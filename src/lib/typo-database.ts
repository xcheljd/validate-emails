export const typoMap: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gmali.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'yahooo.com': 'yahoo.com',
  'yahooo.co': 'yahoo.co',
  'yaho.com': 'yahoo.com',
  'yhaoo.com': 'yahoo.com',
  'hotmail.co': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmil.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'outlooke.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'gmx.com': 'gmail.com',
  'gmx.net': 'gmail.com',
  'aol.co': 'aol.com',
  'aol.com': 'aol.com',
  'icloud.com': 'icloud.com',
};

export function suggestCorrection(email: string): string | null {
  const [local, domain] = email.toLowerCase().split('@');
  if (!domain || !typoMap[domain]) return null;
  return `${local}@${typoMap[domain]}`;
}

export function detectTypos(emails: string[]): Map<string, string> {
  const corrections = new Map<string, string>();
  emails.forEach((email) => {
    const correction = suggestCorrection(email);
    if (correction) corrections.set(email, correction);
  });
  return corrections;
}
