import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Mirrors `CorruptSettingsInfo` in src-tauri/src/settings_mod/settings_core.rs. */
export interface CorruptSettingsInfo {
  originalPath: string;
  backupPath: string;
  reason: string;
  preserved: boolean;
  message: string;
}

/**
 * Shown once per launch when the backend found settings.json corrupt at
 * startup and moved it aside (B13), so a lost proxy pool is never silent.
 */
export function CorruptSettingsBanner() {
  const [info, setInfo] = useState<CorruptSettingsInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await invoke<CorruptSettingsInfo | null>('get_corrupt_settings_warning');
        if (!cancelled && result) setInfo(result);
      } catch (error) {
        console.error('Failed to check for corrupt settings:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 p-3 mb-4 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 rounded-lg"
    >
      <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
          Settings file was corrupt — defaults are in use
        </span>
        <span className="text-xs text-yellow-700 dark:text-yellow-300">{info.message}</span>
        {info.preserved && (
          <span className="text-xs text-yellow-600 dark:text-yellow-400">
            Backup: <code className="break-all">{info.backupPath}</code>
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto h-7 w-7 flex-shrink-0"
        aria-label="Dismiss"
        onClick={() => setInfo(null)}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
