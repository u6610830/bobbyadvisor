// Role is derived from the first letter of the entered ID:
//   U / u → student
//   E / e → instructor
//   A / a → admin
// Returns null if the ID doesn't start with a recognized prefix.
export function getRoleFromId(id) {
  const prefix = id.trim().charAt(0).toUpperCase();
  if (prefix === "U") return "student";
  if (prefix === "E") return "instructor";
  if (prefix === "A") return "admin";
  return null;
}
