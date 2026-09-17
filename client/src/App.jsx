import { useEffect, useState } from "react";
import Sidebar from "./layout/Sidebar.jsx";
import Topbar from "./layout/Topbar.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import GradeList from "./pages/GradeList.jsx";
import GradeUpload from "./pages/GradeUpload.jsx";
import CourseRecommendation from "./pages/CourseRecommendation.jsx";
import GoalsAndCareer from "./pages/GoalsAndCareer.jsx";
import Planner from "./pages/Planner.jsx";
import StudentRequestedCourses from "./pages/StudentRequestedCourses.jsx";
import StudentGraduationCheck from "./pages/StudentGraduationCheck.jsx";
import AiChatbot from "./pages/AiChatbot.jsx";
import InstructorPortal from "./pages/InstructorPortal.jsx";
import AdminPortal from "./pages/AdminPortal.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import ChooseAdvisor from "./pages/ChooseAdvisor.jsx";
import WelcomeGoals from "./pages/WelcomeGoals.jsx";
import Profile from "./pages/Profile.jsx";
import StudentAdvisorChat from "./pages/StudentAdvisorChat.jsx";
import { getCurrentAdvisorId, setCurrentAdvisor } from "./utils/profile.js";
import { getCurrentPrereqGroupId } from "./utils/prereqGroup.js";
import { syncCurriculaFromServer } from "./utils/curriculum.js";
import { syncAdvisorsFromServer } from "./data/mockAdvisors.js";
import { getStudentGoalsCareer } from "./utils/goalsCareer.js";
import "./App.css";

const AUTH_STORAGE_KEY = "bobbyAdvisorAuth";

function getStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.userId || !parsed?.role) return null;

    return parsed;
  } catch (error) {
    console.error("Failed to restore saved login:", error);
    return null;
  }
}

