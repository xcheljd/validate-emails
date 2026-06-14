---
name: qa-desktop
description: >
  QA tests for the ValidateEmails desktop app. Tests all functional areas:
  email input and cleaning, validation lifecycle, results and analytics,
  proxy management, session management, settings, and export. Covers
  comprehensive use case scenarios and edge cases for each area.
---

# QA Desktop -- ValidateEmails

## Testing Target

This is a Tauri desktop app. Tests run in **browser-only mode** against the Vite
dev server at `http://localhost:1420`.

### Tauri Mock Setup

The app uses `invoke()` from `@tauri-apps/api/core` for all backend calls. In
browser-only mode, these must be mocked. The project root contains
`tauri-mock.js` which provides mock implementations.

Before testing, ensure the mock is loaded:

```javascript
// Check if Tauri internals exist
window.__TAURI_INTERNALS__ !== undefined
```

If not loaded, inject the mock by loading `tauri-mock.js` or manually setting
up `window.__TAURI_INTERNALS__.invoke` with mock responses.

Key Tauri commands to mock:
- `validate_emails_bulk` -- returns ValidationResult[]
- `revalidate_emails_bulk` -- returns ValidationResult[]
- `load_settings` / `save_settings` -- returns/accepts BackendSettings
- `get_proxy_pool` -- returns BackendProxyPool
- `add_proxy` / `delete_proxy` / `update_proxy` -- proxy CRUD
- `create_validation_session` / `load_validation_session` / `list_validation_sessions`
- `pause_validation` / `resume_validation` / `stop_validation`
- `set_proxy_bypass_for_session` / `clear_proxy_bypass_for_session`

### Browser Testing Notes

- The app uses Radix UI Dialog components which render in portals
- Some animations use CSS transitions (wait for them to complete)
- The results table uses @tanstack/react-virtual for virtualization
- Dark mode toggle is in the sidebar (Nordfox theme)
- The app has responsive breakpoints at sm: (640px) and md: (768px)

---

## Test Flow Menu

The orchestrator selects flows based on the git diff. Each flow below is a
self-contained test scenario. Run the flows relevant to the change plus edge
cases for the affected area.

---

## AREA 1: Email Input and Cleaning Pipeline

### Flow 1.1: Paste Emails and Verify Cleaning Report

1. Navigate to the validation view (default landing)
2. Find the textarea for manual email entry
3. Paste a mixed list of emails:
   ```
   john.doe@gmail.com
   johndoe@gmail.com
   john.doe+work@gmail.com
   user@gmial.com
   test@outlook.com
   invalid-email
   john@gmail.com
   john@gmail.com
   ```
4. Click "Load N Emails" button
5. **Verify**: Cleaning Report appears showing:
   - Original count: 8
   - Cleaned count should be less (duplicates removed, invalid discarded)
   - Duplicates removed counter > 0 (Gmail dot + alias collapse)
   - Typos corrected: 1 (gmial.com -> gmail.com)
   - Invalid discarded: 1 (invalid-email)
6. Click "Proceed with N Clean Emails"
7. **Verify**: Validation Config screen appears with the cleaned email count

### Flow 1.2: File Upload (CSV)

1. Drag a CSV file onto the upload area (or click Browse Files)
2. CSV should contain an "email" column with mixed valid/invalid addresses
3. **Verify**: Emails extracted and cleaning report appears
4. **Verify**: Upload area shows drag-over visual state when dragging

### Flow 1.3: Multi-File Upload

1. Drop multiple CSV files simultaneously
2. **Verify**: Emails merged from all files
3. **Verify**: If any file has 0 emails, warning toast appears

### Flow 1.4: Cleaning Report -- Back and Skip

1. Load emails to see cleaning report
2. Click "Go Back" -- verify returns to empty input state
3. Load emails again
4. Click "Skip (Use Original)" -- verify proceeds with uncleaned count

