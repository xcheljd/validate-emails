import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { SettingsContent, validateSmtpIdentity } from './settings-content';
import { SettingsProvider } from '@/hooks/use-settings';

const { mockInvoke, mockToastError } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: mockToastError },
}));

const backendSettings = {
  validation_mode: 'standard',
  concurrency: 5,
  timeout_ms: 30000,
  max_retries: 3,
  auto_save_interval: 10,
  history_retention_days: 90,
  max_emails_per_session: 0,
  rate_limiter: { max_per_second: 1, max_per_minute: 60 },
};

const backendProxyPool = {
  proxies: [],
  enabled: false,
  rotationMode: 'manual',
  domainAssignments: {},
  proxyStats: {},
  cooldownDurationSecs: 60,
  autoDisableThreshold: { successRatePercent: 20, minAttempts: 10 },
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

async function renderSettings(backend: Record<string, unknown> = {}) {
  mockInvoke.mockImplementation((command: string) => {
    if (command === 'load_settings') {
      return Promise.resolve({ ...backendSettings, ...backend });
    }
    if (command === 'get_proxy_pool') return Promise.resolve(backendProxyPool);
    return Promise.resolve();
  });
  await act(async () => {
    render(<SettingsContent />, { wrapper: SettingsWrapper });
  });
}

function savedSettings(): Record<string, unknown> {
  const call = mockInvoke.mock.calls.find(([cmd]) => cmd === 'save_settings');
  expect(call).toBeDefined();
  return (call![1] as { settings: Record<string, unknown> }).settings;
}

describe('SMTP callout settings', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.clearAllMocks();
  });

  it('renders the From email and HELO name fields with guidance', async () => {
    await renderSettings();
    expect(screen.getByLabelText('From email (SMTP callout)')).toHaveValue('');
    expect(screen.getByLabelText('HELO name')).toHaveValue('');
    expect(
      screen.getByText(/ideally one whose reverse\s+DNS matches/i)
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/example\.com\s+is rejected by many servers/i).length
    ).toBeGreaterThan(0);
  });

  it('loads saved values from the backend', async () => {
    await renderSettings({
      from_email: 'probe@mail.acme.io',
      hello_name: 'mail.acme.io',
    });
    expect(screen.getByLabelText('From email (SMTP callout)')).toHaveValue(
      'probe@mail.acme.io'
    );
    expect(screen.getByLabelText('HELO name')).toHaveValue('mail.acme.io');
  });

  it('includes trimmed values in save_settings', async () => {
    await renderSettings();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('From email (SMTP callout)'), {
        target: { value: ' probe@mail.acme.io ' },
      });
      fireEvent.change(screen.getByLabelText('HELO name'), {
        target: { value: 'mail.acme.io' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save Settings'));
    });
    const saved = savedSettings();
    expect(saved.from_email).toBe('probe@mail.acme.io');
    expect(saved.hello_name).toBe('mail.acme.io');
  });

  it('saves empty strings when left blank (built-in default)', async () => {
    await renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByText('Save Settings'));
    });
    const saved = savedSettings();
    expect(saved.from_email).toBe('');
    expect(saved.hello_name).toBe('');
  });

  it('blocks save and shows an error for an invalid from email', async () => {
    await renderSettings();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('From email (SMTP callout)'), {
        target: { value: 'not-an-address' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save Settings'));
    });
    expect(mockToastError).toHaveBeenCalledWith("From email must contain '@'");
    expect(
      mockInvoke.mock.calls.some(([cmd]) => cmd === 'save_settings')
    ).toBe(false);
  });
});

describe('validateSmtpIdentity', () => {
  it('accepts blank and plausible values', () => {
    expect(validateSmtpIdentity('', '')).toBeNull();
    expect(validateSmtpIdentity('probe@mail.acme.io', 'mail.acme.io')).toBeNull();
    expect(validateSmtpIdentity('  probe@acme.io  ', ' acme.io ')).toBeNull();
  });

  it('rejects a from email without @ and whitespace inside values', () => {
    expect(validateSmtpIdentity('nope', '')).toMatch(/@/);
    expect(validateSmtpIdentity('a b@acme.io', '')).toMatch(/spaces/);
    expect(validateSmtpIdentity('', 'mail acme.io')).toMatch(/HELO/);
  });
});
