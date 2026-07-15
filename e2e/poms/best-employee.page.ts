import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

export class BestEmployeePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get pageContent(): Locator {
    return this.page.locator('#page-content');
  }

  get monthTabs(): Locator {
    return this.page.locator('#page-content .be-month-bar button.be-month-tab').first();
  }

  get championCard(): Locator {
    return this.page.locator('#page-content .be-champion-card');
  }

  get emptyState(): Locator {
    return this.page.locator('#page-content .be-empty');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    const navBtn = this.page.locator('button.nav-item[data-page="best-employee"]');
    await navBtn.waitFor({ state: 'visible', timeout: 10000 });
    await navBtn.click();
    await this.page.waitForFunction(() => {
      const c = document.getElementById('page-content');
      return c !== null && !c.innerHTML.includes('Загрузка...');
    }, { timeout: 10000 });
  }
}
