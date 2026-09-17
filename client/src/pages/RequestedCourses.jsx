import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { RefreshCcw, Users } from "lucide-react";

import "./RequestedCourses.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

// --------------------------------------------------
// Requested Courses
// --------------------------------------------------
//
// Shows every course a student has asked for through Planner >
// "Requested Unscheduled Courses" -> Save.
//
// Data comes from:
//
// GET /requested-courses (optionally ?advisor_id= to scope to one
// advisor's advisees)
//
// The backend returns:
//
// {
//   requestedCourses: [
//     { id, student_id, course_code, course_name, created_at }
//   ]
// }
//
// One row = one student requesting one course, so the demand count for a
// course is the number of distinct student_id rows for that course_code.
// --------------------------------------------------

function RequestedCourses({
  title = "Requested Courses",
  audience = "Admin",
  advisorId = null,
}) {
  const [requestedCourses, setRequestedCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ------------------------------------------------
  // Load requested courses
  // ------------------------------------------------

  const load = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await axios.get(`${API_BASE}/requested-courses`, {
        params: advisorId ? { advisor_id: advisorId } : {},
      });

      const rows = response.data?.requestedCourses;
      setRequestedCourses(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.error("Failed to load requested courses:", error);
      setError(error.response?.data?.error || "Failed to load requested courses.");
      setRequestedCourses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [advisorId]);

  // ------------------------------------------------
  // Group by course — one entry per student counts as one interested
  // student, so students are deduped with a Set even if a stale
  // duplicate row ever ends up in the table.
  // ------------------------------------------------

  const byCourse = useMemo(() => {
    const groups = new Map();

    requestedCourses.forEach((row) => {
      const courseCode = String(row.course_code || "").trim().toUpperCase();
      if (!courseCode) return;

      if (!groups.has(courseCode)) {
        groups.set(courseCode, { code: courseCode, name: "", students: new Set() });
      }

      const group = groups.get(courseCode);
      if (!group.name && row.course_name) group.name = row.course_name;
      if (row.student_id) group.students.add(row.student_id);
    });

    return [...groups.values()]
      .map((group) => ({ code: group.code, name: group.name, count: group.students.size }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.code.localeCompare(b.code);
      });
  }, [requestedCourses]);

  const totalInterestedStudents = useMemo(() => {
    return new Set(requestedCourses.map((row) => row.student_id).filter(Boolean)).size;
  }, [requestedCourses]);

  // ------------------------------------------------
  // Render
  // ------------------------------------------------

  return (
    <div className="hdc-page">
      {/* Header */}

      <div className="hdc-header">
        <span className="admin-summary-title-pill">{title}</span>

        <button type="button" className="hdc-refresh" onClick={load} disabled={loading}>
          <RefreshCcw size={15} strokeWidth={2} />
          <span>{loading ? "Loading..." : "Refresh"}</span>
        </button>
      </div>

      {/* Description */}

      <p className="hdc-help">
        Courses students asked for through Planner's "Requested Unscheduled Courses" because they
        aren't opening next semester. This is a live view for {audience} of how many students want
        each course.
      </p>

      {/* Summary */}

      {!loading && !error && byCourse.length > 0 && (
        <div className="hdc-summary">
          <span>
            Courses requested: <strong>{byCourse.length}</strong>
          </span>
          <span>
            Students: <strong>{totalInterestedStudents}</strong>
          </span>
        </div>
      )}

      {/* Loading */}

      {loading && <p>Loading requested courses...</p>}

      {/* Error */}

      {!loading && error && (
        <div className="hdc-error">
          <p>{error}</p>
          <button type="button" onClick={load}>
            Try Again
          </button>
        </div>
      )}

      {/* Empty */}

      {!loading && !error && byCourse.length === 0 && (
        <p className="hdc-empty">No student has requested an unscheduled course yet.</p>
      )}

      {/* Course list — ranked by demand, one plain row per course. Simple
          list instead of a wall of same-size cards, so it stays easy to
          scan even with many courses. */}

      {!loading && !error && byCourse.length > 0 && (
        <div className="hdc-list">
          {byCourse.map((group, index) => (
            <div className="hdc-row" key={group.code}>
              <span className="hdc-rank">{index + 1}</span>

              <div className="hdc-row-info">
                <span className="hdc-row-code">{group.code}</span>
                {group.name && <span className="hdc-row-name">{group.name}</span>}
              </div>

              <span className="hdc-count">
                <Users size={14} strokeWidth={2} />
                {group.count} {group.count === 1 ? "student" : "students"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default RequestedCourses;
