import { invoke } from '@tauri-apps/api/core';
import {
  validateSession,
  validateSessionSummary,
  validateResultsBatch,
} from './data-validation';
import { showError } from './toast';
import { ValidationResult } from './types';

export interface ValidationSession {
  id: string;
  name: string;
  emails: string[];
  results: ValidationResult[];
  status: 'pending' | 'in-progress' | 'completed' | 'paused' | 'stopped';
  currentIndex: number;
  total: number;
  createdAt: string;
  completedAt?: string;
  settings: SessionSettings;
}

export interface SessionSettings {
  validationMode: 'quick' | 'standard' | 'thorough';
}

/** A session list row: metadata only, no emails or results (I10). */
export type SessionSummary = Omit<ValidationSession, 'emails' | 'results'>;

export async function createSession(
  emails: string[],
  settings: SessionSettings
): Promise<string> {
  return invoke('create_validation_session', { emails, settings });
}

/** Why a run halted; recorded on the session. Other statuses are derived by the backend. */
export type SessionHaltStatus = 'paused' | 'stopped';

/**
 * Saves progress. `results` is appended to the session's results file: pass
 * only new or changed results (see planSessionSave). With `replace`, it is
 * the full set and the file is rewritten instead.
 */
export async function updateSessionProgress(
  sessionId: string,
  results: ValidationResult[],
  currentIndex: number,
  status?: SessionHaltStatus,
  replace = false
): Promise<void> {
  // Validate results before updating
  const validation = validateResultsBatch(results);
  if (!validation.valid) {
    console.error('Invalid results detected during update:', validation.errors);
    throw new Error(`Data validation failed: ${validation.errors[0]}`);
  }

  // Backup is handled internally by the Rust update_validation_session command
  return invoke('update_validation_session', {
    id: sessionId,
    results,
    currentIndex,
    backup: true,
    ...(status ? { status } : {}),
    ...(replace ? { replace: true } : {}),
  });
}

/** Results last confirmed saved, by email. */
export type PersistedResults = Map<string, ValidationResult>;

export interface SessionSavePlan {
  results: ValidationResult[];
  replace: boolean;
}

/**
 * What a save must send, given what was last saved. Results are replaced
 * by email when retried, so this sends every result that is new or a
 * different object than the saved one. Unknown saved state (`null`) or a
 * deleted result needs a full rewrite: an append can't remove anything.
 */
export function planSessionSave(
  results: ValidationResult[],
  persisted: PersistedResults | null
): SessionSavePlan {
  if (!persisted) return { results, replace: true };
  const changed: ValidationResult[] = [];
  const stillPresent = new Set<string>();
  for (const result of results) {
    const saved = persisted.get(result.email);
    if (saved !== undefined) stillPresent.add(result.email);
    if (saved !== result) changed.push(result);
  }
  if (stillPresent.size < persisted.size) return { results, replace: true };
  return { results: changed, replace: false };
}

export function indexResultsByEmail(results: ValidationResult[]): PersistedResults {
  return new Map(results.map((r) => [r.email, r]));
}

export async function loadSession(
  sessionId: string
): Promise<ValidationSession> {
  const session = await invoke<ValidationSession>('load_validation_session', {
    id: sessionId,
  });

  // Validate session structure after loading
  const validation = validateSession(session);
  if (!validation.valid) {
    const errorMsg = `Loaded session "${sessionId}" is corrupted: ${validation.errors.join(', ')}`;
    showError(errorMsg);
    throw new Error(errorMsg);
  }

  return session;
}

/** Lists sessions as metadata only; load one with loadSession for its results. */
export async function listSessions(): Promise<SessionSummary[]> {
  const sessions = await invoke<SessionSummary[]>('list_validation_sessions');

  // Filter out invalid sessions from the list to prevent UI crashes
  return sessions.filter((session) => {
    const validation = validateSessionSummary(session);
    if (!validation.valid) {
      console.warn(
        `Skipping invalid session ${session.id}:`,
        validation.errors
      );
      return false;
    }
    return true;
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  return invoke('delete_validation_session', { id: sessionId });
}

export async function cleanupOldSessions(days: number = 90): Promise<number> {
  return invoke('cleanup_old_sessions', { days });
}
