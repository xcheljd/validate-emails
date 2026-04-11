import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './sidebar';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as useSettingsHook from '@/hooks/use-settings';

// Mock useSettings
vi.mock('@/hooks/use-settings', () => ({
  useSettings: vi.fn(),
  SettingsProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe('Sidebar', () => {
  const mockUpdateSettings = vi.fn();
  const mockSettings = {
    sidebarCollapsed: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useSettingsHook.useSettings as any).mockReturnValue({
      settings: mockSettings,
      updateSettings: mockUpdateSettings,
    });
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
      (useSettingsHook.useSettings as any).mockReturnValue({
        settings: { ...mockSettings, sidebarCollapsed: true },
        updateSettings: mockUpdateSettings,
      });

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
      (useSettingsHook.useSettings as any).mockReturnValue({
        settings: { ...mockSettings, sidebarCollapsed: true },
        updateSettings: mockUpdateSettings,
      });

      render(<Sidebar currentView="validation" onNavigate={vi.fn()} />);
      expect(screen.getByTitle('Validation')).toBeInTheDocument();
      expect(screen.getByTitle('History')).toBeInTheDocument();
      expect(screen.getByTitle('Expand Sidebar')).toBeInTheDocument();
    });
  });
});
