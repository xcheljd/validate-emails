import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, ArrowRight, Trash2, ChevronLeft } from 'lucide-react';
import { ValidationModeSelector } from './validation-modes';

type ValidationMode = 'quick' | 'standard' | 'thorough';

const modeLabels: Record<ValidationMode, string> = {
  quick: 'Quick',
  standard: 'Standard',
  thorough: 'Thorough',
};

interface ValidationConfigProps {
  emails: string[];
  onClear: () => void;
  onStart: () => void;
  validationMode: ValidationMode;
  onModeChange: (mode: ValidationMode) => void;
  onBack: () => void;
}

export function ValidationConfig({
  emails,
  onClear,
  onStart,
  validationMode,
  onModeChange,
  onBack,
}: ValidationConfigProps) {
  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-2 -ml-2 text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Add more emails
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onClear}
          className="gap-2"
        >
          <Trash2 className="h-4 w-4" />
          Clear List
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">
              1. Select Validation Depth
            </h3>
            <ValidationModeSelector
              selected={validationMode}
              onChange={onModeChange}
            />
          </section>

          <Card className="border-2 border-primary/10 shadow-lg bg-gradient-to-b from-primary/5 to-transparent">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-6">
                <div className="space-y-1">
                  <h2 className="text-xl font-bold tracking-tight">
                    Ready to Verify
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Review your settings and start the process
                  </p>
                </div>
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Mail className="h-6 w-6 text-primary" />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 rounded-xl bg-background border shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="font-black text-2xl text-primary">
                      {emails.length}
                    </div>
                    <div className="text-xs font-bold uppercase text-muted-foreground tracking-tighter">
                      Total Emails
                      <br />
                      Loaded
                    </div>
                  </div>
                  <Button
                    size="lg"
                    onClick={onStart}
                    className="gap-2 px-8 font-bold text-lg h-14 shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    Start Validation
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-background border shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="text-xs font-bold uppercase text-muted-foreground tracking-tighter">
                      Validation Mode
                    </div>
                  </div>
                  <div className="font-bold text-sm text-primary">
                    {modeLabels[validationMode]}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">
            2. Preview List
          </h3>
          <Card className="h-[500px] flex flex-col overflow-hidden">
            <CardHeader className="py-3 bg-muted/30 border-b">
              <CardTitle className="text-xs font-bold uppercase">
                Sample Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              <div className="h-full overflow-y-auto p-4 space-y-2 font-mono text-[11px]">
                {emails.map((email, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 border-b border-muted pb-2 last:border-0 truncate text-muted-foreground"
                  >
                    <span className="text-[10px] opacity-30 w-6 text-right shrink-0">
                      {i + 1}
                    </span>
                    {email}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
