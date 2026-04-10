import { describe, it, expect, beforeEach } from 'vitest';
import { exportToCSV, exportColumns } from './enhanced-export-utils';
import { ValidationResult } from '@/lib/types';

describe('enhanced-export-utils', () => {
  const mockResults: ValidationResult[] = [
    {
      email: 'test1@example.com',
      result: 'Safe',
      reason: 'Valid email',
      logs: [],
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
      timestamp: '2025-01-04T14:30:00Z',
      validationMode: 'standard',
      riskScore: 0,
    },
    {
      email: 'test2@test.org',
      result: 'Invalid',
      reason: 'Invalid syntax',
      logs: [],
      domain: 'test.org',
      validationDuration: 500,
      mxRecordCount: 0,
      isDisposable: false,
      isRoleAccount: false,
      isCatchAll: false,
      isDeliverable: false,
      isDisabled: false,
      hasFullInbox: false,
      canConnectSmtp: false,
      acceptsMail: false,
      isValidSyntax: false,
      isB2c: false,
      timestamp: '2025-01-04T14:31:00Z',
      validationMode: 'standard',
      riskScore: 100,
    },
  ];

  beforeEach(() => {
    exportColumns.forEach(col => col.enabled = true);
  });

  it('should export all columns when all are enabled', () => {
    const csv = exportToCSV(mockResults, exportColumns);
    const lines = csv.split('\n');

    expect(lines[0]).toBe('Email,Status,Verdict Reason,Domain,Risk Score,Valid Syntax,Deliverable,Disabled,Full Inbox,Catch-All,Disposable,Role Account,B2C Provider,SMTP Connected,Accepts Mail,MX Records,Breached,Suggestion,Duration (ms),Validated At,Mode,Error Type');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('test1@example.com');
    expect(lines[1]).toContain('Safe');
    expect(lines[2]).toContain('test2@test.org');
    expect(lines[2]).toContain('Invalid');
  });

  it('should export only enabled columns', () => {
    const enabledColumns = exportColumns.slice(0, 3);
    exportColumns.forEach(col => col.enabled = false);
    enabledColumns.forEach(col => col.enabled = true);

    const csv = exportToCSV(mockResults, exportColumns);
    const lines = csv.split('\n');

    expect(lines[0]).toBe('Email,Status,Verdict Reason');
    expect(lines[1]).toContain('test1@example.com');
    expect(lines[1]).toContain('Safe');
  });

  it('should escape commas in CSV values', () => {
    const resultWithComma: ValidationResult[] = [
      {
        ...mockResults[0],
        reason: 'Potential issues, check MX',
      },
    ];

    const csv = exportToCSV(resultWithComma, exportColumns);
    expect(csv).toContain('"Potential issues, check MX"');
  });

  it('should handle null values by replacing with hyphen', () => {
    const resultWithNulls: ValidationResult[] = [
      {
        ...mockResults[0],
        errorType: undefined,
      },
    ];

    const csv = exportToCSV(resultWithNulls, exportColumns);
    const lines = csv.split('\n');
    const dataLine = lines[1];
    const columns = dataLine.split(',');

    const errorIndex = exportColumns.findIndex(c => c.key === 'errorType');

    expect(columns[errorIndex]).toBe('-');
  });

  it('exportColumns should have all columns with correct labels', () => {
    expect(exportColumns).toHaveLength(22);
    expect(exportColumns[0]).toEqual({ key: 'email', label: 'Email', enabled: true });
    expect(exportColumns[1]).toEqual({ key: 'result', label: 'Status', enabled: true });
    expect(exportColumns[2]).toEqual({ key: 'reason', label: 'Verdict Reason', enabled: true });
    expect(exportColumns[3]).toEqual({ key: 'domain', label: 'Domain', enabled: true });
  });
});
