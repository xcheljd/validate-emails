import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { SidebarView } from "@/components/layout/sidebar";
import { EmailInput } from "@/components/validation/email-input";
import { ValidationDashboard } from "@/components/validation/validation-dashboard";
import { ResultsTable } from "@/components/validation/results-table";
import { ResultDetails } from "@/components/validation/result-details";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { useEmailValidation, ValidationResult } from "@/hooks/use-email-validation";
import { useSettings, ProxyConfig } from "@/hooks/use-settings";
import { showWarning } from "@/lib/toast";

/** Read proxy settings directly from localStorage to avoid stale React state.
 *  useSettings() is a hook with independent useState per component — not a shared Context.
 *  When proxy is enabled in the Settings view, the App component's state is not updated. */
function getLiveProxySettings(): { enabled: boolean; proxies: ProxyConfig[] } {
  try {
    // Try 'proxy-settings' key first (used by localStorage fallback path in use-settings.ts)
    const proxyStored = localStorage.getItem('proxy-settings');
    if (proxyStored) {
      const proxy = JSON.parse(proxyStored);
      return { enabled: proxy.enabled ?? false, proxies: proxy.proxies ?? [] };
    }
    // Fall back to 'app-settings' key (used by Tauri success path in use-settings.ts)
    const appStored = localStorage.getItem('app-settings');
    if (appStored) {
      const app = JSON.parse(appStored);
      return { enabled: app.proxy?.enabled ?? false, proxies: app.proxy?.proxies ?? [] };
    }
  } catch (e) {
    console.error('Failed to read proxy settings from localStorage:', e);
  }
  return { enabled: false, proxies: [] };
}
import { formatAsCSV } from "@/lib/export-utils";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { SettingsContent } from "@/components/settings/settings-content";
import { StatisticsDashboard } from "@/components/analytics/statistics-dashboard";
import { DomainAnalysis } from "@/components/analytics/domain-analysis";
import { SessionHistory } from "@/components/history/session-history";
import { SessionDetails } from "@/components/history/session-details";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useKeyboardShortcuts } from "@/lib/keyboard-shortcuts";
import { Badge } from "@/components/ui/badge";
import { ValidationConfig } from "@/components/validation/validation-config";

