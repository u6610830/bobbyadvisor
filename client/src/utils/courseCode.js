// Small shared helpers for turning free-text course codes (which show up
// in slightly different formats across the timetable, prerequisites, and
// grades data) into one canonical form for comparison for both Planner.jsx
// and the student Graduation Check page.

/** Canonical course code form, e.g. "CSX-4202" / "csx 4202" -> "CSX4202". */
export function normalizeCourseCode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2,4}\d{3,4}$/.test(compact) ? compact : "";
}

/** Pulls every course code out of free text, e.g. a prerequisite string. */
export function extractCourseCodes(text) {
  if (!text) return [];
  const matches = String(text).toUpperCase().match(/[A-Z]{2,4}(?:\s*-\s*|\s*)\d{3,4}/g);
  return matches ? [...new Set(matches.map(normalizeCourseCode).filter(Boolean))] : [];
}
