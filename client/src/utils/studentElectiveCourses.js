// Shared helpers for student-editable course status on Graduation Check —
// see server/supabase_student_elective_courses.sql. A student can set/
// override the status (Completed / In Progress / Not Taken) of a course
// already on Admin's pre-approved list in ANY requirement block, and can
// also add a brand-new course not on that list under any block Admin has
// ticked "Student can add subject" for on Upload Table Data (Major
// Elective Group 1A, Group 1B, Other Major Elective, Free Elective, and
// any future group Admin ticks the same way). Whether a block allows this
// comes straight from that checkbox (block.allowAddCourse, persisted as
// curriculum_groups.allow_add_course — see
// server/supabase_curriculum_groups_allow_add.sql), never a hardcoded
// list of group names or an inferred field — so a brand-new elective
// group works here the moment Admin ticks it, with no code change. Used
// by both Graduation Check (where the student manages these) and
// Planner's "Check course left" (which must show the same status), so the
// two never drift apart, and by the Advisor's read-only view of a
// specific student (same table, same merge — see
// InstructorStudentAnalytics.jsx), so it never drifts from either.
import axios from "axios";
import { normalizeCourseCode } from "./courseCode.js";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

/** The group_name key status-override rows are stored/looked up under for
 * a given block — its own heading (block.label), falling back to
 * block.group if a block somehow has no label. block.label is what
 * uniquely and correctly identifies a block: it's the exact heading Admin
 * gave it, so two different blocks (e.g. Major Elective Group 1A vs Group
 * 1B) never collide even if some other field on one of them is wrong or
 * reused — unlike block.group, which is only a coarse category tag and
 * has been seen misconfigured on real uploaded data (a Group 1B block
 * tagged with the same block.group as General Education). Keying by
 * label instead keeps every block's self-added/overridden courses
 * correctly isolated from every other block, including ones added in the
 * future, with no per-group-name code to maintain. */
export function statusOverrideGroupKey(block) {
  return block?.label || block?.group || "";
}

/** Whether a student can add a brand-new course (not already on Admin's
 * list) under this block — true only when Admin ticked "Student can add
 * subject" for it on Upload Table Data (block.allowAddCourse), regardless
 * of the block's Selection mode or name. A block Admin hasn't ticked
 * still supports editing the status of its existing courses via
 * mergeElectiveGroupRows below, just not adding new ones — its list stays
 * fixed by Admin. */
export function canAddCourseToGroup(block) {
  return Boolean(block?.allowAddCourse);
}

/** Every self-added/overridden elective-course row this student has saved,
 * across both groups. Best-effort — resolves to [] on failure so a problem
 * loading these never blocks the rest of the caller's page. */
export function fetchStudentElectiveCourses(studentId) {
  if (!studentId) return Promise.resolve([]);
  return axios
    .get(`${API_BASE}/student-elective-courses?student_id=${studentId}`)
    .then((res) => res.data || [])
    .catch((err) => {
      console.error("Failed to load self-added elective courses:", err);
      return [];
    });
}

// One row per course shown for a block: every course on Admin's
// pre-approved list for this group (block.courses), with its status
// overridden if the student has a saved row for it, PLUS — for blocks
// Admin ticked "Student can add subject" for only (see canAddCourseToGroup
// above) — any extra course the student added themselves that isn't
// already on that list. A course on
// the pre-approved list keeps its official name/credits from the
// curriculum even when overridden; only its status changes. `groupKey` is
// the value from statusOverrideGroupKey(block) above.
//
// Matching a saved status row back to its curriculum course is done via
// normalizeCourseCode() on both sides — never a raw string match. Admin's
// checklist often has codes with a space ("CSX 4202") or a hyphen
// ("CSX4183-99"), while the server always normalizes (strips to
// "CSX4202") before saving. Comparing the raw, un-normalized codes here
// would silently fail to find the existing row and add a second,
// duplicate-looking one instead of updating it in place.
export function mergeElectiveGroupRows(blockCourses, groupKey, electiveCourses) {
  const overridesByCode = new Map(
    electiveCourses
      .filter((c) => c.group_name === groupKey)
      .map((c) => [normalizeCourseCode(c.course_code) || c.course_code, c])
  );
  const fixedCodes = new Set(blockCourses.map((c) => normalizeCourseCode(c.code) || c.code));

  const fixedRows = blockCourses.map((c) => {
    const override = overridesByCode.get(normalizeCourseCode(c.code) || c.code);
    return {
      code: c.code,
      name: c.name,
      credits: c.credits,
      status: override ? override.status : c.status,
      removable: false,
    };
  });

  const extraRows = electiveCourses
    .filter(
      (c) => c.group_name === groupKey && !fixedCodes.has(normalizeCourseCode(c.course_code) || c.course_code)
    )
    .map((c) => ({
      code: c.course_code,
      name: c.course_name,
      credits: c.credits,
      status: c.status,
      id: c.id,
      removable: true,
    }));

  return [...fixedRows, ...extraRows];
}

/** Credits toward this block's target from a merged row list (see
 * mergeElectiveGroupRows above) — every "completed" row counts once,
 * whether it came from Admin's list or the student's own additions. */
export function electiveGroupCreditsEarned(rows) {
  return rows
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + Number(r.credits || 0), 0);
}
