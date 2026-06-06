import type { ValidationResult } from './types';
import type { ValidationSession } from './session-manager';

export interface ChangedEntry {
  email: string;
  oldVerdict: ValidationResult['result'];
  newVerdict: ValidationResult['result'];
}

export interface SessionDiffStats {
  totalAdded: number;
  totalRemoved: number;
  totalChanged: number;
  unchanged: number;
}

export interface SessionDiff {
  added: ValidationResult[];
  removed: ValidationResult[];
  changed: ChangedEntry[];
  stats: SessionDiffStats;
  /** Counts of each verdict transition type, e.g. "Unknown → Safe": 3 */
  changeSummary: Record<string, number>;
}

/**
 * Compute the diff between two validation sessions.
 * Compares results keyed by email address to find added, removed, and changed entries.
 */
export function computeSessionDiff(
  sessionA: ValidationSession,
  sessionB: ValidationSession
): SessionDiff {
  const resultsA = new Map(sessionA.results.map((r) => [r.email, r]));
  const resultsB = new Map(sessionB.results.map((r) => [r.email, r]));

  const added: ValidationResult[] = [];
  const removed: ValidationResult[] = [];
  const changed: ChangedEntry[] = [];

  // Find added and changed
  for (const [email, resultB] of resultsB) {
    const resultA = resultsA.get(email);
    if (!resultA) {
      added.push(resultB);
    } else if (resultA.result !== resultB.result) {
      changed.push({
        email,
        oldVerdict: resultA.result,
        newVerdict: resultB.result,
      });
    }
  }

  // Find removed
  for (const [email, resultA] of resultsA) {
    if (!resultsB.has(email)) {
      removed.push(resultA);
    }
  }

  // Compute change summary
  const changeSummary: Record<string, number> = {};
  for (const entry of changed) {
    const key = `${entry.oldVerdict} → ${entry.newVerdict}`;
    changeSummary[key] = (changeSummary[key] || 0) + 1;
  }

  return {
    added,
    removed,
    changed,
    stats: {
      totalAdded: added.length,
      totalRemoved: removed.length,
      totalChanged: changed.length,
      unchanged: resultsA.size - removed.length - changed.length,
    },
    changeSummary,
  };
}

/**
 * Count results by verdict type.
 */
export function countByVerdict(
  results: ValidationResult[],
  verdict: ValidationResult['result']
): number {
  return results.filter((r) => r.result === verdict).length;
}
