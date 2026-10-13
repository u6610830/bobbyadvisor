import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Users,
  UserPlus,
  Search,
  X,
  Trash2,
  RefreshCcw,
  GraduationCap,
} from "lucide-react";

import {
  getAllAdvisors,
  addAdvisor,
  removeAdvisor,
  syncAdvisorsFromServer,
} from "../data/mockAdvisors.js";
import { MOCK_ADMINS } from "../data/mockAdmins.js";
import { setCurrentAdvisor } from "../utils/profile.js";

import "./AdminManageUsers.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

const ROLE_FILTERS = [
  { id: "all", label: "All" },
  { id: "student", label: "Students" },
  { id: "instructor", label: "Advisors" },
  { id: "admin", label: "Admins" },
];

const ROLE_LABELS = {
  student: "Student",
  instructor: "Advisor",
  admin: "Admin",
};

const emptyAdvisorDraft = { name: "", department: "", email: "" };

function AdminManageUsers({ adminId = "" }) {
  const [students, setStudents] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [studentsError, setStudentsError] = useState("");

  // Bumped whenever the advisor cache changes (initial DB sync, or a
  // local add/remove), to re-read it without needing its own loading state.
  const [advisorVersion, setAdvisorVersion] = useState(0);
  const advisors = useMemo(() => getAllAdvisors(), [advisorVersion]);

  useEffect(() => {
    syncAdvisorsFromServer().then(() => setAdvisorVersion((v) => v + 1));
  }, []);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const [showAddAdvisor, setShowAddAdvisor] = useState(false);
  const [advisorDraft, setAdvisorDraft] = useState(emptyAdvisorDraft);
  const [advisorReasons, setAdvisorReasons] = useState([]);
  const [savingAdvisor, setSavingAdvisor] = useState(false);

  const [reassigning, setReassigning] = useState(null); // studentId currently being saved
  const [reassignError, setReassignError] = useState("");

  const loadStudents = async () => {
    try {
      setLoadingStudents(true);
      setStudentsError("");
      const response = await axios.get(`${API_BASE}/students`);
      const rows = response.data?.students;
      setStudents(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.error("Failed to load students:", error);
      setStudentsError(
        error.response?.data?.error || "Failed to load students from the server."
      );
      setStudents([]);
    } finally {
      setLoadingStudents(false);
    }
  };

  useEffect(() => {
    loadStudents();
  }, []);

  // ---- Combined, filterable list of every user in the system ----
  const allUsers = useMemo(() => {
    const studentRows = students.map((s) => ({
      key: `student-${s.student_id}`,
      id: s.student_id,
      name: s.name || "—",
      role: "student",
      department: null,
      email: s.email || null,
      advisorId: s.advisor_id || null,
    }));

    const advisorRows = advisors.map((a) => ({
      key: `advisor-${a.id}`,
      id: a.id,
      name: a.name,
      role: "instructor",
      department: a.department,
      email: a.email || null,
      addedByAdmin: !a.is_seed,
    }));

    const adminRows = MOCK_ADMINS.map((a) => ({
      key: `admin-${a.id}`,
      id: a.id,
      name: a.name,
      role: "admin",
      department: a.department,
      email: a.email || null,
    }));

    return [...studentRows, ...advisorRows, ...adminRows];
  }, [students, advisors]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allUsers.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.id.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q)
      );
    });
  }, [allUsers, search, roleFilter]);

  const counts = useMemo(
    () => ({
      all: allUsers.length,
      student: allUsers.filter((u) => u.role === "student").length,
      instructor: allUsers.filter((u) => u.role === "instructor").length,
      admin: allUsers.filter((u) => u.role === "admin").length,
    }),
    [allUsers]
  );

  // ---- Add Advisor ----
  const openAddAdvisor = () => {
    setAdvisorDraft(emptyAdvisorDraft);
    setAdvisorReasons([]);
    setShowAddAdvisor(true);
  };

  const closeAddAdvisor = () => setShowAddAdvisor(false);

  const handleAddAdvisor = async (e) => {
    e.preventDefault();
    setSavingAdvisor(true);
    try {
      const result = await addAdvisor(advisorDraft);
      if (!result.ok) {
        setAdvisorReasons(result.reasons);
        return;
      }
      setAdvisorVersion((v) => v + 1);
      setShowAddAdvisor(false);
    } finally {
      setSavingAdvisor(false);
    }
  };

  // ---- Delete a user (student or advisor) ----
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, name, role }
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const openDelete = (user) => {
    setDeleteTarget({ id: user.id, name: user.name, role: user.role });
    setDeletePassword("");
    setDeleteError("");
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
  };

  const handleConfirmDelete = async (e) => {
    e.preventDefault();
    if (!deleteTarget) return;
    if (!deletePassword) {
      setDeleteError("Enter your admin password to confirm.");
      return;
    }

    setDeleting(true);
    setDeleteError("");
    try {
      if (deleteTarget.role === "instructor") {
        const result = await removeAdvisor(deleteTarget.id, {
          adminId,
          adminPassword: deletePassword,
        });
        if (!result.ok) {
          setDeleteError(result.reason || "Failed to delete advisor.");
          return;
        }
        // The server un-assigns this advisor's students; mirror that here.
        setStudents((prev) =>
          prev.map((s) =>
            String(s.advisor_id || "").toUpperCase() === deleteTarget.id.toUpperCase()
              ? { ...s, advisor_id: null }
              : s
          )
        );
        setAdvisorVersion((v) => v + 1);
      } else {
        await axios.delete(
          `${API_BASE}/students/${encodeURIComponent(deleteTarget.id)}`,
          { data: { admin_id: adminId, admin_password: deletePassword } }
        );
        setStudents((prev) => prev.filter((s) => s.student_id !== deleteTarget.id));
      }
      setDeleteTarget(null);
    } catch (error) {
      console.error("Failed to delete user:", error);
      setDeleteError(
        error.response?.data?.error || error.message || "Failed to delete user."
      );
    } finally {
      setDeleting(false);
    }
  };

  // ---- Reassign a student's advisor ----
  const handleReassign = async (studentId, newAdvisorId) => {
    if (!newAdvisorId) return;
    setReassignError("");
    setReassigning(studentId);
    try {
      setCurrentAdvisor(studentId, newAdvisorId);
      setStudents((prev) =>
        prev.map((s) =>
          s.student_id === studentId ? { ...s, advisor_id: newAdvisorId } : s
        )
      );
    } catch (error) {
      console.error("Failed to reassign advisor:", error);
      setReassignError(error.message || "Failed to reassign advisor.");
    } finally {
      setReassigning(null);
    }
  };

  return (
    <div className="mu-page">
      <div className="mu-header">
        <span className="admin-summary-title-pill">Manage Users</span>
        <button type="button" className="mu-refresh" onClick={loadStudents} disabled={loadingStudents}>
          <RefreshCcw size={15} strokeWidth={2} />
          <span>{loadingStudents ? "Loading..." : "Refresh"}</span>
        </button>
      </div>

      <p className="mu-help">
        Every account in the system — students, advisors, and admins — in one place. Add new advisors here,
        and reassign a student's advisor directly from the table below.
      </p>

      <div className="mu-toolbar">
        <div className="mu-search">
          <Search size={16} strokeWidth={2} />
          <input
            type="text"
            placeholder="Search by ID, name, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="mu-role-tabs">
          {ROLE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`mu-role-tab${roleFilter === f.id ? " is-active" : ""}`}
              onClick={() => setRoleFilter(f.id)}
            >
              {f.label}
              <span className="mu-role-count">{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>

        <button type="button" className="mu-add-advisor-btn" onClick={openAddAdvisor}>
          <UserPlus size={16} strokeWidth={2} />
          <span>Add Advisor</span>
        </button>
      </div>

      {studentsError && (
        <div className="mu-error-banner">
          <p>{studentsError}</p>
          <button type="button" onClick={loadStudents}>
            Try Again
          </button>
        </div>
      )}

      {reassignError && <p className="mu-error-inline">{reassignError}</p>}

      <div className="mu-table-wrap">
        <table className="mu-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Role</th>
              <th>Department</th>
              <th>Email</th>
              <th>Advisor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 && !loadingStudents && (
              <tr>
                <td colSpan={7} className="mu-empty-row">
                  No users match your search.
                </td>
              </tr>
            )}

            {filteredUsers.map((u) => (
              <tr key={u.key}>
                <td className="mu-id-cell">{u.id}</td>
                <td>{u.name}</td>
                <td>
                  <span className={`mu-role-badge mu-role-${u.role}`}>{ROLE_LABELS[u.role]}</span>
                </td>
                <td>{u.department || "—"}</td>
                <td>{u.email || "—"}</td>
                <td>
                  {u.role === "student" ? (
                    <select
                      className="mu-advisor-select"
                      value={u.advisorId || ""}
                      disabled={reassigning === u.id}
                      onChange={(e) => handleReassign(u.id, e.target.value)}
                    >
                      <option value="" disabled>
                        {u.advisorId ? u.advisorId : "-- Assign --"}
                      </option>
                      {advisors.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.id} — {a.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="mu-actions-cell">
                  {(u.role === "instructor" || u.role === "student") && (
                    <button
                      type="button"
                      className="mu-remove-btn"
                      onClick={() => openDelete(u)}
                      title={`Delete ${ROLE_LABELS[u.role].toLowerCase()}`}
                      aria-label={`Delete ${ROLE_LABELS[u.role].toLowerCase()} ${u.name}`}
                    >
                      <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                      <span>Delete</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddAdvisor && (
        <div className="mu-modal-backdrop" onClick={closeAddAdvisor}>
          <div className="mu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mu-modal-head">
              <h4>
                <GraduationCap size={18} strokeWidth={2} />
                <span>Add Advisor</span>
              </h4>
              <button type="button" className="mu-modal-close" onClick={closeAddAdvisor}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddAdvisor} className="mu-modal-form">
              <label className="mu-field">
                <span>Full name</span>
                <input
                  value={advisorDraft.name}
                  onChange={(e) => setAdvisorDraft({ ...advisorDraft, name: e.target.value })}
                  placeholder="e.g. Dr. Jane Smith"
                />
              </label>

              <label className="mu-field">
                <span>Department</span>
                <input
                  value={advisorDraft.department}
                  onChange={(e) => setAdvisorDraft({ ...advisorDraft, department: e.target.value })}
                  placeholder="e.g. Computer Science"
                />
              </label>

              <label className="mu-field">
                <span>Email (optional — needed for Sign in with Microsoft)</span>
                <input
                  type="email"
                  value={advisorDraft.email}
                  onChange={(e) => setAdvisorDraft({ ...advisorDraft, email: e.target.value })}
                  placeholder="e.g. jane.s@school.edu"
                />
              </label>

              {advisorReasons.length > 0 && (
                <ul className="mu-modal-errors">
                  {advisorReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}

              <div className="mu-modal-actions">
                <button type="button" className="mu-btn-ghost" onClick={closeAddAdvisor}>
                  Cancel
                </button>
                <button type="submit" className="mu-btn-primary" disabled={savingAdvisor}>
                  <Users size={15} strokeWidth={2} />
                  <span>{savingAdvisor ? "Adding…" : "Add Advisor"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="mu-modal-backdrop" onClick={closeDelete}>
          <div className="mu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mu-modal-head">
              <h4>
                <Trash2 size={18} strokeWidth={2} />
                <span>Delete {ROLE_LABELS[deleteTarget.role]}</span>
              </h4>
              <button type="button" className="mu-modal-close" onClick={closeDelete}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmDelete} className="mu-modal-form">
              <p className="mu-delete-warning">
                {deleteTarget.role === "student" ? (
                  <>
                    This permanently deletes <strong>{deleteTarget.name}</strong> (
                    {deleteTarget.id}), their login account, and all of their data
                    (grades, plans, registrations and chat history). This can&apos;t
                    be undone.
                  </>
                ) : (
                  <>
                    This permanently deletes <strong>{deleteTarget.name}</strong> (
                    {deleteTarget.id}) and their chat history and recommendations.
                    Their students will be left without an Advisor. This can&apos;t
                    be undone.
                  </>
                )}
              </p>

              <label className="mu-field">
                <span>Your admin password</span>
                <input
                  type="password"
                  autoFocus
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Enter your password to confirm"
                />
              </label>

              {deleteError && (
                <ul className="mu-modal-errors">
                  <li>{deleteError}</li>
                </ul>
              )}

              <div className="mu-modal-actions">
                <button type="button" className="mu-btn-ghost" onClick={closeDelete}>
                  Cancel
                </button>
                <button type="submit" className="mu-btn-danger" disabled={deleting}>
                  <Trash2 size={15} strokeWidth={2} />
                  <span>{deleting ? "Deleting…" : "Delete"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminManageUsers;