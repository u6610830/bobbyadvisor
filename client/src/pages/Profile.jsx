import { useEffect, useState } from "react";
import { User, GraduationCap, CheckCircle2 } from "lucide-react";
import { getAllAdvisors, getAdvisorById, syncAdvisorsFromServer } from "../data/mockAdvisors.js";
import { getPrereqGroupLabel } from "../data/prereqGroups.js";
import { getBatchCode } from "../utils/prereqGroup.js";
import "./Profile.css";

function Profile({ studentId, advisorId, onAdvisorChange, prereqGroupId }) {
  const [advisors, setAdvisors] = useState(() => getAllAdvisors());

  useEffect(() => {
    syncAdvisorsFromServer().then(() => setAdvisors(getAllAdvisors()));
  }, []);


  const currentAdvisor = getAdvisorById(advisorId);
  const [draftAdvisorId, setDraftAdvisorId] = useState(advisorId || "");
  const [saved, setSaved] = useState(false);

  const batchCode = getBatchCode(studentId);

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

          {saved && (
            <p className="profile-saved-note">
              <CheckCircle2 size={16} strokeWidth={2} />
              <span>Save new Advisor complete</span>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

export default Profile;
