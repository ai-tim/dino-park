/* Динопарк — совместимость со старыми и «телевизионными» браузерами.
 *   Samsung Tizen 2.4–7.0 (WebKit → Chromium 47–94), LG webOS 3–6 (Chromium 38–79), Android TV / Google TV (Chrome, WebView),
 *   Xiaomi / TCL / Philips / Sony (Android TV), Hisense VIDAA, Fire TV Silk, Яндекс Браузер, Safari (WebKit), Firefox, старый Chromium.
 * Статика: js/boot.js и js/legacy/* — чистый ES5; скрипты ТВ-страницы — ES2017; остальные — ES2018 (vendor — ES2019);
 *          без API новее Chromium 63 на ТВ-странице; полифиллы; свежесть наследной сборки (tools/build-legacy.js); CSS ТВ-страницы.
 * В браузере (playwright-core + сайт BASE): матрица профилей × страниц (tv, parks, index, park?demo=1) — страница запускается
 *          (DPBOOT.ready), без ошибок JS и без экрана «не запустился»; на ТВ-странице — клавиатура и шифрование (в т.ч. JS-запасное);
 *          плюс «скрипт не выполнился» / «файл не загрузился» → понятный экран вместо пустого.
 * Использование: [BASE=http://127.0.0.1:8765] [QUICK=1] node compat.js   (acorn нужен для проверки синтаксиса)
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
let acorn = null; try { acorn = require('acorn'); } catch (e) { /* нет — пропуск */ }
const results = []; const ok = (n, c, i) => { results.push(!!c); console.log((c ? '✅' : '❌') + ' ' + n + (i ? ' — ' + i : '')); };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = ['tv', 'park', 'parks', 'index'];
const bootAttr = (page, a) => { const m = new RegExp('<script src="js/boot\\.js"[^>]*' + a + "='([^']+)'").exec(read(page + '.html')); return m ? JSON.parse(m[1]) : null; };
const modernOf = (p) => bootAttr(p, 'data-modern') || [];
const tvFiles = modernOf('tv');
const files = [...new Set(PAGES.flatMap(modernOf))];
const parse = (f, ver) => { try { acorn.parse(read(f), { ecmaVersion: ver, sourceType: 'script' }); return null; } catch (e) { return e.message; } };
if (acorn) {
  for (const f of files) { const ver = tvFiles.includes(f) ? 2017 : /vendor/.test(f) ? 2019 : 2018, err = parse(f, ver); ok(`${f}: синтаксис ES${ver}`, !err, err || ''); }
  { const err = parse('js/boot.js', 5); ok('js/boot.js: чистый ES5', !err, err || ''); }
  for (const f of fs.readdirSync(path.join(ROOT, 'js/legacy'))) { const err = parse('js/legacy/' + f, 5); ok(`js/legacy/${f}: чистый ES5`, !err, err || ''); }
} else console.log('⏭️ acorn не установлен — проверка синтаксиса пропущена');
// страницы запускаются через загрузчик; все файлы наследной сборки на месте и свежие
const hashOf = (fl) => crypto.createHash('sha256').update(fl.map(read).join('\n')).digest('hex').slice(0, 16);
const fresh = (f, src) => { try { return read(f).includes('src:' + hashOf(src)); } catch (e) { return false; } };
for (const p of PAGES) {
  const html = read(p + '.html'), leg = bootAttr(p, 'data-legacy') || [];
  ok(`${p}.html: запуск через js/boot.js (нет прямых <script src>)`, /<script src="js\/boot\.js"/.test(html) && !/<script src="(?!js\/boot\.js)/.test(html) && modernOf(p).length > 0);
  ok(`${p}.html: файлы наследной сборки существуют`, leg.length > 0 && leg.every(f => fs.existsSync(path.join(ROOT, f))), leg.join(', '));
  const m = modernOf(p).filter(f => !/three\.dino/.test(f)), i = m.indexOf('js/config.js'), g = i < 0 ? [m] : [m.slice(0, i), m.slice(i + 1)];
  g.forEach((grp, k) => ok(`js/legacy/${p}-${k + 1}.js свежая (иначе: node tools/build-legacy.js)`, fresh(`js/legacy/${p}-${k + 1}.js`, grp)));
}
ok('js/legacy/polyfills.js свежая', fresh('js/legacy/polyfills.js', ['tools/legacy-polyfills.js']));
ok('js/legacy/crypto.js свежая', fresh('js/legacy/crypto.js', ['tools/legacy-crypto.js']));
ok('css/legacy/style.css свежая', fresh('css/legacy/style.css', ['css/style.css']));
const lcss = read('css/legacy/style.css');
ok('css/legacy/style.css: без var(), inset:, с запасными значениями для flex-gap', !/var\(--/.test(lcss) && !/(^|[;{\s])inset\s*:/.test(lcss) && /html\.no-flexgap/.test(lcss));
// возможности, которых нет в Chromium 68–79 / старом Safari
const BAD = [[/\.replaceAll\(/, 'String.replaceAll'], [/\.at\(-?\d/, 'Array.at'], [/structuredClone\(/, 'structuredClone'], [/Object\.hasOwn\(/, 'Object.hasOwn'], [/\.flatMap\(/, 'flatMap (Chrome 69)'], [/AbortSignal\.timeout/, 'AbortSignal.timeout'], [/Promise\.any\(/, 'Promise.any'], [/queueMicrotask\(/, 'queueMicrotask (Chrome 71)']];
for (const f of files.filter(f => !/vendor/.test(f))) { const hits = BAD.filter(([re]) => re.test(read(f))).map(b => b[1]); ok(`${f}: без новых API`, !hits.length, hits.join(', ')); }
const TV_BAD = [[/Object\.fromEntries\(/, 'Object.fromEntries (Chrome 73)'], [/\.flat\(\)/, 'Array.flat (Chrome 69)'], [/\.matchAll\(/, 'matchAll (Chrome 73)'], [/\bglobalThis\b/, 'globalThis (Chrome 71)'], [/\.trimStart\(|\.trimEnd\(/, 'trimStart/End (Chrome 66)'], [/new ResizeObserver/, 'ResizeObserver (Chrome 64)'], [/Promise\.allSettled/, 'Promise.allSettled (Chrome 76)']];
for (const f of tvFiles.filter(f => !/vendor/.test(f))) { const hits = TV_BAD.filter(([re]) => re.test(read(f))).map(b => b[1]); ok(`${f}: без API новее Chromium 63 (Tizen 5)`, !hits.length, hits.join(', ')); }
const util = read('js/util.js');
ok('util.js: полифиллы padStart / padEnd / Promise.finally', /String\.prototype\.padStart\s*=/.test(util) && /String\.prototype\.padEnd\s*=/.test(util) && /Promise\.prototype\.finally\s*=/.test(util));
ok('tv.html: первый скрипт — util.js (полифиллы раньше остального)', tvFiles[0] === 'js/util.js');
const tvCss = read('tv.html').match(/<style>([\s\S]*?)<\/style>/)[1];
ok('tv.html: CSS без inset / gap (Chromium < 84)', !/(^|[;{\s])inset\s*:|(^|[;{\s])gap\s*:/.test(tvCss));
ok('js/boot.js: обработчик ошибок, сторож, экран «не запустился», журнал dp.errors', /W\.onerror/.test(read('js/boot.js')) && /сторож/.test(read('js/boot.js')) && /bootmsg/.test(read('js/boot.js')) && /dp\.errors/.test(read('js/boot.js')));

// ———————————————— матрица в браузере ————————————————
const UA = {
  tizen24: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1',
  tizen3: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 3.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/3.0 TV Safari/538.1',
  tizen5: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 TV Safari/537.36',
  tizen7: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36',
  webos3: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/38.0.2125.122 Safari/537.36 WebAppManager',
  webos5: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 WebAppManager',
  webos6: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager',
  androidtv: 'Mozilla/5.0 (Linux; Android 11; BRAVIA 4K VH2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  webview: 'Mozilla/5.0 (Linux; Android 9; MiTV-AXSO0; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.198 Mobile Safari/537.36',
  philips: 'Mozilla/5.0 (Linux; Android 9; Philips TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.105 Safari/537.36',
  vidaa: 'Mozilla/5.0 (Linux; VIDAA; Hisense) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.120 Safari/537.36 Hisense',
  silk: 'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233) AppleWebKit/537.36 (KHTML, like Gecko) Silk/98.3.32 like Chrome/98.0.4758.136 Safari/537.36',
  yandex: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 YaBrowser/24.4.0.0 Safari/537.36',
  tcl: 'Mozilla/5.0 (Linux; Android 11; Smart TV Build/RTT2.211108.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Safari/537.36 TCL'
};
// что убрать, чтобы движок был похож на старый: lvl 1 — Chromium 63 (Tizen 5), 2 — + нет CSS inset/clamp/flex-gap (Chromium < 84),
// legacy — принудительно ES5-сборка (Chromium 38–54, WebKit Tizen 2.4/3), nosubtle — нет WebCrypto (JS-запасное шифрование)
const PROFILES = [
  { id: 'Samsung Tizen 2.4 (WebKit, без WebCrypto)', ua: UA.tizen24, legacy: true, nosubtle: true, old: 2, tv: true },
  { id: 'Samsung Tizen 3.0 (Chromium 47)', ua: UA.tizen3, legacy: true, old: 2, tv: true },
  { id: 'Samsung Tizen 5.0 (Chromium 63)', ua: UA.tizen5, old: 2, tv: true },
  { id: 'Samsung Tizen 7.0 (Chromium 94)', ua: UA.tizen7, tv: true },
  { id: 'LG webOS 3 (Chromium 38)', ua: UA.webos3, legacy: true, old: 2, tv: true },
  { id: 'LG webOS 5 (Chromium 68)', ua: UA.webos5, old: 2, tv: true },
  { id: 'LG webOS 6 (Chromium 79)', ua: UA.webos6, old: 2, tv: true },
  { id: 'Sony / Google TV (Chrome 120)', ua: UA.androidtv, tv: true },
  { id: 'Xiaomi Mi TV WebView (Chrome 86)', ua: UA.webview, old: 1, tv: true },
  { id: 'TCL Android TV WebView', ua: UA.tcl, old: 1, tv: true },
  { id: 'Philips Android TV (Chrome 72)', ua: UA.philips, old: 2, tv: true },
  { id: 'Hisense VIDAA (Chromium 77)', ua: UA.vidaa, old: 2, tv: true },
  { id: 'Fire TV Silk', ua: UA.silk, tv: true },
  { id: 'Яндекс Браузер', ua: UA.yandex },
  { id: 'Safari (WebKit)', engine: 'webkit' },
  { id: 'Firefox', engine: 'firefox' }
];
function strip(o) {
  if (o.old >= 1) {
    delete String.prototype.padStart; delete String.prototype.padEnd; delete Promise.prototype.finally; delete Array.prototype.flat; delete Array.prototype.flatMap;
    delete Object.fromEntries; delete String.prototype.matchAll; delete String.prototype.replaceAll; delete window.queueMicrotask; delete window.structuredClone; delete window.ResizeObserver;
    const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t) { return t === 'webgl2' ? null : g.apply(this, arguments); };
  }
  if (o.old >= 2 && window.CSS && CSS.supports) { const s = CSS.supports.bind(CSS); CSS.supports = function (a, b) { const q = String(a) + ' ' + String(b || ''); return /inset|clamp|row-gap/.test(q) ? false : s.apply(null, arguments); }; }
  if (o.nosubtle && window.crypto) { try { Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true }); } catch (e) { /* */ } }
  window.DP_CONFIG = { RELAYS: [] };
}
async function runtime() {
  let pw; try { pw = require('playwright-core'); } catch (e) { console.log('⏭️ playwright-core не найден — проверка в браузере пропущена'); return; }
  const BASE = (process.env.BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
  const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const eng = {};
  const get = async (e) => { if (e in eng) return eng[e]; eng[e] = await (e === 'chromium' ? pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ARGS }) : pw[e].launch()).catch(() => null); return eng[e]; };
  const cr = await get('chromium'); if (!cr) { console.log('⏭️ Chrome не запустился — проверка в браузере пропущена'); return; }
  { const c = await cr.newContext(); const p = await c.newPage(); const r = await p.goto(BASE + '/tv.html').catch(() => null); await c.close(); if (!r || !r.ok()) { console.log('⏭️ сайт ' + BASE + ' не открылся — проверка в браузере пропущена'); return; } }
  const quick = !!process.env.QUICK;
  try {
    for (const P of PROFILES) {
      const b = await get(P.engine || 'chromium');
      if (!b) { console.log(`⏭️ ${P.id}: движок ${P.engine} не установлен (npx playwright-core install ${P.engine})`); continue; }
      const pages = quick ? ['tv'] : (P.legacy || P.old === 2 || P.engine || P.id === 'Яндекс Браузер') ? ['tv', 'parks', 'index', 'park'] : ['tv', 'parks'];
      for (const pg of pages) {
        const ctx = await b.newContext(Object.assign({ viewport: pg === 'tv' || P.tv ? { width: 1920, height: 1080 } : { width: 1280, height: 800 }, locale: 'ru-RU' }, P.ua ? { userAgent: P.ua } : {}));
        await ctx.addInitScript(strip, { old: P.old || 0, nosubtle: !!P.nosubtle });
        await ctx.addInitScript(() => { try { localStorage.setItem('dp_news_v3', '1'); localStorage.setItem('dp_onboarded', '1'); } catch (e) { /* */ } });
        const p = await ctx.newPage(); const errs = [];
        p.on('pageerror', e => errs.push(e.message));
        const q = (pg === 'park' ? '?demo=1' : '') + (P.legacy ? (pg === 'park' ? '&' : '?') + 'legacy=1' : '');
        await p.goto(BASE + '/' + pg + '.html' + q, { timeout: 45000 }).catch(e => errs.push('goto: ' + e.message));
        await p.waitForFunction(() => window.DPBOOT && (window.DPBOOT.ready || document.querySelector('#bootmsg')), null, { timeout: 30000 }).catch(() => {});
        await p.waitForTimeout(pg === 'tv' ? 800 : 1500);
        const r = await p.evaluate(async (isTv) => {
          const B = window.DPBOOT || {}, o = { mode: B.mode, ready: !!B.ready, boot: !!document.querySelector('#bootmsg'), logged: (B.errors || []).map(e => e.m + ' @' + e.w), css: (document.querySelector('link[href*="style.css"]') || {}).href || '' };
          if (isTv) { o.keys = document.querySelectorAll('#kp [data-k]').length; o.crypto = DP.relay ? await DP.relay.selfTest().then(() => 'ok' + (DP.relay.hub && window.DP_SUBTLE && !(window.crypto && window.crypto.subtle) ? ' (JS)' : ''), (e) => e.kind + ': ' + e.message) : 'нет relay'; }
          return o;
        }, pg === 'tv').catch(e => ({ err: e.message }));
        const want = P.legacy ? 'legacy' : 'modern';
        const good = r.ready && !r.boot && r.mode === want && !errs.length && !(r.logged || []).length && (pg !== 'tv' || (r.keys === 12 && /^ok/.test(r.crypto)));
        ok(`${P.id} · ${pg}.html: запускается`, good, `${r.mode || '?'}${/legacy/.test(r.css) ? ' +legacy.css' : ''}${pg === 'tv' ? ' · шифрование ' + r.crypto : ''}` + (good ? '' : ' · ' + JSON.stringify({ r, errs }).slice(0, 260)));
        await ctx.close();
      }
    }
    // скрипт не выполнился (синтаксис, которого не знает браузер ТВ) → понятное сообщение вместо пустого экрана
    const c3 = await cr.newContext({ viewport: { width: 1280, height: 720 } }); const p3 = await c3.newPage();
    await p3.route('**/js/tv.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'let { a } = ; // «новый синтаксис»' }));
    await p3.goto(BASE + '/tv.html'); await p3.waitForSelector('#bootmsg', { timeout: 10000 }).catch(() => {});
    const m3 = await p3.evaluate(() => { const d = document.querySelector('#bootmsg'); return d ? d.textContent : ''; });
    ok('скрипт не запустился → «Динопарк не запустился» + «Перезагрузить» (не пустой экран)', /не запустился/.test(m3) && /Перезагрузить/.test(m3), m3.slice(0, 90));
    await c3.close();
    const c4 = await cr.newContext({ viewport: { width: 1280, height: 720 } }); const p4 = await c4.newPage();
    await p4.route('**/js/relay.js', (r) => r.fulfill({ status: 503, body: '' }));
    await p4.goto(BASE + '/park.html?demo=1'); await p4.waitForSelector('#bootmsg', { timeout: 10000 }).catch(() => {});
    const m4 = await p4.evaluate(() => { const d = document.querySelector('#bootmsg'); return d ? d.textContent : ''; });
    ok('файл сайта не загрузился → «проверьте интернет»', /интернет/.test(m4), m4.slice(0, 90));
    await c4.close();
    // нет брокеров → на ТВ своя ошибка «нет связи», не «код не найден»
    const c5 = await cr.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: UA.tizen5 }); await c5.addInitScript(strip, { old: 1 });
    const p5 = await c5.newPage(); await p5.goto(BASE + '/tv.html'); await p5.waitForFunction(() => window.DPBOOT && DPBOOT.ready, null, { timeout: 20000 }).catch(() => {});
    for (const d of '12345') await p5.click(`#kp [data-k="${d}"]`);
    if (!(await p5.textContent('#err'))) await p5.click('#go').catch(() => {});
    await p5.waitForFunction(() => document.querySelector('#err').dataset.kind, null, { timeout: 30000 }).catch(() => {});
    const w = await p5.evaluate(() => ({ k: document.querySelector('#err').dataset.kind, t: document.querySelector('#err').textContent, retry: !!document.querySelector('#retry') }));
    ok('Tizen 5: нет связи с ретранслятором → своя ошибка и «Попробовать ещё раз»', w.k === 'net' && w.retry && !/не найден|истёк/.test(w.t), w.k + ' · ' + w.t.slice(0, 80));
    await c5.close();
  } finally { for (const b of Object.values(eng)) if (b) await b.close().catch(() => {}); }
}
runtime().catch(e => ok('проверка в браузере без исключений', false, e.message)).then(() => {
  const fails = results.filter(r => !r).length; console.log(`\nИтого: ${results.length - fails}/${results.length}`); process.exit(fails ? 1 : 0);
});
