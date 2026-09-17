import { useEffect, useState } from "react";
import axios from "axios";
import { ArrowLeft, Pencil, Save } from "lucide-react";
import "./GradeList.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

const GRADE_POINTS = {
  A: 4.00,
  "A-": 3.75,
  "B+": 3.25,
  B: 3.00,
  "B-": 2.75,
  "C+": 2.25,
  C: 2.00,
  "C-": 1.75,
  D: 1.00,
  F: 0.00,
};

// Grades that count toward credits earned (S counts, but has no GPA value).
const GRADES_THAT_COUNT = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F", "S"];

// Selectable in the edit dropdown — includes grades without GPA points
// (S/W/I) so a student can correct a misread transcript value to any of
// the marks AU Spark actually uses.
const EDITABLE_GRADES = [...Object.keys(GRADE_POINTS), "S", "W", "I"];

function GradeList({ onNavigate, studentId }) {
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Which term (semester key, e.g. "1/2023") is currently being edited —
  // null means no term is in edit mode. Only one term can be edited at a
  // time, but it can be ANY term, not just the most recent one.
  const [editingTerm, setEditingTerm] = useState(null);
  const [activeGradeId, setActiveGradeId] = useState(null);
  const [gradeDrafts, setGradeDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

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

        console.log("Getting grades for student:", studentId);

        const response = await axios.get(
          `${API_BASE}/grades?student_id=${studentId}`
        );

        setGrades(response.data);
      } catch (error) {
        console.error("Error loading grades:", error);
        console.error("Backend response:", error.response?.data);

        setError(
          error.response?.data?.error ||
            "Unable to load grades."
        );
      } finally {
        setLoading(false);
      }
    };

    fetchGrades();
  }, [studentId]);

  const startEditingTerm = (term) => {
    setSaveError("");
    setGradeDrafts({});
    setActiveGradeId(null);
    setEditingTerm(term);
  };

  const saveEditingTermGrades = async () => {
    const changed = grades.filter((course) => gradeDrafts[course.id] && gradeDrafts[course.id] !== course.grade);
    if (changed.some((course) => !gradeDrafts[course.id])) return;
    try {
      setSaving(true);
      setSaveError("");
      const updates = await Promise.all(changed.map(async (course) => {
        const { data } = await axios.put(`${API_BASE}/grades/${course.id}`, {
          course_name: course.course_name || "",
          grade: gradeDrafts[course.id],
          credits: Number(course.credits),
        });
        return data.grade;
      }));
      const byId = new Map(updates.map((course) => [course.id, course]));
      setGrades((prev) => prev.map((course) => byId.has(course.id) ? { ...course, grade: byId.get(course.id).grade } : course));
      setEditingTerm(null);
      setActiveGradeId(null);
      setGradeDrafts({});
    } catch (error) {
      console.error("Failed to save grade:", error);
      setSaveError(error.response?.data?.error || "Failed to save — please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Group grades by semester
  const gradesBySemester = grades.reduce((groups, grade) => {
    const semester = grade.Semester || "Unknown Semester";

    if (!groups[semester]) {
      groups[semester] = [];
    }

    groups[semester].push(grade);

    return groups;
  }, {});

  // Calculate weighted average for one semester
  const calculateTermAverage = (courses) => {
    let totalPoints = 0;
    let totalCredits = 0;

    courses.forEach((course) => {
      const grade = course.grade?.trim().toUpperCase();
      const gradePoint = GRADE_POINTS[grade];

      const credits = Number(course.credits);

      // Ignore grades that don't have grade points
      // such as S, W, I, etc.
      if (
        gradePoint !== undefined &&
        !isNaN(credits) &&
        credits > 0
      ) {
        totalPoints += gradePoint * credits;
        totalCredits += credits;
      }
    });

    if (totalCredits === 0) {
      return null;
    }

    return totalPoints / totalCredits;
  };

  // Calculate total credits earned for one semester (courses that count,
  // even ones without a GPA value like S).
  const calculateTermCredits = (courses) => {
    let totalCredits = 0;

    courses.forEach((course) => {
      const grade = course.grade?.trim().toUpperCase();
      const credits = Number(course.credits);

      if (
        GRADES_THAT_COUNT.includes(grade) &&
        !isNaN(credits) &&
        credits > 0
      ) {
        totalCredits += credits;
      }
    });

    return totalCredits;
  };

  // Sort semesters from newest to oldest
  const sortedSemesters = Object.entries(
    gradesBySemester
  ).sort(([semesterA], [semesterB]) => {
    const [termA, yearA] = semesterA.split("/").map(Number);
    const [termB, yearB] = semesterB.split("/").map(Number);

    if (yearA !== yearB) {
      return yearB - yearA;
    }

    return termB - termA;
  });

  return (
    <div className="grade-list-page">

      <button
        type="button"
        className="grade-list-back"
        onClick={() => onNavigate?.("dashboard")}
      >
        <ArrowLeft size={16} strokeWidth={2} />
        <span>Back to Dashboard</span>
      </button>

      <h2>My Grades</h2>

      <p>
        Student ID: <strong>{studentId}</strong>
      </p>

      {loading && <p>Loading grades...</p>}

      {!loading && error && (
        <p className="upload-message">{error}</p>
      )}

      {!loading && !error && grades.length === 0 && (
        <p>
          No grades found. Upload your transcript first.
        </p>
      )}

      {!loading &&
        !error &&
        sortedSemesters.map(([term, courses]) => {
          const average = calculateTermAverage(courses);
          const termCredits = calculateTermCredits(courses);

          const isEditingThisTerm = editingTerm === term;

          return (
            <section className="grade-term-wrap" key={term}>
              <div className="grade-term-actions">
                {!isEditingThisTerm ? (
                  <button
                    type="button"
                    className="grade-term-edit"
                    onClick={() => startEditingTerm(term)}
                    disabled={editingTerm !== null}
                  >
                    <Pencil size={15} /> Edit
                  </button>
                ) : (
                  <button type="button" className="grade-term-save" onClick={saveEditingTermGrades} disabled={saving}>
                    <Save size={15} /> {saving ? "Saving..." : "Save"}
                  </button>
                )}
              </div>
            <div className="grade-term-card">

              {/* SEMESTER HEADER */}

              <div className="term-header">

                <h3>
                  {term}
                  <span className="term-credits"> · {termCredits} Credits</span>
                </h3>

                <div className="term-average">

                  <span className="term-average-value">
                    {average !== null
                      ? (
                          Math.round(
                            (average + 1e-9) * 100
                          ) / 100
                        ).toFixed(2)
                      : "N/A"}
                  </span>
                </div>

              </div>

              {/* COURSES */}

              <ul>

                {courses.map((course) => {
                  return (
                    <li key={course.id} className="grade-course-box">
                      <span className="grade-course">
                        {course.course_code}{" "}
                        {course.course_name}{" "}
                        ({course.credits} Credits)
                      </span>

                      {isEditingThisTerm && activeGradeId === course.id ? (
                        <select className="grade-value grade-inline-select" value={gradeDrafts[course.id] ?? course.grade} onChange={(e) => { setGradeDrafts((prev) => ({ ...prev, [course.id]: e.target.value })); setActiveGradeId(null); }} autoFocus>
                          {EDITABLE_GRADES.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                        </select>
                      ) : (
                        <button type="button" className={`grade-value${isEditingThisTerm ? " is-editable" : ""}`} onClick={() => isEditingThisTerm && setActiveGradeId(course.id)} disabled={!isEditingThisTerm}>{gradeDrafts[course.id] ?? course.grade}</button>
                      )}
                    </li>
                  );
                })}

              </ul>

              {isEditingThisTerm && saveError && <p className="grade-edit-error">{saveError}</p>}
            </div>
            </section>
          );
        })}

    </div>
  );
}

export default GradeList;
