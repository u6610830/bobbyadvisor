import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, RefreshCcw, Save, X, Settings } from "lucide-react";
import { getCourseGroups, addCourseGroup, renameCourseGroup, deleteCourseGroup } from "../utils/courseGroups.js";
import "./AdminCourses.css";

const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

const EMPTY_COURSE = {
  course_code: "",
  course_title: "",
  credits: "",
  description: "",
  course_group: "",
};

function AdminCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingCode, setEditingCode] = useState(null);
  const [form, setForm] = useState(EMPTY_COURSE);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [courseGroups, setCourseGroups] = useState(getCourseGroups());
  const [showGroupManager, setShowGroupManager] = useState(false);

  const loadCourses = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await axios.get(`${API_BASE}/courses`);

      setCourses(
        Array.isArray(response.data?.courses)
          ? response.data.courses
          : []
      );
    } catch (err) {
      console.error("Failed to load courses:", err);

      setError(
        err.response?.data?.error ||
          "Failed to load courses."
      );

      setCourses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCourses();
  }, []);

  const startEdit = (course) => {
    setEditingCode(course.course_code);
    setShowAdd(false);

    setForm({
      course_code: course.course_code || "",
      course_title: course.course_title || "",
      credits: course.credits ?? "",
      description: course.description || "",
      course_group: course.course_group || "",
    });
  };

  const cancelEdit = () => {
    setEditingCode(null);
    setShowAdd(false);
    setForm(EMPTY_COURSE);
  };

  const saveEdit = async () => {
    try {
      setSaving(true);
      setError("");

      if (showAdd) {
        await axios.post(
          `${API_BASE}/courses`,
          form
        );
      } else {
        await axios.put(
          `${API_BASE}/courses/${encodeURIComponent(
            form.course_code
          )}`,
          form
        );
      }

      await loadCourses();
      cancelEdit();
    } catch (err) {
      console.error(
        "Failed to save course:",
        err
      );

      setError(
        err.response?.data?.error ||
          "Failed to save course."
      );
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => {
    setShowAdd(true);
    setEditingCode(null);
    setForm(EMPTY_COURSE);
  };

  const handleAddGroup = () => {
    const name = window.prompt("New course group name, e.g. \"Major Elective\"");
    if (!name || !name.trim()) return;
    setCourseGroups(addCourseGroup(name));
  };

  const handleRenameGroup = (group) => {
    const name = window.prompt(`Rename course group "${group}" to:`, group);
    if (!name || !name.trim() || name.trim() === group) return;
    setCourseGroups(renameCourseGroup(group, name));
    // Keep the form in sync if the group being renamed is currently selected.
    setForm((prev) => (prev.course_group === group ? { ...prev, course_group: name.trim() } : prev));
  };

  const handleDeleteGroup = (group) => {
    if (!window.confirm(`Delete the course group "${group}"? Courses already tagged with it will keep the old value until re-saved.`)) return;
    setCourseGroups(deleteCourseGroup(group));
  };

  return (
    <div className="admin-courses-page">
      <div className="admin-courses-header">
        <div>
          <span className="admin-summary-title-pill">
            All Courses
          </span>

          <p className="admin-courses-help">
            View every course known by the system and add or edit the
            course description students will see.
          </p>
        </div>

        <div className="admin-courses-actions">
          <button
            type="button"
            onClick={() => setShowGroupManager((v) => !v)}
          >
            <Settings size={15} />
            Manage Groups
          </button>

          <button
            type="button"
            onClick={loadCourses}
            disabled={loading}
          >
            <RefreshCcw size={15} />
            {loading
              ? "Loading..."
              : "Refresh"}
          </button>

          <button
            type="button"
            className="admin-courses-primary"
            onClick={openAdd}
          >
            <Plus size={16} />
            Add Course
          </button>
        </div>
      </div>

      {showGroupManager && (
        <div className="admin-course-group-manager">
          <h4>Course Groups</h4>
          <ul>
            {courseGroups.map((group) => (
              <li key={group}>
                <span>{group}</span>
                <div className="admin-course-group-manager-actions">
                  <button type="button" onClick={() => handleRenameGroup(group)}>
                    Rename
                  </button>
                  <button type="button" onClick={() => handleDeleteGroup(group)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" onClick={handleAddGroup}>
            <Plus size={14} />
            Add Group
          </button>
        </div>
      )}

      {error && (
        <div className="admin-courses-error">
          {error}
        </div>
      )}

      {(showAdd || editingCode) && (
        <div className="admin-course-editor">
          <div className="admin-course-editor-head">
            <h3>
              {showAdd
                ? "Add Course"
                : `Edit ${editingCode}`}
            </h3>

            <button
              type="button"
              className="icon-only"
              onClick={cancelEdit}
            >
              <X size={18} />
            </button>
          </div>

          <div className="admin-course-form-grid">
            <label>
              Course Code

              <input
                value={form.course_code}
                disabled={!showAdd}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    course_code:
                      e.target.value,
                  }))
                }
                placeholder="CSX4201"
              />
            </label>

            <label>
              Course Title

              <input
                value={form.course_title}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    course_title:
                      e.target.value,
                  }))
                }
                placeholder="Artificial Intelligence Concepts"
              />
            </label>

            <label>
              Credits

              <input
                type="number"
                min="0"
                step="0.5"
                value={form.credits}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    credits:
                      e.target.value,
                  }))
                }
                placeholder="3"
              />
            </label>

            <label>
              Course

              <select
                value={form.course_group}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    course_group: e.target.value,
                  }))
                }
              >
                <option value="">— Select group —</option>
                {courseGroups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-course-description-field">
              Course Description

              <textarea
                rows="5"
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    description:
                      e.target.value,
                  }))
                }
                placeholder="Enter Course Description Here...."
              />
            </label>
          </div>

          <div className="admin-course-editor-actions">
            <button
              type="button"
              onClick={cancelEdit}
            >
              Cancel
            </button>

            <button
              type="button"
              className="admin-courses-primary"
              onClick={saveEdit}
              disabled={
                saving ||
                !form.course_code.trim()
              }
            >
              <Save size={16} />
              {saving
                ? "Saving..."
                : "Save"}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <p>Loading courses...</p>
      )}

      {!loading &&
        courses.length === 0 &&
        !error && (
          <div className="admin-courses-empty">
            No courses found yet.
          </div>
        )}

      {!loading &&
        courses.length > 0 && (
          <div className="admin-courses-table-wrap">
            <table className="admin-courses-table">
              <thead>
                <tr>
                  <th>Course Code</th>
                  <th>Course Title</th>
                  <th>Credits</th>
                  <th>Course</th>
                  <th>Description</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {courses.map((course) => (
                  <tr key={course.course_code}>
                    <td>
                      <strong>
                        {course.course_code}
                      </strong>
                    </td>

                    <td>
                      {course.course_title ||
                        "—"}
                    </td>

                    <td>
                      {course.credits ?? "—"}
                    </td>

                    <td>
                      {course.course_group || "—"}
                    </td>

                    <td className="admin-course-description-cell">
                      {course.description ||
                        "No description yet."}
                    </td>

                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          startEdit(course)
                        }
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

export default AdminCourses;
