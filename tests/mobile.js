/* Динопарк — проверка на iPhone: лендинг → «Мои парки» → новый парк с PIN → парк с динозаврами.
 * Использование:  BASE=http://localhost:8000 node mobile.js
 * Движок: WebKit (как Safari), если установлен (`npx playwright install webkit`), иначе Chrome с профилем iPhone,
 * замедлением процессора ×4 и медленной сетью. ENGINE=chromium — принудительно Chrome.
 * SHOT=/path/to.png — куда сохранить снимок парка (по умолчанию tests/screens/mobile-iphone-park.png).
 */
const pw = require('playwright-core');
const path = require('path');
const fs = require('fs');
const BASE = (process.env.BASE || 'http://localhost:8000').replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'screens'); fs.mkdirSync(SHOTS, { recursive: true });
const SHOT = process.env.SHOT || path.join(SHOTS, 'mobile-iphone-park.png');
const results = [], errors = [];
const ok = (name, cond, info) => { results.push({ name, pass: !!cond }); console.log((cond ? '✅' : '❌') + ' ' + name + (info ? ' — ' + info : '')); };
const IPHONE = (pw.devices && pw.devices['iPhone 13']) || {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true
};
// учёт памяти холстов: сколько мегабайт выделено за всё время и сколько живо сейчас
const CANVAS_PROBE = () => {
  window.__cvAlloc = 0; const refs = [];
  const ce = Document.prototype.createElement;
  Document.prototype.createElement = function (t, o) { const e = ce.call(this, t, o); if (String(t).toLowerCase() === 'canvas' && window.WeakRef) refs.push(new WeakRef(e)); return e; };
  const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
  Object.defineProperty(HTMLCanvasElement.prototype, 'height', { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); window.__cvAlloc += this.width * this.height * 4 / 1e6; } });
  window.__cvLive = () => { let mb = 0; document.querySelectorAll('canvas').forEach(c => { if (window.WeakRef) refs.push(new WeakRef(c)); }); const seen = new Set(); refs.forEach(r => { const c = r.deref && r.deref(); if (c && !seen.has(c)) { seen.add(c); mb += c.width * c.height * 4 / 1e6; } }); return Math.round(mb); };
};

