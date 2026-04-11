import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

export function ValidationSettings() {
  const [validationMode, setValidationMode] = useState<
    'quick' | 'standard' | 'thorough'
  >('standard');
  const [concurrency, setConcurrency] = useState(5);
  const [timeout, setTimeout] = useState(30);
  const [maxRetries, setMaxRetries] = useState(3);
  const [autoSaveInterval, setAutoSaveInterval] = useState(10);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Validation Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label htmlFor="validation-mode">Default Validation Mode</Label>
          <select
            id="validation-mode"
            value={validationMode}
            onChange={(e) =>
              setValidationMode(
                e.target.value as 'quick' | 'standard' | 'thorough'
              )
            }
            className="mt-2 w-full p-2 border rounded-md"
          >
            <option value="quick">Quick (10s)</option>
            <option value="standard">Standard (30s)</option>
            <option value="thorough">Thorough (60s)</option>
          </select>
        </div>

        <div>
          <Label htmlFor="concurrency">
            Concurrency: {concurrency} parallel validations
          </Label>
          <input
            id="concurrency"
            type="range"
            min="1"
            max="20"
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </div>

        <div>
          <Label htmlFor="timeout">Timeout: {timeout}s</Label>
          <input
            id="timeout"
            type="range"
            min="10"
            max="120"
            value={timeout}
            onChange={(e) => setTimeout(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </div>

        <div>
          <Label htmlFor="max-retries">Max Retries: {maxRetries}</Label>
          <input
            id="max-retries"
            type="number"
            min="0"
            max="5"
            value={maxRetries}
            onChange={(e) => setMaxRetries(Number(e.target.value))}
            className="mt-2 w-full p-2 border rounded-md"
          />
        </div>

        <div>
          <Label htmlFor="auto-save-interval">
            Auto-Save every {autoSaveInterval} validations
          </Label>
          <input
            id="auto-save-interval"
            type="number"
            min="5"
            max="50"
            value={autoSaveInterval}
            onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
            className="mt-2 w-full p-2 border rounded-md"
          />
        </div>
      </CardContent>
    </Card>
  );
}
