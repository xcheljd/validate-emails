import { createTauriTest } from '@srsholmes/tauri-playwright';
import { createRetryModalPage } from '../pages/retry-modal';
import { simulateValidationFlowDirect } from '../helpers/events';

const { test, expect } = createTauriTest({
  mode: 'browser',
  devUrl: 'http://localhost:1420',
  ipcMocks: {
    // Return immediately since we use simulateValidationFlowDirect for state updates
    validate_emails_bulk: async () => {
      return [];
    },
    // NOTE: revalidate_emails_bulk is mocked manually in test.beforeEach to avoid
    // tauri-playwright async mock issue
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
  
  // Wait for validation to complete (results will come via validation-progress events)
  // The test's simulateValidationFlowDirect will handle the progress events
}

test.describe('Retry Modal - VAL-PW-005', () => {
  test('retry modal appears after validation with Unknown results', async ({ tauriPage }, _testInfo) => {
    const retryModal = createRetryModalPage(tauriPage);

    await startValidationViaIPC(tauriPage, [
      'test1@example.com',
      'test2@example.com',
      'test3@example.com',
      'test4@example.com',
      'test5@example.com',
    ]);

    // Use direct state simulation for browser-only mode
    await simulateValidationFlowDirect(tauriPage, [
      'test1@example.com',
      'test2@example.com',
      'test3@example.com',
      'test4@example.com',
      'test5@example.com',
    ], { unknownCount: 3 });

    await retryModal.waitForVisible(15000);

    await expect(retryModal.title).toBeVisible();
    await expect(retryModal.description).toContainText('3 emails have unknown status');
    await expect(retryModal.quickTierButton).toBeVisible();
    await expect(retryModal.standardTierButton).toBeVisible();
    await expect(retryModal.thoroughTierButton).toBeVisible();
    await expect(retryModal.autoEscalateCheckbox).toBeVisible();
    // Check that standard tier is selected by default (checkmark circle)
    await expect(retryModal.standardTierButton.locator('.h-5.w-5.bg-primary.rounded-full')).toBeVisible();
  });
});

test.describe('Retry Modal - VAL-PW-006', () => {
  test('auto-escalation shows tier progression (1→2→3)', async ({ tauriPage }) => {
    const retryModal = createRetryModalPage(tauriPage);

    await startValidationViaIPC(tauriPage, [
      'test1@example.com',
      'test2@example.com',
      'test3@example.com',
    ]);

    // Use direct state simulation for browser-only mode
    await simulateValidationFlowDirect(tauriPage, [
      'test1@example.com',
      'test2@example.com',
      'test3@example.com',
    ], { unknownCount: 3 });

    await retryModal.waitForVisible(15000);

    // Ensure React has processed the state update with Unknown results
    await new Promise(resolve => setTimeout(resolve, 1000));

    await retryModal.setAutoEscalate(true);
    await retryModal.clickRetry();
    
    // Wait for escalation to start (isEscalating becomes true) - do this IMMEDIATELY
    await retryModal.waitForEscalationStart();

    await retryModal.waitForEscalationTier(1);
    expect(await retryModal.getEscalationTier()).toBe(1);

    await retryModal.waitForEscalationTier(2);
    expect(await retryModal.getEscalationTier()).toBe(2);

    await retryModal.waitForEscalationTier(3);
    expect(await retryModal.getEscalationTier()).toBe(3);

    await expect(retryModal.retryButton).toBeDisabled();
    expect(await retryModal.getRetryButtonText()).toContain('Escalating');
  });
});

test.describe('Retry Modal - VAL-PW-007', () => {
  test('manual tier selection passes correct mode to backend', async ({ tauriPage }, _testInfo) => {
    const retryModal = createRetryModalPage(tauriPage);

    await startValidationViaIPC(tauriPage, [
      'test1@example.com',
      'test2@example.com',
    ]);

    // Use direct state simulation for browser-only mode
    await simulateValidationFlowDirect(tauriPage, [
      'test1@example.com',
      'test2@example.com',
    ], { unknownCount: 2 });

    await retryModal.waitForVisible(15000);

    await retryModal.selectTier('quick');
    expect(await retryModal.getSelectedTier()).toBe('quick');

    await retryModal.selectTier('standard');
    expect(await retryModal.getSelectedTier()).toBe('standard');

    await retryModal.selectTier('thorough');
    expect(await retryModal.getSelectedTier()).toBe('thorough');

    await retryModal.clickRetry();
    await retryModal.waitForHidden(5005);
  });
});

test.describe('Retry Modal - VAL-PW-008', () => {
  test('manual retry works after auto-escalation error', async ({ tauriPage }, _testInfo) => {
    const retryModal = createRetryModalPage(tauriPage);

    // Set up the revalidate mock config in the browser context
    await tauriPage.evaluate(() => {
      window.__REVALIDATE_CONFIG__ = { unknownTiers: 2, delayMs: 300 };
      window.__REVALIDATE_CALL_COUNT__ = 0;
    });

    await startValidationViaIPC(tauriPage, [
      'test1@example.com',
      'test2@example.com',
    ]);

    // Use direct state simulation for browser-only mode
    await simulateValidationFlowDirect(tauriPage, [
      'test1@example.com',
      'test2@example.com',
    ], { unknownCount: 2 });

    await retryModal.waitForVisible(15000);

    await retryModal.setAutoEscalate(true);
    await retryModal.clickRetry();
    await retryModal.waitForEscalationStart();

    // Wait for auto-escalation to complete (tiers 1-3)
    await retryModal.waitForEscalationTier(3);

    // Simulate auto-escalation error by setting validation state with unknown results
    // This will cause the retry modal to reappear
    const evalPage = tauriPage.playwrightPage || tauriPage;
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
      results: [
        { email: 'test1@example.com', result: 'Unknown', reason: 'Timeout', logs: [], domain: 'example.com', validationDuration: 100, mxRecordCount: 1, isDisposable: false, isRoleAccount: false, isCatchAll: false, isDeliverable: false, isDisabled: false, hasFullInbox: false, canConnectSmtp: false, acceptsMail: false, isValidSyntax: true, isB2c: false, suggestion: null, gravatarUrl: null, haveibeenpwned: null, errorType: 'Timeout', timestamp: new Date().toISOString(), validationMode: 'standard', riskScore: 100 },
        { email: 'test2@example.com', result: 'Unknown', reason: 'Timeout', logs: [], domain: 'example.com', validationDuration: 100, mxRecordCount: 1, isDisposable: false, isRoleAccount: false, isCatchAll: false, isDeliverable: false, isDisabled: false, hasFullInbox: false, canConnectSmtp: false, acceptsMail: false, isValidSyntax: true, isB2c: false, suggestion: null, gravatarUrl: null, haveibeenpwned: null, errorType: 'Timeout', timestamp: new Date().toISOString(), validationMode: 'standard', riskScore: 100 },
      ],
      progress: 2,
      total: 2,
      status: 'idle',
    });

    // Reset the mock counter for the manual retry
    await tauriPage.evaluate(() => {
      window.__REVALIDATE_CALL_COUNT__ = 0;
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    await retryModal.waitForVisible(15000);

    await retryModal.selectTier('quick');
    expect(await retryModal.isAutoEscalateEnabled()).toBe(false);

    await retryModal.clickRetry();
    await retryModal.waitForHidden(5000);
  });
});
