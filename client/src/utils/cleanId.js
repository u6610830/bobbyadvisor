// Shared ID-normalization helper used anywhere a student/advisor ID
// might arrive in a different shape than it's stored elsewhere —
// e.g. "student-u6610001" (mock data's internal id) vs "U6610001"
// (the real value that flows in from login / the students table).
//
// Strips a leading "student-" or "advisor-" prefix (case-insensitive)
// and lowercases everything, so two IDs that refer to the same person
// always compare equal regardless of which shape either side is in.
export function cleanId(rawId) {
  return String(rawId ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(student|advisor)-/, "");
}
