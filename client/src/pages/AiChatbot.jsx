import { useEffect, useRef, useState } from "react";
import { Send, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import "./AiChatbot.css";
import logo from "../assets/logo.png";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.PROD
    ? "https://api.bobbyadvisor.org"
    : "http://localhost:3001");

// Helps older Bobby responses that put Markdown bullets on one long line.
function formatBotMessage(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+\*\s+(?=\*\*)/g, "\n\n- ")
    .replace(/\s+\*\s+(?=Missing:)/gi, "\n  - ")
    .trim();
}

function AiChatbot({ studentId }) {
  // No greeting message.
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(Boolean(studentId));
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

  // Load saved Bobby conversation.
  useEffect(() => {
    let cancelled = false;

    setMessages([]);

    if (!studentId) {
      setHistoryLoading(false);
      return undefined;
    }

    setHistoryLoading(true);

    fetch(`${API_BASE}/chat/bobby/${encodeURIComponent(studentId)}`)
      .then((response) => response.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;

        const saved = Array.isArray(data.messages)
          ? data.messages
          : [];

        setMessages(
          saved.map((row) => ({
            id: `h-${row.id}`,
            from: row.role === "user" ? "user" : "bot",
            text: row.text,
          }))
        );
      })
      .catch((loadError) => {
        console.error(
          "Failed to load Bobby chat history:",
          loadError
        );
      })
      .finally(() => {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const handleSend = async (e) => {
    e.preventDefault();

    const text = draft.trim();

    if (!text || sending || historyLoading) {
      return;
    }

    if (!studentId) {
      setError(
        "You need to be signed in as a student to chat with Bobby."
      );
      return;
    }

    const userMessage = {
      id: `u-${Date.now()}`,
      from: "user",
      text,
    };

    const historyForRequest = [...messages, userMessage]
      .slice(-10)
      .map((message) => ({
        role:
          message.from === "user"
            ? "user"
            : "bot",
        text: message.text,
      }));

    setMessages((prev) => [
      ...prev,
      userMessage,
    ]);

    setDraft("");
    setError("");
    setSending(true);

    try {
      const response = await fetch(
        `${API_BASE}/chat/bobby`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            student_id: studentId,
            message: text,
            history: historyForRequest,
          }),
        }
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Bobby couldn't respond right now."
        );
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          from: "bot",
          text: data.reply || "...",
        },
      ]);
    } catch (sendError) {
      console.error(
        "Bobby chat error:",
        sendError
      );

      setError(
        sendError.message === "Failed to fetch"
          ? "Could not connect to the backend."
          : sendError.message ||
              "Bobby couldn't respond right now."
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chatbot-page">
      <span className="chatbot-title-pill">
        Bobby Advisor
      </span>

      <div className="chatbot-card">
        <div
          className="chatbot-messages"
          ref={scrollRef}
        >
          {!historyLoading &&
            messages.length === 0 && (
              <div className="chatbot-empty">
                <img
                  src={logo}
                  alt="Bobby Advisor Logo"
                  className="chatbot-empty-logo"
                />

                <h3>Ask Bobby anything</h3>

                <p>
                  Ask about your grades,
                  graduation requirements,
                  course planning, or career goals.
                </p>
              </div>
            )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`chatbot-row ${message.from}`}
            >
              {message.from === "bot" && (
                <span className="chatbot-avatar">
                  <img
                    src={logo}
                    alt=""
                    aria-hidden="true"
                    className="chatbot-avatar-logo"
                  />
                </span>
              )}

              {message.from === "bot" ? (
                <div className="chatbot-bubble bot chatbot-markdown">
                  <ReactMarkdown>
                    {formatBotMessage(
                      message.text
                    )}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="chatbot-bubble user">
                  {message.text}
                </p>
              )}
            </div>
          ))}

          {historyLoading && (
            <div className="chatbot-row bot">
              <span className="chatbot-avatar">
                <img
                  src={logo}
                  alt=""
                  aria-hidden="true"
                  className="chatbot-avatar-logo"
                />
              </span>

              <div className="chatbot-bubble bot chatbot-typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          {sending && (
            <div className="chatbot-row bot">
              <span className="chatbot-avatar">
                <img
                  src={logo}
                  alt=""
                  aria-hidden="true"
                  className="chatbot-avatar-logo"
                />
              </span>

              <div className="chatbot-bubble bot chatbot-typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="chatbot-error-row">
            <AlertTriangle
              size={16}
              strokeWidth={2}
            />

            <span>{error}</span>
          </div>
        )}

        <form
          className="chatbot-input-row"
          onSubmit={handleSend}
        >
          <input
            type="text"
            placeholder={
              historyLoading
                ? "Loading conversation..."
                : "Ask Bobby about your progress..."
            }
            value={draft}
            disabled={
              sending || historyLoading
            }
            onChange={(e) =>
              setDraft(e.target.value)
            }
          />

          <button
            type="submit"
            aria-label="Send message"
            disabled={
              sending ||
              historyLoading ||
              !draft.trim()
            }
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

export default AiChatbot;