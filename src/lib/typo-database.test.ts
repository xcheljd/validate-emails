import { describe, it, expect } from 'vitest';
import * as typoDatabase from './typo-database';

describe('typo-database', () => {
  describe('suggestCorrection', () => {
    it('should suggest correction for common typos', () => {
      expect(typoDatabase.suggestCorrection('test@gmial.com')).toBe(
        'test@gmail.com'
      );
      expect(typoDatabase.suggestCorrection('user@gmaill.com')).toBe(
        'user@gmail.com'
      );
    });

    it('should suggest correction for yahoo typos', () => {
      expect(typoDatabase.suggestCorrection('test@yahooo.com')).toBe(
        'test@yahoo.com'
      );
      expect(typoDatabase.suggestCorrection('user@yaho.com')).toBe(
        'user@yahoo.com'
      );
    });

    it('should suggest correction for outlook typos', () => {
      expect(typoDatabase.suggestCorrection('test@outlok.com')).toBe(
        'test@outlook.com'
      );
      expect(typoDatabase.suggestCorrection('user@outlooke.com')).toBe(
        'user@outlook.com'
      );
    });

    it('should suggest correction for hotmail typos', () => {
      expect(typoDatabase.suggestCorrection('test@hotmal.com')).toBe(
        'test@hotmail.com'
      );
      expect(typoDatabase.suggestCorrection('user@hotmial.com')).toBe(
        'user@hotmail.com'
      );
    });

    it('should suggest correction for aol typos', () => {
      expect(typoDatabase.suggestCorrection('test@aol.co')).toBe(
        'test@aol.com'
      );
    });

    it('should return null for valid domains', () => {
      expect(typoDatabase.suggestCorrection('test@gmail.com')).toBeNull();
      expect(typoDatabase.suggestCorrection('user@yahoo.com')).toBeNull();
      expect(typoDatabase.suggestCorrection('admin@outlook.com')).toBeNull();
      // GMX is a legitimate provider, not a typo of Gmail
      expect(typoDatabase.suggestCorrection('user@gmx.com')).toBeNull();
      expect(typoDatabase.suggestCorrection('user@gmx.net')).toBeNull();
      // Self-mapping domains should not produce corrections
      expect(typoDatabase.suggestCorrection('user@aol.com')).toBeNull();
      expect(typoDatabase.suggestCorrection('user@icloud.com')).toBeNull();
    });

    it('should return null for unknown domains', () => {
      expect(
        typoDatabase.suggestCorrection('test@unknown-domain.com')
      ).toBeNull();
      expect(
        typoDatabase.suggestCorrection('user@custom-company.org')
      ).toBeNull();
    });

    it('should handle empty strings', () => {
      expect(typoDatabase.suggestCorrection('')).toBeNull();
    });

    it('should handle invalid email format', () => {
      expect(typoDatabase.suggestCorrection('not-an-email')).toBeNull();
      expect(typoDatabase.suggestCorrection('missing@')).toBeNull();
    });
  });

  describe('typoMap database', () => {
    it('should have expected typo mappings', () => {
      const typos = typoDatabase.typoMap;

      expect(typos['gmial.com']).toBe('gmail.com');
      expect(typos['yaho.com']).toBe('yahoo.com');
      expect(typos['outlok.com']).toBe('outlook.com');
      expect(typos['hotmal.com']).toBe('hotmail.com');
      expect(typos['aol.co']).toBe('aol.com');
    });

    it('should be case-insensitive when matching', () => {
      expect(typoDatabase.suggestCorrection('test@GMIAL.com')).toBe(
        'test@gmail.com'
      );
      expect(typoDatabase.suggestCorrection('user@YHAOO.COM')).toBe(
        'user@yahoo.com'
      );
    });
  });
});
