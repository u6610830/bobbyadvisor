import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  RefreshCcw,
  Users,
  ChevronDown,
} from "lucide-react";

import { getAllStudentsForAdmin } from "../utils/students.js";

// Reuse the exact same styling as Course Registrations
import "./AdminCourseRegistrations.css";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.PROD
    ? "https://api.bobbyadvisor.org"
    : "http://localhost:3001");

function RequestedCourses({
  title = "Requested Courses",
  audience = "Admin",
  advisorId = null,
}) {
  const [requestedCourses, setRequestedCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Which course detail is currently opened
  const [expandedCourses, setExpandedCourses] = useState(
    () => new Set()
  );

  const toggleCourse = (courseCode) => {
    setExpandedCourses((prev) => {
      const next = new Set(prev);

      if (next.has(courseCode)) {
        next.delete(courseCode);
      } else {
        next.add(courseCode);
      }

      return next;
    });
  };

  // ------------------------------------------------
  // Student roster
  // ------------------------------------------------

  const roster = useMemo(() => {
    const students = getAllStudentsForAdmin();

    return Array.isArray(students)
      ? students
      : [];
  }, []);

  const studentById = useMemo(() => {
    const map = new Map();

    roster.forEach((student) => {
      if (student.studentId) {
        map.set(
          String(student.studentId),
          student
        );
      }
    });

    return map;
  }, [roster]);

  // ------------------------------------------------
  // Load requested courses
  // ------------------------------------------------

  const load = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await axios.get(
        `${API_BASE}/requested-courses`,
        {
          params: advisorId
            ? { advisor_id: advisorId }
            : {},
        }
      );

      const rows =
        response.data?.requestedCourses;

      setRequestedCourses(
        Array.isArray(rows)
          ? rows
          : []
      );
    } catch (error) {
      console.error(
        "Failed to load requested courses:",
        error
      );

      setError(
        error.response?.data?.error ||
          "Failed to load requested courses."
      );

      setRequestedCourses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [advisorId]);

  // ------------------------------------------------
  // Group by course
  // ------------------------------------------------

  const byCourse = useMemo(() => {
    const groups = new Map();

    requestedCourses.forEach((row) => {
      const courseCode = String(
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

    return [...groups.entries()]
      .map(([courseCode, rows]) => {
        // Prevent duplicate student rows
        const students = new Map();

        rows.forEach((row) => {
          if (!row.student_id) return;

          const id =
            String(row.student_id);

          if (!students.has(id)) {
            students.set(id, row);
          }
        });

        return [
          courseCode,
          [...students.values()],
        ];
      })
      .sort(
        ([courseA, rowsA], [courseB, rowsB]) => {
          if (rowsB.length !== rowsA.length) {
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
  }, [requestedCourses]);

  // ------------------------------------------------
  // Total students
  // ------------------------------------------------

  const uniqueStudents = useMemo(() => {
    return new Set(
      requestedCourses
        .map((row) => row.student_id)
        .filter(Boolean)
    ).size;
  }, [requestedCourses]);

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
        Courses students requested because
        they are not currently available in
        the upcoming timetable. This is a
        live view for {audience} showing how
        many students are interested in each
        course.
      </p>

      {/* Summary */}

      {!loading &&
        !error &&
        requestedCourses.length > 0 && (
          <div className="reg-admin-summary">

            <span>
              Total requests:{" "}
              <strong>
                {requestedCourses.length}
              </strong>
            </span>

            <span>
              Students:{" "}
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
        <p>
          Loading requested courses...
        </p>
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
            No student has requested an
            unscheduled course yet.
          </p>
        )}

      {/* Course Cards */}

      {!loading &&
        !error &&
        byCourse.length > 0 && (
          <div className="reg-admin-grid">

            {byCourse.map(
              ([courseCode, rows]) => {
                const isOpen =
                  expandedCourses.has(
                    courseCode
                  );

                const courseName =
                  rows.find(
                    (row) =>
                      row.course_name
                  )?.course_name || "";

                return (
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

                    {/* Requested students */}

                    <div className="reg-admin-sections">

                      <div className="reg-admin-section">

                        <button
                          type="button"
                          className="reg-admin-section-row"
                          onClick={() =>
                            toggleCourse(
                              courseCode
                            )
                          }
                          aria-expanded={
                            isOpen
                          }
                        >

                          <span className="reg-admin-section-label">
                            {courseName ||
                              "Interested Students"}
                          </span>

                          <span className="reg-admin-section-count">
                            <Users
                              size={13}
                              strokeWidth={2}
                            />

                            {rows.length}
                          </span>

                          <span className="reg-admin-section-detail">
                            {isOpen
                              ? "Hide"
                              : "Detail"}

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

                        {/* Student detail */}

                        {isOpen && (
                          <div className="reg-admin-student-list">

                            <div className="reg-admin-student-list-head">
                              Interested Students
                            </div>

                            <ul className="reg-admin-student-list-items">

                              {rows.map(
                                (row, index) => {
                                  const student =
                                    studentById.get(
                                      String(
                                        row.student_id
                                      )
                                    );

                                  return (
                                    <li
                                      key={
                                        row.id ??
                                        `${courseCode}-${row.student_id}`
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
                                          {
                                            student.displayName
                                          }
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

                    </div>

                  </div>
                );
              }
            )}

          </div>
        )}
    </div>
  );
}

export default RequestedCourses;