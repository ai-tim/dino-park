/* Динопарк — обработка фото раскраски.
 * 1) ищем 4 чёрных угловых маркера → гомография → выпрямляем лист;
 * 2) читаем код шаблона (вид динозавра) → вырезаем по маске контура шаблона;
 * 3) если маркеры не найдены — запасной путь: убираем светлый фон заливкой от краёв,
 *    берём самое большое пятно и обрезаем по его рамке.
 */
window.DP = window.DP || {};
(function () {
  const T = () => DP.Template;
  const PX_PER_MM = 4;

  function toCanvas(src, max) {
    const w0 = src.naturalWidth || src.videoWidth || src.width, h0 = src.naturalHeight || src.videoHeight || src.height;
    const k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c;
  }
  function lumArray(d, n) { const L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return L; }

  // ---------- Поиск маркеров ----------
  /** Поиск маркеров: пробуем несколько порогов (тень, вспышка, тусклый свет). Возвращает {pts, L, W, H, found} или {found} */
  const PASSES = [[0.62, 110], [0.5, 85], [0.72, 140], [0.8, 170]];
  function findMarkers(img) {
    const { width: W, height: H, data } = img, n = W * H, L = lumArray(data, n);
    // интегральное изображение для адаптивного порога
    const I = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += L[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
    const r = Math.max(8, Math.round(Math.max(W, H) / 12)), mean = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r);
      mean[y * W + x] = (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    }
    let found = 0;
    for (const [k, abs] of PASSES) {
      const res = findWith(L, mean, W, H, k, abs);
      if (res.pts) return Object.assign(res, { L, W, H, pass: k });
      found = Math.max(found, res.found);
    }
    return { pts: null, found: Math.min(4, found), L, W, H };
  }
  function findWith(L, mean, W, H, k, abs) {
    const n = W * H, dark = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const v = L[i]; dark[i] = (v < mean[i] * k && v < abs) ? 1 : 0; }
    // компоненты связности
    const lab = new Int32Array(n), comps = [], stack = new Int32Array(n);
    let id = 0;
    for (let i = 0; i < n; i++) {
      if (!dark[i] || lab[i]) continue;
      id++; let sp = 0; stack[sp++] = i; lab[i] = id;
      let area = 0, minx = W, miny = H, maxx = 0, maxy = 0;
      while (sp) {
        const p = stack[--sp], x = p % W, y = (p / W) | 0;
        area++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (x > 0 && dark[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < W - 1 && dark[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && dark[p - W] && !lab[p - W]) { lab[p - W] = id; stack[sp++] = p - W; }
        if (y < H - 1 && dark[p + W] && !lab[p + W]) { lab[p + W] = id; stack[sp++] = p + W; }
      }
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      // центр — по рамке (окошко с кодом внутри метки не сдвигает его)
      comps.push({ area, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, bw, bh, fill: area / (bw * bh), minx, miny, maxx, maxy });
    }
    const minA = n * 0.00025;
    const cand = comps.filter(c => c.area >= minA && c.bw / c.bh > 0.5 && c.bw / c.bh < 2 && c.fill > 0.5 &&
      c.minx > 0 && c.miny > 0 && c.maxx < W - 1 && c.maxy < H - 1).sort((a, b) => b.area - a.area).slice(0, 12);
    // «похожих на метку» — квадратных и сплошных; для подсказки «найдено N из 4»
    const sq = cand.filter(c => c.fill > 0.6 && c.bw / c.bh > 0.6 && c.bw / c.bh < 1.6 && c.area < n * 0.02);
    const big = sq.reduce((a, c) => Math.max(a, c.area), 0);
    // метка v2 — квадрат с окошком (заполнение < 0.93); клетки полоски кода сплошные и мельче
    const squareish = sq.filter(c => c.fill < 0.93 || c.area >= big * 0.33).length;
    if (cand.length < 4) return { pts: null, found: squareish };
    let best = null, bestScore = 0;
    for (let a = 0; a < cand.length; a++) for (let b = a + 1; b < cand.length; b++) for (let c = b + 1; c < cand.length; c++) for (let d = c + 1; d < cand.length; d++) {
      const set = [cand[a], cand[b], cand[c], cand[d]];
      const areas = set.map(s => s.area), mx = Math.max.apply(0, areas), mn = Math.min.apply(0, areas);
      if (mx / mn > 3) continue;
      const pts = orderCW(set.map(s => [s.cx, s.cy]));
      const qa = quadArea(pts); if (!convex(pts)) continue;
      // маркеры должны быть заметно меньше листа
      if (mx > qa * 0.03) continue;
      const score = qa * (mn / mx);
      if (score > bestScore) { bestScore = score; best = pts; }
    }
    if (!best || bestScore < n * 0.08) return { pts: null, found: squareish };
    return { pts: best, found: 4 };
  }
  function orderCW(pts) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
    const o = pts.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    // начинаем с точки с минимальной x+y (левый верхний)
    let s = 0; o.forEach((p, i) => { if (p[0] + p[1] < o[s][0] + o[s][1]) s = i; });
    return o.slice(s).concat(o.slice(0, s));
  }
  function quadArea(p) { let a = 0; for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return Math.abs(a) / 2; }
  function convex(p) { let sg = 0; for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4]; const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); const s = Math.sign(z); if (!sg) sg = s; else if (s !== sg) return false; } return true; }

  // ---------- Гомография (мм → пиксели фото) ----------
  function homography(src, dst) {
    // решаем 8x8: dst = H * src
    const A = [], B = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
    }
    for (let c = 0; c < 8; c++) {
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
      for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; B[r] -= f * B[c]; }
    }
    const h = B.map((b, i) => b / A[i][i]); h.push(1); return h;
  }
  function apply(h, x, y) { const w = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; }

  function sampleLum(L, W, H, x, y) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return 255; return L[y * W + x]; }
  function areaLum(h, L, W, H, mx, my, r) { let s = 0, n = 0; for (let dy = -r; dy <= r; dy += r / 2) for (let dx = -r; dx <= r; dx += r / 2) { const p = apply(h, mx + dx, my + dy); s += sampleLum(L, W, H, p[0], p[1]); n++; } return s / n; }

  function readCode(h, m) {
    const t = T();
    const white = t.BLANK.map(([x, y]) => areaLum(h, m.L, m.W, m.H, x, y, 1.5)).sort((a, b) => b - a)[1];
    const cells = [];
    for (let i = 0; i < t.CODE.n; i++) { const [x, y] = t.cellCenter(i); cells.push(areaLum(h, m.L, m.W, m.H, x, y, 1.1) < white * 0.5 ? 1 : 0); }
    return { index: t.decode(cells), cells, white };
  }

  /** Код вида внутри каждой из 4 меток. Возвращает массив индексов (-1 — не прочиталось) */
  function readMarkerCodes(h, m, white) {
    const t = T(), out = [];
    for (let k = 0; k < 4; k++) {
      const black = areaLum(h, m.L, m.W, m.H, t.MARK.centers[k][0] - 6, t.MARK.centers[k][1], 0.6); // рамка метки
      const thr = (black + white) / 2, g = [];
      for (let r = 0; r < 3; r++) { g.push([]); for (let c = 0; c < 3; c++) { const [x, y] = t.markerCell(k, r, c); g[r].push(areaLum(h, m.L, m.W, m.H, x, y, 0.6) < thr ? 1 : 0); } }
      out.push(t.markerDecode(g));
    }
    return out;
  }

  function warp(srcCanvas, h, area) {
    const sctx = srcCanvas.getContext('2d'), S = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height), sd = S.data, SW = S.width, SH = S.height;
    const ow = Math.round(area.w * PX_PER_MM), oh = Math.round(area.h * PX_PER_MM);
    const out = document.createElement('canvas'); out.width = ow; out.height = oh;
    const octx = out.getContext('2d'), O = octx.createImageData(ow, oh), od = O.data;
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      const p = apply(h, area.x + (x + 0.5) / PX_PER_MM, area.y + (y + 0.5) / PX_PER_MM);
      const fx = p[0] - 0.5, fy = p[1] - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const o = (y * ow + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= SW - 1 || y0 >= SH - 1) { od[o] = od[o + 1] = od[o + 2] = 255; od[o + 3] = 255; continue; }
      const i00 = (y0 * SW + x0) * 4, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) od[o + c] = (sd[i00 + c] * (1 - ax) + sd[i10 + c] * ax) * (1 - ay) + (sd[i01 + c] * (1 - ax) + sd[i11 + c] * ax) * ay;
      od[o + 3] = 255;
    }
    octx.putImageData(O, 0, 0); return out;
  }

  function whiteBalance(canvas, white) {
    const ctx = canvas.getContext('2d'), im = ctx.getImageData(0, 0, canvas.width, canvas.height), d = im.data;
    // оценка цвета бумаги: 90-й перцентиль яркости
    const lum = []; for (let i = 0; i < d.length; i += 4 * 7) lum.push([0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2], i]);
    lum.sort((a, b) => a[0] - b[0]);
    let r = 0, g = 0, b = 0, cnt = 0; for (let k = Math.floor(lum.length * 0.85); k < Math.floor(lum.length * 0.97); k++) { const i = lum[k][1]; r += d[i]; g += d[i + 1]; b += d[i + 2]; cnt++; }
    if (!cnt) return canvas;
    r /= cnt; g /= cnt; b /= cnt;
    const kr = 250 / Math.max(60, r), kg = 250 / Math.max(60, g), kb = 250 / Math.max(60, b);
    for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * kr); d[i + 1] = Math.min(255, d[i + 1] * kg); d[i + 2] = Math.min(255, d[i + 2] * kb); }
    ctx.putImageData(im, 0, 0); return canvas;
  }

  async function maskCut(warped, speciesId) {
    const W = warped.width, H = warped.height, n = W * H;
    const raster = async (mode) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 400 254">${DP.Dinos.inner(speciesId, mode, 0)}</svg>`;
      const img = await DP.util.loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
      const m = document.createElement('canvas'); m.width = W; m.height = H; const mc = m.getContext('2d'); mc.drawImage(img, 0, 0, W, H);
      const md = mc.getImageData(0, 0, W, H).data, a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = md[i * 4 + 3]; return a;
    };
    const A = await raster('mask'), F = await raster('fill');
    const ctx = warped.getContext('2d'), im = ctx.getImageData(0, 0, W, H), d = im.data;
    paperBalance(d, W, H, A);
    const alpha = trimLine(d, W, H, F);
    let minx = W, miny = H, maxx = 0, maxy = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, a = alpha[i];
      d[i * 4 + 3] = a;
      if (a > 20) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    }
    ctx.putImageData(im, 0, 0);
    return autoLevel(crop(warped, minx, miny, maxx, maxy, 4));
  }

  /** Баланс белого по бумаге: всё вне контура — чистый лист. Строим карту освещения
   *  (сетка 10×7, светлый перцентиль бумаги в каждой ячейке) и делим на неё — уходят тени и цветной оттенок лампы. */
  function paperBalance(d, W, H, A) {
    const GX = 10, GY = 7, cw = W / GX, ch = H / GY, grid = [];
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const s = [];
      for (let y = Math.floor(gy * ch); y < Math.min(H, (gy + 1) * ch); y += 2) for (let x = Math.floor(gx * cw); x < Math.min(W, (gx + 1) * cw); x += 2) {
        const i = y * W + x; if (A[i] > 0) continue;
        const o = i * 4; s.push([d[o] + d[o + 1] + d[o + 2], o]);
      }
      if (s.length < 12) { grid.push(null); continue; }
      s.sort((a, b) => a[0] - b[0]);
      let r = 0, g = 0, b = 0, k = 0;
      for (let j = Math.floor(s.length * 0.6); j < Math.floor(s.length * 0.95); j++) { const o = s[j][1]; r += d[o]; g += d[o + 1]; b += d[o + 2]; k++; }
      grid.push(k ? [r / k, g / k, b / k] : null);
    }
    // дыры (ячейки целиком внутри динозавра) заполняем средним соседей
    for (let pass = 0; pass < 12 && grid.some(v => !v); pass++) {
      const next = grid.slice();
      for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
        if (grid[gy * GX + gx]) continue;
        const nb = []; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { const x = gx + dx, y = gy + dy; if (x >= 0 && y >= 0 && x < GX && y < GY && grid[y * GX + x]) nb.push(grid[y * GX + x]); });
        if (nb.length) next[gy * GX + gx] = [0, 1, 2].map(c => nb.reduce((a, v) => a + v[c], 0) / nb.length);
      }
      for (let i = 0; i < grid.length; i++) grid[i] = next[i];
    }
    if (grid.some(v => !v)) return;
    for (let y = 0; y < H; y++) {
      const fy = Math.min(GY - 1.001, Math.max(0, y / ch - 0.5)), y0 = Math.floor(fy), ay = fy - y0, y1 = Math.min(GY - 1, y0 + 1);
      for (let x = 0; x < W; x++) {
        const fx = Math.min(GX - 1.001, Math.max(0, x / cw - 0.5)), x0 = Math.floor(fx), ax = fx - x0, x1 = Math.min(GX - 1, x0 + 1);
        const o = (y * W + x) * 4, g00 = grid[y0 * GX + x0], g10 = grid[y0 * GX + x1], g01 = grid[y1 * GX + x0], g11 = grid[y1 * GX + x1];
        for (let c = 0; c < 3; c++) {
          const p = (g00[c] * (1 - ax) + g10[c] * ax) * (1 - ay) + (g01[c] * (1 - ax) + g11[c] * ax) * ay;
          const v = d[o + c] * 248 / Math.max(50, p); d[o + c] = v > 255 ? 255 : v;
        }
      }
    }
  }

  /** Срезаем печатную линию контура и «пускаем» краску за неё: F — точный силуэт без обводки.
   *  Тёмные бесцветные пиксели у края силуэта (это напечатанная линия) и всё, что снаружи силуэта
   *  в пределах запаса, заливаем цветом соседей изнутри. Возвращает альфа-канал вырезки. */
  function trimLine(d, W, H, F) {
    const n = W * H, IN = Math.round(PX_PER_MM * 2.3), OUT = Math.round(PX_PER_MM * 1.5);
    const bfs = (seed, lim) => { // расстояние (4-связность) от пикселей seed, до lim
      const dist = new Uint8Array(n).fill(255), q = new Int32Array(n); let qh = 0, qt = 0;
      for (let i = 0; i < n; i++) if (seed(i)) { dist[i] = 0; q[qt++] = i; }
      while (qh < qt) { const p = q[qh++], x = p % W, dv = dist[p] + 1; if (dv > lim) continue;
        if (x > 0 && dist[p - 1] > dv) { dist[p - 1] = dv; q[qt++] = p - 1; } if (x < W - 1 && dist[p + 1] > dv) { dist[p + 1] = dv; q[qt++] = p + 1; }
        if (p >= W && dist[p - W] > dv) { dist[p - W] = dv; q[qt++] = p - W; } if (p < n - W && dist[p + W] > dv) { dist[p + W] = dv; q[qt++] = p + W; } }
      return dist;
    };
    const dIn = bfs(i => F[i] <= 127, IN), dOut = bfs(i => F[i] > 127, OUT + 1);
    const bad = new Uint8Array(n), alpha = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (F[i] > 127) {
        alpha[i] = 255;
        if (dIn[i] <= IN) { const o = i * 4, r = d[o], g = d[o + 1], b = d[o + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (0.299 * r + 0.587 * g + 0.114 * b < 150 && (mx - mn) < 90) bad[i] = 1; }
      } else if (dOut[i] <= OUT + 1) { bad[i] = 1; alpha[i] = dOut[i] <= OUT ? 255 : 120; }
    }
    // заливаем «плохие» пиксели цветом хороших соседей, слой за слоем
    for (let pass = 0; pass < IN + OUT + 4; pass++) {
      const fix = [];
      for (let i = 0; i < n; i++) {
        if (!bad[i]) continue; const x = i % W; let r = 0, g = 0, b = 0, k = 0;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
        for (const j of nb) { if (j < 0 || j >= n || bad[j] || !alpha[j]) continue; const o = j * 4; r += d[o]; g += d[o + 1]; b += d[o + 2]; k++; }
        if (k) fix.push([i, r / k, g / k, b / k]);
      }
      if (!fix.length) break;
      fix.forEach(([i, r, g, b]) => { const o = i * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; bad[i] = 0; });
    }
    return alpha;
  }

  /** Автоуровни: растягиваем яркость непрозрачных пикселей по 1-му и 99-му перцентилю */
  function autoLevel(c) {
    const ctx = c.getContext('2d'), im = ctx.getImageData(0, 0, c.width, c.height), d = im.data, h = new Uint32Array(256);
    let n = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; h[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++; n++; }
    if (n < 50) return c;
    let lo = 0, hi = 255, acc = 0; for (; lo < 255; lo++) { acc += h[lo]; if (acc > n * 0.01) break; }
    acc = 0; for (; hi > 0; hi--) { acc += h[hi]; if (acc > n * 0.01) break; }
    lo = Math.min(lo, 60); hi = Math.max(hi, 200); if (hi - lo < 40) return c;
    const k = 255 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; for (let ch = 0; ch < 3; ch++) { const v = (d[i + ch] - lo) * k; d[i + ch] = v < 0 ? 0 : v > 255 ? 255 : v; } }
    ctx.putImageData(im, 0, 0); return c;
  }

  function crop(c, minx, miny, maxx, maxy, pad) {
    minx = Math.max(0, minx - pad); miny = Math.max(0, miny - pad); maxx = Math.min(c.width - 1, maxx + pad); maxy = Math.min(c.height - 1, maxy + pad);
    const o = document.createElement('canvas'); o.width = Math.max(1, maxx - minx + 1); o.height = Math.max(1, maxy - miny + 1);
    o.getContext('2d').drawImage(c, minx, miny, o.width, o.height, 0, 0, o.width, o.height); return o;
  }

  // ---------- Запасной путь: светлый фон → прозрачный, самое большое пятно ----------
  function blobCut(canvas) {
    const W = canvas.width, H = canvas.height, n = W * H;
    const ctx = canvas.getContext('2d'), im = ctx.getImageData(0, 0, W, H), d = im.data;
    const L = lumArray(d, n);
    // порог Оцу по яркости
    const hist = new Array(256).fill(0); for (let i = 0; i < n; i++) hist[L[i] | 0]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, thr = 180;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = t; } }
    thr = Math.max(150, Math.min(225, thr + 10));
    const light = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0;
      light[i] = (L[i] > thr && sat < 0.22) ? 1 : 0;
    }
    // заливка фона от краёв
    const bg = new Uint8Array(n), st = new Int32Array(n); let sp = 0;
    const push = (p) => { if (light[p] && !bg[p]) { bg[p] = 1; st[sp++] = p; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (sp) { const p = st[--sp], x = p % W; if (x > 0) push(p - 1); if (x < W - 1) push(p + 1); if (p >= W) push(p - W); if (p < n - W) push(p + W); }
    // самое большое непрозрачное пятно (8-связность)
    const lab = new Int32Array(n); let id = 0, bestId = 0, bestA = 0; const boxes = {};
    for (let i = 0; i < n; i++) {
      if (bg[i] || lab[i]) continue;
      id++; sp = 0; st[sp++] = i; lab[i] = id; let a = 0, minx = W, miny = H, maxx = 0, maxy = 0;
      while (sp) {
        const p = st[--sp], x = p % W, y = (p / W) | 0; a++;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx; if (!bg[q] && !lab[q]) { lab[q] = id; st[sp++] = q; }
        }
      }
      boxes[id] = [minx, miny, maxx, maxy, a];
      if (a > bestA) { bestA = a; bestId = id; }
    }
    if (!bestId || bestA < n * 0.002) return null;
    const bb = boxes[bestId];
    // оставляем главное пятно и крупные пятна внутри его рамки
    const keep = {}; keep[bestId] = 1;
    Object.keys(boxes).forEach(k => { const b = boxes[k]; if (b[4] > bestA * 0.01 && b[0] >= bb[0] && b[2] <= bb[2] && b[1] >= bb[1] && b[3] <= bb[3]) keep[k] = 1; });
    for (let i = 0; i < n; i++) d[i * 4 + 3] = keep[lab[i]] ? 255 : 0;
    // мягкий край
    for (let i = 0; i < n; i++) { if (!d[i * 4 + 3]) continue; const x = i % W; if ((x > 0 && !d[(i - 1) * 4 + 3]) || (x < W - 1 && !d[(i + 1) * 4 + 3]) || (i >= W && !d[(i - W) * 4 + 3]) || (i < n - W && !d[(i + W) * 4 + 3])) d[i * 4 + 3] = 150; }
    ctx.putImageData(im, 0, 0);
    return { canvas: crop(canvas, bb[0], bb[1], bb[2], bb[3], 2), bbox: bb };
  }

  /** Главная функция: src — Image/Canvas/Video. Возвращает {canvas, species, method, markers, codes} */
  async function process(src) {
    const c = toCanvas(src, 1400);
    const im = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const m = findMarkers(im);
    if (m.pts) {
      const t = T(), dst = t.MARK.centers;
      // пробуем 4 поворота листа: голосуют полоска кода и коды в каждой из меток
      let chosen = null;
      for (let r = 0; r < 4; r++) {
        const pts = m.pts.slice(r).concat(m.pts.slice(0, r));
        const h = homography(dst, pts);
        const code = readCode(h, m), mk = readMarkerCodes(h, m, code.white);
        const votes = {};
        mk.forEach(i => { if (i >= 0 && i < DP.Dinos.SPECIES.length) votes[i] = (votes[i] || 0) + 1; });
        if (code.index >= 0 && code.index < DP.Dinos.SPECIES.length) votes[code.index] = (votes[code.index] || 0) + 1.5;
        let index = -1, score = 0; Object.keys(votes).forEach(k => { if (votes[k] > score) { score = votes[k]; index = +k; } });
        const cand = { h, index, r, score, codes: mk, strip: code.index };
        if (!chosen || score > chosen.score) chosen = cand;
        if (score >= 3) break;
      }
      const warped = warp(c, chosen.h, t.AREA);
      const markers = chosen.codes.filter(i => i >= 0).length;
      if (chosen.index >= 0) {
        const sp = DP.Dinos.SPECIES[chosen.index];
        const out = await maskCut(warped, sp.id);
        return { canvas: out, species: sp.id, method: 'markers', markers: 4, codes: chosen.codes, readCodes: markers };
      }
      const b = blobCut(autoLevel(whiteBalance(warped)));
      if (b) return { canvas: b.canvas, species: null, method: 'markers+blob', markers: 4, codes: chosen.codes, readCodes: markers };
    }
    const b = blobCut(whiteBalance(toCanvas(src, 900)));
    if (!b) { const e = new Error('Не удалось найти рисунок на фото'); e.markers = m.found || 0; throw e; }
    return { canvas: autoLevel(b.canvas), species: null, method: 'blob', markers: m.found || 0 };
  }

  /** Усиление насыщенности (0..1) — для ползунка «Яркие цвета» */
  function boost(src, amount, max, light) {
    light = light || 0;
    const k = Math.min(1, (max || 400) / Math.max(src.width, src.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
    const ctx = c.getContext('2d'); ctx.drawImage(src, 0, 0, c.width, c.height);
    if (amount <= 0 && !light) return c;
    const im = ctx.getImageData(0, 0, c.width, c.height), d = im.data, s = 1 + Math.max(0, amount) * 1.6, ct = 1 + Math.max(0, amount) * 0.25;
    const gam = Math.pow(2, -light * 1.6); // ☀️ яркость: гамма-кривая, белое остаётся белым
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2], l = 0.299 * r + 0.587 * g + 0.114 * b;
      for (let ch = 0; ch < 3; ch++) { let v = l + (d[i + ch] - l) * s; v = (v - 128) * ct + 128; v = v < 0 ? 0 : v > 255 ? 255 : v; if (light) v = 255 * Math.pow(v / 255, gam); d[i + ch] = v; }
    }
    ctx.putImageData(im, 0, 0); return c;
  }

  DP.Photo = { process, boost, findMarkers, homography, blobCut, autoLevel, readMarkerCodes, _apply: apply };
})();
