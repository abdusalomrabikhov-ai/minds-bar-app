import { test, expect } from '@playwright/test';
import { TasksPage } from '../../poms/tasks.page';

const TEST_TITLE = `[E2E] Тестовая задача ${Date.now()}`;

test.describe('Task create E2E smoke', () => {
  test('создать задачу — появляется в списке', async ({ page }) => {
    const tasks = new TasksPage(page);
    await tasks.goto();

    // Open new task modal
    await tasks.openNewTaskModal();
    await expect(tasks.newTaskModal).toBeVisible();

    // Fill title
    await page.fill('#f-title', TEST_TITLE);

    // Save
    await page.click('#save-task-btn');

    // Modal should close
    await expect(tasks.newTaskModal).not.toBeVisible({ timeout: 8000 });

    // Search for created task
    await tasks.search(TEST_TITLE.slice(0, 30));
    await expect(page.locator('#tasks-list-container').getByText(TEST_TITLE)).toBeVisible({ timeout: 8000 });
  });

  test('создание без заголовка показывает ошибку', async ({ page }) => {
    const tasks = new TasksPage(page);
    await tasks.goto();
    await tasks.openNewTaskModal();
    await expect(tasks.newTaskModal).toBeVisible();

    // Clear title and try to save
    await page.fill('#f-title', '');
    await page.click('#save-task-btn');

    // Modal must stay open and toast appear
    await Promise.all([
      expect(tasks.newTaskModal).toBeVisible({ timeout: 5000 }),
      expect(page.locator('.toast').first()).toBeVisible({ timeout: 5000 }),
    ]);
  });
});
