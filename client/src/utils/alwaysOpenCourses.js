// Courses that are open EVERY term. They have no timetable rows (no class
// meetings), so they must never depend on the timetable to count as open.
// Keep in sync with ALWAYS_OPEN_COURSE_CODES in server/server.js.
import { normalizeCourseCode } from "./courseCode.js";

export const ALWAYS_OPEN_COURSES = [
  { code: "CSX3010", name: "Senior Project" },
  { code: "CSX3011", name: "Senior Project II" },
];

const CODES = new Set(ALWAYS_OPEN_COURSES.map((c) => c.code));

export function isAlwaysOpenCourse(code) {
  return CODES.has(normalizeCourseCode(code));
}

// Fixed prerequisites that always apply, whatever the Pre-Require table says:
// Senior Project II can only be registered after Senior Project I is passed.
// Keep in sync with FORCED_PREREQS in server/server.js.
export const FORCED_PREREQS = {
  CSX3011: ["CSX3010"],
};

/** Forced prerequisites of `code` that the student has not passed yet. */
export function forcedMissingPrereqs(code, passedCodes) {
  const required = FORCED_PREREQS[normalizeCourseCode(code)] || [];
  return required.filter((c) => !passedCodes.has(c));
}