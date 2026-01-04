# Remaining Implementation Specification

**Project:** Email Validation App (Tauri + React)
**Status:** Phase 1 Complete, Phase 2 Partial (50%), Phase 3 Not Started
**Estimated Time to Complete:** 2-3 hours

---

## Overview

This document specifies the remaining implementation work for the email validation application enhancement project.

---

## Phase 2: Session History & Persistence (50% Complete)

### ✅ Completed
- Rust session.rs with CRUD operations
- 90-day auto-cleanup logic
- TypeScript typo-database.ts with common typos
- Enhanced ValidationResult interface with new fields

### 📋 Remaining Tasks

#### 1. Install Excel Dependency
**File:** `package.json`
**Action:** Add xlsx and @types/xlsx to dependencies
**Command:**
```bash
npm install xlsx
npm install -D @types/xlsx
```

#### 2. Create TypeScript Session Manager
**File:** `src/lib/session-manager.ts`
**Purpose:** Frontend wrapper for Rust session commands

**Interface:**
```typescript
export interface ValidationSession {
  id: string;
  name: string;
  emails: string[];
  results: ValidationResult[];
  status: 'pending' | 'in-progress' | 'completed' | 'paused' | 'stopped';
  currentIndex: number;
  total: number;
  createdAt: string;
  completedAt?: string;
  settings: SessionSettings;
}

export interface SessionSettings {
  validationMode: 'quick' | 'standard' | 'thorough';
  proxyEnabled: boolean;
  proxyRotationStrategy: string;
  maxEmailsPerProxy: number;
}
```

**Functions:**
- `createSession(emails, settings)` → Promise<string> (returns session ID)
- `updateSessionProgress(sessionId, results, currentIndex)` → Promise<void>
- `loadSession(sessionId)` → Promise<ValidationSession>
- `listSessions()` → Promise<ValidationSession[]>
- `deleteSession(sessionId)` → Promise<void>
- `cleanupOldSessions(days)` → Promise<number> (returns deleted count)
- `generateSessionName()` → string (format: "Jan 4, 2025 2:30 PM")

#### 3. Session History List Component
**File:** `src/components/history/session-history.tsx`
**Features:**
- Table showing all sessions with: name, status, email count, completion %, date
- Auto-refresh on mount
- Auto-cleanup old sessions (90 days) on load
- Session actions: View details, Resume (if paused), Delete
- Status icons: ✓ Done, 🔄 In-Progress, ⏸ Paused, ⏹ Stopped

**UI Layout:**
```
+-------------------------------------------------------+
|  Validation History                          [Refresh]  |
+-------------------------------------------------------+
|  Session Name           | Status | Emails | Date       |
|  ----------------------|--------|---------|------------|
|  Jan 4, 2025 2:30 PM  | ✓ Done | 2,345   | Jan 4      |
|  CRM Cleanup           | ⏸ Paused| 891    | Dec 28     |
|  Trade Show Leads       | 🔄 In-Progress | 5,102  | Today      |
+-------------------------------------------------------+
```

#### 4. Session Details Component
**File:** `src/components/history/session-details.tsx`
**Features:**
- Session summary header (name, progress, settings used)
- Statistics cards (Safe, Risky, Invalid, Unknown counts)
- ResultsTable with all validated emails
- Actions: Export, Delete, Resume (if paused), New validation button

**Layout:**
```
+-------------------------------------------------------+
|  Jan 4, 2025 2:30 PM                           [Close]    |
|  891 / 2,345 validated                                       |
+-------------------------------------------------------+
|  Safe: 1,890 | Risky: 320 | Invalid: 126 | Unknown: 9  |
+-------------------------------------------------------+
|  [Results Table Component Here]                             |
|  [Export CSV] [Export Excel] [Delete]               |
+-------------------------------------------------------+
```

#### 5. Update ValidationDashboard
**File:** `src/components/validation/validation-dashboard.tsx`
**Changes Required:**
- Import `ValidationModeSelector` from "./validation-modes"
- Replace hardcoded mode selector with `ValidationModeSelector` component
- Fix `ValidationModeSelector` name mismatch (currently named `ValidationModes` in file)
- Add proxy pool status display if `proxyStatus` prop provided
- Add validation speed and ETA display if props provided

