import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Trash2, Edit2, Plus, ListPlus, Shield, AlertCircle } from 'lucide-react';
import { ProxyConfig } from '@/hooks/use-settings';
import { cn } from '@/lib/utils';

interface ProxyListProps {
  proxies: ProxyConfig[];
  onAdd: (proxy: ProxyConfig) => void;
  onUpdate: (index: number, proxy: ProxyConfig) => void;
  onDelete: (index: number) => void;
  disabled?: boolean;
}

/** Parse proxy string into ProxyConfig */
function parseProxyString(input: string): ProxyConfig | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try socks5://user:pass@host:port format
  const socks5WithAuth = trimmed.match(/^socks5:\/\/([^:]+):([^@]+)@([^:]+):(\d+)$/i);
  if (socks5WithAuth) {
    const [, username, password, host, portStr] = socks5WithAuth;
    const port = parseInt(portStr, 10);
    if (port > 0 && port <= 65535) {
      return { host, port, username, password };
    }
    return null;
  }

  // Try socks5://host:port format
  const socks5Simple = trimmed.match(/^socks5:\/\/([^:]+):(\d+)$/i);
  if (socks5Simple) {
    const [, host, portStr] = socks5Simple;
    const port = parseInt(portStr, 10);
    if (port > 0 && port <= 65535) {
      return { host, port };
    }
    return null;
  }

  // Try simple host:port format
  const simple = trimmed.match(/^([^:]+):(\d+)$/);
  if (simple) {
    const [, host, portStr] = simple;
    const port = parseInt(portStr, 10);
    if (port > 0 && port <= 65535) {
      return { host, port };
    }
    return null;
  }

  return null;
}

/** Check if two proxies are duplicates */
function isDuplicateProxy(a: ProxyConfig, b: ProxyConfig): boolean {
  return a.host === b.host && a.port === b.port;
}

/** Generate unique key for proxy */
function proxyKey(proxy: ProxyConfig, index: number): string {
  return `${proxy.host}:${proxy.port}:${index}`;
}

