import { useState } from "react";
import { KeyRound, CheckCircle2, User } from "lucide-react";
import { changeAdvisorPassword } from "../data/mockAdvisors.js";
import { changeAdminPassword } from "../data/mockAdmins.js";
import "./Profile.css";

// Shared "Account Settings" page for Advisor and Admin — the one place
// they change their own password. New Advisor accounts start with a
// temporary password of "dev-preview" (set by Admin > Manage Users > Add
// Advisor); Admin's seed account starts the same way. Both change it here.
function AccountSettings({ userId, role, displayName }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const roleLabel = role === "admin" ? "Admin" : "Advisor";
  const changePassword = role === "admin" ? changeAdminPassword : changeAdvisorPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSaved(false);

    if (!currentPassword || !newPassword) {
      setError("Please fill in your current and new password.");
      return;
    }

    if (newPassword.length < 6) {
      setError("New password must contain at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSubmitting(true);
    const result = await changePassword(userId, currentPassword, newPassword);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.reason || "Failed to change password.");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
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
            <h3>{userId}</h3>
            <p>{displayName ? `${displayName} — ${roleLabel} account` : `${roleLabel} account`}</p>
          </div>
        </div>
      </div>

      <div className="profile-card">
        <h4 className="profile-section-title">
          <KeyRound size={18} strokeWidth={2} />
          <span>Change Password</span>
        </h4>

        <p className="profile-prereq-note">
          New accounts start with a temporary password of "0000" — change it here to something only you know.
        </p>

        <form className="profile-advisor-form" onSubmit={handleSubmit}>
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />

          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            placeholder="At least 6 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />

          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />

          {error && <p className="profile-error-note">{error}</p>}

          <button type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Update Password"}
          </button>

          {saved && (
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

export default AccountSettings;
