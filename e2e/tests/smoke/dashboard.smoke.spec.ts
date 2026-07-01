import { test, expect } from '@playwright/test';
import { DashboardPage } from '../../poms/dashboard.page';

test.describe('Dashboard smoke', () => {
  test('dashboard loads with stat cards', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.verifyStatCardsVisible();
    await expect(dashboard.newTaskButton).toBeVisible();
    await expect(dashboard.notificationsButton).toBeVisible();
  });

  test('sidebar navigation visible', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.sidebarNav).toBeVisible();
    await expect(page.locator('button.nav-item[data-page="tasks"]')).toBeVisible();
    await expect(page.locator('button.nav-item[data-page="mytasks"]')).toBeVisible();
    await expect(page.locator('button.nav-item[data-page="settings"]')).toBeVisible();
  });

  test('clicking stat card navigates to filtered tasks', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.newTasksCard.click();
    await expect(page).toHaveURL(/\/tasks/, { timeout: 5000 });
  });
});
