import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';
import { getBaseUrl } from '../helpers/env-config';

export class LoginPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ==========================================
  // LIFECYCLE
  // ==========================================

  /**
   * Navigates to the login page and ensures the user is logged out.
   *
   * Steps:
   * 1. Clears localStorage to remove any existing session (tt_token, tt_user).
   * 2. Navigates to the base URL.
   * 3. Asserts the login form is visible.
   */
  async setUp(): Promise<void> {
    await this.page.goto(getBaseUrl());
    await this.page.evaluate(() => {
      localStorage.removeItem('tt_token');
      localStorage.removeItem('tt_user');
    });
    await this.page.reload();
    await expect(this.loginForm).toBeVisible();
  }

  /**
   * No-op teardown — login page leaves no persistent data.
   */
  async tearDown(): Promise<void> {}

  // ==========================================
  // LOCATORS
  // ==========================================

  /** The login card container. */
  get loginForm(): Locator {
    return this.page.locator('#login-form');
  }

  /** Email input field. */
  get emailInput(): Locator {
    return this.page.locator('#login-email');
  }

  /** Password input field. */
  get passwordInput(): Locator {
    return this.page.locator('#login-password');
  }

  /** Submit (Войти) button. */
  get submitButton(): Locator {
    return this.page.locator('#login-btn');
  }

  /** Error message element shown on failed login. */
  get errorMessage(): Locator {
    return this.page.locator('#login-error');
  }

  /** Login screen wrapper (visible when unauthenticated). */
  get loginScreen(): Locator {
    return this.page.locator('#login-screen');
  }

  /** Main app wrapper (visible after successful login). */
  get appContainer(): Locator {
    return this.page.locator('.sidebar').first();
  }

  // ==========================================
  // NAVIGATION
  // ==========================================

  /**
   * Navigates directly to the login page.
   *
   * Steps:
   * 1. Calls page.goto('/') to load the SPA.
   * 2. Asserts the login form is visible.
   */
  async goto(_id?: number): Promise<void> {
    await this.page.goto('/');
    await expect(this.loginForm).toBeVisible({ timeout: 10000 });
  }

  // ==========================================
  // ACTIONS
  // ==========================================

  /**
   * Fills email and password fields without submitting.
   *
   * Steps:
   * 1. Fills the email input with the provided value.
   * 2. Fills the password input with the provided value.
   *
   * @param email    - User email address
   * @param password - User password
   */
  async fillCredentials(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  /**
   * Submits the login form by clicking the submit button.
   *
   * Steps:
   * 1. Clicks the #login-btn button.
   */
  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  // ==========================================
  // VERIFICATION
  // ==========================================

  /**
   * Logs in with the given credentials and asserts successful entry.
   *
   * Steps:
   * 1. Fills email and password.
   * 2. Clicks submit.
   * 3. Waits for the sidebar to be visible (indicates dashboard loaded).
   * 4. Asserts tt_token exists in localStorage.
   *
   * @param email    - Valid user email
   * @param password - Valid user password
   */
  async loginAs(email: string, password: string): Promise<void> {
    await this.fillCredentials(email, password);
    await this.submit();
    await expect(this.appContainer).toBeVisible({ timeout: 10000 });
    const token = await this.page.evaluate(() => localStorage.getItem('tt_token'));
    expect(token).toBeTruthy();
  }

  /**
   * Attempts login with invalid credentials and asserts the error message appears.
   *
   * Steps:
   * 1. Fills email and password.
   * 2. Clicks submit.
   * 3. Asserts the #login-error element is visible and non-empty.
   *
   * @param email    - Invalid or wrong email
   * @param password - Invalid or wrong password
   */
  async loginExpectFailure(email: string, password: string): Promise<void> {
    await this.fillCredentials(email, password);
    await this.submit();
    await expect(this.errorMessage).toBeVisible({ timeout: 5000 });
    const text = await this.errorMessage.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  }

  /**
   * Verifies the login screen is displayed (user is not authenticated).
   *
   * Steps:
   * 1. Asserts #login-screen is visible.
   * 2. Asserts sidebar is not visible.
   */
  async verifyNotAuthenticated(): Promise<void> {
    await expect(this.loginScreen).toBeVisible();
    await expect(this.appContainer).not.toBeVisible();
  }
}
