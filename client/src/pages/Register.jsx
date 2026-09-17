import { useEffect, useState } from "react";
import {
  IdCard,
  User,
  Lock,
  Mail,
  GraduationCap,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

import { getCurriculumYearForStudent, syncCurriculaFromServer } from "../utils/curriculum.js";
import { getPrereqGroupLabel } from "../data/prereqGroups.js";
import { getCurrentPrereqGroupId } from "../utils/prereqGroup.js";

import "./Register.css";
import logo from "../assets/logo.png";

const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.bobbyadvisor.org" : "http://localhost:3001");

// Only Assumption University student emails are accepted: "u" followed by
// 7 digits, then "@au.edu" — e.g. u6610066@au.edu, u6710001@au.edu.
// The Student ID is never typed in separately; it's always the local part
// of this email, uppercased (u6610066@au.edu -> U6610066).
const AU_EMAIL_RE = /^u\d{7}@au\.edu$/i;

function deriveStudentId(rawEmail) {
  const normalized = String(rawEmail || "").trim().toLowerCase();
  return AU_EMAIL_RE.test(normalized)
    ? normalized.split("@")[0].toUpperCase()
    : "";
}

function deriveAdmissionYearFromStudentId(studentId) {
  const digits = String(studentId || "").replace(/\D/g, "");
  if (digits.length < 2) return "";
  const beYear = Number(digits.slice(0, 2));
  return Number.isFinite(beYear) ? String(1957 + beYear) : "";
}

function Register({ onBackToLogin, microsoftAccount = null, onMicrosoftRegistered }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [curriculaReady, setCurriculaReady] = useState(false);
  const [reasons, setReasons] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);

  const isMicrosoftRegistration = Boolean(microsoftAccount?.accessToken);
  const previewStudentId = deriveStudentId(email);
  const curriculumYear =
    curriculaReady && previewStudentId
      ? getCurriculumYearForStudent(previewStudentId) ||
        deriveAdmissionYearFromStudentId(previewStudentId)
      : "";

  useEffect(() => {
    syncCurriculaFromServer().finally(() => setCurriculaReady(true));
  }, []);

  useEffect(() => {
    if (!isMicrosoftRegistration) return;

    setEmail(String(microsoftAccount?.email || "").trim().toLowerCase());
    setFullName(String(microsoftAccount?.displayName || "").trim());
  }, [isMicrosoftRegistration, microsoftAccount]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setReasons([]);

    const normalizedEmail = email.trim().toLowerCase();

    if (!fullName.trim()) {
      setReasons(["Full Name is required."]);
      return;
    }

    if (!AU_EMAIL_RE.test(normalizedEmail)) {
      setReasons([
        "Email must be your AU student email in the format u#######@au.edu (e.g. u6610066@au.edu).",
      ]);
      return;
    }

    const normalizedStudentId = deriveStudentId(normalizedEmail);

    if (!curriculumYear) {
      setReasons([
        "Could not determine your Curriculum Year from your Student ID.",
      ]);
      return;
    }

    if (password !== confirmPassword) {
      setReasons(["Password and confirmation do not match."]);
      return;
    }

    if (password.length < 6) {
      setReasons(["Password must contain at least 6 characters."]);
      return;
    }

    setSubmitting(true);
    try {
      // Password registration uses /students, which creates a Supabase Auth
      // account and sends a confirmation email — the student must click that
      // link before Login will let them in. Microsoft registration uses
      // /students/microsoft instead; Microsoft already verified this AU
      // email, so that account is confirmed immediately, but it still gets
      // the same password so the student can also sign in the normal way
      // afterward, not only via the Microsoft button.
      // Advisor isn't collected here — new students start with no Advisor
      // and are asked to choose one (or "None") right after signing in.
      const endpoint = isMicrosoftRegistration
        ? `${API_BASE}/students/microsoft`
        : `${API_BASE}/students`;

      const body = isMicrosoftRegistration
        ? {
            student_id: normalizedStudentId,
            curriculum_year: curriculumYear,
            access_token: microsoftAccount.accessToken,
            password,
          }
        : {
            student_id: normalizedStudentId,
            name: fullName.trim(),
            email: normalizedEmail,
            curriculum_year: curriculumYear,
            password,
          };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const text = await response.text();

      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(
          `Server returned an invalid response: ${text.slice(0, 100)}`
        );
      }

      if (!response.ok) {
        throw new Error(data.error || "Failed to save student profile.");
      }

      setSuccess({
        studentId: normalizedStudentId,
        displayName: fullName.trim(),
        curriculumYear,
        prereqGroup: getCurrentPrereqGroupId(normalizedStudentId),
        verificationRequired: data.verificationRequired !== false,
        message: data.message,
        student: data.student,
        microsoft: isMicrosoftRegistration,
      });
    } catch (error) {
      console.error("Registration error:", error);
      setReasons([error.message || "Registration failed."]);
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="register-page">
        <div className="register-card">
          <div className="register-logo">
            <span className="register-logo-icon">
              <CheckCircle2 size={30} strokeWidth={2} />
            </span>

            <h1>
              <span className="brand-accent">Registration</span> Successful
            </h1>
          </div>

          <div className="register-success-box">
            <p>
              <strong>Student ID:</strong> {success.studentId}
            </p>

            <p>
              <strong>Full Name:</strong> {success.displayName}
            </p>

            <p>
              <strong>Curriculum Year:</strong> {success.curriculumYear}
            </p>

            <p>
              <strong>Prerequisite Group:</strong>{" "}
              {success.prereqGroup
                ? getPrereqGroupLabel(success.prereqGroup)
                : "-"}
            </p>
          </div>

          <p className="register-success-note">
            {success.message ||
              (success.microsoft
                ? "Your account has been created."
                : "Your account has been created. Check your email and verify your account before signing in.")}
          </p>

          <button
            type="button"
            className="register-btn"
            onClick={() => {
              if (success.microsoft && success.student) {
                onMicrosoftRegistered?.(success.student);
                return;
              }

              onBackToLogin?.(success.studentId);
            }}
          >
            <span>
              {success.microsoft ? "Continue to Bobby Advisor" : "Go to Login"}
            </span>
            <ArrowRight size={18} strokeWidth={2} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="register-page">
      <div className="register-card">
        <div className="register-logo">
          <img
            src={logo}
            alt="Bobby Advisor Logo"
            className="register-logo-image"
          />

          <h1>
            <span className="brand-accent">Student</span> Register
          </h1>
        </div>

        {isMicrosoftRegistration && (
          <p className="register-success-note">
            Microsoft account: {email}
          </p>
        )}

        <form className="register-form" onSubmit={handleSubmit}>
          <label htmlFor="reg-full-name">Full Name:</label>

          <div className="register-input">
            <User size={18} strokeWidth={2} />

            <input
              id="reg-full-name"
              type="text"
              placeholder="e.g. Somsri Jaidee"
              value={fullName}
              readOnly={isMicrosoftRegistration}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <label htmlFor="reg-email">Email:</label>

          <div className="register-input">
            <Mail size={18} strokeWidth={2} />
            <input
              id="reg-email"
              type="email"
              placeholder="e.g. u6610066@au.edu"
              value={email}
              readOnly={isMicrosoftRegistration}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="register-input register-input-readonly">
            <IdCard size={18} strokeWidth={2} />
            <input
              id="reg-student-id"
              type="text"
              readOnly
              tabIndex={-1}
              placeholder="Student ID (from your email)"
              value={previewStudentId}
            />
          </div>

          <div className="register-grid">
            <div>
              <label htmlFor="reg-password">Password:</label>

              <div className="register-input">
                <Lock size={18} strokeWidth={2} />

                <input
                  id="reg-password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label htmlFor="reg-confirm-password">
                Confirm Password:
              </label>

              <div className="register-input">
                <Lock size={18} strokeWidth={2} />

                <input
                  id="reg-confirm-password"
                  type="password"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
          </div>

          {isMicrosoftRegistration && (
            <p className="register-hint">
              You'll be able to sign in either with Microsoft or with your
              Student ID and this password.
            </p>
          )}

          <label htmlFor="reg-curriculum">Curriculum Year:</label>

          <div className="register-input register-input-readonly">
            <GraduationCap size={18} strokeWidth={2} />
            <input
              id="reg-curriculum"
              type="text"
              readOnly
              tabIndex={-1}
              value={curriculumYear}
              placeholder={
                previewStudentId
                  ? curriculaReady
                    ? "No matching curriculum found"
                    : "Checking curriculum…"
                  : "Auto-filled from Student ID"
              }
            />
          </div>
          <p className="register-hint">
            Curriculum Year is selected automatically from your Student ID.
          </p>

          {reasons.length > 0 && (
            <div className="register-error-box">
              <div className="register-error-title">
                <AlertTriangle size={16} strokeWidth={2} />

                <span>Registration failed because:</span>
              </div>

              <ul>
                {reasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          <button type="submit" className="register-btn" disabled={submitting}>
            <span>{submitting ? "Registering…" : "Register"}</span>

            <ArrowRight size={18} strokeWidth={2} />
          </button>

          <button
            type="button"
            className="register-link-btn"
            onClick={() => onBackToLogin?.()}
          >
            Already have an account? Back to Login
          </button>
        </form>
      </div>
    </div>
  );
}

export default Register;
