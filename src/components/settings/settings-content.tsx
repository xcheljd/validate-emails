import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Save, History, ShieldCheck, Shield, Gauge, Activity, Mail } from 'lucide-react';
import {
  useSettings,
  AppSettings,
  RotationMode,
  ProxyConfig,
} from '@/hooks/use-settings';
import { toast } from 'sonner';
import { ProxyList } from './proxy-list';
import { PerDomainAssignment } from './per-domain-assignment';
import { ProxyHealthDashboard } from './proxy-health-dashboard';

/**
 * Mirrors the backend's validate_smtp_identity: both fields may be blank
 * (built-in default); a from address needs an '@'; neither may contain
 * whitespace. Returns an error message, or null if valid.
 */
export function validateSmtpIdentity(
  fromEmail: string,
  helloName: string
): string | null {
  const from = fromEmail.trim();
  const helo = helloName.trim();
  if (from && !from.includes('@')) return "From email must contain '@'";
  if (/\s/.test(from)) return 'From email must not contain spaces';
  if (/\s/.test(helo)) return 'HELO name must not contain spaces';
  return null;
}

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
    bypassProxyCooldown,
    setCooldownDuration,
    reEnableProxy,
    setAutoDisableThreshold,
  } = useSettings();
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [activeTab, setActiveTab] = useState('validation');

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleSave = () => {
    const smtpError = validateSmtpIdentity(
      localSettings.fromEmail,
      localSettings.helloName
    );
    if (smtpError) {
      toast.error(smtpError);
      return;
    }
    updateSettings(localSettings);
    toast.success('Settings saved successfully');
    if (onClose) onClose();
  };

  const handleChange = (
    key: keyof AppSettings,
    value: string | number | boolean
  ) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  // Proxy enabled toggle - persists to backend immediately
  const handleProxyEnabledChange = useCallback(
    async (enabled: boolean) => {
      setLocalSettings((prev) => ({
        ...prev,
        proxy: { ...prev.proxy, enabled },
      }));
      try {
        await updateProxyPoolConfig(enabled, undefined);
      } catch (_error) {
        toast.error('Failed to update proxy settings');
      }
    },
    [updateProxyPoolConfig]
  );

  // Proxy rotation mode change - persists to backend immediately
  const handleRotationModeChange = useCallback(
    async (rotationMode: RotationMode) => {
      setLocalSettings((prev) => ({
        ...prev,
        proxy: { ...prev.proxy, rotationMode },
      }));
      try {
        await updateProxyPoolConfig(undefined, rotationMode);
      } catch (_error) {
        toast.error('Failed to update rotation mode');
      }
    },
    [updateProxyPoolConfig]
  );

  // Proxy list handlers - persist to backend immediately
  const handleAddProxy = useCallback(
    async (proxy: ProxyConfig) => {
      setLocalSettings((prev) => ({
        ...prev,
        proxy: { ...prev.proxy, proxies: [...prev.proxy.proxies, proxy] },
      }));
      try {
        await addProxy(proxy);
        toast.success('Proxy added successfully');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to add proxy';
        toast.error(message);
        // Revert local state on error
        setLocalSettings((prev) => ({
          ...prev,
          proxy: { ...prev.proxy, proxies: prev.proxy.proxies.slice(0, -1) },
        }));
      }
    },
    [addProxy]
  );

  const handleUpdateProxy = useCallback(
    async (index: number, proxy: ProxyConfig) => {
      const oldProxy = localSettings.proxy.proxies[index];
      const oldId = `${oldProxy.host}:${oldProxy.port}`;

      setLocalSettings((prev) => {
        const newProxies = [...prev.proxy.proxies];
        newProxies[index] = proxy;
        return {
          ...prev,
          proxy: { ...prev.proxy, proxies: newProxies },
        };
      });

      try {
        await updateProxy(oldId, proxy);
        toast.success('Proxy updated successfully');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to update proxy';
        toast.error(message);
        // Revert local state on error
        setLocalSettings((prev) => {
          const newProxies = [...prev.proxy.proxies];
          newProxies[index] = oldProxy;
          return {
            ...prev,
            proxy: { ...prev.proxy, proxies: newProxies },
          };
        });
      }
    },
    [localSettings.proxy.proxies, updateProxy]
  );

  const handleDeleteProxy = useCallback(
    async (index: number) => {
      const proxyToDelete = localSettings.proxy.proxies[index];
      const proxyId = `${proxyToDelete.host}:${proxyToDelete.port}`;

      setLocalSettings((prev) => ({
        ...prev,
        proxy: {
          ...prev.proxy,
          proxies: prev.proxy.proxies.filter((_, i) => i !== index),
        },
      }));

      try {
        await deleteProxy(proxyId);
        toast.success('Proxy removed successfully');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to delete proxy';
        toast.error(message);
        // Revert local state on error
        setLocalSettings((prev) => ({
          ...prev,
          proxy: {
            ...prev.proxy,
            proxies: [
              ...prev.proxy.proxies.slice(0, index),
              proxyToDelete,
              ...prev.proxy.proxies.slice(index),
            ],
          },
        }));
      }
    },
    [localSettings.proxy.proxies, deleteProxy]
  );

  // Per-domain proxy assignment handler
  const handleDomainAssign = useCallback(
    async (domain: string, proxyId: string | null) => {
      setLocalSettings((prev) => {
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
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to update domain assignment';
        toast.error(message);
        // Refresh from backend on error
        interface ProxyPool {
          domain_assignments: Record<string, string>;
        }
        const pool = await invoke<ProxyPool>('get_proxy_pool');
        setLocalSettings((prev) => ({
          ...prev,
          proxy: { ...prev.proxy, domainAssignments: pool.domain_assignments },
        }));
      }
    },
    [assignDomainProxy, unassignDomainProxy]
  );

  // Bypass cooldown for a proxy
  const handleBypassCooldown = useCallback(
    async (proxyId: string) => {
      try {
        await bypassProxyCooldown(proxyId);
        toast.success('Cooldown bypassed - proxy is now available');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to bypass cooldown';
        toast.error(message);
      }
    },
    [bypassProxyCooldown]
  );

  // Handle cooldown duration change
  const handleCooldownDurationChange = useCallback(
    async (value: number[]) => {
      const duration = value[0];
      setLocalSettings((prev) => ({
        ...prev,
        proxy: { ...prev.proxy, cooldownDurationSecs: duration },
      }));
      try {
        await setCooldownDuration(duration);
      } catch (_error) {
        toast.error('Failed to update cooldown duration');
      }
    },
    [setCooldownDuration]
  );

  return (
    <div className="space-y-6">
      <div className="flex space-x-1 border-b pb-2 overflow-x-auto">
        <Button
          variant={activeTab === 'validation' ? 'secondary' : 'ghost'}
          onClick={() => setActiveTab('validation')}
          className="gap-2"
        >
          <ShieldCheck className="h-4 w-4" />
          Validation
        </Button>

        <Button
          variant={activeTab === 'history' ? 'secondary' : 'ghost'}
          onClick={() => setActiveTab('history')}
          className="gap-2"
        >
          <History className="h-4 w-4" />
          History
        </Button>

        <Button
          variant={activeTab === 'proxy' ? 'secondary' : 'ghost'}
          onClick={() => setActiveTab('proxy')}
          className="gap-2"
        >
          <Shield className="h-4 w-4" />
          Proxy
        </Button>

        <Button
          variant={activeTab === 'health' ? 'secondary' : 'ghost'}
          onClick={() => setActiveTab('health')}
          className="gap-2"
        >
          <Activity className="h-4 w-4" />
          Health
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
                <option value="thorough">Thorough (45s+)</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="concurrency">
                Concurrency (parallel validations)
              </Label>
              <div className="flex items-center gap-4">
                <Input
                  id="concurrency"
                  type="number"
                  value={localSettings.concurrency}
                  onChange={(e) =>
                    handleChange('concurrency', parseInt(e.target.value) || 1)
                  }
                  min="1"
                  max="20"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Recommended: 5-10
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="timeout">Timeout (seconds per SMTP connection)</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="timeout"
                  type="number"
                  value={localSettings.timeout}
                  onChange={(e) =>
                    handleChange('timeout', parseInt(e.target.value) || 10)
                  }
                  min="10"
                  max="120"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Thorough mode uses at least 45s
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="retries">Max Retries</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="retries"
                  type="number"
                  value={localSettings.maxRetries}
                  onChange={(e) =>
                    handleChange('maxRetries', parseInt(e.target.value) || 0)
                  }
                  min="0"
                  max="5"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  On temporary failures (default: 1)
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mx-concurrency">Max Sessions per Mail Server</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="mx-concurrency"
                  type="number"
                  value={localSettings.mxConcurrency}
                  onChange={(e) =>
                    handleChange(
                      'mxConcurrency',
                      Math.min(16, Math.max(1, parseInt(e.target.value) || 1))
                    )
                  }
                  min="1"
                  max="16"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Parallel SMTP sessions to one MX host (default: 3)
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="autosave">Auto-Save Interval (batch size)</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="autosave"
                  type="number"
                  value={localSettings.autoSaveInterval}
                  onChange={(e) =>
                    handleChange(
                      'autoSaveInterval',
                      parseInt(e.target.value) || 1
                    )
                  }
                  min="5"
                  max="50"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Saves results every 10 items
                </span>
              </div>
            </div>

            {/* SMTP Callout Section */}
            <div className="pt-4 border-t">
              <div className="flex items-center gap-2 mb-4">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">SMTP Callout</h3>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="from-email">From email (SMTP callout)</Label>
                  <Input
                    id="from-email"
                    type="email"
                    placeholder="verify@example.com"
                    value={localSettings.fromEmail}
                    onChange={(e) => handleChange('fromEmail', e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Use an address on a real domain you control. example.com
                    is rejected by many servers. Leave blank for the default.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hello-name">HELO name</Label>
                  <Input
                    id="hello-name"
                    type="text"
                    placeholder="example.com"
                    value={localSettings.helloName}
                    onChange={(e) => handleChange('helloName', e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Use a real domain you control, ideally one whose reverse
                    DNS matches your sending IP. example.com is rejected by
                    many servers. Leave blank for the default.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="check-gravatar">
                      Look up Gravatar profiles
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Sends an MD5 hash of each address to gravatar.com over
                      HTTPS — direct, not through your proxies.
                    </p>
                  </div>
                  <button
                    id="check-gravatar"
                    type="button"
                    role="switch"
                    aria-checked={localSettings.checkGravatar}
                    onClick={() =>
                      handleChange('checkGravatar', !localSettings.checkGravatar)
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      localSettings.checkGravatar ? 'bg-primary' : 'bg-input'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        localSettings.checkGravatar
                          ? 'translate-x-5'
                          : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Rate Limiting Section */}
            <div className="pt-4 border-t">
              <div className="flex items-center gap-2 mb-4">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Rate Limiting</h3>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="rate-limit-enabled">
                      Limit dispatch rate
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Caps how fast emails are sent through each proxy (or
                      your own connection when no proxy is used), to keep
                      IPs off blocklists. Off = no limit.
                    </p>
                  </div>
                  <button
                    id="rate-limit-enabled"
                    type="button"
                    role="switch"
                    aria-checked={localSettings.rateLimitEnabled}
                    onClick={() =>
                      handleChange('rateLimitEnabled', !localSettings.rateLimitEnabled)
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      localSettings.rateLimitEnabled ? 'bg-primary' : 'bg-input'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        localSettings.rateLimitEnabled
                          ? 'translate-x-5'
                          : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max-per-second">Max Per Second</Label>
                  <div className="flex items-center gap-4">
                    <Input
                      id="max-per-second"
                      type="number"
                      value={localSettings.rateLimitMaxPerSecond}
                      disabled={!localSettings.rateLimitEnabled}
                      onChange={(e) =>
                        handleChange('rateLimitMaxPerSecond', parseInt(e.target.value) || 1)
                      }
                      min="1"
                      max="100"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      Default: 1
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max-per-minute">Max Per Minute</Label>
                  <div className="flex items-center gap-4">
                    <Input
                      id="max-per-minute"
                      type="number"
                      value={localSettings.rateLimitMaxPerMinute}
                      disabled={!localSettings.rateLimitEnabled}
                      onChange={(e) =>
                        handleChange('rateLimitMaxPerMinute', parseInt(e.target.value) || 60)
                      }
                      min="1"
                      max="6000"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      Default: 60
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max-emails-session">Max Emails Per Session</Label>
                  <div className="flex items-center gap-4">
                    <Input
                      id="max-emails-session"
                      type="number"
                      value={localSettings.maxEmailsPerSession}
                      onChange={(e) =>
                        handleChange('maxEmailsPerSession', parseInt(e.target.value) || 0)
                      }
                      min="0"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      0 = unlimited
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Warns when batch exceeds this limit. Set to 0 for no limit.
                  </p>
                </div>
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
                onChange={(e) =>
                  handleChange(
                    'sessionRetentionDays',
                    parseInt(e.target.value) || 1
                  )
                }
              />
              <p className="text-[10px] text-muted-foreground">
                Sessions older than this will be automatically deleted on
                startup.
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
                onClick={() =>
                  handleProxyEnabledChange(!localSettings.proxy.enabled)
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  localSettings.proxy.enabled ? 'bg-primary' : 'bg-input'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    localSettings.proxy.enabled
                      ? 'translate-x-5'
                      : 'translate-x-0'
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
                onChange={(e) =>
                  handleRotationModeChange(e.target.value as RotationMode)
                }
                disabled={!localSettings.proxy.enabled}
              >
                <option value="manual">Manual - Select proxy manually</option>
                <option value="automatic">
                  Automatic - Rotate through all proxies
                </option>
                <option value="perDomain">
                  Per-Domain - Assign proxies to email domains
                </option>
              </select>
              <p className="text-xs text-muted-foreground">
                {localSettings.proxy.rotationMode === 'manual' &&
                  'Proxy only changes when you manually select a different proxy.'}
                {localSettings.proxy.rotationMode === 'automatic' &&
                  'Proxies rotate automatically during validation (round-robin or weighted).'}
                {localSettings.proxy.rotationMode === 'perDomain' &&
                  'Assign specific proxies to Gmail, Yahoo, Hotmail domains.'}
              </p>
            </div>

            <div className="pt-2">
              <ProxyList
                proxies={localSettings.proxy.proxies}
                proxyStats={localSettings.proxy.proxyStats}
                onAdd={handleAddProxy}
                onUpdate={handleUpdateProxy}
                onDelete={handleDeleteProxy}
                onBypassCooldown={handleBypassCooldown}
                disabled={!localSettings.proxy.enabled}
              />
            </div>

            {/* Cooldown duration setting */}
            <div className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="cooldown-duration">Cooldown Duration</Label>
                <span className="text-sm text-muted-foreground">
                  {localSettings.proxy.cooldownDurationSecs} seconds
                </span>
              </div>
              <input
                id="cooldown-duration"
                type="range"
                min={30}
                max={300}
                step={10}
                value={localSettings.proxy.cooldownDurationSecs}
                onChange={(e) =>
                  handleCooldownDurationChange([parseInt(e.target.value, 10)])
                }
                disabled={!localSettings.proxy.enabled}
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>30s</span>
                <span>300s</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Time before a failed proxy automatically rejoins rotation (30s -
                300s)
              </p>
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

        {activeTab === 'health' && (
          <ProxyHealthDashboard
            proxies={localSettings.proxy.proxies}
            proxyStats={localSettings.proxy.proxyStats}
            autoDisableThreshold={localSettings.proxy.autoDisableThreshold}
            onReEnableProxy={reEnableProxy}
            onSetAutoDisableThreshold={setAutoDisableThreshold}
            disabled={false}
          />
        )}
      </div>

      <div className="flex justify-end items-center pt-6 border-t gap-2">
        {onClose && (
          <Button variant="ghost" onClick={onClose}>
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
