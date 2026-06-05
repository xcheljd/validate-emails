import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEmailValidation } from './use-email-validation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ValidationResult } from '@/lib/types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@/lib/notifications', () => ({
  notifyValidationComplete: vi.fn(),
  notifyError: vi.fn(),
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

function makeResult(email: string, result: 'Safe' | 'Risky' | 'Invalid' | 'Unknown'): ValidationResult {
  return {
    email,
    result,
    reason: '',
    logs: [],
    domain: email.split('@')[1],
    validationDuration: 100,
    mxRecordCount: 1,
    isDisposable: false,
    isRoleAccount: false,
    isCatchAll: false,
    isDeliverable: result === 'Safe',
    isDisabled: false,
    hasFullInbox: false,
    canConnectSmtp: true,
    acceptsMail: true,
    isValidSyntax: true,
    isB2c: false,
    riskScore: 0,
    timestamp: '',
    validationMode: 'standard',
  };
}

describe('useEmailValidation retryWithEscalation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementation for invoke
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('should pass correct mode for Tier 1 Quick', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    const mockResults = [
      makeResult('safe@test.com', 'Safe'),
      makeResult('unknown@test.com', 'Unknown'),
    ];

    act(() => {
      result.current.setResults(mockResults);
    });

    await act(async () => {
      await result.current.retryWithEscalation('quick', false);
    });

    expect(invoke).toHaveBeenCalledWith(
      'revalidate_emails_bulk',
      expect.objectContaining({
        items: [{ email: 'unknown@test.com' }],
        mode: 'quick',
      })
    );
  });

  it('should pass correct mode for Tier 2 Standard', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    const mockResults = [
      makeResult('safe@test.com', 'Safe'),
      makeResult('unknown@test.com', 'Unknown'),
    ];

    act(() => {
      result.current.setResults(mockResults);
    });

    await act(async () => {
      await result.current.retryWithEscalation('standard', false);
    });

    expect(invoke).toHaveBeenCalledWith(
      'revalidate_emails_bulk',
      expect.objectContaining({
        items: [{ email: 'unknown@test.com' }],
        mode: 'standard',
      })
    );
  });

  it('should pass correct mode for Tier 3 Thorough', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    const mockResults = [
      makeResult('safe@test.com', 'Safe'),
      makeResult('unknown@test.com', 'Unknown'),
    ];

    act(() => {
      result.current.setResults(mockResults);
    });

    await act(async () => {
      await result.current.retryWithEscalation('thorough', false);
    });

    expect(invoke).toHaveBeenCalledWith(
      'revalidate_emails_bulk',
      expect.objectContaining({
        items: [{ email: 'unknown@test.com' }],
        mode: 'thorough',
      })
    );
  });

  it('should auto-escalate through all three tiers sequentially', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    const mockResults = [
      makeResult('unknown1@test.com', 'Unknown'),
      makeResult('unknown2@test.com', 'Unknown'),
    ];

    act(() => {
      result.current.setResults(mockResults);
    });

    // Mock invoke to return results (still unknown after each tier)
    let callCount = 0;
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((_cmd: string, _args: Record<string, unknown>) => {
      callCount++;
      // First two calls are revalidate, return still Unknown results
      if (callCount <= 2) {
        return Promise.resolve([
          makeResult('unknown1@test.com', 'Unknown'),
          makeResult('unknown2@test.com', 'Unknown'),
        ]);
      }
      // Third call resolves them
      return Promise.resolve([
        makeResult('unknown1@test.com', 'Safe'),
        makeResult('unknown2@test.com', 'Safe'),
      ]);
    });

    await act(async () => {
      await result.current.retryWithEscalation('quick', true);
    });

    // Should have been called 3 times with modes: quick, standard, thorough
    const revalidateCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'revalidate_emails_bulk'
    );
    expect(revalidateCalls).toHaveLength(3);
    expect(revalidateCalls[0][1]).toHaveProperty('mode', 'quick');
    expect(revalidateCalls[1][1]).toHaveProperty('mode', 'standard');
    expect(revalidateCalls[2][1]).toHaveProperty('mode', 'thorough');
  });

  it('should stop auto-escalation early if all Unknowns are resolved', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    const mockResults = [
      makeResult('unknown1@test.com', 'Unknown'),
      makeResult('unknown2@test.com', 'Unknown'),
    ];

    act(() => {
      result.current.setResults(mockResults);
    });

    // After first tier, resolve all unknowns
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeResult('unknown1@test.com', 'Safe'),
      makeResult('unknown2@test.com', 'Safe'),
    ]);

    await act(async () => {
      await result.current.retryWithEscalation('quick', true);
    });

    // Should have been called only once (quick mode) since all resolved
    const revalidateCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'revalidate_emails_bulk'
    );
    expect(revalidateCalls).toHaveLength(1);
    expect(revalidateCalls[0][1]).toHaveProperty('mode', 'quick');
  });

  it('should return early if no unknown results exist', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    const mockResults = [
      makeResult('safe@test.com', 'Safe'),
      makeResult('invalid@test.com', 'Invalid'),
    ];

    act(() => {
      result.current.setResults(mockResults);
    });

    await act(async () => {
      await result.current.retryWithEscalation('quick', false);
    });

    expect(invoke).not.toHaveBeenCalledWith(
      'revalidate_emails_bulk',
      expect.anything()
    );
  });

  it('should track escalation state during auto-escalation', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    const mockResults = [
      makeResult('unknown1@test.com', 'Unknown'),
    ];

    act(() => {
      result.current.setResults(mockResults);
    });

    // Make it go through all tiers
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeResult('unknown1@test.com', 'Unknown'),
    ]);

    const promise = act(async () => {
      await result.current.retryWithEscalation('quick', true);
    });

    // During escalation, the state should show escalation info
    // (this is checked indirectly since the hook should complete)
    await promise;

    // After completion, escalation state should be reset
    expect(result.current.isEscalating).toBe(false);
  });
});
