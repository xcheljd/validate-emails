import { useState, useMemo } from "react";
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
import { Search, ArrowUpDown, ChevronRight, Filter } from "lucide-react";
import { ValidationResult } from "@/hooks/use-email-validation";
import { filterResults, sortResults } from "./results-table-logic";

interface ResultsTableProps {
  results: ValidationResult[];
  onViewDetails: (result: ValidationResult) => void;
}

export function ResultsTable({ results, onViewDetails }: ResultsTableProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string>("email");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const filteredAndSorted = useMemo(() => {
    const filtered = filterResults(results, query);
    return sortResults(filtered, sortKey, sortOrder);
  }, [results, query, sortKey, sortOrder]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
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

  return (
    <div className="space-y-4 w-full max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search emails, status, or reasons..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 bg-card shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full border">
          <Filter className="h-3 w-3" />
          <span>Showing <strong>{filteredAndSorted.length}</strong> of {results.length}</span>
        </div>
      </div>

      <div className="border rounded-lg bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[300px]">
                <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleSort("email")} 
                    className="-ml-3 h-8 text-muted-foreground hover:text-foreground font-semibold uppercase tracking-wider text-[10px]"
                >
                  Email
                  <ArrowUpDown className="ml-2 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleSort("result")} 
                    className="-ml-3 h-8 text-muted-foreground hover:text-foreground font-semibold uppercase tracking-wider text-[10px]"
                >
                  Status
                  <ArrowUpDown className="ml-2 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead className="hidden md:table-cell text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">
                Verdict Reason
              </TableHead>
              <TableHead className="text-right text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSorted.length > 0 ? (
              filteredAndSorted.map((result, i) => (
                <TableRow key={`${result.email}-${i}`} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-medium font-mono text-xs truncate max-w-[300px]">
                    {result.email}
                  </TableCell>
                  <TableCell>{getStatusBadge(result.result)}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground text-xs truncate max-w-[400px]">
                    {result.reason}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => onViewDetails(result)} className="h-8 text-xs hover:bg-primary/10 hover:text-primary">
                      Details <ChevronRight className="ml-1 h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground italic">
                  No matches found for your search query.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}