**New Props to Add:**
```typescript
interface ValidationDashboardProps {
  // Existing props...
  validationMode?: 'quick' | 'standard' | 'thorough';
  onChangeValidationMode?: (mode: 'quick' | 'standard' | 'thorough') => void;
  proxyStatus?: ProxyPoolStatus;
  validationSpeed?: number;
  estimatedTimeRemaining?: number;
}
```

---

## Phase 3: Intelligence & Export Features (0% Complete)

### 📋 Remaining Tasks

#### 6. Create Enhanced Export Utilities
**File:** `src/lib/enhanced-export-utils.ts`
**Purpose:** Replace existing export-utils.ts with column selection and Excel support

**Features:**
- Export to CSV with selectable columns
- Export to Excel (.xlsx) with selectable columns
- Column configuration array (13 total columns)

**Columns Available:**
1. Email
2. Status (Safe/Risky/Invalid/Unknown)
3. Verdict Reason
4. Domain
5. Duration (ms)
6. Proxy (IP:PORT)
7. MX Records
8. Disposable (true/false)
9. Role Account (true/false)
10. Catch-All (true/false)
11. Error Type
12. Validated At (timestamp)
13. Validation Mode

**Functions:**
```typescript
export interface ExportColumn {
  key: keyof ValidationResult;
  label: string;
  enabled: boolean;
}

export const exportColumns: ExportColumn[] = [
  { key: 'email', label: 'Email', enabled: true },
  { key: 'result', label: 'Status', enabled: true },
  // ... all 13 columns
];

export function exportToExcel(results, columns, filename);
export function exportToCSV(results, columns, filename);
```

#### 7. Create Risk Scorer Module
**File:** `src/lib/risk-scorer.ts`
**Purpose:** Calculate risk score 0-100 based on validation factors

**Risk Calculation Formula:**
```typescript
Base Score (from result):
- Safe: 0
- Risky: 30
- Invalid: 100
- Unknown: 50

Additions:
- Disposable email: +40
- Role account: +15
- Catch-all domain: +25
- No MX records: +50
- Network error: +20

Final score = min(Base Score + Additions, 100)
```

**Risk Levels:**
- 0-10: Very Low
- 10-30: Low
- 30-50: Medium
- 50-80: High
- 80-100: Very High

**Functions:**
```typescript
export function calculateRiskScore(result: ValidationResult): number;
export function getRiskLevel(score: number): 'Very Low' | 'Low' | 'Medium' | 'High' | 'Very High';
export function getRiskColor(score: number): string; // Tailwind color classes
export function getRiskReasons(result: ValidationResult): string[];
```

#### 8. Create Risk Score Badge Component
**File:** `src/components/validation/risk-score-badge.tsx`
**Purpose:** Display risk score as a small badge next to status

**Features:**
- Shows score number (0-100)
- Color-coded background based on risk level
- Hover tooltip showing full risk level name
- Small, unobtrusive design

**Visual Design:**
```
[Safe] 🟢 0    (Very Low)
[Safe] 🟡 35    (Low)
[Risky] 🟡 55    (Medium)
[Risky] 🟠 75    (High)
[Invalid] 🔴 95   (Very High)
```

#### 9. Create Typo Warning Component
**File:** `src/components/validation/typo-warning.tsx`
**Purpose:** Alert user of potential email typos and offer corrections

**Features:**
- Detects typos using typo-database
- Shows warning icon and suggested correction
- One-click fix button
- "Fix all [N] similar" option for batch corrections

**Example:**
```
⚠️ Typo detected: test@gmial.com → test@gmail.com
[Fix This Email] [Fix All 3 Similar]
```

#### 10. Update Results Table
**File:** `src/components/validation/results-table.tsx`
**Required Changes:**

**Add Columns (toggleable):**
- Email
- Domain
- Duration (ms)
- Proxy Used
- MX Records
- Is Disposable
- Is Role Account
- Is Catch-All
- Error Type
- Timestamp
- Validation Mode

