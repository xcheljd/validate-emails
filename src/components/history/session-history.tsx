import { useState, useEffect } from 'react';
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
import { Play, Trash2, Eye, RotateCcw } from 'lucide-react';
import {
  listSessions,
  deleteSession,
  loadSession,
  ValidationSession,
  cleanupOldSessions,
} from '@/lib/session-manager';

export function SessionHistory({
  onViewDetails,
  onResume,
  onSessionSelected,
}: {
  onViewDetails: (sessionId: string) => void;
  onResume: (sessionId: string) => void;
  onSessionSelected: (session: ValidationSession) => void;
}) {
  const [sessions, setSessions] = useState<ValidationSession[]>([]);

  useEffect(() => {
    loadSessions();
    cleanupOldSessions(90);
  }, []);

  const loadSessions = () => {
    listSessions().then(setSessions);
  };

  const handleDelete = async (sessionId: string) => {
    if (confirm('Delete this session? This action cannot be undone.')) {
      await deleteSession(sessionId);
      setSessions((s) => s.filter((session) => session.id !== sessionId));
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
        <Button
          variant="outline"
          size="sm"
          onClick={loadSessions}
          className="gap-2"
        >
          <RotateCcw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
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
                  colSpan={6}
                  className="text-center py-12 text-muted-foreground"
                >
                  No sessions found. Start a new validation to create a session.
                </TableCell>
              </TableRow>
            ) : (
              sessions.map((session) => (
                <TableRow key={session.id}>
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
