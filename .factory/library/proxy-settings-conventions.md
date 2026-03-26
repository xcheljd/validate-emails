# Proxy Settings Conventions

Patterns and conventions discovered during proxy-core milestone implementation.

## Backend Serialization

### Snake_case vs camelCase

The `Settings` struct uses snake_case for field names (`validation_mode`, `timeout_ms`, `proxy_pool`) while nested structs like `ProxyPool` use camelCase via `#[serde(rename_all = "camelCase")]`. This mixed convention is consistent with existing code.

**Example:**
```rust
// settings.rs
pub struct Settings {
    pub validation_mode: String,  // snake_case
    #[serde(default)]
    pub proxy_pool: ProxyPool,    // snake_case
}

#[serde(rename_all = "camelCase")]
pub struct ProxyPool {
    pub proxies: Vec<ProxyConfig>,           // becomes "proxies" in JSON
    pub enabled: bool,                       // becomes "enabled"
    pub rotation_mode: RotationMode,         // becomes "rotationMode"
    pub domain_assignments: HashMap<...>,    // becomes "domainAssignments"
}
```

### Backward Compatibility Pattern

Use `#[serde(default)]` for new fields in existing structs to ensure backward compatibility with older settings files.

```rust
#[derive(Serialize, Deserialize)]
pub struct Settings {
    // ... existing fields ...
    #[serde(default)]
    pub proxy_pool: ProxyPool,  // Gracefully handles missing field
}
```

## Frontend Hook Pattern

### Domain-Specific Management Functions

For complex settings that need backend sync, prefer domain-specific management functions over generic update functions.

**Pattern:**
```typescript
// use-settings.ts
const addProxy = async (proxy: ProxyConfig) => {
  // 1. Optimistic local update
  setSettings(prev => ({
    ...prev,
    proxy: {
      ...prev.proxy,
      proxies: [...prev.proxy.proxies, proxy]
    }
  }));
  
  // 2. Backend invoke
  try {
    await invoke('add_proxy', { proxy });
  } catch (error) {
    // 3. Rollback on error
    setSettings(prev => ({
      ...prev,
      proxy: {
        ...prev.proxy,
        proxies: prev.proxy.proxies.filter(p => p.id !== proxy.id)
      }
    }));
    toast.error(`Failed to add proxy: ${error}`);
  }
};
```

### Separate Backend Interfaces

Proxy settings are stored separately from other settings in the backend. The `BackendSettings` interface excludes proxy fields, and proxy pool is loaded/saved via separate Tauri commands.

```typescript
// Load both in parallel
const [backendSettings, proxyPool] = await Promise.all([
  invoke<BackendSettings>('get_settings'),
  invoke<BackendProxyPool>('get_proxy_pool')
]);
```

## Tauri Commands

### Error Handling Pattern

All Tauri commands return `Result<T, String>` for error handling.

```rust
#[tauri::command]
pub async fn add_proxy(proxy: ProxyConfig, app: AppHandle) -> Result<(), String> {
    // ... implementation ...
    Ok(())
}
```
