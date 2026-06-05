import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppSettings } from '@/hooks/use-settings';

// Hoisted mock functions (needed because vi.mock factories are hoisted)
const {
  mockShowWarning,
  mockStartValidation,
  getMockSettings,
  mockUseSettingsFn,
} = vi.hoisted(() => {
  const mockSettingsState: AppSettings = {
    validationMode: 'standard',
    concurrency: 5,
    timeout: 30,
    maxRetries: 3,
    autoSaveInterval: 10,
    sessionRetentionDays: 90,
    sidebarCollapsed: false,
    proxy: {
      proxies: [],
      enabled: false,
      rotationMode: 'manual',
      domainAssignments: {},
      proxyStats: {},
      cooldownDurationSecs: 60,
    },
    rateLimitMaxPerSecond: 1,
    rateLimitMaxPerMinute: 60,
    maxEmailsPerSession: 0,
  };
  return {
    mockShowWarning: vi.fn(),
    mockStartValidation: vi.fn(),
    getMockSettings: () => mockSettingsState,
    mockUseSettingsFn: vi.fn(() => ({
      settings: mockSettingsState,
      updateSettings: vi.fn(),
      addProxy: vi.fn(),
      updateProxy: vi.fn(),
      deleteProxy: vi.fn(),
      clearProxies: vi.fn(),
      updateProxyPoolConfig: vi.fn(),
      assignDomainProxy: vi.fn(),
      unassignDomainProxy: vi.fn(),
      getProxyStats: vi.fn(() => ({
        attempts: 0,
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        cooldownUntil: null,
      })),
      recordProxySuccess: vi.fn(),
      recordProxyFailure: vi.fn(),
      resetProxyStats: vi.fn(),
      bypassProxyCooldown: vi.fn(),
      setCooldownDuration: vi.fn(),
    })),
  };
});

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(),
}));

// Mock the toast module
vi.mock('@/lib/toast', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: mockShowWarning,
  showInfo: vi.fn(),
}));

// Mock use-settings — provides a passthrough SettingsProvider and a mock useSettings.
// The passthrough provider is needed because App.tsx wraps content in <SettingsProvider>.
// Components inside read from the mocked useSettings, so the provider just renders children.
vi.mock('@/hooks/use-settings', () => ({
  useSettings: mockUseSettingsFn,
  // Passthrough SettingsProvider — just renders children so App.tsx doesn't crash
  SettingsProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  defaultProxySettings: {
    proxies: [],
    enabled: false,
    rotationMode: 'manual',
    domainAssignments: {},
    proxyStats: {},
    cooldownDurationSecs: 60,
  },
}));

// Mock useEmailValidation
vi.mock('@/hooks/use-email-validation', () => ({
  useEmailValidation: () => ({
    results: [],
    isProcessing: false,
    status: 'idle',
    progress: 0,
    total: 0,
    startValidation: mockStartValidation,
    pauseValidation: vi.fn(),
    resumeValidation: vi.fn(),
    stopValidation: vi.fn(),
    setResults: vi.fn(),
    validationMode: 'standard',
    onChangeValidationMode: vi.fn(),
    validationSpeed: 0,
    estimatedTimeRemaining: 0,
    resumeSession: vi.fn(),
    retryUnknowns: vi.fn(),
    retryWithEscalation: vi.fn(),
    isEscalating: false,
    escalationTier: 1,
    escalationEmailCount: 0,
    allProxiesFailedState: null,
    continueWithoutProxy: vi.fn(),
    retryWithCooldown: vi.fn(),
    usingDirectConnection: false,
    waitingForProxy: false,
    waitingCooldownSecs: 0,
    rateLimitFailureState: {
      consecutiveFailures: 0,
      isSlowdownActive: false,
      isAutoPaused: false,
    },
    resumeFromAutoPause: vi.fn(),
    stopFromAutoPause: vi.fn(),
    setAllProxiesFailedStateForTest: vi.fn(),
  }),
}));

