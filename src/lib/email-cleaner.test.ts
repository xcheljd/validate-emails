import { describe, it, expect } from 'vitest';
import { cleanEmailList, toCanonical } from './email-cleaner';

// ============================================================
// VAL-DEDUP-001: Gmail dot removal
// ============================================================
describe('toCanonical - Gmail dot removal', () => {
  it('strips dots from Gmail local part', () => {
    expect(toCanonical('john.doe@gmail.com')).toBe('johndoe@gmail.com');
  });

  it('strips all dots from heavily dotted Gmail address', () => {
    expect(toCanonical('j.o.h.n@gmail.com')).toBe('john@gmail.com');
  });
});

// ============================================================
// VAL-DEDUP-002: Gmail plus alias stripping
// ============================================================
describe('toCanonical - Gmail plus stripping', () => {
  it('strips single plus alias', () => {
    expect(toCanonical('user+tag@gmail.com')).toBe('user@gmail.com');
  });

  it('strips multi-segment plus alias', () => {
    expect(toCanonical('user+promo+extra@gmail.com')).toBe('user@gmail.com');
  });
});

// ============================================================
// VAL-DEDUP-003: Gmail domain alias normalization
// ============================================================
describe('toCanonical - Gmail domain aliases', () => {
  it('normalizes googlemail.com to gmail.com', () => {
    expect(toCanonical('user@googlemail.com')).toBe('user@gmail.com');
  });

  it('normalizes googlemail.co.uk to gmail.com', () => {
    expect(toCanonical('user@googlemail.co.uk')).toBe('user@gmail.com');
  });
});

// ============================================================
// VAL-DEDUP-004: Gmail dot + plus combined
// ============================================================
describe('toCanonical - Gmail combined', () => {
  it('strips both dots and plus alias', () => {
    expect(toCanonical('john.doe+promo@gmail.com')).toBe('johndoe@gmail.com');
  });
});

// ============================================================
// VAL-DEDUP-005: Multiple Gmail originals collapse to one canonical
// ============================================================
describe('cleanEmailList - Gmail collapse', () => {
  it('collapses multiple Gmail equivalents into one', () => {
    const result = cleanEmailList([
      'john.doe@gmail.com',
      'johndoe@gmail.com',
      'johndoe+work@gmail.com',
    ]);
    expect(result.cleanedEmails).toHaveLength(1);
    expect(result.cleanedEmails).toContain('johndoe@gmail.com');
    expect(result.canonicalToOriginals.get('johndoe@gmail.com')).toEqual([
      'john.doe@gmail.com',
      'johndoe@gmail.com',
      'johndoe+work@gmail.com',
    ]);
  });
});

// ============================================================
// VAL-DEDUP-006: Outlook dots ARE significant
// ============================================================
describe('toCanonical - Outlook dots significant', () => {
  it('preserves dots in Outlook local part', () => {
    expect(toCanonical('john.doe@outlook.com')).toBe('john.doe@outlook.com');
  });

  it('does NOT collapse dotted vs non-dotted Outlook', () => {
    const result = cleanEmailList([
      'john.doe@outlook.com',
      'johndoe@outlook.com',
    ]);
    expect(result.cleanedEmails).toHaveLength(2);
    expect(result.cleanedEmails).toContain('john.doe@outlook.com');
    expect(result.cleanedEmails).toContain('johndoe@outlook.com');
  });
});

// ============================================================
// VAL-DEDUP-007: Outlook plus alias stripping
// ============================================================
describe('toCanonical - Outlook plus stripping', () => {
  it('strips plus from outlook.com', () => {
    expect(toCanonical('user+tag@outlook.com')).toBe('user@outlook.com');
  });

  it('strips plus from hotmail.com', () => {
    expect(toCanonical('user+tag@hotmail.com')).toBe('user@hotmail.com');
  });

  it('strips plus from live.com', () => {
    expect(toCanonical('user+tag@live.com')).toBe('user@live.com');
  });

  it('strips plus from msn.com', () => {
    expect(toCanonical('user+tag@msn.com')).toBe('user@msn.com');
  });
});

// ============================================================
// VAL-DEDUP-008: Hotmail NOT collapsed to outlook.com
// ============================================================
describe('toCanonical - Hotmail NOT aliased to Outlook', () => {
  it('keeps hotmail.com separate from outlook.com', () => {
    const result = cleanEmailList([
      'user@hotmail.com',
      'user@outlook.com',
    ]);
    expect(result.cleanedEmails).toHaveLength(2);
    expect(result.cleanedEmails).toContain('user@hotmail.com');
    expect(result.cleanedEmails).toContain('user@outlook.com');
  });

  it('canonical for hotmail stays as hotmail.com', () => {
    expect(toCanonical('user@hotmail.com')).toBe('user@hotmail.com');
  });
});

