/* Динопарк — сопряжение телефона и телевизора без сервера (через публичные MQTT-брокеры, сквозное шифрование).
 * Использование:  BASE=http://localhost:8000 node tv-relay.js       (или BASE=https://ai-tim.github.io/dino-park)
 * Телефон и ТВ — разные браузеры (разные контексты, общего хранилища нет). Проверяются пары:
 *   телефон WebKit (iPhone)  → ТВ Chromium (как LG webOS, 1920×1080)
 *   телефон Chromium         → ТВ WebKit
 * Если нет выхода в интернет или ни один брокер недоступен — тест пропускается (код выхода 0).
 * PAIRS=wk-cr,cr-wk,cr-cr — какие пары гонять; SHOT_TV=путь.png — снимок ТВ первой пары.
 */
const pw = require('playwright-core');
const path = require('path');
const fs = require('fs');
const BASE = (process.env.BASE || 'http://localhost:8000').replace(/\/$/, '');
const SHOTS = path.join(__dirname, 'screens'); fs.mkdirSync(SHOTS, { recursive: true });
const PAIRS = (process.env.PAIRS || 'wk-cr,cr-wk').split(',');
const results = [], errors = [];
const ok = (name, cond, info) => { results.push({ name, pass: !!cond }); console.log((cond ? '✅' : '❌') + ' ' + name + (info ? ' — ' + info : '')); };
const LG_UA = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager';
const CHROME_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const browsers = {};
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

