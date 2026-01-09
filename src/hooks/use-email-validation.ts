import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { notifyValidationComplete, notifyError } from "@/lib/notifications";
import { loadSession, ValidationSession } from "@/lib/session-manager";

export interface ValidationResult {
  email: string;
  result: "Safe" | "Risky" | "Invalid" | "Unknown";
  reason: string;
  logs: string[];
  domain: string;
  validationDuration: number;
  proxyUsed?: string;
  mxRecordCount: number;
  isDisposable: boolean;
  isRoleAccount: boolean;
  isCatchAll: boolean;
  errorType?: string;
  timestamp: string;
  validationMode: "quick" | "standard" | "thorough";
  riskScore: number;
}

export type ValidationStatus = 'idle' | 'processing' | 'paused' | 'stopping';

export function useEmailValidation() {
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [status, setStatus] = useState<ValidationStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [validationMode, setValidationMode] = useState<'quick' | 'standard' | 'thorough'>('standard');
  const [validationSpeed, setValidationSpeed] = useState<number>(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number>(0);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const pendingEmailsRef = useRef<string[]>([]);
  const currentConcurrencyRef = useRef<number>(5);
  const statusRef = useRef<ValidationStatus>('idle');

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
      const avgDuration = recentResults.reduce((a, b) => a + b.validationDuration, 0) / recentResults.length;
      
      const speed = avgDuration > 0 ? 60000 / avgDuration : 0;
      const remaining = (total - progress) * avgDuration / 1000;

      setValidationSpeed(Math.round(speed));
      setEstimatedTimeRemaining(Math.round(remaining));
    }
  }, [progress, results, total]);

  // Completion notification
  useEffect(() => {
    if (status === 'idle' && results.length > 0 && progress === total && total > 0) {
      const safeCount = results.filter(r => r.result === 'Safe').length;
      const riskyCount = results.filter(r => r.result === 'Risky').length;
      notifyValidationComplete(total, safeCount, riskyCount);
    }
  }, [status, results.length, progress, total]);

  // Event listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isActive = true;

    const setupListener = async () => {
      const unlistenFn = await listen<ValidationResult>("validation-progress", (event) => {
        setResults((prev) => [...prev, event.payload]);
        setProgress((prev) => prev + 1);
        pendingEmailsRef.current = pendingEmailsRef.current.filter(e => e !== event.payload.email);
      });

      if (!isActive) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    };

    setupListener();

    return () => {
      isActive = false;
      if (unlisten) unlisten();
    };
  }, []);

  const mutation = useMutation({
    mutationFn: async ({ emails, concurrency, mode }: { emails: string[], concurrency: number, mode: 'quick' | 'standard' | 'thorough' }) => {
      return invoke<ValidationResult[]>("validate_emails_bulk", { 
        emails, 
        concurrency, 
        mode
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
        console.error("Bulk validation failed:", error);
        notifyError(error instanceof Error ? error.message : "Validation failed");
        setStatus('idle');
      }
    }
  });

  const startValidation = useCallback((emails: string[], concurrency: number = 5, mode: 'quick' | 'standard' | 'thorough' = 'standard') => {
    setResults([]);
    setProgress(0);
    setTotal(emails.length);
    setStatus('processing');
    statusRef.current = 'processing';
    setValidationMode(mode);
    pendingEmailsRef.current = [...emails];
    currentConcurrencyRef.current = concurrency;
    mutation.mutate({ emails, concurrency, mode });
  }, [mutation]);

  const pauseValidation = useCallback(async () => {
    setStatus('paused');
    statusRef.current = 'paused';
    await invoke("pause_validation");
  }, []);

  const resumeValidation = useCallback(async () => {
    if (statusRef.current !== 'paused') return;
    setStatus('processing');
    statusRef.current = 'processing';
    await invoke("resume_validation");
    mutation.mutate({
      emails: pendingEmailsRef.current,
      concurrency: currentConcurrencyRef.current,
      mode: validationMode
    });
  }, [mutation, validationMode]);

  const resumeSession = useCallback(async (sessionIdToResume: string) => {
    try {
      const session: ValidationSession = await loadSession(sessionIdToResume);
      const unprocessedEmails = session.emails.slice(session.currentIndex);
      const problemEmails = session.results
        .filter(r => r.result === 'Unknown' || r.result === 'Invalid')
        .map(r => r.email);

      const emailsToRevalidate = [...unprocessedEmails, ...problemEmails];

      setResults(session.results);
      setProgress(session.currentIndex);
      setTotal(session.total);
      setSessionId(sessionIdToResume);
      setValidationMode(session.settings.validationMode);
      currentConcurrencyRef.current = 5;
      pendingEmailsRef.current = emailsToRevalidate;

      setStatus('processing');
      statusRef.current = 'processing';
      mutation.mutate({
        emails: emailsToRevalidate,
        concurrency: 5,
        mode: session.settings.validationMode
      });
    } catch (error) {
      console.error("Failed to resume session:", error);
      notifyError(`Failed to resume session: ${error}`);
    }
  }, [mutation]);

  const revalidationMutation = useMutation({
    mutationFn: async ({ items, concurrency, mode }: { items: { email: string, excluded_proxy?: string }[], concurrency: number, mode: 'quick' | 'standard' | 'thorough' }) => {
      return invoke<ValidationResult[]>("revalidate_emails_bulk", {
        items,
        concurrency,
        mode
      });
    },
    onSuccess: () => {
      if (statusRef.current === 'processing') {
        setStatus('idle');
      }
    },
    onError: (error) => {
      if (statusRef.current === 'processing') {
        console.error("Revalidation failed:", error);
        notifyError(error instanceof Error ? error.message : "Revalidation failed");
        setStatus('idle');
      }
    }
  });

  const retryUnknowns = useCallback(() => {
    const unknownResults = results.filter(r => r.result === 'Unknown');
    if (unknownResults.length === 0) return;

    const items = unknownResults.map(r => ({
      email: r.email,
      excluded_proxy: r.proxyUsed
    }));

    setResults(prev => prev.filter(r => r.result !== 'Unknown'));
    setProgress(prev => Math.max(0, prev - unknownResults.length));
    
    setStatus('processing');
    statusRef.current = 'processing';
    
    revalidationMutation.mutate({
        items,
        concurrency: currentConcurrencyRef.current,
        mode: validationMode
    });
  }, [results, validationMode, revalidationMutation]);

  const stopValidation = useCallback(async () => {
    setStatus('stopping');
    statusRef.current = 'stopping';
    await invoke("stop_validation");
    setStatus('idle');
    statusRef.current = 'idle';
    // We don't reset progress/total here because the user might want to see the partial results
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
  };
}