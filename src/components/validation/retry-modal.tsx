import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface RetryModalProps {
  open: boolean;
  unknownCount: number;
  onRetry: () => void;
  onCancel: () => void;
}

export function RetryModal({
  open,
  unknownCount,
  onRetry,
  onCancel,
}: RetryModalProps) {
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Validation Complete</DialogTitle>
          <DialogDescription>
            We found {unknownCount} Unknown results. Would you like to retry these specific emails using different proxies to improve accuracy?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onRetry}>
            Retry Unknown Emails
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
