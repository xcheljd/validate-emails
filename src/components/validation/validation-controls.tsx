import { Button } from "@/components/ui/button";
import { Pause, Play, Square } from "lucide-react";
import { ValidationStatus } from "@/hooks/use-email-validation";

interface ValidationControlsProps {
  status: ValidationStatus;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function ValidationControls({
  status,
  onPause,
  onResume,
  onStop,
}: ValidationControlsProps) {
  if (status === 'idle') return null;

  return (
    <div className="flex items-center gap-2">
      {status === 'processing' && (
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onPause}
          className="flex items-center gap-2"
        >
          <Pause className="h-4 w-4" />
          Pause
        </Button>
      )}
      
      {status === 'paused' && (
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onResume}
          className="flex items-center gap-2"
        >
          <Play className="h-4 w-4" />
          Resume
        </Button>
      )}

      <Button 
        variant="destructive" 
        size="sm" 
        onClick={onStop}
        className="flex items-center gap-2"
        disabled={status === 'stopping'}
      >
        <Square className="h-4 w-4 fill-current" />
        Stop
      </Button>
    </div>
  );
}
