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
import {
  TIMETABLE_DAY_LABELS,
  TIMETABLE_TIME_LABELS,
  TIMETABLE_TIME_START,
  TIMETABLE_TIME_END,
} from "../data/mockTimetable.js";

import "./InstructorStudentAnalytics.css";

const API_BASE =
  import.meta.env.VITE_API_BASE || "http://localhost:3001";

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
// Timetable helpers (same day/time scale as Planner)
// --------------------------------------------------

const TIMETABLE_COLORS = [
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#EA580C",
  "#16A34A",
  "#0891B2",
  "#CA8A04",
];

function timetableMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

const TIMETABLE_RANGE_START = timetableMinutes(TIMETABLE_TIME_START) ?? 8 * 60;
const TIMETABLE_RANGE_END = timetableMinutes(TIMETABLE_TIME_END) ?? 20 * 60;
const TIMETABLE_RANGE_SPAN = Math.max(1, TIMETABLE_RANGE_END - TIMETABLE_RANGE_START);

function timetablePosition(value) {
  const minutes = timetableMinutes(value);
  if (minutes === null) return 0;
  const clamped = Math.min(Math.max(minutes, TIMETABLE_RANGE_START), TIMETABLE_RANGE_END);
  return ((clamped - TIMETABLE_RANGE_START) / TIMETABLE_RANGE_SPAN) * 100;
}

function normalizeSection(value) {
  return String(value ?? "")
    .replace(/^\s*(?:sec(?:tion)?\.?\s*)/i, "")
    .trim()
    .toUpperCase();
}

function getRegistrationCode(row) {
  const directCode = normalizeCourseCode(row?.course_code);
  if (directCode) return directCode;
  const label = String(row?.course_label || "");
  const match = label.toUpperCase().match(/[A-Z]{2,4}\s*-?\s*\d{3,4}/);
  return match ? normalizeCourseCode(match[0]) : "";
}

function getRegistrationSection(row) {
  if (row?.section !== undefined && row?.section !== null && String(row.section).trim()) {
    return normalizeSection(row.section);
  }
  const label = String(row?.course_label || "");
  const match = label.match(/\bSec(?:tion)?\.?\s*([A-Z0-9-]+)/i);
  return match ? normalizeSection(match[1]) : "";
}

function getTimetableDayIndex(day) {
  if (typeof day === "number" && Number.isInteger(day)) {
    return day >= 0 && day < TIMETABLE_DAY_LABELS.length ? day : -1;
  }
  const value = String(day ?? "").trim().toUpperCase();
  if (!value) return -1;
  const shortDay = value.slice(0, 3);
  return TIMETABLE_DAY_LABELS.findIndex((label) => {
    const normalized = String(label).trim().toUpperCase();
    return normalized === value || normalized.slice(0, 3) === shortDay;
  });
}

function layoutTimetableDay(entries) {
  const sorted = [...entries].sort(
    (a, b) => (timetableMinutes(a.start) ?? 0) - (timetableMinutes(b.start) ?? 0)
  );
  const laneEndTimes = [];
  const placed = sorted.map((entry) => {
    const start = timetableMinutes(entry.start) ?? 0;
    const end = timetableMinutes(entry.end) ?? start;
    let lane = laneEndTimes.findIndex((laneEnd) => laneEnd <= start);
    if (lane < 0) {
      lane = laneEndTimes.length;
      laneEndTimes.push(end);
    } else {
      laneEndTimes[lane] = end;
    }
    return { ...entry, lane };
  });
  return { placed, laneCount: Math.max(1, laneEndTimes.length) };
}

// --------------------------------------------------
// Component
// --------------------------------------------------

