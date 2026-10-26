/* Динопарк — сопряжение с «трудными» устройствами (через публичные MQTT-брокеры, как на проде).
 * Использование:  BASE=http://127.0.0.1:8765 node tv-compat.js     (или BASE=https://ai-tim.github.io/dino-park)
 * Сценарии (SCEN=a,b,c,d,e — какие гонять; по умолчанию все):
 *   a  телефон Samsung Internet (Android) → ТВ Samsung Tizen 5.0 (старый Chromium: нет padStart/finally/flat/queueMicrotask…, нет WebGL2)
 *      + неверный код → «телефон не ответил» и кнопка «Попробовать ещё раз»
 *   b  телефон iPhone (WebKit), часы −10 мин → ТВ Tizen, часы +10 мин
 *   c  код вводят на ТВ через 75 с; телефон за это время перерисовывает экран «ТВ» — код не должен меняться
 *   d  один брокер на ТВ «лежит» (недоступный адрес) — сопряжение всё равно проходит
 *   f  очень старый ТВ (Tizen 3 / webOS 3): наследная ES5-сборка (?legacy=1) — сопряжение и события
 *   e  все брокеры на ТВ недоступны → «не удалось связаться с сервером соединения» (а не «код не найден») + повтор
 * Если ни один брокер недоступен с телефона — тест пропускается (код выхода 0).
 */
const pw = require('playwright-core');
const BASE = (process.env.BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const SCEN = (process.env.SCEN || 'a,b,c,d,e,f').split(',');
const DELAY = +(process.env.DELAY_MS || 75000);
const results = [], errors = [];
const ok = (name, cond, info) => { results.push({ name, pass: !!cond }); console.log((cond ? '✅' : '❌') + ' ' + name + (info ? ' — ' + info : '')); };
const TIZEN_UA = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 TV Safari/537.36';
const SAMSUNG_PHONE_UA = 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36';
const BROKERS = [
  { name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' },
  { name: 'shiftr.io', url: 'wss://public.cloud.shiftr.io', user: 'public', pass: 'public' },
  { name: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
  { name: 'Mosquitto', url: 'wss://test.mosquitto.org:8081/mqtt' }
];
const DEAD = { name: 'Dead', url: 'wss://127.0.0.1:9/mqtt' };
const CHROME_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
// «старый Chromium» Tizen 4–5: убираем то, чего там нет (Chrome 56–63)
const OLD_TV = () => {
  delete String.prototype.padStart; delete String.prototype.padEnd; delete Promise.prototype.finally;
  delete Array.prototype.flat; delete Array.prototype.flatMap; delete Object.fromEntries; delete String.prototype.matchAll;
  delete String.prototype.replaceAll; delete Array.prototype.at; delete String.prototype.at; delete window.structuredClone;
  delete window.queueMicrotask; delete window.ResizeObserver; delete window.WebGL2RenderingContext;
  const g = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t) { if (t === 'webgl2') return null; return g.apply(this, arguments); };
};
const SKEW = (off) => {
  const D = Date, n = D.now.bind(D);
  class SD extends D { constructor(...a) { if (a.length) super(...a); else super(n() + off); } static now() { return n() + off; } }
  window.Date = SD;
};
let browsers = {};
async function launch(kind) {
  if (browsers[kind]) return browsers[kind];
  if (kind === 'wk') { try { browsers.wk = await pw.webkit.launch(); } catch (e) { console.log('ℹ️ WebKit не установлен — вместо него Chrome'); browsers.wk = await launch('cr'); } }
  else browsers.cr = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: CHROME_ARGS });
  return browsers[kind];
}
const watch = (page, tag) => {
  page.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR|Failed to load resource|WebSocket/.test(m.text())) errors.push(tag + ' console: ' + m.text()); });
};

