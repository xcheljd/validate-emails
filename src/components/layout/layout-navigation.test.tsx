import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './sidebar';
import { describe, it, expect, vi } from 'vitest';

describe('Sidebar Navigation', () => {
  it('calls onNavigate with "validation" when Validation is clicked', () => {
    const handleNavigate = vi.fn();
    // @ts-ignore
    render(<Sidebar currentView="history" onNavigate={handleNavigate} />);
    fireEvent.click(screen.getByText('Validation'));
    expect(handleNavigate).toHaveBeenCalledWith('validation');
  });

  it('calls onNavigate with "history" when History is clicked', () => {
    const handleNavigate = vi.fn();
    // @ts-ignore
    render(<Sidebar currentView="validation" onNavigate={handleNavigate} />);
    fireEvent.click(screen.getByText('History'));
    expect(handleNavigate).toHaveBeenCalledWith('history');
  });

  it('shows active state for current view', () => {
     const handleNavigate = vi.fn();
     // @ts-ignore
     render(<Sidebar currentView="validation" onNavigate={handleNavigate} />);
     const validationBtn = screen.getByRole('button', { name: /Validation/i });
     expect(validationBtn.className).toContain('bg-secondary');
  });
});