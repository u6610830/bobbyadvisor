import axios from "axios";
import { getPrereqGroups, setPrereqGroups } from "./data/prereqGroups.js";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

// Determines which prerequisite group a student belongs to automatically
// from their student ID — no manual selection needed. The ID's first 3
// digits are the batch code (year + curriculum revision), e.g.
// "u6610001" -> batch code "661" (year 66, revision 1).
//
// Mirrors the columns on the university's course-prerequisite sheet:
//   g1 = batch 62-64          ("Prerequisite for 621 - 643")
//   g2 = batch 65/1, 65/2      ("Prerequisite for 651 - 652")
//   g3 = batch 65/3 onwards    ("Prerequisite for 653 onwards")
//   plus any later group an admin adds (e.g. 671) — see data/prereqGroups.js
function extractBatchCode(studentId) {
  const digits = (studentId || "").replace(/\D/g, "");
  if (digits.length < 3) return null;
  return digits.slice(0, 3); // e.g. "661"
}

/** The 3-digit batch code read from the student's ID, e.g. "661". */
export function getBatchCode(studentId) {
  return extractBatchCode(studentId);
}

/** The student's prerequisite group id ("g1" | "g2" | "g3" | an admin-added
 * id such as "b671"), derived purely from their student ID, or null if the
 * ID can't be parsed. A student belongs to the latest group whose starting
 * batch code is <= their own batch code. */
export function getCurrentPrereqGroupId(studentId) {
  const batchCode = extractBatchCode(studentId);
  if (!batchCode) return null;

  const code = Number(batchCode);
  if (!Number.isFinite(code)) return null;

  const groups = getPrereqGroups();
  let match = groups[0];
  for (const g of groups) {
    if (g.from_batch <= code) match = g;
  }
  return match?.id ?? null;
}

/** Fetch the group list (built-in + admin-added) from the server and make it
 * the active one. Resolves to the list; on failure keeps the built-ins. */
export async function loadPrereqGroups() {
  try {
    const res = await axios.get(`${API_BASE}/prereq-groups`);
    setPrereqGroups(res.data?.groups);
  } catch (err) {
    console.error("Failed to load prerequisite groups:", err);
  }
  return getPrereqGroups();
}