import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResultsTable } from '@/components/validation/results-table';
import { loadSession, ValidationSession } from '@/lib/session-manager';
import { ValidationResult } from '@/lib/types';

export function SessionDetails({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<ValidationSession | null>(null);
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    loadSession(sessionId).then((s) => {
      setSession(s);
      if (s) {
        setResults(s.results);
      }
    }).finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return <div className="flex justify-center items-center h-screen">
      <div className="text-lg">Loading session...</div>
    </div>;
  }

  if (!session) return null;

  const safeCount = results.filter(r => r.result === 'Safe').length;
  const riskyCount = results.filter(r => r.result === 'Risky').length;
  const invalidCount = results.filter(r => r.result === 'Invalid').length;
  const unknownCount = results.filter(r => r.result === 'Unknown').length;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">{session.name}</h2>
        <div className="text-sm text-muted-foreground">
          {session.currentIndex} / {session.total} validated
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Safe</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{safeCount}</div>
            <p className="text-xs text-muted-foreground">Deliverable emails</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Risky</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{riskyCount}</div>
            <p className="text-xs text-muted-foreground">Potential issues</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Invalid</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{invalidCount}</div>
            <p className="text-xs text-muted-foreground">Undeliverable emails</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-slate-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unknown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{unknownCount}</div>
            <p className="text-xs text-muted-foreground">Verification failed</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Validation Results</h3>
        <ResultsTable
          results={results}
          onViewDetails={() => {}}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onDeleteResults={(emailsToDelete) => {
            setResults(prev => prev.filter(r => !emailsToDelete.has(r.email)));
          }}
        />
        <div className="flex justify-end mt-4">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="px-4 py-2 border rounded-md hover:bg-accent"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
