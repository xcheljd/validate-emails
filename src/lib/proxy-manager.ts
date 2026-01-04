import { invoke } from '@tauri-apps/api/core';

export interface Proxy {
  ip: string;
  port: number;
  protocol: 'http' | 'socks5';
  anonymity: string;
  uptime: number;
  connectTime: number;
  downloadSpeed: number;
}

export interface ProxyPoolStatus {
  totalProxies: number;
  activeProxy: string | null;
  successRate: number;
  averageSpeed: number;
}

export async function fetchProxies(config: {
  maxPerProxy: number;
  rotationStrategy: string;
  protocol: string;
  minUptime: number;
}): Promise<string> {
  return invoke('fetch_proxies', {
    maxPerProxy: config.maxPerProxy,
    rotationStrategy: config.rotationStrategy,
    protocol: config.protocol,
    minUptime: config.minUptime,
  });
}

export async function getProxyPoolStatus(): Promise<ProxyPoolStatus> {
  return invoke('get_proxy_status');
}

export async function refreshProxyPool(): Promise<string> {
  return invoke('refresh_proxies');
}

export async function clearProxyPool(): Promise<string> {
  return invoke('clear_proxies');
}
