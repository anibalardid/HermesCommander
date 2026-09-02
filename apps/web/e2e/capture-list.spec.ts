import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'e2e/shots';
mkdirSync(OUT, { recursive: true });
const MOBILE = { width: 390, height: 844 };

test('capture list view + task sheet', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/mission/3ff6016d-5046-4b2b-9a05-847043dd71aa');
  await page.waitForTimeout(1500);
  // Switch to list view.
  await page.getByRole('button', { name: /list/i }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/06-mission-list.png` });

  // Open a task detail bottom sheet.
  await page.locator('button', { hasText: /Orchestrator/i }).first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/07-task-sheet.png` });
});
