const PREFIX = "bobbyAdvisor:";

/**
 * Load JSON state from localStorage. Falls back to `fallback` if the key
 * doesn't exist yet or the stored value can't be parsed.
 */
export function loadState(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to load "${key}" from storage`, err);
    return fallback;
  }
}

/**
 * Persist JSON-serializable state to localStorage under a namespaced key.
 */
export function saveState(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (err) {
    console.error(`Failed to save "${key}" to storage`, err);
  }
}
