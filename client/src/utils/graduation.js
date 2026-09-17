import { getCurriculumGroups } from "./curriculum.js";
import { normalizeCourseCode } from "./courseCode.js";

export const GRADE_POINTS = {
  A: 4.0,
  "A-": 3.75,
  "B+": 3.25,
  B: 3.0,
  "B-": 2.75,
  "C+": 2.25,
  C: 2.0,
  "C-": 1.75,
  D: 1.0,
  F: 0.0,
};

export const REGRADE_GRADES = new Set([
  "C-",
  "D",
  "F",
]);

export const PASSING_WITHOUT_MIN_C = new Set([
  "C-",
  "D",
]);

export const COMPLETED_GRADES = new Set([
  "A", "A-", "B+", "B", "B-", "C+", "C", "S",
]);

export function normalizeGrade(grade) {
  return String(grade || "").trim().toUpperCase();
}

export function isCompletedGrade(grade) {
  return COMPLETED_GRADES.has(normalizeGrade(grade));
}

function semesterOrder(semester) {
  const [term, year] = String(semester || "0/0").split("/").map(Number);
  return (Number.isFinite(year) ? year : 0) * 10 + (Number.isFinite(term) ? term : 0);
}

/** Keep one effective attempt per course. A passing retake replaces earlier
 * attempts; when no attempt passes, the latest attempt is retained. */
export function getFinalCourseGrades(grades) {
  const attemptsByCode = new Map();

  (Array.isArray(grades) ? grades : []).forEach((course) => {
    const rawCode = course.course_code ?? course.code;
    const code = normalizeCourseCode(rawCode) || String(rawCode || "").trim().toUpperCase();
    if (!code) return;
    if (!attemptsByCode.has(code)) attemptsByCode.set(code, []);
    attemptsByCode.get(code).push(course);
  });

  return Array.from(attemptsByCode.values()).map((attempts) => {
    const sorted = [...attempts].sort((a, b) => {
      const semesterDifference =
        semesterOrder(a.Semester ?? a.semester) - semesterOrder(b.Semester ?? b.semester);
      if (semesterDifference !== 0) return semesterDifference;
      return String(a.id ?? "").localeCompare(String(b.id ?? ""));
    });
    const latestPassing = [...sorted].reverse().find((course) => isCompletedGrade(course.grade));
    return latestPassing || sorted[sorted.length - 1];
  });
}

export function calculateGPA(courses) {
  let totalPoints = 0;
  let totalCredits = 0;

  (Array.isArray(courses) ? courses : []).forEach((course) => {
    const grade = normalizeGrade(course.grade);
    const gradePoint = GRADE_POINTS[grade];
    const credits = Number(course.credits);
    // Follow the project's rule: S/W/R/I/F do not contribute to GPA.
    if (gradePoint === undefined || grade === "F" || !Number.isFinite(credits) || credits <= 0) return;
    totalPoints += gradePoint * credits;
    totalCredits += credits;
  });

  if (totalCredits === 0) return 0;
  return Math.round((totalPoints / totalCredits + 1e-9) * 100) / 100;
}

