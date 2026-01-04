import { describe, it, expect, beforeEach } from 'vitest';
import { exportToCSV, exportColumns } from './enhanced-export-utils';
import { ValidationResult } from '@/hooks/use-email-validation';

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

    expect(lines[0]).toBe('Email,Status,Verdict Reason,Domain,Duration (ms),Proxy,MX Records,Disposable,Role Account,Catch-All,Error Type,Validated At,Validation Mode');
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
        proxyUsed: null as any,
        errorType: undefined,
      },
    ];

    const csv = exportToCSV(resultWithNulls, exportColumns);
    const lines = csv.split('\n');
    const dataLine = lines[1];
    const columns = dataLine.split(',');

    const proxyIndex = exportColumns.findIndex(c => c.key === 'proxyUsed');
    const errorIndex = exportColumns.findIndex(c => c.key === 'errorType');

    expect(columns[proxyIndex]).toBe('-');
    expect(columns[errorIndex]).toBe('-');
  });

  it('exportColumns should have all 13 columns with correct labels', () => {
    expect(exportColumns).toHaveLength(13);
    expect(exportColumns[0]).toEqual({ key: 'email', label: 'Email', enabled: true });
    expect(exportColumns[1]).toEqual({ key: 'result', label: 'Status', enabled: true });
    expect(exportColumns[2]).toEqual({ key: 'reason', label: 'Verdict Reason', enabled: true });
    expect(exportColumns[3]).toEqual({ key: 'domain', label: 'Domain', enabled: true });
  });
});
