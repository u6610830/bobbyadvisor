import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { GraduationCap, CheckCircle2, Clock, Circle, RotateCcw, Plus, Pencil, Save, Trash2 } from "lucide-react";
import { getCurriculumForStudent, getCurriculumGroups, syncCurriculaFromServer, subscribeCurricula } from "../utils/curriculum.js";
import { evaluateCurriculumProgress } from "../utils/curriculumProgress.js";
import { normalizeCourseCode } from "../utils/courseCode.js";
import {
  getFinalCourseGrades,
  normalizeGrade,
  courseMatchesRule,
  COMPLETED_GRADES,
  PASSING_WITHOUT_MIN_C,
} from "../utils/graduation.js";
import { getStudentElectiveGroup, filterBlocksForElectiveGroup } from "../utils/electiveGroup.js";
import {
  statusOverrideGroupKey,
  canAddCourseToGroup,
  fetchStudentElectiveCourses,
  mergeElectiveGroupRows,
  electiveGroupCreditsEarned,
} from "../utils/studentElectiveCourses.js";
import "./StudentGraduationCheck.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

const STATUS_META = {
  completed: { label: "Completed", icon: CheckCircle2, className: "gc-status-completed" },
  "in-progress": { label: "In Progress", icon: Clock, className: "gc-status-inprogress" },
  "not-taken": { label: "Not Taken", icon: Circle, className: "gc-status-nottaken" },
  "re-grade": { label: "Retake", icon: RotateCcw, className: "gc-status-regrade" },
};

const STATUS_OPTIONS = ["completed", "in-progress", "not-taken", "re-grade"];

const EMPTY_ADD_FORM = { code: "", name: "", credits: "" };

function rowKey(groupName, code) {
  return `${groupName}::${code}`;
}

