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
import { formatAsCSV } from "@/lib/export-utils";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { SettingsContent } from "@/components/settings/settings-panel";
import { StatisticsDashboard } from "@/components/analytics/statistics-dashboard";
import { DomainAnalysis } from "@/components/analytics/domain-analysis";
import { SessionHistory } from "@/components/history/session-history";
import { SessionDetails } from "@/components/history/session-details";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useKeyboardShortcuts } from "@/lib/keyboard-shortcuts";

function App() {
  const [emails, setEmails] = useState<string[]>([]);
  const [showDashboard, setShowDashboard] = useState(false);
  const [selectedResult, setSelectedResult] = useState<ValidationResult | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [currentView, setCurrentView] = useState<SidebarView>('validation');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

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
    resumeSession
  } = useEmailValidation();

  const handleNavigate = (view: SidebarView) => {
    setCurrentView(view);
  };

  const handleStartValidation = () => {
    if (emails.length === 0 || isProcessing) return;
    setShowDashboard(true);
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
  };

  const renderTitle = () => {
    switch (currentView) {
      case 'history': return 'Validation History';
      case 'session-details': return 'Session Details';
      case 'analytics': return 'Analytics Dashboard';
      case 'settings': return 'Settings';
      case 'validation': return showDashboard ? 'Validation Results' : 'Email Validation';
      default: return 'Email Validator';
    }
  };
  
  const renderSubtitle = () => {
     switch (currentView) {
      case 'history': return 'View past validation sessions';
      case 'session-details': return 'Detailed session information';
      case 'analytics': return 'Statistics and domain analysis';
      case 'settings': return 'Configure application preferences';
      case 'validation': return showDashboard ? `Analyzed ${progress} of ${total} emails` : "Upload or paste your leads to verify deliverability";
      default: return '';
    }
  };

  return (
    <ErrorBoundary>
      <MainLayout currentView={currentView} onNavigate={handleNavigate}>
        <header className="border-b px-4 sm:px-6 md:px-8 py-4 md:py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-card">
          <div className="flex items-center gap-2 sm:gap-4">
             {currentView === 'session-details' && (
               <Button variant="ghost" size="icon" onClick={() => setCurrentView('history')}>
                 <ChevronLeft className="h-4 w-4" />
               </Button>
             )}
             <div>
                <h1 className="text-2xl font-bold tracking-tight">{renderTitle()}</h1>
                <p className="text-muted-foreground text-sm">{renderSubtitle()}</p>
             </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {currentView === 'validation' && !showDashboard && emails.length > 0 && (
              <>
                <Button variant="ghost" size="sm" onClick={handleClear} disabled={isProcessing}>
                  Clear
                </Button>
                <Button size="sm" onClick={handleStartValidation} disabled={isProcessing} className="gap-2">
                  Start ({emails.length})
                </Button>
              </>
            )}
            {currentView === 'validation' && showDashboard && status === 'idle' && (
              <>
                <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
                  Export
                </Button>
                <Button variant="outline" size="sm" onClick={handleClear}>
                  New
                </Button>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 p-4 sm:p-6 md:p-8">
           {currentView === 'validation' && (
             !showDashboard ? (
                <div className="max-w-4xl mx-auto space-y-8">
                  <EmailInput onEmailsLoaded={handleEmailsLoaded} />
                  {emails.length > 0 && (
                    <div className="bg-card border rounded-lg p-6">
                      <h3 className="text-sm font-medium mb-4 uppercase tracking-wider text-muted-foreground">
                        Loaded Emails ({emails.length})
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                         {emails.slice(0, 20).map((email, i) => (
                           <div key={i} className="text-sm font-mono truncate bg-muted/30 px-2 py-1 rounded">
                             {email}
                           </div>
                         ))}
                         {emails.length > 20 && (
                           <div className="text-sm text-muted-foreground italic px-2 py-1">
                             ... and {emails.length - 20} more
                           </div>
                         )}
                      </div>
                    </div>
                  )}
                </div>
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
                    validationMode={validationMode}
                    onChangeValidationMode={onChangeValidationMode}
                    validationSpeed={validationSpeed}
                    estimatedTimeRemaining={estimatedTimeRemaining}
                  />
                  <ResultsTable
                    results={results}
                    onViewDetails={handleViewDetails}
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