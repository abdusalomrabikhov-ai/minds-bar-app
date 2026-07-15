import { test, expect } from '@playwright/test';
import { BestEmployeePage } from '../../poms/best-employee.page';

test.describe('Best Employee smoke', () => {
  test('страница лучшего сотрудника открывается', async ({ page }) => {
    const be = new BestEmployeePage(page);
    await be.goto();
    await expect(be.pageContent).not.toContainText('Ошибка');
    await expect(be.pageContent).not.toContainText('Invalid id');
  });

  test('вкладки месяцев видны', async ({ page }) => {
    const be = new BestEmployeePage(page);
    await be.goto();
    await expect(be.monthTabs).toBeVisible();
  });

  test('карточка чемпиона или пустое состояние', async ({ page }) => {
    const be = new BestEmployeePage(page);
    await be.goto();
    const champCount = await be.championCard.count();
    const emptyCount = await be.emptyState.count();
    expect(champCount + emptyCount).toBeGreaterThan(0);
  });

  test('переключение месяца не ломает страницу', async ({ page }) => {
    const be = new BestEmployeePage(page);
    await be.goto();
    // Click second month tab if it exists
    const tabs = page.locator('#page-content .be-month-bar button.be-month-tab');
    const count = await tabs.count();
    if (count >= 2) {
      await tabs.nth(1).click();
      await page.waitForFunction(() => {
        const c = document.getElementById('page-content');
        return c !== null && !c.innerHTML.includes('Загрузка...');
      }, { timeout: 8000 });
      await expect(be.pageContent).not.toContainText('Ошибка');
    }
  });
});
