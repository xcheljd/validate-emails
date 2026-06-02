/**
 * Email Cleaner Module
 *
 * Core email normalization, deduplication, and cleaning pipeline.
 * Pure TypeScript functions — no React, no side effects.
 *
 * Provider-specific rules determine canonical form for dedup.
 * Syntax cleaning, typo correction, and invalid filtering run
 * before canonical form computation.
 */

import { suggestCorrection } from './typo-database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  /** Detailed actions for reporting (capped at first 500 for memory) */
  actions: CleaningAction[];
  /**
   * Map from canonical email → array of original emails that collapsed into it.
   * Used for export mapping.
   */
  canonicalToOriginals: Map<string, string[]>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ProviderRule {
  /** Whether dots in the local part are insignificant (Gmail only) */
  dotsInsensitive: boolean;
  /** Whether plus-addressing should be stripped */
  stripPlusAliases: boolean;
}

// ---------------------------------------------------------------------------
// Domain alias map (alias → primary domain)
// ---------------------------------------------------------------------------

const DOMAIN_ALIASES: Record<string, string> = {
  'googlemail.com': 'gmail.com',
  'googlemail.co.uk': 'gmail.com',
  'me.com': 'icloud.com',
  'mac.com': 'icloud.com',
  'pm.me': 'protonmail.com',
  'proton.me': 'protonmail.com',
};

// ---------------------------------------------------------------------------
// Provider rules lookup (domain → rule)
// ---------------------------------------------------------------------------

const PROVIDER_RULES: Record<string, ProviderRule> = {
  // Gmail family
  'gmail.com': { dotsInsensitive: true, stripPlusAliases: true },
  'googlemail.com': { dotsInsensitive: true, stripPlusAliases: true },
  'googlemail.co.uk': { dotsInsensitive: true, stripPlusAliases: true },

  // Outlook family (dots significant)
  'outlook.com': { dotsInsensitive: false, stripPlusAliases: true },
  'hotmail.com': { dotsInsensitive: false, stripPlusAliases: true },
  'hotmail.co.uk': { dotsInsensitive: false, stripPlusAliases: true },
  'hotmail.fr': { dotsInsensitive: false, stripPlusAliases: true },
  'live.com': { dotsInsensitive: false, stripPlusAliases: true },
  'live.co.uk': { dotsInsensitive: false, stripPlusAliases: true },
  'live.fr': { dotsInsensitive: false, stripPlusAliases: true },
  'msn.com': { dotsInsensitive: false, stripPlusAliases: true },

  // Yahoo family (plus NOT stripped)
  'yahoo.com': { dotsInsensitive: false, stripPlusAliases: false },
  'yahoo.co.uk': { dotsInsensitive: false, stripPlusAliases: false },
  'yahoo.fr': { dotsInsensitive: false, stripPlusAliases: false },
  'yahoo.de': { dotsInsensitive: false, stripPlusAliases: false },
  'yahoo.co.in': { dotsInsensitive: false, stripPlusAliases: false },
  'ymail.com': { dotsInsensitive: false, stripPlusAliases: false },
  'rocketmail.com': { dotsInsensitive: false, stripPlusAliases: false },

  // iCloud family
  'icloud.com': { dotsInsensitive: false, stripPlusAliases: true },
  'me.com': { dotsInsensitive: false, stripPlusAliases: true },
  'mac.com': { dotsInsensitive: false, stripPlusAliases: true },

  // AOL
  'aol.com': { dotsInsensitive: false, stripPlusAliases: true },
  'aol.co.uk': { dotsInsensitive: false, stripPlusAliases: true },

  // ProtonMail family
  'protonmail.com': { dotsInsensitive: false, stripPlusAliases: true },
  'proton.me': { dotsInsensitive: false, stripPlusAliases: true },
  'pm.me': { dotsInsensitive: false, stripPlusAliases: true },

  // Zoho
  'zoho.com': { dotsInsensitive: false, stripPlusAliases: true },

  // Fastmail
  'fastmail.com': { dotsInsensitive: false, stripPlusAliases: true },
  'fastmail.fm': { dotsInsensitive: false, stripPlusAliases: true },

  // GMX
  'gmx.com': { dotsInsensitive: false, stripPlusAliases: true },
  'gmx.net': { dotsInsensitive: false, stripPlusAliases: true },
  'gmx.de': { dotsInsensitive: false, stripPlusAliases: true },
  'gmx.co.uk': { dotsInsensitive: false, stripPlusAliases: true },

  // Tutanota (plus NOT stripped)
  'tutanota.com': { dotsInsensitive: false, stripPlusAliases: false },
  'tutanota.de': { dotsInsensitive: false, stripPlusAliases: false },
  'tutamail.com': { dotsInsensitive: false, stripPlusAliases: false },
};

