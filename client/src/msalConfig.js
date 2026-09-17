// Configuration for "Sign in with Microsoft" — the same Microsoft
// Entra ID (Azure AD) identity used to sign in to Microsoft Teams,
// Outlook, and the rest of Microsoft 365. Signing in here doesn't open
// Teams itself; it authenticates the person's Microsoft account, which
// is what lets a Teams/M365 login work for this site.
//
// To make this actually work you need to register an app in the
// Microsoft Entra admin center (https://entra.microsoft.com):
//   1. App registrations > New registration.
//   2. Supported account types: pick whatever fits your school/org
//      (single tenant, or "any organizational directory").
//   3. Platform: Single-page application (SPA). Redirect URI: this
//      site's URL (e.g. http://localhost:5173 for local dev).
//   4. Copy the "Application (client) ID" and "Directory (tenant) ID"
//      from the Overview page into client/.env (see .env.example).
//   5. API permissions: Microsoft Graph > User.Read (usually added by
//      default) — that's all this app needs to read the signed-in
//      person's name and email.
import { LogLevel } from "@azure/msal-browser";

export const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_MSAL_CLIENT_ID || "",
    authority: `https://login.microsoftonline.com/${
      import.meta.env.VITE_MSAL_TENANT_ID || "common"
    }`,
    redirectUri: import.meta.env.VITE_MSAL_REDIRECT_URI || window.location.origin,
  },
  cache: {
    // sessionStorage (not localStorage) so signing out of one browser
    // tab doesn't silently affect others, and nothing MSAL-related
    // lingers after the tab is closed.
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        if (level === LogLevel.Error) console.error(message);
      },
    },
  },
};

// User.Read is enough to read the signed-in person's profile (name,
// email/UPN) via the /me endpoint — that's all we need to match them
// against the Student/Advisor/Admin roster.
//
// prompt: "select_account" forces Microsoft to always show the account
// picker/login screen, even when the browser already has an active
// Microsoft session. Without it, the popup silently completes SSO with
// whichever account is already signed in — it flashes open and closes
// almost instantly instead of showing anything, which is confusing and
// also means you can't switch accounts from here.
export const loginRequest = {
  scopes: ["User.Read"],
  prompt: "select_account",
};

export const isMsalConfigured = Boolean(import.meta.env.VITE_MSAL_CLIENT_ID);
