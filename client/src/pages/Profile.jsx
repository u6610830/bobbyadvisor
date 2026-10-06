import { useEffect, useState } from "react";
import axios from "axios";
import { User, GraduationCap, CheckCircle2, KeyRound } from "lucide-react";
import { getAllAdvisors, getAdvisorById, syncAdvisorsFromServer } from "../data/mockAdvisors.js";
import { getPrereqGroupLabel } from "../data/prereqGroups.js";
import { getBatchCode } from "../utils/prereqGroup.js";
import "./Profile.css";
import { validatePasswordStrength, PASSWORD_HINT } from "../utils/password.js";
import UnsavedNotice from "../components/UnsavedNotice.jsx";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

function Profile({ studentId, advisorId, onAdvisorChange, prereqGroupId }) {
  const [advisors, setAdvisors] = useState(() => getAllAdvisors());

  useEffect(() => {
    syncAdvisorsFromServer().then(() => setAdvisors(getAllAdvisors()));
  }, []);


  const currentAdvisor = getAdvisorById(advisorId);
  const [draftAdvisorId, setDraftAdvisorId] = useState(advisorId || "");
  const [saved, setSaved] = useState(false);

  const batchCode = getBatchCode(studentId);

  // Change password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSaved(false);

    if (!currentPassword || !newPassword) {
      setPasswordError("Please fill in your current and new password.");
      return;
    }
    const passwordProblem = validatePasswordStrength(newPassword);
    if (passwordProblem) {
      setPasswordError(passwordProblem);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }

    setPasswordSubmitting(true);
    try {
      await axios.put(`${API_BASE}/students/${encodeURIComponent(studentId)}/password`, {
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 2500);
    } catch (err) {
      setPasswordError(err.response?.data?.error || err.message || "Failed to change password.");
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (!draftAdvisorId || draftAdvisorId === advisorId) return;
    onAdvisorChange(draftAdvisorId);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div className="profile-header">
          <span className="profile-avatar">
            <User size={24} strokeWidth={2} />
          </span>
          <div>
            <h3>{studentId}</h3>
            <p>Student profile information</p>
          </div>
        </div>

        <div className="profile-row">
          <span className="profile-row-label">Advisor </span>
          <span className="profile-row-value">
            {currentAdvisor ? `${currentAdvisor.name} — ${currentAdvisor.department}` : "Not selected yet"}
          </span>
        </div>

        <div className="profile-row">
          <span className="profile-row-label">Batch Code </span>
          <span className="profile-row-value">{batchCode || "—"}</span>
        </div>

        <div className="profile-row">
          <span className="profile-row-label">Prerequisite Group </span>
          <span className="profile-row-value">
            {prereqGroupId ? getPrereqGroupLabel(prereqGroupId) : "Could not read Student ID"}
          </span>
        </div>
        <p className="profile-prereq-note">
          Your Prerequisite group is calculated automatically from your Student ID — no need to set it yourself.
        </p>
      </div>

      <div className="profile-card">
        <h4 className="profile-section-title">
          <GraduationCap size={18} strokeWidth={2} />
          <span>Change your Advisor (Change Advisor)</span>
        </h4>

        <form className="profile-advisor-form" onSubmit={handleSave}>
          <select value={draftAdvisorId} onChange={(e) => setDraftAdvisorId(e.target.value)}>
            <option value="">-- Choose your Advisor --</option>
            {advisors.map((advisor) => (
              <option key={advisor.id} value={advisor.id}>
                {advisor.name} — {advisor.department}
              </option>
            ))}
          </select>

          <button type="submit" disabled={!draftAdvisorId || draftAdvisorId === advisorId}>
            Record of changes
          </button>

          <UnsavedNotice
            show={Boolean(draftAdvisorId) && draftAdvisorId !== advisorId}
            text="You have unsaved changes — press Record of changes to keep them."
          />

          {saved && (
            <p className="profile-saved-note">
              <CheckCircle2 size={16} strokeWidth={2} />
              <span>Save new Advisor complete</span>
            </p>
          )}
        </form>
      </div>
      <div className="profile-card">
        <h4 className="profile-section-title">
          <KeyRound size={18} strokeWidth={2} />
          <span>Change Password</span>
        </h4>

        <form className="profile-advisor-form" onSubmit={handlePasswordSubmit}>
          <label htmlFor="student-current-password">Current password</label>
          <input
            id="student-current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />

          <label htmlFor="student-new-password">New password</label>
          <input
            id="student-new-password"
            type="password"
            autoComplete="new-password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <p className="profile-prereq-note">{PASSWORD_HINT}</p>

          <label htmlFor="student-confirm-password">Confirm new password</label>
          <input
            id="student-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />

          <UnsavedNotice
            show={Boolean(currentPassword || newPassword || confirmPassword) && !passwordSubmitting}
            text="Your new password is not saved yet — press Update Password."
          />

          {passwordError && <p className="profile-error-note">{passwordError}</p>}

          <button type="submit" disabled={passwordSubmitting}>
            {passwordSubmitting ? "Saving..." : "Update Password"}
          </button>

          {passwordSaved && (
            <p className="profile-saved-note">
              <CheckCircle2 size={16} strokeWidth={2} />
              <span>Password updated</span>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

export default Profile;