// ============================================================
// VAL-DEDUP-009: Yahoo plus NOT stripped
// ============================================================
describe('toCanonical - Yahoo plus preserved', () => {
  it('preserves plus alias in Yahoo', () => {
    expect(toCanonical('user+tag@yahoo.com')).toBe('user+tag@yahoo.com');
  });
});

// ============================================================
// VAL-DEDUP-010: Yahoo different TLDs are different canonicals
// ============================================================
describe('toCanonical - Yahoo TLDs', () => {
  it('treats yahoo.com and yahoo.co.uk as different', () => {
    const result = cleanEmailList([
      'user@yahoo.com',
      'user@yahoo.co.uk',
    ]);
    expect(result.cleanedEmails).toHaveLength(2);
  });

  it('keeps yahoo.com canonical distinct from yahoo.co.uk', () => {
    expect(toCanonical('user@yahoo.com')).toBe('user@yahoo.com');
    expect(toCanonical('user@yahoo.co.uk')).toBe('user@yahoo.co.uk');
  });
});

// ============================================================
// VAL-DEDUP-011: iCloud domain alias normalization
// ============================================================
describe('toCanonical - iCloud aliases', () => {
  it('normalizes me.com to icloud.com', () => {
    expect(toCanonical('user@me.com')).toBe('user@icloud.com');
  });

  it('normalizes mac.com to icloud.com', () => {
    expect(toCanonical('user@mac.com')).toBe('user@icloud.com');
  });

  it('strips plus alias from iCloud', () => {
    expect(toCanonical('user+tag@icloud.com')).toBe('user@icloud.com');
  });

  it('normalizes me.com with plus to icloud.com without plus', () => {
    expect(toCanonical('user+photos@me.com')).toBe('user@icloud.com');
  });
});

// ============================================================
// VAL-DEDUP-012: Additional providers strip plus, preserve dots
// ============================================================
describe('toCanonical - Additional providers', () => {
  it('AOL strips plus', () => {
    expect(toCanonical('user+tag@aol.com')).toBe('user@aol.com');
  });

  it('ProtonMail strips plus', () => {
    expect(toCanonical('user+tag@protonmail.com')).toBe('user@protonmail.com');
  });

  it('pm.me aliased to protonmail.com', () => {
    expect(toCanonical('user@pm.me')).toBe('user@protonmail.com');
  });

  it('proton.me aliased to protonmail.com', () => {
    expect(toCanonical('user@proton.me')).toBe('user@protonmail.com');
  });

  it('Zoho strips plus', () => {
    expect(toCanonical('user+tag@zoho.com')).toBe('user@zoho.com');
  });

  it('Fastmail strips plus', () => {
    expect(toCanonical('user+tag@fastmail.com')).toBe('user@fastmail.com');
  });

  it('GMX strips plus', () => {
    expect(toCanonical('user+tag@gmx.com')).toBe('user@gmx.com');
  });

  it('Tutanota does NOT strip plus', () => {
    expect(toCanonical('user+tag@tutanota.com')).toBe('user+tag@tutanota.com');
  });

  it('preserves dots for non-Gmail providers', () => {
    expect(toCanonical('john.doe@aol.com')).toBe('john.doe@aol.com');
    expect(toCanonical('john.doe@protonmail.com')).toBe('john.doe@protonmail.com');
  });
});

// ============================================================
// VAL-DEDUP-013: Unknown domains - conservative defaults
// ============================================================
describe('toCanonical - Unknown domains', () => {
  it('preserves dots for unknown domains', () => {
    expect(toCanonical('john.doe@mycompany.com')).toBe(
      'john.doe@mycompany.com'
    );
  });

  it('strips plus for unknown domains', () => {
    expect(toCanonical('user+tag@mycompany.com')).toBe('user@mycompany.com');
  });

  it('does not alias unknown domains', () => {
    expect(toCanonical('user@mycompany.com')).toBe('user@mycompany.com');
  });

  it('treats dotted and non-dotted unknown domain as different', () => {
    const result = cleanEmailList([
      'john.doe@mycompany.com',
      'johndoe@mycompany.com',
    ]);
    expect(result.cleanedEmails).toHaveLength(2);
  });
});

// ============================================================
// VAL-DEDUP-014: Syntax fix - trailing dots
// ============================================================
describe('cleanEmailList - Syntax: trailing dots', () => {
  it('removes trailing dot in local part', () => {
    const result = cleanEmailList(['john.@gmail.com']);
    expect(result.cleanedEmails).toContain('john@gmail.com');
    const action = result.actions.find(
      (a) => a.type === 'syntax_fix' && a.original === 'john.@gmail.com'
    );
    expect(action).toBeDefined();
  });

  it('removes trailing dot in domain', () => {
    const result = cleanEmailList(['john@gmail.com.']);
    expect(result.cleanedEmails).toContain('john@gmail.com');
    const action = result.actions.find(
      (a) => a.type === 'syntax_fix' && a.original === 'john@gmail.com.'
    );
    expect(action).toBeDefined();
  });
});

