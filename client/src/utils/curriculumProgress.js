// Compares a student's completed/in-progress courses against a
// curriculum's requirement blocks (see utils/curriculum.js ->
// getCurriculumGroups) and reports, per block, which courses are done,
// which are currently planned, which need a retake, and which are missing.

import { getCurriculumGroups } from "./curriculum.js";
import { normalizeCourseCode } from "./courseCode.js";
import {
  courseMatchesRule,
  REGRADE_GRADES,
} from "./graduation.js";

/**
 * @param {object|null} curriculum
 * @param {Set<string>} completedCodes - normalized course codes with a passing grade
 * @param {Set<string>} inProgressCodes - normalized course codes currently in the student's Planner
 * @param {Map<string, string>} gradesByCode - final grade by normalized course code
 * @returns {{
 *   blocks: Array<{
 *     id, label, group, mode, chooseCount, creditsRequired,
 *     courses: Array<{code, name, credits, status: "completed"|"in-progress"|"not-taken"|"re-grade"}>,
 *     completedCount, inProgressCount, satisfied: boolean,
 *   }>,
 *   missingCourses: Array<{code, name, credits, blockLabel}>,
 * }}
 */
export function evaluateCurriculumProgress(
  curriculum,
  completedCodes,
  inProgressCodes,
  gradesByCode
) {
  const groups = getCurriculumGroups(curriculum);

  const completed = completedCodes || new Set();
  const inProgress = inProgressCodes || new Set();
  const grades = gradesByCode || new Map();

  const blocks = groups.map((block) => {
    const courses = (block.courses || []).map((course) => {
      const code =
        normalizeCourseCode(course.code) ||
        String(course.code || "").toUpperCase();

      let status = "not-taken";

      if (
        [...completed].some((completedCode) =>
          courseMatchesRule(completedCode, course.code)
        )
      ) {
        status = "completed";
      } else if (
        [...inProgress].some((plannedCode) =>
          courseMatchesRule(plannedCode, course.code)
        )
      ) {
        status = "in-progress";
      } else {
        const recordedGrade = [...grades.entries()].find(
          ([gradeCode]) => courseMatchesRule(gradeCode, course.code)
        )?.[1];

        const needsRegrade = course.minGradeC
          ? recordedGrade && REGRADE_GRADES.has(recordedGrade)
          : recordedGrade === "F" || recordedGrade === "W";

        if (needsRegrade) {
          status = "re-grade";
        }
      }

      return {
        ...course,
        code,
        status,
      };
    });

    const completedCount = courses.filter(
      (c) => c.status === "completed"
    ).length;

    const inProgressCount = courses.filter(
      (c) => c.status === "in-progress"
    ).length;

    const satisfied =
      block.mode === "all"
        ? courses.length > 0 &&
          completedCount === courses.length
        : completedCount >= (block.chooseCount || 0);

    return {
      ...block,
      courses,
      completedCount,
      inProgressCount,
      satisfied,
    };
  });

  const missingCourses = [];

  blocks.forEach((block) => {
    // Retake is still unfinished, so it belongs in missingCourses.
    const unfinished = block.courses.filter(
      (c) =>
        c.status === "not-taken" ||
        c.status === "re-grade"
    );

    if (block.mode === "all") {
      unfinished.forEach((c) =>
        missingCourses.push({
          ...c,
          blockLabel: block.label,
        })
      );
    } else if (!block.satisfied) {
      unfinished.forEach((c) =>
        missingCourses.push({
          ...c,
          blockLabel: block.label,
        })
      );
    }
  });

  return {
    blocks,
    missingCourses,
  };
}
