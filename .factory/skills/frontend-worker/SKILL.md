---
name: frontend-worker
description: React/TypeScript frontend implementation for UI features
---

# Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that require:
- React components (new or modified)
- TypeScript logic modules (pure functions, hooks, utilities)
- State management changes in App.tsx or hooks
- UI interactions and form validation
- No Rust backend changes

## Required Skills

- `agent-browser` — For manual verification of UI flows at http://localhost:1420

## Work Procedure

1. **Read existing code thoroughly**:
   - Read `src/App.tsx` for app state flow and navigation
   - Read relevant component files in `src/components/`
   - Read relevant library files in `src/lib/`
   - Read `src/lib/types.ts` for interfaces
   - Read `src/hooks/` for existing hooks and patterns
   - Read PRD if applicable (`PRD-email-deduplication.md`)

2. **Write failing tests first** (red):
   - Create test file `*.test.ts` or `*.test.tsx` as appropriate
   - For pure logic: unit tests with vitest
   - For components: `@testing-library/react` render + assertions
   - For hooks: `renderHook()` with `QueryClientProvider` wrapper
   - Follow existing patterns: `vi.mock('@tauri-apps/api/core')` for Tauri mocks, `createMockResult()` for test data
   - Run `npx vitest run <path>` to verify tests fail

3. **Implement to make tests pass** (green):
   - Create/modify TypeScript files
   - Create/modify React components using Shadcn UI primitives + Radix
   - Use `cn()` for class merging, Lucide icons for iconography
   - Wire into App.tsx state flow if adding new app states or screens
   - If adding new app state: update the state type union and add rendering logic in App.tsx

4. **Run full verification**:
   - `npm run typecheck` (or `npm run build`)
   - `npm test`
   - `npx eslint src/`

5. **Manual verification with agent-browser**:
   - Start dev server: `npm run dev` (runs on port 1420)
   - Wait for it: `sleep 3 && curl -sf http://localhost:1420`
   - Use agent-browser to navigate to http://localhost:1420
   - Test the complete user flow for the feature
   - Take screenshots at key points
   - **Stop the dev server when done**: `lsof -ti :1420 | xargs kill`

6. **Each manual check must produce an interactiveChecks entry** with `{action, observed}`.

7. **Cleanup**: Ensure no dev server or test runner is left running.

## Example Handoff

```json
{
  "salientSummary": "Implemented email cleaner module with 10 provider rules and cleaning report UI. 47 unit tests passing for core logic. Agent-browser verified: cleaning report shows correct stats, Proceed/Back/Skip buttons work.",
  "whatWasImplemented": "Created src/lib/email-cleaner.ts with cleanEmailList(), toCanonical(), provider rules table for 10 providers, syntax cleaning, and typo correction integration. Created src/components/validation/cleaning-report.tsx with summary cards, expandable details, and Proceed/Back/Skip actions. Added 'cleaning_report' state to App.tsx between loaded and config.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "npm run typecheck", "exitCode": 0, "observation": "No errors"},
      {"command": "npm test", "exitCode": 0, "observation": "All tests passing (253 total, 47 new)"},
      {"command": "npx eslint src/", "exitCode": 0, "observation": "No warnings"}
    ],
    "interactiveChecks": [
      {"action": "Pasted 10 emails with duplicates and typos, submitted", "observed": "Cleaning report appeared showing Original: 10, Clean: 7, Duplicates: 2, Typos: 1"},
      {"action": "Expanded 'Duplicates Removed' section", "observed": "Showed john.doe@gmail.com <- johndoe@gmail.com mapping"},
      {"action": "Clicked 'Proceed with 7 Clean Emails'", "observed": "Transitioned to validation config showing 7 emails"},
      {"action": "Clicked 'Go Back'", "observed": "Returned to email input screen"},
      {"action": "Clicked 'Skip Cleaning'", "observed": "Proceeded to config with original 10 emails"}
    ]
  },
  "tests": {
    "added": [
      {"file": "src/lib/email-cleaner.test.ts", "cases": [
        {"name": "gmail dot removal", "verifies": "john.doe@gmail.com -> johndoe@gmail.com"},
        {"name": "gmail plus stripping", "verifies": "user+tag@gmail.com -> user@gmail.com"},
        {"name": "outlook dots significant", "verifies": "john.doe@outlook.com != johndoe@outlook.com"},
        {"name": "hotmail not aliased to outlook", "verifies": "user@hotmail.com != user@outlook.com"},
        {"name": "full pipeline mixed list", "verifies": "Correct stats for mixed input"}
      ]},
      {"file": "src/components/validation/cleaning-report.test.tsx", "cases": [
        {"name": "renders summary cards", "verifies": "All 6 cards present with correct values"},
        {"name": "expandable sections work", "verifies": "Sections expand to show details"},
        {"name": "proceed button transitions", "verifies": "Calls onProceed with cleaned emails"}
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Backend Tauri commands don't exist yet (feature blocked)
- Cannot wire UI without backend changes
- Existing UI patterns incompatible with required changes
- Feature requires new npm dependencies
