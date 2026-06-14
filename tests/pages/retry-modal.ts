import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Retry Modal
 *
 * Encapsulates interactions with the retry modal that appears
 * when validation completes with Unknown results.
 */

export class RetryModalPage {
  readonly page: Page;

  // Modal container
  readonly modal: Locator;
  readonly modalContent: Locator;

  // Header elements
  readonly title: Locator;
  readonly description: Locator;

  // Tier selection
  readonly tierSection: Locator;
  readonly tierButtons: Locator;
  readonly quickTierButton: Locator;
  readonly standardTierButton: Locator;
  readonly thoroughTierButton: Locator;

  // Auto-escalate
  readonly autoEscalateSection: Locator;
  readonly autoEscalateCheckbox: Locator;
  readonly autoEscalateLabel: Locator;

  // Escalation progress (shown during auto-escalation)
  readonly escalationProgress: Locator;
  readonly escalationTierText: Locator;
  readonly escalationEmailCount: Locator;

  // Footer buttons
  readonly cancelButton: Locator;
  readonly retryButton: Locator;

  /**
   * Evaluate a script in the page using string-form for both Tauri and browser mode.
   * TauriPage only accepts strings. BrowserPageAdapter also accepts strings.
   */
  private async evaluateInPage(scriptFn: (arg: any) => any, arg: any): Promise<any> {
    // Always use string-form evaluate for compatibility with both TauriPage and BrowserPageAdapter
    const script = `(${scriptFn.toString()})(${JSON.stringify(arg)})`;
    return this.page.evaluate(script);
  }

  constructor(page: Page) {
    this.page = page;

    // Modal container - use filter instead of :has-text() for Tauri compatibility
    this.modal = page.locator('[role="dialog"]').filter({ hasText: 'Retry Unknown Emails' });

    // Header - use filter instead of :has-text() for Tauri compatibility
    this.title = this.modal.locator('h2').filter({ hasText: 'Retry Unknown Emails' });
    this.description = this.modal.locator('p').filter({ hasText: 'emails have unknown status' });

    // Tier buttons - use data-testid for stable selectors
    this.quickTierButton = this.modal.locator('[data-testid="tier-button-quick"]');
    this.standardTierButton = this.modal.locator('[data-testid="tier-button-standard"]');
    this.thoroughTierButton = this.modal.locator('[data-testid="tier-button-thorough"]');

    // Auto-escalate checkbox - use data-testid for stable selectors
    this.autoEscalateCheckbox = this.modal.locator('[data-testid="auto-escalate-checkbox"]');

    // Escalation progress (shown during auto-escalation) - use data-testid for stable selectors
    this.escalationProgress = this.modal.locator('[data-testid="escalation-progress"]');
    this.escalationTierText = this.modal.locator('[data-testid="escalation-tier-text"]');
    this.escalationEmailCount = this.modal.locator('[data-testid="escalation-email-count"]');

    // Footer buttons - use filter instead of :has-text() for Tauri compatibility
    this.cancelButton = this.modal.locator('button').filter({ hasText: 'Cancel' });
    this.retryButton = this.modal.locator('button').filter({ hasText: /Retry|Escalating/ });
  }

  /**
   * Wait for the retry modal to be visible.
   * In Tauri mode, checks for DOM presence since visibility is affected by CSS animation issues.
   */
  async waitForVisible(timeout = 10000): Promise<void> {
    // Poll for the modal to exist in the DOM with correct content
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const exists = await this.page.evaluate(`
        (function() {
          const dialogs = document.querySelectorAll('[role="dialog"]');
          for (const dialog of dialogs) {
            if (dialog.textContent?.includes('Retry Unknown Emails')) {
              return true;
            }
          }
          return false;
        })()
      `);
      if (exists) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Force opacity to 1 for Tauri WebView animation issue
    // Simple approach - just target the dialog and its immediate content div
    await this.page.evaluate(`
      (function() {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        for (const dialog of dialogs) {
          if (dialog.textContent?.includes('Retry Unknown Emails')) {
            dialog.style.opacity = '1';
            dialog.style.visibility = 'visible';
            // Target the dialog content div (first child with modal content)
            const content = dialog.querySelector('div.fixed, div[class*="left-[50%]"]');
            if (content) {
              content.style.opacity = '1';
              content.style.visibility = 'visible';
            }
          }
        }
      })()
    `);
    
    // Verify the modal exists in DOM (visibility check may fail in Tauri due to animation)
    const modalExists = await this.page.evaluate(`
      (function() {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        for (const dialog of dialogs) {
          if (dialog.textContent?.includes('Retry Unknown Emails')) {
            return true;
          }
        }
        return false;
      })()
    `);
    if (!modalExists) {
      throw new Error('Retry modal not found in DOM after waiting');
    }
  }

