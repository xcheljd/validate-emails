import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ValidationResult } from '@/lib/types';

interface DomainStats {
  domain: string;
  totalCount: number;
  safeCount: number;
  riskyCount: number;
  invalidCount: number;
  unknownCount: number;
  successRate: number;
  isFreeProvider: boolean;
}

export function DomainAnalysis({ results }: { results: ValidationResult[] }) {
  const domainStats = useMemo(() => {
    const statsMap = new Map<string, DomainStats>();

    results.forEach(result => {
      const domain = result.domain;
      if (!statsMap.has(domain)) {
        statsMap.set(domain, {
          domain,
          totalCount: 0,
          safeCount: 0,
          riskyCount: 0,
          invalidCount: 0,
          unknownCount: 0,
          successRate: 0,
          isFreeProvider: false,
        });
      }

      const stats = statsMap.get(domain)!;
      stats.totalCount++;
      if (result.result === 'Safe') stats.safeCount++;
      else if (result.result === 'Risky') stats.riskyCount++;
      else if (result.result === 'Invalid') stats.invalidCount++;
      else if (result.result === 'Unknown') stats.unknownCount++;
    });

    const freeProviders = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com', 'icloud.com', 'protonmail.com'];

    Array.from(statsMap.values())
      .sort((a, b) => b.totalCount - a.totalCount)
      .forEach(stats => {
        stats.successRate = stats.totalCount > 0 ? Math.round((stats.safeCount / stats.totalCount) * 100) : 0;
        stats.isFreeProvider = freeProviders.includes(stats.domain.toLowerCase());
      });

    return Array.from(statsMap.values());
  }, [results]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Domain Analysis</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Domain</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Safe</TableHead>
              <TableHead>Risky</TableHead>
              <TableHead>Invalid</TableHead>
              <TableHead>Unknown</TableHead>
              <TableHead>Success Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domainStats.slice(0, 20).map((stats: DomainStats, idx: number) => (
              <TableRow key={`${stats.domain}-${idx}`}>
                <TableCell className="font-medium">{stats.domain}</TableCell>
                <TableCell>{stats.totalCount}</TableCell>
                <TableCell className="text-green-600">{stats.safeCount}</TableCell>
                <TableCell className="text-yellow-600">{stats.riskyCount}</TableCell>
                <TableCell className="text-red-600">{stats.invalidCount}</TableCell>
                <TableCell>{stats.unknownCount}</TableCell>
                <TableCell>{stats.successRate}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
