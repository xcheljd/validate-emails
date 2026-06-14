import { useState, useEffect, useRef } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { SidebarView } from '@/components/layout/sidebar';
import { EmailInput } from '@/components/validation/email-input';
import { ValidationDashboard } from '@/components/validation/validation-dashboard';
import { ResultsTable } from '@/components/validation/results-table';
import { ResultDetails } from '@/components/validation/result-details';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { useEmailValidation, type ValidationStatus } from '@/hooks/use-email-validation';
import { ValidationResult } from '@/lib/types';
import { useSettings, SettingsProvider } from '@/hooks/use-settings';
import { showWarning } from '@/lib/toast';
import { SettingsContent } from '@/components/settings/settings-content';
import { StatisticsDashboard } from '@/components/analytics/statistics-dashboard';
import { DomainAnalysis } from '@/components/analytics/domain-analysis';
import { SessionHistory } from '@/components/history/session-history';
import { SessionDetails } from '@/components/history/session-details';
import { SessionDiffView } from '@/components/history/session-diff';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { useKeyboardShortcuts } from '@/lib/keyboard-shortcuts';
import { Badge } from '@/components/ui/badge';
import { ValidationConfig } from '@/components/validation/validation-config';
import { ExportDialog } from '@/components/validation/export-dialog';
import { CleaningReport } from '@/components/validation/cleaning-report';
import { CrashRecoveryDialog } from '@/components/validation/crash-recovery-dialog';
import { RateLimitWarningDialog, estimateValidationTime } from '@/components/validation/rate-limit-warning-dialog';
import { AutoPauseModal } from '@/components/validation/auto-pause-modal';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cleanEmailList, type CleaningResult } from '@/lib/email-cleaner';
import type { ValidationSession } from '@/lib/session-manager';

// Global test helper type declaration
interface ValidationTestHelper {
  setValidationState: (state: Partial<{
    results: ValidationResult[];
    status: ValidationStatus;
    progress: number;
    total: number;
    validationMode: 'quick' | 'standard' | 'thorough';
  }>) => void;
  getValidationState: () => {
    results: ValidationResult[];
    status: ValidationStatus;
    progress: number;
    total: number;
    validationMode: 'quick' | 'standard' | 'thorough';
    isEscalating: boolean;
    escalationTier: number;
    escalationEmailCount: number;
    rateLimitFailureState: {
      consecutiveFailures: number;
      isSlowdownActive: boolean;
      isAutoPaused: boolean;
    };
  };
  setShowDashboard: (value: boolean) => void;
  resetRateLimitState: () => void;
  resetEscalationState: () => void;
  setEscalationState: (state: Partial<{
    isEscalating: boolean;
    escalationTier: number;
    escalationEmailCount: number;
  }>) => void;
  setRateLimitFailureState: (state: Partial<{
    consecutiveFailures: number;
    isSlowdownActive: boolean;
    isAutoPaused: boolean;
  }>) => void;
  resetRetryPrompt: () => void;
  retryUnknowns: () => void;
  setForceShowRetryModal: (value: boolean) => void;
  setDiffSessions: (sessionA: ValidationSession | null, sessionB: ValidationSession | null) => void;
  clearDiffSessions: () => void;
}

declare global {
  interface Window {
    __VALIDATION_TEST_HELPER__?: ValidationTestHelper;
  }
}

function App() {
  return (
    <SettingsProvider>
      <AppContent />
    </SettingsProvider>
  );
}

