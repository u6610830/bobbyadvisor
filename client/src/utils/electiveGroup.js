// The Major Elective sub-groups a student picks between on Goal and
// Career, and which the Planner's "Check course left" / Graduation Check
// filter to. Which blocks belong to this "choose one of these" set is
// driven entirely by Admin's checkbox on Upload Table Data
// (block.chooseOneGroup, persisted as curriculum_groups.is_choose_one_group
// — see server/supabase_curriculum_groups_choose_one.sql), never a
// hard-coded name/pattern — so ticking a brand-new block (a future Group
// 1C, or any other pair of alternative groups) is all it takes for it to
// show up everywhere else too.
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

/**
 * The identifier a ticked block is chosen/matched by — its own heading
 * (block.label), the same stable, admin-authored string used to key its
 * self-added/status-override courses (see statusOverrideGroupKey in
 * utils/studentElectiveCourses.js). Returns null for a block Admin hasn't
 * ticked as part of a "choose one" set — such blocks are never filtered
 * out and never offered as a choice.
 */
export function getBlockElectiveGroupId(block) {
  if (!block?.chooseOneGroup) return null;
  return block.label || block.group || null;
}

/**
 * Every "choose one of these" alternative this curriculum actually
 * offers, e.g. [{ id, fullName }, ...] — one entry per block Admin ticked,
 * derived from `blocks` (as returned by utils/curriculum.js
 * getCurriculumGroups, or the `.blocks` from evaluateCurriculumProgress),
 * in the order they appear. Empty if Admin hasn't ticked any block for
 * this curriculum.
 */
export function getElectiveGroupOptions(blocks) {
  if (!Array.isArray(blocks)) return [];
  const seen = new Map();
  blocks.forEach((block) => {
    const id = getBlockElectiveGroupId(block);
    if (id && !seen.has(id)) seen.set(id, block.label || block.group || id);
  });
  return Array.from(seen, ([id, fullName]) => ({ id, fullName }));
}

/** The display name for one alternative's id, looked up from the same
 * `blocks` getElectiveGroupOptions() would use. Returns "" if that id
 * isn't (or is no longer) offered by this curriculum. */
export function electiveGroupFullName(groupId, blocks) {
  if (!groupId) return "";
  return getElectiveGroupOptions(blocks).find((opt) => opt.id === groupId)?.fullName || "";
}

/** The student's saved elective-group choice (a block's label, or null).
 * Stored in the database (students.elective_group), not localStorage, so
 * it's tied to the student's actual record rather than one browser. */
export async function getStudentElectiveGroup(studentId) {
  if (!studentId) return null;
  const res = await axios.get(`${API_BASE}/student-elective-group/${encodeURIComponent(studentId)}`);
  return res.data?.elective_group || null;
}

export async function setStudentElectiveGroup(studentId, groupId) {
  if (!studentId) throw new Error("Student ID is required.");
  const res = await axios.put(`${API_BASE}/student-elective-group/${encodeURIComponent(studentId)}`, {
    electiveGroup: groupId,
  });
  return res.data?.elective_group || null;
}

/**
 * Drops every *other* ticked alternative's requirement block from a
 * curriculum's blocks (as produced by evaluateCurriculumProgress), so a
 * student who chose one group only sees that group's block — whichever
 * other ticked groups exist (a future third alternative included) are all
 * dropped the same way, not just one hard-coded opposite. Every unticked
 * block (General Education, Major Courses, Free Elective, ...) is left
 * untouched. If the student hasn't chosen a group yet, every block is
 * kept as-is.
 */
export function filterBlocksForElectiveGroup(blocks, groupId) {
  if (!Array.isArray(blocks)) return [];
  if (!groupId) return blocks;
  return blocks.filter((block) => {
    const tag = getBlockElectiveGroupId(block);
    return !tag || tag === groupId;
  });
}
