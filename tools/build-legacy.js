/* Сборка «наследной» (ES5) версии ТВ-страницы для очень старых телевизоров и браузеров:
 * Samsung Tizen 2.4–3.0 (WebKit / Chromium 47), LG webOS 3 (Chromium 38), старые Android TV WebView, Fire TV Silk и т.п.
 * Загрузчик в tv.html сам выбирает: современные файлы js/*.js (ES2017) или js/legacy/tv-1.js + js/config.js + js/legacy/tv-2.js.
 * three.js в наследную сборку не входит: в таких браузерах нет WebGL2, парк рисуется в 2D.
 *
 *   mkdir -p /tmp/bb && cd /tmp/bb && npm i @babel/core @babel/preset-env regenerator-runtime core-js-bundle terser
 *   BABEL_DIR=/tmp/bb/node_modules node tools/build-legacy.js
 *
 * Перезапускать после КАЖДОГО изменения скриптов ТВ-страницы (tests/compat.js проверяет, что сборка свежая).
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const NM = process.env.BABEL_DIR || path.join(ROOT, 'node_modules');
const req = (m) => require(path.join(NM, m));
const babel = req('@babel/core'), terser = req('terser');
const G1 = ['util', 'music', 'store', 'needs', 'voices', 'dinos', 'backgrounds', 'scene', 'life', 'creatures', 'dino3d', 'nature3d', 'things3d', 'scene3d'];
const G2 = ['relay', 'sync', 'tv'];
const POLY = fs.readFileSync(path.join(__dirname, 'legacy-polyfills.js'), 'utf8');
const hashOf = (names) => crypto.createHash('sha256').update(names.map(n => fs.readFileSync(path.join(ROOT, 'js', n + '.js'), 'utf8')).join('\n')).digest('hex').slice(0, 16);
async function build(names, withPoly) {
  let out = '';
  for (const n of names) {
    const src = fs.readFileSync(path.join(ROOT, 'js', n + '.js'), 'utf8');
    const r = babel.transformSync(src, { filename: n + '.js', babelrc: false, configFile: false, sourceType: 'script', compact: false,
      presets: [[path.join(NM, '@babel/preset-env'), { targets: { chrome: '38', safari: '9' }, modules: false, useBuiltIns: false }]] });
    // каждый файл — отдельно: ошибка в одном (например, в 3D) не останавливает остальные, как и с отдельными <script>
    out += '\ntry {\n' + r.code + '\n} catch (e) { if (window.DPBOOT && DPBOOT.log) DPBOOT.log(e, ' + JSON.stringify('legacy/' + n + '.js') + '); }\n';
  }
  const min = await terser.minify(out, { ecma: 5, compress: { passes: 1 }, mangle: true, output: { comments: false } });
  if (min.error) throw min.error;
  let head = '/* Динопарк — наследная ES5-сборка ТВ-страницы (tools/build-legacy.js). НЕ ПРАВИТЬ ВРУЧНУЮ. src:' + hashOf(names) + ' */\n';
  if (withPoly) {
    const cj = fs.readFileSync(path.join(NM, 'core-js-bundle/minified.js'), 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '');
    const rg = (await terser.minify(fs.readFileSync(path.join(NM, 'regenerator-runtime/runtime.js'), 'utf8'), { ecma: 5 })).code;
    const pl = (await terser.minify(POLY, { ecma: 5 })).code;
    head += cj + '\n' + rg + '\n' + pl + '\n';
  }
  return head + min.code + '\n';
}
(async () => {
  fs.mkdirSync(path.join(ROOT, 'js/legacy'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'js/legacy/tv-1.js'), await build(G1, true));
  fs.writeFileSync(path.join(ROOT, 'js/legacy/tv-2.js'), await build(G2, false));
  for (const f of ['tv-1.js', 'tv-2.js']) console.log(f, (fs.statSync(path.join(ROOT, 'js/legacy', f)).size / 1024).toFixed(0) + ' КБ');
})().catch(e => { console.error(e); process.exit(1); });
