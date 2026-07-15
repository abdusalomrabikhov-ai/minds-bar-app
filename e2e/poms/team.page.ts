import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

export class TeamPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get memberCards(): Locator {
    return this.page.locator('#page-content .team-member-card, #page-content .member-card, #page-content [class*="team-card"]');
  }

  get tabsBar(): Locator {
    return this.page.locator('#page-content .team-tabs-bar').first();
  }

  get workloadTab(): Locator {
    return this.page.locator('#page-content .team-tabs-bar button.fin-tab').filter({ hasText: 'Нагрузка' });
  }

  get pageContent(): Locator {
    return this.page.locator('#page-content');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    const navBtn = this.page.locator('button.nav-item[data-page="team"]');
    await navBtn.waitFor({ state: 'visible', timeout: 10000 });
    await navBtn.click();
    await this.page.waitForFunction(() => {
      const c = document.getElementById('page-content');
      return c !== null && !c.innerHTML.includes('Загрузка...');
    }, { timeout: 10000 });
  }
}
