import { invoke } from '@tauri-apps/api/core';
import { validateSession, validateResultsBatch } from './data-validation';
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

export async function createSession(
  emails: string[],
  settings: SessionSettings
): Promise<string> {
  return invoke('create_validation_session', { emails, settings });
}

/** Why a run halted; recorded on the session. Other statuses are derived by the backend. */
export type SessionHaltStatus = 'paused' | 'stopped';

export async function updateSessionProgress(
  sessionId: string,
  results: ValidationResult[],
  currentIndex: number,
  status?: SessionHaltStatus
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
  });
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

export async function listSessions(): Promise<ValidationSession[]> {
  const sessions = await invoke<ValidationSession[]>(
    'list_validation_sessions'
  );

  // Filter out invalid sessions from the list to prevent UI crashes
  return sessions.filter((session) => {
    const validation = validateSession(session);
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
