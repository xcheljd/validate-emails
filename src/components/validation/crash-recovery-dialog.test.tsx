import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CrashRecoveryDialog } from './crash-recovery-dialog';
import type { ValidationSession } from '@/lib/session-manager';

// Mock session-manager
const mockListSessions = vi.fn();
vi.mock('@/lib/session-manager', () => ({
  listSessions: (...args: unknown[]) => mockListSessions(...args),
  cleanupOldSessions: vi.fn(),
  deleteSession: vi.fn(),
  loadSession: vi.fn(),
  createSession: vi.fn(),
  updateSessionProgress: vi.fn(),
}));

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock Tauri event
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const mockIncompleteSessions: ValidationSession[] = [
  {
    id: '1',
    name: 'Test Session A',
    createdAt: '2025-06-01T10:30:00Z',
    status: 'in-progress',
    total: 100,
    currentIndex: 50,
    results: [],
    emails: [],
    settings: { validationMode: 'thorough' },
  },
  {
    id: '2',
    name: 'Test Session B',
    createdAt: '2025-06-02T14:15:00Z',
    status: 'paused',
    total: 200,
    currentIndex: 75,
    results: [],
    emails: [],
    settings: { validationMode: 'standard' },
  },
];

const mockCompletedSession: ValidationSession = {
  id: '3',
  name: 'Completed Session',
  createdAt: '2025-06-01T08:00:00Z',
  status: 'completed',
  total: 50,
  currentIndex: 50,
  results: [],
  emails: [],
  settings: { validationMode: 'quick' },
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('CrashRecoveryDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows dialog with incomplete sessions listed', async () => {
    mockListSessions.mockResolvedValue([
      ...mockIncompleteSessions,
      mockCompletedSession,
    ]);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <CrashRecoveryDialog
          onResume={vi.fn()}
          onDismiss={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Resume Session')).toBeInTheDocument();
      expect(screen.getByText('Test Session A')).toBeInTheDocument();
      expect(screen.getByText('Test Session B')).toBeInTheDocument();
      // Completed session should NOT be listed
      expect(screen.queryByText('Completed Session')).not.toBeInTheDocument();
    });
  });

  it('displays session name and formatted date for each session', async () => {
    mockListSessions.mockResolvedValue(mockIncompleteSessions);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <CrashRecoveryDialog
          onResume={vi.fn()}
          onDismiss={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Session A')).toBeInTheDocument();
      expect(screen.getByText('Test Session B')).toBeInTheDocument();
    });

    // Check dates are rendered
    const dateElements = screen.getAllByText(/\d+\/\d+\/\d+/);
    expect(dateElements.length).toBeGreaterThanOrEqual(2);
  });

  it('has a Resume button for each incomplete session', async () => {
    mockListSessions.mockResolvedValue(mockIncompleteSessions);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <CrashRecoveryDialog
          onResume={vi.fn()}
          onDismiss={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      const resumeButtons = screen.getAllByRole('button', { name: /resume/i });
      // 2 session Resume buttons + 1 Dismiss button
      expect(resumeButtons.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('calls onResume with session ID when Resume is clicked', async () => {
    const onResume = vi.fn();
    mockListSessions.mockResolvedValue(mockIncompleteSessions);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <CrashRecoveryDialog
          onResume={onResume}
          onDismiss={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Session A')).toBeInTheDocument();
    });

    // Find the first session's resume button (inside the row for Test Session A)
    const allButtons = screen.getAllByRole('button', { name: /resume/i });
    fireEvent.click(allButtons[0]);

    expect(onResume).toHaveBeenCalledWith('1');
  });

  it('has a Dismiss button that calls onDismiss', async () => {
    const onDismiss = vi.fn();
    mockListSessions.mockResolvedValue(mockIncompleteSessions);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <CrashRecoveryDialog
          onResume={vi.fn()}
          onDismiss={onDismiss}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Session A')).toBeInTheDocument();
    });

    const dismissButton = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissButton);

    expect(onDismiss).toHaveBeenCalled();
  });

  it('does not show dialog when no incomplete sessions exist', async () => {
    mockListSessions.mockResolvedValue([mockCompletedSession]);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <CrashRecoveryDialog
          onResume={vi.fn()}
          onDismiss={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(mockListSessions).toHaveBeenCalled();
    });

    // Dialog should not be visible
    expect(screen.queryByText('Resume Session')).not.toBeInTheDocument();
  });

  it('does not show dialog when listSessions returns empty', async () => {
    mockListSessions.mockResolvedValue([]);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <CrashRecoveryDialog
          onResume={vi.fn()}
          onDismiss={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(mockListSessions).toHaveBeenCalled();
    });

    expect(screen.queryByText('Resume Session')).not.toBeInTheDocument();
  });

  it('shows session status badge as In Progress or Paused', async () => {
    mockListSessions.mockResolvedValue(mockIncompleteSessions);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <CrashRecoveryDialog
          onResume={vi.fn()}
          onDismiss={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('In Progress')).toBeInTheDocument();
      expect(screen.getByText('Paused')).toBeInTheDocument();
    });
  });

  it('shows progress percentage for each session', async () => {
    mockListSessions.mockResolvedValue(mockIncompleteSessions);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <CrashRecoveryDialog
          onResume={vi.fn()}
          onDismiss={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      // Session A: 50/100 = 50%
      expect(screen.getByText(/50% complete/)).toBeInTheDocument();
      // Session B: 75/200 = 38% (rounds to 38%)
      expect(screen.getByText(/38% complete/)).toBeInTheDocument();
    });
  });
});
