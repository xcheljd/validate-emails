import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, ResponsiveContainer, Cell, Pie } from 'recharts';
import { ShieldAlert, BarChart3 } from 'lucide-react';
import { ValidationResult } from '@/lib/types';

interface StatusDataEntry {
  name: string;
  value: number;
  color: string;
}

interface StatisticsDashboardProps {
  results: ValidationResult[];
}

export function StatisticsDashboard({ results }: StatisticsDashboardProps) {
  const stats = useMemo(() => {
    const total = results.length;
    const safe = results.filter((r) => r.result === 'Safe').length;
    const risky = results.filter((r) => r.result === 'Risky').length;
    const invalid = results.filter((r) => r.result === 'Invalid').length;
    const unknown = results.filter((r) => r.result === 'Unknown').length;
    const breached = results.filter((r) => r.haveibeenpwned === true).length;

    const durations = results
      .map((r) => r.validationDuration)
      .filter((d) => d > 0);
    const avgDuration =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

    return {
      total,
      safe,
      risky,
      invalid,
      unknown,
      breached,
      avgDuration,
      validationSpeed: avgDuration > 0 ? Math.round(60000 / avgDuration) : 0,
    };
  }, [results]);

  const statusData = useMemo(() => {
    return [
      { name: 'Safe', value: stats.safe, color: '#22c55e' },
      { name: 'Risky', value: stats.risky, color: '#eab308' },
      { name: 'Invalid', value: stats.invalid, color: '#ef4444' },
      { name: 'Unknown', value: stats.unknown, color: '#64748b' },
    ];
  }, [stats]);

  const riskCounts = useMemo(() => {
    const veryLow = results.filter(
      (r) => r.riskScore >= 0 && r.riskScore < 10
    ).length;
    const low = results.filter(
      (r) => r.riskScore >= 10 && r.riskScore < 30
    ).length;
    const medium = results.filter(
      (r) => r.riskScore >= 30 && r.riskScore < 50
    ).length;
    const high = results.filter(
      (r) => r.riskScore >= 50 && r.riskScore < 80
    ).length;
    const veryHigh = results.filter(
      (r) => r.riskScore >= 80 && r.riskScore <= 100
    ).length;

    return {
      veryLow,
      low,
      medium,
      high,
      veryHigh,
    };
  }, [results]);

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="bg-muted p-6 rounded-full mb-4">
          <BarChart3 className="h-10 w-10 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No analytics data yet</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Run a validation to see statistics, risk distribution, domain
          analysis, and breach reports here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-6">
          <CardHeader className="flex flex-col items-center justify-center space-y-0 pb-2">
            <CardTitle className="text-4xl font-bold">{stats.total}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">Total Validated</div>
          </CardContent>
        </Card>
        <Card className="p-6 border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Safe</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.safe}</div>
            <div className="text-xs text-muted-foreground">
              Deliverable emails
            </div>
          </CardContent>
        </Card>
        <Card className="p-6 border-l-4 border-l-yellow-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Risky</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.risky}</div>
            <div className="text-xs text-muted-foreground">
              Potential issues
            </div>
          </CardContent>
        </Card>
        <Card className="p-6 border-l-4 border-l-red-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-4xl font-bold">
              {stats.invalid}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.invalid}</div>
            <div className="text-xs text-muted-foreground">
              Undeliverable emails
            </div>
          </CardContent>
        </Card>
        <Card className="p-6 border-l-4 border-l-slate-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-4xl font-bold">
              {stats.unknown}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.unknown}</div>
            <div className="text-xs text-muted-foreground">
              Verification failed
            </div>
          </CardContent>
        </Card>
      </div>

      {stats.breached > 0 && (
        <Card className="p-6 border-2 border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-8 w-8 text-red-500" />
                <div>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {stats.breached}
                  </div>
                  <div className="text-xs text-muted-foreground font-medium">
                    {stats.total > 0
                      ? `${((stats.breached / stats.total) * 100).toFixed(1)}% of emails found in known data breaches`
                      : 'Emails found in known data breaches'}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <CardHeader>
            <CardTitle>Validation Speed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.validationSpeed}</div>
            <div className="text-sm text-muted-foreground">emails/minute</div>
          </CardContent>
        </Card>
        <Card className="p-6">
          <CardHeader>
            <CardTitle>Average Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Math.round(stats.avgDuration / 1000)}s
            </div>
            <div className="text-xs text-muted-foreground">
              seconds per email
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 h-80">
        <Card className="p-6">
          <CardHeader>
            <CardTitle>Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  outerRadius={80}
                  dataKey="value"
                >
                  {statusData.map((entry: StatusDataEntry, index: number) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.color}
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="p-6">
          <CardHeader>
            <CardTitle>Risk Score Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm mb-2">
                <span>Very Low (0-9)</span>
                <span className="ml-auto">{riskCounts.veryLow}</span>
              </div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span>Low (10-29)</span>
                <span className="ml-auto">{riskCounts.low}</span>
              </div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span>Medium (30-49)</span>
                <span className="ml-auto">{riskCounts.medium}</span>
              </div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span>High (50-79)</span>
                <span className="ml-auto">{riskCounts.high}</span>
              </div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span>Very High (80-100)</span>
                <span className="ml-auto">{riskCounts.veryHigh}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
