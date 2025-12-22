import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ValidationResult } from "@/hooks/use-email-validation";
import { Mail, ShieldCheck, AlertCircle, XCircle, Info } from "lucide-react";

interface ResultDetailsProps {
  result: ValidationResult | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResultDetails({ result, open, onOpenChange }: ResultDetailsProps) {
  if (!result) return null;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Safe":
        return <ShieldCheck className="h-5 w-5 text-green-500" />;
      case "Risky":
        return <AlertCircle className="h-5 w-5 text-yellow-500" />;
      case "Invalid":
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Info className="h-5 w-5 text-slate-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Safe":
        return <Badge className="bg-green-500">Safe</Badge>;
      case "Risky":
        return <Badge className="bg-yellow-500">Risky</Badge>;
      case "Invalid":
        return <Badge variant="destructive">Invalid</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <DialogTitle className="font-mono text-lg truncate">
              {result.email}
            </DialogTitle>
          </div>
          <div className="flex items-center gap-2">
            {getStatusIcon(result.result)}
            <DialogDescription className="text-sm font-medium">
              Deliverability Status:
            </DialogDescription>
            {getStatusBadge(result.result)}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden py-4 space-y-6">
          <div className="space-y-2">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Verdict Reason
            </h4>
            <div className="p-3 rounded-md bg-muted/50 border text-sm italic">
              {result.reason || "No specific reason provided by validation engine."}
            </div>
          </div>

          <div className="space-y-2 flex flex-col h-[300px]">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Technical Logs
            </h4>
            <ScrollArea className="flex-1 rounded-md border bg-black p-4 font-mono text-[11px] leading-relaxed text-green-400">
              {result.logs && result.logs.length > 0 ? (
                <div className="space-y-1">
                  {result.logs.map((log, i) => (
                    <div key={i} className="break-all whitespace-pre-wrap">
                      <span className="text-slate-500 mr-2">[{i + 1}]</span>
                      {log}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500 italic py-10 text-center">
                  No detailed SMTP logs available for this result.
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
