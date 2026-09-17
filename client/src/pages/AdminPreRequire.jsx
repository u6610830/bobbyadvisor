import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Plus, Trash2, Save, RefreshCcw, UploadCloud, FileText } from "lucide-react";
import { PREREQ_GROUPS } from "../data/prereqGroups.js";
import "./AdminPreRequire.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

const BLANK_ROW = { course_code: "", course_title: "", g1_text: "", g2_text: "", g3_text: "" };

// ── CourseSearchInput ──────────────────────────────────────────────────────────
// Input with dropdown suggestions populated from the /courses Supabase table.
function CourseSearchInput({
  value,
  placeholder,
  allCourses,
  onSelect,
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const wrapRef = useRef(null);
  const isFocused = useRef(false);
  const justSelected = useRef(false);

  useEffect(() => {
    if (justSelected.current) {
      justSelected.current = false;
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const query = String(value || "")
      .trim()
      .toLowerCase();

    if (!query) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const filtered = allCourses
      .filter((course) => {
        const code = String(
          course.course_code || ""
        ).toLowerCase();

        const title = String(
          course.course_name ||
            course.course_title ||
            ""
        ).toLowerCase();

        return (
          code.includes(query) ||
          title.includes(query)
        );
      })
      .slice(0, 10);

    setSuggestions(filtered);

    // Only open when this input is currently selected.
    setOpen(
      isFocused.current &&
        filtered.length > 0
    );
  }, [value, allCourses]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (
        wrapRef.current &&
        !wrapRef.current.contains(event.target)
      ) {
        isFocused.current = false;
        setOpen(false);
      }
    };

    document.addEventListener(
      "mousedown",
      handleOutsideClick
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleOutsideClick
      );
    };
  }, []);

  const handleSelect = (course) => {
    justSelected.current = true;
    isFocused.current = false;

    onSelect(course);
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div
      className="prereq-search-wrap"
      ref={wrapRef}
    >
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => {
          isFocused.current = true;
          onChange(event.target.value);
        }}
        onFocus={() => {
          isFocused.current = true;

          if (suggestions.length > 0) {
            setOpen(true);
          }
        }}
        onBlur={() => {
          isFocused.current = false;
          setOpen(false);
        }}
      />

      {open && suggestions.length > 0 && (
        <ul className="prereq-search-dropdown">
          {suggestions.map((course) => (
            <li
              key={course.course_code}
              className="prereq-search-item"
              onMouseDown={(event) => {
                event.preventDefault();
                handleSelect(course);
              }}
            >
              <span className="prereq-search-code">
                {course.course_code}
              </span>

              <span className="prereq-search-name">
                {course.course_name ||
                  course.course_title ||
                  ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
// ── PrereqTextSuggest ──────────────────────────────────────────────────────────
// Textarea for the prerequisite text fields (g1/g2/g3).
// Search query = everything on the current line up to cursor,
// so multi-word phrases like "data sci" or "itx2007 data" work correctly.
function PrereqTextSuggest({ value, allCourses, onChange }) {
  const [open, setOpen]               = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [phraseStart, setPhraseStart] = useState(0);
  const wrapRef      = useRef(null);
  const taRef        = useRef(null);
  // Flag: skip re-opening dropdown when focus is restored after a selection
  const justSelected = useRef(false);

  // Returns { phrase, start } — phrase = text from last newline to cursorPos
  const getPhrase = (text, cursorPos) => {
    const before = text.slice(0, cursorPos);
    const lastNL = before.lastIndexOf("\n");
    const start  = lastNL + 1;
    const phrase = before.slice(start).trimStart();
    return { phrase, start: start + (before.slice(start).length - phrase.length) };
  };

  const runFilter = (phrase) => {
    const q = phrase.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    const words = q.split(/\s+/);
    return allCourses
      .filter((c) => {
        const code  = c.course_code?.toLowerCase()  || "";
        const title = c.course_title?.toLowerCase() || "";
        const combined = `${code} ${title}`;
        return words.every((w) => combined.includes(w));
      })
      .slice(0, 8);
  };

  const handleChange = (e) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    onChange(val);
    const { phrase, start } = getPhrase(val, pos);
    setPhraseStart(start);
    const filtered = runFilter(phrase);
    setSuggestions(filtered);
    setOpen(filtered.length > 0);
  };

  // Close when clicking outside
  useEffect(() => {
    const handleClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSelect = (course) => {
    const ta = taRef.current;
    if (!ta) return;
    const pos   = ta.selectionStart;
    const label = `${course.course_code}${course.course_title ? " " + course.course_title : ""}`;
    const before    = value.slice(0, phraseStart);
    const after     = value.slice(pos);
    const newBefore = before + label;
    // Close dropdown immediately
    justSelected.current = true;
    setOpen(false);
    setSuggestions([]);
    onChange(newBefore + after);
    // Restore cursor position (flag prevents onFocus from re-opening)
    setTimeout(() => {
      ta.focus();
      const newPos = newBefore.length;
      ta.setSelectionRange(newPos, newPos);
    }, 0);
  };

  return (
    <div className="prereq-search-wrap prereq-ta-wrap" ref={wrapRef}>
      <textarea
        ref={taRef}
        rows={2}
        value={value}
        onChange={handleChange}
        onFocus={(e) => {
          // Skip if we just selected a suggestion (focus was restored programmatically)
          if (justSelected.current) {
            justSelected.current = false;
            return;
          }
          const { phrase } = getPhrase(value, e.target.selectionStart);
          const filtered = runFilter(phrase);
          setSuggestions(filtered);
          if (filtered.length > 0) setOpen(true);
        }}
      />
      {open && (
        <ul className="prereq-search-dropdown">
          {suggestions.map((c) => (
            <li
              key={c.course_code}
              className="prereq-search-item"
              onMouseDown={() => handleSelect(c)}
            >
              <span className="prereq-search-code">{c.course_code}</span>
              <span className="prereq-search-name">{c.course_title || ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AdminPreRequire() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [allCourses, setAllCourses] = useState([]);

  // Upload-and-extract state
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // data URL, image files only
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const fileInputRef = useRef(null);

  const load = () => {
    setLoading(true);
    setError("");
    axios
      .get(`${API_BASE}/prerequisites`)
      .then((res) => setRows(res.data.prerequisites || []))
      .catch((err) => {
        console.error("Failed to load prerequisites:", err);
        setError(err.response?.data?.error || "Failed to load Pre-Require data.");
      })
      .finally(() => setLoading(false));
  };

  // Load the course list from Supabase (for Search Suggestions)
  useEffect(() => {
    axios
      .get(`${API_BASE}/courses`)
      .then((res) => setAllCourses(res.data.courses || []))
      .catch((err) => console.error("Failed to load courses for suggestions:", err));
  }, []);

  useEffect(load, []);

  const updateRow = (idx, field, value) => {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addRow = () => {
    setRows((prev) => [...prev, { ...BLANK_ROW, _new: true }]);
  };

  const removeRow = async (idx) => {
    const row = rows[idx];
    if (!row) return;

    if (row.id) {
      if (!window.confirm(`Delete row ${row.course_code}?`)) return;
      try {
        await axios.delete(`${API_BASE}/prerequisites/${row.id}`);
      } catch (err) {
        console.error("Failed to delete prerequisite row:", err);
        setError(err.response?.data?.error || "Failed to delete row.");
        return;
      }
    }

    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveRow = async (idx) => {
    const row = rows[idx];
    if (!row.course_code.trim()) {
      setError("Please enter a course code before saving.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (row.id) {
        const res = await axios.put(`${API_BASE}/prerequisites/${row.id}`, row);
        updateRow(idx, "id", res.data.prerequisite.id);
      } else {
        const res = await axios.post(`${API_BASE}/prerequisites`, row);
        setRows((prev) => {
          const next = [...prev];
          next[idx] = res.data.prerequisite;
          return next;
        });
      }
      setMessage(`Saved ${row.course_code}.`);
      setTimeout(() => setMessage(""), 2500);
    } catch (err) {
      console.error("Failed to save prerequisite row:", err);
      setError(err.response?.data?.error || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleFileChange = (e) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    setUploadMessage("");
    setPreview(null);

    if (chosen && chosen.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result);
      reader.readAsDataURL(chosen);
    }
  };

  // Upload -> Gemini reads the table -> bulk-save straight to Supabase
  // (this REPLACES the whole table, same as Admin > Course Timetable's
  // upload flow) -> reload so the rows below are editable right away.
  const handleUpload = async () => {
    if (!file) {
      setUploadMessage("Please choose an image or PDF file first.");
      return;
    }

    setUploading(true);
    setUploadMessage("Reading the file and saving to the database…");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const extractRes = await axios.post(`${API_BASE}/extract-prerequisites`, formData);
      const extractedRows = extractRes.data.rows || [];

      if (extractedRows.length === 0) {
        setUploadMessage("No course data found in the file. Try another file, or add courses manually below.");
        return;
      }

      const importRes = await axios.post(`${API_BASE}/prerequisites/import`, {
        rows: extractedRows,
      });

      setRows(importRes.data.prerequisites || []);
      setUploadMessage(
        `Saved ${extractedRows.length} course(s) — you can still edit/add/delete rows in the table below.`
      );
      setFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      console.error("Failed to upload/extract prerequisites:", err);
      setUploadMessage(
        err.response?.data?.error || "Failed to read the file. Try again, or add courses manually below."
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="prereq-admin-page">
      <div className="prereq-admin-header">
        <span className="admin-summary-title-pill">Pre-Require</span>
        <button type="button" className="prereq-admin-refresh" onClick={load}>
          <RefreshCcw size={15} strokeWidth={2} />
          <span>Refresh</span>
        </button>
      </div>

      <p className="prereq-admin-help">
        Set the Prerequisite for each course, separately for the 3 student batch groups — type it as free-form
        text, e.g. <code>CSX3002 Object-Oriented Concepts and Programming</code> or{" "}
        <code>Year 3 and &gt;= 72 credits</code>. The system automatically pulls out any course codes you type
        to check them when a student registers.
      </p>

      <div className="prereq-admin-upload-card">
        <h4>Upload Pre-Require Table (Image or PDF)</h4>
        <p>
          Upload an image or PDF of the Prerequisite table — the system will read it and save it to the
          database automatically. <strong>Uploading replaces the entire existing table.</strong> After saving,
          you can still edit/add/delete individual rows in the table below.
        </p>
        <div className="prereq-admin-upload-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,.pdf"
            onChange={handleFileChange}
            disabled={uploading}
          />
          <button
            type="button"
            className="prereq-admin-upload-btn"
            onClick={handleUpload}
            disabled={uploading || !file}
          >
            <UploadCloud size={15} strokeWidth={2} />
            <span>{uploading ? "Uploading…" : "Upload"}</span>
          </button>
        </div>
        {file && (
          <p className="prereq-admin-selected-file">
            <FileText size={14} strokeWidth={2} />
            <span>{file.name}</span>
          </p>
        )}
        {preview && (
          <img className="prereq-admin-preview" src={preview} alt="Uploaded prerequisite sheet preview" />
        )}
        {uploadMessage && <p className="prereq-admin-upload-message">{uploadMessage}</p>}
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className="prereq-admin-error">{error}</p>}
      {message && <p className="prereq-admin-message">{message}</p>}

      {!loading && (
        <div className="prereq-admin-table-wrap">
          <table className="prereq-admin-table">
            <thead>
              <tr>
                <th>Courses</th>
                <th>Title</th>
                {PREREQ_GROUPS.map((g) => (
                  <th key={g.id}>{g.label}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.id ?? `new-${idx}`}>
                  <td>
                    <CourseSearchInput
                      value={row.course_code}
                      field="course_code"
                      placeholder="CSX3009"
                      allCourses={allCourses}
                      onChange={(val) => updateRow(idx, "course_code", val)}
                      onSelect={(course) => {
                        updateRow(idx, "course_code", course.course_code || "");
                        updateRow(idx, "course_title", course.course_name || course.course_title || "");
                      }}
                    />
                  </td>
                  <td>
                    <CourseSearchInput
                      value={row.course_title}
                      field="course_title"
                      placeholder="Algorithm Design"
                      allCourses={allCourses}
                      onChange={(val) => updateRow(idx, "course_title", val)}
                      onSelect={(course) => {
                        updateRow(idx, "course_code", course.course_code || "");
                        updateRow(idx, "course_title", course.course_name || course.course_title || "");
                      }}
                    />
                  </td>
                  {["g1_text", "g2_text", "g3_text"].map((field) => (
                    <td key={field}>
                      <PrereqTextSuggest
                        value={row[field]}
                        allCourses={allCourses}
                        onChange={(val) => updateRow(idx, field, val)}
                      />
                    </td>
                  ))}
                  <td className="prereq-admin-row-actions">
                    <button
                      type="button"
                      className="prereq-admin-save"
                      onClick={() => handleSaveRow(idx)}
                      disabled={saving}
                      aria-label="Save row"
                    >
                      <Save size={15} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className="prereq-admin-delete"
                      onClick={() => removeRow(idx)}
                      aria-label="Delete row"
                    >
                      <Trash2 size={15} strokeWidth={2} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button type="button" className="prereq-admin-add" onClick={addRow}>
            <Plus size={16} strokeWidth={2} />
            <span>Add Course</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default AdminPreRequire;
