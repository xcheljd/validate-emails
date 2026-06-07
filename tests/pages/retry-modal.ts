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

  constructor(page: Page) {
    this.page = page;

    // Modal container
    this.modal = page.locator('[role="dialog"]:has-text("Retry Unknown Emails")');

    // Header - use text-based selectors since Radix UI uses dynamic IDs
    this.title = this.modal.locator('h2:has-text("Retry Unknown Emails")');
    this.description = this.modal.locator('p:has-text("emails have unknown status")');

    // Tier selection
    this.tierSection = this.modal.locator('text=Select retry tier').locator('..');
    this.tierButtons = this.tierSection.locator('button[role="button"]');
    this.quickTierButton = this.tierButtons.filter({ hasText: 'Tier 1: Quick' });
    this.standardTierButton = this.tierButtons.filter({ hasText: 'Tier 2: Standard' });
    this.thoroughTierButton = this.tierButtons.filter({ hasText: 'Tier 3: Thorough' });

    // Auto-escalate
    this.autoEscalateSection = this.modal.locator('text=Auto-Escalate').locator('..');
    this.autoEscalateCheckbox = this.modal.locator('[role="checkbox"][aria-label="Auto-Escalate"]');
    this.autoEscalateLabel = this.autoEscalateSection.locator('label');

    // Escalation progress (shown during auto-escalation)
    // The escalation progress div has a blue background and contains "Tier X of 3" text
    this.escalationProgress = this.modal.locator('div.bg-blue-50, div.bg-blue-950\\/30').filter({ hasText: /Tier \d+ of 3/ });
    this.escalationTierText = this.modal.locator('text=/Tier \\d+ of 3/');
    this.escalationEmailCount = this.modal.locator('text=/Retrying \\d+ emails/');

    // Footer buttons
    this.cancelButton = this.modal.locator('button:has-text("Cancel")');
    this.retryButton = this.modal.locator('button:has-text("Retry"), button:has-text("Escalating...")');
  }

  /**
   * Wait for the retry modal to be visible.
   */
  async waitForVisible(timeout = 10000): Promise<void> {
    await expect(this.modal).toBeVisible({ timeout });
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
    await expect(button).toBeEnabled();
    await button.click();

    // Verify selection by checking for the checkmark circle (more specific than .bg-primary)
    await expect(button.locator('.h-5.w-5.bg-primary.rounded-full')).toBeVisible();
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
      // Click the auto-escalate section (the whole clickable area) instead of just the label
      await this.autoEscalateSection.click();
    }
    await expect(this.autoEscalateCheckbox).toBeChecked({ checked: enable });
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
