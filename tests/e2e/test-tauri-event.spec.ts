import { createTauriTest } from '@srsholmes/tauri-playwright';

const { test, expect } = createTauriTest({
  mode: 'tauri',
  mcpSocket: '/tmp/tauri-playwright.sock',
  startTimeout: 30,
});

async function waitForAppReady(tauriPage: any): Promise<void> {
  await tauriPage.evaluate(`(function() { return document.readyState; })()`);
  await tauriPage.waitForSelector('body', 30000);
  await tauriPage.waitForSelector('textarea[placeholder*="separated by commas or new lines"]', 30000);
}

async function resetAppState(tauriPage: any): Promise<void> {
  const script = `
    (function() {
      if (window.__VALIDATION_TEST_HELPER__) {
        window.__VALIDATION_TEST_HELPER__.setValidationState({
          total: 0, progress: 0, status: 'idle', results: [], validationMode: 'standard',
        });
        window.__VALIDATION_TEST_HELPER__.setShowDashboard(false);
      }
      window.__REVALIDATE_CALL_COUNT__ = 0;
    })()
  `;
  await tauriPage.evaluate(script);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function setupMocks(tauriPage: any): Promise<void> {
  const script = `
    (function() {
      window.__ORIGINAL_INVOKE__ = window.__TAURI_INTERNALS__.invoke;
      window.__REVALIDATE_CONFIG__ = { unknownTiers: 2, delayMs: 300 };
      window.__REVALIDATE_CALL_COUNT__ = 0;
      window.__TAURI_INTERNALS__.invoke = async function(cmd, args) {
        if (cmd === 'validate_emails_bulk') { return []; }
        if (cmd === 'revalidate_emails_bulk') {
          const { items, mode } = args;
          const config = window.__REVALIDATE_CONFIG__ || { unknownTiers: 2, delayMs: 300 };
          window.__REVALIDATE_CALL_COUNT__ = (window.__REVALIDATE_CALL_COUNT__ || 0) + 1;
          const callCount = window.__REVALIDATE_CALL_COUNT__;
          const isUnknownTier = callCount <= config.unknownTiers;
          await new Promise((resolve) => setTimeout(resolve, config.delayMs));
          return items.map((item) => ({
            email: item.email, result: isUnknownTier ? 'Unknown' : 'Safe', reason: isUnknownTier ? 'Timeout' : 'OK', logs: [], domain: item.email.split('@')[1], validationDuration: 100, mxRecordCount: 1, isDisposable: false, isRoleAccount: false, isCatchAll: false, isDeliverable: !isUnknownTier, isDisabled: false, hasFullInbox: false, canConnectSmtp: !isUnknownTier, acceptsMail: !isUnknownTier, isValidSyntax: true, isB2c: false, suggestion: null, gravatarUrl: null, haveibeenpwned: null, errorType: isUnknownTier ? 'Timeout' : undefined, timestamp: new Date().toISOString(), validationMode: mode, riskScore: isUnknownTier ? 100 : 0,
          }));
        }
        return window.__ORIGINAL_INVOKE__(cmd, args);
      };
    })()
  `;
  await tauriPage.evaluate(script);
}

test('tauri event test', async ({ tauriPage }) => {
  await resetAppState(tauriPage);
  await waitForAppReady(tauriPage);
  await setupMocks(tauriPage);
  
  // Show dashboard
  await tauriPage.evaluate(`
    (function() {
      if (window.__VALIDATION_TEST_HELPER__) {
        window.__VALIDATION_TEST_HELPER__.setShowDashboard(true);
      }
    })()
  `);
  
  // Initialize validation state
  const emails = ['test1@example.com', 'test2@example.com'];
  const initScript = `
    (function(emailsList) {
      if (window.__VALIDATION_TEST_HELPER__) {
        window.__VALIDATION_TEST_HELPER__.setValidationState({
          total: emailsList.length,
          progress: 0,
          status: 'processing',
          results: [],
          validationMode: 'standard',
        });
      }
    })(${JSON.stringify(emails)})
  `;
  await tauriPage.evaluate(initScript);
  
  // Invoke validate_emails_bulk
  await tauriPage.evaluate(`
    window.__TAURI_INTERNALS__.invoke('validate_emails_bulk', { emails: ["test1@example.com","test2@example.com"], concurrency: 5, mode: 'standard' })
  `);
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Emit validation-progress event via test command
  const result1 = {
    email: 'test1@example.com', result: 'Unknown', reason: 'Timeout', logs: [], domain: 'example.com', validationDuration: 100, mxRecordCount: 1, isDisposable: false, isRoleAccount: false, isCatchAll: false, isDeliverable: false, isDisabled: false, hasFullInbox: false, canConnectSmtp: false, acceptsMail: false, isValidSyntax: true, isB2c: false, suggestion: null, gravatarUrl: null, haveibeenpwned: null, errorType: 'Timeout', timestamp: new Date().toISOString(), validationMode: 'standard', riskScore: 100,
  };
  
  await tauriPage.evaluate(`
    window.__TAURI_INTERNALS__.invoke('test_emit_validation_progress', { result: ${JSON.stringify(result1)} })
  `);
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Emit second event
  const result2 = { ...result1, email: 'test2@example.com' };
  await tauriPage.evaluate(`
    window.__TAURI_INTERNALS__.invoke('test_emit_validation_progress', { result: ${JSON.stringify(result2)} })
  `);
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Emit validation-complete
  await tauriPage.evaluate(`
    window.__TAURI_INTERNALS__.invoke('test_emit_validation_complete', { total: 2, safe: 0, risky: 0, invalid: 0, unknown: 2, sessionId: 'test-session' })
  `);
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Check for retry modal
  const modal = tauriPage.locator('[role="dialog"]').filter({ hasText: 'Retry Unknown Emails' });
  const isVisible = await modal.isVisible();
  console.log('Retry modal visible:', isVisible);
  
  if (!isVisible) {
    // Check what's on screen
    const bodyText = await tauriPage.locator('body').textContent();
    console.log('Body text:', bodyText?.substring(0, 500));
  }
});