**Add Features:**
- Column visibility toggles (checkbox or dropdown)
- Filter by status
- Filter by risk score range
- Sort by risk score
- Show `RiskScoreBadge` next to status
- Show `TypoWarning` for each email if typo detected
- Batch actions: Export selected, Delete selected

**UI Layout:**
```
+-------------------------------------------------------------+
|  [Search]  [Filter: All▼]  [Columns▼]    |
|  Showing 234 of 2,345 emails (12 emails/min)  |
+-------------------------------------------------------------+
|  [Email▼] [Status▼] [Risk▼] [Domain▼] [Proxy▼]  |
|  [Duration▼] [MX▼] [Disposable▼] [Role▼] [Actions▼] |
|  ... table rows ...                                       |
+-------------------------------------------------------------+
```

#### 11. Update Result Details Modal
**File:** `src/components/validation/result-details.tsx`
**Required Changes:**

**Add Sections:**
1. Enhanced Information
   - Domain
   - Validation duration
   - Proxy used
   - MX record count
   - Timestamp
   - Validation mode

2. Risk Factors Panel
   - List all factors affecting risk score
   - Visual indicators for each factor
   - Explanation of each factor

3. Typo Correction
   - Show if typo detected
   - One-click fix button

**Layout:**
```
+-------------------------------------------------------+
|  Validation Details: john@company.com              [X]    |
+-------------------------------------------------------+
|  Status: Safe (🟢 0)                           |
|  Domain: company.com                                |
|  Duration: 1,245ms                                |
|  Proxy: 192.168.1.100:8080                        |
|  MX Records: 4                                      |
+-------------------------------------------------------+
|  Risk Factors:                                        |
|  ✓ Syntax valid                                       |
|  ✓ MX records found                                   |
|  ✓ SMTP deliverable                                   |
|  ! Disposable email detected (+40)                   |
|  ! Role account detected (+15)                          |
+-------------------------------------------------------+
|  Final Risk Score: 55 (Medium)                     |
+-------------------------------------------------------+
|  Verdict Reason:                                     |
|  Reachability: Safe, Misc: {...}, MX: {...}, SMTP: {...} |
+-------------------------------------------------------+
|  [Technical Logs Section]                             |
+-------------------------------------------------------+
```

#### 12. Create Domain Analysis Component
**File:** `src/components/analytics/domain-analysis.tsx`
**Purpose:** Analyze validation results by domain

**Features:**
- Table showing top 20 domains by volume
- Per-domain statistics: total, safe, risky, invalid, unknown counts
- Success rate percentage per domain
- Visual indicators for problem domains (low success rates)
- Filter by domain name
- Sort by total, success rate, or domain

**Metrics:**
```typescript
interface DomainStats {
  domain: string;
  totalCount: number;
  safeCount: number;
  riskyCount: number;
  invalidCount: number;
  unknownCount: number;
  successRate: number; // percentage
  isFreeProvider: boolean; // gmail.com, yahoo.com, etc.
}
```

**UI Layout:**
```
+-------------------------------------------------------+
|  Domain Analysis                                    |
+-------------------------------------------------------+
|  | Domain      | Total | Safe | Risky | Invalid | Success Rate |  |
|  |-------------|-------|------|--------|----------|-----|
|  | gmail.com   | 1,234 | 1,100 | 89  | 45  | 89.2%     |
|  | company.com | 456   | 400  | 34  | 10  | 7.9%      |
|  | yahoo.com   | 89    | 75   | 12  | 2   | 84.3%     |
|  | ...         | ...   | ...  | ...  | ...  | ...        |
+-------------------------------------------------------+
```

#### 13. Create Statistics Dashboard Component
**File:** `src/components/analytics/statistics-dashboard.tsx`
**Purpose:** Overview of validation statistics and analytics

**Features:**

**Summary Cards:**
- Total emails validated
- Safe emails (with green highlight)
- Risky emails (with yellow highlight)
- Invalid emails (with red highlight)
- Unknown emails (with gray highlight)

