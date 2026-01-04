import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmailInput } from "@/components/validation/email-input";
import { ValidationDashboard } from "@/components/validation/validation-dashboard";
import { ResultsTable } from "@/components/validation/results-table";
import { ResultDetails } from "@/components/validation/result-details";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Settings, History } from "lucide-react";
import { useEmailValidation, ValidationResult } from "@/hooks/use-email-validation";
import { formatAsCSV } from "@/lib/export-utils";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { StatisticsDashboard } from "@/components/analytics/statistics-dashboard";
import { DomainAnalysis } from "@/components/analytics/domain-analysis";
import { SessionHistory } from "@/components/history/session-history";
import { SessionDetails } from "@/components/history/session-details";
import { ErrorBoundary } from "@/components/ui/error-boundary";

type CurrentView = 'validation' | 'history' | 'session-details' | 'analytics';

function App() {
  const [emails, setEmails] = useState<string[]>([]);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedResult, setSelectedResult] = useState<ValidationResult | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [currentView, setCurrentView] = useState<CurrentView>('validation');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const {
    results,
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

  const isProcessing = status === 'processing' || status === 'paused' || status === 'stopping';

  const handleEmailsLoaded = (newEmails: string[]) => {
    setEmails(prev => [...new Set([...prev, ...newEmails])]);
  };

  const handleClear = () => {
    setEmails([]);
    setShowDashboard(false);
    setResults([]);
    setCurrentView('validation');
  };

  const handleStartValidation = () => {
    setShowDashboard(true);
    startValidation(emails, 5, validationMode);
  };

  const handleBack = () => {
    if (currentView === 'session-details') {
      setCurrentView('history');
    } else if (currentView === 'history') {
      setCurrentView('validation');
    } else if (currentView === 'analytics') {
      setCurrentView('validation');
    } else {
      setShowDashboard(false);
    }
  };

  const handleViewDetails = (result: ValidationResult) => {
    setSelectedResult(result);
    setIsDetailsOpen(true);
  };

  const handleFixEmail = (correctedEmail: string) => {
    setEmails(prev => prev.map(e => e === selectedResult?.email ? correctedEmail : e));
    setIsDetailsOpen(false);
  };

  const handleClear = () => {
    setEmails([]);
    setShowDashboard(false);
    setResults([]);
    setCurrentView('validation');
    setSelectedResult(null);
  };

  const handleDiscard = () => {
    stopValidation();
    handleClear();
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

  const handleViewSessionDetails = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setCurrentView('session-details');
  };

  const handleResumeSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    resumeSession(sessionId);
  };

  return (
    <ErrorBoundary>
      <MainLayout>
        <header className="border-b px-8 py-6 flex items-center justify-between bg-card">
        <div className="flex items-center gap-4">
          {(showDashboard || currentView !== 'validation') && (
            <Button variant="ghost" size="icon" onClick={handleBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <Settings
            onClick={() => setShowSettings(!showSettings)}
            className="h-5 w-5 cursor-pointer"
          />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {currentView === 'history' && "Validation History"}
            {currentView === 'session-details' && "Session Details"}
            {currentView === 'analytics' && "Analytics Dashboard"}
            {currentView === 'validation' && (showDashboard ? "Validation Results" : "Email Validation")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {currentView === 'history' && "View past validation sessions"}
            {currentView === 'session-details' && "Detailed session information"}
            {currentView === 'analytics' && "Statistics and domain analysis"}
            {currentView === 'validation' && (
              showDashboard
                ? `Analyzed ${progress} of ${total} emails`
                : "Upload or paste your leads to verify deliverability"
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {currentView === 'validation' && !showDashboard && emails.length > 0 && (
            <>
              <Button variant="ghost" onClick={handleClear} disabled={isProcessing}>
                Clear List
              </Button>
              <Button onClick={handleStartValidation} disabled={isProcessing} className="gap-2">
                Start Validation ({emails.length})
              </Button>
            </>
          )}
          {currentView === 'validation' && showDashboard && status === 'idle' && (
            <>
              <Button variant="outline" onClick={() => setCurrentView('analytics')} className="gap-2">
                Analytics
              </Button>
              <Button variant="outline" onClick={handleExport} className="gap-2">
                Export CSV
              </Button>
              <Button variant="outline" onClick={handleClear}>
                New Validation
              </Button>
            </>
          )}
          {currentView === 'validation' && !showDashboard && (
            <Button
              variant="ghost"
              onClick={() => setCurrentView('history')}
              className="gap-2"
            >
              <History className="h-4 w-4" />
              History
            </Button>
          )}
          <Settings
            onClick={() => setShowSettings(!showSettings)}
            className="h-5 w-5 cursor-pointer"
          />
        </div>
      </header>

      <ScrollArea className="flex-1 p-8">
        {currentView === 'validation' && !showDashboard && (
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
        )}

        {currentView === 'validation' && showDashboard && (
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
      </ScrollArea>

      <SettingsPanel
        open={showSettings}
        onOpenChange={setShowSettings}
      />
    </MainLayout>
  );
}

export default App;
