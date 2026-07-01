import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class TasksPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ==========================================
  // LIFECYCLE
  // ==========================================

  /**
   * Navigates to the tasks page and waits for the task list to render.
   *
   * Steps:
   * 1. Navigates to '/tasks'.
   * 2. Waits for the search input to be visible.
   * 3. Waits for the task list container to appear.
   */
  async setUp(): Promise<void> {
    await this.goto();
  }

  /**
   * No-op — tasks created during tests should be cleaned up via API in spec teardown.
   */
  async tearDown(): Promise<void> {}

  // ==========================================
  // LOCATORS
  // ==========================================

  /** Search input for filtering tasks by text. */
  get searchInput(): Locator {
    return this.page.locator('#task-search');
  }

  /** Task list container element. */
  get taskListContainer(): Locator {
    return this.page.locator('#tasks-list-container');
  }

  /** All rendered task cards. */
  get taskCards(): Locator {
    return this.page.locator('.task-card, .tasks-list .task-item').first().locator('..');
  }

  /** Filter button for "Все" (all tasks). */
  get filterAll(): Locator {
    return this.page.locator('.filter-btn').filter({ hasText: 'Все' }).first();
  }

  /** Filter button for "Новые" (new tasks). */
  get filterNew(): Locator {
    return this.page.locator('.filter-btn').filter({ hasText: 'Новые' });
  }

  /** Filter button for "В работе" (in-progress tasks). */
  get filterInProgress(): Locator {
    return this.page.locator('.filter-btn').filter({ hasText: 'В работе' });
  }

  /** Filter button for "Готово" (done tasks). */
  get filterDone(): Locator {
    return this.page.locator('.filter-btn').filter({ hasText: 'Готово' });
  }

  /** Filter button for "Просрочено" (overdue tasks). */
  get filterOverdue(): Locator {
    return this.page.locator('.filter-btn').filter({ hasText: 'Просрочено' });
  }

  /** Filter button for "Срочные" (high priority tasks). */
  get filterUrgent(): Locator {
    return this.page.locator('.filter-btn').filter({ hasText: 'Срочные' });
  }

  /** Employee filter dropdown (admin only). */
  get employeeFilterSelect(): Locator {
    return this.page.locator('#employee-filter-select');
  }

  /** New task modal — opened via #new-task-btn in the header. */
  get newTaskModal(): Locator {
    return this.page.locator('#modal-root .modal-overlay, #modal-root .modal').first();
  }

  // ==========================================
  // NAVIGATION
  // ==========================================

  /**
   * Navigates to the tasks page.
   *
   * Steps:
   * 1. Calls page.goto('/tasks').
   * 2. Waits for #task-search input to be visible.
   */
  // SPA uses sessionStorage (not URL path) to determine initial page.
  // sidebar-name is populated BEFORE initApp's final navigateTo call, so waiting
  // for it is not sufficient. Instead: click the sidebar nav button once the
  // sidebar is interactive — this fires AFTER initApp's render has settled.
  async goto(_id?: number): Promise<void> {
    await this.page.goto('/');
    // Wait for sidebar nav to be interactive (login-screen hidden, app rendered)
    const tasksNavBtn = this.page.locator('button.nav-item[data-page="tasks"]');
    await tasksNavBtn.waitFor({ state: 'visible', timeout: 10000 });
    // Wait for initApp final render (page-content has children)
    await this.page.waitForFunction(() => {
      const c = document.getElementById('page-content');
      return c !== null && c.innerHTML.trim().length > 0;
    }, { timeout: 10000 });
    await tasksNavBtn.click();
    await expect(this.searchInput).toBeVisible({ timeout: 10000 });
  }

  // ==========================================
  // FILTER & SEARCH
  // ==========================================

  /**
   * Types text into the task search input and waits for the list to update.
   *
   * Steps:
   * 1. Clears the search input.
   * 2. Types the query string character by character.
   * 3. Waits for networkidle to let the filtered list render.
   *
   * @param query - Search string to type
   */
  async search(query: string): Promise<void> {
    await this.searchInput.clear();
    await this.searchInput.fill(query);
    await this.page.waitForLoadState('load');
  }

  /**
   * Clicks a status filter button.
   *
   * Steps:
   * 1. Clicks the specified filter button.
   * 2. Waits for task list container to be visible.
   *
   * @param status - 'all' | 'new' | 'in_progress' | 'done' | 'overdue' | 'urgent'
   */
  async applyFilter(status: 'all' | 'new' | 'in_progress' | 'done' | 'overdue' | 'urgent'): Promise<void> {
    const map: Record<string, Locator> = {
      all: this.filterAll,
      new: this.filterNew,
      in_progress: this.filterInProgress,
      done: this.filterDone,
      overdue: this.filterOverdue,
      urgent: this.filterUrgent,
    };
    await map[status].click();
    await expect(this.taskListContainer).toBeVisible({ timeout: 5000 });
  }

  // ==========================================
  // CREATE
  // ==========================================

  /**
   * Opens the new task modal via the header #new-task-btn.
   *
   * Steps:
   * 1. Clicks #new-task-btn.
   * 2. Waits for the modal overlay to appear.
   */
  async openNewTaskModal(): Promise<void> {
    await this.page.locator('#new-task-btn').click();
    await expect(this.newTaskModal).toBeVisible({ timeout: 5000 });
  }

  /**
   * Creates a new task using the modal form.
   *
   * Steps:
   * 1. Opens the new task modal.
   * 2. Fills the task title field.
   * 3. Optionally selects priority.
   * 4. Clicks the save/submit button.
   * 5. Waits for the modal to close.
   *
   * @param title    - Task title
   * @param priority - Optional priority: 'low' | 'medium' | 'high'
   */
  async createTask(title: string, priority?: 'low' | 'medium' | 'high'): Promise<void> {
    await this.openNewTaskModal();
    const modal = this.newTaskModal;
    await modal.locator('input[placeholder*="назван"], input[placeholder*="задач"], input[id*="title"], input[id*="task-title"]').first().fill(title);
    if (priority) {
      await modal.locator('#f-priority').selectOption(priority);
    }
    await modal.locator('.btn-blue, .btn-primary, button[type="submit"]').last().click();
    await expect(this.newTaskModal).not.toBeVisible({ timeout: 10000 });
  }

  // ==========================================
  // VERIFICATION
  // ==========================================

  /**
   * Verifies a task with the given title is visible in the task list.
   *
   * Steps:
   * 1. Locates any element inside #tasks-list-container that contains the title text.
   * 2. Asserts it is visible.
   *
   * @param title - Task title to look for
   */
  async verifyTaskExists(title: string): Promise<void> {
    await expect(
      this.taskListContainer.getByText(title, { exact: false })
    ).toBeVisible({ timeout: 8000 });
  }

  /**
   * Verifies no task with the given title is visible.
   *
   * Steps:
   * 1. Asserts no element inside #tasks-list-container contains the title text.
   *
   * @param title - Task title that should NOT be visible
   */
  async verifyTaskNotExists(title: string): Promise<void> {
    await expect(
      this.taskListContainer.getByText(title, { exact: false })
    ).not.toBeVisible({ timeout: 5000 });
  }
}
