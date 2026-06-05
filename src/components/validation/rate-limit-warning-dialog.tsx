import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface RateLimitWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  emailCount: number;
  maxEmails: number;
  estimatedTime: string;
  onCancel: () => void;
  onProceed: () => void;
}

/**
 * Calculate estimated validation time based on rate config and email count.
 * Returns human-readable string like "2 hours 30 minutes" or "45 seconds".
 */
export function estimateValidationTime(
  emailCount: number,
  maxPerSecond: number,
  maxPerMinute: number
): string {
  if (emailCount === 0) return '0 seconds';

  // Use the more restrictive rate
  const effectivePerSecond = Math.min(maxPerSecond, maxPerMinute / 60);
  const totalSeconds = emailCount / effectivePerSecond;

  if (totalSeconds < 60) {
    return `${Math.ceil(totalSeconds)} second${Math.ceil(totalSeconds) !== 1 ? 's' : ''}`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.ceil(totalSeconds % 60);

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  }
  if (seconds > 0 && hours === 0) {
    parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
  }

  return parts.join(' ');
}

export function RateLimitWarningDialog({
  open,
  onOpenChange,
  emailCount,
  maxEmails,
  estimatedTime,
  onCancel,
  onProceed,
}: RateLimitWarningDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Email Count Warning
          </DialogTitle>
          <DialogDescription>
            Your batch exceeds the configured session limit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm">
            You are about to validate <strong>{emailCount.toLocaleString()}</strong> emails.
          </p>
          <p className="text-sm">
            This exceeds the session limit of{' '}
            <strong>{maxEmails.toLocaleString()}</strong> emails.
          </p>
          <div className="rounded-md bg-muted p-3">
            <p className="text-sm font-medium">
              Estimated time: {estimatedTime}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onProceed}>
            Proceed Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