**Charts:**
- Status breakdown pie chart (Safe/Risky/Invalid/Unknown)
- Risk score distribution histogram
- Top 20 domains bar chart (horizontal)

**Additional Metrics:**
- Average validation duration
- Validation speed (emails/min)
- Proxy success rate (if proxies used)
- Most common domain

**Layout:**
```
+-------------------------------------------------------+
|  Validation Statistics Dashboard                       |
+-------------------------------------------------------+
|  [Total: 2,345] [Safe: 1,100] [Risky: 320]         |
|  [Invalid: 126] [Unknown: 9]                       |
|  [Avg Duration: 1.2s] [Speed: 12/min]            |
+-------------------------------------------------------+
|  [Status Pie Chart]     [Risk Histogram]              |
|  [Distribution]           [Top Domains Bar Chart]         |
+-------------------------------------------------------+
```

**Note:** Use existing recharts dependency for charts

#### 14. Create Validation Settings Component
**File:** `src/components/settings/validation-settings.tsx`
**Purpose:** Configure validation behavior

**Controls:**

**Default Validation Mode:**
- Dropdown: Quick (10s), Standard (30s), Thorough (60s)

**Concurrency:**
- Slider: 1-20 (default: 5)
- Display: "Concurrency: 5 parallel validations"

**Timeout:**
- Slider: 10-120 seconds (default: 30s)
- Display: "Timeout: 30s"

**Retry Count:**
- Input: 0-5 (default: 3)
- Display: "Max Retries: 3"

**Auto-Save Interval:**
- Input: 5-50 (default: 10)
- Display: "Auto-Save every: 10 validations"

#### 15. Create Proxy Settings Component
**File:** `src/components/settings/proxy-settings.tsx`
**Purpose:** Configure proxy behavior

**Controls:**

**Enable Proxy:**
- Toggle switch
- Default: false (disabled)

**Rotation Strategy:**
- Dropdown options:
  - Rotate on Failure (default, recommended)
  - Rotate Per Email
  - Rotate Per Batch

**Max Emails Per Proxy:**
- Input: 10-100 (default: 50)
- Display: "Max Emails Per Proxy: 50"

**Protocol Preference:**
- Dropdown: Any (default), HTTP, SOCKS5

**Min Uptime:**
- Slider: 50-100% (default: 80%)
- Display: "Min Proxy Uptime: 80%"

**Proxy Pool Status:**
- Real-time display:
  - Total proxies available
  - Current active proxy
  - Success rate percentage
  - Average download speed

**Actions:**
- [Refresh Proxy List] button
- [Clear Proxy Pool] button

#### 16. Create History Settings Component
**File:** `src/components/settings/history-settings.tsx`
**Purpose:** Configure session history behavior

**Controls:**

**Retention Period:**
- Input: 1-365 days (default: 90)
- Display: "Delete sessions older than: 90 days"
- Auto-cleanup on app start

**Manual Cleanup:**
- [Clean Up Old Sessions] button
- Show confirmation dialog before deletion
- Display sessions that will be deleted

**Session Count Warning:**
- Show warning if session count exceeds 50
- Message: "Warning: High session count (65 sessions). Consider cleanup."

#### 17. Create Settings Panel Component
**File:** `src/components/settings/settings-panel.tsx`
**Purpose:** Main settings dialog with tabbed interface

**Tabs:**
1. Validation Settings
2. Proxy Settings
3. History Settings

**Layout:**
```
+-------------------------------------------------------+
|  Settings                                    [X]         |
+-------------------------------------------------------+
|  [Validation] [Proxy] [History]                  |
+-------------------------------------------------------+
|  [Tab Content Area]                              |
+-------------------------------------------------------+
|  [Reset to Defaults] [Save] [Cancel]            |
+-------------------------------------------------------+
```

**Features:**
- Use shadcn/ui Tabs component
- Load/save settings from Rust backend
- Reset to defaults button
- Save button with success feedback
- Validation on save (validate input ranges)

