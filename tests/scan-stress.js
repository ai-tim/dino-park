/* Динопарк — стресс-тест распознавания листа-раскраски.
 * Для каждого из 9 видов генерируем «фото» листа с перспективой, поворотом (0/90/180/270°),
 * тенью, цветным светом лампы, шумом, размытием, закрытой полоской кода и т. п. и проверяем,
 * что вид распознан. Отдельно: закрыта одна метка → «найдено 3 из 4 меток».
 * Использование: BASE=http://localhost:8000 node scan-stress.js
 */
const { chromium } = require('playwright-core');
const path = require('path'), fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8000';
const SHOTS = path.join(__dirname, 'screens'); fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/park.html?demo=1&tod=day'); await page.waitForTimeout(1500);
  const res = await page.evaluate(async () => {
    const rnd = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const pages = {};
    async function pageCanvas(id) {
      if (pages[id]) return pages[id];
      const svg = DP.Template.pageSVG(id, 'color', 'width="1188" height="840"');
      const img = await DP.util.loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
      const c = document.createElement('canvas'); c.width = 1188; c.height = 840; c.getContext('2d').drawImage(img, 0, 0);
      return (pages[id] = c);
    }
    /** «Фотографируем» лист: corners — куда попали углы листа на фото (по часовой от левого верхнего) */
    function shoot(src, corners, o) {
      const W = 1400, H = 1050, out = document.createElement('canvas'); out.width = W; out.height = H;
      const x = out.getContext('2d'), im = x.createImageData(W, H), d = im.data;
      const s = src.getContext('2d').getImageData(0, 0, src.width, src.height).data, SW = src.width, SH = src.height;
      const h = DP.Photo.homography(corners, [[0, 0], [SW, 0], [SW, SH], [0, SH]]);
      const table = o.table || [120, 112, 104];
      for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) {
        const p = DP.Photo._apply(h, X + 0.5, y + 0.5), sx = p[0] | 0, sy = p[1] | 0, k = (y * W + X) * 4;
        let r, g, b;
        if (sx >= 0 && sy >= 0 && sx < SW && sy < SH) { const i = (sy * SW + sx) * 4; r = s[i]; g = s[i + 1]; b = s[i + 2]; }
        else { r = table[0]; g = table[1]; b = table[2]; }
        // свет: градиент тени + оттенок лампы
        const sh = 1 - (o.shade || 0) * (X / W) * (0.6 + 0.4 * y / H);
        r *= sh * (o.cast ? o.cast[0] : 1); g *= sh * (o.cast ? o.cast[1] : 1); b *= sh * (o.cast ? o.cast[2] : 1);
        if (o.dim) { r *= o.dim; g *= o.dim; b *= o.dim; }
        if (o.noise) { const n = (rnd() - 0.5) * o.noise; r += n; g += n; b += n; }
        d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255;
      }
      x.putImageData(im, 0, 0);
      if (o.blur) { const t = document.createElement('canvas'); t.width = W; t.height = H; const tx = t.getContext('2d'); tx.filter = `blur(${o.blur}px)`; tx.drawImage(out, 0, 0); return t; }
      return out;
    }
    const rot = (pts, r) => pts.slice(r).concat(pts.slice(0, r));
    function quad(kind) {
      const base = { flat: [[170, 160], [1230, 140], [1250, 900], [150, 920]], persp: [[260, 180], [1140, 150], [1290, 930], [110, 880]],
        tilt: [[120, 260], [1180, 90], [1300, 850], [230, 1000]], portrait: [[420, 60], [1010, 90], [990, 1000], [400, 980]], small: [[430, 330], [970, 320], [980, 710], [420, 720]] };
      return base[kind];
    }
    const cases = [
      ['ровно', { q: 'flat', r: 0 }],
      ['перспектива', { q: 'persp', r: 0 }],
      ['поворот 90° (телефон вертикально)', { q: 'portrait', r: 1 }],
      ['вверх ногами', { q: 'persp', r: 2 }],
      ['поворот 270° (телефон вертикально)', { q: 'portrait', r: 3 }],
      ['тень + тёплая лампа', { q: 'persp', r: 0, shade: 0.45, cast: [1.05, 0.92, 0.7] }],
      ['тускло + шум', { q: 'flat', r: 0, dim: 0.55, noise: 40 }],
      ['размыто', { q: 'tilt', r: 0, blur: 2 }],
      ['мелко в кадре', { q: 'small', r: 0 }],
      ['закрыта полоска кода', { q: 'persp', r: 0, cover: 'strip' }],
      ['светлый стол', { q: 'flat', r: 2, table: [205, 200, 190] }]
    ];
    const out = [], samples = {};
    for (const sp of DP.Dinos.SPECIES) {
      const src = await pageCanvas(sp.id);
      for (const [name, o] of cases) {
        let s = src;
        if (o.cover === 'strip') { s = document.createElement('canvas'); s.width = src.width; s.height = src.height; const sx = s.getContext('2d'); sx.drawImage(src, 0, 0); sx.fillStyle = '#3b5bdb'; sx.fillRect(35 * 4 - 8, 185 * 4 - 8, 50 * 4, 5 * 4 + 16); }
        const ph = shoot(s, rot(quad(o.q), o.r), o);
        const t0 = performance.now(); let r, err = null;
        try { r = await DP.Photo.process(ph); } catch (e) { err = e; }
        out.push({ sp: sp.id, name, ok: !!r && r.species === sp.id, got: r ? r.species : null, method: r ? r.method : 'error', codes: r ? r.readCodes : null, ms: Math.round(performance.now() - t0) });
        if (sp.id === 'stegosaurus' && (name === 'тень + тёплая лампа' || name === 'вверх ногами')) samples[name] = { in: ph.toDataURL('image/jpeg', 0.75), out: r ? r.canvas.toDataURL('image/png') : null };
      }
    }
    // одна метка закрыта рукой → честная подсказка «найдено 3 из 4»
    const src = await pageCanvas('trex');
    const s = document.createElement('canvas'); s.width = src.width; s.height = src.height; const sx = s.getContext('2d'); sx.drawImage(src, 0, 0);
    sx.fillStyle = '#e0b48f'; sx.beginPath(); sx.ellipse(1108, 760, 90, 70, 0, 0, Math.PI * 2); sx.fill();
    let three; try { const r = await DP.Photo.process(shoot(s, quad('flat'), {})); three = { markers: r.markers, method: r.method }; } catch (e) { three = { markers: e.markers, method: 'error' }; }
    return { out, three, samples };
  });
  const pass = res.out.filter(r => r.ok).length, total = res.out.length;
  const byCase = {}; res.out.forEach(r => { (byCase[r.name] = byCase[r.name] || [0, 0])[1]++; if (r.ok) byCase[r.name][0]++; });
  Object.keys(byCase).forEach(k => console.log(`${byCase[k][0] === byCase[k][1] ? '✅' : '❌'} ${k}: ${byCase[k][0]}/${byCase[k][1]}`));
  res.out.filter(r => !r.ok).forEach(r => console.log('   ✗', r.sp, r.name, '→', r.got, r.method, 'метки:', r.codes));
  const avg = Math.round(res.out.reduce((a, r) => a + r.ms, 0) / total);
  console.log(`Распознано ${pass}/${total} (${(pass / total * 100).toFixed(1)}%), в среднем ${avg} мс на фото`);
  const threeOk = res.three.markers === 3;
  console.log(`${threeOk ? '✅' : '❌'} Закрыта одна метка → «найдено ${res.three.markers} из 4 меток» (${res.three.method})`);
  const save = (n, d) => d && fs.writeFileSync(path.join(SHOTS, n), Buffer.from(d.split(',')[1], 'base64'));
  Object.entries(res.samples).forEach(([k, v], i) => { save(`scan-stress-${i + 1}-in.jpg`, v.in); save(`scan-stress-${i + 1}-out.png`, v.out); });
  if (errors.length) console.log('JS errors:', errors);
  await browser.close();
  const okAll = pass / total >= 0.97 && threeOk && !errors.length;
  console.log(okAll ? '\nИтого: стресс-тест пройден' : '\nИтого: стресс-тест НЕ пройден');
  process.exit(okAll ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
