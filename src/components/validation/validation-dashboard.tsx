import { useState, useEffect, useRef, useMemo } from 'react';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  Info,
  Timer,
  Zap,
  Globe,
  Loader2,
  Gauge,
} from 'lucide-react';
import { ValidationResult } from '@/lib/types';
import {
  ValidationStatus,
  AllProxiesFailedPayload,
  RateLimitFailureState,
} from '@/hooks/use-email-validation';
import type { RetryTier } from './retry-modal';
import { ValidationControls } from './validation-controls';
import { RetryModal } from './retry-modal';
import { ProxyFailureModal } from './proxy-failure-modal';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ValidationDashboardProps {
  results: ValidationResult[];
  progress: number;
  total: number;
  status: ValidationStatus;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
  onRetryUnknowns?: () => void;
  onRetryWithEscalation?: (tier: RetryTier) => void;
  isEscalating?: boolean;
  escalationTier?: number;
  escalationEmailCount?: number;
  validationMode: 'quick' | 'standard' | 'thorough';
  onChangeValidationMode: (mode: 'quick' | 'standard' | 'thorough') => void;
  validationSpeed?: number;
  estimatedTimeRemaining?: number;
  statusFilter?: string;
  onStatusFilterChange?: (filter: string) => void;
  // All proxies failed handling
  allProxiesFailedState?: AllProxiesFailedPayload | null;
  onContinueWithoutProxy?: () => void;
  onRetryWithCooldown?: () => void;
  // Direct connection indicator
  usingDirectConnection?: boolean;
  // Waiting for proxy cooldown
  waitingForProxy?: boolean;
  waitingCooldownSecs?: number;
  // Rate limit failure state (auto-slowdown badge)
  rateLimitFailureState?: RateLimitFailureState;
  // Test helper: force show retry modal for E2E testing
  forceShowRetryModal?: boolean;
}