#### 18. Update use-email-validation Hook
**File:** `src/hooks/use-email-validation.ts`
**Required Enhancements:**

**New State:**
```typescript
const [validationMode, setValidationMode] = useState<'quick' | 'standard' | 'thorough'>('standard');
const [validationSpeed, setValidationSpeed] = useState<number>(0);
const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number>(0);
const [sessionId, setSessionId] = useState<string | null>(null);
```

**New Logic:**

1. **ETA Calculation:**
```typescript
useEffect(() => {
  if (progress >= 10 && results.length > 0) {
    const recentDurations = results.slice(-10).map(r => r.validationDuration);
    const avgDuration = recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;
    const speed = 60000 / avgDuration; // emails per minute
    const remaining = (total - progress) * avgDuration / 1000; // seconds
    setValidationSpeed(Math.round(speed));
    setEstimatedTimeRemaining(Math.round(remaining));
  }
}, [progress, results, total]);
```

2. **Session Integration:**
```typescript
// Create session on start validation
const startValidation = useCallback(async (emails, settings) => {
  const sid = await createSession(emails, settings);
  setSessionId(sid);
  // ... existing validation logic
}, []);

// Auto-save every 10 validations
useEffect(() => {
  if (sessionId && progress > 0 && progress % 10 === 0) {
    updateSessionProgress(sessionId, results, progress);
  }
}, [sessionId, progress, results]);

// Resume session logic
const resumeValidation = useCallback(async () => {
  if (sessionId) {
    const session = await loadSession(sessionId);
    const emailsToRevalidate = session.emails.slice(session.currentIndex);
    const unknownOrFailed = session.results.filter(r =>
      r.result === 'Unknown' || r.result === 'Invalid'
    );
    const emailsToValidate = [...emailsToRevalidate, ...unknownOrFailed];
    // Start validation for filtered emails
  }
}, [sessionId]);
```

**Updated Return Value:**
```typescript
return {
  results,
  isProcessing: status === 'processing',
  status,
  progress,
  total,
  startValidation,
  pauseValidation,
  resumeValidation,
  stopValidation,
  setResults,
  validationMode,
  onChangeValidationMode,
  sessionId,
  validationSpeed,
  estimatedTimeRemaining,
};
```

#### 19. Update App.tsx
**File:** `src/App.tsx`
**Required Changes:**

**Add to State:**
```typescript
const [showHistory, setShowHistory] = useState(false);
const [showSettings, setShowSettings] = useState(false);
const [currentView, setCurrentView] = useState<'validation' | 'history' | 'session-details'>('validation');
const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
```

**Add Header Actions:**
```typescript
<header className="border-b px-8 py-6 flex items-center justify-between bg-card">
  <div className="flex items-center gap-4">
    {/* Existing content */}
  </div>
  <div className="flex items-center gap-2">
    <Button variant="ghost" onClick={() => setShowHistory(true)}>
      <HistoryIcon className="h-5 w-5" /> History
    </Button>
    <Button variant="ghost" onClick={() => setShowSettings(true)}>
      <SettingsIcon className="h-5 w-5" /> Settings
    </Button>
  </div>
</header>
```

**Add Views:**

1. **History View:**
```typescript
{showHistory && (
  <div className="h-screen">
    <SessionHistory
      onViewDetails={(sessionId) => {
        setSelectedSessionId(sessionId);
        setCurrentView('session-details');
        setShowHistory(false);
      }}
      onResume={(sessionId) => {
        // Load and resume session
        setSelectedSessionId(sessionId);
        setCurrentView('validation');
        setShowHistory(false);
      }}
    />
  </div>
)}
```

2. **Session Details View:**
```typescript
{currentView === 'session-details' && selectedSessionId && (
  <SessionDetails sessionId={selectedSessionId} />
)}
```

**Add Settings Dialog:**
```typescript
<SettingsPanel
  open={showSettings}
  onOpenChange={setShowSettings}
/>
```

