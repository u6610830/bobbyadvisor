// Manages graduation-requirement tables (curriculum year -> required
// courses / total credits / min GPA). Admin's "Upload Table Data" page
// writes here; Graduation Check and Excel Check read from here.
//
// The source of truth is the `curricula`/`curriculum_groups` tables in
// Supabase (see server/supabase_curricula.sql and the /curricula endpoints
// in server.js). To avoid turning every reader of this module into an
// async component, the DB is mirrored into the same localStorage cache
// this module always used: syncCurriculaFromServer() refreshes the cache
// and fires a "curricula:updated" window event; components that memoize
// on curriculum data should subscribe via subscribeCurricula() and
// include the resulting version in their dependency list. Everything else
// (getAllCurricula/getCurriculum/etc.) keeps reading the cache
// synchronously, unchanged.
import axios from "axios";
import { DEFAULT_CURRICULA } from "../data/mockCurriculum.js";
import { loadState, saveState } from "./storage.js";
import { getBatchCode } from "./prereqGroup.js";
import { DEFAULT_COURSE_GROUPS } from "./courseGroups.js";

const STORAGE_KEY = "curricula";
const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");
const UPDATED_EVENT = "curricula:updated";

/** All curricula, with Admin-uploaded/edited entries overriding the defaults. */
export function getAllCurricula() {
  const custom = loadState(STORAGE_KEY, {});
  return { ...DEFAULT_CURRICULA, ...custom };
}

/** Refresh the local cache from the database. Call on page/app mount so
 * synchronous readers below see up-to-date data as soon as possible. */
export async function syncCurriculaFromServer() {
  try {
    const res = await axios.get(`${API_BASE}/curricula`);
    saveState(STORAGE_KEY, res.data?.curricula || {});
    window.dispatchEvent(new Event(UPDATED_EVENT));
  } catch (err) {
    console.error("Failed to sync curricula from database:", err);
  }
}

/** Subscribe to cache refreshes (from syncCurriculaFromServer, or after a
 * save/delete). Returns an unsubscribe function. */
export function subscribeCurricula(callback) {
  window.addEventListener(UPDATED_EVENT, callback);
  return () => window.removeEventListener(UPDATED_EVENT, callback);
}

export function getAvailableYears() {
  return Object.keys(getAllCurricula()).sort();
}

export function getCurriculum(year) {
  const all = getAllCurricula();
  return all[year] ?? null;
}

export async function saveCurriculum(year, data) {
  if (!year) throw new Error("Curriculum year is required.");

  // Save to the database FIRST — only mirror into the local cache once
  // the server confirms it actually persisted. Writing to the cache
  // optimistically (before confirming success) made a failed save look
  // identical to a successful one in the browser that made the edit,
  // even though the database was never actually updated — the change
  // would only vanish again on the next full sync from the server.
  await axios.put(`${API_BASE}/curricula/${encodeURIComponent(year)}`, data);

  const custom = loadState(STORAGE_KEY, {});
  custom[year] = { ...data, year };
  saveState(STORAGE_KEY, custom);
  window.dispatchEvent(new Event(UPDATED_EVENT));

  return custom[year];
}

export async function deleteCurriculum(year) {
  // Same ordering fix as saveCurriculum: confirm the database delete
  // succeeded before touching the local cache.
  await axios.delete(`${API_BASE}/curricula/${encodeURIComponent(year)}`);

  const custom = loadState(STORAGE_KEY, {});
  delete custom[year];
  saveState(STORAGE_KEY, custom);
  window.dispatchEvent(new Event(UPDATED_EVENT));
}

/** Reset all Admin-uploaded overrides, falling back to the built-in defaults. */
export function resetCurricula() {
  saveState(STORAGE_KEY, {});
}

/**
 * A curriculum's requirement blocks/groups, e.g.:
 *   { id, label, group, mode: "all" | "choose", chooseCount, creditsRequired, courses: [{code,name,credits}] }
 * Normalizes the older flat `requiredCourses` shape (still used by a few
 * built-in defaults) into a single "all required" block, so every caller
 * can read `groups` without caring which shape was actually saved.
 */
export function getCurriculumGroups(curriculum) {
  if (!curriculum) return [];
  if (Array.isArray(curriculum.groups)) return curriculum.groups;
  const requiredCourses = Array.isArray(curriculum.requiredCourses) ? curriculum.requiredCourses : [];
  if (requiredCourses.length === 0) return [];
  return [
    {
      id: "legacy-required",
      label: "Required Courses",
      group: DEFAULT_COURSE_GROUPS[0],
      mode: "all",
      chooseCount: requiredCourses.length,
      creditsRequired: requiredCourses.reduce((sum, c) => sum + (Number(c.credits) || 0), 0),
      courses: requiredCourses,
    },
  ];
}

// Student IDs start with "U" followed by a batch code whose first two
// digits are the Thai Buddhist-era admission year, e.g. "U6610001" ->
// "66" -> B.E. 2566 -> C.E. 2023. Mirrors the batch-code parsing already
// used for prerequisite groups (see prereqGroup.js) so both features stay
// consistent and neither needs the student to pick a year manually.
function beYearToCeYear(beYear) {
  return 1957 + beYear; // e.g. 66 -> 2023
}

/** The curriculum year (as a string, e.g. "2023") that applies to a given
 * student, derived automatically from their student ID. Falls back to the
 * closest available year (not exceeding it) if there's no exact match, or
 * null if the ID can't be parsed at all. */
export function getCurriculumYearForStudent(studentId) {
  const batchCode = getBatchCode(studentId);
  if (!batchCode) return null;

  const beYear = Number(batchCode.slice(0, 2));
  if (!Number.isFinite(beYear)) return null;
  const ceYear = beYearToCeYear(beYear);

  const years = getAvailableYears();
  if (years.length === 0) return null;
  if (years.includes(String(ceYear))) return String(ceYear);

  const numericYears = years.map(Number).filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
  const notExceeding = numericYears.filter((y) => y <= ceYear);
  if (notExceeding.length > 0) return String(notExceeding[notExceeding.length - 1]);
  return String(numericYears[0]);
}

/** The full curriculum record that applies to a given student, or null. */
export function getCurriculumForStudent(studentId, selectedYear = null) {
  // A curriculum explicitly saved on the student's profile always wins.
  // Older records may not have this field, so retain the batch-ID fallback.
  const selected = selectedYear ? getCurriculum(String(selectedYear)) : null;
  if (selected) return selected;
  const year = getCurriculumYearForStudent(studentId);
  return year ? getCurriculum(year) : null;
}
