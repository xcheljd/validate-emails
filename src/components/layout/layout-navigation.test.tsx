import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './sidebar';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as useSettingsHook from '@/hooks/use-settings';
import type { AppSettings } from '@/hooks/use-settings';

// Mock useSettings
vi.mock('@/hooks/use-settings', () => ({
  useSettings: vi.fn(),
  SettingsProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const partialSettings = {
  sidebarCollapsed: false,
} satisfies Partial<AppSettings>;

let mockUpdateSettings: ReturnType<typeof vi.fn>;

function mockUseSettings(overrides: Partial<AppSettings> = {}) {
  const settings = { ...partialSettings, ...overrides } as AppSettings;
  mockUpdateSettings = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock requires full AppSettings but sidebar only reads sidebarCollapsed
  (useSettingsHook.useSettings as any).mockReturnValue({
    settings,
    updateSettings: mockUpdateSettings,
  });
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSettings();
  });

  describe('Navigation', () => {
    it('calls onNavigate with "validation" when Validation is clicked', () => {
      const handleNavigate = vi.fn();
      render(<Sidebar currentView="history" onNavigate={handleNavigate} />);
      fireEvent.click(screen.getByText('Validation'));
      expect(handleNavigate).toHaveBeenCalledWith('validation');
    });

    it('calls onNavigate with "history" when History is clicked', () => {
      const handleNavigate = vi.fn();
      render(<Sidebar currentView="validation" onNavigate={handleNavigate} />);
      fireEvent.click(screen.getByText('History'));
      expect(handleNavigate).toHaveBeenCalledWith('history');
    });

    it('shows active state for current view', () => {
      const handleNavigate = vi.fn();
      render(<Sidebar currentView="validation" onNavigate={handleNavigate} />);
      const validationBtn = screen.getByRole('button', { name: /Validation/i });
      expect(validationBtn.className).toContain('bg-secondary');
    });
  });

  describe('Collapsible Functionality', () => {
    it('shows labels when expanded', () => {
      render(<Sidebar currentView="validation" onNavigate={vi.fn()} />);
      expect(screen.getByText('ReachCheck')).toBeInTheDocument();
      expect(screen.getByText('Validation')).toBeInTheDocument();
      expect(screen.getByText('History')).toBeInTheDocument();
    });

    it('hides labels when collapsed', () => {
      mockUseSettings({ sidebarCollapsed: true });

      render(<Sidebar currentView="validation" onNavigate={vi.fn()} />);
      expect(screen.queryByText('ReachCheck')).not.toBeInTheDocument();
      expect(screen.queryByText('Validation')).not.toBeInTheDocument();
      expect(screen.queryByText('History')).not.toBeInTheDocument();
    });

    it('calls updateSettings when toggle button is clicked', () => {
      render(<Sidebar currentView="validation" onNavigate={vi.fn()} />);
      const toggleBtn = screen.getByTitle('Collapse Sidebar');
      fireEvent.click(toggleBtn);
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        sidebarCollapsed: true,
      });
    });

    it('shows tooltips (via title) when collapsed', () => {
      mockUseSettings({ sidebarCollapsed: true });

      render(<Sidebar currentView="validation" onNavigate={vi.fn()} />);
      expect(screen.getByTitle('Validation')).toBeInTheDocument();
      expect(screen.getByTitle('History')).toBeInTheDocument();
      expect(screen.getByTitle('Expand Sidebar')).toBeInTheDocument();
    });
  });
});
