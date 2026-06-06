import { useState, useEffect, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Play, Trash2, Eye, RotateCcw, GitCompareArrows } from 'lucide-react';
import {
  listSessions,
  deleteSession,
  loadSession,
  ValidationSession,
  cleanupOldSessions,
} from '@/lib/session-manager';

interface SessionHistoryProps {
  onViewDetails: (sessionId: string) => void;
  onResume: (sessionId: string) => void;
  onSessionSelected: (session: ValidationSession) => void;
  onCompareSessions?: (sessionA: ValidationSession, sessionB: ValidationSession) => void;
}

export function SessionHistory({
  onViewDetails,
  onResume,
  onSessionSelected,
  onCompareSessions,
}: SessionHistoryProps) {
  const [sessions, setSessions] = useState<ValidationSession[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadSessions();
    cleanupOldSessions(90);
  }, []);

  const loadSessions = () => {
    listSessions().then(setSessions);
  };

  const toggleSelectSession = useCallback((sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === sessions.length) {
        return new Set();
      }
      return new Set(sessions.map((s) => s.id));
    });
  }, [sessions]);

  const handleCompare = async () => {
    if (selectedIds.size !== 2 || !onCompareSessions) return;
    const [idA, idB] = Array.from(selectedIds);
    const [sessionA, sessionB] = await Promise.all([
      loadSession(idA),
      loadSession(idB),
    ]);
    onCompareSessions(sessionA, sessionB);
  };

  const handleDelete = async (sessionId: string) => {
    if (confirm('Delete this session? This action cannot be undone.')) {
      await deleteSession(sessionId);
      setSessions((s) => s.filter((session) => session.id !== sessionId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  };

  const handleViewDetails = (sessionId: string) => {
    loadSession(sessionId).then(onSessionSelected);
    onViewDetails(sessionId);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className="bg-green-500 hover:bg-green-600">Completed</Badge>
        );
      case 'in-progress':
        return (
          <Badge variant="default" className="animate-pulse">
            In Progress
          </Badge>
        );
      case 'paused':
        return <Badge variant="secondary">Paused</Badge>;
      case 'stopped':
        return <Badge variant="destructive">Stopped</Badge>;
      case 'pending':
        return <Badge variant="outline">Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatPercentage = (current: number, total: number): string => {
    if (total === 0) return '0%';
    return `${Math.round((current / total) * 100)}%`;
  };

  const allSelected = sessions.length > 0 && selectedIds.size === sessions.length;
  const canCompare = selectedIds.size === 2 && !!onCompareSessions;

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex justify-between items-center">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">
            Validation History
          </h2>
          <p className="text-muted-foreground text-sm">
            Manage your past validation sessions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && onCompareSessions && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCompare}
              disabled={!canCompare}
              className="gap-2"
              title={
                selectedIds.size === 2
                  ? 'Compare selected sessions'
                  : `Select exactly 2 sessions to compare (${selectedIds.size}/2 selected)`
              }
            >
              <GitCompareArrows className="h-4 w-4" />
              Compare{selectedIds.size > 0 ? ` (${selectedIds.size}/2)` : ''}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={loadSessions}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all sessions"
                />
              </TableHead>
              <TableHead>Session Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Emails</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-12 text-muted-foreground"
                >
                  No sessions found. Start a new validation to create a session.
                </TableCell>
              </TableRow>
            ) : (
              sessions.map((session) => (
                <TableRow
                  key={session.id}
                  className={
                    selectedIds.has(session.id) ? 'bg-primary/5' : ''
                  }
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(session.id)}
                      onCheckedChange={() => toggleSelectSession(session.id)}
                      aria-label={`Select ${session.name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{session.name}</TableCell>
                  <TableCell>{getStatusBadge(session.status)}</TableCell>
                  <TableCell>{session.total}</TableCell>
                  <TableCell>
                    {formatPercentage(session.currentIndex, session.total)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(session.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="View Details"
                        onClick={() => handleViewDetails(session.id)}
                      >
                        <Eye className="h-4 w-4 text-primary" />
                      </Button>
                      {session.status === 'paused' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Resume"
                          onClick={() => onResume(session.id)}
                        >
                          <Play className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        onClick={() => handleDelete(session.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
