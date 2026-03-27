import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
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
  });

  it('should initialize with empty results', () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });
    expect(result.current.results).toEqual([]);
    expect(result.current.isProcessing).toBe(false);
  });

  it('should set isProcessing to true when validation starts', () => {
    mockInvoke.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });

    act(() => {
      result.current.startValidation(['test@example.com']);
    });

    expect(result.current.isProcessing).toBe(true);
    expect(result.current.status).toBe('processing');
  });

  it('should transition to paused state when pause is called', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });

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
    const { result } = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });

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

      const { result } = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });

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

      const { result } = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });

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
      expect(mockInvoke).toHaveBeenCalledWith('set_proxy_bypass_for_session', { bypass: true });
    });

    it('should preserve proxy settings for future sessions', async () => {
      mockInvoke.mockResolvedValueOnce([]); // validate_emails_bulk
      mockInvoke.mockResolvedValueOnce(undefined); // clear_proxy_bypass_for_session (from startValidation)
      mockInvoke.mockResolvedValueOnce(undefined); // set_proxy_bypass_for_session
      mockInvoke.mockResolvedValueOnce([]); // validate_emails_bulk on resume

      const { result } = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });

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
        (call) => call[0] === 'update_proxy_pool_config' && call[1]?.enabled === false
      );
      expect(updateProxyCall).toBeUndefined();
    });
  });
});
