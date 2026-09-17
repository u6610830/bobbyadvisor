import { useState } from "react";
import { Target, ArrowRight, LogOut } from "lucide-react";
import MultiChoice from "../components/MultiChoice.jsx";
import { GOAL_OPTIONS, CAREER_OPTIONS } from "../data/goalCareerOptions.js";
import { setStudentGoalsCareer } from "../utils/goalsCareer.js";
import "./WelcomeGoals.css";

// Shown once, right after Choose Advisor, the first time a student logs
// in with no Goals or Career Interest saved yet (see the `goals`/
// `career_interests` columns added in server/supabase_goals_career.sql).
// Bobby Advisor and Course Recommendation both read these, so getting at
// least one of each up front makes both useful from the student's very
// first session instead of showing generic/empty results.
function WelcomeGoals({ studentId, onDone, onSignOut }) {
  const [goals, setGoals] = useState([]);
  const [careerInterests, setCareerInterests] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const finish = async (skip) => {
    setError("");
    setSaving(true);
    try {
      // Even on "Skip for now" we still call save (with whatever empty/
      // partial lists exist) so this page won't ask again mid-session if
      // the student navigates back — Course Recommendation will prompt
      // them again itself if goals end up empty.
      if (!skip) {
        await setStudentGoalsCareer(studentId, { goals, careerInterests });
      }
      onDone({ goals, careerInterests });
    } catch (err) {
      console.error("Failed to save goals/career interests:", err);
      setError("Could not save right now — you can try again, or skip and add these later.");
      setSaving(false);
    }
  };

  return (
    <div className="welcome-goals-page">
      <div className="welcome-goals-card">
        <div className="welcome-goals-logo">
          <span className="welcome-goals-logo-icon">
            <Target size={30} strokeWidth={2} />
          </span>
          <h1>What are you working toward?</h1>
        </div>

        <p className="welcome-goals-intro">
        Add a goal and any careers you're interested in.
        <br />
        Bobby Advisor uses these to personalize what they show you.
        <br />
        You can always change them later from the Goals & Career page.
        </p>

        <div className="welcome-goals-section">
          <h3>Goals</h3>
          <p className="welcome-goals-choice-help">Choose one or more goals.</p>
          <MultiChoice
            options={GOAL_OPTIONS}
            value={goals}
            onChange={setGoals}
            disabled={saving}
          />
        </div>

        <div className="welcome-goals-section">
          <h3>Career Interest</h3>
          <p className="welcome-goals-choice-help">Choose every career area that interests you.</p>
          <MultiChoice
            options={CAREER_OPTIONS}
            value={careerInterests}
            onChange={setCareerInterests}
            disabled={saving}
          />
        </div>

        {error && <p className="welcome-goals-error">{error}</p>}

        <div className="welcome-goals-actions">
          <button type="button" className="welcome-goals-signout" onClick={onSignOut}>
            <LogOut size={16} strokeWidth={2} />
            <span>Sign Out</span>
          </button>

          <div className="welcome-goals-actions-right">
            <button
              type="button"
              className="welcome-goals-skip"
              disabled={saving}
              onClick={() => finish(true)}
            >
              Skip for now
            </button>

            <button
              type="button"
              className="welcome-goals-submit"
              disabled={saving}
              onClick={() => finish(false)}
            >
              <span>{saving ? "Saving…" : "Continue"}</span>
              <ArrowRight size={18} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WelcomeGoals;
