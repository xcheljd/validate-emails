import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CleaningReport } from './cleaning-report';
import type { CleaningResult } from '@/lib/email-cleaner';

function createMockResult(overrides: Partial<CleaningResult> = {}): CleaningResult {
  return {
    cleanedEmails: ['johndoe@gmail.com', 'user@outlook.com', 'test@yahoo.com'],
    originalCount: 10,
    exactDuplicatesRemoved: 2,
    normalizedDuplicatesRemoved: 3,
    typosCorrected: 1,
    syntaxFixes: 2,
    invalidDiscarded: 1,
    finalCount: 3,
    actions: [
      {
        type: 'syntax_fix',
        original: '<wrapped@gmail.com>',
        corrected: 'wrapped@gmail.com',
        description: 'Angle brackets removed',
      },
      {
        type: 'syntax_fix',
        original: 'john.@gmail.com',
        corrected: 'john@gmail.com',
        description: 'Trailing dot removed from local part',
      },
      {
        type: 'typo_correction',
        original: 'user@gmial.com',
        corrected: 'user@gmail.com',
        description: 'Domain typo corrected: gmial.com → gmail.com',
      },
    ],
    canonicalToOriginals: new Map([
      ['johndoe@gmail.com', ['john.doe@gmail.com', 'johndoe@gmail.com', 'johndoe+work@gmail.com']],
      ['user@outlook.com', ['user+tag@outlook.com', 'user@outlook.com']],
      ['test@yahoo.com', ['test@yahoo.com']],
    ]),
    ...overrides,
  };
}

describe('CleaningReport', () => {
  it('renders all 6 summary cards with correct values', () => {
    const result = createMockResult();
    render(
      <CleaningReport
        result={result}
        onProceed={vi.fn()}
        onBack={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    // Original count (unique value)
    expect(screen.getByText('10')).toBeInTheDocument();

    // Clean count appears in summary card and elsewhere
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);

    // Duplicates removed (2 exact + 3 normalized = 5) - appears in card and badge
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);

    // Typos corrected (unique count of 1)
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);

    // Syntax fixes (count 2)
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
  });

  it('renders card labels correctly', () => {
    const result = createMockResult();
    render(
      <CleaningReport
        result={result}
        onProceed={vi.fn()}
        onBack={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(screen.getByText('Clean')).toBeInTheDocument();
    expect(screen.getByText('Duplicates')).toBeInTheDocument();
    expect(screen.getByText('Typos')).toBeInTheDocument();
    // Syntax Fixes appears in both card and expandable section
    expect(screen.getAllByText('Syntax Fixes').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Invalid').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Proceed button with correct clean count', () => {
    const result = createMockResult();
    render(
      <CleaningReport
        result={result}
        onProceed={vi.fn()}
        onBack={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: /proceed with 3 clean emails/i })
    ).toBeInTheDocument();
  });

  it('calls onProceed when Proceed button is clicked', () => {
    const onProceed = vi.fn();
    const result = createMockResult();
    render(
      <CleaningReport
        result={result}
        onProceed={onProceed}
        onBack={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /proceed with 3 clean emails/i })
    );
    expect(onProceed).toHaveBeenCalledOnce();
  });

  it('calls onBack when Go Back button is clicked', () => {
    const onBack = vi.fn();
    const result = createMockResult();
    render(
      <CleaningReport
        result={result}
        onProceed={vi.fn()}
        onBack={onBack}
        onSkip={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /go back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('calls onSkip when Skip Cleaning button is clicked', () => {
    const onSkip = vi.fn();
    const result = createMockResult();
    render(
      <CleaningReport
        result={result}
        onProceed={vi.fn()}
        onBack={vi.fn()}
        onSkip={onSkip}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /skip cleaning/i }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('renders expandable sections for each category with counts', () => {
    const result = createMockResult();
    render(
      <CleaningReport
        result={result}
        onProceed={vi.fn()}
        onBack={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    // Section headers should show category name
    expect(screen.getByText('Duplicates Removed')).toBeInTheDocument();
    expect(screen.getByText('Typos Corrected')).toBeInTheDocument();
    expect(screen.getByText('Invalid & Discarded')).toBeInTheDocument();
    // Syntax Fixes appears in card label too, use getAllByText
    expect(screen.getAllByText('Syntax Fixes').length).toBeGreaterThanOrEqual(1);
  });

  it('expands a section when clicked and shows details', () => {
    const result = createMockResult();
    render(
      <CleaningReport
        result={result}
        onProceed={vi.fn()}
        onBack={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    // Click on "Typos Corrected" section to expand it
    const typosSection = screen.getByText(/typos corrected/i);
    fireEvent.click(typosSection);

    // Should now show the typo details
    expect(screen.getByText(/user@gmial.com/i)).toBeInTheDocument();
    expect(screen.getByText(/user@gmail.com/i)).toBeInTheDocument();
  });

  it('shows "No items" for empty categories when expanded', () => {
    const result = createMockResult({
      actions: [],
      typosCorrected: 0,
      syntaxFixes: 0,
      invalidDiscarded: 0,
      exactDuplicatesRemoved: 0,
      normalizedDuplicatesRemoved: 0,
      cleanedEmails: ['solo@example.com'],
      finalCount: 1,
      originalCount: 1,
      canonicalToOriginals: new Map([['solo@example.com', ['solo@example.com']]]),
    });
    render(
      <CleaningReport
        result={result}
        onProceed={vi.fn()}
        onBack={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    // Expand an empty section - click on the "Duplicates Removed" text
    const section = screen.getByText('Duplicates Removed');
    fireEvent.click(section);
    // The empty message should appear
    expect(screen.getByText(/no duplicates removed to display/i)).toBeInTheDocument();
  });

  it('shows clean list preview section with cleaned emails', () => {
    const result = createMockResult();
    render(
      <CleaningReport
        result={result}
        onProceed={vi.fn()}
        onBack={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    // Clean list should be visible
    expect(screen.getByText(/cleaned emails/i)).toBeInTheDocument();
    expect(screen.getByText('johndoe@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('user@outlook.com')).toBeInTheDocument();
    expect(screen.getByText('test@yahoo.com')).toBeInTheDocument();
  });
});
