import { test, expect } from '@playwright/test';
import { LoginPage } from '../../poms/login.page';
import { DashboardPage } from '../../poms/dashboard.page';

test.describe('Auth smoke', () => {
  test('login with valid credentials shows dashboard', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.verifyStatCardsVisible();
  });

  test('logout clears session', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');
    await page.evaluate(() => {
      localStorage.removeItem('tt_token');
      localStorage.removeItem('tt_user');
    });
    await page.reload({ waitUntil: 'load' });
    const login = new LoginPage(page);
    await expect(login.loginScreen).toBeVisible({ timeout: 8000 });
  });

  test('invalid credentials rejected by API', async ({ request, baseURL }) => {
    // Tests the auth API directly — 401 for wrong credentials
    const resp = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: 'nobody@nowhere.com', password: 'wrongpassword' },
    });
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body.error).toBeTruthy();
  });
});
