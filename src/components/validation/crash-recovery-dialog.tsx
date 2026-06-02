import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, X, AlertTriangle } from 'lucide-react';
import { listSessions, type ValidationSession } from '@/lib/session-manager';

interface CrashRecoveryDialogProps {
  onResume: (sessionId: string) => void;
  onDismiss: () => void;
}

export function CrashRecoveryDialog({
  onResume,
  onDismiss,
}: CrashRecoveryDialogProps) {
  const [incompleteSessions, setIncompleteSessions] = useState<
    ValidationSession[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSessions()
      .then((sessions) => {
        const incomplete = sessions.filter(
          (s) => s.status === 'in-progress' || s.status === 'paused'
        );
        setIncompleteSessions(incomplete);
      })
      .catch(() => {
        setIncompleteSessions([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const hasIncomplete = incompleteSessions.length > 0;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'in-progress':
        return (
          <Badge variant="default" className="animate-pulse text-xs">
            In Progress
          </Badge>
        );
      case 'paused':
        return (
          <Badge variant="secondary" className="text-xs">
            Paused
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-xs">
            {status}
          </Badge>
        );
    }
  };

  const formatPercentage = (current: number, total: number): string => {
    if (total === 0) return '0%';
    return `${Math.round((current / total) * 100)}%`;
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString();
  };

  if (loading) return null;

  return (
    <Dialog open={hasIncomplete} onOpenChange={(open) => {
      if (!open) onDismiss();
    }}>
      <DialogContent className="sm:max-w-md" hideCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Resume Session
          </DialogTitle>
          <DialogDescription>
            You have incomplete validation sessions from a previous session.
            Choose a session to resume or dismiss to start fresh.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {incompleteSessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">
                    {session.name}
                  </span>
                  {getStatusBadge(session.status)}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{formatDate(session.createdAt)}</span>
                  <span>
                    {formatPercentage(session.currentIndex, session.total)}{' '}
                    complete ({session.currentIndex}/{session.total})
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onResume(session.id)}
                className="gap-1.5 shrink-0"
              >
                <Play className="h-3.5 w-3.5" />
                Resume
              </Button>
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onDismiss} className="gap-2">
            <X className="h-4 w-4" />
            Dismiss
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
