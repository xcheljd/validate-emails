import { useState } from 'react';
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
  const [userAction, setUserAction] = useState<'none' | 'resume' | 'stop'>('none');

  const handleOpenChange = (newOpen: boolean) => {
    // Call the original onOpenChange handler
    onOpenChange(newOpen);
    // If modal is closing (open becomes false) and user didn't explicitly click Resume,
    // call onStop to halt validation (e.g., Escape key, click outside)
    if (!newOpen && userAction !== 'resume') {
      onStop();
    }
    // Reset user action after handling
    setUserAction('none');
  };

  const handleResume = () => {
    setUserAction('resume');
    onResume();
  };

  const handleStop = () => {
    setUserAction('stop');
    onStop();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
          <Button variant="outline" onClick={handleStop}>
            Stop Validation
          </Button>
          <Button onClick={handleResume}>
            Resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
