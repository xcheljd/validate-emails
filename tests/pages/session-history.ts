import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Session History View
 *
 * Encapsulates interactions with the session history list
 * and session diff view.
 */

export class SessionHistoryPage {
  readonly page: Page;

  // Session list
  readonly sessionList: Locator;
  readonly sessionItems: Locator;

  // Session diff view
  readonly diffView: Locator;
  readonly diffHeader: Locator;
  readonly backButton: Locator;

  // Session A info
  readonly sessionAName: Locator;
  readonly sessionAResults: Locator;
  readonly sessionADate: Locator;

  // Session B info
  readonly sessionBName: Locator;
  readonly sessionBResults: Locator;
  readonly sessionBDate: Locator;

  // Summary cards
  readonly verdictSummaryCards: Locator;

  // Stats summary
  readonly statsSummary: Locator;
  readonly changeSummaryBadges: Locator;

  // Changed section
  readonly changedSection: Locator;
  readonly changedTable: Locator;
  readonly changedRows: Locator;

  // Added section
  readonly addedSection: Locator;
  readonly addedTable: Locator;
  readonly addedRows: Locator;

  // Removed section
  readonly removedSection: Locator;
  readonly removedTable: Locator;
  readonly removedRows: Locator;

  constructor(page: Page) {
    this.page = page;

    // Session list - the table wrapper div with class 'rounded-md border bg-card'
    this.sessionList = page.locator('div.rounded-md.border.bg-card').first();
    this.sessionItems = this.sessionList.locator('tbody tr');

    // Session diff view
    this.diffView = page.locator('text=Session Comparison').locator('..').locator('..');
    this.diffHeader = page.locator('h2:has-text("Session Comparison")');
    this.backButton = page.locator('button:has-text("Back to History")');

    // Session A info
    this.sessionAName = page.locator('text=Session A').locator('..').locator('p.font-semibold').first();
    this.sessionAResults = page.locator('text=Session A').locator('..').locator('p.text-xs').first();
    this.sessionADate = page.locator('text=Session A').locator('..').locator('p.text-xs').nth(1);

    // Session B info
    this.sessionBName = page.locator('text=Session B').locator('..').locator('p.font-semibold').first();
    this.sessionBResults = page.locator('text=Session B').locator('..').locator('p.text-xs').first();
    this.sessionBDate = page.locator('text=Session B').locator('..').locator('p.text-xs').nth(1);

    // Summary cards
    this.verdictSummaryCards = page.locator('div.grid.grid-cols-2.md\\:grid-cols-4.gap-4 > div');

    // Stats summary
    this.statsSummary = page.locator('div.p-4.bg-muted\\/50.rounded-lg.border');
    this.changeSummaryBadges = page.locator('div.flex.flex-wrap.gap-2.mt-2 > div');

    // Changed section - the table is inside a div.px-4.pb-4 which is a sibling of the button
    // text=Changed Verdicts -> parent (button) -> parent (div.border.rounded-lg) -> div.px-4.pb-4 -> table
    this.changedSection = page.locator('text=Changed Verdicts').locator('..').locator('..');
    this.changedTable = this.changedSection.locator('div.px-4.pb-4 table');
    this.changedRows = this.changedTable.locator('tbody tr');

    // Added section
    this.addedSection = page.locator('text=Added Emails').locator('..').locator('..');
    this.addedTable = this.addedSection.locator('div.px-4.pb-4 table');
    this.addedRows = this.addedTable.locator('tbody tr');

    // Removed section
    this.removedSection = page.locator('text=Removed Emails').locator('..').locator('..');
    this.removedTable = this.removedSection.locator('div.px-4.pb-4 table');
    this.removedRows = this.removedTable.locator('tbody tr');
  }

  /**
   * Wait for the session history list to be visible.
   */
  async waitForHistoryVisible(timeout = 10000): Promise<void> {
    await expect(this.sessionList).toBeVisible({ timeout });
  }

  /**
   * Get the number of sessions in the list.
   */
  async getSessionCount(): Promise<number> {
    return this.sessionItems.count();
  }

  /**
   * Click a session to view details.
   */
  async clickSession(index: number): Promise<void> {
    await this.sessionItems.nth(index).click();
  }

  /**
   * Click the compare button for a session (if available).
   */
  async clickCompareSession(sessionIndex: number): Promise<void> {
    const session = this.sessionItems.nth(sessionIndex);
    const compareButton = session.locator('button:has-text("Compare")');
    await compareButton.click();
  }

  /**
   * Wait for the session diff view to be visible.
   */
  async waitForDiffVisible(timeout = 10000): Promise<void> {
    await expect(this.diffHeader).toBeVisible({ timeout });
  }

  /**
   * Get session A name.
   */
  async getSessionAName(): Promise<string> {
    return (await this.sessionAName.textContent()) || '';
  }

  /**
   * Get session B name.
   */
  async getSessionBName(): Promise<string> {
    return (await this.sessionBName.textContent()) || '';
  }

  /**
   * Get the change summary badges text.
   */
  async getChangeSummary(): Promise<string[]> {
    const badges = await this.changeSummaryBadges.allTextContents();
    return badges.map(b => b.trim()).filter(b => b.length > 0);
  }

  /**
   * Get the number of changed verdicts.
   */
  async getChangedCount(): Promise<number> {
    return this.changedRows.count();
  }

  /**
   * Get changed verdict details.
   */
  async getChangedDetails(): Promise<Array<{email: string, oldVerdict: string, newVerdict: string, direction: string}>> {
    const details: Array<{email: string, oldVerdict: string, newVerdict: string, direction: string}> = [];
    const count = await this.changedRows.count();
    for (let i = 0; i < count; i++) {
      const row = this.changedRows.nth(i);
      const email = await row.locator('td').nth(0).textContent();
      const oldVerdict = await row.locator('td').nth(1).textContent();
      const newVerdict = await row.locator('td').nth(3).textContent();
      const direction = await row.locator('td').nth(4).textContent();
      details.push({
        email: email?.trim() || '',
        oldVerdict: oldVerdict?.trim() || '',
        newVerdict: newVerdict?.trim() || '',
        direction: direction?.trim() || '',
      });
    }
    return details;
  }

  /**
   * Get the number of added emails.
   */
  async getAddedCount(): Promise<number> {
    return this.addedRows.count();
  }

  /**
   * Get the number of removed emails.
   */
  async getRemovedCount(): Promise<number> {
    return this.removedRows.count();
  }

  /**
   * Click the Back to History button.
   */
  async clickBackToHistory(): Promise<void> {
    await this.backButton.click();
  }

  /**
   * Take a screenshot of the session diff view.
   */
  async screenshot(name: string): Promise<Buffer> {
    return this.diffView.screenshot({ path: `tests/screenshots/session-diff-${name}.png` });
  }
}

/**
 * Factory function to create a SessionHistoryPage instance.
 */
export function createSessionHistoryPage(page: Page): SessionHistoryPage {
  return new SessionHistoryPage(page);
}
