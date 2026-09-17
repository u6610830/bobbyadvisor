// Resolves a login ID (or, for Microsoft sign-in, an email) to its
// role + account record, checking it against the actual rosters (mock +
// self-registered students, mock advisors, mock admins) instead of just
// the ID prefix. This is what makes Login only accept IDs/accounts that
// belong to someone real, per role.
import { getRoleFromId } from "./role.js";
import { findStudentByStudentId, findStudentByEmail } from "./students.js";
import { getAdvisorById, getAdvisorByEmail } from "../data/mockAdvisors.js";
import { getAdminById, getAdminByEmail } from "../data/mockAdmins.js";

/**
 * Returns { role, account } if the ID is a recognized student, advisor
 * (instructor), or admin, or null if the ID doesn't belong to anyone.
 */
export function resolveLoginAccount(id) {
  const role = getRoleFromId(id);
  if (!role) return null;

  if (role === "student") {
    const student = findStudentByStudentId(id);
    return student ? { role, account: student } : null;
  }

  if (role === "instructor") {
    const advisor = getAdvisorById(id);
    return advisor ? { role, account: advisor } : null;
  }

  if (role === "admin") {
    const admin = getAdminById(id);
    return admin ? { role, account: admin } : null;
  }

  return null;
}

/**
 * Same idea as resolveLoginAccount, but matches by email — used for
 * "Sign in with Microsoft", where all we get back is the signed-in
 * person's Microsoft account (name + email/UPN), not one of our own
 * U/E/A-prefixed IDs. Checks student, then advisor, then admin, since
 * emails aren't prefixed the way IDs are.
 */
export function resolveLoginAccountByEmail(email) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return null;

  const student = findStudentByEmail(normalized);
  if (student) return { role: "student", account: student, id: student.studentId };

  const advisor = getAdvisorByEmail(normalized);
  if (advisor) return { role: "instructor", account: advisor, id: advisor.id };

  const admin = getAdminByEmail(normalized);
  if (admin) return { role: "admin", account: admin, id: admin.id };

  return null;
}
