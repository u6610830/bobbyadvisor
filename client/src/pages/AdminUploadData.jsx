import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Plus, Trash2, Save, Upload, FileSpreadsheet, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import {
  getAllCurricula,
  saveCurriculum,
  deleteCurriculum,
  getCurriculumGroups,
  syncCurriculaFromServer,
} from "../utils/curriculum.js";
import { getCourseGroups, addCourseGroup } from "../utils/courseGroups.js";
import {
  readCurriculumWorkbook,
  listCurriculumSheets,
  parseCurriculumSheet,
  collectGroupNames,
} from "../utils/curriculumExcel.js";
import "./AdminUploadData.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

const BLANK_COURSE = {code: "",name: "",credits: 3,minGradeC: false};
function blankBlock() {
  return {
    id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: "",
    group: getCourseGroups()[0] || "",
    mode: "all",
    chooseCount: 0,
    creditsRequired: 0,
    courses: [],
    // Ticked when this group is one of a set of alternatives a student
    // must pick only one of (e.g. Major Elective Group 1A vs 1B) — see
    // utils/electiveGroup.js.
    chooseOneGroup: false,
    // Ticked when a student is allowed to add a brand-new course (not
    // already on the list below) to this group on Graduation Check — see
    // utils/studentElectiveCourses.js canAddCourseToGroup.
    allowAddCourse: false,
  };
}