function AppContent() {
  const [emails, setEmails] = useState<string[]>([]);
  const [showDashboard, setShowDashboard] = useState(false);
  const [selectedResult, setSelectedResult] = useState<ValidationResult | null>(
    null
  );
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [currentView, setCurrentView] = useState<SidebarView>('validation');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [cleaningResult, setCleaningResult] = useState<CleaningResult | null>(
    null
  );
  const [originalEmails, setOriginalEmails] = useState<string[]>([]);
  /** Persists the dedup mapping for export even after cleaning report is dismissed */
  const [dedupMapping, setDedupMapping] = useState<Map<string, string[]> | null>(null);
  /** Controls the crash recovery dialog visibility on startup */
  const [showCrashRecovery, setShowCrashRecovery] = useState(true);
  /** Controls the rate limit warning dialog */
  const [showRateLimitWarning, setShowRateLimitWarning] = useState(false);
  /** Controls the clear results confirmation dialog */
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  /** Stores the estimated time for the rate limit warning */
  const [rateLimitEstimatedTime, setRateLimitEstimatedTime] = useState('');
  /** Session diff state: two sessions to compare */
  const [diffSessionA, setDiffSessionA] = useState<ValidationSession | null>(null);
  const [diffSessionB, setDiffSessionB] = useState<ValidationSession | null>(null);

  // Read settings from shared context — no more stale independent useState
  const { settings } = useSettings();

  const {
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
    onChangeValidationMode,
    validationSpeed,
    estimatedTimeRemaining,
    resumeSession,
    retryUnknowns,
    retryWithEscalation,
    isEscalating,
    escalationTier,
    escalationEmailCount,
    allProxiesFailedState,
    continueWithoutProxy,
    retryWithCooldown,
    usingDirectConnection,
    waitingForProxy,
    waitingCooldownSecs,
    rateLimitFailureState,
    resumeFromAutoPause,
    stopFromAutoPause,
    setValidationStateForTest,
    getValidationStateForTest,
    resetRateLimitFailureStateForTest,
    resetEscalationStateForTest,
    setEscalationStateForTest,
    setRateLimitFailureStateForTest,
  } = useEmailValidation(settings.validationMode, settings.autoSaveInterval);

  const [forceShowRetryModal, setForceShowRetryModal] = useState(false);
  const [dashboardKey, setDashboardKey] = useState(0);

  // Use refs to store test helper functions to avoid recreation on dependency changes
  const testHelperRef = useRef({
    setValidationState: setValidationStateForTest,
    getValidationState: getValidationStateForTest,
    setShowDashboard: (value: boolean) => setShowDashboard(value),
    resetRateLimitState: resetRateLimitFailureStateForTest,
    resetEscalationState: resetEscalationStateForTest,
    setEscalationState: setEscalationStateForTest,
    setRateLimitFailureState: setRateLimitFailureStateForTest,
    resetRetryPrompt: () => setDashboardKey((k) => k + 1),
    retryUnknowns: () => retryUnknowns(),
    setForceShowRetryModal: (value: boolean) => setForceShowRetryModal(value),
    // Session diff test helpers
    setDiffSessions: (sessionA: ValidationSession | null, sessionB: ValidationSession | null) => {
      setDiffSessionA(sessionA);
      setDiffSessionB(sessionB);
      setCurrentView('session-diff');
    },
    clearDiffSessions: () => {
      setDiffSessionA(null);
      setDiffSessionB(null);
      setCurrentView('history');
    },
  });

  // Update ref when functions change (stable setters won't trigger this)
  useEffect(() => {
    testHelperRef.current.setValidationState = setValidationStateForTest;
    testHelperRef.current.getValidationState = getValidationStateForTest;
    testHelperRef.current.setShowDashboard = (value: boolean) => setShowDashboard(value);
    testHelperRef.current.resetRateLimitState = resetRateLimitFailureStateForTest;
    testHelperRef.current.resetEscalationState = resetEscalationStateForTest;
    testHelperRef.current.setEscalationState = setEscalationStateForTest;
    testHelperRef.current.setRateLimitFailureState = setRateLimitFailureStateForTest;
    testHelperRef.current.retryUnknowns = () => retryUnknowns();
  }, [setValidationStateForTest, getValidationStateForTest, setShowDashboard, resetRateLimitFailureStateForTest, resetEscalationStateForTest, setEscalationStateForTest, setRateLimitFailureStateForTest, retryUnknowns]);

  // Expose test helper globally for E2E tests (only in test mode, not development)
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      window.__VALIDATION_TEST_HELPER__ = testHelperRef.current;
    }
    return () => {
      delete window.__VALIDATION_TEST_HELPER__;
    };
  }, []);

  // Add test mode attribute to body for CSS animation disabling
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      if (forceShowRetryModal) {
        document.body.setAttribute('data-test-mode', 'true');
      } else {
        document.body.removeAttribute('data-test-mode');
      }
    }
    return () => {
      document.body.removeAttribute('data-test-mode');
    };
  }, [forceShowRetryModal]);

  const handleNavigate = (view: SidebarView) => {
    setCurrentView(view);
  };

  const handleStartValidation = () => {
    if (emails.length === 0 || isProcessing) return;

    // VAL-FLR-007: Guard against proxy enabled with no proxies configured.
    // Settings come from shared context — changes in SettingsContent are reflected here immediately.
    const proxy = settings.proxy;
    if (proxy.enabled && proxy.proxies.length === 0) {
      showWarning(
        'No proxies configured. Please add proxies in Settings or disable proxy.'
      );
      return;
    }

    // Check max emails per session
    const maxEmails = settings.maxEmailsPerSession;
    if (maxEmails > 0 && emails.length > maxEmails) {
      const estTime = estimateValidationTime(
        emails.length,
        settings.rateLimitMaxPerSecond,
        settings.rateLimitMaxPerMinute
      );
      setRateLimitEstimatedTime(estTime);
      setShowRateLimitWarning(true);
      return;
    }

    setShowDashboard(true);
    setStatusFilter('all'); // Reset filter on start
    startValidation(emails, settings.concurrency, validationMode);
  };

  const handleExport = () => {
    if (results.length === 0) return;
    setIsExportDialogOpen(true);
  };

  useKeyboardShortcuts({
    startValidation: handleStartValidation,
    pauseValidation: () => {
      if (status === 'processing') pauseValidation();
    },
    resumeValidation: () => {
      if (status === 'paused') resumeValidation();
    },
    stopValidation: () => {
      if (isProcessing || status === 'paused') stopValidation();
    },
    exportCSV: handleExport,
    openSettings: () => handleNavigate('settings'),
    openHistory: () => handleNavigate('history'),
    openValidation: () => handleNavigate('validation'),
  });

  const handleEmailsLoaded = (newEmails: string[]) => {
    const merged = [...new Set([...emails, ...newEmails])];
    setOriginalEmails(merged);
    const result = cleanEmailList(merged);
    setCleaningResult(result);
    setDedupMapping(result.canonicalToOriginals);
    setEmails(result.cleanedEmails);
  };

  const handleClear = () => {
    setEmails([]);
    setShowDashboard(false);
    setResults([]);
    setCurrentView('validation');
    setSelectedResult(null);
    setStatusFilter('all');
    setCleaningResult(null);
    setOriginalEmails([]);
    setDedupMapping(null);
  };

  const handleClearClick = () => {
    if (results.length > 0) {
      setShowClearConfirm(true);
    } else {
      handleClear();
    }
  };

  const handleViewDetails = (result: ValidationResult) => {
    setSelectedResult(result);
    setIsDetailsOpen(true);
  };

  const handleFixEmail = (correctedEmail: string) => {
    setEmails((prev) =>
      prev.map((e) => (e === selectedResult?.email ? correctedEmail : e))
    );
    setIsDetailsOpen(false);
  };

  const handleDiscard = () => {
    stopValidation();
    handleClear();
  };

  const handleViewSessionDetails = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setCurrentView('session-details');
  };

  const handleResumeSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    resumeSession(sessionId, settings.concurrency);
    setCurrentView('validation');
    setShowDashboard(true);
    setStatusFilter('all');
    setShowCrashRecovery(false);
  };

  const handleCrashRecoveryDismiss = () => {
    setShowCrashRecovery(false);
  };

  const handleCompareSessions = (sessionA: ValidationSession, sessionB: ValidationSession) => {
    setDiffSessionA(sessionA);
    setDiffSessionB(sessionB);
    setCurrentView('session-diff');
  };

  const handleCleaningProceed = () => {
    // Proceed with cleaned emails — already set via handleEmailsLoaded
    setCleaningResult(null);
  };

  const handleCleaningBack = () => {
    setEmails([]);
    setCleaningResult(null);
    setOriginalEmails([]);
  };

  const handleCleaningSkip = () => {
    // Use original uncleaned emails
    setEmails(originalEmails);
    setCleaningResult(null);
    setDedupMapping(null);
  };

  const renderTitle = () => {
    switch (currentView) {
      case 'history':
        return 'Validation History';
      case 'session-details':
        return 'Session Details';
      case 'session-diff':
        return 'Session Comparison';
      case 'analytics':
        return 'Analytics Dashboard';
      case 'settings':
        return 'Settings';
      case 'validation':
        if (showDashboard) return 'Validation Results';
        if (cleaningResult) return 'Cleaning Report';
        if (emails.length > 0) return 'Configure Validation';
        return 'Email Validation';
      default:
        return 'ReachCheck';
    }
  };

  const renderSubtitle = () => {
    switch (currentView) {
      case 'history':
        return 'View past validation sessions';
      case 'session-details':
        return 'Detailed session information';
      case 'session-diff':
        return 'Compare results between two sessions';
      case 'analytics':
        return 'Statistics and domain analysis';
      case 'settings':
        return 'Configure application preferences';
      case 'validation':
        if (showDashboard) return `Analyzed ${progress} of ${total} emails`;
        if (cleaningResult) return `${cleaningResult.finalCount} clean emails from ${cleaningResult.originalCount} original`;
        if (emails.length > 0)
          return `Setup your options for ${emails.length} emails`;
        return 'Upload or paste your leads to verify deliverability';
      default:
        return '';
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'processing':
        return (
          <Badge
            variant="default"
            className="animate-pulse bg-blue-500 hover:bg-blue-600"
          >
            Validating
          </Badge>
        );
      case 'paused':
        return (
          <Badge
            variant="secondary"
            className="bg-yellow-100 text-yellow-800 border-yellow-200"
          >
            Paused
          </Badge>
        );
      case 'waiting':
        return (
          <Badge
            variant="secondary"
            className="bg-yellow-100 text-yellow-800 border-yellow-200 animate-pulse"
          >
            Waiting for Proxy
          </Badge>
        );
      case 'stopping':
        return <Badge variant="destructive">Stopping...</Badge>;
      default:
        return null;
    }
  };

  return (
    <ErrorBoundary>
      <MainLayout currentView={currentView} onNavigate={handleNavigate}>
        <header className="border-b px-4 sm:px-6 md:px-8 py-4 md:py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-card sticky top-0 z-50">
          <div className="flex items-center gap-2 sm:gap-4">
            {currentView === 'session-details' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentView('history')}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            {currentView === 'session-diff' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentView('history')}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {renderTitle()}
              </h1>
              <p className="text-muted-foreground text-sm hidden xs:block">
                {renderSubtitle()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            {status !== 'idle' && (
              <div className="flex items-center gap-2 bg-muted/50 rounded-full px-3 py-1 border shadow-sm mr-2 transition-all duration-300">
                <span className="hidden md:inline text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">
                  Status
                </span>
                {getStatusBadge()}
              </div>
            )}

            {currentView === 'validation' &&
              showDashboard &&
              status === 'idle' && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExport}
                    className="gap-2"
                  >
                    Export
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearClick}
                    className="font-bold"
                  >
                    New
                  </Button>
                </>
              )}
          </div>
        </header>

        <div className="flex-1 p-4 sm:p-6 md:p-8">
          {currentView === 'validation' &&
            (!showDashboard ? (
              cleaningResult ? (
                <CleaningReport
                  result={cleaningResult}
                  onProceed={handleCleaningProceed}
                  onBack={handleCleaningBack}
                  onSkip={handleCleaningSkip}
                />
              ) : emails.length === 0 ? (
                <div className="max-w-4xl mx-auto space-y-8">
                  <EmailInput onEmailsLoaded={handleEmailsLoaded} />
                </div>
              ) : (
                <ValidationConfig
                  emails={emails}
                  validationMode={validationMode}
                  onModeChange={onChangeValidationMode}
                  onStart={handleStartValidation}
                  onClear={handleClear}
                  onBack={() => setEmails([])}
                />
              )
            ) : (
              <ErrorBoundary inline>
                <div className="max-w-6xl mx-auto space-y-8">
                  <ValidationDashboard
                    key={dashboardKey}
                  results={results}
                  progress={progress}
                  total={total}
                  status={status}
                  onPause={pauseValidation}
                  onResume={resumeValidation}
                  onStop={stopValidation}
                  onDiscard={handleDiscard}
                  onRetryUnknowns={retryUnknowns}
                  onRetryWithEscalation={(tier) => {
                    if (tier === 'auto-escalate') {
                      retryWithEscalation('quick', true);
                    } else {
                      retryWithEscalation(tier, false);
                    }
                  }}
                  isEscalating={isEscalating}
                  escalationTier={escalationTier}
                  escalationEmailCount={escalationEmailCount}
                  validationMode={validationMode}
                  onChangeValidationMode={onChangeValidationMode}
                  validationSpeed={validationSpeed}
                  estimatedTimeRemaining={estimatedTimeRemaining}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  allProxiesFailedState={allProxiesFailedState}
                  onContinueWithoutProxy={continueWithoutProxy}
                  onRetryWithCooldown={retryWithCooldown}
                  usingDirectConnection={usingDirectConnection}
                  waitingForProxy={waitingForProxy}
                  waitingCooldownSecs={waitingCooldownSecs}
                  rateLimitFailureState={rateLimitFailureState}
                  forceShowRetryModal={forceShowRetryModal}
                />
                <ResultsTable
                  results={results}
                  onViewDetails={handleViewDetails}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  onDeleteResults={(emailsToDelete) => {
                    setResults((prev) =>
                      prev.filter((r) => !emailsToDelete.has(r.email))
                    );
                  }}
                />
                <ResultDetails
                  result={selectedResult}
                  open={isDetailsOpen}
                  onOpenChange={setIsDetailsOpen}
                  onFixEmail={handleFixEmail}
                />
                </div>
              </ErrorBoundary>
            ))}

          {currentView === 'history' && (
            <div className="max-w-6xl mx-auto">
              <SessionHistory
                onViewDetails={handleViewSessionDetails}
                onResume={handleResumeSession}
                onSessionSelected={() => {}}
                onCompareSessions={handleCompareSessions}
              />
            </div>
          )}

          {currentView === 'session-details' && selectedSessionId && (
            <div className="max-w-6xl mx-auto">
              <SessionDetails sessionId={selectedSessionId} />
            </div>
          )}

          {currentView === 'session-diff' && diffSessionA && diffSessionB && (
            <div className="max-w-6xl mx-auto">
              <SessionDiffView
                sessionA={diffSessionA}
                sessionB={diffSessionB}
                onBack={() => setCurrentView('history')}
              />
            </div>
          )}

          {currentView === 'analytics' && (
            <ErrorBoundary inline>
              <div className="max-w-6xl mx-auto space-y-8">
                <StatisticsDashboard results={results} />
                <DomainAnalysis results={results} />
              </div>
            </ErrorBoundary>
          )}

          {currentView === 'settings' && (
            <ErrorBoundary inline>
              <div className="max-w-4xl mx-auto">
                <div className="bg-card border rounded-lg p-6">
                  <SettingsContent />
                </div>
              </div>
            </ErrorBoundary>
          )}
        </div>
      </MainLayout>

      <ExportDialog
        open={isExportDialogOpen}
        onOpenChange={setIsExportDialogOpen}
        results={results}
        canonicalToOriginals={dedupMapping}
      />

      {showCrashRecovery && (
        <CrashRecoveryDialog
          onResume={handleResumeSession}
          onDismiss={handleCrashRecoveryDismiss}
        />
      )}

      <RateLimitWarningDialog
        open={showRateLimitWarning}
        onOpenChange={setShowRateLimitWarning}
        emailCount={emails.length}
        maxEmails={settings.maxEmailsPerSession}
        estimatedTime={rateLimitEstimatedTime}
        onCancel={() => setShowRateLimitWarning(false)}
        onProceed={() => {
          setShowRateLimitWarning(false);
          setShowDashboard(true);
          setStatusFilter('all');
          startValidation(emails, settings.concurrency, validationMode);
        }}
      />

      <AutoPauseModal
        open={rateLimitFailureState.isAutoPaused && status === 'paused' && !allProxiesFailedState}
        onOpenChange={(open) => {
          if (!open) {
            // Don't auto-resume on close
          }
        }}
        failureCount={rateLimitFailureState.consecutiveFailures}
        onResume={resumeFromAutoPause}
        onStop={stopFromAutoPause}
      />

      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clear All Results?</DialogTitle>
            <DialogDescription>
              This will discard all {results.length} validation results and
              return to the email input screen. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => setShowClearConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowClearConfirm(false);
                handleClear();
              }}
            >
              Clear Everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ErrorBoundary>
  );
}

export default App;
