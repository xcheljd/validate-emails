import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  Mail,
  Sparkles,
  AlertTriangle,
  Copy,
  Type,
  Wrench,
  Trash2,
  Forward,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CleaningResult, CleaningAction } from '@/lib/email-cleaner';

interface CleaningReportProps {
  result: CleaningResult;
  onProceed: () => void;
  onBack: () => void;
  onSkip: () => void;
}

interface SectionConfig {
  key: string;
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  items: SectionItem[];
}

interface SectionItem {
  label: string;
  detail?: string;
}

function ExpandableSection({ config }: { config: SectionConfig }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        className={cn(
          'w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors',
          isOpen && 'bg-muted/30'
        )}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{config.label}</span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {config.count}
        </Badge>
      </button>
      {isOpen && (
        <div className="border-t bg-muted/10">
          <ScrollArea className={cn(config.items.length > 6 ? 'h-[200px]' : '')}>
            <div className="p-3 space-y-1.5">
              {config.items.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 px-2">
                  No {config.label.toLowerCase()} to display
                </p>
              ) : (
                config.items.map((item, i) => (
                  <div
                    key={i}
                    className="text-xs font-mono px-2 py-1.5 rounded bg-background border"
                  >
                    <span>{item.label}</span>
                    {item.detail && (
                      <span className="text-muted-foreground ml-2">
                        {item.detail}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

export function CleaningReport({
  result,
  onProceed,
  onBack,
  onSkip,
}: CleaningReportProps) {
  const totalDuplicates =
    result.exactDuplicatesRemoved + result.normalizedDuplicatesRemoved;

  // Build section data from the result
  const duplicateItems: SectionItem[] = [];
  for (const [canonical, originals] of result.canonicalToOriginals) {
    if (originals.length > 1) {
      // Show the canonical email with its collapsed originals
      const collapsed = originals.slice(1);
      for (const orig of collapsed) {
        duplicateItems.push({
          label: orig,
          detail: `→ ${canonical}`,
        });
      }
    }
  }

  const typoItems: SectionItem[] = result.actions
    .filter((a: CleaningAction) => a.type === 'typo_correction')
    .map((a: CleaningAction) => ({
      label: a.original,
      detail: `→ ${a.corrected}`,
    }));

  const syntaxItems: SectionItem[] = result.actions
    .filter((a: CleaningAction) => a.type === 'syntax_fix')
    .map((a: CleaningAction) => ({
      label: a.original,
      detail: `→ ${a.corrected} (${a.description})`,
    }));

  // We don't track which specific emails were invalid (they're discarded),
  // so show count only. But if there are any actions mentioning invalid, use them.
  const invalidItems: SectionItem[] =
    result.invalidDiscarded > 0
      ? [
          {
            label: `${result.invalidDiscarded} email${result.invalidDiscarded !== 1 ? 's' : ''} discarded`,
            detail: '(no @ sign, no TLD, or other syntax errors)',
          },
        ]
      : [];

  const sections: SectionConfig[] = [
    {
      key: 'duplicates',
      label: 'Duplicates Removed',
      count: totalDuplicates,
      icon: <Copy className="h-4 w-4" />,
      color: 'text-blue-500',
      items: duplicateItems,
    },
    {
      key: 'typos',
      label: 'Typos Corrected',
      count: result.typosCorrected,
      icon: <Type className="h-4 w-4" />,
      color: 'text-amber-500',
      items: typoItems,
    },
    {
      key: 'syntax',
      label: 'Syntax Fixes',
      count: result.syntaxFixes,
      icon: <Wrench className="h-4 w-4" />,
      color: 'text-purple-500',
      items: syntaxItems,
    },
    {
      key: 'invalid',
      label: 'Invalid & Discarded',
      count: result.invalidDiscarded,
      icon: <AlertTriangle className="h-4 w-4" />,
      color: 'text-red-500',
      items: invalidItems,
    },
  ];

  const emailsRemoved =
    result.originalCount - result.finalCount - result.invalidDiscarded;

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      {/* Header with Back and Skip buttons */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-2 -ml-2 text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSkip}
          className="gap-2 text-muted-foreground"
        >
          <Forward className="h-4 w-4" />
          Skip Cleaning
        </Button>
      </div>

      {/* Section title */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Cleaning Report</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Review the changes applied to your email list before proceeding.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="border-2 border-primary/10">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Mail className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="text-2xl font-black text-primary">
              {result.originalCount}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Original
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-green-500/20 bg-green-500/5">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Sparkles className="h-3.5 w-3.5 text-green-600" />
            </div>
            <div className="text-2xl font-black text-green-600">
              {result.finalCount}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Clean
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-blue-500/20">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Copy className="h-3.5 w-3.5 text-blue-500" />
            </div>
            <div className="text-2xl font-black text-blue-500">
              {totalDuplicates}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Duplicates
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-amber-500/20">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Type className="h-3.5 w-3.5 text-amber-500" />
            </div>
            <div className="text-2xl font-black text-amber-500">
              {result.typosCorrected}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Typos
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-purple-500/20">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Wrench className="h-3.5 w-3.5 text-purple-500" />
            </div>
            <div className="text-2xl font-black text-purple-500">
              {result.syntaxFixes}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Syntax Fixes
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-red-500/20">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </div>
            <div className="text-2xl font-black text-red-500">
              {result.invalidDiscarded}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Invalid
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main content: Details + Clean list */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Expandable detail sections */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">
            Details
          </h3>
          <div className="space-y-2">
            {sections.map((section) => (
              <ExpandableSection key={section.key} config={section} />
            ))}
          </div>
        </div>

        {/* Clean email list preview */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">
            Cleaned Emails ({result.finalCount})
          </h3>
          <Card className="h-[400px] flex flex-col overflow-hidden">
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-1.5">
                {result.cleanedEmails.map((email, i) => {
                  const originals =
                    result.canonicalToOriginals.get(email) ?? [];
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-2 border-b border-muted pb-2 last:border-0"
                    >
                      <span className="text-[10px] opacity-30 w-6 text-right shrink-0 pt-0.5">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[11px] truncate">
                          {email}
                        </div>
                        {originals.length > 1 && (
                          <div className="text-[9px] text-muted-foreground mt-0.5">
                            ← {originals.length} originals
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </Card>
        </div>
      </div>

      {/* Action bar */}
      <Card className="border-2 border-primary/10 shadow-lg bg-gradient-to-b from-primary/5 to-transparent">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">
                {emailsRemoved > 0
                  ? `${emailsRemoved} email${emailsRemoved !== 1 ? 's were' : ' was'} removed to improve accuracy and save time`
                  : 'Your list is already clean!'}
              </div>
            </div>
            <Button
              size="lg"
              onClick={onProceed}
              className="gap-2 px-8 font-bold text-lg h-14 shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              Proceed with {result.finalCount} Clean Emails
              <ArrowRight className="h-5 w-5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
