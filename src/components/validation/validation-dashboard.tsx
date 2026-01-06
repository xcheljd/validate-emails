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
     <div className="space-y-4 md:space-y-6 w-full max-w-6xl mx-auto animate-in fade-in duration-500 overflow-x-auto pb-4">
       <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
         {validationMode && onChangeValidationMode && (
           <div className="w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
             <ValidationModeSelector selected={validationMode} onChange={onChangeValidationMode} />
           </div>
         )}
         
         {status !== 'idle' && (
           <div className="flex items-center gap-2 bg-card border rounded-lg px-2 py-1.5 md:px-4 md:py-2 shadow-sm w-full sm:w-auto justify-between sm:justify-start">
             <div className="flex items-center gap-2 mr-2 pr-2 md:mr-4 md:pr-4 border-r">
               <span className="hidden xs:inline text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Status</span>
               {getStatusBadge()}
             </div>
             <ValidationControls
               status={status}
               onPause={onPause}
               onResume={onResume}
               onStop={handleStopClick}
               isCompact={true}
             />
           </div>
         )}
       </div>

       {/* Progress Section */}
       {(status !== 'idle' || (progress > 0 && progress < total)) && (
         <Card className="overflow-hidden border-none shadow-md bg-gradient-to-br from-card to-muted/30">
           <CardContent className="pt-4 md:pt-6">
             <div className="flex flex-col sm:flex-row justify-between mb-3 md:mb-4 gap-2 sm:gap-4">
               <div className="space-y-0.5">
                 <h3 className="text-sm font-medium flex items-center gap-2">
                   {status === 'paused' ? 'Validation Paused' : 'Verification Progress'}
                   <span className="text-primary font-bold ml-1">{percentage}%</span>
                 </h3>
                 <p className="text-[10px] md:text-xs text-muted-foreground">
                   {progress} of {total} emails processed
                 </p>
               </div>
               
               {estimatedTimeRemaining !== undefined && status === 'processing' && (
                 <div className="flex items-center gap-3 md:gap-4 text-[10px] md:text-xs">
                   <div className="flex items-center gap-1.5 text-muted-foreground">
                     <Zap className="h-3 w-3 text-yellow-500" />
                     <span>{validationSpeed || 0}<span className="hidden xs:inline"> emails/min</span><span className="xs:hidden">/min</span></span>
                   </div>
                   <div className="flex items-center gap-1.5 text-muted-foreground border-l pl-3 md:pl-4">
                     <Timer className="h-3 w-3 text-blue-500" />
                     <span>~{formatTime(estimatedTimeRemaining)}<span className="hidden xs:inline"> left</span></span>
                   </div>
                 </div>
               )}
             </div>
             <Progress
               value={percentage}
               className={cn(
                 "h-2 md:h-2.5 transition-all duration-500",
                 status === 'paused' ? "bg-muted" : "bg-muted"
               )}
             />
           </CardContent>
         </Card>
       )}

       {/* Compact Status Grid */}
       <Card className="shadow-sm overflow-hidden">
         <CardContent className="p-0">
           <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 border-collapse">
             <div className="p-3 md:p-4 flex flex-col items-center justify-center space-y-1 group hover:bg-green-50/30 transition-colors">
               <div className="flex items-center gap-1.5 md:gap-2 text-green-600">
                 <CheckCircle2 className="h-3.5 w-3.5 md:h-4 md:w-4" />
                 <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-center">Safe</span>
               </div>
               <div className="text-xl md:text-2xl font-bold">{safeCount}</div>
               <div className="hidden xs:block text-[9px] md:text-[10px] text-muted-foreground text-center">Deliverable</div>
             </div>
             
             <div className="p-3 md:p-4 flex flex-col items-center justify-center space-y-1 group hover:bg-yellow-50/30 transition-colors">
               <div className="flex items-center gap-1.5 md:gap-2 text-yellow-600">
                 <AlertCircle className="h-3.5 w-3.5 md:h-4 md:w-4" />
                 <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-center">Risky</span>
               </div>
               <div className="text-xl md:text-2xl font-bold">{riskyCount}</div>
               <div className="hidden xs:block text-[9px] md:text-[10px] text-muted-foreground text-center">Issues</div>
             </div>

             <div className="p-3 md:p-4 flex flex-col items-center justify-center space-y-1 group hover:bg-red-50/30 transition-colors">
               <div className="flex items-center gap-1.5 md:gap-2 text-red-600">
                 <XCircle className="h-3.5 w-3.5 md:h-4 md:w-4" />
                 <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-center">Invalid</span>
               </div>
               <div className="text-xl md:text-2xl font-bold">{invalidCount}</div>
               <div className="hidden xs:block text-[9px] md:text-[10px] text-muted-foreground text-center">Failed</div>
             </div>

             <div className="p-3 md:p-4 flex flex-col items-center justify-center space-y-1 group hover:bg-slate-50 transition-colors">
               <div className="flex items-center gap-1.5 md:gap-2 text-slate-500">
                 <Info className="h-3.5 w-3.5 md:h-4 md:w-4" />
                 <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-center">Unknown</span>
               </div>
               <div className="text-xl md:text-2xl font-bold">{unknownCount}</div>
               <div className="hidden xs:block text-[9px] md:text-[10px] text-muted-foreground text-center">Unverified</div>
             </div>
           </div>
         </CardContent>
       </Card>

       {proxyStatus && proxyStatus.totalProxies > 0 && (
         <Card className="border-dashed bg-muted/10">
           <CardContent className="py-2 md:py-3 px-4 md:px-6 flex items-center justify-between gap-4">
             <div className="flex items-center gap-2 text-xs md:text-sm">
               <span className="font-semibold text-muted-foreground">Proxy:</span>
               <Badge variant="outline" className="bg-background max-w-[100px] md:max-w-none truncate">{proxyStatus.activeProxy || 'Initializing...'}</Badge>
             </div>
             <div className="flex items-center gap-3 md:gap-6">
               <div className="flex flex-col items-end">
                 <span className="text-[8px] md:text-[10px] uppercase text-muted-foreground font-bold">Success</span>
                 <span className="text-xs md:text-sm font-mono font-bold">{Math.round(proxyStatus.successRate)}%</span>
               </div>
               <div className="flex flex-col items-end border-l pl-3 md:pl-6">
                 <span className="text-[8px] md:text-[10px] uppercase text-muted-foreground font-bold">Pool</span>
                 <span className="text-xs md:text-sm font-mono font-bold">{proxyStatus.totalProxies}</span>
               </div>
             </div>
           </CardContent>
         </Card>
       )}

       <Dialog open={showStopDialog} onOpenChange={setShowStopDialog}>
         <DialogContent className="max-w-[90vw] sm:max-w-md">
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