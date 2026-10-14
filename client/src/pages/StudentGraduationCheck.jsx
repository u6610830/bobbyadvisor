import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx-js-style";
import { GraduationCap, CheckCircle2, Clock, Circle, RotateCcw, Plus, Pencil, Save, Trash2, Download } from "lucide-react";
import { getCurriculumForStudent, getCurriculumGroups, syncCurriculaFromServer, subscribeCurricula } from "../utils/curriculum.js";
import { evaluateCurriculumProgress } from "../utils/curriculumProgress.js";
import { normalizeCourseCode } from "../utils/courseCode.js";
import {
  getFinalCourseGrades,
  getDashboardCourseStatus,
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
import UnsavedNotice from "../components/UnsavedNotice.jsx";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

const STATUS_META = {
  completed: { label: "Complete", icon: CheckCircle2, className: "gc-status-completed" },
  "in-progress": { label: "In Process", icon: Clock, className: "gc-status-inprogress" },
  "not-taken": { label: "Not Taken", icon: Circle, className: "gc-status-nottaken" },
  "re-grade": { label: "Re-grade", icon: RotateCcw, className: "gc-status-regrade" },
};

const DASHBOARD_STATUS_META = {
  Complete: STATUS_META.completed,
  "Register This Term": STATUS_META["in-progress"],
  "Not Taken": STATUS_META["not-taken"],
  Retake: STATUS_META["re-grade"],
  Retry: STATUS_META["re-grade"],
  Withdraw: STATUS_META["re-grade"],
  Incomplete: STATUS_META["in-progress"],
};

const STATUS_OPTIONS = ["completed", "in-progress", "not-taken", "re-grade"];

const EMPTY_ADD_FORM = { code: "", name: "", credits: "" };

function rowKey(groupName, code) {
  return `${groupName}::${code}`;
}

// readOnly: true hides every editing control (Add Course and per-row Delete)
// so this same component can be embedded
// read-only elsewhere — e.g. the Advisor's Student List detail view,
// showing one specific student's real progress from the database with no
// way to change it. Everything else (data fetching, per-student scoping)
// is identical to the student's own page.
function StudentGraduationCheck({ studentId, curriculumYear = null, readOnly = false }) {
  const [completedCodes, setCompletedCodes] = useState(new Set());
  const [inProgressCodes, setInProgressCodes] = useState(new Set());
  const [gradesByCode, setGradesByCode] = useState(new Map());
  const [courseStatuses, setCourseStatuses] = useState(new Map());
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
  const [editingGroups, setEditingGroups] = useState(new Set());
  const [statusDrafts, setStatusDrafts] = useState({});
  const [savingGroups, setSavingGroups] = useState(new Set());
  const [saveErrors, setSaveErrors] = useState({});
  const [savedNoMinCNotes, setSavedNoMinCNotes] = useState(new Set());

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

  // Transcript grades and planned courses feed graduation progress. The
  // displayed course status below is derived from transcript grades using
  // the same helper as Dashboard > Course status.
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

    const passesForCurriculum = (courseCode, grade) => {
      const normalized = normalizeGrade(grade);

      if (minGradeCRules.some((rule) => courseMatchesRule(courseCode, rule))) {
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
        const allGradesByCode = new Map();
        let earned = 0;

        (gradesRes.data || []).forEach((gradeRow) => {
          const code = normalizeCourseCode(gradeRow.course_code ?? gradeRow.code);
          if (!code) return;
          const entries = allGradesByCode.get(code) || [];
          entries.push(gradeRow.grade);
          allGradesByCode.set(code, entries);
        });

        const statusMap = new Map(
          [...allGradesByCode.entries()].map(([code, grades]) => [
            code,
            getDashboardCourseStatus(code, grades, minGradeCRules),
          ])
        );

        const finalGrades = getFinalCourseGrades(gradesRes.data || [], currentCurriculum);

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
        setCourseStatuses(statusMap);
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
        .filter((c) =>
          courseStatuses.get(normalizeCourseCode(c.course_code)) === "Complete" &&
          !completedCodes.has(normalizeCourseCode(c.course_code))
        )
        .reduce((sum, c) => sum + (Number(c.credits) || 0), 0),
    [electiveCourses, completedCodes, courseStatuses]
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

  // Status is calculated from transcript grades with the same rule used by
  // Dashboard > Course status until the student explicitly edits and saves it.
  const mergeGraduationRows = (block, groupKey) =>
    mergeElectiveGroupRows(block.courses, groupKey, electiveCourses).map((row) => {
      const matchedStatus = [...courseStatuses.entries()].find(([courseCode]) =>
        courseMatchesRule(courseCode, row.code)
      )?.[1] || "Not Taken";
      const calculatedStatus = matchedStatus === "Complete"
        ? "completed"
        : ["Retake", "Retry", "Withdraw"].includes(matchedStatus)
          ? "re-grade"
          : "not-taken";
      const requestedStatus = row.statusOverride ? row.status : calculatedStatus;
      const minCBlocksCompletion = row.minGradeC &&
        requestedStatus === "completed" &&
        matchedStatus !== "Complete";
      const rowStatus = minCBlocksCompletion ? calculatedStatus : requestedStatus;
      const courseStatus = !row.statusOverride || minCBlocksCompletion
        ? matchedStatus
        : rowStatus === "completed"
          ? "Complete"
          : rowStatus === "in-progress"
            ? "Register This Term"
            : rowStatus === "not-taken"
              ? "Not Taken"
              : row.minGradeC
                ? "Retake"
                : "Retry";
      return {
        ...row,
        courseStatus,
        transcriptStatus: matchedStatus,
        status: rowStatus,
      };
    });

  // --- Add-new-course form helpers ---------------------------------------
  // Just adds the course. Its displayed status is derived from transcript
  // grades after this row is added.

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

  const startEditingGroup = (groupName) => {
    setSaveErrors((prev) => ({ ...prev, [groupName]: "" }));
    setSavedNoMinCNotes((prev) => {
      const next = new Set(prev);
      next.delete(groupName);
      return next;
    });
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
    const showNoMinCNote = () => {
      if (!rows.some((row) => !row.minGradeC)) return;
      setSavedNoMinCNotes((prev) => new Set(prev).add(groupName));
    };
    const stopEditing = () => setEditingGroups((prev) => {
      const next = new Set(prev);
      next.delete(groupName);
      return next;
    });

    if (changed.length === 0) {
      showNoMinCNote();
      stopEditing();
      return;
    }

    setSavingGroups((prev) => new Set(prev).add(groupName));
    setSaveErrors((prev) => ({ ...prev, [groupName]: "" }));

    Promise.all(changed.map((row) =>
      axios.post(`${API_BASE}/student-elective-courses`, {
        studentId,
        groupName,
        courseCode: row.code,
        courseName: row.name,
        credits: row.credits,
        status: statusDrafts[rowKey(groupName, row.code)],
      })
    ))
      .then((responses) => {
        const saved = responses.map((res) => res.data.course);
        setElectiveCourses((prev) => {
          const savedKeys = new Set(saved.map((course) => `${course.group_name}|${course.course_code}`));
          return [...prev.filter((course) => !savedKeys.has(`${course.group_name}|${course.course_code}`)), ...saved];
        });
        setStatusDrafts((prev) => {
          const next = { ...prev };
          changed.forEach((row) => delete next[rowKey(groupName, row.code)]);
          return next;
        });
        if (changed.some((row) => !row.minGradeC)) showNoMinCNote();
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

  // Which rows a block shows outside edit mode — the three full-list blocks
  // (General Education / Core / Major) show every course; the elective
  // blocks show only finished ones (Completed or Retake). See the render
  // below for the full reasoning.
  const isFullListBlock = (block) => !/elective/i.test(`${block.group || ""} ${block.label || ""}`);
  const visibleRowsForBlock = (block, rows) =>
    isFullListBlock(block)
      ? rows
      : rows.filter((r) => r.status === "completed" || r.status === "re-grade");

  const blockStatusText = (block, rows) => {
    const rowsCompletedCount = rows.filter((r) => r.status === "completed").length;
    if (block.courses.length === 0) return `${electiveGroupCreditsEarned(rows)}/${block.creditsRequired ?? "—"} credits`;
    if (block.mode === "all") return `${rowsCompletedCount}/${block.courses.length} completed`;
    return `${rowsCompletedCount}/${block.chooseCount} chosen`;
  };

  // Download the same summary + per-group course tables shown on the page
  // as an .xlsx file. Summary lines are "Label : value"; group headings and
  // table headers are bold, and group headings get a light blue background.
  const downloadExcel = () => {
    const bold = { font: { bold: true } };
    const heading = { font: { bold: true }, fill: { patternType: "solid", fgColor: { rgb: "BDD7EE" } } };
    const aoa = [];
    const boldRows = [];
    const headingRows = [];
    const pushRow = (row, isBold = false) => {
      if (isBold) boldRows.push(aoa.length);
      aoa.push(row);
    };

    pushRow(["Graduation Check"], true);
    if (curriculum?.programName) pushRow([curriculum.programName]);
    if (studentId) pushRow([`Student ID : ${studentId}`]);
    pushRow([]);
    pushRow([`Credits Earned : ${creditsEarned}`]);
    pushRow([`Total Credits Required : ${totalRequired ?? "—"}`]);
    pushRow([`Credits Left : ${creditsLeft ?? "—"}`]);
    pushRow([`Requirement Groups Met : ${visibleBlocks.filter((b) => b.satisfied).length}/${visibleBlocks.length}`]);

    visibleBlocks.forEach((block) => {
      const rows = mergeGraduationRows(block, statusOverrideGroupKey(block));
      const exportRows = visibleRowsForBlock(block, rows);
      const headingText =
        block.group && block.group.trim() !== block.label?.trim()
          ? `${block.label} (${block.group})`
          : block.label;

      pushRow([]);
      headingRows.push(aoa.length);
      pushRow([headingText, "", "", "", blockStatusText(block, rows)], true);
      if (exportRows.length === 0) {
        pushRow([isFullListBlock(block) ? "No courses listed for this requirement yet." : "No completed courses yet."]);
        return;
      }
      pushRow(["Course Code", "Course Name", "Credits", "Grade", "Status"], true);
      exportRows.forEach((row) => {
        pushRow([
          row.code,
          row.name || "—",
          Number(row.credits) || row.credits || "",
          findGradeForCourse(row.code),
          (DASHBOARD_STATUS_META[row.courseStatus] || DASHBOARD_STATUS_META["Not Taken"]).label,
        ]);
      });
    });

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    boldRows.forEach((r) => {
      aoa[r].forEach((_, c) => {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.s = bold;
      });
    });
    headingRows.forEach((r) => {
      aoa[r].forEach((_, c) => {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.s = heading;
      });
    });
    sheet["!cols"] = [{ wch: 16 }, { wch: 45 }, { wch: 10 }, { wch: 10 }, { wch: 16 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Graduation Check");
    XLSX.writeFile(workbook, `graduation-check${studentId ? `-${studentId}` : ""}.xlsx`);
  };

  const allSatisfied =
    visibleBlocks.length > 0 &&
    visibleBlocks.every((block) => {
      const groupKey = statusOverrideGroupKey(block);
      const rows = mergeGraduationRows(block, groupKey);
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
          <div className="gc-download-row">
            <button type="button" className="gc-download-btn" onClick={downloadExcel}>
              <Download size={14} strokeWidth={2} /> Download Excel
            </button>
          </div>

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
              // Statuses are read from transcript grades with Dashboard's
              // Course status rules. Students can still add eligible courses.
              const groupKey = statusOverrideGroupKey(block);
              const canAdd = canAddCourseToGroup(block);
              const rows = mergeGraduationRows(block, groupKey);
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
              // The chosen Major Elective group (Admin's "choose one" blocks)
              // also lists every required course when all of its courses are
              // single codes; pools containing ranges (e.g. CSX4280-4299)
              // keep the completed-only view because a range is not one course.
              const isFixedChooseOneBlock =
                Boolean(block.chooseOneGroup) &&
                block.courses.length > 0 &&
                block.courses.every((c) => normalizeCourseCode(c.code));
              const isFullListBlock =
                !/elective/i.test(`${block.group || ""} ${block.label || ""}`) ||
                isFixedChooseOneBlock;

              // Elective blocks show completed/retake courses, plus all
              // Min C courses so their transcript status matches Dashboard.
              const displayRows = isEditingGroup || isFullListBlock
                ? rows
                : rows.filter(
                    (r) =>
                      r.status === "completed" ||
                      r.status === "re-grade" ||
                      r.minGradeC
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
                      {!readOnly && (!isEditingGroup ? (
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
                      {isEditingGroup && !isSavingGroup && <UnsavedNotice show text="Not saved yet — press Save." />}
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
                            const meta = DASHBOARD_STATUS_META[row.courseStatus] || STATUS_META["not-taken"];
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
                                      title={row.minGradeC ? "A minimum grade of C is required to mark this course completed." : undefined}
                                      onChange={(e) => setDraftStatus(groupKey, row.code, e.target.value)}
                                    >
                                      {STATUS_OPTIONS.map((status) => (
                                        <option
                                          key={status}
                                          value={status}
                                          disabled={row.minGradeC && status === "completed" && row.transcriptStatus !== "Complete"}
                                        >
                                          {STATUS_META[status].label}
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
                  {savedNoMinCNotes.has(groupKey) && (
                    <p className="gc-no-min-c-note">This course does not require a minimum grade of C.</p>
                  )}
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