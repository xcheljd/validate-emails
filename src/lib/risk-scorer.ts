import { ValidationResult } from '@/hooks/use-email-validation';

export function calculateRiskScore(result: ValidationResult): number {
  let score = 0;

  switch (result.result) {
    case 'Safe': score += 0; break;
    case 'Risky': score += 30; break;
    case 'Invalid': score += 100; break;
    case 'Unknown': score += 50; break;
  }

  if (result.isDisposable) score += 40;

  if (result.isRoleAccount) score += 15;

  if (result.isCatchAll) score += 25;

  if (result.mxRecordCount === 0) score += 50;

  if (result.errorType === 'network_error') score += 20;

  return Math.min(score, 100);
}

export function getRiskLevel(score: number): 'Very Low' | 'Low' | 'Medium' | 'High' | 'Very High' {
  if (score < 10) return 'Very Low';
  if (score < 30) return 'Low';
  if (score < 50) return 'Medium';
  if (score < 80) return 'High';
  return 'Very High';
}

export function getRiskColor(score: number): string {
  if (score < 30) return 'bg-green-500';
  if (score < 50) return 'bg-yellow-500';
  if (score < 80) return 'bg-orange-500';
  return 'bg-red-500';
}

export function getRiskReasons(result: ValidationResult): string[] {
  const reasons: string[] = [];

  switch (result.result) {
    case 'Safe': reasons.push('Valid email address'); break;
    case 'Risky': reasons.push('Potential deliverability issues'); break;
    case 'Invalid': reasons.push('Undeliverable email'); break;
    case 'Unknown': reasons.push('Unable to verify email'); break;
  }

  if (result.isDisposable) reasons.push('Disposable email provider detected');

  if (result.isRoleAccount) reasons.push('Role account (info@, support@, etc.)');

  if (result.isCatchAll) reasons.push('Catch-all domain - may not exist');

  if (result.mxRecordCount === 0) reasons.push('No MX records found');

  if (result.errorType === 'network_error') reasons.push('Network or connection error');

  return reasons;
}
