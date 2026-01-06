import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { addProxies, getProxyPoolStatus, clearProxyPool, ProxyPoolStatus } from '@/lib/proxy-manager';
import { toast } from 'sonner';

export function ProxySettings() {
  const [proxyList, setProxyList] = useState('');
  const [poolStatus, setPoolStatus] = useState<ProxyPoolStatus>({
    total_proxies: 0,
    active_proxy: null,
    success_rate: 0,
    average_speed: 0,
  });

  const fetchStatus = async () => {
    try {
      const status = await getProxyPoolStatus();
      setPoolStatus(status);
    } catch (error) {
      console.error('Failed to fetch proxy status:', error);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleAddProxies = async () => {
    if (!proxyList.trim()) return;
    
    const lines = proxyList.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    try {
      const result = await addProxies(lines);
      toast.success(result);
      setProxyList('');
      fetchStatus();
    } catch (error) {
      toast.error(`Failed to add proxies: ${error}`);
    }
  };

  const handleClearProxies = async () => {
    try {
      await clearProxyPool();
      toast.success('Proxy pool cleared');
      fetchStatus();
    } catch (error) {
      toast.error(`Failed to clear proxies: ${error}`);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Proxy Management</CardTitle>
          <CardDescription>
            Add SOCKS5 proxies to rotate IP addresses during validation.
            Format: <code>socks5://user:pass@host:port</code> or <code>host:port</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea 
            placeholder="socks5://user:pass@127.0.0.1:1080&#10;192.168.1.1:8080"
            rows={5}
            value={proxyList}
            onChange={(e) => setProxyList(e.target.value)}
            className="font-mono text-sm"
          />
          <div className="flex gap-2">
            <Button onClick={handleAddProxies} disabled={!proxyList.trim()}>
              Add Proxies
            </Button>
            <Button variant="outline" onClick={handleClearProxies} disabled={poolStatus.total_proxies === 0}>
              Clear Pool
            </Button>
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
              <div className="text-2xl font-bold">{poolStatus.total_proxies}</div>
              <div className="text-sm text-muted-foreground">Total Proxies</div>
            </div>
            <div>
              <div className="text-lg font-medium truncate px-2" title={poolStatus.active_proxy || 'None'}>
                {poolStatus.active_proxy || 'None'}
              </div>
              <div className="text-sm text-muted-foreground">Active Proxy</div>
            </div>
            <div className="flex flex-col items-center justify-center">
              <div className="text-2xl font-bold">
                {poolStatus.success_rate.toFixed(1)}%
              </div>
              <div className="text-sm text-muted-foreground">Success Rate</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
