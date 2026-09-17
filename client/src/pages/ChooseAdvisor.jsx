import { useEffect, useState } from "react";
import { GraduationCap, ArrowRight, LogOut } from "lucide-react";
import { getAllAdvisors, syncAdvisorsFromServer } from "../data/mockAdvisors.js";
import "./ChooseAdvisor.css";

const NONE_VALUE = "none";

function ChooseAdvisor({ studentId, onSelect, onSignOut }) {
  const [advisorId, setAdvisorId] = useState("");
  const [error, setError] = useState("");
  const [advisors, setAdvisors] = useState(() => getAllAdvisors());

  useEffect(() => {
    syncAdvisorsFromServer().then(() => setAdvisors(getAllAdvisors()));
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!advisorId) {
      setError("Choose your Advisor, or select \"None for now\".");
      return;
    }
    onSelect(advisorId === NONE_VALUE ? null : advisorId);
  };

  return (
    <div className="choose-advisor-page">
      <div className="choose-advisor-card">
        <div className="choose-advisor-logo">
          <span className="choose-advisor-logo-icon">
            <GraduationCap size={30} strokeWidth={2} />
          </span>
          <h1>Choose Your Advisor</h1>
        </div>

        <p className="choose-advisor-intro">
          The account <strong>{studentId}</strong> doesn&apos;t have an Advisor yet. Choose an Advisor now, or pick &quot;None for now&quot; if you don&apos;t have one yet.
          (You can change this later on the Profile page.)
        </p>

        <form className="choose-advisor-form" onSubmit={handleSubmit}>
          <div className="choose-advisor-options">
            {advisors.map((advisor) => (
              <label
                key={advisor.id}
                className={`choose-advisor-option${advisorId === advisor.id ? " selected" : ""}`}
              >
                <input
                  type="radio"
                  name="advisor"
                  value={advisor.id}
                  checked={advisorId === advisor.id}
                  onChange={() => {
                    setAdvisorId(advisor.id);
                    setError("");
                  }}
                />
                <span className="choose-advisor-name">{advisor.name}</span>
                <span className="choose-advisor-dept">{advisor.department}</span>
              </label>
            ))}

            <label
              className={`choose-advisor-option${advisorId === NONE_VALUE ? " selected" : ""}`}
            >
              <input
                type="radio"
                name="advisor"
                value={NONE_VALUE}
                checked={advisorId === NONE_VALUE}
                onChange={() => {
                  setAdvisorId(NONE_VALUE);
                  setError("");
                }}
              />
              <span className="choose-advisor-name">None for now</span>
              <span className="choose-advisor-dept">Choose an Advisor later from Profile</span>
            </label>
          </div>

          {error && <p className="choose-advisor-error">{error}</p>}

          <div className="choose-advisor-actions">
            <button type="button" className="choose-advisor-signout" onClick={onSignOut}>
              <LogOut size={16} strokeWidth={2} />
              <span>Sign Out</span>
            </button>

            <button type="submit" className="choose-advisor-submit">
              <span>Confirm</span>
              <ArrowRight size={18} strokeWidth={2} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ChooseAdvisor;
