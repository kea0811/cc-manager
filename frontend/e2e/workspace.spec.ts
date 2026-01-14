import { test, expect } from '@playwright/test';

// Run all workspace tests serially to avoid conflicts
test.describe.serial('Workspace', () => {
  let projectId: string;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    await page.getByTestId('create-project-btn').click();
    await page.getByLabel('Name').fill('Workspace Test Project');
    await page.getByRole('button', { name: 'Create Project' }).click();
    await page.waitForURL(/\/projects\/.+/);
    projectId = page.url().split('/projects/')[1];
    await page.close();
  });

  test.afterAll(async ({ request }) => {
    // Safety net: clean up project if delete test didn't run or failed
    if (projectId) {
      try {
        await request.delete(`/api/projects/${projectId}`);
      } catch {
        // Ignore - project may already be deleted by the delete test
      }
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 10000 });
  });

  test('displays workspace with chat and editor panels', async ({ page }) => {
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await expect(page.getByTestId('editor-panel')).toBeVisible();
  });

  test('displays project name in header', async ({ page }) => {
    await expect(page.getByText('Workspace Test Project')).toBeVisible();
  });

  test('can type in chat input', async ({ page }) => {
    const chatInput = page.getByTestId('chat-input');
    await chatInput.fill('Hello, this is a test message');
    await expect(chatInput).toHaveValue('Hello, this is a test message');
  });

  test('can edit content in editor', async ({ page }) => {
    const editor = page.getByTestId('editor-textarea');
    await editor.clear();
    await editor.fill('# Test Content\n\nThis is test content.');
    await expect(editor).toHaveValue('# Test Content\n\nThis is test content.');
  });

  test('save button enables when content changes', async ({ page }) => {
    const editor = page.getByTestId('editor-textarea');
    const saveButton = page.getByTestId('save-editor');
    await expect(saveButton).toBeDisabled();
    await editor.fill('# Changed Content');
    await expect(saveButton).not.toBeDisabled();
  });

  test('saves editor content', async ({ page }) => {
    const editor = page.getByTestId('editor-textarea');
    const saveButton = page.getByTestId('save-editor');
    await editor.fill(`# Saved Content ${Date.now()}`);
    await saveButton.click();
    await expect(saveButton).toBeDisabled({ timeout: 5000 });
  });

  test('toggles between edit and preview mode', async ({ page }) => {
    await expect(page.getByTestId('editor-textarea')).toBeVisible();
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByTestId('editor-preview')).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByTestId('editor-textarea')).toBeVisible();
  });

  test('navigates back to dashboard', async ({ page }) => {
    await page.getByTestId('back-btn').click();
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });

  // Chat tests use real Claude - longer timeout
  test('sends a chat message and receives response', async ({ page }) => {
    const chatInput = page.getByTestId('chat-input');
    const testMessage = `E2E test ${Date.now()}`;

    await chatInput.fill(testMessage);
    await page.getByTestId('send-message').click();

    // Claude takes ~5-10 seconds to respond
    await expect(page.getByTestId('chat-message-user')).toContainText(testMessage, { timeout: 30000 });
    await expect(page.getByTestId('chat-message-assistant')).toBeVisible({ timeout: 30000 });
    await expect(chatInput).toBeEnabled();
  });

  test('clears chat history', async ({ page }) => {
    // Should have messages from previous test
    await expect(page.getByTestId('chat-message-user')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('clear-chat').click();
    await expect(page.getByTestId('chat-message-user')).not.toBeVisible();
  });

  test('opens settings dialog', async ({ page }) => {
    await page.getByTestId('settings-btn').click();
    await expect(page.getByRole('heading', { name: 'Project Settings' })).toBeVisible();
    await expect(page.getByTestId('settings-name')).toHaveValue('Workspace Test Project');
  });

  test('updates project name via settings', async ({ page }) => {
    await page.getByTestId('settings-btn').click();
    await expect(page.getByRole('heading', { name: 'Project Settings' })).toBeVisible();

    // Change the name
    const nameInput = page.getByTestId('settings-name');
    await nameInput.clear();
    await nameInput.fill('Updated Project Name');

    // Save
    await page.getByTestId('save-settings-btn').click();

    // Dialog should close (check save button is gone) and name should update in header
    await expect(page.getByTestId('save-settings-btn')).not.toBeVisible();
    await expect(page.getByText('Updated Project Name')).toBeVisible();
  });

  test('can add GitHub repo URL', async ({ page }) => {
    await page.getByTestId('settings-btn').click();

    const githubInput = page.getByTestId('settings-github');
    await githubInput.fill('https://github.com/test/repo');

    // Should show development mode hint
    await expect(page.getByText('Linking a repo will enable Development Mode')).toBeVisible();

    await page.getByTestId('save-settings-btn').click();
    await expect(page.getByTestId('save-settings-btn')).not.toBeVisible();
  });

  test('deletes project via settings', async ({ page }) => {
    await page.getByTestId('settings-btn').click();

    // Click delete
    await page.getByTestId('delete-project-btn').click();

    // Should show confirmation
    await expect(page.getByText('Are you sure?')).toBeVisible();

    // Confirm delete
    await page.getByTestId('confirm-delete-btn').click();

    // Should navigate to dashboard
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });
});
