import { Page } from '@playwright/test';

/**
 * Tauri Event Simulation Helpers
 *
 * Provides utilities to simulate Tauri backend events in the WebView
 * for testing frontend event handling without requiring actual backend execution.
 */

/**
 * Check if the page is a BrowserPageAdapter (browser mode) vs TauriPage (tauri mode)
 */
function isBrowserMode(page: Page & { playwrightPage?: Page }): boolean {
  return !!page.playwrightPage;
}

/**
 * Evaluate a script in the page, handling both browser mode (function) and tauri mode (string).
 */
async function evaluateInPage(
  page: Page & { playwrightPage?: Page },
  scriptFn: (evt: unknown) => void,
  eventData: unknown
): Promise<void> {
  const evalPage = page.playwrightPage || page;
  if (isBrowserMode(page)) {
    // Browser mode: use function form
    await evalPage.evaluate(scriptFn, eventData);
  } else {
    // Tauri mode: convert function to string script
    const script = `(${scriptFn.toString()})(${JSON.stringify(eventData)})`;
    await evalPage.evaluate(script);
  }
}

/**
 * ValidationResult interface matching the frontend's expected type
 */
export interface ValidationResult {
  email: string;
  result: 'Safe' | 'Risky' | 'Invalid' | 'Unknown';
  reason: string;
  logs: string[];
  domain: string;
  validationDuration: number;
  mxRecordCount: number;
  isDisposable: boolean;
  isRoleAccount: boolean;
  isCatchAll: boolean;
  isDeliverable: boolean;
  isDisabled: boolean;
  hasFullInbox: boolean;
  canConnectSmtp: boolean;
  acceptsMail: boolean;
  isValidSyntax: boolean;
  isB2c: boolean;
  suggestion?: string | null;
  gravatarUrl?: string | null;
  haveibeenpwned?: boolean | null;
  errorType?: string;
  timestamp: string;
  validationMode: 'quick' | 'standard' | 'thorough';
  riskScore: number;
  proxyId?: string;
  originalEmails?: string;
}

/**
 * All proxies failed event payload structure
 */
export interface AllProxiesFailedEvent {
  failedProxies: Array<{
    host: string;
    port: number;
    error: string;
  }>;
  timestamp: number;
}

/**
 * Session event payload structure
 */
export interface SessionEvent {
  type: 'created' | 'updated' | 'deleted' | 'completed';
  sessionId: string;
  sessionName?: string;
  resultCount?: number;
}

/**
 * Emit a validation-progress Tauri event to the WebView.
 *
 * This simulates the backend sending validation results
 * to the frontend via Tauri's event system.
 *
 * @param page - Playwright page connected to the Tauri WebView (or BrowserPageAdapter)
 * @param result - Validation result data
 */
export async function emitValidationProgress(
  page: Page & { playwrightPage?: Page },
  result: ValidationResult
): Promise<void> {
  // Use the test-only Tauri command to emit the event
  // Tauri invoke expects named arguments as an object
  const script = 
    'window.__TAURI_INTERNALS__.invoke(\'test_emit_validation_progress\', { result: ' +
    JSON.stringify(result) + ' })';
  const evalPage = page.playwrightPage || page;
  await evalPage.evaluate(script);
}

/**
 * Emit an all-proxies-failed Tauri event to the WebView.
 *
 * This simulates the backend notifying the frontend that all
 * configured proxies have failed.
 *
 * @param page - Playwright page connected to the Tauri WebView (or BrowserPageAdapter)
 * @param event - All proxies failed event data
 */
export async function emitAllProxiesFailed(
  page: Page & { playwrightPage?: Page },
  event: AllProxiesFailedEvent
): Promise<void> {
  await evaluateInPage(page, (evt) => {
    if (window.__TAURI_EMIT_MOCK_EVENT__) {
      window.__TAURI_EMIT_MOCK_EVENT__('all-proxies-failed', evt);
    }
    window.dispatchEvent(
      new CustomEvent('tauri://all-proxies-failed', { detail: evt })
    );
  }, event);
}

