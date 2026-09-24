import { useState } from "react";
import axios from "axios";
import { CalendarCheck, AlertTriangle, Check, X, Sparkles } from "lucide-react";
import { normalizeCourseCode } from "../utils/courseCode.js";
import { TIMETABLE_DAY_LABELS } from "../data/mockTimetable.js";

import "./CoursePlanGenerator.css";

const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

const CATEGORY_OPTIONS = [
  { key: "core", label: "Core / Major Required" },
  { key: "major_elective", label: "Major Elective" },
  { key: "gen_ed", label: "General Education" },
  { key: "free_elective", label: "Free Elective" },
];

const DEFAULT_CATEGORIES = {
  core: { enabled: true, count: "" },
  major_elective: { enabled: true, count: "" },
  gen_ed: { enabled: true, count: "" },
  free_elective: { enabled: false, count: "" },
};

const STAGE_LABELS = {
  required: "Graduation requirement",
  gateway: "Unlocks other courses",
  category: "Your category pick",
  interest: "Matches your interests",
  fill: "Fills remaining credits",
};

const MIN_CREDITS = 1;
const MAX_CREDITS = 30;

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function overlaps(a, b) {
  return a.day === b.day && toMinutes(a.start) < toMinutes(b.end) && toMinutes(a.end) > toMinutes(b.start);
}

function describeMeetings(section) {
  if (!section) return "";
  return section.meetings
    .map((m) => `${TIMETABLE_DAY_LABELS[m.day] || "?"} ${m.start}–${m.end}`)
    .join(", ");
}

