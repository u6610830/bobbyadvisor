import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  BookOpen,
  Compass,
  CalendarRange,
  UploadCloud,
  UserCog,
  LogOut,
  MessageCircle,
  GraduationCap,
  ClipboardList,
} from "lucide-react";
import "./Sidebar.css";
import logo from "../assets/logo.png";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

function BobbyLogoNavIcon({ className = "" }) {
  return (
    <img
      src={logo}
      alt=""
      aria-hidden="true"
      className={`${className} sidebar-bobby-logo-icon`.trim()}
    />
  );
}

const STUDENT_NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "course-recommendation", label: "Course Recommendation", icon: BookOpen },
  { id: "goals", label: "Goal and Career Interests", icon: Compass },
  { id: "planner", label: "Planner", icon: CalendarRange },
  { id: "requested-courses", label: "My Requested Courses", icon: ClipboardList },
  { id: "graduation-check", label: "Graduation Check", icon: GraduationCap },
  { id: "chatbot", label: "AI Chatbot", icon: BobbyLogoNavIcon },
  { id: "advisor-chat", label: "Chat with Advisor", icon: MessageCircle },
  { id: "upload", label: "Upload Transcript", icon: UploadCloud },
  { id: "profile", label: "Profile", icon: UserCog },
];

function Sidebar({
  activePage,
  onNavigate,
  onSignOut,
  navItems = STUDENT_NAV_ITEMS,
  studentId,
  advisorId,
}) {
  const [unreadCount, setUnreadCount] = useState(0);

  // Student viewer: unread messages from this student's advisor, badged on
  // the "Chat with Advisor" nav item.
  // Advisor viewer (advisorId only, no studentId): total unread messages
  // sent by any of the advisor's students, badged on the "Student List"
  // nav item.
  const isAdvisorViewer = Boolean(advisorId) && !studentId;
  const unreadBadgeTarget = isAdvisorViewer ? "student-list" : "advisor-chat";

  useEffect(() => {
    if (!advisorId) return;

    const loadUnread = async () => {
      try {
        if (isAdvisorViewer) {
          const response = await fetch(
            `${API_BASE}/instructor/students?advisor_id=${encodeURIComponent(advisorId)}`
          );
          const data = await response.json();
          if (response.ok && Array.isArray(data)) {
            const total = data.reduce(
              (sum, student) => sum + (Number(student.unread_count) || 0),
              0
            );
            setUnreadCount(total);
          }
          return;
        }

        if (!studentId) return;

        const response = await fetch(
          `${API_BASE}/advisor-messages/unread?studentId=${encodeURIComponent(studentId)}&advisorId=${encodeURIComponent(advisorId)}&viewerRole=student`
        );
        const data = await response.json();
        if (response.ok) setUnreadCount(Number(data.unread_count) || 0);
      } catch (error) {
        console.error("Failed to load unread messages:", error);
      }
    };

    loadUnread();
    const timer = setInterval(loadUnread, 5000);
    return () => clearInterval(timer);
  }, [studentId, advisorId, isAdvisorViewer]);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={logo} alt="Bobby Advisor Logo" className="sidebar-logo" />
        <h1>
          <span className="brand-accent">Bobby</span>
          <br />
          Advisor
        </h1>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(({ id, label, icon: Icon }) => {
          const isActive = activePage === id;

          return (
            <button
              key={id}
              type="button"
              className={`sidebar-nav-item${isActive ? " active" : ""}`}
              onClick={() => onNavigate(id)}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={20} strokeWidth={2} className="sidebar-nav-icon" />
              <span className="sidebar-nav-label">{label}</span>

              {id === unreadBadgeTarget && unreadCount > 0 && (
                <span className="sidebar-chat-unread-badge">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <button type="button" className="sidebar-signout" onClick={onSignOut}>
        <LogOut size={18} strokeWidth={2} />
        <span>Sign Out</span>
      </button>
    </aside>
  );
}

export default Sidebar;
