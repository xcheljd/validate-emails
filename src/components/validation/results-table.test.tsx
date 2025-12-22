import { describe, it, expect } from 'vitest';
import { filterResults, sortResults } from './results-table-logic';
import { ValidationResult } from '@/hooks/use-email-validation';

const mockResults: ValidationResult[] = [
  { email: 'c@example.com', result: 'Safe', reason: '', logs: [] },
  { email: 'a@example.com', result: 'Invalid', reason: '', logs: [] },
  { email: 'b@example.com', result: 'Risky', reason: '', logs: [] },
];

describe('ResultsTable Logic', () => {
  it('should filter results by email', () => {
    const filtered = filterResults(mockResults, 'a@');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].email).toBe('a@example.com');
  });

  it('should filter results by status', () => {
    const filtered = filterResults(mockResults, 'Safe');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].result).toBe('Safe');
  });

  it('should sort results by email ascending', () => {
    const sorted = sortResults(mockResults, 'email', 'asc');
    expect(sorted[0].email).toBe('a@example.com');
    expect(sorted[2].email).toBe('c@example.com');
  });

  it('should sort results by email descending', () => {
    const sorted = sortResults(mockResults, 'email', 'desc');
    expect(sorted[0].email).toBe('c@example.com');
    expect(sorted[2].email).toBe('a@example.com');
  });
});
