import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState('validation');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure validation behavior, proxy settings, and more.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 border-b pb-6">
          <button
            type="button"
            onClick={() => setActiveTab('validation')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'validation'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Validation
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('proxy')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'proxy'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Proxy
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            History
          </button>
        </div>

        <div className="space-y-6">
          {activeTab === 'validation' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Default Validation Mode</label>
                <select
                  defaultValue="standard"
                  className="w-full p-2 border rounded-md"
                >
                  <option value="quick">Quick (10s)</option>
                  <option value="standard">Standard (30s)</option>
                  <option value="thorough">Thorough (60s)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Concurrency (parallel validations)</label>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    defaultValue="5"
                    min="1"
                    max="20"
                    className="w-full p-2 border rounded-md"
                  />
                  <span className="text-xs text-muted-foreground">{5} parallel validations</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Timeout (seconds)</label>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    defaultValue="30"
                    min="10"
                    max="120"
                    className="w-full p-2 border rounded-md"
                  />
                  <span className="text-xs text-muted-foreground">{30} seconds per email</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Max Retries</label>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    defaultValue="3"
                    min="0"
                    max="5"
                    className="w-full p-2 border rounded-md"
                  />
                  <span className="text-xs text-muted-foreground">{3} max retries</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Auto-Save Interval (validations)</label>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    defaultValue="10"
                    min="5"
                    max="50"
                    className="w-full p-2 border rounded-md"
                  />
                  <span className="text-xs text-muted-foreground">Save every {10} validations</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'proxy' && (
            <div className="space-y-4">
              <div>
                <label className="flex items-center justify-between mb-2">
                  <span className="font-medium">Enable Proxy</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                  />
                </label>
                <p className="text-sm text-muted-foreground">Route validations through proxy servers to avoid IP blocking</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Rotation Strategy</label>
                <select
                  defaultValue="on-failure"
                  className="w-full p-2 border rounded-md"
                  >
                  <option value="on-failure">Rotate on Failure (Recommended)</option>
                  <option value="per-email">Rotate Per Email</option>
                  <option value="per-batch">Rotate Per Batch</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Max Emails Per Proxy</label>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    min="10"
                    max="100"
                    defaultValue="50"
                    className="w-full p-2 border rounded-md"
                  />
                  <span className="text-xs text-muted-foreground">{50} per proxy</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Protocol Preference</label>
                <select
                  defaultValue="any"
                  className="w-full p-2 border rounded-md"
                >
                  <option value="any">Any</option>
                  <option value="http">HTTP</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Min Proxy Uptime (%)</label>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    min="50"
                    max="100"
                    defaultValue="80"
                    className="w-full p-2 border rounded-md"
                  />
                  <span className="text-xs text-muted-foreground">80%</span>
                </div>
              </div>

              <div>
                <div className="space-y-4">
                  <label className="block text-sm font-medium mb-2">Proxy Pool Status</label>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-semibold">Total Proxies</div>
                      <div className="text-sm text-muted-foreground">Proxy pool shows current status</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold">Active Proxy</div>
                      <div className="text-sm text-muted-foreground">Currently active proxy</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold">Success Rate</div>
                      <div className="text-sm text-muted-foreground">Average success rate across all proxies</div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    className="px-4 py-2 border rounded-md hover:bg-accent"
                  >
                    Refresh Proxy List
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2 border rounded-md hover:bg-destructive hover:text-destructive-foreground"
                  >
                    Clear Proxy Pool
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Session Retention (days)</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  defaultValue="90"
                  className="w-full p-2 border rounded-md"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Sessions older than this will be automatically deleted
                </p>
              </div>

              <Button
                variant="outline"
                className="w-full"
              >
                Clean Up Old Sessions
              </Button>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button onClick={() => onOpenChange(false)}>
            Save Settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
