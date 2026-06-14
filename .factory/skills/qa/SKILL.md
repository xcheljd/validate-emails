---
name: qa
description: >
  Run comprehensive QA tests for ValidateEmails (ReachCheck). Analyzes git diff to
  determine affected areas, runs functional test flows covering use case scenarios
  and edge cases, and generates a structured report. Uses agent-browser for browser-
  based testing of the React frontend with mocked Tauri backend. Use when testing
  PRs, releases, or smoke testing the application.
---

# QA Orchestrator

**SCOPE: This skill performs manual/functional QA only -- verifying that the
application actually works by interacting with it as a real user would via
browser. Do NOT run or report on CI checks, linting, ESLint, typecheck, unit
tests (vitest), or any static analysis. Those are handled by separate workflows.**

## Step 1: Load Configuration

Read `.factory/skills/qa/config.yaml` for environment URLs, personas, and app
definitions.

## Step 2: Determine Target Environment

Use the `development` environment (default_target). URL: `http://localhost:1420`.

This is a Tauri desktop app. In CI and browser-only testing, the Vite dev server
runs at localhost:1420. Tauri `invoke()` calls must be mocked using
`tauri-mock.js` at the project root or via
`window.__TAURI_INTERNALS__.invoke()` override.

## Step 3: Analyze Git Diff

Run `git diff` (or `git diff --cached` for staged changes, or `git diff HEAD~1`
for the last commit) to determine what changed. Map changed files to apps using
the `path_patterns` in config.yaml.

All source files (`src/**`, `src-tauri/src/**`) map to the `desktop` app. If any
source file changed, run the desktop QA sub-skill.

Files that don't match ANY app's path_patterns (e.g., `.factory/skills/**`,
`docs/**`, `README.md`, `*.md` files, `.github/**`) are NOT associated with any
app. Do NOT run app test flows for them.

If NO app is affected by the diff, report as INCONCLUSIVE: "No app code changed
-- QA not applicable for this diff."

## Step 4: Pre-flight Checks

For the desktop app:

1. Verify `npm run dev` is running or start it: `npm run dev &`
2. Poll `http://localhost:1420` until it responds (max 30 seconds)
3. Verify the Tauri mock is loaded (check for `window.__TAURI_INTERNALS__`)
4. If pre-flight fails, report BLOCKED with specific error and remediation

## Step 5: Execute Flows

Read the sub-skill at `.factory/skills/qa-desktop/SKILL.md`.

The sub-skill contains a MENU of available test flows organized by functional
area. You must:

1. Read the diff carefully and identify which flows are relevant to the change
2. Run those flows PLUS adjacent flows that verify integration
3. Always run the EDGE CASE flows relevant to the changed area
4. Write ad-hoc tests for any new feature not covered by existing flows
5. Do NOT run completely unrelated flows
6. Do NOT run unit tests, lint, typecheck, or vitest

## Step 6: Evidence Capture

After each significant test step, capture evidence:

- Use `agent-browser snapshot` to capture accessibility tree as text
- Save screenshots to `./qa-results/$RUN_ID/`
- Do NOT embed `![image](url)` in the report -- reference filenames instead
- Label each snapshot clearly

## Step 7: Test Quality Gate

1. CHANGE-SPECIFIC FIRST. At least half your tests should verify the changed behavior
2. INTEGRATION TESTS ARE VALID. Verify changes don't break integration points
3. NO UNRELATED FLOWS. Don't test features unrelated to the diff
4. NO AUTOMATED TEST SUITES. This is manual/functional QA only
5. NEGATIVE TESTS. Include at least 1 error handling or boundary test
6. INTERACTIVE TESTING. Actually interact with the app as a user would
7. INCONCLUSIVE IF UNSURE. Mark as INCONCLUSIVE rather than PASS if unsure

## Step 8: Handle Failures

**Never silently skip a flow.** If a flow cannot complete, report it as BLOCKED
with what was tried and remediation steps. Continue to the next flow.

## Step 9: Generate Report

Generate the report at `./qa-results/report.md` using the template at
`.factory/skills/qa/REPORT-TEMPLATE.md`.

Key rules:
- Start with `## QA Report` heading
- Result column uses emojis: PASS :white_check_mark:, FAIL :x:, BLOCKED :no_entry:, FLAKY :warning:, INCONCLUSIVE :grey_question:
- Keep it CONCISE
- Put all evidence in a single collapsed `<details>` block

## Step 10: Suggest Skill Updates

After generating the report, check if any BLOCKED or FAIL results revealed a
testing environment insight. Format as a table with severity and collapsible fix
prompts. Only suggest environment/workflow knowledge, not skill bugs.
