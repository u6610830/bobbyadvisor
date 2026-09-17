import { useState } from "react";
import {
  ClipboardList,
  Settings,
  TrendingUp,
  Users,
} from "lucide-react";

import Sidebar from "../layout/Sidebar.jsx";
import Topbar from "../layout/Topbar.jsx";

import InstructorStudentList from "./InstructorStudentList.jsx";
import InstructorStudentAnalytics from "./InstructorStudentAnalytics.jsx";
import InstructorStudentChat from "./InstructorStudentChat.jsx";
import AdminCourseRegistrations from "./AdminCourseRegistrations.jsx";
import RequestedCourses from "./RequestedCourses.jsx";
import AccountSettings from "./AccountSettings.jsx";

import { getAdvisorById } from "../data/mockAdvisors.js";

const INSTRUCTOR_NAV_ITEMS = [
  {
    id: "student-list",
    label: "Student List",
    icon: Users,
  },
  {
    id: "registrations",
    label: "Course Registrations",
    icon: ClipboardList,
  },
  {
    id: "requested-courses",
    label: "Requested Courses",
    icon: TrendingUp,
  },
  {
    id: "settings",
    label: "Account Settings",
    icon: Settings,
  },
];

function InstructorPortal({
  userId,
  onSignOut,
}) {
  const [activePage, setActivePage] = useState("student-list");

  const [
    selectedStudentId,
    setSelectedStudentId,
  ] = useState(null);

  const [
    selectedStudentRecord,
    setSelectedStudentRecord,
  ] = useState(null);

  const advisor = getAdvisorById(userId);

  // ---------------------------------------------
  // Open student analytics
  // ---------------------------------------------
  const handleSelectStudent = (
    id,
    studentRecord = null
  ) => {
    setSelectedStudentId(id);
    setSelectedStudentRecord(studentRecord);
    setActivePage("analytics");
  };

  // ---------------------------------------------
  // Open student/advisor chat
  // ---------------------------------------------
  const handleOpenChat = (id) => {
    setSelectedStudentId(id);
    setActivePage("chat");
  };

  // ---------------------------------------------
  // Back to Student List
  // ---------------------------------------------
  const handleBackToStudents = () => {
    setActivePage("student-list");
  };

  // ---------------------------------------------
  // Main sidebar navigation
  // ---------------------------------------------
  const handleNavigate = (page) => {
    setActivePage(page);

    // When returning to the main Student List,
    // clear the previously selected student.
    if (page === "student-list") {
      setSelectedStudentId(null);
      setSelectedStudentRecord(null);
    }
  };

  // Keep "Student List" highlighted while the advisor
  // is viewing a student's Analytics or Chat page.
  const sidebarActivePage =
    activePage === "analytics" || activePage === "chat"
      ? "student-list"
      : activePage;

  // ---------------------------------------------
  // Render page
  // ---------------------------------------------
  const renderPage = () => {
    // Student List
    if (activePage === "student-list") {
      return (
        <InstructorStudentList
          advisorId={userId}
          onSelectStudent={handleSelectStudent}
        />
      );
    }

    // Student Analytics
    if (activePage === "analytics") {
      return (
        <InstructorStudentAnalytics
          studentId={selectedStudentId}
          studentRecord={selectedStudentRecord}
          advisorId={userId}
          onBack={handleBackToStudents}
          onOpenChat={handleOpenChat}
        />
      );
    }

    // Student / Advisor Chat
    if (activePage === "chat") {
      return (
        <InstructorStudentChat
          studentId={selectedStudentId}
          advisorId={userId}
          onBack={() => setActivePage("analytics")}
        />
      );
    }

    // Course Registrations
    if (activePage === "registrations") {
      return (
        <AdminCourseRegistrations
          advisorId={userId}
        />
      );
    }

    // Requested Courses from this advisor's students
    if (activePage === "requested-courses") {
      return (
        <RequestedCourses
          title="Requested Courses"
          audience="Advisor"
          advisorId={userId}
        />
      );
    }

    // Advisor Account Settings
    if (activePage === "settings") {
      return (
        <AccountSettings
          userId={userId}
          role="advisor"
          displayName={advisor?.name}
        />
      );
    }

    // Fallback
    return (
      <InstructorStudentList
        advisorId={userId}
        onSelectStudent={handleSelectStudent}
      />
    );
  };

  return (
    <div className="app-shell">
      {/* -----------------------------------------
          Advisor Sidebar
      ------------------------------------------ */}
      <Sidebar
        activePage={sidebarActivePage}
        onNavigate={handleNavigate}
        onSignOut={onSignOut}
        navItems={INSTRUCTOR_NAV_ITEMS}
        advisorId={userId}
      />

      <div className="app-main">
        {/* ---------------------------------------
            Advisor Topbar

            advisorId is passed.
            studentId is intentionally NOT passed.

            This keeps Topbar in advisor mode and
            allows advisor-level message notifications.
        ---------------------------------------- */}
        <Topbar
          topLine={
            advisor?.department ||
            userId ||
            "Advisor"
          }
          bottomLine={
            advisor?.name ||
            "Advisor"
          }
          advisorId={userId}
        />

        {/* ---------------------------------------
            Advisor Page
        ---------------------------------------- */}
        <main className="app-content">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

export default InstructorPortal;
