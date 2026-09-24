import { useEffect, useState } from "react";
import axios from "axios";
import { Sparkles, AlertTriangle, X } from "lucide-react";
import { normalizeCourseCode, extractCourseCodes } from "../utils/courseCode.js";
import { getCurrentPrereqGroupId } from "../utils/prereqGroup.js";
import { getFinalCourseGrades, isCompletedGrade } from "../utils/graduation.js";
import { TIMETABLE_DAY_LABELS } from "../data/mockTimetable.js";
import CoursePlanGenerator from "./CoursePlanGenerator.jsx";

import "./CourseRecommendation.css";

const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

const PREREQ_GROUP_COLUMN = { g1: "g1_text", g2: "g2_text", g3: "g3_text" };

function toMinutes(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  return h * 60 + m;
}

// Sorts sections low-to-high by section number. Falls back to plain string
// comparison for non-numeric section labels (e.g. "A", "B") so nothing
// crashes or silently disappears if a section isn't a number. Same helper
// Planner uses for its own section picker.
function sortSections(sections) {
  return [...sections].sort((a, b) => {
    const numA = Number(a.section);
    const numB = Number(b.section);
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
    return String(a.section || "").localeCompare(String(b.section || ""));
  });
}

// Personalized elective/next-course suggestions, generated from the
// student's own Goals & Career Interest (Goals & Career page) plus what
// they still need for their curriculum — see POST /course-recommendations
// in server/server.js.
function CourseRecommendation({ studentId, onNavigate }) {
  const [recommendations, setRecommendations] = useState([]);
  const [goals, setGoals] = useState([]);
  const [careerInterests, setCareerInterests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsGoals, setNeedsGoals] = useState(false);
  const [addingCode, setAddingCode] = useState(null);
  // Kept separate from `error` (the load failure) — an add/request
  // failure (prerequisite not met, time conflict, etc.) should show as a
  // notice alongside the still-visible recommendation list, not replace
  // the whole page with just an error and nothing else.
  const [addError, setAddError] = useState("");
  // The recommendation currently asking "which section?" (a course object
  // with 2+ open sections), or null when no picker is open.
  const [sectionPicker, setSectionPicker] = useState(null);
  const [openEntries, setOpenEntries] = useState([]);
  const [prereqRows, setPrereqRows] = useState([]);
  const [passedCodes, setPassedCodes] = useState(() => new Set());

  const prereqGroupId = studentId ? getCurrentPrereqGroupId(studentId) : null;
  const prereqColumn = PREREQ_GROUP_COLUMN[prereqGroupId];

  const loadRecommendations = async () => {
    if (!studentId) {
      setLoading(false);
      setError("You need to be signed in as a student to see recommendations.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setNeedsGoals(false);

      // Everything needed to both show and safely add a recommendation,
      // fetched together: the recommendations themselves; registrations +
      // requested courses (so an already-handled course can be filtered
      // out rather than shown as if it still needed action); the open
      // timetable (for the time-conflict check); and the Pre-Require table
      // + this student's grades (for the prerequisite check) — same data
      // Planner's own "Add" flow checks against.
      const [recRes, registrationsRes, requestedRes, timetableRes, prereqRes, gradesRes] =
        await Promise.all([
          axios.post(`${API_BASE}/course-recommendations`, { student_id: studentId }),
          axios.get(`${API_BASE}/registrations/${encodeURIComponent(studentId)}`).catch(() => null),
          axios.get(`${API_BASE}/requested-courses/${encodeURIComponent(studentId)}`).catch(() => null),
          axios.get(`${API_BASE}/timetable`).catch(() => null),
          axios.get(`${API_BASE}/prerequisites`).catch(() => null),
          axios.get(`${API_BASE}/grades?student_id=${encodeURIComponent(studentId)}`).catch(() => null),
        ]);

      const registeredCodes = (registrationsRes?.data?.registrations || []).map((r) =>
        normalizeCourseCode(r.course_code)
      );
      const requestedCodes = (requestedRes?.data?.requestedCourses || []).map((r) =>
        normalizeCourseCode(r.course_code)
      );
      // Already registered or requested -> don't show it as a
      // recommendation at all, on this load or any later one (the server
      // already excludes these from candidates too — this is a client-side
      // backstop in case the same course code somehow still comes back).
      // normalizeCourseCode strips ALL whitespace (not just leading/
      // trailing), so a code with a stray internal space from the AI-
      // extracted catalog still matches correctly.
      const alreadyHandled = new Set([...registeredCodes, ...requestedCodes].filter(Boolean));

      const nextRecommendations = (recRes.data?.recommendations || []).filter(
        (c) => !alreadyHandled.has(normalizeCourseCode(c.code))
      );
      setRecommendations(nextRecommendations);
      setGoals(recRes.data?.goals || []);
      setCareerInterests(recRes.data?.careerInterests || []);
      setOpenEntries(timetableRes?.data?.entries || []);
      setPrereqRows(prereqRes?.data?.prerequisites || []);

      const passed = new Set();
      getFinalCourseGrades(gradesRes?.data || []).forEach((g) => {
        if (isCompletedGrade(g.grade)) {
          const code = normalizeCourseCode(g.course_code);
          if (code) passed.add(code);
        }
      });
      setPassedCodes(passed);
    } catch (err) {
      console.error("Failed to load course recommendations:", err);
      setNeedsGoals(Boolean(err.response?.data?.needsGoals));
      setError(
        err.response?.data?.error || "Failed to load course recommendations."
      );
      setRecommendations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecommendations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // Same check Planner runs before adding a course: is there a Pre-Require
  // row for this course under the student's prerequisite group, and if so,
  // has the student passed everything it lists? Returns a message string
  // if blocked, or null if clear (or if there's simply no rule to check).
  const checkPrerequisite = (courseCode, courseTitle) => {
    if (!prereqColumn) return null; // no group resolvable — can't check, don't block
    const normalized = normalizeCourseCode(courseCode);
    let row = normalized
      ? prereqRows.find((r) => normalizeCourseCode(r.course_code) === normalized)
      : null;
    if (!row && courseTitle) {
      const normalizedTitle = String(courseTitle).trim().toLowerCase();
      row = prereqRows.find(
        (r) => String(r.course_title || "").trim().toLowerCase() === normalizedTitle
      );
    }
    if (!row) return null; // no Pre-Require entry for this course

    const ruleText = row[prereqColumn];
    if (!ruleText || !ruleText.trim()) return null;

    const rowCode = normalizeCourseCode(row.course_code) || normalized;
    const requiredCodes = extractCourseCodes(ruleText).filter((c) => c !== rowCode);
    const missing = requiredCodes.filter((c) => !passedCodes.has(c));
    if (missing.length === 0) return null;

    return `Cannot add ${rowCode || courseCode}: has not yet passed ${missing.join(", ")}.`;
  };

  // A course open in exactly one section this term gets that section
  // automatically. When several are open, handleAddClick shows a picker
  // (same idea as Planner's own section picker) instead of guessing —
  // the chosen section is then threaded through as `section` below.
  const registrationLabelFor = (course, section) =>
    section ? `${course.code} Sec.${section.section || "1"}` : course.code;

  // Same overlap check Planner uses when adding a course: does the new
  // section's day/time overlap any section the student is already
  // registered for? Registrations only store course_code + section, not
  // day/time, so each existing registration is matched against the full
  // open timetable (already fetched alongside the recommendations) to
  // find its actual time.
  const findScheduleConflict = (section, registeredRows) => {
    if (!section) return null;
    const targetStart = toMinutes(section.start);
    const targetEnd = toMinutes(section.end);

    for (const row of registeredRows) {
      const entry = openEntries.find(
        (e) =>
          normalizeCourseCode(e.code) === normalizeCourseCode(row.course_code) &&
          String(e.section || "1") === String(row.section || "1")
      );
      if (!entry || entry.day !== section.day) continue;
      const existStart = toMinutes(entry.start);
      const existEnd = toMinutes(entry.end);
      if (targetStart < existEnd && targetEnd > existStart) {
        return `${entry.code} Sec.${entry.section || "1"} (${entry.start}\u2013${entry.end})`;
      }
    }
    return null;
  };

  // Open this term -> actually register the student (POST /registrations),
  // same table Planner's "Selected Courses" reads/writes — after checking
  // prerequisites and that it doesn't clash with a class the student
  // already has that day. Not open this term -> add to "Requested
  // Unscheduled Courses" instead (POST /requested-courses). Either way,
  // once it succeeds the course is removed from this list entirely (it's
  // no longer something to recommend — it's already handled), rather than
  // staying visible with an "Added"/"Requested" label. `section` is the
  // specific open section to register for — required when the course has
  // one, resolved by handleAddClick/pickSection before this ever runs.
  const handleAdd = async (course, section) => {
    if (!studentId || addingCode) return;
    setAddError("");

    const prereqBlock = checkPrerequisite(course.code, course.title);
    if (prereqBlock) {
      setAddError(prereqBlock);
      return;
    }

    setAddingCode(course.code);
    try {
      if (course.isOpen) {
        const existingRes = await axios.get(
          `${API_BASE}/registrations/${encodeURIComponent(studentId)}`
        );
        const existingRows = existingRes.data?.registrations || [];

        const conflict = findScheduleConflict(section, existingRows);
        if (conflict) {
          setAddError(
            `Can't add ${course.code} — it overlaps with ${conflict}, which you already have scheduled at that time.`
          );
          return;
        }

        const existingLabels = existingRows.map(
          (row) => row.course_label || `${row.course_code} Sec.${row.section || "1"}`
        );
        await axios.post(`${API_BASE}/registrations`, {
          studentId,
          courses: [...existingLabels, registrationLabelFor(course, section)],
        });
      } else {
        const existingRes = await axios.get(
          `${API_BASE}/requested-courses/${encodeURIComponent(studentId)}`
        );
        const existingLabels = (existingRes.data?.requestedCourses || []).map(
          (row) => `${row.course_code} ${row.course_name || ""}`.trim()
        );
        await axios.post(`${API_BASE}/requested-courses`, {
          studentId,
          courses: [...existingLabels, `${course.code} ${course.title || ""}`.trim()],
        });
      }

      setRecommendations((prev) => prev.filter((c) => c.code !== course.code));
      setSectionPicker(null);
    } catch (err) {
      console.error("Failed to add course:", err);
      // Prerequisite failures caught server-side (belt-and-suspenders,
      // e.g. stale client data) land here with the server's own message,
      // e.g. "Cannot save CSX3009: has not yet passed CSX3003." — shown
      // as-is rather than replaced with a generic one.
      setAddError(
        err.response?.data?.error ||
          (course.isOpen
            ? "Could not add that course to your plan."
            : "Could not request that course.")
      );
    } finally {
      setAddingCode(null);
    }
  };

  // Entry point for the "Add to Plan" button. A course open in exactly one
  // section (or not open at all — a plain request) is added right away.
  // One open in several sections can't be resolved automatically — Planner
  // itself asks the student which one to join, so this does the same via
  // the section-picker modal below instead of silently guessing.
  const handleAddClick = (course) => {
    if (course.isOpen && course.sections.length > 1) {
      setAddError("");
      setSectionPicker(course);
      return;
    }
    handleAdd(course, course.sections?.[0] || null);
  };

  const pickSection = (course, section) => {
    handleAdd(course, section);
  };

  // Courses added from the generated plan are no longer "to do" — drop
  // them from the recommendation list below too.
  const handlePlanCoursesAdded = (codes) => {
    const added = new Set(codes.map((c) => normalizeCourseCode(c)));
    setRecommendations((prev) => prev.filter((c) => !added.has(normalizeCourseCode(c.code))));
  };

  return (
    <div className="course-rec">
      <CoursePlanGenerator studentId={studentId} onCoursesAdded={handlePlanCoursesAdded} />

      <div className="course-rec-card">
        <div className="course-rec-header">
          <h3>
            <Sparkles size={18} strokeWidth={2} />
            Recommended For You
          </h3>

          {(goals.length > 0 || careerInterests.length > 0) && (
            <p className="course-rec-based-on">
              Based on your goals
              {goals.length > 0 && <>: {goals.join(", ")}</>}
              {careerInterests.length > 0 && (
                <> and career interest: {careerInterests.join(", ")}</>
              )}
            </p>
          )}
        </div>

        {loading && <p>Finding courses that fit your goals…</p>}

        {!loading && error && (
          <div className="course-rec-error">
            <p>{error}</p>
            {needsGoals && onNavigate && (
              <button
                type="button"
                className="course-rec-goals-btn"
                onClick={() => onNavigate("goals")}
              >
                Go to Goals & Career
              </button>
            )}
          </div>
        )}

        {!loading && !error && addError && (
          <div className="course-rec-notice">
            <AlertTriangle size={16} strokeWidth={2} />
            <span>{addError}</span>
          </div>
        )}

        {!loading && !error && recommendations.length === 0 && (
          <p>No recommendations right now — check back after Admin adds more course descriptions.</p>
        )}

        {!loading && !error && recommendations.length > 0 && (
          <ul className="course-rec-list">
            {recommendations.map((course) => (
              <li key={course.code}>
                <div className="course-rec-info">
                  <span className="course-rec-item">
                    <strong>{course.code}</strong>{" "}
                    {course.title || "Untitled Course"}
                    {!course.isOpen && (
                      <span className="course-rec-not-open">Not Open</span>
                    )}
                  </span>

                  {course.reason && (
                    <p className="course-rec-reason">{course.reason}</p>
                  )}

                  {course.description && (
                    <p className="course-rec-description">
                      {course.description}
                    </p>
                  )}

                  {course.credits != null && (
                    <span className="course-rec-credits">
                      {course.credits} Credits
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="add-to-plan-btn"
                  disabled={addingCode === course.code}
                  onClick={() => handleAddClick(course)}
                >
                  {addingCode === course.code
                    ? "Adding…"
                    : course.isOpen
                    ? "Add to Plan"
                    : "Request"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sectionPicker && (
        <div
          className="course-rec-modal-backdrop"
          onClick={() => (addingCode ? null : setSectionPicker(null))}
        >
          <div className="course-rec-modal" onClick={(e) => e.stopPropagation()}>
            <div className="course-rec-modal-head">
              <h4>Choose a section — {sectionPicker.code}</h4>
              <button
                type="button"
                className="course-rec-modal-close"
                onClick={() => setSectionPicker(null)}
                disabled={Boolean(addingCode)}
              >
                <X size={18} />
              </button>
            </div>

            {addError && (
              <div className="course-rec-notice course-rec-modal-notice">
                <AlertTriangle size={16} strokeWidth={2} />
                <span>{addError}</span>
              </div>
            )}

            <div className="course-rec-section-grid">
              {sortSections(sectionPicker.sections).map((section) => (
                <button
                  type="button"
                  key={`${section.section}-${section.day}-${section.start}`}
                  className="course-rec-section-box"
                  disabled={Boolean(addingCode)}
                  onClick={() => pickSection(sectionPicker, section)}
                >
                  <strong className="course-rec-section-box-title">
                    Sec. {section.section || "1"}
                  </strong>
                  <span className="course-rec-section-schedule">
                    {TIMETABLE_DAY_LABELS[section.day]} {section.start}–{section.end}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CourseRecommendation;