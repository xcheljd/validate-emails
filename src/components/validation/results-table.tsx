import { useState, useMemo, useRef, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, ArrowUpDown, ChevronRight, Filter, Download, Trash2, Columns, Smartphone, X } from "lucide-react";
import { ValidationResult } from "@/lib/types";
import { RiskScoreBadge } from "./risk-score-badge";
import { TypoWarning } from "./typo-warning";
import * as typoDatabase from "@/lib/typo-database";
import { exportColumns, ExportColumn } from "@/lib/enhanced-export-utils";
import { formatAsCSV } from "@/lib/export-utils";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";

interface ResultsTableProps {
  results: ValidationResult[];
  onViewDetails: (result: ValidationResult) => void;
  statusFilter: string;
  onStatusFilterChange: (filter: string) => void;
}

export function ResultsTable({ 
  results, 
  onViewDetails,
  statusFilter,
  onStatusFilterChange 
}: ResultsTableProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [sortKey, setSortKey] = useState<string>("email");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const [localColumns, setLocalColumns] = useState<ExportColumn[]>(() =>
    exportColumns.map(c => ({ ...c }))
  );
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const filteredAndSorted = useMemo(() => {
    let filtered = [...results];

    if (debouncedQuery) {
      filtered = filtered.filter(r =>
        r.email.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        r.result.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        r.reason.toLowerCase().includes(debouncedQuery.toLowerCase())
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => r.result === statusFilter);
    }

    if (riskFilter === 'low') {
      filtered = filtered.filter(r => r.riskScore < 30);
    } else if (riskFilter === 'medium') {
      filtered = filtered.filter(r => r.riskScore >= 30 && r.riskScore < 50);
    } else if (riskFilter === 'high') {
      filtered = filtered.filter(r => r.riskScore >= 50);
    }

    filtered.sort((a, b) => {
      const aVal = (a as any)[sortKey];
      const bVal = (b as any)[sortKey];
      let comparison = 0;
      if (aVal < bVal) comparison = -1;
      if (aVal > bVal) comparison = 1;
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [results, debouncedQuery, sortKey, sortOrder, statusFilter, riskFilter]);

  const virtualizer = useVirtualizer({
    count: filteredAndSorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRows(new Set(filteredAndSorted.map(r => r.email)));
    } else {
      setSelectedRows(new Set());
    }
  };

  const handleSelectRow = (email: string, checked: boolean) => {
    const newSelected = new Set(selectedRows);
    if (checked) {
      newSelected.add(email);
    } else {
      newSelected.delete(email);
    }
    setSelectedRows(newSelected);
  };

  const getTypoForEmail = (email: string): string | null => {
    return typoDatabase.suggestCorrection(email);
  };

  const handleExportSelected = async () => {
    const selectedResults = results.filter(r => selectedRows.has(r.email));
    if (selectedResults.length === 0) return;

    const csvContent = formatAsCSV(selectedResults);

    try {
      const filePath = await save({
        filters: [{
          name: 'CSV',
          extensions: ['csv']
        }],
        defaultPath: 'validation_results_selected.csv'
      });

      if (filePath) {
        await writeTextFile(filePath, csvContent);
      }
    } catch (err) {
      console.error("Failed to save file:", err);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'validation_results_selected.csv';
      a.click();
    }
  };

  const handleDeleteSelected = () => {
    if (confirm(`Delete ${selectedRows.size} selected results?`)) {
      setSelectedRows(new Set());
    }
  };

  const toggleColumn = (key: string) => {
    setLocalColumns(prev =>
      prev.map(c =>
        c.key === key ? { ...c, enabled: !c.enabled } : c
      )
    );
    setShowColumnMenu(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Safe":
        return <Badge className="bg-green-500 hover:bg-green-600 shadow-sm">Safe</Badge>;
      case "Risky":
        return <Badge className="bg-yellow-500 hover:bg-yellow-600 shadow-sm text-black">Risky</Badge>;
      case "Invalid":
        return <Badge variant="destructive" className="shadow-sm">Invalid</Badge>;
      default:
        return <Badge variant="outline" className="shadow-sm">Unknown</Badge>;
    }
  };

  const visibleColumns = useMemo(() => {
    const enabledColumns = localColumns.filter(c => c.enabled);
    
    if (windowWidth < 640) { // mobile
      return enabledColumns.filter(c => ['email', 'result'].includes(c.key));
    } else if (windowWidth < 1024) { // tablet
      return enabledColumns.filter(c => ['email', 'result', 'domain'].includes(c.key));
    }
    
    return enabledColumns;
  }, [localColumns, windowWidth]);

  const { getVirtualItems, getTotalSize } = virtualizer;
  const items = getVirtualItems();
  const paddingTop = items.length > 0 ? items[0].start : 0;
  const paddingBottom = items.length > 0 ? getTotalSize() - items[items.length - 1].end : 0;

  return (
    <div className="space-y-4 w-full max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search emails, status, or reasons..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 bg-card shadow-sm w-full"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className={cn(
                "text-sm border rounded-md px-3 py-1.5 bg-card touch-action-manipulation min-h-[38px] pr-8 appearance-none",
                statusFilter !== "all" && "border-primary ring-1 ring-primary/20"
              )}
            >
              <option value="all">All Status</option>
              <option value="Safe">Safe</option>
              <option value="Risky">Risky</option>
              <option value="Invalid">Invalid</option>
              <option value="Unknown">Unknown</option>
            </select>
            {statusFilter !== "all" && (
              <button 
                onClick={() => onStatusFilterChange("all")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            className="text-sm border rounded-md px-3 py-1.5 bg-card touch-action-manipulation min-h-[38px]"
          >
            <option value="all">All Risk</option>
            <option value="low">Low (0-29)</option>
            <option value="medium">Medium (30-49)</option>
            <option value="high">High (50+)</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowColumnMenu(!showColumnMenu)}
            className="gap-2 min-h-[38px]"
          >
            <Columns className="h-4 w-4" />
            <span className="hidden sm:inline">Columns</span>
          </Button>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full border w-full sm:w-auto justify-center sm:justify-start">
          <Filter className="h-3 w-3" />
          <span>Showing <strong>{filteredAndSorted.length}</strong> of {results.length}</span>
        </div>
      </div>

      {showColumnMenu && (
        <div className="bg-card border rounded-lg p-4 shadow-lg">
          <h4 className="font-medium mb-2">Toggle Columns</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {localColumns.map(col => (
              <label key={col.key} className="flex items-center gap-2 text-sm touch-action-manipulation">
                <Checkbox
                  checked={col.enabled}
                  onCheckedChange={() => toggleColumn(col.key)}
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {selectedRows.size > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 bg-primary/10 border border-primary rounded-lg p-3">
          <span className="text-sm font-medium">{selectedRows.size} selected</span>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportSelected}
              className="gap-2 min-h-[38px] flex-1 sm:flex-none"
            >
              <Download className="h-4 w-4" />
              <span>Export</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteSelected}
              className="gap-2 text-destructive hover:text-destructive min-h-[38px] flex-1 sm:flex-none"
            >
              <Trash2 className="h-4 w-4" />
              <span>Delete</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedRows(new Set())}
              className="min-h-[38px] flex-1 sm:flex-none"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="border rounded-lg bg-card shadow-sm overflow-hidden">
        <div ref={parentRef} className="overflow-auto max-h-[600px]">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0 z-10">
              <TableRow>
                <TableHead className="w-[40px] min-w-[40px]">
                  <Checkbox
                    checked={selectedRows.size === filteredAndSorted.length && filteredAndSorted.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                {visibleColumns.map(col => (
                  <TableHead key={col.key} className="whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSort(col.key)}
                      className="-ml-3 h-8 text-muted-foreground hover:text-foreground font-semibold uppercase tracking-wider text-[10px]"
                    >
                      {col.label}
                      <ArrowUpDown className="ml-2 h-3 w-3" />
                    </Button>
                  </TableHead>
                ))}
                <TableHead className="text-right text-muted-foreground font-semibold uppercase tracking-wider text-[10px] min-w-[80px]">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSorted.length > 0 ? (
                <>
                  {paddingTop > 0 && (
                    <TableRow>
                      <TableCell colSpan={visibleColumns.length + 2} style={{ height: `${paddingTop}px`, padding: 0 }} />
                    </TableRow>
                  )}
                  {items.map((virtualRow) => {
                    const result = filteredAndSorted[virtualRow.index];
                    const typo = getTypoForEmail(result.email);
                    return (
                        <TableRow 
                            key={virtualRow.key}
                            data-index={virtualRow.index}
                            ref={virtualizer.measureElement}
                            className="hover:bg-muted/30 transition-colors"
                        >
                          <TableCell className="min-w-[40px]">
                            <Checkbox
                              checked={selectedRows.has(result.email)}
                              onCheckedChange={(checked) => handleSelectRow(result.email, !!checked)}
                            />
                          </TableCell>
                          {visibleColumns.map(col => (
                            <TableCell key={col.key} className="whitespace-nowrap">
                              {col.key === 'email' && (
                                <div>
                                  <div className="font-medium font-mono text-xs truncate max-w-[300px] sm:max-w-[400px]">
                                    {result[col.key]}
                                  </div>
                                  {typo && <TypoWarning email={result.email} correctedEmail={typo} />}
                                </div>
                              )}
                              {col.key === 'result' && (
                                <div className="flex items-center gap-2">
                                  {getStatusBadge(result[col.key])}
                                  <RiskScoreBadge result={result} />
                                </div>
                              )}
                              {col.key !== 'email' && col.key !== 'result' && (
                                <span className="text-sm text-muted-foreground truncate">
                                  {String(result[col.key as keyof ValidationResult] ?? '-')}
                                </span>
                              )}
                            </TableCell>
                          ))}
                          <TableCell className="text-right min-w-[80px]">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onViewDetails(result)}
                              className="h-8 text-xs hover:bg-primary/10 hover:text-primary min-h-[38px]"
                            >
                              <span className="hidden sm:inline">Details</span>
                              <ChevronRight className="h-3 w-3 ml-1" />
                            </Button>
                          </TableCell>
                        </TableRow>
                    );
                  })}
                  {paddingBottom > 0 && (
                    <TableRow>
                      <TableCell colSpan={visibleColumns.length + 2} style={{ height: `${paddingBottom}px`, padding: 0 }} />
                    </TableRow>
                  )}
                </>
              ) : (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + 2} className="h-32 text-center text-muted-foreground italic">
                    No matches found for your search query.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {filteredAndSorted.length > 100 && (
        <div className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Smartphone className="h-4 w-4" />
          <span>Virtualized table for optimal performance with {filteredAndSorted.length} results</span>
        </div>
      )}
    </div>
  );
}
