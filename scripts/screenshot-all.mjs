import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'docs', 'images');
mkdirSync(OUT, { recursive: true });

const W = 1512;
const H = 982;

// Real IDs from the seeded DB
const PROJ1 = '01da36fc-5889-498b-a212-2d8362953050'; // ani-test-1
const PROJ2 = '43322975-d58f-41a3-8415-a318b0f10ad4'; // ani-test-2
const MISSION_LANDING = '0b44df3d-ecad-46ee-959e-178a11c251fa';
const MISSION_HERO = 'a245b90d-4d72-4f75-b04a-5b3873b98ed7';
const MISSION_CALC = '2735d3f9-8ee7-46c1-ae3a-b5961d20b400';
const MISSION_REVIEW1 = 'dc094b77-bdbc-4a6c-ab68-06a3636dff24';

const screens = [
  { name: 'home', url: '/' },
  { name: 'project-ani-test-1', url: `/project/${PROJ1}` },
  { name: 'project-ani-test-2', url: `/project/${PROJ2}` },
  { name: 'mission-landing', url: `/mission/${MISSION_LANDING}` },
  { name: 'mission-hero', url: `/mission/${MISSION_HERO}` },
  { name: 'mission-calculator', url: `/mission/${MISSION_CALC}` },
  { name: 'mission-review-pr1', url: `/mission/${MISSION_REVIEW1}` },
  { name: 'tasks', url: '/tasks' },
  { name: 'resume', url: '/resume' },
  { name: 'settings', url: '/settings' },
  { name: 'help', url: '/help' },
];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });

  // Force dark theme + English before the app boots
  await page.addInitScript(() => {
    localStorage.setItem('hermes-commander.theme', 'dark');
    localStorage.setItem('hermes-commander.lang', 'en');
  });

  for (const s of screens) {
    await page.goto(`http://127.0.0.1:5175${s.url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: join(OUT, `${s.name}.png`), fullPage: false });
    console.log(`${s.name}.png capturada`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
