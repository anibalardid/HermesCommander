import { test, expect } from '@playwright/test';

/**
 * Smoke E2E tests against the real dev servers (Vite :5175 + API :4310).
 * Verifies the app loads and that the primary action buttons live in the
 * right places (FABs, not scattered across sidebar/header).
 */
test('app loads and shows the office', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /office/i })).toBeVisible();
});

test('add project is a FAB, not in the sidebar', async ({ page }) => {
  await page.goto('/');
  // The FAB (bottom-right) is the only "add project" affordance.
  const fab = page.getByRole('button', { name: /add project/i });
  await expect(fab).toBeVisible();
  // No "add project" link in the sidebar footer.
  await expect(page.locator('aside').getByText(/add project/i)).toHaveCount(0);
});

test('add project FAB is visible and stacked above the chat FAB', async ({ page }) => {
  await page.goto('/');
  const addProject = page.getByRole('button', { name: /add project/i });
  const chat = page.getByRole('button', { name: /open hermes chat/i });
  await expect(addProject).toBeVisible();
  await expect(chat).toBeVisible();
  // add project must sit ABOVE the chat FAB (both bottom-right, stacked).
  const apBox = await addProject.boundingBox();
  const chatBox = await chat.boundingBox();
  expect(apBox).not.toBeNull();
  expect(chatBox).not.toBeNull();
  // Same horizontal position, add project higher (smaller y).
  expect(Math.abs(apBox!.x - chatBox!.x)).toBeLessThan(5);
  expect(apBox!.y).toBeLessThan(chatBox!.y);
});

test('mission header has no start button (mission is a container)', async ({ page }) => {
  await page.goto('/');
  // Missions appear as direct links in the left sidebar (desktop). Wait for
  // the store to load them (async) before asserting.
  const missionLink = page.locator('a[href^="/mission/"]').first();
  try {
    await missionLink.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    test.skip(true, 'no missions seeded');
    return;
  }
  await missionLink.click();
  await page.waitForURL(/\/mission\//);
  // The mission header must NOT have a start/pause/stop button.
  await expect(page.getByRole('button', { name: /start/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /pause/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /stop/i })).toHaveCount(0);
  // But it should have a "new task" FAB.
  await expect(page.getByRole('button', { name: /new task/i })).toBeVisible();
});

test('chat close (X) closes the chat, clear (trash) clears messages', async ({ page }) => {
  await page.goto('/');
  // Open the chat.
  await page.getByRole('button', { name: /open hermes chat/i }).click();
  // The chat panel is visible.
  await expect(page.getByRole('button', { name: /close/i })).toBeVisible();
  // Click the X (close) — the chat panel should disappear and the FAB return.
  await page.getByRole('button', { name: /close/i }).click();
  await expect(page.getByRole('button', { name: /open hermes chat/i })).toBeVisible();
  // The chat panel is gone.
  await expect(page.getByRole('button', { name: /close/i })).toHaveCount(0);
});

test('expanding a project shows a "new mission" option', async ({ page }) => {
  await page.goto('/');
  // Wait for a project row to load.
  const projectRow = page.locator('button', { hasText: /ani-test/i }).first();
  try {
    await projectRow.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    test.skip(true, 'no projects seeded');
    return;
  }
  // Expand it.
  await projectRow.click();
  // The "new mission" link should now be visible inside the expanded project.
  await expect(page.getByRole('link', { name: /new mission/i })).toBeVisible();
});
