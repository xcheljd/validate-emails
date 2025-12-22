import { useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Upload, X } from "lucide-react";
import { parseEmails } from "@/lib/email-parser";
import Papa from "papaparse";

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
        // Basic plain text parsing for non-csv files
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
    <div className="space-y-8 w-full max-w-4xl mx-auto">
      <Card
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cx(
          "p-12 border-2 border-dashed flex flex-col items-center justify-center text-center space-y-4 transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-muted"
        )}
      >
        <div className="bg-muted p-4 rounded-full">
          <Upload className="h-8 w-8 text-muted-foreground" />
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
        <Button variant="outline" onClick={() => document.getElementById('file-upload')?.click()}>
            Browse Files
        </Button>
      </Card>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">Or paste emails</span>
        </div>
      </div>

      <div className="space-y-4">
        <Textarea
          value={text}
          onChange={handleTextChange}
          placeholder="Enter emails separated by commas or new lines..."
          className="min-h-[200px] font-mono text-sm"
        />
        <div className="flex justify-end gap-2">
            {text && (
                <Button variant="ghost" onClick={() => setText("")} className="gap-2">
                    <X className="h-4 w-4" /> Clear
                </Button>
            )}
            <Button onClick={handleProcessText} disabled={!text.trim()}>
                Load {text.trim() ? parseEmails(text).length : 0} Emails
            </Button>
        </div>
      </div>
    </div>
  );
}

// Simple helper if clsx/cn is not imported correctly in some environments
function cx(...args: any[]) {
    return args.filter(Boolean).join(" ");
}
