import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ValidationResult {
  email: string;
  result: "Safe" | "Risky" | "Invalid" | "Unknown";
  reason: string;
  logs: string[];
}

export type ValidationStatus = 'idle' | 'processing' | 'paused' | 'stopping';

export function useEmailValidation() {
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [status, setStatus] = useState<ValidationStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  
  const pendingEmailsRef = useRef<string[]>([]);
  const currentConcurrencyRef = useRef<number>(5);

  const isProcessing = status === 'processing';

  // Listen for progress events from Rust
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isActive = true;
    
    const setupListener = async () => {
      const unlistenFn = await listen<ValidationResult>("validation-progress", (event) => {
        setResults((prev) => [...prev, event.payload]);
        setProgress((prev) => prev + 1);
        // Remove from pending
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
    mutationFn: async ({ emails, concurrency }: { emails: string[], concurrency: number }) => {
      return invoke<ValidationResult[]>("validate_emails_bulk", { emails, concurrency });
    },
    onSuccess: (data) => {
      // Data might be partial if cancelled
      if (data && status === 'processing' && progress + data.length >= total) {
        setStatus('idle');
      }
    },
    onError: (error) => {
      console.error("Bulk validation failed:", error);
      setStatus('idle');
    }
  });

  const startValidation = useCallback((emails: string[], concurrency: number = 5) => {
    setResults([]);
    setProgress(0);
    setTotal(emails.length);
    setStatus('processing');
    pendingEmailsRef.current = [...emails];
    currentConcurrencyRef.current = concurrency;
    mutation.mutate({ emails, concurrency });
  }, [mutation]);

  const pauseValidation = useCallback(async () => {
    if (status !== 'processing') return;
    setStatus('paused');
    await invoke("pause_validation");
  }, [status]);

  const resumeValidation = useCallback(async () => {
    if (status !== 'paused') return;
    setStatus('processing');
    await invoke("resume_validation");
    // Re-submit pending emails
    mutation.mutate({ 
      emails: pendingEmailsRef.current, 
      concurrency: currentConcurrencyRef.current 
    });
  }, [status, mutation]);

  const stopValidation = useCallback(async () => {
    setStatus('idle');
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
    setResults, // Allow manual clearing/saving
  };
}