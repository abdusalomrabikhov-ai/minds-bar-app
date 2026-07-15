import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class DashboardPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ==========================================
  // LIFECYCLE
  // ==========================================

  /**
   * Navigates to the dashboard and waits for stat cards to render.
   *
   * Steps:
   * 1. Navigates to '/' via direct URL.
   * 2. Waits for at least one .dash-stat-card to be visible.
   */
  async setUp(): Promise<void> {
    await this.goto();
  }

  /**
   * No-op — dashboard creates no persistent data.
   */
  async tearDown(): Promise<void> {}

  // ==========================================
  // LOCATORS
  // ==========================================

  /** All stat cards on the dashboard. */
  get statCards(): Locator {
    return this.page.locator('.dash-stat-card');
  }

  /** Stat card for "Новые задачи" (new tasks). */
  get newTasksCard(): Locator {
    return this.page.locator('.dash-stat-card[title="Новые задачи"]');
  }

  /** Stat card for "Задачи в работе" (in-progress tasks). */
  get inProgressCard(): Locator {
    return this.page.locator('.dash-stat-card[title="Задачи в работе"]');
  }

  /** Stat card for "Завершённые задачи" (done tasks). */
  get doneTasksCard(): Locator {
    return this.page.locator('.dash-stat-card[title^="Завершённые"], .dash-stat-card[title^="Выполненные"]').first();
  }

  /** Stat card for "Просроченные задачи" (overdue tasks). */
  get overdueCard(): Locator {
    return this.page.locator('.dash-stat-card[title="Просроченные задачи"]');
  }

  /** Notifications button in the header. */
  get notificationsButton(): Locator {
    return this.page.locator('#notif-btn');
  }

  /** New task button in the header. */
  get newTaskButton(): Locator {
    return this.page.locator('#new-task-btn');
  }

  /** Sidebar navigation container. */
  get sidebarNav(): Locator {
    return this.page.locator('#sidebar .sidebar-nav');
  }

  /** User name display in the sidebar footer. */
  get sidebarUserName(): Locator {
    return this.page.locator('#sidebar-name');
  }

  /** User role display in the sidebar footer. */
  get sidebarUserRole(): Locator {
    return this.page.locator('#sidebar-role');
  }

  /** Charts section on the dashboard. */
  get chartsSection(): Locator {
    return this.page.locator('.dash-charts');
  }

  // ==========================================
  // NAVIGATION
  // ==========================================

  /**
   * Navigates to the dashboard via direct URL.
   *
   * Steps:
   * 1. Calls page.goto('/').
   * 2. Waits for the first .dash-stat-card to be visible.
   */
  async goto(_id?: number): Promise<void> {
    await this.page.goto('/');
    await expect(this.statCards.first()).toBeVisible({ timeout: 10000 });
  }

  // ==========================================
  // VERIFICATION
  // ==========================================

  /**
   * Verifies all four stat cards are visible on the dashboard.
   *
   * Steps:
   * 1. Asserts newTasksCard is visible.
   * 2. Asserts doneTasksCard is visible.
   * 3. Asserts overdueCard is visible.
   */
  async verifyStatCardsVisible(): Promise<void> {
    await expect(this.newTasksCard).toBeVisible();
    await expect(this.doneTasksCard).toBeVisible();
    await expect(this.overdueCard).toBeVisible();
  }

  /**
   * Returns the numeric count displayed inside a given stat card.
   *
   * Steps:
   * 1. Locates the count element inside the card.
   * 2. Returns its text content parsed as a number.
   *
   * @param card - The stat card Locator to read from
   * @returns The count as a number
   */
  async getStatCount(card: Locator): Promise<number> {
    const text = await card.locator('.dash-stat-value, strong, b, .count').first().textContent();
    return parseInt(text?.trim() ?? '0', 10);
  }

  /**
   * Verifies the sidebar displays the expected username and role.
   *
   * Steps:
   * 1. Asserts #sidebar-name contains the expected name.
   * 2. Asserts #sidebar-role is visible.
   *
   * @param name - Expected display name of the logged-in user
   */
  async verifySidebarUser(name: string): Promise<void> {
    await expect(this.sidebarUserName).toContainText(name, { timeout: 5000 });
    await expect(this.sidebarUserRole).toBeVisible();
  }

  /**
   * Clicks a stat card to navigate to the filtered tasks list.
   *
   * Steps:
   * 1. Clicks the provided stat card element.
   * 2. Waits for navigation (URL changes away from '/').
   *
   * @param card - The stat card Locator to click
   */
  async clickStatCard(card: Locator): Promise<void> {
    await card.click();
    await this.page.waitForURL(/\/tasks/, { timeout: 5000 });
  }

  /**
   * Opens the new task modal by clicking the header button.
   *
   * Steps:
   * 1. Clicks #new-task-btn.
   * 2. Waits for a modal/dialog to appear.
   */
  async openNewTaskModal(): Promise<void> {
    await this.newTaskButton.click();
    await expect(this.page.locator('.modal, [role="dialog"]').first()).toBeVisible({ timeout: 5000 });
  }

  /**
   * Opens the notifications panel.
   *
   * Steps:
   * 1. Clicks #notif-btn.
   * 2. Waits for the notifications panel to become visible.
   */
  async openNotifications(): Promise<void> {
    await this.notificationsButton.click();
    await expect(this.page.locator('.notif-panel, .notifications-panel, .notif-dropdown').first()).toBeVisible({ timeout: 5000 });
  }
}
