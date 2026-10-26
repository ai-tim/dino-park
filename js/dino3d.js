/* Динопарк — объёмные 3D-динозавры.
 * Каждая часть бумажной марионетки (тело, голова, хвост, лапы) «надувается» по карте расстояний до контура:
 * получается мягкая округлая форма, как у плюшевой игрушки из папье-маше. Раскраска — та же бумажная (SVG части
 * растеризуется в атлас), а рисунок ребёнка натягивается на оба бока. Геометрия считается один раз на вид. */
window.DP = window.DP || {};
(function () {
  const TAU = Math.PI * 2;
  const T = () => window.THREE;
  const Din = () => DP.Dinos;
  const mobile = () => !!(DP.Scene && DP.Scene.PERF && DP.Scene.PERF.mobile);
  const QL = () => (DP.Scene && DP.Scene.PERF && DP.Scene.PERF.quality) || (mobile() ? 'low' : 'high');
  // детализация: телефоны — как раньше (память iPhone), ТВ — средняя, компьютер — мелкая сетка, больше сглаживания, чешуя
  const Q = () => { const q = QL(); return q === 'low' ? { res: 1.15, step: 2.8, tex: 512, sprite: 512, smooth: 3, scales: true } : q === 'mid' ? { res: 1.35, step: 2.2, tex: 1024, sprite: 1024, smooth: 4, scales: true } : { res: 1.6, step: 1.7, tex: 1024, sprite: 1024, smooth: 5, scales: true }; };
  const SCALE = 4.2 / 428; // единиц сцены на единицу рисунка (ширина рисунка = 4.2 при size=1)
  const ORIGIN = { x: 200, y: 248 }; // точка между лап на земле
  // толщина: доля «круглого» сечения по видам и частям
  const THICK = { trex: 0.8, triceratops: 1, stegosaurus: 0.9, brachiosaurus: 0.85, pterodactyl: 0.62, plesiosaur: 0.85, ankylosaurus: 1.08, parasaurolophus: 0.8, velociraptor: 0.72 };
  const ROLE_K = { body: 1, tail: 0.88, head: 0.86, neck: 0.84, leg: 0.74, arm: 0.66, wing: 0.1, flip: 0.32, none: 0.7 };
  const ROLE_CAP = { wing: 2.4, flip: 5 };
  const ACC = { stegosaurus: { k: 0.2, cap: 2.4, z: 3.5 }, triceratops: { k: 0.3, cap: 4 }, pterodactyl: { k: 0.3, cap: 3 }, velociraptor: { k: 0.3, cap: 2.6 }, parasaurolophus: { k: 0.55, cap: 7 }, ankylosaurus: { k: 0.9, cap: 40 } };

  // ——— очередь тяжёлых задач: по одной, с паузой (главный поток не замирает) ———
  let queue = Promise.resolve();
  const pause = () => new Promise(r => setTimeout(r, 0));
  function enqueue(fn) { const job = queue.then(fn); queue = job.then(pause, pause); return job; }

  // ——— карта расстояний (Felzenszwalb–Huttenlocher) ———
  function dt1(f, n, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
  }
  function dt2(feat, w, h) {
    const g = new Float64Array(w * h), m = Math.max(w, h), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
    for (let i = 0; i < w * h; i++) g[i] = feat[i] ? 0 : 1e20;
    for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; dt1(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; dt1(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = d[x]; }
    return g;
  }
  function signedDist(mask, w, h) {
    const n = w * h, inv = new Uint8Array(n); for (let i = 0; i < n; i++) inv[i] = mask[i] ? 0 : 1;
    const dOut = dt2(inv, w, h), dIn = dt2(mask, w, h), sd = new Float32Array(n);
    for (let i = 0; i < n; i++) sd[i] = mask[i] ? Math.sqrt(dOut[i]) - 0.5 : -(Math.sqrt(dIn[i]) - 0.5);
    return sd;
  }

  /** Надуть маску (кроп в пикселях; пиксель i покрывает рисунок [ox + i/res, …)) в двустороннюю оболочку.
   *  Возвращает вершины в координатах рисунка (x, y, z) и треугольники; o: {step, k, cap, z, rad} */
  function inflate(mask, mw, mh, ox, oy, res, o) {
    const sd = signedDist(mask, mw, mh);
    const S = (x, y) => {
      const fx = (x - ox) * res - 0.5, fy = (y - oy) * res - 0.5;
      if (fx < 0 || fy < 0 || fx > mw - 1.001 || fy > mh - 1.001) return -50;
      const i = Math.floor(fx), j = Math.floor(fy), ax = fx - i, ay = fy - j, b = j * mw + i;
      return ((sd[b] * (1 - ax) + sd[b + 1] * ax) * (1 - ay) + (sd[b + mw] * (1 - ax) + sd[b + mw + 1] * ax) * ay) / res;
    };
    const g = o.step, W = mw / res, H = mh / res, nx = Math.ceil(W / g) + 1, ny = Math.ceil(H / g) + 1, N = nx * ny;
    const s0 = new Float32Array(N), X = new Float32Array(N), Y = new Float32Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = j * nx + i, x = ox + i * g, y = oy + j * g; X[q] = x; Y[q] = y; s0[q] = S(x, y); }
    // местная «толщина» — максимум расстояния поблизости (сечение круглое, а не клином)
    const r = Math.max(2, Math.round((o.rad || 22) / g)), tmp = new Float32Array(N), R = new Float32Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let m = -99; for (let k = Math.max(0, i - r); k <= Math.min(nx - 1, i + r); k++) m = Math.max(m, s0[j * nx + k]); tmp[j * nx + i] = m; }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let m = -99; for (let k = Math.max(0, j - r); k <= Math.min(ny - 1, j + r); k++) m = Math.max(m, tmp[k * nx + i]); R[j * nx + i] = m; }
    const thrIn = 0.35 * g, thrOut = -1.1 * g, type = new Uint8Array(N), Hh = new Float32Array(N);
    for (let q = 0; q < N; q++) {
      const s = s0[q];
      type[q] = s >= thrIn ? 2 : s > thrOut ? 1 : 0;
      if (type[q] === 2) { const Rl = Math.max(R[q], s); Hh[q] = Math.min(o.cap || 1e9, o.k * Math.sqrt(Math.max(0, s * (2 * Rl - s)))); }
    }
    for (let pass = 0; pass < (o.smooth || 2); pass++) { // сглаживание высоты
      const h2 = Hh.slice();
      for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const q = j * nx + i; if (type[q] !== 2) continue;
        let a = 0, c = 0; [q - 1, q + 1, q - nx, q + nx].forEach(t => { if (type[t] === 2) { a += Hh[t]; c++; } else { c += 0.5; } });
        h2[q] = Hh[q] * 0.5 + (c ? a / c : Hh[q]) * 0.5;
      }
      Hh.set(h2);
    }
    // вершины: внутренние — пара (перед/зад), краевые — одна общая, прижатая к контуру
    const pos = [], vb = [], fi = new Int32Array(N).fill(-1), bi = new Int32Array(N).fill(-1), z0 = o.z || 0, e = 0.7 / res;
    for (let q = 0; q < N; q++) {
      if (!type[q]) continue;
      let x = X[q], y = Y[q];
      if (type[q] === 1) {
        for (let it = 0; it < 3; it++) { const s = S(x, y), gx = (S(x + e, y) - S(x - e, y)) / (2 * e), gy = (S(x, y + e) - S(x, y - e)) / (2 * e), gl = Math.hypot(gx, gy) || 1; x -= gx / gl * s; y -= gy / gl * s; }
        fi[q] = bi[q] = pos.length / 3; pos.push(x, y, z0); vb.push(x, y);
      } else {
        fi[q] = pos.length / 3; pos.push(x, y, z0 + Hh[q]); vb.push(x, y);
        bi[q] = pos.length / 3; pos.push(x, y, z0 - Hh[q]); vb.push(x, y);
      }
    }
    const idx = [], maxE = 2.7 * g, P = pos;
    const len = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1]);
    const tri = (a, b, c) => {
      if (!type[a] || !type[b] || !type[c]) return;
      const fa = fi[a], fb = fi[b], fc = fi[c];
      if (len(fa, fb) > maxE || len(fb, fc) > maxE || len(fa, fc) > maxE) return;
      if (type[a] === 1 && type[b] === 1 && type[c] === 1) { // тонкое место (рог, коготь): плоский двусторонний лоскут
        const cx = (P[fa * 3] + P[fb * 3] + P[fc * 3]) / 3, cy = (P[fa * 3 + 1] + P[fb * 3 + 1] + P[fc * 3 + 1]) / 3;
        if (S(cx, cy) < 0.15) return;
      }
      idx.push(fa, fc, fb); idx.push(bi[a], bi[b], bi[c]);
    };
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, d = a + nx, c = d + 1;
      if (s0[a] + s0[c] >= s0[b] + s0[d]) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
    }
    const hAt = (x, y) => { // высота над средней плоскостью в точке рисунка
      const fx = (x - ox) / g, fy = (y - oy) / g; if (fx < 0 || fy < 0 || fx > nx - 1.001 || fy > ny - 1.001) return 0;
      const i = Math.floor(fx), j = Math.floor(fy), ax = fx - i, ay = fy - j, q = j * nx + i;
      return (Hh[q] * (1 - ax) + Hh[q + 1] * ax) * (1 - ay) + (Hh[q + nx] * (1 - ax) + Hh[q + nx + 1] * ax) * ay;
    };
    const top = (x) => { // верхний край силуэта в столбце x
      for (let y = oy; y < oy + H; y += 0.5) if (S(x, y) > 0) return y;
      return null;
    };
    return { pos, vb, idx, hAt, top, maxH: Hh.reduce((a, b) => Math.max(a, b), 0) };
  }

  // ——— маски частей ———
  let scratch = null;
  function maskCanvas(w, h) {
    if (!scratch) scratch = document.createElement('canvas');
    if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
    const x = scratch.getContext('2d', { willReadFrequently: true }); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h);
    return x;
  }
  /** Растеризовать набор контуров в маску; возвращает кроп {mask, w, h, ox, oy} в координатах рисунка или null */
  function rasterShapes(paths, res, margin) {
    if (!paths.length) return null;
    const VB = Din().VB, W = Math.ceil(VB.w * res), H = Math.ceil(VB.h * res), x = maskCanvas(W, H);
    x.setTransform(res, 0, 0, res, -VB.x * res, -VB.y * res); x.fillStyle = '#fff';
    paths.forEach(d => { try { x.fill(new Path2D(d)); } catch (e) { /* ignore */ } });
    const data = x.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (data[(j * W + i) * 4 + 3] > 127) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    if (x1 < 0) return null;
    return cropMask(data, W, H, x0, y0, x1, y1, margin, (i) => data[i * 4 + 3] > 127, VB.x, VB.y, res);
  }
  function cropMask(data, W, H, x0, y0, x1, y1, margin, test, bx, by, res) {
    const cx0 = x0 - margin, cy0 = y0 - margin, w = x1 - x0 + 1 + margin * 2, h = y1 - y0 + 1 + margin * 2, m = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) { const sy = cy0 + j; if (sy < 0 || sy >= H) continue; for (let i = 0; i < w; i++) { const sx = cx0 + i; if (sx >= 0 && sx < W && test(sy * W + sx)) m[j * w + i] = 1; } }
    return { mask: m, w, h, ox: bx + cx0 / res, oy: by + cy0 / res, bbox: [bx + x0 / res, by + y0 / res, bx + (x1 + 1) / res, by + (y1 + 1) / res] };
  }

  // ——— геометрия вида (один раз на вид) ———
  const shapeCache = {};
  function speciesShape(id) {
    if (shapeCache[id]) return shapeCache[id];
    const q = Q(), art = Din().ART[id], th = THICK[id] || 0.85, acc = ACC[id] || { k: 0.5, cap: 6 };
    const margin = Math.ceil((q.step * 2 + 2) * q.res);
    const parts = art.map((p, i) => {
      const far = (p.role === 'leg' || p.role === 'arm' || p.role === 'wing' || p.role === 'flip') && p.s[0][0] === 'F';
      const layers = [];
      const core = p.s.filter(s => s[0] === 'B' || s[0] === 'F' || s[0] === 'L').map(s => s[1]);
      const A = p.s.filter(s => s[0] === 'A').map(s => s[1]), Dd = p.s.filter(s => s[0] === 'D').map(s => s[1]), Hh = p.s.filter(s => s[0] === 'H').map(s => s[1]);
      const k = (ROLE_K[p.role] || 0.7) * th, cap = ROLE_CAP[p.role];
      if (core.length) layers.push({ kind: 'core', paths: core, o: { step: q.step, k, cap, z: 0, rad: p.role === 'body' ? 30 : 18, smooth: q.smooth } });
      if (A.length) layers.push({ kind: 'A', paths: A, o: { step: q.step * 0.8, k: acc.k, cap: acc.cap, z: acc.z || 0, rad: 10 } });
      if (Dd.length) layers.push({ kind: 'D', paths: Dd, o: { step: q.step * 0.8, k: acc.k, cap: acc.cap, z: -(acc.z || 3), rad: 10 } });
      if (Hh.length) layers.push({ kind: 'H', paths: Hh, o: { step: q.step * (q.smooth > 2 ? 0.45 : 0.6), k: 0.75, cap: 9, z: 0, rad: 6 } }); // рога, когти, зубы
      const eyes = p.s.filter(s => s[0] === 'E').map(s => ({ x: s[1], y: s[2], r: s[3] }));
      return { i, n: p.n, role: p.role, pivot: p.pivot, amp: p.amp == null ? 1 : p.amp, off: p.off || 0, far, layers, eyes, all: p.s.filter(s => Din().OUTLINE_TYPES[s[0]]).map(s => s[1]) };
    });
    shapeCache[id] = { id, parts, built: null };
    return shapeCache[id];
  }
  /** Построить надутые оболочки всех частей вида (тяжело — только через очередь) */
  function buildShape(id) {
    const sh = speciesShape(id); if (sh.built) return sh;
    const q = Q(), margin = Math.ceil((q.step * 2 + 2) * q.res);
    let sil = null; const grow = (b) => { if (!b) return; sil = sil ? [Math.min(sil[0], b[0]), Math.min(sil[1], b[1]), Math.max(sil[2], b[2]), Math.max(sil[3], b[3])] : b.slice(); };
    sh.parts.forEach(p => {
      p.chunks = []; p.bbox = null;
      p.layers.forEach(L => {
        const m = rasterShapes(L.paths, q.res, margin); if (!m) return;
        const r = inflate(m.mask, m.w, m.h, m.ox, m.oy, q.res, L.o);
        if (L.kind === 'core') { p.hAt = r.hAt; p.top = r.top; p.maxH = r.maxH; }
        p.chunks.push(r); grow(m.bbox);
        p.bbox = p.bbox ? [Math.min(p.bbox[0], m.bbox[0]), Math.min(p.bbox[1], m.bbox[1]), Math.max(p.bbox[2], m.bbox[2]), Math.max(p.bbox[3], m.bbox[3])] : m.bbox.slice();
      });
    });
    const body = sh.parts.find(p => p.role === 'body') || sh.parts[0];
    const bodyH = (x, y) => { const h = body.hAt ? body.hAt(x, y) : 0; return h > 1 ? h : (body.maxH || 30) * 0.6; };
    // смещение частей по глубине: ближние лапы — к нам, дальние — от нас
    sh.parts.forEach(p => {
      const hb = bodyH(p.pivot[0], p.pivot[1]);
      p.z = 0;
      if (p.role === 'leg' || p.role === 'arm') p.z = (p.far ? -1 : 1) * hb * (p.role === 'arm' ? 0.62 : 0.52);
      else if (p.role === 'wing') p.z = (p.far ? -1 : 1) * hb * 0.35;
      else if (p.role === 'flip') p.z = (p.far ? -1 : 1) * hb * 0.62;
      p.eyes.forEach(E => { E.z = Math.max(E.r * 0.6, (p.hAt ? p.hAt(E.x, E.y) : 8) * 0.86); });
    });
    // шапка: верх головы над глазом; седло: верх спины над центром тела
    const head = sh.parts.find(p => p.eyes.length) || sh.parts.find(p => p.role === 'head' || p.role === 'neck');
    if (head && head.top) {
      const E = head.eyes[0] || { x: head.pivot[0] + 20, y: head.pivot[1] - 10, r: 5 };
      const hx = E.x - E.r * 0.3, ty = head.top(hx);
      sh.hat = { part: head.i, x: hx, y: ty == null ? E.y - E.r * 2 : ty, size: Math.max(34, Math.min(62, E.r * 7.5)) };
    }
    if (body.top) { const bx = body.pivot[0], ty = body.top(bx); sh.saddle = { x: bx, y: ty == null ? body.pivot[1] - 40 : ty, z: 0 }; }
    sh.sil = sil || [0, 0, 400, 254]; sh.bodyMaxH = body.maxH || 30;
    sh.built = true;
    return sh;
  }

  // ——— атлас текстур (раскладка по частям; одна на вид и размер) ———
  function layoutFor(sh, S) {
    const key = 'L' + S; if (sh[key]) return sh[key];
    const pad = 4, rects = sh.parts.map(p => p.bbox ? { p, x0: p.bbox[0] - pad, y0: p.bbox[1] - pad, w: p.bbox[2] - p.bbox[0] + pad * 2, h: p.bbox[3] - p.bbox[1] + pad * 2 } : null).filter(Boolean);
    const area = rects.reduce((a, r) => a + r.w * r.h, 0);
    let sc = Math.min(mobile() ? 2 : 3, Math.sqrt(S * S * 0.8 / Math.max(1, area)));
    for (let tries = 0; tries < 30; tries++, sc *= 0.93) {
      const order = rects.slice().sort((a, b) => b.h - a.h); let x = 2, y = 2, rowH = 0, ok = true;
      for (const r of order) {
        const w = Math.ceil(r.w * sc) + 2, h = Math.ceil(r.h * sc) + 2;
        if (x + w > S - 2) { x = 2; y += rowH; rowH = 0; }
        if (w > S - 4 || y + h > S - 2) { ok = false; break; }
        r.ax = x; r.ay = y; r.aw = w; r.ah = h; x += w; rowH = Math.max(rowH, h);
      }
      if (ok) break;
    }
    const byPart = {}; rects.forEach(r => byPart[r.p.i] = r);
    sh[key] = { S, sc, rects, byPart };
    return sh[key];
  }

  // ——— сборка BufferGeometry частей (позиции относительно шарнира, единицы сцены) ———
  function partGeometry(sh, p, uvFn) {
    const THREE = T(); let pos = [], uv = [], idx = [], base = 0;
    p.chunks.forEach(c => {
      for (let v = 0; v < c.pos.length; v += 3) {
        pos.push((c.pos[v] - p.pivot[0]) * SCALE, (p.pivot[1] - c.pos[v + 1]) * SCALE, (c.pos[v + 2]) * SCALE);
        const t = uvFn(c.vb[(v / 3) * 2], c.vb[(v / 3) * 2 + 1], p); uv.push(t[0], t[1]);
      }
      for (let k = 0; k < c.idx.length; k++) idx.push(c.idx[k] + base);
      base += c.pos.length / 3;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    pos = uv = idx = null;
    return g;
  }
  const geoCache = {};
  function geometrySet(id, mode) { // mode: 'atlas' | 'sprite'
    const key = id + ':' + mode;
    if (geoCache[key]) { geoCache[key].refs++; return geoCache[key]; }
    const sh = buildShape(id), S = Q().tex;
    let uvFn;
    if (mode === 'atlas') { const L = layoutFor(sh, S); uvFn = (x, y, p) => { const r = L.byPart[p.i]; if (!r) return [0, 0]; return [(r.ax + 1 + (x - r.x0) * L.sc) / S, 1 - (r.ay + 1 + (y - r.y0) * L.sc) / S]; }; }
    else { const s = sh.sil, pad = 1.5, x0 = s[0] - pad, y0 = s[1] - pad, w = s[2] - s[0] + pad * 2, h = s[3] - s[1] + pad * 2; uvFn = (x, y) => [(x - x0) / w, 1 - (y - y0) / h]; }
    const geos = sh.parts.map(p => p.chunks && p.chunks.length ? partGeometry(sh, p, uvFn) : null);
    geoCache[key] = { key, sh, geos, refs: 1 };
    return geoCache[key];
  }
  function releaseGeometry(set) { if (!set) return; set.refs--; if (set.refs <= 0) { set.geos.forEach(g => g && g.dispose()); delete geoCache[set.key]; } }

  // ——— текстуры ———
  const texCache = {};
  function bleed(ctx, w, h, x0, y0, x1, y1) {
    // краевые прозрачные пиксели заливаем цветом ближайших непрозрачных (иначе на кромке тёмная бахрома)
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
    const rw = x1 - x0, rh = y1 - y0; if (rw <= 0 || rh <= 0) return;
    const im = ctx.getImageData(x0, y0, rw, rh), d = im.data, ok = new Uint8Array(rw * rh);
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let i = 0; i < rw * rh; i++) if (d[i * 4 + 3] > 200) { ok[i] = 1; ar += d[i * 4]; ag += d[i * 4 + 1]; ab += d[i * 4 + 2]; an++; }
    const R = 10;
    const pass = (horiz) => {
      const n1 = horiz ? rh : rw, n2 = horiz ? rw : rh, ok2 = ok.slice();
      for (let a = 0; a < n1; a++) {
        let last = -1e9;
        const idx = (b) => horiz ? a * rw + b : b * rw + a;
        const near = new Int32Array(n2).fill(-1), dist = new Float32Array(n2).fill(1e9);
        for (let b = 0; b < n2; b++) { if (ok[idx(b)]) last = b; if (b - last <= R) { near[b] = last; dist[b] = b - last; } }
        last = 1e9; for (let b = n2 - 1; b >= 0; b--) { if (ok[idx(b)]) last = b; if (last - b <= R && last - b < dist[b]) { near[b] = last; dist[b] = last - b; } }
        for (let b = 0; b < n2; b++) { const i = idx(b); if (ok[i] || near[b] < 0) continue; const j = idx(near[b]); d[i * 4] = d[j * 4]; d[i * 4 + 1] = d[j * 4 + 1]; d[i * 4 + 2] = d[j * 4 + 2]; ok2[i] = 1; }
      }
      ok.set(ok2);
    };
    pass(true); pass(false); pass(true);
    if (an) { ar /= an; ag /= an; ab /= an; }
    for (let i = 0; i < rw * rh; i++) { if (!ok[i]) { d[i * 4] = ar; d[i * 4 + 1] = ag; d[i * 4 + 2] = ab; } d[i * 4 + 3] = 255; }
    ctx.putImageData(im, x0, y0);
  }
  function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('img')); im.src = src; }); }
  function finishTex(c, key, extra) {
    const THREE = T(), tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = (DP.G3 && DP.G3.aniso) || 1; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const t = Object.assign({ key, tex, canvas: c, refs: 1, bytes: c.width * c.height * 4 * 1.34 }, extra || {});
    texCache[key] = t; return t;
  }
  /** Атлас готового динозавра: каждая часть — своя SVG-раскраска */
  function atlasTexture(id, pal) {
    const key = 'A:' + id + ':' + pal + ':' + Q().tex;
    if (texCache[key]) { texCache[key].refs++; return Promise.resolve(texCache[key]); }
    if (texCache[key + ':p']) return texCache[key + ':p'].then(t => { t.refs++; return t; });
    const pr = (async () => {
      const sh = buildShape(id), S = Q().tex, L = layoutFor(sh, S), VB = Din().VB;
      const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d', { willReadFrequently: true });
      const sp = Din().byId[id], P = Din().palOf(sp, pal); x.fillStyle = P.b; x.fillRect(0, 0, S, S);
      x.clearRect(0, 0, S, S);
      for (const r of L.rects) {
        const img = await enqueue(() => loadImg(Din().enc(Din().partDoc(id, r.p.i, pal, L.sc)))).catch(() => null);
        if (!img) continue;
        const sx = (r.x0 - VB.x) * L.sc, sy = (r.y0 - VB.y) * L.sc, sw = r.w * L.sc, shh = r.h * L.sc;
        x.drawImage(img, sx, sy, sw, shh, r.ax + 1, r.ay + 1, sw, shh);
        img.src = '';
      }
      await enqueue(() => { L.rects.forEach(r => bleed(x, S, S, r.ax, r.ay, r.ax + r.aw, r.ay + r.ah)); });
      const t = finishTex(c, key, { lid: Din().dark(P.b, 0.12) });
      delete texCache[key + ':p'];
      return t;
    })();
    texCache[key + ':p'] = pr;
    return pr;
  }
  /** Текстура из рисунка ребёнка (спрайт уже вырезан по силуэту шаблона) */
  function spriteTexture(src, eyeUV) {
    const key = 'S:' + src.length + ':' + src.slice(-64);
    if (texCache[key]) { texCache[key].refs++; return Promise.resolve(texCache[key]); }
    return enqueue(() => loadImg(src)).then(img => {
      const M = Q().sprite, k = Math.min(1, M / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.max(4, Math.round(img.naturalWidth * k)); c.height = Math.max(4, Math.round(img.naturalHeight * k));
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, c.width, c.height);
      let alpha = null; try { const d = x.getImageData(0, 0, c.width, c.height).data; alpha = new Uint8Array(c.width * c.height); for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3] > 110 ? 1 : 0; } catch (e) { alpha = null; }
      let lid = null; if (eyeUV) { try { const px = x.getImageData(Math.round(eyeUV[0] * c.width), Math.round((1 - eyeUV[1]) * c.height), 1, 1).data; lid = `rgb(${px[0] * 0.8 | 0},${px[1] * 0.8 | 0},${px[2] * 0.8 | 0})`; } catch (e) { lid = null; } }
      bleed(x, c.width, c.height, 0, 0, c.width, c.height);
      img.src = '';
      return finishTex(c, key, { alpha, aw: c.width, ah: c.height, lid, aspect: img.naturalHeight / Math.max(1, img.naturalWidth) });
    });
  }
  function releaseTex(t) { if (!t) return; t.refs--; if (t.refs <= 0) { t.tex.dispose(); if (t.canvas) { t.canvas.width = t.canvas.height = 0; } delete texCache[t.key]; } }
  /** После загрузки в видеопамять холст больше не нужен (экономим память iPhone) */
  function dropCanvas(t, renderer) {
    if (!t || !t.canvas || t.kept) return;
    try { renderer.initTexture(t.tex); } catch (e) { return; }
    const c = t.canvas; t.tex.image = { width: c.width, height: c.height }; t.canvas = null;
    c.width = c.height = 0;
  }

  // ——— свободный рисунок (без шаблона): надуваем сам силуэт рисунка ———
  function freeShape(t) {
    const key = 'F:' + t.key; if (shapeCache[key]) return shapeCache[key];
    const aw = t.aw, ah = t.ah, lim = 120, k = Math.min(1, lim / Math.max(aw, ah)), w = Math.max(8, Math.round(aw * k)), h = Math.max(8, Math.round(ah * k));
    // уменьшаем маску: рисунок шириной 428 единиц
    const unit = 428 / w, res = 1 / unit, m = new Uint8Array(w * h);
    if (t.alpha) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) m[j * w + i] = t.alpha[Math.min(ah - 1, Math.floor(j / k)) * aw + Math.min(aw - 1, Math.floor(i / k))];
    else m.fill(1);
    const margin = 4, W2 = w + margin * 2, H2 = h + margin * 2, m2 = new Uint8Array(W2 * H2);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) m2[(j + margin) * W2 + i + margin] = m[j * w + i];
    const hgt = h * unit, ox = 200 - 214 - margin * unit, oy = 248 - hgt - margin * unit;
    const r = inflate(m2, W2, H2, ox, oy, res, { step: Math.max(unit * 1.2, 4), k: 0.62, z: 0, rad: 30 });
    const part = { i: 0, n: 'free', role: 'body', pivot: [200, 248 - hgt / 2], amp: 1, off: 0, far: false, eyes: [], chunks: [r], bbox: [200 - 214, 248 - hgt, 200 + 214, 248], z: 0, hAt: r.hAt, top: r.top, maxH: r.maxH };
    const sh = { id: key, parts: [part], built: true, sil: part.bbox, free: true, height: hgt, bodyMaxH: r.maxH };
    sh.hat = { part: 0, x: 200 + 214 * 0.45, y: (r.top(200 + 214 * 0.45) || (248 - hgt)), size: 40 };
    sh.saddle = { x: 200, y: r.top(200) || 248 - hgt, z: 0 };
    shapeCache[key] = sh;
    return sh;
  }
  function freeGeometry(t) {
    const sh = freeShape(t), key = sh.id + ':free';
    if (geoCache[key]) { geoCache[key].refs++; return geoCache[key]; }
    const s = sh.sil, uvFn = (x, y) => [(x - s[0]) / (s[2] - s[0]), 1 - (y - s[1]) / (s[3] - s[1])];
    geoCache[key] = { key, sh, geos: [partGeometry(sh, sh.parts[0], uvFn)], refs: 1 };
    return geoCache[key];
  }

  // ——— чешуя: маленькая повторяющаяся карта рельефа (мягкие бугорки-«плитки»), общая для всех динозавров ———
  let scaleTex = null;
  function scaleBump() {
    if (scaleTex) return scaleTex;
    const THREE = T(), S = 64, n = 6, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    const cell = S / n;
    for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) {
      const cx = (i + (j % 2 ? 0.5 : 0)) * cell + cell / 2, cy = j * cell + cell / 2, g = x.createRadialGradient(cx - cell * 0.12, cy - cell * 0.12, 0, cx, cy, cell * 0.62);
      g.addColorStop(0, '#fff'); g.addColorStop(0.6, '#999'); g.addColorStop(1, '#000'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, cell * 0.62, 0, TAU); x.fill();
    }
    scaleTex = new THREE.CanvasTexture(c); scaleTex.colorSpace = THREE.NoColorSpace; scaleTex.wrapS = scaleTex.wrapT = THREE.RepeatWrapping; scaleTex.repeat.set(26, 26);
    return scaleTex;
  }
  /** «Живая» кожа: мягкий контровой свет по краю силуэта, затенение снизу (живот, под шеей) и тёплое подповерхностное свечение — объём без лишних текстур */
  function skin(m) {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float dpAO = 0.74 + 0.26 * smoothstep(-0.85, 0.55, normal.y);
        diffuseColor.rgb *= dpAO;`).replace('#include <opaque_fragment>', `{
        float dpRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.6);
        outgoingLight += diffuseColor.rgb * vec3(0.55, 0.62, 0.72) * dpRim * 0.55 + diffuseColor.rgb * vec3(0.10, 0.04, 0.02) * (1.0 - dpRim);
      }
      #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'dpskin';
    return m;
  }
  // ——— глаза, веки, шапки ———
  let eyeGeo = null, lidGeo = null, scleraMat = null, glintMat = null;
  const hatTex = {};
  function hatTexture(hat) {
    if (hatTex[hat]) return hatTex[hat];
    const THREE = T(), c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    x.font = '100px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(DP.Scene.HATS[hat] || '', 64, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    hatTex[hat] = { tex: t, mat: new THREE.SpriteMaterial({ map: t, depthWrite: false }) };
    return hatTex[hat];
  }

  /** Собрать модель динозавра для сущности сцены. Возвращает Promise<model> */
  function build(e, scene) {
    const THREE = T(), d = e.d || {}, sp = Din().byId[e.species];
    const legend = !!d.legend || d.palette === Din().LEGEND;
    let geoP, texP;
    if (sp && !d.sprite) { texP = atlasTexture(sp.id, d.palette || 0); geoP = enqueue(() => geometrySet(sp.id, 'atlas')); }
    else if (sp && d.sprite) {
      geoP = enqueue(() => geometrySet(sp.id, 'sprite'));
      texP = geoP.then(set => {
        const sh = set.sh, s = sh.sil, pad = 1.5, head = sh.parts.find(p => p.eyes.length), E = head && head.eyes[0];
        const uv = E ? [(E.x - s[0] + pad) / (s[2] - s[0] + pad * 2), 1 - (E.y - s[1] + pad) / (s[3] - s[1] + pad * 2)] : null;
        return spriteTexture(d.sprite, uv);
      });
    } else if (d.sprite) { texP = spriteTexture(d.sprite); geoP = texP.then(t => enqueue(() => freeGeometry(t))); }
    else return Promise.reject(new Error('no art'));
    return Promise.all([geoP, texP]).then(([set, tex]) => {
      if (e._dead3d) { releaseGeometry(set); releaseTex(tex); return null; }
      const sh = set.sh;
      const bump = Q().scales && !sh.free ? { bumpMap: scaleBump(), bumpScale: 0.55 } : {};
      const mat = skin(legend ? new THREE.MeshPhongMaterial(Object.assign({ map: tex.tex, shininess: 70, specular: new THREE.Color('#fff0b0'), emissive: new THREE.Color('#3a2a00') }, bump))
        : Q().scales ? new THREE.MeshPhongMaterial(Object.assign({ map: tex.tex, shininess: 18, specular: new THREE.Color('#34342c') }, bump)) // лёгкий влажный блеск кожи
          : new THREE.MeshLambertMaterial({ map: tex.tex }));
      const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
      const lidCol = new THREE.Color(tex.lid || (sp ? Din().dark(Din().palOf(sp, d.palette || 0).b, 0.12) : '#6a7a40'));
      const parts = [], eyes = [];
      const lo = QL() === 'low';
      if (!eyeGeo) { eyeGeo = lo ? new THREE.SphereGeometry(1, 16, 12) : new THREE.SphereGeometry(1, 24, 16); lidGeo = new THREE.SphereGeometry(1, lo ? 16 : 24, lo ? 8 : 10, 0, TAU, 0, Math.PI * 0.62); }
      if (!scleraMat) { scleraMat = new THREE.MeshPhongMaterial({ color: '#f4efe0', shininess: 60, specular: new THREE.Color('#ffffff') }); glintMat = new THREE.MeshBasicMaterial({ color: '#ffffff' }); }
      const eyeMat = new THREE.MeshPhongMaterial({ color: sp && sp.eye === 'slit' ? '#2a1404' : '#160c06', shininess: 90, specular: new THREE.Color('#ffffff') });
      const lidMat = new THREE.MeshLambertMaterial({ color: lidCol });
      sh.parts.forEach((p, i) => {
        const geo = set.geos[i]; if (!geo) return;
        const g = new THREE.Group();
        g.position.set((p.pivot[0] - ORIGIN.x) * SCALE, (ORIGIN.y - p.pivot[1]) * SCALE, (p.z || 0) * SCALE);
        const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; g.add(mesh);
        body.add(g); parts.push({ p, g, mesh });
        p.eyes.forEach(E => [1, -1].forEach(side => {
          const r = E.r * SCALE * 0.95, ex = (E.x - p.pivot[0]) * SCALE, ey = (p.pivot[1] - E.y) * SCALE, ez = side * E.z * SCALE;
          // глазное яблоко (светлое), зрачок чуть вперёд и наружу, блик — живой взгляд
          const sc = new THREE.Mesh(eyeGeo, scleraMat); sc.scale.set(r * 1.05, r * 1.05, r * 0.8); sc.position.set(ex, ey, ez);
          const em = new THREE.Mesh(eyeGeo, eyeMat); em.scale.setScalar(r * 0.68); em.position.set(ex + r * 0.18, ey, ez + side * r * 0.45);
          const gl = new THREE.Mesh(eyeGeo, glintMat); gl.scale.setScalar(r * 0.2); gl.position.set(ex + r * 0.34, ey + r * 0.3, ez + side * r * 0.86);
          const lid = new THREE.Mesh(lidGeo, lidMat); lid.scale.setScalar(r * 1.32); lid.position.set(ex, ey, ez); lid.rotation.x = side > 0 ? Math.PI / 2 : -Math.PI / 2; lid.visible = false;
          g.add(sc); g.add(em); g.add(gl); g.add(lid); eyes.push({ em, lid, side, sc, gl });
        }));
      });
      // рост и размах модели (в единицах рисунка)
      const s = sh.sil, len = (s[2] - s[0]) * SCALE, hgt = (ORIGIN.y - s[1]) * SCALE;
      const m = {
        e, root, body, parts, eyes, mat, eyeMat, lidMat, set, tex, sh, legend, len, hgt, hat: null, hatId: null,
        cx: ((s[0] + s[2]) / 2 - ORIGIN.x) * SCALE, bottom: (ORIGIN.y - s[3]) * SCALE, halfZ: (sh.bodyMaxH || 30) * SCALE,
        saddle: sh.saddle ? { x: (sh.saddle.x - ORIGIN.x) * SCALE, y: (ORIGIN.y - sh.saddle.y) * SCALE } : { x: 0, y: hgt * 0.7 },
        dispose() {
          root.removeFromParent(); mat.dispose(); eyeMat.dispose(); lidMat.dispose();
          releaseGeometry(set); releaseTex(tex);
        }
      };
      if (scene && scene.renderer) { dropCanvas(tex, scene.renderer); }
      return m;
    });
  }
  /** Шапка как наклейка-эмодзи, приклеенная к голове (поворачивается и качается вместе с ней) */
  function setHat(m, hat) {
    if (m.hatId === hat) return;
    if (m.hat) { m.hat.removeFromParent(); m.hat = null; }
    m.hatId = hat;
    if (!hat || !DP.Scene.HATS[hat] || !m.sh.hat) return;
    const H = m.sh.hat, part = m.parts.find(q => q.p.i === H.part); if (!part) return;
    const sprite = new (T().Sprite)(hatTexture(hat).mat), sz = H.size * SCALE * 1.15;
    sprite.scale.set(sz, sz, 1); sprite.center.set(0.5, 0.18);
    sprite.position.set((H.x - part.p.pivot[0]) * SCALE, (part.p.pivot[1] - H.y) * SCALE, 0);
    part.g.add(sprite); m.hat = sprite;
  }

  /** Поза на этот кадр: шаг, покачивание, сон лёжа, еда, прыжок, кувырок, кладка яйца. sc — сцена */
  function pose(m, e, sc, dt) {
    const t = sc.t, mv = Math.min(1.4, e.moving || 0), lie = e.lie || 0, hab = e.habitat;
    const body = m.body, h = m.hgt;
    let oy = 0, rotZ = 0, rotX = 0, sy = 1;
    if (hab === 'ground') {
      oy = Math.abs(Math.sin(e.phase)) * h * 0.05 * mv; rotZ = Math.sin(e.phase) * 0.035 * mv; rotX = Math.sin(e.phase) * 0.03 * mv;
      sy = 1 + Math.sin(t * 2.2 + e.seed) * 0.012 * (1 - Math.min(1, mv)); // дыхание
    } else if (hab === 'sky') { oy = Math.sin(t * (1.8 - lie) + e.seed) * h * 0.12; rotZ = -(e.vy || 0) * 0.0012; }
    else { rotZ = Math.sin(t * 2.5 + e.seed) * 0.06 * (1 - lie * 0.7); oy = Math.sin(t * 1.4 + e.seed) * h * 0.05; }
    if (lie) { sy *= 1 - 0.1 * lie + Math.sin(t * 1.7 + e.seed) * 0.02 * lie; if (hab === 'ground') { oy -= m.legLen * 0.62 * lie; rotX += 0.12 * lie; rotZ *= 1 - lie; } }
    if (e.state === 'eat') { rotZ -= 0.14; sy *= 1 + Math.sin(t * 22) * 0.03; }
    if (e.layT > 0) { const k = Math.sin(Math.min(1, e.layT / 1.6) * Math.PI); oy -= m.legLen * 0.45 * k; rotZ += 0.12 * k; }
    let spin = 0;
    if (e.jump) {
      const j = e.jump / 0.75; oy += Math.sin(Math.PI * Math.min(1, j * 1.15)) * h * 0.7;
      if (j < 0.12) sy *= 1 - (0.12 - j) * 1.5; if (j > 0.85) sy *= 1 - (j - 0.85) * 1.2;
      if (e.spin) spin = j * TAU;
    }
    const yaw = hab === 'ground' ? Math.sin(e.phase) * 0.06 * mv : 0; // при шаге корпус чуть поворачивается из стороны в сторону
    body.position.y = oy; body.rotation.set(rotX, yaw, rotZ);
    body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
    const age = sc.t - e.born; const grow = age < 0.4 ? 0.3 + age / 0.4 * 0.7 : 1;
    m.root.userData.grow = grow;
    // части: углы марионетки (по часовой в 2D → против часовой в 3D) + сгибы для сна/полёта
    m.parts.forEach(({ p, g }) => {
      const a = -sc.partAngle(e, p);
      g.rotation.set(0, 0, a);
      if (p.role === 'leg' && lie) { const front = p.pivot[0] > (m.sh.parts.find(q => q.role === 'body') || p).pivot[0]; g.rotation.z += (front ? -1.15 : 1.15) * lie; }
      if (p.role === 'tail') { g.rotation.y = Math.sin(t * 1.5 + e.seed) * 0.16 + Math.sin(e.phase - 0.9) * 0.14 * mv - yaw * 1.4 + (e.state === 'play' ? Math.sin(t * 9) * 0.15 : 0); g.rotation.z += Math.sin(e.phase * 2 - 0.6) * 0.035 * mv; }
      if ((p.role === 'head' || p.role === 'neck') && hab === 'ground') { g.rotation.z -= rotZ * 0.7 - Math.sin(e.phase * 2 + 0.5) * 0.025 * mv; g.rotation.y -= yaw * 0.8; } // голова «держит горизонт» и кивает в такт шагу
      if ((p.role === 'head' || p.role === 'neck') && e.act === 'look' && e.mode === 'idle') g.rotation.y = Math.sin(t * 0.9 + e.seed) * 0.35;
      if (p.role === 'wing') { const flap = lie ? 0.25 : 1.0 + Math.sin(t * (6 + 3 * mv) + e.seed + p.off) * 0.55; g.rotation.x = (p.far ? -1 : 1) * flap; }
      if (p.role === 'flip') g.rotation.x = (p.far ? -1 : 1) * (0.9 + Math.sin(t * 2.6 + e.seed + p.off) * 0.25);
    });
    // моргание и сон: веки
    const closed = lie > 0.55 || e.blinkT < 0;
    m.eyes.forEach(E => { E.lid.visible = closed; E.em.visible = !closed; if (E.gl) E.gl.visible = !closed; });
    if (m.legend) m.mat.emissive.setRGB(0.22 + 0.08 * Math.sin(t * 2.4 + e.seed), 0.16 + 0.06 * Math.sin(t * 2.4 + e.seed), 0);
    m.spin = spin;
  }
  /** Длина ног (для приседания) — один раз на модель */
  function measure(m) {
    const legs = m.parts.filter(q => q.p.role === 'leg');
    m.legLen = legs.length ? Math.max(...legs.map(q => q.p.bbox ? (q.p.bbox[3] - q.p.pivot[1]) * SCALE : 0)) : m.hgt * 0.2;
    return m;
  }

  function stats() {
    let tex = 0, texN = 0, geo = 0, geoN = 0;
    Object.values(texCache).forEach(t => { if (t && t.tex) { tex += t.bytes; texN++; } });
    Object.values(geoCache).forEach(s => s.geos.forEach(g => { if (!g) return; geoN++; Object.values(g.attributes).forEach(a => geo += a.array.byteLength); if (g.index) geo += g.index.array.byteLength; }));
    return { tex, texN, geo, geoN };
  }
  function warm(ids) { (ids || []).forEach(id => enqueue(() => { buildShape(id); })); }
  /** Освободить всё (уход со страницы / потеря контекста): кэш геометрии и текстур */
  function purge() {
    Object.values(geoCache).forEach(s => s.geos.forEach(g => g && g.dispose())); Object.keys(geoCache).forEach(k => delete geoCache[k]);
    Object.values(texCache).forEach(t => { if (t && t.tex) { t.tex.dispose(); if (t.canvas) t.canvas.width = t.canvas.height = 0; } }); Object.keys(texCache).forEach(k => delete texCache[k]);
    Object.values(hatTex).forEach(h => { h.tex.dispose(); h.mat.dispose(); }); Object.keys(hatTex).forEach(k => delete hatTex[k]);
    if (eyeGeo) { eyeGeo.dispose(); lidGeo.dispose(); eyeGeo = lidGeo = null; }
    if (scleraMat) { scleraMat.dispose(); glintMat.dispose(); scleraMat = glintMat = null; }
    if (scaleTex) { scaleTex.dispose(); scaleTex = null; }
    if (scratch) { scratch.width = scratch.height = 0; scratch = null; }
  }

  DP.Dino3D = { _hatMat: (h) => DP.Scene.HATS[h] ? hatTexture(h).mat : null, build: (e, sc) => build(e, sc).then(m => m && measure(m)), pose, setHat, stats, purge, warm, enqueue, SCALE, ORIGIN, _shape: buildShape, _inflate: inflate };
})();
