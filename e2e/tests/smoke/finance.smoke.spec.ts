import { test, expect } from '@playwright/test';
import { FinancePage } from '../../poms/finance.page';

test.describe('Finance smoke', () => {
  test('страница финансов открывается', async ({ page }) => {
    const finance = new FinancePage(page);
    await finance.goto();
    await expect(finance.pageContent).not.toContainText('Ошибка');
    await expect(finance.tabsBar).toBeVisible();
  });

  test('таблица финансов загружается', async ({ page }) => {
    const finance = new FinancePage(page);
    await finance.goto();
    await expect(finance.financeTable).toBeVisible({ timeout: 8000 });
  });

  test('переключение вкладок не ломает страницу', async ({ page }) => {
    const finance = new FinancePage(page);
    await finance.goto();
    // Click through available tabs (first 3)
    const tabs = page.locator('#page-content button.fin-tab');
    const count = await tabs.count();
    for (let i = 0; i < Math.min(count, 3); i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(800);
      await expect(finance.pageContent).not.toContainText('Ошибка');
    }
  });

  test('вкладка Таймшит открывается', async ({ page }) => {
    const finance = new FinancePage(page);
    await finance.goto();
    const timesheetBtn = page.locator('#page-content button.fin-tab').filter({ hasText: 'Табель' });
    await timesheetBtn.click();
    await page.waitForFunction(() => {
      const c = document.getElementById('page-content');
      return c !== null && !c.innerHTML.includes('Загрузка...');
    }, { timeout: 10000 });
    await expect(finance.pageContent).not.toContainText('Ошибка');
    await expect(finance.timesheetTable).toBeVisible({ timeout: 8000 });
  });

  test('XLSX не загружается при открытии финансов (lazy)', async ({ page }) => {
    const finance = new FinancePage(page);
    await finance.goto();
    const xlsxLoaded = await page.evaluate(() => !!window.XLSX);
    expect(xlsxLoaded).toBe(false);
  });
});
