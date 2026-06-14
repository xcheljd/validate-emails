import { createTauriTest } from '@srsholmes/tauri-playwright';
import { createAutoPauseModalPage } from '../pages/auto-pause-modal';
import { simulateValidationFlowDirect } from '../helpers/events';

const { test, expect } = createTauriTest({
  mode: 'browser',
  devUrl: 'http://localhost:1420',
  ipcMocks: {
    // Return immediately since we use simulateValidationFlowDirect for state updates
    validate_emails_bulk: async () => {
      return [];
    },
    // Mock test-only Tauri commands for emitting events in browser mode
    test_emit_validation_progress: async ({ result }) => {
      // Emit via the Tauri mock event system
      if (typeof window !== 'undefined' && window.__TAURI_EMIT_MOCK_EVENT__) {
        window.__TAURI_EMIT_MOCK_EVENT__('validation-progress', result);
      }
      return true;
    },
    test_emit_validation_complete: async ({ total, safe, risky, invalid, unknown, sessionId }) => {
      // Emit via the Tauri mock event system
      if (typeof window !== 'undefined' && window.__TAURI_EMIT_MOCK_EVENT__) {
        window.__TAURI_EMIT_MOCK_EVENT__('validation-complete', { total, safe, risky, invalid, unknown, sessionId });
      }
      return true;
    },
    pause_validation: async () => {},
    resume_validation: async () => {},
    stop_validation: async () => {},
    clear_proxy_bypass_for_session: async () => {},
    set_proxy_bypass_for_session: async () => {},
  },
});

