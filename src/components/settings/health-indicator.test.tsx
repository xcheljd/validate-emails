import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  HealthIndicator,
  getHealthColor,
  getHealthLabel,
} from './health-indicator';
import type { ProxyStats } from '@/hooks/use-settings';

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

describe('HealthIndicator', () => {
  it('shows healthy status for high success rate', () => {
    const stats = makeStats({ attempts: 100, successes: 95, failures: 5 });
    render(<HealthIndicator stats={stats} />);

    expect(screen.getByText('95%')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('shows degraded status for medium success rate', () => {
    const stats = makeStats({ attempts: 100, successes: 70, failures: 30 });
    render(<HealthIndicator stats={stats} />);

    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('shows failed status for low success rate', () => {
    const stats = makeStats({ attempts: 100, successes: 30, failures: 70, consecutiveFailures: 3 });
    render(<HealthIndicator stats={stats} />);

    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows healthy status for new proxy with no attempts', () => {
    const stats = makeStats();
    render(<HealthIndicator stats={stats} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('shows bad proxy indicator when consecutive failures >= 3', () => {
    const stats = makeStats({ attempts: 10, successes: 5, failures: 5, consecutiveFailures: 3 });
    render(<HealthIndicator stats={stats} showBadIndicator />);

    expect(screen.getByText('Bad')).toBeInTheDocument();
  });

  it('hides bad proxy indicator when not requested', () => {
    const stats = makeStats({ attempts: 10, successes: 5, failures: 5, consecutiveFailures: 3 });
    render(<HealthIndicator stats={stats} />);

    expect(screen.queryByText('Bad')).not.toBeInTheDocument();
  });

  it('applies compact mode', () => {
    const stats = makeStats({ attempts: 100, successes: 95, failures: 5 });
    render(<HealthIndicator stats={stats} compact />);

    // Compact mode should still show percentage
    expect(screen.getByText('95%')).toBeInTheDocument();
  });
});

describe('getHealthColor', () => {
  it('returns green for healthy status', () => {
    expect(getHealthColor('healthy')).toContain('green');
  });

  it('returns yellow for degraded status', () => {
    expect(getHealthColor('degraded')).toContain('yellow');
  });

  it('returns red for failed status', () => {
    expect(getHealthColor('failed')).toContain('red');
  });
});

describe('getHealthLabel', () => {
  it('returns correct label for healthy', () => {
    expect(getHealthLabel('healthy')).toBe('Healthy');
  });

  it('returns correct label for degraded', () => {
    expect(getHealthLabel('degraded')).toBe('Degraded');
  });

  it('returns correct label for failed', () => {
    expect(getHealthLabel('failed')).toBe('Failed');
  });
});
