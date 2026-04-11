import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProxyList } from './proxy-list';
import { ProxyConfig } from '@/hooks/use-settings';

describe('ProxyList', () => {
  const mockProxies: ProxyConfig[] = [
    { host: '192.168.1.1', port: 8080 },
    { host: '10.0.0.1', port: 1080, username: 'user', password: 'pass' },
  ];

  const mockHandlers = {
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders empty state when no proxies', () => {
      render(<ProxyList proxies={[]} {...mockHandlers} />);
      expect(screen.getByText('No proxies configured')).toBeInTheDocument();
    });

    it('renders list of proxies', () => {
      render(<ProxyList proxies={mockProxies} {...mockHandlers} />);
      expect(screen.getByText('192.168.1.1:8080')).toBeInTheDocument();
      expect(screen.getByText('10.0.0.1:1080')).toBeInTheDocument();
    });

    it('shows authenticated indicator for proxies with credentials', () => {
      render(<ProxyList proxies={mockProxies} {...mockHandlers} />);
      expect(screen.getByText('authenticated')).toBeInTheDocument();
    });

    it('shows proxy count', () => {
      render(<ProxyList proxies={mockProxies} {...mockHandlers} />);
      expect(screen.getByText('2 configured')).toBeInTheDocument();
    });
  });

  describe('add proxy validation', () => {
    it('accepts valid host:port format', async () => {
      render(<ProxyList proxies={[]} {...mockHandlers} />);
      const input = screen.getByPlaceholderText(/host:port or socks5/);
      fireEvent.change(input, { target: { value: '192.168.1.1:8080' } });
      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(mockHandlers.onAdd).toHaveBeenCalledWith({
          host: '192.168.1.1',
          port: 8080,
        });
      });
    });

    it('accepts valid socks5://user:pass@host:port format', async () => {
      render(<ProxyList proxies={[]} {...mockHandlers} />);
      const input = screen.getByPlaceholderText(/host:port or socks5/);
      fireEvent.change(input, {
        target: { value: 'socks5://myuser:mypass@proxy.example.com:1080' },
      });
      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(mockHandlers.onAdd).toHaveBeenCalledWith({
          host: 'proxy.example.com',
          port: 1080,
          username: 'myuser',
          password: 'mypass',
        });
      });
    });

    it('accepts socks5://host:port format without credentials', async () => {
      render(<ProxyList proxies={[]} {...mockHandlers} />);
      const input = screen.getByPlaceholderText(/host:port or socks5/);
      fireEvent.change(input, {
        target: { value: 'socks5://192.168.1.1:1080' },
      });
      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(mockHandlers.onAdd).toHaveBeenCalledWith({
          host: '192.168.1.1',
          port: 1080,
        });
      });
    });

    it('rejects invalid format - missing port', async () => {
      render(<ProxyList proxies={[]} {...mockHandlers} />);
      const input = screen.getByPlaceholderText(/host:port or socks5/);
      fireEvent.change(input, { target: { value: '192.168.1.1' } });
      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(screen.getByText(/invalid.*format/i)).toBeInTheDocument();
      });
      expect(mockHandlers.onAdd).not.toHaveBeenCalled();
    });

    it('rejects invalid format - invalid port', async () => {
      render(<ProxyList proxies={[]} {...mockHandlers} />);
      const input = screen.getByPlaceholderText(/host:port or socks5/);
      fireEvent.change(input, { target: { value: '192.168.1.1:99999' } });
      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(screen.getByText(/invalid.*port/i)).toBeInTheDocument();
      });
      expect(mockHandlers.onAdd).not.toHaveBeenCalled();
    });

    it('rejects invalid format - empty input', async () => {
      render(<ProxyList proxies={[]} {...mockHandlers} />);
      // Add button should be disabled when input is empty
      const addButton = screen.getByRole('button', { name: /add/i });
      expect(addButton).toBeDisabled();
      expect(mockHandlers.onAdd).not.toHaveBeenCalled();
    });

    it('rejects duplicate proxy', async () => {
      render(
        <ProxyList
          proxies={[{ host: '192.168.1.1', port: 8080 }]}
          {...mockHandlers}
        />
      );
      const input = screen.getByPlaceholderText(/host:port or socks5/);
      fireEvent.change(input, { target: { value: '192.168.1.1:8080' } });
      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(screen.getByText(/already exists/i)).toBeInTheDocument();
      });
      expect(mockHandlers.onAdd).not.toHaveBeenCalled();
    });

    it('clears error when input changes', async () => {
      render(<ProxyList proxies={[]} {...mockHandlers} />);
      const input = screen.getByPlaceholderText(/host:port or socks5/);

      // Trigger error
      fireEvent.change(input, { target: { value: 'invalid' } });
      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(screen.getByText(/invalid.*format/i)).toBeInTheDocument();
      });

      // Change input to clear error
      fireEvent.change(input, { target: { value: '192.168.1.1:8080' } });

      await waitFor(() => {
        expect(screen.queryByText(/invalid.*format/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('delete proxy', () => {
    it('shows confirmation dialog when delete is clicked', async () => {
      render(<ProxyList proxies={mockProxies} {...mockHandlers} />);
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      fireEvent.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/remove proxy/i)).toBeInTheDocument();
      });
    });

    it('calls onDelete when confirmed', async () => {
      render(<ProxyList proxies={mockProxies} {...mockHandlers} />);
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      fireEvent.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/remove proxy/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));

      await waitFor(() => {
        expect(mockHandlers.onDelete).toHaveBeenCalledWith(0);
      });
    });

    it('cancels delete when cancel is clicked', async () => {
      render(<ProxyList proxies={mockProxies} {...mockHandlers} />);
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      fireEvent.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/remove proxy/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByText(/remove proxy/i)).not.toBeInTheDocument();
      });
      expect(mockHandlers.onDelete).not.toHaveBeenCalled();
    });
  });

  describe('edit proxy', () => {
    it('shows edit dialog when edit is clicked', async () => {
      render(<ProxyList proxies={mockProxies} {...mockHandlers} />);
      const editButtons = screen.getAllByRole('button', { name: /edit/i });
      fireEvent.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/edit proxy/i)).toBeInTheDocument();
      });
    });

    it('populates edit form with current values', async () => {
      render(<ProxyList proxies={mockProxies} {...mockHandlers} />);
      const editButtons = screen.getAllByRole('button', { name: /edit/i });
      fireEvent.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByDisplayValue('192.168.1.1')).toBeInTheDocument();
        expect(screen.getByDisplayValue('8080')).toBeInTheDocument();
      });
    });

    it('calls onUpdate when save is clicked', async () => {
      render(<ProxyList proxies={mockProxies} {...mockHandlers} />);
      const editButtons = screen.getAllByRole('button', { name: /edit/i });
      fireEvent.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByDisplayValue('8080')).toBeInTheDocument();
      });

      const portInput = screen.getByDisplayValue('8080');
      fireEvent.change(portInput, { target: { value: '9090' } });

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockHandlers.onUpdate).toHaveBeenCalledWith(0, {
          host: '192.168.1.1',
          port: 9090,
        });
      });
    });

    it('cancels edit when cancel is clicked', async () => {
      render(<ProxyList proxies={mockProxies} {...mockHandlers} />);
      const editButtons = screen.getAllByRole('button', { name: /edit/i });
      fireEvent.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/edit proxy/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByText(/edit proxy/i)).not.toBeInTheDocument();
      });
      expect(mockHandlers.onUpdate).not.toHaveBeenCalled();
    });
  });

  describe('bulk add', () => {
    it('adds multiple proxies from textarea', async () => {
      render(<ProxyList proxies={[]} {...mockHandlers} />);

      // Click bulk add toggle (button has text "Bulk")
      fireEvent.click(screen.getByRole('button', { name: /bulk/i }));

      const textarea = screen.getByPlaceholderText(/one proxy per line/i);
      fireEvent.change(textarea, {
        target: {
          value:
            '192.168.1.1:8080\nsocks5://user:pass@10.0.0.1:1080\ninvalid-entry',
        },
      });

      fireEvent.click(screen.getByRole('button', { name: /add all/i }));

      await waitFor(() => {
        expect(mockHandlers.onAdd).toHaveBeenCalledTimes(2);
        expect(mockHandlers.onAdd).toHaveBeenNthCalledWith(1, {
          host: '192.168.1.1',
          port: 8080,
        });
        expect(mockHandlers.onAdd).toHaveBeenNthCalledWith(2, {
          host: '10.0.0.1',
          port: 1080,
          username: 'user',
          password: 'pass',
        });
      });
    });
  });
});
