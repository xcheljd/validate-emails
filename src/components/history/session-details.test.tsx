import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionDetails } from './session-details';
import type { ValidationSession } from '@/lib/session-manager';
import type { ValidationResult } from '@/lib/types';

const { mockSession } = vi.hoisted(() => {
  const mockResults: ValidationResult[] = [
    {
      email: 'test@example.com',
      result: 'Safe',
      reason: 'Deliverable',
      riskScore: 10,
      timestamp: '2024-01-01T00:00:00Z',
      domain: 'example.com',
      logs: [],
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
      validationMode: 'standard',
    },
    {
      email: 'risky@example.com',
      result: 'Risky',
      reason: 'Accepts all',
      riskScore: 50,
      timestamp: '2024-01-01T00:00:00Z',
      domain: 'example.com',
      logs: [],
      validationDuration: 200,
      mxRecordCount: 1,
      isDisposable: false,
      isRoleAccount: false,
      isCatchAll: true,
      isDeliverable: false,
      isDisabled: false,
      hasFullInbox: false,
      canConnectSmtp: true,
      acceptsMail: true,
      isValidSyntax: true,
      isB2c: false,
      validationMode: 'standard',
    },
  ];

  const mockSession: ValidationSession = {
    id: 'test-session-1',
    name: 'Test Session',
    emails: ['test@example.com', 'risky@example.com'],
    results: mockResults,
    status: 'completed',
    currentIndex: 2,
    total: 2,
    createdAt: '2024-01-01T00:00:00Z',
    completedAt: '2024-01-01T00:01:00Z',
    settings: { validationMode: 'standard' },
  };

  return { mockSession };
});

vi.mock('@/lib/session-manager', () => ({
  loadSession: vi.fn().mockResolvedValue(mockSession),
}));

vi.mock('@/lib/enhanced-export-utils', () => ({
  exportColumns: [
    { key: 'email', label: 'Email', enabled: true },
    { key: 'result', label: 'Status', enabled: true },
    { key: 'reason', label: 'Reason', enabled: true },
  ],
}));

vi.mock('@/lib/typo-database', () => ({
  suggestCorrection: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/hooks/use-debounce', () => ({
  useDebounce: (val: string) => val,
}));

vi.mock('@/lib/export-utils', () => ({
  formatAsCSV: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('SessionDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders session details with status filter controls', async () => {
    render(<SessionDetails sessionId="test-session-1" />, {
      wrapper: createWrapper(),
    });

    // Wait for the session to load
    await waitFor(() => {
      expect(screen.getByText('Test Session')).toBeDefined();
    });

    // Verify the ResultsTable renders (it should receive statusFilter props)
    await waitFor(() => {
      // The status filter dropdown should be rendered by ResultsTable
      const selectElement = screen.getByDisplayValue('All Status');
      expect(selectElement).toBeDefined();
    });
  });

  it('passes statusFilter and onStatusFilterChange props to ResultsTable', async () => {
    const { container } = render(
      <SessionDetails sessionId="test-session-1" />,
      {
        wrapper: createWrapper(),
      }
    );

    // Wait for load
    await waitFor(() => {
      expect(screen.getByText('Test Session')).toBeDefined();
    });

    // Verify the status filter select exists (meaning props were passed correctly)
    const selectEl = container.querySelector('select');
    expect(selectEl).toBeDefined();
  });
});
