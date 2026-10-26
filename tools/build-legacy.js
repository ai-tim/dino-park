/* Сборка наследной (ES5) версии страниц для очень старых телевизоров и браузеров:
 * Samsung Tizen 2.4–3.0, LG webOS 3 (Chromium 38), старые Android TV WebView, Fire TV Silk, VIDAA, старый Safari и т.п.
 * js/boot.js сам выбирает: современные js/*.js (ES2017, 3D) или js/legacy/<страница>-*.js (ES5, только 2D — без three.js).
 * Списки файлов берутся из атрибута data-modern у <script src="js/boot.js"> в каждой странице.
 * Также собираются: js/legacy/polyfills.js (core-js + regenerator + свои), js/legacy/crypto.js (WebCrypto на чистом JS),
 * css/legacy/style.css (CSS-переменные развёрнуты в значения, префиксы -webkit- для старых движков).
 *
 *   mkdir -p /tmp/bb && cd /tmp/bb && npm i @babel/core @babel/preset-env regenerator-runtime core-js-bundle terser \
 *        postcss postcss-custom-properties autoprefixer node-forge elliptic esbuild
 *   BABEL_DIR=/tmp/bb/node_modules node tools/build-legacy.js
 *
 * Перезапускать после КАЖДОГО изменения скриптов или css/style.css (tests/compat.js проверяет, что сборка свежая).
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const NM = process.env.BABEL_DIR || path.join(ROOT, 'node_modules');
const req = (m) => { const r = require(require.resolve(m, { paths: [NM] })); return r && r.default && typeof r !== 'function' ? r.default : r; };
const babel = req('@babel/core'), terser = req('terser');
const PAGES = ['tv', 'park', 'parks', 'index'];
const TARGETS = { chrome: '38', safari: '9', firefox: '45' };
const hashOf = (files) => crypto.createHash('sha256').update(files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')).digest('hex').slice(0, 16);
const modernOf = (page) => JSON.parse(/<script src="js\/boot\.js" data-modern='([^']+)'/.exec(fs.readFileSync(path.join(ROOT, page + '.html'), 'utf8'))[1]);
// группы страницы: до config.js и после (config.js грузится отдельно — сервер дописывает в него свои настройки)
function groups(page) {
  const m = modernOf(page).filter(f => !/three\.dino/.test(f)), i = m.indexOf('js/config.js');
  return i < 0 ? [m] : [m.slice(0, i), m.slice(i + 1)];
}
const es5 = (code, name) => babel.transformSync(code, { filename: name, babelrc: false, configFile: false, sourceType: 'script', compact: false,
  presets: [[path.join(NM, '@babel/preset-env'), { targets: TARGETS, modules: false, useBuiltIns: false }]] }).code;
async function bundle(files) {
  let out = '';
  for (const f of files) {
    // каждый файл отдельно: ошибка в одном (например, в 3D) не останавливает остальные — как с отдельными <script>
    out += '\ntry {\n' + es5(fs.readFileSync(path.join(ROOT, f), 'utf8'), f) + '\n} catch (e) { if (window.DPBOOT && DPBOOT.log) DPBOOT.log(e, ' + JSON.stringify('legacy:' + f) + '); }\n';
  }
  const min = await terser.minify(out, { ecma: 5, compress: { passes: 1 }, mangle: true, output: { comments: false } });
  return '/* Динопарк — наследная ES5-сборка (tools/build-legacy.js). НЕ ПРАВИТЬ ВРУЧНУЮ. src:' + hashOf(files) + ' */\n' + min.code + '\n';
}
async function polyfills() {
  const cj = fs.readFileSync(path.join(NM, 'core-js-bundle/minified.js'), 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '');
  const rg = (await terser.minify(fs.readFileSync(path.join(NM, 'regenerator-runtime/runtime.js'), 'utf8'), { ecma: 5 })).code;
  const pl = (await terser.minify(fs.readFileSync(path.join(__dirname, 'legacy-polyfills.js'), 'utf8'), { ecma: 5 })).code;
  return '/* Динопарк — полифиллы для наследной сборки: core-js (MIT), regenerator-runtime (MIT), tools/legacy-polyfills.js. src:' + hashOf(['tools/legacy-polyfills.js']) + ' */\n' + cj + '\n' + rg + '\n' + pl + '\n';
}
async function cryptoJs() {
  const esb = req('esbuild');
  const r = await esb.build({ entryPoints: [path.join(__dirname, 'legacy-crypto.js')], bundle: true, write: false, format: 'iife', platform: 'browser', external: ['crypto'], nodePaths: [NM], target: 'es2015', logLevel: 'silent' });
  const code = es5(r.outputFiles[0].text, 'crypto.js');
  const min = await terser.minify(code, { ecma: 5, mangle: true, output: { comments: false } });
  return '/* Динопарк — WebCrypto на чистом JS (node-forge, elliptic), tools/legacy-crypto.js. src:' + hashOf(['tools/legacy-crypto.js']) + ' */\n' + min.code + '\n';
}
// запасные значения для движков без inset (Chrome < 87), flex-gap (< 84), clamp/min/max (< 79), gap у grid (< 66)
function oldCss(postcss) {
  const split = (v) => { const out = []; let d = 0, cur = ''; for (const ch of v) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  const fnRe = /\b(clamp|min|max)\(/;
  const fallback = (v) => { // первое вхождение clamp/min/max — заменяем на «разумное» значение, повторяем
    for (let n = 0; n < 8; n++) {
      const m = fnRe.exec(v); if (!m) return v;
      let i = m.index + m[0].length, d = 1; while (i < v.length && d) { if (v[i] === '(') d++; if (v[i] === ')') d--; i++; }
      const args = split(v.slice(m.index + m[0].length, i - 1));
      const rel = args.find(a => /%|vw|vh/.test(a));
      const pick = m[1] === 'clamp' ? args[1] : m[1] === 'max' ? args.find(a => !/env\(/.test(a)) || args[0] : (rel || args[0]);
      v = v.slice(0, m.index) + (/[+\-*/]/.test(pick.replace(/^-/, '')) && !/^calc/.test(pick) ? 'calc(' + pick + ')' : pick) + v.slice(i);
    }
    return v;
  };
  return {
    postcssPlugin: 'dp-old-css',
    Once(root) {
      const extra = [];
      root.walkRules((rule) => {
        if (rule.parent && rule.parent.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
        let display = null; rule.walkDecls('display', (d) => { display = d.value; });
        rule.walkDecls((d) => {
          if (d.prop === 'inset') {
            const v = d.value.split(/\s+/), [t, r = t, b = t, l = r] = v;
            d.cloneBefore({ prop: 'top', value: t }); d.cloneBefore({ prop: 'right', value: r }); d.cloneBefore({ prop: 'bottom', value: b }); d.cloneBefore({ prop: 'left', value: l });
            d.remove(); return;
          }
          if ((fnRe.test(d.value) || /env\(/.test(d.value)) && !/^(-webkit-)?(transform|transition|filter)$/.test(d.prop)) {
            const m = /^min\(\s*(\d+px)\s*,\s*(\d+%)\s*\)$/.exec(d.value);
            if (d.prop === 'width' && m) { d.cloneBefore({ value: m[1] }); let has = false; rule.walkDecls('max-width', () => { has = true; }); if (!has) d.cloneBefore({ prop: 'max-width', value: m[2] }); }
            else {
              // env(safe-area-…, X) → X (нет env() — Chrome < 69)
              let v = d.value; for (let n = 0; n < 8 && /env\(/.test(v); n++) v = v.replace(/env\(\s*[\w-]+\s*(?:,\s*([^()]*?))?\s*\)/, (x, fb) => fb || '0px');
              v = fallback(v); if (v !== d.value) d.cloneBefore({ value: v });
            }
          }
          if (/^(row-|column-)?gap$/.test(d.prop)) {
            if (display && /grid/.test(display)) d.cloneBefore({ prop: 'grid-' + d.prop });
            else {
              const g = d.value.split(/\s+/), row = d.prop === 'column-gap' ? '0px' : g[0], col = d.prop === 'row-gap' ? '0px' : (g[1] || g[0]);
              const sel = rule.selectors.map(x => 'html.no-flexgap ' + x + ' > *').join(', ');
              extra.push(postcss.rule({ selector: sel }).append({ prop: 'margin', value: `calc(${row} / 2) calc(${col} / 2)` }));
            }
          }
        });
      });
      if (extra.length) { root.append(postcss.comment({ text: ' flex-gap для старых движков (html.no-flexgap ставит js/boot.js) ' })); extra.forEach(r => root.append(r)); }
    }
  };
}
async function css() {
  const postcss = req('postcss'), cp = req('postcss-custom-properties'), ap = req('autoprefixer');
  const src = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const r = await postcss([cp({ preserve: false }), oldCss(postcss), ap({ overrideBrowserslist: ['chrome 38', 'safari 9', 'firefox 45'], flexbox: 'no-2009' })]).process(src, { from: 'css/style.css', to: 'css/legacy/style.css' });
  return '/* Динопарк — CSS для старых браузеров (tools/build-legacy.js). НЕ ПРАВИТЬ ВРУЧНУЮ. src:' + hashOf(['css/style.css']) + ' */\n' + r.css.replace(/url\((['"]?)(?!data:|https?:|\/)/g, 'url($1../');
}
(async () => {
  const L = path.join(ROOT, 'js/legacy'); fs.mkdirSync(L, { recursive: true }); fs.mkdirSync(path.join(ROOT, 'css/legacy'), { recursive: true });
  const w = (f, s) => { fs.writeFileSync(path.join(ROOT, f), s); console.log(f, (s.length / 1024).toFixed(0) + ' КБ'); };
  w('js/legacy/polyfills.js', await polyfills());
  w('js/legacy/crypto.js', await cryptoJs());
  w('css/legacy/style.css', await css());
  for (const p of PAGES) { const g = groups(p); for (let i = 0; i < g.length; i++) w(`js/legacy/${p}-${i + 1}.js`, await bundle(g[i])); }
})().catch(e => { console.error(e); process.exit(1); });
