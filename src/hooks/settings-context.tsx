import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  AppSettings,
  ProxySettings,
  ProxyConfig,
  ProxyStats,
  RotationMode,
  AutoDisableThreshold,
} from './use-settings';
import {
  defaultSettings,
  defaultProxySettings,
  getProxyId,
} from './use-settings';

// ---------------------------------------------------------------------------
// Internal helpers (previously module-private in use-settings.ts)
// ---------------------------------------------------------------------------

// No separate proxy-settings key; all settings stored under 'app-settings'

interface BackendSettings {
  validation_mode: string;
  concurrency: number;
  timeout_ms: number;
  max_retries: number;
  auto_save_interval: number;
  history_retention_days: number;
  max_emails_per_session: number;
  rate_limiter: { max_per_second: number; max_per_minute: number };
}

interface BackendProxyPool {
  proxies: ProxyConfig[];
  enabled: boolean;
  rotationMode: RotationMode;
  domainAssignments: Record<string, string>;
  proxyStats?: Record<string, ProxyStats>;
  cooldownDurationSecs?: number;
  autoDisableThreshold?: AutoDisableThreshold;
}

function backendToFrontend(backend: BackendSettings): Partial<AppSettings> {
  return {
    validationMode: backend.validation_mode as AppSettings['validationMode'],
    concurrency: backend.concurrency,
    timeout: Math.round(backend.timeout_ms / 1000),
    maxRetries: backend.max_retries,
    autoSaveInterval: backend.auto_save_interval,
    sessionRetentionDays: backend.history_retention_days,
    sidebarCollapsed: false,
    maxEmailsPerSession: backend.max_emails_per_session ?? 0,
    rateLimitMaxPerSecond: backend.rate_limiter?.max_per_second ?? 1,
    rateLimitMaxPerMinute: backend.rate_limiter?.max_per_minute ?? 60,
  };
}

function frontendToBackend(frontend: AppSettings): BackendSettings {
  return {
    validation_mode: frontend.validationMode,
    concurrency: frontend.concurrency,
    timeout_ms: frontend.timeout * 1000,
    max_retries: frontend.maxRetries,
    auto_save_interval: frontend.autoSaveInterval,
    history_retention_days: frontend.sessionRetentionDays,
    max_emails_per_session: frontend.maxEmailsPerSession,
    rate_limiter: {
      max_per_second: frontend.rateLimitMaxPerSecond,
      max_per_minute: frontend.rateLimitMaxPerMinute,
    },
  };
}

