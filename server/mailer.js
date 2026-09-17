// Sends the email-verification code used during student registration
// (see /register/send-code in server.js). Uses plain SMTP via
// nodemailer so it works with whatever provider you already have —
// Gmail, Outlook/Office365, SendGrid, Mailgun, etc. — instead of
// locking this to one vendor's API.
//
// To make this work, add SMTP credentials to server/.env (see
// server/.env.example). A few common providers' SMTP settings:
//   - Gmail:      host smtp.gmail.com, port 587 (use an "App Password",
//                 not your normal password — https://myaccount.google.com/apppasswords)
//   - Outlook:    host smtp.office365.com, port 587
//   - SendGrid:   host smtp.sendgrid.net, port 587, user "apikey", pass = your API key
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const REQUIRED_ENV_VARS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
const missingEnvVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
  console.error(
    `[mailer] Missing ${missingEnvVars.join(", ")} in server/.env — sending verification emails will fail until these are set. See server/.env.example.`
  );
}

const transporter = missingEnvVars.length === 0
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465, // true for 465 (SSL), false for 587/others (STARTTLS)
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

export const isMailerConfigured = missingEnvVars.length === 0;

/**
 * Sends a 6-digit verification code to `to`. Throws if SMTP isn't
 * configured or the send fails — callers should catch and turn this
 * into a clear error response rather than a silent failure.
 */
export async function sendVerificationEmail(to, code) {
  if (!transporter) {
    throw new Error(
      `Email sending isn't configured on the server (missing ${missingEnvVars.join(", ")}).`
    );
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: "Your Bobby Advisor verification code",
    text: `Your verification code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 420px;">
        <p>Your verification code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">${code}</p>
        <p style="color: #666; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}
