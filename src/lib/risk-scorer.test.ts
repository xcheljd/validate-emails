import { describe, it, expect } from 'vitest';
import { calculateRiskScore, getRiskLevel, getRiskColor, getRiskReasons } from './risk-scorer';
import { ValidationResult } from '@/hooks/use-email-validation';

describe('risk-scorer', () => {
  const createMockResult = (overrides: Partial<ValidationResult> = {}): ValidationResult => ({
    email: 'test@example.com',
    result: 'Safe',
    reason: 'Valid',
    logs: [],
    domain: 'example.com',
    validationDuration: 1000,
    mxRecordCount: 2,
    isDisposable: false,
    isRoleAccount: false,
    isCatchAll: false,
    timestamp: '2025-01-04T00:00:00Z',
    validationMode: 'standard',
    riskScore: 0,
    ...overrides,
  });

  describe('calculateRiskScore', () => {
    it('should return 0 for Safe email with no risk factors', () => {
      const result = createMockResult({ result: 'Safe' });
      expect(calculateRiskScore(result)).toBe(0);
    });

    it('should return 30 for Risky email', () => {
      const result = createMockResult({ result: 'Risky' });
      expect(calculateRiskScore(result)).toBe(30);
    });

    it('should return 100 for Invalid email', () => {
      const result = createMockResult({ result: 'Invalid' });
      expect(calculateRiskScore(result)).toBe(100);
    });

    it('should return 50 for Unknown email', () => {
      const result = createMockResult({ result: 'Unknown' });
      expect(calculateRiskScore(result)).toBe(50);
    });

    it('should add 40 points for disposable email', () => {
      const result = createMockResult({ isDisposable: true });
      expect(calculateRiskScore(result)).toBe(40);
    });

    it('should add 15 points for role account', () => {
      const result = createMockResult({ isRoleAccount: true });
      expect(calculateRiskScore(result)).toBe(15);
    });

    it('should add 25 points for catch-all domain', () => {
      const result = createMockResult({ isCatchAll: true });
      expect(calculateRiskScore(result)).toBe(25);
    });

    it('should add 50 points when no MX records', () => {
      const result = createMockResult({ mxRecordCount: 0 });
      expect(calculateRiskScore(result)).toBe(50);
    });

    it('should add 20 points for network error', () => {
      const result = createMockResult({ errorType: 'network_error' });
      expect(calculateRiskScore(result)).toBe(20);
    });

    it('should combine multiple risk factors correctly', () => {
      const result = createMockResult({
        result: 'Invalid',
        isDisposable: true,
        isRoleAccount: true,
      });
      expect(calculateRiskScore(result)).toBe(100);
    });

    it('should cap score at 100', () => {
      const result = createMockResult({
        result: 'Invalid',
        isDisposable: true,
        isRoleAccount: true,
        isCatchAll: true,
        errorType: 'network_error',
      });
      expect(calculateRiskScore(result)).toBe(100);
    });
  });

  describe('getRiskLevel', () => {
    it('should return Very Low for scores < 10', () => {
      expect(getRiskLevel(0)).toBe('Very Low');
      expect(getRiskLevel(5)).toBe('Very Low');
      expect(getRiskLevel(9)).toBe('Very Low');
    });

    it('should return Low for scores 10-29', () => {
      expect(getRiskLevel(10)).toBe('Low');
      expect(getRiskLevel(20)).toBe('Low');
      expect(getRiskLevel(29)).toBe('Low');
    });

    it('should return Medium for scores 30-49', () => {
      expect(getRiskLevel(30)).toBe('Medium');
      expect(getRiskLevel(40)).toBe('Medium');
      expect(getRiskLevel(49)).toBe('Medium');
    });

    it('should return High for scores 50-79', () => {
      expect(getRiskLevel(50)).toBe('High');
      expect(getRiskLevel(65)).toBe('High');
      expect(getRiskLevel(79)).toBe('High');
    });

    it('should return Very High for scores 80-100', () => {
      expect(getRiskLevel(80)).toBe('Very High');
      expect(getRiskLevel(90)).toBe('Very High');
      expect(getRiskLevel(100)).toBe('Very High');
    });
  });

  describe('getRiskColor', () => {
    it('should return green for scores < 30', () => {
      expect(getRiskColor(0)).toBe('bg-green-500');
      expect(getRiskColor(15)).toBe('bg-green-500');
      expect(getRiskColor(29)).toBe('bg-green-500');
    });

    it('should return yellow for scores 30-49', () => {
      expect(getRiskColor(30)).toBe('bg-yellow-500');
      expect(getRiskColor(40)).toBe('bg-yellow-500');
      expect(getRiskColor(49)).toBe('bg-yellow-500');
    });

    it('should return orange for scores 50-79', () => {
      expect(getRiskColor(50)).toBe('bg-orange-500');
      expect(getRiskColor(65)).toBe('bg-orange-500');
      expect(getRiskColor(79)).toBe('bg-orange-500');
    });

    it('should return red for scores 80-100', () => {
      expect(getRiskColor(80)).toBe('bg-red-500');
      expect(getRiskColor(90)).toBe('bg-red-500');
      expect(getRiskColor(100)).toBe('bg-red-500');
    });
  });

  describe('getRiskReasons', () => {
    it('should return valid email reason for Safe result', () => {
      const result = createMockResult({ result: 'Safe' });
      const reasons = getRiskReasons(result);
      expect(reasons).toContain('Valid email address');
    });

    it('should return risky reason for Risky result', () => {
      const result = createMockResult({ result: 'Risky' });
      const reasons = getRiskReasons(result);
      expect(reasons).toContain('Potential deliverability issues');
    });

    it('should return invalid reason for Invalid result', () => {
      const result = createMockResult({ result: 'Invalid' });
      const reasons = getRiskReasons(result);
      expect(reasons).toContain('Undeliverable email');
    });

    it('should return unknown reason for Unknown result', () => {
      const result = createMockResult({ result: 'Unknown' });
      const reasons = getRiskReasons(result);
      expect(reasons).toContain('Unable to verify email');
    });

    it('should include disposable reason when isDisposable is true', () => {
      const result = createMockResult({ isDisposable: true });
      const reasons = getRiskReasons(result);
      expect(reasons).toContain('Disposable email provider detected');
    });

    it('should include role account reason when isRoleAccount is true', () => {
      const result = createMockResult({ isRoleAccount: true });
      const reasons = getRiskReasons(result);
      expect(reasons).toContain('Role account (info@, support@, etc.)');
    });

    it('should include catch-all reason when isCatchAll is true', () => {
      const result = createMockResult({ isCatchAll: true });
      const reasons = getRiskReasons(result);
      expect(reasons).toContain('Catch-all domain - may not exist');
    });

    it('should include no MX records reason when mxRecordCount is 0', () => {
      const result = createMockResult({ mxRecordCount: 0 });
      const reasons = getRiskReasons(result);
      expect(reasons).toContain('No MX records found');
    });

    it('should include network error reason when errorType is network_error', () => {
      const result = createMockResult({ errorType: 'network_error' });
      const reasons = getRiskReasons(result);
      expect(reasons).toContain('Network or connection error');
    });

    it('should return multiple reasons for multiple risk factors', () => {
      const result = createMockResult({
        isDisposable: true,
        isRoleAccount: true,
        isCatchAll: true,
      });
      const reasons = getRiskReasons(result);
      expect(reasons.length).toBeGreaterThan(1);
    });
  });
});
