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
        window.__VALIDATION_TEST_HELPER__.resetRateLimitState();
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

test('test status idle', async ({ tauriPage }) => {
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
  
  // Check status via body text
  let bodyText = await tauriPage.locator('body').textContent();
  console.log('Body after init:', bodyText?.substring(0, 200));
  
  // Invoke validate_emails_bulk
  await tauriPage.evaluate(`
    window.__TAURI_INTERNALS__.invoke('validate_emails_bulk', { emails: ["test1@example.com","test2@example.com"], concurrency: 5, mode: 'standard' })
  `);
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  bodyText = await tauriPage.locator('body').textContent();
  console.log('Body after validate_emails_bulk:', bodyText?.substring(0, 200));
  
  // Set status to idle via test helper
  await tauriPage.evaluate(`
    (function() {
      if (window.__VALIDATION_TEST_HELPER__) {
        window.__VALIDATION_TEST_HELPER__.setValidationState({ status: 'idle' });
      }
    })()
  `);
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Check if status changed
  bodyText = await tauriPage.locator('body').textContent();
  console.log('Body after setValidationState idle:', bodyText?.substring(0, 200));
});
