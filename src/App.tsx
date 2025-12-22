import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmailInput } from "@/components/validation/email-input";
import { Button } from "@/components/ui/button";
import { Trash2, Play } from "lucide-react";

function App() {
  const [emails, setEmails] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleEmailsLoaded = (newEmails: string[]) => {
    setEmails(prev => [...new Set([...prev, ...newEmails])]);
  };

  const handleClear = () => {
    setEmails([]);
  };

  return (
    <MainLayout>
      <header className="border-b px-8 py-6 flex items-center justify-between bg-card">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Validation</h1>
          <p className="text-muted-foreground text-sm">Upload or paste your leads to verify deliverability</p>
        </div>
        {emails.length > 0 && (
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={handleClear} disabled={isProcessing} className="text-destructive hover:text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4 mr-2" /> Clear List
            </Button>
            <Button onClick={() => setIsProcessing(true)} disabled={isProcessing} className="gap-2">
              <Play className="h-4 w-4" /> Start Validation ({emails.length})
            </Button>
          </div>
        )}
      </header>
      
      <ScrollArea className="flex-1 p-8">
        {!isProcessing && emails.length === 0 ? (
          <EmailInput onEmailsLoaded={handleEmailsLoaded} />
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* We will implement the Dashboard and Results here in next tasks */}
            <div className="bg-card border rounded-lg p-8 text-center space-y-4">
               <h2 className="text-xl font-semibold">Ready to validate {emails.length} emails</h2>
               <p className="text-muted-foreground text-sm">Click the "Start Validation" button in the header to begin.</p>
               
               <div className="mt-8 text-left border rounded-md overflow-hidden">
                  <div className="bg-muted px-4 py-2 border-b text-xs font-medium uppercase tracking-wider">
                    Email Preview (First 10)
                  </div>
                  <div className="divide-y max-h-60 overflow-y-auto">
                    {emails.slice(0, 10).map((email, i) => (
                      <div key={i} className="px-4 py-2 text-sm font-mono">
                        {email}
                      </div>
                    ))}
                    {emails.length > 10 && (
                      <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/50 italic">
                        ... and {emails.length - 10} more
                      </div>
                    )}
                  </div>
               </div>

               <Button variant="outline" onClick={() => setEmails([])} className="mt-4">
                  Add more emails
               </Button>
            </div>
          </div>
        )}
      </ScrollArea>
    </MainLayout>
  );
}

export default App;
