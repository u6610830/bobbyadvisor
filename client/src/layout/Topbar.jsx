import { useEffect, useRef } from "react";
import { User } from "lucide-react";
import { supabase } from "../utils/supabaseClient.js";
import { cleanId } from "../utils/cleanId.js";
import chatbotIcon from "../assets/logo.png";
import "./Topbar.css";

function Topbar({
  topLine,
  bottomLine,
  onOpenChatbot,
  studentId,
  advisorId,
}) {
  const notificationAudioRef = useRef(null);

  // ------------------------------------------------
  // Realtime chat notification sound
  // ------------------------------------------------

  useEffect(() => {
    if (!advisorId) {
      return;
    }

    const targetAdvisor = cleanId(advisorId);

    const targetStudent = studentId
      ? cleanId(studentId)
      : null;

    const playSound = () => {
      const audio =
        notificationAudioRef.current;

      if (!audio) {
        return;
      }

      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;

      audio.play().catch((error) => {
        console.error(
          "Could not play notification sound:",
          error
        );
      });
    };

    const channel = supabase
      .channel(
        `topbar-chat-sound-${targetAdvisor}-${
          targetStudent || "advisor"
        }`
      )

      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "advisor_messages",
        },
        (payload) => {
          const message = payload.new;

          if (!message) {
            return;
          }

          const messageAdvisor =
            cleanId(
              message.advisor_id
            );

          const messageStudent =
            cleanId(
              message.student_id
            );

          // Ignore messages for another advisor
          if (
            messageAdvisor !==
            targetAdvisor
          ) {
            return;
          }

          // ------------------------------------------------
          // STUDENT
          // Play sound only when ADVISOR sends a message
          // ------------------------------------------------

          if (targetStudent) {
            if (
              messageStudent !==
              targetStudent
            ) {
              return;
            }

            if (
              message.sender_role !==
              "advisor"
            ) {
              return;
            }

            console.log(
              "New advisor message:",
              message
            );

            playSound();

            return;
          }

          // ------------------------------------------------
          // ADVISOR
          // Play sound only when STUDENT sends a message
          // ------------------------------------------------

          if (
            message.sender_role !==
            "student"
          ) {
            return;
          }

          console.log(
            "New student message:",
            message
          );

          playSound();
        }
      )

      .subscribe((status) => {
        console.log(
          "Chat notification status:",
          status
        );
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    studentId,
    advisorId,
  ]);

  return (
    <header className="topbar">

      {/* Notification sound */}
      <audio
        ref={notificationAudioRef}
        src="/sounds/notification.mp3"
        preload="auto"
      />

      {/* AI Chatbot */}
      {onOpenChatbot && (
        <button
          type="button"
          className="topbar-bot"
          onClick={onOpenChatbot}
          aria-label="Open AI Chatbot"
        >
          <img
            src={chatbotIcon}
            alt="AI Chatbot"
            className="chatbot-icon"
          />
        </button>
      )}

      {/* User */}
      <div className="topbar-user">

        <div className="topbar-avatar">
          <User
            size={22}
            strokeWidth={2}
          />
        </div>

        <div className="topbar-identity">
          <span className="topbar-id">
            {topLine}
          </span>

          <span className="topbar-name">
            {bottomLine}
          </span>
        </div>

      </div>
    </header>
  );
}

export default Topbar;