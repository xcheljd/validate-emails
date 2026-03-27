import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, XCircle, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FailedProxyInfo {
  id: string;
  isBad: boolean;
  remainingCooldownSecs: number;
  consecutiveFailures: number;
  successRate: number;
}

export interface ProxyFailureModalProps {
  open: boolean;
  failedProxies: FailedProxyInfo[];
  totalProxies: number;
  badCount: number;
  cooldownCount: number;
  nearestCooldownSecs: number;
  onContinueWithoutProxy: () => void;
  onRetryWithCooldown: () => void;
  onStop: () => void;
}

function formatCooldownTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

export function ProxyFailureModal({
  open,
  failedProxies,
  totalProxies,
  badCount,
  cooldownCount,
  nearestCooldownSecs,
  onContinueWithoutProxy,
  onRetryWithCooldown,
  onStop,
}: ProxyFailureModalProps) {
  return (
    <Dialog open={open} onOpenChange={() => {/* Modal can only be closed by choosing an option */}}>
      <DialogContent 
        className="sm:max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        hideCloseButton
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            All Proxies Unavailable
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                All {totalProxies} configured {totalProxies === 1 ? 'proxy is' : 'proxies are'} currently unavailable.
              </p>
              <p className="text-sm">
                <span className="text-destructive font-medium">{badCount} bad</span>
                {' • '}
                <span className="text-yellow-600 dark:text-yellow-400 font-medium">{cooldownCount} in cooldown</span>
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* Failed Proxies List */}
        <div className="my-4 max-h-48 overflow-y-auto space-y-2">
          {failedProxies.map((proxy) => (
            <div
              key={proxy.id}
              className={cn(
                "flex items-center justify-between p-3 rounded-lg border",
                proxy.isBad 
                  ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900" 
                  : "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-900"
              )}
            >
              <div className="flex items-center gap-3">
                {proxy.isBad ? (
                  <XCircle className="h-4 w-4 text-red-500" />
                ) : (
                  <Clock className="h-4 w-4 text-yellow-500" />
                )}
                <span className="font-mono text-sm">{proxy.id}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-xs",
                    proxy.isBad 
                      ? "border-red-300 text-red-600 dark:border-red-700 dark:text-red-400" 
                      : "border-yellow-300 text-yellow-600 dark:border-yellow-700 dark:text-yellow-400"
                  )}
                >
                  {proxy.successRate}%
                </Badge>
                {proxy.isBad ? (
                  <Badge variant="destructive" className="text-xs">
                    Failed
                  </Badge>
                ) : proxy.remainingCooldownSecs > 0 ? (
                  <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-600 dark:border-yellow-700 dark:text-yellow-400">
                    <Timer className="h-3 w-3 mr-1" />
                    {formatCooldownTime(proxy.remainingCooldownSecs)}
                  </Badge>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button 
            variant="ghost" 
            onClick={onStop}
            className="w-full sm:w-auto"
          >
            Stop Validation
          </Button>
          <Button 
            variant="outline" 
            onClick={onRetryWithCooldown}
            disabled={cooldownCount === 0}
            className="w-full sm:w-auto"
          >
            {cooldownCount > 0 ? (
              <>
                <Timer className="h-4 w-4 mr-2" />
                Retry with Cooldown ({formatCooldownTime(nearestCooldownSecs)})
              </>
            ) : (
              "Retry with Cooldown"
            )}
          </Button>
          <Button 
            onClick={onContinueWithoutProxy}
            className="w-full sm:w-auto"
          >
            Continue without Proxy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
