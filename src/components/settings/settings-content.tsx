import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Save, History, ShieldCheck, Shield } from "lucide-react";
import { useSettings, AppSettings, RotationMode, ProxyConfig } from '@/hooks/use-settings';
import { toast } from "sonner";
import { ProxyList } from './proxy-list';
import { PerDomainAssignment } from './per-domain-assignment';

interface SettingsContentProps {
  onClose?: () => void;
}

export function SettingsContent({ onClose }: SettingsContentProps) {
  const { 
    settings, 
    updateSettings, 
    addProxy, 
    updateProxy, 
    deleteProxy,
    updateProxyPoolConfig,
    assignDomainProxy,
    unassignDomainProxy,
  } = useSettings();
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [activeTab, setActiveTab] = useState('validation');

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleSave = () => {
    updateSettings(localSettings);
    toast.success("Settings saved successfully");
    if (onClose) onClose();
  };

  const handleChange = (key: keyof AppSettings, value: any) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
  };

  // Proxy enabled toggle - persists to backend immediately
  const handleProxyEnabledChange = useCallback(async (enabled: boolean) => {
    setLocalSettings(prev => ({
      ...prev,
      proxy: { ...prev.proxy, enabled },
    }));
    try {
      await updateProxyPoolConfig(enabled, undefined);
    } catch (error) {
      toast.error("Failed to update proxy settings");
    }
  }, [updateProxyPoolConfig]);

  // Proxy rotation mode change - persists to backend immediately
  const handleRotationModeChange = useCallback(async (rotationMode: RotationMode) => {
    setLocalSettings(prev => ({
      ...prev,
      proxy: { ...prev.proxy, rotationMode },
    }));
    try {
      await updateProxyPoolConfig(undefined, rotationMode);
    } catch (error) {
      toast.error("Failed to update rotation mode");
    }
  }, [updateProxyPoolConfig]);

  // Proxy list handlers - persist to backend immediately
  const handleAddProxy = useCallback(async (proxy: ProxyConfig) => {
    setLocalSettings(prev => ({
      ...prev,
      proxy: { ...prev.proxy, proxies: [...prev.proxy.proxies, proxy] },
    }));
    try {
      await addProxy(proxy);
      toast.success("Proxy added successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add proxy";
      toast.error(message);
      // Revert local state on error
      setLocalSettings(prev => ({
        ...prev,
        proxy: { ...prev.proxy, proxies: prev.proxy.proxies.slice(0, -1) },
      }));
    }
  }, [addProxy]);

  const handleUpdateProxy = useCallback(async (index: number, proxy: ProxyConfig) => {
    const oldProxy = localSettings.proxy.proxies[index];
    const oldId = `${oldProxy.host}:${oldProxy.port}`;
    
    setLocalSettings(prev => {
      const newProxies = [...prev.proxy.proxies];
      newProxies[index] = proxy;
      return {
        ...prev,
        proxy: { ...prev.proxy, proxies: newProxies },
      };
    });
    
    try {
      await updateProxy(oldId, proxy);
      toast.success("Proxy updated successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update proxy";
      toast.error(message);
      // Revert local state on error
      setLocalSettings(prev => {
        const newProxies = [...prev.proxy.proxies];
        newProxies[index] = oldProxy;
        return {
          ...prev,
          proxy: { ...prev.proxy, proxies: newProxies },
        };
      });
    }
  }, [localSettings.proxy.proxies, updateProxy]);

  const handleDeleteProxy = useCallback(async (index: number) => {
    const proxyToDelete = localSettings.proxy.proxies[index];
    const proxyId = `${proxyToDelete.host}:${proxyToDelete.port}`;
    
    setLocalSettings(prev => ({
      ...prev,
      proxy: { ...prev.proxy, proxies: prev.proxy.proxies.filter((_, i) => i !== index) },
    }));
    
    try {
      await deleteProxy(proxyId);
      toast.success("Proxy removed successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete proxy";
      toast.error(message);
      // Revert local state on error
      setLocalSettings(prev => ({
        ...prev,
        proxy: { ...prev.proxy, proxies: [...prev.proxy.proxies.slice(0, index), proxyToDelete, ...prev.proxy.proxies.slice(index)] },
      }));
    }
  }, [localSettings.proxy.proxies, deleteProxy]);

  // Per-domain proxy assignment handler
  const handleDomainAssign = useCallback(async (domain: string, proxyId: string | null) => {
    setLocalSettings(prev => {
      const newAssignments = { ...prev.proxy.domainAssignments };
      if (proxyId === null) {
        delete newAssignments[domain.toLowerCase()];
      } else {
        newAssignments[domain.toLowerCase()] = proxyId;
      }
      return {
        ...prev,
        proxy: { ...prev.proxy, domainAssignments: newAssignments },
      };
    });

    try {
      if (proxyId === null) {
        await unassignDomainProxy(domain);
        toast.success(`Removed proxy assignment for ${domain}`);
      } else {
        await assignDomainProxy(domain, proxyId);
        toast.success(`Assigned proxy to ${domain}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update domain assignment";
      toast.error(message);
      // Refresh from backend on error
      interface ProxyPool {
        domain_assignments: Record<string, string>;
      }
      const pool = await invoke<ProxyPool>('get_proxy_pool');
      setLocalSettings(prev => ({
        ...prev,
        proxy: { ...prev.proxy, domainAssignments: pool.domain_assignments },
      }));
    }
  }, [assignDomainProxy, unassignDomainProxy]);

  return (
    <div className="space-y-6">
        <div className="flex space-x-1 border-b pb-2 overflow-x-auto">
           <Button
             variant={activeTab === 'validation' ? "secondary" : "ghost"}
             onClick={() => setActiveTab('validation')}
             className="gap-2"
           >
             <ShieldCheck className="h-4 w-4" />
             Validation
           </Button>

           <Button
             variant={activeTab === 'history' ? "secondary" : "ghost"}
             onClick={() => setActiveTab('history')}
             className="gap-2"
           >
             <History className="h-4 w-4" />
             History
           </Button>

           <Button
             variant={activeTab === 'proxy' ? "secondary" : "ghost"}
             onClick={() => setActiveTab('proxy')}
             className="gap-2"
           >
             <Shield className="h-4 w-4" />
             Proxy
           </Button>
        </div>

        <div className="space-y-6 min-h-[300px] animate-in fade-in slide-in-from-bottom-2 duration-300">
          {activeTab === 'validation' && (
            <div className="space-y-4 max-w-lg">
              <div className="space-y-2">
                <Label htmlFor="val-mode">Default Validation Mode</Label>
                <select
                  id="val-mode"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={localSettings.validationMode}
                  onChange={(e) => handleChange('validationMode', e.target.value)}
                >
                  <option value="quick">Quick (10s)</option>
                  <option value="standard">Standard (30s)</option>
                  <option value="thorough">Thorough (60s)</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="concurrency">Concurrency (parallel validations)</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="concurrency"
                    type="number"
                    value={localSettings.concurrency}
                    onChange={(e) => handleChange('concurrency', parseInt(e.target.value) || 1)}
                    min="1"
                    max="20"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Recommended: 5-10</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="timeout">Timeout (seconds per email)</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="timeout"
                    type="number"
                    value={localSettings.timeout}
                    onChange={(e) => handleChange('timeout', parseInt(e.target.value) || 10)}
                    min="10"
                    max="120"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Default: 30s</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="retries">Max Retries</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="retries"
                    type="number"
                    value={localSettings.maxRetries}
                    onChange={(e) => handleChange('maxRetries', parseInt(e.target.value) || 0)}
                    min="0"
                    max="5"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">On temporary failures</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="autosave">Auto-Save Interval (batch size)</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="autosave"
                    type="number"
                    value={localSettings.autoSaveInterval}
                    onChange={(e) => handleChange('autoSaveInterval', parseInt(e.target.value) || 1)}
                    min="5"
                    max="50"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Saves results every 10 items</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-4 max-w-lg">
              <div className="space-y-2">
                <Label htmlFor="retention">Session Retention (days)</Label>
                <Input
                  id="retention"
                  type="number"
                  min="1"
                  max="365"
                  value={localSettings.sessionRetentionDays}
                  onChange={(e) => handleChange('sessionRetentionDays', parseInt(e.target.value) || 1)}
                />
                <p className="text-[10px] text-muted-foreground">
                  Sessions older than this will be automatically deleted on startup.
                </p>
              </div>

              <div className="pt-4">
                <Button variant="outline" className="w-full gap-2">
                    <Trash2 className="h-4 w-4" />
                    Clean Up Old Sessions Now
                </Button>
              </div>
            </div>
          )}

          {activeTab === 'proxy' && (
            <div className="space-y-6 max-w-lg">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="proxy-enabled">Enable Proxy</Label>
                  <p className="text-xs text-muted-foreground">
                    Route email validation through SOCKS5 proxies
                  </p>
                </div>
                <button
                  id="proxy-enabled"
                  type="button"
                  role="switch"
                  aria-checked={localSettings.proxy.enabled}
                  onClick={() => handleProxyEnabledChange(!localSettings.proxy.enabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    localSettings.proxy.enabled ? 'bg-primary' : 'bg-input'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      localSettings.proxy.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rotation-mode">Rotation Mode</Label>
                <select
                  id="rotation-mode"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={localSettings.proxy.rotationMode}
                  onChange={(e) => handleRotationModeChange(e.target.value as RotationMode)}
                  disabled={!localSettings.proxy.enabled}
                >
                  <option value="manual">Manual - Select proxy manually</option>
                  <option value="automatic">Automatic - Rotate through all proxies</option>
                  <option value="perDomain">Per-Domain - Assign proxies to email domains</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  {localSettings.proxy.rotationMode === 'manual' && 'Proxy only changes when you manually select a different proxy.'}
                  {localSettings.proxy.rotationMode === 'automatic' && 'Proxies rotate automatically during validation (round-robin or weighted).'}
                  {localSettings.proxy.rotationMode === 'perDomain' && 'Assign specific proxies to Gmail, Yahoo, Hotmail domains.'}
                </p>
              </div>

              <div className="pt-2">
                <ProxyList
                  proxies={localSettings.proxy.proxies}
                  proxyStats={localSettings.proxy.proxyStats}
                  onAdd={handleAddProxy}
                  onUpdate={handleUpdateProxy}
                  onDelete={handleDeleteProxy}
                  disabled={!localSettings.proxy.enabled}
                />
              </div>

              {localSettings.proxy.rotationMode === 'perDomain' && (
                <div className="pt-4">
                  <PerDomainAssignment
                    proxies={localSettings.proxy.proxies}
                    domainAssignments={localSettings.proxy.domainAssignments}
                    onAssign={handleDomainAssign}
                    disabled={!localSettings.proxy.enabled}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end items-center pt-6 border-t gap-2">
          {onClose && (
            <Button
              variant="ghost"
              onClick={onClose}
            >
              Cancel
            </Button>
          )}
          <Button onClick={handleSave} className="gap-2">
            <Save className="h-4 w-4" />
            Save Settings
          </Button>
        </div>
    </div>
  );
}