function backendProxyPoolToFrontend(backend: BackendProxyPool): ProxySettings {
  return {
    proxies: backend.proxies,
    enabled: backend.enabled,
    rotationMode: backend.rotationMode,
    domainAssignments: backend.domainAssignments,
    proxyStats: backend.proxyStats || {},
    cooldownDurationSecs: backend.cooldownDurationSecs ?? 60,
    autoDisableThreshold: backend.autoDisableThreshold ?? {
      successRatePercent: 20,
      minAttempts: 10,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared helper: update proxy portion of settings + persist to localStorage
// ---------------------------------------------------------------------------

function persistProxyUpdate(
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>,
  updater: (proxy: ProxySettings) => ProxySettings
): void {
  setSettings((prev) => {
    const updated = updater(prev.proxy);
    const next = { ...prev, proxy: updated };
    localStorage.setItem('app-settings', JSON.stringify(next));
    return next;
  });
}

/** Sync proxy pool from backend, then persist to localStorage */
function syncProxyFromBackend(
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>,
  proxySettings: ProxySettings
): void {
  setSettings((prev) => {
    const next = { ...prev, proxy: proxySettings };
    localStorage.setItem('app-settings', JSON.stringify(next));
    return next;
  });
}

/**
 * Invoke a Tauri command, then re-sync the proxy pool from the backend.
 * Falls back to localStorage via `fallbackFn` if the backend is unavailable.
 */
async function invokeAndSyncProxy<T>(
  cmd: string,
  args: Record<string, unknown>,
  fallbackFn: (proxy: ProxySettings) => ProxySettings,
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
): Promise<T> {
  try {
    const result = await invoke<T>(cmd, args);
    const pool = await invoke<BackendProxyPool>('get_proxy_pool');
    syncProxyFromBackend(setSettings, backendProxyPoolToFrontend(pool));
    return result;
  } catch (err) {
    console.warn(`Failed ${cmd} via Tauri, using localStorage fallback:`, err);
    persistProxyUpdate(setSettings, fallbackFn);
    throw err;
  }
}

/**
 * Invoke a Tauri command, then persist a local proxy update.
 * Used when the command does not return a pool to re-sync from.
 */
async function invokeAndPersistProxy(
  cmd: string,
  args: Record<string, unknown>,
  fallbackFn: (proxy: ProxySettings) => ProxySettings,
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
): Promise<void> {
  try {
    await invoke(cmd, args);
  } catch (err) {
    console.warn(`Failed ${cmd} via Tauri, using localStorage fallback:`, err);
  }
  persistProxyUpdate(setSettings, fallbackFn);
}

// ---------------------------------------------------------------------------
// Context type — mirrors the return type of the old useSettings() hook
// ---------------------------------------------------------------------------

export interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  addProxy: (proxy: ProxyConfig) => Promise<void>;
  updateProxy: (oldId: string, proxy: ProxyConfig) => Promise<void>;
  deleteProxy: (id: string) => Promise<boolean>;
  clearProxies: () => Promise<void>;
  updateProxyPoolConfig: (
    enabled?: boolean,
    rotationMode?: RotationMode
  ) => Promise<void>;
  assignDomainProxy: (domain: string, proxyId: string) => Promise<void>;
  unassignDomainProxy: (domain: string) => Promise<boolean>;
  getProxyStats: (proxyId: string) => ProxyStats;
  recordProxySuccess: (proxyId: string) => Promise<void>;
  recordProxyFailure: (proxyId: string) => Promise<void>;
  resetProxyStats: (proxyId: string) => Promise<void>;
  bypassProxyCooldown: (proxyId: string) => Promise<void>;
  setCooldownDuration: (durationSecs: number) => Promise<void>;
  reEnableProxy: (proxyId: string) => Promise<void>;
  setAutoDisableThreshold: (threshold: AutoDisableThreshold) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SettingsContext = createContext<SettingsContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider — holds the single shared state for the entire app
// ---------------------------------------------------------------------------

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const stored = localStorage.getItem('app-settings');
    if (stored) {
      try {
        return { ...defaultSettings, ...JSON.parse(stored) };
      } catch (e) {
        console.error('Failed to parse settings', e);
      }
    }
    return defaultSettings;
  });

  useEffect(() => {
    invoke<BackendSettings>('load_settings')
      .then((backend) => {
        const loaded = backendToFrontend(backend);
        setSettings((prev) => ({ ...prev, ...loaded }));
      })
      .catch((err) => {
        console.warn(
          'Failed to load settings from backend, using localStorage:',
          err
        );
      });

    // Load proxy pool and merge with settings to avoid race condition
    invoke<BackendProxyPool>('get_proxy_pool')
      .then((backendPool) => {
        const proxySettings = backendProxyPoolToFrontend(backendPool);
        setSettings((prev) => ({ ...prev, proxy: proxySettings }));
      })
      .catch((err) => {
        console.warn(
          'Failed to load proxy pool from backend, using localStorage fallback:',
          err
        );
        // Read proxy settings from app-settings localStorage key
        try {
          const stored = localStorage.getItem('app-settings');
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.proxy) {
              setSettings((prev) => ({ ...prev, proxy: parsed.proxy }));
            }
          }
        } catch (e) {
          console.error('Failed to parse proxy settings from app-settings:', e);
        }
      });
  }, []);

  // --- General settings ---------------------------------------------------

  const updateSettings = useCallback(
    async (newSettings: Partial<AppSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...newSettings };
        localStorage.setItem('app-settings', JSON.stringify(next));

        const backendSettings = frontendToBackend(next);
        invoke('save_settings', { settings: backendSettings }).catch((err) =>
          console.warn('Failed to save settings to backend:', err)
        );

        return next;
      });
    },
    []
  );

  // --- Proxy management ---------------------------------------------------

  const addProxy = useCallback(async (proxy: ProxyConfig): Promise<void> => {
    try {
      await invokeAndSyncProxy<void>('add_proxy', { proxy }, (currentProxy) => {
        const exists = currentProxy.proxies.some(
          (p) => getProxyId(p) === getProxyId(proxy)
        );
        if (!exists) {
          return { ...currentProxy, proxies: [...currentProxy.proxies, proxy] };
        }
        return currentProxy;
      }, setSettings);
    } catch {
      // Fallback already applied in invokeAndSyncProxy
    }
  }, []);

  const updateProxy = useCallback(
    async (oldId: string, proxy: ProxyConfig): Promise<void> => {
      try {
        await invokeAndSyncProxy<void>(
          'update_proxy',
          { oldId, proxy },
          (currentProxy) => ({
            ...currentProxy,
            proxies: currentProxy.proxies.map((p) =>
              getProxyId(p) === oldId ? proxy : p
            ),
          }),
          setSettings
        );
      } catch {
        // Fallback already applied in invokeAndSyncProxy
      }
    },
    []
  );

  const deleteProxy = useCallback(async (id: string): Promise<boolean> => {
    try {
      return await invokeAndSyncProxy<boolean>(
        'delete_proxy',
        { id },
        (currentProxy) => {
          const updated = {
            ...currentProxy,
            proxies: currentProxy.proxies.filter((p) => getProxyId(p) !== id),
            domainAssignments: Object.fromEntries(
              Object.entries(currentProxy.domainAssignments).filter(
                ([, proxyId]) => proxyId !== id
              )
            ),
          };
          return updated;
        },
        setSettings
      );
    } catch {
      // Fallback already applied, but we don't know if the proxy existed
      const stored = localStorage.getItem('app-settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.proxy?.proxies?.some((p: ProxyConfig) => getProxyId(p) === id) ?? false;
      }
      return false;
    }
  }, []);

  const clearProxies = useCallback(async (): Promise<void> => {
    const fallback = (): ProxySettings => ({
      ...defaultProxySettings,
      proxies: [],
      domainAssignments: {},
    });
    await invokeAndPersistProxy('clear_proxies', {}, fallback, setSettings);
  }, []);

  const updateProxyPoolConfig = useCallback(
    async (enabled?: boolean, rotationMode?: RotationMode): Promise<void> => {
      const fallback = (currentProxy: ProxySettings) => ({
        ...currentProxy,
        ...(enabled !== undefined && { enabled }),
        ...(rotationMode !== undefined && { rotationMode }),
      });
      await invokeAndPersistProxy('update_proxy_pool_config', { enabled, rotationMode }, fallback, setSettings);
    },
    []
  );

  const assignDomainProxy = useCallback(
    async (domain: string, proxyId: string): Promise<void> => {
      try {
        await invokeAndSyncProxy<void>(
          'assign_domain_proxy',
          { domain, proxyId },
          (currentProxy) => ({
            ...currentProxy,
            domainAssignments: {
              ...currentProxy.domainAssignments,
              [domain]: proxyId,
            },
          }),
          setSettings
        );
      } catch {
        // Fallback already applied
      }
    },
    []
  );

  const unassignDomainProxy = useCallback(
    async (domain: string): Promise<boolean> => {
      try {
        return await invokeAndSyncProxy<boolean>(
          'unassign_domain_proxy',
          { domain },
          (currentProxy) => ({
            ...currentProxy,
            domainAssignments: Object.fromEntries(
              Object.entries(currentProxy.domainAssignments).filter(
                ([d]) => d !== domain
              )
            ),
          }),
          setSettings
        );
      } catch {
        // Fallback applied, but we don't know if assignment existed
        const stored = localStorage.getItem('app-settings');
        if (stored) {
          const parsed = JSON.parse(stored);
          return domain in (parsed.proxy?.domainAssignments ?? {});
        }
        return false;
      }
    },
    []
  );

  // --- Proxy stats ---------------------------------------------------------

  const getProxyStats = useCallback(
    (proxyId: string): ProxyStats => {
      return (
        settings.proxy.proxyStats[proxyId] || {
          attempts: 0,
          successes: 0,
          failures: 0,
          consecutiveFailures: 0,
          cooldownUntil: null,
          avgDurationMs: 0,
          autoDisabled: false,
        }
      );
    },
    [settings.proxy.proxyStats]
  );

  const recordProxySuccess = useCallback(
    async (proxyId: string): Promise<void> => {
      try {
        await invokeAndSyncProxy<void>(
          'record_proxy_success',
          { proxyId },
          (currentProxy) => {
            const s = currentProxy.proxyStats[proxyId] || {
              attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0,
              cooldownUntil: null as number | null, avgDurationMs: 0, autoDisabled: false,
            };
            return {
              ...currentProxy,
              proxyStats: { ...currentProxy.proxyStats, [proxyId]: {
                ...s, attempts: s.attempts + 1, successes: s.successes + 1, consecutiveFailures: 0,
              }},
            };
          },
          setSettings
        );
      } catch { /* Fallback applied */ }
    },
    []
  );

  const recordProxyFailure = useCallback(
    async (proxyId: string): Promise<void> => {
      try {
        await invokeAndSyncProxy<void>(
          'record_proxy_failure',
          { proxyId },
          (currentProxy) => {
            const s = currentProxy.proxyStats[proxyId] || {
              attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0,
              cooldownUntil: null as number | null, avgDurationMs: 0, autoDisabled: false,
            };
            return {
              ...currentProxy,
              proxyStats: { ...currentProxy.proxyStats, [proxyId]: {
                ...s, attempts: s.attempts + 1, failures: s.failures + 1,
                consecutiveFailures: s.consecutiveFailures + 1,
              }},
            };
          },
          setSettings
        );
      } catch { /* Fallback applied */ }
    },
    []
  );

  const resetProxyStats = useCallback(
    async (proxyId: string): Promise<void> => {
      try {
        await invokeAndSyncProxy<void>(
          'reset_proxy_stats',
          { proxyId },
          (currentProxy) => ({
            ...currentProxy,
            proxyStats: { ...currentProxy.proxyStats, [proxyId]: {
              attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0,
              cooldownUntil: null, avgDurationMs: 0, autoDisabled: false,
            }},
          }),
          setSettings
        );
      } catch { /* Fallback applied */ }
    },
    []
  );

  const bypassProxyCooldown = useCallback(
    async (proxyId: string): Promise<void> => {
      try {
        await invokeAndSyncProxy<void>(
          'bypass_proxy_cooldown',
          { proxyId },
          (currentProxy) => {
            const s = currentProxy.proxyStats[proxyId] || {
              attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0,
              cooldownUntil: null as number | null, avgDurationMs: 0, autoDisabled: false,
            };
            return {
              ...currentProxy,
              proxyStats: { ...currentProxy.proxyStats, [proxyId]: {
                ...s, cooldownUntil: null, consecutiveFailures: 0,
              }},
            };
          },
          setSettings
        );
      } catch { /* Fallback applied */ }
    },
    []
  );

  const setCooldownDuration = useCallback(
    async (durationSecs: number): Promise<void> => {
      const clampedDuration = Math.max(30, Math.min(300, durationSecs));
      await invokeAndPersistProxy(
        'set_cooldown_duration',
        { durationSecs: clampedDuration },
        (currentProxy) => ({ ...currentProxy, cooldownDurationSecs: clampedDuration }),
        setSettings
      );
    },
    []
  );

  const reEnableProxy = useCallback(
    async (proxyId: string): Promise<void> => {
      try {
        await invokeAndSyncProxy<void>(
          're_enable_proxy',
          { proxyId },
          (currentProxy) => {
            const s = currentProxy.proxyStats[proxyId] || {
              attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0,
              cooldownUntil: null as number | null, avgDurationMs: 0, autoDisabled: false,
            };
            return {
              ...currentProxy,
              proxyStats: { ...currentProxy.proxyStats, [proxyId]: {
                ...s, autoDisabled: false, consecutiveFailures: 0, cooldownUntil: null,
              }},
            };
          },
          setSettings
        );
      } catch { /* Fallback applied */ }
    },
    []
  );

  const setAutoDisableThreshold = useCallback(
    async (threshold: AutoDisableThreshold): Promise<void> => {
      await invokeAndPersistProxy(
        'set_auto_disable_threshold',
        { threshold },
        (currentProxy) => ({ ...currentProxy, autoDisableThreshold: threshold }),
        setSettings
      );
    },
    []
  );

  // --- Context value -------------------------------------------------------

  const value: SettingsContextValue = {
    settings,
    updateSettings,
    addProxy,
    updateProxy,
    deleteProxy,
    clearProxies,
    updateProxyPoolConfig,
    assignDomainProxy,
    unassignDomainProxy,
    getProxyStats,
    recordProxySuccess,
    recordProxyFailure,
    resetProxyStats,
    bypassProxyCooldown,
    setCooldownDuration,
    reEnableProxy,
    setAutoDisableThreshold,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook — consumers call this instead of the old standalone hook
// ---------------------------------------------------------------------------

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
