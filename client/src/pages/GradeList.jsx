import { useEffect, useState } from "react";
import axios from "axios";
import "./GradeList.css";
import { ArrowLeft, Pencil, Save, Plus, Trash2, X } from "lucide-react";
import UnsavedNotice from "../components/UnsavedNotice.jsx";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.PROD
    ? "https://api.bobbyadvisor.org"
    : "http://localhost:3001");

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

// Grades that count toward credits earned.
const GRADES_THAT_COUNT = [
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D",
  "F",
  "S",
];

// Grades available when editing/adding.
const EDITABLE_GRADES = [
  ...Object.keys(GRADE_POINTS),
  "S",
  "W",
  "I",
];

// Semester must look like 1/2026 or 2/2026.
const SEMESTER_RE = /^[12]\/\d{4}$/;

const EMPTY_NEW_GRADE = {
  course_code: "",
  course_name: "",
  grade: "A",
  credits: "",
  Semester: "",
};

function GradeList({ onNavigate, studentId }) {
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Editing existing grades
  const [editingTerm, setEditingTerm] = useState(null);
  const [activeGradeId, setActiveGradeId] = useState(null);
  const [gradeDrafts, setGradeDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Adding a new grade (has its own error so it never mixes with edit errors)
  const [showAddForm, setShowAddForm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [newGrade, setNewGrade] = useState(EMPTY_NEW_GRADE);

  // Deleting a grade
  const [deletingId, setDeletingId] = useState(null);

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

  // ------------------------------------------------
  // EDIT EXISTING GRADE
  // ------------------------------------------------

  const startEditingTerm = (term) => {
    setSaveError("");
    setGradeDrafts({});
    setActiveGradeId(null);
    setEditingTerm(term);
  };

  const saveEditingTermGrades = async () => {
    const changed = grades.filter(
      (course) =>
        gradeDrafts[course.id] &&
        gradeDrafts[course.id] !== course.grade
    );

    try {
      setSaving(true);
      setSaveError("");

      const updates = await Promise.all(
        changed.map(async (course) => {
          const { data } = await axios.put(
            `${API_BASE}/grades/${course.id}`,
            {
              course_name: course.course_name || "",
              grade: gradeDrafts[course.id],
              credits: Number(course.credits),
            }
          );

          return data.grade;
        })
      );

      const byId = new Map(
        updates.map((course) => [course.id, course])
      );

      setGrades((prev) =>
        prev.map((course) =>
          byId.has(course.id)
            ? {
                ...course,
                grade: byId.get(course.id).grade,
              }
            : course
        )
      );

      setEditingTerm(null);
      setActiveGradeId(null);
      setGradeDrafts({});
    } catch (error) {
      console.error("Failed to save grade:", error);

      setSaveError(
        error.response?.data?.error ||
          "Failed to save — please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------
  // ADD NEW GRADE
  // ------------------------------------------------

  const closeAddForm = () => {
    setShowAddForm(false);
    setAddError("");
  };

  const addGrade = async () => {
    if (
      !newGrade.course_code.trim() ||
      !newGrade.course_name.trim() ||
      !newGrade.grade ||
      !newGrade.credits ||
      !newGrade.Semester.trim()
    ) {
      setAddError("Please fill in all fields.");
      return;
    }

    const credits = Number(newGrade.credits);

    if (Number.isNaN(credits) || credits <= 0) {
      setAddError("Credits must be greater than 0.");
      return;
    }

    if (!SEMESTER_RE.test(newGrade.Semester.trim())) {
      setAddError("Semester must look like 1/2026 or 2/2026.");
      return;
    }

    try {
      setAdding(true);
      setAddError("");

      const response = await axios.post(`${API_BASE}/grades`, {
        student_id: studentId,
        course_code: newGrade.course_code.trim().toUpperCase(),
        course_name: newGrade.course_name.trim(),
        grade: newGrade.grade,
        credits,
        Semester: newGrade.Semester.trim(),
      });

      setGrades((prev) => [...prev, response.data]);
      setNewGrade(EMPTY_NEW_GRADE);
      setShowAddForm(false);
    } catch (error) {
      console.error("Failed to add grade:", error);

      setAddError(
        error.response?.data?.error ||
          "Failed to add grade — please try again."
      );
    } finally {
      setAdding(false);
    }
  };

  // ------------------------------------------------
  // DELETE GRADE
  // ------------------------------------------------

  const deleteGrade = async (id) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this grade?"
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(id);
      setSaveError("");

      await axios.delete(`${API_BASE}/grades/${id}`);

      setGrades((prev) =>
        prev.filter((course) => course.id !== id)
      );

      // If the deleted grade was being edited,
      // clear its edit state.
      if (activeGradeId === id) {
        setActiveGradeId(null);
      }
    } catch (error) {
      console.error("Failed to delete grade:", error);

      setSaveError(
        error.response?.data?.error ||
          "Failed to delete grade — please try again."
      );
    } finally {
      setDeletingId(null);
    }
  };

  // ------------------------------------------------
  // GROUP GRADES BY SEMESTER
  // ------------------------------------------------

  const gradesBySemester = grades.reduce((groups, grade) => {
    const semester = grade.Semester || "Unknown Semester";

    if (!groups[semester]) {
      groups[semester] = [];
    }

    groups[semester].push(grade);

    return groups;
  }, {});

  // ------------------------------------------------
  // CALCULATE TERM GPA
  // ------------------------------------------------

  const calculateTermAverage = (courses) => {
    let totalPoints = 0;
    let totalCredits = 0;

    courses.forEach((course) => {
      const grade = course.grade?.trim().toUpperCase();
      const gradePoint = GRADE_POINTS[grade];

      const credits = Number(course.credits);

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

  // ------------------------------------------------
  // CALCULATE TERM CREDITS
  // ------------------------------------------------

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

  // ------------------------------------------------
  // SORT SEMESTERS NEWEST → OLDEST
  // ------------------------------------------------

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

  // ------------------------------------------------
  // UI
  // ------------------------------------------------

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

      {/* ADD GRADE BUTTON / FORM */}

      {!loading && !error && (
        <div className="grade-add-area">
          {!showAddForm ? (
            <button
              type="button"
              className="grade-add-button"
              onClick={() => {
                setAddError("");
                setShowAddForm(true);
              }}
            >
              <Plus size={17} />
              Add Grade
            </button>
          ) : (
            <div className="grade-add-form">
              <div className="grade-add-header">
                <h3>Add Grade</h3>

                <button
                  type="button"
                  className="grade-add-close"
                  onClick={closeAddForm}
                  disabled={adding}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div
                className="grade-add-fields"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !adding) addGrade();
                }}
              >
                <div className="grade-add-field">
                  <label>Course Code</label>
                  <input
                    type="text"
                    placeholder="e.g. CSX3002"
                    value={newGrade.course_code}
                    onChange={(e) =>
                      setNewGrade((prev) => ({
                        ...prev,
                        course_code: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grade-add-field is-wide">
                  <label>Course Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Object-Oriented Concepts and Programming"
                    value={newGrade.course_name}
                    onChange={(e) =>
                      setNewGrade((prev) => ({
                        ...prev,
                        course_name: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grade-add-field">
                  <label>Grade</label>
                  <select
                    value={newGrade.grade}
                    onChange={(e) =>
                      setNewGrade((prev) => ({
                        ...prev,
                        grade: e.target.value,
                      }))
                    }
                  >
                    {EDITABLE_GRADES.map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grade-add-field">
                  <label>Credits</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder="e.g. 3"
                    value={newGrade.credits}
                    onChange={(e) =>
                      setNewGrade((prev) => ({
                        ...prev,
                        credits: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grade-add-field">
                  <label>Semester</label>
                  <input
                    type="text"
                    placeholder="e.g. 1/2026"
                    value={newGrade.Semester}
                    onChange={(e) =>
                      setNewGrade((prev) => ({
                        ...prev,
                        Semester: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              {addError && (
                <p className="grade-edit-error">{addError}</p>
              )}

              <div className="grade-add-actions">
                <button
                  type="button"
                  className="grade-add-cancel"
                  onClick={closeAddForm}
                  disabled={adding}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="grade-add-save"
                  onClick={addGrade}
                  disabled={adding}
                >
                  <Save size={15} />
                  {adding ? "Adding..." : "Add Grade"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading && <p>Loading grades...</p>}

      {!loading && error && (
        <p className="upload-message">{error}</p>
      )}

      {!loading &&
        !error &&
        grades.length === 0 &&
        !showAddForm && (
          <p>
            No grades found. Upload your transcript first or add a
            grade manually.
          </p>
        )}

      {!loading &&
        !error &&
        sortedSemesters.map(([term, courses]) => {
          const average = calculateTermAverage(courses);
          const termCredits = calculateTermCredits(courses);

          const isEditingThisTerm = editingTerm === term;

          return (
            <section
              className="grade-term-wrap"
              key={term}
            >
              <div className="grade-term-actions">
                {!isEditingThisTerm ? (
                  <button
                    type="button"
                    className="grade-term-edit"
                    onClick={() => startEditingTerm(term)}
                    disabled={editingTerm !== null}
                  >
                    <Pencil size={15} />
                    Edit
                  </button>
                ) : (
                  <button
                    type="button"
                    className="grade-term-save"
                    onClick={saveEditingTermGrades}
                    disabled={saving}
                  >
                    <Save size={15} />
                    {saving ? "Saving..." : "Save"}
                  </button>
                )}

                {isEditingThisTerm && !saving && (
                  <UnsavedNotice
                    show
                    text="Not saved yet — press Save."
                  />
                )}
              </div>

              <div className="grade-term-card">
                {/* SEMESTER HEADER */}

                <div className="term-header">
                  <h3>
                    {term}
                    <span className="term-credits">
                      {" "}
                      · {termCredits} Credits
                    </span>
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
                      <li
                        key={course.id}
                        className="grade-course-box"
                      >
                        <span className="grade-course">
                          {course.course_code}{" "}
                          {course.course_name}{" "}
                          ({course.credits} Credits)
                        </span>

                        <div className="grade-course-actions">
                          {isEditingThisTerm &&
                          activeGradeId === course.id ? (
                            <select
                              className="grade-value grade-inline-select"
                              value={
                                gradeDrafts[course.id] ??
                                course.grade
                              }
                              onChange={(e) => {
                                setGradeDrafts((prev) => ({
                                  ...prev,
                                  [course.id]:
                                    e.target.value,
                                }));

                                setActiveGradeId(null);
                              }}
                              autoFocus
                            >
                              {EDITABLE_GRADES.map((grade) => (
                                <option
                                  key={grade}
                                  value={grade}
                                >
                                  {grade}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <button
                              type="button"
                              className={`grade-value${
                                isEditingThisTerm
                                  ? " is-editable"
                                  : ""
                              }`}
                              onClick={() =>
                                isEditingThisTerm &&
                                setActiveGradeId(course.id)
                              }
                              disabled={!isEditingThisTerm}
                            >
                              {gradeDrafts[course.id] ??
                                course.grade}
                            </button>
                          )}

                          {/* DELETE BUTTON */}

                          <button
                            type="button"
                            className="grade-delete-button"
                            onClick={() =>
                              deleteGrade(course.id)
                            }
                            disabled={
                              deletingId === course.id ||
                              saving
                            }
                            title="Delete grade"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {isEditingThisTerm && saveError && (
                  <p className="grade-edit-error">
                    {saveError}
                  </p>
                )}
              </div>
            </section>
          );
        })}
    </div>
  );
}
export default GradeList;