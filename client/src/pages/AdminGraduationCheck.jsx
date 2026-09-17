import { useState } from "react";
import { CheckCircle2, Search, XCircle } from "lucide-react";

import { getAdvisorById } from "../data/mockAdvisors.js";
import {
  getCurriculumForStudent,
  syncCurriculaFromServer,
} from "../utils/curriculum.js";
import {
  calculateGPA,
  checkGraduation,
  getFinalCourseGrades,
  isCompletedGrade,
  prepareCourseRows,
} from "../utils/graduation.js";
import { normalizeCourseCode } from "../utils/courseCode.js";
import "./AdminGraduationCheck.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

async function fetchJSON(url) {
  const response = await fetch(url);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("The server returned an invalid response.");
  }
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data;
}

function mergeCompletedManualCourses(finalGrades, manualCourses) {
  const byCode = new Map();
  finalGrades.forEach((course) => {
    const code = normalizeCourseCode(course.course_code);
    if (code) byCode.set(code, course);
  });

  (manualCourses || [])
    .filter((course) => course.status === "completed")
    .forEach((course) => {
      const code = normalizeCourseCode(course.course_code);
      if (!code) return;
      const official = byCode.get(code);
      if (official && isCompletedGrade(official.grade)) return;
      byCode.set(code, {
        course_code: code,
        course_name: course.course_name,
        credits: course.credits,
        grade: "S",
        Semester: "Manual",
      });
    });

  return Array.from(byCode.values());
}

