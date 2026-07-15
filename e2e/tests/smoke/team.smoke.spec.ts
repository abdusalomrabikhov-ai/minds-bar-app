import { test, expect } from '@playwright/test';
import { TeamPage } from '../../poms/team.page';

test.describe('Team smoke', () => {
  test('страница команды открывается', async ({ page }) => {
    const team = new TeamPage(page);
    await team.goto();
    await expect(team.pageContent).not.toContainText('Ошибка');
    // Member cards or some content present
    const txt = await team.pageContent.textContent();
    expect(txt && txt.length > 50).toBe(true);
  });

  test('карточки сотрудников видны', async ({ page }) => {
    const team = new TeamPage(page);
    await team.goto();
    await expect(team.memberCards.first()).toBeVisible({ timeout: 8000 });
  });

  test('вкладки (Сотрудники / Нагрузка) видны', async ({ page }) => {
    const team = new TeamPage(page);
    await team.goto();
    await expect(team.tabsBar).toBeVisible();
  });

  test('вкладка Нагрузка открывается', async ({ page }) => {
    const team = new TeamPage(page);
    await team.goto();
    await team.workloadTab.click();
    await page.waitForFunction(() => {
      const c = document.getElementById('page-content');
      return c !== null && !c.innerHTML.includes('Загрузка...');
    }, { timeout: 10000 });
    await expect(team.pageContent).not.toContainText('Ошибка');
  });
});
