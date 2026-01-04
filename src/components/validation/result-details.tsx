import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ValidationResult } from "@/hooks/use-email-validation";
import { Mail, ShieldCheck, AlertCircle, XCircle, Info, Clock, Server, Globe, Activity, Check, AlertTriangle } from "lucide-react";
import { calculateRiskScore, getRiskLevel, getRiskColor, getRiskReasons } from "@/lib/risk-scorer";
import * as typoDatabase from "@/lib/typo-database";

interface ResultDetailsProps {
  result: ValidationResult | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFixEmail?: (correctedEmail: string) => void;
}

export function ResultDetails({ result, open, onOpenChange, onFixEmail }: ResultDetailsProps) {
  if (!result) return null;

  const riskScore = calculateRiskScore(result);
  const riskLevel = getRiskLevel(riskScore);
  const riskColorClass = getRiskColor(riskScore);
  const riskReasons = getRiskReasons(result);
  const typoCorrection = typoDatabase.suggestCorrection(result.email);

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

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const handleFixEmail = () => {
    if (typoCorrection && onFixEmail) {
      onFixEmail(typoCorrection);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <DialogTitle className="font-mono text-lg truncate">
                  {result.email}
                </DialogTitle>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {getStatusIcon(result.result)}
                <DialogDescription className="text-sm font-medium">
                  Deliverability Status:
                </DialogDescription>
                {getStatusBadge(result.result)}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge className={`${riskColorClass} text-white px-3 py-1`}>
                Risk Score: {riskScore}
              </Badge>
              <span className="text-xs text-muted-foreground">{riskLevel}</span>
            </div>
          </div>
        </DialogHeader>

        {typoCorrection && (
          <div className="flex items-center gap-2 text-yellow-600 text-sm bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>Typo detected: <span className="font-semibold">{result.email}</span> → <span className="font-semibold text-green-600">{typoCorrection}</span></span>
            {onFixEmail && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleFixEmail}
                className="ml-auto gap-1"
              >
                <Check className="h-3 w-3" />
                Fix Email
              </Button>
            )}
          </div>
        )}

        <ScrollArea className="flex-1 py-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Validation Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Domain</div>
                  <div className="font-medium text-sm flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {result.domain}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Duration</div>
                  <div className="font-medium text-sm flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(result.validationDuration)}
                  </div>
                </div>
                {result.proxyUsed && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Proxy Used</div>
                    <div className="font-medium text-sm flex items-center gap-1">
                      <Server className="h-3 w-3" />
                      {result.proxyUsed}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">MX Records</div>
                  <div className="font-medium text-sm">{result.mxRecordCount} found</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Timestamp</div>
                  <div className="font-medium text-sm text-xs">{new Date(result.timestamp).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Mode</div>
                  <div className="font-medium text-sm capitalize">{result.validationMode}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Risk Factors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {riskReasons.length > 0 ? (
                riskReasons.map((reason, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    {reason.includes('Valid') || reason.includes('found') ? (
                      <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                    )}
                    <span className="text-sm">{reason}</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground italic">No risk factors detected</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Email Flags</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {result.isDisposable && (
                  <Badge variant="outline" className="border-orange-500 text-orange-500">
                    Disposable
                  </Badge>
                )}
                {result.isRoleAccount && (
                  <Badge variant="outline" className="border-yellow-500 text-yellow-500">
                    Role Account
                  </Badge>
                )}
                {result.isCatchAll && (
                  <Badge variant="outline" className="border-blue-500 text-blue-500">
                    Catch-All
                  </Badge>
                )}
                {!result.isDisposable && !result.isRoleAccount && !result.isCatchAll && (
                  <Badge variant="outline">None</Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Verdict Reason</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="p-3 rounded-md bg-muted/50 border text-sm">
                {result.reason || "No specific reason provided by validation engine."}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Technical Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px] rounded-md border bg-black p-4 font-mono text-[11px] leading-relaxed text-green-400 overflow-auto">
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
              </div>
            </CardContent>
          </Card>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