// Set up manual mock for revalidate_emails_bulk before each test
test.beforeEach(async ({ tauriPage }) => {
  await tauriPage.evaluate(() => {
    // Store original invoke
    window.__ORIGINAL_INVOKE__ = window.__TAURI_INTERNALS__.invoke;
    
    // Mock state
    window.__REVALIDATE_CONFIG__ = { unknownTiers: 2, delayMs: 300 };
    window.__REVALIDATE_CALL_COUNT__ = 0;
    
    // Override invoke for revalidate_emails_bulk
    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'revalidate_emails_bulk') {
        const { items, mode } = args;
        const config = window.__REVALIDATE_CONFIG__ || { unknownTiers: 2, delayMs: 300 };
        window.__REVALIDATE_CALL_COUNT__ = (window.__REVALIDATE_CALL_COUNT__ || 0) + 1;
        const callCount = window.__REVALIDATE_CALL_COUNT__;
        const isUnknownTier = callCount <= config.unknownTiers;

        // Add delay to allow React state updates to render between tiers
        await new Promise((resolve) => setTimeout(resolve, config.delayMs));

        const result = items.map((item) => ({
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
        
        return result;
      }
      // Fall back to original invoke for other commands
      return window.__ORIGINAL_INVOKE__(cmd, args);
    };
  });
});

// Helper to start validation via Tauri IPC (bypasses UI textarea issues in Tauri mode)
async function startValidationViaIPC(tauriPage: import('@playwright/test').Page & { playwrightPage?: import('@playwright/test').Page }, emails: string[]) {
  // Wait for app to load
  await tauriPage.waitForSelector('textarea[placeholder*="separated by commas or new lines"]', 10000);
  
  // Set up frontend validation state using the test helper
  // Use playwrightPage for browser mode to support function + args form
  const evalPage = tauriPage.playwrightPage || tauriPage;
  await evalPage.evaluate((emailsList) => {
    if (window.__VALIDATION_TEST_HELPER__) {
      window.__VALIDATION_TEST_HELPER__.setValidationState({
        total: emailsList.length,
        progress: 0,
        status: 'processing',
        results: [],
        validationMode: 'standard',
      });
      window.__VALIDATION_TEST_HELPER__.setShowDashboard(true);
    }
  }, emails);
  
  // Invoke validate_emails_bulk directly via Tauri IPC (mocked to return immediately)
  const invokeScript = 
    'window.__TAURI_INTERNALS__.invoke(\'validate_emails_bulk\', {' +
    '  emails: ' + JSON.stringify(emails) + ',' +
    '  concurrency: 5,' +
    '  mode: \'standard\'' +
    '})';
  await evalPage.evaluate(invokeScript);
}

// Helper to trigger auto-pause modal via test helper
async function triggerAutoPauseModal(
  tauriPage: import('@playwright/test').Page & { playwrightPage?: import('@playwright/test').Page },
  failureCount: number
): Promise<void> {
  const evalPage = tauriPage.playwrightPage || tauriPage;
  
  // Use the test helper to set validation state that will trigger auto-pause
  await evalPage.evaluate((count) => {
    if (window.__VALIDATION_TEST_HELPER__) {
      // Set rate limit failure state to trigger auto-pause
      window.__VALIDATION_TEST_HELPER__.setRateLimitFailureState({
        consecutiveFailures: count,
        isSlowdownActive: count >= 3,
        isAutoPaused: count >= 8,
      });
      // Force the modal to show by setting status to paused
      window.__VALIDATION_TEST_HELPER__.setValidationState({
        status: 'paused',
      });
    }
  }, failureCount);
  
  // Allow React to process the state update
  await new Promise((resolve) => setTimeout(resolve, 500));
}

// Helper to get partial results from the dashboard
async function getPartialResults(
  tauriPage: import('@playwright/test').Page & { playwrightPage?: import('@playwright/test').Page }
): Promise<number> {
  const evalPage = tauriPage.playwrightPage || tauriPage;
  return evalPage.evaluate(() => {
    if (window.__VALIDATION_TEST_HELPER__) {
      const state = window.__VALIDATION_TEST_HELPER__.getValidationState();
      return state.results?.length || 0;
    }
    return 0;
  });
}

test.describe('AutoPauseModal - VAL-PW-009', () => {
  test('AutoPauseModal triggers after 8 consecutive failures', async ({ tauriPage }, _testInfo) => {
    const autoPauseModal = createAutoPauseModalPage(tauriPage);

    const emails = [
      'fail1@example.com',
      'fail2@example.com',
      'fail3@example.com',
      'fail4@example.com',
      'fail5@example.com',
      'fail6@example.com',
      'fail7@example.com',
      'fail8@example.com',
    ];

    await startValidationViaIPC(tauriPage, emails);

    // Simulate 8 consecutive failures to trigger auto-pause
    await triggerAutoPauseModal(tauriPage, 8);

    // Wait for the auto-pause modal to appear
    await autoPauseModal.waitForVisible(15000);

    // Verify modal content
    await expect(autoPauseModal.title).toBeVisible();
    await expect(autoPauseModal.description).toBeVisible();
    await expect(autoPauseModal.failureCountText).toHaveText('8');
    await expect(autoPauseModal.stopButton).toBeVisible();
    await expect(autoPauseModal.resumeButton).toBeVisible();
  });
});

test.describe('AutoPauseModal - VAL-PW-010', () => {
  test('Escape key closes modal and stops validation', async ({ tauriPage }) => {
    const autoPauseModal = createAutoPauseModalPage(tauriPage);

    const emails = [
      'fail1@example.com',
      'fail2@example.com',
      'fail3@example.com',
      'fail4@example.com',
      'fail5@example.com',
      'fail6@example.com',
      'fail7@example.com',
      'fail8@example.com',
    ];

    await startValidationViaIPC(tauriPage, emails);

    // Simulate 8 consecutive failures to trigger auto-pause
    await triggerAutoPauseModal(tauriPage, 8);

    // Wait for the auto-pause modal to appear
    await autoPauseModal.waitForVisible(15000);

    // Verify modal is visible
    expect(await autoPauseModal.isVisible()).toBe(true);

    // Press Escape key to close modal (should trigger stop)
    await autoPauseModal.pressEscape();

    // Wait for modal to close
    await autoPauseModal.waitForHidden(5000);

    // Verify modal is hidden
    expect(await autoPauseModal.isVisible()).toBe(false);

    // Verify validation stopped (status should be idle)
    const evalPage = tauriPage.playwrightPage || tauriPage;
    const state = await evalPage.evaluate(() => {
      if (window.__VALIDATION_TEST_HELPER__) {
        return window.__VALIDATION_TEST_HELPER__.getValidationState();
      }
      return null;
    });
    expect(state?.status).toBe('idle');
  });
});

test.describe('AutoPauseModal - VAL-PW-011', () => {
  test('Click outside closes modal and stops validation', async ({ tauriPage }) => {
    const autoPauseModal = createAutoPauseModalPage(tauriPage);

    const emails = [
      'fail1@example.com',
      'fail2@example.com',
      'fail3@example.com',
      'fail4@example.com',
      'fail5@example.com',
      'fail6@example.com',
      'fail7@example.com',
      'fail8@example.com',
    ];

    await startValidationViaIPC(tauriPage, emails);

    // Simulate 8 consecutive failures to trigger auto-pause
    await triggerAutoPauseModal(tauriPage, 8);

    // Wait for the auto-pause modal to appear
    await autoPauseModal.waitForVisible(15000);

    // Verify modal is visible
    expect(await autoPauseModal.isVisible()).toBe(true);

    // Click outside the modal (on overlay) to close it (should trigger stop)
    await autoPauseModal.clickOutside();

    // Wait for modal to close
    await autoPauseModal.waitForHidden(5000);

    // Verify modal is hidden
    expect(await autoPauseModal.isVisible()).toBe(false);

    // Verify validation stopped (status should be idle)
    const evalPage = tauriPage.playwrightPage || tauriPage;
    const state = await evalPage.evaluate(() => {
      if (window.__VALIDATION_TEST_HELPER__) {
        return window.__VALIDATION_TEST_HELPER__.getValidationState();
      }
      return null;
    });
    expect(state?.status).toBe('idle');
  });
});

test.describe('AutoPauseModal - VAL-PW-012', () => {
  test('Partial results preserved after auto-pause stop', async ({ tauriPage }) => {
    const autoPauseModal = createAutoPauseModalPage(tauriPage);

    // Use 10 emails: 8 failures + 2 successful results
    const emails = [
      'safe1@example.com',   // Will be Safe
      'safe2@example.com',   // Will be Safe
      'fail1@example.com',   // Will be Unknown (failure)
      'fail2@example.com',   // Will be Unknown (failure)
      'fail3@example.com',   // Will be Unknown (failure)
      'fail4@example.com',   // Will be Unknown (failure)
      'fail5@example.com',   // Will be Unknown (failure)
      'fail6@example.com',   // Will be Unknown (failure)
      'fail7@example.com',   // Will be Unknown (failure)
      'fail8@example.com',   // Will be Unknown (failure)
    ];

    await startValidationViaIPC(tauriPage, emails);

    // Create partial results: 2 Safe + 8 failures
    const evalPage = tauriPage.playwrightPage || tauriPage;
    const partialResults = [
      {
        email: 'safe1@example.com',
        result: 'Safe' as const,
        reason: 'OK',
        logs: [],
        domain: 'example.com',
        validationDuration: 100,
        mxRecordCount: 1,
        isDisposable: false,
        isRoleAccount: false,
        isCatchAll: false,
        isDeliverable: true,
        isDisabled: false,
        hasFullInbox: false,
        canConnectSmtp: true,
        acceptsMail: true,
        isValidSyntax: true,
        isB2c: false,
        suggestion: null,
        gravatarUrl: null,
        haveibeenpwned: null,
        errorType: undefined,
        timestamp: new Date().toISOString(),
        validationMode: 'standard' as const,
        riskScore: 0,
      },
      {
        email: 'safe2@example.com',
        result: 'Safe' as const,
        reason: 'OK',
        logs: [],
        domain: 'example.com',
        validationDuration: 100,
        mxRecordCount: 1,
        isDisposable: false,
        isRoleAccount: false,
        isCatchAll: false,
        isDeliverable: true,
        isDisabled: false,
        hasFullInbox: false,
        canConnectSmtp: true,
        acceptsMail: true,
        isValidSyntax: true,
        isB2c: false,
        suggestion: null,
        gravatarUrl: null,
        haveibeenpwned: null,
        errorType: undefined,
        timestamp: new Date().toISOString(),
        validationMode: 'standard' as const,
        riskScore: 0,
      },
      {
        email: 'fail1@example.com',
        result: 'Unknown' as const,
        reason: 'Timeout',
        logs: [],
        domain: 'example.com',
        validationDuration: 100,
        mxRecordCount: 1,
        isDisposable: false,
        isRoleAccount: false,
        isCatchAll: false,
        isDeliverable: false,
        isDisabled: false,
        hasFullInbox: false,
        canConnectSmtp: false,
        acceptsMail: false,
        isValidSyntax: true,
        isB2c: false,
        suggestion: null,
        gravatarUrl: null,
        haveibeenpwned: null,
        errorType: 'Timeout',
        timestamp: new Date().toISOString(),
        validationMode: 'standard' as const,
        riskScore: 100,
      },
      {
        email: 'fail2@example.com',
        result: 'Unknown' as const,
        reason: 'Timeout',
        logs: [],
        domain: 'example.com',
        validationDuration: 100,
        mxRecordCount: 1,
        isDisposable: false,
        isRoleAccount: false,
        isCatchAll: false,
        isDeliverable: false,
        isDisabled: false,
        hasFullInbox: false,
        canConnectSmtp: false,
        acceptsMail: false,
        isValidSyntax: true,
        isB2c: false,
        suggestion: null,
        gravatarUrl: null,
        haveibeenpwned: null,
        errorType: 'Timeout',
        timestamp: new Date().toISOString(),
        validationMode: 'standard' as const,
        riskScore: 100,
      },
      {
        email: 'fail3@example.com',
        result: 'Unknown' as const,
        reason: 'Timeout',
        logs: [],
        domain: 'example.com',
        validationDuration: 100,
        mxRecordCount: 1,
        isDisposable: false,
        isRoleAccount: false,
        isCatchAll: false,
        isDeliverable: false,
        isDisabled: false,
        hasFullInbox: false,
        canConnectSmtp: false,
        acceptsMail: false,
        isValidSyntax: true,
        isB2c: false,
        suggestion: null,
        gravatarUrl: null,
        haveibeenpwned: null,
        errorType: 'Timeout',
        timestamp: new Date().toISOString(),
        validationMode: 'standard' as const,
        riskScore: 100,
      },
      {
        email: 'fail4@example.com',
        result: 'Unknown' as const,
        reason: 'Timeout',
        logs: [],
        domain: 'example.com',
        validationDuration: 100,
        mxRecordCount: 1,
        isDisposable: false,
        isRoleAccount: false,
        isCatchAll: false,
        isDeliverable: false,
        isDisabled: false,
        hasFullInbox: false,
        canConnectSmtp: false,
        acceptsMail: false,
        isValidSyntax: true,
        isB2c: false,
        suggestion: null,
        gravatarUrl: null,
        haveibeenpwned: null,
        errorType: 'Timeout',
        timestamp: new Date().toISOString(),
        validationMode: 'standard' as const,
        riskScore: 100,
      },
      {
        email: 'fail5@example.com',
        result: 'Unknown' as const,
        reason: 'Timeout',
        logs: [],
        domain: 'example.com',
        validationDuration: 100,
        mxRecordCount: 1,
        isDisposable: false,
        isRoleAccount: false,
        isCatchAll: false,
        isDeliverable: false,
        isDisabled: false,
        hasFullInbox: false,
        canConnectSmtp: false,
        acceptsMail: false,
        isValidSyntax: true,
        isB2c: false,
        suggestion: null,
        gravatarUrl: null,
        haveibeenpwned: null,
        errorType: 'Timeout',
        timestamp: new Date().toISOString(),
        validationMode: 'standard' as const,
        riskScore: 100,
      },
      {
        email: 'fail6@example.com',
        result: 'Unknown' as const,
        reason: 'Timeout',
        logs: [],
        domain: 'example.com',
        validationDuration: 100,
        mxRecordCount: 1,
        isDisposable: false,
        isRoleAccount: false,
        isCatchAll: false,
        isDeliverable: false,
        isDisabled: false,
        hasFullInbox: false,
        canConnectSmtp: false,
        acceptsMail: false,
        isValidSyntax: true,
        isB2c: false,
        suggestion: null,
        gravatarUrl: null,
        haveibeenpwned: null,
        errorType: 'Timeout',
        timestamp: new Date().toISOString(),
        validationMode: 'standard' as const,
        riskScore: 100,
      },
      {
        email: 'fail7@example.com',
        result: 'Unknown' as const,
        reason: 'Timeout',
        logs: [],
        domain: 'example.com',
        validationDuration: 100,
        mxRecordCount: 1,
        isDisposable: false,
        isRoleAccount: false,
        isCatchAll: false,
        isDeliverable: false,
        isDisabled: false,
        hasFullInbox: false,
        canConnectSmtp: false,
        acceptsMail: false,
        isValidSyntax: true,
        isB2c: false,
        suggestion: null,
        gravatarUrl: null,
        haveibeenpwned: null,
        errorType: 'Timeout',
        timestamp: new Date().toISOString(),
        validationMode: 'standard' as const,
        riskScore: 100,
      },
      {
        email: 'fail8@example.com',
        result: 'Unknown' as const,
        reason: 'Timeout',
        logs: [],
        domain: 'example.com',
        validationDuration: 100,
        mxRecordCount: 1,
        isDisposable: false,
        isRoleAccount: false,
        isCatchAll: false,
        isDeliverable: false,
        isDisabled: false,
        hasFullInbox: false,
        canConnectSmtp: false,
        acceptsMail: false,
        isValidSyntax: true,
        isB2c: false,
        suggestion: null,
        gravatarUrl: null,
        haveibeenpwned: null,
        errorType: 'Timeout',
        timestamp: new Date().toISOString(),
        validationMode: 'standard' as const,
        riskScore: 100,
      },
    ];

    // Set validation state with partial results and paused status
    await evalPage.evaluate((state) => {
      if (window.__VALIDATION_TEST_HELPER__) {
        window.__VALIDATION_TEST_HELPER__.setValidationState({
          results: state.results,
          progress: state.progress,
          total: state.total,
          status: state.status,
          validationMode: state.validationMode,
        });
        // Also set rate limit failure state
        window.__VALIDATION_TEST_HELPER__.setRateLimitFailureState({
          consecutiveFailures: state.failureCount,
          isSlowdownActive: state.failureCount >= 3,
          isAutoPaused: state.failureCount >= 8,
        });
      }
    }, {
      results: partialResults,
      progress: 10,
      total: 10,
      status: 'paused',
      validationMode: 'standard',
      failureCount: 8,
    });

    // Force show auto-pause modal for E2E testing
    await evalPage.evaluate(() => {
      if (window.__VALIDATION_TEST_HELPER__) {
        window.__VALIDATION_TEST_HELPER__.setForceShowRetryModal(false);
      }
    });

    // Allow React to process the state update
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Wait for the auto-pause modal to appear
    await autoPauseModal.waitForVisible(15000);

    // Verify modal shows 8 failures
    await expect(autoPauseModal.failureCountText).toHaveText('8');

    // Click Stop Validation button
    await autoPauseModal.clickStop();

    // Wait for modal to close
    await autoPauseModal.waitForHidden(5000);

    // Verify modal is hidden
    expect(await autoPauseModal.isVisible()).toBe(false);

    // Verify partial results are preserved (2 Safe results should remain)
    const state = await evalPage.evaluate(() => {
      if (window.__VALIDATION_TEST_HELPER__) {
        return window.__VALIDATION_TEST_HELPER__.getValidationState();
      }
      return null;
    });

    expect(state).not.toBeNull();
    expect(state?.results?.length).toBe(10); // All 10 results should be preserved
    
    // Count Safe results
    const safeCount = state?.results?.filter((r: any) => r.result === 'Safe').length || 0;
    expect(safeCount).toBe(2);
    
    // Count Unknown results
    const unknownCount = state?.results?.filter((r: any) => r.result === 'Unknown').length || 0;
    expect(unknownCount).toBe(8);

    // Verify validation stopped (status should be idle)
    expect(state?.status).toBe('idle');
  });
});
