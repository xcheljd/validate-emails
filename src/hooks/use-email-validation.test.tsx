import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEmailValidation } from './use-email-validation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock Tauri
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@/lib/notifications', () => ({
  notifyValidationComplete: vi.fn(),
  notifyError: vi.fn(),
}));

// Mock timers
vi.useFakeTimers();

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useEmailValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockReset();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should initialize with empty results', () => {
    const { result } = renderHook(() => useEmailValidation(), {
      wrapper: createWrapper(),
    });
    expect(result.current.results).toEqual([]);
    expect(result.current.isProcessing).toBe(false);
  });

  it('should set isProcessing to true when validation starts', async () => {
    // Use a pending promise so the mutation doesn't resolve immediately,
    // which would cause state updates outside act()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'validate_emails_bulk') {
        return new Promise(() => {}); // Never resolves
      }
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useEmailValidation(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.startValidation(['test@example.com']);
    });

    expect(result.current.isProcessing).toBe(true);
    expect(result.current.status).toBe('processing');
  });

  it('should transition to paused state when pause is called', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useEmailValidation(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.startValidation(['test@example.com']);
    });

    await act(async () => {
      await result.current.pauseValidation();
    });

    expect(result.current.status).toBe('paused');
    expect(result.current.isProcessing).toBe(false);
  });

  it('should transition to idle state when stop is called', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useEmailValidation(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.startValidation(['test@example.com']);
    });

    await act(async () => {
      await result.current.stopValidation();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.isProcessing).toBe(false);
  });

  describe('continue without proxy', () => {
    it('should set usingDirectConnection flag when continueWithoutProxy is called', async () => {
      // Create a promise we can control to delay the mutation resolution
      let resolveMutation: (value: unknown) => void;
      const mutationPromise = new Promise((resolve) => {
        resolveMutation = resolve;
      });

      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'validate_emails_bulk') {
          return mutationPromise;
        }
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useEmailValidation(), {
        wrapper: createWrapper(),
      });

      // Start validation
      await act(async () => {
        result.current.startValidation(['test@example.com'], 5, 'standard');
      });

      // Verify it's processing
      expect(result.current.status).toBe('processing');

      // Continue without proxy - this should set the direct connection flag
      await act(async () => {
        await result.current.continueWithoutProxy();
      });

      // Should show direct connection indicator
      expect(result.current.usingDirectConnection).toBe(true);

      // Resolve the mutation
      await act(async () => {
        resolveMutation!([]);
      });
    });

    it('should call set_proxy_bypass_for_session with bypass=true', async () => {
      mockInvoke.mockResolvedValueOnce([]); // validate_emails_bulk
      mockInvoke.mockResolvedValueOnce(undefined); // clear_proxy_bypass_for_session (from startValidation)
      mockInvoke.mockResolvedValueOnce(undefined); // set_proxy_bypass_for_session
      mockInvoke.mockResolvedValueOnce([]); // validate_emails_bulk on resume

      const { result } = renderHook(() => useEmailValidation(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.startValidation(['test@example.com'], 5, 'standard');
      });

      await act(async () => {
        result.current.setAllProxiesFailedStateForTest?.({
          failedProxies: [],
          proxyEnabled: true,
          totalProxies: 0,
          badCount: 0,
          cooldownCount: 0,
          nearestCooldownSecs: 0,
        });
      });

      await act(async () => {
        await result.current.continueWithoutProxy();
      });

      // Should have called set_proxy_bypass_for_session with bypass=true
      expect(mockInvoke).toHaveBeenCalledWith('set_proxy_bypass_for_session', {
        bypass: true,
      });
    });

    it('should preserve proxy settings for future sessions', async () => {
      mockInvoke.mockResolvedValueOnce([]); // validate_emails_bulk
      mockInvoke.mockResolvedValueOnce(undefined); // clear_proxy_bypass_for_session (from startValidation)
      mockInvoke.mockResolvedValueOnce(undefined); // set_proxy_bypass_for_session
      mockInvoke.mockResolvedValueOnce([]); // validate_emails_bulk on resume

      const { result } = renderHook(() => useEmailValidation(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.startValidation(['test@example.com'], 5, 'standard');
      });

      await act(async () => {
        result.current.setAllProxiesFailedStateForTest?.({
          failedProxies: [],
          proxyEnabled: true,
          totalProxies: 1,
          badCount: 0,
          cooldownCount: 0,
          nearestCooldownSecs: 0,
        });
      });

      await act(async () => {
        await result.current.continueWithoutProxy();
      });

      // Should NOT have called update_proxy_pool_config with enabled: false
      // (which would permanently disable proxy)
      const updateProxyCall = mockInvoke.mock.calls.find(
        (call) =>
          call[0] === 'update_proxy_pool_config' && call[1]?.enabled === false
      );
      expect(updateProxyCall).toBeUndefined();
    });
  });

  describe('retry with cooldown', () => {
    it('should show waiting state when retryWithCooldown is called', async () => {
      // Mock validation that takes a while
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'validate_emails_bulk') {
          return new Promise(() => {}); // Never resolves
        }
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useEmailValidation(), {
        wrapper: createWrapper(),
      });

      // Start validation
      await act(async () => {
        result.current.startValidation(['test@example.com'], 5, 'standard');
      });

      // Set all proxies failed state with cooldown
      await act(async () => {
        result.current.setAllProxiesFailedStateForTest?.({
          failedProxies: [
            {
              id: '192.168.1.1:8080',
              isBad: false,
              remainingCooldownSecs: 30,
              consecutiveFailures: 2,
              successRate: 50,
            },
          ],
          proxyEnabled: true,
          totalProxies: 1,
          badCount: 0,
          cooldownCount: 1,
          nearestCooldownSecs: 30,
        });
      });

      // Call retryWithCooldown - this should set waiting state
      act(() => {
        result.current.retryWithCooldown();
      });

      // Should be in waiting state (status should be 'waiting')
      expect(result.current.status).toBe('waiting');

      // Should show waiting message
      expect(result.current.waitingForProxy).toBe(true);
      expect(result.current.waitingCooldownSecs).toBe(30);
    });

    it('should show countdown timer during wait', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'validate_emails_bulk') {
          return new Promise(() => {}); // Never resolves
        }
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useEmailValidation(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.startValidation(['test@example.com'], 5, 'standard');
      });

      await act(async () => {
        result.current.setAllProxiesFailedStateForTest?.({
          failedProxies: [
            {
              id: '192.168.1.1:8080',
              isBad: false,
              remainingCooldownSecs: 30,
              consecutiveFailures: 2,
              successRate: 50,
            },
          ],
          proxyEnabled: true,
          totalProxies: 1,
          badCount: 0,
          cooldownCount: 1,
          nearestCooldownSecs: 30,
        });
      });

      act(() => {
        result.current.retryWithCooldown();
      });

      // Initial countdown should be 30
      expect(result.current.waitingCooldownSecs).toBe(30);

      // Advance time by 10 seconds
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      // Countdown should be 20
      expect(result.current.waitingCooldownSecs).toBe(20);

      // Advance time by another 10 seconds
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      // Countdown should be 10
      expect(result.current.waitingCooldownSecs).toBe(10);
    });

    it('should automatically resume validation when cooldown expires', async () => {
      // Mock validation that stays pending so we can check the status
      let resolveMutation: (value: unknown) => void;
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'validate_emails_bulk') {
          return new Promise((resolve) => {
            resolveMutation = resolve;
          });
        }
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useEmailValidation(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.startValidation(['test@example.com'], 5, 'standard');
      });

      await act(async () => {
        result.current.setAllProxiesFailedStateForTest?.({
          failedProxies: [
            {
              id: '192.168.1.1:8080',
              isBad: false,
              remainingCooldownSecs: 5,
              consecutiveFailures: 2,
              successRate: 50,
            },
          ],
          proxyEnabled: true,
          totalProxies: 1,
          badCount: 0,
          cooldownCount: 1,
          nearestCooldownSecs: 5,
        });
      });

      act(() => {
        result.current.retryWithCooldown();
      });

      // Should be in waiting state
      expect(result.current.status).toBe('waiting');
      expect(result.current.waitingForProxy).toBe(true);

      // Advance time by 5 seconds (cooldown expires)
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // Should have resumed processing (mutation called again)
      expect(result.current.waitingForProxy).toBe(false);
      // Status should be 'processing' since mutation is still pending
      expect(result.current.status).toBe('processing');

      // Resolve the mutation to complete
      await act(async () => {
        resolveMutation!([]);
      });
    });

    it('should not retry if no proxies are in cooldown', async () => {
      // Mock validation that stays pending
      let resolveMutation: (value: unknown) => void;
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'validate_emails_bulk') {
          return new Promise((resolve) => {
            resolveMutation = resolve;
          });
        }
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useEmailValidation(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.startValidation(['test@example.com'], 5, 'standard');
      });

      // Verify it's processing
      expect(result.current.status).toBe('processing');

      await act(async () => {
        result.current.setAllProxiesFailedStateForTest?.({
          failedProxies: [
            {
              id: '192.168.1.1:8080',
              isBad: true, // Bad, not in cooldown
              remainingCooldownSecs: 0,
              consecutiveFailures: 3,
              successRate: 0,
            },
          ],
          proxyEnabled: true,
          totalProxies: 1,
          badCount: 1,
          cooldownCount: 0,
          nearestCooldownSecs: 0,
        });
      });

      // Call retryWithCooldown - should do nothing since no proxies in cooldown
      act(() => {
        result.current.retryWithCooldown();
      });

      // Should NOT be in waiting state (remains false, never set to true)
      expect(result.current.waitingForProxy).toBe(false);
      // Status should still be processing since retryWithCooldown didn't change it
      expect(result.current.status).toBe('processing');

      // Cleanup
      await act(async () => {
        resolveMutation!([]);
      });
    });

    it('should clear all proxies failed state when resuming', async () => {
      // Mock validation that stays pending
      let resolveMutation: (value: unknown) => void;
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'validate_emails_bulk') {
          return new Promise((resolve) => {
            resolveMutation = resolve;
          });
        }
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useEmailValidation(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.startValidation(['test@example.com'], 5, 'standard');
      });

      await act(async () => {
        result.current.setAllProxiesFailedStateForTest?.({
          failedProxies: [
            {
              id: '192.168.1.1:8080',
              isBad: false,
              remainingCooldownSecs: 2,
              consecutiveFailures: 2,
              successRate: 50,
            },
          ],
          proxyEnabled: true,
          totalProxies: 1,
          badCount: 0,
          cooldownCount: 1,
          nearestCooldownSecs: 2,
        });
      });

      expect(result.current.allProxiesFailedState).not.toBeNull();

      act(() => {
        result.current.retryWithCooldown();
      });

      // Advance past cooldown
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      // Should have cleared the failed state
      expect(result.current.allProxiesFailedState).toBeNull();

      // Resolve mutation to clean up
      await act(async () => {
        resolveMutation!([]);
      });
    });
  });

  describe('stop validation from failure modal', () => {
    it('should clear allProxiesFailedState when stopValidation is called', async () => {
      mockInvoke.mockResolvedValueOnce([]); // validate_emails_bulk
      mockInvoke.mockResolvedValueOnce(undefined); // clear_proxy_bypass_for_session
      mockInvoke.mockResolvedValueOnce(undefined); // stop_validation

      const { result } = renderHook(() => useEmailValidation(), {
        wrapper: createWrapper(),
      });

      // Start validation
      await act(async () => {
        result.current.startValidation(['test@example.com'], 5, 'standard');
      });

      // Simulate all proxies failed (modal would appear)
      await act(async () => {
        result.current.setAllProxiesFailedStateForTest?.({
          failedProxies: [
            {
              id: '192.168.1.1:8080',
              isBad: true,
              remainingCooldownSecs: 0,
              consecutiveFailures: 3,
              successRate: 0,
            },
          ],
          proxyEnabled: true,
          totalProxies: 1,
          badCount: 1,
          cooldownCount: 0,
          nearestCooldownSecs: 0,
        });
      });

      // Verify modal state is set
      expect(result.current.allProxiesFailedState).not.toBeNull();

      // Stop validation (as if user clicked "Stop Validation" in modal)
      await act(async () => {
        await result.current.stopValidation();
      });

      // Modal state should be cleared (modal closes)
      expect(result.current.allProxiesFailedState).toBeNull();
      // Status should be idle (user sees results view)
      expect(result.current.status).toBe('idle');
    });

    it('should preserve partial results when stopValidation is called from failure modal', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'validate_emails_bulk') {
          return new Promise(() => {}); // Never resolves - simulates in-progress
        }
        if (cmd === 'stop_validation') return Promise.resolve(undefined);
        if (cmd === 'clear_proxy_bypass_for_session')
          return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useEmailValidation(), {
        wrapper: createWrapper(),
      });

      // Start validation
      await act(async () => {
        result.current.startValidation(
          ['test@example.com', 'test2@example.com'],
          5,
          'standard'
        );
      });

      // Manually add some partial results (simulating validation-progress events)
      const partialResult = {
        email: 'test@example.com',
        result: 'Safe' as const,
        reason: 'Deliverable',
        logs: [],
        domain: 'example.com',
        validationDuration: 100,
        mxRecordCount: 1,
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
        timestamp: new Date().toISOString(),
        validationMode: 'standard' as const,
        riskScore: 0,
      };

      await act(async () => {
        result.current.setResults([partialResult]);
      });

      // Simulate all proxies failed
      await act(async () => {
        result.current.setAllProxiesFailedStateForTest?.({
          failedProxies: [
            {
              id: '192.168.1.1:8080',
              isBad: true,
              remainingCooldownSecs: 0,
              consecutiveFailures: 3,
              successRate: 0,
            },
          ],
          proxyEnabled: true,
          totalProxies: 1,
          badCount: 1,
          cooldownCount: 0,
          nearestCooldownSecs: 0,
        });
      });

      // Stop validation
      await act(async () => {
        await result.current.stopValidation();
      });

      // Results should be preserved
      expect(result.current.results).toHaveLength(1);
      expect(result.current.results[0].email).toBe('test@example.com');
      expect(result.current.results[0].result).toBe('Safe');
      // Modal should be closed
      expect(result.current.allProxiesFailedState).toBeNull();
    });

    it('should clear waiting state when stopValidation is called during retry wait', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'validate_emails_bulk') {
          return new Promise(() => {}); // Never resolves
        }
        if (cmd === 'stop_validation') return Promise.resolve(undefined);
        if (cmd === 'clear_proxy_bypass_for_session')
          return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useEmailValidation(), {
        wrapper: createWrapper(),
      });

      // Start validation
      await act(async () => {
        result.current.startValidation(['test@example.com'], 5, 'standard');
      });

      // Simulate all proxies failed with cooldown
      await act(async () => {
        result.current.setAllProxiesFailedStateForTest?.({
          failedProxies: [
            {
              id: '192.168.1.1:8080',
              isBad: false,
              remainingCooldownSecs: 60,
              consecutiveFailures: 2,
              successRate: 50,
            },
          ],
          proxyEnabled: true,
          totalProxies: 1,
          badCount: 0,
          cooldownCount: 1,
          nearestCooldownSecs: 60,
        });
      });

      // Start retry-with-cooldown wait
      act(() => {
        result.current.retryWithCooldown();
      });

      // Should be in waiting state
      expect(result.current.status).toBe('waiting');
      expect(result.current.waitingForProxy).toBe(true);
      expect(result.current.waitingCooldownSecs).toBe(60);

      // Now stop validation while waiting
      await act(async () => {
        await result.current.stopValidation();
      });

      // Waiting state should be cleared
      expect(result.current.waitingForProxy).toBe(false);
      expect(result.current.waitingCooldownSecs).toBe(0);
      expect(result.current.allProxiesFailedState).toBeNull();
      expect(result.current.status).toBe('idle');
    });

    it('should stop the cooldown timer when stopValidation is called', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'validate_emails_bulk') {
          return new Promise(() => {}); // Never resolves
        }
        if (cmd === 'stop_validation') return Promise.resolve(undefined);
        if (cmd === 'clear_proxy_bypass_for_session')
          return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useEmailValidation(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.startValidation(['test@example.com'], 5, 'standard');
      });

      await act(async () => {
        result.current.setAllProxiesFailedStateForTest?.({
          failedProxies: [
            {
              id: '192.168.1.1:8080',
              isBad: false,
              remainingCooldownSecs: 30,
              consecutiveFailures: 2,
              successRate: 50,
            },
          ],
          proxyEnabled: true,
          totalProxies: 1,
          badCount: 0,
          cooldownCount: 1,
          nearestCooldownSecs: 30,
        });
      });

      // Start retry with cooldown
      act(() => {
        result.current.retryWithCooldown();
      });

      expect(result.current.waitingForProxy).toBe(true);

      // Stop validation
      await act(async () => {
        await result.current.stopValidation();
      });

      // Advance time significantly - timer should have been cleared so no state changes
      await act(async () => {
        vi.advanceTimersByTime(60000);
      });

      // Status should remain idle (timer didn't fire to change it back to processing)
      expect(result.current.status).toBe('idle');
      expect(result.current.waitingForProxy).toBe(false);
    });
  });
});
