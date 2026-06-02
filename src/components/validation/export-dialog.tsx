import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Download, FileSpreadsheet, FileText, Filter } from 'lucide-react';
import {
  exportColumns,
  exportToCSV,
  exportToExcel,
  type ExportColumn,
} from '@/lib/enhanced-export-utils';
import { ValidationResult } from '@/lib/types';
import { cn } from '@/lib/utils';

type ExportFormat = 'csv' | 'xlsx';
type ResultFilter = 'all' | 'safe' | 'suppression';

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: ValidationResult[];
  /** Map from canonical email to originals, used to populate Original Emails column */
  canonicalToOriginals?: Map<string, string[]> | null;
}

interface PersistedState {
  columns: Record<string, boolean>;
  format: ExportFormat;
  resultFilter: ResultFilter;
}

const STORAGE_KEY = 'export-dialog-state';

function loadPersistedState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as PersistedState;
    }
  } catch {
    // Ignore parse errors, use defaults
  }
  return null;
}

function persistState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

function getDefaultColumnState(): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  exportColumns.forEach((col) => {
    state[col.key] = col.enabled;
  });
  return state;
}

export function ExportDialog({
  open,
  onOpenChange,
  results,
  canonicalToOriginals,
}: ExportDialogProps) {
  // Initialize state from localStorage or defaults
  const [columnState, setColumnState] = useState<Record<string, boolean>>(
    () => {
      const persisted = loadPersistedState();
      if (persisted?.columns && Object.keys(persisted.columns).length > 0) {
        // Merge persisted with current columns (handles new columns added later)
        const defaults = getDefaultColumnState();
        return { ...defaults, ...persisted.columns };
      }
      return getDefaultColumnState();
    }
  );

  const [format, setFormat] = useState<ExportFormat>(() => {
    const persisted = loadPersistedState();
    return persisted?.format ?? 'csv';
  });

  const [resultFilter, setResultFilter] = useState<ResultFilter>(() => {
    const persisted = loadPersistedState();
    return persisted?.resultFilter ?? 'all';
  });

  // Persist state on every change
  useEffect(() => {
    persistState({ columns: columnState, format, resultFilter });
  }, [columnState, format, resultFilter]);

  const toggleColumn = useCallback((key: string) => {
    setColumnState((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const selectAll = useCallback(() => {
    setColumnState((prev) => {
      const next: Record<string, boolean> = {};
      Object.keys(prev).forEach((key) => {
        next[key] = true;
      });
      return next;
    });
  }, []);

  const deselectAll = useCallback(() => {
    setColumnState((prev) => {
      const next: Record<string, boolean> = {};
      Object.keys(prev).forEach((key) => {
        next[key] = false;
      });
      return next;
    });
  }, []);

  const applyPreset = useCallback((preset: 'full' | 'clean' | 'suppression') => {
    switch (preset) {
      case 'full':
        selectAll();
        setResultFilter('all');
        break;
      case 'clean':
        // Clean list: enable Email + Status at minimum, plus a few useful columns
        setColumnState((prev) => {
          const next: Record<string, boolean> = {};
          Object.keys(prev).forEach((key) => {
            next[key] = false;
          });
          // Enable key columns for clean list
          next.email = true;
          next.result = true;
          next.domain = true;
          next.isDeliverable = true;
          next.isDisposable = true;
          next.suggestion = true;
          return next;
        });
        setResultFilter('safe');
        break;
      case 'suppression':
        // Suppression list: enable Email + Status + reasons
        setColumnState((prev) => {
          const next: Record<string, boolean> = {};
          Object.keys(prev).forEach((key) => {
            next[key] = false;
          });
          next.email = true;
          next.result = true;
          next.reason = true;
          next.domain = true;
          next.riskScore = true;
          next.errorType = true;
          return next;
        });
        setResultFilter('suppression');
        break;
    }
  }, [selectAll]);

  const getFilteredResults = useCallback((): ValidationResult[] => {
    switch (resultFilter) {
      case 'safe':
        return results.filter((r) => r.result === 'Safe');
      case 'suppression':
        return results.filter(
          (r) => r.result === 'Invalid' || r.result === 'Risky'
        );
      default:
        return results;
    }
  }, [results, resultFilter]);

  const enabledColumnCount = Object.values(columnState).filter(Boolean).length;
  const filteredResults = getFilteredResults();

  const handleExport = useCallback(() => {
    if (enabledColumnCount === 0) return;

    // Build column array with current enabled state
    const columns: ExportColumn[] = exportColumns.map((col) => ({
      ...col,
      enabled: columnState[col.key] ?? col.enabled,
    }));

    // Enrich results with originalEmails from dedup mapping
    let dataToExport = filteredResults;
    if (canonicalToOriginals && canonicalToOriginals.size > 0) {
      dataToExport = filteredResults.map((r) => {
        const originals = canonicalToOriginals.get(r.email);
        if (originals && originals.length > 0) {
          return { ...r, originalEmails: originals.join('; ') };
        }
        return r;
      });
    }

    if (format === 'csv') {
      const csvContent = exportToCSV(dataToExport, columns);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'validation_results.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    } else {
      exportToExcel(dataToExport, columns);
    }

    onOpenChange(false);
  }, [columnState, format, filteredResults, enabledColumnCount, onOpenChange, canonicalToOriginals]);

  const getFilterLabel = (): string | null => {
    switch (resultFilter) {
      case 'safe':
        return 'Safe only';
      case 'suppression':
        return 'Invalid & Risky only';
      default:
        return null;
    }
  };

  const filterLabel = getFilterLabel();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Export Results</DialogTitle>
          <DialogDescription>
            Choose columns, format, and filters for your export.
          </DialogDescription>
        </DialogHeader>

        {/* Format selector */}
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Format
          </Label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setFormat('csv')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all text-sm font-medium',
                format === 'csv'
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-muted hover:border-primary/30'
              )}
            >
              <FileText className="h-4 w-4" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => setFormat('xlsx')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all text-sm font-medium',
                format === 'xlsx'
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-muted hover:border-primary/30'
              )}
            >
              <FileSpreadsheet className="h-4 w-4" />
              XLSX
            </button>
          </div>
        </div>

        {/* Preset templates */}
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Presets
          </Label>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyPreset('full')}
              className={cn(
                'text-xs',
                resultFilter === 'all' && enabledColumnCount === exportColumns.length
                  ? 'border-primary bg-primary/5'
                  : ''
              )}
            >
              Full Report
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyPreset('clean')}
              className={cn(
                'text-xs',
                resultFilter === 'safe' ? 'border-primary bg-primary/5' : ''
              )}
            >
              Clean List
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyPreset('suppression')}
              className={cn(
                'text-xs',
                resultFilter === 'suppression'
                  ? 'border-primary bg-primary/5'
                  : ''
              )}
            >
              Suppression List
            </Button>
          </div>
        </div>

        {/* Filter indicator */}
        {filterLabel && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border text-sm">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{filterLabel}</span>
            <span className="text-muted-foreground">
              ({filteredResults.length} of {results.length} results)
            </span>
          </div>
        )}

        {/* Column picker */}
        <div className="space-y-2 flex-1 min-h-0">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Columns ({enabledColumnCount} of {exportColumns.length})
            </Label>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAll}
                className="text-xs h-7 px-2"
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={deselectAll}
                className="text-xs h-7 px-2"
              >
                Deselect All
              </Button>
            </div>
          </div>

          <ScrollArea className="h-[280px] rounded-lg border">
            <div className="p-3 space-y-1">
              {exportColumns.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={columnState[col.key] ?? col.enabled}
                    onCheckedChange={() => toggleColumn(col.key)}
                  />
                  <span className="text-sm">{col.label}</span>
                </label>
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="gap-2"
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={enabledColumnCount === 0}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