/** Conservative default for unknown domains: dots significant, plus stripped */
const DEFAULT_RULE: ProviderRule = {
  dotsInsensitive: false,
  stripPlusAliases: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTIONS_CAP = 500;

/** Basic email validity: non-empty local@domain.tld with no spaces */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function getProviderRule(domain: string): ProviderRule {
  return PROVIDER_RULES[domain] ?? DEFAULT_RULE;
}

/**
 * Apply 6 syntax fixes to an email string.
 * Returns cleaned email and list of actions for each fix applied.
 */
function cleanSyntax(email: string): {
  cleaned: string;
  actions: CleaningAction[];
} {
  let cleaned = email;
  const actions: CleaningAction[] = [];

  const pushAction = (desc: string, before: string) => {
    actions.push({
      type: 'syntax_fix',
      original: before,
      corrected: cleaned,
      description: desc,
    });
  };

  // 1. Trim whitespace
  const trimmed = cleaned.trim();
  if (trimmed !== cleaned) {
    const before = cleaned;
    cleaned = trimmed;
    pushAction('Whitespace trimmed', before);
  }

  // 2. Remove angle brackets
  if (cleaned.startsWith('<') || cleaned.endsWith('>')) {
    const before = cleaned;
    cleaned = cleaned.replace(/^<|>$/g, '');
    pushAction('Angle brackets removed', before);
  }

  // 3. Remove quotes around local part (e.g., "john.doe"@domain)
  const quotedMatch = cleaned.match(/^"([^"]+)"(@.+)$/);
  if (quotedMatch) {
    const before = cleaned;
    cleaned = quotedMatch[1] + quotedMatch[2];
    pushAction('Quoted local part unquoted', before);
  }

  // 4. Fix consecutive dots in local part
  const atIdx = cleaned.indexOf('@');
  if (atIdx > 0) {
    const local = cleaned.slice(0, atIdx);
    const domain = cleaned.slice(atIdx);
    if (local.includes('..')) {
      const before = cleaned;
      const fixedLocal = local.replace(/\.{2,}/g, '.');
      cleaned = fixedLocal + domain;
      pushAction('Consecutive dots fixed', before);
    }
  }

  // 5. Remove trailing dots from local part
  const atIdx2 = cleaned.indexOf('@');
  if (atIdx2 > 0) {
    const local = cleaned.slice(0, atIdx2);
    const domain = cleaned.slice(atIdx2);
    if (local.endsWith('.')) {
      const before = cleaned;
      const fixedLocal = local.replace(/\.+$/, '');
      cleaned = fixedLocal + domain;
      pushAction('Trailing dot removed from local part', before);
    }
  }

  // 6. Remove trailing dot from domain
  if (cleaned.endsWith('.')) {
    const before = cleaned;
    cleaned = cleaned.replace(/\.+$/, '');
    pushAction('Trailing dot removed from domain', before);
  }

  return { cleaned, actions };
}

/**
 * Check if an email has valid syntax after cleaning.
 */
function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Compute the canonical form of an email address.
 *
 * Steps:
 * 1. Trim whitespace
 * 2. Lowercase
 * 3. Normalize domain alias
 * 4. Apply provider-specific local-part rules (plus stripping, dot removal)
 */
