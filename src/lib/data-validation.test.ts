import { describe, it, expect } from 'vitest';
import { validateSession, validateResult, validateResultsBatch } from './data-validation';
import { ValidationResult } from './types';
import { ValidationSession } from './session-manager';

describe('Data Validation', () => {
  const validResult: ValidationResult = {
    email: 'test@example.com',
    result: 'Safe',
    reason: 'Valid MX',
    logs: [],
    domain: 'example.com',
    validationDuration: 100,
    mxRecordCount: 1,
    isDisposable: false,
    isRoleAccount: false,
    isCatchAll: false,
    isDeliverable: true,
    isDisabled: false,
    hasFullInbox: false,
    canConnectSmtp: true,
    acceptsMail: true,
    isValidSyntax: true,
    isB2c: false,
    timestamp: new Date().toISOString(),
    validationMode: 'standard',
    riskScore: 10
  };

  const validSession: ValidationSession = {
    id: 'session-123',
    name: 'Test Session',
    emails: ['test@example.com'],
    results: [validResult],
    status: 'completed',
    currentIndex: 1,
    total: 1,
    createdAt: new Date().toISOString(),
    settings: {
      validationMode: 'standard',
    }
  };

  describe('validateResult', () => {
    it('should accept a valid result', () => {
      const report = validateResult(validResult);
      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });

    it('should reject missing email', () => {
      const invalid = { ...validResult, email: undefined };
      const report = validateResult(invalid);
      expect(report.valid).toBe(false);
      expect(report.errors).toContain('Invalid or missing email');
    });

    it('should reject invalid result status', () => {
      const invalid = { ...validResult, result: 'NotSure' };
      const report = validateResult(invalid);
      expect(report.valid).toBe(false);
      expect(report.errors[0]).toContain('Invalid result value');
    });

    it('should reject invalid risk score', () => {
      const invalid = { ...validResult, riskScore: 150 };
      const report = validateResult(invalid);
      expect(report.valid).toBe(false);
      expect(report.errors).toContain('Invalid risk score');
    });
  });

  describe('validateSession', () => {
    it('should accept a valid session', () => {
      const report = validateSession(validSession);
      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });

    it('should reject missing id', () => {
      const invalid = { ...validSession, id: undefined };
      const report = validateSession(invalid);
      expect(report.valid).toBe(false);
      expect(report.errors).toContain('Invalid or missing session ID');
    });

    it('should reject invalid validation mode in settings', () => {
      const invalid = { 
        ...validSession, 
        settings: { ...validSession.settings, validationMode: 'ultra-thorough' } 
      };
      const report = validateSession(invalid);
      expect(report.valid).toBe(false);
      expect(report.errors[0]).toContain('Invalid validation mode');
    });

    it('should reject invalid session status', () => {
      const invalid = { ...validSession, status: 'archived' };
      const report = validateSession(invalid);
      expect(report.valid).toBe(false);
      expect(report.errors[0]).toContain('Invalid session status');
    });
  });

  describe('validateResultsBatch', () => {
    it('should accept an array of valid results', () => {
      const batch = [validResult, validResult];
      const report = validateResultsBatch(batch);
      expect(report.valid).toBe(true);
    });

    it('should report errors for invalid items in batch', () => {
      const invalidResult = { ...validResult, email: undefined };
      const batch = [validResult, invalidResult];
      const report = validateResultsBatch(batch);
      expect(report.valid).toBe(false);
      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors[0]).toContain('Result at index 1');
    });
  });
});
