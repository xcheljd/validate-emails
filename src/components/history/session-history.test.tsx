import { render, screen, waitFor } from '@testing-library/react';
import { SessionHistory } from './session-history';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as sessionManager from '@/lib/session-manager';

// Mock session manager
vi.mock('@/lib/session-manager', () => ({
  listSessions: vi.fn(),
  cleanupOldSessions: vi.fn(),
  deleteSession: vi.fn(),
  loadSession: vi.fn(),
}));

const mockSessions = [
  {
    id: '1',
    name: 'Session 1',
    createdAt: '2025-01-01',
    status: 'completed',
    total: 100,
    currentIndex: 100,
    results: [],
    config: {},
  },
  {
    id: '2',
    name: 'Session 2',
    createdAt: '2025-01-02',
    status: 'in-progress',
    total: 50,
    currentIndex: 25,
    results: [],
    config: {},
  },
];

describe('SessionHistory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders sessions list', async () => {
    (sessionManager.listSessions as any).mockResolvedValue(mockSessions);

    render(
      <SessionHistory
        onViewDetails={vi.fn()}
        onResume={vi.fn()}
        onSessionSelected={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument();
      expect(screen.getByText('Session 2')).toBeInTheDocument();
    });
  });

  it('renders empty state', async () => {
    (sessionManager.listSessions as any).mockResolvedValue([]);

    render(
      <SessionHistory
        onViewDetails={vi.fn()}
        onResume={vi.fn()}
        onSessionSelected={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/No sessions found/i)).toBeInTheDocument();
    });
  });
});