/**
 * Emit a session Tauri event to the WebView.
 *
 * This simulates session lifecycle events from the backend.
 *
 * @param page - Playwright page connected to the Tauri WebView (or BrowserPageAdapter)
 * @param event - Session event data
 */
export async function emitSessionEvent(
  page: Page & { playwrightPage?: Page },
  event: SessionEvent
): Promise<void> {
  await evaluateInPage(page, (evt) => {
    if (window.__TAURI_EMIT_MOCK_EVENT__) {
      window.__TAURI_EMIT_MOCK_EVENT__('session-event', evt);
    }
    window.dispatchEvent(
      new CustomEvent('tauri://session-event', { detail: evt })
    );
  }, event);
}

/**
 * Emit a rate-limit-warning Tauri event to the WebView.
 *
 * @param page - Playwright page connected to the Tauri WebView (or BrowserPageAdapter)
 * @param warning - Rate limit warning data
 */
export async function emitRateLimitWarning(
  page: Page & { playwrightPage?: Page },
  warning: {
    limit: number;
    current: number;
    resetAt: number;
  }
): Promise<void> {
  await evaluateInPage(page, (evt) => {
    if (window.__TAURI_EMIT_MOCK_EVENT__) {
      window.__TAURI_EMIT_MOCK_EVENT__('rate-limit-warning', evt);
    }
    window.dispatchEvent(
      new CustomEvent('tauri://rate-limit-warning', { detail: evt })
    );
  }, warning);
}

/**
 * Emit an auto-pause Tauri event to the WebView.
 *
 * This simulates the backend triggering the auto-pause modal
 * after consecutive failures.
 *
 * @param page - Playwright page connected to the Tauri WebView (or BrowserPageAdapter)
 * @param failureCount - Number of consecutive failures
 */
export async function emitAutoPause(
  page: Page & { playwrightPage?: Page },
  failureCount: number
): Promise<void> {
  await evaluateInPage(page, (count) => {
    if (window.__TAURI_EMIT_MOCK_EVENT__) {
      window.__TAURI_EMIT_MOCK_EVENT__('auto-pause', { failureCount: count });
    }
    window.dispatchEvent(
      new CustomEvent('tauri://auto-pause', { detail: { failureCount: count } })
    );
  }, failureCount);
}

/**
 * Emit a validation-complete Tauri event to the WebView.
 *
 * @param page - Playwright page connected to the Tauri WebView (or BrowserPageAdapter)
 * @param results - Validation results summary
 */
export async function emitValidationComplete(
  page: Page & { playwrightPage?: Page },
  results: {
    total: number;
    safe: number;
    risky: number;
    invalid: number;
    unknown: number;
    sessionId: string;
  }
): Promise<void> {
  // Use the test-only Tauri command to emit the event
  // Tauri invoke expects named arguments as an object (camelCase for JS)
  const script = 
    'window.__TAURI_INTERNALS__.invoke(\'test_emit_validation_complete\', { ' +
    'total: ' + results.total + ',' +
    'safe: ' + results.safe + ',' +
    'risky: ' + results.risky + ',' +
    'invalid: ' + results.invalid + ',' +
    'unknown: ' + results.unknown + ',' +
    'sessionId: ' + JSON.stringify(results.sessionId) +
    ' })';
  const evalPage = page.playwrightPage || page;
  await evalPage.evaluate(script);
}

/**
 * Emit a retry-escalation Tauri event to the WebView.
 *
 * This simulates the backend notifying the frontend about
 * auto-escalation tier progression.
 *
 * @param page - Playwright page connected to the Tauri WebView (or BrowserPageAdapter)
 * @param escalation - Escalation event data
 */
