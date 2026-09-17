import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import supabase from "./supabase.js";
import bcrypt from "bcrypt";
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({
  dest: "uploads/"
});

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Model used for BOTH /extract (grades) and /extract-timetable below.
// IMPORTANT: "gemini-3.1-flash-lite" is the only model string confirmed
// to actually work on this account/API version. Do NOT swap this for a
// different model name (e.g. "gemini-3.1-flash", "gemini-3.1-pro")
// without first testing it against /test-gemini below — an unavailable
// model name fails with a 404 "not found for API version v1beta" error,
// which breaks the upload it's used in.
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const CLIENT_URL = String(process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");

// AES-256-GCM encryption for Bobby's saved chat (see BOBBY_MESSAGES_TABLE
// below) — both the student's own messages and Bobby's replies are
// encrypted before they're written to the database, so the raw table
// never holds readable chat text, only ciphertext. CHAT_ENCRYPTION_KEY
// can be any passphrase of any length; it's hashed down to a fixed
// 256-bit key so the .env value doesn't have to be a specific format.
if (!process.env.CHAT_ENCRYPTION_KEY) {
  console.warn(
    "CHAT_ENCRYPTION_KEY is not set in .env — Bobby chat messages will be encrypted with an insecure default key. Set CHAT_ENCRYPTION_KEY to a long random value before deploying."
  );
}
const CHAT_ENCRYPTION_KEY = crypto
  .createHash("sha256")
  .update(String(process.env.CHAT_ENCRYPTION_KEY || "insecure-default-change-me"))
  .digest();

// Safe to log/share — it's a short one-way fingerprint of the derived
// key, not the key itself. Two servers meant to read each other's
// encrypted chat rows must print the exact same fingerprint here; if
// they don't, their .env values differ in some way that isn't visible
// just by eyeballing them (e.g. one has quotes around the value, or a
// trailing space, that the other doesn't).
console.log(
  "Chat encryption key fingerprint:",
  crypto.createHash("sha256").update(CHAT_ENCRYPTION_KEY).digest("hex").slice(0, 12)
);

function encryptChatText(plainText) {
  const iv = crypto.randomBytes(12); // 96-bit IV, standard for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", CHAT_ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plainText ?? ""), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Stored as one text column: base64(iv):base64(authTag):base64(ciphertext).
  return [iv, authTag, ciphertext].map((buf) => buf.toString("base64")).join(":");
}

function decryptChatText(storedText) {
  const raw = String(storedText ?? "");
  const parts = raw.split(":");
  // Anything not in our iv:authTag:ciphertext shape isn't decryptable —
  // returned as-is rather than thrown away, so rows written before
  // encryption was added (if any) still display instead of vanishing.
  if (parts.length !== 3) return raw;

  try {
    const [ivB64, authTagB64, ciphertextB64] = parts;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      CHAT_ENCRYPTION_KEY,
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (error) {
    console.error("Failed to decrypt a Bobby chat message:", error.message);
    return "[Unable to decrypt this message]";
  }
}

// Only Assumption University student emails are accepted for registration:
// "u" followed by 7 digits, then "@au.edu" — e.g. u6610066@au.edu,
// u6710001@au.edu. The Student ID is always derived from this email
// (never sent separately by the client) as the local part, uppercased.
const AU_EMAIL_RE = /^u\d{7}@au\.edu$/i;

async function resolveRegistrationCurriculumYear(studentId) {
  const { data, error } = await supabase.from("curricula").select("year");
  if (error) throw error;

  const availableYears = (data || [])
    .map((row) => String(row.year || "").trim())
    .filter(Boolean);

  const matched = deriveCurriculumYearFromId(studentId, availableYears);
  if (matched) return matched;

  // If Admin has not uploaded curriculum rows yet, still derive the
  // student's admission year directly from the ID instead of asking the
  // student to choose it manually (U6610001 -> 66 -> 2023).
  const digits = String(studentId || "").replace(/\D/g, "");
  if (digits.length < 2) return null;
  const beYear = Number(digits.slice(0, 2));
  return Number.isFinite(beYear) ? String(1957 + beYear) : null;
}

function createAuthClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

// Looks up a Supabase Auth user (auth.users, not our own `students`
// table) directly by email via the GoTrue admin REST API. supabase-js's
// admin.listUsers() doesn't support filtering by email, so this hits the
// endpoint directly with the service-role key.
//
// Why this exists: registration creates the Auth user first, then the
// `students` row. If a student's connection drops (or an earlier bug)
// between those two steps, the email ends up "registered" in Supabase
// Auth with no matching `students` row — invisible in our own table, but
// createUser()/signUp() will still reject it as a duplicate forever. This
// finds that orphaned account so registration can recover it instead of
// permanently locking the student out of their own email.
async function findAuthUserByEmail(email) {
  const url = `${process.env.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;
  const response = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
    },
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  const users = data?.users || [];
  return users.find((u) => String(u.email || "").toLowerCase() === email.toLowerCase()) || null;
}

async function findStudentForAuth(identifier) {
  const value = String(identifier || "").trim();
  if (!value) return null;
  let query = supabase
    .from("students")
    .select("student_id, name, email, advisor_id, curriculum_year, elective_group, auth_user_id, email_verified, password_hash");
  query = value.includes("@")
    ? query.ilike("email", value.toLowerCase())
    : query.ilike("student_id", value.toUpperCase());
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureAuthUser(profile) {
  if (profile.auth_user_id) return profile.auth_user_id;

  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw listError;

  let authUser = listed.users?.find(
    (user) => String(user.email || "").toLowerCase() === String(profile.email || "").toLowerCase()
  );
  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: profile.email,
      email_confirm: true,
      user_metadata: { student_id: profile.student_id, name: profile.name },
    });
    if (error) throw error;
    authUser = data.user;
  }

  const { error: updateError } = await supabase
    .from("students")
    .update({ auth_user_id: authUser.id, email_verified: true })
    .eq("student_id", profile.student_id);
  if (updateError) throw updateError;
  return authUser.id;
}

async function getMicrosoftProfile(accessToken) {
  const token = String(accessToken || "").trim();

  if (!token) {
    const error = new Error("Microsoft access token is required.");
    error.status = 400;
    throw error;
  }

  const graphResponse = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }
  );

  if (!graphResponse.ok) {
    const error = new Error(
      "Your Microsoft session is invalid or expired. Sign in with Microsoft again."
    );
    error.status = 401;
    throw error;
  }

  const graphUser = await graphResponse.json();
  const email = String(
    graphUser.mail || graphUser.userPrincipalName || ""
  )
    .trim()
    .toLowerCase();

  if (!email) {
    const error = new Error(
      "Microsoft did not return an email address for this account."
    );
    error.status = 400;
    throw error;
  }

  return {
    microsoftId: graphUser.id,
    email,
    name: String(graphUser.displayName || email).trim(),
  };
}

function studentAuthResponse(student) {
  return {
    student_id: student.student_id,
    name: student.name,
    email: student.email,
    advisor_id: student.advisor_id,
    curriculum_year: student.curriculum_year,
    elective_group: student.elective_group,
  };
}

app.get("/", (req, res) => {
  res.send("Grade Reader AI Backend is running!");
});


app.post("/login/microsoft", async (req, res) => {
  try {
    const microsoft = await getMicrosoftProfile(req.body.access_token);
    const student = await findStudentForAuth(microsoft.email);

    if (!student) {
      return res.status(404).json({
        code: "ACCOUNT_NOT_REGISTERED",
        error: "This Microsoft account has not registered a student profile yet.",
      });
    }

    // A successful Microsoft Graph /me call proves control of the Microsoft
    // account, so the university email can be treated as verified here.
    if (student.email_verified !== true) {
      await supabase
        .from("students")
        .update({ email_verified: true })
        .eq("student_id", student.student_id);
    }

    return res.json({
      student: studentAuthResponse(student),
    });
  } catch (error) {
    console.error("POST /login/microsoft error:", error);
    return res.status(error.status || 500).json({
      error: error.message || "Microsoft login failed.",
    });
  }
});

app.post("/students/microsoft", async (req, res) => {
  try {
    const microsoft = await getMicrosoftProfile(req.body.access_token);

    // The Student ID is never taken from the client — it's always derived
    // from the verified Microsoft email (u6610066@au.edu -> U6610066), so
    // it can't be spoofed by whatever the client sends as student_id.
    const microsoftEmail = String(microsoft.email || "").trim().toLowerCase();
    const advisorId = req.body.advisor_id
      ? String(req.body.advisor_id).trim().toUpperCase()
      : null;
    const password = String(req.body.password || "");

    if (!AU_EMAIL_RE.test(microsoftEmail)) {
      return res.status(400).json({
        error:
          "Only Assumption University student emails (u#######@au.edu) can register.",
      });
    }

    const studentId = microsoftEmail.split("@")[0].toUpperCase();
    const curriculumYear = await resolveRegistrationCurriculumYear(studentId);

    if (!curriculumYear) {
      return res.status(400).json({
        error: "Could not determine Curriculum Year from this Student ID.",
      });
    }

    // Even though Microsoft already verified this student's identity, we
    // still ask for a password here so the account can also sign in the
    // normal Student ID + password way afterward, not only via the
    // Microsoft button.
    if (password.length < 6) {
      return res.status(400).json({
        error: "Password must contain at least 6 characters.",
      });
    }

    const { data: existing, error: existingError } = await supabase
      .from("students")
      .select("student_id, email")
      .or(`student_id.ilike.${studentId},email.ilike.${microsoft.email}`)
      .limit(1);

    if (existingError) {
      return res.status(500).json({ error: existingError.message });
    }

    if (existing?.length) {
      return res.status(409).json({
        error: "That Student ID or Microsoft email is already registered.",
      });
    }

    // Use the admin API (not the public signUp flow) so we can mark the
    // account email-confirmed immediately — Microsoft already verified
    // this AU email, so there's no need to also send a confirmation email
    // and make the student click a link before they can sign in.
    let { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: microsoft.email,
      password,
      email_confirm: true,
      user_metadata: { student_id: studentId, name: microsoft.name },
    });

    if (authError) {
      // We already confirmed above that no `students` row exists for this
      // email/ID, so if Auth says the email is taken, it's an orphaned
      // Auth user from an incomplete earlier attempt — recover it instead
      // of leaving the student permanently unable to register.
      const orphan = await findAuthUserByEmail(microsoft.email).catch(() => null);
      if (!orphan) {
        return res.status(400).json({ error: authError.message });
      }

      const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(
        orphan.id,
        { password, email_confirm: true }
      );
      if (updateError) {
        return res.status(400).json({ error: updateError.message });
      }
      authData = { user: updated.user };
    }

    const { data: student, error: insertError } = await supabase
      .from("students")
      .insert({
        student_id: studentId,
        name: microsoft.name,
        email: microsoft.email,
        advisor_id: advisorId,
        curriculum_year: curriculumYear,
        auth_user_id: authData.user.id,
        email_verified: true,
      })
      .select(
        "student_id, name, email, advisor_id, curriculum_year, elective_group, email_verified"
      )
      .single();

    if (insertError) {
      await supabase.auth.admin.deleteUser(authData.user.id).catch(() => null);
      return res.status(500).json({ error: insertError.message });
    }

    return res.status(201).json({
      student,
      verificationRequired: false,
      message: "Microsoft account linked successfully. You can also sign in with your Student ID and password.",
    });
  } catch (error) {
    console.error("POST /students/microsoft error:", error);
    return res.status(error.status || 500).json({
      error: error.message || "Microsoft registration failed.",
    });
  }
});

app.post("/students", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const advisorId = req.body.advisor_id ? String(req.body.advisor_id).trim().toUpperCase() : null;
    const password = String(req.body.password || "");

    // The Student ID is never taken from the client — it's always derived
    // from the AU email (u6610066@au.edu -> U6610066), so it can't be
    // spoofed by whatever the client sends as student_id.
    if (!AU_EMAIL_RE.test(email)) {
      return res.status(400).json({
        error: "Email must be your AU student email in the format u#######@au.edu.",
      });
    }
    const studentId = email.split("@")[0].toUpperCase();
    const curriculumYear = await resolveRegistrationCurriculumYear(studentId);

    if (!name || !email || password.length < 6) {
      return res.status(400).json({
        error: "Name, email, and a password of at least 6 characters are required.",
      });
    }

    if (!curriculumYear) {
      return res.status(400).json({
        error: "Could not determine Curriculum Year from this Student ID.",
      });
    }

    const { data: existing, error: existingError } = await supabase
      .from("students")
      .select("student_id, email")
      .or(`student_id.ilike.${studentId},email.ilike.${email}`)
      .limit(1);
    if (existingError) return res.status(500).json({ error: existingError.message });
    if (existing?.length) return res.status(409).json({ error: "That Student ID or email is already registered." });

    const authClient = createAuthClient();
    const { data: rawAuthData, error: authError } = await authClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${CLIENT_URL}/?verified=1`,
        data: { student_id: studentId, name },
      },
    });
    if (authError) return res.status(400).json({ error: authError.message });

    let authData = rawAuthData;
    if (!authData.user?.id || authData.user.identities?.length === 0) {
      // We already confirmed above that no `students` row exists for this
      // email/ID, so an "already exists" signal here means an orphaned
      // Auth user from an incomplete earlier attempt — recover it instead
      // of leaving the student permanently unable to register with their
      // own email.
      const orphan = await findAuthUserByEmail(email).catch(() => null);
      if (!orphan) {
        return res.status(409).json({ error: "An account already exists for this email." });
      }
      const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(
        orphan.id,
        { password }
      );
      if (updateError) return res.status(400).json({ error: updateError.message });
      authData = { user: updated.user };
    }

    const { data: student, error: insertError } = await supabase
      .from("students")
      .insert({
        student_id: studentId,
        name,
        email,
        advisor_id: advisorId,
        curriculum_year: curriculumYear,
        auth_user_id: authData.user.id,
        email_verified: Boolean(authData.user.email_confirmed_at),
      })
      .select("student_id, name, email, advisor_id, curriculum_year, elective_group, email_verified")
      .single();

    if (insertError) {
      await supabase.auth.admin.deleteUser(authData.user.id).catch(() => null);
      return res.status(500).json({ error: insertError.message });
    }

    return res.status(201).json({
      student,
      verificationRequired: !student.email_verified,
      message: student.email_verified
        ? "Account created. You can sign in now."
        : "Account created. Check your email and verify your account before signing in.",
    });
  } catch (error) {
    console.error("POST /students error:", error);
    return res.status(500).json({ error: error.message });
  }
});

