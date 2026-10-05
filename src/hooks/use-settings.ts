// Types, constants, and utility functions are kept here.
// State management has been moved to settings-context.tsx (React Context/Provider).
export { useSettings, SettingsProvider } from './settings-context';
export type { SettingsContextValue } from './settings-context';

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
  /** Rolling average validation duration in milliseconds */
  avgDurationMs: number;
  /** Whether this proxy has been auto-disabled due to low success rate */
  autoDisabled: boolean;
}

/** Auto-disable threshold configuration */
export interface AutoDisableThreshold {
  /** Success rate percentage below which proxy is auto-disabled (default: 20) */
  successRatePercent: number;
  /** Minimum attempts before auto-disable kicks in (default: 10) */
  minAttempts: number;
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
  /** Auto-disable threshold configuration */
  autoDisableThreshold: AutoDisableThreshold;
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
  /** Rate limit: max emails per second (default 1) */
  rateLimitMaxPerSecond: number;
  /** Rate limit: max emails per minute (default 60) */
  rateLimitMaxPerMinute: number;
  /** Max emails per session (0 = unlimited, default 0) */
  maxEmailsPerSession: number;
  /** SMTP callout MAIL FROM ('' = built-in default) */
  fromEmail: string;
  /** SMTP callout HELO name ('' = built-in default) */
  helloName: string;
  /** Look up Gravatar profiles (direct, unproxied; default off) */
  checkGravatar: boolean;
}

/** Default proxy settings */
export const defaultProxySettings: ProxySettings = {
  proxies: [],
  enabled: false,
  rotationMode: 'manual',
  domainAssignments: {},
  proxyStats: {},
  cooldownDurationSecs: 60,
  autoDisableThreshold: {
    successRatePercent: 20,
    minAttempts: 10,
  },
};

export const defaultSettings: AppSettings = {
  validationMode: 'standard',
  concurrency: 5,
  timeout: 30,
  maxRetries: 1,
  autoSaveInterval: 10,
  sessionRetentionDays: 90,
  sidebarCollapsed: false,
  proxy: defaultProxySettings,
  rateLimitMaxPerSecond: 1,
  rateLimitMaxPerMinute: 60,
  maxEmailsPerSession: 0,
  fromEmail: '',
  helloName: '',
  checkGravatar: false,
};
