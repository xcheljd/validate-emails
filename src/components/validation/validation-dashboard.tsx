import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, AlertCircle, XCircle, Info } from "lucide-react";
import { ValidationResult } from "@/hooks/use-email-validation";

interface ValidationDashboardProps {
  results: ValidationResult[];
  progress: number;
  total: number;
  isProcessing: boolean;
}

export function ValidationDashboard({ results, progress, total, isProcessing }: ValidationDashboardProps) {
  const safeCount = results.filter(r => r.result === "Safe").length;
  const riskyCount = results.filter(r => r.result === "Risky").length;
  const invalidCount = results.filter(r => r.result === "Invalid").length;
  const unknownCount = results.filter(r => r.result === "Unknown").length;

  const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <div className="space-y-8 w-full max-w-6xl mx-auto">
      {isProcessing && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between mb-2 text-sm font-medium">
              <span>Processing Emails...</span>
              <span>{progress} / {total} ({percentage}%)</span>
            </div>
            <Progress value={percentage} className="h-2" />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Safe</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{safeCount}</div>
            <p className="text-xs text-muted-foreground">Deliverable emails</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Risky</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{riskyCount}</div>
            <p className="text-xs text-muted-foreground">Potential issues</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Invalid</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{invalidCount}</div>
            <p className="text-xs text-muted-foreground">Undeliverable emails</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-slate-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unknown</CardTitle>
            <Info className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{unknownCount}</div>
            <p className="text-xs text-muted-foreground">Verification failed</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
