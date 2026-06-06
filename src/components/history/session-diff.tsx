import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, ArrowLeft } from 'lucide-react';
import { ValidationSession } from '@/lib/session-manager';
import { computeSessionDiff, countByVerdict } from '@/lib/session-diff';
import type { SessionDiff } from '@/lib/session-diff';
import type { ValidationResult } from '@/lib/types';

interface SessionDiffViewProps {
  sessionA: ValidationSession;
  sessionB: ValidationSession;
  onBack: () => void;
}

function VerdictSummaryCard({
  label,
  countA,
  countB,
  icon,
}: {
  label: string;
  countA: number;
  countB: number;
  icon: React.ReactNode;
}) {
  const diff = countB - countA;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold">{countA}</span>
          <span className="text-muted-foreground text-sm">→</span>
          <span className="text-2xl font-bold">{countB}</span>
        </div>
        {diff !== 0 && (
          <p
            className={`text-xs mt-1 ${
              diff > 0 ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {diff > 0 ? '+' : ''}
            {diff} change
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CollapsibleSection({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-lg">
      <button
        type="button"
        className="flex items-center gap-2 w-full p-4 hover:bg-accent/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <span className="font-semibold">{title}</span>
        <Badge variant="secondary" className="ml-auto">
          {count}
        </Badge>
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function getVerdictColor(verdict: string): string {
  switch (verdict) {
    case 'Safe':
      return 'bg-green-500 hover:bg-green-600 text-white';
    case 'Risky':
      return 'bg-yellow-500 hover:bg-yellow-600 text-white';
    case 'Invalid':
      return 'bg-red-500 hover:bg-red-600 text-white';
    case 'Unknown':
      return 'bg-slate-500 hover:bg-slate-600 text-white';
    default:
      return '';
  }
}

function VerdictBadge({ verdict }: { verdict: string }) {
  return (
    <Badge className={getVerdictColor(verdict)}>{verdict}</Badge>
  );
}

function ChangeDirectionIcon({
  oldVerdict,
  newVerdict,
}: {
  oldVerdict: string;
  newVerdict: string;
}) {
  const order = { Safe: 0, Risky: 1, Unknown: 2, Invalid: 3 } as Record<
    string,
    number
  >;
  const oldRank = order[oldVerdict] ?? 2;
  const newRank = order[newVerdict] ?? 2;

  if (newRank < oldRank) {
    // Improved (e.g., Unknown → Safe)
    return <span className="text-green-600 text-sm font-medium">Improved</span>;
  } else if (newRank > oldRank) {
    // Worsened (e.g., Safe → Invalid)
    return <span className="text-red-600 text-sm font-medium">Worsened</span>;
  }
  return <span className="text-yellow-600 text-sm font-medium">Changed</span>;
}

export function SessionDiffView({
  sessionA,
  sessionB,
  onBack,
}: SessionDiffViewProps) {
  const diff: SessionDiff = useMemo(
    () => computeSessionDiff(sessionA, sessionB),
    [sessionA, sessionB]
  );

  const verdicts: Array<ValidationResult['result']> = [
    'Safe',
    'Risky',
    'Invalid',
    'Unknown',
  ];

  const verdictIcons: Record<string, string> = {
    Safe: '✓',
    Risky: '⚠',
    Invalid: '✗',
    Unknown: '?',
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">
            Session Comparison
          </h2>
          <p className="text-muted-foreground text-sm">
            Comparing results between two validation sessions
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back to History
        </Button>
      </div>

      {/* Session Names */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 bg-primary/5 rounded-lg border">
          <p className="text-xs text-muted-foreground font-medium uppercase">
            Session A
          </p>
          <p className="font-semibold">{sessionA.name}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(sessionA.createdAt).toLocaleString()} •{' '}
            {sessionA.results.length} results
          </p>
        </div>
        <div className="p-3 bg-primary/5 rounded-lg border">
          <p className="text-xs text-muted-foreground font-medium uppercase">
            Session B
          </p>
          <p className="font-semibold">{sessionB.name}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(sessionB.createdAt).toLocaleString()} •{' '}
            {sessionB.results.length} results
          </p>
        </div>
      </div>

      {/* Summary Cards - Verdict counts side by side */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {verdicts.map((verdict) => (
          <VerdictSummaryCard
            key={verdict}
            label={`${verdict}`}
            countA={countByVerdict(sessionA.results, verdict)}
            countB={countByVerdict(sessionB.results, verdict)}
            icon={<span className="text-lg">{verdictIcons[verdict]}</span>}
          />
        ))}
      </div>

      {/* Stats Summary */}
      <div className="p-4 bg-muted/50 rounded-lg border space-y-1">
        <p className="font-semibold text-sm">Summary</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">
              {diff.stats.totalChanged}
            </span>{' '}
            email{diff.stats.totalChanged !== 1 ? 's' : ''} changed verdict
          </span>
          <span>
            <span className="font-medium text-green-600">
              {diff.stats.totalAdded}
            </span>{' '}
            added
          </span>
          <span>
            <span className="font-medium text-red-600">
              {diff.stats.totalRemoved}
            </span>{' '}
            removed
          </span>
          <span>
            <span className="font-medium text-foreground">
              {diff.stats.unchanged}
            </span>{' '}
            unchanged
          </span>
        </div>
        {/* Change summary breakdown */}
        {Object.keys(diff.changeSummary).length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {Object.entries(diff.changeSummary).map(([transition, count]) => (
              <Badge key={transition} variant="outline" className="text-xs">
                {transition} ({count})
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Changed Section */}
      {diff.changed.length > 0 && (
        <CollapsibleSection
          title="Changed Verdicts"
          count={diff.changed.length}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Session A</TableHead>
                <TableHead>→</TableHead>
                <TableHead>Session B</TableHead>
                <TableHead>Direction</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diff.changed.map((change) => (
                <TableRow key={change.email}>
                  <TableCell className="font-medium">
                    {change.email}
                  </TableCell>
                  <TableCell>
                    <VerdictBadge verdict={change.oldVerdict} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">→</TableCell>
                  <TableCell>
                    <VerdictBadge verdict={change.newVerdict} />
                  </TableCell>
                  <TableCell>
                    <ChangeDirectionIcon
                      oldVerdict={change.oldVerdict}
                      newVerdict={change.newVerdict}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CollapsibleSection>
      )}

      {/* Added Section */}
      {diff.added.length > 0 && (
        <CollapsibleSection title="Added Emails" count={diff.added.length}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diff.added.map((result) => (
                <TableRow key={result.email}>
                  <TableCell className="font-medium">{result.email}</TableCell>
                  <TableCell>
                    <VerdictBadge verdict={result.result} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CollapsibleSection>
      )}

      {/* Removed Section */}
      {diff.removed.length > 0 && (
        <CollapsibleSection title="Removed Emails" count={diff.removed.length}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diff.removed.map((result) => (
                <TableRow key={result.email}>
                  <TableCell className="font-medium">{result.email}</TableCell>
                  <TableCell>
                    <VerdictBadge verdict={result.result} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CollapsibleSection>
      )}

      {/* No changes message */}
      {diff.added.length === 0 &&
        diff.removed.length === 0 &&
        diff.changed.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg font-medium">No differences found</p>
            <p className="text-sm mt-1">
              Both sessions have identical results.
            </p>
          </div>
        )}
    </div>
  );
}