export async function emitRetryEscalation(
  page: Page & { playwrightPage?: Page },
  escalation: {
    tier: number;
    emailCount: number;
    mode: 'quick' | 'standard' | 'thorough';
  }
): Promise<void> {
  await evaluateInPage(page, (evt) => {
    if (window.__TAURI_EMIT_MOCK_EVENT__) {
      window.__TAURI_EMIT_MOCK_EVENT__('retry-escalation', evt);
    }
    window.dispatchEvent(
      new CustomEvent('tauri://retry-escalation', { detail: evt })
    );
  }, escalation);
}

/**
 * Wait for a specific Tauri event to be received by the frontend.
 *
 * @param page - Playwright page connected to the Tauri WebView (or BrowserPageAdapter)
 * @param eventName - Name of the event to wait for (e.g., 'tauri://validation-progress')
 * @param timeout - Timeout in milliseconds (default: 10000)
 * @returns Promise resolving with the event detail
 */
export async function waitForTauriEvent<T = unknown>(
  page: Page & { playwrightPage?: Page },
  eventName: string,
  timeout = 10000
): Promise<T> {
  const evalPage = page.playwrightPage || page;
  return evalPage.evaluate(
    (name, ms) => {
      return new Promise<T>((resolve, reject) => {
        const handler = (e: CustomEvent) => {
          window.removeEventListener(name, handler as EventListener);
          resolve(e.detail as T);
        };
        window.addEventListener(name, handler as EventListener);
        setTimeout(() => {
          window.removeEventListener(name, handler as EventListener);
          reject(new Error(`Timeout waiting for event: ${name}`));
        }, ms);
      });
    },
    eventName,
    timeout
  );
}

/**
 * Simulate a full validation flow with progress events.
 * Useful for testing the complete validation UI lifecycle.
 *
 * @param page - Playwright page connected to the Tauri WebView
 * @param emails - Array of email addresses to simulate validation for
 * @param options - Configuration options
 */
export async function simulateValidationFlow(
  page: Page,
  emails: string[],
  options: {
    delayBetweenEmails?: number;
    unknownCount?: number;
    failCount?: number;
  } = {}
): Promise<void> {
  const {
    delayBetweenEmails = 100,
    unknownCount = 0,
    failCount = 0,
  } = options;

  const total = emails.length;
  let safeCount = 0;
  let riskyCount = 0;
  const invalidCount = 0;
  let unknownCountActual = 0;

  for (let i = 0; i < total; i++) {
    const email = emails[i];

    // Use a simple timeout instead of page.waitForTimeout which may not be available
    await new Promise((resolve) => setTimeout(resolve, delayBetweenEmails));

    // Determine result
    let result: 'Safe' | 'Risky' | 'Invalid' | 'Unknown' = 'Safe';
    let errorType: string | undefined;
    if (unknownCountActual < unknownCount) {
      result = 'Unknown';
      errorType = 'Timeout';
      unknownCountActual++;
    } else if (failCount > 0 && i < failCount) {
      result = 'Invalid';
      errorType = 'ConnectionFailed';
      failCount--;
    } else if (i % 7 === 0) {
      result = 'Risky';
      riskyCount++;
    } else {
      safeCount++;
    }

    // Create a minimal ValidationResult object that matches the frontend's expected type
    const validationResult: ValidationResult = {
      email,
      result,
      reason: result === 'Unknown' ? 'Timeout' : result === 'Invalid' ? 'Connection failed' : 'OK',
      logs: [],
      domain: email.split('@')[1],
      validationDuration: 100,
      mxRecordCount: 1,
      isDisposable: false,
      isRoleAccount: false,
      isCatchAll: false,
      isDeliverable: result === 'Safe',
      isDisabled: false,
      hasFullInbox: false,
      canConnectSmtp: result !== 'Invalid',
      acceptsMail: result !== 'Invalid',
      isValidSyntax: true,
      isB2c: false,
      suggestion: null,
      gravatarUrl: null,
      haveibeenpwned: null,
      errorType,
      timestamp: new Date().toISOString(),
      validationMode: 'standard',
      riskScore: result === 'Safe' ? 0 : result === 'Risky' ? 50 : 100,
    };

    // Emit validation result
    await emitValidationProgress(page, validationResult);
  }

  // Emit completion
  await emitValidationComplete(page, {
    total,
    safe: safeCount,
    risky: riskyCount,
    invalid: invalidCount,
    unknown: unknownCountActual,
    sessionId: `test-session-${Date.now()}`,
  });
}

