import { useState } from "react";
import { Check, Plus } from "lucide-react";
import "./MultiChoice.css";

const MAX_CHOICES = 20;

const clean = (value) =>
  String(value || "").trim().replace(/\s+/g, " ").slice(0, 200);

const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

function MultiChoice({ options = [], value = [], onChange, disabled = false }) {
  const [customChoice, setCustomChoice] = useState("");
  const selected = Array.isArray(value) ? value : [];

  const visibleOptions = [...options];

  selected.forEach((item) => {
    if (!visibleOptions.some((option) => same(option, item))) {
      visibleOptions.push(item);
    }
  });

  const toggleChoice = (option) => {
    if (disabled) return;

    const exists = selected.some((item) => same(item, option));

    if (exists) {
      onChange(selected.filter((item) => !same(item, option)));
    } else if (selected.length < MAX_CHOICES) {
      onChange([...selected, option]);
    }
  };

  const addCustomChoice = (e) => {
    e.preventDefault();

    const choice = clean(customChoice);
    if (!choice || disabled || selected.length >= MAX_CHOICES) return;

    const existing = visibleOptions.find((option) => same(option, choice));
    const finalChoice = existing || choice;

    if (!selected.some((item) => same(item, finalChoice))) {
      onChange([...selected, finalChoice]);
    }

    setCustomChoice("");
  };

  return (
    <div className="multi-choice">
      <div className="multi-choice-grid">
        {visibleOptions.map((option) => {
          const selectedOption = selected.some((item) => same(item, option));
          const custom = !options.some((preset) => same(preset, option));

          return (
            <button
              key={option}
              type="button"
              className={`multi-choice-option ${selectedOption ? "selected" : ""}`}
              onClick={() => toggleChoice(option)}
              disabled={disabled}
            >
              <span className="multi-choice-check">
                {selectedOption && <Check size={14} strokeWidth={3} />}
              </span>

              <span className="multi-choice-text">{option}</span>

              {custom && (
                <span className="multi-choice-custom-badge">
                  Your choice
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="multi-choice-custom">
        <p>Not listed? Add your own choice.</p>

        <form onSubmit={addCustomChoice}>
          <input
            type="text"
            value={customChoice}
            onChange={(e) => setCustomChoice(e.target.value)}
            maxLength={200}
            disabled={disabled || selected.length >= MAX_CHOICES}
          />

          <button
            type="submit"
            disabled={
              disabled ||
              !clean(customChoice) ||
              selected.length >= MAX_CHOICES
            }
          >
            <Plus size={17} />
            Add
          </button>
        </form>

        {selected.length >= MAX_CHOICES && (
          <small>Maximum of 20 choices reached.</small>
        )}
      </div>
    </div>
  );
}

export default MultiChoice;