import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { Zap, ShieldCheck, ShieldAlert, Check, ArrowUpCircle } from 'lucide-react';

export type RetryTier = 'quick' | 'standard' | 'thorough' | 'auto-escalate';

interface TierConfig {
  key: 'quick' | 'standard' | 'thorough';
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

const TIERS: TierConfig[] = [
  {
    key: 'quick',
    label: 'Tier 1: Quick',
    description: 'MX only — fast sweep',
    icon: <Zap className="h-4 w-4" />,
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-500/10',
  },
  {
    key: 'standard',
    label: 'Tier 2: Standard',
    description: 'Full SMTP + proxy rotation',
    icon: <ShieldCheck className="h-4 w-4" />,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-500/10',
  },
  {
    key: 'thorough',
    label: 'Tier 3: Thorough',
    description: 'Extended timeout + low concurrency',
    icon: <ShieldAlert className="h-4 w-4" />,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-500/10',
  },
];

interface RetryModalProps {
  open: boolean;
  unknownCount: number;
  onRetry: (tier: RetryTier) => void;
  onCancel: () => void;
  isEscalating?: boolean;
  escalationTier?: number;
  escalationEmailCount?: number;
}

export function RetryModal({
  open,
  unknownCount,
  onRetry,
  onCancel,
  isEscalating = false,
  escalationTier = 1,
  escalationEmailCount = 0,
}: RetryModalProps) {
  const [selectedTier, setSelectedTier] = useState<'quick' | 'standard' | 'thorough'>('standard');
  const [autoEscalate, setAutoEscalate] = useState(false);

  // Reset to defaults when modal opens
  useEffect(() => {
    if (open) {
      setSelectedTier('standard');
      setAutoEscalate(false);
    }
  }, [open]);

  const handleRetry = () => {
    if (autoEscalate) {
      onRetry('auto-escalate');
    } else {
      onRetry(selectedTier);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onCancel();
    }
  };

  const handleTierClick = (tier: 'quick' | 'standard' | 'thorough') => {
    setSelectedTier(tier);
    // Deselect auto-escalate when manually picking a tier
    if (autoEscalate) {
      setAutoEscalate(false);
    }
  };

  const handleAutoEscalateChange = (checked: boolean | 'indeterminate') => {
    setAutoEscalate(checked === true);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retry Unknown Emails</DialogTitle>
          <DialogDescription>
            {unknownCount} emails have unknown status. Select a retry tier or
            enable auto-escalation to progressively retry with more thorough
            validation modes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Tier Selection */}
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Select retry tier
            </Label>
            <div className="grid grid-cols-1 gap-2">
              {TIERS.map((tier) => {
                const isSelected = !autoEscalate && selectedTier === tier.key;
                return (
                  <button
                    key={tier.key}
                    onClick={() => handleTierClick(tier.key)}
                    role="button"
                    aria-pressed={isSelected}
                    disabled={isEscalating}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left',
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-muted hover:border-primary/30 hover:shadow-sm',
                      isEscalating && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div
                      className={cn(
                        'p-1.5 rounded-md',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : cn(tier.bgColor, tier.color)
                      )}
                    >
                      {tier.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold">{tier.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {tier.description}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="h-5 w-5 bg-primary rounded-full flex items-center justify-center shrink-0">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Auto-Escalate Toggle */}
          <div
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg border-2 transition-all cursor-pointer',
              autoEscalate
                ? 'border-primary bg-primary/5 shadow-sm'
                : 'border-muted hover:border-primary/30',
              isEscalating && 'opacity-50 cursor-not-allowed'
            )}
            onClick={() => {
              if (!isEscalating) {
                handleAutoEscalateChange(!autoEscalate);
              }
            }}
          >
            <Checkbox
              id="auto-escalate"
              checked={autoEscalate}
              onCheckedChange={handleAutoEscalateChange}
              disabled={isEscalating}
              aria-label="Auto-Escalate"
            />
            <div className="flex-1 min-w-0">
              <Label
                htmlFor="auto-escalate"
                className="text-sm font-bold cursor-pointer"
              >
                Auto-Escalate
              </Label>
              <p className="text-xs text-muted-foreground">
                Progressively retry through Quick → Standard → Thorough
              </p>
            </div>
            <ArrowUpCircle
              className={cn(
                'h-5 w-5 shrink-0',
                autoEscalate
                  ? 'text-primary'
                  : 'text-muted-foreground'
              )}
            />
          </div>

          {/* Escalation Progress */}
          {isEscalating && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-2 w-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
                  Tier {escalationTier} of 3 — {TIERS[escalationTier - 1]?.label.split(': ')[1] || 'Quick'}
                </span>
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                Retrying {escalationEmailCount} emails
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isEscalating}>
            Cancel
          </Button>
          <Button onClick={handleRetry} disabled={isEscalating}>
            {isEscalating ? 'Escalating...' : 'Retry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