export function toCanonical(email: string): string {
  // 1. Trim
  let cleaned = email.trim();

  // 2. Lowercase
  cleaned = cleaned.toLowerCase();

  // 3. Split into local + domain
  const atIdx = cleaned.indexOf('@');
  if (atIdx < 0) return cleaned; // shouldn't happen after validation

  let local = cleaned.slice(0, atIdx);
  let domain = cleaned.slice(atIdx + 1);

  // 4. Domain alias normalization
  if (DOMAIN_ALIASES[domain]) {
    domain = DOMAIN_ALIASES[domain];
  }

  // 5. Provider-specific rules
  const rule = getProviderRule(domain);

  if (rule.stripPlusAliases) {
    local = local.replace(/\+.*$/, '');
  }
  if (rule.dotsInsensitive) {
    local = local.replace(/\./g, '');
  }

  return `${local}@${domain}`;
}

/**
 * Clean and deduplicate an email list.
 *
 * @param rawEmails - Raw email strings from upload/paste
 * @returns CleaningResult with cleaned emails, stats, and mapping
 */
export function cleanEmailList(rawEmails: string[]): CleaningResult {
  const result: CleaningResult = {
    cleanedEmails: [],
    originalCount: rawEmails.length,
    exactDuplicatesRemoved: 0,
    normalizedDuplicatesRemoved: 0,
    typosCorrected: 0,
    syntaxFixes: 0,
    invalidDiscarded: 0,
    finalCount: 0,
    actions: [],
    canonicalToOriginals: new Map(),
  };

  if (rawEmails.length === 0) return result;

  const allActions: CleaningAction[] = [];

  // Phase 1: Process each email individually
  interface ProcessedEmail {
    original: string;
    cleaned: string; // after syntax fix + typo correction + lowercase
    canonical: string;
    perActions: CleaningAction[];
  }

  const processed: ProcessedEmail[] = [];

  for (const raw of rawEmails) {
    // a. Syntax fixes
    const { cleaned: syntaxCleaned, actions: syntaxActions } =
      cleanSyntax(raw);
    let email = syntaxCleaned;

    // b. Validate
    if (!isValidEmail(email)) {
      result.invalidDiscarded++;
      continue;
    }

    // Track syntax fixes
    if (syntaxActions.length > 0) {
      result.syntaxFixes += syntaxActions.length;
    }

    // c. Lowercase for further processing
    email = email.toLowerCase();

    // d. Typo correction
    const correction = suggestCorrection(email);
    let typoAction: CleaningAction | null = null;
    if (correction !== null && correction !== email) {
      typoAction = {
        type: 'typo_correction',
        original: email,
        corrected: correction,
        description: `Domain typo corrected: ${email.split('@')[1]} → ${correction.split('@')[1]}`,
      };
      email = correction;
      result.typosCorrected++;
    }

    // e. Compute canonical form
    const canonical = toCanonical(email);

    const perActions = [...syntaxActions];
    if (typoAction) perActions.push(typoAction);

    processed.push({ original: raw, cleaned: email, canonical, perActions });
  }

  // Phase 2: Dedup — track exact and normalized duplicates
  const seenExact = new Set<string>();
  const canonicalGroups = new Map<
    string,
    { cleaned: string; originals: string[] }
  >();

  for (const p of processed) {
    if (canonicalGroups.has(p.canonical)) {
      const group = canonicalGroups.get(p.canonical)!;

      if (seenExact.has(p.cleaned)) {
        // Exact duplicate (same cleaned string seen before)
        result.exactDuplicatesRemoved++;
      } else {
        // Normalized duplicate (different cleaned string, same canonical)
        result.normalizedDuplicatesRemoved++;
      }
      seenExact.add(p.cleaned);
      group.originals.push(p.original);
    } else {
      seenExact.add(p.cleaned);
      canonicalGroups.set(p.canonical, {
        cleaned: p.cleaned,
        originals: [p.original],
      });
    }

    // Collect per-email actions
    allActions.push(...p.perActions);
  }

  // Build outputs
  result.cleanedEmails = [...canonicalGroups.keys()];
  result.finalCount = result.cleanedEmails.length;

  for (const [canonical, group] of canonicalGroups) {
    result.canonicalToOriginals.set(canonical, group.originals);
  }

  // Cap actions at 500
  result.actions = allActions.slice(0, ACTIONS_CAP);

  return result;
}
