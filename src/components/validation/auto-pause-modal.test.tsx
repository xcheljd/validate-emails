import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutoPauseModal } from './auto-pause-modal';

describe('AutoPauseModal', () => {
  it('renders when open is true', () => {
    render(
      <AutoPauseModal
        open={true}
        onOpenChange={vi.fn()}
        failureCount={8}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />
    );

    expect(screen.getByText('Validation Auto-Paused')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(
      <AutoPauseModal
        open={false}
        onOpenChange={vi.fn()}
        failureCount={8}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />
    );

    expect(screen.queryByText('Validation Auto-Paused')).not.toBeInTheDocument();
  });

  it('displays the failure count', () => {
    render(
      <AutoPauseModal
        open={true}
        onOpenChange={vi.fn()}
        failureCount={8}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />
    );

    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getAllByText(/consecutive failures detected/).length).toBeGreaterThan(0);
  });

  it('has Resume button that calls onResume', () => {
    const onResume = vi.fn();
    render(
      <AutoPauseModal
        open={true}
        onOpenChange={vi.fn()}
        failureCount={8}
        onResume={onResume}
        onStop={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Resume'));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('has Stop Validation button that calls onStop', () => {
    const onStop = vi.fn();
    render(
      <AutoPauseModal
        open={true}
        onOpenChange={vi.fn()}
        failureCount={8}
        onResume={vi.fn()}
        onStop={onStop}
      />
    );

    fireEvent.click(screen.getByText('Stop Validation'));
    expect(onStop).toHaveBeenCalledOnce();
  });
});
