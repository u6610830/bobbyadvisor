import "./UnsavedNotice.css";

/**
 * Red reminder shown next to a Save button while there are changes that have
 * not been saved yet. Renders nothing when everything is saved.
 */
function UnsavedNotice({ show, text = "You have unsaved changes — press Save to keep them." }) {
  if (!show) return null;
  return (
    <span className="unsaved-notice" role="status">
      {text}
    </span>
  );
}

export default UnsavedNotice;