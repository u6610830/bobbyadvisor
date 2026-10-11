import { getMinGradeCRules, passesForCourse } from "./graduation.js";
import { normalizeCourseCode } from "./courseCode.js";

/**
 * Passed course codes and total credits earned, using the same rules as
 * Dashboard / Graduation Check: A..C and S always pass; C- and D pass EXCEPT in
 * courses Admin marked "Min C"; F/W/R/I never pass; each course counts once.
 */
export function computePassedAndCredits(gradeRows, curriculum) {
  const minCRules = getMinGradeCRules(curriculum);
  const passes = (code, grade) => passesForCourse(code, grade, minCRules);

  const best = new Map(); // code -> credits of the passing attempt
  (gradeRows || []).forEach((row) => {
    const code =
      normalizeCourseCode(row.course_code) || String(row.course_code || "").trim().toUpperCase();
    if (!code || !passes(code, row.grade)) return;
    best.set(code, Math.max(best.get(code) || 0, Number(row.credits) || 0));
  });

  return {
    passedCodes: new Set(best.keys()),
    creditsEarned: [...best.values()].reduce((sum, c) => sum + c, 0),
  };
}
