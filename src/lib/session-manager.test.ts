import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createSession, updateSessionProgress, loadSession, listSessions, deleteSession, cleanupOldSessions } from './session-manager';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('session-manager', () => {
  const mockSettings = {
    validationMode: 'standard' as const,
  };

  const mockSession = {
    id: 'test-session-1',
    name: 'Jan 4, 2025 2:30 PM',
    emails: ['test@example.com', 'user@test.org'],
    results: [],
    status: 'in-progress' as const,
    currentIndex: 0,
    total: 2,
    createdAt: '2025-01-04T14:30:00Z',
    settings: mockSettings,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createSession should invoke create_validation_session with correct parameters', async () => {
    vi.mocked(invoke).mockResolvedValue('test-session-id');

    const result = await createSession(['test@example.com'], mockSettings);

    expect(invoke).toHaveBeenCalledWith('create_validation_session', {
      emails: ['test@example.com'],
      settings: mockSettings,
    });
    expect(result).toBe('test-session-id');
  });

  it('updateSessionProgress should invoke update_validation_session with correct parameters', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    const mockResults = [
      {
        email: 'test@example.com',
        result: 'Safe' as const,
        reason: 'Valid email',
        logs: [],
        domain: 'example.com',
        validationDuration: 1000,
        mxRecordCount: 2,
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
        timestamp: '2025-01-04T14:30:00Z',
        validationMode: 'standard' as const,
        riskScore: 0,
      },
    ];

    await updateSessionProgress('test-session-id', mockResults, 1);

    expect(invoke).toHaveBeenCalledWith('update_validation_session', {
      id: 'test-session-id',
      results: mockResults,
      currentIndex: 1,
      backup: true,
    });
  });

  it('loadSession should invoke load_validation_session with correct parameters', async () => {
    vi.mocked(invoke).mockResolvedValue(mockSession);

    const result = await loadSession('test-session-1');

    expect(invoke).toHaveBeenCalledWith('load_validation_session', { id: 'test-session-1' });
    expect(result).toEqual(mockSession);
  });

  it('listSessions should invoke list_validation_sessions', async () => {
    vi.mocked(invoke).mockResolvedValue([mockSession]);

    const result = await listSessions();

    expect(invoke).toHaveBeenCalledWith('list_validation_sessions');
    expect(result).toEqual([mockSession]);
  });

  it('deleteSession should invoke delete_validation_session with correct parameters', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await deleteSession('test-session-1');

    expect(invoke).toHaveBeenCalledWith('delete_validation_session', { id: 'test-session-1' });
  });

  it('cleanupOldSessions should invoke cleanup_old_sessions with correct parameters', async () => {
    vi.mocked(invoke).mockResolvedValue(5);

    const result = await cleanupOldSessions(90);

    expect(invoke).toHaveBeenCalledWith('cleanup_old_sessions', { days: 90 });
    expect(result).toBe(5);
  });

  it('cleanupOldSessions should use default days of 90 when not provided', async () => {
    vi.mocked(invoke).mockResolvedValue(3);

    const result = await cleanupOldSessions();

    expect(invoke).toHaveBeenCalledWith('cleanup_old_sessions', { days: 90 });
    expect(result).toBe(3);
  });
});
