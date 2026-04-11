---
name: fullstack-worker
description: Full-stack implementation spanning Rust backend and React frontend for proxy features
---

# Fullstack Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that require changes to BOTH:
- Rust backend (structs, Tauri commands, logic)
- React frontend (components, state, UI)

Examples: per-domain proxy assignment, health tracking UI with backend stats, failure modal with backend state.

## Required Skills

- `agent-browser` - For manual verification of end-to-end flows in Tauri app

## Work Procedure

1. **Read existing code** - Understand both backend and frontend patterns
2. **Write failing tests first** (red):
   - Backend: `#[cfg(test)]` module in Rust files
   - Frontend: `*.test.tsx` test files
   - Run tests to verify they fail
3. **Implement backend first**:
   - Add/update structs in settings.rs or validation.rs
   - Add/update Tauri commands
   - Register commands in lib.rs
   - Run `cargo test --manifest-path src-tauri/Cargo.toml --lib`
4. **Implement frontend second**:
   - Update TypeScript interfaces
   - Create/update components
   - Wire to backend via `invoke()` calls
   - Run `npm test` and `npm run typecheck`
5. **Integration verification**:
   - Start app with `npm run tauri dev`
   - Verify frontend calls backend correctly
   - Verify data flows both directions
6. **Manual verification with agent-browser**:
   - Test complete user flows end-to-end
7. **Cleanup**: Stop any running dev servers

## Example Handoff

```json
{
  "salientSummary": "Implemented proxy health tracking: backend ProxyStats struct tracks success/failure counts, frontend displays health indicators (Healthy/Degraded/Failed). Stats persist across sessions.",
  "whatWasImplemented": "Backend: ProxyStats struct with attempts, successes, failures, consecutive_failures fields. update_proxy_stats command. Frontend: Health indicator component in ProxyList. Real-time stats update after each validation. Persistence via settings file.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "cargo test --manifest-path src-tauri/Cargo.toml --lib proxy_stats", "exitCode": 0, "observation": "4 tests passed"},
      {"command": "npm test -- --grep 'health'", "exitCode": 0, "observation": "3 tests passed"}
    ],
    "interactiveChecks": [
      {"action": "Added proxy, ran 5 validations with 3 successes", "observed": "Health indicator shows 60% (Degraded, yellow)"},
      {"action": "Closed app, reopened", "observed": "Stats persisted, still shows 60%"}
    ]
  },
  "tests": {
    "added": [
      {"file": "src-tauri/src/settings.rs", "cases": [{"name": "test_proxy_stats_calculation", "verifies": "Success rate calculated correctly"}]},
      {"file": "src/components/settings/health-indicator.test.tsx", "cases": [{"name": "shows healthy for high rate", "verifies": "Green indicator for >90%"}]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Backend and frontend changes create circular dependency
- Integration reveals design flaw requiring scope change
- Feature requires changes outside proxy scope
