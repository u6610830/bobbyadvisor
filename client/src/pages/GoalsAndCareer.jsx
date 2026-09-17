import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Sparkles, Check } from "lucide-react";
import MultiChoice from "../components/MultiChoice.jsx";
import { GOAL_OPTIONS, CAREER_OPTIONS } from "../data/goalCareerOptions.js";
import { getStudentGoalsCareer, setStudentGoalsCareer } from "../utils/goalsCareer.js";
import {
  getCurriculumForStudent,
  getCurriculumGroups,
  syncCurriculaFromServer,
  subscribeCurricula,
} from "../utils/curriculum.js";
import { evaluateCurriculumProgress } from "../utils/curriculumProgress.js";
import { normalizeCourseCode } from "../utils/courseCode.js";
import { getFinalCourseGrades, isCompletedGrade } from "../utils/graduation.js";
import {
  getBlockElectiveGroupId,
  getElectiveGroupOptions,
  getStudentElectiveGroup,
  setStudentElectiveGroup,
} from "../utils/electiveGroup.js";
import "./GoalsAndCareer.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

// ── GroupChoiceInput ────────────────────────────────────────────────────
// Single-select "Search Suggestions" input for whichever groups Admin has
// ticked as a "choose one of these" set on Upload Table Data (Major
// Elective Group 1A vs 1B, or any further alternative Admin ticks — see
// utils/electiveGroup.js getElectiveGroupOptions), same interaction
// pattern as the Course Group input on Admin > Upload Table Data — type
// to filter, click a suggestion to choose it.
function GroupChoiceInput({ value, options, onSelect, disabled }) {
  const [draft, setDraft] = useState(value || "");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => setDraft(value || ""), [value]);

  useEffect(() => {
    const handleClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const suggestions = options.filter((opt) =>
    opt.fullName.toLowerCase().includes(draft.trim().toLowerCase())
  );

  return (
    <div className="goals-search-wrap" ref={wrapRef}>
      <input
        type="text"
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search your Major Elective group…"
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="goals-search-dropdown">
          {suggestions.map((opt) => (
            <li
              key={opt.id}
              className="goals-search-item"
              onMouseDown={() => {
                setDraft(opt.fullName);
                setOpen(false);
                onSelect(opt.id);
              }}
            >
              <strong>{opt.fullName}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GoalsAndCareer({ studentId, curriculumYear = null, onNavigate }) {
  const [goals, setGoals] = useState([]);
  const [careerInterests, setCareerInterests] = useState([]);
  const [goalsLoading, setGoalsLoading] = useState(true);
  const [goalsError, setGoalsError] = useState("");
  const [goalsSaving, setGoalsSaving] = useState(false);
  // Guards against the initial server fetch immediately re-triggering a
  // save (goals/careerInterests changing from the fetch would otherwise
  // look identical to the user editing the list).
  const hasLoadedGoals = useRef(false);

  // electiveGroupId = the choice actually saved to the database — this is
  // what Planner's "Check course left" reads (via getStudentElectiveGroup)
  // to decide which group's block to show. pendingGroupId is just what's
  // picked in the input right now, not persisted until Save is clicked.
  const [electiveGroupId, setElectiveGroupId] = useState(null); // a group's label, or null
  const [pendingGroupId, setPendingGroupId] = useState(null);
  const [groupLoading, setGroupLoading] = useState(true);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [groupMessage, setGroupMessage] = useState("");
  const [progress, setProgress] = useState(null); // { missingCount, block } | null
  const [, setCurriculaVersion] = useState(0);

  // Course suggestions generated from Goals + Career Interest — same
  // POST /course-recommendations Course Recommendation uses, surfaced
  // right here too so a student sees the effect of what they just typed
  // without leaving the page.
  const [recommendations, setRecommendations] = useState([]);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState("");
  const [recNeedsGoals, setRecNeedsGoals] = useState(false);
  const [addedCodes, setAddedCodes] = useState(() => new Set());
  const [addingCode, setAddingCode] = useState(null);
  const hasAutoFetchedRecs = useRef(false);

  // Load this student's saved Goals & Career Interest from their own
  // record (server-side, not localStorage) — see server/supabase_goals_career.sql.
  useEffect(() => {
    if (!studentId) {
      setGoalsLoading(false);
      return;
    }
    let cancelled = false;
    setGoalsLoading(true);
    setGoalsError("");
    getStudentGoalsCareer(studentId)
      .then(({ goals: loadedGoals, careerInterests: loadedCareer }) => {
        if (cancelled) return;
        // Nothing saved yet for this student — leave it blank (the
        // EditableList empty-state text below explains what to add)
        // rather than showing fake sample data.
        setGoals(loadedGoals);
        setCareerInterests(loadedCareer);
        hasLoadedGoals.current = true;
      })
      .catch((err) => {
        console.error("Failed to load goals/career interests:", err);
        if (cancelled) return;
        setGoalsError("Could not load your saved Goals & Career Interest.");
        // Leave hasLoadedGoals.current false so a failed fetch can't
        // trigger the auto-save effect below and overwrite real saved
        // data with a blank/stale list.
      })
      .finally(() => {
        if (!cancelled) setGoalsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  // Auto-save on every add/edit/delete (same immediate-save feel as
  // before), now persisted to the student's record instead of
  // localStorage. Skipped until the initial load above has resolved, so
  // loading saved data doesn't get mistaken for the user editing it.
  useEffect(() => {
    if (!studentId || !hasLoadedGoals.current) return;
    setGoalsSaving(true);
    setGoalsError("");
    setStudentGoalsCareer(studentId, { goals, careerInterests })
      .catch((err) => {
        console.error("Failed to save goals/career interests:", err);
        setGoalsError("Could not save your changes — please try again.");
      })
      .finally(() => setGoalsSaving(false));
  }, [studentId, goals, careerInterests]);

  const loadRecommendations = () => {
    if (!studentId) return;
    setRecLoading(true);
    setRecError("");
    setRecNeedsGoals(false);
    axios
      .post(`${API_BASE}/course-recommendations`, { student_id: studentId })
      .then((res) => setRecommendations(res.data?.recommendations || []))
      .catch((err) => {
        console.error("Failed to load course suggestions:", err);
        setRecNeedsGoals(Boolean(err.response?.data?.needsGoals));
        setRecError(err.response?.data?.error || "Failed to load course suggestions.");
        setRecommendations([]);
      })
      .finally(() => setRecLoading(false));
  };

  // Auto-fetch once, right after the saved Goals/Career load in, as long
  // as there's actually something to base suggestions on — after that,
  // the student refreshes manually (via the button below) rather than on
  // every keystroke, since each refresh is a real AI call.
  useEffect(() => {
    if (!hasLoadedGoals.current || hasAutoFetchedRecs.current) return;
    if (goalsLoading) return;
    if (goals.length === 0 && careerInterests.length === 0) return;
    hasAutoFetchedRecs.current = true;
    loadRecommendations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalsLoading, goals, careerInterests]);

  // Adds one recommended course to the student's "Requested Unscheduled
  // Courses" list (Planner). That endpoint replaces the whole list per
  // save, so we read the current one, append this course, and save it back.
  const handleAddToPlan = async (course) => {
    if (!studentId || addedCodes.has(course.code)) return;
    setAddingCode(course.code);
    try {
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
      setAddedCodes((prev) => new Set(prev).add(course.code));
    } catch (err) {
      console.error("Failed to add course to plan:", err);
      setRecError(err.response?.data?.error || "Could not add that course to your plan.");
    } finally {
      setAddingCode(null);
    }
  };

  // Curriculum requirements live in the database — refresh the local cache
  // on mount, and re-render (via the unused bit of state above) whenever it
  // changes, so the group choices below always reflect the latest save
  // from Admin > Upload Table Data (including a newly added sub-group).
  useEffect(() => {
    syncCurriculaFromServer();
    return subscribeCurricula(() => setCurriculaVersion((v) => v + 1));
  }, []);

  const curriculum = studentId
    ? getCurriculumForStudent(studentId, curriculumYear)
    : null;
  const curriculumBlocks = useMemo(() => getCurriculumGroups(curriculum), [curriculum]);

  // Every Major Elective sub-group this student's curriculum actually
  // offers — not a fixed "1A or 1B" list, so a Group 1C (or any further
  // group) Admin adds on Upload Table Data shows up here automatically.
  const groupOptions = useMemo(() => getElectiveGroupOptions(curriculumBlocks), [curriculumBlocks]);

  // The student's saved elective-group choice lives in the database, tied
  // to their record — not localStorage — so it's the same on every device.
  useEffect(() => {
    if (!studentId) {
      setGroupLoading(false);
      return;
    }
    setGroupLoading(true);
    getStudentElectiveGroup(studentId)
      .then((groupId) => {
        setElectiveGroupId(groupId);
        setPendingGroupId(groupId);
      })
      .catch((err) => {
        console.error("Failed to load elective group choice:", err);
        setGroupError("Could not load your saved group choice.");
      })
      .finally(() => setGroupLoading(false));
  }, [studentId]);

  const handleSaveGroup = async () => {
    if (!studentId || !pendingGroupId) return;
    setGroupSaving(true);
    setGroupError("");
    setGroupMessage("");
    try {
      await setStudentElectiveGroup(studentId, pendingGroupId);
      setElectiveGroupId(pendingGroupId);
      setGroupMessage(
        `Saved — Planner's "Check course left" will now show ${pendingGroupId}.`
      );
    } catch (err) {
      console.error("Failed to save elective group choice:", err);
      setGroupError(err.response?.data?.error || "Could not save your choice — please try again.");
    } finally {
      setGroupSaving(false);
    }
  };

  // How many courses are still missing in the chosen group, computed the
  // same way as Planner's "Check course left" (grades + planned courses
  // vs. the curriculum block whose group matches the chosen full name).
  useEffect(() => {
    if (!studentId || !electiveGroupId) {
      setProgress(null);
      return;
    }
    if (!curriculum) {
      setProgress(null);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const [gradesRes, regRes] = await Promise.all([
          axios.get(`${API_BASE}/grades?student_id=${studentId}`),
          axios.get(`${API_BASE}/registrations/${studentId}`),
        ]);

        const completed = new Set();
        const gradesByCode = new Map();

        getFinalCourseGrades(gradesRes.data || []).forEach((g) => {
          const code = normalizeCourseCode(g.course_code);
          if (!code) return;

          const grade = String(g.grade || "").trim().toUpperCase();
          if (grade) gradesByCode.set(code, grade);

          if (isCompletedGrade(grade)) {
            completed.add(code);
          }
        });

        const inProgress = new Set();
        (regRes.data?.registrations || []).forEach((r) => {
          const code = normalizeCourseCode(r.course_code);
          if (code && !completed.has(code)) inProgress.add(code);
        });

        const { blocks } = evaluateCurriculumProgress(
          curriculum,
          completed,
          inProgress,
          gradesByCode
        );

        const block = blocks.find(
          (b) => getBlockElectiveGroupId(b) === electiveGroupId
        );

        if (!cancelled) {
          setProgress(
            block
              ? {
                  missingCount: block.courses.filter(
                    (c) => c.status === "not-taken" || c.status === "re-grade"
                  ).length,
                  block,
                }
              : null
          );
        }
      } catch (err) {
        console.error("Failed to compute group progress:", err);
        if (!cancelled) setProgress(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [studentId, electiveGroupId, curriculum]);

  const pendingFullName = useMemo(
    () => groupOptions.find((opt) => opt.id === pendingGroupId)?.fullName || "",
    [groupOptions, pendingGroupId]
  );
  const savedFullName = useMemo(
    () => groupOptions.find((opt) => opt.id === electiveGroupId)?.fullName || "",
    [groupOptions, electiveGroupId]
  );
  const hasUnsavedChange = pendingGroupId && pendingGroupId !== electiveGroupId;

  return (
    <div className="goals-page">
      <div className="goals-card">
        <h3>Goals:</h3>
        <p className="goals-group-hint">Choose as many as you want.</p>
        {goalsLoading ? (
          <p className="goals-group-hint">Loading…</p>
        ) : (
          <MultiChoice
            options={GOAL_OPTIONS}
            value={goals}
            onChange={setGoals}
            disabled={goalsSaving}
          />
        )}
      </div>

      <div className="goals-card">
        <h3>Career Interest:</h3>
        <p className="goals-group-hint">Select every career area you are interested in.</p>
        {goalsLoading ? (
          <p className="goals-group-hint">Loading…</p>
        ) : (
          <MultiChoice
            options={CAREER_OPTIONS}
            value={careerInterests}
            onChange={setCareerInterests}
            disabled={goalsSaving}
          />
        )}
        {!goalsLoading && goalsSaving && <p className="goals-save-status">Saving…</p>}
        {!goalsLoading && goalsError && <p className="goals-group-error">{goalsError}</p>}
        {!goalsLoading && !goalsError && !goalsSaving && (
          <p className="goals-save-status">
            Bobby Advisor and Course Recommendation use these choices to personalize suggestions.
          </p>
        )}
      </div>

      <div className="goals-card">
        <div className="goals-rec-header">
          <h3>
            <Sparkles size={18} strokeWidth={2} />
            Suggested Courses
          </h3>
          <button
            type="button"
            className="goals-rec-refresh-btn"
            onClick={loadRecommendations}
            disabled={recLoading || goalsLoading}
          >
            {recLoading ? "Thinking…" : "Suggest Courses"}
          </button>
        </div>

        <p className="goals-group-hint">
          Based on the Goals and Career Interest above — edit them, then click
          Suggest Courses again for updated picks.
        </p>

        {recLoading && <p className="goals-group-hint">Finding courses that fit…</p>}

        {!recLoading && recError && (
          <p className="goals-group-error">
            {recError}
            {recNeedsGoals && " Add a Goal or Career Interest above first."}
          </p>
        )}

        {!recLoading && !recError && recommendations.length > 0 && (
          <ul className="goals-rec-list">
            {recommendations.map((course) => {
              const added = addedCodes.has(course.code);
              return (
                <li key={course.code}>
                  <div>
                    <span className="goals-rec-item">
                      <strong>{course.code}</strong> {course.title || "Untitled Course"}
                    </span>
                    {course.reason && <p className="goals-rec-reason">{course.reason}</p>}
                  </div>
                  <button
                    type="button"
                    className={`goals-rec-add-btn${added ? " added" : ""}`}
                    disabled={added || addingCode === course.code}
                    onClick={() => handleAddToPlan(course)}
                  >
                    {added ? (
                      <>
                        <Check size={14} /> Added
                      </>
                    ) : addingCode === course.code ? (
                      "Adding…"
                    ) : (
                      "Add to Plan"
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="goals-card">
        <h3>Choose your group:</h3>
        {groupLoading ? (
          <p className="goals-group-hint">Loading…</p>
        ) : (
          <>
            <p className="goals-group-hint">
              Pick your Major Elective group, then click Save — Planner&apos;s &ldquo;Check course left&rdquo; uses
              whichever group you last saved here.
            </p>
            <div className="goals-group-row">
              <GroupChoiceInput
                value={pendingFullName}
                options={groupOptions}
                onSelect={setPendingGroupId}
                disabled={groupSaving}
              />
              <button
                type="button"
                className="goals-group-save-btn"
                onClick={handleSaveGroup}
                disabled={groupSaving || !pendingGroupId || !hasUnsavedChange}
              >
                {groupSaving ? "Saving…" : "Save"}
              </button>
            </div>
            {groupError && <p className="goals-group-error">{groupError}</p>}
            {!groupError && groupMessage && <p className="goals-group-done">{groupMessage}</p>}

            {electiveGroupId && (
              <div className="goals-group-summary">
                <p>
                  Saved choice: <strong>{savedFullName || electiveGroupId}</strong>
                </p>
                {progress && (
                  <p className={progress.missingCount === 0 ? "goals-group-done" : ""}>
                    {progress.missingCount === 0
                      ? "You've completed or planned every course in this group."
                      : `Missing ${progress.missingCount} course(s) in this group.`}
                  </p>
                )}
                {onNavigate && (
                  <button type="button" className="goals-group-planner-btn" onClick={() => onNavigate("planner")}>
                    Go to Planner — Check course left
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default GoalsAndCareer;
