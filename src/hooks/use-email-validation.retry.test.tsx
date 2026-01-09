import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEmailValidation } from './use-email-validation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { invoke } from '@tauri-apps/api/core';

// Mock Tauri
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@/lib/notifications', () => ({
  notifyValidationComplete: vi.fn(),
  notifyError: vi.fn(),
}));

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
    }
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useEmailValidation retryUnknowns', () => {
  beforeEach(() => {
      vi.clearAllMocks();
  });

  it('should call revalidate_emails_bulk with unknown emails and their used proxies', async () => {
    const { result } = renderHook(() => useEmailValidation(), { wrapper });

    // 1. Setup initial results with some Unknowns
    const mockResults = [
        { email: 'safe@test.com', result: 'Safe', proxyUsed: '1.1.1.1:80', validationDuration: 100 } as any,
        { email: 'unknown@test.com', result: 'Unknown', proxyUsed: '2.2.2.2:80', validationDuration: 100 } as any,
    ];

    act(() => {
        result.current.setResults(mockResults);
    });

    // 2. Call retryUnknowns
    // @ts-ignore - function not yet implemented
    await act(async () => {
        if (result.current.retryUnknowns) {
            await result.current.retryUnknowns();
        } else {
            throw new Error("retryUnknowns not implemented");
        }
    });

    // 3. Verify invoke was called correctly
    expect(invoke).toHaveBeenCalledWith('revalidate_emails_bulk', expect.objectContaining({
        items: [
            { email: 'unknown@test.com', excluded_proxy: '2.2.2.2:80' }
        ],
        concurrency: expect.any(Number),
        mode: expect.any(String)
    }));
  });
});
