import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmailInput } from "@/components/validation/email-input";
import { ValidationDashboard } from "@/components/validation/validation-dashboard";
import { Button } from "@/components/ui/button";
import { Trash2, Play, ChevronLeft } from "lucide-react";
import { useEmailValidation } from "@/hooks/use-email-validation";

function App() {
  const [emails, setEmails] = useState<string[]>([]);
  const [showDashboard, setShowDashboard] = useState(false);
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
             <Button variant="outline" onClick={handleClear}>
                New Validation
             </Button>
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
          <div className="max-w-6xl mx-auto space-y-8">
            <ValidationDashboard 
              results={results}
              progress={progress}
              total={total}
              isProcessing={isProcessing}
            />

            {/* In next tasks, we will add Charts and the Results Table here */}
            {!isProcessing && results.length === 0 && (
                <div className="text-center py-20">
                    <p className="text-muted-foreground">Waiting for validation to start...</p>
                </div>
            )}
          </div>
        )}
      </ScrollArea>
    </MainLayout>
  );
}

export default App;