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
  /** Auto-disabled proxies need a manual re-enable; waiting won't help. */
  autoDisabled?: boolean;
}

export interface AllProxiesFailedPayload {
  failedProxies: FailedProxyInfo[];
  proxyEnabled: boolean;
  totalProxies: number;
  badCount: number;
  cooldownCount: number;
  nearestCooldownSecs: number;
  /** Run that emitted the event (absent on older/test emitters). */
  runId?: number;
}

/** Every proxy is cooling down; the run is waiting in place, not paused. */
export interface WaitingForProxyPayload {
  proxyIds: string[];
  nearestCooldownSecs: number;
  runId: number;
}

/** Why a run ended before validating every email. */
export type RunStopReason = 'paused_no_proxy' | 'cancelled';

/** Return value of validate_emails_bulk / revalidate_emails_bulk. */
export interface RunOutcome {
  results: ValidationResult[];
  /** null when every email was validated; otherwise results are partial. */
  stopReason: RunStopReason | null;
}

/**
 * Normalize a run command's return value. Accepts the legacy bare-array
 * shape so mocks and older backends keep working.
 */
export function toRunOutcome(raw: unknown): RunOutcome {
  if (Array.isArray(raw)) {
    return { results: raw as ValidationResult[], stopReason: null };
  }
  const outcome = (raw ?? {}) as Partial<RunOutcome>;
  return {
    results: Array.isArray(outcome.results) ? outcome.results : [],
    stopReason: outcome.stopReason ?? null,
  };
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