### EDGE CASE 1.5: Empty Input

1. Click "Load Emails" with empty textarea
2. **Verify**: Button is disabled or shows 0 count
3. **Verify**: No error or crash

### EDGE CASE 1.6: All-Invalid Emails

1. Paste only invalid strings: `notanemail`, `@domain.com`, `user@`, `a@b`
2. Click Load
3. **Verify**: Cleaning report shows all discarded as invalid
4. **Verify**: Cannot proceed (0 clean emails)

### EDGE CASE 1.7: Gmail Dot + Alias Collapse

1. Paste these exact emails:
   ```
   j.o.h.n@gmail.com
   john@gmail.com
   john+newsletter@gmail.com
   john+promo@gmail.com
   john@googlemail.com
   ```
2. **Verify**: All 5 collapse to 1 canonical email (johndoe@gmail.com -- wait,
   they should collapse to john@gmail.com since dots are stripped for Gmail)
3. **Verify**: Cleaning report shows 4 normalized duplicates removed

### EDGE CASE 1.8: Provider-Specific Rules

1. Paste these:
   ```
   jane.doe@outlook.com
   janedoe@outlook.com
   ```
2. **Verify**: These are NOT collapsed (Outlook treats dots as significant)
3. Paste:
   ```
   user+tag@yahoo.com
   user@yahoo.com
   ```
4. **Verify**: These are NOT collapsed (Yahoo does not strip plus aliases)

### EDGE CASE 1.9: Unicode and Special Characters

1. Paste: `user@xn--e1afmapc.com`, `josé@gmail.com`, `"quoted.local"@domain.com`
2. **Verify**: These pass through cleaning without being discarded

---

## AREA 2: Validation Lifecycle

### Flow 2.1: Start Validation

1. Load a small set of emails (5-10)
2. Select "Standard" validation mode
3. Click "Start Validation"
4. **Verify**: Progress bar appears and advances
5. **Verify**: Status badge shows "Validating" (animated)
6. **Verify**: Speed (emails/min) and ETA display update

### Flow 2.2: Pause and Resume

1. Start validation with 50+ emails
2. Click Pause button
3. **Verify**: Status changes to "Paused"
4. **Verify**: Progress bar shows partial completion
5. Click Resume button
6. **Verify**: Validation continues from where it paused

### Flow 2.3: Stop with Save

1. Start validation
2. Click Stop button
3. **Verify**: Dialog appears: "Stop Validation?" with "Save & Stop" and "Discard Results"
4. Click "Save & Stop"
5. **Verify**: Validation stops, partial results remain visible

### Flow 2.4: Stop with Discard

1. Start validation
2. Click Stop
3. Click "Discard Results"
4. **Verify**: Returns to empty input state, all results cleared

### Flow 2.5: Validation Mode Selection

1. Load emails
2. On config screen, select "Quick" mode
3. Start validation
4. **Verify**: Results show validationMode: "quick" in details
5. Repeat with "Thorough" mode

### EDGE CASE 2.6: Proxy Enabled Without Proxies

1. Go to Settings, enable proxy
2. Do NOT add any proxies
3. Go back to validation, load emails, start
4. **Verify**: Warning toast: "No proxies configured"
5. **Verify**: Validation does NOT start

### EDGE CASE 2.7: Rate Limit Warning

1. Go to Settings, set Max Emails Per Session to 5
2. Load 10+ emails
3. Start validation
4. **Verify**: Rate limit warning dialog appears with estimated time
5. Click Proceed -- verify validation starts
6. Click Cancel -- verify returns to config

### EDGE CASE 2.8: Auto-Pause on Consecutive Failures

1. Start validation with mocked results that all return "Unknown"
2. After 8 consecutive failures (mock), verify auto-pause modal appears
3. Click Resume -- verify validation continues
4. Repeat, click Stop -- verify validation stops cleanly

### EDGE CASE 2.9: Empty Results State

