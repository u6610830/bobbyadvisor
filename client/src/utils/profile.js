// Tracks which Advisor a logged-in student currently has. Login in this
// app only checks the ID prefix (see utils/role.js) — it doesn't require
// the student to exist in the roster — so advisor assignment is tracked
// per Student ID here, independent of the mock/registered roster. A
// student's initial default (if any) comes from their registration
// record; after that, changes are saved as an override in this store.
import { findStudentByStudentId } from "./students.js";
import { getAdvisorById } from "../data/mockAdvisors.js";
import { loadState, saveState } from "./storage.js";

const STORAGE_KEY = "studentAdvisorProfile"; // { [studentId]: { advisorId, updatedAt } }
const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

function getOverrides() {
  return loadState(STORAGE_KEY, {});
}

function normalizeId(studentId) {
  return (studentId || "").trim().toUpperCase();
}

/** The student's current advisor id, or null if none has been set yet. */
export function getCurrentAdvisorId(studentId) {
  const id = normalizeId(studentId);
  if (!id) return null;

  const overrides = getOverrides();
  if (overrides[id]?.advisorId) return overrides[id].advisorId;

  const record = findStudentByStudentId(id);
  return record?.advisorId ?? null;
}

export function getCurrentAdvisor(studentId) {
  const advisorId = getCurrentAdvisorId(studentId);
  return advisorId ? getAdvisorById(advisorId) : null;
}

export function hasAdvisor(studentId) {
  return !!getCurrentAdvisorId(studentId);
}

export function setCurrentAdvisor(studentId, advisorId) {
  const id = normalizeId(studentId);
  if (!id) throw new Error("Student ID is required.");
  if (!getAdvisorById(advisorId)) throw new Error("Invalid advisor.");

  const overrides = getOverrides();
  overrides[id] = { advisorId, updatedAt: new Date().toISOString() };
  saveState(STORAGE_KEY, overrides);

  // Keep the database in sync so the advisor portal can find this student.
  // Local storage remains as the immediate UI source, so the existing login
  // flow stays synchronous and does not need to be rewritten.
  fetch(`${API_BASE}/student-advisor/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ advisorId }),
  }).catch((error) => {
    console.warn("Could not sync advisor assignment to database:", error);
  });

  return overrides[id];
}