// readOnly: true hides every editing control (group Edit/Save, Add
// Course, per-row Delete) so this same component can be embedded
// read-only elsewhere — e.g. the Advisor's Student List detail view,
// showing one specific student's real progress from the database with no
// way to change it. Everything else (data fetching, per-student scoping)
// is identical to the student's own page.
function StudentGraduationCheck({ studentId, curriculumYear = null, readOnly = false }) {
  const [completedCodes, setCompletedCodes] = useState(new Set());
  const [inProgressCodes, setInProgressCodes] = useState(new Set());
  const [gradesByCode, setGradesByCode] = useState(new Map());
  // Credits earned from the transcript (grades table) only — self-added
  // elective credits are folded in below via `creditsEarned`, kept separate
  // so a problem loading self-added courses can never wipe out this number.
  const [gradeCreditsEarned, setGradeCreditsEarned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [curriculaVersion, setCurriculaVersion] = useState(0);
  const [electiveGroupId, setElectiveGroupId] = useState(null); // a group's label, or null, from Goal and Career

  // Student's own status rows for the two open-selection groups (Other
  // Major Elective Courses / C. Free Elective Course), loaded from the
  // database — covers both brand-new courses and overrides of Admin's
  // pre-approved list.
  const [electiveCourses, setElectiveCourses] = useState([]);
  const [addForms, setAddForms] = useState({}); // { [groupName]: { open, code, name, credits, saving, error } }

  // One Edit/Save toggle per group (like Grade List's per-term Edit/Save):
  // which canonical group names are currently in edit mode, the draft
  // status per row while editing, and per-group saving/error state.
  const [editingGroups, setEditingGroups] = useState(new Set());
  const [statusDrafts, setStatusDrafts] = useState({}); // { [rowKey]: draftStatus }
  const [savingGroups, setSavingGroups] = useState(new Set());
  const [saveErrors, setSaveErrors] = useState({}); // { [groupName]: error }
  const [profileCurriculum, setProfileCurriculum] = useState(null);

  // Curriculum requirements live in the database now — refresh the local
  // cache on mount, and re-render (via the unused bit of state above)
  // whenever it changes so the lookup below always reflects the latest
  // save from Admin > Upload Table Data.
  useEffect(() => {
    syncCurriculaFromServer();
    return subscribeCurricula(() => setCurriculaVersion((v) => v + 1));
  }, []);

  useEffect(() => {
    if (!studentId || curriculumYear) return;
    axios
      .get(`${API_BASE}/students/${encodeURIComponent(studentId)}`)
      .then((response) => setProfileCurriculum({
        studentId,
        year: response.data?.student?.curriculum_year || null,
      }))
      .catch((fetchError) => {
        console.warn("Could not load the student's saved curriculum year:", fetchError.message);
        setProfileCurriculum({ studentId, year: null });
      });
  }, [studentId, curriculumYear]);

  const effectiveCurriculumYear =
    curriculumYear ||
    (profileCurriculum?.studentId === studentId ? profileCurriculum.year : null);

  // When curriculumYear is not passed in, wait for the student's profile
  // before choosing a curriculum. This avoids briefly rendering the wrong
  // curriculum during login/re-login.
  const profileCurriculumReady =
    Boolean(curriculumYear) ||
    profileCurriculum?.studentId === studentId;

  const curriculum =
    studentId && profileCurriculumReady
      ? getCurriculumForStudent(studentId, effectiveCurriculumYear)
      : null;

  // The student's Major Elective group choice, saved on Goal and Career —
  // used below to hide the *other* group's requirement block, same as
  // Planner's "Check course left".
  useEffect(() => {
    if (!studentId) return;
    getStudentElectiveGroup(studentId)
      .then(setElectiveGroupId)
      .catch((err) => console.error("Failed to load elective group:", err));
  }, [studentId]);

  // Transcript + planned-courses status — this is the original behavior
  // (Completed / In Progress / Not Taken per course) and must keep working
  // on its own, independent of the self-added elective courses below.
  useEffect(() => {
    if (!studentId || !profileCurriculumReady) return;

    let cancelled = false;

    setLoading(true);
    setError("");

    // Build the Min-C rule list inside the effect. Do not put an array/object
    // returned from getCurriculumForStudent() in this effect's dependency
    // list, because that can create a new reference every render and cause
    // an endless fetch -> setState -> render -> fetch loop.
    const currentCurriculum = getCurriculumForStudent(
      studentId,
      effectiveCurriculumYear
    );

    const minGradeCRules = getCurriculumGroups(currentCurriculum)
      .flatMap((block) => block.courses || [])
      .filter((course) => course.minGradeC)
      .map((course) => course.code);

    const requiresMinGradeC = (courseCode) =>
      minGradeCRules.some((rule) =>
        courseMatchesRule(courseCode, rule)
      );

    const passesForCurriculum = (courseCode, grade) => {
      const normalized = normalizeGrade(grade);

      if (requiresMinGradeC(courseCode)) {
        return COMPLETED_GRADES.has(normalized);
      }

      return (
        COMPLETED_GRADES.has(normalized) ||
        PASSING_WITHOUT_MIN_C.has(normalized)
      );
    };

    Promise.all([
      axios.get(`${API_BASE}/grades?student_id=${studentId}`),
      axios.get(`${API_BASE}/registrations/${studentId}`),
    ])
      .then(([gradesRes, regRes]) => {
        if (cancelled) return;

        const completed = new Set();
        const gradeMap = new Map();
        let earned = 0;

        const finalGrades = getFinalCourseGrades(gradesRes.data || []);

        finalGrades.forEach((g) => {
          const code = normalizeCourseCode(g.course_code);
          const grade = normalizeGrade(g.grade);

          if (code) {
            gradeMap.set(code, grade);
          }

          if (code && passesForCurriculum(code, grade)) {
            completed.add(code);

            const credits = Number(g.credits);
            if (!Number.isNaN(credits) && credits > 0) {
              earned += credits;
            }
          }
        });

        const inProgress = new Set();
        (regRes.data?.registrations || []).forEach((r) => {
          const code = normalizeCourseCode(r.course_code);
          if (code && !completed.has(code)) {
            inProgress.add(code);
          }
        });

        setCompletedCodes(completed);
        setInProgressCodes(inProgress);
        setGradesByCode(gradeMap);
        setGradeCreditsEarned(earned);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load graduation check data:", err);
        setError("Could not load your transcript or planned courses right now.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    studentId,
    effectiveCurriculumYear,
    profileCurriculumReady,
    curriculaVersion,
  ]);

  // Self-added elective/free-elective status rows — fetched separately and
  // best-effort. A failure here (e.g. the student_elective_courses table
  // hasn't been created in Supabase yet) only means those two groups show
  // Admin's pre-approved list read-only; it can no longer take down the
  // rest of the page.
  useEffect(() => {
    if (!studentId) return;
    fetchStudentElectiveCourses(studentId).then(setElectiveCourses);
  }, [studentId]);

  // A course already counted via the transcript (completedCodes) must not
  // be double-counted here just because the student also has a status row
  // for it (e.g. they confirmed a pre-approved course that's already on
  // their transcript) — only add credit for rows the transcript doesn't
  // already cover.
  const electiveCreditsEarned = useMemo(
    () =>
      electiveCourses
        .filter((c) => c.status === "completed" && !completedCodes.has(normalizeCourseCode(c.course_code)))
        .reduce((sum, c) => sum + (Number(c.credits) || 0), 0),
    [electiveCourses, completedCodes]
  );
  const creditsEarned = gradeCreditsEarned + electiveCreditsEarned;

  const findGradeForCourse = (courseCode) =>
    [...gradesByCode.entries()].find(([gradeCode]) =>
      courseMatchesRule(gradeCode, courseCode)
    )?.[1] || "—";

  const progress = useMemo(
    () =>
      evaluateCurriculumProgress(
        curriculum,
        completedCodes,
        inProgressCodes,
        gradesByCode
      ),
    [curriculum, completedCodes, inProgressCodes, gradesByCode]
  );

  // Once the student has chosen Group 1A or 1B on Goal and Career, hide the
  // other group's requirement block here too — every other block (General
  // Education, Major Courses, Free Elective, ...) is unaffected.
  const visibleBlocks = useMemo(
    () => filterBlocksForElectiveGroup(progress.blocks, electiveGroupId),
    [progress, electiveGroupId]
  );

  const totalRequired = curriculum?.totalCreditsRequired ?? null;
  const creditsLeft = totalRequired !== null ? Math.max(totalRequired - creditsEarned, 0) : null;

  // A saved/manual elective status must not overwrite a real transcript or
  // planner result. This keeps Min C + C-/D/F as Retake.
  const mergeRowsPreservingAcademicStatus = (block, groupKey) =>
    mergeElectiveGroupRows(block.courses, groupKey, electiveCourses).map((row) => {
      const academicRow = block.courses.find((course) =>
        courseMatchesRule(row.code, course.code)
      );

      if (
        academicRow &&
        ["completed", "in-progress", "re-grade"].includes(academicRow.status)
      ) {
        return { ...row, status: academicRow.status };
      }

      return row;
    });

  // --- Add-new-course form helpers ---------------------------------------
  // Just adds the course — no status to fill in here. It shows up as "Not
  // Taken" until the student sets its real status via the group's Edit
  // button below, same as every other row in the group.

  const getAddForm = (groupName) => addForms[groupName] || EMPTY_ADD_FORM;

  const patchAddForm = (groupName, patch) => {
    setAddForms((prev) => ({
      ...prev,
      [groupName]: { ...EMPTY_ADD_FORM, ...prev[groupName], ...patch },
    }));
  };

  const toggleAddForm = (groupName) => {
    patchAddForm(groupName, { open: !getAddForm(groupName).open, error: "" });
  };

  const submitAddForm = (groupName) => {
    const form = getAddForm(groupName);
    const code = normalizeCourseCode(form.code);
    const credits = Number(form.credits);

    if (!code) return patchAddForm(groupName, { error: "Enter a valid course code, e.g. CSX4202." });
    if (!Number.isFinite(credits) || credits <= 0) return patchAddForm(groupName, { error: "Enter a valid credit amount." });

    patchAddForm(groupName, { saving: true, error: "" });

    axios
      .post(`${API_BASE}/student-elective-courses`, {
        studentId,
        groupName,
        courseCode: code,
        courseName: form.name,
        credits,
        status: "not-taken",
      })
      .then((res) => {
        setElectiveCourses((prev) => [...prev.filter((c) => c.id !== res.data.course.id), res.data.course]);
        setAddForms((prev) => ({ ...prev, [groupName]: { ...EMPTY_ADD_FORM, open: false } }));
      })
      .catch((err) => {
        patchAddForm(groupName, {
          saving: false,
          error: err.response?.data?.error || "Could not add this course. Please try again.",
        });
      });
  };

  const deleteElectiveCourse = (row) => {
    axios
      .delete(`${API_BASE}/student-elective-courses/${row.id}?student_id=${studentId}`)
      .then(() => {
        setElectiveCourses((prev) => prev.filter((c) => c.id !== row.id));
      })
      .catch((err) => console.error("Failed to delete elective course:", err));
  };

  // --- Group-level Edit/Save toggle ---------------------------------------
  // One button per group (top-right of its block): "Edit" turns every row
  // in that group into a status dropdown; "Save" (shown in Edit's place
  // while editing) persists whatever was changed, then reverts to "Edit".

  const startEditingGroup = (groupName) => {
    setSaveErrors((prev) => ({ ...prev, [groupName]: "" }));
    setEditingGroups((prev) => new Set(prev).add(groupName));
  };

  const setDraftStatus = (groupName, code, status) => {
    setStatusDrafts((prev) => ({ ...prev, [rowKey(groupName, code)]: status }));
  };

  const saveEditingGroup = (groupName, rows) => {
    const changed = rows.filter((row) => {
      const draft = statusDrafts[rowKey(groupName, row.code)];
      return draft !== undefined && draft !== row.status;
    });

    const stopEditing = () => setEditingGroups((prev) => {
      const next = new Set(prev);
      next.delete(groupName);
      return next;
    });

    if (changed.length === 0) {
      stopEditing();
      return;
    }

    setSavingGroups((prev) => new Set(prev).add(groupName));
    setSaveErrors((prev) => ({ ...prev, [groupName]: "" }));

    Promise.all(
      changed.map((row) =>
        axios.post(`${API_BASE}/student-elective-courses`, {
          studentId,
          groupName,
          courseCode: row.code,
          courseName: row.name,
          credits: row.credits,
          status: statusDrafts[rowKey(groupName, row.code)],
        })
      )
    )
      .then((responses) => {
        const saved = responses.map((res) => res.data.course);
        setElectiveCourses((prev) => {
          const savedKeys = new Set(saved.map((c) => `${c.group_name}|${c.course_code}`));
          const kept = prev.filter((c) => !savedKeys.has(`${c.group_name}|${c.course_code}`));
          return [...kept, ...saved];
        });
        setStatusDrafts((prev) => {
          const next = { ...prev };
          changed.forEach((row) => delete next[rowKey(groupName, row.code)]);
          return next;
        });
        stopEditing();
      })
      .catch((err) => {
        setSaveErrors((prev) => ({
          ...prev,
          [groupName]: err.response?.data?.error || "Could not save — please try again.",
        }));
      })
      .finally(() => {
        setSavingGroups((prev) => {
          const next = new Set(prev);
          next.delete(groupName);
          return next;
        });
      });
  };

  const allSatisfied =
    visibleBlocks.length > 0 &&
    visibleBlocks.every((block) => {
      const groupKey = statusOverrideGroupKey(block);
      const rows = mergeRowsPreservingAcademicStatus(block, groupKey);
      return electiveGroupCreditsEarned(rows) >= (block.creditsRequired || 0);
    });

  return (
    <div className="gc-page">
      <div className="gc-header">
        <h1 className="gc-title">
          <GraduationCap size={22} strokeWidth={2} />
          Graduation Check
        </h1>
        {curriculum && <p className="gc-program-name">{curriculum.programName}</p>}
      </div>

      {loading && <p>Loading your progress...</p>}
      {error && <p className="gc-error">{error}</p>}

      {!loading && !curriculum && (
        <p className="gc-empty">
          No curriculum requirements are available for your batch yet — please check back once Admin uploads them.
        </p>
      )}

      {!loading && curriculum && (
        <>
          <div className="gc-summary-cards">
            <div className="gc-summary-card">
              <span className="gc-summary-label">Credits Earned</span>
              <span className="gc-summary-value">{creditsEarned}</span>
            </div>
            <div className="gc-summary-card">
              <span className="gc-summary-label">Total Credits Required</span>
              <span className="gc-summary-value">{totalRequired ?? "—"}</span>
            </div>
            <div className="gc-summary-card">
              <span className="gc-summary-label">Credits Left</span>
              <span className="gc-summary-value">{creditsLeft ?? "—"}</span>
            </div>
            <div className={`gc-summary-card gc-summary-status ${allSatisfied ? "gc-ready" : ""}`}>
              <span className="gc-summary-label">Requirement Groups Met</span>
              <span className="gc-summary-value">
                {visibleBlocks.filter((b) => b.satisfied).length}/{visibleBlocks.length}
              </span>
            </div>
          </div>

          <div className="gc-blocks">
            {visibleBlocks.map((block) => {
              // Every block's course status can now be overridden by the
              // student (Edit/Save toggle, top-right) — not just "choose"
              // blocks. Adding a brand-new course not on Admin's list (the
              // "Add Course" form) is still limited to "choose" blocks —
              // see canAddCourseToGroup.
              const groupKey = statusOverrideGroupKey(block);
              const canAdd = canAddCourseToGroup(block);
              const rows = mergeRowsPreservingAcademicStatus(block, groupKey);
              const form = getAddForm(groupKey);
              const isEditingGroup = editingGroups.has(groupKey);
              const isSavingGroup = savingGroups.has(groupKey);
              const groupSaveError = saveErrors[groupKey];

              // "A. General Education Courses" / "Core Courses" / "Major
              // Courses" always show their full course list, taken or
              // not — every other block (the four elective-taxonomy
              // groups: Major Elective 1A/1B, Other Major Elective, Free
              // Elective — see DEFAULT_COURSE_GROUPS in
              // utils/courseGroups.js, all of which contain "elective")
              // keeps the original completed-only view below. Matched on
              // group/label text rather than a fixed list of exact names
              // so it still works if Admin renames one of the three.
              const isFullListBlock = !/elective/i.test(`${block.group || ""} ${block.label || ""}`);

              // Normal view for the elective-taxonomy blocks: show only
              // finished courses. Retake stays visible because the
              // student already finished an attempt but still needs to
              // take the course again. Edit mode keeps every row visible
              // so the old Edit/Save function still works. The three
              // full-list blocks above always show every row regardless.
              const displayRows = isEditingGroup || isFullListBlock
                ? rows
                : rows.filter(
                    (r) =>
                      r.status === "completed" ||
                      r.status === "re-grade"
                  );

              const rowsCompletedCount = rows.filter((r) => r.status === "completed").length;
              const groupCreditsEarned = electiveGroupCreditsEarned(rows);
              const groupSatisfied = groupCreditsEarned >= (block.creditsRequired || 0);

              return (
                <div key={block.id} className="gc-block">
                  <div className="gc-block-head">
                    <div>
                      <strong>{block.label}</strong>
                      
                      {block.group &&
                        block.group.trim() !== block.label?.trim() && (
                            <span className="gc-block-group-tag">
                              {block.group}
                            </span>
                      )}
                    </div>
                    <div className="gc-block-head-right">
                      <span className={`gc-block-status ${groupSatisfied ? "gc-satisfied" : ""}`}>
                        {block.courses.length === 0
                          ? `${groupCreditsEarned}/${block.creditsRequired ?? "—"} credits`
                          : block.mode === "all"
                          ? `${rowsCompletedCount}/${block.courses.length} completed`
                          : `${rowsCompletedCount}/${block.chooseCount} chosen`}
                      </span>
                      {!readOnly &&
                        (!isEditingGroup ? (
                          <button
                            type="button"
                            className="gc-elective-group-edit"
                            onClick={() => startEditingGroup(groupKey)}
                          >
                            <Pencil size={14} strokeWidth={2} /> Edit
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="gc-elective-group-save"
                            onClick={() => saveEditingGroup(groupKey, rows)}
                            disabled={isSavingGroup}
                          >
                            <Save size={14} strokeWidth={2} /> {isSavingGroup ? "Saving..." : "Save"}
                          </button>
                        ))}
                    </div>
                  </div>

                  <div className="gc-elective-panel">
                    {displayRows.length > 0 ? (
                      <table className="gc-course-table">
                        <thead>
                          <tr>
                            <th>Course Code</th>
                            <th>Course Name</th>
                            <th>Credits</th>
                            <th>Grade</th>
                            <th>Status</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayRows.map((row) => {
                            const draftStatus = statusDrafts[rowKey(groupKey, row.code)] ?? row.status;
                            const meta = STATUS_META[draftStatus] || STATUS_META["not-taken"];
                            const Icon = meta.icon;
                            return (
                              <tr key={row.code}>
                                <td>{row.code}</td>
                                <td>{row.name || "—"}</td>
                                <td>{row.credits}</td>
                                <td>{findGradeForCourse(row.code)}</td>
                                <td className="gc-status-cell">
                                  {isEditingGroup ? (
                                    <select
                                      className="gc-status-select"
                                      value={draftStatus}
                                      disabled={isSavingGroup}
                                      onChange={(e) => setDraftStatus(groupKey, row.code, e.target.value)}
                                    >
                                      {STATUS_OPTIONS.map((s) => (
                                        <option key={s} value={s}>
                                          {STATUS_META[s].label}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className={`gc-status-content ${meta.className}`}>
                                      <Icon size={14} strokeWidth={2} />
                                      {meta.label}
                                    </span>
                                  )}
                                </td>
                                <td className="gc-elective-row-actions">
                                  {row.removable && !readOnly && (
                                    <button
                                      type="button"
                                      className="gc-elective-remove"
                                      onClick={() => deleteElectiveCourse(row)}
                                      aria-label={`Remove ${row.code}`}
                                    >
                                      <Trash2 size={14} strokeWidth={2} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <p className="gc-open-block">
                        {isFullListBlock ? "No courses listed for this requirement yet." : "No completed courses yet."}
                      </p>
                    )}

                    {groupSaveError && <p className="gc-error gc-elective-error">{groupSaveError}</p>}

                    {canAdd &&
                      !readOnly &&
                      (!form.open ? (
                        <button type="button" className="gc-elective-add-btn" onClick={() => toggleAddForm(groupKey)}>
                          <Plus size={14} strokeWidth={2} />
                          Add Course
                        </button>
                      ) : (
                        <div className="gc-elective-form">
                          <input
                            type="text"
                            placeholder="Course code (e.g. CSX4202)"
                            value={form.code}
                            onChange={(e) => patchAddForm(groupKey, { code: e.target.value })}
                          />
                          <input
                            type="text"
                            placeholder="Course name"
                            value={form.name}
                            onChange={(e) => patchAddForm(groupKey, { name: e.target.value })}
                          />
                          <input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="Credits"
                            value={form.credits}
                            onChange={(e) => patchAddForm(groupKey, { credits: e.target.value })}
                          />
                          <div className="gc-elective-form-actions">
                            <button
                              type="button"
                              className="gc-elective-save-btn"
                              disabled={form.saving}
                              onClick={() => submitAddForm(groupKey)}
                            >
                              {form.saving ? "Saving..." : "Save"}
                            </button>
                            <button type="button" className="gc-elective-cancel-btn" onClick={() => toggleAddForm(groupKey)}>
                              Cancel
                            </button>
                          </div>
                          {form.error && <p className="gc-error gc-elective-error">{form.error}</p>}
                        </div>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
export default StudentGraduationCheck;
