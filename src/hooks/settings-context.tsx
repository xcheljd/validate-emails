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
} from './use-settings';
import {
  defaultSettings,
  defaultProxySettings,
  getProxyId,
} from './use-settings';

// ---------------------------------------------------------------------------
// Internal helpers (previously module-private in use-settings.ts)
// ---------------------------------------------------------------------------

const PROXY_STORAGE_KEY = 'proxy-settings';

function getProxyFromStorage(): ProxySettings {
  try {
    const stored = localStorage.getItem(PROXY_STORAGE_KEY);
    if (stored) {
      return { ...defaultProxySettings, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to parse proxy settings from localStorage:', e);
  }
  return { ...defaultProxySettings };
}

function saveProxyToStorage(settings: ProxySettings): void {
  try {
    localStorage.setItem(PROXY_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save proxy settings to localStorage:', e);
  }
}

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
  rotation_mode: RotationMode;
  domain_assignments: Record<string, string>;
  proxy_stats?: Record<string, ProxyStats>;
  cooldown_duration_secs?: number;
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
    rotationMode: backend.rotation_mode,
    domainAssignments: backend.domain_assignments,
    proxyStats: backend.proxy_stats || {},
    cooldownDurationSecs: backend.cooldown_duration_secs ?? 60,
  };
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
        const proxySettings = getProxyFromStorage();
        setSettings((prev) => ({ ...prev, proxy: proxySettings }));
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
      await invoke('add_proxy', { proxy });
      const pool = await invoke<BackendProxyPool>('get_proxy_pool');
      const proxySettings = backendProxyPoolToFrontend(pool);
      setSettings((prev) => {
        const next = { ...prev, proxy: proxySettings };
        localStorage.setItem('app-settings', JSON.stringify(next));
        return next;
      });
    } catch (err) {
      console.warn(
        'Failed to add proxy via Tauri, using localStorage fallback:',
        err
      );
      const currentProxy = getProxyFromStorage();
      const exists = currentProxy.proxies.some(
        (p) => getProxyId(p) === getProxyId(proxy)
      );
      if (!exists) {
        const updated = {
          ...currentProxy,
          proxies: [...currentProxy.proxies, proxy],
        };
        saveProxyToStorage(updated);
        setSettings((prev) => ({ ...prev, proxy: updated }));
      }
    }
  }, []);

  const updateProxy = useCallback(
    async (oldId: string, proxy: ProxyConfig): Promise<void> => {
      try {
        await invoke('update_proxy', { oldId, proxy });
        const pool = await invoke<BackendProxyPool>('get_proxy_pool');
        const proxySettings = backendProxyPoolToFrontend(pool);
        setSettings((prev) => {
          const next = { ...prev, proxy: proxySettings };
          localStorage.setItem('app-settings', JSON.stringify(next));
          return next;
        });
      } catch (err) {
        console.warn(
          'Failed to update proxy via Tauri, using localStorage fallback:',
          err
        );
        const currentProxy = getProxyFromStorage();
        const updated = {
          ...currentProxy,
          proxies: currentProxy.proxies.map((p) =>
            getProxyId(p) === oldId ? proxy : p
          ),
        };
        saveProxyToStorage(updated);
        setSettings((prev) => ({ ...prev, proxy: updated }));
      }
    },
    []
  );

  const deleteProxy = useCallback(async (id: string): Promise<boolean> => {
    try {
      const result = await invoke<boolean>('delete_proxy', { id });
      if (result) {
        const pool = await invoke<BackendProxyPool>('get_proxy_pool');
        const proxySettings = backendProxyPoolToFrontend(pool);
        setSettings((prev) => {
          const next = { ...prev, proxy: proxySettings };
          localStorage.setItem('app-settings', JSON.stringify(next));
          return next;
        });
      }
      return result;
    } catch (err) {
      console.warn(
        'Failed to delete proxy via Tauri, using localStorage fallback:',
        err
      );
      const currentProxy = getProxyFromStorage();
      const initialLength = currentProxy.proxies.length;
      const updated = {
        ...currentProxy,
        proxies: currentProxy.proxies.filter((p) => getProxyId(p) !== id),
        domainAssignments: Object.fromEntries(
          Object.entries(currentProxy.domainAssignments).filter(
            ([_, proxyId]) => proxyId !== id
          )
        ),
      };
      saveProxyToStorage(updated);
      setSettings((prev) => ({ ...prev, proxy: updated }));
      return updated.proxies.length < initialLength;
    }
  }, []);

  const clearProxies = useCallback(async (): Promise<void> => {
    try {
      await invoke('clear_proxies');
      setSettings((prev) => {
        const next = {
          ...prev,
          proxy: { ...prev.proxy, proxies: [], domainAssignments: {} },
        };
        localStorage.setItem('app-settings', JSON.stringify(next));
        return next;
      });
    } catch (err) {
      console.warn(
        'Failed to clear proxies via Tauri, using localStorage fallback:',
        err
      );
      const updated: ProxySettings = {
        ...defaultProxySettings,
        proxies: [],
        domainAssignments: {},
      };
      saveProxyToStorage(updated);
      setSettings((prev) => ({ ...prev, proxy: updated }));
    }
  }, []);

  const updateProxyPoolConfig = useCallback(
    async (enabled?: boolean, rotationMode?: RotationMode): Promise<void> => {
      try {
        await invoke('update_proxy_pool_config', { enabled, rotationMode });
        setSettings((prev) => {
          const updated = {
            ...prev,
            proxy: {
              ...prev.proxy,
              ...(enabled !== undefined && { enabled }),
              ...(rotationMode !== undefined && { rotationMode }),
            },
          };
          localStorage.setItem('app-settings', JSON.stringify(updated));
          return updated;
        });
      } catch (err) {
        console.warn(
          'Failed to update proxy pool config via Tauri, using localStorage fallback:',
          err
        );
        const currentProxy = getProxyFromStorage();
        const updated: ProxySettings = {
          ...currentProxy,
          ...(enabled !== undefined && { enabled }),
          ...(rotationMode !== undefined && { rotationMode }),
        };
        saveProxyToStorage(updated);
        setSettings((prev) => ({ ...prev, proxy: updated }));
      }
    },
    []
  );

  const assignDomainProxy = useCallback(
    async (domain: string, proxyId: string): Promise<void> => {
      try {
        await invoke('assign_domain_proxy', { domain, proxyId });
        const pool = await invoke<BackendProxyPool>('get_proxy_pool');
        const proxySettings = backendProxyPoolToFrontend(pool);
        setSettings((prev) => {
          const next = { ...prev, proxy: proxySettings };
          localStorage.setItem('app-settings', JSON.stringify(next));
          return next;
        });
      } catch (err) {
        console.warn(
          'Failed to assign domain proxy via Tauri, using localStorage fallback:',
          err
        );
        const currentProxy = getProxyFromStorage();
        const updated: ProxySettings = {
          ...currentProxy,
          domainAssignments: {
            ...currentProxy.domainAssignments,
            [domain]: proxyId,
          },
        };
        saveProxyToStorage(updated);
        setSettings((prev) => ({ ...prev, proxy: updated }));
      }
    },
    []
  );

  const unassignDomainProxy = useCallback(
    async (domain: string): Promise<boolean> => {
      try {
        const result = await invoke<boolean>('unassign_domain_proxy', {
          domain,
        });
        if (result) {
          const pool = await invoke<BackendProxyPool>('get_proxy_pool');
          const proxySettings = backendProxyPoolToFrontend(pool);
          setSettings((prev) => {
            const next = { ...prev, proxy: proxySettings };
            localStorage.setItem('app-settings', JSON.stringify(next));
            return next;
          });
        }
        return result;
      } catch (err) {
        console.warn(
          'Failed to unassign domain proxy via Tauri, using localStorage fallback:',
          err
        );
        const currentProxy = getProxyFromStorage();
        const hadAssignment = domain in currentProxy.domainAssignments;
        const updated: ProxySettings = {
          ...currentProxy,
          domainAssignments: Object.fromEntries(
            Object.entries(currentProxy.domainAssignments).filter(
              ([d]) => d !== domain
            )
          ),
        };
        saveProxyToStorage(updated);
        setSettings((prev) => ({ ...prev, proxy: updated }));
        return hadAssignment;
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
        }
      );
    },
    [settings.proxy.proxyStats]
  );

  const recordProxySuccess = useCallback(
    async (proxyId: string): Promise<void> => {
      try {
        await invoke('record_proxy_success', { proxyId });
        const pool = await invoke<BackendProxyPool>('get_proxy_pool');
        const proxySettings = backendProxyPoolToFrontend(pool);
        setSettings((prev) => ({ ...prev, proxy: proxySettings }));
      } catch (err) {
        console.warn(
          'Failed to record proxy success via Tauri, using localStorage fallback:',
          err
        );
        const currentProxy = getProxyFromStorage();
        const currentStats = currentProxy.proxyStats[proxyId] || {
          attempts: 0,
          successes: 0,
          failures: 0,
          consecutiveFailures: 0,
        };
        const updatedStats: ProxyStats = {
          ...currentStats,
          attempts: currentStats.attempts + 1,
          successes: currentStats.successes + 1,
          consecutiveFailures: 0,
        };
        const updated: ProxySettings = {
          ...currentProxy,
          proxyStats: { ...currentProxy.proxyStats, [proxyId]: updatedStats },
        };
        saveProxyToStorage(updated);
        setSettings((prev) => ({ ...prev, proxy: updated }));
      }
    },
    []
  );

  const recordProxyFailure = useCallback(
    async (proxyId: string): Promise<void> => {
      try {
        await invoke('record_proxy_failure', { proxyId });
        const pool = await invoke<BackendProxyPool>('get_proxy_pool');
        const proxySettings = backendProxyPoolToFrontend(pool);
        setSettings((prev) => ({ ...prev, proxy: proxySettings }));
      } catch (err) {
        console.warn(
          'Failed to record proxy failure via Tauri, using localStorage fallback:',
          err
        );
        const currentProxy = getProxyFromStorage();
        const currentStats = currentProxy.proxyStats[proxyId] || {
          attempts: 0,
          successes: 0,
          failures: 0,
          consecutiveFailures: 0,
        };
        const updatedStats: ProxyStats = {
          ...currentStats,
          attempts: currentStats.attempts + 1,
          failures: currentStats.failures + 1,
          consecutiveFailures: currentStats.consecutiveFailures + 1,
        };
        const updated: ProxySettings = {
          ...currentProxy,
          proxyStats: { ...currentProxy.proxyStats, [proxyId]: updatedStats },
        };
        saveProxyToStorage(updated);
        setSettings((prev) => ({ ...prev, proxy: updated }));
      }
    },
    []
  );

  const resetProxyStats = useCallback(
    async (proxyId: string): Promise<void> => {
      try {
        await invoke('reset_proxy_stats', { proxyId });
        const pool = await invoke<BackendProxyPool>('get_proxy_pool');
        const proxySettings = backendProxyPoolToFrontend(pool);
        setSettings((prev) => ({ ...prev, proxy: proxySettings }));
      } catch (err) {
        console.warn(
          'Failed to reset proxy stats via Tauri, using localStorage fallback:',
          err
        );
        const currentProxy = getProxyFromStorage();
        const updated: ProxySettings = {
          ...currentProxy,
          proxyStats: {
            ...currentProxy.proxyStats,
            [proxyId]: {
              attempts: 0,
              successes: 0,
              failures: 0,
              consecutiveFailures: 0,
              cooldownUntil: null,
            },
          },
        };
        saveProxyToStorage(updated);
        setSettings((prev) => ({ ...prev, proxy: updated }));
      }
    },
    []
  );

  const bypassProxyCooldown = useCallback(
    async (proxyId: string): Promise<void> => {
      try {
        await invoke('bypass_proxy_cooldown', { proxyId });
        const pool = await invoke<BackendProxyPool>('get_proxy_pool');
        const proxySettings = backendProxyPoolToFrontend(pool);
        setSettings((prev) => ({ ...prev, proxy: proxySettings }));
      } catch (err) {
        console.warn(
          'Failed to bypass cooldown via Tauri, using localStorage fallback:',
          err
        );
        const currentProxy = getProxyFromStorage();
        const currentStats = currentProxy.proxyStats[proxyId] || {
          attempts: 0,
          successes: 0,
          failures: 0,
          consecutiveFailures: 0,
          cooldownUntil: null,
        };
        const updated: ProxySettings = {
          ...currentProxy,
          proxyStats: {
            ...currentProxy.proxyStats,
            [proxyId]: {
              ...currentStats,
              cooldownUntil: null,
              consecutiveFailures: 0,
            },
          },
        };
        saveProxyToStorage(updated);
        setSettings((prev) => ({ ...prev, proxy: updated }));
      }
    },
    []
  );

  const setCooldownDuration = useCallback(
    async (durationSecs: number): Promise<void> => {
      const clampedDuration = Math.max(30, Math.min(300, durationSecs));
      try {
        await invoke('set_cooldown_duration', {
          durationSecs: clampedDuration,
        });
        setSettings((prev) => ({
          ...prev,
          proxy: { ...prev.proxy, cooldownDurationSecs: clampedDuration },
        }));
      } catch (err) {
        console.warn(
          'Failed to set cooldown duration via Tauri, using localStorage fallback:',
          err
        );
        const currentProxy = getProxyFromStorage();
        const updated: ProxySettings = {
          ...currentProxy,
          cooldownDurationSecs: clampedDuration,
        };
        saveProxyToStorage(updated);
        setSettings((prev) => ({ ...prev, proxy: updated }));
      }
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
