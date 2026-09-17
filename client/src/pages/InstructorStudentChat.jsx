import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Send, ArrowLeft, User } from "lucide-react";
import { getStudentByAnyId } from "../data/mockStudents.js";
import { supabase } from "../utils/supabaseClient.js";
import { cleanId } from "../utils/cleanId.js";
import "./AiChatbot.css";
import "./AdvisorChat.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

// Real-time 1-on-1 chat between an instructor/advisor and a selected
// student. Mirrors StudentAdvisorChat.jsx — same `advisor_messages`
// table, same realtime subscription, so messages sent from either side
// show up on the other without a refresh.
function InstructorStudentChat({ studentId, advisorId, onBack }) {
  // Mock roster only covers two demo accounts. Real students created
  // through the app aren't in it, so fall back to the live `students`
  // table for the display name instead of blocking the chat entirely.
  const mockStudent = getStudentByAnyId(studentId);
  const [displayName, setDisplayName] = useState(
    mockStudent?.displayName || studentId
  );

  useEffect(() => {
    if (mockStudent || !studentId) return;

    let cancelled = false;

    axios
      .get(`${API_BASE}/students/${encodeURIComponent(studentId)}`)
      .then(({ data }) => {
        if (!cancelled && data?.student?.name) {
          setDisplayName(data.student.name);
        }
      })
      .catch((err) => {
        console.error("Failed to load student info:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [studentId, mockStudent]);

  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  // Marks all student -> advisor messages in this conversation as read.
  // This clears the unread badge on the Advisor Student List.
  const markAdvisorMessagesRead = async () => {
    if (!studentId || !advisorId) return;

    try {
      await axios.put(`${API_BASE}/advisor-messages/read`, {
        studentId,
        advisorId,
        viewerRole: "advisor",
      });
    } catch (err) {
      // Chat should still work even if clearing the notification fails.
      console.error("Failed to mark advisor messages as read:", err);
    }
  };

  // Initial load.
  useEffect(() => {
    if (!studentId || !advisorId) {
      return;
    }

    let cancelled = false;

    const loadMessages = async () => {
      setLoading(true);
      setError("");

      try {
        const { data } = await axios.get(`${API_BASE}/advisor-messages`, {
          params: { studentId, advisorId },
        });

        if (!cancelled) {
          setMessages(data.messages || []);

          // Opening the conversation means the advisor has seen the
          // student's unread messages, so clear the notification.
          await markAdvisorMessagesRead();
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.error ||
              "Couldn't connect to chat. Please try again."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadMessages();

    return () => {
      cancelled = true;
    };
  }, [studentId, advisorId]);

  // Realtime subscription: listen for new rows inserted into
  // advisor_messages for this student/advisor pair.
  useEffect(() => {
    if (!studentId || !advisorId) return;

    const targetStudent = cleanId(studentId);
    const targetAdvisor = cleanId(advisorId);

    const channel = supabase
      .channel(`advisor-chat-instructor-${targetStudent}-${targetAdvisor}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "advisor_messages" },
        (payload) => {
          const row = payload.new;
          if (!row) return;

          if (cleanId(row.student_id) !== targetStudent) return;
          if (cleanId(row.advisor_id) !== targetAdvisor) return;

          setMessages((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev
              : [...prev, row]
          );

          // If the student sends a new message while this chat is already
          // open, the advisor is currently viewing it, so clear it
          // immediately instead of leaving a false unread badge.
          if (row.sender_role === "student") {
            markAdvisorMessagesRead();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [studentId, advisorId]);

  useEffect(() => {
  if (loading) return;

  const chat = scrollRef.current;
  if (!chat) return;

  requestAnimationFrame(() => {
    chat.scrollTop = chat.scrollHeight;
  });
}, [messages, loading]);

  if (!studentId || !advisorId) {
    return (
      <div className="analytics-empty">
        <p>Select a student first to start a chat.</p>
      </div>
    );
  }

  const handleSend = async (e) => {
    e.preventDefault();

    const text = draft.trim();

    if (!text || sending) {
      return;
    }

    setSending(true);
    setDraft("");

    try {
      const { data } = await axios.post(`${API_BASE}/advisor-messages`, {
        studentId,
        advisorId,
        senderRole: "advisor",
        message: text,
      });

      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id)
          ? prev
          : [...prev, data.message]
      );
    } catch (err) {
      console.error("Failed to send message:", err);
      setError("Failed to send — please try again.");
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="advisor-chat-page">
      <div className="advisor-chat-header">
        <button
          type="button"
          className="analytics-back"
          onClick={onBack}
        >
          <ArrowLeft size={16} strokeWidth={2} />
          <span>Back</span>
        </button>

        <span className="chatbot-title-pill">
          {displayName}
        </span>
      </div>

      <div className="chatbot-card">
        <div
          className="chatbot-messages"
          ref={scrollRef}
        >
          {loading && <p>Loading conversation...</p>}

          {!loading && error && (
            <p className="advisor-chat-error">
              {error}
            </p>
          )}

          {!loading &&
            !error &&
            messages.length === 0 && (
              <p>
                No messages yet — send the first message to{" "}
                {displayName}.
              </p>
            )}

          {!loading &&
            messages.map((message) => {
              const isAdvisor =
                message.sender_role === "advisor";

              return (
                <div
                  key={message.id}
                  className={`chatbot-row ${
                    isAdvisor ? "user" : "advisor"
                  }`}
                >
                  {!isAdvisor && (
                    <span className="chatbot-avatar">
                      <User
                        size={20}
                        strokeWidth={2}
                      />
                    </span>
                  )}

                  <p
                    className={`chatbot-bubble ${
                      isAdvisor ? "user" : "advisor"
                    }`}
                  >
                    {message.message}
                  </p>
                </div>
              );
            })}
        </div>

        <form
          className="chatbot-input-row"
          onSubmit={handleSend}
        >
          <input
            type="text"
            placeholder="TEXT YOUR MESSAGE"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={loading}
          />

          <button
            type="submit"
            aria-label="Send message"
            disabled={sending || loading}
          >
            <Send
              size={18}
              strokeWidth={2}
            />
          </button>
        </form>
      </div>
    </div>
  );
}

export default InstructorStudentChat;