(async () => {
  let engine = process.env.ENGINE || 'webkit', browser;
  if (engine === 'webkit') { try { browser = await pw.webkit.launch(); } catch (e) { console.log('ℹ️ WebKit не установлен — использую Chrome с профилем iPhone'); engine = 'chromium'; } }
  if (!browser) browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const { defaultBrowserType, ...dev } = IPHONE;
  const ctx = await browser.newContext({ ...dev, locale: 'ru-RU' });
  await ctx.addInitScript(CANVAS_PROBE);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  if (engine === 'chromium') { // «как на телефоне»: медленный процессор и сеть 4G
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8 * 1024 / 1000 * 1000, uploadThroughput: 750e3 / 8 });
  }
  console.log('Движок: ' + engine + ', экран ' + dev.viewport.width + '×' + dev.viewport.height + ' @' + dev.deviceScaleFactor + 'x');

  // 1. Лендинг: вес страницы, кнопки — обычные ссылки и видны на экране
  let bytes = 0; const onResp = async (r) => { try { bytes += (await r.body()).length; } catch (e) {} };
  page.on('response', onResp);
  const t0 = Date.now(); await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cta', { state: 'visible' }); const tCta = Date.now() - t0;
  ok('Лендинг: кнопка «Войти в парк» появилась быстро', tCta < 8000, tCta + ' мс');
  await page.waitForTimeout(3500); page.off('response', onResp);
  ok('Лендинг лёгкий (< 600 КБ)', bytes < 600e3, Math.round(bytes / 1024) + ' КБ');
  const cta = await page.evaluate(() => { const a = document.querySelector('#cta'), r = a.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { tag: a.tagName, href: a.getAttribute('href'), bottom: Math.round(r.bottom), vh: innerHeight, onTop: !!hit && (hit === a || a.contains(hit)) }; });
  ok('«Войти в парк» — обычная ссылка на parks.html', cta.tag === 'A' && cta.href === 'parks.html', JSON.stringify(cta));
  ok('«Войти в парк» целиком на экране и ничем не перекрыта', cta.bottom <= cta.vh && cta.onTop, `низ ${cta.bottom} из ${cta.vh}`);
  const demo = await page.getAttribute('.lp-cta-row .lp-ghost', 'href');
  ok('«Посмотреть демо» — обычная ссылка', demo === 'park.html?demo=1');
  // iOS при прокрутке скрывает адресную строку и шлёт resize — холсты не должны пересоздаваться
  const memLoad = await page.evaluate(() => Math.round(window.__cvAlloc));
  for (let i = 0; i < 15; i++) { await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await page.waitForTimeout(40); }
  await page.waitForTimeout(400);
  const memAfter = await page.evaluate(() => Math.round(window.__cvAlloc));
  ok('Память холстов на лендинге в пределах (< 90 МБ)', memLoad < 90, memLoad + ' МБ выделено, живых ' + await page.evaluate(() => window.__cvLive()) + ' МБ');
  ok('Шквал resize (адресная строка iOS) не пересоздаёт холсты', memAfter - memLoad < 10, '+' + (memAfter - memLoad) + ' МБ');
  ok('Лендинг: в шапке живые динозавры', await page.evaluate(() => window.dpLanding.hero.ents.length > 0));

  // 2. Нажатие пальцем → «Мои парки»
  await page.tap('#cta'); await page.waitForURL(/parks\.html/, { timeout: 15000 });
  ok('Тап по «Войти в парк» открывает «Мои парки»', /parks\.html/.test(page.url()));
  await page.waitForSelector('#new-park', { state: 'visible' });

  // 3. Новый парк с паролем
  await page.tap('#new-park'); await page.waitForSelector('#np-name', { state: 'visible' });
  await page.tap('#np-name'); await page.fill('#np-name', 'Парк на iPhone'); await page.tap('#np-create');
  await page.waitForSelector('.cred .v');
  const creds = await page.$$eval('.cred .v', els => els.map(e => e.textContent));
  ok('Создан парк: код + PIN', /^[a-z0-9]{10}$/.test(creds[0]) && /^\d{6}$/.test(creds[1]), creds.join(' / '));
  await page.tap('#cr-go'); await page.waitForURL(/park\.html/, { timeout: 15000 });
  ok('Переход в парк', /park\.html\?id=/.test(page.url()));

  // 4. Первый динозавр и второй — через меню
  await page.waitForSelector('#ob-ready', { state: 'visible', timeout: 15000 });
  await page.tap('#ob-ready'); await page.waitForSelector('[data-sp="trex"]', { state: 'visible' });
  await page.tap('[data-sp="trex"]'); await page.waitForTimeout(500);
  await page.evaluate(() => window.dpPark.screens.ready()); await page.waitForSelector('[data-sp="triceratops"]', { state: 'visible' });
  await page.tap('[data-sp="triceratops"]');
  await page.waitForFunction(() => window.dpScene && window.dpScene.ents.length >= 2 && window.dpScene.ents.every(e => e.ready), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => ({ n: window.dpPark.park.dinos.length, drawn: window.dpScene.ents.filter(e => e.ready && e._rect && e._rect.w > 10).length, w: window.dpScene.c.width, live: window.__cvLive() }));
  ok('В парке видны динозавры', st.n >= 2 && st.drawn >= 2, JSON.stringify(st));
  // ничего лишнего поверх сцены: тап по парку открывает меню
  await page.evaluate(() => DP.ui && DP.ui.close && DP.ui.close()); await page.waitForTimeout(300);
  await page.screenshot({ path: SHOT });

  // 5. Повторный вход по коду и PIN
  await page.goto(BASE + '/parks.html'); await page.waitForSelector('#open-id');
  await page.fill('#open-id', creds[0]); await page.fill('#open-pin', creds[1]); await page.tap('#open-btn');
  await page.waitForURL(/park\.html\?id=/, { timeout: 15000 });
  await page.waitForFunction(() => window.dpScene && window.dpScene.ents.length >= 2, null, { timeout: 20000 });
  ok('Вход по коду и PIN на телефоне', true);

  ok('Нет ошибок JS', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  const pass = results.filter(r => r.pass).length;
  console.log(`\nИтого: ${pass}/${results.length} проверок пройдено (${engine})` + '\nСнимок: ' + SHOT);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('❌ Сбой теста:', e); process.exit(1); });
