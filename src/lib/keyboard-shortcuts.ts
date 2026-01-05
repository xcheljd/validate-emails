import { useEffect } from 'react';

export type ShortcutAction = 
  | 'startValidation'
  | 'pauseValidation'
  | 'resumeValidation'
  | 'stopValidation'
  | 'exportCSV'
  | 'openSettings'
  | 'openHistory'
  | 'openValidation';

export const keyboardShortcuts: Record<string, ShortcutAction> = {
  'Ctrl+Enter': 'startValidation',
  'Ctrl+p': 'pauseValidation',
  'Ctrl+r': 'resumeValidation',
  'Escape': 'stopValidation',
  'Ctrl+e': 'exportCSV',
  'Ctrl+,': 'openSettings',
  'Ctrl+h': 'openHistory',
};

export interface ShortcutHandlers {
  startValidation?: () => void;
  pauseValidation?: () => void;
  resumeValidation?: () => void;
  stopValidation?: () => void;
  exportCSV?: () => void;
  openSettings?: () => void;
  openHistory?: () => void;
  openValidation?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMod = event.ctrlKey || event.metaKey;
      let key = event.key;
      
      // Normalize key
      if (key === 'Enter') key = 'Enter';
      else if (key === 'Escape') key = 'Escape';
      else key = key.toLowerCase();

      let shortcut = '';
      if (isMod && key === 'Enter') shortcut = 'Ctrl+Enter';
      else if (isMod && key === 'p') shortcut = 'Ctrl+p';
      else if (isMod && key === 'r') shortcut = 'Ctrl+r';
      else if (isMod && key === 'e') shortcut = 'Ctrl+e';
      else if (isMod && key === ',') shortcut = 'Ctrl+,';
      else if (isMod && key === 'h') shortcut = 'Ctrl+h';
      else if (key === 'Escape') shortcut = 'Escape';

      if (shortcut && keyboardShortcuts[shortcut]) {
        const action = keyboardShortcuts[shortcut];
        const handler = handlers[action];
        
        if (handler) {
          event.preventDefault();
          handler();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers]);
}