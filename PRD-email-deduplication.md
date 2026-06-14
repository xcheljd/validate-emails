# PRD: Email List Deduplication & Pre-Cleaning

## Document Meta
- **Feature ID**: FEAT-004
- **Status**: Ready for Implementation
- **Priority**: P1 (High — saves validation credits, improves accuracy, reduces waste)
- **Estimated Scope**: ~800–1000 lines new code, ~200 lines modified existing code
- **Dependencies**: None (purely frontend/TypeScript, no Rust changes)

---

## 1. Problem Statement

When users upload email lists, they frequently contain:
- **Exact duplicates** (same email pasted multiple times)
- **Equivalent emails** that resolve to the same inbox (e.g., `john.doe@gmail.com` = `johndoe@gmail.com`, `user+tag@outlook.com` = `user@outlook.com`)
- **Syntax errors** (trailing dots, spaces inside address, malformed TLDs)
- **Domain typos** (e.g., `gmial.com` → `gmail.com` — the existing `typo-database.ts` handles this but is not integrated into the upload flow)

Currently, `handleEmailsLoaded` in `App.tsx` only does a basic `new Set()` dedup on **exact string matches**. The `parseEmails()` function only splits and applies a loose regex. This means:
- Users waste SMTP connections validating the same inbox multiple times
- Results are cluttered with duplicates
- Typo corrections from `typo-database.ts` are never applied during input
- Export data has redundant rows

---

## 2. Goals

1. **Normalize** every incoming email to a canonical form using provider-specific rules
2. **Deduplicate** by canonical form, collapsing all originals under one representative
3. **Clean** obvious syntax issues before validation begins
4. **Report** a detailed cleaning summary so the user can review and confirm before validation
5. **Preserve original emails** in export output — each validated result maps back to every original that collapsed into it

---

## 3. User Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Upload /    │────▶│  Email Cleaner   │────▶│  Cleaning       │────▶│  Start           │
│  Paste       │     │  (automatic)     │     │  Report         │     │  Validation      │
│  Emails      │     │                  │     │  (user reviews  │     │  (on clean list) │
│              │     │                  │     │   & confirms)   │     │                  │
└─────────────┘     └──────────────────┘     └─────────────────┘     └──────────────────┘
```

**Detailed steps:**
1. User uploads CSV/TXT or pastes emails into `EmailInput` (unchanged)
2. `onEmailsLoaded(rawEmails)` fires as before
3. `App.tsx` passes raw emails through `cleanEmailList()` → gets `CleaningResult`
4. `App.tsx` stores `cleaningResult` in new state
5. User sees **Cleaning Report** screen (new component) showing:
   - Original count → Cleaned count
   - Breakdown: duplicates removed, typos corrected, syntax-fixed, invalid discarded
   - Expandable lists for each category
   - "Proceed with X emails" button / "Go Back" button
6. On confirm, cleaned canonical emails proceed to `ValidationConfig` and then validation
7. During export, each result row includes an `Original Emails` column listing all originals that mapped to that canonical email

---

## 4. Technical Specification

### 4.1 New File: `src/lib/email-cleaner.ts`

This is the core logic module. **No UI, no React — pure functions.**

#### Types

```typescript
/**
 * Represents one cleaning operation applied to an email.
 */
export interface CleaningAction {
  type: 'syntax_fix' | 'typo_correction' | 'normalization';
  original: string;
  corrected: string;
  description: string;
}

/**
 * Result of cleaning a full email list.
 */
