import { Zap, ShieldCheck, ShieldAlert, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type ValidationMode = 'quick' | 'standard' | 'thorough';

interface ValidationModesProps {
  selected: ValidationMode;
  onChange: (mode: ValidationMode) => void;
}

const modeConfig = {
  quick: {
    label: 'Quick',
    duration: '10s',
    icon: <Zap className="h-5 w-5" />,
    description: 'Basic syntax & MX checks',
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
  },
  standard: {
    label: 'Standard',
    duration: '30s',
    icon: <ShieldCheck className="h-5 w-5" />,
    description: 'Full SMTP handshake',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
  thorough: {
    label: 'Thorough',
    duration: '60s',
    icon: <ShieldAlert className="h-5 w-5" />,
    description: 'Deep deliverability verify',
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
  },
};

export function ValidationModeSelector({
  selected,
  onChange,
}: ValidationModesProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
      {Object.entries(modeConfig).map(([key, config]) => {
        const isSelected = selected === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key as ValidationMode)}
            className={cn(
              'relative flex flex-col items-start p-4 rounded-xl border-2 transition-all duration-200 text-left group',
              isSelected
                ? 'border-primary bg-primary/5 shadow-md'
                : 'border-muted bg-card hover:border-primary/30 hover:shadow-sm'
            )}
          >
            <div
              className={cn(
                'p-2 rounded-lg mb-3 transition-colors',
                isSelected
                  ? 'bg-primary text-primary-foreground'
                  : cn(config.bgColor, config.color)
              )}
            >
              {config.icon}
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">{config.label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted font-medium text-muted-foreground">
                  {config.duration}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-tight">
                {config.description}
              </p>
            </div>

            {isSelected && (
              <div className="absolute top-3 right-3 h-5 w-5 bg-primary rounded-full flex items-center justify-center animate-in zoom-in duration-300">
                <Check className="h-3 w-3 text-primary-foreground" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
