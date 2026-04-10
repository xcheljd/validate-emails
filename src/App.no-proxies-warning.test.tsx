import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Hoisted mock functions (needed because vi.mock factories are hoisted)
const { mockShowWarning, mockStartValidation, getMockSettings } = vi.hoisted(() => {
  let mockSettingsState: any = {
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
  };
  return {
    mockShowWarning: vi.fn(),
    mockStartValidation: vi.fn(),
    getMockSettings: () => mockSettingsState,
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

// Mock use-settings
vi.mock('@/hooks/use-settings', () => ({
  useSettings: () => ({
    settings: getMockSettings(),
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
  }),
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
    allProxiesFailedState: null,
    continueWithoutProxy: vi.fn(),
    retryWithCooldown: vi.fn(),
    usingDirectConnection: false,
    waitingForProxy: false,
    waitingCooldownSecs: 0,
  }),
}));

// Mock EmailInput to immediately trigger onEmailsLoaded with emails
vi.mock('@/components/validation/email-input', () => ({
  EmailInput: ({ onEmailsLoaded }: { onEmailsLoaded: (emails: string[]) => void }) => {
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
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('should show warning toast and NOT start validation when proxy enabled but no proxies configured', () => {
    // Set localStorage directly — this simulates the user enabling proxy
    // in Settings without a page reload (the React state in App.tsx is stale)
    localStorage.setItem('proxy-settings', JSON.stringify({
      enabled: true,
      proxies: [],
      rotationMode: 'manual',
      domainAssignments: {},
      proxyStats: {},
      cooldownDurationSecs: 60,
    }));

    // Even though the mock useSettings returns stale state (proxy disabled),
    // the guard should read from localStorage and detect enabled + empty
    const settings = getMockSettings();
    settings.proxy.enabled = false; // Stale React state — doesn't matter anymore
    settings.proxy.proxies = [];

    render(<App />, { wrapper });

    // After EmailInput loads emails, ValidationConfig should show Start button
    const startButton = screen.getByRole('button', { name: /start validation/i });
    expect(startButton).toBeInTheDocument();

    fireEvent.click(startButton);

    // Warning toast should be shown (reads from localStorage, not stale React state)
    expect(mockShowWarning).toHaveBeenCalledWith('No proxies configured. Please add proxies in Settings or disable proxy.');
    // Validation should NOT start
    expect(mockStartValidation).not.toHaveBeenCalled();
  });

  it('should NOT show warning and should start validation when proxy is disabled', () => {
    // localStorage has proxy disabled
    localStorage.setItem('proxy-settings', JSON.stringify({
      enabled: false,
      proxies: [],
      rotationMode: 'manual',
      domainAssignments: {},
      proxyStats: {},
      cooldownDurationSecs: 60,
    }));

    const settings = getMockSettings();
    settings.proxy.enabled = false;
    settings.proxy.proxies = [];

    render(<App />, { wrapper });

    const startButton = screen.getByRole('button', { name: /start validation/i });
    fireEvent.click(startButton);

    // No warning should be shown
    expect(mockShowWarning).not.toHaveBeenCalled();
    // Validation should start
    expect(mockStartValidation).toHaveBeenCalled();
  });

  it('should NOT show warning and should start validation when proxy is enabled and proxies are configured', () => {
    // localStorage has proxy enabled with proxies configured
    localStorage.setItem('proxy-settings', JSON.stringify({
      enabled: true,
      proxies: [{ host: '192.168.1.1', port: 8080 }],
      rotationMode: 'manual',
      domainAssignments: {},
      proxyStats: {},
      cooldownDurationSecs: 60,
    }));

    const settings = getMockSettings();
    settings.proxy.enabled = true;
    settings.proxy.proxies = [{ host: '192.168.1.1', port: 8080 }];

    render(<App />, { wrapper });

    const startButton = screen.getByRole('button', { name: /start validation/i });
    fireEvent.click(startButton);

    // No warning should be shown
    expect(mockShowWarning).not.toHaveBeenCalled();
    // Validation should start
    expect(mockStartValidation).toHaveBeenCalled();
  });

  it('should detect proxy enabled from app-settings localStorage key', () => {
    // When Tauri IPC succeeds, proxy data is stored under 'app-settings' key
    localStorage.setItem('app-settings', JSON.stringify({
      validationMode: 'standard',
      concurrency: 5,
      proxy: {
        enabled: true,
        proxies: [], // No proxies configured
        rotationMode: 'manual',
      },
    }));

    const settings = getMockSettings();
    settings.proxy.enabled = false; // Stale React state
    settings.proxy.proxies = [];

    render(<App />, { wrapper });

    const startButton = screen.getByRole('button', { name: /start validation/i });
    fireEvent.click(startButton);

    // Warning should be shown (reads from app-settings localStorage)
    expect(mockShowWarning).toHaveBeenCalledWith('No proxies configured. Please add proxies in Settings or disable proxy.');
    expect(mockStartValidation).not.toHaveBeenCalled();
  });

  it('should show warning even when React state is stale (proxy disabled in React but enabled in localStorage)', () => {
    // This is the core bug scenario: user enables proxy in Settings,
    // but App.tsx useSettings() state is stale (still shows disabled)
    localStorage.setItem('proxy-settings', JSON.stringify({
      enabled: true,
      proxies: [],
      rotationMode: 'manual',
    }));

    // React state is stale — proxy appears disabled
    const settings = getMockSettings();
    settings.proxy.enabled = false;
    settings.proxy.proxies = [];

    render(<App />, { wrapper });

    const startButton = screen.getByRole('button', { name: /start validation/i });
    fireEvent.click(startButton);

    // Warning IS shown because we read from localStorage, not stale React state
    expect(mockShowWarning).toHaveBeenCalledWith('No proxies configured. Please add proxies in Settings or disable proxy.');
    expect(mockStartValidation).not.toHaveBeenCalled();
  });
});
