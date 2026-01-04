import * as XLSX from 'xlsx';
import { ValidationResult } from '@/hooks/use-email-validation';

export interface ExportColumn {
  key: keyof ValidationResult;
  label: string;
  enabled: boolean;
}

export const exportColumns: ExportColumn[] = [
  { key: 'email', label: 'Email', enabled: true },
  { key: 'result', label: 'Status', enabled: true },
  { key: 'reason', label: 'Verdict Reason', enabled: true },
  { key: 'domain', label: 'Domain', enabled: true },
  { key: 'validationDuration', label: 'Duration (ms)', enabled: true },
  { key: 'proxyUsed', label: 'Proxy', enabled: true },
  { key: 'mxRecordCount', label: 'MX Records', enabled: true },
  { key: 'isDisposable', label: 'Disposable', enabled: true },
  { key: 'isRoleAccount', label: 'Role Account', enabled: true },
  { key: 'isCatchAll', label: 'Catch-All', enabled: true },
  { key: 'errorType', label: 'Error Type', enabled: true },
  { key: 'timestamp', label: 'Validated At', enabled: true },
  { key: 'validationMode', label: 'Validation Mode', enabled: true },
];

export function exportToExcel(
  results: ValidationResult[],
  columns: ExportColumn[]
): void {
  const enabledColumns = columns.filter(c => c.enabled);
  const data = results.map(result => {
    const row: any = {};
    enabledColumns.forEach(col => {
      row[col.label] = result[col.key] ?? '-';
    });
    return row;
  });

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');
  XLSX.writeFile(workbook, 'validation_results.xlsx');
}

export function exportToCSV(
  results: ValidationResult[],
  columns: ExportColumn[]
): string {
  const enabledColumns = columns.filter(c => c.enabled);
  const headers = enabledColumns.map(c => c.label).join(',');
  const rows = results.map(result => {
    return enabledColumns.map(col => {
      const value = result[col.key];
      const stringValue = value ?? '-';
      return typeof stringValue === 'string' ? escapeCSV(stringValue) : String(stringValue);
    }).join(',');
  });
  return [headers, ...rows].join('\n');
}

function escapeCSV(val: any): string {
  if (typeof val !== 'string') return String(val);
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${String(val).replace(/"/g, '""')}"`;
  }
  return String(val);
}
