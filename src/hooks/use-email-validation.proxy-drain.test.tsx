import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useEmailValidation } from './use-email-validation';
import type { AllProxiesFailedPayload } from './validation-types';
import type { ValidationResult } from '@/lib/types';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Capture event handlers so tests can emit backend events.
const handlers = new Map<string, (event: { payload: unknown }) => void>();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler);
    return Promise.resolve(() => handlers.delete(name));
  }),
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

function emit(name: string, payload: unknown) {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`no listener for ${name}`);
  handler({ payload });
}

function makeResult(email: string): ValidationResult {
  return {
    email,
    result: 'Safe',
    reason: '',
    logs: [],
    domain: email.split('@')[1],
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
    riskScore: 0,
    timestamp: '',
    validationMode: 'standard',
  };
}

const drainedPayload: AllProxiesFailedPayload = {
  failedProxies: [
    { id: '10.0.0.1:1080', isBad: true, remainingCooldownSecs: 0, consecutiveFailures: 9, successRate: 10, autoDisabled: true },
    { id: '10.0.0.2:1080', isBad: true, remainingCooldownSecs: 0, consecutiveFailures: 9, successRate: 10, autoDisabled: true },
    { id: '10.0.0.3:1080', isBad: true, remainingCooldownSecs: 40, consecutiveFailures: 3, successRate: 70, autoDisabled: false },
  ],
  proxyEnabled: true,
  totalProxies: 3,
  badCount: 3,
  cooldownCount: 1,
  nearestCooldownSecs: 40,
  runId: 1,
};

async function renderWithListeners() {
  const rendered = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });
  // Let the async listener setup finish.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return rendered;
}

describe('useEmailValidation proxy drain handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'validate_emails_bulk') return new Promise(() => {});
      return Promise.resolve(undefined);
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('shows waiting-for-proxy as a non-blocking banner, not the failure modal', async () => {
    const { result } = await renderWithListeners();

    await act(async () => {
      result.current.startValidation(['a@test.com', 'b@test.com']);
    });
    act(() => {
      emit('validation-run-started', { runId: 1 });
      emit('waiting-for-proxy', { runId: 1, proxyIds: ['10.0.0.1:1080'], nearestCooldownSecs: 30 });
    });

    expect(result.current.waitingForProxy).toBe(true);
    expect(result.current.waitingCooldownSecs).toBe(30);
    expect(result.current.status).toBe('processing');
    expect(result.current.allProxiesFailedState).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(result.current.waitingCooldownSecs).toBe(20);
    // The UI does not re-dispatch anything itself; the backend resumes.
    expect(
      mockInvoke.mock.calls.filter((c: unknown[]) => c[0] === 'validate_emails_bulk')
    ).toHaveLength(1);

    // The next result means the run has a proxy again.
    act(() => {
      emit('validation-progress', { ...makeResult('a@test.com'), runId: 1 });
    });
    expect(result.current.waitingForProxy).toBe(false);
    expect(result.current.results[0]).not.toHaveProperty('runId');
  });

  it('ignores events from a superseded run', async () => {
    const { result } = await renderWithListeners();

    await act(async () => {
      result.current.startValidation(['a@test.com']);
    });
    act(() => {
      emit('validation-run-started', { runId: 2 });
      emit('all-proxies-failed', { ...drainedPayload, runId: 1 });
      emit('waiting-for-proxy', { runId: 1, proxyIds: [], nearestCooldownSecs: 30 });
      emit('validation-progress', { ...makeResult('a@test.com'), runId: 1 });
    });

    expect(result.current.allProxiesFailedState).toBeNull();
    expect(result.current.waitingForProxy).toBe(false);
    expect(result.current.results).toHaveLength(0);
    expect(result.current.status).toBe('processing');
  });

  it('re-enable & resume re-enables each auto-disabled proxy, then resumes pending emails', async () => {
    const { result } = await renderWithListeners();

    await act(async () => {
      result.current.startValidation(['a@test.com', 'b@test.com', 'c@test.com']);
    });
    act(() => {
      emit('validation-run-started', { runId: 1 });
      emit('validation-progress', { ...makeResult('a@test.com'), runId: 1 });
      emit('all-proxies-failed', drainedPayload);
    });
    expect(result.current.status).toBe('paused');
    expect(result.current.allProxiesFailedState).not.toBeNull();

    mockInvoke.mockClear();
    await act(async () => {
      await result.current.reEnableAndResume();
    });

    const commands = mockInvoke.mock.calls.map((c: unknown[]) => c[0]);
    expect(commands).toEqual(['re_enable_proxy', 're_enable_proxy', 'validate_emails_bulk']);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 're_enable_proxy', { proxyId: '10.0.0.1:1080' });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 're_enable_proxy', { proxyId: '10.0.0.2:1080' });
    expect(mockInvoke).toHaveBeenNthCalledWith(
      3,
      'validate_emails_bulk',
      expect.objectContaining({ emails: ['b@test.com', 'c@test.com'] })
    );
    expect(result.current.allProxiesFailedState).toBeNull();
    expect(result.current.status).toBe('processing');
  });

  it('re-enable & resume uses a caller-supplied re-enable function', async () => {
    const { result } = await renderWithListeners();
    await act(async () => {
      result.current.startValidation(['a@test.com']);
    });
    act(() => {
      emit('all-proxies-failed', drainedPayload);
    });

    const reEnable = vi.fn(() => Promise.resolve());
    await act(async () => {
      await result.current.reEnableAndResume(reEnable);
    });
    expect(reEnable.mock.calls).toEqual([['10.0.0.1:1080'], ['10.0.0.2:1080']]);
  });

  it('re-enable & resume does not resume if a re-enable fails', async () => {
    const { result } = await renderWithListeners();
    await act(async () => {
      result.current.startValidation(['a@test.com']);
    });
    act(() => {
      emit('all-proxies-failed', drainedPayload);
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 're_enable_proxy' ? Promise.reject(new Error('boom')) : Promise.resolve(undefined)
    );
    await act(async () => {
      await result.current.reEnableAndResume();
    });
    expect(
      mockInvoke.mock.calls.filter((c: unknown[]) => c[0] === 'validate_emails_bulk')
    ).toHaveLength(0);
    expect(result.current.status).toBe('paused');
    expect(result.current.allProxiesFailedState).not.toBeNull();
  });

  it('a run that paused itself stays paused even if its event was missed', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'validate_emails_bulk') {
        return Promise.resolve({ results: [], stopReason: 'paused_no_proxy' });
      }
      return Promise.resolve(undefined);
    });
    const { result } = await renderWithListeners();

    await act(async () => {
      result.current.startValidation(['a@test.com']);
    });

    expect(result.current.status).toBe('paused');
  });
});
