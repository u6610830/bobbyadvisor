import { useEffect, useState } from "react";
import axios from "axios";
import { UploadCloud, ListChecks } from "lucide-react";
import { getCurrentSemester } from "../utils/semester.js";
import {
  calculateGPA,
  getFinalCourseGrades,
  isCompletedGrade,
  normalizeGrade,
  courseMatchesRule,
} from "../utils/graduation.js";
import { getCurriculumForStudent, getCurriculumGroups } from "../utils/curriculum.js";
import "./Dashboard.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");
const DEFAULT_CREDITS_REQUIRED = 132;

const STATUS_CLASS = {
  Complete: "status-complete",
  Retry: "status-retry",
  Retake: "status-retry",
  Withdraw: "status-withdraw",
  "Register This Term": "status-register",
  Incomplete: "status-incomplete",
};

function Dashboard({ onNavigate, studentId, curriculumYear = null }) {
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchGrades = async () => {
      if (!studentId) {
        setError("No logged-in student found.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");

        console.log("Getting dashboard grades for:", studentId);

        const response = await axios.get(
          `${API_BASE}/grades?student_id=${encodeURIComponent(studentId)}`
        );

        setGrades(response.data);
      } catch (error) {
        console.error("Dashboard grade error:", error);
        console.error("Backend response:", error.response?.data);

        setError(
          error.response?.data?.error ||
            "Unable to load student grades."
        );
      } finally {
        setLoading(false);
      }
    };

    fetchGrades();
  }, [studentId]);

  /*
   * ------------------------------------------------
   * CURRENT SEMESTER
   * ------------------------------------------------
   * Based on today's real calendar date, not the student's transcript —
   * see utils/semester.js for the exact month → term mapping.
   */

  const currentSemester = getCurrentSemester();
  const curriculum = studentId
    ? getCurriculumForStudent(studentId, curriculumYear)
    : null;
  const creditsRequired = Number(curriculum?.totalCreditsRequired) || DEFAULT_CREDITS_REQUIRED;

  // Admin can mark individual curriculum courses as requiring at least C.
  // C-/D still count as completed for ordinary courses, but for a Min C
  // course they must be shown as Retake instead.
  const minGradeCRules = getCurriculumGroups(curriculum)
    .flatMap((block) => block.courses || [])
    .filter((course) => course.minGradeC)
    .map((course) => course.code);

  const requiresMinGradeC = (courseCode) =>
    minGradeCRules.some((rule) => courseMatchesRule(courseCode, rule));

  const isPassingForCurriculum = (courseCode, grade) => {
    const normalized = normalizeGrade(grade);

    if (requiresMinGradeC(courseCode)) {
      return isCompletedGrade(normalized);
    }

    return (
      isCompletedGrade(normalized) ||
      normalized === "C-" ||
      normalized === "D"
    );
  };

  /*
   * ------------------------------------------------
   * Overall GPA
   * ------------------------------------------------
   *
   * Overall GPA = total grade points / total GPA credits
   *
   * Example:
   * B (3 credits) = 3.00 × 3
   * A (2 credits) = 4.00 × 2
   */

  // Use only the latest attempt per course so a retake doesn't count twice.
  const finalCourses = getFinalCourseGrades(grades);

  const overallGPA = finalCourses.length > 0 ? calculateGPA(finalCourses) : null;

  /*
   * ------------------------------------------------
   * CREDITS EARNED
   * ------------------------------------------------
   *
   * Count:
   * A, A-, B+, B, B-, C+, C, C-, D
   * S
   *
   * Do NOT count:
   * W, R, I, F
   */

  let creditsEarned = 0;

  finalCourses.forEach((course) => {
    const grade = course.grade?.trim().toUpperCase();
    const credits = Number(course.credits);

    if (
      isPassingForCurriculum(course.course_code, grade) &&
      !isNaN(credits) &&
      credits > 0
    ) {
      creditsEarned += credits;
    }
  });

  /*
   * ------------------------------------------------
   * ACADEMIC PROGRESS
   * ------------------------------------------------
   */

  const progressPct = Math.min(
    100,
    Math.round(
      (creditsEarned / creditsRequired) * 100
    )
  );
  const getProgressColor = (progress) => {
  const stops = [
    { percent: 0, color: [239, 68, 68] },     // Red
    { percent: 25, color: [249, 115, 22] },   // Orange
    { percent: 50, color: [245, 158, 11] },   // Amber
    { percent: 65, color: [234, 179, 8] },    // Yellow
    { percent: 80, color: [132, 204, 22] },   // Lime
    { percent: 100, color: [34, 197, 94] },   // Green
  ];

  if (progress <= 0) {
    return "rgb(239, 68, 68)";
  }

  if (progress >= 100) {
    return "rgb(34, 197, 94)";
  }

  for (let i = 0; i < stops.length - 1; i++) {
    const start = stops[i];
    const end = stops[i + 1];

    if (
      progress >= start.percent &&
      progress <= end.percent
    ) {
      const range =
        end.percent - start.percent;

      const position =
        (progress - start.percent) / range;

      const r = Math.round(
        start.color[0] +
          (end.color[0] - start.color[0]) *
            position
      );

      const g = Math.round(
        start.color[1] +
          (end.color[1] - start.color[1]) *
            position
      );

      const b = Math.round(
        start.color[2] +
          (end.color[2] - start.color[2]) *
            position
      );

      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  return "rgb(34, 197, 94)";
};

const progressColor = getProgressColor(progressPct);
  /*
   * ------------------------------------------------
   * AVERAGE CREDITS PER SEMESTER
   * ------------------------------------------------
   */

  const creditsBySemester = {};

  finalCourses.forEach((course) => {
    const semester = course.Semester;
    const grade = course.grade?.trim().toUpperCase();
    const credits = Number(course.credits);

    if (
      semester &&
      isPassingForCurriculum(course.course_code, grade) &&
      !isNaN(credits) &&
      credits > 0
    ) {
      if (!creditsBySemester[semester]) {
        creditsBySemester[semester] = 0;
      }

      creditsBySemester[semester] += credits;
    }
  });

  const semesterCreditValues = Object.values(
    creditsBySemester
  );

  const averageCreditsPerSemester =
    semesterCreditValues.length > 0
      ? semesterCreditValues.reduce(
          (sum, credits) => sum + credits,
          0
        ) / semesterCreditValues.length
      : 0;

  /*
   * ------------------------------------------------
   * ESTIMATED TERMS LEFT
   * ------------------------------------------------
   */

  const remainingCredits = Math.max(
    0,
    creditsRequired - creditsEarned
  );

  const estimatedTermsLeft =
    averageCreditsPerSemester > 0
      ? Math.ceil(
          remainingCredits /
            averageCreditsPerSemester
        )
      : 0;

  /*
   * ------------------------------------------------
   * COURSE STATUS
   * ------------------------------------------------
   *
   * Group courses by course code.
   *
   * If the same course appears more than once:
   * - A normal passing grade → Complete
   * - S → Complete
   * - W → Withdraw
   * - R → Retry
   * - I → Incomplete
   * - F → Retry
   */

  const courseMap = {};

  grades.forEach((course) => {
    const code = course.course_code;

    if (!code) return;

    if (!courseMap[code]) {
      courseMap[code] = {
        code,
        name: course.course_name,
        grades: [],
      };
    }

    courseMap[code].grades.push(
      course.grade?.trim().toUpperCase()
    );
  });

  const getCourseStatus = (courseCode, courseGrades) => {
    // A course is complete according to that course's own minimum-grade rule.
    if (
      courseGrades.some((grade) =>
        isPassingForCurriculum(courseCode, grade)
      )
    ) {
      return "Complete";
    }

    if (courseGrades.includes("W")) {
      return "Withdraw";
    }

    // C-, D, or F on a course Admin marked "Min C" => Retake.
    if (
      requiresMinGradeC(courseCode) &&
      courseGrades.some((grade) =>
        ["C-", "D", "F"].includes(normalizeGrade(grade))
      )
    ) {
      return "Retake";
    }

    if (
      courseGrades.includes("R") ||
      courseGrades.includes("F")
    ) {
      return "Retry";
    }

    if (courseGrades.includes("I")) {
      return "Incomplete";
    }

    return "Incomplete";
  };

  const majorCourses = Object.values(courseMap).map(
    (course) => ({
      code: course.code,
      name: course.name,
      status: getCourseStatus(course.code, course.grades),
    })
  );

  /*
   * ------------------------------------------------
   * RENDER
   * ------------------------------------------------
   */

  if (loading) {
    return (
      <div className="dashboard">
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <p>{error}</p>

        <button
          type="button"
          onClick={() => onNavigate?.("upload")}
        >
          Upload Grades
        </button>
      </div>
    );
  }

  return (
    <div className="dashboard">

      {/* ACTION BUTTONS */}

      <div className="dashboard-actions">

        <button
          type="button"
          className="upload-grade-btn secondary"
          onClick={() =>
            onNavigate?.("grade-list")
          }
        >
          <ListChecks
            size={18}
            strokeWidth={2}
          />

          <span>Grade List</span>
        </button>

        <button
          type="button"
          className="upload-grade-btn"
          onClick={() =>
            onNavigate?.("upload")
          }
        >
          <UploadCloud
            size={18}
            strokeWidth={2}
          />

          <span>Upload Grade</span>
        </button>

      </div>

      {/* STAT CARDS */}

      <div className="stat-grid">

        <div className="stat-card">
          <span className="stat-label">
            Overall GPA
          </span>

          <span className="stat-value">
            {overallGPA !== null
              ? overallGPA.toFixed(2)
              : "N/A"}
          </span>
        </div>

        <div className="stat-card">
          <span className="stat-label">
            Current Semester
          </span>

          <span className="stat-value">
            {currentSemester}
          </span>
        </div>

      </div>

      {/* ACADEMIC PROGRESS */}

      <div className="progress-card">

        <div className="progress-header">

          <span className="progress-title">
            Academic Progress
          </span>

          <span className="progress-pct">
            {progressPct}%
          </span>

        </div>

        <div className="progress-track">

          <div
            className="progress-fill"
            style={{
              width: `${progressPct}%`,
              backgroundColor: progressColor,
            }}
          />

        </div>

        <div className="progress-footer">

          <span>
            {creditsEarned}/
            {creditsRequired} Credits
          </span>

        </div>

      </div>

      {/* GRADUATION ESTIMATE */}

      <div className="grad-status-card">

        <span>
          Estimated Graduation Status :{" "}
          {estimatedTermsLeft} Terms 
        </span>

      </div>

      {/* COURSE STATUS */}

      <div className="major-courses-card">

        <h3>
          Course status
        </h3>

        {majorCourses.length === 0 ? (
          <p>
            Start Uploading your transcript to see your course status.
          </p>
        ) : (
          <ul className="major-courses-list">

            {majorCourses.map(
              ({
                code,
                name,
                status,
              }) => (
                <li key={code}>

                  <span className="course-code">
                    {code} {name}
                  </span>

                  <span
                    className={`course-status ${
                      STATUS_CLASS[status] ?? ""
                    }`}
                  >
                    {status}
                  </span>

                </li>
              )
            )}

          </ul>
        )}

      </div>

    </div>
  );
}

export default Dashboard;
