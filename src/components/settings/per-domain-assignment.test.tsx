import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PerDomainAssignment } from './per-domain-assignment';
import { ProxyConfig } from '@/hooks/use-settings';

describe('PerDomainAssignment', () => {
  const mockProxies: ProxyConfig[] = [
    { host: '192.168.1.1', port: 8080 },
    { host: '10.0.0.1', port: 1080, username: 'user', password: 'pass' },
    { host: 'proxy.example.com', port: 3128 },
  ];

  const mockHandlers = {
    onAssign: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders all supported domains (Gmail, Yahoo, Hotmail)', () => {
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={{}}
          {...mockHandlers}
        />
      );
      expect(screen.getByText('Gmail')).toBeInTheDocument();
      expect(screen.getByText('Yahoo')).toBeInTheDocument();
      expect(screen.getByText('Hotmail')).toBeInTheDocument();
    });

    it('renders dropdowns for each domain', () => {
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={{}}
          {...mockHandlers}
        />
      );
      const dropdowns = screen.getAllByRole('combobox');
      expect(dropdowns).toHaveLength(3);
    });

    it('renders default option in each dropdown', () => {
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={{}}
          {...mockHandlers}
        />
      );
      const defaultOptions = screen.getAllByText('Default (rotation)');
      expect(defaultOptions).toHaveLength(3);
    });

    it('renders all available proxies in each dropdown', () => {
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={{}}
          {...mockHandlers}
        />
      );
      // Each proxy should appear in each dropdown (3 proxies x 3 dropdowns = 9 total)
      expect(screen.getAllByText('192.168.1.1:8080')).toHaveLength(3);
      expect(screen.getAllByText('10.0.0.1:1080 (auth)')).toHaveLength(3);
      expect(screen.getAllByText('proxy.example.com:3128')).toHaveLength(3);
    });

    it('shows fallback message for unassigned domains', () => {
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={{}}
          {...mockHandlers}
        />
      );
      expect(
        screen.getByText(/Unassigned domains will use the default rotation/i)
      ).toBeInTheDocument();
    });
  });

  describe('current assignments display', () => {
    it('shows assigned proxy badge when domain has assignment', () => {
      const assignments = {
        'gmail.com': '192.168.1.1:8080',
      };
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={assignments}
          {...mockHandlers}
        />
      );
      // Should show badge for Gmail (only one visible, the others don't have badges)
      const badges = screen.getAllByText('192.168.1.1:8080');
      // Badge + 3 dropdown options = 4 total
      expect(badges).toHaveLength(4);
    });

    it('selects correct option when domain has assignment', () => {
      const assignments = {
        'yahoo.com': '10.0.0.1:1080',
      };
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={assignments}
          {...mockHandlers}
        />
      );
      const yahooDropdown = screen.getByLabelText('Select proxy for Yahoo');
      expect(yahooDropdown).toHaveValue('10.0.0.1:1080');
    });

    it('handles case-insensitive domain lookup', () => {
      const assignments = {
        'gmail.com': '192.168.1.1:8080', // stored in lowercase (as backend does)
      };
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={assignments}
          {...mockHandlers}
        />
      );
      const gmailDropdown = screen.getByLabelText('Select proxy for Gmail');
      expect(gmailDropdown).toHaveValue('192.168.1.1:8080');
    });

    it('shows empty selection for unassigned domains', () => {
      const assignments = {
        'gmail.com': '192.168.1.1:8080',
      };
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={assignments}
          {...mockHandlers}
        />
      );
      const yahooDropdown = screen.getByLabelText('Select proxy for Yahoo');
      expect(yahooDropdown).toHaveValue('');
    });
  });

  describe('assignment changes', () => {
    it('calls onAssign when selecting a proxy for a domain', () => {
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={{}}
          {...mockHandlers}
        />
      );
      const gmailDropdown = screen.getByLabelText('Select proxy for Gmail');
      fireEvent.change(gmailDropdown, { target: { value: '192.168.1.1:8080' } });

      expect(mockHandlers.onAssign).toHaveBeenCalledWith('gmail.com', '192.168.1.1:8080');
    });

    it('calls onAssign with null when selecting default option', () => {
      const assignments = {
        'gmail.com': '192.168.1.1:8080',
      };
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={assignments}
          {...mockHandlers}
        />
      );
      const gmailDropdown = screen.getByLabelText('Select proxy for Gmail');
      fireEvent.change(gmailDropdown, { target: { value: '' } });

      expect(mockHandlers.onAssign).toHaveBeenCalledWith('gmail.com', null);
    });

    it('allows different proxies for different domains', () => {
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={{}}
          {...mockHandlers}
        />
      );

      // Assign proxy to Gmail
      const gmailDropdown = screen.getByLabelText('Select proxy for Gmail');
      fireEvent.change(gmailDropdown, { target: { value: '192.168.1.1:8080' } });

      // Assign different proxy to Yahoo
      const yahooDropdown = screen.getByLabelText('Select proxy for Yahoo');
      fireEvent.change(yahooDropdown, { target: { value: '10.0.0.1:1080' } });

      expect(mockHandlers.onAssign).toHaveBeenCalledTimes(2);
      expect(mockHandlers.onAssign).toHaveBeenNthCalledWith(1, 'gmail.com', '192.168.1.1:8080');
      expect(mockHandlers.onAssign).toHaveBeenNthCalledWith(2, 'yahoo.com', '10.0.0.1:1080');
    });
  });

  describe('disabled state', () => {
    it('disables all dropdowns when disabled prop is true', () => {
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={{}}
          disabled={true}
          {...mockHandlers}
        />
      );
      const dropdowns = screen.getAllByRole('combobox');
      dropdowns.forEach((dropdown) => {
        expect(dropdown).toBeDisabled();
      });
    });

    it('enables all dropdowns when disabled prop is false', () => {
      render(
        <PerDomainAssignment
          proxies={mockProxies}
          domainAssignments={{}}
          disabled={false}
          {...mockHandlers}
        />
      );
      const dropdowns = screen.getAllByRole('combobox');
      dropdowns.forEach((dropdown) => {
        expect(dropdown).not.toBeDisabled();
      });
    });
  });

  describe('empty proxy list', () => {
    it('shows only default option when no proxies available', () => {
      render(
        <PerDomainAssignment
          proxies={[]}
          domainAssignments={{}}
          {...mockHandlers}
        />
      );
      const defaultOptions = screen.getAllByText('Default (rotation)');
      expect(defaultOptions).toHaveLength(3);
      // No proxy options should be present
      expect(screen.queryByText('(auth)')).not.toBeInTheDocument();
    });
  });
});
