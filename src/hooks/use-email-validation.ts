import { useState, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ValidationResult {
  email: string;
  result: "Safe" | "Risky" | "Invalid" | "Unknown";
  reason: string;
  logs: string[];
}

export function useEmailValidation() {
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);

  // Listen for progress events from Rust
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isActive = true;
    
    const setupListener = async () => {
      const unlistenFn = await listen<ValidationResult>("validation-progress", (event) => {
        setResults((prev) => [...prev, event.payload]);
        setProgress((prev) => prev + 1);
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
      setResults(data);
      setIsProcessing(false);
    },
    onError: (error) => {
      console.error("Bulk validation failed:", error);
      setIsProcessing(false);
    }
  });

  const startValidation = useCallback((emails: string[], concurrency: number = 5) => {
    setResults([]);
    setProgress(0);
    setTotal(emails.length);
    setIsProcessing(true);
    mutation.mutate({ emails, concurrency });
  }, [mutation]);

  return {
    results,
    isProcessing,
    progress,
    total,
    startValidation,
  };
}
