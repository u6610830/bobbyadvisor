import { useEffect, useRef, useState } from "react";
import { Bot, Send, AlertTriangle } from "lucide-react";
import "./AiChatbot.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

const GREETING = "Hello, I'm Bobby Advisor. Ask me about your grades, remaining requirements, or what to plan next ^-^";

function AiChatbot({ studentId }) {
  const [messages, setMessages] = useState([
    { id: "greeting", from: "bot", text: GREETING },
  ]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // Starts true whenever there's a student to load history for, so the
  // input stays disabled until we know whether there's a conversation to
  // resume — avoids a flash of "new chat" right before saved messages
  // pop in.
  const [historyLoading, setHistoryLoading] = useState(Boolean(studentId));
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  // Resume any conversation Bobby already saved for this student, so
  // reopening the page (or a new session) continues where they left off
  // instead of starting blank every time.
  useEffect(() => {
    let cancelled = false;

    if (!studentId) {
      setHistoryLoading(false);
      return undefined;
    }

    setHistoryLoading(true);
    fetch(`${API_BASE}/chat/bobby/${encodeURIComponent(studentId)}`)
      .then((response) => response.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        const saved = Array.isArray(data.messages) ? data.messages : [];
        if (saved.length > 0) {
          setMessages([
            { id: "greeting", from: "bot", text: GREETING },
            ...saved.map((row) => ({
              id: `h-${row.id}`,
              from: row.role === "user" ? "user" : "bot",
              text: row.text,
            })),
          ]);
        }
      })
      .catch((loadError) => {
        // A failed history load shouldn't block a fresh conversation —
        // the greeting-only default is already in place.
        console.error("Failed to load Bobby chat history:", loadError);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const handleSend = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending || historyLoading) return;

    if (!studentId) {
      setError("You need to be signed in as a student to chat with Bobby.");
      return;
    }

    const userMessage = { id: `u-${Date.now()}`, from: "user", text };
    // Bobby only needs a short rolling window of prior turns for context,
    // so this stays cheap even in a long-running conversation. Since
    // `messages` is seeded from the saved history above, this window
    // naturally includes past sessions too, not just this page load.
    const historyForRequest = [...messages, userMessage]
      .filter((m) => m.id !== "greeting")
      .slice(-10)
      .map((m) => ({ role: m.from === "user" ? "user" : "bot", text: m.text }));

    setMessages((prev) => [...prev, userMessage]);
    setDraft("");
    setError("");
    setSending(true);

    try {
      const response = await fetch(`${API_BASE}/chat/bobby`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId,
          message: text,
          history: historyForRequest,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Bobby couldn't respond right now.");
      }

      setMessages((prev) => [
        ...prev,
        { id: `b-${Date.now()}`, from: "bot", text: data.reply || "..." },
      ]);
    } catch (sendError) {
      console.error("Bobby chat error:", sendError);
      setError(
        sendError.message === "Failed to fetch"
          ? "Could not connect to the backend. Make sure the server is running."
          : sendError.message || "Bobby couldn't respond right now."
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chatbot-page">
      <span className="chatbot-title-pill">Bobby Advisor</span>

      <div className="chatbot-card">
        <div className="chatbot-messages" ref={scrollRef}>
          {messages.map((message) => (
            <div key={message.id} className={`chatbot-row ${message.from}`}>
              {message.from === "bot" && (
                <span className="chatbot-avatar">
                  <Bot size={20} strokeWidth={2} />
                </span>
              )}
              <p className={`chatbot-bubble ${message.from}`}>
                {message.text}
              </p>
            </div>
          ))}

          {historyLoading && (
            <div className="chatbot-row bot">
              <span className="chatbot-avatar">
                <Bot size={20} strokeWidth={2} />
              </span>
              <p className="chatbot-bubble bot chatbot-typing">
                <span></span>
                <span></span>
                <span></span>
              </p>
            </div>
          )}

          {sending && (
            <div className="chatbot-row bot">
              <span className="chatbot-avatar">
                <Bot size={20} strokeWidth={2} />
              </span>
              <p className="chatbot-bubble bot chatbot-typing">
                <span></span>
                <span></span>
                <span></span>
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="chatbot-error-row">
            <AlertTriangle size={16} strokeWidth={2} />
            <span>{error}</span>
          </div>
        )}

        <form className="chatbot-input-row" onSubmit={handleSend}>
          <input
            type="text"
            placeholder="Ask Bobby about your progress..."
            value={draft}
            disabled={sending || historyLoading}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" aria-label="Send message" disabled={sending || historyLoading}>
            <Send size={18} strokeWidth={2} />
          </button>
        </form>
      </div>
    </div>
  );
}

export default AiChatbot;
