---
name: frontend-worker
description: React/TypeScript frontend implementation for proxy features
---

# Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that require:
- React components (proxy list, failure modal, settings UI)
- TypeScript interfaces (ProxySettings, ProxyConfig)
- State management via use-settings.ts hook
- UI interactions and form validation

## Required Skills

- `agent-browser` - For manual verification of UI flows in Tauri app

## Work Procedure

1. **Read existing code** - Understand settings-content.tsx, use-settings.ts patterns
2. **Write failing tests first** (red):
   - Create test file `*.test.tsx` if not exists
   - Write test cases for component behavior
   - Run `npm test -- --grep <pattern>` to verify tests fail
3. **Implement to make tests pass** (green):
   - Update TypeScript interfaces in use-settings.ts
   - Create/update components
   - Wire to backend via `invoke()` calls
4. **Run verification**:
   - `npm run typecheck`
   - `npm test`
   - `npm run lint`
5. **Manual verification with agent-browser**:
   - Start app with `npm run tauri dev`
   - Use agent-browser to navigate to Settings > Proxy tab
   - Verify UI renders, interactions work
6. **Cleanup**: Stop any running dev servers

## Example Handoff

```json
{
  "salientSummary": "Added Proxy tab to settings with enable toggle and rotation mode selector. Created ProxyList component with add/edit/delete. All tests passing, manual verification complete.",
  "whatWasImplemented": "ProxySettings interface in use-settings.ts with proxies array, enabled, rotationMode. ProxyTab component in settings-content.tsx. ProxyList sub-component with add form. Wired to backend via invoke('get_proxies'), invoke('add_proxy').",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "npm run typecheck", "exitCode": 0, "observation": "No errors"},
      {"command": "npm test -- --grep proxy", "exitCode": 0, "observation": "8 tests passed"}
    ],
    "interactiveChecks": [
      {"action": "Navigated to Settings > Proxy tab, added proxy 192.168.1.1:8080", "observed": "Proxy appeared in list with correct host:port"},
      {"action": "Clicked enable toggle", "observed": "Toggle switched to ON state, setting persisted"}
    ]
  },
  "tests": {
    "added": [
      {"file": "src/components/settings/proxy-list.test.tsx", "cases": [{"name": "renders proxy list", "verifies": "Component renders without crashing"}, {"name": "adds valid proxy", "verifies": "Valid proxy added to list"}]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Backend Tauri commands don't exist yet (feature blocked)
- Cannot wire UI without backend changes
- Existing UI patterns incompatible with required changes