async function phoneWithCode(kind, label, init) {
  const b = await launch(kind);
  let opts;
  if (kind === 'wk') { const { defaultBrowserType, ...dev } = pw.devices['iPhone 13']; opts = { ...dev, locale: 'ru-RU' }; }
  else opts = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6, userAgent: SAMSUNG_PHONE_UA, locale: 'ru-RU' };
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(() => { localStorage.setItem('dp_news_v3', '1'); });
  if (init) await ctx.addInitScript(init.fn, init.arg);
  const phone = await ctx.newPage(); watch(phone, label + ' phone');
  await phone.goto(BASE + '/parks.html'); await phone.waitForTimeout(1000);
  await phone.click('#new-park'); await phone.fill('#np-name', 'Парк ' + label); await phone.click('#np-create'); await phone.click('#cr-go');
  await phone.waitForURL(/park\.html/); await phone.waitForTimeout(1500);
  await phone.evaluate(() => DP.ui.close && DP.ui.close());
  for (const sp of ['trex', 'triceratops']) { await phone.evaluate(() => window.dpPark.screens.ready()); await phone.$eval(`[data-sp="${sp}"]`, el => el.click()); await phone.waitForTimeout(200); }
  await phone.evaluate(() => window.dpPark.screens.tv()); await phone.waitForSelector('.tv-code', { timeout: 15000 });
  const online = await phone.waitForFunction(() => DP.relay && DP.relay.hub.online().length > 0, null, { timeout: 25000 }).then(() => true).catch(() => false);
  const code = (await phone.textContent('.tv-code')).replace(/\D/g, '');
  return { ctx, phone, code, online };
}
async function tvPage(label, { relays, skew, old = true, joinMs = 30000, q = '' } = {}) {
  const b = await launch('cr');
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: TIZEN_UA, locale: 'ru-RU' });
  await ctx.addInitScript((cfg) => { window.DP_CONFIG = cfg; }, Object.assign({ JOIN_MS: joinMs }, relays ? { RELAYS: relays } : {}));
  if (old) await ctx.addInitScript(OLD_TV);
  if (skew) await ctx.addInitScript(SKEW, skew);
  const tv = await ctx.newPage(); watch(tv, label + ' tv');
  await tv.goto(BASE + '/tv.html' + q); await tv.waitForTimeout(1200);
  return { ctx, tv };
}
async function enter(tv, code, label, phone) {
  await tv.fill('#code', '');
  const t0 = Date.now();
  for (const d of code) await tv.click(`#kp [data-k="${d}"]`);
  if (!(await tv.evaluate(() => document.querySelector('#err').textContent))) await tv.click('#go').catch(() => {});
  const paired = await tv.waitForFunction(() => window.dpScene && window.dpScene.ents.length >= 2, null, { timeout: 60000 }).then(() => true).catch(() => false);
  ok(`[${label}] сопряжение`, paired, `${((Date.now() - t0) / 1000).toFixed(1)} с · ` + (paired ? await tv.evaluate(() => window.dpScene.ents.length + ' дино · ' + (window.dpScene.is3d ? '3D' : '2D') + ' · ' + DP.relay.hub.online().join(',')) : 'ТВ: ' + (await tv.textContent('#err')).slice(0, 160)));
  if (!paired) { const st = (pg) => pg.evaluate(() => JSON.stringify((DP.relay.hub.conns || []).map(c => [c.b && c.b.name, c.open, !!c.ws, c.tries, c.rx ? Math.round((Date.now() - c.rx) / 1000) + 's' : '-']))).catch(e => e.message);
    console.log('   ТВ брокеры:', await st(tv)); if (phone) console.log('   телефон брокеры:', await st(phone), await phone.evaluate(() => JSON.stringify(Object.values(DP.relay._hosts || {}).map(h => h.codeInfo && h.codeInfo())))); }
  return paired;
}
async function events(phone, tv, label) {
  await phone.evaluate(() => DP.ui.close()); await phone.evaluate(() => window.dpPark.feedAll());
  const fed = await tv.waitForFunction(() => window.dpScene.food.length > 0 || /Обед|корм/i.test(document.querySelector('#tvtoast').textContent), null, { timeout: 20000 }).then(() => true).catch(() => false);
  ok(`[${label}] «Покормить всех» с телефона видно на ТВ`, fed);
  await phone.waitForFunction(() => (DP.sync.tvInfo() || {}).paired > 0, null, { timeout: 15000 }).catch(() => {});
  ok(`[${label}] телефон видит подключённый ТВ`, await phone.evaluate(() => (DP.sync.tvInfo() || {}).paired > 0));
}

