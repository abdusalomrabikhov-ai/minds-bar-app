import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class ReviewPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get heading(): Locator {
    return this.page.locator('#page-content h2');
  }

  get taskCount(): Locator {
    return this.page.locator('#page-content span').filter({ hasText: /задач|задача|задачи/ }).first();
  }

  get emptyState(): Locator {
    return this.page.locator('#page-content .empty-state');
  }

  get taskList(): Locator {
    return this.page.locator('#page-content .review-tasks-list');
  }

  get pageContent(): Locator {
    return this.page.locator('#page-content');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    const navBtn = this.page.locator('button.nav-item[data-page="review"]');
    await navBtn.waitFor({ state: 'visible', timeout: 10000 });
    await navBtn.click();
    await this.page.waitForFunction(() => {
      const c = document.getElementById('page-content');
      return c !== null && !c.innerHTML.includes('Загрузка...');
    }, { timeout: 10000 });
  }
}
