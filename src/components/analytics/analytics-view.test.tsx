import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnalyticsView, CURRENT_RUN } from './analytics-view';
import type { ValidationResult } from '@/lib/types';

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

function makeResults(safe: number, prefix: string): ValidationResult[] {
  return Array.from({ length: safe }, (_, i) => ({
    email: `${prefix}${i}@example.com`,
    result: 'Safe',
    reason: 'Deliverable',
    riskScore: 5,
    timestamp: '2025-01-01T00:00:00Z',
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
  })) as ValidationResult[];
}

function summary(id: string, name: string, createdAt: string) {
  return {
    id,
    name,
    status: 'completed',
    currentIndex: 0,
    total: 0,
    createdAt,
    settings: { validationMode: 'standard' },
  };
}

// Listed oldest first: the view must pick the latest by createdAt itself.
const olderSession = summary('older', 'Older run', '2025-01-01T10:00:00Z');
const newerSession = summary('newer', 'Newer run', '2025-03-01T10:00:00Z');

const sessionResults: Record<string, ValidationResult[]> = {
  older: makeResults(7, 'old'),
  newer: makeResults(3, 'new'),
};

function mockBackend(summaries: unknown[]) {
  mockInvoke.mockImplementation((cmd: string, args?: { id: string }) => {
    if (cmd === 'list_validation_sessions') return Promise.resolve(summaries);
    if (cmd === 'load_validation_session') {
      const s = [olderSession, newerSession].find((x) => x.id === args!.id)!;
      return Promise.resolve({
        ...s,
        emails: [],
        results: sessionResults[args!.id],
      });
    }
    return Promise.reject(new Error(`unexpected command ${cmd}`));
  });
}

function loadCalls() {
  return mockInvoke.mock.calls.filter(
    ([cmd]) => cmd === 'load_validation_session'
  );
}

/** The Safe count shown in the statistics dashboard. */
function safeCount() {
  return screen.getByText('Deliverable emails').previousElementSibling
    ?.textContent;
}

describe('AnalyticsView', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('shows the empty state when there are no sessions and no live results', async () => {
    mockBackend([]);
    render(<AnalyticsView liveResults={[]} status="idle" />);

    expect(await screen.findByText('No analytics data yet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Showing')).not.toBeInTheDocument();
    expect(loadCalls()).toHaveLength(0);
  });

  it('lists every session plus Current run and loads the most recent by default', async () => {
    mockBackend([olderSession, newerSession]);
    render(<AnalyticsView liveResults={[]} status="idle" />);

    const select = (await screen.findByLabelText('Showing')) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toBe('Current run');
    expect(labels.some((l) => l?.startsWith('Newer run'))).toBe(true);
    expect(labels.some((l) => l?.startsWith('Older run'))).toBe(true);
    expect(select.value).toBe('newer');

    await waitFor(() => expect(safeCount()).toBe('3'));
    expect(loadCalls()).toEqual([['load_validation_session', { id: 'newer' }]]);
  });

  it('loads the results of the session the user selects', async () => {
    mockBackend([olderSession, newerSession]);
    render(<AnalyticsView liveResults={[]} status="idle" />);

    await waitFor(() => expect(safeCount()).toBe('3'));
    fireEvent.change(screen.getByLabelText('Showing'), {
      target: { value: 'older' },
    });

    await waitFor(() => expect(safeCount()).toBe('7'));
    expect(loadCalls()[loadCalls().length - 1]).toEqual([
      'load_validation_session',
      { id: 'older' },
    ]);
  });

  it('uses the current run when it has results and loads nothing until a session is picked', async () => {
    mockBackend([olderSession, newerSession]);
    render(
      <AnalyticsView liveResults={makeResults(5, 'live')} status="idle" />
    );

    const select = (await screen.findByLabelText('Showing')) as HTMLSelectElement;
    expect(select.value).toBe(CURRENT_RUN);
    expect(safeCount()).toBe('5');
    expect(loadCalls()).toHaveLength(0);

    fireEvent.change(select, { target: { value: 'newer' } });
    await waitFor(() => expect(safeCount()).toBe('3'));
    expect(loadCalls()).toEqual([['load_validation_session', { id: 'newer' }]]);
  });

  it('returns to the current run when a new run starts', async () => {
    mockBackend([olderSession, newerSession]);
    const { rerender } = render(
      <AnalyticsView liveResults={makeResults(5, 'live')} status="idle" />
    );

    const select = (await screen.findByLabelText('Showing')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'older' } });
    await waitFor(() => expect(safeCount()).toBe('7'));

    rerender(
      <AnalyticsView liveResults={makeResults(1, 'run2')} status="processing" />
    );
    await waitFor(() => expect(select.value).toBe(CURRENT_RUN));
    expect(safeCount()).toBe('1');
  });

  it('shows an error with a retry button when a session fails to load', async () => {
    mockBackend([olderSession, newerSession]);
    const ok = mockInvoke.getMockImplementation()!;
    let failNext = true;
    mockInvoke.mockImplementation((cmd: string, args?: { id: string }) => {
      if (cmd === 'load_validation_session' && failNext) {
        failNext = false;
        return Promise.reject(new Error('disk read failed'));
      }
      return ok(cmd, args);
    });
    render(<AnalyticsView liveResults={[]} status="idle" />);

    expect(
      await screen.findByText(/Could not load session: .*disk read failed/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(safeCount()).toBe('3'));
    expect(screen.queryByText(/Could not load session/)).not.toBeInTheDocument();
  });
});
