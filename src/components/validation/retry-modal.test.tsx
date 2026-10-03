import { render, screen, fireEvent } from '@testing-library/react';
import { RetryModal } from './retry-modal';
import { describe, it, expect, vi } from 'vitest';

describe('RetryModal', () => {
  const defaultProps = {
    open: true,
    unknownCount: 5,
    onRetry: vi.fn(),
    onCancel: vi.fn(),
  };

  it('should render when open', () => {
    render(<RetryModal {...defaultProps} />);
    expect(screen.getByText('Retry Unknown Emails')).toBeInTheDocument();
    expect(screen.getByText(/5 emails have unknown status/)).toBeInTheDocument();
  });

  it('should render three tier options', () => {
    render(<RetryModal {...defaultProps} />);
    expect(screen.getByText('Tier 1: Quick')).toBeInTheDocument();
    expect(screen.getByText('Tier 2: Standard')).toBeInTheDocument();
    expect(screen.getByText('Tier 3: Thorough')).toBeInTheDocument();
  });

  it('should render Auto-Escalate option', () => {
    render(<RetryModal {...defaultProps} />);
    expect(screen.getByText('Auto-Escalate')).toBeInTheDocument();
  });

  it('should highlight Standard tier by default', () => {
    render(<RetryModal {...defaultProps} />);
    const standardButton = screen.getByRole('button', { name: /Tier 2: Standard/ });
    expect(standardButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('should select a different tier when clicked', () => {
    render(<RetryModal {...defaultProps} />);
    const quickButton = screen.getByRole('button', { name: /Tier 1: Quick/ });
    fireEvent.click(quickButton);
    expect(quickButton).toHaveAttribute('aria-pressed', 'true');

    // Standard should no longer be pressed
    const standardButton = screen.getByRole('button', { name: /Tier 2: Standard/ });
    expect(standardButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('should only allow one tier selected at a time', () => {
    render(<RetryModal {...defaultProps} />);
    const quickButton = screen.getByRole('button', { name: /Tier 1: Quick/ });
    const thoroughButton = screen.getByRole('button', { name: /Tier 3: Thorough/ });

    fireEvent.click(quickButton);
    expect(quickButton).toHaveAttribute('aria-pressed', 'true');
    expect(thoroughButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(thoroughButton);
    expect(thoroughButton).toHaveAttribute('aria-pressed', 'true');
    expect(quickButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('should call onRetry with selected tier when retry button clicked', () => {
    const onRetry = vi.fn();
    render(<RetryModal {...defaultProps} onRetry={onRetry} />);

    // Click Quick tier then retry
    fireEvent.click(screen.getByRole('button', { name: /Tier 1: Quick/ }));
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledWith('quick');
  });

  it('should call onRetry with auto-escalate when auto-escalate is checked and retry clicked', () => {
    const onRetry = vi.fn();
    render(<RetryModal {...defaultProps} onRetry={onRetry} />);

    // Enable auto-escalate
    const autoEscCheckbox = screen.getByRole('checkbox', { name: /Auto-Escalate/ });
    fireEvent.click(autoEscCheckbox);

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledWith('auto-escalate');
  });

  it('should call onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<RetryModal {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('should show escalation progress when isEscalating is true', () => {
    render(
      <RetryModal
        {...defaultProps}
        isEscalating={true}
        escalationTier={2}
        escalationEmailCount={3}
      />
    );
    expect(screen.getByText(/Tier 2 of 2 — Thorough/)).toBeInTheDocument();
    expect(screen.getByText(/Retrying 3 emails/)).toBeInTheDocument();
  });

  it('should disable retry button when escalating', () => {
    render(
      <RetryModal
        {...defaultProps}
        isEscalating={true}
        escalationTier={1}
        escalationEmailCount={5}
      />
    );
    const retryButton = screen.getByRole('button', { name: /Escalating/ });
    expect(retryButton).toBeDisabled();
  });
});