const S = {
  async a() {
    const L = 'Samsung-телефон → Tizen-ТВ';
    const P = await phoneWithCode('cr', L); if (!P.online) return 'skip';
    ok(`[${L}] телефон показал код`, /^\d{5}$/.test(P.code), P.code);
    const { ctx, tv } = await tvPage(L, { joinMs: 15000 });
    ok(`[${L}] ТВ: страница открылась без ошибок, есть ввод кода`, !!(await tv.$('#code')) && !errors.some(e => e.startsWith(L + ' tv')), errors.filter(e => e.startsWith(L + ' tv')).join(' | ').slice(0, 200));
    ok(`[${L}] ТВ: защищённое шифрование доступно`, await tv.evaluate(() => DP.relay.selfTest().then(() => true, (e) => e.kind + ': ' + e.message)) === true);
    // неверный код → «телефон не ответил» (а не «нет связи»), есть кнопка повтора
    await tv.fill('#code', String((+P.code + 1) % 100000).padStart(5, '0')); await tv.click('#go');
    await tv.waitForFunction(() => document.querySelector('#err').dataset.kind, null, { timeout: 45000 }).catch(() => {});
    const w = await tv.evaluate(() => ({ kind: document.querySelector('#err').dataset.kind, t: document.querySelector('#err').textContent, retry: !!document.querySelector('#retry') }));
    ok(`[${L}] неверный код → «телефон не ответил» + «Попробовать ещё раз»`, w.kind === 'nophone' && w.retry && /не ответил/.test(w.t), w.kind + ' · ' + w.t.slice(0, 90));
    if (await enter(tv, P.code, L, P.phone)) await events(P.phone, tv, L);
    await P.ctx.close(); await ctx.close();
  },
  async b() {
    const L = 'iPhone (часы −10 мин) → Tizen-ТВ (часы +10 мин)';
    const P = await phoneWithCode('wk', L, { fn: SKEW, arg: -600000 }); if (!P.online) return 'skip';
    const { ctx, tv } = await tvPage(L, { skew: 600000 });
    ok(`[${L}] часы действительно разъехались на 20 мин`, Math.abs((await tv.evaluate(() => Date.now())) - (await P.phone.evaluate(() => Date.now())) - 1200000) < 60000);
    if (await enter(tv, P.code, L, P.phone)) await events(P.phone, tv, L);
    await P.ctx.close(); await ctx.close();
  },
  async c() {
    const L = `код вводят через ${Math.round(DELAY / 1000)} с`;
    const P = await phoneWithCode('wk', L); if (!P.online) return 'skip';
    const { ctx, tv } = await tvPage(L);
    const steps = 3; let same = true;
    for (let i = 0; i < steps; i++) {
      await tv.waitForTimeout(DELAY / steps);
      await P.phone.evaluate(() => window.dpPark.screens.tv()); await P.phone.waitForSelector('.tv-code');
      const c2 = (await P.phone.textContent('.tv-code')).replace(/\D/g, ''); if (c2 !== P.code) same = false;
    }
    ok(`[${L}] перерисовка экрана «ТВ» на телефоне не меняет код`, same);
    if (await enter(tv, P.code, L, P.phone)) await events(P.phone, tv, L);
    await P.ctx.close(); await ctx.close();
  },
  async d() {
    const L = 'на ТВ один брокер недоступен';
    const P = await phoneWithCode('wk', L); if (!P.online) return 'skip';
    const { ctx, tv } = await tvPage(L, { relays: [DEAD].concat(BROKERS) });
    await enter(tv, P.code, L, P.phone);
    await P.ctx.close(); await ctx.close();
  },
  async f() {
    const L = 'iPhone → старый ТВ (ES5-сборка)';
    const P = await phoneWithCode('wk', L); if (!P.online) return 'skip';
    const { ctx, tv } = await tvPage(L, { q: '?legacy=1' });
    ok(`[${L}] ТВ загрузил наследную сборку`, await tv.evaluate(() => DPBOOT.mode === 'legacy' && DPBOOT.ready && !window.THREE));
    if (await enter(tv, P.code, L)) await events(P.phone, tv, L);
    await P.ctx.close(); await ctx.close();
  },
  async e() {
    const L = 'на ТВ все брокеры недоступны';
    const { ctx, tv } = await tvPage(L, { relays: [DEAD, { name: 'Dead2', url: 'wss://127.0.0.1:10/mqtt' }] });
    for (const d of '12345') await tv.click(`#kp [data-k="${d}"]`);
    if (!(await tv.evaluate(() => document.querySelector('#err').textContent))) await tv.click('#go').catch(() => {});
    await tv.waitForFunction(() => document.querySelector('#err').dataset.kind, null, { timeout: 40000 }).catch(() => {});
    const w = await tv.evaluate(() => ({ kind: document.querySelector('#err').dataset.kind, t: document.querySelector('#err').textContent, retry: !!document.querySelector('#retry') }));
    ok(`[${L}] → «не удалось связаться с сервером соединения» + повтор (а не «код не найден»)`, w.kind === 'net' && w.retry && /сервером соединения/.test(w.t) && !/не найден|истёк/.test(w.t), w.kind + ' · ' + w.t.slice(0, 90));
    await ctx.close();
  }
};

(async () => {
  let skipped = false;
  for (const k of SCEN) { if (!S[k]) continue; console.log('— сценарий ' + k); const r = await S[k]().catch(e => { ok('сценарий ' + k + ' без исключений', false, e.message.slice(0, 200)); }); if (r === 'skip') { skipped = true; break; } }
  for (const b of Object.values(browsers)) await b.close().catch(() => {});
  if (skipped) { console.log('⏭️ Нет связи с публичными брокерами — тест пропущен'); process.exit(0); }
  const failed = results.filter(r => !r.pass).length;
  const errs = [...new Set(errors)];
  if (errs.length) console.log('Ошибки в консоли:\n  ' + errs.join('\n  '));
  console.log(`\nИтого: ${results.length - failed}/${results.length}` + (errs.length ? ` · ошибок консоли: ${errs.length}` : ''));
  process.exit(failed || errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