1. Complete validation where all results are filtered out
2. **Verify**: Results table shows "No matches found" message
3. **Verify**: No crash or blank screen

---

## AREA 3: Results and Analytics

### Flow 3.1: Results Table Filtering

1. Complete a validation with mixed results (Safe, Risky, Invalid, Unknown)
2. Click the "Safe" status card at top
3. **Verify**: Table filters to show only Safe results
4. Click "Safe" again -- verify filter clears
5. Use the dropdown filter -- verify it works
6. Use the search box -- verify text search works

### Flow 3.2: Results Table Sorting

1. Click any column header
2. **Verify**: Sort indicator appears (ascending/descending)
3. Click again -- verify sort reverses
4. Click a different column -- verify sort switches

### Flow 3.3: Column Toggle

1. Click "Columns" button
2. **Verify**: Column toggle panel appears
3. Uncheck a column -- verify it disappears from table
4. Re-check it -- verify it reappears

### Flow 3.4: Row Selection and Batch Actions

1. Select individual rows via checkbox
2. **Verify**: Batch action bar appears showing count
3. Click "Export" on selected -- verify export dialog or file download
4. Click "Delete" on selected -- verify confirm dialog, then rows removed
5. Click "Clear" -- verify selection cleared

### Flow 3.5: Result Details Modal

1. Click "Details" on any result row
2. **Verify**: Modal opens showing:
   - Email address
   - Status badge
   - Risk score with level label
   - Deliverability details (SMTP, MX, etc.)
   - Validation information (domain, duration, mode)
   - Risk factors list
   - Email flags (disposable, role account, catch-all, B2C, breached)
3. Close modal -- verify it closes cleanly

### Flow 3.6: Statistics Dashboard

1. Navigate to Analytics tab
2. **Verify**: Summary cards show correct counts (Total, Safe, Risky, Invalid, Unknown)
3. **Verify**: Pie chart renders
4. **Verify**: Risk score distribution shows
5. If any results have haveibeenpwned=true:
   - **Verify**: Breach summary card appears with count and percentage

### Flow 3.7: Domain Analysis

1. Navigate to Analytics tab
2. **Verify**: Domain analysis table shows top domains
3. **Verify**: Per-domain success rates are displayed

### EDGE CASE 3.8: Virtualized Table Performance

1. Mock results with 1000+ entries
2. **Verify**: Table scrolls smoothly without lag
3. **Verify**: Only visible rows are rendered (check DOM node count)
4. Scroll rapidly -- verify no visual glitches

### EDGE CASE 3.9: Breach Indicator in Results

1. Mock a result with haveibeenpwned=true
2. **Verify**: Red ShieldAlert icon appears next to status badge in results table
3. Open details -- verify "Breached" badge in Email Flags section
4. Check analytics -- verify breach count in summary

### EDGE CASE 3.10: Risk Score Badge Accuracy

1. Mock results with various riskScore values (0, 30, 50, 80, 100)
2. **Verify**: Badge colors match: green (0-29), yellow (30-49), orange (50-79), red (80-100)
3. **Verify**: Badge shows the numeric score from result.riskScore (not recalculated)

---

## AREA 4: Proxy Management

### Flow 4.1: Add Proxy

1. Navigate to Settings
2. Find proxy configuration section
3. Enter proxy: `socks5://user:pass@192.168.1.1:1080`
4. Click Add
5. **Verify**: Proxy appears in list with host:port display
6. **Verify**: "(auth)" or "authenticated" indicator shown

### Flow 4.2: Delete Proxy

1. With proxy added, click delete/remove
2. **Verify**: Proxy removed from list

### Flow 4.3: Rotation Mode

1. Add 2+ proxies
2. Change rotation mode dropdown (Manual, Automatic, PerDomain)
3. **Verify**: Setting persists after save

### Flow 4.4: Domain Assignment

