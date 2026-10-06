import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Send, CornerDownLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";

import logo from "../assets/logo.png";
import "./AiChatbot.css";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.PROD
    ? "https://api.bobbyadvisor.org"
    : "http://localhost:3001");

function formatBotMessage(text) {
  return String(text || "")
    .replace(/([^\n])\s+([-*])\s+/g, "$1\n$2 ")
    .replace(/([.!?])\s+(\d+\.)\s+/g, "$1\n$2 ");
}

function InstructorAiChat({ advisorId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");

  const messagesRef = useRef(null);

  // Load saved chat history whenever the advisor changes
  useEffect(() => {
    if (!advisorId) {
      setMessages([]);
      setInput("");
      setError("");
      return;
    }

    const loadHistory = async () => {
      setLoadingHistory(true);
      setError("");

      try {
        const response = await fetch(
          `${API_BASE}/chat/advisor/history/${encodeURIComponent(advisorId)}`
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.error || "Could not load advisor chat history."
          );
        }

        setMessages(Array.isArray(data.messages) ? data.messages : []);
      } catch (historyError) {
        console.error("Advisor chat history error:", historyError);

        setMessages([]);
        setError(
          historyError.message || "Could not load advisor chat history."
        );
      } finally {
        setLoadingHistory(false);
      }
    };

    loadHistory();
  }, [advisorId]);

  // Scroll to the newest message
  useEffect(() => {
    const element = messagesRef.current;

    if (!element) return;

    element.scrollTop = element.scrollHeight;
  }, [messages, loading, loadingHistory]);

  const sendMessage = async () => {
    const message = input.trim();

    if (!message || loading || !advisorId) return;

    const userMessage = {
      role: "user",
      text: message,
    };

    // Show the message immediately
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/chat/advisor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          advisor_id: advisorId,
          message,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || "Bobby could not respond right now."
        );
      }

      setMessages((current) => [
        ...current,
        {
          role: "bot",
          text: data.reply || "I couldn't generate a response.",
        },
      ]);
    } catch (requestError) {
      console.error("Advisor AI chat error:", requestError);

      setError(
        requestError.message || "Bobby could not respond right now."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chatbot-page">
      <div className="chatbot-title-pill">AI Advisor Assistant</div>

      <section className="chatbot-card">
        <div className="chatbot-messages" ref={messagesRef}>
          {loadingHistory ? (
            <div className="chatbot-empty">
              <img
                src={logo}
                alt="Bobby Advisor"
                className="chatbot-empty-logo"
              />

              <p>Loading your chat history...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="chatbot-empty">
              <img
                src={logo}
                alt="Bobby Advisor"
                className="chatbot-empty-logo"
              />

              <h3>Ask Bobby about your students</h3>

              <p>
                Ask about student GPAs, courses, graduation progress,
                registered courses, or requested courses.
              </p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`chatbot-row ${message.role}`}
              >
                {message.role === "bot" && (
                  <div className="chatbot-avatar">
                    <img
                      src={logo}
                      alt=""
                      aria-hidden="true"
                      className="chatbot-avatar-logo"
                    />
                  </div>
                )}

                <div
                  className={`chatbot-bubble ${
                    message.role === "user" ? "user" : ""
                  }`}
                >
                  {message.role === "bot" ? (
                    <div className="chatbot-markdown">
                      <ReactMarkdown>
                        {formatBotMessage(message.text)}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    message.text
                  )}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="chatbot-row bot">
              <div className="chatbot-avatar">
                <img
                  src={logo}
                  alt=""
                  aria-hidden="true"
                  className="chatbot-avatar-logo"
                />
              </div>

              <div
                className="chatbot-typing"
                aria-label="Bobby is typing"
              >
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="chatbot-error-row">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="chatbot-input-row">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Bobby about your students..."
            disabled={loading || loadingHistory || !advisorId}
          />

          <button
            type="button"
            onClick={sendMessage}
            disabled={
              loading ||
              loadingHistory ||
              !input.trim() ||
              !advisorId
            }
            aria-label="Send message"
          >
            <Send size={18} strokeWidth={2} />

            <CornerDownLeft
              size={15}
              strokeWidth={2.4}
              className="chatbot-enter-icon"
              aria-hidden="true"
            />
          </button>
        </div>
      </section>
    </div>
  );
}

export default InstructorAiChat;