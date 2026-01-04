import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listSessions, deleteSession, loadSession, ValidationSession, cleanupOldSessions } from '@/lib/session-manager';

export function SessionHistory({
  onViewDetails,
  onResume,
  onSessionSelected
}: {
  onViewDetails: (sessionId: string) => void;
  onResume: (sessionId: string) => void;
  onSessionSelected: (session: ValidationSession) => void;
}) {
  const [sessions, setSessions] = useState<ValidationSession[]>([]);

  useEffect(() => {
    listSessions().then(setSessions);
    cleanupOldSessions(90);
  }, []);

  const handleDelete = async (sessionId: string) => {
    if (confirm('Delete this session? This action cannot be undone.')) {
      await deleteSession(sessionId);
      setSessions(s => s.filter(session => session.id !== sessionId));
    }
  };

  const handleViewDetails = (sessionId: string) => {
    loadSession(sessionId).then(onSessionSelected);
    onViewDetails(sessionId);
  };

  const handleResume = (sessionId: string) => {
    onResume(sessionId);
  };

  const getStatusBadge = (status: string): string => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'in-progress': return 'bg-blue-500';
      case 'paused': return 'bg-yellow-500';
      case 'stopped': return 'bg-red-500';
      case 'pending': return 'bg-gray-500';
      default: return 'bg-gray-400';
    }
  };

  const formatPercentage = (current: number, total: number): string => {
    if (total === 0) return '0%';
    return `${Math.round((current / total) * 100)}%`;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Validation History</h2>
        <button
          type="button"
          onClick={() => listSessions().then(setSessions)}
          className="text-sm text-blue-600 hover:underline"
        >
          Refresh
        </button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Emails</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No sessions found. Start a new validation to create a session.
                </TableCell>
              </TableRow>
            ) : (
              sessions.map(session => (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">{session.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${getStatusBadge(session.status)}`}></span>
                      <span className="ml-2 text-sm">{session.status}</span>
                    </div>
                  </TableCell>
                  <TableCell>{session.total}</TableCell>
                  <TableCell>{formatPercentage(session.currentIndex, session.total)}</TableCell>
                  <TableCell>{session.createdAt}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleViewDetails(session.id)}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        View
                      </button>
                      {session.status === 'paused' && (
                        <button
                          type="button"
                          onClick={() => handleResume(session.id)}
                          className="text-sm text-blue-600 hover:underline"
                        >
                          Resume
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(session.id)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
