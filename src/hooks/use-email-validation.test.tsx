import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEmailValidation } from './use-email-validation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock Tauri
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const queryClient = new QueryClient();
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useEmailValidation', () => {
  it('should initialize with empty results', () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });
    expect(result.current.results).toEqual([]);
    expect(result.current.isProcessing).toBe(false);
  });

  it('should set isProcessing to true when validation starts', () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });
    
    act(() => {
      result.current.startValidation(['test@example.com']);
    });

        expect(result.current.isProcessing).toBe(true);

        expect(result.current.status).toBe('processing');

      });

    

      it('should transition to paused state when pause is called', async () => {

        const { result } = renderHook(() => useEmailValidation(), { wrapper });

        

        act(() => {

          result.current.startValidation(['test@example.com']);

        });

    

        await act(async () => {

          await result.current.pauseValidation();

        });

    

        expect(result.current.status).toBe('paused');

        expect(result.current.isProcessing).toBe(false);

      });

    

      it('should transition to idle state when stop is called', async () => {

        const { result } = renderHook(() => useEmailValidation(), { wrapper });

        

        act(() => {

          result.current.startValidation(['test@example.com']);

        });

    

        await act(async () => {

          await result.current.stopValidation();

        });

    

        expect(result.current.status).toBe('idle');

        expect(result.current.isProcessing).toBe(false);

      });

    });

    