import { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, AlertCircle, XCircle, Info, Timer, Zap } from "lucide-react";
import { ValidationResult, ValidationStatus } from "@/hooks/use-email-validation";
import { ValidationControls } from "./validation-controls";
import { ValidationModeSelector } from "./validation-modes";
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
import { cn } from "@/lib/utils";

interface ValidationDashboardProps {
  results: ValidationResult[];
  progress: number;
  total: number;
  status: ValidationStatus;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
  validationMode?: 'quick' | 'standard' | 'thorough';
  onChangeValidationMode?: (mode: 'quick' | 'standard' | 'thorough') => void;
  proxyStatus?: {
    totalProxies: number;
    activeProxy: string | null;
    successRate: number;
  };
  validationSpeed?: number;
  estimatedTimeRemaining?: number;
}

export function ValidationDashboard({
   results,
   progress,
   total,
   status,
   onPause,
   onResume,
   onStop,
   onDiscard,
   validationMode,
   onChangeValidationMode,
   proxyStatus,
   validationSpeed,
   estimatedTimeRemaining
}: ValidationDashboardProps) {
   const [showStopDialog, setShowStopDialog] = useState(false);

   const safeCount = results.filter(r => r.result === "Safe").length;
   const riskyCount = results.filter(r => r.result === "Risky").length;
   const invalidCount = results.filter(r => r.result === "Invalid").length;
   const unknownCount = results.filter(r => r.result === "Unknown").length;

   const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;

   const formatTime = (seconds: number): string => {
     if (seconds < 60) return `${Math.round(seconds)}s`;
     if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
     return `${Math.round(seconds / 3600)}h`;
   };

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
         return <Badge variant="default" className="animate-pulse bg-blue-500 hover:bg-blue-600">Validating</Badge>;
       case 'paused':
         return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-200">Paused</Badge>;
       case 'stopping':
         return <Badge variant="destructive">Stopping...</Badge>;
       default:
         return <Badge variant="outline" className="text-muted-foreground">Finished</Badge>;
     }
   };

   return (
     <div className="space-y-6 w-full max-w-6xl mx-auto animate-in fade-in duration-500">
       <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
         {validationMode && onChangeValidationMode && (
           <ValidationModeSelector selected={validationMode} onChange={onChangeValidationMode} />
         )}
         
         {status !== 'idle' && (
           <div className="flex items-center gap-2 bg-card border rounded-lg px-4 py-2 shadow-sm ml-auto">
             <div className="flex items-center gap-2 mr-4 pr-4 border-r">
               <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</span>
               {getStatusBadge()}
             </div>
             <ValidationControls
               status={status}
               onPause={onPause}
               onResume={onResume}
               onStop={handleStopClick}
             />
           </div>
         )}
       </div>

       {/* Progress Section */}
       {(status !== 'idle' || (progress > 0 && progress < total)) && (
         <Card className="overflow-hidden border-none shadow-md bg-gradient-to-br from-card to-muted/30">
           <CardContent className="pt-6">
             <div className="flex flex-col sm:flex-row justify-between mb-4 gap-4">
               <div className="space-y-1">
                 <h3 className="text-sm font-medium flex items-center gap-2">
                   {status === 'paused' ? 'Validation Paused' : 'Verification Progress'}
                   <span className="text-primary font-bold ml-1">{percentage}%</span>
                 </h3>
                 <p className="text-xs text-muted-foreground">
                   {progress} of {total} emails processed
                 </p>
               </div>
               
               {estimatedTimeRemaining !== undefined && status === 'processing' && (
                 <div className="flex items-center gap-4 text-xs">
                   <div className="flex items-center gap-1.5 text-muted-foreground">
                     <Zap className="h-3 w-3 text-yellow-500" />
                     <span>{validationSpeed || 0} emails/min</span>
                   </div>
                   <div className="flex items-center gap-1.5 text-muted-foreground border-l pl-4">
                     <Timer className="h-3 w-3 text-blue-500" />
                     <span>~{formatTime(estimatedTimeRemaining)} left</span>
                   </div>
                 </div>
               )}
             </div>
             <Progress
               value={percentage}
               className={cn(
                 "h-2.5 transition-all duration-500",
                 status === 'paused' ? "bg-muted" : "bg-muted"
               )}
             />
           </CardContent>
         </Card>
       )}

       {/* Compact Status Grid */}
       <Card className="shadow-sm">
         <CardContent className="p-0">
           <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 border-collapse">
             <div className="p-4 flex flex-col items-center justify-center space-y-1 group hover:bg-green-50/30 transition-colors">
               <div className="flex items-center gap-2 text-green-600">
                 <CheckCircle2 className="h-4 w-4" />
                 <span className="text-[10px] font-bold uppercase tracking-widest text-center">Safe</span>
               </div>
               <div className="text-2xl font-bold">{safeCount}</div>
               <div className="text-[10px] text-muted-foreground text-center">Deliverable</div>
             </div>
             
             <div className="p-4 flex flex-col items-center justify-center space-y-1 group hover:bg-yellow-50/30 transition-colors">
               <div className="flex items-center gap-2 text-yellow-600">
                 <AlertCircle className="h-4 w-4" />
                 <span className="text-[10px] font-bold uppercase tracking-widest text-center">Risky</span>
               </div>
               <div className="text-2xl font-bold">{riskyCount}</div>
               <div className="text-[10px] text-muted-foreground text-center">Issues</div>
             </div>

             <div className="p-4 flex flex-col items-center justify-center space-y-1 group hover:bg-red-50/30 transition-colors">
               <div className="flex items-center gap-2 text-red-600">
                 <XCircle className="h-4 w-4" />
                 <span className="text-[10px] font-bold uppercase tracking-widest text-center">Invalid</span>
               </div>
               <div className="text-2xl font-bold">{invalidCount}</div>
               <div className="text-[10px] text-muted-foreground text-center">Failed</div>
             </div>

             <div className="p-4 flex flex-col items-center justify-center space-y-1 group hover:bg-slate-50 transition-colors">
               <div className="flex items-center gap-2 text-slate-500">
                 <Info className="h-4 w-4" />
                 <span className="text-[10px] font-bold uppercase tracking-widest text-center">Unknown</span>
               </div>
               <div className="text-2xl font-bold">{unknownCount}</div>
               <div className="text-[10px] text-muted-foreground text-center">Unverified</div>
             </div>
           </div>
         </CardContent>
       </Card>

       {proxyStatus && proxyStatus.totalProxies > 0 && (
         <Card className="border-dashed bg-muted/10">
           <CardContent className="py-3 px-6 flex items-center justify-between gap-4">
             <div className="flex items-center gap-2 text-sm">
               <span className="font-semibold text-muted-foreground">Proxy:</span>
               <Badge variant="outline" className="bg-background">{proxyStatus.activeProxy || 'Initializing...'}</Badge>
             </div>
             <div className="flex items-center gap-6">
               <div className="flex flex-col items-end">
                 <span className="text-[10px] uppercase text-muted-foreground font-bold">Success Rate</span>
                 <span className="text-sm font-mono font-bold">{Math.round(proxyStatus.successRate)}%</span>
               </div>
               <div className="flex flex-col items-end border-l pl-6">
                 <span className="text-[10px] uppercase text-muted-foreground font-bold">Pool Size</span>
                 <span className="text-sm font-mono font-bold">{proxyStatus.totalProxies}</span>
               </div>
             </div>
           </CardContent>
         </Card>
       )}

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