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

  it('should auto-escalate through standard → thorough sequentially (quick excluded)', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    const mockResults = [
      makeResult('unknown1@test.com', 'Unknown'),
      makeResult('unknown2@test.com', 'Unknown'),
    ];

    act(() => {
      result.current.setResults(mockResults);
    });

    // Mock invoke to return results (still unknown after the first tier)
    let callCount = 0;
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((_cmd: string, _args: Record<string, unknown>) => {
      callCount++;
      // First tier (standard) returns still Unknown
      if (callCount <= 1) {
        return Promise.resolve([
          makeResult('unknown1@test.com', 'Unknown'),
          makeResult('unknown2@test.com', 'Unknown'),
        ]);
      }
      // Second tier (thorough) resolves them
      return Promise.resolve([
        makeResult('unknown1@test.com', 'Safe'),
        makeResult('unknown2@test.com', 'Safe'),
      ]);
    });

    await act(async () => {
      await result.current.retryWithEscalation('standard', true);
    });

    // quick is not an auto-escalation tier (it can never resolve an Unknown)
    const revalidateCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'revalidate_emails_bulk'
    );
    expect(revalidateCalls).toHaveLength(2);
    expect(revalidateCalls[0][1]).toHaveProperty('mode', 'standard');
    expect(revalidateCalls[1][1]).toHaveProperty('mode', 'thorough');
  });

  it('should not advance tiers when a tier pauses for lack of a proxy', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    act(() => {
      result.current.setResults([
        makeResult('unknown1@test.com', 'Unknown'),
        makeResult('unknown2@test.com', 'Unknown'),
      ]);
    });

    // The standard tier pauses itself after finishing one email; the other
    // one is still Unknown only because it was never dispatched.
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'revalidate_emails_bulk') {
        return Promise.resolve({
          results: [makeResult('unknown1@test.com', 'Unknown')],
          stopReason: 'paused_no_proxy',
        });
      }
      return Promise.resolve(undefined);
    });

    await act(async () => {
      await result.current.retryWithEscalation('standard', true);
    });

    const revalidateCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'revalidate_emails_bulk'
    );
    expect(revalidateCalls).toHaveLength(1);
    expect(revalidateCalls[0][1]).toHaveProperty('mode', 'standard');
    expect(result.current.status).toBe('paused');
    expect(result.current.isEscalating).toBe(false);
  });

  it('should not advance tiers when a tier is cancelled', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    act(() => {
      result.current.setResults([makeResult('unknown1@test.com', 'Unknown')]);
    });

    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [],
      stopReason: 'cancelled',
    });

    await act(async () => {
      await result.current.retryWithEscalation('standard', true);
    });

    const revalidateCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'revalidate_emails_bulk'
    );
    expect(revalidateCalls).toHaveLength(1);
  });

  it('should escalate through tiers when each tier completes (RunOutcome shape)', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    act(() => {
      result.current.setResults([makeResult('unknown1@test.com', 'Unknown')]);
    });

    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [makeResult('unknown1@test.com', 'Unknown')],
      stopReason: null,
    });

    await act(async () => {
      await result.current.retryWithEscalation('standard', true);
    });

    const revalidateCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'revalidate_emails_bulk'
    );
    expect(revalidateCalls).toHaveLength(2);
    expect(revalidateCalls[1][1]).toHaveProperty('mode', 'thorough');
    expect(result.current.status).toBe('idle');
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
      await result.current.retryWithEscalation('standard', true);
    });

    // Should have been called only once (standard mode) since all resolved
    const revalidateCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'revalidate_emails_bulk'
    );
    expect(revalidateCalls).toHaveLength(1);
    expect(revalidateCalls[0][1]).toHaveProperty('mode', 'standard');
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

  it('should catch invoke errors during auto-escalation and not throw unhandled rejection', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    const mockResults = [
      makeResult('unknown1@test.com', 'Unknown'),
      makeResult('unknown2@test.com', 'Unknown'),
    ];

    act(() => {
      result.current.setResults(mockResults);
    });

    // Mock invoke to reject on first call
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    // Should not throw - error should be caught internally
    await act(async () => {
      await expect(result.current.retryWithEscalation('quick', true)).resolves.not.toThrow();
    });
  });

  it('should reset escalation state on invoke error during auto-escalation', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    const mockResults = [
      makeResult('unknown1@test.com', 'Unknown'),
      makeResult('unknown2@test.com', 'Unknown'),
    ];

    act(() => {
      result.current.setResults(mockResults);
    });

    // Mock invoke to reject on first call
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    await act(async () => {
      await result.current.retryWithEscalation('quick', true);
    });

    // After error, escalation state should be reset
    expect(result.current.isEscalating).toBe(false);
    expect(result.current.escalationTier).toBe(1); // Reset to initial value
    expect(result.current.escalationEmailCount).toBe(0);
  });

  it('should reset escalation state on invoke error during manual retry (autoEscalate=false)', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    const mockResults = [
      makeResult('unknown1@test.com', 'Unknown'),
    ];

    act(() => {
      result.current.setResults(mockResults);
    });

    // Mock invoke to reject
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    await act(async () => {
      await result.current.retryWithEscalation('quick', false);
    });

    // After error, escalation state should be reset (should already be false for manual)
    expect(result.current.isEscalating).toBe(false);
    expect(result.current.escalationTier).toBe(1);
    expect(result.current.escalationEmailCount).toBe(0);
  });

  it('should allow manual retry after auto-escalation fails', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    const mockResults = [
      makeResult('unknown1@test.com', 'Unknown'),
      makeResult('unknown2@test.com', 'Unknown'),
    ];

    act(() => {
      result.current.setResults(mockResults);
    });

    // First auto-escalation fails
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    await act(async () => {
      await result.current.retryWithEscalation('quick', true);
    });

    // Escalation state should be reset
    expect(result.current.isEscalating).toBe(false);
    expect(result.current.escalationTier).toBe(1);
    expect(result.current.escalationEmailCount).toBe(0);

    // Now try manual retry - should not throw and should not leave UI in broken state
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeResult('unknown1@test.com', 'Safe'),
      makeResult('unknown2@test.com', 'Safe'),
    ]);

    await act(async () => {
      await result.current.retryWithEscalation('standard', false);
    });

    // Manual retry should not throw and escalation state should remain reset
    expect(result.current.isEscalating).toBe(false);
    expect(result.current.escalationTier).toBe(1);
    expect(result.current.escalationEmailCount).toBe(0);
  });
});
