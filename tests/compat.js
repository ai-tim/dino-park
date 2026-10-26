/* Динопарк — проверка совместимости со старыми браузерами телевизоров (LG webOS: Chromium 68–87) и Safari.
 * Синтаксис всех скриптов ТВ-страницы и парка — не новее ES2019 (без ?. ?? и полей классов), CSS ТВ-страницы — без inset и flex-gap.
 * Использование: node compat.js   (нужен пакет acorn: npm i acorn — иначе проверка синтаксиса пропускается)
 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let acorn = null; try { acorn = require('acorn'); } catch (e) { /* нет — пропуск */ }
const results = []; const ok = (n, c, i) => { results.push(!!c); console.log((c ? '✅' : '❌') + ' ' + n + (i ? ' — ' + i : '')); };
const scripts = (html) => [...fs.readFileSync(path.join(ROOT, html), 'utf8').matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
const files = [...new Set(['tv.html', 'park.html', 'index.html', 'parks.html'].flatMap(scripts))];
if (acorn) {
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8'), ver = /vendor/.test(f) ? 2019 : 2018;
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
const tvCss = fs.readFileSync(path.join(ROOT, 'tv.html'), 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
ok('tv.html: CSS без inset / gap (Chromium < 84)', !/(^|[;{\s])inset\s*:|(^|[;{\s])gap\s*:/.test(tvCss));
const fails = results.filter(r => !r).length; console.log(`\nИтого: ${results.length - fails}/${results.length}`); process.exit(fails ? 1 : 0);
