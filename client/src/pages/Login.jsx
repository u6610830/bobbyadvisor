import { useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import {
  ArrowLeft,
  ArrowRight,
  KeyRound,
  Lock,
  Mail,
  User,
} from "lucide-react";
import logo from "../assets/logo.png";
import {
  resolveLoginAccount,
  resolveLoginAccountByEmail,
} from "../utils/auth.js";
import { supabase } from "../utils/supabaseClient.js";
import { syncAdvisorsFromServer } from "../data/mockAdvisors.js";
import { isMsalConfigured, loginRequest } from "../msalConfig.js";
import "./Login.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

async function requestJSON(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("The server returned an invalid response.");
  }
  if (!response.ok) {
    const error = new Error(data.error || "The request failed.");
    error.code = data.code;
    throw error;
  }
  return data;
}

    function MicrosoftLogo({ size = 18 }) {
      return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 21 21"
        aria-hidden="true"
      >
      <rect x="0" y="0" width="10" height="10" fill="#f25022" />
      <rect x="11" y="0" width="10" height="10" fill="#7fba00" />
      <rect x="0" y="11" width="10" height="10" fill="#00a4ef" />
      <rect x="11" y="11" width="10" height="10" fill="#ffb900" />
      </svg>
    );
  }
function Login({ onLogin, onGoToRegister, initialStudentId = "" }) {
  const initialMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("reset") === "1" ? "reset" : "login";
  }, []);
  const verifiedMessage = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("verified") === "1"
      ? "Email verified successfully. You can sign in now."
      : "";
  }, []);

  const [mode, setMode] = useState(initialMode);
  const [studentId, setStudentId] = useState(initialStudentId);
  const [password, setPassword] = useState("");
  const [identifier, setIdentifier] = useState(initialStudentId);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(verifiedMessage);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetReady, setResetReady] = useState(initialMode !== "reset");
  const [msError, setMsError] = useState("");
  const { instance, inProgress } = useMsal();

  useEffect(() => {
    if (mode !== "reset") return undefined;
    let active = true;

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setResetReady(Boolean(data.session));
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) setResetReady(true);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [mode]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const id = studentId.trim().toUpperCase();

    if (!id || !password) {
      setError("Please enter both your ID and password.");
      return;
    }

    // Advisor/Admin accounts (E-/A-prefixed IDs) authenticate against the
    // password stored for them in the database — new advisor accounts get
    // a temporary password of "0000" when Admin creates them (see
    // Admin > Manage Users > Add Advisor), and Admin/Advisor can change it
    // afterwards from their Profile page.
    if (!id.startsWith("U")) {
      try {
        setBusy(true);
        setError("");
        setNotice("");

        // Make sure we have the latest advisor roster before resolving —
        // this can run before App.jsx's own mount-time sync has resolved
        // (e.g. logging in right after the page loads).
        await syncAdvisorsFromServer();

        const resolved = resolveLoginAccount(id);

        if (!resolved || (resolved.role !== "instructor" && resolved.role !== "admin")) {
          setError("ID not recognized. Please check your ID and try again.");
          return;
        }

        const data = await requestJSON(`${API_BASE}/login/${resolved.role === "admin" ? "admin" : "advisor"}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, password }),
        });

        onLogin?.(data.account.id, resolved.role, data.account);
      } catch (loginError) {
        console.error("Login failed:", loginError);
        setError(
          loginError.message === "Failed to fetch"
            ? "Could not connect to the backend. Make sure the server is running on port 3001."
            : loginError.message || "Login failed."
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      setBusy(true);
      setError("");
      setNotice("");
      setEmailNotVerified(false);
      const data = await requestJSON(`${API_BASE}/login/student`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: id, password }),
      });
      const student = data.student;
      onLogin?.(student.student_id, "student", {
        studentId: student.student_id,
        displayName: student.name || student.student_id,
        email: student.email,
        advisorId: student.advisor_id,
        curriculumYear: student.curriculum_year,
        electiveGroup: student.elective_group,
      });
    } catch (loginError) {
      console.error("Login failed:", loginError);
      setEmailNotVerified(loginError.code === "EMAIL_NOT_VERIFIED");
      setError(
        loginError.message === "Failed to fetch"
          ? "Could not connect to the backend. Make sure the server is running on port 3001."
          : loginError.message || "Login failed."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async (event) => {
    event.preventDefault();
    if (!identifier.trim()) {
      setError("Enter your Student ID or email.");
      return;
    }
    try {
      setBusy(true);
      setError("");
      const data = await requestJSON(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      setNotice(data.message);
    } catch (forgotError) {
      setError(forgotError.message || "Could not send the reset email.");
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    const value = studentId.trim();
    if (!value) return;
    try {
      setBusy(true);
      setError("");
      const data = await requestJSON(`${API_BASE}/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: value }),
      });
      setNotice(data.message);
    } catch (resendError) {
      setError(resendError.message || "Could not resend the verification email.");
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    if (newPassword.length < 6) {
      setError("Password must contain at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Password and confirmation do not match.");
      return;
    }
    try {
      setBusy(true);
      setError("");
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        throw new Error("The reset link is invalid or expired. Request a new password-reset email.");
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      await supabase.auth.signOut();
      window.history.replaceState({}, document.title, window.location.pathname);
      setMode("login");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Password updated successfully. Sign in with your new password.");
    } catch (resetError) {
      setError(
        resetError.message ||
          "The reset link is invalid or expired. Request a new password-reset email."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    setMsError("");

    if (!isMsalConfigured) {
      setMsError(
        "Microsoft sign-in is not configured. Add the Microsoft app credentials to client/.env."
      );
      return;
    }

    try {
      const result = await instance.loginPopup(loginRequest);

      const email = String(
        result.account?.username ||
          result.account?.idTokenClaims?.email ||
          result.account?.idTokenClaims?.preferred_username ||
          ""
      )
        .trim()
        .toLowerCase();

      const displayName = String(
        result.account?.name || result.account?.idTokenClaims?.name || ""
      ).trim();

      // Keep the current local/mock Microsoft accounts working for
      // Advisor/Admin. Students are resolved from the real Supabase table
      // through the backend below.
      await syncAdvisorsFromServer();
      const localResolved = resolveLoginAccountByEmail(email);
      if (
        localResolved &&
        (localResolved.role === "instructor" || localResolved.role === "admin")
      ) {
        onLogin?.(
          localResolved.id,
          localResolved.role,
          localResolved.account
        );
        return;
      }

      if (!result.accessToken) {
        throw new Error(
          'Microsoft did not return an access token. Make sure loginRequest includes the "User.Read" scope.'
        );
      }

      try {
        const data = await requestJSON(`${API_BASE}/login/microsoft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            access_token: result.accessToken,
          }),
        });

        const student = data.student;

        onLogin?.(student.student_id, "student", {
          studentId: student.student_id,
          displayName: student.name || student.student_id,
          email: student.email,
          advisorId: student.advisor_id,
          curriculumYear: student.curriculum_year,
          electiveGroup: student.elective_group,
        });
      } catch (linkError) {
        // A valid Assumption University Microsoft account that is not in
        // Supabase yet should continue to Student Register instead of
        // showing "not linked".
        if (linkError.code === "ACCOUNT_NOT_REGISTERED") {
          onGoToRegister?.({
            accessToken: result.accessToken,
            email,
            displayName,
          });
          return;
        }

        throw linkError;
      }
    } catch (microsoftError) {
      if (microsoftError?.errorCode !== "user_cancelled") {
        console.error("Microsoft sign-in failed:", microsoftError);
        setMsError(
          microsoftError.message ||
            "Microsoft sign-in failed. Please try again."
        );
      }
    }
  };

  const msalBusy = inProgress !== InteractionStatus.None;

  return (
    <div className="login-page">
      <span className="login-blob-cluster blob-top-right" aria-hidden="true">
        <span className="blob" /><span className="blob" /><span className="blob" />
      </span>
      <span className="login-blob-cluster blob-bottom-left" aria-hidden="true">
        <span className="blob" /><span className="blob" /><span className="blob" />
      </span>

      <div className="login-card">
        <div className="login-logo">
          <img src={logo} alt="Bobby Advisor Logo" className="login-logo-image" />
          <h1><span className="brand-accent">Bobby</span> Advisor</h1>
        </div>

        {notice && <p className="login-notice">{notice}</p>}

        {mode === "login" && (
          <form className="login-form" onSubmit={handleSubmit}>
            <label htmlFor="student-id">ID:</label>
            <div className="login-input">
              <User size={18} strokeWidth={2} />
              <input
                id="student-id"
                type="text"
                placeholder="e.g. U6610001, E1000, A1000"
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
              />
            </div>

            <label htmlFor="password">Password:</label>
            <div className="login-input">
              <Lock size={18} strokeWidth={2} />
              <input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <div className="login-link-row">
              <button
                type="button"
                className="login-text-btn"
                onClick={() => {
                  setIdentifier(studentId);
                  setMode("forgot");
                  setError("");
                  setNotice("");
                }}
              >
                Forgot password?
              </button>
            </div>

            {error && <p className="login-error">{error}</p>}
            {emailNotVerified && (
              <button
                type="button"
                className="login-text-btn login-resend-btn"
                onClick={handleResendVerification}
                disabled={busy}
              >
                Resend verification email
              </button>
            )}

            <button type="submit" className="login-btn" disabled={busy}>
              <span>{busy ? "Signing in..." : "Login"}</span>
              <ArrowRight size={18} strokeWidth={2} />
            </button>

            <div className="login-divider"><span>or</span></div>
            {msError && <p className="login-error">{msError}</p>}
            <button
              type="button"
              className="login-ms-btn"
              onClick={handleMicrosoftLogin}
              disabled={msalBusy}
            >
              <MicrosoftLogo size={18} />
              <span>{msalBusy ? "Signing in..." : "Sign in with Microsoft"}</span>
            </button>
            <button
              type="button"
              className="login-register-link"
              onClick={() => onGoToRegister?.()}
            >
              No account yet? Register here
            </button>
          </form>
        )}

        {mode === "forgot" && (
          <form className="login-form" onSubmit={handleForgotPassword}>
            <h2 className="login-form-title">Reset your password</h2>
            <p className="login-form-help">
              Enter your Student ID or email to receive a password reset link.
            </p>
            <label htmlFor="reset-identifier">Student ID or email:</label>
            <div className="login-input">
              <Mail size={18} />
              <input
                id="reset-identifier"
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </div>
            {error && <p className="login-error">{error}</p>}
            <button type="submit" className="login-btn" disabled={busy}>
              <span>{busy ? "Sending..." : "Send reset email"}</span>
              <ArrowRight size={18} />
            </button>
            <button type="button" className="login-text-btn login-back-btn" onClick={() => setMode("login")}>
              <ArrowLeft size={15} /> Back to login
            </button>
          </form>
        )}

        {mode === "reset" && (
          <form className="login-form" onSubmit={handleResetPassword}>
            <h2 className="login-form-title">Choose a new password</h2>
            <p className="login-form-help">
              {resetReady
                ? "Enter a new password with at least 6 characters."
                : "Preparing your secure password-reset link..."}
            </p>
            <label htmlFor="new-password">New password:</label>
            <div className="login-input">
              <KeyRound size={18} />
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
            <label htmlFor="confirm-new-password">Confirm new password:</label>
            <div className="login-input">
              <Lock size={18} />
              <input
                id="confirm-new-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            {error && <p className="login-error">{error}</p>}
            <button type="submit" className="login-btn" disabled={busy || !resetReady}>
              <span>{busy ? "Saving..." : "Update password"}</span>
              <ArrowRight size={18} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default Login;