app.post("/login/student", async (req, res) => {
  try {
    const studentId = String(req.body.student_id || "").trim().toUpperCase();
    const password = String(req.body.password || "");
    if (!studentId || !password) {
      return res.status(400).json({ error: "Student ID and password are required." });
    }

    const student = await findStudentForAuth(studentId);
    if (!student) return res.status(401).json({ error: "Incorrect ID or password." });

    let authenticated = false;
    if (student.email) {
      const authClient = createAuthClient();
      const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
        email: student.email,
        password,
      });
      if (!authError && authData.user) {
        authenticated = true;
        const verified = Boolean(authData.user.email_confirmed_at);
        if (!verified) {
          return res.status(403).json({
            code: "EMAIL_NOT_VERIFIED",
            error: "Verify your email before signing in.",
          });
        }
        await supabase
          .from("students")
          .update({ auth_user_id: authData.user.id, email_verified: true })
          .eq("student_id", student.student_id);
      } else if (String(authError?.message || "").toLowerCase().includes("email not confirmed")) {
        return res.status(403).json({
          code: "EMAIL_NOT_VERIFIED",
          error: "Verify your email before signing in.",
        });
      }
    }

    // Compatibility for existing bcrypt accounts created before email auth.
    if (!authenticated && !student.auth_user_id && student.password_hash) {
      authenticated = await bcrypt.compare(password, student.password_hash);
    }
    if (!authenticated) return res.status(401).json({ error: "Incorrect ID or password." });
    if (student.email_verified === false && student.auth_user_id) {
      return res.status(403).json({ code: "EMAIL_NOT_VERIFIED", error: "Verify your email before signing in." });
    }

    return res.json({
      student: {
        student_id: student.student_id,
        name: student.name,
        email: student.email,
        advisor_id: student.advisor_id,
        curriculum_year: student.curriculum_year,
        elective_group: student.elective_group,
      },
    });
  } catch (error) {
    console.error("POST /login/student error:", error);
    return res.status(500).json({ error: error.message });
  }
});

app.post("/auth/resend-verification", async (req, res) => {
  try {
    const student = await findStudentForAuth(req.body.identifier);
    if (!student?.email) return res.json({ message: "If the account exists, a verification email has been sent." });
    const authClient = createAuthClient();
    const { error } = await authClient.auth.resend({
      type: "signup",
      email: student.email,
      options: { emailRedirectTo: `${CLIENT_URL}/?verified=1` },
    });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ message: "Verification email sent. Check your inbox and spam folder." });
  } catch (error) {
    console.error("POST /auth/resend-verification error:", error);
    return res.status(500).json({ error: error.message });
  }
});

app.post("/auth/forgot-password", async (req, res) => {
  try {
    const student = await findStudentForAuth(req.body.identifier);
    const genericMessage = "If the account exists, a password-reset email has been sent.";
    if (!student?.email) return res.json({ message: genericMessage });

    await ensureAuthUser(student);
    const authClient = createAuthClient();
    const { error } = await authClient.auth.resetPasswordForEmail(student.email, {
      redirectTo: `${CLIENT_URL}/?reset=1`,
    });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ message: genericMessage });
  } catch (error) {
    console.error("POST /auth/forgot-password error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------
// STUDENT: transcript image upload -> grades
// ------------------------------------------------
app.post("/extract", upload.single("image"), async (req, res) => {
  try {
    // Check image
    if (!req.file) {
      return res.status(400).json({
        error: "No image uploaded"
      });
    }

    // Get the logged-in student's ID
    const studentId = req.body.student_id;

    if (!studentId) {
      return res.status(400).json({
        error: "Student ID is required"
      });
    }

    console.log("Extracting grades for student:", studentId);

    // Read image
    const imageBuffer = req.file.buffer;
    const base64 = imageBuffer.toString("base64");

    // Send image to Gemini
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      config: {
        // Deterministic reading — grade transcription shouldn't vary
        // between runs on the same image.
        temperature: 0,
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `
Get all courses details semester and grades from this image.

Rules:
- Return ONLY valid JSON, no markdown fences.
- Preserve + and - grades exactly as printed (e.g. "B+", "C-").
- Ignore GPA.
- Ignore student information (name, ID, major, etc).
- Double-check every character of "course_code" and "grade" before finalizing — a misread letter/digit here silently corrupts a real transcript record.
- "credits" must be a number, not a string.

Semester rules:
If course is ABOVE the Known Semester header: Next Semester.
If course is UNDER the Known Semester header: Previous Semester.
if the known semester start with 1/ then the previous semester is 2/ of the previous year
if the known semester start with 2/ then the previous semester is 1/ of the same year
if the known semester start with 1/ then the next semester is 2/ of the same year
if the known semester start with 2/ then the next semester is 1/ of the next year

Next Semester:
 From 1/20xx -> becomes 2/20xx.
 From 2/20xx -> becomes 1/20xx+1.

Previous Semester:
 From 1/20xx -> becomes 2/(20xx-1).
 From 2/20xx -> becomes 1/20xx.

Example:
{ "courses": [{"course_code": "...","course_name": "...","grade": "...","credits": 3,"Semester": "1/2025"}]}

Unknown --> 2/2025 CSX4201 ARTIFICIAL INTELLIGENCE CONCEPTS (3 Credits)
Unknown --> 2/2025 GE2102 HUMAN HERITAGE AND GLOBALIZATION (3 Credits)
Known 1/2025 BG14035 PROFESSIONAL ETHICS SEMINAR V (0 Credits
Unknown -->2/2024 CSX3002 OBJECT-ORIENTED CONCEPTS AND PROGRAMMING (3 Credits)
            `
            },
            {
              inlineData: {
                mimeType: req.file.mimetype,
                data: base64
              }
            }
          ]
        }
      ]
    });

    // Clean Gemini response
    const cleanedText = response.text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    // Convert Gemini JSON into JavaScript object
    const result = JSON.parse(cleanedText);

    // Make sure Gemini returned courses
    if (!result.courses || !Array.isArray(result.courses)) {
      throw new Error("Invalid course data returned by Gemini");
    }

    /*
      Add the logged-in student's ID to every course.

      Gemini does NOT need to know the student's ID.
      The backend already knows it from req.body.student_id.
    */
    const coursesWithStudentId = result.courses.map((course) => ({
      student_id: studentId,
      course_code: course.course_code,
      course_name: course.course_name,
      grade: course.grade,
      credits: course.credits,
      Semester: course.Semester
    }));

    console.log("Saving grades:", coursesWithStudentId);

    // Save grades to Supabase
    const { data, error } = await supabase
     .from("grades")
     .upsert(coursesWithStudentId, {
      onConflict: "student_id,course_code,Semester",
      ignoreDuplicates: true
      })
        .select();

    if (error) {
      throw new Error(error.message);
    }

    // Delete uploaded image
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    // Send saved grades back to frontend
    res.json({
      student_id: studentId,
      courses: data
    });

  } catch (error) {
    console.error(error);

    // Delete image if something went wrong
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: error.message
    });
  }
});


// Get grades
app.get("/grades", async (req, res) => {
  try {
    const studentId = req.query.student_id;

    if (!studentId) {
      return res.status(400).json({
        error: "Student ID is required"
      });
    }

    const { data, error } = await supabase
      .from("grades")
      .select("*")
      .ilike("student_id", studentId);

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json(data);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

// Edit one grade row — lets a student fix a course_name/grade/credits
// value that Gemini misread from their transcript upload. Only the
// fields below are editable; student_id/course_code/Semester stay as-is
// so this can't be used to attach a grade to a different course/term.
app.put("/grades/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { grade, credits, course_name } = req.body;

    const updates = {};
    if (grade !== undefined) updates.grade = String(grade).trim().toUpperCase();
    if (credits !== undefined) {
      const numCredits = Number(credits);
      if (Number.isNaN(numCredits) || numCredits < 0) {
        return res.status(400).json({ error: "Credits must be a non-negative number." });
      }
      updates.credits = numCredits;
    }
    if (course_name !== undefined) updates.course_name = String(course_name).trim();

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Nothing to update." });
    }

    const { data, error } = await supabase
      .from("grades")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ grade: data });
  } catch (error) {
    console.error("PUT /grades/:id error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------
// STUDENT: self-added elective courses / status overrides (Graduation Check)
// ------------------------------------------------
// Lets a student manually add a course under one of the two open-selection
// requirement groups ("Other Major Elective Courses" / "C. Free Elective
// Course") instead of only via transcript upload — the frontend is what
// restricts *adding a brand-new course* to those two groups; this endpoint
// itself accepts any group name because a student can also set/override
// the status of a course already on Admin's pre-approved list in ANY
// group (Major Courses, General Education, Major Elective Group 1A/1B,
// ...). Kept in its own table rather than "grades" so it can never be
// mistaken for an OCR'd transcript row. Always scoped by student_id, same
// pattern as /grades and /registrations, so one student never sees or
// edits another's rows.
const ELECTIVE_COURSES_TABLE = "student_elective_courses";
const ELECTIVE_STATUSES = ["completed", "in-progress", "not-taken", "re-grade"];

app.get("/student-elective-courses", async (req, res) => {
  try {
    const studentId = req.query.student_id;
    if (!studentId) {
      return res.status(400).json({ error: "Student ID is required" });
    }

    const { data, error } = await supabase
      .from(ELECTIVE_COURSES_TABLE)
      .select("*")
      .ilike("student_id", studentId)
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    res.json(data || []);
  } catch (error) {
    console.error("GET /student-elective-courses error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Adds a brand-new course under a group, OR sets/corrects the status of a
// course that's already on Admin's pre-approved list for that group — same
// call either way. Upserted on (student_id, group_name, course_code) so
// calling this again for a code the student already has a row for updates
// that row in place instead of creating a duplicate.
app.post("/student-elective-courses", async (req, res) => {
  try {
    const { studentId, groupName, courseCode, courseName, credits, status } = req.body;

    if (!studentId) return res.status(400).json({ error: "studentId is required." });
    const trimmedGroupName = String(groupName || "").trim();
    if (!trimmedGroupName) return res.status(400).json({ error: "groupName is required." });

    const code = normalizeCourseCode(courseCode);
    if (!code) return res.status(400).json({ error: "Please enter a valid course code, e.g. CSX4202." });

    const numCredits = Number(credits);
    if (Number.isNaN(numCredits) || numCredits <= 0) {
      return res.status(400).json({ error: "Credits must be a positive number." });
    }

    const trimmedStatus = String(status || "").trim().toLowerCase();
    if (!ELECTIVE_STATUSES.includes(trimmedStatus)) {
      return res.status(400).json({ error: "status must be one of: " + ELECTIVE_STATUSES.join(", ") });
    }

    const { data, error } = await supabase
      .from(ELECTIVE_COURSES_TABLE)
      .upsert(
        {
          student_id: studentId,
          group_name: trimmedGroupName,
          course_code: code,
          course_name: String(courseName || "").trim(),
          credits: numCredits,
          status: trimmedStatus,
        },
        { onConflict: "student_id,group_name,course_code" }
      )
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({ course: data });
  } catch (error) {
    console.error("POST /student-elective-courses error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/student-elective-courses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.query.student_id;
    if (!studentId) return res.status(400).json({ error: "student_id is required." });

    // Scope the delete to this student's own id so one student can't
    // remove another's row by guessing/incrementing the numeric id.
    const { error } = await supabase
      .from(ELECTIVE_COURSES_TABLE)
      .delete()
      .eq("id", id)
      .ilike("student_id", studentId);

    if (error) return res.status(500).json({ error: error.message });

    res.status(204).end();
  } catch (error) {
    console.error("DELETE /student-elective-courses/:id error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------
// ADMIN: timetable image/PDF upload -> classes
// ------------------------------------------------

// Forces any time Gemini returns into a strict, zero-padded "HH:MM"
// 24-hour string (drops seconds like "09:00:00", pads "9:00" -> "09:00").
// Returns null if the value isn't a parseable time at all, so it falls
// through to the existing "missing field" review flow instead of saving
// a garbage time.
function normalizeTimeStr(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Extract a weekly class schedule from an uploaded timetable image/PDF
app.post("/extract-timetable", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded"
      });
    }

    console.log("Extracting timetable from:", req.file.originalname);

    const fileBuffer = fs.readFileSync(req.file.path);
    const base64 = fileBuffer.toString("base64");

    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      config: {
        // Deterministic reading — this is a transcription task, not a
        // creative one, so we don't want the model "guessing" a plausible
        // but wrong digit differently between blocks or between runs.
        temperature: 0,
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `
Get every class from this course timetable image/PDF.

Rules:
- Return ONLY valid JSON, no markdown fences.
- "day" must be one of: SUN, MON, TUE, WED, THU, FRI, SAT (3-letter, uppercase).
- "start" and "end" must be 24-hour "HH:MM" strings.
- "name" is the full course name shown for that class. Preserve it exactly; if it is not visible, use "".
- "section" is the section/Sec value shown for that class. Some source files put this value in a column labelled "Room"; treat that value as the section, not as a room. If missing, use "1".
- "code" is the course code (e.g. CSX3010). If two codes are slash-separated for a cross-listed class (e.g. "CSX4107 / ITX4107"), keep the full string exactly as printed, slash included.
- If the same course appears more than once (different day/time), list it as a separate entry each time.

TIME READING — CRITICAL:
- The timetable uses fixed 30-minute grid intervals.
- Both :00 and :30 are valid timetable times.
- NEVER round, snap, floor, or convert a :30 time to an hour.
- 13:30 must remain 13:30.
- 16:30 must remain 16:30.
- 09:30 must remain 09:30.
- 12:30 must remain 12:30.

HOW TO DETERMINE START:
1. Find the exact vertical gridline where the class block begins.
2. Determine which 30-minute grid position that line represents.
3. Use that exact position as "start".
4. Do NOT choose the nearest printed hour.
5. A class can start at :30 between two whole-hour labels.
6. Use the timetable gridline, not the visual padding/inset of the colored block.

HOW TO DETERMINE END:
1. Determine the exact start time first.
2. Count the number of 30-minute grid columns occupied by the class.
3. Calculate end = start + (column_count × 30 minutes).
4. Do NOT independently round or guess the right edge.

Examples:
- 09:00 + 6 columns = 12:00
- 09:30 + 6 columns = 12:30
- 13:00 + 6 columns = 16:00
- 13:30 + 6 columns = 16:30

If a block starts at 13:30 and spans six half-hour columns, return exactly:
"start": "13:30",
"end": "16:30"

Do NOT return:
"start": "13:00",
"end": "16:00"

DOUBLE-CHECK EVERY TIME:
- start must be on a 00 or 30 minute boundary.
- end must be on a 00 or 30 minute boundary.
- duration must match the counted grid columns.
- never round :30 to :00.

SAME TIME-SLOT SECTIONS:
- If multiple sections of the same course are displayed in the same day/time cell, read the shared start/end once.
- Use exactly the same start/end for every section in that shared slot.

GRID TIME LABELS:
- Return the printed time labels along the timetable axis as "gridTimeLabels".
- Return only labels actually printed in the image.
- Do not invent an extra label for the outer edge.

OTHER RULES:
- Ignore legends, headers, notes, seat counts and instructor names.
- If day, start or end is cut off, blocked, unclear or not visible, return null.
- Do NOT guess missing values.
- Still include a class if some fields are null.
- If the same course appears on multiple days/times, return each occurrence separately.

Return exactly this shape:
{ "gridTimeLabels": ["09:00", "09:30", "10:00", "..."], "classes": [ { "day": "MON", "code": "CSX3010", "name": "Data Structures and Algorithms", "section": "1", "start": "09:00", "end": "12:00" } ] }
              `
            },
            {
              inlineData: {
                mimeType: req.file.mimetype,
                data: base64
              }
            }
          ]
        }
      ]
    });

    const cleanedText = response.text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const result = JSON.parse(cleanedText);

    if (!result.classes || !Array.isArray(result.classes)) {
      throw new Error("Invalid timetable data returned by Gemini");
    }

    // Normalize every time to a strict "HH:MM" before anything else runs,
    // so formatting alone (missing zero-pad, stray seconds, etc.) can
    // never make two identical class times look different.
    result.classes = result.classes.map((cls) => ({
      ...cls,
      start: normalizeTimeStr(cls.start),
      end: normalizeTimeStr(cls.end),
    }));

    // Last-column fix: printed axis labels mark the START of each
    // column, so a class whose block visually reaches the grid's outer
    // edge actually ends one column-interval AFTER the last printed
    // label — but that boundary has no label of its own to read, so
    // asking Gemini to reason its way there per-block was unreliable in
    // practice. Instead we deterministically add one interval, in code,
    // to any class whose "end" landed exactly on the last printed label
    // — since a real class can't have zero duration, an "end" equal to
    // the very last axis label almost always means it was clamped there
    // instead of correctly landing one interval later.
    const gridLabels = Array.isArray(result.gridTimeLabels)
      ? result.gridTimeLabels.map(normalizeTimeStr).filter(Boolean)
      : [];
    if (gridLabels.length >= 2) {
      const labelMinutes = gridLabels
        .map((l) => {
          const [h, m] = l.split(":").map(Number);
          return h * 60 + m;
        })
        .sort((a, b) => a - b);
      const lastLabelMin = labelMinutes[labelMinutes.length - 1];
      const interval = labelMinutes[1] - labelMinutes[0];
      if (interval > 0) {
        result.classes = result.classes.map((cls) => {
          if (!cls.end) return cls;
          const [h, m] = cls.end.split(":").map(Number);
          const endMin = h * 60 + m;
          if (endMin === lastLabelMin) {
            const fixedMin = endMin + interval;
            const fixedH = String(Math.floor(fixedMin / 60)).padStart(2, "0");
            const fixedM = String(fixedMin % 60).padStart(2, "0");
            console.log(
              `Timetable extraction: bumped ${cls.code || "?"} end from ${cls.end} (last axis label) to ${fixedH}:${fixedM} (last-column edge case)`
            );
            return { ...cls, end: `${fixedH}:${fixedM}` };
          }
          return cls;
        });
      }
    }

    // Flag any class Gemini couldn't fully read (day/start/end missing)
    // instead of silently dropping or guessing it — the admin reviews
    // these on the frontend rather than losing them entirely.
    let classes = result.classes.map((cls) => {
      const missingFields = ["day", "start", "end"].filter(
        (field) => cls[field] === null || cls[field] === undefined || cls[field] === ""
      );
      return {
        ...cls,
        incomplete: missingFields.length > 0,
        missingFields,
      };
    });

    // Same course + same day, but times only ~close instead of exactly
    // equal, almost always means a shared time-slot got mis-transcribed
    // for one of its sections (see prompt rule above) rather than being
    // two genuinely different class times. Don't silently trust either
    // reading — route the whole group to the admin's review queue so
    // they confirm/fix the real time instead of getting a silently wrong
    // timetable (or a false "no matching section" on the student side).
    const CONFLICT_TOLERANCE_MIN = 20;
    const toMin = (hhmm) => {
      if (!hhmm) return null;
      const [h, m] = hhmm.split(":").map(Number);
      return h * 60 + m;
    };
    const byCourseDay = new Map();
    classes.forEach((cls, index) => {
      if (cls.incomplete || !cls.code || cls.day === null || cls.day === undefined) return;
      const groupKey = `${String(cls.code).trim().toUpperCase()}|${String(cls.day).trim().toUpperCase()}`;
      if (!byCourseDay.has(groupKey)) byCourseDay.set(groupKey, []);
      byCourseDay.get(groupKey).push(index);
    });
    byCourseDay.forEach((indices) => {
      if (indices.length < 2) return;
      for (let i = 0; i < indices.length; i++) {
        for (let j = i + 1; j < indices.length; j++) {
          const a = classes[indices[i]];
          const b = classes[indices[j]];
          const sameTime = a.start === b.start && a.end === b.end;
          if (sameTime) continue;
          const startDiff = Math.abs(toMin(a.start) - toMin(b.start));
          const endDiff = Math.abs(toMin(a.end) - toMin(b.end));
          const looksLikeMisread =
            startDiff <= CONFLICT_TOLERANCE_MIN && endDiff <= CONFLICT_TOLERANCE_MIN;
          if (looksLikeMisread) {
            [indices[i], indices[j]].forEach((idx) => {
              classes[idx] = {
                ...classes[idx],
                incomplete: true,
                missingFields: [
                  ...(classes[idx].missingFields || []),
                  `start/end (please verify — read as ${classes[idx].start}–${classes[idx].end}, but another ${classes[idx].code} section this same day read close but not identical; likely the same slot, misread)`,
                ],
              };
            });
          }
        }
      }
    });

    const incompleteCount = classes.filter((c) => c.incomplete).length;
    if (incompleteCount > 0) {
      console.log(
        `Timetable extraction: ${incompleteCount}/${classes.length} class(es) had missing fields`,
        classes.filter((c) => c.incomplete).map((c) => ({ code: c.code, missingFields: c.missingFields }))
      );
    }

    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.json({ classes });

  } catch (error) {
    console.error(error);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: error.message
    });
  }
});


