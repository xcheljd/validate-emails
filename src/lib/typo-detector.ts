import * as typoDatabase from '@/lib/typo-database';

export function detectTypos(email: string): string | null {
  return typoDatabase.suggestCorrection(email);
}

export function detectTyposInList(emails: string[]): Map<string, string> {
  const typos = new Map<string, string>();
  emails.forEach(email => {
    const correction = typoDatabase.suggestCorrection(email);
    if (correction) {
      typos.set(email, correction);
    }
  });
  return typos;
}
