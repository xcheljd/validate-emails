import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

/** Rotation mode for proxy selection */
export type RotationMode = 'manual' | 'automatic' | 'perDomain';

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

    // Load proxy pool from backend
    invoke<BackendProxyPool>('get_proxy_pool')
      .then(backendPool => {
        const proxySettings = backendProxyPoolToFrontend(backendPool);
        setSettings(prev => ({ ...prev, proxy: proxySettings }));
      })
      .catch(err => {
        console.warn('Failed to load proxy pool from backend:', err);
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
    await invoke('add_proxy', { proxy });
    // Refresh proxy list from backend
    const pool = await invoke<BackendProxyPool>('get_proxy_pool');
    const proxySettings = backendProxyPoolToFrontend(pool);
    setSettings(prev => ({ ...prev, proxy: proxySettings }));
    localStorage.setItem('app-settings', JSON.stringify({ ...settings, proxy: proxySettings }));
  }, [settings]);

  const updateProxy = useCallback(async (oldId: string, proxy: ProxyConfig): Promise<void> => {
    await invoke('update_proxy', { oldId, proxy });
    // Refresh proxy list from backend
    const pool = await invoke<BackendProxyPool>('get_proxy_pool');
    const proxySettings = backendProxyPoolToFrontend(pool);
    setSettings(prev => ({ ...prev, proxy: proxySettings }));
    localStorage.setItem('app-settings', JSON.stringify({ ...settings, proxy: proxySettings }));
  }, [settings]);

  const deleteProxy = useCallback(async (id: string): Promise<boolean> => {
    const result = await invoke<boolean>('delete_proxy', { id });
    if (result) {
      // Refresh proxy list from backend
      const pool = await invoke<BackendProxyPool>('get_proxy_pool');
      const proxySettings = backendProxyPoolToFrontend(pool);
      setSettings(prev => ({ ...prev, proxy: proxySettings }));
      localStorage.setItem('app-settings', JSON.stringify({ ...settings, proxy: proxySettings }));
    }
    return result;
  }, [settings]);

  const clearProxies = useCallback(async (): Promise<void> => {
    await invoke('clear_proxies');
    setSettings(prev => ({
      ...prev,
      proxy: { ...prev.proxy, proxies: [], domainAssignments: {} }
    }));
    localStorage.setItem('app-settings', JSON.stringify({
      ...settings,
      proxy: { ...settings.proxy, proxies: [], domainAssignments: {} }
    }));
  }, [settings]);

  const updateProxyPoolConfig = useCallback(async (
    enabled?: boolean,
    rotationMode?: RotationMode
  ): Promise<void> => {
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
  }, []);

  const assignDomainProxy = useCallback(async (domain: string, proxyId: string): Promise<void> => {
    await invoke('assign_domain_proxy', { domain, proxyId });
    const pool = await invoke<BackendProxyPool>('get_proxy_pool');
    const proxySettings = backendProxyPoolToFrontend(pool);
    setSettings(prev => ({ ...prev, proxy: proxySettings }));
    localStorage.setItem('app-settings', JSON.stringify({ ...settings, proxy: proxySettings }));
  }, [settings]);

  const unassignDomainProxy = useCallback(async (domain: string): Promise<boolean> => {
    const result = await invoke<boolean>('unassign_domain_proxy', { domain });
    if (result) {
      const pool = await invoke<BackendProxyPool>('get_proxy_pool');
      const proxySettings = backendProxyPoolToFrontend(pool);
      setSettings(prev => ({ ...prev, proxy: proxySettings }));
      localStorage.setItem('app-settings', JSON.stringify({ ...settings, proxy: proxySettings }));
    }
    return result;
  }, [settings]);

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
  };
}