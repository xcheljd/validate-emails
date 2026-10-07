import { useState } from 'react';
import type { ReactNode } from 'react';
import { RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { useSettings } from '@/hooks/use-settings';

interface ConfirmDestructiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
}

/** Cancel + destructive-confirm dialog, same shape as the proxy delete dialog. */
function ConfirmDestructiveDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
}: ConfirmDestructiveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Danger zone" block with a reset-all-settings-to-defaults action. */
export function ResetSettingsSection() {
  const { resetToDefaults } = useSettings();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const handleConfirm = async () => {
    setPending(true);
    try {
      await resetToDefaults();
      toast.success('All settings reset to defaults');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      toast.error(`Failed to reset settings: ${message}`);
    } finally {
      setPending(false);
      setOpen(false);
    }
  };

  return (
    <div className="pt-4 border-t">
      <div className="flex items-center gap-2 mb-4">
        <TriangleAlert className="h-4 w-4 text-destructive" />
        <h3 className="text-sm font-medium">Danger Zone</h3>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-md border border-destructive/40 p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Reset to defaults</p>
          <p className="text-[10px] text-muted-foreground">
            Restores every setting to its default and removes your entire
            proxy pool.
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-2 shrink-0 text-destructive hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <RotateCcw className="h-4 w-4" />
          Reset to defaults
        </Button>
      </div>

      <ConfirmDestructiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Reset all settings?"
        description={
          <>
            This resets ALL settings to their defaults, including validation
            options, rate limits, timeouts, AND your entire proxy pool (all
            proxies, domain assignments, and health stats). This cannot be
            undone.
          </>
        }
        confirmLabel="Reset everything"
        pending={pending}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

/** Secondary "Clear all proxies" action; disabled when the pool is empty. */
export function ClearProxiesButton() {
  const { settings, clearProxies } = useSettings();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const hasProxies = settings.proxy.proxies.length > 0;

  const handleConfirm = async () => {
    setPending(true);
    try {
      await clearProxies();
      toast.success('All proxies cleared');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      toast.error(`Failed to clear proxies: ${message}`);
    } finally {
      setPending(false);
      setOpen(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 text-destructive hover:text-destructive"
        disabled={!hasProxies}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
        Clear all proxies
      </Button>

      <ConfirmDestructiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Clear all proxies?"
        description="This removes ALL proxies, their health stats, and all domain assignments. Your other settings are kept. This cannot be undone."
        confirmLabel="Clear proxies"
        pending={pending}
        onConfirm={handleConfirm}
      />
    </>
  );
}
