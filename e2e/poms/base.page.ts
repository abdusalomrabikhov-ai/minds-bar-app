import { Page, Locator } from '@playwright/test';

export abstract class BasePage {
  protected readonly page: Page;
  readonly sidebar: Locator;
  readonly toastContainer: Locator;
  readonly loadingSpinner: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebar = page.locator('.sidebar');
    this.toastContainer = page.locator('.toast, .notification-toast').first();
    this.loadingSpinner = page.locator('.spinner, .loading').first();
  }

  abstract goto(id?: number): Promise<void>;

  // SSE keeps a persistent connection — networkidle never fires. Use 'load' instead.
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('load');
  }

  async navigateTo(pageName: string, id?: string | number): Promise<void> {
    const url = pageName === 'dashboard' ? '/' : `/${pageName}${id ? `/${id}` : ''}`;
    await this.page.goto(url);
    await this.waitForPageLoad();
  }

  async getToastMessage(): Promise<string> {
    await this.toastContainer.waitFor({ timeout: 5000 });
    return (await this.toastContainer.textContent()) ?? '';
  }

  async clickSidebarLink(pageName: string): Promise<void> {
    await this.sidebar.locator(`[data-page="${pageName}"]`).click();
    await this.waitForPageLoad();
  }
}
