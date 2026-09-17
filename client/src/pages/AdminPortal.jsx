import { useState } from "react";
import { LayoutDashboard, CalendarDays, GraduationCap, TableProperties, FileSpreadsheet, ListChecks, ClipboardList, BookOpen, TrendingUp, Users, Settings } from "lucide-react";
import RoleLayout from "../layout/RoleLayout.jsx";
import AdminStudentsSummary from "./AdminStudentsSummary.jsx";
import AdminCourseTimetable from "./AdminCourseTimetable.jsx";
import AdminGraduationCheck from "./AdminGraduationCheck.jsx";
import AdminUploadData from "./AdminUploadData.jsx";
import AdminExcelCheck from "./AdminExcelCheck.jsx";
import AdminPreRequire from "./AdminPreRequire.jsx";
import AdminCourseRegistrations from "./AdminCourseRegistrations.jsx";
import AdminCourses from "./AdminCourses.jsx";
import RequestedCourses from "./RequestedCourses.jsx";
import AdminManageUsers from "./AdminManageUsers.jsx";
import AccountSettings from "./AccountSettings.jsx";
import { getAdminById } from "../data/mockAdmins.js";

const ADMIN_NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "manage-users", label: "Manage Users", icon: Users },
  { id: "timetable", label: "Course Timetable", icon: CalendarDays },
  { id: "graduation-check", label: "Graduation Check", icon: GraduationCap },
  { id: "upload-data", label: "Upload Table Data", icon: TableProperties },
  { id: "excel-check", label: "Check from Excel", icon: FileSpreadsheet },
  { id: "pre-require", label: "Pre-Require", icon: ListChecks },
  { id: "registrations", label: "Course Registrations", icon: ClipboardList },
  { id: "courses", label: "All Courses", icon: BookOpen },
  { id: "high-demand", label: "Requested Courses", icon: TrendingUp },
  { id: "settings", label: "Account Settings", icon: Settings },
];

function AdminPortal({ userId, onSignOut }) {
  const [activePage, setActivePage] = useState("dashboard");
  const admin = getAdminById(userId);

  const renderContent = () => {
    if (activePage === "manage-users") return <AdminManageUsers />;
    if (activePage === "settings") return <AccountSettings userId={userId} role="admin" displayName={admin?.name} />;
    if (activePage === "timetable") return <AdminCourseTimetable />;
    if (activePage === "graduation-check") return <AdminGraduationCheck />;
    if (activePage === "upload-data") return <AdminUploadData />;
    if (activePage === "excel-check") return <AdminExcelCheck />;
    if (activePage === "pre-require") return <AdminPreRequire />;
    if (activePage === "registrations") return <AdminCourseRegistrations />;
    if (activePage === "courses") return <AdminCourses />;
    if (activePage === "high-demand") return <RequestedCourses />;
    return <AdminStudentsSummary />;
  };

  return (
    <RoleLayout
      themeClass="theme-admin"
      brandName="Admin"
      userId={userId}
      userName={admin?.name}
      navItems={ADMIN_NAV_ITEMS}
      activePage={activePage}
      onNavigate={setActivePage}
      onSignOut={onSignOut}
    >
      {renderContent()}
    </RoleLayout>
  );
}

export default AdminPortal;


