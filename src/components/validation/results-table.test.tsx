import { render } from '@testing-library/react';
import { ResultsTable } from './results-table';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ValidationResult } from '@/lib/types';
import { filterResults, sortResults } from './results-table-logic';

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

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
  { email: 'c@example.com', result: 'Safe', reason: '', ...baseResult, riskScore: 0 },
  { email: 'a@example.com', result: 'Invalid', reason: '', ...baseResult, riskScore: 100 },
  { email: 'b@example.com', result: 'Risky', reason: '', ...baseResult, riskScore: 30 },
];

describe('ResultsTable Structure', () => {
  it('renders valid table structure (no divs in tbody)', () => {
    const { container } = render(<ResultsTable results={mockResults} onViewDetails={vi.fn()} />);
    const tbody = container.querySelector('tbody');
    expect(tbody).toBeInTheDocument();
    
    // Direct children of tbody must be TRs
    const children = Array.from(tbody!.children);
    const nonTrChildren = children.filter(child => child.tagName !== 'TR');
    
    if (nonTrChildren.length > 0) {
        console.log('Invalid children tags:', nonTrChildren.map(c => c.tagName));
    }
    expect(nonTrChildren).toHaveLength(0);
  });
});

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