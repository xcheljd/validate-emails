---
name: backend-worker
description: Rust/Tauri backend implementation for proxy features
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that require:
- Rust struct definitions (ProxyConfig, ProxyPool, ProxyStats)
- Tauri commands (add_proxy, get_proxies, etc.)
- Integration with check-if-email-exists library
- Backend logic for proxy rotation, health tracking, cooldown

## Required Skills

None. This worker uses Rust toolchain directly.

## Work Procedure

1. **Read existing code** - Understand current validation.rs, settings.rs, lib.rs patterns
2. **Write failing tests first** (red):
   - Create test cases in `#[cfg(test)]` module
   - Run `cargo test --manifest-path src-tauri/Cargo.toml --lib` to verify tests fail
3. **Implement to make tests pass** (green):
   - Add structs to settings.rs or validation.rs
   - Implement Tauri commands
   - Register commands in lib.rs
4. **Run verification**:
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - `cargo test --manifest-path src-tauri/Cargo.toml --lib`
   - `cargo clippy --manifest-path src-tauri/Cargo.toml`
5. **Manual verification** if applicable:
   - Start app with `npm run tauri dev`
   - Test the feature through frontend or Tauri DevTools

## Example Handoff

```json
{
  "salientSummary": "Added ProxyConfig struct with host, port, username, password fields. Implemented add_proxy, get_proxies, delete_proxy Tauri commands. All 5 unit tests passing.",
  "whatWasImplemented": "ProxyConfig struct in settings.rs with Serialize/Deserialize. ProxyPool wrapper with enabled and rotation_mode. Tauri commands registered in lib.rs. Unit tests for parsing and validation.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "cargo test --manifest-path src-tauri/Cargo.toml --lib proxy", "exitCode": 0, "observation": "5 tests passed"},
      {"command": "cargo clippy --manifest-path src-tauri/Cargo.toml", "exitCode": 0, "observation": "No warnings"}
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {"file": "src-tauri/src/settings.rs", "cases": [{"name": "test_proxy_config_parse", "verifies": "ProxyConfig parses valid input"}, {"name": "test_proxy_config_invalid_port", "verifies": "Invalid port rejected"}]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on frontend changes that don't exist yet
- check-if-email-exists library API differs from documentation
- Cannot integrate without breaking existing validation logic
