/** Isolated synthetic render only. No user profile, external network or real archive. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'coverage/snapshot-analysis-visual');
const moduleRoot = process.argv[2];
const executablePath = process.argv[3];
if (!moduleRoot || !executablePath)
  throw new Error('Pass a local Playwright module directory and browser executable.');
const { chromium } = createRequire(path.join(moduleRoot, '_local_loader.cjs'))('playwright');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2));
const raw = Buffer.from('{"conversation_id":"synthetic-only","mapping":{}}');
const manifest = {
  schema: 'liska-capture/1',
  captureId: 'capture-chatgpt-synthetic-only',
  provider: 'chatgpt',
  conversationId: 'synthetic-only',
  capturedAt: '2026-01-01T00:00:00.000Z',
  method: 'same-origin-api',
  artifacts: [
    {
      id: 'conversation',
      relativePath: 'responses/conversation.json',
      mediaType: 'application/json',
      byteLength: raw.length,
      sha256: digest(raw),
      endpoint: { method: 'GET', pathPattern: '/backend-api/conversation/{conversationId}' },
    },
  ],
  assets: [],
  completeness: {
    graph: 'unknown',
    messages: 'unknown',
    branches: 'unknown',
    assets: 'not-attempted',
  },
  warnings: [],
  observedUnknownContentTypes: [],
};
for (const name of ['synthetic-one', 'synthetic-two']) {
  const folder = path.join(out, name);
  await fs.mkdir(path.join(folder, 'responses'), { recursive: true });
  await fs.writeFile(path.join(folder, 'manifest.json'), json(manifest));
  await fs.writeFile(path.join(folder, 'responses/conversation.json'), raw);
}
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let blocked = 0;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://liska.invalid') {
      blocked++;
      await route.abort();
      return;
    }
    const file = path.resolve(dist, '.' + url.pathname);
    if (!file.startsWith(dist + path.sep)) {
      blocked++;
      await route.abort();
      return;
    }
    try {
      const body = await fs.readFile(file);
      const contentType = file.endsWith('.html')
        ? 'text/html'
        : file.endsWith('.css')
          ? 'text/css'
          : 'application/javascript';
      await route.fulfill({ status: 200, contentType, body });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  await page.addInitScript(() => {
    globalThis.chrome = {
      i18n: { getMessage: () => '' },
      downloads: {
        download: () => {
          throw Error('Synthetic render never saves');
        },
        onChanged: { addListener() {}, removeListener() {} },
        search: async () => [],
      },
      runtime: { lastError: null },
    };
  });
  await page.goto('https://liska.invalid/src/snapshot-analysis/snapshot-analysis.html');
  await page.screenshot({ path: path.join(out, 'desktop-empty.png'), fullPage: true });
  await page.locator('#snapshot-picker').setInputFiles(path.join(out, 'synthetic-one'));
  await page.locator('#snapshot-picker').setInputFiles(path.join(out, 'synthetic-two'));
  await page.locator('#analyze-snapshots').click();
  await page.locator('#analysis-status[data-state="ready"]').waitFor();
  await page.screenshot({ path: path.join(out, 'desktop-ready.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, 'mobile-ready.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  const text = await page.locator('body').innerText();
  if (
    overflow ||
    errors.length ||
    text.includes('synthetic-only') ||
    text.includes('synthetic-one')
  )
    throw Error('Synthetic visual invariant failed');
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 420, height: 720 });
  await popup.route('**/src/popup/index.html', async route => {
    const html = await fs.readFile(path.join(dist, 'src/popup/index.html'), 'utf8');
    // Static navigation/style inspection only; never execute settings/storage code.
    await route.fulfill({
      contentType: 'text/html',
      body: html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, ''),
    });
  });
  await popup.goto('https://liska.invalid/src/popup/index.html');
  await popup.screenshot({ path: path.join(out, 'popup-link-static.png'), fullPage: true });
  console.log(
    JSON.stringify(
      {
        outputDirectory: out,
        ready: true,
        mobileHorizontalOverflow: overflow,
        pageErrors: errors.length,
        externalRequestsBlocked: blocked,
        source:
          'synthetic raw-only folders; fake origin fulfilled entirely from built local assets; no Save invoked',
      },
      null,
      2
    )
  );
  await context.close();
} finally {
  await browser.close();
}