/**
 * Simulate a full validation flow by directly setting validation state via test helper.
 * This bypasses the Tauri event system and directly updates the frontend state.
 * Useful for browser-only mode where Tauri event mocking is limited.
 *
 * @param page - Playwright page connected to the Tauri WebView (or BrowserPageAdapter)
 * @param emails - Array of email addresses to simulate validation for
 * @param options - Configuration options
 */
export async function simulateValidationFlowDirect(
  page: Page & { playwrightPage?: Page },
  emails: string[],
  options: {
    delayBetweenEmails?: number;
    unknownCount?: number;
    failCount?: number;
  } = {}
): Promise<void> {
  const {
    delayBetweenEmails = 50,
    unknownCount = 0,
    failCount = 0,
  } = options;

  const total = emails.length;
  let unknownCountActual = 0;
  const results: ValidationResult[] = [];

  const evalPage = page.playwrightPage || page;

  for (let i = 0; i < total; i++) {
    const email = emails[i];

    await new Promise((resolve) => setTimeout(resolve, delayBetweenEmails));

    let result: 'Safe' | 'Risky' | 'Invalid' | 'Unknown';
    let errorType: string | undefined;
    if (unknownCountActual < unknownCount) {
      result = 'Unknown';
      errorType = 'Timeout';
      unknownCountActual++;
    } else if (failCount > 0 && i < failCount) {
      result = 'Invalid';
      errorType = 'ConnectionFailed';
      failCount--;
    } else if (i % 7 === 0) {
      result = 'Risky';
    } else {
      result = 'Safe';
    }

    const validationResult: ValidationResult = {
      email,
      result,
      reason: result === 'Unknown' ? 'Timeout' : result === 'Invalid' ? 'Connection failed' : 'OK',
      logs: [],
      domain: email.split('@')[1],
      validationDuration: 100,
      mxRecordCount: 1,
      isDisposable: false,
      isRoleAccount: false,
      isCatchAll: false,
      isDeliverable: result === 'Safe',
      isDisabled: false,
      hasFullInbox: false,
      canConnectSmtp: result !== 'Invalid',
      acceptsMail: result !== 'Invalid',
      isValidSyntax: true,
      isB2c: false,
      suggestion: null,
      gravatarUrl: null,
      haveibeenpwned: null,
      errorType,
      timestamp: new Date().toISOString(),
      validationMode: 'standard',
      riskScore: result === 'Safe' ? 0 : result === 'Risky' ? 50 : 100,
    };

    results.push(validationResult);

    // Update frontend state directly
    await evalPage.evaluate((state) => {
      if (window.__VALIDATION_TEST_HELPER__) {
        window.__VALIDATION_TEST_HELPER__.setValidationState({
          results: state.results,
          progress: state.progress,
          total: state.total,
          status: state.status,
        });
      }
    }, {
      results: [...results],
      progress: i + 1,
      total,
      status: 'processing',
    });
  }

  // Set final state to idle to trigger retry modal
  await evalPage.evaluate((state) => {
    if (window.__VALIDATION_TEST_HELPER__) {
      window.__VALIDATION_TEST_HELPER__.setValidationState({
        results: state.results,
        progress: state.progress,
        total: state.total,
        status: state.status,
      });
    }
  }, {
    results,
    progress: total,
    total,
    status: 'idle',
  });

  // Allow React to process the state update and trigger the retry modal
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Simulate auto-escalation flow by emitting Tauri retry-escalation events.
 * This properly triggers the parent component's event-driven auto-escalation flow
 * including the UI tier progression display.
 *
 * @param page - Playwright page connected to the Tauri WebView (or BrowserPageAdapter)
 * @param emailCount - Number of emails being escalated
 * @param options - Configuration options
 */
export async function simulateAutoEscalationFlow(
  page: Page & { playwrightPage?: Page },
  emailCount: number,
  options: {
    delayBetweenTiers?: number;
    tiers?: Array<'quick' | 'standard' | 'thorough'>;
  } = {}
): Promise<void> {
  const {
    delayBetweenTiers = 500,
    tiers = ['quick', 'standard', 'thorough'],
  } = options;

  const evalPage = page.playwrightPage || page;

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const tierNumber = i + 1;

    // Emit retry-escalation event to trigger UI update
    await emitRetryEscalation(evalPage, {
      tier: tierNumber,
      emailCount,
      mode: tier,
    });

    // Allow React to process the state update and render the tier progression
    await new Promise((resolve) => setTimeout(resolve, delayBetweenTiers));
  }

  // Emit final validation-complete event with all safe results
  await emitValidationComplete(evalPage, {
    total: emailCount,
    safe: emailCount,
    risky: 0,
    invalid: 0,
    unknown: 0,
    sessionId: `test-session-${Date.now()}`,
  });
}

