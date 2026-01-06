import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsContent } from './settings-content';
import { describe, it, expect, vi } from 'vitest';

describe('SettingsContent', () => {
  it('renders validation settings by default', () => {
    render(<SettingsContent />);
    expect(screen.getByText('Default Validation Mode')).toBeInTheDocument();
  });

  it('switches to proxy tab', () => {
    render(<SettingsContent />);
    fireEvent.click(screen.getByText('Proxy'));
    expect(screen.getByText('Enable Proxy Rotation')).toBeInTheDocument();
  });

  it('switches to history tab', () => {
    render(<SettingsContent />);
    fireEvent.click(screen.getByText('History'));
    expect(screen.getByText('Session Retention (days)')).toBeInTheDocument();
  });

  it('calls onClose when save is clicked', () => {
    const handleClose = vi.fn();
    render(<SettingsContent onClose={handleClose} />);
    fireEvent.click(screen.getByText('Save Settings'));
    expect(handleClose).toHaveBeenCalled();
  });
});
