import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

/** LocalStorage key for proxy settings fallback */
const PROXY_STORAGE_KEY = 'proxy-settings';

/** Get proxy settings from localStorage */
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

/** Save proxy settings to localStorage */
function saveProxyToStorage(settings: ProxySettings): void {
  try {
    localStorage.setItem(PROXY_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save proxy settings to localStorage:', e);
  }
}

/** Generate unique ID for a proxy */
export function getProxyId(proxy: ProxyConfig): string {
  return `${proxy.host}:${proxy.port}`;
}

/** Calculate success rate percentage (0-100) */
export function calculateSuccessRate(stats: ProxyStats): number {
  if (stats.attempts === 0) {
    return 100; // New proxies start with neutral/healthy status
  }
  return Math.round((stats.successes / stats.attempts) * 100);
}

/** Get health status based on success rate */
export function getHealthStatus(stats: ProxyStats): HealthStatus {
  const rate = calculateSuccessRate(stats);
  if (rate >= 90) {
    return 'healthy';
  } else if (rate >= 50) {
    return 'degraded';
  }
  return 'failed';
}

/** Check if proxy is "bad" (3 consecutive failures) */
export function isProxyBad(stats: ProxyStats): boolean {
  return stats.consecutiveFailures >= 3;
}

/** Check if proxy is currently in cooldown */
export function isProxyInCooldown(stats: ProxyStats): boolean {
  if (stats.cooldownUntil === null) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  return now < stats.cooldownUntil;
}

/** Get remaining cooldown time in seconds. Returns 0 if not in cooldown. */
export function getRemainingCooldown(stats: ProxyStats): number {
  if (stats.cooldownUntil === null) {
    return 0;
  }
  const now = Math.floor(Date.now() / 1000);
  const remaining = stats.cooldownUntil - now;
  return remaining > 0 ? remaining : 0;
}

/** Format remaining cooldown as "Xs" or "Xm Ys" */
export function formatCooldown(remainingSecs: number): string {
  if (remainingSecs <= 0) {
    return '';
  }
  const minutes = Math.floor(remainingSecs / 60);
  const seconds = remainingSecs % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/** Rotation mode for proxy selection */
export type RotationMode = 'manual' | 'automatic' | 'perDomain';

/** Health status of a proxy */
export type HealthStatus = 'healthy' | 'degraded' | 'failed';

/** Statistics for a single proxy */
export interface ProxyStats {
  /** Total number of validation attempts */
  attempts: number;
  /** Number of successful validations */
  successes: number;
  /** Number of failed validations */
  failures: number;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Timestamp (Unix epoch seconds) when cooldown ends. null if not in cooldown. */
  cooldownUntil: number | null;
}

/** Configuration for a single SOCKS5 proxy */
export interface ProxyConfig {
  /** Proxy host (IP address or hostname) */
  host: string;
  /** Proxy port (1-65535) */
  port: number;
  /** Optional username for authentication */
  username?: string;
  /** Optional password for authentication */
  password?: string;
}

/** Proxy settings for the application */
export interface ProxySettings {
  /** List of configured proxies */
  proxies: ProxyConfig[];
  /** Whether proxy support is enabled */
  enabled: boolean;
  /** Current rotation mode */
  rotationMode: RotationMode;
  /** Per-domain proxy assignments (domain -> proxy host:port) */
  domainAssignments: Record<string, string>;
  /** Statistics per proxy (proxy ID -> stats) */
  proxyStats: Record<string, ProxyStats>;
  /** Cooldown duration in seconds when proxy fails (default: 60, range: 30-300) */
  cooldownDurationSecs: number;
}

export interface AppSettings {
  validationMode: 'quick' | 'standard' | 'thorough';
  concurrency: number;
  timeout: number;
  maxRetries: number;
  autoSaveInterval: number;
  sessionRetentionDays: number;
  sidebarCollapsed: boolean;
  proxy: ProxySettings;
}

/** Default proxy settings */
export const defaultProxySettings: ProxySettings = {
  proxies: [],
  enabled: false,
  rotationMode: 'manual',
  domainAssignments: {},
  proxyStats: {},
  cooldownDurationSecs: 60,
};

interface BackendSettings {
  validation_mode: string;
  concurrency: number;
  timeout_ms: number;
  max_retries: number;
  auto_save_interval: number;
  history_retention_days: number;
}

interface BackendProxyPool {
  proxies: ProxyConfig[];
  enabled: boolean;
  rotation_mode: RotationMode;
  domain_assignments: Record<string, string>;
  proxy_stats?: Record<string, ProxyStats>;
  cooldown_duration_secs?: number;
}

export const defaultSettings: AppSettings = {
  validationMode: 'standard',
  concurrency: 5,
  timeout: 30,
  maxRetries: 3,
  autoSaveInterval: 10,
  sessionRetentionDays: 90,
  sidebarCollapsed: false,
  proxy: defaultProxySettings,
};

function backendToFrontend(backend: BackendSettings): Partial<AppSettings> {
  return {
    validationMode: backend.validation_mode as AppSettings['validationMode'],
    concurrency: backend.concurrency,
    timeout: Math.round(backend.timeout_ms / 1000),
    maxRetries: backend.max_retries,
    autoSaveInterval: backend.auto_save_interval,
    sessionRetentionDays: backend.history_retention_days,
    sidebarCollapsed: false,
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

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const stored = localStorage.getItem('app-settings');
    if (stored) {
      try {
        return { ...defaultSettings, ...JSON.parse(stored) };
      } catch (e) {
        console.error("Failed to parse settings", e);
      }
    }
    return defaultSettings;
  });

  useEffect(() => {
    invoke<BackendSettings>('load_settings')
      .then(backend => {
        const loaded = backendToFrontend(backend);
        setSettings(prev => ({ ...prev, ...loaded }));
      })
      .catch(err => {
        console.warn('Failed to load settings from backend, using localStorage:', err);
      });

    // Load proxy pool from backend, with localStorage fallback
    invoke<BackendProxyPool>('get_proxy_pool')
      .then(backendPool => {
        const proxySettings = backendProxyPoolToFrontend(backendPool);
        setSettings(prev => ({ ...prev, proxy: proxySettings }));
      })
      .catch(err => {
        console.warn('Failed to load proxy pool from backend, using localStorage fallback:', err);
        // Fallback to localStorage when Tauri IPC is not available (browser testing context)
        const proxySettings = getProxyFromStorage();
        setSettings(prev => ({ ...prev, proxy: proxySettings }));
      });
  }, []);

  const updateSettings = async (newSettings: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...newSettings };
      localStorage.setItem('app-settings', JSON.stringify(next));

      const backendSettings = frontendToBackend(next);
      invoke('save_settings', { settings: backendSettings })
        .catch(err => console.warn('Failed to save settings to backend:', err));

      return next;
    });
  };

  // Proxy management functions
  const addProxy = useCallback(async (proxy: ProxyConfig): Promise<void> => {
    try {
      await invoke('add_proxy', { proxy });
      // Refresh proxy list from backend
      const pool = await invoke<BackendProxyPool>('get_proxy_pool');
      const proxySettings = backendProxyPoolToFrontend(pool);
      setSettings(prev => ({ ...prev, proxy: proxySettings }));
      localStorage.setItem('app-settings', JSON.stringify({ ...settings, proxy: proxySettings }));
    } catch (err) {
      // Fallback to localStorage when Tauri IPC is not available (browser testing context)
      console.warn('Failed to add proxy via Tauri, using localStorage fallback:', err);
      const currentProxy = getProxyFromStorage();
      // Check for duplicates
      const exists = currentProxy.proxies.some(p => getProxyId(p) === getProxyId(proxy));
      if (!exists) {
        const updated = {
          ...currentProxy,
          proxies: [...currentProxy.proxies, proxy]
        };
        saveProxyToStorage(updated);
        setSettings(prev => ({ ...prev, proxy: updated }));
      }
    }
  }, [settings]);

  const updateProxy = useCallback(async (oldId: string, proxy: ProxyConfig): Promise<void> => {
    try {
      await invoke('update_proxy', { oldId, proxy });
      // Refresh proxy list from backend
      const pool = await invoke<BackendProxyPool>('get_proxy_pool');
      const proxySettings = backendProxyPoolToFrontend(pool);
      setSettings(prev => ({ ...prev, proxy: proxySettings }));
      localStorage.setItem('app-settings', JSON.stringify({ ...settings, proxy: proxySettings }));
    } catch (err) {
      // Fallback to localStorage when Tauri IPC is not available (browser testing context)
      console.warn('Failed to update proxy via Tauri, using localStorage fallback:', err);
      const currentProxy = getProxyFromStorage();
      const updated = {
        ...currentProxy,
        proxies: currentProxy.proxies.map(p =>
          getProxyId(p) === oldId ? proxy : p
        )
      };
      saveProxyToStorage(updated);
      setSettings(prev => ({ ...prev, proxy: updated }));
    }
  }, [settings]);

  const deleteProxy = useCallback(async (id: string): Promise<boolean> => {
    try {
      const result = await invoke<boolean>('delete_proxy', { id });
      if (result) {
        // Refresh proxy list from backend
        const pool = await invoke<BackendProxyPool>('get_proxy_pool');
        const proxySettings = backendProxyPoolToFrontend(pool);
        setSettings(prev => ({ ...prev, proxy: proxySettings }));
        localStorage.setItem('app-settings', JSON.stringify({ ...settings, proxy: proxySettings }));
      }
      return result;
    } catch (err) {
      // Fallback to localStorage when Tauri IPC is not available (browser testing context)
      console.warn('Failed to delete proxy via Tauri, using localStorage fallback:', err);
      const currentProxy = getProxyFromStorage();
      const initialLength = currentProxy.proxies.length;
      const updated = {
        ...currentProxy,
        proxies: currentProxy.proxies.filter(p => getProxyId(p) !== id),
        // Also remove from domain assignments if present
        domainAssignments: Object.fromEntries(
          Object.entries(currentProxy.domainAssignments).filter(([_, proxyId]) => proxyId !== id)
        )
      };
      saveProxyToStorage(updated);
      setSettings(prev => ({ ...prev, proxy: updated }));
      return updated.proxies.length < initialLength;
    }
  }, [settings]);

  const clearProxies = useCallback(async (): Promise<void> => {
    try {
      await invoke('clear_proxies');
      setSettings(prev => ({
        ...prev,
        proxy: { ...prev.proxy, proxies: [], domainAssignments: {} }
      }));
      localStorage.setItem('app-settings', JSON.stringify({
        ...settings,
        proxy: { ...settings.proxy, proxies: [], domainAssignments: {} }
      }));
    } catch (err) {
      // Fallback to localStorage when Tauri IPC is not available (browser testing context)
      console.warn('Failed to clear proxies via Tauri, using localStorage fallback:', err);
      const updated: ProxySettings = {
        ...defaultProxySettings,
        proxies: [],
        domainAssignments: {}
      };
      saveProxyToStorage(updated);
      setSettings(prev => ({ ...prev, proxy: updated }));
    }
  }, [settings]);

  const updateProxyPoolConfig = useCallback(async (
    enabled?: boolean,
    rotationMode?: RotationMode
  ): Promise<void> => {
    try {
      await invoke('update_proxy_pool_config', { enabled, rotationMode });
      setSettings(prev => {
        const updated = {
          ...prev,
          proxy: {
            ...prev.proxy,
            ...(enabled !== undefined && { enabled }),
            ...(rotationMode !== undefined && { rotationMode })
          }
        };
        localStorage.setItem('app-settings', JSON.stringify(updated));
        return updated;
      });
    } catch (err) {
      // Fallback to localStorage when Tauri IPC is not available (browser testing context)
      console.warn('Failed to update proxy pool config via Tauri, using localStorage fallback:', err);
      const currentProxy = getProxyFromStorage();
      const updated: ProxySettings = {
        ...currentProxy,
        ...(enabled !== undefined && { enabled }),
        ...(rotationMode !== undefined && { rotationMode })
      };
      saveProxyToStorage(updated);
      setSettings(prev => ({ ...prev, proxy: updated }));
    }
  }, []);

  const assignDomainProxy = useCallback(async (domain: string, proxyId: string): Promise<void> => {
    try {
      await invoke('assign_domain_proxy', { domain, proxyId });
      const pool = await invoke<BackendProxyPool>('get_proxy_pool');
      const proxySettings = backendProxyPoolToFrontend(pool);
      setSettings(prev => ({ ...prev, proxy: proxySettings }));
      localStorage.setItem('app-settings', JSON.stringify({ ...settings, proxy: proxySettings }));
    } catch (err) {
      // Fallback to localStorage when Tauri IPC is not available (browser testing context)
      console.warn('Failed to assign domain proxy via Tauri, using localStorage fallback:', err);
      const currentProxy = getProxyFromStorage();
      const updated: ProxySettings = {
        ...currentProxy,
        domainAssignments: {
          ...currentProxy.domainAssignments,
          [domain]: proxyId
        }
      };
      saveProxyToStorage(updated);
      setSettings(prev => ({ ...prev, proxy: updated }));
    }
  }, [settings]);

  const unassignDomainProxy = useCallback(async (domain: string): Promise<boolean> => {
    try {
      const result = await invoke<boolean>('unassign_domain_proxy', { domain });
      if (result) {
        const pool = await invoke<BackendProxyPool>('get_proxy_pool');
        const proxySettings = backendProxyPoolToFrontend(pool);
        setSettings(prev => ({ ...prev, proxy: proxySettings }));
        localStorage.setItem('app-settings', JSON.stringify({ ...settings, proxy: proxySettings }));
      }
      return result;
    } catch (err) {
      // Fallback to localStorage when Tauri IPC is not available (browser testing context)
      console.warn('Failed to unassign domain proxy via Tauri, using localStorage fallback:', err);
      const currentProxy = getProxyFromStorage();
      const hadAssignment = domain in currentProxy.domainAssignments;
      const updated: ProxySettings = {
        ...currentProxy,
        domainAssignments: Object.fromEntries(
          Object.entries(currentProxy.domainAssignments).filter(([d]) => d !== domain)
        )
      };
      saveProxyToStorage(updated);
      setSettings(prev => ({ ...prev, proxy: updated }));
      return hadAssignment;
    }
  }, [settings]);

  // Get stats for a specific proxy
  const getProxyStats = useCallback((proxyId: string): ProxyStats => {
    return settings.proxy.proxyStats[proxyId] || {
      attempts: 0,
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      cooldownUntil: null,
    };
  }, [settings.proxy.proxyStats]);

  // Record a successful validation for a proxy
  const recordProxySuccess = useCallback(async (proxyId: string): Promise<void> => {
    try {
      await invoke('record_proxy_success', { proxyId });
      // Refresh proxy pool to get updated stats
      const pool = await invoke<BackendProxyPool>('get_proxy_pool');
      const proxySettings = backendProxyPoolToFrontend(pool);
      setSettings(prev => ({ ...prev, proxy: proxySettings }));
    } catch (err) {
      // Fallback to localStorage when Tauri IPC is not available
      console.warn('Failed to record proxy success via Tauri, using localStorage fallback:', err);
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
        proxyStats: {
          ...currentProxy.proxyStats,
          [proxyId]: updatedStats,
        },
      };
      saveProxyToStorage(updated);
      setSettings(prev => ({ ...prev, proxy: updated }));
    }
  }, []);

  // Record a failed validation for a proxy
  const recordProxyFailure = useCallback(async (proxyId: string): Promise<void> => {
    try {
      await invoke('record_proxy_failure', { proxyId });
      // Refresh proxy pool to get updated stats
      const pool = await invoke<BackendProxyPool>('get_proxy_pool');
      const proxySettings = backendProxyPoolToFrontend(pool);
      setSettings(prev => ({ ...prev, proxy: proxySettings }));
    } catch (err) {
      // Fallback to localStorage when Tauri IPC is not available
      console.warn('Failed to record proxy failure via Tauri, using localStorage fallback:', err);
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
        proxyStats: {
          ...currentProxy.proxyStats,
          [proxyId]: updatedStats,
        },
      };
      saveProxyToStorage(updated);
      setSettings(prev => ({ ...prev, proxy: updated }));
    }
  }, []);

  // Reset stats for a specific proxy
  const resetProxyStats = useCallback(async (proxyId: string): Promise<void> => {
    try {
      await invoke('reset_proxy_stats', { proxyId });
      // Refresh proxy pool to get updated stats
      const pool = await invoke<BackendProxyPool>('get_proxy_pool');
      const proxySettings = backendProxyPoolToFrontend(pool);
      setSettings(prev => ({ ...prev, proxy: proxySettings }));
    } catch (err) {
      // Fallback to localStorage when Tauri IPC is not available
      console.warn('Failed to reset proxy stats via Tauri, using localStorage fallback:', err);
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
      setSettings(prev => ({ ...prev, proxy: updated }));
    }
  }, []);

  // Bypass cooldown for a proxy (Retry Now button)
  const bypassProxyCooldown = useCallback(async (proxyId: string): Promise<void> => {
    try {
      await invoke('bypass_proxy_cooldown', { proxyId });
      // Refresh proxy pool to get updated stats
      const pool = await invoke<BackendProxyPool>('get_proxy_pool');
      const proxySettings = backendProxyPoolToFrontend(pool);
      setSettings(prev => ({ ...prev, proxy: proxySettings }));
    } catch (err) {
      // Fallback to localStorage when Tauri IPC is not available
      console.warn('Failed to bypass cooldown via Tauri, using localStorage fallback:', err);
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
            consecutiveFailures: 0,  // Reset consecutive failures too
          },
        },
      };
      saveProxyToStorage(updated);
      setSettings(prev => ({ ...prev, proxy: updated }));
    }
  }, []);

  // Set cooldown duration (30-300 seconds)
  const setCooldownDuration = useCallback(async (durationSecs: number): Promise<void> => {
    const clampedDuration = Math.max(30, Math.min(300, durationSecs));
    try {
      await invoke('set_cooldown_duration', { durationSecs: clampedDuration });
      setSettings(prev => ({
        ...prev,
        proxy: { ...prev.proxy, cooldownDurationSecs: clampedDuration }
      }));
    } catch (err) {
      // Fallback to localStorage when Tauri IPC is not available
      console.warn('Failed to set cooldown duration via Tauri, using localStorage fallback:', err);
      const currentProxy = getProxyFromStorage();
      const updated: ProxySettings = {
        ...currentProxy,
        cooldownDurationSecs: clampedDuration,
      };
      saveProxyToStorage(updated);
      setSettings(prev => ({ ...prev, proxy: updated }));
    }
  }, []);

  return {
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
}