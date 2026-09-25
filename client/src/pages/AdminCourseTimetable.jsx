import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Plus, Trash2, X, Upload, Image as ImageIcon } from "lucide-react";
import { loadState, saveState } from "../utils/storage.js";
import {
  TIMETABLE_DAY_LABELS,
  TIMETABLE_TIME_START,
  TIMETABLE_TIME_END,
  TIMETABLE_TIME_LABELS,
  TIMETABLE_NOTE,
  DEFAULT_TIMETABLE_ENTRIES,
} from "../data/mockTimetable.js";
import "./AdminCourseTimetable.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");
const ENTRIES_KEY = "timetableEntries"; // localStorage cache/fallback if the DB is unreachable
const NOTE_KEY = "timetableNote";
const TITLE_KEY = "timetableTitle"; // heading read from the last uploaded file
const DEFAULT_TITLE = "CS & IT Course Timetable";
const TEMPLATE_KEY = "timetableTemplateImage"; // { fileName, dataUrl, isImage, uploadedAt } | null
const COLOR_OVERRIDES_KEY = "timetableColorOverrides";
const TIMETABLE_COLORS = ["#2563EB", "#7C3AED", "#DB2777", "#EA580C", "#16A34A", "#0891B2", "#CA8A04"];

function toMinutes(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const RANGE_START = toMinutes(TIMETABLE_TIME_START);
const RANGE_END = toMinutes(TIMETABLE_TIME_END);
const RANGE_SPAN = RANGE_END - RANGE_START;

function pctFromTime(hhmm) {
  const clamped = Math.min(Math.max(toMinutes(hhmm), RANGE_START), RANGE_END);
  return ((clamped - RANGE_START) / RANGE_SPAN) * 100;
}

// Lets the admin type an exact 24-hour value, such as 13:45.
function TimeInput({ label, value, onChange }) {
  return (
    <label className="tt-field">
      <span>{label}</span>
      <input
        className="tt-time-input"
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step="60"
        required
      />
    </label>
  );
}

function resolveDisplayColors(entries, overrides) {
  const colorById = {};
  const byDay = new Map();
  entries.forEach((entry) => {
    const dayEntries = byDay.get(entry.day) || [];
    dayEntries.push(entry);
    byDay.set(entry.day, dayEntries);
  });

  byDay.forEach((dayEntries) => {
    let previousColor = null;
    [...dayEntries]
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
      .forEach((entry, index) => {
        const preferred = overrides[String(entry.id)];
        const fallback = TIMETABLE_COLORS[(index + entry.day) % TIMETABLE_COLORS.length];
        const selected = preferred || fallback;
        colorById[entry.id] = selected === previousColor
          ? TIMETABLE_COLORS.find((color) => color !== previousColor)
          : selected;
        previousColor = colorById[entry.id];
      });
  });

  return entries.map((entry) => ({ ...entry, color: colorById[entry.id] || TIMETABLE_COLORS[0] }));
}

// ---- Stacking: real timetables (see the CS&IT Course Plan PDF) often
// have several classes running at the same time on the same day, in
// different sections. Overlapping entries get assigned to their own
// "lane" (greedily, sorted by start time) so they render side-by-side
// instead of hiding each other; the row grows tall enough to fit
// whichever day has the most simultaneous classes.
const LANE_HEIGHT = 64;
const ROW_PADDING = 10;

function layoutDayLanes(dayEntries) {
  const sorted = [...dayEntries].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const laneEndTimes = [];
  const placed = sorted.map((entry) => {
    const start = toMinutes(entry.start);
    let lane = laneEndTimes.findIndex((end) => end <= start);
    if (lane === -1) {
      lane = laneEndTimes.length;
      laneEndTimes.push(toMinutes(entry.end));
    } else {
      laneEndTimes[lane] = toMinutes(entry.end);
    }
    return { ...entry, lane };
  });
  return { placed, laneCount: Math.max(1, laneEndTimes.length) };
}

// ---- Extraction: converts Gemini's { day, code, name, section, start, end,
// incomplete, missingFields } classes into full timetable entries.
// Classes with a missing day/start/end are NOT silently dropped or
// guessed — they're routed to a separate review queue so the admin can
// fill in the gap themselves.
function splitExtractedClasses(classes) {
  const entries = [];
  const reviewItems = [];

  classes.forEach((cls) => {
    const dayIndex = TIMETABLE_DAY_LABELS.indexOf(String(cls.day || "").toUpperCase());
    const isComplete = !cls.incomplete && dayIndex !== -1 && cls.code && cls.start && cls.end;

    if (isComplete) {
      entries.push({
        id: makeId(),
        day: dayIndex,
        code: String(cls.code).trim(),
        name: cls.name ? String(cls.name).trim() : "",
        section: cls.section ? String(cls.section).trim() : "1",
        start: cls.start,
        end: cls.end,
      });
    } else if (cls.code) {
      // Keep whatever the model *could* read so the admin only has to
      // fill in the missing piece, not retype the whole class.
      reviewItems.push({
        reviewId: makeId(),
        code: String(cls.code).trim(),
        name: cls.name ? String(cls.name).trim() : "",
        section: cls.section ? String(cls.section).trim() : "1",
        day: dayIndex !== -1 ? dayIndex : null,
        start: cls.start || null,
        end: cls.end || null,
        missingFields: cls.missingFields?.length
          ? cls.missingFields
          : ["day", "start", "end"].filter(
              (f) => (f === "day" ? dayIndex === -1 : !cls[f])
            ),
      });
    }
    // A class with no code at all is unusable in either list — drop it.
  });

  return { entries, reviewItems };
}

const emptyDraft = (day = 0) => ({
  id: null,
  reviewId: null,
  day,
  code: "",
  name: "",
  section: "1",
  start: "09:00",
  end: "10:30",
  color: TIMETABLE_COLORS[0],
});

function AdminCourseTimetable() {
  const [entries, setEntries] = useState(() => loadState(ENTRIES_KEY, DEFAULT_TIMETABLE_ENTRIES));
  const [colorOverrides, setColorOverrides] = useState(() => loadState(COLOR_OVERRIDES_KEY, {}));
  const [note, setNote] = useState(() => loadState(NOTE_KEY, TIMETABLE_NOTE));
  const [title, setTitle] = useState(() => loadState(TITLE_KEY, ""));
  const [template, setTemplate] = useState(() => loadState(TEMPLATE_KEY, null));
  const [pendingFile, setPendingFile] = useState(null);
  const [uploadMessage, setUploadMessage] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dbStatus, setDbStatus] = useState("loading"); // "loading" | "connected" | "offline"
  const [reviewItems, setReviewItems] = useState([]); // classes with missing day/start/end from the last upload
  const [draft, setDraft] = useState(null); // entry being added/edited, or null
  const fileInputRef = useRef(null);

  // ---- Load from the database on mount; fall back to the local cache
  // (or the seed data) if the backend/DB isn't reachable, so the page
  // still works while offline or before supabase_timetable.sql is run.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [entriesRes, noteRes] = await Promise.all([
          axios.get(`${API_BASE}/timetable`),
          axios.get(`${API_BASE}/timetable-note`).catch(() => null),
        ]);
        if (cancelled) return;
        setEntries(entriesRes.data.entries?.length ? entriesRes.data.entries : DEFAULT_TIMETABLE_ENTRIES);
        if (noteRes?.data?.note) setNote(noteRes.data.note);
        if (noteRes?.data?.title) setTitle(noteRes.data.title);
        setDbStatus("connected");
      } catch (err) {
        console.warn("Timetable DB unreachable, using local cache:", err.message);
        if (!cancelled) setDbStatus("offline");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => saveState(ENTRIES_KEY, entries), [entries]);
  useEffect(() => saveState(COLOR_OVERRIDES_KEY, colorOverrides), [colorOverrides]);
  useEffect(() => saveState(NOTE_KEY, note), [note]);
  useEffect(() => saveState(TITLE_KEY, title), [title]);
  useEffect(() => saveState(TEMPLATE_KEY, template), [template]);

  const handleNoteBlur = () => {
    if (dbStatus !== "connected") return;
    axios.put(`${API_BASE}/timetable-note`, { note }).catch((err) =>
      console.warn("Failed to save note to database:", err.message)
    );
  };

  const displayEntries = useMemo(
    () => resolveDisplayColors(entries, colorOverrides),
    [entries, colorOverrides]
  );

  const dayLayouts = useMemo(() => {
    const byDay = TIMETABLE_DAY_LABELS.map(() => []);
    displayEntries.forEach((entry) => {
      if (byDay[entry.day]) byDay[entry.day].push(entry);
    });
    return byDay.map(layoutDayLanes);
  }, [displayEntries]);

  // ---- Image upload: choosing a new file replaces the reference image
  // shown above the grid, so admins always have the latest one to copy
  // into the editable table below.
  const handleFileChosen = (file) => {
    setPendingFile(file);
    setUploadMessage("");
  };

  const handleUpload = async () => {
    if (!pendingFile) {
      setUploadMessage("Please choose a file first.");
      return;
    }
    const isImage = pendingFile.type.startsWith("image/");

    const setTemplatePreview = (dataUrl) =>
      new Promise((resolve) => {
        setTemplate({
          fileName: pendingFile.name,
          dataUrl: dataUrl ?? null,
          isImage,
          uploadedAt: new Date().toISOString(),
        });
        resolve();
      });

    setIsExtracting(true);
    setUploadMessage("Reading file and updating the table…");

    // Show the reference preview right away.
    if (isImage) {
      await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          setTemplatePreview(reader.result);
          resolve();
        };
        reader.onerror = () => {
          setTemplatePreview(null);
          resolve();
        };
        reader.readAsDataURL(pendingFile);
      });
    } else {
      await setTemplatePreview(null);
    }

    // Ask the backend to read the file and turn it into table rows.
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);

      const response = await axios.post(
        `${API_BASE}/extract-timetable`,
        formData
      );

      const rawClasses = (response.data.classes || []).map((cls) => {
        // ✅ เปลี่ยนเป็น 13:30 เฉพาะเคสที่เป็นคาบบ่ายมาตรฐานที่เลิก 16:30 เท่านั้น
        if (cls.start === "13:00" && cls.end === "16:30") {
          return { ...cls, start: "13:30" };
        }
        return cls;
      });

      const { entries: extracted, reviewItems: needsReview } = splitExtractedClasses(rawClasses);
      const extractedTitle = String(response.data.title || "").trim();

      if (extracted.length === 0 && needsReview.length === 0) {
        setUploadMessage(
          "Uploaded, but no classes could be read from that file — you can add them manually below."
        );
      } else {
        // Persist the freshly-extracted set to the database in one go.
        let savedEntries = extracted;
        try {
          const importRes = await axios.post(`${API_BASE}/timetable/import`, {
            entries: extracted,
            title: extractedTitle,
          });
          savedEntries = importRes.data.entries?.length ? importRes.data.entries : extracted;
          setDbStatus("connected");
        } catch (err) {
          console.warn("Could not save extracted timetable to database:", err.message);
          setDbStatus("offline");
        }

        setEntries(savedEntries);
        setReviewItems(needsReview);
        if (extractedTitle) setTitle(extractedTitle);
        const parts = [];
        if (extracted.length > 0) {
          parts.push(`${extracted.length} class${extracted.length === 1 ? "" : "es"} updated`);
        }
        if (needsReview.length > 0) {
          parts.push(`${needsReview.length} need${needsReview.length === 1 ? "s" : ""} your review below`);
        }
        setUploadMessage(parts.join(", ") + ".");
      }
    } catch (error) {
      console.error("Timetable extraction failed:", error);
      setUploadMessage(
        error.response?.data?.error ||
          "Couldn't read that file automatically — you can still add classes manually below."
      );
    } finally {
      setIsExtracting(false);
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => setUploadMessage(""), 5000);
    }
  };

  // ---- Manual editing ----
  const openAddForm = (day = 0) => setDraft(emptyDraft(day));
  const openEditForm = (entry) => setDraft({ ...emptyDraft(entry.day), ...entry, reviewId: null });
  const openReviewForm = (item) =>
    setDraft({
      id: null,
      reviewId: item.reviewId,
      day: item.day ?? 0,
      code: item.code,
      name: item.name,
      section: item.section,
      start: item.start || "09:00",
      end: item.end || "10:30",
      color: TIMETABLE_COLORS[0],
    });
  const discardReviewItem = (reviewId) =>
    setReviewItems((prev) => prev.filter((r) => r.reviewId !== reviewId));
  const closeForm = () => setDraft(null);

  // Saves to the database (Edit class / Add class), then mirrors the
  // result into local state. Falls back to a local-only save (still
  // usable, just not synced) if the database call fails.
  const saveDraft = async () => {
    if (!draft.code.trim()) return;
    if (!draft.start || !draft.end || toMinutes(draft.end) <= toMinutes(draft.start)) return;

    setIsSaving(true);
    let saved = { ...draft };
    try {
      if (draft.id) {
        const res = await axios.put(`${API_BASE}/timetable/${draft.id}`, draft);
        saved = res.data.entry;
      } else {
        const res = await axios.post(`${API_BASE}/timetable`, draft);
        saved = res.data.entry;
      }
      setDbStatus("connected");
    } catch (err) {
      console.warn("Could not save class to database, keeping it local only:", err.message);
      setDbStatus("offline");
      if (!saved.id) saved.id = makeId();
    } finally {
      setIsSaving(false);
    }

    setEntries((prev) => {
      if (draft.id) {
        return prev.map((e) => (e.id === draft.id ? saved : e));
      }
      return [...prev, saved];
    });
    setColorOverrides((prev) => ({ ...prev, [String(saved.id)]: draft.color }));
    if (draft.reviewId) discardReviewItem(draft.reviewId);
    closeForm();
  };

  const deleteDraft = async () => {
    if (!draft?.id) return;
    const id = draft.id;
    closeForm();
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await axios.delete(`${API_BASE}/timetable/${id}`);
      setDbStatus("connected");
    } catch (err) {
      console.warn("Could not delete class from database:", err.message);
      setDbStatus("offline");
    }
  };

  return (
    <div className="timetable-page">
      <span className="timetable-title-pill">Course Timetable</span>

      {dbStatus === "offline" && (
        <p className="timetable-db-warning">
          Not connected to the database right now — changes are saved on this device only.
          Make sure the server is running and the <code>course_timetable</code> table exists in Supabase.
        </p>
      )}

      <div className="timetable-upload-card">
        <h3>Reference timetable image</h3>
        <p>
          Upload a schedule image or PDF any time — it replaces the
          reference below, and the editable grid underneath is
          automatically updated to match it. You can still add, edit, or
          delete classes there afterward.
        </p>

        <div className="timetable-upload-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
            disabled={isExtracting}
          />
          <button type="button" onClick={handleUpload} disabled={isExtracting}>
            <Upload size={15} /> {isExtracting ? "Reading…" : "Upload"}
          </button>
        </div>

        {pendingFile && (
          <p className="timetable-selected-file">
            <strong>Selected file:</strong> {pendingFile.name}
          </p>
        )}

        {uploadMessage && <p className="timetable-message">{uploadMessage}</p>}

        {!pendingFile && template && (
          <div className="timetable-template-preview">
            {template.isImage && template.dataUrl ? (
              <img src={template.dataUrl} alt={`Timetable reference: ${template.fileName}`} />
            ) : (
              <div className="timetable-template-file">
                <ImageIcon size={18} />
                <span>{template.fileName}</span>
              </div>
            )}
            <p className="timetable-current-file">
              Current template: <strong>{template.fileName}</strong>
            </p>
          </div>
        )}
      </div>

      {reviewItems.length > 0 && (
        <div className="timetable-review-card">
          <h3>Needs review ({reviewItems.length})</h3>
          <p>
            These classes were in the file but part of their info (day
            and/or time) wasn't readable — fill in the missing piece or
            discard them.
          </p>
          <ul className="timetable-review-list">
            {reviewItems.map((item) => (
              <li key={item.reviewId}>
                <span className="timetable-review-info">
                  <strong>{item.code}</strong>
                  {item.name && ` — ${item.name}`}
                  {item.section && ` (Sec. ${item.section})`}
                  <span className="timetable-review-missing">
                    Missing: {item.missingFields.join(", ")}
                  </span>
                </span>
                <span className="timetable-review-actions">
                  <button type="button" onClick={() => openReviewForm(item)}>
                    Fill in
                  </button>
                  <button
                    type="button"
                    className="timetable-review-discard"
                    onClick={() => discardReviewItem(item.reviewId)}
                  >
                    Discard
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="timetable-card">
        <div className="timetable-card-head">
          <h3>{title || DEFAULT_TITLE}</h3>
          <button type="button" className="timetable-add-btn" onClick={() => openAddForm(0)}>
            <Plus size={15} /> Add class
          </button>
        </div>

        <input
          className="timetable-note-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={handleNoteBlur}
          placeholder="Add a note (e.g. seat reservations)…"
        />

        <div className="tt-grid-scroll">
          <div className="tt-grid">
            <div className="tt-header">
              <div className="tt-label-col" />
              <div className="tt-time-track">
                {TIMETABLE_TIME_LABELS.map((label) => (
                  <span key={label} className="tt-time-label">
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {TIMETABLE_DAY_LABELS.map((dayLabel, dayIndex) => {
              const { placed, laneCount } = dayLayouts[dayIndex];
              const trackHeight = ROW_PADDING * 2 + laneCount * LANE_HEIGHT;
              return (
                <div className="tt-row" key={dayLabel} style={{ minHeight: `${trackHeight}px` }}>
                  <div className="tt-label-col">{dayLabel}</div>
                  <div
                    className="tt-day-track"
                    style={{ height: `${trackHeight}px` }}
                    onDoubleClick={() => openAddForm(dayIndex)}
                  >
                    {placed.map((entry) => {
                      const left = pctFromTime(entry.start);
                      const width = pctFromTime(entry.end) - left;
                      const top = ROW_PADDING + entry.lane * LANE_HEIGHT;
                      return (
                        <button
                          type="button"
                          key={entry.id}
                          className="tt-block"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            top: `${top}px`,
                            height: `${LANE_HEIGHT - 8}px`,
                            background: entry.color,
                          }}
                          onClick={() => openEditForm(entry)}
                          title="Click to edit"
                        >
                          <span className="tt-block-code">
                            {entry.code}
                            {entry.section ? ` Sec.${entry.section}` : ""}
                          </span>
                          {entry.name && <span className="tt-block-name">{entry.name}</span>}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="tt-row-add"
                      onClick={() => openAddForm(dayIndex)}
                      title={`Add a class on ${dayLabel}`}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <p className="timetable-hint">
          Click a class to edit it, use the + to add one to a row, or double-click anywhere on a row.
        </p>
      </div>

      {draft && (
        <div className="tt-modal-backdrop" onClick={closeForm}>
          <div className="tt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tt-modal-head">
              <h4>
                {draft.id ? "Edit class" : draft.reviewId ? "Complete class details" : "Add class"}
              </h4>
              <button type="button" className="tt-modal-close" onClick={closeForm}>
                <X size={18} />
              </button>
            </div>

            <label className="tt-field">
              <span>Day</span>
              <select
                value={draft.day}
                onChange={(e) => setDraft({ ...draft, day: Number(e.target.value) })}
              >
                {TIMETABLE_DAY_LABELS.map((label, i) => (
                  <option key={label} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="tt-field">
              <span>Course code</span>
              <input
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                placeholder="e.g. CSX3010"
              />
            </label>

            <label className="tt-field">
              <span>Course name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Data Structures and Algorithms"
              />
            </label>

            <label className="tt-field">
              <span>Sec</span>
              <input
                value={draft.section}
                onChange={(e) => setDraft({ ...draft, section: e.target.value })}
                placeholder="e.g. 1"
              />
            </label>

            <div className="tt-field-row">
              <TimeInput
                label="Start"
                value={draft.start}
                onChange={(val) => setDraft({ ...draft, start: val })}
              />
              <TimeInput
                label="End"
                value={draft.end}
                onChange={(val) => setDraft({ ...draft, end: val })}
              />
            </div>
            {toMinutes(draft.end) <= toMinutes(draft.start) && (
              <p className="tt-field-error">End time must be after start time.</p>
            )}

            <div className="tt-field">
              <span>Box color</span>
              <div className="tt-color-row" aria-label="Box color">
                {TIMETABLE_COLORS.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={`tt-color-swatch${draft.color === color ? " is-selected" : ""}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setDraft({ ...draft, color })}
                    aria-label={`Choose ${color}`}
                  />
                ))}
              </div>
              <small className="tt-color-help">Adjacent blocks are automatically given different colors.</small>
            </div>

            <div className="tt-modal-actions">
              {draft.id && (
                <button type="button" className="tt-btn-danger" onClick={deleteDraft}>
                  <Trash2 size={15} /> Delete
                </button>
              )}
              <div className="tt-modal-actions-right">
                <button type="button" className="tt-btn-ghost" onClick={closeForm}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="tt-btn-primary"
                  onClick={saveDraft}
                  disabled={!draft.code.trim() || !draft.start || !draft.end || toMinutes(draft.end) <= toMinutes(draft.start) || isSaving}
                >
                  {isSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminCourseTimetable;