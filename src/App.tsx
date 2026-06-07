import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { SidebarView } from '@/components/layout/sidebar';
import { EmailInput } from '@/components/validation/email-input';
import { ValidationDashboard } from '@/components/validation/validation-dashboard';
import { ResultsTable } from '@/components/validation/results-table';
import { ResultDetails } from '@/components/validation/result-details';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { useEmailValidation } from '@/hooks/use-email-validation';
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
import { cleanEmailList, type CleaningResult } from '@/lib/email-cleaner';
import type { ValidationSession } from '@/lib/session-manager';

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
  } = useEmailValidation(settings.validationMode);

  // Expose test helper globally for E2E tests
  useEffect(() => {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      (window as any).__VALIDATION_TEST_HELPER__ = {
        setValidationState: setValidationStateForTest,
        setShowDashboard: (value: boolean) => setShowDashboard(value),
      };
    }
    return () => {
      delete (window as any).__VALIDATION_TEST_HELPER__;
    };
  }, [setValidationStateForTest, setShowDashboard]);

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
    startValidation(emails, 5, validationMode);
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
                    onClick={handleClear}
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
              <div className="max-w-6xl mx-auto space-y-8">
                <ValidationDashboard
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
            <div className="max-w-6xl mx-auto space-y-8">
              <StatisticsDashboard results={results} />
              <DomainAnalysis results={results} />
            </div>
          )}

          {currentView === 'settings' && (
            <div className="max-w-4xl mx-auto">
              <div className="bg-card border rounded-lg p-6">
                <SettingsContent />
              </div>
            </div>
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
          startValidation(emails, 5, validationMode);
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
    </ErrorBoundary>
  );
}

export default App;