export function prepareCourseRows(courses) {
  return (Array.isArray(courses) ? courses : [])
    .map((course) => {
      const grade = normalizeGrade(course.grade);
      let status = "Not Completed";
      let statusClass = "not-completed";
      if (isCompletedGrade(grade)) {
        status = "Completed";
        statusClass = "completed";
      } else if (grade === "W" || grade === "R") {
        status = "Withdrawn";
        statusClass = "withdrawn";
      } else if (grade === "I") {
        status = "Incomplete";
        statusClass = "incomplete";
      }

      const rawCode = course.course_code ?? course.code;
      return {
        code: normalizeCourseCode(rawCode) || String(rawCode || "-").trim().toUpperCase(),
        name: course.course_name ?? course.name ?? "-",
        semester: course.Semester ?? course.semester ?? "-",
        grade: grade || "-",
        credits: Number(course.credits) || 0,
        status,
        statusClass,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Match an exact curriculum code or a range such as CSX4280-4299 and
 * shorthand CSX4183-99. */
export function courseMatchesRule(completedCode, curriculumCode) {
  const completed = normalizeCourseCode(completedCode);
  if (!completed) return false;

  const exact = normalizeCourseCode(curriculumCode);
  if (exact) return completed === exact;

  const compactRule = String(curriculumCode || "").toUpperCase().replace(/\s+/g, "");
  const range = compactRule.match(/^([A-Z]{2,4})(\d{4})-(?:[A-Z]{2,4})?(\d{2,4})$/);
  if (!range) return false;

  const completedMatch = completed.match(/^([A-Z]{2,4})(\d{3,4})$/);
  if (!completedMatch || completedMatch[1] !== range[1]) return false;

  const start = Number(range[2]);
  const rawEnd = range[3];
  const end = rawEnd.length === 2
    ? Math.floor(start / 100) * 100 + Number(rawEnd)
    : Number(rawEnd);
  const number = Number(completedMatch[2]);
  return number >= start && number <= end;
}

function uniqueRules(courses) {
  const seen = new Map();
  (courses || []).forEach((course) => {
    const key = String(course.code || "").toUpperCase().replace(/\s+/g, "");
    if (key && !seen.has(key)) seen.set(key, course);
  });
  return Array.from(seen.values());
}

function relevantGroups(curriculum, electiveGroupId) {
  const groups = getCurriculumGroups(curriculum);
  const alternatives = groups.filter((group) => group.chooseOneGroup);
  const selectedId = String(electiveGroupId || "").trim();
  return {
    groups: groups.filter((group) => {
      if (!group.chooseOneGroup) return true;
      return selectedId && (group.label || group.group) === selectedId;
    }),
    needsElectiveSelection: alternatives.length > 0 && !selectedId,
  };
}

export function checkGraduation(student, curriculum, options = {}) {
  const gpa = Number(student?.gpa) || 0;
  if (!curriculum) {
    return {
      graduated: false,
      reasons: ["No curriculum requirements were found for this student. Ask Admin to upload the curriculum first."],
      missingCourses: [],
      groupProgress: [],
      totalCredits: 0,
      creditShortfall: 0,
      gpa,
      curriculumYear: null,
      electiveGroupId: options.electiveGroupId || null,
    };
  }

  const finalCourses = getFinalCourseGrades(student?.courses || []);
  const passedCourses = finalCourses.filter((course) => isCompletedGrade(course.grade));
  const passedByCode = new Map();
  passedCourses.forEach((course) => {
    const code = normalizeCourseCode(course.course_code ?? course.code);
    if (code && !passedByCode.has(code)) passedByCode.set(code, course);
  });
  const passedCodes = Array.from(passedByCode.keys());

  const { groups, needsElectiveSelection } = relevantGroups(curriculum, options.electiveGroupId);
  const missingMap = new Map();
  const groupProgress = groups.map((group) => {
    const rules = uniqueRules(group.courses);
    const matchingCodes = passedCodes.filter((code) =>
      rules.some((rule) => courseMatchesRule(code, rule.code))
    );
    const completedCredits = matchingCodes.reduce(
      (sum, code) => sum + (Number(passedByCode.get(code)?.credits) || 0),
      0
    );
    const requiredCredits = Number(group.creditsRequired) || 0;
    const requiredCount = group.mode === "choose" ? Number(group.chooseCount) || 0 : rules.length;
    const missingRules = group.mode === "all"
      ? rules.filter((rule) => !passedCodes.some((code) => courseMatchesRule(code, rule.code)))
      : [];

    missingRules.forEach((course) => {
      const key = String(course.code || "").toUpperCase().replace(/\s+/g, "");
      if (!missingMap.has(key)) missingMap.set(key, { ...course, blockLabel: group.label });
    });

    const remainingCount = group.mode === "choose"
      ? Math.max(requiredCount - matchingCodes.length, 0)
      : missingRules.length;
    const remainingCredits = Math.max(requiredCredits - completedCredits, 0);
    const countSatisfied = remainingCount === 0;
    const creditsSatisfied = requiredCredits === 0 || remainingCredits === 0;

    return {
      id: group.id,
      label: group.label || group.group || "Requirement Group",
      mode: group.mode,
      completedCount: matchingCodes.length,
      requiredCount,
      remainingCount,
      completedCredits,
      requiredCredits,
      remainingCredits,
      satisfied: countSatisfied && creditsSatisfied,
    };
  });

  const missingCourses = Array.from(missingMap.values());
  const totalCredits = passedCourses.reduce((sum, course) => sum + (Number(course.credits) || 0), 0);
  const requiredCredits = Number(curriculum.totalCreditsRequired) || 0;
  const creditShortfall = Math.max(requiredCredits - totalCredits, 0);
  const minimumGPA = Number(curriculum.minGpa) || 0;
  const reasons = [];

  if (needsElectiveSelection) reasons.push("The student has not selected a major elective group.");
  if (missingCourses.length > 0) reasons.push(`${missingCourses.length} compulsory course(s) have not been completed.`);
  groupProgress.filter((group) => !group.satisfied).forEach((group) => {
    const parts = [];
    if (group.remainingCount > 0) parts.push(`${group.remainingCount} more course(s)`);
    if (group.remainingCredits > 0) parts.push(`${group.remainingCredits} more credit(s)`);
    reasons.push(`${group.label}: ${parts.join(" and ")} required.`);
  });
  if (creditShortfall > 0) reasons.push(`${totalCredits} of ${requiredCredits} total credits completed; ${creditShortfall} remain.`);
  if (gpa < minimumGPA) reasons.push(`Cumulative GPA is below the minimum (${gpa.toFixed(2)} / ${minimumGPA.toFixed(2)}).`);

  return {
    graduated: reasons.length === 0,
    reasons,
    missingCourses,
    groupProgress,
    totalCredits,
    creditShortfall,
    gpa,
    curriculumYear: curriculum.year,
    electiveGroupId: options.electiveGroupId || null,
  };
}
