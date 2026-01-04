import { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, AlertCircle, XCircle, Info } from "lucide-react";
import { ValidationResult, ValidationStatus } from "@/hooks/use-email-validation";
import { ValidationControls } from "./validation-controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ValidationDashboardProps {
  results: ValidationResult[];
  progress: number;
  total: number;
  status: ValidationStatus;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
}

export function ValidationDashboard({ 
  results, 
  progress, 
  total, 
  status,
  onPause,
  onResume,
  onStop,
  onDiscard
}: ValidationDashboardProps) {
  const [showStopDialog, setShowStopDialog] = useState(false);

  const safeCount = results.filter(r => r.result === "Safe").length;
  const riskyCount = results.filter(r => r.result === "Risky").length;
  const invalidCount = results.filter(r => r.result === "Invalid").length;
  const unknownCount = results.filter(r => r.result === "Unknown").length;

  const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;

  const handleStopClick = () => {
    setShowStopDialog(true);
  };

  const handleConfirmStop = (save: boolean) => {
    if (save) {
      onStop();
    } else {
      onDiscard();
    }
    setShowStopDialog(false);
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'processing':
        return <Badge variant="default" className="animate-pulse">Validating</Badge>;
      case 'paused':
        return <Badge variant="secondary">Paused</Badge>;
      case 'stopping':
        return <Badge variant="destructive">Stopping...</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-8 w-full max-w-6xl mx-auto">
      {status !== 'idle' && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">
                  {status === 'paused' ? 'Validation Paused' : 'Processing Emails...'}
                </span>
                {getStatusBadge()}
              </div>
              <ValidationControls 
                status={status}
                onPause={onPause}
                onResume={onResume}
                onStop={handleStopClick}
              />
            </div>
            <div className="flex justify-between mb-2 text-xs text-muted-foreground">
              <span>{progress} of {total} emails verified</span>
              <span>{percentage}%</span>
            </div>
            <Progress 
              value={percentage} 
              className={`h-2 transition-all ${status === 'paused' ? 'bg-secondary' : ''}`} 
            />
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

      <Dialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop Validation?</DialogTitle>
            <DialogDescription>
              You are about to stop the validation process. Would you like to keep the results collected so far or discard them?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => setShowStopDialog(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => handleConfirmStop(false)}>
              Discard Results
            </Button>
            <Button variant="default" onClick={() => handleConfirmStop(true)}>
              Save & Stop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}