// ── GroupSearchInput ────────────────────────────────────────────────────
// Free-text input with a "Search Suggestions" dropdown of known course
// groups (Admin's shared taxonomy, see utils/courseGroups.js) — same
// pattern as CourseSearchInput on the Admin Pre-Require page. Typing a
// name not in the list is still allowed (it becomes a new custom group
// the first time this block is saved), the list is suggestions only.
function GroupSearchInput({
  value,
  options,
  onChange,
  placeholder = "e.g. Major Elective Courses (Group 1B) - Informatics and Data Science",
  wrapClassName = "",
  inputClassName = "",
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const suggestions = options.filter((g) => g.toLowerCase().includes(value.trim().toLowerCase()));

  useEffect(() => {
    const handleClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className={`upload-data-search-wrap ${wrapClassName}`.trim()} ref={wrapRef}>
      <input
        type="text"
        className={inputClassName}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="upload-data-search-dropdown">
          {suggestions.map((g) => (
            <li
              key={g}
              className="upload-data-search-item"
              onMouseDown={() => {
                onChange(g);
                setOpen(false);
              }}
            >
              {g}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── CourseSearchInput ────────────────────────────────────────────────────
// Search Suggestions for a course table row's Course Code / Course Name
// cell, backed by the Courses database table (same /courses endpoint the
// Admin All Courses and Pre-Require pages already use) — pick a
// suggestion and both the code and name cells fill in together.
function CourseSearchInput({ value, allCourses, onChange, onSelect, placeholder = "CSX1001" }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const q = value.trim().toLowerCase();
  const suggestions = q
    ? allCourses
        .filter(
          (c) => c.course_code?.toLowerCase().includes(q) || c.course_title?.toLowerCase().includes(q)
        )
        .slice(0, 10)
    : [];

  useEffect(() => {
    const handleClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="upload-data-search-wrap" ref={wrapRef}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="upload-data-search-dropdown">
          {suggestions.map((c) => (
            <li
              key={c.course_code}
              className="upload-data-search-item"
              onMouseDown={() => {
                onSelect(c);
                setOpen(false);
              }}
            >
              <strong>{c.course_code}</strong>
              <span>{c.course_title || ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AdminUploadData() {
  const [curricula, setCurricula] = useState(getAllCurricula());
  const [selectedYear, setSelectedYear] = useState(Object.keys(getAllCurricula()).sort()[0] ?? "");
  const [message, setMessage] = useState("");
  const [courseGroups, setCourseGroups] = useState(getCourseGroups());
  const [saving, setSaving] = useState(false);
  const [allCourses, setAllCourses] = useState([]);

  // Load the course catalog once (for Course Code / Course Name Search
  // Suggestions below) — this is the same Supabase `courses` table Admin
  // manages on the All Courses page.
  useEffect(() => {
    axios
      .get(`${API_BASE}/courses`)
      .then((res) => setAllCourses(res.data.courses || []))
      .catch((err) => console.error("Failed to load courses for suggestions:", err));
  }, []);

  const refresh = () => setCurricula(getAllCurricula());

  // Curriculum requirements now live in the database — pull the latest on
  // mount so this page (and everything else reading utils/curriculum.js)
  // isn't stuck showing stale/local-only data.
  useEffect(() => {
    syncCurriculaFromServer().then(refresh);
  }, []);

  const current = selectedYear ? curricula[selectedYear] : null;

  const [draft, setDraft] = useState(
    current ? { ...current, groups: getCurriculumGroups(current) } : null
  );

  // Excel upload state
  const [workbook, setWorkbook] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [excelFileName, setExcelFileName] = useState("");
  const [excelError, setExcelError] = useState("");
  const [excelPreview, setExcelPreview] = useState(null); // { programName, totalCreditsRequired, groups }

  // Reordering the requirement-group boxes (drag-and-drop) — dragIndex is
  // the box currently being dragged, dragOverIndex the box it's hovering
  // over (for the drop-target highlight).
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const loadYear = (year) => {
    setSelectedYear(year);
    setDraft(curricula[year] ? { ...curricula[year], groups: getCurriculumGroups(curricula[year]) } : null);
    setMessage("");
    resetExcelState();
  };

  const resetExcelState = () => {
    setWorkbook(null);
    setSheetNames([]);
    setSelectedSheet("");
    setExcelFileName("");
    setExcelError("");
    setExcelPreview(null);
  };

  const startNewYear = () => {
    const year = window.prompt("Enter a new curriculum year, e.g. 2025");
    if (!year || !year.trim()) return;
    const y = year.trim();
    if (curricula[y]) {
      setMessage(`Curriculum requirements for ${y} already exist — please pick it from the list.`);
      return;
    }
    const blank = {
      year: y,
      programName: `B.Sc. Computer Science (Curriculum ${y})`,
      totalCreditsRequired: 130,
      minGpa: 2.0,
      groups: [],
    };
    setSelectedYear(y);
    setDraft(blank);
    setMessage("");
    resetExcelState();
  };

  const updateField = (field, value) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  // --- Block (requirement group) editing -----------------------------

  const updateBlock = (blockId, field, value) => {
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((b) => (b.id === blockId ? { ...b, [field]: value } : b)),
    }));
  };

  const addBlock = () => {
    setDraft((prev) => ({ ...prev, groups: [...prev.groups, blankBlock()] }));
  };

  const removeBlock = (blockId) => {
    setDraft((prev) => ({ ...prev, groups: prev.groups.filter((b) => b.id !== blockId) }));
  };

  // Reorders the requirement-group boxes by moving the box at fromIndex to
  // toIndex — used by both drag-and-drop and the ▲▼ buttons, so admin can
  // freely swap the display order the groups get saved and shown in.
  const moveBlock = (fromIndex, toIndex) => {
    setDraft((prev) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || toIndex >= prev.groups.length) return prev;
      const groups = [...prev.groups];
      const [moved] = groups.splice(fromIndex, 1);
      groups.splice(toIndex, 0, moved);
      return { ...prev, groups };
    });
  };

  const handleBlockDrop = (targetIndex) => {
    if (dragIndex !== null) moveBlock(dragIndex, targetIndex);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const updateBlockCourse = (blockId, idx, field, value) => {
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((b) => {
        if (b.id !== blockId) return b;
        const courses = [...b.courses];
        courses[idx] = { ...courses[idx], [field]: value };
        return { ...b, courses };
      }),
    }));
  };

  // Fills a course row's code/name (and credits, when the catalog has one)
  // from a Course Code / Course Name Search Suggestion pick in one go.
  const selectCourseForRow = (blockId, idx, course) => {
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((b) => {
        if (b.id !== blockId) return b;
        const courses = [...b.courses];
        const current = courses[idx];
        courses[idx] = {
          ...current,
          code: course.course_code || "",
          name: course.course_name || course.course_title || "",
          credits:
            course.credits !== null && course.credits !== undefined && course.credits !== ""
              ? course.credits
              : current.credits,
        };
        return { ...b, courses };
      }),
    }));
  };

  const addBlockCourseRow = (blockId) => {
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((b) => (b.id === blockId ? { ...b, courses: [...b.courses, { ...BLANK_COURSE }] } : b)),
    }));
  };

  const removeBlockCourseRow = (blockId, idx) => {
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((b) =>
        b.id === blockId ? { ...b, courses: b.courses.filter((_, i) => i !== idx) } : b
      ),
    }));
  };

  // --- Excel upload -----------------------------------------------------

  const handleExcelFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setExcelFileName(file.name);
    setExcelError("");
    setExcelPreview(null);

    try {
      const wb = await readCurriculumWorkbook(file);
      const sheets = listCurriculumSheets(wb);
      if (sheets.length === 0) {
        setExcelError("No usable sheet found in this file (only a \"Setting\" sheet was found).");
        return;
      }
      setWorkbook(wb);
      setSheetNames(sheets);
      setSelectedSheet(sheets[0]);
      parseSheet(wb, sheets[0]);
    } catch (err) {
      console.error(err);
      setExcelError("Could not read this file. Please check it is a valid .xlsx file matching the Graduation Checklist template.");
    }
  };

  const parseSheet = (wb, sheetName) => {
    try {
      const parsed = parseCurriculumSheet(wb, sheetName);
      setExcelPreview(parsed);
      setExcelError("");
    } catch (err) {
      console.error(err);
      setExcelError(err.message || "Could not parse this sheet.");
      setExcelPreview(null);
    }
  };

  const handleSheetChange = (sheetName) => {
    setSelectedSheet(sheetName);
    if (workbook) parseSheet(workbook, sheetName);
  };

  const applyExcelPreview = () => {
    if (!excelPreview || !draft) return;

    // Any group name the sheet used that Admin hasn't seen before gets
    // added to the shared taxonomy automatically.
    const newGroupNames = collectGroupNames(excelPreview.groups);
    let groups = courseGroups;
    newGroupNames.forEach((name) => {
      groups = addCourseGroup(name);
    });
    setCourseGroups(groups);

    setDraft((prev) => ({
      ...prev,
      programName: excelPreview.programName || prev.programName,
      totalCreditsRequired: excelPreview.totalCreditsRequired ?? prev.totalCreditsRequired,
      groups: excelPreview.groups.map((g) => ({ ...g, id: `${g.id}-${Date.now()}` })),
    }));
    setMessage("Excel data applied to this curriculum draft — review it below, then click Save.");
    resetExcelState();
  };

  const handleSave = async () => {
    if (!draft?.year) {
      setMessage("Please enter a curriculum year before saving.");
      return;
    }
    const cleanedGroups = draft.groups.map((block) => ({
      ...block,
      label: block.label.trim(),
      group: block.group.trim(),
      courses: block.courses
        .map((c) => ({
          code: c.code.trim().toUpperCase(),
          name: c.name.trim(),
          credits: Number(c.credits) || 0,
          minGradeC: Boolean(c.minGradeC),
        }))
        .filter((c) => c.code),
      chooseCount: Number(block.chooseCount) || 0,
      creditsRequired: Number(block.creditsRequired) || 0,
    }));

    // A group name the admin typed by hand (not picked from suggestions)
    // still joins the shared taxonomy, same as the Excel-import path.
    let groups = courseGroups;
    cleanedGroups.forEach((block) => {
      if (block.group) groups = addCourseGroup(block.group);
    });
    setCourseGroups(groups);

    setSaving(true);
    try {
      await saveCurriculum(draft.year, {
        programName: draft.programName,
        totalCreditsRequired: Number(draft.totalCreditsRequired) || 0,
        minGpa: Number(draft.minGpa) || 0,
        groups: cleanedGroups,
      });
      refresh();
      setMessage(`Saved curriculum requirements for ${draft.year}.`);
    } catch (err) {
      console.error("Failed to save curriculum to database:", err);
      setMessage(`Could not save to the database: ${err.response?.data?.error || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (year) => {
    if (!window.confirm(`Delete the curriculum requirements for ${year} that Admin uploaded? (Built-in default requirements will not be deleted.)`)) return;
    try {
      await deleteCurriculum(year);
      refresh();
      if (selectedYear === year) {
        setSelectedYear("");
        setDraft(null);
      }
    } catch (err) {
      console.error("Failed to delete curriculum from database:", err);
      setMessage(`Could not delete from the database: ${err.response?.data?.error || err.message}`);
    }
  };

  const years = Object.keys(curricula).sort();

  return (
    <div className="upload-data-page">
      <span className="admin-summary-title-pill">Upload Table Data</span>

      <div className="upload-data-layout">
        <div className="upload-data-sidebar">
          <h4>Curriculum Table / Graduation Requirements</h4>
          <ul className="upload-data-year-list">
            {years.map((year) => (
              <li key={year}>
                <button
                  type="button"
                  className={year === selectedYear ? "active" : ""}
                  onClick={() => loadYear(year)}
                >
                  Year {year}
                </button>
                <button type="button" className="upload-data-delete" onClick={() => handleDelete(year)} aria-label={`Delete ${year}`}>
                  <Trash2 size={15} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="upload-data-add-year" onClick={startNewYear}>
            <Plus size={16} strokeWidth={2} />
            <span>Add New Curriculum Year</span>
          </button>
        </div>

        <div className="upload-data-editor">
          {!draft ? (
            <p className="upload-data-empty">Choose a curriculum year on the left, or click &ldquo;Add New Curriculum Year&rdquo; to get started.</p>
          ) : (
            <>
              <div className="upload-data-excel-box">
                <h4 className="upload-data-courses-title">Upload Excel (Graduation Checklist)</h4>
                <p className="upload-data-excel-hint">
                  Upload the university&apos;s Graduation Checklist .xlsx file — Program Name, Total Credits
                  Required, and every requirement group/course below will be filled in automatically. Review
                  and adjust before saving.
                </p>
                <label className="upload-data-excel-input">
                  <Upload size={16} strokeWidth={2} />
                  <span>{excelFileName || "Choose .xlsx file"}</span>
                  <input type="file" accept=".xlsx,.xls" onChange={handleExcelFile} hidden />
                </label>

                {excelError && <p className="upload-data-excel-error">{excelError}</p>}

                {sheetNames.length > 1 && (
                  <div className="upload-data-form-row">
                    <label>Concentration / Sheet</label>
                    <select value={selectedSheet} onChange={(e) => handleSheetChange(e.target.value)}>
                      {sheetNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {excelPreview && (
                  <div className="upload-data-excel-preview">
                    <p>
                      <FileSpreadsheet size={15} strokeWidth={2} />
                      <strong>{excelPreview.programName}</strong> — Total Credits Required:{" "}
                      {excelPreview.totalCreditsRequired} — {excelPreview.groups.length} requirement group(s) found
                    </p>
                    <ul>
                      {excelPreview.groups.map((g) => (
                        <li key={g.id}>
                          {g.label} — <em>{g.group}</em> — {g.mode === "all" ? `all ${g.courses.length} required` : `choose ${g.chooseCount} of ${g.courses.length}`} ({g.creditsRequired} credits)
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="upload-data-save" onClick={applyExcelPreview}>
                      <Upload size={16} strokeWidth={2} />
                      <span>Apply to Draft Below</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="upload-data-form-row">
                <label>Program Name</label>
                <input
                  type="text"
                  value={draft.programName}
                  onChange={(e) => updateField("programName", e.target.value)}
                />
              </div>

              <div className="upload-data-form-grid">
                <div className="upload-data-form-row">
                  <label>Total Credits Required</label>
                  <input
                    type="number"
                    min="0"
                    value={draft.totalCreditsRequired}
                    onChange={(e) => updateField("totalCreditsRequired", e.target.value)}
                  />
                </div>
                <div className="upload-data-form-row">
                  <label>Minimum GPA</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="4"
                    value={draft.minGpa}
                    onChange={(e) => updateField("minGpa", e.target.value)}
                  />
                </div>
              </div>

              <h4 className="upload-data-courses-title">Required Courses (by Group)</h4>

              {draft.groups.map((block, index) => (
                <div
                  className={`upload-data-block${dragIndex === index ? " upload-data-block-dragging" : ""}${dragOverIndex === index && dragIndex !== index ? " upload-data-block-drop-target" : ""}`}
                  key={block.id}
                  onDragOver={(e) => {
                    if (dragIndex === null) return;
                    e.preventDefault();
                    if (dragOverIndex !== index) setDragOverIndex(index);
                  }}
                  onDragLeave={() => setDragOverIndex((prev) => (prev === index ? null : prev))}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleBlockDrop(index);
                  }}
                >
                  <div className="upload-data-block-head">
                    <button
                      type="button"
                      className="upload-data-drag-handle"
                      draggable
                      onDragStart={(e) => {
                        setDragIndex(index);
                        e.dataTransfer.effectAllowed = "move";
                        // Firefox requires setData for drag to start at all.
                        e.dataTransfer.setData("text/plain", block.id);
                      }}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setDragOverIndex(null);
                      }}
                      aria-label="Drag to reorder this group"
                      title="Drag to reorder"
                    >
                      <GripVertical size={16} strokeWidth={2} />
                    </button>
                    <div className="upload-data-block-reorder-btns">
                      <button
                        type="button"
                        onClick={() => moveBlock(index, index - 1)}
                        disabled={index === 0}
                        aria-label="Move group up"
                        title="Move up"
                      >
                        <ChevronUp size={15} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveBlock(index, index + 1)}
                        disabled={index === draft.groups.length - 1}
                        aria-label="Move group down"
                        title="Move down"
                      >
                        <ChevronDown size={15} strokeWidth={2} />
                      </button>
                    </div>
                    <GroupSearchInput
                      value={block.label}
                      options={courseGroups}
                      onChange={(value) => updateBlock(block.id, "label", value)}
                      placeholder="e.g. Major Elective Courses (Group 1A)"
                      wrapClassName="upload-data-block-label-wrap"
                      inputClassName="upload-data-block-label"
                    />
                    <button type="button" className="upload-data-delete" onClick={() => removeBlock(block.id)} aria-label="Remove group">
                      <Trash2 size={15} strokeWidth={2} />
                    </button>
                  </div>

                  <div className="upload-data-block-fields">
                    <label>
                      Course Group
                      <GroupSearchInput
                        value={block.group}
                        options={courseGroups}
                        onChange={(value) => updateBlock(block.id, "group", value)}
                      />
                    </label>

                    <label>
                      Selection
                      <select value={block.mode} onChange={(e) => updateBlock(block.id, "mode", e.target.value)}>
                        <option value="all">Must take all</option>
                        <option value="choose">Choose N of these</option>
                      </select>
                    </label>

                    {block.mode === "choose" && (
                      <label>
                        Choose how many
                        <input
                          type="number"
                          min="0"
                          value={block.chooseCount}
                          onChange={(e) => updateBlock(block.id, "chooseCount", e.target.value)}
                        />
                      </label>
                    )}

                    <label>
                      Credits Required (this group)
                      <input
                        type="number"
                        min="0"
                        value={block.creditsRequired}
                        onChange={(e) => updateBlock(block.id, "creditsRequired", e.target.value)}
                      />
                    </label>
                  </div>

                  <label className="upload-data-choose-one-field">
                    <input
                      type="checkbox"
                      checked={Boolean(block.chooseOneGroup)}
                      onChange={(e) => updateBlock(block.id, "chooseOneGroup", e.target.checked)}
                    />
                    Student picks only one group from this set (e.g. Group 1A vs 1B)
                  </label>

                  <label className="upload-data-choose-one-field">
                    <input
                      type="checkbox"
                      checked={Boolean(block.allowAddCourse)}
                      onChange={(e) => updateBlock(block.id, "allowAddCourse", e.target.checked)}
                    />
                    Student can add subject (student can add their own course to this group)
                  </label>

                  <table className="upload-data-table">
                    <thead>
                      <tr>
                        <th>Course Code</th>
                        <th>Course Name</th>
                        <th>Credits</th>
                        <th>Min C</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {block.courses.map((course, idx) => (
                        <tr key={idx}>
                          <td>
                            <CourseSearchInput
                              value={course.code}
                              allCourses={allCourses}
                              onChange={(val) => updateBlockCourse(block.id, idx, "code", val)}
                              onSelect={(c) => selectCourseForRow(block.id, idx, c)}
                              placeholder="CSX1001"
                            />
                          </td>
                          <td>
                            <CourseSearchInput
                              value={course.name}
                              allCourses={allCourses}
                              onChange={(val) => updateBlockCourse(block.id, idx, "name", val)}
                              onSelect={(c) => selectCourseForRow(block.id, idx, c)}
                              placeholder="Introduction to Programming"
                            />
                          </td>
                          <td className="upload-data-credits-cell">
                            <input
                              type="number"
                              min="0"
                              value={course.credits}
                              onChange={(e) => updateBlockCourse(block.id, idx, "credits", e.target.value)}
                            />
                          </td>
                          <td className="upload-data-mingrade-cell">
                            <input
                              type="checkbox"
                              checked={Boolean(course.minGradeC)}
                              onChange={(e) =>
                                updateBlockCourse(block.id, idx, "minGradeC", e.target.checked)
                              }
                              aria-label={`Require minimum grade C for ${course.code || "this course"}`}
                            />
                          </td>
                          <td>
                            <button type="button" className="upload-data-delete" onClick={() => removeBlockCourseRow(block.id, idx)} aria-label="Remove course">
                              <Trash2 size={15} strokeWidth={2} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <button type="button" className="upload-data-add-course" onClick={() => addBlockCourseRow(block.id)}>
                    <Plus size={16} strokeWidth={2} />
                    <span>Add Course</span>
                  </button>
                </div>
              ))}

              <button type="button" className="upload-data-add-course" onClick={addBlock}>
                <Plus size={16} strokeWidth={2} />
                <span>Add Requirement Group</span>
              </button>

              {message && <p className="upload-data-message">{message}</p>}

              <button type="button" className="upload-data-save" onClick={handleSave} disabled={saving}>
                <Save size={16} strokeWidth={2} />
                <span>{saving ? "Saving…" : "Save"}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminUploadData;
