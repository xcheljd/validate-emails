import { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { notifyValidationComplete, notifyError } from '@/lib/notifications';
import { loadSession, ValidationSession } from '@/lib/session-manager';
import { ValidationResult } from '@/lib/types';

export type ValidationStatus =
  | 'idle'
  | 'processing'
  | 'paused'
  | 'stopping'
  | 'waiting';

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

export function useEmailValidation(initialMode: 'quick' | 'standard' | 'thorough' = 'standard') {
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [status, setStatus] = useState<ValidationStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [validationMode, setValidationMode] = useState<
    'quick' | 'standard' | 'thorough'
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

  const pendingEmailsRef = useRef<string[]>([]);
  const currentConcurrencyRef = useRef<number>(5);
  const statusRef = useRef<ValidationStatus>('idle');
  const waitingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownEndTimeRef = useRef<number>(0);

  // Keep ref in sync for callbacks
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const isProcessing = status === 'processing';

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
  }, [status, results.length, progress, total]);

  // Event listener
  useEffect(() => {
    let unlistenValidationProgress: (() => void) | undefined;
    let unlistenAllProxiesFailed: (() => void) | undefined;
    let isActive = true;

    const setupListeners = async () => {
      const unlistenProgressFn = await listen<ValidationResult>(
        'validation-progress',
        (event) => {
          setResults((prev) => [...prev, event.payload]);
          setProgress((prev) => prev + 1);
          pendingEmailsRef.current = pendingEmailsRef.current.filter(
            (e) => e !== event.payload.email
          );
        }
      );

      const unlistenProxiesFailedFn = await listen<AllProxiesFailedPayload>(
        'all-proxies-failed',
        (event) => {
          setAllProxiesFailedState(event.payload);
          setStatus('paused');
          statusRef.current = 'paused';
        }
      );

      if (!isActive) {
        unlistenProgressFn();
        unlistenProxiesFailedFn();
      } else {
        unlistenValidationProgress = unlistenProgressFn;
        unlistenAllProxiesFailed = unlistenProxiesFailedFn;
      }
    };

    setupListeners();

    return () => {
      isActive = false;
      if (unlistenValidationProgress) unlistenValidationProgress();
      if (unlistenAllProxiesFailed) unlistenAllProxiesFailed();
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
      mode: 'quick' | 'standard' | 'thorough';
    }) => {
      return invoke<ValidationResult[]>('validate_emails_bulk', {
        emails,
        concurrency,
        mode,
      });
    },
    onSuccess: () => {
      // Only return to idle if we were processing and didn't pause/stop
      if (statusRef.current === 'processing') {
        setStatus('idle');
      }
    },
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
      mode: 'quick' | 'standard' | 'thorough' = 'standard'
    ) => {
      setResults([]);
      setProgress(0);
      setTotal(emails.length);
      setStatus('processing');
      statusRef.current = 'processing';
      setValidationMode(mode);
      setUsingDirectConnection(false);
      pendingEmailsRef.current = [...emails];
      currentConcurrencyRef.current = concurrency;
      // Clear any previous proxy bypass when starting a new validation
      invoke('clear_proxy_bypass_for_session').catch(() => {
        // Ignore errors - this is a cleanup call
      });
      mutation.mutate({ emails, concurrency, mode });
    },
    [mutation]
  );

  const pauseValidation = useCallback(async () => {
    setStatus('paused');
    statusRef.current = 'paused';
    await invoke('pause_validation');
  }, []);

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
      mode: 'quick' | 'standard' | 'thorough';
    }) => {
      return invoke<ValidationResult[]>('revalidate_emails_bulk', {
        items,
        concurrency,
        mode,
      });
    },
    onSuccess: () => {
      if (statusRef.current === 'processing') {
        setStatus('idle');
      }
    },
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

    setResults((prev) => prev.filter((r) => r.result !== 'Unknown'));
    setProgress((prev) => Math.max(0, prev - unknownResults.length));

    setStatus('processing');
    statusRef.current = 'processing';

    revalidationMutation.mutate({
      items,
      concurrency: currentConcurrencyRef.current,
      mode: validationMode,
    });
  }, [results, validationMode, revalidationMutation]);

  const stopValidation = useCallback(async () => {
    setStatus('stopping');
    statusRef.current = 'stopping';
    // Clear any active waiting/cooldown timer
    if (waitingTimerRef.current) {
      clearInterval(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
    await invoke('stop_validation');
    setStatus('idle');
    statusRef.current = 'idle';
    // Clear all proxy failure state so the modal closes
    setAllProxiesFailedState(null);
    setWaitingForProxy(false);
    setWaitingCooldownSecs(0);
    // We don't reset progress/total here because the user might want to see the partial results
  }, []);

  // Clear the all-proxies-failed state
  const clearAllProxiesFailedState = useCallback(() => {
    setAllProxiesFailedState(null);
  }, []);

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

      // When cooldown expires, resume validation
      if (remaining <= 0) {
        if (waitingTimerRef.current) {
          clearInterval(waitingTimerRef.current);
          waitingTimerRef.current = null;
        }
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
    // Test helper - allows tests to set the all proxies failed state directly
    setAllProxiesFailedStateForTest: setAllProxiesFailedState,
  };
}
