/* Динопарк — проверка совместимости со старыми браузерами телевизоров и Safari.
 *   LG webOS: Chromium 68–87; Samsung Tizen 4.0–7.0: Chromium 56–94 (Tizen 5.0 = Chrome 63).
 * Скрипты ТВ-страницы (tv.html, включая three.js) — синтаксис не новее ES2017 (без { ...spread } в объектах, catch{} и т.п.),
 * остальные страницы — ES2018 (vendor — ES2019). CSS ТВ-страницы — без inset и flex-gap.
 * Плюс проверка в браузере (если есть playwright-core и запущен сайт BASE): tv.html под UA Tizen с удалёнными
 * padStart / Promise.finally / flat / queueMicrotask / WebGL2 — без ошибок, WebCrypto работает, 3D не включается без WebGL2.
 * Использование: [BASE=http://127.0.0.1:8765] node compat.js   (нужен пакет acorn: npm i acorn — иначе синтаксис пропускается)
 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let acorn = null; try { acorn = require('acorn'); } catch (e) { /* нет — пропуск */ }
const results = []; const ok = (n, c, i) => { results.push(!!c); console.log((c ? '✅' : '❌') + ' ' + n + (i ? ' — ' + i : '')); };
const scripts = (html) => {
  const src = fs.readFileSync(path.join(ROOT, html), 'utf8'), m = /var MODERN = (\[[^\]]*\])/.exec(src); // tv.html: список в ES5-загрузчике
  return (m ? JSON.parse(m[1]) : [...src.matchAll(/<script src="([^"]+)"/g)].map(x => x[1])).filter(s => !/^https?:/.test(s));
};
const files = [...new Set(['tv.html', 'park.html', 'index.html', 'parks.html'].flatMap(scripts))];
const tvFiles = scripts('tv.html');
if (acorn) {
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8'), ver = tvFiles.includes(f) ? 2017 : /vendor/.test(f) ? 2019 : 2018;
    let err = null; try { acorn.parse(src, { ecmaVersion: ver, sourceType: 'script' }); } catch (e) { err = e.message; }
    ok(`${f}: синтаксис ES${ver}`, !err, err || '');
  }
} else console.log('⏭️ acorn не установлен — проверка синтаксиса пропущена');
// возможности, которых нет в Chromium 68–79 / старом Safari
const BAD = [[/\.replaceAll\(/, 'String.replaceAll'], [/\.at\(-?\d/, 'Array.at'], [/structuredClone\(/, 'structuredClone'], [/Object\.hasOwn\(/, 'Object.hasOwn'], [/\.flatMap\(/, 'flatMap (Chrome 69)'], [/AbortSignal\.timeout/, 'AbortSignal.timeout'], [/Promise\.any\(/, 'Promise.any'], [/queueMicrotask\(/, 'queueMicrotask (Chrome 71)']];
for (const f of files.filter(f => !/vendor/.test(f))) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8'); const hits = BAD.filter(([re]) => re.test(src)).map(b => b[1]);
  ok(`${f}: без новых API`, !hits.length, hits.join(', '));
}
// ES5-загрузчик tv.html и наследная сборка js/legacy (для Tizen 2.4–3.0, webOS 3, старых WebView)
const tvHtml = fs.readFileSync(path.join(ROOT, 'tv.html'), 'utf8');
if (acorn) {
  [...tvHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => { let err = null; try { acorn.parse(m[1], { ecmaVersion: 5 }); } catch (e) { err = e.message; } ok(`tv.html: встроенный скрипт ${i + 1} — чистый ES5`, !err, err || ''); });
  for (const f of ['js/legacy/tv-1.js', 'js/legacy/tv-2.js']) { let err = null; try { acorn.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'), { ecmaVersion: 5 }); } catch (e) { err = e.message; } ok(`${f}: чистый ES5`, !err, err || ''); }
}
ok('tv.html: есть обработчик ошибок и сторож запуска (не пустой экран)', /window\.onerror|W\.onerror/.test(tvHtml) && /сторож/.test(tvHtml) && /bootmsg/.test(tvHtml));
{
  const bl = fs.readFileSync(path.join(ROOT, 'tools/build-legacy.js'), 'utf8'), arr = (n) => JSON.parse(new RegExp('const ' + n + ' = (\\[[^\\]]*\\])').exec(bl)[1].replace(/'/g, '"'));
  const hash = (names) => require('crypto').createHash('sha256').update(names.map(n => fs.readFileSync(path.join(ROOT, 'js', n + '.js'), 'utf8')).join('\n')).digest('hex').slice(0, 16);
  const G1 = arr('G1'), G2 = arr('G2');
  ok('наследная сборка покрывает все скрипты ТВ (кроме three.js)', tvFiles.filter(f => !/vendor|config/.test(f)).map(f => f.replace(/^js\/|\.js$/g, '')).join() === G1.concat(G2).join());
  for (const [f, g] of [['tv-1.js', G1], ['tv-2.js', G2]]) ok(`js/legacy/${f} свежая (пересоберите: node tools/build-legacy.js)`, fs.readFileSync(path.join(ROOT, 'js/legacy', f), 'utf8').includes('src:' + hash(g)));
}
// ТВ-страница: ещё строже — то, чего нет в Chromium 56–63 (Tizen 4–5)
const TV_BAD = [[/Object\.fromEntries\(/, 'Object.fromEntries (Chrome 73)'], [/\.flat\(\)/, 'Array.flat (Chrome 69)'], [/\.matchAll\(/, 'matchAll (Chrome 73)'], [/\bglobalThis\b/, 'globalThis (Chrome 71)'], [/\.trimStart\(|\.trimEnd\(/, 'trimStart/End (Chrome 66)'], [/new ResizeObserver/, 'ResizeObserver (Chrome 64)'], [/Promise\.allSettled/, 'Promise.allSettled (Chrome 76)']];
for (const f of tvFiles.filter(f => !/vendor/.test(f))) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8'); const hits = TV_BAD.filter(([re]) => re.test(src)).map(b => b[1]);
  ok(`${f}: без API новее Chromium 63 (Tizen 5)`, !hits.length, hits.join(', '));
}
const util = fs.readFileSync(path.join(ROOT, 'js/util.js'), 'utf8');
ok('util.js: полифиллы padStart / padEnd / Promise.finally (Chrome < 57 / < 63)', /String\.prototype\.padStart\s*=/.test(util) && /String\.prototype\.padEnd\s*=/.test(util) && /Promise\.prototype\.finally\s*=/.test(util));
ok('tv.html: первый скрипт — util.js (полифиллы раньше остального)', tvFiles[0] === 'js/util.js');
const tvCss = fs.readFileSync(path.join(ROOT, 'tv.html'), 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
ok('tv.html: CSS без inset / gap (Chromium < 84)', !/(^|[;{\s])inset\s*:|(^|[;{\s])gap\s*:/.test(tvCss));

// проверка в «старом Tizen»-браузере
async function runtime() {
  let pw; try { pw = require('playwright-core'); } catch (e) { console.log('⏭️ playwright-core не найден — проверка в браузере пропущена'); return; }
  const BASE = (process.env.BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
  const b = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => null);
  if (!b) { console.log('⏭️ Chrome не запустился — проверка в браузере пропущена'); return; }
  try {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 TV Safari/537.36' });
    await ctx.addInitScript(() => {
      delete String.prototype.padStart; delete String.prototype.padEnd; delete Promise.prototype.finally; delete Array.prototype.flat; delete Array.prototype.flatMap;
      delete Object.fromEntries; delete String.prototype.matchAll; delete String.prototype.replaceAll; delete window.queueMicrotask; delete window.structuredClone; delete window.ResizeObserver;
      const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t) { return t === 'webgl2' ? null : g.apply(this, arguments); };
      window.DP_CONFIG = { RELAYS: [] };
    });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    const r = await p.goto(BASE + '/tv.html').catch(() => null);
    if (!r || !r.ok()) { console.log('⏭️ сайт ' + BASE + ' не открылся — проверка в браузере пропущена'); return; }
    await p.waitForTimeout(1500);
    ok('Tizen-подобный ТВ: tv.html без ошибок JS', !errs.length, errs.join(' | ').slice(0, 200));
    const info = await p.evaluate(async () => ({
      ui: !!document.querySelector('#code') && !!document.querySelector('#kp'),
      pad: '7'.padStart(3, '0'), fin: typeof Promise.prototype.finally,
      crypto: await DP.relay.selfTest().then(() => 'ok', (e) => e.kind + ': ' + e.message),
      can3D: DP.can3D ? DP.can3D() : null, boot: DPBOOT.mode + (document.querySelector('#bootmsg') ? ' +сообщение об ошибке' : '')
    }));
    ok('Tizen-подобный ТВ: экран ввода кода и пульт-клавиатура на месте, современная сборка', info.ui && info.boot === 'modern', info.boot);
    ok('Tizen-подобный ТВ: полифиллы padStart / finally работают', info.pad === '007' && info.fin === 'function');
    ok('Tizen-подобный ТВ: WebCrypto (ECDH, PBKDF2, AES-GCM) работает', info.crypto === 'ok', info.crypto);
    ok('Tizen-подобный ТВ: без WebGL2 3D не включается (будет 2D, а не ошибка three.js)', info.can3D === false);
    // нет брокеров → понятная ошибка «нет связи», не «код не найден»
    for (const d of '12345') await p.click(`#kp [data-k="${d}"]`);
    if (!(await p.textContent('#err'))) await p.click('#go').catch(() => {});
    await p.waitForFunction(() => document.querySelector('#err').dataset.kind, null, { timeout: 30000 }).catch(() => {});
    const w = await p.evaluate(() => ({ k: document.querySelector('#err').dataset.kind, t: document.querySelector('#err').textContent, retry: !!document.querySelector('#retry') }));
    ok('Tizen-подобный ТВ: нет связи с ретранслятором → своя ошибка и «Попробовать ещё раз»', w.k === 'net' && w.retry && !/не найден|истёк/.test(w.t), w.k + ' · ' + w.t.slice(0, 80));
    await ctx.close();
    // наследная ES5-сборка (как на Tizen 3 / webOS 3) — экран кода работает, шифрование есть
    const c2 = await b.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 3.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/3.0 TV Safari/538.1' });
    await c2.addInitScript(() => { window.DP_CONFIG = { RELAYS: [] }; });
    const p2 = await c2.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
    await p2.goto(BASE + '/tv.html?legacy=1'); await p2.waitForTimeout(2500);
    const l = await p2.evaluate(async () => ({ mode: DPBOOT.mode, ready: DPBOOT.ready, keys: document.querySelectorAll('#kp [data-k]').length, boot: !!document.querySelector('#bootmsg'), errs: DPBOOT.errors.map(e => e.m), crypto: await DP.relay.selfTest().then(() => 'ok', (e) => e.kind + ': ' + e.message), three: !!window.THREE }));
    ok('наследная ES5-сборка: экран ввода кода работает без ошибок', l.mode === 'legacy' && l.ready && l.keys === 12 && !l.boot && !e2.length && !l.errs.length, JSON.stringify(l).slice(0, 200));
    ok('наследная ES5-сборка: шифрование работает, three.js не грузится', l.crypto === 'ok' && !l.three, l.crypto);
    await c2.close();
    // скрипт не выполнился (как синтаксис, которого браузер ТВ не знает) → понятное сообщение вместо пустого экрана
    const c3 = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p3 = await c3.newPage();
    await p3.route('**/js/tv.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'let { a } = ; // «новый синтаксис», которого нет в браузере ТВ' }));
    await p3.goto(BASE + '/tv.html'); await p3.waitForSelector('#bootmsg', { timeout: 10000 }).catch(() => {});
    const m3 = await p3.evaluate(() => { const d = document.querySelector('#bootmsg'); return d ? d.textContent : ''; });
    ok('ТВ: скрипт не запустился → сообщение «не запустился» + «Перезагрузить» (не пустой экран)', /не запустился/.test(m3) && /Перезагрузить/.test(m3), m3.slice(0, 90));
    await c3.close();
    // файл сайта не загрузился → сообщение про интернет
    const c4 = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p4 = await c4.newPage();
    await p4.route('**/js/relay.js', (r) => r.fulfill({ status: 503, body: '' }));
    await p4.goto(BASE + '/tv.html'); await p4.waitForSelector('#bootmsg', { timeout: 10000 }).catch(() => {});
    const m4 = await p4.evaluate(() => { const d = document.querySelector('#bootmsg'); return d ? d.textContent : ''; });
    ok('ТВ: файл сайта не загрузился → сообщение «проверьте интернет»', /интернет/.test(m4), m4.slice(0, 90));
    await c4.close();
    // в нормальном запуске сообщения нет
  } finally { await b.close(); }
}
runtime().catch(e => ok('проверка в браузере без исключений', false, e.message)).then(() => {
  const fails = results.filter(r => !r).length; console.log(`\nИтого: ${results.length - fails}/${results.length}`); process.exit(fails ? 1 : 0);
});