export interface CleaningResult {
  /** The deduplicated, cleaned list of canonical emails */
  cleanedEmails: string[];
  /** Total emails received as input */
  originalCount: number;
  /** Exact string duplicates removed (after trim + lowercase) */
  exactDuplicatesRemoved: number;
  /** Emails that were equivalent after normalization (e.g., dots in Gmail) */
  normalizedDuplicatesRemoved: number;
  /** Domain typos corrected */
  typosCorrected: number;
  /** Syntax issues that were auto-fixed */
  syntaxFixes: number;
  /** Emails discarded as unparseable/invalid */
  invalidDiscarded: number;
  /** Final count after cleaning */
  finalCount: number;
  /** Detailed actions for reporting (limit to first 500 for memory) */
  actions: CleaningAction[];
  /**
   * Map from canonical email → array of original emails that collapsed into it.
   * Used for export mapping.
   */
  canonicalToOriginals: Map<string, string[]>;
}
```

#### Provider-Specific Normalization Rules

These rules determine what counts as "the same inbox." This is critical — applying wrong rules (e.g., stripping dots from Outlook) would create false duplicates.

```typescript
interface ProviderRule {
  /** Domains this rule applies to (exact match after lowering) */
  domains: string[];
  /** Whether dots in the local part are insignificant (ignored by the provider) */
  dotsInsensitive: boolean;
  /** Whether plus-addressing (user+tag) is supported and should be stripped */
  stripPlusAliases: boolean;
  /** Whether subdomain addressing (user@subdomain.domain) maps to main domain */
  normalizeSubdomains: boolean;
}
```

**The provider rules table:**

| Provider | Domains | Dots Insensitive | Strip Plus | Subdomain Normalization |
|----------|---------|-------------------|------------|------------------------|
| Gmail | `gmail.com`, `googlemail.com`, `googlemail.co.uk` | Yes | Yes | No |
| Outlook/Hotmail | `outlook.com`, `hotmail.com`, `hotmail.co.uk`, `hotmail.fr`, `live.com`, `live.co.uk`, `live.fr`, `msn.com` | No | Yes | No |
| Yahoo | `yahoo.com`, `yahoo.co.uk`, `yahoo.fr`, `yahoo.de`, `yahoo.co.in`, `ymail.com`, `rocketmail.com` | No | No (Yahoo ignores plus) | No |
| iCloud | `icloud.com`, `me.com`, `mac.com` | No | Yes | No |
| AOL | `aol.com`, `aol.co.uk` | No | Yes | No |
| ProtonMail | `protonmail.com`, `proton.me`, `pm.me` | No | Yes | No |
| Zoho | `zoho.com` | No | Yes | No |
| Fastmail | `fastmail.com`, `fastmail.fm` | No | Yes | No |
| GMX | `gmx.com`, `gmx.net`, `gmx.de`, `gmx.co.uk` | No | Yes | No |
| Tutanota | `tutanota.com`, `tutanota.de`, `tutamail.com` | No | No | No |

> **Important**: For any domain NOT in this table, apply **conservative defaults**: dots ARE significant, plus-aliases ARE stripped (safer assumption — most providers support plus addressing). Do NOT treat unknown domains as equivalent.

#### Domain Alias Normalization

Some providers accept mail at multiple domain aliases that all route to the same inbox:

| Primary Domain | Aliases (normalize TO primary) |
|---------------|-------------------------------|
| `gmail.com` | `googlemail.com`, `googlemail.co.uk` |
| `icloud.com` | `me.com`, `mac.com` |

When an alias is found, replace it with the primary domain BEFORE checking dedup.

#### Canonical Form Algorithm

```typescript
function toCanonical(email: string): string {
  // 1. Trim whitespace
  email = email.trim();

  // 2. Lowercase the entire address
  email = email.toLowerCase();

  // 3. Apply domain alias normalization
  //    e.g., user@googlemail.com → user@gmail.com
  email = normalizeDomainAlias(email);

  // 4. Apply provider-specific local-part rules
  const [localPart, domain] = email.split('@');
  const rule = getProviderRule(domain);

  let normalizedLocal = localPart;
  if (rule.stripPlusAliases) {
    // Remove everything from '+' to '@'
    normalizedLocal = normalizedLocal.replace(/\+.*$/, '');
  }
  if (rule.dotsInsensitive) {
    // Remove all dots from local part (Gmail only)
    normalizedLocal = normalizedLocal.replace(/\./g, '');
  }

  return `${normalizedLocal}@${domain}`;
}
```

#### Syntax Cleaning (Pre-Normalization)

Before normalization, apply these syntax fixes. Each fix generates a `CleaningAction`:

1. **Trailing/leading dots** in local or domain: `john.@gmail.com` → `john@gmail.com`
2. **Consecutive dots**: `john..doe@gmail.com` → `john.doe@gmail.com`
3. **Trailing whitespace inside email**: `john@gmail.com ` → `john@gmail.com`
4. **Mixed case**: `John@Gmail.com` → `john@gmail.com` (handled by toLowerCase)
5. **Remove quotes around local part** (rare but valid RFC): `"john.doe"@gmail.com` → `john.doe@gmail.com`
6. **Remove angle brackets**: `<john@gmail.com>` → `john@gmail.com`

After syntax fixes, run a basic validity check. Emails that still fail `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` are discarded as invalid.

#### Main Function Signature

```typescript
/**
 * Cleans and deduplicates an email list.
 *
 * @param rawEmails - Raw email strings from upload/paste
 * @returns CleaningResult with cleaned emails, stats, and mapping
 */
