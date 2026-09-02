import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'docs', 'images');
mkdirSync(OUT, { recursive: true });

const W = 1512;
const H = 982;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });

  // Home
  await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, 'home.png'), fullPage: false });
  console.log('home.png capturada');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
