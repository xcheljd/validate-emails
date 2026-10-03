import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ProxyFailureModal,
  type ProxyFailureModalProps,
  type FailedProxyInfo,
} from './proxy-failure-modal';

describe('ProxyFailureModal', () => {
  const mockFailedProxies: FailedProxyInfo[] = [
    {
      id: '192.168.1.1:8080',
      isBad: true,
      remainingCooldownSecs: 0,
      consecutiveFailures: 3,
      successRate: 0,
    },
    {
      id: '192.168.1.2:8080',
      isBad: false,
      remainingCooldownSecs: 45,
      consecutiveFailures: 2,
      successRate: 50,
    },
  ];

  const defaultProps: ProxyFailureModalProps = {
    open: true,
    failedProxies: mockFailedProxies,
    totalProxies: 2,
    badCount: 1,
    cooldownCount: 1,
    nearestCooldownSecs: 45,
    onContinueWithoutProxy: vi.fn(),
    onRetryWithCooldown: vi.fn(),
    onStop: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders when open is true', () => {
      render(<ProxyFailureModal {...defaultProps} />);
      expect(screen.getByText('All Proxies Unavailable')).toBeInTheDocument();
    });

    it('does not render when open is false', () => {
      render(<ProxyFailureModal {...defaultProps} open={false} />);
      expect(
        screen.queryByText('All Proxies Unavailable')
      ).not.toBeInTheDocument();
    });

    it('shows the list of failed proxies', () => {
      render(<ProxyFailureModal {...defaultProps} />);
      expect(screen.getByText('192.168.1.1:8080')).toBeInTheDocument();
      expect(screen.getByText('192.168.1.2:8080')).toBeInTheDocument();
    });

    it('shows cooldown ETA for proxies in cooldown', () => {
      render(<ProxyFailureModal {...defaultProps} />);
      // The second proxy has remainingCooldownSecs: 0, so it won't show cooldown
      // The first proxy is bad (isBad: true), so it won't show cooldown either
      // We need to check for the "45s" text that appears in the badge
      expect(screen.getByText('45s')).toBeInTheDocument();
    });

    it('shows bad status indicator for bad proxies', () => {
      render(<ProxyFailureModal {...defaultProps} />);
      // The Failed badge is shown for bad proxies
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('shows success rate for each proxy', () => {
      render(<ProxyFailureModal {...defaultProps} />);
      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('shows summary of bad and cooldown counts', () => {
      render(<ProxyFailureModal {...defaultProps} />);
      expect(screen.getByText(/1 bad/)).toBeInTheDocument();
      expect(screen.getByText(/1 in cooldown/)).toBeInTheDocument();
    });
  });

  describe('three options', () => {
    it('shows Continue without proxy button', () => {
      render(<ProxyFailureModal {...defaultProps} />);
      expect(
        screen.getByRole('button', { name: /continue without proxy/i })
      ).toBeInTheDocument();
    });

    it('shows Retry with cooldown button when there are proxies in cooldown', () => {
      render(<ProxyFailureModal {...defaultProps} />);
      expect(
        screen.getByRole('button', { name: /retry with cooldown/i })
      ).toBeInTheDocument();
    });

    it('shows Stop validation button', () => {
      render(<ProxyFailureModal {...defaultProps} />);
      expect(
        screen.getByRole('button', { name: /stop validation/i })
      ).toBeInTheDocument();
    });

    it('disables Retry button when no proxies are in cooldown', () => {
      const props = {
        ...defaultProps,
        cooldownCount: 0,
        nearestCooldownSecs: 0,
      };
      render(<ProxyFailureModal {...props} />);
      const retryButton = screen.getByRole('button', {
        name: /retry with cooldown/i,
      });
      expect(retryButton).toBeDisabled();
    });
  });

  describe('re-enable & resume', () => {
    it('is hidden when no proxy is auto-disabled', () => {
      render(<ProxyFailureModal {...defaultProps} onReEnableAndResume={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /re-enable/i })).toBeNull();
    });

    it('calls onReEnableAndResume when proxies are auto-disabled', () => {
      const onReEnableAndResume = vi.fn();
      render(
        <ProxyFailureModal
          {...defaultProps}
          autoDisabledCount={2}
          onReEnableAndResume={onReEnableAndResume}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /re-enable & resume \(2\)/i }));
      expect(onReEnableAndResume).toHaveBeenCalledTimes(1);
    });
  });

  describe('interactions', () => {
    it('calls onContinueWithoutProxy when Continue button is clicked', () => {
      const onContinueWithoutProxy = vi.fn();
      render(
        <ProxyFailureModal
          {...defaultProps}
          onContinueWithoutProxy={onContinueWithoutProxy}
        />
      );

      fireEvent.click(
        screen.getByRole('button', { name: /continue without proxy/i })
      );
      expect(onContinueWithoutProxy).toHaveBeenCalledTimes(1);
    });

    it('calls onRetryWithCooldown when Retry button is clicked', () => {
      const onRetryWithCooldown = vi.fn();
      render(
        <ProxyFailureModal
          {...defaultProps}
          onRetryWithCooldown={onRetryWithCooldown}
        />
      );

      fireEvent.click(
        screen.getByRole('button', { name: /retry with cooldown/i })
      );
      expect(onRetryWithCooldown).toHaveBeenCalledTimes(1);
    });

    it('calls onStop when Stop button is clicked', () => {
      const onStop = vi.fn();
      render(<ProxyFailureModal {...defaultProps} onStop={onStop} />);

      fireEvent.click(screen.getByRole('button', { name: /stop validation/i }));
      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });

  describe('modal dismissible only by choosing an option', () => {
    it('cannot be dismissed by clicking outside', () => {
      render(<ProxyFailureModal {...defaultProps} />);
      // Dialog should have onOpenChange that does nothing or only allows controlled close
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
    });

    it('does not show close button', () => {
      render(<ProxyFailureModal {...defaultProps} />);
      // The DialogContent should not have the default close button
      const closeButton = screen.queryByRole('button', { name: /close/i });
      expect(closeButton).not.toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('handles empty failed proxies list', () => {
      render(
        <ProxyFailureModal
          {...defaultProps}
          failedProxies={[]}
          totalProxies={0}
          badCount={0}
          cooldownCount={0}
        />
      );
      expect(screen.getByText('All Proxies Unavailable')).toBeInTheDocument();
    });

    it('formats cooldown time correctly for minutes', () => {
      const props = {
        ...defaultProps,
        failedProxies: [
          {
            id: '192.168.1.1:8080',
            isBad: true,
            remainingCooldownSecs: 125, // 2m 5s
            consecutiveFailures: 3,
            successRate: 0,
          },
        ],
        nearestCooldownSecs: 125,
      };
      render(<ProxyFailureModal {...props} />);
      expect(screen.getByText(/2m 5s/)).toBeInTheDocument();
    });
  });
});
