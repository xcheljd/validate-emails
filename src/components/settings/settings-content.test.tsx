import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsContent } from './settings-content';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('SettingsContent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders validation settings by default', () => {
    render(<SettingsContent />);
    expect(screen.getByText('Default Validation Mode')).toBeInTheDocument();
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

describe('ProxySettings Tab', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('switches to proxy tab', () => {
    render(<SettingsContent />);
    fireEvent.click(screen.getByText('Proxy'));
    expect(screen.getByText('Enable Proxy')).toBeInTheDocument();
  });

  it('shows proxy toggle in proxy tab', () => {
    render(<SettingsContent />);
    fireEvent.click(screen.getByText('Proxy'));
    expect(screen.getByRole('switch', { name: /enable proxy/i })).toBeInTheDocument();
  });

  it('shows rotation mode selector in proxy tab', () => {
    render(<SettingsContent />);
    fireEvent.click(screen.getByText('Proxy'));
    expect(screen.getByLabelText('Rotation Mode')).toBeInTheDocument();
  });

  it('shows proxy list placeholder when no proxies configured', () => {
    render(<SettingsContent />);
    fireEvent.click(screen.getByText('Proxy'));
    expect(screen.getByText('No proxies configured')).toBeInTheDocument();
  });

  it('toggles proxy enabled state', () => {
    render(<SettingsContent />);
    fireEvent.click(screen.getByText('Proxy'));
    const toggle = screen.getByRole('switch', { name: /enable proxy/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('disables rotation mode selector when proxy is disabled', () => {
    render(<SettingsContent />);
    fireEvent.click(screen.getByText('Proxy'));
    const select = screen.getByLabelText('Rotation Mode');
    expect(select).toBeDisabled();
  });

  it('enables rotation mode selector when proxy is enabled', () => {
    render(<SettingsContent />);
    fireEvent.click(screen.getByText('Proxy'));
    const toggle = screen.getByRole('switch', { name: /enable proxy/i });
    fireEvent.click(toggle);
    const select = screen.getByLabelText('Rotation Mode');
    expect(select).not.toBeDisabled();
  });

  it('changes rotation mode when selection changes', () => {
    render(<SettingsContent />);
    fireEvent.click(screen.getByText('Proxy'));
    // Enable proxy first
    const toggle = screen.getByRole('switch', { name: /enable proxy/i });
    fireEvent.click(toggle);
    const select = screen.getByLabelText('Rotation Mode');
    fireEvent.change(select, { target: { value: 'automatic' } });
    expect(select).toHaveValue('automatic');
  });

  it('shows correct description for each rotation mode', () => {
    render(<SettingsContent />);
    fireEvent.click(screen.getByText('Proxy'));
    const toggle = screen.getByRole('switch', { name: /enable proxy/i });
    fireEvent.click(toggle);

    // Manual mode (default)
    expect(screen.getByText(/Proxy only changes when you manually select/i)).toBeInTheDocument();

    // Switch to Automatic
    const select = screen.getByLabelText('Rotation Mode');
    fireEvent.change(select, { target: { value: 'automatic' } });
    expect(screen.getByText(/Proxies rotate automatically during validation/i)).toBeInTheDocument();

    // Switch to Per-Domain
    fireEvent.change(select, { target: { value: 'perDomain' } });
    expect(screen.getByText(/Assign specific proxies to Gmail, Yahoo, Hotmail/i)).toBeInTheDocument();
  });
});
