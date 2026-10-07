import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useEmailValidation } from './use-email-validation';
import type { ValidationResult } from '@/lib/types';

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

function makeResult(email: string, result: ValidationResult['result']): ValidationResult {
  return {
    email,
    result,
    reason: '',
    logs: [],
    domain: 'test.com',
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

describe('useEmailValidation session resume', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('resumes the emails without results, not an index slice', async () => {
    // Concurrent runs finish out of order: a, c and e are done, b and d are
    // not, even though the saved count is 3.
    const session = {
      id: 's1',
      name: 'session',
      emails: ['a@test.com', 'b@test.com', 'c@test.com', 'd@test.com', 'e@test.com'],
      results: [
        makeResult('a@test.com', 'Safe'),
        makeResult('e@test.com', 'Safe'),
        makeResult('c@test.com', 'Unknown'),
      ],
      settings: { validationMode: 'standard' },
      status: 'paused',
      currentIndex: 3,
      total: 5,
      createdAt: '',
    };
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_validation_session') return Promise.resolve(session);
      if (cmd === 'validate_emails_bulk') return new Promise(() => {});
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.resumeSession('s1', 4);
    });

    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'validate_emails_bulk');
    expect(call).toBeDefined();
    // Pending b and d, plus the Unknown c for revalidation. Never a or e.
    expect(call![1]).toEqual(
      expect.objectContaining({ emails: ['b@test.com', 'd@test.com', 'c@test.com'] })
    );
    expect(result.current.progress).toBe(3);
    expect(result.current.total).toBe(5);
  });

  it('saves progress as the number of results, not a position', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'create_validation_session') return Promise.resolve('s2');
      if (cmd === 'validate_emails_bulk') return new Promise(() => {});
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.startValidation(['a@test.com', 'b@test.com', 'c@test.com']);
    });
    act(() => {
      result.current.setResults([
        makeResult('c@test.com', 'Safe'),
        makeResult('a@test.com', 'Safe'),
      ]);
    });

    mockInvoke.mockClear();
    await act(async () => {
      await result.current.pauseValidation();
    });

    const save = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'update_validation_session');
    expect(save).toBeDefined();
    expect(save![1]).toEqual(expect.objectContaining({ id: 's2', currentIndex: 2, status: 'paused' }));
  });

  it('records a stopped session as stopped', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'create_validation_session') return Promise.resolve('s3');
      if (cmd === 'validate_emails_bulk') return new Promise(() => {});
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.startValidation(['a@test.com', 'b@test.com']);
    });
    act(() => {
      result.current.setResults([makeResult('a@test.com', 'Safe')]);
    });

    mockInvoke.mockClear();
    await act(async () => {
      await result.current.stopValidation();
    });

    const save = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'update_validation_session');
    expect(save).toBeDefined();
    expect(save![1]).toEqual(expect.objectContaining({ id: 's3', currentIndex: 1, status: 'stopped' }));
  });
  it('sends only new or changed results after the first save, and rewrites on deletion', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'create_validation_session') return Promise.resolve('s4');
      if (cmd === 'validate_emails_bulk') return new Promise(() => {});
      return Promise.resolve(undefined);
    });
    const saves = () =>
      mockInvoke.mock.calls
        .filter((c: unknown[]) => c[0] === 'update_validation_session')
        .map((c: unknown[]) => c[1] as { results: ValidationResult[]; replace?: boolean; currentIndex: number });

    const { result } = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.startValidation(['a@test.com', 'b@test.com', 'c@test.com']);
    });
    const a = makeResult('a@test.com', 'Unknown');
    act(() => {
      result.current.setResults([a]);
    });
    mockInvoke.mockClear();
    await act(async () => {
      await result.current.pauseValidation();
    });
    // First save of a session in this hook: full rewrite.
    expect(saves()).toEqual([expect.objectContaining({ results: [a], replace: true, currentIndex: 1 })]);

    // A retry replaced a, and b is new: only those two are sent, appended.
    const aRetried = makeResult('a@test.com', 'Safe');
    const b = makeResult('b@test.com', 'Safe');
    act(() => {
      result.current.setResults([aRetried, b]);
    });
    mockInvoke.mockClear();
    await act(async () => {
      await result.current.stopValidation();
    });
    expect(saves()).toHaveLength(1);
    expect(saves()[0].results).toEqual([aRetried, b]);
    expect(saves()[0]).not.toHaveProperty('replace');
    expect(saves()[0].currentIndex).toBe(2);

    // Nothing changed: an empty append.
    mockInvoke.mockClear();
    await act(async () => {
      await result.current.stopValidation();
    });
    expect(saves()).toEqual([expect.objectContaining({ results: [], currentIndex: 2 })]);
    expect(saves()[0]).not.toHaveProperty('replace');

    // A deleted result can't be appended away: full rewrite.
    act(() => {
      result.current.setResults([b]);
    });
    mockInvoke.mockClear();
    await act(async () => {
      await result.current.stopValidation();
    });
    expect(saves()).toEqual([expect.objectContaining({ results: [b], replace: true, currentIndex: 1 })]);
  });

  it('rewrites in full after a failed save', async () => {
    let failNext = false;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'create_validation_session') return Promise.resolve('s5');
      if (cmd === 'validate_emails_bulk') return new Promise(() => {});
      if (cmd === 'update_validation_session' && failNext) {
        failNext = false;
        return Promise.reject(new Error('disk full'));
      }
      return Promise.resolve(undefined);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saves = () =>
      mockInvoke.mock.calls
        .filter((c: unknown[]) => c[0] === 'update_validation_session')
        .map((c: unknown[]) => c[1] as { results: ValidationResult[]; replace?: boolean });

    const { result } = renderHook(() => useEmailValidation(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.startValidation(['a@test.com', 'b@test.com']);
    });
    const a = makeResult('a@test.com', 'Safe');
    act(() => {
      result.current.setResults([a]);
    });
    await act(async () => {
      await result.current.stopValidation();
    });

    const b = makeResult('b@test.com', 'Safe');
    act(() => {
      result.current.setResults([a, b]);
    });
    failNext = true;
    await act(async () => {
      await result.current.stopValidation();
    });
    mockInvoke.mockClear();
    await act(async () => {
      await result.current.stopValidation();
    });
    expect(saves()).toEqual([expect.objectContaining({ results: [a, b], replace: true })]);
    expect(warn).toHaveBeenCalledWith('Failed to auto-save session:', expect.any(Error));
    warn.mockRestore();
  });
});
