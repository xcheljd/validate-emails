export function parseEmails(input: string): string[] {
  if (!input || !input.trim()) {
    return [];
  }

  // Split by comma or newline, then trim whitespace
  const rawEmails = input.split(/[,\n]/);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  return rawEmails
    .map((email) => email.trim())
    .filter((email) => email.length > 0 && emailRegex.test(email));
}