export function cleanEmailList(rawEmails: string[]): CleaningResult;
```

**Algorithm:**
1. For each raw email:
   a. Apply syntax fixes → record action if changed
   b. Validate basic syntax → discard if invalid, record action
   c. Apply typo correction (using existing `suggestCorrection` from `typo-database.ts`) → record action if corrected
   d. Compute canonical form via `toCanonical()`
2. Group emails by canonical form
3. For groups with >1 original: record normalization actions, keep first-encountered as representative
4. Build `canonicalToOriginals` map
5. Return `CleaningResult`

### 4.2 New File: `src/lib/email-cleaner.test.ts`

Comprehensive test suite. **Tests must be written before or alongside implementation.**

#### Test Categories

**A. Syntax Fixes**
- Trailing dot in local part: `john.@gmail.com` → cleaned to `john@gmail.com`
- Consecutive dots: `john..doe@gmail.com` → cleaned to `john.doe@gmail.com`
- Angle brackets: `<john@gmail.com>` → `john@gmail.com`
- Quoted local part: `"john.doe"@gmail.com` → `john.doe@gmail.com`
- Whitespace padding: `  john@gmail.com  ` → `john@gmail.com`
- Invalid (no @ sign): `notanemail` → discarded
- Invalid (no TLD): `john@gmail` → discarded
- Valid email passes through unchanged

**B. Typo Corrections**
- `user@gmial.com` → corrected to `user@gmail.com`
- `user@yahooo.com` → corrected to `user@yahoo.com`
- `user@correct-domain.com` → no correction applied

**C. Gmail-Specific Rules**
- Dot removal: `john.doe@gmail.com` canonical → `johndoe@gmail.com`
- Plus alias: `user+tag@gmail.com` canonical → `user@gmail.com`
- Both: `john.doe+promo@gmail.com` canonical → `johndoe@gmail.com`
- Domain alias: `user@googlemail.com` canonical → `user@gmail.com`
- Multiple originals collapse: `john.doe@gmail.com`, `johndoe@gmail.com`, `johndoe+work@gmail.com` all → same canonical

**D. Outlook-Specific Rules**
- Dots ARE significant: `john.doe@outlook.com` ≠ `johndoe@outlook.com` (NOT collapsed)
- Plus alias stripped: `user+tag@outlook.com` canonical → `user@outlook.com`
- Hotmail alias: `user@hotmail.com` stays as `user@hotmail.com` (no domain collapse for outlook↔hotmail — they ARE different inboxes)

**E. Yahoo-Specific Rules**
- Dots ARE significant
- Plus NOT stripped: `user+tag@yahoo.com` canonical → `user+tag@yahoo.com` (Yahoo ignores plus in delivery but treating as different is safer)
- Different Yahoo TLDs are different: `user@yahoo.com` ≠ `user@yahoo.co.uk`

**F. iCloud-Specific Rules**
- `user@me.com` canonical → `user@icloud.com` (domain alias)
- `user@mac.com` canonical → `user@icloud.com`
- Plus alias stripped: `user+tag@icloud.com` → `user@icloud.com`

**G. Unknown/Custom Domains**
- Dots are significant (conservative)
- Plus aliases ARE stripped (most providers support this)
- No domain alias normalization
- `user@mycompany.com` stays as `user@mycompany.com`

**H. Full Integration: cleanEmailList()**
- Mixed list with duplicates, typos, syntax issues, and equivalent emails
- Verify `originalCount`, `finalCount`, all stat counters
- Verify `canonicalToOriginals` map correctness
- Verify `actions` array has correct types and descriptions
- Empty input → empty result with zero counts
- Large input (1000+ emails) performance is reasonable
- Actions array is capped at 500 entries for memory safety

**I. Edge Cases**
- Email with unicode characters: `josé@gmail.com` → passes through (lowered)
- Punycode domain: `user@xn--e1afmapc.com` → passes through unchanged
- Very long local part (64+ chars) → still processed
- Multiple @ signs: `user@domain@gmail.com` → discarded as invalid
- IP address domain: `user@[192.168.1.1]` → passes through (valid RFC)
- Empty string → discarded
- Only whitespace → discarded

### 4.3 New Component: `src/components/validation/cleaning-report.tsx`

This component displays between email loading and validation config.

#### Props

```typescript
interface CleaningReportProps {
  result: CleaningResult;
  onProceed: () => void;
  onBack: () => void;
}
```

#### Layout (3-column grid on desktop, stacked on mobile)

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← Back to Upload                                Clear List        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─ Summary Cards ─────────────────────────────────────────────────┐ │
│  │                                                                  │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │ │
│  │  │  1,247   │  │   892    │  │    55     │  │    12    │       │ │
│  │  │ Original │  │ Clean    │  │ Duplicates│  │  Typos   │       │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │ │
│  │                                                                  │ │
│  │  ┌──────────┐  ┌──────────┐                                    │ │
│  │  │    18    │  │    23    │                                    │ │
│  │  │ Syntax   │  │ Invalid  │                                    │ │
│  │  │ Fixed    │  │ Removed  │                                    │ │
│  │  └──────────┘  └──────────┘                                    │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─ Details (expandable sections) ────────────────────────────────┐ │
│  │                                                                  │ │
│  │  ▼ Duplicates Removed (55)                                      │ │
│  │    john.doe@gmail.com ← johndoe@gmail.com                       │ │
│  │    john.doe@gmail.com ← john.doe+work@gmail.com                 │ │
│  │    user@outlook.com ← user@outlook.com (exact duplicate)        │ │
│  │    ...                                                           │ │
│  │                                                                  │ │
│  │  ▼ Typos Corrected (12)                                         │ │
│  │    user@gmial.com → user@gmail.com                              │ │
│  │    test@yahooo.com → test@yahoo.com                             │ │
│  │    ...                                                           │ │
│  │                                                                  │ │
│  │  ▶ Syntax Fixes (18)                                            │ │
│  │  ▶ Invalid & Discarded (23)                                     │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─ Action ───────────────────────────────────────────────────────┐ │
│  │                                                                  │ │
│  │  ┌─────────────────────────────────────────────────────────┐   │ │
│  │  │  Proceed with 892 Clean Emails                          │   │ │
│  │  └─────────────────────────────────────────────────────────┘   │ │
│  │                                                                  │ │
│  │  "285 emails were removed to improve accuracy and save time"     │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Component Requirements:**
- Use existing UI components: `Card`, `CardContent`, `CardHeader`, `CardTitle`, `Button`, `Badge`
- Use `Collapsible` from Radix for expandable sections
- Use `cn()` utility for conditional class merging
- Responsive: summary cards wrap on mobile, details stack vertically
- Animate counts on mount (optional, via CSS transitions)
- Follow Dayfox/Nordfox theme palettes
- Use Lucide icons: `AlertCircle` for invalid, `CheckCircle` for clean, `ArrowRight` for proceed, `ArrowLeft` for back

### 4.4 Modified File: `src/App.tsx`

#### Changes:

1. **Add state for cleaning result:**
   ```typescript
   const [cleaningResult, setCleaningResult] = useState<CleaningResult | null>(null);
   ```

2. **Replace current dedup in `handleEmailsLoaded`:**
   ```typescript
   // Before:
   const unique = [...new Set(emails.map(e => e.trim().toLowerCase()))];

   // After:
   const result = cleanEmailList(emails);
   setCleaningResult(result);
   // Don't proceed directly — show cleaning report first
   ```

3. **Add new app state:** `'cleaning_report'` between `'loaded'` and `'config'`
   - When state is `'cleaning_report'`, render `<CleaningReport>` component
   - `onProceed` sets emails from `cleaningResult.cleanedEmails` and transitions to `'config'`
   - `onBack` clears result and goes back to `'idle'`

### 4.5 Modified File: `src/lib/export-utils.ts`

#### Changes:

1. **Accept `canonicalToOriginals` map** as optional parameter in export function
2. **Add `Original Emails` column** to CSV/XLSX export when mapping is provided
3. For each exported result row, look up canonical email in map and join originals with `; ` separator

### 4.6 Integration with Existing Typo Database

The existing `src/lib/typo-database.ts` already has `suggestCorrection(domain: string): string | null`. This should be called during step 1c of the cleaning algorithm:

```typescript
import { suggestCorrection } from './typo-database';

