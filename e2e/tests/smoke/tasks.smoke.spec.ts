import { test, expect } from '@playwright/test';
import { TasksPage } from '../../poms/tasks.page';

test.describe('Tasks smoke', () => {
  test('tasks page loads with search and filters', async ({ page }) => {
    const tasks = new TasksPage(page);
    await tasks.goto();
    await expect(tasks.searchInput).toBeVisible();
    await expect(tasks.filterAll).toBeVisible();
    await expect(tasks.filterNew).toBeVisible();
    await expect(tasks.filterDone).toBeVisible();
  });

  test('search filters task list', async ({ page }) => {
    const tasks = new TasksPage(page);
    await tasks.goto();
    await tasks.search('zzznonexistent999');
    // List should show empty state, not error
    await expect(tasks.taskListContainer).toBeVisible();
    await expect(page.locator('.error, [data-error]')).not.toBeVisible();
  });

  test('status filters are clickable', async ({ page }) => {
    const tasks = new TasksPage(page);
    await tasks.goto();
    for (const f of [tasks.filterNew, tasks.filterInProgress, tasks.filterDone, tasks.filterOverdue]) {
      await f.click();
      await expect(tasks.taskListContainer).toBeVisible();
    }
  });

  test('new task button opens modal', async ({ page }) => {
    const tasks = new TasksPage(page);
    await tasks.goto();
    await tasks.openNewTaskModal();
    await expect(tasks.newTaskModal).toBeVisible();
    // Close it
    await page.keyboard.press('Escape');
  });
});
