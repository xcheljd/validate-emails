import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProxyHealthDashboard } from './proxy-health-dashboard';
import type { ProxyConfig, ProxyStats, AutoDisableThreshold } from '@/hooks/use-settings';

// Mock recharts to avoid rendering issues in tests
vi.mock('recharts', () => ({
  BarChart: () => <div data-testid="bar-chart">BarChart</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Cell: () => null,
}));

const mockProxy1: ProxyConfig = { host: '192.168.1.1', port: 8080 };
const mockProxy2: ProxyConfig = { host: '192.168.1.2', port: 8080 };
const mockProxy3: ProxyConfig = { host: '192.168.1.3', port: 8080 };

const makeStats = (overrides: Partial<ProxyStats> = {}): ProxyStats => ({
  attempts: 0,
  successes: 0,
  failures: 0,
  consecutiveFailures: 0,
  cooldownUntil: null,
  avgDurationMs: 0,
  autoDisabled: false,
  ...overrides,
});

const defaultThreshold: AutoDisableThreshold = {
  successRatePercent: 20,
  minAttempts: 10,
};

describe('ProxyHealthDashboard', () => {
  it('renders no proxies message when empty', () => {
    render(
      <ProxyHealthDashboard
        proxies={[]}
        proxyStats={{}}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={vi.fn()}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    expect(screen.getByText('Proxy Health Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/No proxies configured/)).toBeInTheDocument();
  });

  it('renders summary cards with correct counts', () => {
    const stats: Record<string, ProxyStats> = {
      '192.168.1.1:8080': makeStats({ attempts: 100, successes: 95, failures: 5 }),
      '192.168.1.2:8080': makeStats({ attempts: 100, successes: 70, failures: 30 }),
      '192.168.1.3:8080': makeStats({ attempts: 100, successes: 20, failures: 80 }),
    };

    render(
      <ProxyHealthDashboard
        proxies={[mockProxy1, mockProxy2, mockProxy3]}
        proxyStats={stats}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={vi.fn()}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    // Total proxies = 3
    expect(screen.getByText('Total Proxies')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // Summary card labels should exist (at least once)
    expect(screen.getAllByText('Healthy').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Degraded').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(1);
  });

  it('renders per-proxy table with latency column', () => {
    const stats: Record<string, ProxyStats> = {
      '192.168.1.1:8080': makeStats({
        attempts: 10,
        successes: 10,
        failures: 0,
        avgDurationMs: 150.5,
      }),
    };

    render(
      <ProxyHealthDashboard
        proxies={[mockProxy1]}
        proxyStats={stats}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={vi.fn()}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    expect(screen.getByText('Latency')).toBeInTheDocument();
    expect(screen.getByText('151 ms')).toBeInTheDocument(); // Math.round(150.5)
  });

  it('shows N/A for latency when no stats', () => {
    render(
      <ProxyHealthDashboard
        proxies={[mockProxy1]}
        proxyStats={{}}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={vi.fn()}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    const cells = screen.getAllByText('N/A');
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it('shows success rate bar chart', () => {
    const stats: Record<string, ProxyStats> = {
      '192.168.1.1:8080': makeStats({ attempts: 10, successes: 8, failures: 2 }),
    };

    render(
      <ProxyHealthDashboard
        proxies={[mockProxy1]}
        proxyStats={stats}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={vi.fn()}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('shows auto-disabled badge for auto-disabled proxies', () => {
    const stats: Record<string, ProxyStats> = {
      '192.168.1.1:8080': makeStats({
        attempts: 10,
        successes: 1,
        failures: 9,
        autoDisabled: true,
      }),
    };

    render(
      <ProxyHealthDashboard
        proxies={[mockProxy1]}
        proxyStats={stats}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={vi.fn()}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    expect(screen.getByText('Auto-disabled')).toBeInTheDocument();
  });

  it('shows Re-enable button for auto-disabled proxies', () => {
    const stats: Record<string, ProxyStats> = {
      '192.168.1.1:8080': makeStats({
        attempts: 10,
        successes: 1,
        failures: 9,
        autoDisabled: true,
      }),
    };

    render(
      <ProxyHealthDashboard
        proxies={[mockProxy1]}
        proxyStats={stats}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={vi.fn()}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    expect(screen.getByText('Re-enable')).toBeInTheDocument();
  });

  it('does not show Re-enable button for healthy proxies', () => {
    const stats: Record<string, ProxyStats> = {
      '192.168.1.1:8080': makeStats({
        attempts: 10,
        successes: 10,
        failures: 0,
      }),
    };

    render(
      <ProxyHealthDashboard
        proxies={[mockProxy1]}
        proxyStats={stats}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={vi.fn()}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    expect(screen.queryByText('Re-enable')).not.toBeInTheDocument();
  });

  it('calls onReEnableProxy when Re-enable button clicked', async () => {
    const handleReEnable = vi.fn();
    const stats: Record<string, ProxyStats> = {
      '192.168.1.1:8080': makeStats({
        attempts: 10,
        successes: 1,
        failures: 9,
        autoDisabled: true,
      }),
    };

    render(
      <ProxyHealthDashboard
        proxies={[mockProxy1]}
        proxyStats={stats}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={handleReEnable}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Re-enable'));
    expect(handleReEnable).toHaveBeenCalledWith('192.168.1.1:8080');
  });

  it('renders auto-disable threshold settings with default values', () => {
    render(
      <ProxyHealthDashboard
        proxies={[mockProxy1]}
        proxyStats={{}}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={vi.fn()}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    expect(screen.getByText('Auto-Disable Threshold')).toBeInTheDocument();
    expect(screen.getByText('Save Threshold')).toBeInTheDocument();
  });

  it('renders health status badges correctly', () => {
    const stats: Record<string, ProxyStats> = {
      '192.168.1.1:8080': makeStats({ attempts: 100, successes: 95, failures: 5 }), // Healthy
      '192.168.1.2:8080': makeStats({ attempts: 100, successes: 60, failures: 40 }), // Degraded
      '192.168.1.3:8080': makeStats({ attempts: 100, successes: 20, failures: 80 }), // Failed
    };

    render(
      <ProxyHealthDashboard
        proxies={[mockProxy1, mockProxy2, mockProxy3]}
        proxyStats={stats}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={vi.fn()}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    const healthyBadges = screen.getAllByText('Healthy');
    const degradedBadges = screen.getAllByText('Degraded');
    const failedBadges = screen.getAllByText('Failed');

    expect(healthyBadges.length).toBeGreaterThanOrEqual(1);
    expect(degradedBadges.length).toBeGreaterThanOrEqual(1);
    expect(failedBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders per-proxy table with success rate column', () => {
    const stats: Record<string, ProxyStats> = {
      '192.168.1.1:8080': makeStats({ attempts: 100, successes: 80, failures: 20 }),
    };

    render(
      <ProxyHealthDashboard
        proxies={[mockProxy1]}
        proxyStats={stats}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={vi.fn()}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    expect(screen.getByText('Success Rate')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('renders per-proxy table with attempts column', () => {
    const stats: Record<string, ProxyStats> = {
      '192.168.1.1:8080': makeStats({ attempts: 42, successes: 40, failures: 2 }),
    };

    render(
      <ProxyHealthDashboard
        proxies={[mockProxy1]}
        proxyStats={stats}
        autoDisableThreshold={defaultThreshold}
        onReEnableProxy={vi.fn()}
        onSetAutoDisableThreshold={vi.fn()}
      />
    );

    expect(screen.getByText('Attempts')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
