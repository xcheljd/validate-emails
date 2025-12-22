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
import { Search, ArrowUpDown, ChevronRight } from "lucide-react";
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
        return <Badge className="bg-green-500 hover:bg-green-600">Safe</Badge>;
      case "Risky":
        return <Badge className="bg-yellow-500 hover:bg-yellow-600">Risky</Badge>;
      case "Invalid":
        return <Badge variant="destructive">Invalid</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <div className="space-y-4 w-full max-w-6xl mx-auto">
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search emails or status..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          Showing {filteredAndSorted.length} of {results.length}
        </div>
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">
                <Button variant="ghost" size="sm" onClick={() => handleSort("email")} className="-ml-3 h-8 data-[state=open]:bg-accent">
                  <span>Email</span>
                  <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => handleSort("result")} className="-ml-3 h-8 data-[state=open]:bg-accent">
                  <span>Status</span>
                  <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
              </TableHead>
              <TableHead className="hidden md:table-cell">Reason</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSorted.length > 0 ? (
              filteredAndSorted.map((result, i) => (
                <TableRow key={`${result.email}-${i}`}>
                  <TableCell className="font-medium font-mono truncate max-w-[300px]">
                    {result.email}
                  </TableCell>
                  <TableCell>{getStatusBadge(result.result)}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground text-sm truncate max-w-[400px]">
                    {result.reason}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => onViewDetails(result)}>
                      Details <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No results found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