// ============================================================
// VAL-DEDUP-015: Syntax fix - consecutive dots
// ============================================================
describe('cleanEmailList - Syntax: consecutive dots', () => {
  it('replaces consecutive dots with single dot', () => {
    const result = cleanEmailList(['john..doe@gmail.com']);
    // Gmail canonical strips dots, so canonical is johndoe@gmail.com
    expect(result.cleanedEmails).toContain('johndoe@gmail.com');
    const action = result.actions.find(
      (a) => a.type === 'syntax_fix' && a.original === 'john..doe@gmail.com'
    );
    expect(action).toBeDefined();
  });
});

// ============================================================
// VAL-DEDUP-016: Syntax fix - angle brackets
// ============================================================
describe('cleanEmailList - Syntax: angle brackets', () => {
  it('removes angle brackets', () => {
    const result = cleanEmailList(['<john@gmail.com>']);
    expect(result.cleanedEmails).toContain('john@gmail.com');
    const action = result.actions.find(
      (a) => a.type === 'syntax_fix' && a.original === '<john@gmail.com>'
    );
    expect(action).toBeDefined();
  });
});

// ============================================================
// VAL-DEDUP-017: Syntax fix - quoted local part
// ============================================================
describe('cleanEmailList - Syntax: quoted local part', () => {
  it('removes quotes around local part', () => {
    const result = cleanEmailList(['"john.doe"@gmail.com']);
    // Gmail canonical strips dots, so canonical is johndoe@gmail.com
    expect(result.cleanedEmails).toContain('johndoe@gmail.com');
    const action = result.actions.find(
      (a) =>
        a.type === 'syntax_fix' && a.original === '"john.doe"@gmail.com'
    );
    expect(action).toBeDefined();
  });
});

// ============================================================
// VAL-DEDUP-018: Syntax fix - whitespace trimming
// ============================================================
describe('cleanEmailList - Syntax: whitespace', () => {
  it('trims leading and trailing whitespace', () => {
    const result = cleanEmailList(['  john@gmail.com  ']);
    expect(result.cleanedEmails).toContain('john@gmail.com');
    const action = result.actions.find(
      (a) => a.type === 'syntax_fix' && a.original === '  john@gmail.com  '
    );
    expect(action).toBeDefined();
  });
});

// ============================================================
// VAL-DEDUP-019: Domain typo correction
// ============================================================
describe('cleanEmailList - Typo correction', () => {
  it('corrects gmail typo', () => {
    const result = cleanEmailList(['user@gmial.com']);
    expect(result.cleanedEmails).toContain('user@gmail.com');
    expect(result.typosCorrected).toBe(1);
    const action = result.actions.find((a) => a.type === 'typo_correction');
    expect(action).toBeDefined();
    expect(action!.original.toLowerCase()).toContain('gmial.com');
    expect(action!.corrected.toLowerCase()).toContain('gmail.com');
  });

  it('corrects yahoo typo', () => {
    const result = cleanEmailList(['user@yahooo.com']);
    expect(result.cleanedEmails).toContain('user@yahoo.com');
    expect(result.typosCorrected).toBe(1);
  });

  it('does NOT correct clean domains', () => {
    const result = cleanEmailList(['user@correct-domain.com']);
    expect(result.cleanedEmails).toContain('user@correct-domain.com');
    expect(result.typosCorrected).toBe(0);
  });

  it('does NOT correct valid gmail.com', () => {
    const result = cleanEmailList(['user@gmail.com']);
    expect(result.typosCorrected).toBe(0);
  });
});

// ============================================================
// VAL-DEDUP-020: Invalid email filtering
// ============================================================
describe('cleanEmailList - Invalid emails', () => {
  it('discards email with no @ sign', () => {
    const result = cleanEmailList(['notanemail']);
    expect(result.invalidDiscarded).toBe(1);
    expect(result.cleanedEmails).toHaveLength(0);
  });

  it('discards email with no TLD', () => {
    const result = cleanEmailList(['john@gmail']);
    expect(result.invalidDiscarded).toBe(1);
    expect(result.cleanedEmails).toHaveLength(0);
  });

  it('discards empty string', () => {
    const result = cleanEmailList(['']);
    expect(result.invalidDiscarded).toBe(1);
  });

  it('discards whitespace-only string', () => {
    const result = cleanEmailList(['   ']);
    expect(result.invalidDiscarded).toBe(1);
  });

  it('counts multiple invalid emails correctly', () => {
    const result = cleanEmailList([
      'notanemail',
      'john@gmail',
      '',
      '   ',
      'valid@gmail.com',
    ]);
    expect(result.invalidDiscarded).toBe(4);
    expect(result.cleanedEmails).toHaveLength(1);
  });
});

