import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  // Track created project IDs for cleanup
  const createdProjectIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test.afterAll(async ({ request }) => {
    // Clean up all projects created during tests
    for (const id of createdProjectIds) {
      try {
        await request.delete(`/api/projects/${id}`);
      } catch {
        // Ignore errors - project may already be deleted
      }
    }
  });

  test('displays the dashboard', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByTestId('create-project-btn')).toBeVisible();
  });

  test('shows empty state when no projects', async ({ page }) => {
    // Wait for loading to complete
    await expect(page.getByText('Loading projects...')).not.toBeVisible({ timeout: 10000 });

    // Check for empty state or project list
    const hasProjects = await page.getByTestId('project-card').count() > 0;
    if (!hasProjects) {
      await expect(page.getByText('No projects yet')).toBeVisible();
    }
  });

  test('opens create project dialog', async ({ page }) => {
    await page.getByTestId('create-project-btn').click();
    await expect(page.getByText('Create New Project')).toBeVisible();
    await expect(page.getByLabel('Name')).toBeVisible();
  });

  test('creates a new project', async ({ page }) => {
    // Open dialog
    await page.getByTestId('create-project-btn').click();
    await expect(page.getByText('Create New Project')).toBeVisible();

    // Fill form
    const projectName = `Test Project ${Date.now()}`;
    await page.getByLabel('Name').fill(projectName);
    await page.getByLabel('Description').fill('E2E test project');

    // Submit
    await page.getByRole('button', { name: 'Create Project' }).click();

    // Should navigate to workspace
    await expect(page).toHaveURL(/\/projects\/.+/);
    await expect(page.getByText(projectName)).toBeVisible();

    // Track for cleanup
    const projectId = page.url().split('/projects/')[1];
    if (projectId) createdProjectIds.push(projectId);
  });

  test('navigates to project workspace on click', async ({ page }) => {
    // First create a project if none exist
    const projectCount = await page.getByTestId('project-card').count();

    if (projectCount === 0) {
      await page.getByTestId('create-project-btn').click();
      await page.getByLabel('Name').fill('Navigation Test Project');
      await page.getByRole('button', { name: 'Create Project' }).click();
      await expect(page).toHaveURL(/\/projects\/.+/);

      // Track for cleanup
      const projectId = page.url().split('/projects/')[1];
      if (projectId) createdProjectIds.push(projectId);

      // Go back to dashboard
      await page.getByTestId('back-btn').click();
      await expect(page).toHaveURL('/');
    }

    // Click on a project card
    await page.getByTestId('project-card').first().click();
    await expect(page).toHaveURL(/\/projects\/.+/);
  });
});
