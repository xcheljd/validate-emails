export function parseEmails(input: string): string[] {
  if (!input || !input.trim()) {
    return [];
  }

  // Split by comma, semicolon, or newline, then trim whitespace
  const rawEmails = input.split(/[,\n;]+/);

  // Loose validation: must contain @ with something on each side.
  // Strict validation (RFC-compliant regex, disposable checks, etc.)
  // is handled by the email-cleaner pipeline downstream.
  return rawEmails
    .map((email) => email.trim())
    .filter((email) => email.length > 0 && email.includes('@'));
}
