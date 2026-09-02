const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Users/anibal/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  });
  const page = await browser.newPage();

  await page.goto('https://codeshare.io/5wYQyP', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(6000);

  // Grab raw text from the CodeMirror editor
  const raw = await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror');
    if (cm && cm.CodeMirror) {
      return cm.CodeMirror.getValue();
    }
    const lines = document.querySelectorAll('.CodeMirror-line');
    if (lines.length) {
      return Array.from(lines).map(l => l.textContent).join('\n');
    }
    const pre = document.querySelector('pre');
    if (pre) return pre.innerText;
    return document.body.innerText;
  });

  fs.writeFileSync('/Users/anibal/Projects/.hermes-commander-wt/error-en-linux/codeshare_raw.txt', raw);
  console.log('CHARS:', raw.length);
  console.log('LINES:', raw.split('\n').length);
  console.log('===== FULL CONTENT =====');
  console.log(raw);

  await browser.close();
})();