**Update ValidationDashboard Props:**
```typescript
<ValidationDashboard
  // existing props...
  validationMode={validationMode}
  onChangeValidationMode={(mode) => setValidationMode(mode)}
  proxyStatus={proxyStatus}
  validationSpeed={validationSpeed}
  estimatedTimeRemaining={estimatedTimeRemaining}
/>
```

---

## Phase 4: Polish

### 📋 Remaining Tasks

#### 20. Desktop Notifications
**File:** Update relevant files to add notification support

**Install Dependency:**
```bash
npm install @tauri-apps/plugin-notification
```

**Usage:**
```typescript
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

export async function notifyValidationComplete(session: ValidationSession) {
  const hasPermission = await isPermissionGranted();
  if (!hasPermission) {
    await requestPermission();
  }

  await sendNotification({
    title: 'Validation Complete',
    body: `Finished ${session.total} emails. Safe: ${session.safeCount}, Risky: ${session.riskyCount}`,
    icon: 'icons/128x128.png'
  });
}

export async function notifyError(message: string) {
  const hasPermission = await isPermissionGranted();
  if (!hasPermission) {
    await requestPermission();
  }

  await sendNotification({
    title: 'Error',
    body: message,
    icon: 'icons/128x128.png'
  });
}
```

**Trigger Points:**
- Validation completes successfully
- Validation encounters error
- Session saved
- Proxies refreshed

#### 21. Update Main Layout
**File:** `src/components/layout/main-layout.tsx`

**Add Header Buttons:**
- History button (with icon)
- Settings button (with icon)

**Navigation:**
- Switch between validation view and history view
- Keep validation state when navigating to history

---

## File Summary

### New Files to Create (17 total)

**TypeScript (10 files):**
1. `src/lib/session-manager.ts`
2. `src/lib/risk-scorer.ts`
3. `src/lib/enhanced-export-utils.ts`
4. `src/components/history/session-history.tsx`
5. `src/components/history/session-details.tsx`
6. `src/components/validation/risk-score-badge.tsx`
7. `src/components/validation/typo-warning.tsx`
8. `src/components/analytics/domain-analysis.tsx`
9. `src/components/analytics/statistics-dashboard.tsx`
10. `src/components/settings/validation-settings.tsx`
11. `src/components/settings/proxy-settings.tsx`
12. `src/components/settings/history-settings.tsx`
13. `src/components/settings/settings-panel.tsx`

### Files to Modify (5 files):

1. `src/hooks/use-email-validation.ts`
   - Add new state variables
   - Implement ETA calculation
   - Add session integration
   - Update return value

2. `src/components/validation/validation-dashboard.tsx`
   - Import ValidationModeSelector
   - Fix component name issue
   - Add new props (validationMode, proxyStatus, validationSpeed, estimatedTimeRemaining)
   - Render ValidationModeSelector
   - Render proxy pool status display
   - Render ETA and validation speed

3. `src/components/validation/results-table.tsx`
   - Add toggleable columns UI
   - Add filters (status, risk score)
   - Add sort by risk score
   - Add RiskScoreBadge
   - Add TypoWarning
   - Add batch actions

4. `src/components/validation/result-details.tsx`
   - Add enhanced information sections
   - Add risk factors panel
   - Add typo correction display

5. `src/App.tsx`
   - Add history and settings state
   - Add header buttons
   - Add history view
   - Add session details view
   - Add settings dialog
   - Update ValidationDashboard props

---

## Implementation Order

### Priority 1: Core Session Management (45 minutes)
1. Install xlsx dependency (2 min)
2. Create session-manager.ts (10 min)
3. Create session-history.tsx (15 min)
4. Create session-details.tsx (12 min)
5. Update use-email-validation.ts with session logic (8 min)

### Priority 2: Export & Intelligence (60 minutes)
6. Create enhanced-export-utils.ts (12 min)
7. Create risk-scorer.ts (8 min)
8. Create risk-score-badge.tsx (5 min)
9. Create typo-warning.tsx (8 min)
10. Update results-table.tsx with all enhancements (15 min)
11. Update result-details.tsx (12 min)

