import { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { notifyValidationComplete, notifyError } from '@/lib/notifications';
import { loadSession, createSession, updateSessionProgress, ValidationSession } from '@/lib/session-manager';
import { ValidationResult } from '@/lib/types';
import {
  type ValidationStatus,
  type ValidationMode,
  type AllProxiesFailedPayload,
  type RateLimitFailureState,
  type ValidationStateForTest,
  type RunOutcome,
  SLOWDOWN_THRESHOLD,
  AUTO_PAUSE_THRESHOLD,
  toRunOutcome,
} from './validation-types';

// Re-export types for backward compatibility with existing consumers.
export type {
  ValidationStatus,
  ValidationMode,
  FailedProxyInfo,
  AllProxiesFailedPayload,
  RateLimitFailureState,
  RunOutcome,
  RunStopReason,
  WaitingForProxyPayload,
} from './validation-types';

export function useEmailValidation(
  initialMode: ValidationMode = 'standard',
  autoSaveInterval: number = 10
) {
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [status, setStatus] = useState<ValidationStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [validationMode, setValidationMode] = useState<
    ValidationMode
  >(initialMode);
  const [validationSpeed, setValidationSpeed] = useState<number>(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] =
    useState<number>(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [allProxiesFailedState, setAllProxiesFailedState] =
    useState<AllProxiesFailedPayload | null>(null);
  const [usingDirectConnection, setUsingDirectConnection] =
    useState<boolean>(false);
  const [waitingForProxy, setWaitingForProxy] = useState<boolean>(false);
  const [waitingCooldownSecs, setWaitingCooldownSecs] = useState<number>(0);

  // Escalation state
  const [isEscalating, setIsEscalating] = useState(false);
  const [escalationTier, setEscalationTier] = useState(1);
  const [escalationEmailCount, setEscalationEmailCount] = useState(0);

  // Rate limit failure tracking (auto-slowdown / auto-pause)
  const [rateLimitFailureState, setRateLimitFailureState] = useState<RateLimitFailureState>({
    consecutiveFailures: 0,
    isSlowdownActive: false,
    isAutoPaused: false,
  });

  const pendingEmailsRef = useRef<string[]>([]);
  const currentConcurrencyRef = useRef<number>(5);
  const statusRef = useRef<ValidationStatus>('idle');
  const waitingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownEndTimeRef = useRef<number>(0);
  const sessionIdRef = useRef<string | null>(null);
  const resultsRef = useRef<ValidationResult[]>([]);
  const progressRef = useRef(0);
  const totalRef = useRef(0);
  // Highest backend run id seen. Events stamped with an older run id come
  // from a superseded run and are ignored.
  const latestRunIdRef = useRef(0);

  // Keep refs in sync for use in callbacks and effects
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    totalRef.current = total;
  }, [total]);

  const isProcessing = status === 'processing';

  /** True if an event's run id belongs to a superseded run. */
  const isStaleRun = (runId: number | undefined): boolean => {
    if (runId === undefined) return false;
    if (runId < latestRunIdRef.current) return true;
    latestRunIdRef.current = runId;
    return false;
  };

  // Apply a finished run's outcome to the status. Only a run that validated
  // every email returns the UI to idle; a run that paused itself for lack of
  // a proxy stays paused (whether or not its event arrived first); a
  // cancelled run leaves status to whoever cancelled it.
  const settleRun = useCallback((outcome: RunOutcome) => {
    if (outcome.stopReason === 'paused_no_proxy') {
      if (statusRef.current === 'processing') {
        setStatus('paused');
        statusRef.current = 'paused';
      }
    } else if (outcome.stopReason === null && statusRef.current === 'processing') {
      setStatus('idle');
    }
  }, []);

  // Save session progress to backend (fire-and-forget with error logging)
  const saveSession = useCallback(
    () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const resultsToSave = resultsRef.current;
      const idx = progressRef.current;
      updateSessionProgress(sid, resultsToSave, idx).catch((err) => {
        console.warn('Failed to auto-save session:', err);
      });
    },
    []
  );

  // Auto-save effect: periodically save session based on autoSaveInterval
  useEffect(() => {
    if (status !== 'processing' || autoSaveInterval <= 0) return;
    const interval = setInterval(() => {
      if (statusRef.current === 'processing' && sessionIdRef.current) {
        saveSession();
      }
    }, autoSaveInterval * 1000);
    return () => clearInterval(interval);
  }, [status, autoSaveInterval, saveSession]);

  // Save on completion (status transitions to idle with all results)
  useEffect(() => {
    if (
      status === 'idle' &&
      results.length > 0 &&
      progress === total &&
      total > 0 &&
      sessionIdRef.current
    ) {
      saveSession();
    }
  }, [status, results, progress, total, saveSession]);

  // Save on pause
  useEffect(() => {
    if (status === 'paused' && sessionIdRef.current) {
      saveSession();
    }
  }, [status, saveSession]);

  // Speed and ETA calculation
  useEffect(() => {
    if (progress >= 1 && results.length > 0) {
      const sampleSize = Math.min(results.length, 20);
      const recentResults = results.slice(-sampleSize);
      const avgDuration =
        recentResults.reduce((a, b) => a + b.validationDuration, 0) /
        recentResults.length;

      const speed = avgDuration > 0 ? 60000 / avgDuration : 0;
      const remaining = ((total - progress) * avgDuration) / 1000;

      setValidationSpeed(Math.round(speed));
      setEstimatedTimeRemaining(Math.round(remaining));
    }
  }, [progress, results, total]);

  // Completion notification
  useEffect(() => {
    if (
      status === 'idle' &&
      results.length > 0 &&
      progress === total &&
      total > 0
    ) {
      const safeCount = results.filter((r) => r.result === 'Safe').length;
      const riskyCount = results.filter((r) => r.result === 'Risky').length;
      notifyValidationComplete(total, safeCount, riskyCount);
    }
  }, [status, results, progress, total]);

  // Event listener
  useEffect(() => {
    const unlistenRefs = {
      validationProgress: undefined as (() => void) | undefined,
      allProxiesFailed: undefined as (() => void) | undefined,
      runStarted: undefined as (() => void) | undefined,
    };
    let isActive = true;

    const setupListeners = async () => {
      try {
        const unlistenRunStartedFn = await listen<{ runId: number }>(
          'validation-run-started',
          (event) => {
            isStaleRun(event.payload.runId);
          }
        );
        unlistenRefs.runStarted = unlistenRunStartedFn;

        const unlistenProgressFn = await listen<ValidationResult & { runId?: number }>(
          'validation-progress',
          (event) => {
            const { runId, ...result } = event.payload;
            if (isStaleRun(runId)) return;
            // Progress counts distinct emails seen. Re-validating an email that
            // is already in results (a retry) updates it in place and must NOT
            // advance progress — otherwise progress would exceed total. This also
            // keeps retries non-destructive: if a retry is interrupted, no result
            // is lost and progress stays at total.
            const alreadySeen = resultsRef.current.some(
              (r) => r.email === result.email
            );
            setResults((prev) => {
              const idx = prev.findIndex((r) => r.email === result.email);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = result;
                return next;
              }
              return [...prev, result];
            });
            if (!alreadySeen) {
              setProgress((prev) => prev + 1);
            }
            pendingEmailsRef.current = pendingEmailsRef.current.filter(
              (e) => e !== result.email
            );

            // Track consecutive failures for rate limit auto-slowdown/auto-pause
            const isFailure = result.result === 'Unknown' || !!result.errorType;
            setRateLimitFailureState((prev) => {
              if (isFailure) {
                const newCount = prev.consecutiveFailures + 1;
                return {
                  consecutiveFailures: newCount,
                  isSlowdownActive: newCount >= SLOWDOWN_THRESHOLD,
                  isAutoPaused: newCount >= AUTO_PAUSE_THRESHOLD,
                };
              } else {
                // Success resets consecutive failures
                return {
                  ...prev,
                  consecutiveFailures: 0,
                };
              }
            });
          }
        );

        const unlistenProxiesFailedFn = await listen<AllProxiesFailedPayload>(
          'all-proxies-failed',
          (event) => {
            if (isStaleRun(event.payload.runId)) return;
            setAllProxiesFailedState(event.payload);
            setStatus('paused');
            statusRef.current = 'paused';
          }
        );

        if (!isActive) {
          unlistenRunStartedFn();
          unlistenProgressFn();
          unlistenProxiesFailedFn();
        } else {
          unlistenRefs.validationProgress = unlistenProgressFn;
          unlistenRefs.allProxiesFailed = unlistenProxiesFailedFn;
        }
      } catch (err) {
        // If setup fails, clean up any partially registered listeners
        if (unlistenRefs.runStarted) unlistenRefs.runStarted();
        if (unlistenRefs.validationProgress) unlistenRefs.validationProgress();
        if (unlistenRefs.allProxiesFailed) unlistenRefs.allProxiesFailed();
        throw err;
      }
    };

    setupListeners().catch((err) => console.error('Failed to set up validation listeners:', err));

    return () => {
      isActive = false;
      if (unlistenRefs.runStarted) unlistenRefs.runStarted();
      if (unlistenRefs.validationProgress) unlistenRefs.validationProgress();
      if (unlistenRefs.allProxiesFailed) unlistenRefs.allProxiesFailed();
    };
  }, []);

  const mutation = useMutation({
    mutationFn: async ({
      emails,
      concurrency,
      mode,
    }: {
      emails: string[];
      concurrency: number;
      mode: ValidationMode;
    }) => {
      return toRunOutcome(
        await invoke<unknown>('validate_emails_bulk', {
          emails,
          concurrency,
          mode,
        })
      );
    },
    onSuccess: settleRun,
    onError: (error) => {
      if (statusRef.current === 'processing') {
        console.error('Bulk validation failed:', error);
        notifyError(
          error instanceof Error ? error.message : 'Validation failed'
        );
        setStatus('idle');
      }
    },
  });

  const startValidation = useCallback(
    (
      emails: string[],
      concurrency: number = 5,
      mode: ValidationMode = 'standard'
    ) => {
      setResults([]);
      setProgress(0);
      setTotal(emails.length);
      setStatus('processing');
      statusRef.current = 'processing';
      setValidationMode(mode);
      setUsingDirectConnection(false);
      setSessionId(null);
      sessionIdRef.current = null;
      // Reset rate limit failure state
      setRateLimitFailureState({
        consecutiveFailures: 0,
        isSlowdownActive: false,
        isAutoPaused: false,
      });
      pendingEmailsRef.current = [...emails];
      currentConcurrencyRef.current = concurrency;
      // Clear any previous proxy bypass when starting a new validation
      invoke('clear_proxy_bypass_for_session').catch(() => {
        // Ignore errors - this is a cleanup call
      });
      // Create a session record for persistence
      createSession(emails, { validationMode: mode })
        .then((id) => {
          setSessionId(id);
          sessionIdRef.current = id;
        })
        .catch((err) => {
          console.warn('Failed to create validation session:', err);
        });
      mutation.mutate({ emails, concurrency, mode });
    },
    [mutation]
  );

  const pauseValidation = useCallback(async () => {
    setStatus('paused');
    statusRef.current = 'paused';
    // Clear any active waiting/cooldown timer
    if (waitingTimerRef.current) {
      clearInterval(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
    await invoke('pause_validation');
  }, []);

  // Auto-pause effect: when rate limit failure state triggers auto-pause
  useEffect(() => {
    if (
      rateLimitFailureState.isAutoPaused &&
      statusRef.current === 'processing'
    ) {
      pauseValidation();
    }
  }, [rateLimitFailureState.isAutoPaused, pauseValidation]);

  const resumeValidation = useCallback(async () => {
    if (statusRef.current !== 'paused') return;
    setStatus('processing');
    statusRef.current = 'processing';
    await invoke('resume_validation');
    mutation.mutate({
      emails: pendingEmailsRef.current,
      concurrency: currentConcurrencyRef.current,
      mode: validationMode,
    });
  }, [mutation, validationMode]);

  const resumeSession = useCallback(
    async (sessionIdToResume: string, concurrency?: number) => {
      try {
        const session: ValidationSession = await loadSession(sessionIdToResume);
        const unprocessedEmails = session.emails.slice(session.currentIndex);
        const problemEmails = session.results
          .filter((r) => r.result === 'Unknown' || r.result === 'Invalid')
          .map((r) => r.email);

        const emailsToRevalidate = [...unprocessedEmails, ...problemEmails];

        const resolvedConcurrency =
          concurrency ?? currentConcurrencyRef.current;

        setResults(session.results);
        setProgress(session.currentIndex);
        setTotal(session.total);
        setSessionId(sessionIdToResume);
        sessionIdRef.current = sessionIdToResume;
        setValidationMode(session.settings.validationMode);
        currentConcurrencyRef.current = resolvedConcurrency;
        pendingEmailsRef.current = emailsToRevalidate;

        setStatus('processing');
        statusRef.current = 'processing';
        mutation.mutate({
          emails: emailsToRevalidate,
          concurrency: resolvedConcurrency,
          mode: session.settings.validationMode,
        });
      } catch (error) {
        console.error('Failed to resume session:', error);
        notifyError(`Failed to resume session: ${error}`);
      }
    },
    [mutation]
  );

  const revalidationMutation = useMutation({
    mutationFn: async ({
      items,
      concurrency,
      mode,
    }: {
      items: { email: string }[];
      concurrency: number;
      mode: ValidationMode;
    }) => {
      return toRunOutcome(
        await invoke<unknown>('revalidate_emails_bulk', {
          items,
          concurrency,
          mode,
        })
      );
    },
    onSuccess: settleRun,
    onError: (error) => {
      if (statusRef.current === 'processing') {
        console.error('Revalidation failed:', error);
        notifyError(
          error instanceof Error ? error.message : 'Revalidation failed'
        );
        setStatus('idle');
      }
    },
  });

  const retryUnknowns = useCallback(() => {
    const unknownResults = results.filter((r) => r.result === 'Unknown');
    if (unknownResults.length === 0) return;

    const items = unknownResults.map((r) => ({
      email: r.email,
    }));

    // Do not remove unknowns or adjust progress here: the progress handler
    // updates each retried email in place without advancing progress, so
    // results stay complete and progress stays at total even if interrupted.
    setStatus('processing');
    statusRef.current = 'processing';
    pendingEmailsRef.current = items.map((i) => i.email);

    revalidationMutation.mutate({
      items,
      concurrency: currentConcurrencyRef.current,
      mode: validationMode,
    });
  }, [results, validationMode, revalidationMutation]);

  const retryWithEscalation = useCallback(
    async (
      tier: ValidationMode,
      autoEscalate: boolean
    ) => {
      const unknownResults = results.filter((r) => r.result === 'Unknown');
      if (unknownResults.length === 0) return;

      if (!autoEscalate) {
        // Manual single-tier retry. The progress handler updates retried emails
        // in place without advancing progress, so no removal/decrement here.
        const items = unknownResults.map((r) => ({ email: r.email }));
        setStatus('processing');
        statusRef.current = 'processing';
        pendingEmailsRef.current = items.map((i) => i.email);

        revalidationMutation.mutate({
          items,
          concurrency: currentConcurrencyRef.current,
          mode: tier,
        });
        return;
      }

      // Auto-escalation: standard → thorough.
      // `quick` is intentionally NOT a tier: by design it skips SMTP and
      // returns Unknown for any non-disposable address that has MX records,
      // so it can never resolve an Unknown — it only wasted a pass and (before
      // the proxy-outcome fix) fed those Unknowns into proxy failure stats.
      const tiers: ValidationMode[] = [
        'standard',
        'thorough',
      ];
      let currentUnknowns = unknownResults.map((r) => r.email);

      setIsEscalating(true);

      try {
        for (let i = 0; i < tiers.length; i++) {
          if (currentUnknowns.length === 0) break;

          setEscalationTier(i + 1);
          setEscalationEmailCount(currentUnknowns.length);

          const items = currentUnknowns.map((email) => ({ email }));

          setStatus('processing');
          statusRef.current = 'processing';
          // If this tier pauses, resume picks up whatever it didn't finish.
          pendingEmailsRef.current = [...currentUnknowns];

          // Call revalidate_emails_bulk directly via invoke. The progress event
          // handler updates each retried email in place (no progress change and
          // no result loss), so we don't mutate results/progress here — we only
          // use the returned results to pick the unknowns for the next tier.
          const outcome = toRunOutcome(
            await invoke<unknown>('revalidate_emails_bulk', {
              items,
              concurrency: currentConcurrencyRef.current,
              mode: tiers[i],
            })
          );

          // A paused or cancelled tier returned only partial results. Treat
          // them as final for this attempt: escalating now would re-run the
          // unfinished emails at the next tier (and, for a proxy pause, start
          // a run against a drained pool).
          if (outcome.stopReason !== null) {
            settleRun(outcome);
            break;
          }

          // Determine remaining unknowns for next tier
          currentUnknowns = outcome.results
            .filter((r) => r.result === 'Unknown')
            .map((r) => r.email);
        }
      } catch (error) {
        // On error, reset escalation state so UI doesn't get stuck in "Escalating..."
        console.error('Auto-escalation failed:', error);
        notifyError(
          error instanceof Error ? error.message : 'Auto-escalation failed'
        );
      } finally {
        // Always reset escalation state (whether success or error)
        setIsEscalating(false);
        setEscalationTier(1);
        setEscalationEmailCount(0);
      }

      if (statusRef.current === 'processing') {
        setStatus('idle');
        statusRef.current = 'idle';
      }
    },
    [results, revalidationMutation, settleRun]
  );

  const stopValidation = useCallback(async () => {
    setStatus('stopping');
    statusRef.current = 'stopping';
    // Clear any active waiting/cooldown timer
    if (waitingTimerRef.current) {
      clearInterval(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
    await invoke('stop_validation');
    // Save session with current progress before resetting
    if (sessionIdRef.current && resultsRef.current.length > 0) {
      saveSession();
    }
    setStatus('idle');
    statusRef.current = 'idle';
    // Clear all proxy failure state so the modal closes
    setAllProxiesFailedState(null);
    setWaitingForProxy(false);
    setWaitingCooldownSecs(0);
    // Reset rate limit failure state
    setRateLimitFailureState({
      consecutiveFailures: 0,
      isSlowdownActive: false,
      isAutoPaused: false,
    });
    // Reset escalation state so UI doesn't get stuck in "Escalating..."
    setIsEscalating(false);
    setEscalationTier(1);
    setEscalationEmailCount(0);
    // We don't reset progress/total here because the user might want to see the partial results
  }, [saveSession]);

  // Clear the all-proxies-failed state
  const clearAllProxiesFailedState = useCallback(() => {
    setAllProxiesFailedState(null);
  }, []);

  // Resume from auto-pause: clears the auto-pause state and continues
  const resumeFromAutoPause = useCallback(() => {
    setRateLimitFailureState((prev) => ({
      ...prev,
      consecutiveFailures: 0,
      isAutoPaused: false,
      isSlowdownActive: false,
    }));
    resumeValidation();
  }, [resumeValidation]);

  // Stop from auto-pause: clears the auto-pause state and stops
  const stopFromAutoPause = useCallback(() => {
    setRateLimitFailureState({
      consecutiveFailures: 0,
      isSlowdownActive: false,
      isAutoPaused: false,
    });
    stopValidation();
  }, [stopValidation]);

  // Continue without proxy - temporarily disable proxy and resume
  const continueWithoutProxy = useCallback(async () => {
    try {
      // Set session-level proxy bypass (does NOT modify permanent settings)
      await invoke('set_proxy_bypass_for_session', { bypass: true });
      setAllProxiesFailedState(null);
      setUsingDirectConnection(true);

      // Resume validation with remaining emails using direct connection
      setStatus('processing');
      statusRef.current = 'processing';
      mutation.mutate({
        emails: pendingEmailsRef.current,
        concurrency: currentConcurrencyRef.current,
        mode: validationMode,
      });
    } catch (error) {
      console.error('Failed to continue without proxy:', error);
      notifyError(
        error instanceof Error
          ? error.message
          : 'Failed to continue without proxy'
      );
    }
  }, [mutation, validationMode]);

  // Retry with cooldown - wait for nearest cooldown to expire then retry
  const retryWithCooldown = useCallback(() => {
    if (!allProxiesFailedState || allProxiesFailedState.cooldownCount === 0) {
      return;
    }

    const waitTimeSecs = allProxiesFailedState.nearestCooldownSecs;
    if (waitTimeSecs <= 0) {
      return;
    }

    // Set waiting state
    setWaitingForProxy(true);
    setWaitingCooldownSecs(waitTimeSecs);
    setStatus('waiting');
    statusRef.current = 'waiting';

    // Store the end time
    const now = Date.now();
    cooldownEndTimeRef.current = now + waitTimeSecs * 1000;

    // Start countdown timer (update every second)
    waitingTimerRef.current = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((cooldownEndTimeRef.current - Date.now()) / 1000)
      );
      setWaitingCooldownSecs(remaining);

      // When cooldown expires, resume validation only if not stopped/paused
      if (remaining <= 0) {
        if (waitingTimerRef.current) {
          clearInterval(waitingTimerRef.current);
          waitingTimerRef.current = null;
        }
        // Only resume if validation hasn't been stopped or paused externally
        if (statusRef.current === 'waiting') {
          setWaitingForProxy(false);
          setWaitingCooldownSecs(0);
          setAllProxiesFailedState(null);
          setStatus('processing');
          statusRef.current = 'processing';

          // Resume validation
          mutation.mutate({
            emails: pendingEmailsRef.current,
            concurrency: currentConcurrencyRef.current,
            mode: validationMode,
          });
        }
      }
    }, 1000);
  }, [allProxiesFailedState, mutation, validationMode]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (waitingTimerRef.current) {
        clearInterval(waitingTimerRef.current);
        waitingTimerRef.current = null;
      }
    };
  }, []);

  // Test helper - allows tests to set validation state directly
  const setValidationStateForTest = useCallback((
    newState: Partial<Pick<ValidationStateForTest, 'results' | 'status' | 'progress' | 'total' | 'validationMode'>>
  ) => {
    if (newState.results !== undefined) setResults(newState.results);
    if (newState.status !== undefined) setStatus(newState.status);
    if (newState.progress !== undefined) setProgress(newState.progress);
    if (newState.total !== undefined) setTotal(newState.total);
    if (newState.validationMode !== undefined) setValidationMode(newState.validationMode);
  }, []);

  // Test helper - allows tests to get validation state directly
  const getValidationStateForTest = useCallback((): ValidationStateForTest => ({
    results,
    status,
    progress,
    total,
    validationMode,
    isEscalating,
    escalationTier,
    escalationEmailCount,
    rateLimitFailureState,
  }), [results, status, progress, total, validationMode, isEscalating, escalationTier, escalationEmailCount, rateLimitFailureState]);

  // Test helper - allows tests to reset rate limit failure state
  const resetRateLimitFailureStateForTest = useCallback(() => {
    setRateLimitFailureState({
      consecutiveFailures: 0,
      isSlowdownActive: false,
      isAutoPaused: false,
    });
  }, []);

  // Test helper - allows tests to reset escalation state
  const resetEscalationStateForTest = useCallback(() => {
    setIsEscalating(false);
    setEscalationTier(1);
    setEscalationEmailCount(0);
  }, []);

  // Test helper - allows tests to set escalation state directly
  const setEscalationStateForTest = useCallback((
    newState: Partial<{
      isEscalating: boolean;
      escalationTier: number;
      escalationEmailCount: number;
    }>
  ) => {
    if (newState.isEscalating !== undefined) setIsEscalating(newState.isEscalating);
    if (newState.escalationTier !== undefined) setEscalationTier(newState.escalationTier);
    if (newState.escalationEmailCount !== undefined) setEscalationEmailCount(newState.escalationEmailCount);
  }, []);

  // Test helper - allows tests to set rate limit failure state directly
  const setRateLimitFailureStateForTest = useCallback((
    newState: Partial<{
      consecutiveFailures: number;
      isSlowdownActive: boolean;
      isAutoPaused: boolean;
    }>
  ) => {
    setRateLimitFailureState((prev) => ({
      ...prev,
      ...newState,
    }));
  }, []);

  return {
    results,
    isProcessing,
    status,
    progress,
    total,
    startValidation,
    pauseValidation,
    resumeValidation,
    resumeSession,
    stopValidation,
    retryUnknowns,
    retryWithEscalation,
    // Escalation state
    isEscalating,
    escalationTier,
    escalationEmailCount,
    setResults,
    validationMode,
    onChangeValidationMode: setValidationMode,
    sessionId,
    setSessionId,
    validationSpeed,
    estimatedTimeRemaining,
    // All proxies failed state and handlers
    allProxiesFailedState,
    clearAllProxiesFailedState,
    continueWithoutProxy,
    retryWithCooldown,
    // Direct connection indicator
    usingDirectConnection,
    // Waiting for proxy cooldown state
    waitingForProxy,
    waitingCooldownSecs,
    // Rate limit failure state (auto-slowdown / auto-pause)
    rateLimitFailureState,
    resumeFromAutoPause,
    stopFromAutoPause,
    // Test helper - allows tests to set the all proxies failed state directly
    setAllProxiesFailedStateForTest: setAllProxiesFailedState,
    // Test helper - allows tests to set validation state directly
    setValidationStateForTest,
    // Test helper - allows tests to get validation state directly
    getValidationStateForTest,
    // Test helper - allows tests to reset rate limit failure state
    resetRateLimitFailureStateForTest,
    // Test helper - allows tests to reset escalation state
    resetEscalationStateForTest,
    // Test helper - allows tests to set escalation state directly
    setEscalationStateForTest,
    // Test helper - allows tests to set rate limit failure state directly
    setRateLimitFailureStateForTest,
  };
}
