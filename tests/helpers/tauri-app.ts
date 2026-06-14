import { type Browser, type Page } from '@playwright/test';
import { TauriProcessManager, createTauriTest } from '@srsholmes/tauri-playwright';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Tauri App Launch and Teardown Helpers
 *
 * Provides utilities to launch a Tauri application in development mode
 * and connect Playwright to its WebView for E2E testing.
 * Each call to launchApp returns a new instance to support parallel test execution.
 */

export interface TauriAppInstance {
  tauriProcess: TauriProcessManager;
  page: Page;
  browser: Browser | null;
}

/**
 * Launch the Tauri application in development mode and connect Playwright.
 *
 * @param options - Configuration options for launching the app
 * @param options.dev - Whether to launch in dev mode (default: true)
 * @param options.timeout - Launch timeout in milliseconds (default: 60000)
 * @returns Promise resolving to a TauriAppInstance containing the process, page, and browser
 */
export async function launchApp(options: {
  dev?: boolean;
  timeout?: number;
} = {}): Promise<TauriAppInstance> {
  const { dev = true, timeout = 60000 } = options;

  // Initialize Tauri process manager
  const appPath = dev
    ? undefined // Use dev mode
    : resolve(__dirname, '../../src-tauri/target/release/tauri-app');

  const tauriProcess = new TauriProcessManager({
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
  const page = tauriTest.page;

  // Wait for the page to be ready
  await page.waitForLoadState('domcontentloaded', { timeout });

  return { tauriProcess, page, browser: null };
}

/**
 * Close the Tauri application and clean up resources.
 */
export async function closeApp(instance: TauriAppInstance): Promise<void> {
  if (instance.page) {
    await instance.page.close().catch(() => {});
  }

  if (instance.tauriProcess) {
    await instance.tauriProcess.stop();
  }

  if (instance.browser) {
    await instance.browser.close().catch(() => {});
  }
}

/**
 * Wait for a Tauri event to be emitted from the backend.
 * Uses a more robust approach than console.log monitoring by exposing
 * a test hook on window that resolves a promise when the event is received.
 *
 * @param page - The Playwright page instance
 * @param eventName - The name of the Tauri event to wait for
 * @param timeout - Timeout in milliseconds (default: 10000)
 * @returns Promise resolving when the event is received
 */
export async function waitForTauriEvent(
  page: Page,
  eventName: string,
  timeout = 10000
): Promise<unknown> {
  // Try the robust approach first: use a test hook on window
  const result = await page.evaluate(async (name) => {
    return new Promise((resolve) => {
      const handler = (event: CustomEvent) => {
        if (event.detail && event.detail.type === name) {
          window.removeEventListener(`tauri://${name}`, handler);
          resolve(event.detail);
        }
      };
      window.addEventListener(`tauri://${name}`, handler as EventListener);
      // Fallback timeout
      setTimeout(() => {
        window.removeEventListener(`tauri://${name}`, handler);
        resolve(null);
      }, 10000);
    });
  }, eventName);

  if (result !== null) {
    return result;
  }

  // Fallback to console.log monitoring for backward compatibility
  return page.waitForEvent('console', {
    predicate: (msg) => msg.type() === 'log' && msg.text().includes(eventName),
    timeout,
  });
}

/**
 * Evaluate a function in the Tauri WebView context.
 * Useful for invoking Tauri IPC commands directly.
 * Uses string-form evaluate for TauriPage compatibility.
 */
export async function evaluateInWebView<T>(
  page: Page,
  fn: (arg: any) => Promise<T> | T,
  arg: any
): Promise<T> {
  const script = `(${fn.toString()})(${JSON.stringify(arg)})`;
  return page.evaluate(script);
}

export { TauriProcessManager };
export type { Browser, Page };
