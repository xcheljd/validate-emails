import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loading } from '@/components/ui/loading';
import { StatisticsDashboard } from '@/components/analytics/statistics-dashboard';
import { DomainAnalysis } from '@/components/analytics/domain-analysis';
import {
  listSessions,
  loadSession,
  type SessionSummary,
} from '@/lib/session-manager';
import type { ValidationResult } from '@/lib/types';
import type { ValidationStatus } from '@/hooks/validation-types';

/** Picker value for the in-memory results of the current/last run. */
export const CURRENT_RUN = '__current_run__';

interface AnalyticsViewProps {
  /** In-memory results of the current/last run. */
  liveResults: ValidationResult[];
  status: ValidationStatus;
}

interface LoadedSession {
  id: string;
  results: ValidationResult[];
}

/**
 * Analytics for the current run or a saved session.
 *
 * Source precedence:
 *   1. A source the user picked explicitly ('Current run' or a session).
 *   2. Otherwise the current run, if it has results or is in progress.
 *   3. Otherwise the most recent session by createdAt.
 * Starting a new run clears the explicit pick, so the live view wins again.
 *
 * Only session summaries (metadata) are listed; results are loaded for the
 * selected session alone. A session with no results shows the empty state.
 */
export function AnalyticsView({ liveResults, status }: AnalyticsViewProps) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setListError(null);
    listSessions()
      .then((list) => {
        if (cancelled) return;
        setSessions(
          [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        );
      })
      .catch((err) => {
        if (!cancelled) setListError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [listAttempt]);

  // A new run takes the view back from any picked session.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (status === 'processing' && prevStatus.current === 'idle') {
      setPicked(null);
    }
    prevStatus.current = status;
  }, [status]);

  const liveActive = liveResults.length > 0 || status !== 'idle';
  const source =
    picked ?? (liveActive ? CURRENT_RUN : (sessions?.[0]?.id ?? CURRENT_RUN));
  const sessionId = source === CURRENT_RUN ? null : source;

  useEffect(() => {
    if (!sessionId || loaded?.id === sessionId) return;
    let cancelled = false;
    setLoadError(null);
    loadSession(sessionId)
      .then((session) => {
        if (!cancelled) setLoaded({ id: sessionId, results: session.results });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
    // `loaded` is read only to skip a reload of the session already shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, loadAttempt]);

  // Wait for the list before falling back to an empty live view.
  const listPending = sessions === null && !listError && !liveActive;
  const results =
    sessionId === null
      ? liveResults
      : loaded?.id === sessionId
        ? loaded.results
        : null;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {listError && (
        <ErrorLine
          message={`Could not list sessions: ${listError}`}
          onRetry={() => setListAttempt((n) => n + 1)}
        />
      )}

      {sessions && sessions.length > 0 && (
        <div className="flex items-center gap-3">
          <Label htmlFor="analytics-source">Showing</Label>
          <select
            id="analytics-source"
            value={source}
            onChange={(e) => setPicked(e.target.value)}
            className="p-2 border rounded-md bg-background"
          >
            <option value={CURRENT_RUN}>Current run</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({new Date(s.createdAt).toLocaleString()})
              </option>
            ))}
          </select>
        </div>
      )}

      {sessionId && loadError ? (
        <ErrorLine
          message={`Could not load session: ${loadError}`}
          onRetry={() => setLoadAttempt((n) => n + 1)}
        />
      ) : listPending || results === null ? (
        <Loading message="Loading session..." />
      ) : (
        <>
          <StatisticsDashboard results={results} />
          <DomainAnalysis results={results} />
        </>
      )}
    </div>
  );
}

function ErrorLine({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-3 text-sm text-destructive">
      <span>{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
