import { describe, it, expect } from 'vitest';
import { estimateValidationTime } from './rate-limit-warning-dialog';

describe('estimateValidationTime', () => {
  it('returns 0 seconds for 0 emails', () => {
    expect(estimateValidationTime(0, 1, 60)).toBe('0 seconds');
  });

  it('returns correct seconds for under 1 minute', () => {
    expect(estimateValidationTime(5, 1, 60)).toBe('5 seconds');
  });

  it('returns singular second for 1 email', () => {
    expect(estimateValidationTime(1, 1, 60)).toBe('1 second');
  });

  it('returns minutes for over 1 minute', () => {
    const result = estimateValidationTime(120, 1, 60);
    expect(result).toContain('2 minute');
  });

  it('returns hours and minutes for over 1 hour', () => {
    const result = estimateValidationTime(3600, 1, 60);
    expect(result).toContain('1 hour');
    // Exactly 1 hour has no remaining minutes
  });

  it('respects max per minute rate limit', () => {
    // maxPerMinute=30 means 0.5 per second, so 30 emails = 60 seconds
    const result = estimateValidationTime(30, 10, 30);
    expect(result).toContain('1 minute');
  });

  it('uses more restrictive rate', () => {
    // maxPerSecond=1, maxPerMinute=60 -> effective 1/s
    // 60 emails = 60 seconds
    const result = estimateValidationTime(60, 1, 60);
    expect(result).toContain('1 minute');
  });

  it('pluralizes hours correctly', () => {
    const result = estimateValidationTime(7200, 1, 60);
    expect(result).toContain('2 hours');
  });

  it('pluralizes minutes correctly', () => {
    const result = estimateValidationTime(120, 1, 60);
    expect(result).toContain('2 minutes');
  });
});
