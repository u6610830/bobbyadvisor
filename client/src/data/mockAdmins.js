// Static placeholder admin roster — swap for a real API once the admin
// backend exists. Also doubles as the Login whitelist for the "admin" role.
//
// Passwords: Admin authenticates against a password stored in the
// `admins` table (see server/supabase_admins_table.sql), seeded with a
// temporary password of "0000". Admin can change it from Profile
// (see changeAdminPassword below / PUT /admins/:id/password).
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

export const MOCK_ADMINS = [
  { id: "A1001", name: "Mr. David Dance", department: "Computer Science", email: "david.d@school.edu" },
];

export function getAdminById(id) {
  const normalized = (id || "").trim().toUpperCase();
  return MOCK_ADMINS.find((a) => a.id.toUpperCase() === normalized) ?? null;
}

export function getAdminByEmail(email) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return null;
  return MOCK_ADMINS.find((a) => a.email?.toLowerCase() === normalized) ?? null;
}

/** Changes an admin's own password. Returns { ok: true } or
 * { ok: false, reason }. */
export async function changeAdminPassword(id, currentPassword, newPassword) {
  try {
    await axios.put(`${API_BASE}/admins/${encodeURIComponent(id)}/password`, {
      currentPassword,
      newPassword,
    });
    return { ok: true };
  } catch (error) {
    console.error("changeAdminPassword error:", error);
    return {
      ok: false,
      reason: error.response?.data?.error || error.message || "Failed to change password.",
    };
  }
}
