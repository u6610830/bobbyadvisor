import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  MessageCircle,
  ArrowLeft,
  RefreshCcw,
  GraduationCap,
  Send,
} from "lucide-react";

import StudentGraduationCheck from "./StudentGraduationCheck.jsx";
import { normalizeCourseCode } from "../utils/courseCode.js";

import "./InstructorStudentAnalytics.css";

const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

// --------------------------------------------------
// Grade points
// --------------------------------------------------

const GRADE_POINTS = {
  A: 4.0,
  "A-": 3.75,
  "B+": 3.25,
  B: 3.0,
  "B-": 2.75,
  "C+": 2.25,
  C: 2.0,
  "C-": 1.75,
  D: 1.0,
  F: 0.0,
};

const PASSING_GRADES = new Set([
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "S",
]);

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function roundGPA(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateGPA(grades) {
  const validGrades = grades.filter((row) => {
    const grade = String(row.grade || "")
      .trim()
      .toUpperCase();

    return (
      Object.prototype.hasOwnProperty.call(
        GRADE_POINTS,
        grade
      ) &&
      Number(row.credits) > 0
    );
  });

  const totalCredits = validGrades.reduce(
    (sum, row) => sum + Number(row.credits),
    0
  );

  if (totalCredits === 0) {
    return 0;
  }

  const totalPoints = validGrades.reduce(
    (sum, row) => {
      const grade = String(row.grade || "")
        .trim()
        .toUpperCase();

      return (
        sum +
        GRADE_POINTS[grade] *
          Number(row.credits)
      );
    },
    0
  );

  return roundGPA(
    totalPoints / totalCredits
  );
}

function calculateCredits(grades) {
  return grades.reduce((total, row) => {
    const grade = String(row.grade || "")
      .trim()
      .toUpperCase();

    if (!PASSING_GRADES.has(grade)) {
      return total;
    }

    return total + Number(row.credits || 0);
  }, 0);
}

// --------------------------------------------------
// Component
// --------------------------------------------------

function InstructorStudentAnalytics({
  studentId,
  studentRecord = null,
  advisorId,
  onBack,
  onOpenChat,
}) {
  const actualStudentId =
  studentRecord?.student_id || studentId || "";

const displayName =
  studentRecord?.name || actualStudentId || "Unknown";

const studentEmail =
  studentRecord?.email || "Not provided";

  const [grades, setGrades] = useState([]);
  const [savedCourses, setSavedCourses] = useState([]);

  // course_code -> course_title, from Admin's All Courses catalog, so
  // Registered Courses below can show the course name, not just the code.
  const [courseTitleByCode, setCourseTitleByCode] = useState({});
  const [courseCatalog, setCourseCatalog] = useState([]);
  const [recommendCourseCode, setRecommendCourseCode] = useState("");
  // Searchable "select course" combobox: what the advisor has typed, and
  // whether the suggestion dropdown should currently be shown.
  const [courseSearchTerm, setCourseSearchTerm] = useState("");
  const [showCourseSuggestions, setShowCourseSuggestions] = useState(false);
  const [recommendMessage, setRecommendMessage] = useState("");
  const [sendingRecommendation, setSendingRecommendation] = useState(false);
  const [recommendationMessage, setRecommendationMessage] = useState("");
  const [showRecommendCourse, setShowRecommendCourse] = useState(false);

  const [loadingGrades, setLoadingGrades] =
    useState(false);

  const [loadingSavedCourses, setLoadingSavedCourses] =
    useState(false);

  const [error, setError] = useState("");
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);

  // Whether the Graduation Check panel below is expanded. It's the same
  // StudentGraduationCheck component the student sees on their own page
  // (read-only here) — passing this student's actualStudentId means every
  // fetch inside it (grades, registrations, curriculum, elective courses)
  // is scoped to this one student from the database, same as everywhere
  // else on this page; no other student's data can show up here.
  const [showGraduationCheck, setShowGraduationCheck] = useState(false);

  // Unread student -> advisor messages for this specific student.
  // This lets the "Message with ..." button show the same notification
  // count as the advisor's Student List / sidebar.
  useEffect(() => {
    if (!actualStudentId || !advisorId) {
      setMessageUnreadCount(0);
      return;
    }

    let cancelled = false;

    const loadUnreadMessages = async () => {
      try {
        const { data } = await axios.get(
          `${API_BASE}/advisor-messages/unread`,
          {
            params: {
              studentId: actualStudentId,
              advisorId,
              viewerRole: "advisor",
            },
          }
        );

        if (!cancelled) {
          setMessageUnreadCount(Number(data?.unread_count) || 0);
        }
      } catch (error) {
        // Do not break the analytics page if the notification count fails.
        console.error("Failed to load unread message count:", error);
      }
    };

    loadUnreadMessages();

    // Keep the badge updated while the advisor stays on this page.
    const timer = setInterval(loadUnreadMessages, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [actualStudentId, advisorId]);

  // --------------------------------------------------
  // Load ALL student data when selected student changes
  // --------------------------------------------------

  useEffect(() => {
    if (!actualStudentId) {
      setGrades([]);
      setSavedCourses([]);
      setLoadingGrades(false);
      setLoadingSavedCourses(false);
      setError("");
      return;
    }

    let cancelled = false;

    const loadStudentData = async () => {
      setLoadingGrades(true);
      setLoadingSavedCourses(true);
      setError("");

      try {
        /*
          Load grades and registrations at the same time.

          Promise.all makes sure changing students loads
          both parts of the report together.
        */
        const [gradesResponse, registrationsResponse] =
          await Promise.all([
            axios.get(`${API_BASE}/grades`, {
              params: {
                student_id: actualStudentId,
              },
            }),

            axios.get(
              `${API_BASE}/registrations/${encodeURIComponent(
                actualStudentId
              )}`
            ),
          ]);

        if (cancelled) {
          return;
        }

        const gradeData = Array.isArray(
          gradesResponse.data
        )
          ? gradesResponse.data
          : [];

        const registrationData =
          registrationsResponse.data
            ?.registrations || [];

        setGrades(gradeData);
        setSavedCourses(registrationData);
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error(
          "Failed to load student data:",
          error
        );

        setError(
          error.response?.data?.error ||
            "Failed to load student data."
        );

        setGrades([]);
        setSavedCourses([]);
      } finally {
        if (!cancelled) {
          setLoadingGrades(false);
          setLoadingSavedCourses(false);
        }
      }
    };

    loadStudentData();

    /*
      Prevent an older request from overwriting the
      newly selected student's data.
    */
    return () => {
      cancelled = true;
    };
  }, [actualStudentId]);

  // Pull Admin's course catalog once so Registered Courses can show each
  // course's name alongside its code/section (same lookup pattern as
  // Planner.jsx's course group lookup).
  useEffect(() => {
    axios
      .get(`${API_BASE}/courses`)
      .then((res) => {
        const courses = res.data?.courses || [];
        const map = {};
        courses.forEach((course) => {
          const code = normalizeCourseCode(course.course_code);
          if (code && course.course_title) {
            map[code] = course.course_title;
          }
        });
        setCourseTitleByCode(map);
        setCourseCatalog(courses);
      })
      .catch((err) =>
        console.warn("Could not load course catalog:", err.message)
      );
  }, []);

  // Collapse the Graduation Check panel when switching students so it
  // doesn't stay expanded showing (briefly, until it refetches) the
  // previous student's layout.
  useEffect(() => {
    setShowGraduationCheck(false);
  }, [actualStudentId]);

  // --------------------------------------------------
  // Calculated statistics
  // --------------------------------------------------

  const gpa = useMemo(
    () => calculateGPA(grades),
    [grades]
  );

  const credits = useMemo(
    () => calculateCredits(grades),
    [grades]
  );

  // --------------------------------------------------
  // Semester grouping
  // --------------------------------------------------

  const semesterGroups = useMemo(() => {
    const groups = new Map();

    grades.forEach((grade) => {
      const semester =
        grade.Semester ||
        grade.semester ||
        "Unknown";

      if (!groups.has(semester)) {
        groups.set(semester, []);
      }

      groups.get(semester).push(grade);
    });

    return [...groups.entries()];
  }, [grades]);

  // --------------------------------------------------
  // Recommend Course: searchable course suggestions
  // --------------------------------------------------

  const filteredCourseSuggestions = useMemo(() => {
    const search = courseSearchTerm.trim().toLowerCase();

    // No search yet: list every course. The dropdown box itself stays a
    // fixed height (see .analytics-course-suggestions) and just scrolls,
    // so this doesn't change how the empty state looks.
    if (!search) return courseCatalog;

    return courseCatalog
      .filter((course) => {
        const code = (course.course_code || "").toLowerCase();
        const title = (course.course_title || "").toLowerCase();
        return code.includes(search) || title.includes(search);
      })
      .slice(0, 8);
  }, [courseCatalog, courseSearchTerm]);

  const handleSelectCourseSuggestion = (course) => {
    setRecommendCourseCode(course.course_code);
    setCourseSearchTerm(
      `${course.course_code}${course.course_title ? ` - ${course.course_title}` : ""}`
    );
    setShowCourseSuggestions(false);
    setRecommendationMessage("");
  };

  // --------------------------------------------------
  // Refresh
  // --------------------------------------------------

  const handleSendRecommendation = async () => {
    if (!recommendCourseCode) {
      setRecommendationMessage("Please select a course.");
      return;
    }

    const currentAdvisorId = String(advisorId || "").trim().toUpperCase();

    if (!currentAdvisorId) {
      setRecommendationMessage("Could not determine this student's advisor.");
      return;
    }

    const selectedCourse = courseCatalog.find(
      (course) =>
        normalizeCourseCode(course.course_code) ===
        normalizeCourseCode(recommendCourseCode)
    );

    try {
      setSendingRecommendation(true);
      setRecommendationMessage("");

      await axios.post(`${API_BASE}/advisor-course-recommendations`, {
        studentId: actualStudentId,
        advisorId: currentAdvisorId,
        courseCode: recommendCourseCode,
        courseName: selectedCourse?.course_title || "",
        message: recommendMessage,
      });

      setRecommendationMessage("Sent!");
      setRecommendCourseCode("");
      setCourseSearchTerm("");
      setRecommendMessage("");
    } catch (error) {
      console.error("Failed to send course recommendation:", error);
      setRecommendationMessage(
        error.response?.data?.error || "Failed to send recommendation."
      );
    } finally {
      setSendingRecommendation(false);
    }
  };

  const handleRefresh = async () => {
    if (!actualStudentId) {
      return;
    }

    setLoadingGrades(true);
    setLoadingSavedCourses(true);
    setError("");

    try {
      const [
        gradesResponse,
        registrationsResponse,
      ] = await Promise.all([
        axios.get(`${API_BASE}/grades`, {
          params: {
            student_id: actualStudentId,
          },
        }),

        axios.get(
          `${API_BASE}/registrations/${encodeURIComponent(
            actualStudentId
          )}`
        ),
      ]);

      setGrades(
        Array.isArray(gradesResponse.data)
          ? gradesResponse.data
          : []
      );

      setSavedCourses(
        registrationsResponse.data?.registrations ||
          []
      );
    } catch (error) {
      console.error(
        "Failed to refresh student data:",
        error
      );

      setError(
        error.response?.data?.error ||
          "Failed to refresh student data."
      );
    } finally {
      setLoadingGrades(false);
      setLoadingSavedCourses(false);
    }
  };

  // --------------------------------------------------
  // No student selected
  // --------------------------------------------------

  if (!actualStudentId) {
    return (
      <div className="analytics-empty">
        <p>
          Select a student from Student List to see
          their report.
        </p>
      </div>
    );
  }

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  return (
    <div className="analytics-page">

      {/* --------------------------------------------
          Header
      --------------------------------------------- */}

      <div className="analytics-header">
        <span className="analytics-title-pill">
          Report &amp; Analytics
        </span>

        <div className="analytics-header-actions">

          <button
            type="button"
            className="analytics-back"
            onClick={onBack}
          >
            <ArrowLeft
              size={16}
              strokeWidth={2}
            />

            <span>
              Back to Student List
            </span>
          </button>

          <button
            type="button"
            className="analytics-refresh"
            onClick={handleRefresh}
            disabled={
              loadingGrades ||
              loadingSavedCourses
            }
            title="Refresh student data"
          >
            <RefreshCcw
              size={15}
              strokeWidth={2}
            />

            <span>
              {loadingGrades ||
              loadingSavedCourses
                ? "Loading..."
                : "Refresh"}
            </span>
          </button>

          <button
            type="button"
            className="analytics-graduation-btn"
            onClick={() =>
              setShowGraduationCheck((prev) => !prev)
            }
            aria-expanded={showGraduationCheck}
          >
            <GraduationCap
              size={16}
              strokeWidth={2}
            />

            <span>
              {showGraduationCheck
                ? "Hide Graduation Check"
                : "Graduation Check"}
            </span>
          </button>

          <button
            type="button"
            className="analytics-chat-btn"
            onClick={() => setShowRecommendCourse((prev) => !prev)}
            aria-expanded={showRecommendCourse}
          >
            <Send size={16} strokeWidth={2} />

            <span>
              {showRecommendCourse ? "Hide Recommend Course" : "Recommend Course"}
            </span>
          </button>

          <button
            type="button"
            className="analytics-chat-btn analytics-message-btn"
            onClick={() => {
              setMessageUnreadCount(0);
              onOpenChat(actualStudentId);
            }}
          >
            <MessageCircle
              size={16}
              strokeWidth={2}
            />

            <span>
              Message with {displayName}
            </span>

            {messageUnreadCount > 0 && (
              <span className="analytics-message-unread-badge">
                {messageUnreadCount > 99
                  ? "99+"
                  : messageUnreadCount}
              </span>
            )}
          </button>

        </div>
      </div>

      {/* --------------------------------------------
          Recommend Course
      --------------------------------------------- */}

      {showRecommendCourse && (
        <div className="analytics-card">
          <h3>Recommend Course</h3>

          <p className="analytics-empty-note">
            Send a course recommendation directly to {displayName}.
          </p>

          <div className="analytics-recommend-form">
            <div className="analytics-course-search">
              <input
                type="text"
                value={courseSearchTerm}
                onChange={(e) => {
                  setCourseSearchTerm(e.target.value);
                  setRecommendCourseCode("");
                  setRecommendationMessage("");
                  setShowCourseSuggestions(true);
                }}
                onFocus={() => setShowCourseSuggestions(true)}
                onBlur={() =>
                  setTimeout(() => setShowCourseSuggestions(false), 120)
                }
                placeholder="Search a course by code or name"
                autoComplete="off"
              />

              {showCourseSuggestions && filteredCourseSuggestions.length > 0 && (
                <div className="analytics-course-suggestions">
                  {filteredCourseSuggestions.map((course) => (
                    <button
                      type="button"
                      key={course.id || course.course_code}
                      className="analytics-course-suggestion"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectCourseSuggestion(course)}
                    >
                      <strong>{course.course_code}</strong>
                      {course.course_title && <span>{course.course_title}</span>}
                    </button>
                  ))}
                </div>
              )}

              {showCourseSuggestions &&
                courseSearchTerm.trim() &&
                filteredCourseSuggestions.length === 0 && (
                  <div className="analytics-course-suggestions">
                    <p className="analytics-course-no-match">No matching courses</p>
                  </div>
                )}
            </div>

            <input
              type="text"
              value={recommendMessage}
              onChange={(e) => setRecommendMessage(e.target.value)}
              placeholder="Comment (optional)"
            />

            <button
              type="button"
              className="analytics-chat-btn"
              onClick={handleSendRecommendation}
              disabled={sendingRecommendation || !recommendCourseCode}
            >
              <Send size={16} strokeWidth={2} />

              <span>{sendingRecommendation ? "Sending..." : "Send"}</span>
            </button>

            {recommendationMessage && (
              <p className="analytics-recommend-message">{recommendationMessage}</p>
            )}
          </div>
        </div>
      )}

      {/* --------------------------------------------
          Error
      --------------------------------------------- */}

      {error && (
        <div className="analytics-error">
          {error}
        </div>
      )}

      {/* --------------------------------------------
          Graduation Check (read-only) — the exact same
          component the student sees on their own Graduation
          Check page, scoped to this one selected student.
      --------------------------------------------- */}

      {showGraduationCheck && (
        <div className="analytics-card analytics-graduation-card">
          <StudentGraduationCheck studentId={actualStudentId} readOnly />
        </div>
      )}

      {/* --------------------------------------------
          Student Information
      --------------------------------------------- */}

      <div className="analytics-card">
        <h3>Student Information</h3>

        <ul>
          <li>
            Name: {displayName}
          </li>

          <li>
            Student ID: {actualStudentId}
          </li>
        <li>
            Email: {studentEmail}
          </li>
        </ul>
      </div>

      {/* --------------------------------------------
          Student Progress
      --------------------------------------------- */}

      <div className="analytics-card">
        <h3>
          Student Progress Report
        </h3>

        {loadingGrades ? (
          <p>Loading grades...</p>
        ) : (
          <ul>
            <li>
              GPA: {gpa.toFixed(2)}
            </li>

            <li>
              Credits Earned: {credits}
            </li>

            <li>
              Total Courses: {grades.length}
            </li>
          </ul>
        )}
      </div>

      

      {/* --------------------------------------------
          Saved Course Plan
      --------------------------------------------- */}

      <div className="analytics-card">
        <h3>
          Registered Courses
        </h3>

        {loadingSavedCourses && (
          <p>Loading...</p>
        )}

        {!loadingSavedCourses &&
          savedCourses.length === 0 && (
            <p className="analytics-empty-note">
              This student hasn&apos;t saved a
              course plan yet.
            </p>
          )}

        {!loadingSavedCourses &&
          savedCourses.length > 0 && (
            <ul>
              {savedCourses.map(
                (row, index) => {
                  const courseTitle =
                    courseTitleByCode[
                      normalizeCourseCode(row.course_code)
                    ];

                  const codeAndSection =
                    row.course_label ||
                    `${row.course_code}${
                      row.section
                        ? ` Sec.${row.section}`
                        : ""
                    }`;

                  return (
                    <li
                      key={
                        row.id ??
                        `${row.course_code}-${row.section}-${index}`
                      }
                    >
                      Selected Course{" "}
                      {index + 1} :{" "}
                      {codeAndSection}
                      {courseTitle
                        ? ` - ${courseTitle}`
                        : ""}
                    </li>
                  );
                }
              )}
            </ul>
          )}
      </div>

      {/* --------------------------------------------
          Grade History
      --------------------------------------------- */}

      <div className="analytics-card">
        <h3>
          Grade History
        </h3>

        {loadingGrades ? (
          <p>Loading grades...</p>
        ) : grades.length === 0 ? (
          <p>
            No grades have been uploaded for
            this student.
          </p>
        ) : (
          semesterGroups.map(
            ([semester, semesterGrades]) => (
              <div
                key={semester}
                className="analytics-semester"
              >
                <h4>
                  {semester}
                </h4>

                <ul>
                  {semesterGrades.map(
                    (row, index) => (
                      <li
                        key={
                          row.id ??
                          `${row.course_code}-${index}`
                        }
                      >
                        <strong>
                          {row.course_code}
                        </strong>{" "}
                        -{" "}
                        {row.course_name ||
                          "Unknown Course"}{" "}
                        (
                        {row.credits} Credits
                        ){" "}
                        <strong>
                          {row.grade}
                        </strong>
                      </li>
                    )
                  )}
                </ul>
              </div>
            )
          )
        )}
      </div>

    </div>
  );
}

export default InstructorStudentAnalytics;