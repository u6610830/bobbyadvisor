import { useState } from "react";
import "./EditableList.css";

function EditableList({
  items,
  suggestions = [],
  onAdd,
  onEdit,
  onDelete,
  placeholder = "Add new item",
  emptyMessage = "Nothing here yet.",
  renderLabel,
  showEdit = true,
}) {
  const [draft, setDraft] = useState("");
  const [editingIndex, setEditingIndex] = useState(null);
  const [editValue, setEditValue] = useState("");

  const filteredSuggestions = suggestions
    .filter((item) => {
      const search = draft.trim().toLowerCase();

      if (!search) return false;

      return (
        item.code?.toLowerCase().includes(search) ||
        item.name?.toLowerCase().includes(search)
      );
    })
    .filter(
      (item, index, arr) =>
        arr.findIndex((x) => x.code === item.code) === index
    )
    .slice(0, 8);

  const handleAdd = (e) => {
    e.preventDefault();

    const value = draft.trim();

    if (!value) return;

    onAdd(value);
    setDraft("");
  };

  const selectSuggestion = (item) => {
    setDraft(`${item.code} ${item.name || ""}`.trim());
  };

  const startEdit = (index, currentValue) => {
    setEditingIndex(index);
    setEditValue(currentValue);
  };

  const confirmEdit = (index) => {
    const value = editValue.trim();

    if (value) {
      onEdit(index, value);
    }

    setEditingIndex(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditValue("");
  };

  return (
    <div className="editable-list">
      {items.length === 0 && (
        <p className="editable-list-empty">{emptyMessage}</p>
      )}

      <ul>
        {items.map((item, index) => (
          <li key={index}>
            {editingIndex === index ? (
              <>
                <input
                  className="editable-list-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      confirmEdit(index);
                    }

                    if (e.key === "Escape") {
                      cancelEdit();
                    }
                  }}
                  autoFocus
                />

                <div className="editable-list-actions">
                  <button
                    type="button"
                    onClick={() => confirmEdit(index)}
                    className="save-btn"
                  >
                    Save
                  </button>

                  <button
                    type="button"
                    onClick={cancelEdit}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="editable-list-label">
                  {renderLabel ? renderLabel(item, index) : item}
                </span>

                <div className="editable-list-actions">
                  {showEdit && (
                    <button
                      type="button"
                      onClick={() => startEdit(index, item)}
                      className="edit-btn"
                    >
                      Edit
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onDelete(index)}
                    className="delete-btn"
                  >
                    X
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      <form className="editable-list-add" onSubmit={handleAdd}>
        <div className="editable-list-search">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
          />

          {filteredSuggestions.length > 0 && (
            <div className="editable-list-suggestions">
              {filteredSuggestions.map((item) => (
                <button
                  type="button"
                  key={`${item.code}-${item.name}`}
                  className="editable-list-suggestion"
                  onClick={() => selectSuggestion(item)}
                >
                  <strong>{item.code}</strong>
                  {item.name && <span>{item.name}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          aria-label="Add"
          className="add-btn"
        >
          Add
        </button>
      </form>
    </div>
  );
}

export default EditableList;