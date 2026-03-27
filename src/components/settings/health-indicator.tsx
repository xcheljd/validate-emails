import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { 
  calculateSuccessRate, 
  getHealthStatus, 
  isProxyBad,
  type ProxyStats, 
  type HealthStatus 
} from '@/hooks/use-settings';

interface HealthIndicatorProps {
  stats: ProxyStats;
  showBadIndicator?: boolean;
  compact?: boolean;
  className?: string;
}

/** Get the color class for a health status */
export function getHealthColor(status: HealthStatus): string {
  switch (status) {
    case 'healthy':
      return 'bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30';
    case 'degraded':
      return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
    case 'failed':
      return 'bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30';
  }
}

/** Get the label for a health status */
export function getHealthLabel(status: HealthStatus): string {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'degraded':
      return 'Degraded';
    case 'failed':
      return 'Failed';
  }
}

export function HealthIndicator({ 
  stats, 
  showBadIndicator = false, 
  compact = false,
  className 
}: HealthIndicatorProps) {
  const successRate = calculateSuccessRate(stats);
  const healthStatus = getHealthStatus(stats);
  const isBad = isProxyBad(stats);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Success rate */}
      <span className={cn(
        'font-mono text-sm',
        compact && 'text-xs'
      )}>
        {successRate}%
      </span>
      
      {/* Health status badge */}
      <Badge 
        variant="outline" 
        className={cn(
          'text-xs',
          getHealthColor(healthStatus)
        )}
      >
        {getHealthLabel(healthStatus)}
      </Badge>

      {/* Bad proxy indicator */}
      {showBadIndicator && isBad && (
        <Badge 
          variant="outline" 
          className="text-xs bg-red-600/20 text-red-700 dark:text-red-400 border-red-600/30"
        >
          Bad
        </Badge>
      )}
    </div>
  );
}
