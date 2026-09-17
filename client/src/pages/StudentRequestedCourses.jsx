import { useEffect, useState } from "react";
import axios from "axios";
import { ClipboardList, Save } from "lucide-react";
import EditableList from "../components/EditableList.jsx";
import "./StudentRequestedCourses.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

// A student's own view of everything they've asked for — this used to be
// split between a read-only list here and the actual "Request Unscheduled
// Courses" add/edit box on Planner. That box now lives here instead (same
// requested_unscheduled_courses table, same /requested-courses endpoint),
// so adding, editing, and removing a request all happen on this one page.
function StudentRequestedCourses({ studentId, onNavigate }) {
  const [requestedCourses, setRequestedCourses] = useState([]); // label strings, e.g. "CSX-9004 Advanced Topics"
  const [allCourses, setAllCourses] = useState([]); // Admin's All Courses catalog, for suggestions
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error

  const load = () => {
    if (!studentId) {
      setLoading(false);
      setError("You need to be signed in as a student to see this.");
      return;
    }
    setLoading(true);
    setError("");
    axios
      .get(`${API_BASE}/requested-courses/${encodeURIComponent(studentId)}`)
      .then((res) => {
        const rows = res.data?.requestedCourses || [];
        const labels = rows
          .map((row) => `${row.course_code || ""} ${row.course_name || ""}`.trim())
          .filter(Boolean);
        setRequestedCourses(labels);
      })
      .catch((err) => {
        console.error("Failed to load requested courses:", err);
        setError(err.response?.data?.error || "Failed to load your requested courses.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [studentId]);

  // Admin's course catalog, for the "add a course" suggestions dropdown.
  useEffect(() => {
    axios
      .get(`${API_BASE}/courses`)
      .then((res) => setAllCourses(res.data?.courses || []))
      .catch((err) => console.warn("Could not load course catalog:", err.message));
  }, []);

  // No prerequisite/time-conflict check here, since these aren't being
  // scheduled, just asked for.
  const addRequestedCourse = (label) => {
    setRequestedCourses((prev) => (prev.includes(label) ? prev : [...prev, label]));
  };

  const editRequestedCourse = (index, label) => {
    setRequestedCourses((prev) => prev.map((course, i) => (i === index ? label : course)));
  };

  const handleSaveRequestedCourses = async () => {
    if (!studentId) return;
    setSaveStatus("saving");
    try {
      await axios.post(`${API_BASE}/requested-courses`, { studentId, courses: requestedCourses });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      console.warn("Could not save requested unscheduled courses:", err.message);
      setSaveStatus("error");
    }
  };

  return (
    <div className="student-req-page">
      <div className="student-req-card">
        <h3>
          <ClipboardList size={20} strokeWidth={2} />
          My Requested Courses
        </h3>
        <p className="student-req-hint">
          Not opening next semester but you'd still like to take it? Add it below — one box per course.
          Each course you save here counts once toward how many students want it (visible to your advisor and admin).
        </p>

        {loading && <p className="student-req-hint">Loading…</p>}

        {!loading && error && <p className="student-req-error">{error}</p>}

        {!loading && !error && requestedCourses.length === 0 && (
          <div className="student-req-empty">
            <p>You haven't requested any courses yet.</p>
            {onNavigate && (
              <button
                type="button"
                className="student-req-cta"
                onClick={() => onNavigate("course-recommendation")}
              >
                See Course Recommendations
              </button>
            )}
          </div>
        )}

        {!loading && !error && (
          <>
            <EditableList
              items={requestedCourses}
              suggestions={[
                ...new Map(
                  allCourses
                    .filter((course) => course.course_code)
                    .map((course) => [
                      course.course_code,
                      {
                        code: course.course_code,
                        name: course.course_title || "",
                      },
                    ])
                ).values(),
              ]}
              placeholder="Add a course code (e.g. CSX-9004) and name"
              onAdd={addRequestedCourse}
              onEdit={editRequestedCourse}
              onDelete={(index) =>
                setRequestedCourses((prev) => prev.filter((_, i) => i !== index))
              }
              renderLabel={(label, index) => `Requested Course ${index + 1} : ${label}`}
            />
            <div className="student-req-save-row">
              <button
                type="button"
                className="student-req-save-btn"
                onClick={handleSaveRequestedCourses}
                disabled={saveStatus === "saving" || !studentId}
              >
                <Save size={16} strokeWidth={2} />
                {saveStatus === "saving"
                  ? "Saving..."
                  : saveStatus === "saved"
                  ? "Saved!"
                  : "Save"}
              </button>
              {saveStatus === "error" && (
                <span className="student-req-save-error">Could not save — please try again.</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default StudentRequestedCourses;
