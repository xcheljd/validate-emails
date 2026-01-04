import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function ProxySettings() {
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [rotationStrategy, setRotationStrategy] = useState('on-failure');
  const [maxPerProxy, setMaxPerProxy] = useState(50);
  const [protocol, setProtocol] = useState('any');
  const [poolStatus, setPoolStatus] = useState({
    totalProxies: 0,
    activeProxy: null,
    successRate: 0,
    averageSpeed: 0,
  });

  const handleRefresh = () => {
    setPoolStatus(prev => ({ ...prev, totalProxies: prev.totalProxies + 1 }));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Proxy Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="flex items-center justify-between mb-2">
              <span className="font-medium">Enable Proxy</span>
              <input
                type="checkbox"
                checked={proxyEnabled}
                onChange={(e) => setProxyEnabled(e.target.checked)}
              />
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Rotation Strategy</label>
            <select
              value={rotationStrategy}
              onChange={(e) => setRotationStrategy(e.target.value)}
              className="mt-2 w-full p-2 border rounded-md"
            >
              <option value="on-failure">Rotate on Failure (Recommended)</option>
              <option value="per-email">Rotate Per Email</option>
              <option value="per-batch">Rotate Per Batch</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Max Emails Per Proxy</label>
            <input
              type="number"
              min="10"
              max="100"
              value={maxPerProxy}
              onChange={(e) => setMaxPerProxy(Number(e.target.value))}
              className="mt-2 w-full p-2 border rounded-md"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Protocol Preference</label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="mt-2 w-full p-2 border rounded-md"
            >
              <option value="any">Any</option>
              <option value="http">HTTP</option>
              <option value="socks5">SOCKS5</option>
            </select>
          </div>

          <div>
            <label className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Actions</span>
              <button
                type="button"
                onClick={handleRefresh}
                className="px-4 py-2 border rounded-md hover:bg-accent"
              >
                Refresh Proxy List
              </button>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proxy Pool Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-lg font-semibold">{poolStatus.totalProxies}</div>
              <div className="text-sm text-muted-foreground">Total Proxies</div>
            </div>
            <div>
              <div className="text-lg font-semibold">{poolStatus.activeProxy || 'None'}</div>
              <div className="text-sm text-muted-foreground">Active Proxy</div>
            </div>
            <div className="flex items-center justify-center">
              <Badge className="bg-blue-500 text-white">{poolStatus.successRate}% Success Rate</Badge>
            </div>
          </div>
          <div className="text-center mt-4">
            <div className="text-3xl font-semibold">{Math.round(poolStatus.averageSpeed)}</div>
            <div className="text-sm text-muted-foreground">KB/s</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
