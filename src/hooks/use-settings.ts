import { useState, useEffect } from 'react';

export interface AppSettings {
  validationMode: 'quick' | 'standard' | 'thorough';
  concurrency: number;
  timeout: number;
  maxRetries: number;
  autoSaveInterval: number;
  proxyEnabled: boolean;
  proxyRotation: 'on-failure' | 'per-email' | 'per-batch';
  maxEmailsPerProxy: number;
  protocolPreference: 'any' | 'http' | 'socks5';
  minProxyUptime: number;
  sessionRetentionDays: number;
}

export const defaultSettings: AppSettings = {
  validationMode: 'standard',
  concurrency: 5,
  timeout: 30,
  maxRetries: 3,
  autoSaveInterval: 10,
  proxyEnabled: false,
  proxyRotation: 'on-failure',
  maxEmailsPerProxy: 50,
  protocolPreference: 'any',
  minProxyUptime: 80,
  sessionRetentionDays: 90,
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('app-settings');
      if (stored) {
        try {
          return { ...defaultSettings, ...JSON.parse(stored) };
        } catch (e) {
          console.error("Failed to parse settings", e);
        }
      }
    }
    return defaultSettings;
  });

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...newSettings };
      localStorage.setItem('app-settings', JSON.stringify(next));
      return next;
    });
  };

  return { settings, updateSettings };
}
