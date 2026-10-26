/* Динопарк — замер плавности экрана ТВ (tv.html) на «слабом телевизоре»: Chrome headless без видеокарты (WebGL = программный SwiftShader; флаг --use-angle=swiftshader не нужен — с ним вешается 2D-холст),
 * замедление процессора страницы (CDP, CPU=4..6) и, по желанию, весь браузер на одном ядре (запуск через `taskset -c 0`).
 * Использование: BASE=http://127.0.0.1:8765 CPU=6 SECS=30 Q="" node tools/tvperf.js
 *   Q — добавка к адресу tv.html (например "&q=mid&aa=0"), DINOS — сколько динозавров (10), KEEP=1 — не чистить dp.perf.
 * Печатает: кадры/с по секундам, медиану и 95-й процентиль интервала кадров, итоговый уровень качества и память GPU. */
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:8765', CPU = +(process.env.CPU || 6), SECS = +(process.env.SECS || 30), Q = process.env.Q || '', N = +(process.env.DINOS || 10);
const UA = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, userAgent: UA });
  await ctx.addInitScript(() => { window.DP_CONFIG = Object.assign(window.DP_CONFIG || {}, { RELAYS: [] }); });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000); await page.goto(BASE + '/parks.html', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#new-park', { state: 'visible' });
  await page.click('#new-park'); await page.fill('#np-name', 'Замер'); await page.click('#np-create'); await page.waitForSelector('.cred .v');
  await page.click('#cr-go'); await page.waitForURL(/park\.html/); await page.waitForFunction(() => window.dpPark && window.dpPark.park, null, { timeout: 30000 });
  await page.evaluate(() => DP.ui && DP.ui.close && DP.ui.close());
  await page.evaluate((n) => { const P = window.dpPark, L = DP.Dinos.SPECIES.filter(s => s.habitat === 'ground');
    for (let i = 0; i < n; i++) { const sp = L[i % L.length]; if (P.newDino) P.newDino({ species: sp.id, palette: i % 8, name: sp.name + ' ' + i, diet: sp.diet, habitat: sp.habitat, sprite: null }); else { P.screens.ready(); document.querySelector('[data-sp="' + sp.id + '"]').click(); } } }, N);
  await page.evaluate(() => window.dpPark.screens.tv()); await page.waitForSelector('.tv-code');
  const code = (await page.textContent('.tv-code')).trim(); await page.evaluate(() => DP.ui.close());
  // парк и код ТВ уже в localStorage — «телефон» закрываем: вторая вкладка делит с ТВ программный GPU, а headless Chrome
  // перестаёт давать кадры (requestAnimationFrame) вкладке ТВ, пока открыта другая
  await page.waitForTimeout(500); await page.close();
  const tv = await ctx.newPage(); const errs = []; tv.on('pageerror', e => errs.push(e.message));
  if (!process.env.KEEP) await tv.addInitScript(() => { try { localStorage.removeItem('dp.perf'); localStorage.removeItem('dp.tvq'); } catch (e) { /* */ } });
  await tv.addInitScript(() => { const iv = []; let last = 0; const f = (t) => { if (last) iv.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); window.__raf = iv; });
  if (process.env.CSS) await tv.addInitScript((css) => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }); }, process.env.CSS);
  if (process.env.NOBLUR) await tv.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'; document.head.appendChild(st); }); });
  const cdp = await ctx.newCDPSession(tv); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await tv.bringToFront();
  const t0 = Date.now();
  await tv.goto(BASE + '/tv.html?code=' + code + Q, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await tv.waitForFunction(() => window.dpScene && window.dpScene.frames > 0, null, { timeout: 120000 });
  const tStart = Date.now() - t0;
  if (process.env.PROFILE) { // где тратится время главного потока (самое «тяжёлое» по собственному времени)
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 2000 }); await cdp.send('Profiler.start');
    await tv.waitForTimeout(+process.env.PROFILE * 1000);
    const { profile } = await cdp.send('Profiler.stop'); const byId = {}, self = {};
    profile.nodes.forEach(n => { byId[n.id] = n; });
    const dts = profile.timeDeltas; let tot = 0;
    profile.samples.forEach((id, i) => { const n = byId[id], cf = n.callFrame, k = (cf.functionName || '(anon)') + ' ' + (cf.url || '').split('/').pop() + ':' + cf.lineNumber; self[k] = (self[k] || 0) + (dts[i] || 0); tot += dts[i] || 0; });
    console.log('PROFILE top (ms self of ' + Math.round(tot / 1000) + ')'); Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(String(Math.round(v / 1000)).padStart(6), k));
  }
  const series = []; let pf = await tv.evaluate(() => window.dpScene.frames), pt = Date.now();
  for (let s = 0; s < SECS; s++) {
    await tv.waitForTimeout(1000);
    const st = await tv.evaluate(() => { const s = window.dpScene; return { f: s.frames || 0, q: DP.Scene.PERF.quality, d3: !!s.is3d, rs: s._rs || 1, sh: s._sh || 0, aa: s._aa || '-', lvl: s.level || (window.dpTvQ && window.dpTvQ.level) || '' }; });
    const now = Date.now(), fps = (st.f - pf) * 1000 / (now - pt); pf = st.f; pt = now;
    series.push(Object.assign({ fps: +fps.toFixed(1) }, st));
  }
  if (process.env.SHOT) await tv.screenshot({ path: process.env.SHOT });
  if (process.env.EVAL) console.log('EVAL', JSON.stringify(await tv.evaluate(process.env.EVAL)));
  const res = await tv.evaluate(() => { const s = window.dpScene, iv = window.__raf.slice(-600).sort((a, b) => a - b); const g = s.gpuStats ? s.gpuStats() : null;
    return { dbg: { lf: s._lastFrame, now: performance.now(), last: s.last, dead2: s._dead, off: s._offscreen, hid: document.hidden, w: s.c.width, paused: s.paused, dead: s._dead, t: s.t, ents: s.ents.length }, programs: s.renderer && s.renderer.info.programs ? s.renderer.info.programs.length : null, rafMed: iv[Math.floor(iv.length / 2)], raf95: iv[Math.floor(iv.length * 0.95)], long: window.__raf.filter(x => x > 250).length, gpu: g && { calls: g.calls, tris: g.triangles, tex: g.textures, geo: g.geometries, size: g.size, totalMB: g.totalMB, aa: g.aa, shadow: g.shadow }, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0, scenes: DP.Scene.all.length, mode: window.DPBOOT && window.DPBOOT.mode }; });
  const avg = (a) => a.length ? +(a.reduce((x, y) => x + y.fps, 0) / a.length).toFixed(1) : 0;
  const first5 = series.slice(0, 5), rest = series.slice(Math.max(5, series.length - 10));
  console.log(JSON.stringify({ base: BASE, cpu: CPU, q: Q, startMs: tStart, fps0_5: avg(first5), fpsLast10: avg(rest), timeline: series.map(x => x.fps).join(' '), final: series[series.length - 1], res, errs: errs.slice(0, 3) }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
