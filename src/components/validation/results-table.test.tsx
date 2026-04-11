import { render, screen, fireEvent } from '@testing-library/react';
import { ResultsTable } from './results-table';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { ValidationResult } from '@/lib/types';
import { filterResults, sortResults } from './results-table-logic';

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  vi.restoreAllMocks();
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
  {
    email: 'c@example.com',
    result: 'Safe',
    reason: '',
    ...baseResult,
    riskScore: 0,
  },
  {
    email: 'a@example.com',
    result: 'Invalid',
    reason: '',
    ...baseResult,
    riskScore: 100,
  },
  {
    email: 'b@example.com',
    result: 'Risky',
    reason: '',
    ...baseResult,
    riskScore: 30,
  },
];

describe('ResultsTable Structure', () => {
  it('renders valid table structure (no divs in tbody)', () => {
    const { container } = render(
      <ResultsTable
        results={mockResults}
        onViewDetails={vi.fn()}
        statusFilter="all"
        onStatusFilterChange={vi.fn()}
      />
    );
    const tbody = container.querySelector('tbody');
    expect(tbody).toBeInTheDocument();

    // Direct children of tbody must be TRs
    const children = Array.from(tbody!.children);
    const nonTrChildren = children.filter((child) => child.tagName !== 'TR');

    if (nonTrChildren.length > 0) {
      console.log(
        'Invalid children tags:',
        nonTrChildren.map((c) => c.tagName)
      );
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

describe('ResultsTable Delete Selected', () => {
  it('calls onDeleteResults with selected emails when delete is confirmed', () => {
    const onDeleteResults = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const currentResults = [...mockResults];

    render(
      <ResultsTable
        results={currentResults}
        onViewDetails={vi.fn()}
        statusFilter="all"
        onStatusFilterChange={vi.fn()}
        onDeleteResults={onDeleteResults}
      />
    );

    // Select all rows via "select all" checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    // The first checkbox is "select all"
    fireEvent.click(checkboxes[0]);

    // Click the Delete button
    const deleteButton = screen.getByText('Delete');
    fireEvent.click(deleteButton);

    // Confirm was shown
    expect(confirmSpy).toHaveBeenCalledWith('Delete 3 selected results?');

    // onDeleteResults was called with a Set containing all 3 emails
    expect(onDeleteResults).toHaveBeenCalledTimes(1);
    const deletedEmails = onDeleteResults.mock.calls[0][0] as Set<string>;
    expect(deletedEmails.size).toBe(3);
    expect(deletedEmails.has('a@example.com')).toBe(true);
    expect(deletedEmails.has('b@example.com')).toBe(true);
    expect(deletedEmails.has('c@example.com')).toBe(true);

    confirmSpy.mockRestore();
  });

  it('does not call onDeleteResults when delete is cancelled', () => {
    const onDeleteResults = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <ResultsTable
        results={mockResults}
        onViewDetails={vi.fn()}
        statusFilter="all"
        onStatusFilterChange={vi.fn()}
        onDeleteResults={onDeleteResults}
      />
    );

    // Select all rows
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    // Click the Delete button
    const deleteButton = screen.getByText('Delete');
    fireEvent.click(deleteButton);

    // onDeleteResults should NOT be called when user cancels
    expect(onDeleteResults).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('onDeleteResults filters out deleted results when wired to state', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    let currentResults = [...mockResults];
    const setResults = (
      updaterOrValue:
        | ValidationResult[]
        | ((prev: ValidationResult[]) => ValidationResult[])
    ) => {
      if (typeof updaterOrValue === 'function') {
        currentResults = updaterOrValue(currentResults);
      } else {
        currentResults = updaterOrValue;
      }
    };

    const handleDeleteResults = (emailsToDelete: Set<string>) => {
      setResults((prev) => prev.filter((r) => !emailsToDelete.has(r.email)));
    };

    render(
      <ResultsTable
        results={currentResults}
        onViewDetails={vi.fn()}
        statusFilter="all"
        onStatusFilterChange={vi.fn()}
        onDeleteResults={handleDeleteResults}
      />
    );

    // Select all rows and delete
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    const deleteButton = screen.getByText('Delete');
    fireEvent.click(deleteButton);

    // After delete, results should be empty (all 3 were selected)
    expect(currentResults).toHaveLength(0);

    confirmSpy.mockRestore();
  });
});
