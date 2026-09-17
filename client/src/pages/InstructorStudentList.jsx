import { useEffect, useState } from "react";
import { User } from "lucide-react";
import "./InstructorStudentList.css";

const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

function InstructorStudentList({ advisorId, onSelectStudent }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const fetchStudents = async (showLoading = false) => {
      if (!advisorId) {
        setStudents([]);
        setLoading(false);
        return;
      }

      try {
        if (showLoading) {
          setLoading(true);
        }

        setError("");

        const response = await fetch(
          `${API_BASE}/instructor/students?advisor_id=${encodeURIComponent(advisorId)}`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to fetch students");
        }

        if (!cancelled) {
          setStudents(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        console.error("Error fetching students:", error);

        if (!cancelled) {
          setError(error.message);

          if (showLoading) {
            setStudents([]);
          }
        }
      } finally {
        if (!cancelled && showLoading) {
          setLoading(false);
        }
      }
    };

    // First load.
    fetchStudents(true);

    // Refresh the student list periodically so unread chat badges update
    // without the advisor manually refreshing the page.
    const intervalId = window.setInterval(() => {
      fetchStudents(false);
    }, 5000);

    // Also refresh immediately when the advisor comes back to this tab.
    const handleFocus = () => {
      fetchStudents(false);
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [advisorId]);

  if (loading) {
    return (
      <div className="student-list-card">
        <div className="student-list-empty">
          <p>Loading students...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="student-list-card">
      {error && (
        <div className="student-list-empty">
          <p>{error}</p>
        </div>
      )}

      {!error && (
        <div className="student-list-grid">
          {students.map((student) => {
            const unreadCount = Number(
              student.unread_count ?? student.unreadCount ?? 0
            );

            return (
              <button
                key={student.student_id}
                type="button"
                className={`student-list-item${
                  unreadCount > 0 ? " has-unread-message" : ""
                }`}
                onClick={() =>
                  onSelectStudent(student.student_id, student)
                }
              >
                <span className="student-avatar">
                  <User size={22} strokeWidth={2} />
                </span>

                <span className="student-list-name">
                  {student.name || student.student_id}
                </span>

                {unreadCount > 0 && (
                  <span
                    className="student-chat-unread-badge"
                    aria-label={`${unreadCount} unread message${
                      unreadCount === 1 ? "" : "s"
                    }`}
                    title={`${unreadCount} unread message${
                      unreadCount === 1 ? "" : "s"
                    }`}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!error && students.length === 0 && (
        <div className="student-list-empty">
          <p>No students are assigned to this advisor.</p>
        </div>
      )}
    </div>
  );
}

export default InstructorStudentList;