// ------------------------------------------------
// COURSE TIMETABLE
// ------------------------------------------------
// Backs Admin > Course Timetable (full CRUD) and the Student Planner's
// "Which courses are open" grid (read-only there). Both talk to this
// backend, never to Supabase directly, same pattern as /grades above.
// See server/supabase_timetable.sql for the table definition.

const TIMETABLE_TABLE = "course_timetable";
const TIMETABLE_NOTE_TABLE = "course_timetable_note";
const DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DISPLAY_COLORS = ["#6B7280", "#E8833C", "#8E5FC7", "#5BB85C", "#F0BB3E", "#E1483F", "#4F93D6"];

function colorForCode(code) {
  const hash = [...String(code || "")].reduce((total, char) => total + char.charCodeAt(0), 0);
  return DISPLAY_COLORS[hash % DISPLAY_COLORS.length];
}

// DB row (snake_case) -> shape the frontend already works with (camelCase).
function rowToEntry(row) {
  return {
    id: row.id,
    day: DAY_NAMES.indexOf(row.day),
    code: row.code,
    name: row.name || "",
    section: row.sec || "1",
    start: String(row.start_time).slice(0, 5),
    end: String(row.end_time).slice(0, 5),
    // Colour is presentation-only; it is no longer stored in the database.
    color: colorForCode(row.code),
  };
}

// Frontend entry (camelCase) -> DB row (snake_case), for insert/update.
function entryToRow(entry) {
  return {
    day: DAY_NAMES[Number(entry.day)] || "Sunday",
    code: String(entry.code || "").trim(),
    name: entry.name ? String(entry.name).trim() : "",
    sec: entry.section ? String(entry.section).trim() : "1",
    start_time: entry.start,
    end_time: entry.end,
  };
}

// List every class in the timetable.
app.get("/timetable", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TIMETABLE_TABLE)
      .select("*")
      .order("day", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ entries: (data || []).map(rowToEntry) });
  } catch (error) {
    console.error("GET /timetable error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Add one class.
app.post("/timetable", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TIMETABLE_TABLE)
      .insert(entryToRow(req.body))
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({ entry: rowToEntry(data) });
  } catch (error) {
    console.error("POST /timetable error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Replace the whole table in one go — used when the admin uploads a
// timetable image/PDF and Gemini extracts a fresh set of classes.
app.post("/timetable/import", async (req, res) => {
  try {
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];

    const { error: deleteError } = await supabase
      .from(TIMETABLE_TABLE)
      .delete()
      .not("id", "is", null);
    if (deleteError) return res.status(500).json({ error: deleteError.message });

    if (entries.length === 0) return res.json({ entries: [] });

    const { data, error } = await supabase
      .from(TIMETABLE_TABLE)
      .insert(entries.map(entryToRow))
      .select();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ entries: (data || []).map(rowToEntry) });
  } catch (error) {
    console.error("POST /timetable/import error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Edit one class.
app.put("/timetable/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TIMETABLE_TABLE)
      .update(entryToRow(req.body))
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ entry: rowToEntry(data) });
  } catch (error) {
    console.error("PUT /timetable/:id error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete one class.
app.delete("/timetable/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from(TIMETABLE_TABLE)
      .delete()
      .eq("id", req.params.id);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE /timetable/:id error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get/set the free-text note shown above the admin grid.
app.get("/timetable-note", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TIMETABLE_NOTE_TABLE)
      .select("note")
      .eq("id", 1)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ note: data?.note || "" });
  } catch (error) {
    console.error("GET /timetable-note error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/timetable-note", async (req, res) => {
  try {
    const { error } = await supabase
      .from(TIMETABLE_NOTE_TABLE)
      .upsert({ id: 1, note: req.body.note || "" });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
  } catch (error) {
    console.error("PUT /timetable-note error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------
// PRE-REQUIRE: course prerequisites (Admin CRUD + Student check)
// ------------------------------------------------
// Backs Admin > Pre-Require (full CRUD) and the Student Pre-Require /
// Planner pages (read-only there). See server/supabase_prerequisites.sql
// for the table definition.

const PREREQ_TABLE = "course_prerequisites";
const REGISTRATIONS_TABLE = "student_registrations";
const REQUESTED_COURSES_TABLE = "requested_unscheduled_courses";
const ADVISOR_MESSAGES_TABLE = "advisor_messages";
const BOBBY_MESSAGES_TABLE = "bobby_chat_messages";
const COURSES_TABLE = "courses";
const ADVISOR_RECOMMENDATIONS_TABLE = "advisor_course_recommendation";
const PREREQ_GROUP_COLUMNS = { g1: "g1_text", g2: "g2_text", g3: "g3_text" };

// Pulls course codes like "CSX3002" or "ITX2007" out of free-form
// prerequisite text, so a rule like "CSX3001 Fundamentals of Computer
// Programming and ITX2007 Data Science" can be checked automatically
// against a student's completed grades without the admin having to fill
// in a separate structured field.
function extractCourseCodes(text) {
  if (!text) return [];
  const matches = String(text).toUpperCase().match(/[A-Z]{2,4}(?:\s*-\s*|\s*)\d{3,4}/g);
  return matches ? [...new Set(matches.map(normalizeCourseCode).filter(Boolean))] : [];
}

function normalizeCourseCode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2,4}\d{3,4}$/.test(compact) ? compact : "";
}

// Keep the registration endpoint aligned with the prerequisite group shown
// in the student UI. The group is derived from the student ID, not trusted
// from a value sent by the browser.
function getPrereqGroupForStudent(studentId) {
  const digits = String(studentId || "").replace(/\D/g, "");
  if (digits.length < 3) return null;

  const year = Number(digits.slice(0, 2));
  const revision = Number(digits.slice(2, 3));
  if (!Number.isFinite(year) || !Number.isFinite(revision)) return null;

  if (year < 65) return "g1";
  if (year === 65) return revision <= 2 ? "g2" : "g3";
  return "g3";
}

// Pulls a "Year N and >= M credits" style rule out of free text (used for
// things like Senior Project I/II). Returns null if the text doesn't
// look like that pattern.
function extractYearCreditRule(text) {
  if (!text) return null;
  const yearMatch = String(text).match(/Year\s*(\d)/i);
  const creditMatch = String(text).match(/>=\s*(\d+)\s*credits?/i);
  if (!yearMatch && !creditMatch) return null;
  return {
    minYear: yearMatch ? Number(yearMatch[1]) : null,
    minCredits: creditMatch ? Number(creditMatch[1]) : null,
  };
}

function rowToPrereq(row) {
  return {
    id: row.id,
    course_code: row.course_code,
    course_title: row.course_title || "",
    g1_text: row.g1_text || "",
    g2_text: row.g2_text || "",
    g3_text: row.g3_text || "",
  };
}

// Admin uploads an image or PDF of the course-prerequisite sheet (like
// the university's official table) and Gemini reads it into rows. The
// frontend then bulk-saves the result via POST /prerequisites/import
// (below) — same "extract then import" pattern as the timetable upload.
app.post("/extract-prerequisites", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log(
      "Extracting prerequisites from:",
      req.file.originalname,
      "mimetype:",
      req.file.mimetype,
      "size:",
      req.file.size
    );

    // Gemini's inlineData only accepts specific MIME types — anything
    // else (a .heic photo straight off an iPhone, a .doc, a corrupted
    // upload with no detected type, etc.) gets rejected by the API with
    // a generic "INVALID_ARGUMENT" that gives the admin no clue what
    // went wrong. Catch it here instead, with a message that tells them
    // what to do about it.
    const SUPPORTED_MIME_TYPES = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf",
    ];
    if (!SUPPORTED_MIME_TYPES.includes(req.file.mimetype)) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: `File type "${req.file.mimetype || "unknown"}" is not supported. Please upload a JPG, PNG, or PDF file only.`,
      });
    }

    const fileBuffer = fs.readFileSync(req.file.path);
    if (fileBuffer.length === 0) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "The uploaded file is empty. Please try a different file." });
    }
    const base64 = fileBuffer.toString("base64");

    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      config: {
        // Deterministic reading — transcription, not creative writing.
        temperature: 0,
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `
Read every row from this course-prerequisite table (image or PDF).

The table has these columns, in this order:
1. "Courses" — the course code, e.g. "CSX3007".
2. "Title" — the course title, e.g. "Computer Architecture".
3. A prerequisite column for the earliest student batch/curriculum group (its header usually looks like "Prerequisite for 621 - 643" or similar batch/year range).
4. A prerequisite column for the middle student batch/curriculum group (its header usually looks like "Prerequisite for 651 - 652" or similar).
5. A prerequisite column for the latest student batch/curriculum group ("... onwards"), e.g. "Prerequisite for 653 onwards".

There may be more than 3 prerequisite columns in the source, or the columns may be labelled differently — always map them, in left-to-right order, to g1_text (earliest group), g2_text (middle group), g3_text (latest group). If there are only 1 or 2 prerequisite columns total, still map them left-to-right into g1_text, g2_text (leave g3_text "" if there is no third column) — never invent a column that isn't there.

Rules:
- Return ONLY valid JSON, no markdown fences.
- Preserve prerequisite text exactly as printed (e.g. "CSX3001 Fundamentals of Computer Programming and ITX2007 Data Science", or "Year 3 and >= 72 credits").
- If a cell is empty / has no prerequisite, use "".
- "course_code" should be uppercase, no spaces (e.g. "CSX3007").
- Skip the header row(s) themselves — only return actual course rows.
- If a row's course code is unreadable, skip that row entirely rather than guessing.

Return exactly this shape:
{ "rows": [ { "course_code": "CSX3007", "course_title": "Computer Architecture", "g1_text": "", "g2_text": "", "g3_text": "" } ] }
              `,
            },
            {
              inlineData: {
                mimeType: req.file.mimetype,
                data: base64,
              },
            },
          ],
        },
      ],
    });

    const cleanedText = response.text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const result = JSON.parse(cleanedText);

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    if (!result.rows || !Array.isArray(result.rows)) {
      throw new Error("Invalid prerequisite data returned by Gemini");
    }

    const rows = result.rows
      .filter((r) => r.course_code && String(r.course_code).trim())
      .map((r) => ({
        course_code: String(r.course_code).trim().toUpperCase(),
        course_title: r.course_title ? String(r.course_title).trim() : "",
        g1_text: r.g1_text ? String(r.g1_text).trim() : "",
        g2_text: r.g2_text ? String(r.g2_text).trim() : "",
        g3_text: r.g3_text ? String(r.g3_text).trim() : "",
      }));

    res.json({ rows });
  } catch (error) {
    console.error("POST /extract-prerequisites error:", error);
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    const raw = error?.message || "";
    let friendly = raw || "Failed to read the uploaded file.";
    if (raw.includes("INVALID_ARGUMENT")) {
      friendly =
        "Gemini could not read this file (INVALID_ARGUMENT) — usually caused by a corrupted file, a file that isn't actually an image/PDF, or a file that's too large. Try a different JPG/PNG image or PDF (recommended under ~10MB).";
    } else if (raw.includes("RESOURCE_EXHAUSTED") || raw.includes("429")) {
      friendly = "Too many requests to the Gemini API (rate limit) — please wait a moment and try again.";
    } else if (raw.includes("API key") || raw.includes("PERMISSION_DENIED") || raw.includes("403")) {
      friendly = "The GEMINI_API_KEY in server/.env is invalid or expired.";
    }

    res.status(500).json({ error: friendly, rawError: raw });
  }
});

