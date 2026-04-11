import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from './keyboard-shortcuts';

describe('useKeyboardShortcuts', () => {
  const handlers = {
    startValidation: vi.fn(),
    pauseValidation: vi.fn(),
    stopValidation: vi.fn(),
    exportCSV: vi.fn(),
    openSettings: vi.fn(),
    openHistory: vi.fn(),
    openValidation: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register event listener on mount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderHook(() => useKeyboardShortcuts(handlers));
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('should remove event listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('should trigger startValidation on Ctrl+Enter', () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
    });

    window.dispatchEvent(event);
    expect(handlers.startValidation).toHaveBeenCalled();
  });

  it('should trigger exportCSV on Ctrl+e', () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    const event = new KeyboardEvent('keydown', {
      key: 'e',
      ctrlKey: true,
      bubbles: true,
    });

    window.dispatchEvent(event);
    expect(handlers.exportCSV).toHaveBeenCalled();
  });

  it('should trigger stopValidation on Escape', () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    });

    window.dispatchEvent(event);
    expect(handlers.stopValidation).toHaveBeenCalled();
  });

  it('should not trigger handler if modifier key is missing for Ctrl shortcuts', () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    const event = new KeyboardEvent('keydown', {
      key: 'e', // Missing Ctrl
      bubbles: true,
    });

    window.dispatchEvent(event);
    expect(handlers.exportCSV).not.toHaveBeenCalled();
  });

  it('should respect Meta key (Command) for Mac users', () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
    });

    window.dispatchEvent(event);
    expect(handlers.startValidation).toHaveBeenCalled();
  });
});