function InstructorStudentAnalytics({
  studentId,
  studentRecord = null,
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
  const [timetableEntries, setTimetableEntries] = useState([]);
  const [loadingTimetable, setLoadingTimetable] = useState(false);
  const [timetableError, setTimetableError] = useState("");

  // course_code -> course_title, from Admin's All Courses catalog, so
  // Registered Courses below can show the course name, not just the code.
  const [courseTitleByCode, setCourseTitleByCode] = useState({});
  const [courseCatalog, setCourseCatalog] = useState([]);
  const [recommendCourseCode, setRecommendCourseCode] = useState("");
  const [recommendSection, setRecommendSection] = useState("");
  const [courseSearchTerm, setCourseSearchTerm] = useState("");
  const [showCourseSuggestions, setShowCourseSuggestions] = useState(false);
  const [recommendMessage, setRecommendMessage] = useState("");
  const [sendingRecommendation, setSendingRecommendation] = useState(false);
  const [recommendationMessage, setRecommendationMessage] = useState("");
  const [loadingGrades, setLoadingGrades] =
    useState(false);

  const [loadingSavedCourses, setLoadingSavedCourses] =
    useState(false);

  const [error, setError] = useState("");

  // Whether the Graduation Check panel below is expanded. It's the same
  // StudentGraduationCheck component the student sees on their own page
  // (read-only here) — passing this student's actualStudentId means every
  // fetch inside it (grades, registrations, curriculum, elective courses)
  // is scoped to this one student from the database, same as everywhere
  // else on this page; no other student's data can show up here.
  const [showGraduationCheck, setShowGraduationCheck] = useState(false);

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
  // Load the same published timetable used by Planner. We display only
  // sections saved by this selected student, and match by course code + section.
  useEffect(() => {
    let cancelled = false;
    setLoadingTimetable(true);
    setTimetableError("");

    axios
      .get(`${API_BASE}/timetable`)
      .then((response) => {
        if (cancelled) return;
        const entries = Array.isArray(response.data?.entries)
          ? response.data.entries
          : [];
        setTimetableEntries(entries);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load timetable:", err);
        setTimetableEntries([]);
        setTimetableError(
          err.response?.data?.error ||
            "Could not load the published timetable. Please try refreshing."
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingTimetable(false);
      });

    return () => {
      cancelled = true;
    };
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

  // Convert the student's saved registrations into the same weekly calendar
  // layout used by Planner. A registration without a matching published
  // section is not assigned a guessed time or day.
  const studentTimetableLayouts = useMemo(() => {
    const selected = new Map();
    savedCourses.forEach((row) => {
      const code = getRegistrationCode(row);
      const section = getRegistrationSection(row);
      if (!code) return;
      const key = `${code}|${section}`;
      selected.set(key, { code, section, row });
    });

    const matched = timetableEntries
      .filter((entry) => {
        const code = normalizeCourseCode(entry.code || entry.course_code);
        const section = normalizeSection(entry.section);
        return selected.has(`${code}|${section}`);
      })
      .map((entry, index) => {
        const code = normalizeCourseCode(entry.code || entry.course_code);
        const section = normalizeSection(entry.section);
        const registration = selected.get(`${code}|${section}`)?.row;
        const dayIndex = getTimetableDayIndex(entry.day);
        return {
          ...entry,
          code: entry.code || entry.course_code || code,
          normalizedCode: code,
          section: entry.section ?? registration?.section ?? "",
          name:
            entry.name ||
            entry.course_name ||
            courseTitleByCode[code] ||
            "Course name unavailable",
          dayIndex,
          key: `${code}|${section}|${entry.day}|${entry.start}|${entry.end}|${index}`,
          color: entry.color || TIMETABLE_COLORS[index % TIMETABLE_COLORS.length],
        };
      })
      .filter((entry) => entry.dayIndex >= 0 && entry.start && entry.end);

    const byDay = TIMETABLE_DAY_LABELS.map(() => []);
    matched.forEach((entry, index) => {
      byDay[entry.dayIndex].push({
        ...entry,
        color: TIMETABLE_COLORS[index % TIMETABLE_COLORS.length],
      });
    });
    return byDay.map(layoutTimetableDay);
  }, [savedCourses, timetableEntries, courseTitleByCode]);

  const hasStudentTimetable = studentTimetableLayouts.some(
    (day) => day.placed.length > 0
  );

  // Build the full offered timetable in the same grouped-block style as
  // Planner. Sections with the same course/day/time share one clickable block.
  const offeredTimetableLayouts = useMemo(() => {
    const groups = new Map();

    timetableEntries.forEach((entry, index) => {
      const code = normalizeCourseCode(entry.code || entry.course_code);
      const dayIndex = getTimetableDayIndex(entry.day);
      if (!code || dayIndex < 0 || !entry.start || !entry.end) return;

      const section = normalizeSection(entry.section) || "1";
      const key = `${code}|${dayIndex}|${entry.start}|${entry.end}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          code: entry.code || entry.course_code || code,
          normalizedCode: code,
          dayIndex,
          start: entry.start,
          end: entry.end,
          name: entry.name || entry.course_name || courseTitleByCode[code] || "Course name unavailable",
          sections: [],
          color: TIMETABLE_COLORS[(dayIndex + groups.size) % TIMETABLE_COLORS.length],
        });
      }
      const block = groups.get(key);
      if (!block.sections.some((item) => normalizeSection(item.section) === section)) {
        block.sections.push({ ...entry, section, name: entry.name || entry.course_name || block.name, id: entry.id ?? `${key}|${section}|${index}` });
      }
    });

    const byDay = TIMETABLE_DAY_LABELS.map(() => []);
    [...groups.values()].forEach((block) => {
      if (byDay[block.dayIndex]) byDay[block.dayIndex].push(block);
    });
    return byDay.map(layoutTimetableDay);
  }, [timetableEntries, courseTitleByCode]);

  const hasOfferedTimetable = offeredTimetableLayouts.some(
    (day) => day.placed.length > 0
  );

  // A course can meet more than once per week, so group schedule rows by
  // section for the recommendation selector and show all meeting times.
  const availableSections = useMemo(() => {
    const code = normalizeCourseCode(recommendCourseCode);
    if (!code) return [];
    const bySection = new Map();

    timetableEntries.forEach((entry) => {
      const entryCode = normalizeCourseCode(entry.code || entry.course_code);
      if (entryCode !== code) return;
      const section = normalizeSection(entry.section) || "1";
      if (!bySection.has(section)) bySection.set(section, []);
      const dayIndex = getTimetableDayIndex(entry.day);
      const day = dayIndex >= 0 ? TIMETABLE_DAY_LABELS[dayIndex] : String(entry.day || "");
      const schedule = `${day} ${entry.start || ""}–${entry.end || ""}`.trim();
      if (schedule && !bySection.get(section).includes(schedule)) {
        bySection.get(section).push(schedule);
      }
    });

    return [...bySection.entries()]
      .sort(([a], [b]) => {
        const na = Number(a);
        const nb = Number(b);
        return Number.isFinite(na) && Number.isFinite(nb)
          ? na - nb
          : a.localeCompare(b);
      })
      .map(([section, schedules]) => ({ section, schedules }));
  }, [recommendCourseCode, timetableEntries]);

  const selectedSectionInfo = availableSections.find(
    (item) => item.section === normalizeSection(recommendSection)
  );

  // --------------------------------------------------
  // Refresh
  // --------------------------------------------------
    const filteredCourseSuggestions = useMemo(() => {
    const query = courseSearchTerm.trim().toLowerCase();
    if (!query) return courseCatalog;
    return courseCatalog
      .filter((course) =>
        String(course.course_code || "").toLowerCase().includes(query) ||
        String(course.course_title || "").toLowerCase().includes(query)
      )
      .slice(0, 8);
  }, [courseCatalog, courseSearchTerm]);

  const handleSelectCourse = (course) => {
    setRecommendCourseCode(course.course_code);
    setCourseSearchTerm(
      `${course.course_code}${course.course_title ? ` - ${course.course_title}` : ""}`
    );
    setRecommendSection("");
    setShowCourseSuggestions(false);
    setRecommendationMessage("");
  };

  const handleSendRecommendation = async () => {
  if (!recommendCourseCode) {
    setRecommendationMessage("Please select a course.");
    return;
  }

  if (availableSections.length > 0 && !recommendSection) {
    setRecommendationMessage("Please select an offered section for this course.");
    return;
  }

  const advisorId = String(
    studentRecord?.advisor_id || ""
  )
    .trim()
    .toUpperCase();

  if (!advisorId) {
    setRecommendationMessage(
      "Could not determine this student's advisor."
    );
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

    await axios.post(
      `${API_BASE}/advisor-course-recommendations`,
      {
        studentId: actualStudentId,
        advisorId,
        courseCode: recommendCourseCode,
        courseName: selectedCourse?.course_title || "",
        section: recommendSection || null,
        message: [
          recommendSection ? `Recommended section: Sec.${recommendSection}` : "",
          selectedSectionInfo?.schedules?.length
            ? `Schedule: ${selectedSectionInfo.schedules.join(", ")}`
            : "",
          recommendMessage.trim(),
        ].filter(Boolean).join("\n"),
      }
    );

    setRecommendationMessage(
      "Course recommendation sent successfully."
    );

    setRecommendCourseCode("");
    setRecommendSection("");
    setCourseSearchTerm("");
    setRecommendMessage("");
  } catch (error) {
    console.error(
      "Failed to send course recommendation:",
      error
    );

    setRecommendationMessage(
      error.response?.data?.error ||
        "Failed to send recommendation."
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
        timetableResponse,
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

        axios.get(`${API_BASE}/timetable`),
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
      setTimetableEntries(
        Array.isArray(timetableResponse.data?.entries)
          ? timetableResponse.data.entries
          : []
      );
      setTimetableError("");
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
              loadingSavedCourses ||
              loadingTimetable
            }
            title="Refresh student data"
          >
            <RefreshCcw
              size={15}
              strokeWidth={2}
            />

            <span>
              {loadingGrades ||
              loadingSavedCourses ||
              loadingTimetable
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
            onClick={() =>
              onOpenChat(actualStudentId)
            }
          >
            <MessageCircle
              size={16}
              strokeWidth={2}
            />

            <span>
              Message with {displayName}
            </span>
          </button>

        </div>
      </div>

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
          Full Offered Timetable (matches Planner's published timetable)
      --------------------------------------------- */}

      <div className="analytics-card">
        <h3>All Offered Courses &amp; Sections</h3>
        <p className="analytics-empty-note">
          This is the full published timetable used by Planner. Select a block to prefill the recommendation form, then choose the exact section below.
        </p>

        {loadingTimetable ? (
          <p>Loading offered timetable...</p>
        ) : timetableError ? (
          <p className="analytics-error">{timetableError}</p>
        ) : !hasOfferedTimetable ? (
          <p className="analytics-empty-note">
            No offered course sections have been published yet.
          </p>
        ) : (
          <div className="analytics-timetable-scroll" style={{ overflowX: "auto", width: "100%" }}>
            <div className="analytics-timetable-grid" style={{ minWidth: 760 }}>
              <div className="analytics-timetable-header" style={{ display: "grid", gridTemplateColumns: "76px 1fr", alignItems: "end", borderBottom: "1px solid #e5e7eb", paddingBottom: 8, marginBottom: 4 }}>
                <div />
                <div className="analytics-timetable-time-track" style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                  {TIMETABLE_TIME_LABELS.map((label) => (
                    <span key={label} style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>{label}</span>
                  ))}
                </div>
              </div>

              {TIMETABLE_DAY_LABELS.map((dayLabel, dayIndex) => {
                const { placed, laneCount } = offeredTimetableLayouts[dayIndex];
                const laneHeight = 62;
                const rowHeight = Math.max(72, 12 + laneCount * laneHeight);
                return (
                  <div key={dayLabel} className="analytics-timetable-row" style={{ display: "grid", gridTemplateColumns: "76px 1fr", borderBottom: "1px solid #e5e7eb", minHeight: rowHeight }}>
                    <div className="analytics-timetable-day" style={{ padding: "12px 8px 8px 0", fontWeight: 600, fontSize: 12, color: "#374151" }}>{dayLabel}</div>
                    <div className="analytics-timetable-track" style={{ position: "relative", minHeight: rowHeight, background: "linear-gradient(to right, #e5e7eb 1px, transparent 1px)", backgroundSize: `${100 / Math.max(1, TIMETABLE_TIME_LABELS.length - 1)}% 100%` }}>
                      {placed.map((block) => {
                        const left = timetablePosition(block.start);
                        const right = timetablePosition(block.end);
                        const width = Math.max(right - left, 2.5);
                        const alreadyRegistered = savedCourses.some((row) =>
                          getRegistrationCode(row) === block.normalizedCode &&
                          block.sections.some((section) => getRegistrationSection(row) === normalizeSection(section.section))
                        );
                        return (
                          <button
                            type="button"
                            className="analytics-timetable-block"
                            key={block.key}
                            onClick={() => {
                              const catalogCourse = courseCatalog.find((course) =>
                                normalizeCourseCode(course.course_code) === block.normalizedCode
                              );
                              setRecommendCourseCode(catalogCourse?.course_code || block.code);
                              setCourseSearchTerm(`${catalogCourse?.course_code || block.code}${catalogCourse?.course_title ? ` - ${catalogCourse.course_title}` : ""}`);
                              setRecommendSection(block.sections.length === 1 ? normalizeSection(block.sections[0].section) : "");
                              setRecommendationMessage("");
                              document.getElementById("analytics-recommend-course")?.scrollIntoView({ behavior: "smooth", block: "center" });
                            }}
                            title={`${block.code} — ${block.name}; sections ${block.sections.map((section) => section.section).join(", ")} (${block.start}–${block.end})`}
                            style={{ position: "absolute", left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, top: `${8 + block.lane * laneHeight}px`, height: `${laneHeight - 8}px`, boxSizing: "border-box", overflow: "hidden", padding: "5px 7px", border: alreadyRegistered ? "2px solid #111827" : "1px solid rgba(255,255,255,.5)", borderRadius: 7, color: "#fff", background: block.color, boxShadow: "0 1px 3px rgba(0,0,0,0.12)", fontSize: 11, lineHeight: 1.35, textAlign: "left", cursor: "pointer" }}
                          >
                            <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {block.code}{block.sections.length > 1 ? ` (${block.sections.length} secs)` : ` · Sec.${block.sections[0]?.section || "?"}`}
                            </div>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{block.name}</div>
                            <div style={{ opacity: 0.92, whiteSpace: "nowrap" }}>{block.start}–{block.end}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <p className="analytics-empty-note" style={{ marginTop: 10 }}>
          Click a course block to select it for recommendation. A dark outline indicates that at least one section in that time block is already registered by this student.
        </p>
      </div>

      {/* --------------------------------------------
          Student Timetable (read-only, using Planner's published sections)
      --------------------------------------------- */}

      <div className="analytics-card">
        <h3>Student Timetable</h3>
        <p className="analytics-empty-note">
          Shows the published day and time for the sections this student saved in Planner.
        </p>

        {loadingTimetable ? (
          <p>Loading timetable...</p>
        ) : timetableError ? (
          <p className="analytics-error">{timetableError}</p>
        ) : savedCourses.length === 0 ? (
          <p className="analytics-empty-note">
            This student has no saved course sections to display.
          </p>
        ) : !hasStudentTimetable ? (
          <p className="analytics-empty-note">
            No saved sections matched the published timetable. Check that the saved section numbers match the timetable.
          </p>
        ) : (
          <div className="analytics-timetable-scroll" style={{ overflowX: "auto", width: "100%" }}>
            <div className="analytics-timetable-grid" style={{ minWidth: 760 }}>
              <div
                className="analytics-timetable-header"
                style={{
                  display: "grid",
                  gridTemplateColumns: "76px 1fr",
                  alignItems: "end",
                  borderBottom: "1px solid #e5e7eb",
                  paddingBottom: 8,
                  marginBottom: 4,
                }}
              >
                <div />
                <div className="analytics-timetable-time-track" style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                  {TIMETABLE_TIME_LABELS.map((label) => (
                    <span key={label} style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              {TIMETABLE_DAY_LABELS.map((dayLabel, dayIndex) => {
                const { placed, laneCount } = studentTimetableLayouts[dayIndex];
                const laneHeight = 62;
                const rowHeight = Math.max(72, 12 + laneCount * laneHeight);
                return (
                  <div
                    key={dayLabel}
                    className="analytics-timetable-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "76px 1fr",
                      borderBottom: "1px solid #e5e7eb",
                      minHeight: rowHeight,
                    }}
                  >
                    <div style={{ padding: "12px 8px 8px 0", fontWeight: 600, fontSize: 12, color: "#374151" }}>
                      {dayLabel}
                    </div>
                    <div className="analytics-timetable-track" style={{ position: "relative", minHeight: rowHeight, background: "linear-gradient(to right, #e5e7eb 1px, transparent 1px)", backgroundSize: `${100 / Math.max(1, TIMETABLE_TIME_LABELS.length - 1)}% 100%` }}>
                      {placed.map((entry) => {
                        const left = timetablePosition(entry.start);
                        const right = timetablePosition(entry.end);
                        const width = Math.max(right - left, 2.5);
                        return (
                          <div
                            className="analytics-timetable-block analytics-timetable-student-block"
                            key={entry.key}
                            title={`${entry.code} Sec.${entry.section || "?"} — ${entry.name} (${entry.start}–${entry.end})`}
                            style={{
                              position: "absolute",
                              left: `${left}%`,
                              width: `${Math.min(width, 100 - left)}%`,
                              top: `${8 + entry.lane * laneHeight}px`,
                              minHeight: 52,
                              boxSizing: "border-box",
                              overflow: "hidden",
                              padding: "5px 7px",
                              borderRadius: 7,
                              color: "#fff",
                              background: entry.color,
                              boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                              fontSize: 11,
                              lineHeight: 1.35,
                            }}
                          >
                            <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {entry.code} · Sec.{entry.section || "?"}
                            </div>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {entry.name}
                            </div>
                            <div style={{ opacity: 0.92, whiteSpace: "nowrap" }}>
                              {entry.start}–{entry.end}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* --------------------------------------------
          Recommend Course
      --------------------------------------------- */}

      <div className="analytics-card" id="analytics-recommend-course">
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
                setRecommendSection("");
                setRecommendationMessage("");
                setShowCourseSuggestions(true);
              }}
              onFocus={() => setShowCourseSuggestions(true)}
              onBlur={() => setTimeout(() => setShowCourseSuggestions(false), 120)}
              placeholder="Search a course by code or name"
              autoComplete="off"
              aria-label="Search a course by code or name"
            />

            {showCourseSuggestions && filteredCourseSuggestions.length > 0 && (
              <div className="analytics-course-suggestions">
                {filteredCourseSuggestions.map((course) => (
                  <button
                    type="button"
                    key={course.id || course.course_code}
                    className="analytics-course-suggestion"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectCourse(course)}
                  >
                    <strong>{course.course_code}</strong>
                    {course.course_title && <span>{course.course_title}</span>}
                  </button>
                ))}
              </div>
            )}

            {showCourseSuggestions && courseSearchTerm.trim() && filteredCourseSuggestions.length === 0 && (
              <div className="analytics-course-suggestions">
                <p className="analytics-course-no-match">No matching courses</p>
              </div>
            )}
          </div>

          <select
            value={recommendSection}
            onChange={(e) => {
              setRecommendSection(e.target.value);
              setRecommendationMessage("");
            }}
            disabled={!recommendCourseCode || availableSections.length === 0}
          >
            <option value="">
              {!recommendCourseCode
                ? "Select a course first"
                : availableSections.length === 0
                  ? "No offered section for this course"
                  : "Select a section"}
            </option>
            {availableSections.map((item) => (
              <option key={item.section} value={item.section}>
                {`Sec.${item.section} — ${item.schedules.join(", ") || "Schedule unavailable"}`}
              </option>
            ))}
          </select>

          <textarea
            value={recommendMessage}
            onChange={(e) =>
              setRecommendMessage(e.target.value)
            }
            placeholder="Optional message to student"
            rows={3}
          />

          <button
            type="button"
            className="analytics-chat-btn"
            onClick={handleSendRecommendation}
            disabled={
              sendingRecommendation ||
              !recommendCourseCode
            }
          >
            <Send size={16} strokeWidth={2} />

            {sendingRecommendation
              ? "Sending..."
              : "Send Recommendation"}
          </button>

          {recommendationMessage && (
            <p className="analytics-recommend-message">
              {recommendationMessage}
            </p>
          )}
        </div>
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
                    `${row.course_code}${row.section ? ` Sec.${row.section}` : ""}`;


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