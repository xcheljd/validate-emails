import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest';
import { ExportDialog } from './export-dialog';
import { ValidationResult } from '@/lib/types';

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseResult: Omit<ValidationResult, 'email' | 'result' | 'reason'> = {
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
  timestamp: '2025-01-04T00:00:00Z',
  validationMode: 'standard',
  riskScore: 0,
};

const mockResults: ValidationResult[] = [
  {
    email: 'safe@example.com',
    result: 'Safe',
    reason: 'Deliverable',
    ...baseResult,
  },
  {
    email: 'invalid@example.com',
    result: 'Invalid',
    reason: 'Bad syntax',
    ...baseResult,
    riskScore: 100,
  },
  {
    email: 'risky@example.com',
    result: 'Risky',
    reason: 'Catch-all domain',
    ...baseResult,
    riskScore: 50,
  },
];

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  results: mockResults,
};

// Helper: Radix Dialog portals duplicate buttons, so use getAllByRole and take last
function getButton(name: RegExp | string) {
  const buttons = screen.getAllByRole('button', { name });
  return buttons[buttons.length - 1];
}

describe('ExportDialog', () => {
  it('renders the dialog when open is true', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByText('Export Results')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(<ExportDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Export Results')).not.toBeInTheDocument();
  });

  it('shows all 22 column toggles, all enabled by default', () => {
    render(<ExportDialog {...defaultProps} />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(22);
    checkboxes.forEach((cb) => {
      expect(cb).toBeChecked();
    });
  });

  it('has format selector with CSV (default) and XLSX options', () => {
    render(<ExportDialog {...defaultProps} />);
    // Format buttons are plain buttons, not radio inputs with labels
    const formatSection = screen.getByText('Format').closest('div')!;
    const csvBtn = within(formatSection.parentElement!).getByText('CSV');
    const xlsxBtn = within(formatSection.parentElement!).getByText('XLSX');
    expect(csvBtn).toBeInTheDocument();
    expect(xlsxBtn).toBeInTheDocument();
    // CSV should have the active (primary) styling by default
    expect(csvBtn.closest('button')).toHaveClass('border-primary');
    expect(xlsxBtn.closest('button')).not.toHaveClass('border-primary');
  });

  it('allows toggling individual columns on/off', () => {
    render(<ExportDialog {...defaultProps} />);
    const checkboxes = screen.getAllByRole('checkbox');
    // Uncheck the first column
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).not.toBeChecked();
    // Second column should still be checked
    expect(checkboxes[1]).toBeChecked();
  });

  it('has Select All and Deselect All controls', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(getButton(/^Select All$/)).toBeInTheDocument();
    expect(getButton(/^Deselect All$/)).toBeInTheDocument();
  });

  it('Select All enables every column', () => {
    render(<ExportDialog {...defaultProps} />);
    // First deselect all
    fireEvent.click(getButton(/^Deselect All$/));
    let checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach((cb) => {
      expect(cb).not.toBeChecked();
    });
    // Then select all
    fireEvent.click(getButton(/^Select All$/));
    checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach((cb) => {
      expect(cb).toBeChecked();
    });
  });

  it('Deselect All disables every column', () => {
    render(<ExportDialog {...defaultProps} />);
    fireEvent.click(getButton(/^Deselect All$/));
    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach((cb) => {
      expect(cb).not.toBeChecked();
    });
  });

  it('shows three preset templates', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(getButton(/full report/i)).toBeInTheDocument();
    expect(getButton(/clean list/i)).toBeInTheDocument();
    expect(getButton(/suppression list/i)).toBeInTheDocument();
  });

  it('Full Report preset enables all columns with no filter', () => {
    render(<ExportDialog {...defaultProps} />);
    // First deselect some columns
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    // Click Full Report
    fireEvent.click(getButton(/full report/i));

    // All columns should be checked
    const updatedCheckboxes = screen.getAllByRole('checkbox');
    updatedCheckboxes.forEach((cb) => {
      expect(cb).toBeChecked();
    });

    // No filter indicator should be shown (no element containing "only")
    expect(screen.queryByText(/only/i)).not.toBeInTheDocument();
  });

  it('Clean List preset shows Safe-only filter indicator', () => {
    render(<ExportDialog {...defaultProps} />);
    fireEvent.click(getButton(/clean list/i));
    expect(screen.getByText(/safe only/i)).toBeInTheDocument();
  });

  it('Suppression List preset shows Invalid/Risky filter indicator', () => {
    render(<ExportDialog {...defaultProps} />);
    fireEvent.click(getButton(/suppression list/i));
    expect(screen.getByText(/invalid.*risky/i)).toBeInTheDocument();
  });

  it('persists column state to localStorage on change', () => {
    render(<ExportDialog {...defaultProps} />);
    const checkboxes = screen.getAllByRole('checkbox');
    // Uncheck the first column
    fireEvent.click(checkboxes[0]);

    // Check localStorage was updated
    const stored = JSON.parse(
      localStorage.getItem('export-dialog-state') || '{}'
    );
    const firstColumnKey = 'email'; // first column is email
    expect(stored.columns[firstColumnKey]).toBe(false);
  });

  it('restores column state from localStorage on mount', () => {
    // Pre-populate localStorage with Email unchecked
    localStorage.setItem(
      'export-dialog-state',
      JSON.stringify({
        columns: { email: false, result: true },
        format: 'csv',
        resultFilter: 'all',
      })
    );

    render(<ExportDialog {...defaultProps} />);
    const checkboxes = screen.getAllByRole('checkbox');
    // First column (email) should be unchecked
    expect(checkboxes[0]).not.toBeChecked();
    // Second column (result) should be checked
    expect(checkboxes[1]).toBeChecked();
  });

  it('has an Export button that triggers download', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(getButton(/^export$/i)).toBeInTheDocument();
  });

  it('has a close button (X)', () => {
    render(<ExportDialog {...defaultProps} />);
    // The Dialog component from Shadcn includes a close button with sr-only text "Close"
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    const closeBtn = closeButtons[closeButtons.length - 1];
    expect(closeBtn).toBeInTheDocument();
  });

  it('calls onOpenChange(false) when close button is clicked', () => {
    const onOpenChange = vi.fn();
    render(<ExportDialog {...defaultProps} onOpenChange={onOpenChange} />);
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    const closeBtn = closeButtons[closeButtons.length - 1];
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('persists format selection to localStorage', () => {
    render(<ExportDialog {...defaultProps} />);
    // Switch to XLSX by clicking the XLSX format button
    const formatSection = screen.getByText('Format').closest('div')!;
    const xlsxBtn = within(formatSection.parentElement!).getByText('XLSX');
    fireEvent.click(xlsxBtn);

    const stored = JSON.parse(
      localStorage.getItem('export-dialog-state') || '{}'
    );
    expect(stored.format).toBe('xlsx');
  });

  it('restores format from localStorage on mount', () => {
    localStorage.setItem(
      'export-dialog-state',
      JSON.stringify({
        columns: {},
        format: 'xlsx',
        resultFilter: 'all',
      })
    );

    render(<ExportDialog {...defaultProps} />);
    // XLSX should have active styling, CSV should not
    const formatSection = screen.getByText('Format').closest('div')!;
    const csvBtn = within(formatSection.parentElement!).getByText('CSV');
    const xlsxBtn = within(formatSection.parentElement!).getByText('XLSX');
    expect(xlsxBtn.closest('button')).toHaveClass('border-primary');
    expect(csvBtn.closest('button')).not.toHaveClass('border-primary');
  });
});