function App() {
  const [storedAuth] = useState(() => getStoredAuth());
  const [isLoggedIn, setIsLoggedIn] = useState(
    () => Boolean(storedAuth?.userId && storedAuth?.role)
  );
  const [userId, setUserId] = useState(() => storedAuth?.userId || "");
  const [role, setRole] = useState(() => storedAuth?.role || null);
  const [activePage, setActivePage] = useState("dashboard");
  const [authView, setAuthView] = useState("login");
  const [prefillStudentId, setPrefillStudentId] = useState("");
  const [advisorId, setAdvisorId] = useState(() => storedAuth?.advisorId ?? null);

  // True once the student has gone through the Choose Advisor screen for
  // this session (whether they picked a real Advisor or "None for now").
  // Without this, picking "None" would just bounce straight back to the
  // Choose Advisor screen, since advisorId would still be null.
  const [advisorDecided, setAdvisorDecided] = useState(false);

  const [prereqGroupId, setPrereqGroupId] = useState(null);
  const [account, setAccount] = useState(() => storedAuth?.account ?? null);

  // Whether this student has any Goals/Career Interest saved yet:
  // null = still checking
  // true = none saved
  // false = already has at least one
  const [goalsPromptNeeded, setGoalsPromptNeeded] = useState(null);

  // True once the student has gone through or skipped the Goals/Career prompt.
  const [goalsDecided, setGoalsDecided] = useState(false);

  // Holds a verified Microsoft sign-in while a first-time student
  // completes Student ID / curriculum registration.
  const [microsoftRegistration, setMicrosoftRegistration] = useState(null);

  // Keep the signed-in account across browser refreshes.
  useEffect(() => {
    if (!isLoggedIn || !userId || !role) return;

    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        userId,
        role,
        account,
        advisorId,
      })
    );
  }, [isLoggedIn, userId, role, account, advisorId]);

  // Restore student-specific state after a browser refresh.
  useEffect(() => {
    if (!isLoggedIn || role !== "student" || !userId) return;

    if (!advisorId) {
      const restoredAdvisorId =
        account?.advisorId ?? getCurrentAdvisorId(userId) ?? null;
      if (restoredAdvisorId) {
        setAdvisorId(restoredAdvisorId);
      }
    }

    setPrereqGroupId(getCurrentPrereqGroupId(userId));

    getStudentGoalsCareer(userId)
      .then(({ goals, careerInterests }) => {
        setGoalsPromptNeeded(
          goals.length === 0 && careerInterests.length === 0
        );
      })
      .catch((err) => {
        console.error("Failed to check goals/career interests:", err);
        setGoalsPromptNeeded(false);
      });
  }, [isLoggedIn, role, userId, account?.advisorId]);

  // Load curriculum requirements.
  useEffect(() => {
    syncCurriculaFromServer();
  }, []);

  // Load advisor roster.
  useEffect(() => {
    syncAdvisorsFromServer();
  }, []);

  const handleLogin = (id, loggedInRole, loggedInAccount) => {
    const nextAccount = loggedInAccount ?? null;
    const currentAdvisorId =
      loggedInRole === "student"
        ? nextAccount
          ? nextAccount.advisorId ?? null
          : getCurrentAdvisorId(id)
        : null;

    setUserId(id);
    setRole(loggedInRole);
    setAccount(nextAccount);
    setIsLoggedIn(true);
    setMicrosoftRegistration(null);
    setAdvisorDecided(false);
    setGoalsDecided(false);
    setGoalsPromptNeeded(null);
    setAdvisorId(currentAdvisorId);

    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        userId: id,
        role: loggedInRole,
        account: nextAccount,
        advisorId: currentAdvisorId,
      })
    );

    // Re-sync an existing local advisor assignment to Supabase on login.
    if (loggedInRole === "student" && currentAdvisorId) {
      setCurrentAdvisor(id, currentAdvisorId);
    }

    setPrereqGroupId(
      loggedInRole === "student"
        ? getCurrentPrereqGroupId(id)
        : null
    );

    // Check whether this student needs the first-login Goals/Career prompt.
    if (loggedInRole === "student") {
      getStudentGoalsCareer(id)
        .then(({ goals, careerInterests }) => {
          setGoalsPromptNeeded(
            goals.length === 0 &&
              careerInterests.length === 0
          );
        })
        .catch((err) => {
          console.error(
            "Failed to check goals/career interests:",
            err
          );

          // Do not block login if this check fails.
          setGoalsPromptNeeded(false);
        });
    }
  };

  const handleMicrosoftRegistered = (student) => {
    handleLogin(student.student_id, "student", {
      studentId: student.student_id,
      displayName:
        student.name || student.student_id,
      email: student.email,
      advisorId: student.advisor_id,
      curriculumYear: student.curriculum_year,
      electiveGroup: student.elective_group,
    });
  };

  const handleAdvisorChange = (newAdvisorId) => {
    setAdvisorDecided(true);

    if (newAdvisorId) {
      setCurrentAdvisor(userId, newAdvisorId);
      setAdvisorId(newAdvisorId);
      setAccount((current) =>
        current ? { ...current, advisorId: newAdvisorId } : current
      );
    } else {
      // "None for now"
      setAdvisorId(null);
      setAccount((current) =>
        current ? { ...current, advisorId: null } : current
      );
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);

    setIsLoggedIn(false);
    setUserId("");
    setRole(null);
    setAccount(null);
    setActivePage("dashboard");
    setAdvisorId(null);
    setAdvisorDecided(false);
    setPrereqGroupId(null);
    setMicrosoftRegistration(null);
    setGoalsDecided(false);
    setGoalsPromptNeeded(null);
  };

  const renderStudentPage = () => {
    if (activePage === "dashboard") {
      return (
        <Dashboard
          studentId={userId}
          curriculumYear={account?.curriculumYear}
          onNavigate={setActivePage}
        />
      );
    }

    if (activePage === "grade-list") {
      return (
        <GradeList
          studentId={userId}
          onNavigate={setActivePage}
        />
      );
    }

    if (activePage === "upload") {
      return (
        <GradeUpload
          studentId={userId}
        />
      );
    }

    if (activePage === "course-recommendation") {
      return (
        <CourseRecommendation
          studentId={userId}
          onNavigate={setActivePage}
        />
      );
    }

    if (activePage === "goals") {
      return (
        <GoalsAndCareer
          studentId={userId}
          curriculumYear={account?.curriculumYear}
          onNavigate={setActivePage}
        />
      );
    }

    if (activePage === "planner") {
      return (
        <Planner
          studentId={userId}
          curriculumYear={account?.curriculumYear}
        />
      );
    }

    if (activePage === "requested-courses") {
      return (
        <StudentRequestedCourses
          studentId={userId}
          onNavigate={setActivePage}
        />
      );
    }

    if (activePage === "graduation-check") {
      return (
        <StudentGraduationCheck
          studentId={userId}
          curriculumYear={account?.curriculumYear}
        />
      );
    }

    if (activePage === "chatbot") {
      return (
        <AiChatbot
          studentId={userId}
        />
      );
    }

    if (activePage === "advisor-chat") {
      return (
        <StudentAdvisorChat
          studentId={userId}
          advisorId={advisorId}
        />
      );
    }

    if (activePage === "profile") {
      return (
        <Profile
          studentId={userId}
          advisorId={advisorId}
          onAdvisorChange={handleAdvisorChange}
          prereqGroupId={prereqGroupId}
        />
      );
    }

    return null;
  };

  // Not logged in
  if (!isLoggedIn) {
    if (authView === "register") {
      return (
        <Register
          microsoftAccount={microsoftRegistration}
          onMicrosoftRegistered={handleMicrosoftRegistered}
          onBackToLogin={(studentId) => {
            setPrefillStudentId(studentId || "");
            setMicrosoftRegistration(null);
            setAuthView("login");
          }}
        />
      );
    }

    return (
      <Login
        onLogin={handleLogin}
        onGoToRegister={(microsoftAccount) => {
          setMicrosoftRegistration(
            microsoftAccount || null
          );
          setAuthView("register");
        }}
        initialStudentId={prefillStudentId}
      />
    );
  }

  // Instructor portal handles its own layout/topbar.
  if (role === "instructor") {
    return (
      <InstructorPortal
        userId={userId}
        onSignOut={handleSignOut}
      />
    );
  }

  // Admin portal handles its own layout/topbar.
  if (role === "admin") {
    return (
      <AdminPortal
        userId={userId}
        onSignOut={handleSignOut}
      />
    );
  }

  // Student must choose advisor once per session if none exists.
  if (
    role === "student" &&
    !advisorId &&
    !advisorDecided
  ) {
    return (
      <ChooseAdvisor
        studentId={userId}
        onSelect={handleAdvisorChange}
        onSignOut={handleSignOut}
      />
    );
  }

  // Wait while checking Goals/Career data.
  if (
    role === "student" &&
    goalsPromptNeeded === null
  ) {
    return null;
  }

  // First-login Goals/Career prompt.
  if (
    role === "student" &&
    goalsPromptNeeded &&
    !goalsDecided
  ) {
    return (
      <WelcomeGoals
        studentId={userId}
        onDone={() => setGoalsDecided(true)}
        onSignOut={handleSignOut}
      />
    );
  }

  // Student app
  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        onSignOut={handleSignOut}
        studentId={userId}
        advisorId={advisorId}
      />

      <div className="app-main">
        <Topbar
          topLine={userId}
          bottomLine={
            account?.displayName ?? "Student"
          }
          onOpenChatbot={() =>
            setActivePage("chatbot")
          }
          studentId={userId}
          advisorId={advisorId}
          onOpenNotifications={() => {
            setActivePage("advisor-chat");
          }}
        />

        <main className="app-content">
          {renderStudentPage()}
        </main>
      </div>
    </div>
  );
}

export default App;
