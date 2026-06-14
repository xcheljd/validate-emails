import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import {
  Activity,
  HeartPulse,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Gauge,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  ProxyConfig,
  ProxyStats,
  AutoDisableThreshold,
  getProxyId,
  calculateSuccessRate,
  getHealthStatus,
} from '@/hooks/use-settings';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ProxyHealthDashboardProps {
  proxies: ProxyConfig[];
  proxyStats: Record<string, ProxyStats>;
  autoDisableThreshold: AutoDisableThreshold;
  onReEnableProxy: (proxyId: string) => Promise<void>;
  onSetAutoDisableThreshold: (threshold: AutoDisableThreshold) => Promise<void>;
  disabled?: boolean;
}

/** Get color for health status */
function getHealthBadgeColor(successRate: number): string {
  if (successRate >= 90) return 'bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30';
  if (successRate >= 50) return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
  return 'bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30';
}

/** Get label for health status */
function getHealthBadgeLabel(successRate: number): string {
  if (successRate >= 90) return 'Healthy';
  if (successRate >= 50) return 'Degraded';
  return 'Failed';
}

/** Get bar chart color for success rate */
function getBarColor(successRate: number): string {
  if (successRate >= 90) return '#10b981';
  if (successRate >= 50) return '#f59e0b';
  return '#ef4444';
}

