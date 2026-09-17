// Static placeholder roster — swap for a real API once the instructor
// backend exists. Also doubles as (part of) the Login whitelist for the
// "student" role — see utils/students.js#findStudentByStudentId, which
// combines this with any real self-registrations.

import { MOCK_ADVISORS } from "./mockAdvisors.js";
import { DEFAULT_CURRICULA } from "./mockCurriculum.js";
import { cleanId } from "../utils/cleanId.js";

const DEFAULT_CAREER_INTERESTS = ["Software Engineer", "AI Engineer"];
const DEFAULT_NEXT_SEMESTER_PLAN = ["CSX-9000", "CSX-9001", "CSX-9002", "CSX-9003"];
const DEFAULT_NOTE = "No major concerns right now — keep up the good work.";
const CURRICULUM_YEAR = "2024";

// Every course listed across a curriculum's requirement groups, flattened
// into one list (a course can only need to be "passed" once even if it
// could count toward more than one group).
function flattenCurriculumCourses(curriculum) {
  if (!curriculum) return [];
  const groups = Array.isArray(curriculum.groups) ? curriculum.groups : [];
  const seen = new Map();
  groups.forEach((block) => {
    (block.courses || []).forEach((course) => {
      if (!seen.has(course.code)) seen.set(course.code, course);
    });
  });
  return [...seen.values()];
}

// Builds a plausible transcript for a mock student: the student "passes"
// the first `passCount` required courses of their curriculum and is
// missing the rest — enough variety for the Graduation Check demo to show
// both Graduated and Not Graduated outcomes with real reasons.
function buildMockCourses(curriculumYear, passCount) {
  const curriculum = DEFAULT_CURRICULA[curriculumYear];
  if (!curriculum) return [];

  return flattenCurriculumCourses(curriculum)
    .slice(0, passCount)
    .map((course, idx) => ({
      code: course.code,
      name: course.name,
      credits: course.credits,
      grade: idx % 5 === 0 ? "B" : idx % 3 === 0 ? "B+" : "A",
      semester: "1/2025",
    }));
}

const CURRICULUM_2024_COURSE_COUNT = flattenCurriculumCourses(DEFAULT_CURRICULA[CURRICULUM_YEAR]).length;

// The only two accounts allowed to log in as "student" for now (see
// pages/Login.jsx), each pre-linked to their advisor.
export const MOCK_STUDENTS = [
  {
    id: "student-u6610001",
    studentId: "U6610001",
    displayName: "Mr. Johnny Light",
    email: "u6610001@school.edu",
    department: "Computer Science",
    gpa: "3.33",
    credit: 92,
    careerInterests: DEFAULT_CAREER_INTERESTS,
    nextSemesterPlan: DEFAULT_NEXT_SEMESTER_PLAN,
    advisorNote: DEFAULT_NOTE,
    advisorId: MOCK_ADVISORS[0].id, // E1001 — Asst. Prof. Shinnosuke Nohara
    curriculumYear: CURRICULUM_YEAR,
    courses: buildMockCourses(CURRICULUM_YEAR, CURRICULUM_2024_COURSE_COUNT),
  },
  {
    id: "student-u6610002",
    studentId: "U6610002",
    displayName: "Ms. Angelica Slient",
    email: "u6610002@school.edu",
    department: "Computer Science",
    gpa: "3.05",
    credit: 61,
    careerInterests: DEFAULT_CAREER_INTERESTS,
    nextSemesterPlan: DEFAULT_NEXT_SEMESTER_PLAN,
    advisorNote: DEFAULT_NOTE,
    advisorId: MOCK_ADVISORS[1].id, // E1002 — Asst. Prof. Toru Kazama
    curriculumYear: CURRICULUM_YEAR,
    courses: buildMockCourses(CURRICULUM_YEAR, Math.max(1, CURRICULUM_2024_COURSE_COUNT - 3)),
  },
];

export function getStudentById(id) {
  return MOCK_STUDENTS.find((s) => s.id === id) ?? null;
}

export function getStudentByStudentId(studentId) {
  const id = (studentId || "").trim().toUpperCase();
  return MOCK_STUDENTS.find((s) => s.studentId.toUpperCase() === id) ?? null;
}

// Prefix/case-tolerant lookup — matches on either the internal `id`
// (e.g. "student-u6610001") or the plain `studentId` (e.g. "U6610001"),
// after normalizing both sides with cleanId(). Use this instead of
// getStudentById() whenever the caller's ID might come from a source
// (login, the real students table, a chat thread) that doesn't share
// mock data's "student-" prefix convention.
export function getStudentByAnyId(rawId) {
  const target = cleanId(rawId);
  if (!target) return null;
  return (
    MOCK_STUDENTS.find((s) => cleanId(s.id) === target) ??
    MOCK_STUDENTS.find((s) => cleanId(s.studentId) === target) ??
    null
  );
}

export function getStudentByEmail(email) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return null;
  return MOCK_STUDENTS.find((s) => s.email?.toLowerCase() === normalized) ?? null;
}