async function pair(combo, first) {
  const [pk, tk] = combo.split('-');
  const label = `${pk === 'wk' ? 'WebKit' : 'Chromium'} → ТВ ${tk === 'wk' ? 'WebKit' : 'Chromium'}`;
  const pb = await launch(pk), tb = await launch(tk);
  const iphone = pw.devices['iPhone 13']; const { defaultBrowserType, ...dev } = iphone;
  const pctx = await pb.newContext(pk === 'wk' ? { ...dev, locale: 'ru-RU' } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await pctx.addInitScript(() => { localStorage.setItem('dp_news_v3', '1'); });
  const phone = await pctx.newPage(); watch(phone, 'phone');
  await phone.goto(BASE + '/parks.html'); await phone.waitForTimeout(1000);
  await phone.click('#new-park'); await phone.fill('#np-name', 'Парк ' + combo); await phone.click('#np-create'); await phone.click('#cr-go');
  await phone.waitForURL(/park\.html/); await phone.waitForTimeout(1500);
  await phone.evaluate(() => DP.ui.close && DP.ui.close());
  for (const sp of ['trex', 'triceratops']) { await phone.evaluate(() => window.dpPark.screens.ready()); await phone.$eval(`[data-sp="${sp}"]`, el => el.click()); await phone.waitForTimeout(200); }
  await phone.evaluate(() => window.dpPark.screens.tv()); await phone.waitForSelector('.tv-code', { timeout: 15000 });
  // есть ли связь с брокерами?
  const online = await phone.waitForFunction(() => DP.relay && DP.relay.hub.online().length > 0, null, { timeout: 20000 }).then(() => true).catch(() => false);
  if (!online) { await pctx.close(); return 'skip'; }
  const code = (await phone.textContent('.tv-code')).replace(/\D/g, '');
  ok(`[${label}] телефон показал код для ТВ`, /^\d{5}$/.test(code), code + ' · ' + (await phone.evaluate(() => DP.relay.hub.online().join(','))));
  if (first) await phone.screenshot({ path: path.join(SHOTS, 'relay-phone-code.png') });

  const tctx = await tb.newContext(tk === 'cr' ? { viewport: { width: 1920, height: 1080 }, userAgent: LG_UA, locale: 'ru-RU' } : { viewport: { width: 1920, height: 1080 }, locale: 'ru-RU' });
  await tctx.addInitScript(() => { window.DP_CONFIG = { JOIN_MS: 25000 }; });
  const tv = await tctx.newPage(); watch(tv, 'tv');
  await tv.goto(BASE + '/tv.html'); await tv.waitForTimeout(1200);
  ok(`[${label}] ТВ: режим без сервера`, /без регистрации/.test(await tv.textContent('body')));
  // неверный код — понятная ошибка
  await tv.fill('#code', String((+code + 1) % 100000).padStart(5, '0')); await tv.click('#go');
  await tv.waitForFunction(() => /не найден|истёк|Неверн|не ответил/i.test(document.querySelector('#err').textContent), null, { timeout: 30000 }).catch(() => {});
  ok(`[${label}] ТВ: неверный код → понятная ошибка`, /не найден|истёк|Неверн|не ответил/i.test(await tv.textContent('#err')), (await tv.textContent('#err')).slice(0, 80));
  // ввод кода экранной клавиатурой (как пультом)
  await tv.fill('#code', '');
  const t0 = Date.now();
  for (const d of code) await tv.click(`#kp [data-k="${d}"]`);
  const paired = await tv.waitForFunction(() => window.dpScene && window.dpScene.ents.length >= 2, null, { timeout: 45000 }).then(() => true).catch(() => false);
  ok(`[${label}] сопряжение через ретранслятор`, paired, `${((Date.now() - t0) / 1000).toFixed(1)} с · ${await tv.evaluate(() => (window.dpScene ? window.dpScene.ents.length : 0) + ' дино · ' + DP.relay.hub.online().join(','))}`);
  if (!paired) { console.log('   TV err:', await tv.textContent('#err')); await pctx.close(); await tctx.close(); return; }
  await phone.waitForFunction(() => (DP.sync.tvInfo() || {}).paired > 0, null, { timeout: 15000 }).catch(() => {});
  ok(`[${label}] телефон видит подключённый ТВ`, await phone.evaluate(() => (DP.sync.tvInfo() || {}).paired > 0));
  if (first) { // второй телевизор с тем же кодом не войдёт
    const t2c = await tb.newContext({ viewport: { width: 1280, height: 720 } }); await t2c.addInitScript(() => { window.DP_CONFIG = { JOIN_MS: 25000 }; }); const t2 = await t2c.newPage();
    await t2.goto(BASE + '/tv.html?code=' + code);
    await t2.waitForFunction(() => /⚠️/.test(document.querySelector('#err').textContent), null, { timeout: 50000 }).catch(() => {});
    ok(`[${label}] код одноразовый — второй ТВ с тем же кодом не входит`, await t2.evaluate(() => !window.dpScene && /⚠️/.test(document.querySelector('#err').textContent)));
    await t2c.close();
  }
  await tv.waitForTimeout(1500);
  ok(`[${label}] ТВ: телефон на связи`, /на связи/.test(await tv.textContent('#tvlink')));
  ok(`[${label}] ТВ: желаний над головами нет`, await tv.evaluate(() => window.dpScene.opts.showNeeds === false && window.dpScene.opts.needHint === false));
  // v5: ТВ рисует в родном разрешении 1920×1080 (без растягивания), со сглаживанием и тон-маппингом
  const rr = await tv.evaluate(() => { const s = window.dpScene; if (!s.is3d) return { is3d: false }; const rs0 = s._rs || 1; if (s.setRenderScale) s.setRenderScale(1); s.resize && s.resize(); const g = s.gpuStats(); return { is3d: true, rs0: +rs0.toFixed(2), size: [s.c.width, s.c.height], dpr: s.dpr, aa: g.aa, tm: g.toneMapping, q: DP.Scene.PERF.quality }; });
  ok(`[${label}] ТВ: 3D в родном разрешении 1920×1080, сглаживание включено`, !rr.is3d || (rr.size[0] === 1920 && rr.size[1] === 1080 && rr.aa !== '0' && rr.tm > 0), JSON.stringify(rr));
  // события с телефона
  await phone.evaluate(() => DP.ui.close()); await phone.evaluate(() => window.dpPark.feedAll());
  const fed = await tv.waitForFunction(() => window.dpScene.food.length > 0 || /Обед|корм/i.test(document.querySelector('#tvtoast').textContent), null, { timeout: 15000 }).then(() => true).catch(() => false);
  ok(`[${label}] «Покормить всех» с телефона видно на ТВ`, fed);
  await phone.evaluate(() => window.dpPark.screens.menu()); await phone.click('#m-qa [data-go="playall"]');
  const play = await tv.waitForFunction(() => window.dpScene.balls.length > 0 || /игр|мяч/i.test(document.querySelector('#tvtoast').textContent), null, { timeout: 15000 }).then(() => true).catch(() => false);
  ok(`[${label}] «Поиграть со всеми» видно на ТВ`, play);
  // новый динозавр с телефона
  await phone.evaluate(() => window.dpPark.screens.ready()); await phone.$eval('[data-sp="stegosaurus"]', el => el.click());
  const added = await tv.waitForFunction(() => window.dpScene.ents.length >= 3, null, { timeout: 15000 }).then(() => true).catch(() => false);
  ok(`[${label}] новый динозавр появляется на ТВ`, added);
  if (first) { await tv.waitForTimeout(2500); await tv.screenshot({ path: process.env.SHOT_TV || path.join(SHOTS, 'relay-tv-1080.png') }); }
  // перезагрузка ТВ — сеанс восстанавливается без нового кода
  await tv.reload(); await tv.waitForTimeout(500);
  const resumed = await tv.waitForFunction(() => window.dpScene && window.dpScene.ents.length >= 3, null, { timeout: 30000 }).then(() => true).catch(() => false);
  ok(`[${label}] после перезагрузки ТВ продолжает показывать парк`, resumed);
  // отключение с телефона
  await phone.evaluate(() => window.dpPark.screens.tv()); await phone.waitForTimeout(500);
  const off = await phone.$('#tv-off');
  if (off) { await off.click(); let gone = false; for (let i = 0; i < 30 && !gone; i++) { await tv.waitForTimeout(500); gone = await tv.evaluate(() => !window.dpScene && !!document.querySelector('#join') && !document.querySelector('#join').classList.contains('hidden')).catch(() => false); } ok(`[${label}] «Отключить телевизоры» на телефоне отключает ТВ`, gone); }
  else ok(`[${label}] кнопка «Отключить телевизоры»`, false);
  await pctx.close(); await tctx.close();
}

(async () => {
  let first = true, skipped = false;
  for (const c of PAIRS) { const r = await pair(c, first); if (r === 'skip') { skipped = true; break; } first = false; }
  for (const b of Object.values(browsers)) await b.close().catch(() => {});
  if (skipped) { console.log('⏭️ Нет связи с публичными брокерами — тест сопряжения через интернет пропущен'); process.exit(0); }
  const failed = results.filter(r => !r.pass).length;
  const errs = [...new Set(errors)];
  if (errs.length) console.log('Ошибки в консоли:\n  ' + errs.join('\n  '));
  console.log(`\nИтого: ${results.length - failed}/${results.length}` + (errs.length ? ` · ошибок консоли: ${errs.length}` : ''));
  process.exit(failed || errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
