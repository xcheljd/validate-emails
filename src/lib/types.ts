/**
 * Canonical ValidationResult interface.
 * Single source of truth for validation result data across the application.
 */

export interface ValidationResult {
  email: string;
  result: 'Safe' | 'Risky' | 'Invalid' | 'Unknown';
  reason: string;
  logs: string[];
  domain: string;
  validationDuration: number;
  mxRecordCount: number;
  isDisposable: boolean;
  isRoleAccount: boolean;
  isCatchAll: boolean;
  isDeliverable: boolean;
  isDisabled: boolean;
  hasFullInbox: boolean;
  canConnectSmtp: boolean;
  acceptsMail: boolean;
  isValidSyntax: boolean;
  isB2c: boolean;
  suggestion?: string | null;
  gravatarUrl?: string | null;
  haveibeenpwned?: boolean | null;
  errorType?: string;
  timestamp: string;
  validationMode: 'quick' | 'standard' | 'thorough';
  riskScore: number;
  /** The proxy ID used for this validation (if any) */
  proxyId?: string;
}