function AdminGraduationCheck() {
  const [query, setQuery] = useState("");
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async (event) => {
    event.preventDefault();
    const studentId = query.trim().toUpperCase();
    if (!studentId) {
      setError("Please enter a Student ID.");
      setRecord(null);
      return;
    }

    try {
      setLoading(true);
      setError("");
      setRecord(null);
      await syncCurriculaFromServer();

      const [studentData, gradesData, electiveGroupData, manualCourses] = await Promise.all([
        fetchJSON(`${API_BASE}/students/${encodeURIComponent(studentId)}`),
        fetchJSON(`${API_BASE}/grades?student_id=${encodeURIComponent(studentId)}`),
        fetchJSON(`${API_BASE}/student-elective-group/${encodeURIComponent(studentId)}`),
        fetchJSON(`${API_BASE}/student-elective-courses?student_id=${encodeURIComponent(studentId)}`)
          .catch(() => []),
      ]);

      const profile = studentData.student;
      const officialGrades = Array.isArray(gradesData) ? gradesData : [];
      const finalOfficialGrades = getFinalCourseGrades(officialGrades);
      const effectiveCourses = mergeCompletedManualCourses(finalOfficialGrades, manualCourses);
      const courseRows = prepareCourseRows(effectiveCourses);
      const curriculum = getCurriculumForStudent(profile.student_id, profile.curriculum_year);
      const electiveGroupId =
        electiveGroupData.elective_group || profile.elective_group || null;
      const gpa = calculateGPA(finalOfficialGrades);
      const student = {
        studentId: profile.student_id,
        displayName: profile.name || profile.student_id,
        email: profile.email || "",
        advisorId: profile.advisor_id || null,
        curriculumYear: profile.curriculum_year || curriculum?.year || null,
        gpa,
        courses: effectiveCourses,
      };
      const result = checkGraduation(student, curriculum, { electiveGroupId });

      setRecord({
        student,
        advisor: student.advisorId ? getAdvisorById(student.advisorId) : null,
        curriculum,
        electiveGroupId,
        result,
        courses: courseRows,
      });
    } catch (searchError) {
      console.error("Admin graduation check error:", searchError);
      setError(
        searchError.message === "Failed to fetch"
          ? "Could not connect to the backend. Make sure the server is running on port 3001."
          : searchError.message || "Unable to check this student."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grad-check-page">
      <span className="admin-summary-title-pill">Graduation Check</span>

      <form className="grad-check-search" onSubmit={handleSearch}>
        <Search size={18} strokeWidth={2} />
        <input
          type="text"
          placeholder="Enter Student ID, e.g. U6610001"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Checking..." : "Check"}
        </button>
      </form>

      {error && <div className="grad-check-card grad-check-error">{error}</div>}

      {record && (
        <div className="grad-check-card">
          <div className="grad-check-header">
            <div>
              <h3>{record.student.displayName}</h3>
              <p className="grad-check-sub">
                Student ID: {record.student.studentId}
                {" • "}Email: {record.student.email || "-"}
                {" • "}Advisor: {record.advisor?.name || record.student.advisorId || "-"}
              </p>
            </div>
            <span
              className={`grad-status-badge ${
                record.result.graduated ? "graduated" : "not-graduated"
              }`}
            >
              {record.result.graduated ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
              {record.result.graduated ? "Graduated" : "Not Graduated"}
            </span>
          </div>

          <section className="grad-check-section">
            <h4>Graduation Summary</h4>
            <div className="grad-check-table-wrap">
              <table className="grad-check-data-table">
                <thead>
                  <tr>
                    <th>Curriculum</th>
                    <th>Elective Group</th>
                    <th>GPA</th>
                    <th>Credits Earned</th>
                    <th>Credits Required</th>
                    <th>Credits Left</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{record.result.curriculumYear || "-"}</td>
                    <td>{record.electiveGroupId || "Not selected"}</td>
                    <td>{record.result.gpa.toFixed(2)}</td>
                    <td>{record.result.totalCredits}</td>
                    <td>{record.curriculum?.totalCreditsRequired ?? "-"}</td>
                    <td>{record.result.creditShortfall}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {record.result.graduated ? (
            <p className="grad-check-pass-note">
              This student meets every graduation requirement.
            </p>
          ) : (
            <div className="grad-check-reasons">
              <h4>Requirements Not Yet Met</h4>
              <ul>
                {record.result.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </div>
          )}

          {record.result.groupProgress.length > 0 && (
            <section className="grad-check-section">
              <h4>Requirement Group Progress</h4>
              <div className="grad-check-table-wrap">
                <table className="grad-check-data-table">
                  <thead>
                    <tr>
                      <th>Requirement Group</th>
                      <th>Courses</th>
                      <th>Credits</th>
                      <th>Remaining</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.result.groupProgress.map((group) => (
                      <tr key={group.id || group.label}>
                        <td>{group.label}</td>
                        <td>{group.completedCount} / {group.requiredCount}</td>
                        <td>{group.completedCredits} / {group.requiredCredits || "-"}</td>
                        <td>
                          {group.remainingCount} course(s), {group.remainingCredits} credit(s)
                        </td>
                        <td>
                          <span className={`grad-course-status ${group.satisfied ? "completed" : "not-completed"}`}>
                            {group.satisfied ? "Met" : "Not Met"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {record.result.missingCourses.length > 0 && (
            <section className="grad-check-section">
              <h4>Missing Courses</h4>
              <div className="grad-check-table-wrap">
                <table className="grad-check-data-table">
                  <thead>
                    <tr>
                      <th>Course Code</th>
                      <th>Course Name</th>
                      <th>Group</th>
                      <th>Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.result.missingCourses.map((course, index) => (
                      <tr key={`${course.code}-${index}`}>
                        <td>{course.code}</td>
                        <td>{course.name || "-"}</td>
                        <td>{course.blockLabel || "-"}</td>
                        <td>{course.credits || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="grad-check-section">
            <h4>Final Course Results</h4>
            <div className="grad-check-table-wrap">
              <table className="grad-check-data-table">
                <thead>
                  <tr>
                    <th>Course Code</th>
                    <th>Course Name</th>
                    <th>Semester</th>
                    <th>Grade</th>
                    <th>Credits</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {record.courses.length > 0 ? record.courses.map((course) => (
                    <tr key={course.code}>
                      <td>{course.code}</td>
                      <td>{course.name}</td>
                      <td>{course.semester}</td>
                      <td><span className="grad-grade">{course.grade}</span></td>
                      <td>{course.credits}</td>
                      <td>
                        <span className={`grad-course-status ${course.statusClass}`}>
                          {course.status}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="6">No grade records were found for this student.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default AdminGraduationCheck;