1. Add proxies
2. Switch to PerDomain mode
3. Assign a proxy to gmail.com
4. **Verify**: Assignment appears in the per-domain table

### Flow 4.5: Proxy Health Dashboard

1. Navigate to Settings > Health tab
2. **Verify**: Summary cards show (Total, Healthy, Degraded, Failed)
3. **Verify**: Per-proxy table with success rate, latency, attempts
4. **Verify**: Auto-disable threshold configuration is present

### EDGE CASE 4.6: Invalid Proxy Format

1. Enter invalid proxy string: `not-a-proxy`
2. **Verify**: Error message shown, proxy not added

### EDGE CASE 4.7: Duplicate Proxy

1. Add a proxy
2. Try adding the same host:port again
3. **Verify**: Warning or silent rejection (no duplicate in list)

---

## AREA 5: Session Management

### Flow 5.1: Session History List

1. Navigate to History tab
2. **Verify**: List of past sessions appears (or empty state message)
3. **Verify**: Each session shows name, status, email count, completion %, date
4. **Verify**: Status badges are correct (Done, In-Progress, Paused, Stopped)

### Flow 5.2: View Session Details

1. Click "Details" on a session
2. **Verify**: Session details view opens
3. **Verify**: Shows session name, progress, results table
4. **Verify**: Back button returns to history list

### Flow 5.3: Session Comparison (Diff)

1. Select exactly 2 sessions via checkboxes
2. **Verify**: "Compare Selected" button enables
3. Click compare
4. **Verify**: Diff view shows:
   - Summary cards for both sessions
   - Added/Removed/Changed emails
   - Change summary with verdict transition counts

### EDGE CASE 5.4: Compare with Fewer Than 2 Selected

1. Select 0 or 1 session
2. **Verify**: Compare button is disabled

### EDGE CASE 5.5: Delete Session

1. Click delete on a session
2. **Verify**: Confirm dialog appears
3. Confirm -- verify session removed from list

### EDGE CASE 5.6: Crash Recovery Dialog

1. Mock an incomplete session (status: in-progress or paused)
2. Reload the app
3. **Verify**: Crash recovery dialog appears listing incomplete sessions
4. Click Resume -- verify session loads
5. Click Dismiss -- verify dialog closes

---

## AREA 6: Settings and Configuration

### Flow 6.1: Validation Settings

1. Navigate to Settings > Validation tab
2. Change concurrency slider
3. Change timeout
4. Change retry count
5. Click Save
6. **Verify**: Settings saved notification or indicator
7. Reload app -- verify settings persist

### Flow 6.2: Rate Limit Settings

1. Navigate to Settings > Validation tab
2. Set Max Per Second to 2
3. Set Max Per Minute to 120
4. Set Max Emails Per Session to 100
5. Save and verify persistence

### Flow 6.3: History Settings

1. Navigate to Settings
2. Change session retention days
3. Click "Clean Up Old Sessions"
4. **Verify**: Cleanup runs (or confirm dialog appears)

### Flow 6.4: Concurrency Setting Actually Applied

1. Set concurrency to 10 in settings
2. Start validation
3. **Verify**: The actual concurrency used is 10 (check mock invoke call args)
4. This verifies the fix for the hardcoded concurrency=5 bug

### EDGE CASE 6.5: Settings Persistence Across Reload

1. Change multiple settings
2. Save
3. Reload the page
4. **Verify**: All saved settings are restored

### EDGE CASE 6.6: Settings with Invalid Values

1. Enter negative or zero for timeout
2. Enter extremely large concurrency (e.g., 999)
3. **Verify**: Values are clamped or rejected with error message

---

## AREA 7: Export

### Flow 7.1: Export Dialog -- Full Report

1. Complete validation with results
2. Click Export button
3. **Verify**: Export dialog opens
4. Select "Full Report" preset
5. Select CSV format
6. Click Export
7. **Verify**: File download triggered

### Flow 7.2: Export -- Clean List Preset

