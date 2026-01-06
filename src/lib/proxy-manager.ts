import { invoke } from '@tauri-apps/api/core';

export interface Proxy {
  ip: string;
  port: number;
  protocol: 'http' | 'socks5';
  username?: string;
  password?: string;
}

export interface ProxyPoolStatus {
  total_proxies: number;
  active_proxy: string | null;
  success_rate: number;
  average_speed: number;
}

export async function addProxies(proxies: string[]): Promise<string> {
  return invoke('add_proxies', { proxies });
}

export async function getProxyPoolStatus(): Promise<ProxyPoolStatus> {
  return invoke('get_proxy_status');
}

export async function clearProxyPool(): Promise<string> {
  return invoke('clear_proxies');
}

// Kept for backward compatibility if needed, but mostly unused now
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

export async function refreshProxyPool(): Promise<string> {
  return invoke('refresh_proxies');
}
