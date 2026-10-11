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
// Senior Project I needs at least 70 credits earned (no year rule); Senior
// Project II needs at least 100 credits earned (and Senior Project I passed —
// see FORCED_PREREQS). Keep in sync with SENIOR_PROJECT_REQUIREMENTS in
// server/server.js.
export const SENIOR_PROJECT_REQUIREMENTS = {
  CSX3010: { minCredits: 70 },
  CSX3011: { minCredits: 100 },
};

/**
 * Year of study from the student ID (first two digits = admission year in
 * B.E., e.g. 66xxxxx -> 2566). The academic year starts in August. Returns
 * null when the ID can't be read — the year rule is then not applied.
 */
export function getStudentYearLevel(studentId, now = new Date()) {
  const digits = String(studentId || "").replace(/\D/g, "");
  if (digits.length < 3) return null;
  const admissionBE = 2500 + Number(digits.slice(0, 2));
  if (!Number.isFinite(admissionBE)) return null;
  const currentBE = now.getFullYear() + 543;
  const academicYearBE = now.getMonth() >= 7 ? currentBE : currentBE - 1;
  const level = academicYearBE - admissionBE + 1;
  return level >= 1 && level <= 10 ? level : null;
}

/**
 * Everything stopping a student from taking `code` because of the fixed
 * Senior Project rules (empty list = allowed).
 */
export function seniorProjectProblems(code, { passedCodes, creditsEarned, studentId }) {
  const normalized = normalizeCourseCode(code);
  const problems = [];

  const missing = forcedMissingPrereqs(normalized, passedCodes);
  if (missing.length > 0) problems.push(`has not yet passed ${missing.join(", ")}`);

  const rule = SENIOR_PROJECT_REQUIREMENTS[normalized];
  if (rule) {
    const yearLevel = getStudentYearLevel(studentId);
    if (rule.minYear && yearLevel !== null && yearLevel < rule.minYear) {
      problems.push(`must be in year ${rule.minYear} or higher`);
    }
    if (rule.minCredits && creditsEarned < rule.minCredits) {
      problems.push(`needs at least ${rule.minCredits} credits earned (currently ${creditsEarned})`);
    }
  }
  return problems;
}