/**
 * Create a stateful mock for revalidate_emails_bulk that returns
 * Unknown results for the first N tiers and Safe for the final tier.
 * This enables testing the auto-escalation tier progression.
 *
 * The mock reads configuration from window.__REVALIDATE_CONFIG__ which must be
 * set up in the browser context before the test runs.
 *
 * @param _unknownTiers - Number of tiers that should return Unknown results (default: 2)
 * @param _delayMs - Delay in milliseconds to simulate network latency (default: 300)
 * @returns Mock function for revalidate_emails_bulk
 */
export function createRevalidateMock(_unknownTiers = 2, _delayMs = 300) {
  // The mock function reads config from window.__REVALIDATE_CONFIG__
  // This survives serialization because it references the window object
  // Use a plain object parameter without TypeScript annotations for better serialization
  return async function revalidateMock(args) {
    const { items, mode } = args;
    const config = window.__REVALIDATE_CONFIG__ || { unknownTiers: 2, delayMs: 300 };
    window.__REVALIDATE_CALL_COUNT__ = (window.__REVALIDATE_CALL_COUNT__ || 0) + 1;
    const callCount = window.__REVALIDATE_CALL_COUNT__;
    const isUnknownTier = callCount <= config.unknownTiers;

    // Add delay to allow React state updates to render between tiers
    await new Promise((resolve) => setTimeout(resolve, config.delayMs));

    return items.map((item) => ({
      email: item.email,
      result: isUnknownTier ? 'Unknown' : 'Safe',
      reason: isUnknownTier ? 'Timeout' : 'OK',
      logs: [],
      domain: item.email.split('@')[1],
      validationDuration: 100,
      mxRecordCount: 1,
      isDisposable: false,
      isRoleAccount: false,
      isCatchAll: false,
      isDeliverable: !isUnknownTier,
      isDisabled: false,
      hasFullInbox: false,
      canConnectSmtp: !isUnknownTier,
      acceptsMail: !isUnknownTier,
      isValidSyntax: true,
      isB2c: false,
      suggestion: null,
      gravatarUrl: null,
      haveibeenpwned: null,
      errorType: isUnknownTier ? 'Timeout' : undefined,
      timestamp: new Date().toISOString(),
      validationMode: mode,
      riskScore: isUnknownTier ? 100 : 0,
    }));
  };
}

/**
 * Reset the call count for a mock created by createRevalidateMock.
 * Useful for test isolation.
 */
export function resetRevalidateMock(_mock: ReturnType<typeof createRevalidateMock>): void {
  // The mock is a closure, we can't directly reset it.
  // Instead, create a new mock for each test.
}
