import { ValidationResult } from '@/lib/types';

export function filterResults(
  results: ValidationResult[],
  query: string
): ValidationResult[] {
  const lowQuery = query.toLowerCase();
  return results.filter(
    (r) =>
      r.email.toLowerCase().includes(lowQuery) ||
      r.result.toLowerCase().includes(lowQuery) ||
      r.reason.toLowerCase().includes(lowQuery)
  );
}

export function sortResults(
  results: ValidationResult[],
  key: string,
  order: 'asc' | 'desc'
): ValidationResult[] {
  return [...results].sort((a, b) => {
    const aVal = a[key as keyof ValidationResult];
    const bVal = b[key as keyof ValidationResult];
    if (aVal == null || bVal == null) return 0;
    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });
}
