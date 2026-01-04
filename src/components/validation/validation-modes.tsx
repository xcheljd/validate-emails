import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type ValidationMode = 'quick' | 'standard' | 'thorough';

interface ValidationModesProps {
  selected: ValidationMode;
  onChange: (mode: ValidationMode) => void;
}

const modeConfig = {
  quick: { timeout: 10, label: 'Quick (10s)', checks: ['Syntax', 'MX'] },
  standard: { timeout: 30, label: 'Standard (30s)', checks: ['Syntax', 'MX', 'SMTP Connect'] },
  thorough: { timeout: 60, label: 'Thorough (60s)', checks: ['All Checks', 'Deliverability'] },
};

export function ValidationModeSelector({ selected, onChange }: ValidationModesProps) {
  return (
    <Card className="p-4">
      <div className="flex gap-2">
        {Object.entries(modeConfig).map(([key, config]) => (
          <Button
            key={key}
            variant={selected === key ? 'default' : 'outline'}
            onClick={() => onChange(key as ValidationMode)}
            className="flex-1 h-auto py-4"
          >
            <div className="text-left">
              <div className="font-semibold text-sm">{config.label}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {config.checks.join(' • ')}
              </div>
            </div>
          </Button>
        ))}
      </div>
    </Card>
  );
}
