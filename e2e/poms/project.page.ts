import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class ProjectPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ==========================================
  // LIFECYCLE
  // ==========================================

  /**
   * Navigates to a specific project page and waits for it to fully render.
   *
   * Steps:
   * 1. Calls goto(projectId).
   * 2. Waits for the project progress bar to be visible.
   *
   * @param projectId - Numeric project ID
   */
  async setUp(projectId?: number): Promise<void> {
    if (projectId) await this.goto(projectId);
  }

  /**
   * No-op — projects and tasks are cleaned up via API in spec teardown.
   */
  async tearDown(): Promise<void> {}

  // ==========================================
  // LOCATORS
  // ==========================================

  /** Project progress bar fill element. */
  get progressBar(): Locator {
    return this.page.locator('.progress-bar');
  }

  /** "Задачи" tab button. */
  get tasksTab(): Locator {
    return this.page.locator('.proj-tab').filter({ hasText: 'Задачи' });
  }

  /** "Контент-план" tab button. */
  get contentTab(): Locator {
    return this.page.locator('.proj-tab').filter({ hasText: 'Контент-план' });
  }

  /** Tab panel content area. */
  get tabPanel(): Locator {
    return this.page.locator('#proj-tab-panel');
  }

  /** Project tasks list container. */
  get projectTasksList(): Locator {
    return this.page.locator('#project-tasks-list');
  }

  /** "Add task" button (admin only). */
  get addTaskButton(): Locator {
    return this.page.locator('button').filter({ hasText: /Добавить задачу/ });
  }

  /** "Edit project" button (admin only). */
  get editProjectButton(): Locator {
    return this.page.locator('button').filter({ hasText: /Изменить/ });
  }

  /** "Archive" button (admin only). */
  get archiveButton(): Locator {
    return this.page.locator('button').filter({ hasText: /Архивировать/ });
  }

  /** Project members avatars row. */
  get membersRow(): Locator {
    return this.page.locator('.proj-members-row');
  }

  /** "Add member" (+) button in the members row (admin only). */
  get addMemberButton(): Locator {
    return this.page.locator('.proj-member-add-btn');
  }

  /** New task modal opened via the project page. */
  get newTaskModal(): Locator {
    return this.page.locator('#modal-root .modal-overlay').first();
  }

  // ==========================================
  // NAVIGATION
  // ==========================================

  /**
   * Navigates directly to a project page by ID.
   *
   * Steps:
   * 1. Calls page.goto('/project/{projectId}').
   * 2. Waits for the progress bar to be visible.
   * 3. Asserts URL contains the project ID.
   *
   * @param projectId - Numeric project ID to navigate to
   */
  async goto(projectId?: number): Promise<void> {
    if (!projectId) { await this.page.goto('/'); return; }
    await this.page.goto(`/project/${projectId}`);
    await expect(this.progressBar).toBeVisible({ timeout: 10000 });
    await expect(this.page).toHaveURL(new RegExp(String(projectId)));
  }

  // ==========================================
  // TABS
  // ==========================================

  /**
   * Switches to the Tasks tab and waits for #project-tasks-list to render.
   *
   * Steps:
   * 1. Clicks the "Задачи" tab button.
   * 2. Waits for #project-tasks-list to be visible.
   */
  async switchToTasksTab(): Promise<void> {
    await this.tasksTab.click();
    await expect(this.projectTasksList).toBeVisible({ timeout: 8000 });
  }

  /**
   * Switches to the Content Plan tab.
   *
   * Steps:
   * 1. Clicks the "Контент-план" tab button.
   * 2. Waits for tab panel to update (networkidle).
   */
  async switchToContentTab(): Promise<void> {
    await this.contentTab.click();
    await this.page.waitForLoadState('networkidle');
  }

  // ==========================================
  // CREATE
  // ==========================================

  /**
   * Opens the "Add task" modal for this project.
   *
   * Steps:
   * 1. Ensures the Tasks tab is active.
   * 2. Clicks the "Добавить задачу" button.
   * 3. Waits for the modal to appear.
   */
  async openAddTaskModal(): Promise<void> {
    await this.addTaskButton.click();
    await expect(this.newTaskModal).toBeVisible({ timeout: 5000 });
  }

  /**
   * Creates a task within this project via the project tasks tab.
   *
   * Steps:
   * 1. Clicks "Добавить задачу".
   * 2. Fills the title field.
   * 3. Clicks the submit button.
   * 4. Waits for the modal to close.
   *
   * @param title - Task title to enter
   */
  async createTask(title: string): Promise<void> {
    await this.openAddTaskModal();
    const modal = this.newTaskModal;
    await modal.locator('input[placeholder*="назван"], input[placeholder*="задач"]').first().fill(title);
    await modal.locator('.btn-blue, .btn-primary').last().click();
    await expect(this.newTaskModal).not.toBeVisible({ timeout: 10000 });
  }

  // ==========================================
  // MEMBERS
  // ==========================================

  /**
   * Returns the count of project members shown in the members avatars row.
   *
   * Steps:
   * 1. Counts all .proj-member-wrap elements.
   *
   * @returns Number of current project members
   */
  async getMemberCount(): Promise<number> {
    return this.page.locator('.proj-member-wrap').count();
  }

  // ==========================================
  // VERIFICATION
  // ==========================================

  /**
   * Verifies a task with the given title exists in the project task list.
   *
   * Steps:
   * 1. Asserts that #project-tasks-list contains text matching the title.
   *
   * @param title - Task title to find
   */
  async verifyTaskExists(title: string): Promise<void> {
    await expect(
      this.projectTasksList.getByText(title, { exact: false })
    ).toBeVisible({ timeout: 8000 });
  }

  /**
   * Verifies the project progress percentage displayed on the page.
   *
   * Steps:
   * 1. Reads the progress text from the progress section.
   * 2. Asserts it contains the expected percentage.
   *
   * @param percent - Expected progress value (e.g. 50 for "50%")
   */
  async verifyProgress(percent: number): Promise<void> {
    await expect(
      this.page.getByText(`${percent}%`, { exact: false })
    ).toBeVisible({ timeout: 5000 });
  }
}
