import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertOctagon } from 'lucide-react';

interface AutoPauseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  failureCount: number;
  onResume: () => void;
  onStop: () => void;
}

export function AutoPauseModal({
  open,
  onOpenChange,
  failureCount,
  onResume,
  onStop,
}: AutoPauseModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertOctagon className="h-5 w-5 text-red-500" />
            Validation Auto-Paused
          </DialogTitle>
          <DialogDescription>
            Too many consecutive failures detected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
            <p className="text-sm text-red-800 dark:text-red-200">
              <strong>{failureCount}</strong> consecutive failures detected.
              Validation has been paused to prevent further issues.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onStop}>
            Stop Validation
          </Button>
          <Button onClick={onResume}>
            Resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
