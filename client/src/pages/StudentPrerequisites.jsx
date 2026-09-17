import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import { getPrereqGroupLabel } from "../data/prereqGroups.js";
import { extractCourseCodes, normalizeCourseCode } from "../utils/courseCode.js";
import { getFinalCourseGrades, isCompletedGrade } from "../utils/graduation.js";
import "./StudentPrerequisites.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");
const GROUP_COLUMN = { g1: "g1_text", g2: "g2_text", g3: "g3_text" };

// The prerequisite group is derived automatically from the student's ID
// (see utils/prereqGroup.js) — students never pick it manually.
function StudentPrerequisites({ studentId, prereqGroupId }) {
  const [rows, setRows] = useState([]);
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const groupId = prereqGroupId || "";

  useEffect(() => {
    setLoading(true);
    setError("");

    Promise.all([
      axios.get(`${API_BASE}/prerequisites`),
      studentId
        ? axios.get(`${API_BASE}/grades?student_id=${studentId}`)
        : Promise.resolve({ data: [] }),
    ])
      .then(([prereqRes, gradesRes]) => {
        setRows(prereqRes.data.prerequisites || []);
        setGrades(gradesRes.data || []);
      })
      .catch((err) => {
        console.error("Failed to load prerequisites:", err);
        setError(err.response?.data?.error || "Failed to load Pre-Require data.");
      })
      .finally(() => setLoading(false));
  }, [studentId]);

  const passedCodes = useMemo(() => {
    const set = new Set();
    getFinalCourseGrades(grades).forEach((g) => {
      if (isCompletedGrade(g.grade)) {
        const code = normalizeCourseCode(g.course_code);
        if (code) set.add(code);
      }
    });
    return set;
  }, [grades]);

  const column = GROUP_COLUMN[groupId];

  return (
    <div className="prereq-student-page">
      <h2>Pre-Require</h2>
      <p className="prereq-student-sub">
        Check which courses you need to have passed first, based on your Prerequisite group.
      </p>

      <div className="prereq-student-group-picker">
        <span className="prereq-student-group-label">Your Prerequisite group:</span>
        {groupId ? (
          <span className="prereq-student-group-value">{getPrereqGroupLabel(groupId)}</span>
        ) : (
          <span className="prereq-student-group-hint">
            Couldn&apos;t determine your batch from your Student ID.
          </span>
        )}
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className="prereq-student-error">{error}</p>}

      {!loading && !error && !groupId && (
        <p className="prereq-student-empty">
          Your Prerequisite group could not be determined — please check your Student ID.
        </p>
      )}

      {!loading && !error && groupId && (
        <div className="prereq-student-list">
          {rows.map((row) => {
            const ruleText = row[column] || "";
            const requiredCodes = extractCourseCodes(ruleText);
            const hasCourseReq = requiredCodes.length > 0;
            const missing = requiredCodes.filter((code) => !passedCodes.has(code));
            const met = hasCourseReq ? missing.length === 0 : null; // null = can't auto-check (e.g. year/credit rule)

            return (
              <div key={row.id} className="prereq-student-row">
                <div className="prereq-student-row-main">
                  <span className="prereq-student-code">{row.course_code}</span>
                  <span className="prereq-student-title">{row.course_title}</span>
                </div>
                <div className="prereq-student-row-rule">
                  {ruleText ? ruleText : <em>No prerequisite</em>}
                </div>
                <div className="prereq-student-row-status">
                  {!ruleText && (
                    <span className="prereq-status prereq-status-ok">
                      <CheckCircle2 size={16} strokeWidth={2} />
                      You can register
                    </span>
                  )}
                  {ruleText && met === true && (
                    <span className="prereq-status prereq-status-ok">
                      <CheckCircle2 size={16} strokeWidth={2} />
                      All requirements met
                    </span>
                  )}
                  {ruleText && met === false && (
                    <span className="prereq-status prereq-status-blocked">
                      <XCircle size={16} strokeWidth={2} />
                      Not yet passed: {missing.join(", ")}
                    </span>
                  )}
                  {ruleText && met === null && (
                    <span className="prereq-status prereq-status-manual">
                      <HelpCircle size={16} strokeWidth={2} />
                      Check manually (e.g. year/credit requirement)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="prereq-student-empty">Admin has not added any Pre-Require data yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default StudentPrerequisites;
