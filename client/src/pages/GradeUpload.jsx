import { useState } from "react";
import axios from "axios";
import "./GradeUpload.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

function GradeUpload({ studentId }) {
  const [file, setFile] = useState(null);
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const extractGrades = async () => {
  if (!file) {
    setMessage("Please select a transcript image.");
    return;
  }

  if (!studentId) {
    setMessage("No logged-in student found.");
    return;
  }

  setLoading(true);
  setMessage("");

  const formData = new FormData();

  // Transcript image
  formData.append("image", file);

  // Logged-in student's ID
  formData.append("student_id", studentId);

  try {
    console.log("Uploading grades for student:", studentId);

    const response = await axios.post(
      `${API_BASE}/extract`,
      formData
    );

    setGrades(response.data.courses);

    setMessage("Completed.");

    setTimeout(() => {
      setMessage("");
    }, 3000);

  } catch (error) {
    console.error("Full error:", error);
    console.error("Backend response:", error.response?.data);

    setMessage(
      error.response?.data?.error ||
        "Error, Please try again."
    );

  } finally {
    setLoading(false);
  }
};

  return (
    <div className="grade-upload">
      <div className="grade-upload-intro">
        <h2>Upload Transcript</h2>

        <p>
          Upload your AU Spark Grade list.
        </p>

        {/* Optional: useful while testing */}
        <p>
          Logged in as: <strong>{studentId}</strong>
        </p>
      </div>

      <div className="upload-area">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            setFile(e.target.files[0]);
            setMessage("");
            setGrades([]);
          }}
        />

        {file && (
          <p className="selected-file">
            <strong>Selected File:</strong> {file.name}
          </p>
        )}

        <button
          onClick={extractGrades}
          disabled={loading}
        >
          {loading ? "Processing..." : "Start"}
        </button>

        {message && (
          <p className="upload-message">
            {message}
          </p>
        )}
      </div>

      {grades.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Course</th>
              <th>Grade</th>
            </tr>
          </thead>

          <tbody>
            {grades.map((item, index) => (
              <tr key={index}>
                <td>
                  {item.Semester} {item.course_code}{" "}
                  {item.course_name} ({item.credits} Credits)
                </td>

                <td>
                  <span className="grade">
                    {item.grade}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default GradeUpload;