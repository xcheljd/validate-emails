import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RefreshCw, Trash2, Save, History, Globe, ShieldCheck } from "lucide-react";
import { useSettings, AppSettings } from '@/hooks/use-settings';
import { toast } from "sonner";

interface SettingsContentProps {
  onClose?: () => void;
}

export function SettingsContent({ onClose }: SettingsContentProps) {
  const { settings, updateSettings } = useSettings();
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
             variant={activeTab === 'proxy' ? "secondary" : "ghost"}
             onClick={() => setActiveTab('proxy')}
             className="gap-2"
           >
             <Globe className="h-4 w-4" />
             Proxy
           </Button>
           <Button
             variant={activeTab === 'history' ? "secondary" : "ghost"}
             onClick={() => setActiveTab('history')}
             className="gap-2"
           >
             <History className="h-4 w-4" />
             History
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

          {activeTab === 'proxy' && (
            <div className="space-y-4 max-w-lg">
              <div className="flex items-center space-x-2 border p-4 rounded-md">
                <Checkbox 
                    id="enable-proxy" 
                    checked={localSettings.proxyEnabled}
                    onCheckedChange={(c) => handleChange('proxyEnabled', !!c)}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="enable-proxy" className="font-medium">
                    Enable Proxy Rotation
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Route validations through proxy servers to avoid IP blocking.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rotation-strategy">Rotation Strategy</Label>
                <select
                  id="rotation-strategy"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={localSettings.proxyRotation}
                  onChange={(e) => handleChange('proxyRotation', e.target.value)}
                >
                  <option value="on-failure">Rotate on Failure (Recommended)</option>
                  <option value="per-email">Rotate Per Email</option>
                  <option value="per-batch">Rotate Per Batch</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="max-emails-proxy">Max Emails Per Proxy</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="max-emails-proxy"
                    type="number"
                    min="10"
                    max="100"
                    value={localSettings.maxEmailsPerProxy}
                    onChange={(e) => handleChange('maxEmailsPerProxy', parseInt(e.target.value) || 10)}
                  />
                  <span className="text-xs text-muted-foreground">Limit before forced rotation</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="protocol">Protocol Preference</Label>
                <select
                  id="protocol"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={localSettings.protocolPreference}
                  onChange={(e) => handleChange('protocolPreference', e.target.value)}
                >
                  <option value="any">Any (HTTP/SOCKS4/SOCKS5)</option>
                  <option value="http">HTTP/HTTPS Only</option>
                  <option value="socks5">SOCKS5 Only</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="min-uptime">Min Proxy Uptime (%)</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="min-uptime"
                    type="number"
                    min="50"
                    max="100"
                    value={localSettings.minProxyUptime}
                    onChange={(e) => handleChange('minProxyUptime', parseInt(e.target.value) || 50)}
                  />
                  <span className="text-xs text-muted-foreground">80%</span>
                </div>
              </div>

              <div className="pt-4 border-t">
                 <div className="mb-4">
                  <h4 className="text-sm font-medium mb-2">Proxy Pool Management</h4>
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="bg-muted p-2 rounded">
                      <div className="font-bold">0</div>
                      <div className="text-[10px] uppercase text-muted-foreground">Total</div>
                    </div>
                    <div className="bg-muted p-2 rounded">
                      <div className="font-bold">-</div>
                      <div className="text-[10px] uppercase text-muted-foreground">Active</div>
                    </div>
                    <div className="bg-muted p-2 rounded">
                      <div className="font-bold">0%</div>
                      <div className="text-[10px] uppercase text-muted-foreground">Success</div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="w-full gap-2">
                    <RefreshCw className="h-3 w-3" /> Refresh List
                  </Button>
                  <Button variant="outline" size="sm" className="w-full gap-2 text-destructive hover:text-destructive">
                    <Trash2 className="h-3 w-3" /> Clear Pool
                  </Button>
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