export function ValidationDashboard({
  results,
  progress,
  total,
  status,
  onPause,
  onResume,
  onStop,
  onDiscard,
  onRetryUnknowns,
  onRetryWithEscalation,
  isEscalating = false,
  escalationTier = 1,
  escalationEmailCount = 0,
  validationMode,
  validationSpeed,
  estimatedTimeRemaining,
  statusFilter = 'all',
  onStatusFilterChange,
  allProxiesFailedState,
  onContinueWithoutProxy,
  onRetryWithCooldown,
  usingDirectConnection = false,
  waitingForProxy = false,
  waitingCooldownSecs = 0,
  rateLimitFailureState,
  // Test helper: force show retry modal for E2E testing
  forceShowRetryModal = false,
}: ValidationDashboardProps) {
  const [showStopDialog, setShowStopDialog] = useState(false);
  const [showRetryModal, setShowRetryModal] = useState(false);

  const safeCount = results.filter((r) => r.result === 'Safe').length;
  const riskyCount = results.filter((r) => r.result === 'Risky').length;
  const invalidCount = results.filter((r) => r.result === 'Invalid').length;
  const unknownCount = useMemo(() => results.filter((r) => r.result === 'Unknown').length, [results]);

  // Use a latch to prevent repeatedly showing the retry modal.
  const [hasPromptedRetry, setHasPromptedRetry] = useState(false);

  // When forceShowRetryModal transitions true → false, close the modal and reset the
  // latch so the normal idle-path can re-prompt after a test run.
  const prevForceShowRef = useRef(forceShowRetryModal);
  useEffect(() => {
    const wasForced = prevForceShowRef.current;
    prevForceShowRef.current = forceShowRetryModal;
    if (wasForced && !forceShowRetryModal) {
      setShowRetryModal(false);
      setHasPromptedRetry(false);
    }
  }, [forceShowRetryModal]);

  useEffect(() => {
    if (status === 'processing') {
      setHasPromptedRetry(false);
      return;
    }

    // Allow forceShowRetryModal to override the latch for testing
    if (forceShowRetryModal) {
      setShowRetryModal(true);
      setHasPromptedRetry(true);
      return;
    }

    if (
      status === 'idle' &&
      progress === total &&
      total > 0 &&
      unknownCount > 0 &&
      !hasPromptedRetry &&
      onRetryUnknowns
    ) {
      setShowRetryModal(true);
      setHasPromptedRetry(true);
    }
  }, [
    status,
    progress,
    total,
    unknownCount,
    hasPromptedRetry,
    onRetryUnknowns,
    forceShowRetryModal,
  ]);

  const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;

  // Debug indicator for forceShowRetryModal
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  };

  const handleStopClick = () => {
    setShowStopDialog(true);
  };

  const handleConfirmStop = (save: boolean) => {
    if (save) {
      onStop();
    } else {
      onDiscard();
    }
    setShowStopDialog(false);
  };

  const handleFilterClick = (status: string) => {
    if (onStatusFilterChange) {
      onStatusFilterChange(statusFilter === status ? 'all' : status);
    }
  };

  const isPaused = status === 'paused';
  const isWaiting = status === 'waiting';

  return (
    <div className="space-y-4 md:space-y-6 w-full max-w-6xl mx-auto animate-in fade-in duration-500">
      {/* Waiting for Proxy Cooldown Indicator */}
      {waitingForProxy && isWaiting && (
        <div className="flex items-center gap-3 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 rounded-lg animate-pulse">
          <Loader2 className="h-5 w-5 text-yellow-600 dark:text-yellow-400 animate-spin" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
              Waiting for proxy to become available...
            </span>
            <span className="text-xs text-yellow-600 dark:text-yellow-400">
              Resuming in {waitingCooldownSecs}s
            </span>
          </div>
        </div>
      )}

      {/* Direct Connection Indicator */}
      {usingDirectConnection &&
        (status === 'processing' || status === 'paused') && (
          <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg">
            <Globe className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              Using direct connection (proxy bypassed)
            </span>
          </div>
        )}

      {/* Auto-Slowdown Badge */}
      {rateLimitFailureState?.isSlowdownActive &&
        !rateLimitFailureState.isAutoPaused &&
        status === 'processing' && (
          <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg">
            <Gauge className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
              Slowdown ({rateLimitFailureState.consecutiveFailures} consecutive failures)
            </span>
          </div>
        )}

      {/* Status Summary Banner */}
      {status === 'idle' && progress > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold uppercase text-muted-foreground tracking-widest">
            Selected Mode:
          </span>
          <Badge variant="outline" className="capitalize">
            {validationMode}
          </Badge>
          {usingDirectConnection && (
            <Badge
              variant="outline"
              className="text-blue-600 border-blue-300 dark:text-blue-400 dark:border-blue-700"
            >
              <Globe className="h-3 w-3 mr-1" />
              Direct Connection
            </Badge>
          )}
        </div>
      )}

      {/* Progress Section with Integrated Controls and Metrics */}
      {(status !== 'idle' || (progress > 0 && progress < total)) && (
        <Card className="overflow-hidden border-none shadow-md bg-gradient-to-br from-card to-muted/30">
          <CardContent className="pt-4 md:pt-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between w-full gap-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold flex items-center gap-2 text-muted-foreground">
                    {isWaiting
                      ? 'Waiting for Proxy'
                      : isPaused
                        ? 'Validation Paused'
                        : 'Overall Progress'}
                    <span className="text-primary font-black text-lg">
                      {percentage}%
                    </span>
                  </h3>
                  <p className="text-[10px] md:text-xs text-muted-foreground font-medium">
                    {progress} of {total} emails verified
                    {isWaiting && waitingCooldownSecs > 0 && (
                      <span className="ml-2 text-yellow-600 dark:text-yellow-400">
                        • Resuming in {waitingCooldownSecs}s
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2 bg-background/50 p-1.5 rounded-xl border shadow-sm w-full sm:w-auto justify-between sm:justify-start">
                  {/* Metrics (Timer/Speed) */}
                  {(estimatedTimeRemaining !== undefined ||
                    validationSpeed !== undefined) &&
                    (status === 'processing' ||
                      status === 'paused' ||
                      status === 'waiting') && (
                      <div
                        className={cn(
                          'flex items-center gap-3 md:gap-4 text-[10px] md:text-xs font-bold border-r pr-3 mr-1 tabular-nums transition-colors duration-300',
                          isPaused || isWaiting
                            ? 'text-muted-foreground'
                            : 'text-blue-600'
                        )}
                      >
                        <div className="flex items-center gap-1.5 min-w-[65px] md:min-w-[80px]">
                          <Zap
                            className={cn(
                              'h-3.5 w-3.5 fill-current shrink-0',
                              isPaused || isWaiting
                                ? 'text-muted-foreground'
                                : 'text-blue-600'
                            )}
                          />
                          <span className="truncate">
                            {validationSpeed || 0}
                            <span className="opacity-70">/m</span>
                          </span>
                        </div>
                        <div
                          className={cn(
                            'flex items-center gap-1.5 border-l pl-3 min-w-[65px] md:min-w-[80px]',
                            isPaused || isWaiting
                              ? 'border-muted-foreground/30'
                              : 'border-blue-200'
                          )}
                        >
                          <Timer
                            className={cn(
                              'h-3.5 w-3.5 shrink-0',
                              isPaused || isWaiting
                                ? 'text-muted-foreground'
                                : 'text-blue-600'
                            )}
                          />
                          <span>
                            ~{formatTime(estimatedTimeRemaining || 0)}
                          </span>
                        </div>
                      </div>
                    )}

                  <ValidationControls
                    status={status}
                    onPause={onPause}
                    onResume={onResume}
                    onStop={handleStopClick}
                    isCompact={true}
                  />
                </div>
              </div>

              <Progress
                value={percentage}
                className={cn(
                  'h-2 md:h-3 transition-all duration-500 bg-muted',
                  (isPaused || isWaiting) && 'opacity-60'
                )}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compact Status Grid */}
      <Card className="shadow-sm overflow-hidden border-2">
        <CardContent className="p-0">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x-2 divide-y md:divide-y-0 border-collapse">
            <button
              onClick={() => handleFilterClick('Safe')}
              className={cn(
                'p-4 md:p-6 flex flex-col items-center justify-center space-y-1 group transition-all',
                statusFilter === 'Safe'
                  ? 'bg-green-100 dark:bg-green-900/40'
                  : 'hover:bg-green-50/50 dark:hover:bg-green-950/20'
              )}
            >
              <div className="flex items-center gap-1.5 md:gap-2 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4 md:h-5 md:w-5" />
                <span className="text-[10px] font-black uppercase tracking-widest text-center">
                  Safe
                </span>
              </div>
              <div className="text-2xl md:text-3xl font-black">{safeCount}</div>
              <div className="hidden xs:block text-[10px] text-muted-foreground font-bold text-center uppercase tracking-tighter">
                Deliverable
              </div>
            </button>

            <button
              onClick={() => handleFilterClick('Risky')}
              className={cn(
                'p-4 md:p-6 flex flex-col items-center justify-center space-y-1 group transition-all',
                statusFilter === 'Risky'
                  ? 'bg-yellow-100 dark:bg-yellow-900/40'
                  : 'hover:bg-yellow-50/50 dark:hover:bg-yellow-950/20'
              )}
            >
              <div className="flex items-center gap-1.5 md:gap-2 text-yellow-600 dark:text-yellow-400">
                <AlertCircle className="h-4 w-4 md:h-5 md:w-5" />
                <span className="text-[10px] font-black uppercase tracking-widest text-center">
                  Risky
                </span>
              </div>
              <div className="text-2xl md:text-3xl font-black">
                {riskyCount}
              </div>
              <div className="hidden xs:block text-[10px] text-muted-foreground font-bold text-center uppercase tracking-tighter">
                Needs Review
              </div>
            </button>

            <button
              onClick={() => handleFilterClick('Invalid')}
              className={cn(
                'p-4 md:p-6 flex flex-col items-center justify-center space-y-1 group transition-all',
                statusFilter === 'Invalid'
                  ? 'bg-red-100 dark:bg-red-900/40'
                  : 'hover:bg-red-50/50 dark:hover:bg-red-950/20'
              )}
            >
              <div className="flex items-center gap-1.5 md:gap-2 text-red-600 dark:text-red-400">
                <XCircle className="h-4 w-4 md:h-5 md:w-5" />
                <span className="text-[10px] font-black uppercase tracking-widest text-center">
                  Invalid
                </span>
              </div>
              <div className="text-2xl md:text-3xl font-black">
                {invalidCount}
              </div>
              <div className="hidden xs:block text-[10px] text-muted-foreground font-bold text-center uppercase tracking-tighter">
                Bounce Likely
              </div>
            </button>

            <button
              onClick={() => handleFilterClick('Unknown')}
              className={cn(
                'p-4 md:p-6 flex flex-col items-center justify-center space-y-1 group transition-all',
                statusFilter === 'Unknown'
                  ? 'bg-slate-200 dark:bg-slate-700/40'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
              )}
            >
              <div className="flex items-center gap-1.5 md:gap-2 text-slate-500 dark:text-slate-400">
                <Info className="h-4 w-4 md:h-5 md:w-5" />
                <span className="text-[10px] font-black uppercase tracking-widest text-center">
                  Unknown
                </span>
              </div>
              <div className="text-2xl md:text-3xl font-black">
                {unknownCount}
              </div>
              <div className="hidden xs:block text-[10px] text-muted-foreground font-bold text-center uppercase tracking-tighter">
                Timeout/Error
              </div>
            </button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Stop Validation?</DialogTitle>
            <DialogDescription>
              You are about to stop the validation process. Would you like to
              keep the results collected so far or discard them?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => setShowStopDialog(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => handleConfirmStop(false)}>
              Discard Results
            </Button>
            <Button variant="default" onClick={() => handleConfirmStop(true)}>
              Save & Stop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RetryModal
        open={showRetryModal}
        unknownCount={unknownCount}
        onRetry={(tier) => {
          // For auto-escalate, keep the modal open to show escalation progress
          if (tier !== 'auto-escalate') {
            setShowRetryModal(false);
          }
          if (onRetryWithEscalation) {
            onRetryWithEscalation(tier);
          } else {
            onRetryUnknowns?.();
          }
        }}
        onCancel={() => setShowRetryModal(false)}
        isEscalating={isEscalating}
        escalationTier={escalationTier}
        escalationEmailCount={escalationEmailCount}
        testMode={forceShowRetryModal}
      />

      {allProxiesFailedState && (
        <ProxyFailureModal
          open={!!allProxiesFailedState}
          failedProxies={allProxiesFailedState.failedProxies}
          totalProxies={allProxiesFailedState.totalProxies}
          badCount={allProxiesFailedState.badCount}
          cooldownCount={allProxiesFailedState.cooldownCount}
          nearestCooldownSecs={allProxiesFailedState.nearestCooldownSecs}
          onContinueWithoutProxy={() => {
            onContinueWithoutProxy?.();
          }}
          onRetryWithCooldown={() => {
            onRetryWithCooldown?.();
          }}
          onStop={() => {
            onStop();
          }}
        />
      )}
    </div>
  );
}
