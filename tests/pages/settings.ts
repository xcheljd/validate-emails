import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Settings Panel
 *
 * Encapsulates interactions with the settings content component
 * which includes Validation, History, Proxy, and Health tabs.
 */

export class SettingsPage {
  readonly page: Page;

  // Tab buttons
  readonly validationTab: Locator;
  readonly historyTab: Locator;
  readonly proxyTab: Locator;
  readonly healthTab: Locator;

  // Validation tab fields
  readonly validationModeSelect: Locator;
  readonly concurrencyInput: Locator;
  readonly timeoutInput: Locator;
  readonly retriesInput: Locator;
  readonly autoSaveInput: Locator;
  readonly maxPerSecondInput: Locator;
  readonly maxPerMinuteInput: Locator;
  readonly maxEmailsSessionInput: Locator;

  // History tab fields
  readonly retentionInput: Locator;
  readonly cleanupButton: Locator;

  // Proxy tab fields
  readonly proxyEnabledSwitch: Locator;
  readonly rotationModeSelect: Locator;
  readonly cooldownSlider: Locator;
  readonly proxyListContainer: Locator;

  // Footer buttons
  readonly saveButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    this.page = page;

    // Tab buttons
    this.validationTab = page.locator('button:has-text("Validation")');
    this.historyTab = page.locator('button:has-text("History")');
    this.proxyTab = page.locator('button:has-text("Proxy")');
    this.healthTab = page.locator('button:has-text("Health")');

    // Validation tab
    this.validationModeSelect = page.locator('#val-mode');
    this.concurrencyInput = page.locator('#concurrency');
    this.timeoutInput = page.locator('#timeout');
    this.retriesInput = page.locator('#retries');
    this.autoSaveInput = page.locator('#autosave');
    this.maxPerSecondInput = page.locator('#max-per-second');
    this.maxPerMinuteInput = page.locator('#max-per-minute');
    this.maxEmailsSessionInput = page.locator('#max-emails-session');

    // History tab
    this.retentionInput = page.locator('#retention');
    this.cleanupButton = page.locator('button:has-text("Clean Up Old Sessions")');

    // Proxy tab
    this.proxyEnabledSwitch = page.locator('#proxy-enabled');
    this.rotationModeSelect = page.locator('#rotation-mode');
    this.cooldownSlider = page.locator('#cooldown-duration');
    this.proxyListContainer = page.locator('[data-testid="proxy-list"], .proxy-list').first();

    // Footer
    this.saveButton = page.locator('button:has-text("Save Settings")');
    this.cancelButton = page.locator('button:has-text("Cancel")');
  }

  /**
   * Click the Validation tab.
   */
  async clickValidationTab(): Promise<void> {
    await this.validationTab.click();
  }

  /**
   * Click the History tab.
   */
  async clickHistoryTab(): Promise<void> {
    await this.historyTab.click();
  }

  /**
   * Click the Proxy tab.
   */
  async clickProxyTab(): Promise<void> {
    await this.proxyTab.click();
  }

  /**
   * Click the Health tab.
   */
  async clickHealthTab(): Promise<void> {
    await this.healthTab.click();
  }

  /**
   * Select a validation mode from the dropdown.
   */
  async selectValidationMode(mode: 'quick' | 'standard' | 'thorough'): Promise<void> {
    await this.clickValidationTab();
    await this.validationModeSelect.selectOption(mode);
  }

  /**
   * Set concurrency value.
   */
  async setConcurrency(value: number): Promise<void> {
    await this.clickValidationTab();
    await this.concurrencyInput.fill(value.toString());
  }

  /**
   * Set timeout value.
   */
  async setTimeout(value: number): Promise<void> {
    await this.clickValidationTab();
    await this.timeoutInput.fill(value.toString());
  }

  /**
   * Set max retries value.
   */
  async setRetries(value: number): Promise<void> {
    await this.clickValidationTab();
    await this.retriesInput.fill(value.toString());
  }

  /**
   * Get current validation mode value.
   */
  async getValidationMode(): Promise<string> {
    return this.validationModeSelect.inputValue();
  }

  /**
   * Get current concurrency value.
   */
  async getConcurrency(): Promise<number> {
    return parseInt(await this.concurrencyInput.inputValue(), 10);
  }

  /**
   * Get current timeout value.
   */
  async getTimeout(): Promise<number> {
    return parseInt(await this.timeoutInput.inputValue(), 10);
  }

  /**
   * Toggle proxy enabled switch.
   */
  async toggleProxyEnabled(): Promise<void> {
    await this.clickProxyTab();
    await this.proxyEnabledSwitch.click();
  }

  /**
   * Enable or disable proxy.
   */
  async setProxyEnabled(enabled: boolean): Promise<void> {
    await this.clickProxyTab();
    const isChecked = (await this.proxyEnabledSwitch.getAttribute('aria-checked')) === 'true';
    if (isChecked !== enabled) {
      await this.proxyEnabledSwitch.click();
    }
  }

  /**
   * Check if proxy is enabled.
   */
  async isProxyEnabled(): Promise<boolean> {
    return (await this.proxyEnabledSwitch.getAttribute('aria-checked')) === 'true';
  }

  /**
   * Select proxy rotation mode.
   */
  async selectRotationMode(mode: 'manual' | 'automatic' | 'perDomain'): Promise<void> {
    await this.clickProxyTab();
    await this.rotationModeSelect.selectOption(mode);
  }

  /**
   * Get current rotation mode.
   */
  async getRotationMode(): Promise<string> {
    return this.rotationModeSelect.inputValue();
  }

  /**
   * Set session retention days.
   */
  async setRetentionDays(days: number): Promise<void> {
    await this.clickHistoryTab();
    await this.retentionInput.fill(days.toString());
  }

  /**
   * Get current retention days value.
   */
  async getRetentionDays(): Promise<number> {
    return parseInt(await this.retentionInput.inputValue(), 10);
  }

  /**
   * Click Save Settings button.
   */
  async clickSave(): Promise<void> {
    await this.saveButton.click();
  }

  /**
   * Click Cancel button.
   */
  async clickCancel(): Promise<void> {
    await this.cancelButton.click();
  }

  /**
   * Verify we are on a specific tab by checking the active tab button variant.
   */
  async expectActiveTab(tabName: 'Validation' | 'History' | 'Proxy' | 'Health'): Promise<void> {
    const tabMap: Record<string, Locator> = {
      Validation: this.validationTab,
      History: this.historyTab,
      Proxy: this.proxyTab,
      Health: this.healthTab,
    };
    const tab = tabMap[tabName];
    await expect(tab).toHaveAttribute('data-state', 'active');
  }

  /**
   * Set rate limiting max emails per session.
   */
  async setMaxEmailsPerSession(value: number): Promise<void> {
    await this.clickValidationTab();
    await this.maxEmailsSessionInput.fill(value.toString());
  }

  /**
   * Set rate limiting max per second.
   */
  async setMaxPerSecond(value: number): Promise<void> {
    await this.clickValidationTab();
    await this.maxPerSecondInput.fill(value.toString());
  }

  /**
   * Set rate limiting max per minute.
   */
  async setMaxPerMinute(value: number): Promise<void> {
    await this.clickValidationTab();
    await this.maxPerMinuteInput.fill(value.toString());
  }

  /**
   * Take a screenshot of the settings panel.
   */
  async screenshot(name: string): Promise<Buffer> {
    return this.page.screenshot({ path: `tests/screenshots/settings-${name}.png` });
  }
}

/**
 * Factory function to create a SettingsPage instance.
 */
export function createSettingsPage(page: Page): SettingsPage {
  return new SettingsPage(page);
}
