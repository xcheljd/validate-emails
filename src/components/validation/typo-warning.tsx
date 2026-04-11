import { AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as typoDatabase from '@/lib/typo-database';

export function TypoWarning({
  email,
  correctedEmail,
}: {
  email: string;
  correctedEmail: string | null;
}) {
  if (!correctedEmail) return null;

  const correction = typoDatabase.suggestCorrection(email);

  if (!correction) return null;

  return (
    <div className="flex items-center gap-2 text-yellow-600 text-sm bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <span>
        Typo detected: <span className="font-semibold">{email}</span> →{' '}
        <span className="font-semibold text-green-600">{correction}</span>
      </span>
      <Button
        variant="outline"
        size="sm"
        className="ml-auto"
        onClick={() => {
          navigator.clipboard.writeText(correction);
        }}
      >
        <Check className="h-3 w-3 mr-1" />
        Copy Corrected
      </Button>
    </div>
  );
}