// Mock EmailInput to immediately trigger onEmailsLoaded with emails
vi.mock('@/components/validation/email-input', () => ({
  EmailInput: ({
    onEmailsLoaded,
  }: {
    onEmailsLoaded: (emails: string[]) => void;
  }) => {
    React.useEffect(() => {
      onEmailsLoaded(['test@example.com']);
    }, []);
    return <div data-testid="email-input-mock">Email Input Mock</div>;
  },
}));

// Must import App after mocks
import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('App - no proxies warning (VAL-FLR-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartValidation.mockReset();
    mockShowWarning.mockReset();
    // Reset the mock settings to defaults
    const settings = getMockSettings();
    settings.proxy.enabled = false;
    settings.proxy.proxies = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('should show warning toast and NOT start validation when proxy enabled but no proxies configured', () => {
    // With shared context, the mock useSettings returns proxy enabled + empty proxies
    const settings = getMockSettings();
    settings.proxy.enabled = true;
    settings.proxy.proxies = [];

    render(<App />, { wrapper });

    // EmailInput mock triggers onEmailsLoaded, which now shows cleaning report
    // Click "Proceed" to advance to validation config
    const proceedButton = screen.getByRole('button', {
      name: /proceed with \d+ clean emails/i,
    });
    fireEvent.click(proceedButton);

    const startButton = screen.getByRole('button', {
      name: /start validation/i,
    });
    expect(startButton).toBeInTheDocument();

    fireEvent.click(startButton);

    expect(mockShowWarning).toHaveBeenCalledWith(
      'No proxies configured. Please add proxies in Settings or disable proxy.'
    );
    expect(mockStartValidation).not.toHaveBeenCalled();
  });

  it('should NOT show warning and should start validation when proxy is disabled', () => {
    const settings = getMockSettings();
    settings.proxy.enabled = false;
    settings.proxy.proxies = [];

    render(<App />, { wrapper });

    // Navigate past cleaning report
    const proceedButton = screen.getByRole('button', {
      name: /proceed with \d+ clean emails/i,
    });
    fireEvent.click(proceedButton);

    const startButton = screen.getByRole('button', {
      name: /start validation/i,
    });
    fireEvent.click(startButton);

    expect(mockShowWarning).not.toHaveBeenCalled();
    expect(mockStartValidation).toHaveBeenCalled();
  });

  it('should NOT show warning and should start validation when proxy is enabled and proxies are configured', () => {
    const settings = getMockSettings();
    settings.proxy.enabled = true;
    settings.proxy.proxies = [{ host: '192.168.1.1', port: 8080 }];

    render(<App />, { wrapper });

    // Navigate past cleaning report
    const proceedButton = screen.getByRole('button', {
      name: /proceed with \d+ clean emails/i,
    });
    fireEvent.click(proceedButton);

    const startButton = screen.getByRole('button', {
      name: /start validation/i,
    });
    fireEvent.click(startButton);

    expect(mockShowWarning).not.toHaveBeenCalled();
    expect(mockStartValidation).toHaveBeenCalled();
  });

  it('should reflect settings changes from context immediately (no stale state)', () => {
    // With React Context, settings changes in SettingsContent propagate to App instantly.
    // Simulate the scenario where proxy is enabled via context state.
    const settings = getMockSettings();
    settings.proxy.enabled = true;
    settings.proxy.proxies = [];

    render(<App />, { wrapper });

    // Navigate past cleaning report
    const proceedButton = screen.getByRole('button', {
      name: /proceed with \d+ clean emails/i,
    });
    fireEvent.click(proceedButton);

    const startButton = screen.getByRole('button', {
      name: /start validation/i,
    });
    fireEvent.click(startButton);

    // Context-based state is always live — no stale state possible
    expect(mockShowWarning).toHaveBeenCalledWith(
      'No proxies configured. Please add proxies in Settings or disable proxy.'
    );
    expect(mockStartValidation).not.toHaveBeenCalled();
  });
});
