import { useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Upload, X, FileText } from "lucide-react";
import { parseEmails } from "@/lib/email-parser";
import Papa from "papaparse";
import { cn } from "@/lib/utils";

interface EmailInputProps {
  onEmailsLoaded: (emails: string[]) => void;
}

export function EmailInput({ onEmailsLoaded }: EmailInputProps) {
  const [text, setText] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  const handleProcessText = () => {
    const emails = parseEmails(text);
    if (emails.length > 0) {
      onEmailsLoaded(emails);
      setText("");
    }
  };

  const processFile = useCallback((file: File) => {
    if (file.type === "text/csv" || file.name.endsWith(".csv")) {
      Papa.parse(file, {
        complete: (results) => {
          const emails: string[] = [];
          results.data.forEach((row: any) => {
            if (Array.isArray(row)) {
              row.forEach(cell => {
                if (typeof cell === 'string' && cell.includes('@')) {
                  emails.push(...parseEmails(cell));
                }
              });
            } else if (typeof row === 'object') {
              Object.values(row).forEach(val => {
                if (typeof val === 'string' && val.includes('@')) {
                  emails.push(...parseEmails(val));
                }
              });
            }
          });
          onEmailsLoaded([...new Set(emails)]);
        },
        header: false,
      });
    } else {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            onEmailsLoaded(parseEmails(content));
        };
        reader.readAsText(file);
    }
  }, [onEmailsLoaded]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="space-y-8 w-full max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "p-12 border-2 border-dashed flex flex-col items-center justify-center text-center space-y-4 transition-all duration-200",
          isDragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-muted hover:border-primary/50"
        )}
      >
        <div className="bg-primary/10 p-4 rounded-full">
          <Upload className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Drop your email list here</h2>
          <p className="text-muted-foreground">Support for CSV and text files</p>
        </div>
        <input 
            type="file" 
            id="file-upload" 
            className="hidden" 
            accept=".csv,.txt"
            onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
        />
        <Button variant="secondary" onClick={() => document.getElementById('file-upload')?.click()}>
            Browse Files
        </Button>
      </Card>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-4 text-muted-foreground font-medium">Or paste emails</span>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
            <FileText className="h-4 w-4" />
            Manual Entry
        </div>
        <Textarea
          value={text}
          onChange={handleTextChange}
          placeholder="Enter emails separated by commas or new lines..."
          className="min-h-[200px] font-mono text-sm focus-visible:ring-primary shadow-sm"
        />
        <div className="flex justify-end gap-2">
            {text && (
                <Button variant="ghost" onClick={() => setText("")} className="gap-2 text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" /> Clear
                </Button>
            )}
            <Button onClick={handleProcessText} disabled={!text.trim()} className="px-8 shadow-sm">
                Load {text.trim() ? parseEmails(text).length : 0} Emails
            </Button>
        </div>
      </div>
    </div>
  );
}