// Inside cleanEmailList():
const [localPart, domain] = email.split('@');
const correction = suggestCorrection(domain);
if (correction) {
  const corrected = `${localPart}@${correction}`;
  actions.push({
    type: 'typo_correction',
    original: email,
    corrected,
    description: `Domain typo: ${domain} → ${correction}`,
  });
  email = corrected;
}
```

---

## 5. Acceptance Criteria

### Must Have (P1)
- [ ] `cleanEmailList()` correctly handles all provider-specific normalization rules
- [ ] Gmail dot-stripping, plus-alias stripping, and domain alias normalization work
- [ ] Outlook/Hotmail/Yahoo rules are correct (no false deduplication)
- [ ] Syntax cleaning fixes the 6 defined issues
- [ ] Typo corrections from existing database are applied
- [ ] `CleaningResult` stats are accurate
- [ ] `canonicalToOriginals` map is built correctly
- [ ] Cleaning Report component renders with summary cards and expandable details
- [ ] User can proceed or go back from cleaning report
- [ ] Export includes Original Emails column when dedup mapping exists
- [ ] Test suite covers all categories A–I with passing tests

### Should Have (P2)
- [ ] Animated count-up on summary cards
- [ ] "Download cleaning report" as standalone CSV
- [ ] Keyboard shortcut (Enter) to proceed from cleaning report

### Nice to Have (P3)
- [ ] Undo individual cleaning actions
- [ ] Provider-specific icons in cleaning report
- [ ] Estimated validation credits saved display

---

## 6. Out of Scope

- **MX record checking** during cleaning (would require async/Rust — out of scope for purely frontend feature)
- **SMTP-level dedup** (verifying two different addresses deliver to same inbox)
- **AI/ML-based typo correction** (stick with existing deterministic database)
- **Real-time cleaning as user types** (batch cleaning on submit is sufficient)

---

## 7. Performance Considerations

- **Actions array capped at 500 entries** to prevent memory issues with very large lists
- **`cleanEmailList()` should process 10,000 emails in under 500ms** (all synchronous string ops)
- **`canonicalToOriginals` Map** is used instead of plain object for O(1) lookups during export
- **No external dependencies** — all logic is pure TypeScript

---

## 8. Migration Path

1. Feature is **additive** — no breaking changes to existing validation flow
2. If `cleanEmailList` is not called (e.g., code not updated), behavior remains identical to current
3. `canonicalToOriginals` is optional in export — old export code works without it
4. Cleaning report is a new app state — existing states are untouched
