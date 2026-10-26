/* Динопарк — качество картинки на телевизоре (v6): на ТВ нет теней в реальном времени и MSAA, нет размытия под панелями;
 * «⚙️ Качество: Авто/Плавно/Красиво» переключается пультом (стрелки + OK) и с телефона (☰ → 📺 ТВ), выбор сохраняется;
 * смена ступени не плодит сцен и циклов кадров. Использование: BASE=http://127.0.0.1:8765 node tests/tvq.js */
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const UA = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager';
const results = []; const ok = (n, c, i) => { results.push(!!c); console.log((c ? '✅' : '❌') + ' ' + n + (i ? ' — ' + i : '')); };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, userAgent: UA });
  await ctx.addInitScript(() => { window.DP_CONFIG = Object.assign(window.DP_CONFIG || {}, { RELAYS: [] }); });
  const errs = [];
  const ph = await ctx.newPage(); ph.on('pageerror', e => errs.push('phone: ' + e.message)); ph.setDefaultTimeout(60000);
  await ph.goto(BASE + '/parks.html', { waitUntil: 'domcontentloaded' }); await ph.waitForSelector('#new-park', { state: 'visible' });
  await ph.click('#new-park'); await ph.fill('#np-name', 'ТВ-качество'); await ph.click('#np-create'); await ph.waitForSelector('.cred .v');
  await ph.click('#cr-go'); await ph.waitForURL(/park\.html/); await ph.waitForFunction(() => window.dpPark && window.dpPark.park, null, { timeout: 30000 });
  const parkUrl = ph.url();
  await ph.evaluate(() => { const P = window.dpPark; DP.ui.close(); ['trex', 'triceratops'].forEach((id, i) => P.newDino({ species: id, palette: i, name: 'Д' + i, diet: 'herb', habitat: 'ground', sprite: null })); });
  await ph.evaluate(() => window.dpPark.screens.tv()); await ph.waitForSelector('.tv-code');
  ok('телефон: в меню ТВ есть выбор качества', await ph.locator('[data-tvq]').count() === 3);
  const code = (await ph.textContent('.tv-code')).trim(); await ph.evaluate(() => DP.ui.close()); await ph.waitForTimeout(400); await ph.close();

  const tv = await ctx.newPage(); tv.on('pageerror', e => errs.push('tv: ' + e.message)); tv.setDefaultTimeout(60000);
  await tv.addInitScript(() => { if (!sessionStorage.getItem('t_init')) { sessionStorage.setItem('t_init', '1'); localStorage.removeItem('dp.tvq'); } });
  await tv.goto(BASE + '/tv.html?code=' + code, { waitUntil: 'domcontentloaded' });
  await tv.waitForFunction(() => window.dpScene && window.dpScene.frames > 2 && window.dpTvQ, null, { timeout: 90000 });
  const st = () => tv.evaluate(() => { const s = window.dpScene, P = DP.Scene.PERF; return { mode: window.dpTvQ.mode, lvl: window.dpTvQ.level, is3d: !!s.is3d, sh: s._sh || 0, aa: s._aa || '', shadowMap: !!(s.renderer && s.renderer.shadowMap.enabled), scenes: DP.Scene.all.length, label: document.querySelector('#tvq').textContent, saved: localStorage.getItem('dp.tvq'), blur: getComputedStyle(document.querySelector('#tvname')).backdropFilter, q: P.quality, ents: s.ents.length }; });
  let s = await st();
  ok('ТВ: режим «Авто», ступень ≥ 1', s.mode === 'auto' && s.lvl >= 1, JSON.stringify(s));
  ok('ТВ: без теней в реальном времени и без MSAA', !s.shadowMap && s.sh === 0 && s.aa !== 'msaa', s.aa);
  ok('ТВ: панели без размытия фона', !s.blur || s.blur === 'none', s.blur);
  // пульт: стрелка → фокус на «⚙️ Качество», OK → «Плавно»
  await tv.keyboard.press('ArrowDown');
  ok('пульт: стрелка ставит фокус на кнопку качества', await tv.evaluate(() => document.activeElement && document.activeElement.id) === 'tvq');
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(800);
  s = await st();
  ok('пульт: OK → «Плавно» (ступень 2)', s.mode === 'smooth' && s.lvl === 2 && /Плавно/.test(s.label) && s.is3d, JSON.stringify({ m: s.mode, l: s.lvl, label: s.label }));
  ok('выбор сохранён (dp.tvq)', /"mode":"smooth"/.test(s.saved || ''));
  ok('смена ступени — одна сцена', s.scenes === 1, 'scenes=' + s.scenes);
  const f1 = await tv.evaluate(() => window.dpScene.frames); await tv.waitForTimeout(1500);
  ok('после смены кадры идут', (await tv.evaluate(() => window.dpScene.frames)) > f1);
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(800); s = await st();
  ok('пульт: ещё OK → «Красиво» (FXAA, без теней)', s.mode === 'pretty' && s.lvl === 0 && s.aa === 'fxaa' && !s.shadowMap, JSON.stringify({ m: s.mode, l: s.lvl, aa: s.aa }));
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(500); s = await st();
  ok('пульт: ещё OK → снова «Авто»', s.mode === 'auto' && /Авто/.test(s.label));
  // выбор переживает перезагрузку
  await tv.evaluate(() => window.dpTvQ.set('smooth')); await tv.waitForTimeout(500);
  await tv.reload({ waitUntil: 'domcontentloaded' });
  await tv.waitForFunction(() => window.dpScene && window.dpScene.frames > 0 && window.dpTvQ, null, { timeout: 90000 });
  s = await st();
  ok('после перезагрузки ТВ: «Плавно» сохранилось', s.mode === 'smooth' && s.lvl === 2 && s.q === 'low', JSON.stringify({ m: s.mode, l: s.lvl, q: s.q }));
  ok('после перезагрузки — парк на экране', s.ents === 2, 'ents=' + s.ents);
  // телефон → ТВ: «Красиво»
  const ph2 = await ctx.newPage(); ph2.on('pageerror', e => errs.push('phone: ' + e.message));
  await ph2.goto(parkUrl, { waitUntil: 'domcontentloaded' }); await ph2.waitForFunction(() => window.dpPark && window.dpPark.park, null, { timeout: 30000 });
  await ph2.evaluate(() => window.dpPark.screens.tv()); await ph2.waitForSelector('[data-tvq="pretty"]');
  await ph2.click('[data-tvq="pretty"]');
  await tv.waitForFunction(() => window.dpTvQ.mode === 'pretty', null, { timeout: 15000 }).catch(() => {});
  s = await st();
  ok('телефон → ТВ: «Красиво»', s.mode === 'pretty' && s.lvl === 0, JSON.stringify({ m: s.mode, l: s.lvl }));
  ok('телефон: кнопка выбранного режима подсвечена', await ph2.evaluate(() => document.querySelector('[data-tvq="pretty"]').classList.contains('green')));
  // авто-откат: ступень 4 (2D) и обратно в 3D по выбору
  await tv.evaluate(() => window.dpTvQ.set('smooth')); await tv.waitForTimeout(600);
  await tv.evaluate(() => window.dpTvQ.step(4)); await tv.waitForTimeout(800); s = await st();
  ok('ступень 4 — 2D-картинка, одна сцена', !s.is3d && s.scenes === 1 && s.ents === 2, JSON.stringify({ d3: s.is3d, sc: s.scenes, e: s.ents }));
  await tv.evaluate(() => window.dpTvQ.step(2)); await tv.waitForTimeout(800); s = await st();
  ok('обратно в 3D — одна сцена, кадры идут', s.is3d && s.scenes === 1 && (await tv.evaluate(() => window.dpScene.frames)) > 0, JSON.stringify({ d3: s.is3d, sc: s.scenes }));
  ok('без ошибок на страницах', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  const bad = results.filter(x => !x).length; console.log(bad ? `\n${bad} провал(ов) из ${results.length}` : `\nВсе ${results.length} проверок пройдены`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
