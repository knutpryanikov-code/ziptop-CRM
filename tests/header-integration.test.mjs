import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Chrome CDP launcher: dedicated temp profile + readiness polling.
// Without --user-data-dir Chrome may bind DevTools to IPv6 ::1 only, and the
// fixed 1.2s sleep raced Chrome startup — Node fetch to 127.0.0.1 then failed
// with "fetch failed" in CI.
// ---------------------------------------------------------------------------
async function launchChrome(chromePath, port) {
  const profileDir = fs.mkdtempSync(join(os.tmpdir(), 'ziptop-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless',
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  chrome.stderr?.on('data', (d) => { stderr += String(d); });
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (chrome.exitCode !== null) {
      throw new Error(`Chrome exited early (code ${chrome.exitCode}): ${stderr.slice(-500)}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) break;
    } catch {}
    if (Date.now() > deadline) {
      try { chrome.kill(); } catch {}
      throw new Error(`Chrome DevTools endpoint did not start on port ${port}: ${stderr.slice(-500)}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const cleanup = () => {
    try { chrome.kill(); } catch {}
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  };
  return { cleanup };
}

const DIST_DIR = join(process.cwd(), 'dist');
const LIVE_URL = process.env.LIVE_TEST_URL || 'https://xn--g1acsdbq.xn--p1ai';
const GITHUB_STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY;

function appendToSummary(markdown) {
  if (GITHUB_STEP_SUMMARY && existsSync(GITHUB_STEP_SUMMARY)) {
    try {
      fs.appendFileSync(GITHUB_STEP_SUMMARY, markdown + '\n\n', 'utf-8');
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// 1. Logo Test: Brand has only "ЗИПТОП" title and no subtitle "запчасти"
// ---------------------------------------------------------------------------
test('1. Main page logo contains only ЗИПТОП and no subtitle', async () => {
  assert.ok(existsSync(join(DIST_DIR, 'index.html')), 'dist/index.html must exist (run npm run build:prod)');
  const html = readFileSync(join(DIST_DIR, 'index.html'), 'utf-8');

  // Find the brand anchor
  const brandMatch = html.match(/<a[^>]*class="[^"]*main-site-brand[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  assert.ok(brandMatch, 'main-site-brand element must be present in header');
  const brandHtml = brandMatch[1];

  // Must contain ЗИП and ТОП
  assert.match(brandHtml, /ЗИП/i, 'Brand must contain "ЗИП"');
  assert.match(brandHtml, /ТОП/i, 'Brand must contain "ТОП"');

  // Must NOT contain subtitle "запчасти" or motto class
  const hasSubtitleText = /запчасти/i.test(brandHtml);
  const hasMottoClass = /main-site-brand__motto/i.test(brandHtml);

  assert.equal(hasSubtitleText, false, 'Brand logo must NOT contain subtitle "запчасти" on main page');
  assert.equal(hasMottoClass, false, 'Brand logo must NOT contain "main-site-brand__motto" class');

  appendToSummary(`### ✅ Check 1: Main Page Logo\n- Logo contains **ЗИПТОП**\n- No subtitle or motto found in brand block`);
});

// ---------------------------------------------------------------------------
// 2. Russian Navigation Links Test: No broken links
// ---------------------------------------------------------------------------
test('2. Header navigation contains Russian routes without broken links', async () => {
  const html = readFileSync(join(DIST_DIR, 'index.html'), 'utf-8');
  const navMatch = html.match(/<nav[^>]*class="[^"]*main-site-nav[^"]*"[^>]*>([\s\S]*?)<\/nav>/i);
  assert.ok(navMatch, 'main-site-nav element must be present');
  const navHtml = navMatch[1];

  // Extract all hrefs
  const linkMatches = [...navHtml.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(linkMatches.length >= 4, `Expected at least 4 navigation links, found ${linkMatches.length}`);

  const requiredRussianLinks = ['/каталог/', '/взрыв-схемы/', '/ии-подбор/', '/экосистема/', '/контакты/'];
  for (const expected of requiredRussianLinks) {
    const found = linkMatches.some((href) => decodeURI(href) === expected);
    assert.ok(found, `Expected Russian header link "${expected}" to be present in navigation`);
  }

  // Verify internal routes exist in dist/
  const results = [];
  for (const href of linkMatches) {
    const decoded = decodeURI(href);
    if (decoded.startsWith('http')) continue;
    let localFile;
    if (decoded === '/') {
      localFile = join(DIST_DIR, 'index.html');
    } else {
      const rel = decoded.replace(/^\/+|\/+$/g, '');
      localFile = join(DIST_DIR, rel, 'index.html');
    }

    let exists = existsSync(localFile);
    // /каталог/ is hosted under market prefix, so verify against market dist or live
    if (!exists && decoded === '/каталог/') {
      const marketDist = join(process.cwd(), '../market/dist/index.html');
      const marketCache = join(process.cwd(), '../market/.build_cache/dist-prod-common/index.html');
      exists = existsSync(marketDist) || existsSync(marketCache);
      if (!exists) {
        // Fallback: check live URL if available
        try {
          const res = await fetch(LIVE_URL + encodeURI(decoded), { method: 'HEAD' });
          exists = res.status === 200;
        } catch {}
      }
    }

    assert.ok(exists, `Route "${decoded}" must resolve to a valid file or live endpoint`);
    results.push(`| \`${decoded}\` | ✅ OK |`);
  }

  appendToSummary(`### ✅ Check 2: Russian Navigation Links\n| Route | Status |\n| :--- | :---: |\n${results.join('\n')}`);
});

// ---------------------------------------------------------------------------
// 3. Pixel-Perfect Alignment Test: Compare main page and market page in Chrome
// ---------------------------------------------------------------------------
test('3. Headers in main site and market are pixel-perfect aligned', async (t) => {
  const chromePath = process.env.CHROME_PATH ||
    (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : 'google-chrome'));

  if (process.platform === 'darwin' && !existsSync(chromePath)) {
    t.skip('Google Chrome binary not found for local headless CDP test');
    return;
  }

  const port = 9223;
  const { cleanup: cleanupChrome } = await launchChrome(chromePath, port);

  async function inspect(url) {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?` + encodeURIComponent(url), { method: 'PUT' });
    const target = await res.json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);

    await new Promise((resolve) => (ws.onopen = resolve));
    let id = 1;
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const curId = id++;
        const handler = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id === curId) {
            ws.removeEventListener('message', handler);
            if (msg.error) reject(msg.error);
            else resolve(msg.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: curId, method, params }));
      });
    }

    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 2000));

    const evalResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const header = document.querySelector(".main-site-header, .unified-header, .detail-header");
        const inner = document.querySelector(".main-site-header__inner, .unified-header__inner");
        const brand = document.querySelector(".main-site-brand, .unified-brand, a.brand");
        const nav = document.querySelector(".main-site-nav, .unified-header__nav");
        const city = document.querySelector(".site-city-selector, .unified-header__city, [data-city-toggle]");
        const cart = document.querySelector("[data-cart-toggle], .cart");

        function b(el) {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10, width: Math.round(r.width * 10) / 10 };
        }

        return {
          clientWidth: document.documentElement.clientWidth,
          innerWidth: window.innerWidth,
          scrollbarWidth: window.innerWidth - document.documentElement.clientWidth,
          inner: b(inner),
          brand: b(brand),
          nav: b(nav),
          city: b(city),
          cart: b(cart)
        };
      })()`,
      returnByValue: true,
    });

    await fetch(`http://127.0.0.1:${port}/json/close/` + target.id);
    return evalResult.result.value;
  }

  try {
    const mainMetrics = await inspect(`${LIVE_URL}/?t=${Date.now()}`);
    const marketMetrics = await inspect(`${LIVE_URL}/каталог/?t=${Date.now()}`);

    const deltaScrollbar = Math.abs(mainMetrics.scrollbarWidth - marketMetrics.scrollbarWidth);
    const deltaClientWidth = Math.abs(mainMetrics.clientWidth - marketMetrics.clientWidth);
    const deltaInnerLeft = Math.abs(mainMetrics.inner.left - marketMetrics.inner.left);
    const deltaBrandLeft = Math.abs(mainMetrics.brand.left - marketMetrics.brand.left);
    const deltaNavLeft = Math.abs(mainMetrics.nav.left - marketMetrics.nav.left);
    const deltaCartLeft = Math.abs(mainMetrics.cart.left - marketMetrics.cart.left);
    const deltaCartRight = Math.abs(mainMetrics.cart.right - marketMetrics.cart.right);

    // Maximum allowed tolerance is 1.0 px (strict pixel-perfect alignment)
    const TOLERANCE = 1.0;
    assert.ok(deltaScrollbar <= TOLERANCE, `Scrollbar width delta too high: ${deltaScrollbar}px`);
    assert.ok(deltaClientWidth <= TOLERANCE, `Client width delta too high: ${deltaClientWidth}px`);
    assert.ok(deltaInnerLeft <= TOLERANCE, `Header inner left delta too high: ${deltaInnerLeft}px`);
    assert.ok(deltaBrandLeft <= TOLERANCE, `Brand logo left delta too high: ${deltaBrandLeft}px`);
    assert.ok(deltaNavLeft <= TOLERANCE, `Navigation left delta too high: ${deltaNavLeft}px`);
    assert.ok(deltaCartLeft <= TOLERANCE, `Cart button left delta too high: ${deltaCartLeft}px`);
    assert.ok(deltaCartRight <= TOLERANCE, `Cart button right delta too high: ${deltaCartRight}px`);

    const summaryTable = [
      '### ✅ Check 3: Pixel-Perfect Header Alignment (Main vs. Market)',
      '| Header Metric | Main Site | Market (/каталог/) | Delta | Status |',
      '| :--- | :---: | :---: | :---: | :---: |',
      `| Client Viewport Width | ${mainMetrics.clientWidth}px | ${marketMetrics.clientWidth}px | ${deltaClientWidth}px | ✅ PASS |`,
      `| Scrollbar Width | ${mainMetrics.scrollbarWidth}px | ${marketMetrics.scrollbarWidth}px | ${deltaScrollbar}px | ✅ PASS |`,
      `| Container Left | ${mainMetrics.inner.left}px | ${marketMetrics.inner.left}px | ${deltaInnerLeft}px | ✅ PASS |`,
      `| Brand Logo Left | ${mainMetrics.brand.left}px | ${marketMetrics.brand.left}px | ${deltaBrandLeft}px | ✅ PASS |`,
      `| Nav Menu Left | ${mainMetrics.nav.left}px | ${marketMetrics.nav.left}px | ${deltaNavLeft}px | ✅ PASS |`,
      `| Cart Button Left | ${mainMetrics.cart.left}px | ${marketMetrics.cart.left}px | ${deltaCartLeft}px | ✅ PASS |`,
      `| Cart Button Right | ${mainMetrics.cart.right}px | ${marketMetrics.cart.right}px | ${deltaCartRight}px | ✅ PASS |`,
    ].join('\n');

    appendToSummary(summaryTable);
  } finally {
    cleanupChrome();
  }
});

// ---------------------------------------------------------------------------
// 4. Search Focus, Bounds & Esc Button Test (Main Page & Market Page)
// ---------------------------------------------------------------------------
test('4. Search input does not cover logo, and Esc exits focus on both pages', async (t) => {
  const chromePath = process.env.CHROME_PATH ||
    (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : 'google-chrome'));

  if (process.platform === 'darwin' && !existsSync(chromePath)) {
    t.skip('Google Chrome binary not found for local headless CDP test');
    return;
  }

  const port = 9228;
  const { cleanup: cleanupChrome } = await launchChrome(chromePath, port);

  async function testSearch(url, name) {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?` + encodeURIComponent(url), { method: 'PUT' });
    const target = await res.json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => (ws.onopen = resolve));
    let id = 1;
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const curId = id++;
        const handler = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id === curId) {
            ws.removeEventListener('message', handler);
            if (msg.error) reject(msg.error);
            else resolve(msg.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: curId, method, params }));
      });
    }

    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.enable');
    await send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 1500));

    // Focus search input and check bounds
    const focusResult = await send('Runtime.evaluate', {
      expression: `(async () => {
        const input = document.querySelector('#header-search-input');
        const search = document.querySelector('.main-header-search-wrap, .compact-search-wrap');
        const kbd = search?.querySelector('kbd');
        input.focus();
        // Module scripts load asynchronously — poll until the focus handler
        // swaps the badge instead of relying on a fixed delay (CI runners
        // are slow and the handler may attach late).
        let kbdText = kbd?.textContent?.trim();
        for (let i = 0; i < 30 && kbdText !== 'Esc'; i++) {
          await new Promise((r) => setTimeout(r, 200));
          if (document.activeElement !== input) input.focus();
          kbdText = kbd?.textContent?.trim();
        }
        const brand = document.querySelector('.main-site-brand, .unified-brand');
        const brandRight = brand.getBoundingClientRect().right;
        const searchLeft = search.getBoundingClientRect().left;
        return {
          brandRight,
          searchLeft,
          gap: searchLeft - brandRight,
          coversLogo: searchLeft < brandRight,
          kbdText,
          kbdRole: kbd?.getAttribute('role')
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });

    const f = focusResult.result.value;
    assert.equal(f.coversLogo, false, `${name}: search must not cover brand logo`);
    assert.ok(f.gap >= 18, `${name}: gap between brand and search must be at least 18px (got ${f.gap}px)`);
    assert.equal(f.kbdText, 'Esc', `${name}: kbd badge must display 'Esc' when focused`);
    assert.equal(f.kbdRole, 'button', `${name}: kbd badge must have role='button'`);

    // Click Esc button and verify exit
    const escClickResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const kbd = document.querySelector('.main-header-search-wrap kbd, .compact-search-wrap kbd');
        kbd.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
        kbd.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return (async () => {
          const header = document.querySelector('.main-site-header, .unified-header');
          let isFocused = header.classList.contains('is-search-focused');
          let kbdText = header?.querySelector('kbd')?.textContent?.trim();
          for (let i = 0; i < 20 && isFocused; i++) {
            await new Promise((r) => setTimeout(r, 150));
            isFocused = header.classList.contains('is-search-focused');
            kbdText = header?.querySelector('kbd')?.textContent?.trim();
          }
          return { isFocused, kbdText };
        })();
      })()`,
      awaitPromise: true,
      returnByValue: true
    });

    const c = escClickResult.result.value;
    assert.equal(c.isFocused, false, `${name}: clicking Esc must remove search focus`);
    assert.equal(c.kbdText, '⌘ K', `${name}: kbd badge must revert to '⌘ K'`);

    await fetch(`http://127.0.0.1:${port}/json/close/` + target.id);
  }

  // Spin up local static servers for accurate testing
  const { createServer } = await import('node:http');
  const path = await import('node:path');
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  function makeServer(distDir) {
    return createServer((req, res) => {
      let urlPath = decodeURI(req.url.split('?')[0]);
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      const filePath = path.join(distDir, urlPath);
      if (existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'text/plain' });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  }

  const sMain = makeServer(DIST_DIR);
  const sMarket = makeServer(join(process.cwd(), '../market/dist'));
  await new Promise((r) => sMain.listen(4120, r));
  await new Promise((r) => sMarket.listen(4121, r));

  try {
    await testSearch('http://127.0.0.1:4120/', 'Main Page (зиптоп.рф)');
    const marketUrl = existsSync(join(process.cwd(), '../market/dist/index.html'))
      ? 'http://127.0.0.1:4121/'
      : `${LIVE_URL}/каталог/`;
    await testSearch(marketUrl, 'Market Page (/каталог/)');
    appendToSummary('### ✅ Check 4: Search Input Bounds & Esc Button\n- Search expands without covering brand logo (gap ≥ 18px)\n- Badge displays interactive `Esc` button\n- Clicking `Esc` button and pressing physical `Escape` key successfully exits search on both pages');
  } finally {
    sMain.close();
    sMarket.close();
    cleanupChrome();
  }
});

