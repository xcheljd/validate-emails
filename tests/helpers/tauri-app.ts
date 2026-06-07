import { type Browser, type Page } from '@playwright/test';
import { TauriProcessManager, createTauriTest } from '@srsholmes/tauri-playwright';
import { resolve } from 'path';

/**
 * Tauri App Launch and Teardown Helpers
 *
 * Provides utilities to launch a Tauri application in development mode
 * and connect Playwright to its WebView for E2E testing.
 */

let tauriProcess: TauriProcessManager | null = null;
let browser: Browser | null = null;
let page: Page | null = null;

/**
 * Launch the Tauri application in development mode and connect Playwright.
 *
 * @param options - Configuration options for launching the app
 * @param options.dev - Whether to launch in dev mode (default: true)
 * @param options.timeout - Launch timeout in milliseconds (default: 60000)
 * @returns Promise resolving to the Playwright Page connected to the Tauri WebView
 */
export async function launchApp(options: {
  dev?: boolean;
  timeout?: number;
} = {}): Promise<Page> {
  const { dev = true, timeout = 60000 } = options;

  // Initialize Tauri process manager
  const appPath = dev
    ? undefined // Use dev mode
    : resolve(__dirname, '../../src-tauri/target/release/tauri-app');

  tauriProcess = new TauriProcessManager({
    command: 'cargo',
    args: dev ? ['tauri', 'dev'] : [],
    cwd: process.cwd(),
    startTimeout: Math.ceil(timeout / 1000),
    // For built app, use the binary directly
    ...(!dev && { appPath }),
  });

  // Start the Tauri process
  await tauriProcess.start();

  // Wait for the socket to be ready
  await tauriProcess.waitForSocket(timeout);

  // Connect to the Tauri WebView
  const tauriTest = createTauriTest();
  await tauriTest.connect();

  // Get the page from the driver
  page = tauriTest.page;

  // Wait for the page to be ready
  await page.waitForLoadState('domcontentloaded', { timeout });

  return page;
}

/**
 * Close the Tauri application and clean up resources.
 */
export async function closeApp(): Promise<void> {
  if (page) {
    await page.close().catch(() => {});
    page = null;
  }

  if (tauriProcess) {
    tauriProcess.stop();
    tauriProcess = null;
  }

  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

/**
 * Get the current Tauri process manager instance.
 * Useful for accessing driver-specific functionality.
 */
export function getTauriProcess(): TauriProcessManager | null {
  return tauriProcess;
}

/**
 * Get the current Playwright page instance.
 */
export function getPage(): Page | null {
  return page;
}

/**
 * Get the current browser instance.
 */
export function getBrowser(): Browser | null {
  return browser;
}

/**
 * Wait for a Tauri event to be emitted from the backend.
 *
 * @param eventName - The name of the Tauri event to wait for
 * @param timeout - Timeout in milliseconds (default: 10000)
 * @returns Promise resolving when the event is received
 */
export async function waitForTauriEvent(
  eventName: string,
  timeout = 10000
): Promise<unknown> {
  if (!page) {
    throw new Error('Page not initialized. Call launchApp() first.');
  }

  return page.waitForEvent('console', {
    predicate: (msg) => msg.type() === 'log' && msg.text().includes(eventName),
    timeout,
  });
}

/**
 * Evaluate a function in the Tauri WebView context.
 * Useful for invoking Tauri IPC commands directly.
 */
export async function evaluateInWebView<T>(
  fn: () => Promise<T> | T
): Promise<T> {
  if (!page) {
    throw new Error('Page not initialized. Call launchApp() first.');
  }

  return page.evaluate(fn);
}

export { TauriProcessManager };
export type { Browser, Page };