  /**
   * Wait for the retry modal to be hidden.
   */
  async waitForHidden(timeout = 10000): Promise<void> {
    await expect(this.modal).toBeHidden({ timeout });
  }

  /**
   * Check if the modal is currently visible.
   */
  async isVisible(): Promise<boolean> {
    return this.modal.isVisible();
  }

  /**
   * Get the unknown email count from the description.
   */
  async getUnknownCount(): Promise<number> {
    const descText = await this.description.textContent();
    const match = descText?.match(/(\d+) emails have unknown status/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Select a specific retry tier.
   *
   * @param tier - The tier to select: 'quick', 'standard', or 'thorough'
   */
  async selectTier(tier: 'quick' | 'standard' | 'thorough'): Promise<void> {
    const tierButtonMap = {
      quick: this.quickTierButton,
      standard: this.standardTierButton,
      thorough: this.thoroughTierButton,
    };
    const button = tierButtonMap[tier];
    
    // Use Playwright's built-in click with actionability checks
    await button.click({ timeout: 5000 });
    
    // Verify selection by checking for the checkmark circle
    await expect(button.locator('[data-testid="tier-checkmark"]')).toBeVisible({ timeout: 5000 });
  }

  /**
   * Get the currently selected tier.
   */
  async getSelectedTier(): Promise<'quick' | 'standard' | 'thorough' | null> {
    for (const tier of ['quick', 'standard', 'thorough'] as const) {
      const button = this.getTierButton(tier);
      // Use the checkmark circle selector which is specific to the selected tier
      const isSelected = await button.locator('.h-5.w-5.bg-primary.rounded-full').isVisible().catch(() => false);
      if (isSelected) return tier;
    }
    return null;
  }

  /**
   * Get a tier button by name.
   */
  private getTierButton(tier: 'quick' | 'standard' | 'thorough'): Locator {
    const map = {
      quick: this.quickTierButton,
      standard: this.standardTierButton,
      thorough: this.thoroughTierButton,
    };
    return map[tier];
  }

  /**
   * Toggle auto-escalate mode.
   *
   * @param enable - Whether to enable auto-escalate
   */
  async setAutoEscalate(enable: boolean): Promise<void> {
    const isChecked = await this.autoEscalateCheckbox.isChecked();
    if (isChecked !== enable) {
      // Use Playwright's built-in click with actionability checks
      await this.autoEscalateCheckbox.click({ timeout: 5000 });
    }
    await expect(this.autoEscalateCheckbox).toBeChecked({ checked: enable, timeout: 5000 });
  }

  /**
   * Check if auto-escalate is currently enabled.
   */
  async isAutoEscalateEnabled(): Promise<boolean> {
    return this.autoEscalateCheckbox.isChecked();
  }

  /**
   * Click the Retry button.
   * This will either start a manual retry or auto-escalation.
   */
  async clickRetry(): Promise<void> {
    await expect(this.retryButton).toBeEnabled();
    await this.retryButton.click();
  }

  /**
   * Click the Cancel button.
   */
  async clickCancel(): Promise<void> {
    await expect(this.cancelButton).toBeEnabled();
    await this.cancelButton.click();
  }

  /**
   * Wait for auto-escalation to start (modal shows escalation progress).
   */
  async waitForEscalationStart(timeout = 10000): Promise<void> {
    await expect(this.escalationProgress).toBeVisible({ timeout });
  }

  /**
   * Get the current escalation tier (1-3).
   */
  async getEscalationTier(): Promise<number | null> {
    const text = await this.escalationTierText.textContent();
    const match = text?.match(/Tier (\d+) of 3/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Get the number of emails being retried in current escalation.
   */
  async getEscalationEmailCount(): Promise<number | null> {
    const text = await this.escalationEmailCount.textContent();
    const match = text?.match(/Retrying (\d+) emails/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Wait for a specific escalation tier to be reached.
   */
  async waitForEscalationTier(tier: number, timeout = 30000): Promise<void> {
    await expect(this.escalationTierText).toContainText(`Tier ${tier} of 3`, { timeout });
  }

  /**
   * Check if the modal is in escalation mode (buttons disabled).
   */
  async isEscalating(): Promise<boolean> {
    return (await this.retryButton.getAttribute('disabled')) !== null;
  }

  /**
   * Get the retry button text (changes during escalation).
   */
  async getRetryButtonText(): Promise<string> {
    return (await this.retryButton.textContent()) || '';
  }

  /**
   * Take a screenshot of the retry modal.
   */
  async screenshot(name: string): Promise<Buffer> {
    return this.modal.screenshot({ path: `tests/screenshots/retry-modal-${name}.png` });
  }
}

/**
 * Factory function to create a RetryModalPage instance.
 */
export function createRetryModalPage(page: Page): RetryModalPage {
  return new RetryModalPage(page);
}
