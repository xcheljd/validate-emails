import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmailInput } from './email-input';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock papaparse
vi.mock('papaparse', () => ({
  default: {
    parse: vi.fn(),
  },
}));

import Papa from 'papaparse';

function createCSVFile(content: string, name = 'test.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

function createTXTFile(content: string, name = 'test.txt'): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('EmailInput - Multi-file upload', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onEmailsLoaded: any;

  beforeEach(() => {
    vi.clearAllMocks();
    onEmailsLoaded = vi.fn();
  });

  it('file input has multiple attribute', () => {
    render(<EmailInput onEmailsLoaded={onEmailsLoaded} />);
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    expect(fileInput.hasAttribute('multiple')).toBe(true);
  });

  it('file input accept attribute is limited to .csv and .txt', () => {
    render(<EmailInput onEmailsLoaded={onEmailsLoaded} />);
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;
    expect(fileInput.getAttribute('accept')).toBe('.csv,.txt');
  });

  it('processes a single TXT file and extracts emails', async () => {
    render(<EmailInput onEmailsLoaded={onEmailsLoaded} />);
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;

    const file = createTXTFile('alice@example.com\nbob@example.com');
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(onEmailsLoaded).toHaveBeenCalled();
    });

    const emails = onEmailsLoaded.mock.calls[0][0] as string[];
    expect(emails).toContain('alice@example.com');
    expect(emails).toContain('bob@example.com');
  });

  it('processes a single CSV file and extracts emails', async () => {
    const parsedData = {
      data: [['alice@example.com'], ['bob@example.com']],
      errors: [],
      meta: {},
    };
    (Papa.parse as ReturnType<typeof vi.fn>).mockImplementation(
      (_file: unknown, options: { complete: (result: unknown) => void }) => {
        options.complete(parsedData);
      }
    );

    render(<EmailInput onEmailsLoaded={onEmailsLoaded} />);
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;

    const file = createCSVFile('email\nalice@example.com\nbob@example.com');
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(onEmailsLoaded).toHaveBeenCalled();
    });

    const emails = onEmailsLoaded.mock.calls[0][0] as string[];
    expect(emails).toContain('alice@example.com');
    expect(emails).toContain('bob@example.com');
  });

  it('processes multiple files and merges extracted emails', async () => {
    // Mock Papa.parse for CSV files
    (Papa.parse as ReturnType<typeof vi.fn>).mockImplementation(
      (file: File, options: { complete: (result: unknown) => void }) => {
        if (file.name === 'file1.csv') {
          options.complete({
            data: [['alice@example.com']],
            errors: [],
            meta: {},
          });
        } else {
          options.complete({
            data: [['bob@example.com']],
            errors: [],
            meta: {},
          });
        }
      }
    );

    render(<EmailInput onEmailsLoaded={onEmailsLoaded} />);
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;

    const file1 = createCSVFile('email\nalice@example.com', 'file1.csv');
    const file2 = createCSVFile('email\nbob@example.com', 'file2.csv');
    fireEvent.change(fileInput, { target: { files: [file1, file2] } });

    await waitFor(() => {
      expect(onEmailsLoaded).toHaveBeenCalled();
    });

    const emails = onEmailsLoaded.mock.calls[0][0] as string[];
    expect(emails).toContain('alice@example.com');
    expect(emails).toContain('bob@example.com');
    expect(emails.length).toBe(2);
  });

  it('deduplicates emails across multiple files', async () => {
    (Papa.parse as ReturnType<typeof vi.fn>).mockImplementation(
      (_file: unknown, options: { complete: (result: unknown) => void }) => {
        options.complete({
          data: [['shared@example.com']],
          errors: [],
          meta: {},
        });
      }
    );

    render(<EmailInput onEmailsLoaded={onEmailsLoaded} />);
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;

    const file1 = createCSVFile('email\nshared@example.com', 'file1.csv');
    const file2 = createCSVFile('email\nshared@example.com', 'file2.csv');
    fireEvent.change(fileInput, { target: { files: [file1, file2] } });

    await waitFor(() => {
      expect(onEmailsLoaded).toHaveBeenCalled();
    });

    const emails = onEmailsLoaded.mock.calls[0][0] as string[];
    // Should be deduplicated - only one instance
    const sharedCount = emails.filter((e: string) => e === 'shared@example.com').length;
    expect(sharedCount).toBe(1);
  });

  it('shows toast warning when a single file has zero emails', async () => {
    const { toast } = await import('sonner');

    render(<EmailInput onEmailsLoaded={onEmailsLoaded} />);
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;

    const emptyFile = createTXTFile('no emails here, just text');
    fireEvent.change(fileInput, { target: { files: [emptyFile] } });

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining('No valid emails found')
      );
    });

    // Should NOT call onEmailsLoaded when no emails were found
    expect(onEmailsLoaded).not.toHaveBeenCalled();
  });

  it('shows toast warning when ALL uploaded files have zero emails', async () => {
    const { toast } = await import('sonner');

    (Papa.parse as ReturnType<typeof vi.fn>).mockImplementation(
      (_file: unknown, options: { complete: (result: unknown) => void }) => {
        options.complete({
          data: [['header-only']],
          errors: [],
          meta: {},
        });
      }
    );

    render(<EmailInput onEmailsLoaded={onEmailsLoaded} />);
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;

    const emptyCsv = createCSVFile('email\n', 'empty1.csv');
    const emptyCsv2 = createCSVFile('email\n', 'empty2.csv');
    fireEvent.change(fileInput, { target: { files: [emptyCsv, emptyCsv2] } });

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining('No valid emails found')
      );
    });

    // Should NOT call onEmailsLoaded when all files are empty
    expect(onEmailsLoaded).not.toHaveBeenCalled();
  });

  it('shows toast warning for empty file among multiple files', async () => {
    const { toast } = await import('sonner');

    (Papa.parse as ReturnType<typeof vi.fn>).mockImplementation(
      (file: File, options: { complete: (result: unknown) => void }) => {
        if (file.name === 'good.csv') {
          options.complete({
            data: [['alice@example.com']],
            errors: [],
            meta: {},
          });
        } else {
          options.complete({
            data: [['no-email-here']],
            errors: [],
            meta: {},
          });
        }
      }
    );

    render(<EmailInput onEmailsLoaded={onEmailsLoaded} />);
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;

    const goodFile = createCSVFile('email\nalice@example.com', 'good.csv');
    const emptyFile = createCSVFile('data\nno-email-here', 'empty.csv');
    fireEvent.change(fileInput, { target: { files: [goodFile, emptyFile] } });

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalled();
    });

    // Still calls onEmailsLoaded with emails from the good file
    expect(onEmailsLoaded).toHaveBeenCalled();
    const emails = onEmailsLoaded.mock.calls[0][0] as string[];
    expect(emails).toContain('alice@example.com');
  });

  it('drag-and-drop processes all dropped files', async () => {
    (Papa.parse as ReturnType<typeof vi.fn>).mockImplementation(
      (file: File, options: { complete: (result: unknown) => void }) => {
        if (file.name === 'drop1.csv') {
          options.complete({
            data: [['drop1@example.com']],
            errors: [],
            meta: {},
          });
        } else {
          options.complete({
            data: [['drop2@example.com']],
            errors: [],
            meta: {},
          });
        }
      }
    );

    render(<EmailInput onEmailsLoaded={onEmailsLoaded} />);

    const dropZone = screen.getByText(/drop your email list here/i).closest('[class]')!;

    const file1 = createCSVFile('email\ndrop1@example.com', 'drop1.csv');
    const file2 = createCSVFile('email\ndrop2@example.com', 'drop2.csv');

    const dataTransfer = {
      files: [file1, file2],
    };

    fireEvent.drop(dropZone, {
      dataTransfer,
      preventDefault: vi.fn(),
    });

    await waitFor(() => {
      expect(onEmailsLoaded).toHaveBeenCalled();
    });

    const emails = onEmailsLoaded.mock.calls[0][0] as string[];
    expect(emails).toContain('drop1@example.com');
    expect(emails).toContain('drop2@example.com');
  });

  it('handles mixed CSV and TXT files together', async () => {
    (Papa.parse as ReturnType<typeof vi.fn>).mockImplementation(
      (_file: unknown, options: { complete: (result: unknown) => void }) => {
        options.complete({
          data: [['csv-user@example.com']],
          errors: [],
          meta: {},
        });
      }
    );

    render(<EmailInput onEmailsLoaded={onEmailsLoaded} />);
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;

    const csvFile = createCSVFile('email\ncsv-user@example.com', 'data.csv');
    const txtFile = createTXTFile('txt-user@example.com', 'data.txt');
    fireEvent.change(fileInput, { target: { files: [csvFile, txtFile] } });

    await waitFor(() => {
      expect(onEmailsLoaded).toHaveBeenCalled();
    });

    const emails = onEmailsLoaded.mock.calls[0][0] as string[];
    expect(emails).toContain('csv-user@example.com');
    expect(emails).toContain('txt-user@example.com');
    expect(emails.length).toBe(2);
  });
});