1. Open export dialog
2. Click "Clean List" preset
3. **Verify**: Filter shows "Safe only"
4. **Verify**: Column selection narrows to key columns
5. Export -- verify only Safe results in output

### Flow 7.3: Export -- Suppression List Preset

1. Open export dialog
2. Click "Suppression List" preset
3. **Verify**: Filter shows "Invalid & Risky only"
4. Export -- verify only Invalid/Risky in output

### Flow 7.4: Export -- XLSX Format

1. Open export dialog
2. Select XLSX format
3. Export
4. **Verify**: .xlsx file downloads

### EDGE CASE 7.5: Export with No Columns Selected

1. Open export dialog
2. Deselect all columns
3. **Verify**: Export button is disabled

### EDGE CASE 7.6: Export with Dedup Mapping

1. Load emails that trigger dedup (Gmail dots, aliases)
2. Complete validation
3. Export with "Original Emails" column enabled
4. **Verify**: Original emails column populated with semicolon-separated list

---

## AREA 8: Smart Retry and Escalation

### Flow 8.1: Retry Unknowns

1. Complete validation with some Unknown results
2. **Verify**: "Retry Unknowns" button or modal appears
3. Click Retry
4. **Verify**: Only Unknown emails are re-validated
5. **Verify**: Progress updates correctly

### Flow 8.2: Manual Tier Retry

1. After validation with Unknowns, retry modal appears
2. Select Tier 1 (Quick)
3. Click Retry
4. **Verify**: Quick mode is used for revalidation

### Flow 8.3: Auto-Escalation

1. After validation with Unknowns
2. Select "Auto-Escalate" in retry modal
3. Click Retry
4. **Verify**: Escalation progress indicator shows current tier
5. **Verify**: Unknowns decrease through tiers (Quick -> Standard -> Thorough)

### EDGE CASE 8.4: Retry with No Unknowns

1. Complete validation where all results are Safe/Risky/Invalid
2. **Verify**: Retry modal does NOT appear
3. **Verify**: No retry button shown

---

## AREA 9: Error Boundaries and Resilience

### Flow 9.1: Per-View Error Boundary

1. Navigate to Analytics view
2. Mock a component error (e.g., inject bad data that crashes Recharts)
3. **Verify**: Inline error message appears ("This view encountered an error")
4. **Verify**: Other views (Validation, Settings) still work
5. **Verify**: "Try Again" button recovers the view

### Flow 9.2: Validation Config Preview Virtualization

1. Load 1000+ emails
2. Navigate to config screen
3. **Verify**: Preview list scrolls smoothly
4. **Verify**: Only visible rows rendered in DOM (check element count)

---

## Known Failure Modes

1. **Tauri invoke hangs in browser mode.** When testing without Tauri, invoke()
   calls hang forever unless mocked. Always ensure tauri-mock.js is loaded before
   interacting with features that trigger invoke() (settings load, validation
   start, session list, proxy operations).

2. **Radix Dialog portal rendering in Tauri WebView.** Dialog components use
   portals that may not render correctly inside Tauri's WebKit. In browser-only
   mode they work fine. If testing in Tauri mode, dialogs may need extra wait time.

3. **Settings load timing.** On initial page load, SettingsProvider makes async
   invoke() calls to load settings. If these haven't resolved yet, settings will
   show defaults. Wait for settings to load before interacting with settings UI.

4. **Validation progress events.** The validation-progress Tauri event drives
   real-time result updates. In browser-only mode, these events must be simulated
   via the test helper or by dispatching events manually.

5. **localStorage as fallback.** When Tauri backend is unavailable, the app
   falls back to localStorage for settings. This means settings may behave
   differently in browser-only vs Tauri mode (especially proxy operations).

6. **Rate limit sequential processing.** When rate limiting is active, validation
   switches from concurrent to sequential. This is much slower. Mock validation
   results should account for this timing difference.
