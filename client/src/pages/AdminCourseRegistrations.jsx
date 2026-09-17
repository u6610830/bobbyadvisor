import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  RefreshCcw,
  Users,
  ChevronDown,
} from "lucide-react";

import { getAllStudentsForAdmin } from "../utils/students.js";

import "./AdminCourseRegistrations.css";

const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

// Splits one course's registration rows into its sections (e.g. "541",
// "542"), each keeping its own rows so a card can show a per-section
// headcount instead of one flat student list. Rows without a section
// (shouldn't normally happen, but the column isn't required) are grouped
// under "Unassigned" and sorted to the end.
function groupBySection(rows) {
  const groups = new Map();

  rows.forEach((row) => {
    const section = String(row.section || "").trim() || "Unassigned";

    if (!groups.has(section)) {
      groups.set(section, []);
    }

    groups.get(section).push(row);
  });

  return [...groups.entries()].sort(([a], [b]) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

// --------------------------------------------------
// Course Registrations
// --------------------------------------------------
//
// Shows every course that students saved through
// Planner -> Save.
//
// Data comes from:
//
// GET /registrations
//
// The backend returns:
//
// {
//   registrations: [
//     {
//       student_id,
//       course_code,
//       section,
//       course_label,
//       saved_at
//     }
//   ]
// }
// --------------------------------------------------

function AdminCourseRegistrations({
  title = "Course Registrations",
  audience = "Admin",
  advisorId = null,
}) {
  const [registrations, setRegistrations] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  // Which "<courseCode>::<section>" rows currently have their student list
  // open. Student IDs stay hidden until the advisor asks for them.
  const [expandedSections, setExpandedSections] = useState(
    () => new Set()
  );

  const toggleSection = (key) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // ------------------------------------------------
  // Student roster
  // ------------------------------------------------

  const roster = useMemo(() => {
    const students =
      getAllStudentsForAdmin();

    return Array.isArray(students)
      ? students
      : [];
  }, []);

  const studentById = useMemo(() => {
    const map = new Map();

    roster.forEach((student) => {
      if (student.studentId) {
        map.set(
          student.studentId,
          student
        );
      }
    });

    return map;
  }, [roster]);

  // ------------------------------------------------
  // Load registrations
  // ------------------------------------------------

  const load = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await axios.get(
        `${API_BASE}/registrations`,
        {
          params: advisorId ? { advisor_id: advisorId } : {},
        }
      );

      const rows =
        response.data?.registrations;

      setRegistrations(
        Array.isArray(rows) ? rows : []
      );
    } catch (error) {
      console.error(
        "Failed to load registrations:",
        error
      );

      setError(
        error.response?.data?.error ||
          "Failed to load saved registrations."
      );

      setRegistrations([]);
    } finally {
      setLoading(false);
    }
  };

  // ------------------------------------------------
  // Initial load
  // ------------------------------------------------

  useEffect(() => {
     load();
  }, [advisorId]);

  // ------------------------------------------------
  // Group by course
  // ------------------------------------------------

  const byCourse = useMemo(() => {
    const groups = new Map();

    registrations.forEach((row) => {
      const courseCode =
        String(
          row.course_code || ""
        )
          .trim()
          .toUpperCase();

      if (!courseCode) return;

      if (!groups.has(courseCode)) {
        groups.set(courseCode, []);
      }

      groups
        .get(courseCode)
        .push(row);
    });

    return [...groups.entries()].sort(
      ([courseA, rowsA], [courseB, rowsB]) => {
        if (
          rowsB.length !==
          rowsA.length
        ) {
          return (
            rowsB.length -
            rowsA.length
          );
        }

        return courseA.localeCompare(
          courseB
        );
      }
    );
  }, [registrations]);

  // ------------------------------------------------
  // Total registered students
  // ------------------------------------------------

  const uniqueStudents = useMemo(() => {
    return new Set(
      registrations
        .map(
          (row) => row.student_id
        )
        .filter(Boolean)
    ).size;
  }, [registrations]);

  // ------------------------------------------------
  // Render
  // ------------------------------------------------

  return (
    <div className="reg-admin-page">
      {/* Header */}

      <div className="reg-admin-header">
        <span className="admin-summary-title-pill">
          {title}
        </span>

        <button
          type="button"
          className="reg-admin-refresh"
          onClick={load}
          disabled={loading}
        >
          <RefreshCcw
            size={15}
            strokeWidth={2}
          />

          <span>
            {loading
              ? "Loading..."
              : "Refresh"}
          </span>
        </button>
      </div>

      {/* Description */}

      <p className="reg-admin-help">
        Courses students have added to
        their Planner and saved. This is
        a live view for {audience} of the
        Selected Course list each student
        saved.
      </p>

      {/* Summary */}

      {!loading &&
        !error &&
        registrations.length > 0 && (
          <div className="reg-admin-summary">
            <span>
              Total registrations:{" "}
              <strong>
                {registrations.length}
              </strong>
            </span>

            <span>
              Students Registered:{" "}
              <strong>
                {uniqueStudents}
              </strong>
            </span>

            <span>
              Courses:{" "}
              <strong>
                {byCourse.length}
              </strong>
            </span>
          </div>
        )}

      {/* Loading */}

      {loading && (
        <p>Loading registrations...</p>
      )}

      {/* Error */}

      {!loading && error && (
        <div className="reg-admin-error">
          <p>{error}</p>

          <button
            type="button"
            onClick={load}
          >
            Try Again
          </button>
        </div>
      )}

      {/* Empty */}

      {!loading &&
        !error &&
        byCourse.length === 0 && (
          <p className="reg-admin-empty">
            No student has saved a course
            selection yet.
          </p>
        )}

      {/* Course cards */}

      {!loading &&
        !error &&
        byCourse.length > 0 && (
          <div className="reg-admin-grid">
            {byCourse.map(
              ([courseCode, rows]) => (
                <div
                  className="reg-admin-card"
                  key={courseCode}
                >
                  {/* Course header */}

                  <div className="reg-admin-card-head">
                    <h4>
                      {courseCode}
                    </h4>

                    <span className="reg-admin-count">
                      <Users
                        size={14}
                        strokeWidth={2}
                      />

                      {rows.length}
                    </span>
                  </div>

                  {/* One row per section — headcount only. Student IDs
                      stay hidden until "Detail" is opened for that
                      section. */}

                  <div className="reg-admin-sections">
                    {groupBySection(rows).map(
                      ([section, sectionRows]) => {
                        const sectionKey = `${courseCode}::${section}`;
                        const isOpen =
                          expandedSections.has(sectionKey);

                        return (
                          <div
                            className="reg-admin-section"
                            key={sectionKey}
                          >
                            <button
                              type="button"
                              className="reg-admin-section-row"
                              onClick={() =>
                                toggleSection(sectionKey)
                              }
                              aria-expanded={isOpen}
                            >
                              <span className="reg-admin-section-label">
                                {section === "Unassigned"
                                  ? "No section"
                                  : `Sec ${section}`}
                              </span>

                              <span className="reg-admin-section-count">
                                <Users
                                  size={13}
                                  strokeWidth={2}
                                />
                                {sectionRows.length}
                              </span>

                              <span className="reg-admin-section-detail">
                                {isOpen ? "Hide" : "Detail"}
                                <ChevronDown
                                  size={14}
                                  strokeWidth={2}
                                  className={
                                    isOpen
                                      ? "reg-admin-chevron open"
                                      : "reg-admin-chevron"
                                  }
                                />
                              </span>
                            </button>

                            {isOpen && (
                              <div className="reg-admin-student-list">
                                <div className="reg-admin-student-list-head">
                                  Sec :{" "}
                                  {section === "Unassigned"
                                    ? "-"
                                    : section}
                                </div>

                                <ul className="reg-admin-student-list-items">
                                  {sectionRows.map(
                                    (row, index) => {
                                      const student =
                                        studentById.get(
                                          row.student_id
                                        );

                                      return (
                                        <li
                                          key={
                                            row.id ??
                                            `${row.student_id}-${row.course_code}-${index}`
                                          }
                                        >
                                          <span className="reg-admin-student-id">
                                            <span className="reg-admin-student-num">
                                              {index + 1}).
                                            </span>
                                            {row.student_id}
                                          </span>

                                          {student?.displayName && (
                                            <span className="reg-admin-student-name">
                                              {student.displayName}
                                            </span>
                                          )}
                                        </li>
                                      );
                                    }
                                  )}
                                </ul>
                              </div>
                            )}
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        )}
    </div>
  );
}

export default AdminCourseRegistrations;