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

## ProxyStats and Health Tracking

### ProxyStats Struct

Each proxy has associated `ProxyStats` tracking validation performance. Stats are stored in a `HashMap<String, ProxyStats>` keyed by proxy ID within `ProxyPool`.

```rust
pub struct ProxyStats {
    pub attempts: u32,
    pub successes: u32,
    pub failures: u32,
    pub consecutive_failures: u32,
    pub cooldown_until: Option<i64>,  // Unix timestamp in milliseconds (signed i64, not u64)
}
```

### Health Status Thresholds

- **Healthy**: success_rate > 90% (green indicator)
- **Degraded**: success_rate 50-90% (yellow indicator)
- **Failed**: success_rate < 50% (red indicator)
- **New proxy** (0 attempts): treated as Healthy with 100% success rate

### Bad Proxy Detection

A proxy is marked "bad" when `consecutive_failures >= 3`. The counter resets to 0 on any success. Note: "bad" status alone does NOT exclude a proxy from rotation. Only cooldown status gates availability (see below).

### Cooldown System

When a proxy is marked bad (3 consecutive failures), it enters cooldown (configurable duration, default 60s, range 30-300s). Cooldown is checked lazily — `is_in_cooldown()` compares `now < cooldown_until` on each availability query, so no background timer is needed. `bypass_cooldown()` clears both cooldown and bad status.

**Important:** `is_proxy_available()` only checks cooldown status, NOT bad status. After cooldown expires, a bad proxy (3+ consecutive failures) becomes available again and gets another chance. If it fails again, it re-enters cooldown via `record_failure()`. This design gives proxies automatic recovery after their cooldown period.

### Weighted Rotation

In automatic rotation mode, proxy selection uses cumulative weight distribution:
- Weight = success_rate (0-100) for proxies with stats
- Weight = 50 for new proxies (no attempts)
- Weight = 0 for proxies in cooldown
- Falls back to round-robin when all weights are equal

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

## Backend-to-Frontend Event Emission

The backend emits events to the frontend via `window.emit()` with serde-serializable payloads. This is the primary mechanism for pushing state from Rust to React.

**Known events:**
- `all-proxies-failed` — emitted when all proxies are in cooldown, payload includes failed proxy list and cooldown ETAs
- `no-proxies-configured` — emitted when proxy is enabled but pool is empty

```rust
// Pattern
window.emit("event-name", &payload)?;
```

## All-Proxies-Failed Dependency Chain

There is a dependency chain from proxy availability checks through to the frontend retry-with-cooldown UI:

`is_proxy_available()` → `get_available_proxies()` → `has_available_proxies()` → `all_proxies_failed()` → `get_all_proxies_failed_state()` → frontend event → `retryWithCooldown` hook

Changes to `is_proxy_available()` ripple through this entire chain. The chain is checked both before validation starts and after each batch completes.

## Session-Level State Pattern

Temporary session state (not persisted to disk) should be added to `SettingsState` (the in-memory `Arc<RwLock<...>>` wrapper) rather than to the persisted `Settings` struct. Example: `proxy_bypass_for_session: Arc<RwLock<bool>>` on SettingsState.

## Testing Patterns

### Event-Driven State Testing

For testing hooks that depend on Tauri events (e.g., `all-proxies-failed`), expose a test-only setter (e.g., `setAllProxiesFailedStateForTest`) that bypasses the event listener. Name with `ForTest` suffix to make the test-only nature clear.

### Timer-Dependent Testing

Use `vi.useFakeTimers()` at the file level for tests involving `setInterval`/`setTimeout`. Clean up with `vi.clearAllTimers()` in `afterEach`.