export function ProxyList({ proxies, onAdd, onUpdate, onDelete, disabled = false }: ProxyListProps) {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  
  // Edit dialog state
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editHost, setEditHost] = useState('');
  const [editPort, setEditPort] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  
  // Delete confirmation dialog state
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  const handleAddProxy = useCallback(() => {
    const proxy = parseProxyString(inputValue);
    
    if (!proxy) {
      setError('Invalid format. Use host:port or socks5://user:pass@host:port');
      return;
    }
    
    if (proxy.port <= 0 || proxy.port > 65535) {
      setError('Invalid port. Port must be between 1 and 65535');
      return;
    }
    
    // Check for duplicates
    const isDuplicate = proxies.some(p => isDuplicateProxy(p, proxy));
    if (isDuplicate) {
      setError('This proxy already exists in your list');
      return;
    }
    
    onAdd(proxy);
    setInputValue('');
    setError(null);
  }, [inputValue, proxies, onAdd]);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    if (error) setError(null);
  }, [error]);

  const handleBulkAdd = useCallback(() => {
    const lines = bulkInput.split('\n').filter(line => line.trim());
    let addedCount = 0;
    
    for (const line of lines) {
      const proxy = parseProxyString(line);
      if (proxy) {
        // Check for duplicates within existing proxies
        const isDuplicate = proxies.some(p => isDuplicateProxy(p, proxy));
        if (!isDuplicate) {
          onAdd(proxy);
          addedCount++;
        }
      }
    }
    
    setBulkInput('');
    setShowBulkAdd(false);
  }, [bulkInput, proxies, onAdd]);

  const handleEditClick = useCallback((index: number) => {
    const proxy = proxies[index];
    setEditIndex(index);
    setEditHost(proxy.host);
    setEditPort(proxy.port.toString());
    setEditUsername(proxy.username || '');
    setEditPassword(proxy.password || '');
    setEditError(null);
  }, [proxies]);

  const handleEditSave = useCallback(() => {
    if (editIndex === null) return;
    
    const port = parseInt(editPort, 10);
    if (!editHost.trim()) {
      setEditError('Host is required');
      return;
    }
    if (isNaN(port) || port <= 0 || port > 65535) {
      setEditError('Port must be between 1 and 65535');
      return;
    }
    
    const updatedProxy: ProxyConfig = {
      host: editHost.trim(),
      port,
      username: editUsername.trim() || undefined,
      password: editPassword.trim() || undefined,
    };
    
    // Check for duplicates (excluding current proxy)
    const isDuplicate = proxies.some((p, i) => i !== editIndex && isDuplicateProxy(p, updatedProxy));
    if (isDuplicate) {
      setEditError('This proxy already exists');
      return;
    }
    
    onUpdate(editIndex, updatedProxy);
    setEditIndex(null);
    setEditError(null);
  }, [editIndex, editHost, editPort, editUsername, editPassword, proxies, onUpdate]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteIndex === null) return;
    onDelete(deleteIndex);
    setDeleteIndex(null);
  }, [deleteIndex, onDelete]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Proxy List</Label>
        <span className="text-xs text-muted-foreground">
          {proxies.length} configured
        </span>
      </div>
      
      {/* Add proxy form */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              placeholder="host:port or socks5://user:pass@host:port"
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddProxy()}
              disabled={disabled}
              className={cn(error && 'border-destructive')}
            />
          </div>
          <Button 
            onClick={handleAddProxy} 
            size="sm"
            disabled={disabled || !inputValue.trim()}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowBulkAdd(!showBulkAdd)}
            disabled={disabled}
          >
            <ListPlus className="h-4 w-4 mr-1" />
            Bulk
          </Button>
        </div>
        
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}
        
        {/* Bulk add textarea */}
        {showBulkAdd && (
          <div className="space-y-2 pt-2">
            <textarea
              className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="One proxy per line:\n192.168.1.1:8080\nsocks5://user:pass@proxy.com:1080"
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              disabled={disabled}
            />
            <div className="flex justify-end gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  setShowBulkAdd(false);
                  setBulkInput('');
                }}
              >
                Cancel
              </Button>
              <Button 
                size="sm"
                onClick={handleBulkAdd}
                disabled={disabled || !bulkInput.trim()}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add All
              </Button>
            </div>
          </div>
        )}
      </div>
      
      {/* Proxy list */}
      <div className="border rounded-md min-h-[120px] bg-muted/30">
        {proxies.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">
            <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No proxies configured</p>
            <p className="text-xs mt-1">Add proxies to enable proxy-based validation</p>
          </div>
        ) : (
          <div className="divide-y">
            {proxies.map((proxy, index) => (
              <div
                key={proxyKey(proxy, index)}
                className="flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono">
                    {proxy.host}:{proxy.port}
                  </span>
                  {proxy.username && (
                    <Badge variant="secondary" className="text-xs">
                      authenticated
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => handleEditClick(index)}
                    disabled={disabled}
                    aria-label="Edit proxy"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteIndex(index)}
                    disabled={disabled}
                    aria-label="Delete proxy"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Edit Dialog */}
      <Dialog open={editIndex !== null} onOpenChange={(open) => !open && setEditIndex(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Proxy</DialogTitle>
            <DialogDescription>
              Modify the proxy configuration. Changes will be saved when you click Save.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-host" className="text-right">Host</Label>
              <Input
                id="edit-host"
                value={editHost}
                onChange={(e) => {
                  setEditHost(e.target.value);
                  if (editError) setEditError(null);
                }}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-port" className="text-right">Port</Label>
              <Input
                id="edit-port"
                type="number"
                value={editPort}
                onChange={(e) => {
                  setEditPort(e.target.value);
                  if (editError) setEditError(null);
                }}
                className="col-span-3"
                min={1}
                max={65535}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-username" className="text-right">Username</Label>
              <Input
                id="edit-username"
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                className="col-span-3"
                placeholder="Optional"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-password" className="text-right">Password</Label>
              <Input
                id="edit-password"
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                className="col-span-3"
                placeholder="Optional"
              />
            </div>
            {editError && (
              <div className="col-span-4 flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {editError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditIndex(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteIndex !== null} onOpenChange={(open) => !open && setDeleteIndex(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Remove Proxy</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{' '}
              <span className="font-mono font-medium">
                {deleteIndex !== null && proxies[deleteIndex] && 
                  `${proxies[deleteIndex].host}:${proxies[deleteIndex].port}`}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteIndex(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
