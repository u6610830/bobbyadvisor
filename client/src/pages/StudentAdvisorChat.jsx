import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Send, User } from "lucide-react";
import { getAdvisorById } from "../data/mockAdvisors.js";
import { supabase } from "../utils/supabaseClient.js";
import { cleanId } from "../utils/cleanId.js";
import "./AiChatbot.css";
import "./AdvisorChat.css";

const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

function StudentAdvisorChat({ studentId, advisorId }) {
  const advisor = advisorId
    ? getAdvisorById(advisorId)
    : null;

  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const scrollRef = useRef(null);

  // Mark advisor -> student messages as read.
  const markStudentMessagesRead = async () => {
    if (!studentId || !advisorId) return;

    try {
      await axios.put(
        `${API_BASE}/advisor-messages/read`,
        {
          studentId,
          advisorId,
          viewerRole: "student",
        }
      );
    } catch (err) {
      console.error(
        "Failed to mark student messages as read:",
        err
      );
    }
  };

  // Load existing conversation.
  useEffect(() => {
    if (!studentId || !advisorId) return;

    let cancelled = false;

    const loadMessages = async () => {
      setLoading(true);
      setError("");

      try {
        const { data } = await axios.get(
          `${API_BASE}/advisor-messages`,
          {
            params: {
              studentId,
              advisorId,
            },
          }
        );

        if (cancelled) return;

        setMessages(data.messages || []);

        // Student has opened the chat,
        // so advisor messages are now read.
        await markStudentMessagesRead();
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

  // Realtime messages + read receipts.
  useEffect(() => {
    if (!studentId || !advisorId) return;

    const targetStudent = cleanId(studentId);
    const targetAdvisor = cleanId(advisorId);

    const channel = supabase
      .channel(
        `advisor-chat-student-${targetStudent}-${targetAdvisor}`
      )

      // NEW MESSAGE
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "advisor_messages",
        },
        (payload) => {
          const row = payload.new;

          if (!row) return;

          if (
            cleanId(row.student_id) !== targetStudent
          ) {
            return;
          }

          if (
            cleanId(row.advisor_id) !== targetAdvisor
          ) {
            return;
          }

          setMessages((prev) => {
            const alreadyExists = prev.some(
              (message) => message.id === row.id
            );

            if (alreadyExists) {
              return prev;
            }

            return [...prev, row];
          });

          // Advisor sends message while student
          // already has the chat open.
          if (row.sender_role === "advisor") {
            markStudentMessagesRead();
          }
        }
      )

      // READ STATUS CHANGED
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "advisor_messages",
        },
        (payload) => {
          const row = payload.new;

          if (!row) return;

          if (
            cleanId(row.student_id) !== targetStudent
          ) {
            return;
          }

          if (
            cleanId(row.advisor_id) !== targetAdvisor
          ) {
            return;
          }

          // Replace the old message with the
          // updated database version.
          setMessages((prev) =>
            prev.map((message) =>
              message.id === row.id
                ? row
                : message
            )
          );
        }
      )

      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [studentId, advisorId]);

  // Scroll to newest message.
  useEffect(() => {
    if (loading) return;

    const chat = scrollRef.current;

    if (!chat) return;

    requestAnimationFrame(() => {
      chat.scrollTop = chat.scrollHeight;
    });
  }, [messages, loading]);

  const handleSend = async (e) => {
    e.preventDefault();

    const text = draft.trim();

    if (!text || sending) return;

    setSending(true);
    setDraft("");
    setError("");

    try {
      const { data } = await axios.post(
        `${API_BASE}/advisor-messages`,
        {
          studentId,
          advisorId,
          senderRole: "student",
          message: text,
        }
      );

      setMessages((prev) => {
        const alreadyExists = prev.some(
          (message) =>
            message.id === data.message.id
        );

        if (alreadyExists) {
          return prev;
        }

        return [...prev, data.message];
      });
    } catch (err) {
      console.error(
        "Failed to send message:",
        err
      );

      setError(
        "Failed to send message — please try again."
      );

      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  if (!advisorId) {
    return (
      <div className="advisor-chat-empty">
        <p>
          Your advisor hasn&apos;t been set yet.
          Please set it on the Profile page first.
        </p>
      </div>
    );
  }

  // Find the newest message sent by the student.
  //
  // Only THIS message gets Sent / Seen,
  // similar to Instagram DM.
  const latestStudentMessage =
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.sender_role === "student"
      );

  const latestStudentMessageId =
    latestStudentMessage?.id;

  return (
    <div className="advisor-chat-page">
      <div className="advisor-chat-header">
        <span className="chatbot-title-pill">
          {advisor
            ? `${advisor.name} (${advisor.department})`
            : "Your Advisor"}
        </span>
      </div>

      <div className="chatbot-card">
        <div
          className="chatbot-messages"
          ref={scrollRef}
        >
          {loading && (
            <p>Loading conversation...</p>
          )}

          {!loading && error && (
            <p className="advisor-chat-error">
              {error}
            </p>
          )}

          {!loading &&
            !error &&
            messages.length === 0 && (
              <p>
                No messages yet — send the first
                one to{" "}
                {advisor?.name ?? "advisor"}.
              </p>
            )}

          {!loading &&
            messages.map((message) => {
              const isStudent =
                message.sender_role === "student";

              const showStatus =
                isStudent &&
                message.id ===
                  latestStudentMessageId;

              return (
                <div
                  key={message.id}
                  className={`chatbot-row ${
                    isStudent
                      ? "user"
                      : "advisor"
                  }`}
                >
                  {!isStudent && (
                    <span className="chatbot-avatar">
                      <User
                        size={20}
                        strokeWidth={2}
                      />
                    </span>
                  )}

                  <div className="chat-message-content">
                    <p
                      className={`chatbot-bubble ${
                        isStudent
                          ? "user"
                          : "advisor"
                      }`}
                    >
                      {message.message}
                    </p>

                    {showStatus && (
                      <span className="chat-read-status">
                        {message.read_by_advisor
                          ? "Seen"
                          : "Sent"}
                      </span>
                    )}
                  </div>
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
            onChange={(e) =>
              setDraft(e.target.value)
            }
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

export default StudentAdvisorChat;