import { describe, it, expect } from 'vitest';
import { parseEmails } from './email-parser';

describe('parseEmails', () => {
  it('should parse emails separated by newlines', () => {
    const input = 'test1@example.com\ntest2@example.com\n\ntest3@example.com';
    const result = parseEmails(input);
    expect(result).toEqual([
      'test1@example.com',
      'test2@example.com',
      'test3@example.com',
    ]);
  });

  it('should parse emails separated by commas', () => {
    const input = 'test1@example.com, test2@example.com ,test3@example.com';
    const result = parseEmails(input);
    expect(result).toEqual([
      'test1@example.com',
      'test2@example.com',
      'test3@example.com',
    ]);
  });

  it('should parse emails with mixed separators', () => {
    const input = 'test1@example.com\ntest2@example.com, test3@example.com';
    const result = parseEmails(input);
    expect(result).toEqual([
      'test1@example.com',
      'test2@example.com',
      'test3@example.com',
    ]);
  });

  it('should handle empty input', () => {
    expect(parseEmails('')).toEqual([]);
    expect(parseEmails('   ')).toEqual([]);
  });

  it('should ignore invalid email strings (basic check)', () => {
    // Note: The parser's job is just splitting and trimming,
    // but we can add basic filtering if we want.
    const input = 'test1@example.com, not-an-email, test2@example.com';
    const result = parseEmails(input);
    // If we only want valid-looking emails:
    expect(result).toEqual(['test1@example.com', 'test2@example.com']);
  });
});
