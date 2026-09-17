// Advisor roster — backed by the `advisors` table in Supabase (see
// server/supabase_advisors_table.sql and the /advisors endpoints in
// server.js), mirrored into the same localStorage cache this module
// always used, following the same pattern as utils/curriculum.js.
// syncAdvisorsFromServer() refreshes the cache and fires an
// "advisors:updated" window event; pages that render an advisor list
// should call syncAdvisorsFromServer() on mount and re-render once it
// resolves (see AdminManageUsers.jsx, Register.jsx, ChooseAdvisor.jsx,
// Profile.jsx). Everything else (getAllAdvisors/getAdvisorById/etc.)
// keeps reading the cache synchronously and unchanged, so callers like
// login/registration/profile/chat don't need to become async.
//
// Passwords: the server never returns password_hash to the client, so it
// never ends up in this cache. New advisors get a temporary password of
// "0000" automatically (see server.js POST /advisors) — Admin does
// not set a password when creating one. Advisor/Admin change their own
// password from Profile (see PUT /advisors/:id/password, /admins/:id/password).
import axios from "axios";
import { loadState, saveState } from "../utils/storage.js";

const STORAGE_KEY = "advisorsCache";
const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");
const UPDATED_EVENT = "advisors:updated";

// Only used until the first real sync completes (e.g. before the
// network has responded) — the database is the actual source of truth.
export const MOCK_ADVISORS = [
  { id: "E1001", name: "Asst. Prof. Shinnosuke Nohara", department: "Computer Science", email: "shinnosuke.n@school.edu" },
  { id: "E1002", name: "Asst. Prof. Toru Kazama", department: "Computer Science", email: "toru.k@school.edu" },
  { id: "E1003", name: "Dr. Furuya Rei", department: "Information Technology", email: "furuya.r@school.edu" },
  { id: "E1004", name: "Dr. Dekisugi Hidetoshi ", department: "Software Engineering", email: "dekisugi.h@school.edu" },
  { id: "E1005", name: "A. Reimon Marika", department: "Computer Science", email: "reimon.m@school.edu" },
];

export function getAllAdvisors() {
  return loadState(STORAGE_KEY, MOCK_ADVISORS);
}

/** Refresh the local cache from the database. Call on app/page mount so
 * synchronous readers below see up-to-date data as soon as possible. */
export async function syncAdvisorsFromServer() {
  try {
    const res = await axios.get(`${API_BASE}/advisors`);
    saveState(STORAGE_KEY, res.data?.advisors || []);
    window.dispatchEvent(new Event(UPDATED_EVENT));
  } catch (err) {
    console.error("Failed to sync advisors from database:", err);
  }
}

/** Subscribe to cache refreshes (from syncAdvisorsFromServer, or after
 * add/remove). Returns an unsubscribe function. */
export function subscribeAdvisors(callback) {
  window.addEventListener(UPDATED_EVENT, callback);
  return () => window.removeEventListener(UPDATED_EVENT, callback);
}

export function getAdvisorById(id) {
  const normalized = (id || "").trim().toUpperCase();
  return getAllAdvisors().find((a) => a.id.toUpperCase() === normalized) ?? null;
}

export function getAdvisorByEmail(email) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return null;
  return getAllAdvisors().find((a) => a.email?.toLowerCase() === normalized) ?? null;
}

/**
 * Adds a new advisor via the API and updates the cache on success. The
 * server automatically sets a temporary password ("0000") for the
 * new account — Admin only provides name/department/email here.
 * Returns { ok: true, advisor } or { ok: false, reasons: string[] }.
 */
export async function addAdvisor({ name, department, email }) {
  try {
    const res = await axios.post(`${API_BASE}/advisors`, { name, department, email });
    const advisor = res.data?.advisor;

    const updated = [...getAllAdvisors(), advisor];
    saveState(STORAGE_KEY, updated);
    window.dispatchEvent(new Event(UPDATED_EVENT));

    return { ok: true, advisor };
  } catch (error) {
    console.error("addAdvisor error:", error);
    const reasons = error.response?.data?.error
      ? [error.response.data.error]
      : [error.message || "Failed to add advisor."];
    return { ok: false, reasons };
  }
}

/** Removes an advisor via the API (seed advisors are protected — the
 * server rejects those). Updates the cache on success. Returns
 * { ok: true } or { ok: false, reason }. */
export async function removeAdvisor(id) {
  try {
    await axios.delete(`${API_BASE}/advisors/${encodeURIComponent(id)}`);

    const updated = getAllAdvisors().filter(
      (a) => a.id.toUpperCase() !== id.trim().toUpperCase()
    );
    saveState(STORAGE_KEY, updated);
    window.dispatchEvent(new Event(UPDATED_EVENT));

    return { ok: true };
  } catch (error) {
    console.error("removeAdvisor error:", error);
    return {
      ok: false,
      reason: error.response?.data?.error || error.message || "Failed to remove advisor.",
    };
  }
}

/** Changes an advisor's own password. Returns { ok: true } or
 * { ok: false, reason }. */
export async function changeAdvisorPassword(id, currentPassword, newPassword) {
  try {
    await axios.put(`${API_BASE}/advisors/${encodeURIComponent(id)}/password`, {
      currentPassword,
      newPassword,
    });
    return { ok: true };
  } catch (error) {
    console.error("changeAdvisorPassword error:", error);
    return {
      ok: false,
      reason: error.response?.data?.error || error.message || "Failed to change password.",
    };
  }
}
