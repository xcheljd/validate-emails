import type { ValidationResult } from '@/lib/types';

export type ValidationStatus =
  | 'idle'
  | 'processing'
  | 'paused'
  | 'stopping'
  | 'waiting';

export type ValidationMode = 'quick' | 'standard' | 'thorough';

export interface FailedProxyInfo {
  id: string;
  isBad: boolean;
  remainingCooldownSecs: number;
  consecutiveFailures: number;
  successRate: number;
}

export interface AllProxiesFailedPayload {
  failedProxies: FailedProxyInfo[];
  proxyEnabled: boolean;
  totalProxies: number;
  badCount: number;
  cooldownCount: number;
  nearestCooldownSecs: number;
}

/** Rate limit status for consecutive failure tracking */
export interface RateLimitFailureState {
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Whether slowdown is active (>=SLOWDOWN_THRESHOLD consecutive failures) */
  isSlowdownActive: boolean;
  /** Whether auto-pause has been triggered (>=AUTO_PAUSE_THRESHOLD consecutive failures) */
  isAutoPaused: boolean;
}

/** Shape of the test-helper "get state" return value */
export interface ValidationStateForTest {
  results: ValidationResult[];
  status: ValidationStatus;
  progress: number;
  total: number;
  validationMode: ValidationMode;
  isEscalating: boolean;
  escalationTier: number;
  escalationEmailCount: number;
  rateLimitFailureState: RateLimitFailureState;
}

export const SLOWDOWN_THRESHOLD = 3;
export const AUTO_PAUSE_THRESHOLD = 8;
