import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { notifyValidationComplete, notifyError } from "@/lib/notifications";

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

  const isProcessing = status === 'processing';

  useEffect(() => {
    if (progress >= 10 && results.length > 0) {
      const recentDurations = results.slice(-10).map(r => r.validationDuration);
      const avgDuration = recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;
      const speed = avgDuration > 0 ? 60000 / avgDuration : 0;
      const remaining = (total - progress) * avgDuration / 1000;

      setValidationSpeed(Math.round(speed));
      setEstimatedTimeRemaining(Math.round(remaining));
    }
  }, [progress, results, total]);

  useEffect(() => {
    if (progress >= 10 && results.length > 0) {
      const recentDurations = results.slice(-10).map(r => r.validationDuration);
      const avgDuration = recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;
      const speed = avgDuration > 0 ? 60000 / avgDuration : 0;
      const remaining = (total - progress) * avgDuration / 1000;

      setValidationSpeed(Math.round(speed));
      setEstimatedTimeRemaining(Math.round(remaining));
    }
  }, [progress, results, total]);

  useEffect(() => {
    if (status === 'idle' && results.length > 0 && progress === total) {
      const safeCount = results.filter(r => r.result === 'Safe').length;
      const riskyCount = results.filter(r => r.result === 'Risky').length;
      notifyValidationComplete(total, safeCount, riskyCount);
    }
  }, [status, results.length, progress, total]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isActive = true;

    const setupListener = async () => {
      const unlistenFn = await listen<ValidationResult>("validation-progress", (event) => {
        setResults((prev) => [...prev, event.payload]);
        setProgress((prev) => prev + 1);
        pendingEmailsRef.current = pendingEmailsRef.current.filter(e => e !== event.payload.email);

        if (progress + 1 >= total) {
          setStatus('idle');
        }
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
  }, [total]);

  const mutation = useMutation({
    mutationFn: async ({ emails, concurrency, mode }: { emails: string[], concurrency: number, mode: 'quick' | 'standard' | 'thorough' }) => {
      return invoke<ValidationResult[]>("validate_emails_bulk", { emails, concurrency, timeout: mode === 'quick' ? 10 : mode === 'standard' ? 30 : 60 });
    },
    onSuccess: () => {
      setStatus('idle');
    },
    onError: (error) => {
      console.error("Bulk validation failed:", error);
      notifyError(error instanceof Error ? error.message : "Validation failed");
      setStatus('idle');
    }
  });

  const startValidation = useCallback((emails: string[], concurrency: number = 5, mode: 'quick' | 'standard' | 'thorough' = 'standard') => {
    setResults([]);
    setProgress(0);
    setTotal(emails.length);
    setStatus('processing');
    setValidationMode(mode);
    pendingEmailsRef.current = [...emails];
    currentConcurrencyRef.current = concurrency;
    mutation.mutate({ emails, concurrency, mode });
  }, [mutation]);

  const pauseValidation = useCallback(async () => {
    setStatus('paused');
    await invoke("pause_validation");
  }, []);

  const resumeValidation = useCallback(async () => {
    if (status !== 'paused') return;
    setStatus('processing');
    await invoke("resume_validation");
    mutation.mutate({
      emails: pendingEmailsRef.current,
      concurrency: currentConcurrencyRef.current,
      mode: validationMode
    });
  }, [status, mutation, validationMode]);

  const stopValidation = useCallback(async () => {
    setStatus('idle');
    setProgress(0);
    setTotal(0);
    setValidationSpeed(0);
    setEstimatedTimeRemaining(0);
    await invoke("stop_validation");
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
    stopValidation,
    setResults,
    validationMode,
    onChangeValidationMode: setValidationMode,
    sessionId,
    setSessionId,
    validationSpeed,
    estimatedTimeRemaining,
  };
}
