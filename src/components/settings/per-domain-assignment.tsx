import { useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Globe, ArrowRight } from 'lucide-react';
import { ProxyConfig } from '@/hooks/use-settings';
import { cn } from '@/lib/utils';

/** Supported domains for per-domain proxy assignment */
const SUPPORTED_DOMAINS = [
  { id: 'gmail.com', label: 'Gmail', icon: '📧' },
  { id: 'yahoo.com', label: 'Yahoo', icon: '📮' },
  { id: 'hotmail.com', label: 'Hotmail', icon: '📬' },
] as const;

interface PerDomainAssignmentProps {
  /** List of available proxies to assign */
  proxies: ProxyConfig[];
  /** Current domain assignments (domain -> proxy host:port) */
  domainAssignments: Record<string, string>;
  /** Callback when a domain is assigned to a proxy */
  onAssign: (domain: string, proxyId: string | null) => void;
  /** Whether the component is disabled */
  disabled?: boolean;
}

/** Generate unique proxy ID */
function getProxyId(proxy: ProxyConfig): string {
  return `${proxy.host}:${proxy.port}`;
}

export function PerDomainAssignment({
  proxies,
  domainAssignments,
  onAssign,
  disabled = false,
}: PerDomainAssignmentProps) {
  const handleAssignmentChange = useCallback(
    (domain: string, proxyId: string) => {
      if (proxyId === '') {
        // "None" selected - unassign
        onAssign(domain, null);
      } else {
        onAssign(domain, proxyId);
      }
    },
    [onAssign]
  );

  const getAssignedProxy = useCallback(
    (domain: string): ProxyConfig | undefined => {
      const proxyId = domainAssignments[domain.toLowerCase()];
      return proxies.find((p) => getProxyId(p) === proxyId);
    },
    [proxies, domainAssignments]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Domain Assignments</Label>
        <span className="text-xs text-muted-foreground">
          Assign specific proxies to email domains
        </span>
      </div>

      <div className="border rounded-md bg-muted/30 divide-y">
        {SUPPORTED_DOMAINS.map((domain) => {
          const assignedProxy = getAssignedProxy(domain.id);
          const assignedId = assignedProxy ? getProxyId(assignedProxy) : '';

          return (
            <div
              key={domain.id}
              className="flex items-center justify-between px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg" role="img" aria-hidden="true">
                  {domain.icon}
                </span>
                <div>
                  <span className="text-sm font-medium">{domain.label}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {domain.id}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {assignedProxy && (
                  <>
                    <Badge
                      variant="secondary"
                      className="font-mono text-xs max-w-[150px] truncate"
                    >
                      {assignedProxy.host}:{assignedProxy.port}
                    </Badge>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  </>
                )}

                <select
                  className={cn(
                    'flex h-8 rounded-md border border-input bg-background px-2 py-1 text-xs',
                    'ring-offset-background focus-visible:outline-none focus-visible:ring-2',
                    'focus-visible:ring-ring focus-visible:ring-offset-2',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    !assignedProxy && 'text-muted-foreground'
                  )}
                  value={assignedId}
                  onChange={(e) =>
                    handleAssignmentChange(domain.id, e.target.value)
                  }
                  disabled={disabled}
                  aria-label={`Select proxy for ${domain.label}`}
                >
                  <option value="">Default (rotation)</option>
                  {proxies.map((proxy) => (
                    <option key={getProxyId(proxy)} value={getProxyId(proxy)}>
                      {proxy.host}:{proxy.port}
                      {proxy.username ? ' (auth)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        <Globe className="h-3 w-3 inline mr-1" />
        Unassigned domains will use the default rotation or manual selection.
      </p>
    </div>
  );
}
