// Manages student self-registration (Register page) and exposes a
// combined roster (mock demo students + real registrations) for the
// Admin pages. Swap for a real API once the backend exists — the shape
// mirrors what a `students` table would return.
import { MOCK_STUDENTS, getStudentByStudentId } from "../data/mockStudents.js";
import { loadState, saveState } from "./storage.js";

const STORAGE_KEY = "registeredStudents";

export function getRegisteredStudents() {
  return loadState(STORAGE_KEY, []);
}

function saveRegisteredStudents(list) {
  saveState(STORAGE_KEY, list);
}

/** True if the Student ID is already taken, by a mock student or a real registration. */
export function isStudentIdTaken(studentId) {
  const id = studentId.trim().toUpperCase();
  if (getStudentByStudentId(id)) return true;
  return getRegisteredStudents().some((s) => s.studentId.toUpperCase() === id);
}

/**
 * Validates and saves a new registration.
 * Returns { ok: true, student } on success, or { ok: false, reasons: string[] }.
 */
export function registerStudent({ studentId, fullName, password, curriculumYear, email }) {
  const reasons = [];
  const id = (studentId || "").trim().toUpperCase();
  const name = (fullName || "").trim();
  const normalizedEmail = (email || "").trim().toLowerCase();

  if (!id) {
    reasons.push("Please enter a Student ID.");
  } else if (!/^U\d{6,8}$/.test(id)) {
    reasons.push("Student ID must start with U followed by 6-8 digits, e.g. U9910000.");
  } else if (isStudentIdTaken(id)) {
    reasons.push(`Student ID ${id} is already registered. Please double-check your ID, or contact Admin if you think this is a mistake.`);
  }

  if (!name) {
    reasons.push("Please enter your full name.");
  }

  if (!password || password.trim().length < 6) {
    reasons.push("Password must be at least 6 characters.");
  }

  if (!curriculumYear) {
    reasons.push("Please select a curriculum year.");
  }

  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    reasons.push("That email address doesn't look valid.");
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  const student = {
    id: `reg-${id}`,
    studentId: id,
    displayName: name,
    email: normalizedEmail || null,
    gpa: "0.00",
    credit: 0,
    careerInterests: [],
    nextSemesterPlan: [],
    advisorNote: "",
    advisorId: null,
    curriculumYear,
    courses: [],
    registeredAt: new Date().toISOString(),
  };

  const list = getRegisteredStudents();
  list.push(student);
  saveRegisteredStudents(list);

  return { ok: true, student };
}

/** Combined roster for Admin pages: demo students + real registrations. */
export function getAllStudentsForAdmin() {
  return [...MOCK_STUDENTS, ...getRegisteredStudents()];
}

export function findStudentByStudentId(studentId) {
  const id = (studentId || "").trim().toUpperCase();
  return getAllStudentsForAdmin().find((s) => s.studentId?.toUpperCase() === id) ?? null;
}

/** Same combined roster, matched by the email linked at registration —
 * used by "Sign in with Microsoft" to map a Microsoft account to a
 * student here. Self-registered students only match if they entered
 * their email on the Register page. */
export function findStudentByEmail(email) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return null;
  return getAllStudentsForAdmin().find((s) => s.email?.toLowerCase() === normalized) ?? null;
}