function App() {
  const [emails, setEmails] = useState<string[]>([]);
  const [showDashboard, setShowDashboard] = useState(false);
  const [selectedResult, setSelectedResult] = useState<ValidationResult | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [currentView, setCurrentView] = useState<SidebarView>('validation');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

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
    allProxiesFailedState,
    continueWithoutProxy,
    retryWithCooldown,
    usingDirectConnection,
    waitingForProxy,
    waitingCooldownSecs,
  } = useEmailValidation();

  // useSettings() is kept for side effects (loading from backend),
  // but proxy guard in handleStartValidation reads from localStorage
  // to avoid stale React state (each useSettings() call has independent useState).
  useSettings();

  const handleNavigate = (view: SidebarView) => {
    setCurrentView(view);
  };

  const handleStartValidation = () => {
    if (emails.length === 0 || isProcessing) return;

    // VAL-FLR-007: Guard against proxy enabled with no proxies configured.
    // Read from localStorage directly — useSettings() hook state is stale
    // when proxy is toggled in Settings without a page reload.
    const liveProxy = getLiveProxySettings();
    if (liveProxy.enabled && liveProxy.proxies.length === 0) {
      showWarning('No proxies configured. Please add proxies in Settings or disable proxy.');
      return;
    }

    setShowDashboard(true);
    setStatusFilter("all"); // Reset filter on start
    startValidation(emails, 5, validationMode);
  };

  const handleExport = async () => {
    if (results.length === 0) return;

    const csvContent = formatAsCSV(results);

    try {
      const filePath = await save({
        filters: [{
          name: 'CSV',
          extensions: ['csv']
        }],
        defaultPath: 'validation_results.csv'
      });

      if (filePath) {
        await writeTextFile(filePath, csvContent);
      }
    } catch (err) {
      console.error("Failed to save file:", err);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'validation_results.csv';
      a.click();
    }
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
    openValidation: () => handleNavigate('validation')
  });

  const handleEmailsLoaded = (newEmails: string[]) => {
    setEmails(prev => [...new Set([...prev, ...newEmails])]);
  };

  const handleClear = () => {
    setEmails([]);
    setShowDashboard(false);
    setResults([]);
    setCurrentView('validation');
    setSelectedResult(null);
    setStatusFilter("all");
  };

  const handleViewDetails = (result: ValidationResult) => {
    setSelectedResult(result);
    setIsDetailsOpen(true);
  };

  const handleFixEmail = (correctedEmail: string) => {
    setEmails(prev => prev.map(e => e === selectedResult?.email ? correctedEmail : e));
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
    resumeSession(sessionId);
    setCurrentView('validation');
    setShowDashboard(true);
    setStatusFilter("all");
  };

  const renderTitle = () => {
    switch (currentView) {
      case 'history': return 'Validation History';
      case 'session-details': return 'Session Details';
      case 'analytics': return 'Analytics Dashboard';
      case 'settings': return 'Settings';
      case 'validation': 
        if (showDashboard) return 'Validation Results';
        if (emails.length > 0) return 'Configure Validation';
        return 'Email Validation';
      default: return 'ReachCheck';
    }
  };
  
  const renderSubtitle = () => {
     switch (currentView) {
      case 'history': return 'View past validation sessions';
      case 'session-details': return 'Detailed session information';
      case 'analytics': return 'Statistics and domain analysis';
      case 'settings': return 'Configure application preferences';
      case 'validation': 
        if (showDashboard) return `Analyzed ${progress} of ${total} emails`;
        if (emails.length > 0) return `Setup your options for ${emails.length} emails`;
        return "Upload or paste your leads to verify deliverability";
      default: return '';
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'processing':
        return <Badge variant="default" className="animate-pulse bg-blue-500 hover:bg-blue-600">Validating</Badge>;
      case 'paused':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-200">Paused</Badge>;
      case 'waiting':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-200 animate-pulse">Waiting for Proxy</Badge>;
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
               <Button variant="ghost" size="icon" onClick={() => setCurrentView('history')}>
                 <ChevronLeft className="h-4 w-4" />
               </Button>
             )}
             <div>
                <h1 className="text-2xl font-bold tracking-tight">{renderTitle()}</h1>
                <p className="text-muted-foreground text-sm hidden xs:block">{renderSubtitle()}</p>
             </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            {status !== 'idle' && (
              <div className="flex items-center gap-2 bg-muted/50 rounded-full px-3 py-1 border shadow-sm mr-2 transition-all duration-300">
                <span className="hidden md:inline text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">Status</span>
                {getStatusBadge()}
              </div>
            )}

            {currentView === 'validation' && showDashboard && status === 'idle' && (
              <>
                <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
                  Export
                </Button>
                <Button variant="outline" size="sm" onClick={handleClear} className="font-bold">
                  New
                </Button>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 p-4 sm:p-6 md:p-8">
           {currentView === 'validation' && (
             !showDashboard ? (
                emails.length === 0 ? (
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
                  />
                  <ResultsTable
                    results={results}
                    onViewDetails={handleViewDetails}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                  />
                  <ResultDetails
                    result={selectedResult}
                    open={isDetailsOpen}
                    onOpenChange={setIsDetailsOpen}
                    onFixEmail={handleFixEmail}
                  />
                </div>
             )
           )}

           {currentView === 'history' && (
             <div className="max-w-6xl mx-auto">
               <SessionHistory
                 onViewDetails={handleViewSessionDetails}
                 onResume={handleResumeSession}
                 onSessionSelected={() => {}}
               />
             </div>
           )}

           {currentView === 'session-details' && selectedSessionId && (
             <div className="max-w-6xl mx-auto">
               <SessionDetails sessionId={selectedSessionId} />
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
    </ErrorBoundary>
  );
}

export default App;