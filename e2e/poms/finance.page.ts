import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class FinancePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get tabsBar(): Locator {
    return this.page.locator('#page-content .fin-tabs-bar').first();
  }

  get pageContent(): Locator {
    return this.page.locator('#page-content');
  }

  get timesheetTab(): Locator {
    return this.page.locator('#page-content button.fin-tab').filter({ hasText: 'Табель' });
  }

  get financeTable(): Locator {
    return this.page.locator('#page-content .fin-table-wrap, #page-content table').first();
  }

  get financeRows(): Locator {
    return this.page.locator('#page-content .fin-row');
  }

  get timesheetTable(): Locator {
    return this.page.locator('#page-content table').first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    const navBtn = this.page.locator('button.nav-item[data-page="finance"]');
    await navBtn.waitFor({ state: 'visible', timeout: 10000 });
    await navBtn.click();
    await this.page.waitForFunction(() => {
      const c = document.getElementById('page-content');
      return c !== null && !c.innerHTML.includes('Загрузка...');
    }, { timeout: 12000 });
  }

  async openTimesheetTab(): Promise<void> {
    await this.timesheetTab.click();
    await this.page.waitForFunction(() => {
      const c = document.getElementById('page-content');
      return c !== null && !c.innerHTML.includes('Загрузка...');
    }, { timeout: 10000 });
  }
}
