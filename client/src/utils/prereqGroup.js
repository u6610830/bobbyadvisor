// Determines which prerequisite group a student belongs to automatically
// from their student ID — no manual selection needed. The ID's first 3
// digits are the batch code (year + curriculum revision), e.g.
// "u6610001" -> batch code "661" (year 66, revision 1).
//
// Mirrors the columns on the university's course-prerequisite sheet:
//   g1 = batch 62-64
//   g2 = batch 65/1, 65/2
//   g3 = batch 65/3 onwards

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.PROD
    ? "https://api.bobbyadvisor.org"
    : "http://localhost:3001");

function extractBatchCode(studentId) {
  const digits = (studentId || "").replace(/\D/g, "");

  if (digits.length < 3) return null;

  return digits.slice(0, 3);
}

/** The 3-digit batch code read from the student's ID, e.g. "661". */
export function getBatchCode(studentId) {
  return extractBatchCode(studentId);
}

/** The student's prerequisite group id ("g1" | "g2" | "g3"), derived
 * purely from their student ID, or null if the ID can't be parsed. */
export function getCurrentPrereqGroupId(studentId) {
  const batchCode = extractBatchCode(studentId);

  if (!batchCode) return null;

  const year = Number(batchCode.slice(0, 2));
  const revision = Number(batchCode.slice(2, 3));

  if (!Number.isFinite(year) || !Number.isFinite(revision)) {
    return null;
  }

  if (year < 65) return "g1";

  if (year === 65) {
    return revision <= 2 ? "g2" : "g3";
  }

  return "g3";
}

/**
 * Load the prerequisite groups from the backend.
 * Used by the Admin Pre-Require page when groups are
 * added or deleted.
 */
export async function loadPrereqGroups() {
  const response = await fetch(`${API_BASE}/prereq-groups`);

  if (!response.ok) {
    throw new Error("Failed to load prerequisite groups.");
  }

  return response.json();
}