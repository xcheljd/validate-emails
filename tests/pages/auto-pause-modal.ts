import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Auto-Pause Modal
 *
 * Encapsulates interactions with the auto-pause modal that appears
 * after 8+ consecutive validation failures.
 */

export class AutoPauseModalPage {
  readonly page: Page;

  // Modal container
  readonly modal: Locator;
  readonly modalContent: Locator;

  // Header elements
  readonly title: Locator;
  readonly description: Locator;
  readonly alertIcon: Locator;

  // Failure count display
  readonly failureCountContainer: Locator;
  readonly failureCountText: Locator;

  // Footer buttons
  readonly stopButton: Locator;
  readonly resumeButton: Locator;

  // Overlay (for click-outside detection)
  readonly overlay: Locator;

  constructor(page: Page) {
    this.page = page;

    // Modal container - use filter instead of :has-text() for Tauri compatibility
    this.modal = page.locator('[role="dialog"]').filter({ hasText: 'Validation Auto-Paused' });
    this.modalContent = this.modal.locator('> div').first(); // DialogContent is direct child

    // Header - use filter instead of :has-text() for Tauri compatibility
    this.title = this.modal.locator('h2').filter({ hasText: 'Validation Auto-Paused' });
    this.description = this.modal.locator('p').filter({ hasText: 'Too many consecutive failures' });
    // The AlertOctagon icon renders as an img inside the h2
    this.alertIcon = this.modal.locator('h2:has-text("Validation Auto-Paused") > img').first();

    // Failure count - find the paragraph containing the failure count
    this.failureCountContainer = this.modal.locator('p').filter({ hasText: /consecutive failures/ }).first();
    this.failureCountText = this.failureCountContainer.locator('strong');

    // Footer buttons
    this.stopButton = this.modal.locator('button:has-text("Stop Validation")');
    this.resumeButton = this.modal.locator('button:has-text("Resume")');

    // Overlay (backdrop) - Radix Dialog overlay
    this.overlay = page.locator('[data-radix-dialog-overlay]');
  }

  /**
   * Wait for the auto-pause modal to be visible.
   */
  async waitForVisible(timeout = 10000): Promise<void> {
    await expect(this.modal).toBeVisible({ timeout });
  }

  /**
   * Wait for the auto-pause modal to be hidden.
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
   * Get the failure count displayed in the modal.
   */
  async getFailureCount(): Promise<number> {
    const text = await this.failureCountText.textContent();
    return text ? parseInt(text, 10) : 0;
  }

  /**
   * Click the Resume button to continue validation.
   */
  async clickResume(): Promise<void> {
    await expect(this.resumeButton).toBeEnabled();
    await this.resumeButton.click();
  }

  /**
   * Click the Stop Validation button to halt validation.
   */
  async clickStop(): Promise<void> {
    await expect(this.stopButton).toBeEnabled();
    await this.stopButton.click();
  }

  /**
   * Press Escape key to close the modal (triggers stop).
   */
  async pressEscape(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }

  /**
   * Click outside the modal (on overlay) to close it (triggers stop).
   */
  async clickOutside(): Promise<void> {
    // Try clicking the overlay first
    const overlay = this.page.locator('[data-radix-dialog-overlay]');
    if (await overlay.isVisible({ timeout: 1000 }).catch(() => false)) {
      await overlay.click({ position: { x: 10, y: 10 } });
    } else {
      // Fallback: click on the body element at top-left corner (0, 0)
      // which is always outside any centered modal
      await this.page.locator('body').click({ position: { x: 0, y: 0 } });
    }
  }

  /**
   * Check if the Resume button is enabled.
   */
  async isResumeEnabled(): Promise<boolean> {
    return this.resumeButton.isEnabled();
  }

  /**
   * Check if the Stop button is enabled.
   */
  async isStopEnabled(): Promise<boolean> {
    return this.stopButton.isEnabled();
  }

  /**
   * Get the modal title text.
   */
  async getTitle(): Promise<string> {
    return (await this.title.textContent()) || '';
  }

  /**
   * Get the modal description text.
   */
  async getDescription(): Promise<string> {
    return (await this.description.textContent()) || '';
  }

  /**
   * Verify the modal has the expected failure count.
   */
  async expectFailureCount(count: number): Promise<void> {
    await expect(this.failureCountText).toHaveText(count.toString());
  }

  /**
   * Take a screenshot of the auto-pause modal.
   */
  async screenshot(name: string): Promise<Buffer> {
    return this.modal.screenshot({ path: `tests/screenshots/auto-pause-modal-${name}.png` });
  }
}

/**
 * Factory function to create an AutoPauseModalPage instance.
 */
export function createAutoPauseModalPage(page: Page): AutoPauseModalPage {
  return new AutoPauseModalPage(page);
}
