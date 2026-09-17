// Manages the shared taxonomy of "Course" groups (e.g. Major Courses,
// Major Elective, General Education, Free Elective) that Admin can add,
// rename, or delete. Used by both the All Courses page (per-course group)
// and the Upload Table Data page (per-requirement-block group), so a group
// renamed here shows up consistently in both places.
import { loadState, saveState } from "./storage.js";

const STORAGE_KEY = "courseGroups";

export const DEFAULT_COURSE_GROUPS = [
  "A. General Education Courses",
  "Core Courses",
  "Major Courses",
  "Major Elective Courses (Group 1A) - Software Engineering and Development",
  "Major Elective Courses (Group 1B) - Informatics and Data Science",
  "Other Major Elective Courses",
  "C. Free Elective Course",
];

// Short-form names from before DEFAULT_COURSE_GROUPS above was replaced
// with the full 7-item taxonomy — some browsers still have these saved
// (e.g. from an earlier Excel import), which show up as near-duplicates
// of "A. General Education Courses" / "Major Elective Courses (Group ...)"
// / "C. Free Elective Course". Stripped out below wherever the stored list
// is read, so this is a one-time, self-healing cleanup rather than
// something Admin has to fix by hand in every browser.
const LEGACY_GROUP_NAMES = ["Major Elective", "General Education", "Free Elective"];

/** The current list of course group names, admin defaults unless overridden. */
export function getCourseGroups() {
  const custom = loadState(STORAGE_KEY, null);
  if (!Array.isArray(custom) || custom.length === 0) return [...DEFAULT_COURSE_GROUPS];

  const cleaned = custom.filter((g) => !LEGACY_GROUP_NAMES.includes(g));
  if (cleaned.length !== custom.length) saveState(STORAGE_KEY, cleaned);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_COURSE_GROUPS];
}

export function addCourseGroup(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return getCourseGroups();
  const groups = getCourseGroups();
  if (groups.some((g) => g.toLowerCase() === trimmed.toLowerCase())) return groups;
  const next = [...groups, trimmed];
  saveState(STORAGE_KEY, next);
  return next;
}

export function renameCourseGroup(oldName, newName) {
  const trimmed = (newName || "").trim();
  if (!trimmed) return getCourseGroups();
  const groups = getCourseGroups();
  const next = groups.map((g) => (g === oldName ? trimmed : g));
  saveState(STORAGE_KEY, next);
  return next;
}

export function deleteCourseGroup(name) {
  const groups = getCourseGroups();
  const next = groups.filter((g) => g !== name);
  saveState(STORAGE_KEY, next);
  return next;
}