// ============================================================
// VAL-DEDUP-021: Full pipeline - mixed list
// ============================================================
describe('cleanEmailList - Full pipeline', () => {
  it('produces correct stats for mixed input', () => {
    const input = [
      'john.doe@gmail.com',       // will be normalized to johndoe@gmail.com
      'johndoe@gmail.com',        // normalized duplicate of above
      'john.doe@gmail.com',       // exact duplicate of first
      'user+tag@outlook.com',     // plus stripped
      'user@outlook.com',         // normalized duplicate of above
      'test@yahooo.com',          // typo corrected to yahoo.com
      'user@gmial.com',           // typo corrected to gmail.com -> user@gmail.com canonical
      '<wrapped@gmail.com>',      // syntax fix (angle brackets)
      'notanemail',               // invalid
      'another@custom.org',       // valid unknown domain
    ];

    const result = cleanEmailList(input);

    expect(result.originalCount).toBe(10);
    expect(result.invalidDiscarded).toBe(1);
    expect(result.typosCorrected).toBe(2);
    expect(result.syntaxFixes).toBeGreaterThanOrEqual(1);
    expect(result.finalCount).toBeGreaterThan(0);
    expect(result.actions.length).toBeGreaterThan(0);

    // Verify canonicalToOriginals has entries
    expect(result.canonicalToOriginals.size).toBe(result.finalCount);
  });
});

// ============================================================
// VAL-DEDUP-022: Edge case - unicode local part
// ============================================================
describe('cleanEmailList - Unicode local part', () => {
  it('preserves unicode characters', () => {
    const result = cleanEmailList(['José@gmail.com']);
    expect(result.cleanedEmails).toHaveLength(1);
    expect(result.cleanedEmails[0]).toBe('josé@gmail.com');
    expect(result.invalidDiscarded).toBe(0);
  });
});

// ============================================================
// VAL-DEDUP-023: Edge case - punycode domain
// ============================================================
describe('cleanEmailList - Punycode domain', () => {
  it('passes punycode domain through unchanged', () => {
    const result = cleanEmailList(['user@xn--e1afmapc.com']);
    expect(result.cleanedEmails).toHaveLength(1);
    expect(result.cleanedEmails[0]).toBe('user@xn--e1afmapc.com');
  });
});

// ============================================================
// VAL-DEDUP-024: Edge case - very long local part
// ============================================================
describe('cleanEmailList - Long local part', () => {
  it('processes 70-character local part normally', () => {
    const longLocal = 'a'.repeat(70);
    const email = `${longLocal}@gmail.com`;
    const result = cleanEmailList([email]);
    expect(result.cleanedEmails).toHaveLength(1);
    expect(result.cleanedEmails[0]).toBe(`${longLocal}@gmail.com`);
  });
});

// ============================================================
// VAL-DEDUP-025: Edge case - multiple @ signs
// ============================================================
describe('cleanEmailList - Multiple @ signs', () => {
  it('discards email with multiple @ signs', () => {
    const result = cleanEmailList(['user@domain@gmail.com']);
    expect(result.invalidDiscarded).toBe(1);
    expect(result.cleanedEmails).toHaveLength(0);
  });
});

// ============================================================
// VAL-DEDUP-026: Actions array capped at 500
// ============================================================
describe('cleanEmailList - Actions cap', () => {
  it('caps actions array at 500 entries', () => {
    // Generate 600 emails that will each produce at least one action (syntax fix)
    const emails: string[] = [];
    for (let i = 0; i < 600; i++) {
      // Use trailing dot to generate syntax_fix action
      emails.push(`user${i}.@gmail.com`);
    }
    const result = cleanEmailList(emails);
    expect(result.actions.length).toBeLessThanOrEqual(500);
  });
});

// ============================================================
// VAL-DEDUP-027: Empty input returns zero counts
// ============================================================
describe('cleanEmailList - Empty input', () => {
  it('returns zero counts for empty array', () => {
    const result = cleanEmailList([]);
    expect(result.originalCount).toBe(0);
    expect(result.finalCount).toBe(0);
    expect(result.exactDuplicatesRemoved).toBe(0);
    expect(result.normalizedDuplicatesRemoved).toBe(0);
    expect(result.typosCorrected).toBe(0);
    expect(result.syntaxFixes).toBe(0);
    expect(result.invalidDiscarded).toBe(0);
    expect(result.cleanedEmails).toHaveLength(0);
    expect(result.actions).toHaveLength(0);
    expect(result.canonicalToOriginals.size).toBe(0);
  });
});
