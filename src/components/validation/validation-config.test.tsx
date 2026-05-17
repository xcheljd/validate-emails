import { render, screen, fireEvent, within } from '@testing-library/react';
import { ValidationConfig } from './validation-config';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

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

const defaultProps = {
  emails: ['test@example.com', 'user@test.com'],
  onClear: vi.fn(),
  onStart: vi.fn(),
  validationMode: 'standard' as const,
  onModeChange: vi.fn(),
  onBack: vi.fn(),
};

// Helper to find the summary card (the "Ready to Verify" card)
function getSummaryCard() {
  const heading = screen.getByText('Ready to Verify');
  // Walk up to the Card container
  return heading.closest('[class*="border-2"]') as HTMLElement;
}

describe('ValidationConfig', () => {
  it('renders the Ready to Verify card with email count', () => {
    render(<ValidationConfig {...defaultProps} />);
    const card = getSummaryCard();
    expect(card).toBeTruthy();
    // The email count should appear in the summary card
    expect(within(card).getByText('2')).toBeInTheDocument();
  });

  it('displays Standard mode name in the summary card', () => {
    render(<ValidationConfig {...defaultProps} validationMode="standard" />);
    const card = getSummaryCard();
    expect(within(card).getByText('Standard')).toBeInTheDocument();
  });

  it('displays Quick mode name in the summary card when selected', () => {
    render(<ValidationConfig {...defaultProps} validationMode="quick" />);
    const card = getSummaryCard();
    expect(within(card).getByText('Quick')).toBeInTheDocument();
  });

  it('displays Thorough mode name in the summary card when selected', () => {
    render(<ValidationConfig {...defaultProps} validationMode="thorough" />);
    const card = getSummaryCard();
    expect(within(card).getByText('Thorough')).toBeInTheDocument();
  });

  it('updates the mode name in summary when validationMode prop changes', () => {
    const { rerender } = render(
      <ValidationConfig {...defaultProps} validationMode="quick" />
    );
    let card = getSummaryCard();
    expect(within(card).getByText('Quick')).toBeInTheDocument();

    rerender(
      <ValidationConfig {...defaultProps} validationMode="thorough" />
    );
    card = getSummaryCard();
    expect(within(card).getByText('Thorough')).toBeInTheDocument();
    // Quick should NOT be in the summary card after switching
    expect(within(card).queryByText('Quick')).not.toBeInTheDocument();
  });

  it('renders the Start Validation button', () => {
    render(<ValidationConfig {...defaultProps} />);
    expect(
      screen.getByRole('button', { name: /start validation/i })
    ).toBeInTheDocument();
  });

  it('calls onStart when Start Validation is clicked', () => {
    const onStart = vi.fn();
    render(<ValidationConfig {...defaultProps} onStart={onStart} />);
    fireEvent.click(
      screen.getByRole('button', { name: /start validation/i })
    );
    expect(onStart).toHaveBeenCalledOnce();
  });
});
