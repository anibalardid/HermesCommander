import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'docs', 'images');
mkdirSync(OUT, { recursive: true });

const W = 1512;
const H = 982;

// Real IDs from the seeded DB
const PROJ1 = '173e410d-ed65-4976-8555-adf0e73b2428'; // HermesCommander
const MISSION = '4e528002-5738-46b0-b90a-c58c7348a083'; // Screenshot test mission

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });

  // Force dark theme + English before the app boots
  await page.addInitScript(() => {
    localStorage.setItem('hermes-commander.theme', 'dark');
    localStorage.setItem('hermes-commander.lang', 'en');
  });

  // 1. New project modal (dedicated route /new)
  await page.goto('http://127.0.0.1:5175/new', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(OUT, 'modal-new-project.png'), fullPage: false });
  console.log('modal-new-project.png capturada');

  // 2. New mission modal (dedicated route /project/:id/new-mission)
  await page.goto(`http://127.0.0.1:5175/project/${PROJ1}/new-mission`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(OUT, 'modal-new-mission.png'), fullPage: false });
  console.log('modal-new-mission.png capturada');

  // 3. New task modal (opens via "New task" button in the TODO column of a mission)
  await page.goto(`http://127.0.0.1:5175/mission/${MISSION}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  // Click the "New task" button in the TODO column
  await page.getByRole('button', { name: /New task/i }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, 'modal-new-task.png'), fullPage: false });
  console.log('modal-new-task.png capturada');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