// List every course's prerequisites.
app.get("/prerequisites", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(PREREQ_TABLE)
      .select("*")
      .order("course_code", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ prerequisites: (data || []).map(rowToPrereq) });
  } catch (error) {
    console.error("GET /prerequisites error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Add one course's prerequisite row.
app.post("/prerequisites", async (req, res) => {
  try {
    const { course_code, course_title, g1_text, g2_text, g3_text } = req.body;

    if (!course_code || !String(course_code).trim()) {
      return res.status(400).json({ error: "Course code is required." });
    }

    const { data, error } = await supabase
      .from(PREREQ_TABLE)
      .insert({
        course_code: String(course_code).trim().toUpperCase(),
        course_title: course_title || "",
        g1_text: g1_text || "",
        g2_text: g2_text || "",
        g3_text: g3_text || "",
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({ prerequisite: rowToPrereq(data) });
  } catch (error) {
    console.error("POST /prerequisites error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk replace the whole table — used by the Admin "import from Excel /
// paste table" flow, same pattern as /timetable/import.
app.post("/prerequisites/import", async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

    const { error: deleteError } = await supabase
      .from(PREREQ_TABLE)
      .delete()
      .not("id", "is", null);
    if (deleteError) return res.status(500).json({ error: deleteError.message });

    if (rows.length === 0) return res.json({ prerequisites: [] });

    const { data, error } = await supabase
      .from(PREREQ_TABLE)
      .insert(
        rows.map((r) => ({
          course_code: String(r.course_code || "").trim().toUpperCase(),
          course_title: r.course_title || "",
          g1_text: r.g1_text || "",
          g2_text: r.g2_text || "",
          g3_text: r.g3_text || "",
        }))
      )
      .select();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ prerequisites: (data || []).map(rowToPrereq) });
  } catch (error) {
    console.error("POST /prerequisites/import error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Edit one course's prerequisite row.
app.put("/prerequisites/:id", async (req, res) => {
  try {
    const { course_code, course_title, g1_text, g2_text, g3_text } = req.body;

    const { data, error } = await supabase
      .from(PREREQ_TABLE)
      .update({
        course_code: course_code ? String(course_code).trim().toUpperCase() : undefined,
        course_title,
        g1_text,
        g2_text,
        g3_text,
      })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ prerequisite: rowToPrereq(data) });
  } catch (error) {
    console.error("PUT /prerequisites/:id error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete one course's prerequisite row.
app.delete("/prerequisites/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from(PREREQ_TABLE)
      .delete()
      .eq("id", req.params.id);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE /prerequisites/:id error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Check whether a student can register a course: pass student_id,
// course_code, and their prerequisite group (g1/g2/g3). Compares the
// course codes required by that group's rule text against the student's
// completed grades (any non-F, non-W grade). Also checks a "Year N and
// >= M credits" style rule if present (e.g. Senior Project).
app.get("/prerequisites/check", async (req, res) => {
  try {
    const { student_id, course_code, group, year, credits } = req.query;

    if (!student_id || !course_code) {
      return res.status(400).json({ error: "student_id and course_code are required." });
    }

    const groupColumn = PREREQ_GROUP_COLUMNS[group] || null;

    const { data: prereqRow, error: prereqError } = await supabase
      .from(PREREQ_TABLE)
      .select("*")
      .eq("course_code", String(course_code).trim().toUpperCase())
      .maybeSingle();

    if (prereqError) return res.status(500).json({ error: prereqError.message });

    // No prerequisite row on file for this course at all -> nothing to
    // block on.
    if (!prereqRow) {
      return res.json({ eligible: true, reason: null, requiredCourses: [] });
    }

    const ruleText = groupColumn ? prereqRow[groupColumn] : "";

    // No group selected, or that group has no rule text -> can't check,
    // so don't block (surfaced to the student as a warning, not an error).
    if (!ruleText || !String(ruleText).trim()) {
      return res.json({ eligible: true, reason: null, requiredCourses: [] });
    }

    const requiredCourses = extractCourseCodes(ruleText).filter(
      (code) => code !== String(course_code).trim().toUpperCase()
    );
    const yearCreditRule = extractYearCreditRule(ruleText);

    const { data: grades, error: gradesError } = await supabase
      .from("grades")
      .select("course_code, grade")
      .eq("student_id", student_id);

    if (gradesError) return res.status(500).json({ error: gradesError.message });

    const passedCodes = new Set(
      (grades || [])
        .filter((g) => {
          const grade = (g.grade || "").trim().toUpperCase();
          return grade && grade !== "F" && grade !== "W" && grade !== "I";
        })
        .map((g) => (g.course_code || "").trim().toUpperCase())
    );

    const missingCourses = requiredCourses.filter((code) => !passedCodes.has(code));

    const problems = [];
    if (missingCourses.length > 0) {
      problems.push(`Has not yet passed: ${missingCourses.join(", ")}`);
    }
    if (yearCreditRule?.minYear && Number(year || 0) < yearCreditRule.minYear) {
      problems.push(`Must be in academic year ${yearCreditRule.minYear} or higher`);
    }
    if (yearCreditRule?.minCredits && Number(credits || 0) < yearCreditRule.minCredits) {
      problems.push(`Must have earned >= ${yearCreditRule.minCredits} credits`);
    }

    res.json({
      eligible: problems.length === 0,
      reason: problems.length > 0 ? problems.join(" and ") : null,
      requiredCourses,
      ruleText,
    });
  } catch (error) {
    console.error("GET /prerequisites/check error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------
// CURRICULUM REQUIREMENTS: Admin "Upload Table Data" (full CRUD) + the
// Student Planner / Graduation Check (read-only there). See
// server/supabase_curricula.sql for the table definitions.
// ------------------------------------------------

const CURRICULA_TABLE = "curricula";
const CURRICULUM_GROUPS_TABLE = "curriculum_groups";

function groupRowToBlock(row) {
  return {
    id: String(row.id),
    label: row.label || "",
    group: row.course_group || "",
    mode: row.mode === "choose" ? "choose" : "all",
    chooseCount: row.choose_count || 0,
    creditsRequired: row.credits_required || 0,
    courses: Array.isArray(row.courses) ? row.courses : [],
    // Admin's "student picks only one of these groups" checkbox on Upload
    // Table Data — see supabase_curriculum_groups_choose_one.sql and
    // client/src/utils/electiveGroup.js.
    chooseOneGroup: Boolean(row.is_choose_one_group),
    // Admin's "Student can add subject" checkbox on Upload Table Data —
    // see supabase_curriculum_groups_allow_add.sql and
    // client/src/utils/studentElectiveCourses.js canAddCourseToGroup.
    allowAddCourse: Boolean(row.allow_add_course),
  };
}

function blockToGroupRow(curriculumYear, block, index) {
  return {
    curriculum_year: curriculumYear,
    sort_order: index,
    label: block.label || "",
    course_group: block.group || "",
    mode: block.mode === "choose" ? "choose" : "all",
    choose_count: Number(block.chooseCount) || 0,
    credits_required: Number(block.creditsRequired) || 0,
    courses: Array.isArray(block.courses) ? block.courses : [],
    is_choose_one_group: Boolean(block.chooseOneGroup),
    allow_add_course: Boolean(block.allowAddCourse),
  };
}

// Mirrors client/src/utils/graduation.js courseMatchesRule — matches
// either an exact curriculum code or a range such as "CSX4280-4299" /
// shorthand "CSX4183-99". Kept as a standalone copy here (rather than
// imported) since the client version's module chain pulls in
// browser-only localStorage helpers that don't run under Node.
function courseMatchesRule(completedCode, curriculumCode) {
  const completed = normalizeCourseCode(completedCode);
  if (!completed) return false;

  const exact = normalizeCourseCode(curriculumCode);
  if (exact) return completed === exact;

  const compactRule = String(curriculumCode || "").toUpperCase().replace(/\s+/g, "");
  const range = compactRule.match(/^([A-Z]{2,4})(\d{4})-(?:[A-Z]{2,4})?(\d{2,4})$/);
  if (!range) return false;

  const completedMatch = completed.match(/^([A-Z]{2,4})(\d{3,4})$/);
  if (!completedMatch || completedMatch[1] !== range[1]) return false;

  const start = Number(range[2]);
  const rawEnd = range[3];
  const end = rawEnd.length === 2
    ? Math.floor(start / 100) * 100 + Number(rawEnd)
    : Number(rawEnd);
  const number = Number(completedMatch[2]);
  return number >= start && number <= end;
}

// List every curriculum year, each with its requirement blocks — shaped as
// { curricula: { [year]: { year, programName, totalCreditsRequired, minGpa, groups: [...] } } }
// to match what client/src/utils/curriculum.js already expects.
app.get("/curricula", async (req, res) => {
  try {
    const [{ data: years, error: yearsError }, { data: groups, error: groupsError }] = await Promise.all([
      supabase.from(CURRICULA_TABLE).select("*"),
      supabase.from(CURRICULUM_GROUPS_TABLE).select("*").order("sort_order", { ascending: true }),
    ]);

    if (yearsError) return res.status(500).json({ error: yearsError.message });
    if (groupsError) return res.status(500).json({ error: groupsError.message });

    const curricula = {};
    (years || []).forEach((row) => {
      curricula[row.year] = {
        year: row.year,
        programName: row.program_name || "",
        totalCreditsRequired: row.total_credits_required || 0,
        minGpa: row.min_gpa || 0,
        groups: [],
      };
    });
    (groups || []).forEach((row) => {
      if (curricula[row.curriculum_year]) {
        curricula[row.curriculum_year].groups.push(groupRowToBlock(row));
      }
    });

    res.json({ curricula });
  } catch (error) {
    console.error("GET /curricula error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create/replace one curriculum year and its whole set of requirement
// blocks in one go — this is what the "Save" button on Admin > Upload
// Table Data calls.
app.put("/curricula/:year", async (req, res) => {
  try {
    const year = String(req.params.year || "").trim();
    if (!year) return res.status(400).json({ error: "Curriculum year is required." });

    const { programName, totalCreditsRequired, minGpa, groups } = req.body;

    const { error: upsertError } = await supabase.from(CURRICULA_TABLE).upsert({
      year,
      program_name: programName || "",
      total_credits_required: Number(totalCreditsRequired) || 0,
      min_gpa: Number(minGpa) || 0,
    });
    if (upsertError) return res.status(500).json({ error: upsertError.message });

    const { error: deleteError } = await supabase
      .from(CURRICULUM_GROUPS_TABLE)
      .delete()
      .eq("curriculum_year", year);
    if (deleteError) return res.status(500).json({ error: deleteError.message });

    const blocks = Array.isArray(groups) ? groups : [];
    let savedGroups = [];
    if (blocks.length > 0) {
      const { data, error: insertError } = await supabase
        .from(CURRICULUM_GROUPS_TABLE)
        .insert(blocks.map((block, index) => blockToGroupRow(year, block, index)))
        .select();
      if (insertError) return res.status(500).json({ error: insertError.message });
      savedGroups = (data || []).sort((a, b) => a.sort_order - b.sort_order).map(groupRowToBlock);
    }

    res.json({
      curriculum: {
        year,
        programName: programName || "",
        totalCreditsRequired: Number(totalCreditsRequired) || 0,
        minGpa: Number(minGpa) || 0,
        groups: savedGroups,
      },
    });
  } catch (error) {
    console.error("PUT /curricula/:year error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a curriculum year (its requirement blocks cascade with it).
app.delete("/curricula/:year", async (req, res) => {
  try {
    const { error } = await supabase.from(CURRICULA_TABLE).delete().eq("year", req.params.year);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error("DELETE /curricula/:year error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------
// STUDENT MAJOR ELECTIVE GROUP: which one of Admin's "choose one of these
// groups" set (e.g. Major Elective Group 1A vs 1B — see
// is_choose_one_group on curriculum_groups) the student is working
// toward — set from Goal and Career, read by Graduation Check and the
// Planner's "Check course left" to filter to just that group's block.
// ------------------------------------------------

app.get("/student-elective-group/:studentId", async (req, res) => {
  try {
    const studentId = String(req.params.studentId || "").trim().toUpperCase();

    const { data, error } = await supabase
      .from("students")
      .select("student_id, elective_group")
      .eq("student_id", studentId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    res.json({
      student_id: studentId,
      elective_group: data?.elective_group || null,
    });
  } catch (error) {
    console.error("GET /student-elective-group error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/student-elective-group/:studentId", async (req, res) => {
  try {
    const studentId = String(req.params.studentId || "").trim().toUpperCase();
    const electiveGroup = String(req.body.electiveGroup || "").trim();

    // Not hard-coded to any particular group name — this stores whichever
    // group heading (block.label) the student picked from the "choose one
    // of these groups" set Admin ticked on Upload Table Data, e.g. "Major
    // Elective Courses (Group 1A) - Software Engineering and Development".
    // See client/src/utils/electiveGroup.js getBlockElectiveGroupId for the
    // matching shape used when reading these blocks back out.
    if (!studentId || !electiveGroup) {
      return res.status(400).json({ error: "Student ID and a group choice are required." });
    }

    const { data, error } = await supabase
      .from("students")
      .upsert({ student_id: studentId, elective_group: electiveGroup }, { onConflict: "student_id" })
      .select("student_id, elective_group")
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  } catch (error) {
    console.error("PUT /student-elective-group error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/test-gemini", async (req, res) => {
  try {
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: "Say hello"
    });

    res.json({
      success: true,
      response: response.text
    });

  } catch (error) {
    console.error("Gemini test error:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Turns a raw Gemini/API error into the same kind of plain-English
// message used elsewhere (/extract-prerequisites etc.) so a bad or
// missing GEMINI_API_KEY, a rate limit, or a malformed request all read
// as something a non-developer can act on.
function friendlyGeminiError(error) {
  const raw = error?.message || "";
  if (raw.includes("RESOURCE_EXHAUSTED") || raw.includes("429")) {
    return "Too many requests to the Gemini API (rate limit) — please wait a moment and try again.";
  }
  if (raw.includes("API key") || raw.includes("PERMISSION_DENIED") || raw.includes("403")) {
    return "The GEMINI_API_KEY in server/.env is invalid or expired.";
  }
  return raw || "Bobby couldn't respond right now. Please try again.";
}

// ------------------------------------------------
// BOBBY ADVISOR: AI chat grounded in the student's own academic record.
// Gathers the same data the Planner/Graduation Check pages read
// (profile, grades, curriculum requirements, requested/registered
// courses, elective group) straight from Supabase, hands it to Gemini
// as context, and asks it to answer only from that data — never about
// another student, and never inventing a course/grade/requirement that
// isn't in the context.
// ------------------------------------------------
// Same batch-code parsing prereqGroup.js/curriculum.js use client-side —
// student IDs start with "U" followed by a 3-digit batch code whose first
// two digits are the Thai Buddhist-era admission year (e.g. "U6610001" ->
// "66" -> B.E. 2566 -> C.E. 2023). Falls back to the closest available
// curriculum year not exceeding that admission year, same as
// getCurriculumYearForStudent in client/src/utils/curriculum.js — kept as
// a standalone copy for the same reason as courseMatchesRule above.
function deriveCurriculumYearFromId(studentIdValue, availableYears) {
  const digits = String(studentIdValue || "").replace(/\D/g, "");
  if (digits.length < 3) return null;
  const beYear = Number(digits.slice(0, 2));
  if (!Number.isFinite(beYear)) return null;
  const ceYear = 1957 + beYear;

  if (availableYears.includes(String(ceYear))) return String(ceYear);
  const numericYears = availableYears.map(Number).filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
  const notExceeding = numericYears.filter((y) => y <= ceYear);
  if (notExceeding.length > 0) return String(notExceeding[notExceeding.length - 1]);
  return numericYears.length > 0 ? String(numericYears[0]) : null;
}

// Bobby's saved conversation for one student — lets the chat page pick up
// where it left off after a reload/new session instead of starting blank
// every time. Written to by POST /chat/bobby below.
app.get("/chat/bobby/:studentId", async (req, res) => {
  try {
    const studentId = String(req.params.studentId || "").trim().toUpperCase();
    if (!studentId) return res.status(400).json({ error: "studentId is required." });

    const { data, error } = await supabase
      .from(BOBBY_MESSAGES_TABLE)
      .select("id, role, text, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Rows are stored encrypted (see encryptChatText) — decrypt each
    // one's text here so the client only ever sees plain chat text.
    const messages = (data || []).map((row) => ({
      ...row,
      text: decryptChatText(row.text),
    }));

    res.json({ messages });
  } catch (error) {
    console.error("GET /chat/bobby/:studentId error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/chat/bobby", async (req, res) => {
  try {
    const studentId = String(req.body.student_id || "").trim().toUpperCase();
    const message = String(req.body.message || "").trim();
    // Short rolling history from the client: [{ role: "user"|"bot", text }]
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-10) : [];

    if (!studentId) return res.status(400).json({ error: "student_id is required." });
    if (!message) return res.status(400).json({ error: "message is required." });

    const [
      { data: student, error: studentError },
      { data: grades, error: gradesError },
      { data: registrations },
      { data: requestedCourses },
      { data: curriculumYears },
      { data: curriculumGroups },
      { data: courseCatalog },
    ] = await Promise.all([
      supabase
        .from("students")
        .select("student_id, name, curriculum_year, advisor_id, elective_group, goals, career_interests")
        .ilike("student_id", studentId)
        .maybeSingle(),
      supabase.from("grades").select("course_code, course_name, grade, credits, Semester").ilike("student_id", studentId),
      supabase.from(REGISTRATIONS_TABLE).select("course_code, Semester").ilike("student_id", studentId),
      supabase.from(REQUESTED_COURSES_TABLE).select("course_code, course_name").ilike("student_id", studentId),
      supabase.from(CURRICULA_TABLE).select("*"),
      supabase.from(CURRICULUM_GROUPS_TABLE).select("*").order("sort_order", { ascending: true }),
      // Admin > All Courses descriptions — lets Bobby describe any course
      // by code or title, not just ones on this student's own record.
      supabase.from(COURSES_TABLE).select("course_code, course_title, credits, description, course_group"),
    ]);

    if (studentError) return res.status(500).json({ error: studentError.message });
    if (!student) return res.status(404).json({ error: "Student ID not recognized." });
    if (gradesError) return res.status(500).json({ error: gradesError.message });

    // Normalize both sides before comparing (a stray space or number-vs-
    // string mismatch between the student record and the curricula table
    // would otherwise make a real match look like "no curriculum found").
    // If the student's own curriculum_year is blank or still doesn't
    // match any uploaded year, fall back to inferring it from their
    // student ID — the same fallback Graduation Check already relies on
    // via getCurriculumYearForStudent — so Bobby doesn't come up empty
    // just because that field was never set on this student's record.
    const availableYears = (curriculumYears || []).map((row) => String(row.year).trim());
    let curriculumYear = String(student.curriculum_year || "").trim();
    let yearRow = (curriculumYears || []).find((row) => String(row.year).trim() === curriculumYear);
    if (!yearRow) {
      const inferredYear = deriveCurriculumYearFromId(student.student_id, availableYears);
      if (inferredYear) {
        curriculumYear = inferredYear;
        yearRow = (curriculumYears || []).find((row) => String(row.year).trim() === curriculumYear);
      }
    }
    const groupRows = (curriculumGroups || []).filter((row) => String(row.curriculum_year).trim() === curriculumYear);

    // Same passing-grade set the client's own graduation logic uses —
    // F/W/WF/I don't count as completed credit.
    const NON_PASSING_GRADES = new Set(["F", "W", "WF", "I", ""]);
    const completedCourses = (grades || []).filter(
      (g) => !NON_PASSING_GRADES.has(String(g.grade || "").trim().toUpperCase())
    );
    const totalCreditsEarned = completedCourses.reduce((sum, g) => sum + (Number(g.credits) || 0), 0);

    // One row per course code (a retake would otherwise count its credits
    // twice) — keep whichever attempt has the higher credit value, in
    // case an older row has a blank credits field.
    const passedByCode = new Map();
    completedCourses.forEach((g) => {
      const code = normalizeCourseCode(g.course_code);
      if (!code) return;
      const existing = passedByCode.get(code);
      if (!existing || (Number(g.credits) || 0) > (Number(existing.credits) || 0)) {
        passedByCode.set(code, g);
      }
    });
    const passedCodes = Array.from(passedByCode.keys());

    // Same "choose one elective group" filter Graduation Check applies —
    // a chooseOneGroup block (e.g. picking one concentration track out of
    // several) only counts toward this student if it's the one they
    // actually selected on their profile.
    const relevantGroupRows = groupRows.filter((row) => {
      if (!row.is_choose_one_group) return true;
      return student.elective_group && row.label === student.elective_group;
    });

    // Per-category (major requirement / general education / major
    // elective / etc. — whatever each block is labeled) credit progress,
    // computed here rather than left for Gemini to add up, so the
    // numbers Bobby reports are always exactly right.
    const requirementProgress = relevantGroupRows.map((row) => {
      const block = groupRowToBlock(row);
      const rules = Array.isArray(block.courses) ? block.courses : [];
      const matchingCodes = passedCodes.filter((code) =>
        rules.some((rule) => courseMatchesRule(code, rule.code))
      );
      const completedCredits = matchingCodes.reduce(
        (sum, code) => sum + (Number(passedByCode.get(code)?.credits) || 0),
        0
      );
      const requiredCredits = Number(block.creditsRequired) || 0;
      const remainingCredits = Math.max(requiredCredits - completedCredits, 0);
      // A specific missing-course list only makes sense for "all
      // required" blocks — a "choose N of these" elective block doesn't
      // have one fixed set of courses still owed.
      const missingCourses = block.mode === "all"
        ? rules
            .filter((rule) => !passedCodes.some((code) => courseMatchesRule(code, rule.code)))
            .map((rule) => `${rule.code}${rule.name ? " " + rule.name : ""}`.trim())
        : [];

      return {
        category: block.label || block.group || "Requirement",
        required_credits: requiredCredits,
        completed_credits: completedCredits,
        remaining_credits: remainingCredits,
        satisfied: requiredCredits === 0 || remainingCredits === 0,
        missing_courses: missingCourses,
      };
    });

    const totalCreditsRequired = Number(yearRow?.total_credits_required) || 0;
    const totalCreditsRemaining = Math.max(totalCreditsRequired - totalCreditsEarned, 0);

    // Compact context — only what Bobby needs, not raw table dumps.
    const context = {
      student: {
        student_id: student.student_id,
        name: student.name,
        curriculum_year: curriculumYear,
        elective_group: student.elective_group || null,
        has_advisor: Boolean(student.advisor_id),
        goals: Array.isArray(student.goals) ? student.goals : [],
        career_interests: Array.isArray(student.career_interests) ? student.career_interests : [],
      },
      curriculum_requirements: yearRow
        ? {
            program_name: yearRow.program_name,
            total_credits_required: yearRow.total_credits_required,
            min_gpa: yearRow.min_gpa,
            requirement_groups: groupRows.map((row) => ({
              label: row.label,
              credits_required: row.credits_required,
              mode: row.mode === "choose" ? `choose ${row.choose_count}` : "all required",
              courses: row.courses,
            })),
          }
        : null,
      // Already-computed remaining-credit breakdown, one entry per
      // requirement category (major requirement, general education,
      // major elective, etc. — exactly as each block is labeled in
      // curriculum_requirements). Use these numbers as-is.
      requirement_progress: requirementProgress,
      credits_summary: {
        total_credits_required: totalCreditsRequired,
        total_credits_earned: totalCreditsEarned,
        total_credits_remaining: totalCreditsRemaining,
      },
      completed_courses: completedCourses.map((g) => ({
        code: g.course_code,
        name: g.course_name,
        grade: g.grade,
        credits: g.credits,
        semester: g.Semester,
      })),
      total_credits_earned: totalCreditsEarned,
      currently_registered_courses: (registrations || []).map((r) => r.course_code),
      requested_unscheduled_courses: (requestedCourses || []).map((r) => r.course_code),
      // Every cataloged course — code, title, group, and Admin's
      // description when one has been entered (empty string otherwise).
      // Bobby uses the description when present, and otherwise infers a
      // short summary from the title/code — see ground rules below.
      // Titles are what makes that inference possible, so courses are
      // kept here even without a description; only rows missing both a
      // code and a title are dropped as unusable.
      course_catalog: (courseCatalog || [])
        .filter((c) => c.course_code || c.course_title)
        .map((c) => ({
          code: c.course_code,
          title: c.course_title || "",
          credits: c.credits,
          group: c.course_group || "",
          description: c.description
            ? String(c.description).slice(0, 500)
            : "",
        })),
    };

    const systemInstructions = `
You are "Bobby", the friendly AI academic advisor built into this student's portal.

Ground rules:
- Only answer using the STUDENT DATA JSON below — it is this one student's own record. Never invent a course code, grade, credit value, or requirement that isn't in it.
- Never discuss or compare another student's data — you don't have it.
- If the STUDENT DATA doesn't contain enough to answer (e.g. curriculum_requirements is null, or something needs a human judgment call), say so plainly and suggest they message their human advisor or check with the registrar — don't guess.
- credits_summary and requirement_progress are already fully calculated — total_credits_remaining, and each category's own remaining_credits, are exact numbers. State them directly; never recompute or re-derive credit totals yourself, and never contradict them.
- When asked how many credits are left (overall or "what do I still need"), report credits_summary.total_credits_remaining, then break it down using requirement_progress — one line per category (its category label, e.g. "Major Requirement" / "General Education" / "Major Elective" — exactly as labeled, plus its own remaining_credits), and name the specific missing_courses for any category that lists them. Skip categories that are already satisfied unless asked for the full picture.
- You can: summarize progress, list remaining requirement groups/courses by category, explain a grade or credit total, describe what a course is about (by code or title) using course_catalog, suggest electives that fit the student's goals/career_interests (if set) alongside their remaining requirements, sanity-check whether a course looks safe to plan next (based on completed courses vs listed prerequ courses if present), and give general encouragement/study tips.
- Describing a course: if its course_catalog entry has a non-empty description, use that. If the description is empty, or the course isn't in course_catalog at all but its code/title is known from elsewhere in STUDENT DATA, give a short, natural, best-guess summary of what it likely covers, based on its title, code prefix, and course group, the way anyone familiar with common course-naming conventions would. Speak with ordinary confidence — do not hedge with phrases like "probably", "I'm guessing", or "likely covers", and never mention that a description is missing, unofficial, unavailable, or something Admin/the department should add. If a title alone gives you nothing to go on, say you don't have enough to describe that one and suggest checking the syllabus or department — don't fabricate specifics you can't reasonably infer from the name.
- You cannot: register/drop courses, change grades, or promise official graduation status — that's a Registrar/Advisor decision. Frame graduation-readiness talk as "based on your records so far", not a guarantee.
- Keep replies conversational and concise (a few sentences, or a short list) — not a wall of text.

STUDENT DATA:
${JSON.stringify(context)}
`.trim();

    const contents = [
      { role: "user", parts: [{ text: systemInstructions }] },
      { role: "model", parts: [{ text: "Understood — I'll answer only from that student's data." }] },
      ...history.map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: String(m.text || "") }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      config: { temperature: 0.4 },
      contents,
    });

    const reply = (response.text || "").trim();

    // Best-effort save — a logging hiccup here shouldn't cost the student
    // the reply they're already waiting on, so this never blocks or fails
    // the response. Both sides of the turn are encrypted before storage.
    supabase
      .from(BOBBY_MESSAGES_TABLE)
      .insert([
        { student_id: studentId, role: "user", text: encryptChatText(message) },
        { student_id: studentId, role: "bot", text: encryptChatText(reply) },
      ])
      .then(({ error: saveError }) => {
        if (saveError) console.error("Failed to save Bobby chat message:", saveError.message);
      });

    res.json({ reply });
  } catch (error) {
    console.error("POST /chat/bobby error:", error);
    res.status(500).json({ error: friendlyGeminiError(error) });
  }
});

// ------------------------------------------------
// COURSE RECOMMENDATION: personalized elective suggestions grounded in
// the student's own Goals & Career Interest (see PUT
// /students/:studentId/goals) plus what they still need for their
// curriculum. Gemini only picks course_codes from the candidate list we
// hand it (courses that exist in the catalog and aren't already
// completed/registered/requested) — the actual title/credits/description
// shown to the student always comes back from our own data, not
// whatever Gemini says, so it can't hallucinate a course into existing.
// ------------------------------------------------
app.post("/course-recommendations", async (req, res) => {
  try {
    const studentId = String(req.body.student_id || "").trim().toUpperCase();
    if (!studentId) return res.status(400).json({ error: "student_id is required." });

    const [
      { data: student, error: studentError },
      { data: grades },
      { data: registrations },
      { data: requestedCourses },
      { data: curriculumGroups },
      { data: courseCatalog },
      { data: timetableEntries },
    ] = await Promise.all([
      supabase
        .from("students")
        .select("student_id, name, curriculum_year, goals, career_interests")
        .ilike("student_id", studentId)
        .maybeSingle(),
      supabase.from("grades").select("course_code, grade").ilike("student_id", studentId),
      supabase.from(REGISTRATIONS_TABLE).select("course_code").ilike("student_id", studentId),
      supabase.from(REQUESTED_COURSES_TABLE).select("course_code").ilike("student_id", studentId),
      supabase.from(CURRICULUM_GROUPS_TABLE).select("*"),
      supabase.from(COURSES_TABLE).select("course_code, course_title, credits, description, course_group"),
      // Which courses are actually schedulable this term — same
      // course_timetable table Planner reads via GET /timetable — so a
      // recommendation can tell the student whether "Add to Plan" will
      // register them for real, or whether they can only request it.
      supabase.from(TIMETABLE_TABLE).select("code, name, sec, day, start_time, end_time"),
    ]);

    if (studentError) return res.status(500).json({ error: studentError.message });
    if (!student) return res.status(404).json({ error: "Student ID not recognized." });

    const goals = Array.isArray(student.goals) ? student.goals : [];
    const careerInterests = Array.isArray(student.career_interests) ? student.career_interests : [];

    if (goals.length === 0 && careerInterests.length === 0) {
      return res.status(400).json({
        error: "Add at least one Goal or Career Interest on the Goals & Career page first — recommendations are based on those.",
        needsGoals: true,
      });
    }

    const NON_PASSING_GRADES = new Set(["F", "W", "WF", "I", ""]);
    // normalizeCourseCode strips ALL whitespace/punctuation (not just
    // leading/trailing), so "CSX 1001" and "CSX1001" compare as the same
    // course — codes coming from the AI-extracted course catalog can have
    // stray internal spaces that a plain .trim() wouldn't catch, which
    // previously let an already-requested/registered course still appear
    // in recommendations after a reload.
    const takenOrPlanned = new Set(
      [
        ...(grades || [])
          .filter((g) => !NON_PASSING_GRADES.has(String(g.grade || "").trim().toUpperCase()))
          .map((g) => g.course_code),
        ...(registrations || []).map((r) => r.course_code),
        ...(requestedCourses || []).map((r) => r.course_code),
      ]
        .map((code) => normalizeCourseCode(code))
        .filter(Boolean)
    );

    // Candidate pool: every cataloged course the student hasn't already
    // completed, registered for, or requested — this is the only set
    // Gemini is allowed to choose from.
    const candidates = (courseCatalog || [])
      .filter((c) => c.course_code && !takenOrPlanned.has(normalizeCourseCode(c.course_code)))
      .map((c) => ({
        code: c.course_code,
        title: c.course_title || "",
        credits: c.credits,
        group: c.course_group || "",
        description: c.description ? String(c.description).slice(0, 400) : "",
      }));

    if (candidates.length === 0) {
      return res.json({ recommendations: [], note: "No un-taken courses found in the catalog to recommend from." });
    }

    // Curriculum elective-group labels for this student's year, so Gemini
    // can note when a pick also happens to satisfy a specific requirement
    // group — purely informational, doesn't gate the recommendation.
    const groupLabels = (curriculumGroups || [])
      .filter((row) => row.curriculum_year === student.curriculum_year)
      .map((row) => row.label)
      .filter(Boolean);

    const prompt = `
You are recommending elective/next courses for one student, based on their stated Goals and Career Interests.

Rules:
- Return ONLY valid JSON, no markdown fences: {"recommendations": [{"course_code": "...", "reason": "..."}]}
- Pick every course from CANDIDATE_COURSES that genuinely fits the student's goals/career interests — don't artificially limit yourself to a small number, but don't pad the list with weak matches either. Copy "code" exactly as "course_code". Never invent a course_code that isn't in that list.
- "reason" is 1-2 short sentences explaining specifically why this course fits THIS student's goals/career interests (or their curriculum group) — reference the student's own words where relevant, not generic filler.
- Prefer courses whose description/title clearly connects to the goals or career interests. If nothing connects well, pick the closest reasonable matches and say so honestly in the reason.
- Do not repeat the same course twice.

STUDENT GOALS: ${JSON.stringify(goals)}
STUDENT CAREER INTERESTS: ${JSON.stringify(careerInterests)}
STUDENT CURRICULUM ELECTIVE GROUPS (for context only): ${JSON.stringify(groupLabels)}

CANDIDATE_COURSES:
${JSON.stringify(candidates)}
`.trim();

    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      config: { temperature: 0.5 },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const cleanedText = (response.text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      throw new Error("Gemini returned an unreadable response.");
    }

    const candidateByCode = new Map(candidates.map((c) => [normalizeCourseCode(c.code), c]));

    // Group open timetable sections by course code so each recommendation
    // can say whether it's actually schedulable this term, and if so,
    // with which section(s) — same table Planner's timetable view reads.
    const sectionsByCode = new Map();
    (timetableEntries || []).forEach((entry) => {
      const code = normalizeCourseCode(entry.code);
      if (!code) return;
      if (!sectionsByCode.has(code)) sectionsByCode.set(code, []);
      sectionsByCode.get(code).push({
        section: entry.sec || "1",
        // Match GET /timetable's numeric day index (0 = Sunday), not the
        // raw day-name string, so a course's day here can be compared
        // directly against timetable entries fetched from that endpoint.
        day: DAY_NAMES.indexOf(entry.day),
        start: String(entry.start_time || "").slice(0, 5),
        end: String(entry.end_time || "").slice(0, 5),
      });
    });

    const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
      .map((r) => {
        const course = candidateByCode.get(normalizeCourseCode(r.course_code));
        if (!course) return null; // Gemini picked something outside the candidate list — drop it.
        const sections = sectionsByCode.get(normalizeCourseCode(course.code)) || [];
        return { ...course, reason: String(r.reason || "").trim(), isOpen: sections.length > 0, sections };
      })
      .filter(Boolean)
      // A generous ceiling just to keep the response sane — not a target;
      // Gemini is instructed above to include every genuine fit, not pad
      // toward this number.
      .slice(0, 25);

    res.json({ recommendations, goals, careerInterests });
  } catch (error) {
    console.error("POST /course-recommendations error:", error);
    res.status(500).json({ error: friendlyGeminiError(error) });
  }
});

// ------------------------------------------------
// PLANNER INSIGHTS: turns the student's current Selected Course list (on
// the Planner page) into an AI-judged difficulty rating and a short
// balance suggestion. Falls back to a simple course-count heuristic (what
// the UI used before this existed) whenever Gemini can't be reached or
// returns something unusable, so the indicator never just breaks.
// ------------------------------------------------

function fallbackDifficulty(courseCount) {
  if (courseCount >= 4) return "Hard";
  if (courseCount >= 2) return "Moderate";
  if (courseCount === 1) return "Light";
  return "None planned";
}

function fallbackBalanceSuggestion(courseCount, difficulty) {
  if (courseCount === 0) return "Add a course above to get a balance suggestion.";
  if (difficulty === "Hard") return "This load looks heavy — consider spreading some courses across another term.";
  if (difficulty === "Moderate") return "This looks manageable — keep an eye on overlapping deadlines.";
  return "This is a light load — you could consider adding another course.";
}

app.post("/planner-insights", async (req, res) => {
  // Selected Course entries can be "CODE Sec.N" or a bare code — pull just
  // the code out of each, same helper the prerequisite check uses, and
  // de-dupe (a course added under two sections should still count once).
  const labels = Array.isArray(req.body.courses) ? req.body.courses : [];
  const codes = [...new Set(labels.map((label) => extractCourseCodes(label)[0]).filter(Boolean))];
  const fallback = {
    difficulty: fallbackDifficulty(codes.length),
    balanceSuggestion: fallbackBalanceSuggestion(codes.length, fallbackDifficulty(codes.length)),
  };

  if (codes.length === 0) {
    return res.json({ ...fallback, source: "heuristic" });
  }

  try {
    const { data: catalog } = await supabase
      .from(COURSES_TABLE)
      .select("course_code, course_title, credits, description, course_group");

    const catalogByCode = new Map((catalog || []).map((c) => [normalizeCourseCode(c.course_code), c]));

    const selectedCourses = codes.map((code) => {
      const row = catalogByCode.get(code);
      return {
        code,
        title: row?.course_title || "",
        credits: row?.credits ?? null,
        group: row?.course_group || "",
        description: row?.description ? String(row.description).slice(0, 300) : "",
      };
    });

    const prompt = `
You are assessing ONE student's current semester plan for workload difficulty and balance.

Rules:
- Return ONLY valid JSON, no markdown fences: {"difficulty": "Light" | "Moderate" | "Hard", "balance_suggestion": "..."}
- "difficulty" is your overall judgment of how demanding this combination of courses is this term — weigh course level (the number in each course code), credit load, subject overlap/variety, and how many courses are selected. Don't just count courses — e.g. four intro-level courses can be lighter than two advanced/lab-heavy ones.
- "balance_suggestion" is 1-2 short, specific sentences of practical advice for THIS exact set of courses (e.g. spreading the load across terms, watching overlapping deadlines, pairing heavy courses with lighter ones) — not generic filler.

SELECTED_COURSES (${selectedCourses.length} total):
${JSON.stringify(selectedCourses)}
`.trim();

    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      config: { temperature: 0.4 },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const cleanedText = (response.text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      throw new Error("Gemini returned an unreadable response.");
    }

    const ALLOWED_DIFFICULTIES = new Set(["Light", "Moderate", "Hard"]);
    const difficulty = ALLOWED_DIFFICULTIES.has(parsed.difficulty) ? parsed.difficulty : fallback.difficulty;
    const balanceSuggestion = String(parsed.balance_suggestion || "").trim() || fallback.balanceSuggestion;

    res.json({ difficulty, balanceSuggestion, source: "ai" });
  } catch (error) {
    console.error("POST /planner-insights error:", error);
    // A supplementary indicator, not core functionality — fall back to the
    // heuristic instead of failing the whole Planner page over it.
    res.json({ ...fallback, source: "heuristic" });
  }
});

// ------------------------------------------------
// STUDENT PLAN REGISTRATIONS: the "Save" button on the Planner page
// persists the student's current Selected Course list here — a separate
// table from the in-memory/localStorage planner draft — so admins and
// advisors can see which courses each student has actually registered.
// Saving always replaces the student's previous saved set (one row per
// saved course, all sharing the same saved_at timestamp).
// ------------------------------------------------

// Admin: every saved registration, across all students. Advisors can pass
// ?advisor_id=E1001 to see only registrations from their own advisees.
app.get("/registrations", async (req, res) => {
  try {
    const advisorId = String(
      req.query.advisor_id || ""
    )
      .trim()
      .toUpperCase();

    // Get registrations
    const {
      data: registrations,
      error: registrationsError,
    } = await supabase
      .from(REGISTRATIONS_TABLE)
      .select("*")
      .order("course_code", {
        ascending: true,
      });

    if (registrationsError) {
      return res.status(500).json({
        error: registrationsError.message,
      });
    }

    // Admin: no advisor filter, show everything
    if (!advisorId) {
      return res.json({
        registrations: registrations || [],
      });
    }

    // Advisor: get students assigned to this advisor
    const {
      data: advisees,
      error: adviseeError,
    } = await supabase
      .from("students")
      .select("student_id")
      .ilike("advisor_id", advisorId);

    if (adviseeError) {
      return res.status(500).json({
        error: adviseeError.message,
      });
    }

    // Make all student IDs uppercase ONLY for comparison
    const allowedStudentIds = new Set(
      (advisees || []).map((student) =>
        String(student.student_id || "")
          .trim()
          .toUpperCase()
      )
    );

    // Case-insensitive filtering
    const filteredRegistrations =
      (registrations || []).filter((row) => {
        const registrationStudentId =
          String(row.student_id || "")
            .trim()
            .toUpperCase();

        return allowedStudentIds.has(
          registrationStudentId
        );
      });

    return res.json({
      registrations: filteredRegistrations,
    });
  } catch (error) {
    console.error(
      "GET /registrations error:",
      error
    );

    return res.status(500).json({
      error: error.message,
    });
  }
});

// Student/advisor: saved registrations for one student.
app.get("/registrations/:studentId", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(REGISTRATIONS_TABLE)
      .select("*")
      .ilike("student_id", req.params.studentId)
      .order("course_code", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ registrations: data || [] });
  } catch (error) {
    console.error("GET /registrations/:studentId error:", error);
    res.status(500).json({ error: error.message });
  }
});


// --------------------------------------------------
// ADVISOR COURSE RECOMMENDATIONS
// --------------------------------------------------

// Advisor sends a course recommendation to one of their students.
app.post("/advisor-course-recommendations", async (req, res) => {
  try {
    const {
      studentId,
      advisorId,
      courseCode,
      courseName,
      message,
    } = req.body;

    const studentIdClean = String(studentId || "")
      .trim()
      .toUpperCase();

    const advisorIdClean = String(advisorId || "")
      .trim()
      .toUpperCase();

    const courseCodeClean = normalizeCourseCode(courseCode);

    if (!studentIdClean) {
      return res.status(400).json({
        error: "studentId is required.",
      });
    }

    if (!advisorIdClean) {
      return res.status(400).json({
        error: "advisorId is required.",
      });
    }

    if (!courseCodeClean) {
      return res.status(400).json({
        error: "A valid course code is required.",
      });
    }

    // Make sure this student really belongs to this advisor.
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("student_id, advisor_id")
      .ilike("student_id", studentIdClean)
      .maybeSingle();

    if (studentError) {
      return res.status(500).json({
        error: studentError.message,
      });
    }

    if (!student) {
      return res.status(404).json({
        error: "Student not found.",
      });
    }

    const assignedAdvisor = String(student.advisor_id || "")
      .trim()
      .toUpperCase();

    if (assignedAdvisor !== advisorIdClean) {
      return res.status(403).json({
        error: "You can only recommend courses to your assigned students.",
      });
    }

    // Save recommendation.
    const { data, error } = await supabase
      .from(ADVISOR_RECOMMENDATIONS_TABLE)
      .insert({
        student_id: studentIdClean,
        advisor_id: advisorIdClean,
        course_code: courseCodeClean,
        course_name: String(courseName || "").trim(),
        message: String(message || "").trim(),
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: error.message,
      });
    }

    return res.status(201).json({
      recommendation: data,
    });
  } catch (error) {
    console.error(
      "POST /advisor-course-recommendations error:",
      error
    );

    return res.status(500).json({
      error: error.message,
    });
  }
});


// Student: get recommendations sent to them.
app.get(
  "/advisor-course-recommendations/:studentId",
  async (req, res) => {
    try {
      const studentId = String(req.params.studentId || "")
        .trim()
        .toUpperCase();

      if (!studentId) {
        return res.status(400).json({
          error: "studentId is required.",
        });
      }

      const { data, error } = await supabase
        .from(ADVISOR_RECOMMENDATIONS_TABLE)
        .select("*")
        .ilike("student_id", studentId)
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        return res.status(500).json({
          error: error.message,
        });
      }

      return res.json({
        recommendations: data || [],
      });
    } catch (error) {
      console.error(
        "GET /advisor-course-recommendations/:studentId error:",
        error
      );

      return res.status(500).json({
        error: error.message,
      });
    }
  }
);


// Student accepts or dismisses a recommendation.
app.patch(
  "/advisor-course-recommendations/:id",
  async (req, res) => {
    try {
      const { id } = req.params;

      const studentId = String(req.body.studentId || "")
        .trim()
        .toUpperCase();

      const status = String(req.body.status || "")
        .trim()
        .toLowerCase();

      if (!studentId) {
        return res.status(400).json({
          error: "studentId is required.",
        });
      }

      if (!["accepted", "dismissed"].includes(status)) {
        return res.status(400).json({
          error: "status must be accepted or dismissed.",
        });
      }

      // student_id is included in the update condition so one
      // student cannot change another student's recommendation.
      const { data, error } = await supabase
        .from(ADVISOR_RECOMMENDATIONS_TABLE)
        .update({
          status,
        })
        .eq("id", id)
        .ilike("student_id", studentId)
        .select()
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          error: error.message,
        });
      }

      if (!data) {
        return res.status(404).json({
          error: "Recommendation not found.",
        });
      }

      return res.json({
        recommendation: data,
      });
    } catch (error) {
      console.error(
        "PATCH /advisor-course-recommendations/:id error:",
        error
      );

      return res.status(500).json({
        error: error.message,
      });
    }
  }
);


// Student: save the current Selected Course list. Replaces whatever was
// previously saved for this student with the new list.
app.post("/registrations", async (req, res) => {
  try {
    const { studentId, courses } = req.body;
    if (!studentId) return res.status(400).json({ error: "studentId is required" });

    // Preserve the selected section and label. Admin totals are still
    // grouped by course_code, while a student's plan can show its section.
    const courseList = Array.from(new Map((Array.isArray(courses) ? courses : [])
      .map((course) => {
        const label = String(course || "").trim();
        const courseCode = extractCourseCodes(label)[0];
        const section = label.match(/\bSEC\.?\s*([^\s]+)/i)?.[1] || "";
        return courseCode ? { course_code: courseCode, section, course_label: label } : null;
      })
      .filter(Boolean)
      .map((course) => [`${course.course_code}|${course.section}`, course])).values());

    // The client checks prerequisites while courses are added, but validate
    // again here so manually typed courses, stale browser data, and direct
    // API calls cannot save an ineligible registration. This happens before
    // replacing existing registrations, so a rejected save never erases them.
    const groupColumn = PREREQ_GROUP_COLUMNS[getPrereqGroupForStudent(studentId)];
    if (groupColumn && courseList.length > 0) {
      const [{ data: prereqRows, error: prereqError }, { data: grades, error: gradesError }] = await Promise.all([
        supabase
          .from(PREREQ_TABLE)
          .select(`course_code, ${groupColumn}`),
          // Compare normalized codes below. Fetching this small admin table
          // also supports older rows that were saved with a hyphen.
        supabase
          .from("grades")
          .select("course_code, grade")
          .eq("student_id", studentId),
      ]);

      if (prereqError) return res.status(500).json({ error: prereqError.message });
      if (gradesError) return res.status(500).json({ error: gradesError.message });

      const passedCodes = new Set(
        (grades || [])
          .filter((gradeRow) => {
            const grade = String(gradeRow.grade || "").trim().toUpperCase();
            return grade && grade !== "F" && grade !== "W" && grade !== "I";
          })
          .map((gradeRow) => normalizeCourseCode(gradeRow.course_code))
          .filter(Boolean)
      );
      const selectedCourseCodes = new Set(courseList.map((course) => course.course_code));
      const blockedCourses = (prereqRows || []).flatMap((prereqRow) => {
        const prereqCourseCode = normalizeCourseCode(prereqRow.course_code);
        if (!selectedCourseCodes.has(prereqCourseCode)) return [];
        const requiredCourses = extractCourseCodes(prereqRow[groupColumn]).filter(
          (code) => code !== prereqCourseCode
        );
        const missingCourses = requiredCourses.filter((code) => !passedCodes.has(code));
        return missingCourses.length > 0
          ? [{ courseCode: prereqRow.course_code, missingCourses }]
          : [];
      });

      if (blockedCourses.length > 0) {
        const firstBlocked = blockedCourses[0];
        return res.status(422).json({
          error: `Cannot save ${firstBlocked.courseCode}: has not yet passed ${firstBlocked.missingCourses.join(", ")}.`,
          blockedCourses,
        });
      }
    }

    const { error: deleteError } = await supabase
      .from(REGISTRATIONS_TABLE)
      .delete()
      .eq("student_id", studentId);
    if (deleteError) return res.status(500).json({ error: deleteError.message });

    if (courseList.length === 0) return res.json({ registrations: [] });

    const savedAt = new Date().toISOString();
    const rows = courseList.map((course) => ({
      student_id: studentId,
      ...course,
      saved_at: savedAt,
    }));

    const { data, error } = await supabase
      .from(REGISTRATIONS_TABLE)
      .insert(rows)
      .select();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({ registrations: data || [] });
  } catch (error) {
    console.error("POST /registrations error:", error);
    res.status(500).json({ error: error.message });
  }
});

// --------------------------------------------------
// REQUESTED UNSCHEDULED COURSES
// --------------------------------------------------
//
// Planner > "Requested Unscheduled Courses" lets a student ask for a
// course that isn't on next semester's open timetable. Each save fully
// replaces that student's rows (same pattern as /registrations above),
// so a course a student later removes from the list also disappears
// from the High-Demand Courses count below.

// Admin/Advisor: every request, for the High-Demand Courses page.
// Advisor view is scoped to their own advisees, same as /registrations.
app.get("/requested-courses", async (req, res) => {
  try {
    const advisorId = String(req.query.advisor_id || "").trim().toUpperCase();

    const { data: rows, error } = await supabase
      .from(REQUESTED_COURSES_TABLE)
      .select("*")
      .order("course_code", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    if (!advisorId) {
      return res.json({ requestedCourses: rows || [] });
    }

    const { data: advisees, error: adviseeError } = await supabase
      .from("students")
      .select("student_id")
      .ilike("advisor_id", advisorId);

    if (adviseeError) return res.status(500).json({ error: adviseeError.message });

    const allowedStudentIds = new Set(
      (advisees || []).map((student) => String(student.student_id || "").trim().toUpperCase())
    );

    const filtered = (rows || []).filter((row) =>
      allowedStudentIds.has(String(row.student_id || "").trim().toUpperCase())
    );

    res.json({ requestedCourses: filtered });
  } catch (error) {
    console.error("GET /requested-courses error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Student/advisor: one student's own saved requests, to pre-fill the
// "Requested Unscheduled Courses" boxes when Planner loads.
app.get("/requested-courses/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;

    const { data, error } = await supabase
      .from(REQUESTED_COURSES_TABLE)
      .select("*")
      .ilike("student_id", studentId)
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ requestedCourses: data || [] });
  } catch (error) {
    console.error("GET /requested-courses/:studentId error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Save (fully replace) a student's requested-course list. Deduped by
// course code — a course only ever counts once per student either way,
// since High-Demand Courses counts distinct students per course_code.
app.post("/requested-courses", async (req, res) => {
  try {
    const { studentId, courses } = req.body;
    if (!studentId) return res.status(400).json({ error: "studentId is required" });

    const courseList = Array.from(
      new Map(
        (Array.isArray(courses) ? courses : [])
          .map((course) => {
            const label = String(course || "").trim();
            const courseCode = extractCourseCodes(label)[0];
            if (!courseCode) return null;
            // Strip the leading "CODE" token (as typed, e.g. "CSX-9004")
            // to get whatever name text follows it, if any.
            const courseName = label
              .replace(/^[A-Za-z]{2,4}\s*-?\s*\d{3,4}\s*/, "")
              .trim();
            return [courseCode, { course_code: courseCode, course_name: courseName }];
          })
          .filter(Boolean)
      ).values()
    );

    const { error: deleteError } = await supabase
      .from(REQUESTED_COURSES_TABLE)
      .delete()
      .eq("student_id", studentId);
    if (deleteError) return res.status(500).json({ error: deleteError.message });

    if (courseList.length === 0) return res.json({ requestedCourses: [] });

    const rows = courseList.map((course) => ({ student_id: studentId, ...course }));

    const { data, error } = await supabase
      .from(REQUESTED_COURSES_TABLE)
      .insert(rows)
      .select();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({ requestedCourses: data || [] });
  } catch (error) {
    console.error("POST /requested-courses error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------
// ------------------------------------------------
// GET ALL STUDENTS (Admin: Manage Users)
// ------------------------------------------------

app.get("/students", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("students")
      .select("student_id, name, email, advisor_id")
      .order("student_id", { ascending: true });

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json({
      students: data || []
    });
  } catch (error) {
    console.error(
      "GET /students error:",
      error
    );

    res.status(500).json({
      error: error.message
    });
  }
});

// ------------------------------------------------
// GET ONE STUDENT
// ------------------------------------------------

app.get("/students/:studentId", async (req, res) => {
  try {
    const studentId = String(
      req.params.studentId || ""
    )
      .trim()
      .toUpperCase();

    if (!studentId) {
      return res.status(400).json({
        error: "Student ID is required."
      });
    }

    const { data, error } =
      await supabase
        .from("students")
        .select(
          "student_id, name, email, advisor_id, curriculum_year, elective_group, email_verified, goals, career_interests"
        )
        .ilike(
          "student_id",
          studentId
        )
        .maybeSingle();

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    if (!data) {
      return res.status(404).json({
        error:
          "Student ID not recognized."
      });
    }

    res.json({
      student: data
    });
  } catch (error) {
    console.error(
      "GET /students/:studentId error:",
      error
    );

    res.status(500).json({
      error: error.message
    });
  }
});

// Save this student's Goals & Career Interest lists — used by Course
// Recommendation (and Bobby chat) to personalize suggestions. Replaces
// the old browser-localStorage-only version of this data, which wasn't
// even scoped per student and wasn't visible to the server at all.
app.put("/students/:studentId/goals", async (req, res) => {
  try {
    const studentId = String(req.params.studentId || "").trim().toUpperCase();
    if (!studentId) return res.status(400).json({ error: "Student ID is required." });

    // Cap list length/item size — this gets embedded in an AI prompt
    // later, so keep it small and sane rather than trusting arbitrary
    // client input.
    const cleanList = (value) =>
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || "").trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 20);

    const goals = cleanList(req.body.goals);
    const careerInterests = cleanList(req.body.career_interests);

    const { data, error } = await supabase
      .from("students")
      .update({ goals, career_interests: careerInterests })
      .ilike("student_id", studentId)
      .select("student_id, goals, career_interests")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Student ID not recognized." });

    res.json({ student: data });
  } catch (error) {
    console.error("PUT /students/:studentId/goals error:", error);
    res.status(500).json({ error: error.message });
  }
});


// on a browser anon key. This makes chat available as soon as the database
// migration has been applied and keeps the client configuration simple.
// ------------------------------------------------
app.get("/advisor-messages", async (req, res) => {
  try {
    const studentId = String(req.query.studentId || "").trim().toUpperCase();
    const advisorId = String(req.query.advisorId || "").trim().toUpperCase();

    if (!studentId || !advisorId) {
      return res.status(400).json({
        error: "studentId and advisorId are required",
      });
    }

    const { data, error } = await supabase
      .from(ADVISOR_MESSAGES_TABLE)
      .select("*")
      .eq("student_id", studentId)
      .eq("advisor_id", advisorId)
      .order("created_at", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ messages: data || [] });
  } catch (error) {
    console.error("GET /advisor-messages error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/advisor-messages", async (req, res) => {
  try {
    const studentId = String(req.body.studentId || "").trim().toUpperCase();
    const advisorId = String(req.body.advisorId || "").trim().toUpperCase();
    const senderRole = String(req.body.senderRole || "").trim().toLowerCase();
    const message = String(req.body.message || "").trim();

    if (!studentId || !advisorId || !message) {
      return res.status(400).json({
        error: "studentId, advisorId and message are required",
      });
    }

    if (!["student", "advisor"].includes(senderRole)) {
      return res.status(400).json({
        error: "senderRole must be student or advisor",
      });
    }

    // A sender has obviously already read their own message. The receiver's
    // flag starts false, which is what creates the unread notification.
    const readByStudent = senderRole === "student";
    const readByAdvisor = senderRole === "advisor";

    const { data, error } = await supabase
      .from(ADVISOR_MESSAGES_TABLE)
      .insert({
        student_id: studentId,
        advisor_id: advisorId,
        sender_role: senderRole,
        message,
        read_by_student: readByStudent,
        read_by_advisor: readByAdvisor,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ message: data });
  } catch (error) {
    console.error("POST /advisor-messages error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Returns the number of messages the current viewer has not opened yet.
// Student side uses viewerRole=student.
// Advisor side can use viewerRole=advisor for a single conversation.
app.get("/advisor-messages/unread", async (req, res) => {
  try {
    const studentId = String(req.query.studentId || "").trim().toUpperCase();
    const advisorId = String(req.query.advisorId || "").trim().toUpperCase();
    const viewerRole = String(req.query.viewerRole || "").trim().toLowerCase();

    if (!studentId || !advisorId) {
      return res.status(400).json({
        error: "studentId and advisorId are required",
      });
    }

    if (!["student", "advisor"].includes(viewerRole)) {
      return res.status(400).json({
        error: "viewerRole must be student or advisor",
      });
    }

    const senderRole = viewerRole === "student" ? "advisor" : "student";
    const readColumn =
      viewerRole === "student" ? "read_by_student" : "read_by_advisor";

    const { count, error } = await supabase
      .from(ADVISOR_MESSAGES_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .eq("advisor_id", advisorId)
      .eq("sender_role", senderRole)
      .eq(readColumn, false);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ unread_count: count || 0 });
  } catch (error) {
    console.error("GET /advisor-messages/unread error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Call this when a chat screen is opened. It clears the receiver's unread
// notification for messages sent by the other side.
app.put("/advisor-messages/read", async (req, res) => {
  try {
    const studentId = String(req.body.studentId || "").trim().toUpperCase();
    const advisorId = String(req.body.advisorId || "").trim().toUpperCase();
    const viewerRole = String(req.body.viewerRole || "").trim().toLowerCase();

    if (!studentId || !advisorId) {
      return res.status(400).json({
        error: "studentId and advisorId are required",
      });
    }

    if (!["student", "advisor"].includes(viewerRole)) {
      return res.status(400).json({
        error: "viewerRole must be student or advisor",
      });
    }

    const senderRole = viewerRole === "student" ? "advisor" : "student";
    const readColumn =
      viewerRole === "student" ? "read_by_student" : "read_by_advisor";

    const { error } = await supabase
      .from(ADVISOR_MESSAGES_TABLE)
      .update({ [readColumn]: true })
      .eq("student_id", studentId)
      .eq("advisor_id", advisorId)
      .eq("sender_role", senderRole)
      .eq(readColumn, false);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("PUT /advisor-messages/read error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------
// STUDENT / ADVISOR ASSIGNMENT
// ------------------------------------------------

// List only students assigned to the currently logged-in advisor.
// Each row also includes unread_count so the Student List can show a chat
// notification beside the student who sent new messages.
app.get("/instructor/students", async (req, res) => {
  try {
    const advisorId = String(req.query.advisor_id || "").trim().toUpperCase();

    if (!advisorId) {
      return res.status(400).json({ error: "advisor_id is required" });
    }

    const [
      { data: students, error: studentsError },
      { data: unreadMessages, error: unreadError },
    ] = await Promise.all([
      supabase
        .from("students")
        .select("student_id, name, email, advisor_id")
        .eq("advisor_id", advisorId)
        .order("student_id", { ascending: true }),

      supabase
        .from(ADVISOR_MESSAGES_TABLE)
        .select("student_id")
        .eq("advisor_id", advisorId)
        .eq("sender_role", "student")
        .eq("read_by_advisor", false),
    ]);

    if (studentsError) {
      return res.status(500).json({ error: studentsError.message });
    }

    if (unreadError) {
      return res.status(500).json({ error: unreadError.message });
    }

    const unreadByStudent = new Map();

    (unreadMessages || []).forEach((row) => {
      const studentId = String(row.student_id || "").trim().toUpperCase();
      unreadByStudent.set(
        studentId,
        (unreadByStudent.get(studentId) || 0) + 1
      );
    });

    const result = (students || []).map((student) => ({
      ...student,
      unread_count:
        unreadByStudent.get(
          String(student.student_id || "").trim().toUpperCase()
        ) || 0,
    }));

    res.json(result);
  } catch (error) {
    console.error("GET /instructor/students error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Read one student's advisor assignment.
app.get("/student-advisor/:studentId", async (req, res) => {
  try {
    const studentId = String(req.params.studentId || "").trim().toUpperCase();

    const { data, error } = await supabase
      .from("students")
      .select("student_id, advisor_id")
      .eq("student_id", studentId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    res.json({
      student_id: studentId,
      advisor_id: data?.advisor_id || null,
    });
  } catch (error) {
    console.error("GET /student-advisor error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Save/change a student's advisor.
app.put("/student-advisor/:studentId", async (req, res) => {
  try {
    const studentId = String(req.params.studentId || "").trim().toUpperCase();
    const advisorId = String(req.body.advisorId || "").trim().toUpperCase();

    if (!studentId || !advisorId) {
      return res.status(400).json({ error: "Student ID and Advisor ID are required." });
    }

    const { data, error } = await supabase
      .from("students")
      .upsert(
        { student_id: studentId, advisor_id: advisorId },
        { onConflict: "student_id" }
      )
      .select("student_id, advisor_id")
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  } catch (error) {
    console.error("PUT /student-advisor error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------
// ADVISORS
// Backed by the `advisors` table (see server/supabase_advisors_table.sql).
// Seed advisors (is_seed = true) can't be deleted via the API.
// ------------------------------------------------

// New advisors (Admin > Manage Users > Add Advisor) get this temporary
// password automatically — Admin never types a password. The advisor (or
// Admin, for their own account) changes it afterwards from Profile.
const TEMP_ADVISOR_PASSWORD = "0000";

app.get("/advisors", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("advisors")
      .select("id, name, department, email, is_seed")
      .order("id", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ advisors: data || [] });
  } catch (error) {
    console.error("GET /advisors error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/advisors", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const department = String(req.body.department || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!name) {
      return res.status(400).json({ error: "Please enter the advisor's full name." });
    }

    if (!department) {
      return res.status(400).json({ error: "Please enter a department." });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "That email address doesn't look valid." });
    }

    if (email) {
      const { data: existingEmail, error: emailLookupError } = await supabase
        .from("advisors")
        .select("id")
        .ilike("email", email)
        .maybeSingle();

      if (emailLookupError) {
        return res.status(500).json({ error: emailLookupError.message });
      }

      if (existingEmail) {
        return res.status(409).json({
          error: `An advisor with the email ${email} already exists.`,
        });
      }
    }

    // Next free E-prefixed ID after whatever's already in use.
    const { data: existingAdvisors, error: listError } = await supabase
      .from("advisors")
      .select("id");

    if (listError) {
      return res.status(500).json({ error: listError.message });
    }

    const used = (existingAdvisors || [])
      .map((a) => /^E(\d+)$/i.exec(a.id))
      .filter(Boolean)
      .map((m) => parseInt(m[1], 10));
    const nextNum = (used.length ? Math.max(...used) : 1000) + 1;
    const id = `E${nextNum}`;

    // New advisors get a temporary password automatically — Admin never
    // types a password here. The advisor (or Admin) can change it
    // afterwards from Profile — see PUT /advisors/:id/password below.
    const password_hash = await bcrypt.hash(TEMP_ADVISOR_PASSWORD, 10);

    const { data, error } = await supabase
      .from("advisors")
      .insert({
        id,
        name,
        department,
        email: email || null,
        is_seed: false,
        password_hash,
      })
      .select("id, name, department, email, is_seed")
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ advisor: data });
  } catch (error) {
    console.error("POST /advisors error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/advisors/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim().toUpperCase();

    const { data: existing, error: lookupError } = await supabase
      .from("advisors")
      .select("id, is_seed")
      .ilike("id", id)
      .maybeSingle();

    if (lookupError) {
      return res.status(500).json({ error: lookupError.message });
    }

    if (!existing) {
      return res.status(404).json({ error: "Advisor not found." });
    }

    if (existing.is_seed) {
      return res.status(403).json({ error: "Built-in advisors can't be removed." });
    }

    const { error } = await supabase
      .from("advisors")
      .delete()
      .ilike("id", id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /advisors/:id error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------
// ADVISOR LOGIN + PASSWORD CHANGE
// Advisor/Admin no longer share one hardcoded "0000" password —
// each account authenticates against its own password_hash. New advisors
// get password_hash = bcrypt("0000") automatically (see POST
// /advisors above); they change it here afterwards.
// ------------------------------------------------

app.post("/login/advisor", async (req, res) => {
  try {
    const id = String(req.body.id || "").trim().toUpperCase();
    const password = String(req.body.password || "");

    if (!id || !password) {
      return res.status(400).json({ error: "Please enter both your ID and password." });
    }

    const { data: advisor, error } = await supabase
      .from("advisors")
      .select("id, name, department, email, is_seed, password_hash")
      .ilike("id", id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!advisor) {
      return res.status(404).json({ error: "ID not recognized. Please check your ID and try again." });
    }

    // Seed advisors created before password_hash existed: fall back to
    // the temporary password so login still works until they change it.
    const authenticated = advisor.password_hash
      ? await bcrypt.compare(password, advisor.password_hash)
      : password === TEMP_ADVISOR_PASSWORD;

    if (!authenticated) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    const { password_hash, ...account } = advisor;
    res.json({ account });
  } catch (error) {
    console.error("POST /login/advisor error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/advisors/:id/password", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim().toUpperCase();
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are both required." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must contain at least 6 characters." });
    }

    const { data: advisor, error: lookupError } = await supabase
      .from("advisors")
      .select("id, password_hash")
      .ilike("id", id)
      .maybeSingle();

    if (lookupError) {
      return res.status(500).json({ error: lookupError.message });
    }

    if (!advisor) {
      return res.status(404).json({ error: "Advisor not found." });
    }

    const currentValid = advisor.password_hash
      ? await bcrypt.compare(currentPassword, advisor.password_hash)
      : currentPassword === TEMP_ADVISOR_PASSWORD;

    if (!currentValid) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);

    const { error } = await supabase
      .from("advisors")
      .update({ password_hash })
      .ilike("id", id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("PUT /advisors/:id/password error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------
// ADMIN LOGIN + PASSWORD CHANGE
// Backed by the `admins` table (see server/supabase_admins_table.sql).
// There's no "Add Admin" flow — accounts are seeded directly — but Admin
// authenticates and changes their password the same way Advisor does.
// ------------------------------------------------

app.post("/login/admin", async (req, res) => {
  try {
    const id = String(req.body.id || "").trim().toUpperCase();
    const password = String(req.body.password || "");

    if (!id || !password) {
      return res.status(400).json({ error: "Please enter both your ID and password." });
    }

    const { data: admin, error } = await supabase
      .from("admins")
      .select("id, name, department, email, password_hash")
      .ilike("id", id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!admin) {
      return res.status(404).json({ error: "ID not recognized. Please check your ID and try again." });
    }

    const authenticated = admin.password_hash
      ? await bcrypt.compare(password, admin.password_hash)
      : password === TEMP_ADVISOR_PASSWORD;

    if (!authenticated) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    const { password_hash, ...account } = admin;
    res.json({ account });
  } catch (error) {
    console.error("POST /login/admin error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/admins/:id/password", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim().toUpperCase();
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are both required." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must contain at least 6 characters." });
    }

    const { data: admin, error: lookupError } = await supabase
      .from("admins")
      .select("id, password_hash")
      .ilike("id", id)
      .maybeSingle();

    if (lookupError) {
      return res.status(500).json({ error: lookupError.message });
    }

    if (!admin) {
      return res.status(404).json({ error: "Admin not found." });
    }

    const currentValid = admin.password_hash
      ? await bcrypt.compare(currentPassword, admin.password_hash)
      : currentPassword === TEMP_ADVISOR_PASSWORD;

    if (!currentValid) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);

    const { error } = await supabase
      .from("admins")
      .update({ password_hash })
      .ilike("id", id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("PUT /admins/:id/password error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------
// COURSES: Admin All Courses + descriptions
// ------------------------------------------------

// Get all courses
app.get("/courses", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(COURSES_TABLE)
      .select("*")
      .order("course_code", { ascending: true });

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json({
      courses: data || []
    });

  } catch (error) {
    console.error("GET /courses error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});


// Add a new course
app.post("/courses", async (req, res) => {
  try {
    const courseCode = normalizeCourseCode(
      req.body.course_code
    );

    const courseTitle = String(
      req.body.course_title || ""
    ).trim();

    const description = String(
      req.body.description || ""
    ).trim();

    const courseGroup = String(
      req.body.course_group || ""
    ).trim();

    const credits =
      req.body.credits === "" ||
      req.body.credits === null ||
      req.body.credits === undefined
        ? null
        : Number(req.body.credits);

    if (!courseCode) {
      return res.status(400).json({
        error: "A valid course code is required."
      });
    }

    if (
      credits !== null &&
      (Number.isNaN(credits) || credits < 0)
    ) {
      return res.status(400).json({
        error: "Credits must be a non-negative number."
      });
    }

    const { data, error } = await supabase
      .from(COURSES_TABLE)
      .insert({
        course_code: courseCode,
        course_title: courseTitle,
        credits,
        description,
        course_group: courseGroup || null
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.status(201).json({
      course: data
    });

  } catch (error) {
    console.error("POST /courses error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});


// Edit an existing course
app.put("/courses/:courseCode", async (req, res) => {
  try {
    const courseCode = normalizeCourseCode(
      req.params.courseCode
    );

    const courseTitle = String(
      req.body.course_title || ""
    ).trim();

    const description = String(
      req.body.description || ""
    ).trim();

    const courseGroup = String(
      req.body.course_group || ""
    ).trim();

    const credits =
      req.body.credits === "" ||
      req.body.credits === null ||
      req.body.credits === undefined
        ? null
        : Number(req.body.credits);

    if (!courseCode) {
      return res.status(400).json({
        error: "A valid course code is required."
      });
    }

    if (
      credits !== null &&
      (Number.isNaN(credits) || credits < 0)
    ) {
      return res.status(400).json({
        error: "Credits must be a non-negative number."
      });
    }

    const { data, error } = await supabase
      .from(COURSES_TABLE)
      .update({
        course_title: courseTitle,
        credits,
        description,
        course_group: courseGroup || null
      })
      .eq("course_code", courseCode)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json({
      course: data
    });

  } catch (error) {
    console.error(
      "PUT /courses/:courseCode error:",
      error
    );

    res.status(500).json({
      error: error.message
    });
  }
});
// ------------------------------------------------
// STUDENTS
// ------------------------------------------------



app.listen(3001, () => {
  console.log("Server running on port 3001");
});
