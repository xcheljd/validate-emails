import { describe, it, expect } from 'vitest';
import { computeSessionDiff } from './session-diff';
import type { ValidationSession } from './session-manager';

function createMockSession(
  overrides: Partial<ValidationSession> = {}
): ValidationSession {
  return {
    id: 'test-session',
    name: 'Test Session',
    emails: [],
    results: [],
    status: 'completed',
    currentIndex: 0,
    total: 0,
    createdAt: new Date().toISOString(),
    settings: { validationMode: 'standard' },
    ...overrides,
  };
}

function createMockResult(email: string, result: 'Safe' | 'Risky' | 'Invalid' | 'Unknown') {
  return {
    email,
    result,
    reason: `Test reason for ${email}`,
    logs: [],
    domain: email.split('@')[1] || 'test.com',
    validationDuration: 100,
    mxRecordCount: 1,
    isDisposable: false,
    isRoleAccount: false,
    isCatchAll: false,
    isDeliverable: result === 'Safe',
    isDisabled: false,
    hasFullInbox: false,
    canConnectSmtp: true,
    acceptsMail: true,
    isValidSyntax: true,
    isB2c: false,
    timestamp: new Date().toISOString(),
    validationMode: 'standard' as const,
    riskScore: 0,
  };
}

describe('computeSessionDiff', () => {
  it('identifies added emails', () => {
    const sessionA = createMockSession({
      results: [createMockResult('a@test.com', 'Safe')],
    });
    const sessionB = createMockSession({
      results: [
        createMockResult('a@test.com', 'Safe'),
        createMockResult('b@test.com', 'Safe'),
      ],
    });

    const diff = computeSessionDiff(sessionA, sessionB);

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].email).toBe('b@test.com');
    expect(diff.added[0].result).toBe('Safe');
  });

  it('identifies removed emails', () => {
    const sessionA = createMockSession({
      results: [
        createMockResult('a@test.com', 'Safe'),
        createMockResult('b@test.com', 'Invalid'),
      ],
    });
    const sessionB = createMockSession({
      results: [createMockResult('a@test.com', 'Safe')],
    });

    const diff = computeSessionDiff(sessionA, sessionB);

    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].email).toBe('b@test.com');
    expect(diff.removed[0].result).toBe('Invalid');
  });

  it('identifies changed verdicts', () => {
    const sessionA = createMockSession({
      results: [
        createMockResult('a@test.com', 'Unknown'),
        createMockResult('b@test.com', 'Safe'),
      ],
    });
    const sessionB = createMockSession({
      results: [
        createMockResult('a@test.com', 'Safe'),
        createMockResult('b@test.com', 'Invalid'),
      ],
    });

    const diff = computeSessionDiff(sessionA, sessionB);

    expect(diff.changed).toHaveLength(2);
    expect(diff.changed).toEqual(
      expect.arrayContaining([
        { email: 'a@test.com', oldVerdict: 'Unknown', newVerdict: 'Safe' },
        { email: 'b@test.com', oldVerdict: 'Safe', newVerdict: 'Invalid' },
      ])
    );
  });

  it('handles identical sessions (all unchanged)', () => {
    const sessionA = createMockSession({
      results: [
        createMockResult('a@test.com', 'Safe'),
        createMockResult('b@test.com', 'Invalid'),
      ],
    });
    const sessionB = createMockSession({
      results: [
        createMockResult('a@test.com', 'Safe'),
        createMockResult('b@test.com', 'Invalid'),
      ],
    });

    const diff = computeSessionDiff(sessionA, sessionB);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.stats.unchanged).toBe(2);
  });

  it('handles completely different sessions (disjoint)', () => {
    const sessionA = createMockSession({
      results: [
        createMockResult('a@test.com', 'Safe'),
        createMockResult('b@test.com', 'Risky'),
      ],
    });
    const sessionB = createMockSession({
      results: [
        createMockResult('c@test.com', 'Invalid'),
        createMockResult('d@test.com', 'Unknown'),
      ],
    });

    const diff = computeSessionDiff(sessionA, sessionB);

    expect(diff.added).toHaveLength(2);
    expect(diff.removed).toHaveLength(2);
    expect(diff.changed).toHaveLength(0);
    expect(diff.stats.totalAdded).toBe(2);
    expect(diff.stats.totalRemoved).toBe(2);
    expect(diff.stats.totalChanged).toBe(0);
    expect(diff.stats.unchanged).toBe(0);
  });

  it('computes correct stats with mixed changes', () => {
    const sessionA = createMockSession({
      results: [
        createMockResult('a@test.com', 'Safe'),       // unchanged
        createMockResult('b@test.com', 'Unknown'),     // changed to Safe
        createMockResult('c@test.com', 'Invalid'),     // removed
        createMockResult('d@test.com', 'Risky'),       // unchanged
        createMockResult('e@test.com', 'Unknown'),     // removed
      ],
    });
    const sessionB = createMockSession({
      results: [
        createMockResult('a@test.com', 'Safe'),       // unchanged
        createMockResult('b@test.com', 'Safe'),        // changed from Unknown
        createMockResult('d@test.com', 'Risky'),       // unchanged
        createMockResult('f@test.com', 'Safe'),        // added
        createMockResult('g@test.com', 'Invalid'),     // added
      ],
    });

    const diff = computeSessionDiff(sessionA, sessionB);

    expect(diff.added).toHaveLength(2);
    expect(diff.removed).toHaveLength(2);
    expect(diff.changed).toHaveLength(1);
    expect(diff.stats.totalAdded).toBe(2);
    expect(diff.stats.totalRemoved).toBe(2);
    expect(diff.stats.totalChanged).toBe(1);
    expect(diff.stats.unchanged).toBe(2); // a@test.com and d@test.com
  });

  it('handles empty sessions', () => {
    const sessionA = createMockSession({ results: [] });
    const sessionB = createMockSession({ results: [] });

    const diff = computeSessionDiff(sessionA, sessionB);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.stats.unchanged).toBe(0);
  });

  it('handles session A empty and session B has results', () => {
    const sessionA = createMockSession({ results: [] });
    const sessionB = createMockSession({
      results: [
        createMockResult('a@test.com', 'Safe'),
        createMockResult('b@test.com', 'Invalid'),
      ],
    });

    const diff = computeSessionDiff(sessionA, sessionB);

    expect(diff.added).toHaveLength(2);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it('handles session B empty and session A has results', () => {
    const sessionA = createMockSession({
      results: [
        createMockResult('a@test.com', 'Safe'),
        createMockResult('b@test.com', 'Invalid'),
      ],
    });
    const sessionB = createMockSession({ results: [] });

    const diff = computeSessionDiff(sessionA, sessionB);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(2);
    expect(diff.changed).toHaveLength(0);
  });

  it('counts verdict changes by type in changeSummary', () => {
    const sessionA = createMockSession({
      results: [
        createMockResult('a@test.com', 'Unknown'),
        createMockResult('b@test.com', 'Unknown'),
        createMockResult('c@test.com', 'Safe'),
      ],
    });
    const sessionB = createMockSession({
      results: [
        createMockResult('a@test.com', 'Safe'),
        createMockResult('b@test.com', 'Invalid'),
        createMockResult('c@test.com', 'Risky'),
      ],
    });

    const diff = computeSessionDiff(sessionA, sessionB);

    expect(diff.changeSummary).toEqual({
      'Unknown → Safe': 1,
      'Unknown → Invalid': 1,
      'Safe → Risky': 1,
    });
  });
});
