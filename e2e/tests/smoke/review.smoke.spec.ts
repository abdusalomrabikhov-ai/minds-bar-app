import { test, expect } from '@playwright/test';
import { ReviewPage } from '../../poms/review.page';

test.describe('Review smoke', () => {
  test('задачи для проверки открываются без ошибок', async ({ page }) => {
    const review = new ReviewPage(page);
    await review.goto();
    // No "Invalid id" error
    await expect(review.pageContent).not.toContainText('Invalid id');
    await expect(review.pageContent).not.toContainText('Ошибка загрузки');
    // Either task list or empty state present in DOM
    const taskListCount = await review.taskList.count();
    const emptyCount    = await review.emptyState.count();
    expect(taskListCount + emptyCount).toBeGreaterThan(0);
  });

  test('заголовок страницы виден', async ({ page }) => {
    const review = new ReviewPage(page);
    await review.goto();
    await expect(review.heading).toContainText('Задачи для проверки');
  });

  test('счётчик задач отображается', async ({ page }) => {
    const review = new ReviewPage(page);
    await review.goto();
    await expect(review.taskCount).toBeVisible();
  });
});