// Generates a one-semester plan (POST /course-plan in server/server.js) and
// lets the student add each course to Planner individually, or accept the
// whole plan at once. Open courses (on the timetable) are registered with
// the section the generator picked; courses not on the timetable are added
// to "Requested Unscheduled Courses" instead — same two tables Planner and
// the recommendation list below already use.
function CoursePlanGenerator({ studentId, onCoursesAdded }) {
  const [targetCredits, setTargetCredits] = useState(18);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState(null); // server response
  const [addedCodes, setAddedCodes] = useState(() => new Set());
  const [busy, setBusy] = useState(null); // course code being added, or "all"
  const [addError, setAddError] = useState("");

  const updateCategory = (key, patch) =>
    setCategories((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const generate = async () => {
    if (!studentId) return;
    const credits = Number(targetCredits);
    if (!Number.isFinite(credits) || credits < MIN_CREDITS || credits > MAX_CREDITS) {
      setError(`Target credits must be between ${MIN_CREDITS} and ${MAX_CREDITS}.`);
      return;
    }
    if (!CATEGORY_OPTIONS.some(({ key }) => categories[key].enabled)) {
      setError("Pick at least one course category.");
      return;
    }

    setGenerating(true);
    setError("");
    setAddError("");
    try {
      const payload = Object.fromEntries(
        CATEGORY_OPTIONS.map(({ key }) => [
          key,
          {
            enabled: categories[key].enabled,
            count: categories[key].count === "" ? null : Number(categories[key].count),
          },
        ])
      );
      const res = await axios.post(`${API_BASE}/course-plan`, {
        student_id: studentId,
        target_credits: credits,
        categories: payload,
      });
      setPlan(res.data);
      setAddedCodes(new Set());
    } catch (err) {
      console.error("Failed to generate plan:", err);
      setError(err.response?.data?.error || "Could not generate a plan right now.");
      setPlan(null);
    } finally {
      setGenerating(false);
    }
  };

  const removeFromPlan = (code) => {
    setPlan((prev) =>
      prev ? { ...prev, plan: prev.plan.filter((c) => c.code !== code) } : prev
    );
  };

  // Adds a batch of plan courses to Planner. Registrations/requests are
  // saved as full lists (the endpoints replace the student's rows), so the
  // current rows are fetched first and the new ones appended.
  const addCourses = async (courses) => {
    if (!studentId || courses.length === 0) return;
    setAddError("");

    const openCourses = courses.filter((c) => c.isOpen && c.section);
    const requestCourses = courses.filter((c) => !c.isOpen || !c.section);

    if (openCourses.length > 0) {
      const [regRes, ttRes] = await Promise.all([
        axios.get(`${API_BASE}/registrations/${encodeURIComponent(studentId)}`),
        axios.get(`${API_BASE}/timetable`).catch(() => null),
      ]);
      const existingRows = regRes.data?.registrations || [];
      const entries = ttRes?.data?.entries || [];

      // Re-check time clashes against what's in Planner *now* — the student
      // may have changed it since the plan was generated.
      const busyMeetings = existingRows.flatMap((row) =>
        entries
          .filter(
            (e) =>
              normalizeCourseCode(e.code) === normalizeCourseCode(row.course_code) &&
              String(e.section || "1") === String(row.section || "1")
          )
          .map((e) => ({ day: e.day, start: e.start, end: e.end, label: `${e.code} Sec.${e.section || "1"}` }))
      );
      for (const course of openCourses) {
        for (const meeting of course.section.meetings) {
          const clash = busyMeetings.find((b) => overlaps(meeting, b));
          if (clash) {
            throw new Error(`${course.code} overlaps with ${clash.label} (${clash.start}–${clash.end}) already in your planner.`);
          }
        }
        busyMeetings.push(
          ...course.section.meetings.map((m) => ({ ...m, label: `${course.code} Sec.${course.section.section}` }))
        );
      }

      const existingLabels = existingRows.map(
        (row) => row.course_label || `${row.course_code} Sec.${row.section || "1"}`
      );
      await axios.post(`${API_BASE}/registrations`, {
        studentId,
        courses: [
          ...existingLabels,
          ...openCourses.map((c) => `${c.code} Sec.${c.section.section || "1"}`),
        ],
      });
    }

    if (requestCourses.length > 0) {
      const reqRes = await axios.get(`${API_BASE}/requested-courses/${encodeURIComponent(studentId)}`);
      const existingLabels = (reqRes.data?.requestedCourses || []).map((row) =>
        `${row.course_code} ${row.course_name || ""}`.trim()
      );
      await axios.post(`${API_BASE}/requested-courses`, {
        studentId,
        courses: [...existingLabels, ...requestCourses.map((c) => `${c.code} ${c.title || ""}`.trim())],
      });
    }

    const codes = courses.map((c) => c.code);
    setAddedCodes((prev) => new Set([...prev, ...codes]));
    onCoursesAdded?.(codes);
  };

  const handleAddOne = async (course) => {
    if (busy) return;
    setBusy(course.code);
    try {
      await addCourses([course]);
    } catch (err) {
      console.error("Failed to add plan course:", err);
      setAddError(err.response?.data?.error || err.message || `Could not add ${course.code}.`);
    } finally {
      setBusy(null);
    }
  };

  const handleAcceptAll = async () => {
    if (busy || !plan) return;
    const remaining = plan.plan.filter((c) => !addedCodes.has(c.code));
    if (remaining.length === 0) return;
    setBusy("all");
    try {
      await addCourses(remaining);
    } catch (err) {
      console.error("Failed to accept plan:", err);
      setAddError(err.response?.data?.error || err.message || "Could not add the plan to your planner.");
    } finally {
      setBusy(null);
    }
  };

  const planCourses = plan?.plan || [];
  const planCredits = planCourses.reduce((sum, c) => sum + (Number(c.credits) || 0), 0);
  const totalCredits = (plan?.existingCredits || 0) + planCredits;
  const remainingCount = planCourses.filter((c) => !addedCodes.has(c.code)).length;

  return (
    <div className="plan-gen-card">
      <div className="plan-gen-header">
        <h3>
          <CalendarCheck size={18} strokeWidth={2} />
          Generate Semester Plan
        </h3>
        <p className="plan-gen-sub">
          Core and graduation-required courses come first, then a few courses that unlock
          others (lowest course number first), then picks based on your interests.
        </p>
      </div>

      <div className="plan-gen-settings">
        <label className="plan-gen-credits">
          <span>Target credits</span>
          <input
            type="number"
            min={MIN_CREDITS}
            max={MAX_CREDITS}
            value={targetCredits}
            onChange={(e) => setTargetCredits(e.target.value)}
          />
        </label>

        <div className="plan-gen-categories">
          <span className="plan-gen-label">Include categories (optional: fix how many courses)</span>
          {CATEGORY_OPTIONS.map(({ key, label }) => (
            <div key={key} className={`plan-gen-cat ${categories[key].enabled ? "on" : ""}`}>
              <label className="plan-gen-cat-toggle">
                <input
                  type="checkbox"
                  checked={categories[key].enabled}
                  onChange={(e) => updateCategory(key, { enabled: e.target.checked })}
                />
                {label}
              </label>
              <input
                type="number"
                min={0}
                max={10}
                placeholder="Auto"
                className="plan-gen-count"
                disabled={!categories[key].enabled}
                value={categories[key].count}
                onChange={(e) => updateCategory(key, { count: e.target.value })}
                aria-label={`Number of ${label} courses`}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          className="plan-gen-btn"
          onClick={generate}
          disabled={generating || !studentId}
        >
          <Sparkles size={16} />
          {generating ? "Generating…" : plan ? "Regenerate Plan" : "Generate Plan"}
        </button>
      </div>

      {error && (
        <div className="course-rec-notice">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      )}

      {plan && (
        <div className="plan-gen-result">
          <div className="plan-gen-summary">
            <div>
              <strong>{totalCredits}</strong> / {plan.targetCredits} credits
              {plan.existingCredits > 0 && (
                <span className="plan-gen-muted">
                  {" "}
                  (includes {plan.existingCredits} already in your planner)
                </span>
              )}
              {!plan.hasTimetable && (
                <span className="plan-gen-muted">
                  {" "}
                  · No timetable uploaded yet — courses will be added as requests
                </span>
              )}
            </div>
            <button
              type="button"
              className="plan-gen-accept"
              onClick={handleAcceptAll}
              disabled={Boolean(busy) || remainingCount === 0}
            >
              {busy === "all" ? "Adding…" : remainingCount === 0 ? "All added" : `Accept All (${remainingCount})`}
            </button>
          </div>

          {plan.warnings?.map((w) => (
            <div key={w} className="course-rec-notice">
              <AlertTriangle size={16} strokeWidth={2} />
              <span>{w}</span>
            </div>
          ))}

          {addError && (
            <div className="course-rec-notice plan-gen-error">
              <AlertTriangle size={16} strokeWidth={2} />
              <span>{addError}</span>
            </div>
          )}

          {planCourses.length === 0 ? (
            <p>No eligible courses found for these settings.</p>
          ) : (
            <ul className="plan-gen-list">
              {planCourses.map((course) => {
                const added = addedCodes.has(course.code);
                return (
                  <li key={course.code} className={added ? "added" : ""}>
                    <div className="plan-gen-info">
                      <div className="plan-gen-title">
                        <strong>{course.code}</strong> {course.title || "Untitled Course"}
                        <span className="plan-gen-credit">{course.credits} cr</span>
                      </div>
                      <div className="plan-gen-tags">
                        <span className={`plan-gen-tag cat-${course.category}`}>{course.categoryLabel}</span>
                        <span className={`plan-gen-tag stage-${course.stage}`}>{STAGE_LABELS[course.stage]}</span>
                        {course.isOpen && course.section ? (
                          <span className="plan-gen-tag time">
                            Sec. {course.section.section} · {describeMeetings(course.section)}
                          </span>
                        ) : (
                          <span className="plan-gen-tag not-open">Not on timetable — request</span>
                        )}
                      </div>
                      {course.reason && <p className="plan-gen-reason">{course.reason}</p>}
                    </div>

                    <div className="plan-gen-actions">
                      {added ? (
                        <span className="plan-gen-added">
                          <Check size={15} /> Added
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="add-to-plan-btn"
                            disabled={Boolean(busy)}
                            onClick={() => handleAddOne(course)}
                          >
                            {busy === course.code ? "Adding…" : course.isOpen ? "Add" : "Request"}
                          </button>
                          <button
                            type="button"
                            className="plan-gen-remove"
                            disabled={Boolean(busy)}
                            onClick={() => removeFromPlan(course.code)}
                            aria-label={`Remove ${course.code} from this plan`}
                            title="Remove from this plan"
                          >
                            <X size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default CoursePlanGenerator;