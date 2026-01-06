import { Button } from "@/components/ui/button";
import { Pause, Play, Square } from "lucide-react";
import { ValidationStatus } from "@/hooks/use-email-validation";
import { cn } from "@/lib/utils";

interface ValidationControlsProps {
  status: ValidationStatus;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  isCompact?: boolean;
}

export function ValidationControls({
  status,
  onPause,
  onResume,
  onStop,
  isCompact = false,
}: ValidationControlsProps) {
  if (status === 'idle') return null;

  return (
    <div className="flex items-center gap-2">
      {status === 'processing' && (
        <Button 
          variant="outline" 
          size={isCompact ? "icon" : "sm"}
          onClick={onPause}
          className={cn("flex items-center gap-2", isCompact && "h-8 w-8")}
          title={isCompact ? "Pause" : undefined}
        >
          <Pause className="h-4 w-4" />
          {!isCompact && "Pause"}
        </Button>
      )}
      
      {status === 'paused' && (
        <Button 
          variant="outline" 
          size={isCompact ? "icon" : "sm"}
          onClick={onResume}
          className={cn("flex items-center gap-2", isCompact && "h-8 w-8")}
          title={isCompact ? "Resume" : undefined}
        >
          <Play className="h-4 w-4" />
          {!isCompact && "Resume"}
        </Button>
      )}

      <Button 
        variant="destructive" 
        size={isCompact ? "icon" : "sm"}
        onClick={onStop}
        className={cn("flex items-center gap-2", isCompact && "h-8 w-8")}
        disabled={status === 'stopping'}
        title={isCompact ? "Stop" : undefined}
      >
        <Square className="h-4 w-4 fill-current" />
        {!isCompact && "Stop"}
      </Button>
    </div>
  );
}