export function ProxyHealthDashboard({
  proxies,
  proxyStats,
  autoDisableThreshold,
  onReEnableProxy,
  onSetAutoDisableThreshold,
  disabled = false,
}: ProxyHealthDashboardProps) {
  const [localThreshold, setLocalThreshold] = useState(autoDisableThreshold);

  useEffect(() => {
    setLocalThreshold(autoDisableThreshold);
  }, [autoDisableThreshold]);

  // Calculate aggregate stats
  const totalProxies = proxies.length;
  const statsEntries = proxies.map((proxy) => {
    const id = getProxyId(proxy);
    const stats = proxyStats[id];
    const successRate = stats ? calculateSuccessRate(stats) : 100;
    const healthStatus = stats ? getHealthStatus(stats) : 'healthy' as const;
    const autoDisabled = stats?.autoDisabled ?? false;
    return { id, proxy, stats, successRate, healthStatus, autoDisabled };
  });

  const healthyCount = statsEntries.filter(
    (e) => e.healthStatus === 'healthy' && !e.autoDisabled
  ).length;
  const degradedCount = statsEntries.filter(
    (e) => e.healthStatus === 'degraded' && !e.autoDisabled
  ).length;
  const failedCount = statsEntries.filter(
    (e) => (e.healthStatus === 'failed' && !e.autoDisabled) || e.autoDisabled
  ).length;

  // Chart data
  const chartData = statsEntries.map((entry) => ({
    name: entry.id.length > 18 ? entry.id.substring(0, 15) + '...' : entry.id,
    successRate: entry.successRate,
    fullName: entry.id,
  }));

  // Auto-disable threshold handlers
  const handleSuccessRateChange = useCallback(
    (value: string) => {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        setLocalThreshold((prev) => ({
          ...prev,
          successRatePercent: parsed,
        }));
      }
    },
    []
  );

  const handleMinAttemptsChange = useCallback(
    (value: string) => {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed) && parsed >= 1) {
        setLocalThreshold((prev) => ({
          ...prev,
          minAttempts: parsed,
        }));
      }
    },
    []
  );

  const handleSaveThreshold = useCallback(async () => {
    try {
      await onSetAutoDisableThreshold(localThreshold);
      toast.success('Auto-disable threshold saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save threshold';
      toast.error(message);
    }
  }, [localThreshold, onSetAutoDisableThreshold]);

  // Re-enable proxy handler with explicit logging for debugging
  const handleReEnable = useCallback(
    async (proxyId: string, event?: React.MouseEvent<HTMLButtonElement> | React.PointerEvent<HTMLButtonElement>) => {
      // Prevent any potential event propagation issues
      event?.stopPropagation();

      try {
        await onReEnableProxy(proxyId);
        toast.success(`Proxy ${proxyId} re-enabled`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to re-enable proxy';
        toast.error(message);
      }
    },
    [onReEnableProxy]
  );

  // No proxies configured
  if (proxies.length === 0) {
    return (
      <div className="space-y-6">
        <h3 className="text-lg font-medium">Proxy Health Dashboard</h3>
        <Card>
          <CardContent className="py-8 text-center">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm text-muted-foreground">
              No proxies configured. Add proxies in the Proxy tab to see health data.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">Proxy Health Dashboard</h3>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Total Proxies
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProxies}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <HeartPulse className="h-3 w-3 text-green-500" />
              Healthy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {healthyCount}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-yellow-500" />
              Degraded
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {degradedCount}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <XCircle className="h-3 w-3 text-red-500" />
              Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {failedCount}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Success Rate Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Success Rate by Proxy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 40)}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
              >
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: number | undefined) => [`${value ?? 0}%`, 'Success Rate']}
                  labelFormatter={(label: string) => {
                    const entry = chartData.find((d) => d.name === label);
                    return entry?.fullName || label;
                  }}
                />
                <Bar dataKey="successRate" radius={[0, 4, 4, 0]} barSize={24}>
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill={getBarColor(entry.successRate)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Per-Proxy Details Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Proxy Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host:Port</TableHead>
                <TableHead>Success Rate</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statsEntries.map((entry) => (
                <TableRow
                  key={entry.id}
                  className={cn(
                    entry.autoDisabled && 'bg-orange-50 dark:bg-orange-950/20'
                  )}
                >
                  <TableCell className="font-mono text-sm">
                    {entry.proxy.host}:{entry.proxy.port}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {entry.stats ? (
                      <span
                        className={cn(
                          entry.successRate >= 90 && 'text-green-600 dark:text-green-400',
                          entry.successRate >= 50 && entry.successRate < 90 && 'text-yellow-600 dark:text-yellow-400',
                          entry.successRate < 50 && 'text-red-600 dark:text-red-400'
                        )}
                      >
                        {entry.successRate}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {entry.stats && entry.stats.avgDurationMs > 0
                      ? `${Math.round(entry.stats.avgDurationMs)} ms`
                      : 'N/A'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {entry.stats?.attempts ?? 0}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={cn('text-xs', getHealthBadgeColor(entry.successRate))}
                      >
                        {getHealthBadgeLabel(entry.successRate)}
                      </Badge>
                      {entry.autoDisabled && (
                        <Badge
                          variant="outline"
                          className="text-xs bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/30"
                        >
                          Auto-disabled
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {entry.autoDisabled && (
                      // Wrapper div with explicit pointer-events:auto and high z-index
                      // to ensure button is clickable even if TableCell/TableRow CSS interferes
                      <div
                        style={{
                          pointerEvents: 'auto',
                          zIndex: 100,
                          position: 'relative',
                        }}
                        className="inline-block"
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs relative z-10"
                          onClick={(e) => handleReEnable(entry.id, e)}
                          disabled={disabled}
                          type="button"
                          style={{ pointerEvents: 'auto' }}
                          data-testid={`re-enable-button-${entry.id.replace(/[^a-zA-Z0-9]/g, '-')}`}
                        >
                          <RefreshCw className="h-3 w-3 mr-1 pointer-events-none" />
                          Re-enable
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Auto-Disable Threshold Settings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            Auto-Disable Threshold
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Proxies falling below the success rate threshold (after minimum attempts) are automatically
            disabled and excluded from rotation.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="auto-disable-rate">Success Rate Below (%)</Label>
              <Input
                id="auto-disable-rate"
                type="number"
                value={localThreshold.successRatePercent}
                onChange={(e) => handleSuccessRateChange(e.target.value)}
                min={0}
                max={100}
                disabled={disabled}
              />
              <p className="text-[10px] text-muted-foreground">
                Proxies below this rate are disabled (default: 20%)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="auto-disable-attempts">Minimum Attempts</Label>
              <Input
                id="auto-disable-attempts"
                type="number"
                value={localThreshold.minAttempts}
                onChange={(e) => handleMinAttemptsChange(e.target.value)}
                min={1}
                disabled={disabled}
              />
              <p className="text-[10px] text-muted-foreground">
                Minimum validations before checking (default: 10)
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSaveThreshold}
              disabled={disabled}
            >
              Save Threshold
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
