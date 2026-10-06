// One password rule used everywhere a password is created or changed:
// student registration, reset password, and change password for
// student / advisor / admin. The server enforces the same rule.
export const PASSWORD_RULE_TEXT =
  "Password must be at least 8 characters and include at least 1 uppercase letter, 1 lowercase letter and 1 number.";

export const PASSWORD_HINT =
  "At least 8 characters, with 1 uppercase letter, 1 lowercase letter and 1 number.";

/** Returns an error message, or null when the password is acceptable. */
export function validatePasswordStrength(password) {
  const value = String(password || "");
  if (
    value.length < 8 ||
    !/[A-Z]/.test(value) ||
    !/[a-z]/.test(value) ||
    !/[0-9]/.test(value)
  ) {
    return PASSWORD_RULE_TEXT;
  }
  return null;
}