### Priority 3: Analytics & Settings (60 minutes)
12. Create domain-analysis.tsx (15 min)
13. Create statistics-dashboard.tsx (20 min)
14. Create validation-settings.tsx (8 min)
15. Create proxy-settings.tsx (10 min)
16. Create history-settings.tsx (5 min)
17. Create settings-panel.tsx (5 min)

### Priority 4: Integration (45 minutes)
18. Update validation-dashboard.tsx (8 min)
19. Update App.tsx with all new features (20 min)
20. Update main-layout.tsx (5 min)
21. Add desktop notifications (12 min)

### Priority 5: Testing (30 minutes)
22. Test session CRUD operations
23. Test export functionality (CSV and Excel)
24. Test risk scoring
25. Test typo detection
26. Test analytics components
27. Test settings persistence
28. Full integration testing

---

## Testing Strategy

### Unit Tests Required

**session-manager.test.ts:**
- createSession() creates valid session
- updateSessionProgress() updates session
- loadSession() returns correct session
- deleteSession() removes session
- cleanupOldSessions() removes old sessions
- generateSessionName() returns correct format

**enhanced-export-utils.test.ts:**
- exportToCSV() generates correct CSV format
- exportToExcel() generates correct Excel file
- Column filtering works correctly

**risk-scorer.test.ts:**
- calculateRiskScore() returns 0-100
- getRiskLevel() returns correct level
- getRiskColor() returns correct Tailwind classes
- Risk factors calculated correctly

**typo-database.test.ts:**
- suggestCorrection() detects common typos
- detectTypos() finds multiple typos
- Correction returns null for valid domains

### Integration Tests Required

**Session History Flow:**
1. Create session → appears in history list
2. View session details → shows results
3. Resume session → continues from last email
4. Delete session → removed from list

**Export Flow:**
1. Select columns → export includes only selected
2. Export CSV → file downloads correctly
3. Export Excel → file downloads correctly
4. Export all results → works correctly

**Risk Scoring Flow:**
1. Safe email → score 0-9
2. Risky email → score 30-59
3. Invalid email → score 80-100
4. Disposable email → +40 points
5. Role account → +15 points

**Analytics Flow:**
1. Domain analysis → shows correct statistics
2. Statistics dashboard → displays all metrics
3. Charts render correctly with recharts

---

## Final Notes

### Important Considerations

1. **Session Resume Logic:**
   - Continue from `currentIndex`
   - Re-validate only Unknown and Invalid results
   - Update session progress automatically

2. **Performance:**
   - Use useMemo for expensive calculations
   - Use useCallback for event handlers
   - Implement virtualization for large tables (future)

3. **Error Handling:**
   - Gracefully handle failed session loads
   - Show user-friendly error messages
   - Provide retry mechanisms

4. **User Experience:**
   - Loading states for all async operations
   - Success feedback after save/export
   - Confirmation dialogs for destructive actions
   - Keyboard shortcuts (future enhancement)

5. **Data Integrity:**
   - Validate session JSON structure
   - Handle malformed JSON gracefully
   - Backup session data before overwrites

6. **Responsive Design:**
   - All components should work on mobile/tablet
   - Use Tailwind responsive classes
   - Test on multiple screen sizes

---

## Dependencies

### Required

```json
{
  "dependencies": {
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@types/xlsx": "^0.0.36"
  }
}
```

### Optional (Future)
- `@tauri-apps/plugin-notification` for desktop notifications

---

## Success Criteria

**Complete When:**
- ✅ All 17 new files created
- ✅ All 5 files updated correctly
- ✅ TypeScript compilation passes
- ✅ All tests pass (unit + integration)
- ✅ App builds without errors
- ✅ Session CRUD operations work end-to-end
- ✅ Export to CSV and Excel works
- ✅ Risk scoring displays correctly
- ✅ Typo detection and correction works
- ✅ Domain analysis shows correct statistics
- ✅ Settings panel opens and saves correctly
- ✅ History view lists and navigates sessions
- ✅ Session details view loads and displays correctly
- ✅ Validation dashboard integrates all new features

---

**Document Version:** 1.0
**Created:** January 4, 2025
**Status:** Ready for Implementation
