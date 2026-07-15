import { test as setup, expect } from '@playwright/test';
import { getBaseUrl, getAuthFilePath, getAdminCredentials } from '../helpers/env-config';

const authFile = getAuthFilePath();

setup('authenticate as admin', async ({ page }) => {
  const { email, password } = getAdminCredentials();
  const baseUrl = getBaseUrl();

  await page.goto(baseUrl);

  // TeamTask stores auth in localStorage (keys: tt_token, tt_user)
  // Login via API to get token, then inject into localStorage
  const response = await page.request.post(`${baseUrl}/api/auth/login`, {
    data: { email, password },
  });

  expect(response.status()).toBe(200);
  const { token, user } = await response.json();
  expect(token).toBeTruthy();

  await page.evaluate(
    ({ token, user }) => {
      localStorage.setItem('tt_token', token);
      localStorage.setItem('tt_user', JSON.stringify(user));
    },
    { token, user }
  );

  // Verify we can reach dashboard
  await page.goto(baseUrl);
  await expect(page.locator('.sidebar, [data-page="dashboard"]').first()).toBeVisible({ timeout: 10000 });

  await page.context().storageState({ path: authFile });
});
