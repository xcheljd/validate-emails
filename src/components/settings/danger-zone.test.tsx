import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { SettingsContent } from './settings-content';
import { SettingsProvider } from '@/hooks/use-settings';

const { mockInvoke, mockToastError, mockToastSuccess } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

vi.mock('sonner', () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}));

const customSettings = {
  validation_mode: 'thorough',
  concurrency: 12,
  timeout_ms: 60000,
  max_retries: 3,
  auto_save_interval: 10,
  history_retention_days: 90,
  max_emails_per_session: 0,
  rate_limiter: { enabled: true, max_per_second: 5, max_per_minute: 120 },
  from_email: 'probe@mail.acme.io',
  hello_name: 'mail.acme.io',
  check_gravatar: false,
  mx_concurrency: 3,
};

const emptyPool = {
  proxies: [],
  enabled: false,
  rotationMode: 'manual',
  domainAssignments: {},
  proxyStats: {},
  cooldownDurationSecs: 60,
  autoDisableThreshold: { successRatePercent: 20, minAttempts: 10 },
};

const populatedPool = {
  ...emptyPool,
  enabled: true,
  rotationMode: 'perDomain',
  proxies: [{ host: '10.0.0.1', port: 1080 }],
  domainAssignments: { 'gmail.com': '10.0.0.1:1080' },
};

/** Settings::default() as serialized by the backend's reset_settings. */
const defaultBackendSettings = {
  validation_mode: 'standard',
  concurrency: 5,
  timeout_ms: 30000,
  max_retries: 1,
  auto_save_interval: 10,
  history_retention_days: 90,
  max_emails_per_session: 0,
  rate_limiter: { enabled: false, max_per_second: 1, max_per_minute: 60 },
  from_email: '',
  hello_name: '',
  check_gravatar: false,
  mx_concurrency: 3,
  proxy_pool: emptyPool,
};

// Node's own (flag-gated) global localStorage shadows jsdom's, so provide
// an in-memory one for the SettingsProvider.
function memoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear: () => {
      store = {};
    },
    getItem: (k) => (k in store ? store[k] : null),
    key: (i) => Object.keys(store)[i] ?? null,
    removeItem: (k) => {
      delete store[k];
    },
    setItem: (k, v) => {
      store[k] = String(v);
    },
  };
}

function SettingsWrapper({ children }: { children: React.ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}

async function renderSettings(
  pool: Record<string, unknown>,
  overrides: Record<string, () => Promise<unknown>> = {}
) {
  mockInvoke.mockImplementation((command: string) => {
    if (command in overrides) return overrides[command]();
    if (command === 'load_settings') return Promise.resolve(customSettings);
    if (command === 'get_proxy_pool') return Promise.resolve(pool);
    if (command === 'reset_settings') {
      return Promise.resolve(defaultBackendSettings);
    }
    return Promise.resolve();
  });
  await act(async () => {
    render(<SettingsContent />, { wrapper: SettingsWrapper });
  });
}

function invokedCommands(): string[] {
  return mockInvoke.mock.calls.map(([cmd]) => cmd as string);
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function openProxyTab() {
  await click(screen.getByRole('button', { name: /^proxy$/i }));
}

describe('Reset to defaults', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.clearAllMocks();
  });

  it('opens a confirmation dialog describing the full reset', async () => {
    await renderSettings(populatedPool);
    await click(screen.getByRole('button', { name: /reset to defaults/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/resets ALL settings to their defaults/);
    expect(dialog).toHaveTextContent(/entire proxy pool/);
    expect(dialog).toHaveTextContent(/cannot be undone/);
    expect(
      screen.getByRole('button', { name: 'Reset everything' })
    ).toBeInTheDocument();
  });

  it('Cancel closes the dialog without calling reset_settings', async () => {
    await renderSettings(populatedPool);
    await click(screen.getByRole('button', { name: /reset to defaults/i }));
    await click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(invokedCommands()).not.toContain('reset_settings');
    expect(screen.getByLabelText(/concurrency \(parallel/i)).toHaveValue(12);
  });

  it('Confirm calls reset_settings and the UI shows the returned defaults', async () => {
    await renderSettings(populatedPool);
    expect(screen.getByLabelText(/concurrency \(parallel/i)).toHaveValue(12);
    expect(screen.getByLabelText('HELO name')).toHaveValue('mail.acme.io');

    await click(screen.getByRole('button', { name: /reset to defaults/i }));
    await click(screen.getByRole('button', { name: 'Reset everything' }));

    expect(invokedCommands()).toContain('reset_settings');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/concurrency \(parallel/i)).toHaveValue(5);
    expect(screen.getByLabelText(/^timeout/i)).toHaveValue(30);
    expect(screen.getByLabelText('HELO name')).toHaveValue('');
    expect(screen.getByLabelText('Default Validation Mode')).toHaveValue(
      'standard'
    );
    expect(mockToastSuccess).toHaveBeenCalled();

    // Proxy pool is empty after the reset
    await openProxyTab();
    expect(screen.queryByText(/10\.0\.0\.1/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /clear all proxies/i })
    ).toBeDisabled();
  });

  it('shows an error toast and keeps settings when reset_settings fails', async () => {
    await renderSettings(populatedPool, {
      reset_settings: () => Promise.reject('disk full'),
    });
    await click(screen.getByRole('button', { name: /reset to defaults/i }));
    await click(screen.getByRole('button', { name: 'Reset everything' }));

    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to reset settings: disk full'
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/concurrency \(parallel/i)).toHaveValue(12);
  });
});

describe('Clear all proxies', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.clearAllMocks();
  });

  it('is disabled when there are no proxies', async () => {
    await renderSettings(emptyPool);
    await openProxyTab();
    expect(
      screen.getByRole('button', { name: /clear all proxies/i })
    ).toBeDisabled();
  });

  it('is enabled when proxies exist', async () => {
    await renderSettings(populatedPool);
    await openProxyTab();
    expect(
      screen.getByRole('button', { name: /clear all proxies/i })
    ).toBeEnabled();
  });

  it('Cancel closes the dialog without calling clear_proxies', async () => {
    await renderSettings(populatedPool);
    await openProxyTab();
    await click(screen.getByRole('button', { name: /clear all proxies/i }));

    expect(screen.getByRole('dialog')).toHaveTextContent(
      /removes ALL proxies, their health stats, and all domain assignments/
    );
    await click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(invokedCommands()).not.toContain('clear_proxies');
    expect(
      screen.getByRole('button', { name: /clear all proxies/i })
    ).toBeEnabled();
  });

  it('Confirm calls clear_proxies and empties the pool', async () => {
    await renderSettings(populatedPool);
    await openProxyTab();
    expect(screen.getAllByText(/10\.0\.0\.1/).length).toBeGreaterThan(0);

    await click(screen.getByRole('button', { name: /clear all proxies/i }));
    await click(screen.getByRole('button', { name: 'Clear proxies' }));

    expect(invokedCommands()).toContain('clear_proxies');
    expect(invokedCommands()).not.toContain('reset_settings');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/10\.0\.0\.1/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /clear all proxies/i })
    ).toBeDisabled();
    expect(mockToastSuccess).toHaveBeenCalledWith('All proxies cleared');
  });
});
