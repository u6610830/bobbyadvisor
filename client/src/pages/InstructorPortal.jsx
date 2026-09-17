import { useState } from "react";
import {
  ClipboardList,
  Users,
} from "lucide-react";

import Sidebar from "../layout/Sidebar.jsx";
import Topbar from "../layout/Topbar.jsx";

import InstructorStudentList from "./InstructorStudentList.jsx";
import InstructorStudentAnalytics from "./InstructorStudentAnalytics.jsx";
import InstructorStudentChat from "./InstructorStudentChat.jsx";
import AdminCourseRegistrations from "./AdminCourseRegistrations.jsx";

import {
  getAdvisorById,
} from "../data/mockAdvisors.js";

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
];

function InstructorPortal({
  userId,
  onSignOut,
}) {
  const [activePage, setActivePage] =
    useState("student-list");

  const [
    selectedStudentId,
    setSelectedStudentId,
  ] = useState(null);

  const [
    selectedStudentRecord,
    setSelectedStudentRecord,
  ] = useState(null);

  const advisor =
    getAdvisorById(userId);

  // ---------------------------------------------
  // Open student analytics
  // ---------------------------------------------

  const handleSelectStudent = (
    id,
    studentRecord = null
  ) => {
    setSelectedStudentId(id);

    setSelectedStudentRecord(
      studentRecord
    );

    setActivePage("analytics");
  };

  // ---------------------------------------------
  // Open chat
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
  // Render page
  // ---------------------------------------------

  const renderPage = () => {
    // Student List
    if (
      activePage === "student-list"
    ) {
      return (
        <InstructorStudentList
          advisorId={userId}
          onSelectStudent={
            handleSelectStudent
          }
        />
      );
    }

    // Student Analytics
    if (
      activePage === "analytics"
    ) {
      return (
        <InstructorStudentAnalytics
          studentId={
            selectedStudentId
          }
          studentRecord={
            selectedStudentRecord
          }
          advisorId={userId}
          onBack={
            handleBackToStudents
          }
          onOpenChat={
            handleOpenChat
          }
        />
      );
    }

    // Student / Advisor Chat
    if (
      activePage === "chat"
    ) {
      return (
        <InstructorStudentChat
          studentId={
            selectedStudentId
          }
          advisorId={userId}
          onBack={() =>
            setActivePage(
              "analytics"
            )
          }
        />
      );
    }

    // Course Registrations
    if (
      activePage === "registrations"
    ) {
      return (
        <AdminCourseRegistrations
          advisorId={userId}
        />
      );
    }

    return null;
  };

  return (
    <div className="app-shell">

      {/* -----------------------------------------
          Advisor Sidebar
      ------------------------------------------ */}

      <Sidebar
        activePage={
          activePage
        }
        onNavigate={(
          page
        ) => {
          setActivePage(page);

          if (
            page ===
            "student-list"
          ) {
            setSelectedStudentId(
              null
            );

            setSelectedStudentRecord(
              null
            );
          }
        }}
        onSignOut={
          onSignOut
        }
        navItems={
          INSTRUCTOR_NAV_ITEMS
        }
        advisorId={
          userId
        }
      />

      <div className="app-main">

        {/* ---------------------------------------
            Advisor Topbar

            IMPORTANT:
            advisorId exists
            studentId is NOT passed

            This tells Topbar:
            "This is an advisor viewer"
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
          advisorId={
            userId
          }
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