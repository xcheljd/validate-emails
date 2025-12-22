import { ValidationResult } from '@/hooks/use-email-validation';

export function filterResults(results: ValidationResult[], query: string): ValidationResult[] {
  const lowQuery = query.toLowerCase();
  return results.filter(r => 
    r.email.toLowerCase().includes(lowQuery) || 
    r.result.toLowerCase().includes(lowQuery) ||
    r.reason.toLowerCase().includes(lowQuery)
  );
}

export function sortResults(results: ValidationResult[], key: string, order: 'asc' | 'desc'): ValidationResult[] {
  return [...results].sort((a: any, b: any) => {
    if (a[key] < b[key]) return order === 'asc' ? -1 : 1;
    if (a[key] > b[key]) return order === 'asc' ? 1 : -1;
    return 0;
  });
}