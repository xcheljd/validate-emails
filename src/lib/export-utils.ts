import { ValidationResult } from '@/hooks/use-email-validation';

export function formatAsCSV(results: ValidationResult[]): string {
  const header = "Email,Status,Reason";
  
  const rows = results.map(r => {
    const email = escapeCSV(r.email);
    const result = escapeCSV(r.result);
    const reason = escapeCSV(r.reason);
    return `${email},${result},${reason}`;
  });

  return [header, ...rows].join("\n");
}

function escapeCSV(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}