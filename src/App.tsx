import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmailInput } from "@/components/validation/email-input";
import { ValidationDashboard } from "@/components/validation/validation-dashboard";
import { ResultsTable } from "@/components/validation/results-table";
import { ResultDetails } from "@/components/validation/result-details";
import { Button } from "@/components/ui/button";
import { Trash2, Play, ChevronLeft, Download } from "lucide-react";
import { useEmailValidation, ValidationResult } from "@/hooks/use-email-validation";
import { formatAsCSV } from "@/lib/export-utils";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

function App() {
  const [emails, setEmails] = useState<string[]>([]);
  const [showDashboard, setShowDashboard] = useState(false);
  const [selectedResult, setSelectedResult] = useState<ValidationResult | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  
  const { results, isProcessing, progress, total, startValidation } = useEmailValidation();

  const handleEmailsLoaded = (newEmails: string[]) => {
    setEmails(prev => [...new Set([...prev, ...newEmails])]);
  };

  const handleClear = () => {
    setEmails([]);
    setShowDashboard(false);
  };

  const handleStartValidation = () => {
    setShowDashboard(true);
    startValidation(emails);
  };

  const handleBack = () => {
    setShowDashboard(false);
  };

  const handleViewDetails = (result: ValidationResult) => {
    setSelectedResult(result);
    setIsDetailsOpen(true);
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
      // Fallback for web/dev environment if plugin fails
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'validation_results.csv';
      a.click();
    }
  };

  return (
    <MainLayout>
      <header className="border-b px-8 py-6 flex items-center justify-between bg-card">
        <div className="flex items-center gap-4">
          {showDashboard && !isProcessing && (
            <Button variant="ghost" size="icon" onClick={handleBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {showDashboard ? "Validation Results" : "Email Validation"}
            </h1>
            <p className="text-muted-foreground text-sm">
              {showDashboard ? `Analyzed ${progress} of ${total} emails` : "Upload or paste your leads to verify deliverability"}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {!showDashboard && emails.length > 0 && (
            <>
              <Button variant="ghost" onClick={handleClear} disabled={isProcessing} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4 mr-2" /> Clear List
              </Button>
              <Button onClick={handleStartValidation} disabled={isProcessing} className="gap-2">
                <Play className="h-4 w-4" /> Start Validation ({emails.length})
              </Button>
            </>
          )}
          {showDashboard && !isProcessing && (
             <>
                <Button variant="outline" onClick={handleExport} className="gap-2">
                    <Download className="h-4 w-4" /> Export CSV
                </Button>
                <Button variant="outline" onClick={handleClear}>
                    New Validation
                </Button>
             </>
          )}
        </div>
      </header>
      
      <ScrollArea className="flex-1 p-8">
        {!showDashboard ? (
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
          <div className="max-w-6xl mx-auto space-y-8 pb-20">
            <ValidationDashboard 
              results={results}
              progress={progress}
              total={total}
              isProcessing={isProcessing}
            />

            <ResultsTable 
                results={results} 
                onViewDetails={handleViewDetails}
            />

            <ResultDetails 
                result={selectedResult}
                open={isDetailsOpen}
                onOpenChange={setIsDetailsOpen}
            />
          </div>
        )}
      </ScrollArea>
    </MainLayout>
  );
}

export default App;
