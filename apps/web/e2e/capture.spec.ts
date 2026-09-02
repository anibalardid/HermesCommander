import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'e2e/shots';
mkdirSync(OUT, { recursive: true });
const MOBILE = { width: 390, height: 844 };

test('capture all mobile screens', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-office.png` });

  await page.goto('/project/3047d9e4-4b65-4fa2-bed9-24bfcd145ac3');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/02-project.png` });

  await page.goto('/mission/3ff6016d-5046-4b2b-9a05-847043dd71aa');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/03-mission.png` });

  await page.goto('/settings');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/04-settings.png` });

  await page.goto('/new');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/05-new-project.png` });
});
