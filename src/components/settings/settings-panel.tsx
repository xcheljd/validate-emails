import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsContent } from './settings-content';

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure validation behavior, proxy settings, and more.
          </DialogDescription>
        </DialogHeader>
        <SettingsContent onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

export { SettingsContent }; // Re-export for App.tsx compatibility if it imports from here
