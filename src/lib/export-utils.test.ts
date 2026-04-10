import { describe, it, expect } from 'vitest';
import { formatAsCSV } from './export-utils';
import { ValidationResult } from '@/lib/types';

const baseResult = {
  logs: [] as string[],
  domain: 'example.com',
  validationDuration: 1000,
  mxRecordCount: 2,
  isDisposable: false,
  isRoleAccount: false,
  isCatchAll: false,
  isDeliverable: true,
  isDisabled: false,
  hasFullInbox: false,
  canConnectSmtp: true,
  acceptsMail: true,
  isValidSyntax: true,
  isB2c: false,
  timestamp: '2025-01-04T00:00:00Z',
  validationMode: 'standard' as const,
};

const mockResults: ValidationResult[] = [
  { email: 'test1@example.com', result: 'Safe', reason: 'Reachable', ...baseResult, riskScore: 0 },
  { email: 'test2@example.com', result: 'Invalid', reason: 'Syntax error', ...baseResult, riskScore: 100 },
];

describe('Export Utils', () => {
  it('should format results as CSV string', () => {
    const csv = formatAsCSV(mockResults);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3); // Header + 2 data lines
    expect(lines[0]).toBe('Email,Status,Reason');
    expect(lines[1]).toBe('test1@example.com,Safe,Reachable');
    expect(lines[2]).toBe('test2@example.com,Invalid,Syntax error');
  });

  it('should escape commas in values', () => {
    const results: ValidationResult[] = [
      { email: 'test@example.com', result: 'Risky', reason: 'Potential issues, check MX', ...baseResult, riskScore: 30 }
    ];
    const csv = formatAsCSV(results);
    expect(csv).toContain('"Potential issues, check MX"');
  });
});
