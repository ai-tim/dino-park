/* Динопарк — объёмная природа для пяти локаций: рельеф, вода с рябью, деревья, пальмы, папоротники, трава,
 * камни, горы, вулкан, столовые горы, ледник, ночное небо со звёздами и светлячками.
 * Всё строится кодом из простых низкополигональных фигур (как бумажная поделка) и рисуется «пачками» (instancing),
 * чтобы телефон тянул 30 кадров в секунду. Геометрия раскрашена по вершинам — текстур почти нет (экономим память). */
window.DP = window.DP || {};
(function () {
  const TAU = Math.PI * 2;
  const T = () => window.THREE;

  // ——— общие помощники геометрии (используются и в things3d.js) ———
  function rng(seed) { let a = seed >>> 0 || 1; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, o) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < (o || 3); i++) { s += a * noise2(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
  const _c = {}; function C(hex) { return _c[hex] || (_c[hex] = new (T().Color)(hex)); }
  /** Раскрасить геометрию по вершинам: цвет или функция (x, y, z, nx, ny, nz) → Color */
  function paint(g, col) {
    g = g.index ? g.toNonIndexed() : g;
    const p = g.attributes.position, n = g.attributes.normal, arr = new Float32Array(p.count * 3), tmp = new (T().Color)();
    for (let i = 0; i < p.count; i++) {
      const c = typeof col === 'function' ? col(p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0, tmp) : C(col);
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new (T().BufferAttribute)(arr, 3));
    return g;
  }
  function place(g, x, y, z, rx, ry, rz, sx, sy, sz) {
    const THREE = T(), m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    m.compose(new THREE.Vector3(x || 0, y || 0, z || 0), q, new THREE.Vector3(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz));
    g.applyMatrix4(m); return g;
  }
  /** Неровность: сдвиг вершин по шуму от их положения (совпадающие вершины сдвигаются одинаково — без дыр) */
  function jitter(g, amt, seed) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = (seed || 0) * 13.1; p.setXYZ(i, x + (hash2(x * 9 + k, y * 7 + z * 3) - 0.5) * amt, y + (hash2(y * 9 + k, z * 7 + x * 3) - 0.5) * amt, z + (hash2(z * 9 + k, x * 7 + y * 3) - 0.5) * amt); }
    g.computeVertexNormals(); return g;
  }
  /** Склеить несколько раскрашенных геометрий в одну (один вызов отрисовки) */
  function merge(list) {
    const THREE = T(); let n = 0; const gs = list.filter(Boolean).map(g => { g = g.index ? g.toNonIndexed() : g; if (!g.attributes.normal) g.computeVertexNormals(); n += g.attributes.position.count; return g; });
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Cc = new Float32Array(n * 3); let o = 0;
    gs.forEach(g => { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); if (g.attributes.color) Cc.set(g.attributes.color.array, o * 3); else Cc.fill(1, o * 3, (o + g.attributes.position.count) * 3); o += g.attributes.position.count; g.dispose(); });
    const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  }
  function cyl(rt, rb, h, seg) { return place(new (T().CylinderGeometry)(rt, rb, h, seg || 6, 1), 0, h / 2, 0); }
  function cone(r, h, seg) { return place(new (T().ConeGeometry)(r, h, seg || 7, 1), 0, h / 2, 0); }
  function blob(r, d) { return new (T().IcosahedronGeometry)(r, d || 0); }
  /** Лист-полоска: от основания по +X, изгибается вниз, с продольной складкой */
  function frond(len, width, droop, seg, rise) {
    const THREE = T(), pos = [], S = seg || 6;
    const pt = (t, side) => { const x = len * t, y = len * ((rise == null ? 0.35 : rise) * t - droop * t * t), w = width * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.04)) * (side || 0); return [x, y + Math.abs(w) * 0.25 * (side ? 0 : 1), w]; };
    for (let i = 0; i < S; i++) {
      const a = i / S, b = (i + 1) / S;
      const l0 = pt(a, -1), m0 = pt(a, 0), r0 = pt(a, 1), l1 = pt(b, -1), m1 = pt(b, 0), r1 = pt(b, 1);
      m0[1] += width * 0.12; m1[1] += width * 0.12;
      pos.push(...l0, ...m0, ...l1, ...m0, ...m1, ...l1, ...m0, ...r0, ...m1, ...r0, ...r1, ...m1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
  }
  function hashN(x, z) { const s = Math.sin(x * 41.3 + z * 17.7) * 9631.7; return s - Math.floor(s); }
  function blade(h, w, lean) {
    const THREE = T(), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, lean, h, 0], 3)); g.computeVertexNormals(); return g;
  }
  /** Мягкая круглая текстура (тени, свечения, светлячки) */
  const texCache = {};
  function radialTex(key, stops, size) {
    if (texCache[key]) return texCache[key];
    const THREE = T(), c = document.createElement('canvas'); c.width = c.height = size || 64; const x = c.getContext('2d'), r = c.width / 2;
    const g = x.createRadialGradient(r, r, 0, r, r, r); stops.forEach(s => g.addColorStop(s[0], s[1])); x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; texCache[key] = t; return t;
  }
  function canvasTex(key, w, h, draw) {
    if (texCache[key]) return texCache[key];
    const THREE = T(), c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; texCache[key] = t; return t;
  }
  function freeTextures() { Object.keys(texCache).forEach(k => { texCache[k].dispose(); delete texCache[k]; }); }
  /** Материал с ветром: верх геометрии покачивается (amp — сила, по высоте в квадрате) */
  const TIME = { value: 0 };
  function windMat(amp, opts) {
    const THREE = T(), m = new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true, side: THREE.DoubleSide }, opts || {}));
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = TIME;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float wh = max(position.y, 0.0);
        #ifdef USE_INSTANCING
          vec2 wp = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 wp = vec2(modelMatrix[3][0], modelMatrix[3][2]);
        #endif
        float ww = (sin(uTime * 1.7 + wp.x * 0.31 + wp.y * 0.17) + 0.45 * sin(uTime * 3.1 + wp.x * 0.7)) * ${amp.toFixed(4)} * wh * wh;
        transformed.x += ww; transformed.z += ww * 0.35;`);
    };
    m.customProgramCacheKey = () => 'wind' + amp;
    return m;
  }
  DP.G3 = { rng, noise2, fbm, C, paint, place, jitter, merge, cyl, cone, blob, frond, blade, radialTex, canvasTex, windMat, TIME, freeTextures };

  // ——— растения и камни (единичный размер; масштаб задаёт экземпляр) ———
  const QL = () => (DP.Scene && DP.Scene.PERF && DP.Scene.PERF.quality) || 'high';
  const HI = () => QL() === 'high', LO = () => QL() === 'low';
  /** Изогнутая травинка из нескольких звеньев (сужается к кончику) */
  function blade2(h, w, lean, segs) {
    const THREE = T(), pos = [], n = segs || 3;
    for (let i = 0; i < n; i++) {
      const a = i / n, b = (i + 1) / n, xa = lean * a * a, xb = lean * b * b, wa = w * (1 - a), wb = w * (1 - b);
      pos.push(-wa + xa, h * a, 0, wa + xa, h * a, 0, -wb + xb, h * b, 0, wa + xa, h * a, 0, wb + xb, h * b, 0, -wb + xb, h * b, 0);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
  }
  const KIT = {
    tree(L, r) { // лиственное дерево: ствол и пышная крона из «комков»
      const parts = [paint(jitter(cyl(0.16, 0.3, 2.3, 6), 0.08, 1), L.bark)];
      [[0, 2.7, 0, 1.25], [0.75, 2.35, 0.25, 0.9], [-0.7, 2.4, -0.2, 0.95], [0.15, 3.3, -0.15, 0.85], [-0.2, 2.5, 0.7, 0.8]].forEach(([x, y, z, s], i) => {
        parts.push(paint(jitter(place(blob(s, HI() ? 2 : 1), x, y, z), HI() ? 0.16 : 0.22, i + 2), (px, py, pz, nx, ny) => C(L.leaf[Math.min(L.leaf.length - 1, (ny > 0.35 ? 2 : ny > -0.2 ? 1 : 0) + (i % 2))])));
      });
      return merge(parts);
    },
    tree2(L, r) { // высокое дерево с ярусами зонтичной кроны (как гинкго/акация) и корнями-подпорками
      const parts = [paint(jitter(cyl(0.12, 0.24, 3.2, 7), 0.05, 3), L.barkD || L.bark)];
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4, g = cyl(0.03, 0.07, 0.75, 4); place(g, Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); parts.push(paint(g, L.bark)); }
      [[0, 3.3, 0, 1.6, 0.42], [0.35, 2.55, 0.2, 1.15, 0.36], [-0.3, 2.8, -0.25, 1.05, 0.34], [0.1, 3.85, 0, 0.95, 0.38]].forEach(([x, y, z, s, fl], i) => {
        parts.push(paint(jitter(place(blob(s, HI() ? 2 : 1), x, y, z, 0, i, 0, 1, fl, 1), 0.12, i + 7), (px, py, pz, nx, ny) => C(L.leaf[Math.min(L.leaf.length - 1, ny > 0.5 ? 3 : ny > 0 ? 2 : 1)])));
      });
      return merge(parts);
    },
    palm(L, r, lean) {
      const parts = [], segs = 7; let x = 0, y = 0;
      for (let i = 0; i < segs; i++) { const h = 0.55, g = cyl(0.12 - i * 0.008, 0.15 - i * 0.008, h, 6); place(g, x, y, 0, 0, 0, -lean * (0.3 + i * 0.12)); parts.push(paint(g, i % 2 ? L.bark : L.barkD || L.bark)); x += Math.sin(lean * (0.3 + i * 0.12)) * h; y += Math.cos(lean * (0.3 + i * 0.12)) * h * 0.98; }
      for (let i = 0; i < 9; i++) { const g = frond(1.9, 0.32, 0.75, 6, 0.4); place(g, x, y, 0, 0, i / 9 * TAU + r() * 0.3, 0); parts.push(paint(g, (px, py, pz) => C(L.leaf[Math.min(L.leaf.length - 1, 1 + (Math.hypot(px - x, pz) > 1 ? 1 : 0) + (i % 2))]))); }
      for (let i = 0; i < 3; i++) parts.push(paint(place(blob(0.13, 0), x + Math.cos(i * 2.1) * 0.15, y - 0.12, Math.sin(i * 2.1) * 0.15), '#6a4a2a'));
      return merge(parts);
    },
    treefern(L, r) {
      const parts = [paint(cyl(0.09, 0.14, 1.5, 6), L.barkD || L.bark)];
      for (let i = 0; i < 10; i++) { const g = frond(1.3, 0.22, 0.95, 6, 0.6); place(g, 0, 1.5, 0, 0, i / 10 * TAU, 0); parts.push(paint(g, L.leaf[1 + (i % 2)])); }
      return merge(parts);
    },
    conifer(L, r, snow) {
      const parts = [paint(cyl(0.09, 0.13, 0.7, 5), L.bark)];
      (HI() ? [[0.4, 1.05, 1.2], [0.95, 0.86, 1.05], [1.45, 0.66, 0.95], [1.95, 0.45, 0.8]] : [[0.45, 1.0, 1.35], [1.1, 0.78, 1.15], [1.75, 0.55, 0.95]]).forEach(([y, rr, h], i) => {
        const g = jitter(place(cone(rr, h, HI() ? 10 : 7), 0, y, 0), 0.05, i);
        parts.push(paint(g, (px, py) => C(snow && py > y + h * (0.55 - i * 0.08) ? snow : L.leaf[Math.min(L.leaf.length - 1, i)])));
      });
      return merge(parts);
    },
    bush(L, r, kind) {
      const parts = [], cols = kind === 'dry' ? ['#6a5a2a', '#8a7a3a', '#a89a50'] : L.leaf;
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + r() * 0.5, d = i ? 0.42 : 0, s = 0.42 + r() * 0.2; parts.push(paint(jitter(place(blob(s, 1), Math.cos(a) * d, 0.38 + r() * 0.15 + (i ? 0 : 0.15), Math.sin(a) * d * 0.7), 0.12, i), (px, py, pz, nx, ny) => C(cols[Math.min(cols.length - 1, ny > 0.4 ? 2 : ny > -0.2 ? 1 : 0)]))); }
      if (kind === 'snowbush') for (let i = 0; i < 3; i++) parts.push(paint(place(blob(0.32, 1), (i - 1) * 0.35, 0.78, 0, 0, 0, 0, 1, 0.45, 1), '#f6fbff'));
      if (kind === 'berry') for (let i = 0; i < 5; i++) { const a = r() * TAU; parts.push(paint(place(blob(0.06, 0), Math.cos(a) * 0.55, 0.35 + r() * 0.4, Math.sin(a) * 0.4 + 0.25), '#d6336c')); }
      if (kind === 'dry') for (let i = 0; i < 6; i++) { const g = cyl(0.015, 0.03, 0.9, 3); place(g, 0, 0, 0, (r() - 0.5) * 1.2, 0, (r() - 0.5) * 1.2); parts.push(paint(g, '#5a4628')); }
      return merge(parts);
    },
    fern(L, r) { const parts = []; for (let i = 0; i < 8; i++) { const g = frond(0.9 + r() * 0.3, 0.16, 0.7, 5, 0.9); place(g, 0, 0.02, 0, 0, i / 8 * TAU + r() * 0.3, 0); parts.push(paint(g, (px, py) => C(L.leaf[py > 0.35 ? 3 % L.leaf.length : py > 0.15 ? 2 : 1]))); } return merge(parts); },
    grass(cols, r) {
      const parts = [];
      const nb = LO() ? 7 : HI() ? 10 : 8;
      for (let i = 0; i < nb; i++) { const h = 0.45 + r() * 0.35, g = blade2(h, 0.035, (r() - 0.5) * 0.35, HI() ? 3 : 2); place(g, (r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.24, (r() - 0.5) * 0.5, r() * Math.PI, 0); parts.push(paint(g, (px, py) => C(py > 0.3 ? cols[2] : py > 0.12 ? cols[1] : cols[0]))); }
      return merge(parts);
    },
    flowers(L, r, cols) {
      const parts = [];
      for (let i = 0; i < 5; i++) {
        const x = (r() - 0.5) * 0.7, z = (r() - 0.5) * 0.5, h = 0.25 + r() * 0.2, col = cols[i % cols.length];
        parts.push(paint(place(cyl(0.012, 0.015, h, 3), x, 0, z), '#3f7a30'));
        if (LO()) parts.push(paint(place(blob(0.07, 0), x, h, z), col));
        else { // пять лепестков и листик на стебле
          for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; parts.push(paint(place(blob(0.045, 0), x + Math.cos(a) * 0.05, h + 0.01, z + Math.sin(a) * 0.05, 0, a, 0.25, 1, 0.35, 0.7), col)); }
          parts.push(paint(place(frond(0.12, 0.035, 0.3, 3, 0.4), x, h * 0.45, z, 0, r() * TAU, 0), '#4f8a3a'));
        }
        parts.push(paint(place(blob(0.03, 0), x, h + 0.035, z), '#ffe066'));
      }
      return merge(parts);
    },
    rock(cols, r, ice, moss) {
      const g = jitter(place(blob(1, HI() ? 2 : 1), 0, 0.35, 0, 0, r() * TAU, 0, 1, 0.62, 0.85), HI() ? 0.26 : 0.3, Math.floor(r() * 99));
      const parts = [paint(g, (px, py, pz, nx, ny) => { const c = C(ice && ny > 0.6 ? '#f6fbff' : moss && ny > 0.7 && hashN(px, pz) > 0.35 ? moss : cols[Math.min(cols.length - 1, ny > 0.55 ? 2 : ny > 0 ? 1 : 0)]); return c; })];
      if (!LO()) for (let i = 0; i < 4; i++) { const a = r() * TAU; parts.push(paint(jitter(place(blob(0.16 + r() * 0.1, 1), Math.cos(a) * 1.05, 0.05, Math.sin(a) * 0.8, 0, r() * 3, 0, 1, 0.55, 1), 0.05, i), cols[i % cols.length])); }
      return merge(parts);
    },
    slab(cols, r) { // плоская плита — вторая форма камня
      const g = jitter(place(new (T().CylinderGeometry)(1, 1.1, 0.35, HI() ? 9 : 7, 1), 0, 0.12, 0, 0.08, r() * TAU, 0.05, 1.3, 1, 0.8), 0.12, 5);
      return merge([paint(g, (px, py, pz, nx, ny) => C(cols[ny > 0.6 ? 2 : 1]))]);
    },
    lily(r) { // кувшинки: плоские листья с вырезом и пара цветков
      const THREE = T(), parts = [];
      for (let i = 0; i < 4; i++) { const g = new THREE.CircleGeometry(0.32 + r() * 0.12, 12, 0.35, TAU - 0.35); g.rotateX(-Math.PI / 2); place(g, (r() - 0.5) * 1.6, 0.01 * i, (r() - 0.5) * 1.0, 0, r() * TAU, 0); parts.push(paint(g, ['#3f7a3a', '#4f8a40', '#5f9a48'][i % 3])); }
      for (let i = 0; i < 2; i++) { const x = (r() - 0.5) * 1.2, z = (r() - 0.5) * 0.8; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; parts.push(paint(place(blob(0.07, 0), x + Math.cos(a) * 0.06, 0.06, z + Math.sin(a) * 0.06, 0, a, 0.5, 1, 0.5, 0.6), i ? '#ffffff' : '#ffb3d1')); } parts.push(paint(place(blob(0.04, 0), x, 0.09, z), '#ffe066')); }
      return merge(parts);
    },
    cactus(r) {
      const col = '#4f7a3a', parts = [paint(cyl(0.16, 0.18, 1.4, 8), col), paint(place(blob(0.16, 1), 0, 1.4, 0, 0, 0, 0, 1, 0.7, 1), col)];
      [[-1, 0.6, 0.45], [1, 0.8, 0.4]].forEach(([s, y, h]) => { parts.push(paint(place(cyl(0.09, 0.09, 0.3, 6), s * 0.15, y, 0, 0, 0, -s * Math.PI / 2), col)); parts.push(paint(place(cyl(0.09, 0.1, h, 6), s * 0.42, y - 0.05, 0), col)); parts.push(paint(place(blob(0.09, 0), s * 0.42, y + h - 0.05, 0), col)); });
      return merge(parts);
    },
    reeds(L, r) { const parts = []; for (let i = 0; i < 10; i++) { const x = (i / 9 - 0.5) * 0.9, h = 0.9 + r() * 0.5, g = blade(h, 0.03, (r() - 0.5) * 0.3); place(g, x, 0, (r() - 0.5) * 0.3, 0, r() * Math.PI, 0); parts.push(paint(g, L.leaf[i % 3])); if (i % 3 === 0) parts.push(paint(place(cyl(0.045, 0.045, 0.2, 5), x, h * 0.8, 0), '#7a5230')); } return merge(parts); },
    shells(r) { const parts = []; for (let i = 0; i < 6; i++) parts.push(paint(place(blob(0.12, 1), (r() - 0.5) * 1.1, 0.03, (r() - 0.5) * 0.6, 0, r() * 3, 0, 1, 0.45, 0.8), ['#ffe3d3', '#f7c6a8', '#fff3e0'][i % 3])); return merge(parts); },
    mushStem(r) { const parts = []; for (let i = 0; i < 5; i++) { const x = (r() - 0.5) * 0.9, z = (r() - 0.5) * 0.5, h = 0.18 + r() * 0.15; parts.push(paint(place(cyl(0.025, 0.035, h, 5), x, 0, z), '#e8e2c8')); } return merge(parts); },
  };
  DP.G3.KIT = KIT;

  // ——— стиль локаций ———
  const LOC = {
    jungle: { sky: ['#3f8fcc', '#a9d6e8', '#f2ead0'], fog: '#cfe2e2', hemi: ['#e8f4ff', '#5a7040'], sun: '#fff1d0', sunAt: [0.55, 0.32], ground: ['#7da65a', '#5f8f43', '#4a7a35', '#9cc06a', '#b7a56a'], far: '#7da67a', bed: '#3f6e60', shore: '#8a7a55',
      water: ['#5f9db0', '#2f6f86'], mount: { col: '#8fa8bc', lit: '#c9d9e0', snow: null }, L: { bark: '#5d4430', barkD: '#3f2d1f', leaf: ['#2b5534', '#3a6f40', '#52884e', '#86b067'] }, rock: ['#6f6a62', '#8d877c', '#b3ab9c'],
      trees: [['tree', 2], ['tree2', 2], ['palm', 2], ['treefern', 2]], moss: '#5f8a3a', lily: true, butterflies: ['#ffd43b', '#ff8fb1', '#7fd0ff'], grass: ['#3f6e30', '#5f8f43', '#8db55c'], flowers: ['#ff6b9a', '#ffd43b', '#ffffff'], volcano: true, pollen: '#fff7c8' },
    lagoon: { sky: ['#3a8fd0', '#9fd0ea', '#fbe8c8'], fog: '#d8ecf2', hemi: ['#f0f8ff', '#a08a60'], sun: '#fff4d8', sunAt: [-0.5, 0.3], ground: ['#e6d3a3', '#d6be86', '#c9ad78', '#f2e2bb', '#b99c66'], far: '#b9c8a8', bed: '#5fb0b8', shore: '#e6d3a3',
      water: ['#7fc8d4', '#2f8da5'], mount: { col: '#8aa4bf', lit: '#c4d4e2', snow: null }, L: { bark: '#8a6a48', barkD: '#6a4e34', leaf: ['#2e5a32', '#3f7a3c', '#5c9a4a', '#8ebf62'] }, rock: ['#8a7f70', '#a89c88', '#c8bca4'],
      trees: [['palm', 4], ['tree', 1], ['tree2', 1]], butterflies: ['#ffffff', '#ffd43b'], grass: ['#7a8a48', '#8a9a54', '#a8b066'], flowers: ['#ffffff', '#ffd43b'], islands: true, foam: true },
    canyon: { sky: ['#5a96cc', '#e9c9a0', '#f4a96e'], fog: '#f0cfaa', hemi: ['#fff0dc', '#9a6040'], sun: '#ffe2b0', sunAt: [0.2, 0.18], ground: ['#d9a06a', '#c9895a', '#b87a4c', '#e8b884', '#a86a44'], far: '#d8a880', bed: '#4f8a90', shore: '#c9895a',
      water: ['#7aa6a8', '#3f7c86'], mount: null, L: { bark: '#7a5a3a', barkD: '#5a402a', leaf: ['#3f5a2a', '#5a7a36', '#7d9a48', '#a8b060'] }, rock: ['#9a5a3a', '#b8714a', '#d08a5e'],
      trees: [['treefern', 1]], grass: ['#8a7a48', '#a8955a', '#c4ad6a'], flowers: ['#ffb3c1', '#ffd43b'], mesas: true, cactus: true, dust: '#f8dcb0' },
    glacier: { sky: ['#6aa4d4', '#c3dbea', '#eef3f6'], fog: '#e2ecf3', hemi: ['#ffffff', '#8aa0b4'], sun: '#ffffff', sunAt: [0.45, 0.35], ground: ['#eef4f8', '#dfe9f1', '#c6d5e2', '#ffffff', '#b8c9d8'], far: '#dce8f0', bed: '#4f86a6', shore: '#d8e4ee',
      water: ['#8fc4dc', '#4f86a6'], mount: { col: '#7f93ab', lit: '#b9c9d8', snow: '#f4f8fb', snowLine: 0.45 }, L: { bark: '#4a3a2e', leaf: ['#1f3a34', '#2c4f44', '#456e5e'] }, rock: ['#8aa0b0', '#aec2d0', '#dfeaf2'],
      trees: [['conifer', 1]], snowTrees: '#f2f7fb', grass: ['#8a7f5a', '#9a8f6a', '#b0a47a'], flowers: ['#d0e4ff'], snow: true, glacierTongue: true, floes: true },
    nightforest: { sky: ['#0c1a3a', '#24406e', '#4a5f88'], fog: '#2a3a5c', hemi: ['#5a6fa0', '#18222c'], sun: '#cfdcff', sunAt: [0.5, 0.42], ground: ['#2f4a4a', '#253c3e', '#1e3434', '#3a5a50', '#18282c'], far: '#22344a', bed: '#1a2a48', shore: '#2c3a40',
      water: ['#30486e', '#1a2a48'], mount: { col: '#2c3d62', lit: '#46608a', snow: null }, L: { bark: '#2a2a34', barkD: '#1a1a24', leaf: ['#142236', '#1d3048', '#2a4560', '#4a6a8a'] }, rock: ['#3d4250', '#545a6a', '#6a7082'],
      trees: [['conifer', 3], ['tree', 1], ['tree2', 1]], moss: '#2f5048', lily: true, grass: ['#12261f', '#1e3a34', '#2f5048'], flowers: ['#9fd8ff'], night: true, mush: true, fireflies: true },
  };
  LOC.custom = Object.assign({}, LOC.jungle, { custom: true, volcano: false });
  DP.G3.LOC = LOC;

  /** Построить мир локации. sc — 3D-сцена (даёт отображение логических координат в 3D: sc.M) */
  function build(sc) {
    const THREE = T(), M = sc.M, bgId = sc.bg.id, S = LOC[bgId] || LOC.jungle, q = QL(), mobile = q === 'low', hi = q === 'high';
    const N = (lo, mid, h) => (mobile ? lo : hi ? h : mid);
    const root = new THREE.Group(); root.name = 'nature';
    const r = rng(bgId.length * 977 + 13), disposables = [], anim = [];
    const own = (o) => { disposables.push(o); return o; };
    const W = sc.W, H = sc.H, hc = M.hc, Zb = M.Zb, far = M.far;
    const inPool = (X, Z) => { const p = M.logic(X, Z); return sc.inWater(p.x, p.y); };
    const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    /** холмы за полосой прогулок: плавно поднимаются и вдали закрывают горизонт лишь на пару градусов */
    const hill = (X, Z) => { const beyond = Math.max(0, (-Z - (-Zb) * 1.08) / (-Zb)); return sm(beyond / 3) * (0.35 + fbm(X * 0.02 + 3, Z * 0.02, 3)) * (hc * 0.12 + 0.012 * -Z); };
    const halfW = (Z) => M.Wu / 2 + 6 + Math.abs(Z) * M.tanH * 1.25 + M.Wu * 0.15;

    // 1) рельеф: сетка равномерна по строкам экрана (вблизи подробнее), вдали — холмы
    {
      const rows = [], nearZ = 18;
      const rFar = M.rowOfZ(-far * 0.995);
      const RN = N(44, 52, 64); for (let i = 0; i <= RN; i++) { const rr = 1.12 - (1.12 - Math.max(M.rh + 0.01, rFar)) * Math.pow(i / RN, 1.0); rows.push(M.Z(rr * H)); }
      rows.unshift(nearZ); for (let i = 1; i <= 10; i++) rows.push(rows[rows.length - 1] + (-far - rows[rows.length - 1]) * (i / 10));
      const cols = N(56, 80, 110), pos = [], col = [], idx = [], tmp = new THREE.Color();
      const g0 = S.ground.map(c => C(c)), farC = C(S.far), bed = C(S.bed), shore = C(S.shore);
      rows.forEach((Z, j) => {
        const hw = halfW(Z);
        for (let i = 0; i <= cols; i++) {
          const X = (i / cols * 2 - 1) * hw;
          const n = fbm(X * 0.08, Z * 0.08, 3), beyond = Math.max(0, (-Z - (-Zb) * 1.08) / (-Zb));
          let h = (n - 0.5) * 0.25;
          const side = Math.max(0, (Math.abs(X) - (M.Wu / 2 + 4)) / Math.max(10, M.Wu));
          h += hill(X, Z) + side * side * 6 * (0.6 + n);
          const pool = inPool(X, Z);
          let c;
          if (pool) { h = -0.9 - n * 0.4; c = tmp.copy(bed).lerp(shore, 0.15 * n); }
          else {
            const k = Math.floor(n * 4.99) % g0.length; c = tmp.copy(g0[k]).lerp(g0[(k + 1) % g0.length], fbm(X * 0.3, Z * 0.3, 2));
            if (inPool(X + 1.2, Z) || inPool(X - 1.2, Z) || inPool(X, Z + 1.2) || inPool(X, Z - 1.2)) { c.lerp(shore, 0.6); h = Math.min(h, -0.1); }
            c.lerp(farC, Math.min(0.85, beyond * 0.6 + side * 0.5));
          }
          pos.push(X, h, Z); col.push(c.r, c.g, c.b);
        }
      });
      const rw = cols + 1;
      for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < cols; i++) { const a = j * rw + i, b = a + 1, c = a + rw, d = c + 1; idx.push(a, b, c, b, d, c); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(own(g), own(new THREE.MeshLambertMaterial({ vertexColors: true }))); m.name = 'terrain'; m.visible = !S.custom; root.add(m);
    }
    // 2) вода: форма водоёма из 2D-контура → плоскость с бегущей рябью
    const ripple = own(canvasTex('ripple', 128, 128, (x, w, h) => {
      const img = x.createImageData(w, h), hgt = (i, j) => fbm(i / w * 6, j / h * 6, 3) * 0.6 + fbm(i / w * 14 + 3, j / h * 14, 2) * 0.4;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const dx = hgt((i + 1) % w, j) - hgt((i - 1 + w) % w, j), dy = hgt(i, (j + 1) % h) - hgt(i, (j - 1 + h) % h); const o = (j * w + i) * 4; img.data[o] = 128 + dx * 500; img.data[o + 1] = 128 + dy * 500; img.data[o + 2] = 255; img.data[o + 3] = 255; }
      x.putImageData(img, 0, 0);
    }));
    ripple.colorSpace = THREE.NoColorSpace; ripple.wrapS = ripple.wrapT = THREE.RepeatWrapping; ripple.repeat.set(0.12, 0.12);
    const waterMat = own(new THREE.MeshPhongMaterial({ color: C(S.water[0]).clone().lerp(C(S.water[1]), 0.35), specular: new THREE.Color(S.night ? '#8090c0' : '#ffffff'), shininess: 90, transparent: true, opacity: 0.84, normalMap: ripple, normalScale: new THREE.Vector2(0.45, 0.45), depthWrite: false }));
    (sc.reflections || []).forEach(rf => {
      const p = rf.p, pts = [];
      if (p.ellipse) for (let i = 0; i < 64; i++) { const a = i / 64 * TAU; pts.push([p.cx * W + Math.cos(a) * p.rx * W, p.cy * H + Math.sin(a) * p.ry * H]); }
      else { for (let i = 0; i <= 80; i++) { const x = -W * 2 + i / 80 * W * 5; pts.push([x, p.bank(x, 1, W, H)]); } for (let i = 80; i >= 0; i--) { const x = -W * 2 + i / 80 * W * 5; pts.push([x, Math.max(p.bank(x, 0, W, H), (M.rh + 0.012) * H)]); } }
      const shape = new THREE.Shape(pts.map(([x, y]) => { const q = M.ground(x, y); return new THREE.Vector2(q.X, -q.Z); }));
      const g = own(new THREE.ShapeGeometry(shape, 1)); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, waterMat); m.position.y = M.waterY; m.renderOrder = 1; m.name = 'water'; root.add(m);
      if (S.foam && !p.ellipse) { // пена прибоя вдоль берега
        const fp = []; for (let i = 0; i <= 120; i++) { const x = -W * 0.6 + i / 120 * W * 2.2, q = M.ground(x, p.bank(x, 1, W, H)), q2 = M.ground(x, p.bank(x, 1, W, H) - H * 0.006); fp.push(q.X, 0.02, q.Z, q2.X, 0.02, q2.Z); }
        const fi = []; for (let i = 0; i < 120; i++) { const a = i * 2; fi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        const fg = own(new THREE.BufferGeometry()); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setIndex(fi);
        const fm = own(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false })); const foam = new THREE.Mesh(fg, fm); foam.position.y = M.waterY; root.add(foam);
        anim.push((t) => { fm.opacity = 0.35 + 0.3 * Math.sin(t * 1.6); });
      }
    });
    anim.push((t) => { ripple.offset.set(t * 0.012, t * 0.007); });

    // 3) небо: сфера с градиентом, солнце/луна, облака, звёзды
    const sky = new THREE.Group(); sky.name = 'sky'; root.add(sky);
    const skyGeo = own(new THREE.SphereGeometry(far * 0.92, mobile ? 24 : 36, mobile ? 12 : 18)), skyMat = own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    const skyMesh = new THREE.Mesh(skyGeo, skyMat); skyMesh.renderOrder = -10; sky.add(skyMesh);
    const paintSky = (cols) => {
      const p = skyGeo.attributes.position, arr = new Float32Array(p.count * 3), a = C(cols[0]), b = C(cols[1]), c = C(cols[2]), t = new THREE.Color();
      for (let i = 0; i < p.count; i++) { const e = p.getY(i) / (far * 0.92); if (e > 0.06) t.copy(b).lerp(a, Math.min(1, (e - 0.06) / 0.5)); else t.copy(c).lerp(b, Math.max(0, (e + 0.05) / 0.11)); arr[i * 3] = t.r; arr[i * 3 + 1] = t.g; arr[i * 3 + 2] = t.b; }
      skyGeo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    };
    paintSky(S.sky);
    const sunTex = radialTex('sun', [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,250,230,1)'], [0.2, 'rgba(255,240,200,.55)'], [0.5, 'rgba(255,230,180,.12)'], [1, 'rgba(255,230,180,0)']], 128);
    const sunSpr = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: sunTex, color: S.sun, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending })));
    const sunDir = new THREE.Vector3(S.sunAt[0], S.sunAt[1], -1).normalize();
    sunSpr.position.copy(sunDir).multiplyScalar(far * 0.85); sunSpr.scale.setScalar(far * (S.night ? 0.16 : 0.22)); sunSpr.renderOrder = -9; sky.add(sunSpr);
    let moon = null;
    if (S.night) {
      const mt = own(canvasTex('moon', 128, 128, (x) => { x.fillStyle = '#f6f3e2'; x.beginPath(); x.arc(64, 64, 40, 0, TAU); x.fill(); x.fillStyle = 'rgba(200,196,170,.55)'; [[50, 52, 9], [78, 72, 6], [60, 82, 5], [76, 48, 4]].forEach(([a, b, c]) => { x.beginPath(); x.arc(a, b, c, 0, TAU); x.fill(); }); }));
      moon = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: mt, fog: false, depthWrite: false, transparent: true }))); moon.position.copy(sunDir).multiplyScalar(far * 0.84); moon.scale.setScalar(far * 0.07); moon.renderOrder = -8; sky.add(moon);
    }
    const starsGeo = own(new THREE.BufferGeometry()); { const sp = []; for (let i = 0; i < N(220, 380, 520); i++) { const a = r() * TAU, e = 0.04 + Math.pow(r(), 0.7) * 1.3; sp.push(Math.cos(a) * Math.cos(e) * far * 0.88, Math.sin(e) * far * 0.88, Math.sin(a) * Math.cos(e) * far * 0.88); } starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); }
    const starsMat = own(new THREE.PointsMaterial({ color: '#fffff0', size: mobile ? 2.2 : 1.8, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false, opacity: 0.9 }));
    const stars = new THREE.Points(starsGeo, starsMat); stars.renderOrder = -9; stars.visible = !!S.night; sky.add(stars);
    const cloudTex = canvasTex('cloud', 256, 128, (x, w, h) => { const R = rng(7); for (let i = 0; i < 14; i++) { const cx = w * (0.18 + R() * 0.64), cy = h * (0.45 + R() * 0.25), rr = h * (0.14 + R() * 0.16); const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.7, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rr, 0, TAU); x.fill(); } });
    const cloudMat = own(new THREE.SpriteMaterial({ map: cloudTex, fog: false, depthWrite: false, transparent: true, opacity: S.night ? 0.25 : 0.92, color: S.night ? '#6a7aa0' : '#ffffff' }));
    const clouds = []; for (let i = 0; i < (S.custom ? 0 : 6); i++) { const c = new THREE.Sprite(cloudMat); const a = (r() - 0.5) * 1.6, e = 0.1 + r() * 0.22, d = far * (0.6 + r() * 0.2); c.position.set(Math.sin(a) * d, Math.tan(e) * d + hc, -Math.cos(a) * d); c.scale.set(d * 0.32, d * 0.16, 1); c.renderOrder = -8; c.userData.v = (0.4 + r()) * far * 0.002; sky.add(c); clouds.push(c); }
    anim.push((t, dt) => { clouds.forEach(c => { c.position.x += c.userData.v * dt; if (c.position.x > far * 0.7) c.position.x = -far * 0.7; }); });

    // 4) горы вдали (настоящий рельеф с плоской заливкой), вулкан, столовые горы, ледник
    const solid = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
    if (S.mount && !S.custom) {
      [[0.62, 0.17, 7], [0.42, 0.12, 9]].forEach(([dk, ek, seed], li) => {
        const D = far * dk, cols = mobile ? 70 : 110, rowsN = 7, span = D * M.tanH * 2.6 + M.Wu * 1.5, pos = [], col = [], idx = [], tmp = new THREE.Color();
        const base = C(S.mount.col).clone(), lit = C(S.mount.lit), snow = S.mount.snow ? C(S.mount.snow) : null;
        if (li === 1) base.lerp(C(S.L.leaf[0]), S.night ? 0.2 : 0.35);
        for (let j = 0; j <= rowsN; j++) for (let i = 0; i <= cols; i++) {
          const u = i / cols, v = j / rowsN, X = (u - 0.5) * span, Z = -D - (v - 0.5) * D * 0.25;
          const ridge = 1 - Math.abs(fbm(u * 6 + seed, seed, 4) * 2 - 1), env = Math.sin(v * Math.PI);
          const Hh = (hc + D * Math.tan(ek) * (0.35 + 0.65 * ridge)) * env * (0.75 + 0.25 * noise2(u * 3, seed));
          pos.push(X, Hh - 2, Z);
          const e = Hh / (hc + D * Math.tan(ek));
          tmp.copy(base).lerp(lit, Math.max(0, e - 0.3) * 0.8); if (snow && e > S.mount.snowLine) tmp.lerp(snow, Math.min(1, (e - S.mount.snowLine) * 4));
          col.push(tmp.r, tmp.g, tmp.b);
        }
        const rw = cols + 1; for (let j = 0; j < rowsN; j++) for (let i = 0; i < cols; i++) { const a = j * rw + i, b = a + 1, c = a + rw, d = c + 1; idx.push(a, b, c, b, d, c); }
        let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g = g.toNonIndexed(); g.computeVertexNormals();
        const m = new THREE.Mesh(own(g), solid); m.name = 'mountains'; root.add(m);
      });
    }
    let smoke = null, lava = null;
    if (S.volcano) {
      const D = far * 0.36, Hv = hc + D * Math.tan(0.2), Rb = Hv * 1.25, prof = [];
      for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(Rb * (1 - t) * (1 - 0.35 * Math.sin(t * Math.PI)) + Rb * 0.08, Hv * t)); }
      prof.push(new THREE.Vector2(Rb * 0.06, Hv * 0.97));
      const g = jitter(new THREE.LatheGeometry(prof, 14).toNonIndexed(), Hv * 0.02, 3);
      paint(g, (x, y, z, nx) => { const e = y / Hv, c = new THREE.Color('#9b7f6e').lerp(C('#4f3d36'), 0.4 + nx * 0.3); if (e > 0.9) c.lerp(C('#ff7a2a'), (e - 0.9) * 6); if (e < 0.25) c.lerp(C('#5f7a4a'), (0.25 - e) * 3); return c; });
      const vol = new THREE.Mesh(own(g), solid); vol.position.set(-M.Wu * 0.18 - D * 0.15, -1, -D); root.add(vol);
      const glowT = radialTex('lava', [[0, 'rgba(255,170,80,.95)'], [0.4, 'rgba(255,120,40,.4)'], [1, 'rgba(255,100,30,0)']]);
      lava = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: glowT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
      lava.position.set(vol.position.x, Hv * 0.98, -D + 1); lava.scale.setScalar(Hv * 0.5); root.add(lava);
      const smT = radialTex('smoke', [[0, 'rgba(150,145,155,.85)'], [0.6, 'rgba(140,135,150,.45)'], [1, 'rgba(140,135,150,0)']]);
      smoke = []; for (let i = 0; i < 7; i++) { const s = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: smT, transparent: true, depthWrite: false, fog: true }))); s.userData.ph = i / 7; root.add(s); smoke.push(s); }
      anim.push((t) => {
        lava.material.opacity = 0.65 + 0.3 * Math.sin(t * 1.3);
        smoke.forEach(s => { const k = (t * 0.05 + s.userData.ph) % 1; s.position.set(vol.position.x + k * Hv * 0.5 + Math.sin(k * 6 + s.userData.ph * 9) * Hv * 0.05, Hv * (1 + k * 0.9), -D); s.scale.setScalar(Hv * (0.15 + k * 0.55)); s.material.opacity = Math.sin(k * Math.PI) * 0.8; });
      });
    }
    if (S.mesas) {
      const mk = (X, Z, rad, Hh, cols, seed) => {
        const R = rng(seed), seg = 9, g = new THREE.CylinderGeometry(rad * 0.9, rad, Hh, seg, 5, false);
        const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), k = 1 + (noise2(a * 1.6 + seed, p.getY(i) / Hh * 2) - 0.5) * 0.35; if (Math.abs(p.getY(i)) < Hh / 2 - 0.001) { p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } }
        const gg = g.toNonIndexed(); gg.computeVertexNormals(); g.dispose();
        paint(gg, (x, y, z, nx, ny) => { const e = (y + Hh / 2) / Hh, band = Math.floor(e * 7 + noise2(x * 0.05, z * 0.05)); const c = new THREE.Color(cols[band % 3]); if (ny > 0.9) c.copy(C(cols[3])); return c; });
        const m = new THREE.Mesh(own(gg), solid); m.position.set(X, Hh / 2 - 1.5, Z); root.add(m); void R;
      };
      const farC = ['#c99a8a', '#e6c0ac', '#a77a72', '#e0b080'], midC = ['#c4724a', '#e8a070', '#8a4a34', '#e0b080'], nearC = ['#a85a3a', '#d98a5a', '#6a3424', '#d9a070'];
      [[-0.4, 0.62, 0.06, 0.1], [0.05, 0.66, 0.05, 0.07], [0.45, 0.6, 0.07, 0.12], [0.85, 0.64, 0.05, 0.08], [-0.85, 0.64, 0.06, 0.09]].forEach(([u, dk, rk, ek], i) => { const D = far * dk; mk(u * D * M.tanH * 1.6, -D, D * rk, hc + D * Math.tan(ek), farC, 30 + i); });
      [[-0.3, 0.32, 0.1, 0.16], [0.35, 0.3, 0.08, 0.12]].forEach(([u, dk, rk, ek], i) => { const D = far * dk; mk(u * D * M.tanH * 1.6, -D, D * rk, hc + D * Math.tan(ek), midC, 40 + i); });
      [[-1, 0.13, 0.18, 0.3], [1, 0.14, 0.16, 0.26]].forEach(([s, dk, rk, ek], i) => { const D = far * dk, X = s * (M.Wu / 2 + D * rk * 0.6); mk(X, -D, D * rk, hc + D * Math.tan(ek), nearC, 50 + i); });
    }
    if (S.glacierTongue) {
      const D = far * 0.4, z0 = M.ground(W * 0.5, H * 0.61).Z, pos = [], col = [], top = hc + D * Math.tan(0.1);
      const pts = 8; for (let i = 0; i <= pts; i++) { const v = i / pts, Z = -D + (z0 + D) * v, w = (0.05 + v * 0.22) * D, Y = top * (1 - v) * (1 - v) + 0.05; pos.push(-w, Y, Z, w, Y, Z); const c = C('#e9f3fa').clone().lerp(C('#bcd8ea'), v); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
      const idx = []; for (let i = 0; i < pts; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = own(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, own(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }))); root.add(m);
    }
    if (S.floes && sc.reflections && sc.reflections[0]) {
      const p = sc.reflections[0].p; for (let i = 0; i < 7; i++) { const a = r() * TAU, d = Math.sqrt(r()) * 0.75, q = M.ground(p.cx * W + Math.cos(a) * p.rx * W * d, p.cy * H + Math.sin(a) * p.ry * H * d), s = 0.6 + r() * 1.2; const g = paint(jitter(place(new THREE.CylinderGeometry(s, s * 1.05, 0.18, 7, 1).toNonIndexed(), 0, 0, 0, 0, r() * 3, 0, 1.6, 1, 1), 0.08, i), (x, y) => C(y > 0.05 ? '#f4f9fc' : '#a8c8e0')); const m = new THREE.Mesh(own(g), solid); m.position.set(q.X, M.waterY + 0.02, q.Z); root.add(m); anim.push((t) => { m.position.y = M.waterY + 0.03 * Math.sin(t * 1.3 + i); }); }
    }
    if (S.islands) {
      [[-0.35, 0.55], [0.4, 0.6]].forEach(([u, dk], i) => { const D = far * dk * 0.45, Rr = D * 0.09; const g = paint(jitter(place(new THREE.SphereGeometry(Rr, 10, 6, 0, TAU, 0, Math.PI / 2).toNonIndexed(), 0, 0, 0, 0, 0, 0, 1.6, 0.35, 1), Rr * 0.05, i), (x, y, z, nx, ny) => C(y < Rr * 0.06 ? '#e6d3a3' : ny > 0.6 ? '#6a9670' : '#4f7e5e')); const m = new THREE.Mesh(own(g), solid); m.position.set(u * D * M.tanH * 2, -0.4, -D); root.add(m); });
    }

    // 5) растительность: деревья вдали и по краям мира, трава и цветы в полосе, папоротники на переднем плане
    const vegTree = own(windMat(mobile ? 0.004 : 0.005)), vegSoft = own(windMat(0.12)), vegStill = own(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    const inst = (geo, mat, list, name) => {
      if (!list.length) { geo.dispose(); return null; }
      own(geo); const m = new THREE.InstancedMesh(geo, mat, list.length), mx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
      list.forEach((it, i) => { e.set(0, it.ry || 0, it.rz || 0); q.setFromEuler(e); mx.compose(v.set(it.X, it.Y || 0, it.Z), q, s.set(it.s, it.s * (it.sy || 1), it.s)); m.setMatrixAt(i, mx); c.setRGB(1, 1, 1).multiplyScalar(it.tint || 1); m.setColorAt(i, c); });
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.name = name || 'veg'; m.frustumCulled = false; root.add(m); return m;
    };
    const ok = (X, Z, pad) => !inPool(X, Z) && !inPool(X + pad, Z) && !inPool(X - pad, Z) && !inPool(X, Z - pad);
    const scatter = (n, zr, xr, fn) => { const out = []; for (let i = 0, tries = 0; out.length < n && tries < n * 6; tries++) { const Z = zr[0] + (zr[1] - zr[0]) * r(), hw = xr(Z), X = (r() * 2 - 1) * hw; const it = fn(X, Z); if (it) out.push(it); } return out; };
    if (!S.custom) {
      const hAt = (X, Z) => hill(X, Z);
      const zBand0 = M.Z(sc.bg.zones.ground[0] * H), zBand1 = M.Z(sc.bg.zones.ground[1] * H);
      // деревья: за полосой прогулок — лес; по краям мира — рамка
      const nT = N(48, 66, 84), kinds = S.trees, tot = kinds.reduce((a, k) => a + k[1], 0);
      kinds.forEach(([kind, wgt], ki) => {
        const n = Math.round(nT * wgt / tot);
        const gapW = M.Wu * (S.volcano || S.glacierTongue ? 0.2 : 0.1);
        const back = scatter(Math.round(n * 0.75), [zBand0 * 1.15 - 3, -far * 0.3], (Z) => halfW(Z) * 0.9, (X, Z) => ok(X, Z, 3) && (Math.abs(X - M.Wu * 0.05) > gapW * (1 - Math.min(1, (-Z - -zBand0) / (-zBand0 * 2))) || r() < 0.15) ? { X, Z, Y: hAt(X, Z) - 0.1, s: (1.5 + r() * 1.1) * (1 + (-Z - (-zBand0)) / (-zBand0) * 0.7) * (kind === 'palm' ? 1.3 : kind === 'conifer' ? 1.6 : 1), ry: r() * TAU, tint: 0.85 + r() * 0.3 } : null);
        const sides = scatter(Math.round(n * 0.25), [zBand1 + 4, zBand0], () => M.Wu / 2 + 10, (X, Z) => Math.abs(X) > M.Wu / 2 - 2 && ok(X, Z, 3) ? { X, Z, s: (2 + r() * 0.8) * (kind === 'conifer' ? 1.4 : 1), ry: r() * TAU, tint: 0.9 + r() * 0.2 } : null);
        const list = back.concat(sides);
        let geo;
        if (kind === 'palm') geo = KIT.palm(S.L, rng(5 + ki), 0.18); else if (kind === 'tree2') geo = KIT.tree2(S.L, rng(18)); else if (kind === 'treefern') geo = KIT.treefern(S.L, rng(6)); else if (kind === 'conifer') geo = KIT.conifer(S.L, rng(7), S.snowTrees); else geo = KIT.tree(S.L, rng(8));
        inst(geo, vegTree, list, 'trees-' + kind);
      });
      // кусты и камни для красоты (не прячутся) — по краям полосы и вдали
      const bushes = scatter(N(32, 46, 60), [zBand1 + 2, zBand0 * 1.4], (Z) => halfW(Z) * 0.8, (X, Z) => (Z < zBand0 || Math.abs(X) > M.Wu * 0.42) && ok(X, Z, 1.5) ? { X, Z, Y: hAt(X, Z), s: 0.9 + r() * 1.3, ry: r() * TAU, tint: 0.85 + r() * 0.3 } : null);
      inst(KIT.bush(S.L, rng(9), bgId === 'glacier' ? 'snowbush' : bgId === 'canyon' ? 'dry' : bgId === 'jungle' ? 'berry' : 'bush'), vegTree, bushes, 'bushes');
      const rocks = scatter(N(14, 22, 30), [zBand1, zBand0 * 1.6], (Z) => halfW(Z) * 0.8, (X, Z) => ok(X, Z, 1) ? { X, Z, Y: hAt(X, Z) - 0.15, s: 0.4 + r() * 1.1, ry: r() * TAU, tint: 0.9 + r() * 0.2 } : null);
      inst(KIT.rock(S.rock, rng(10), bgId === 'glacier', S.moss), solid, rocks, 'rocks');
      if (!mobile) { const slabs = scatter(N(0, 8, 14), [zBand1, zBand0 * 1.4], (Z) => halfW(Z) * 0.8, (X, Z) => ok(X, Z, 1.2) && (Z < zBand0 || Math.abs(X) > M.Wu * 0.38) ? { X, Z, Y: hAt(X, Z) - 0.05, s: 0.5 + r() * 0.8, ry: r() * TAU, tint: 0.9 + r() * 0.2 } : null); inst(KIT.slab(S.rock, rng(19)), solid, slabs, 'slabs'); }
      // трава: в полосе и перед ней (шевелится от ветра)
      const grass = scatter(N(480, 700, 1000), [zBand1 + 8, zBand0 * 1.25], (Z) => halfW(Z) * 0.75, (X, Z) => ok(X, Z, 0.4) ? { X, Z, Y: hAt(X, Z), s: 0.7 + r() * 0.9, ry: r() * TAU, tint: 0.8 + r() * 0.4 } : null);
      inst(KIT.grass(S.grass, rng(11)), vegSoft, grass, 'grass');
      const flowers = scatter(N(48, 80, 110), [zBand1, zBand0], (Z) => halfW(Z) * 0.6, (X, Z) => ok(X, Z, 0.6) ? { X, Z, s: 0.8 + r() * 0.6, ry: r() * TAU } : null);
      inst(KIT.flowers(S.L, rng(12), S.flowers), vegSoft, flowers, 'flowers');
      // большие листья на переднем плане (как рамка кадра)
      const front = []; for (let X = -M.Wu / 2 - 8; X < M.Wu / 2 + 8; X += 6 + r() * 5) { const Z = M.Z(H * (1.03 + r() * 0.05)); front.push({ X, Z, s: 2.2 + r() * 1.4, ry: r() * TAU }); }
      inst(bgId === 'canyon' || bgId === 'glacier' ? KIT.grass(S.grass, rng(13)) : KIT.fern(S.L, rng(13)), vegSoft, front, 'front');
      const ferns = scatter(N(14, 26, 36), [zBand1, zBand0 * 1.2], (Z) => halfW(Z) * 0.8, (X, Z) => (Z < zBand0 || Math.abs(X) > M.Wu * 0.4) && ok(X, Z, 1) && bgId !== 'canyon' && bgId !== 'glacier' ? { X, Z, s: 1 + r() * 0.8, ry: r() * TAU } : null);
      inst(KIT.fern(S.L, rng(14)), vegSoft, ferns, 'ferns');
      if (S.cactus) { const cs = scatter(mobile ? 10 : 16, [zBand1, zBand0 * 1.6], (Z) => halfW(Z) * 0.8, (X, Z) => (Z < zBand0 || Math.abs(X) > M.Wu * 0.42) && ok(X, Z, 1) ? { X, Z, s: 1 + r() * 1.4, ry: r() * TAU } : null); inst(KIT.cactus(rng(15)), solid, cs, 'cactus'); }
      if (S.mush) { // светящиеся грибы
        const ms = scatter(mobile ? 12 : 20, [zBand1, zBand0 * 1.1], (Z) => halfW(Z) * 0.7, (X, Z) => ok(X, Z, 0.6) ? { X, Z, s: 1 + r() * 0.8, ry: r() * TAU } : null);
        inst(KIT.mushStem(rng(16)), vegStill, ms, 'mush-stem');
        const caps = []; ms.forEach(m => { const R = rng(16); for (let i = 0; i < 5; i++) { const x = (R() - 0.5) * 0.9, z = (R() - 0.5) * 0.5, h = 0.18 + R() * 0.15; const cs = Math.cos(m.ry), sn = Math.sin(m.ry); caps.push({ X: m.X + (x * cs + z * sn) * m.s, Z: m.Z + (-x * sn + z * cs) * m.s, Y: h * m.s, s: m.s * 0.11, sy: 0.55 }); } });
        const capGeo = new THREE.SphereGeometry(1, 8, 4, 0, TAU, 0, Math.PI / 2);
        inst(capGeo, own(new THREE.MeshBasicMaterial({ color: '#7fe0d0' })), caps, 'mush-cap');
        const gt = radialTex('mushglow', [[0, 'rgba(127,255,224,.55)'], [1, 'rgba(127,255,224,0)']]);
        ms.slice(0, 10).forEach((m, i) => { const s = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: gt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))); s.position.set(m.X, 0.3 * m.s, m.Z); s.scale.setScalar(2.2 * m.s); root.add(s); anim.push((t) => { s.material.opacity = 0.6 + 0.3 * Math.sin(t * 1.5 + i); }); });
      }
      // кувшинки в водоёмах
      if (S.lily && sc.reflections) {
        const lil = [];
        sc.reflections.forEach(rf => { const p = rf.p; if (!p.ellipse) return; for (let i = 0; i < N(3, 5, 7); i++) { const a = r() * TAU, d = 0.25 + Math.sqrt(r()) * 0.55, x = p.cx * W + Math.cos(a) * p.rx * W * d, y = p.cy * H + Math.sin(a) * p.ry * H * d; if (!sc.inWater(x, y)) continue; const q2 = M.ground(x, y); lil.push({ X: q2.X, Z: q2.Z, Y: M.waterY + 0.03, s: 0.8 + r() * 0.6, ry: r() * TAU }); } });
        inst(KIT.lily(rng(20)), vegStill, lil, 'lilies');
      }
      // бабочки днём: два крылышка машут, летают петлями над травой
      if (S.butterflies && !S.night) {
        const nb = N(5, 9, 14), wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.32, 0.05, 0.22, 0.3, 0.02, -0.2, 0, 0, 0, -0.32, 0.05, 0.22, -0.3, 0.02, -0.2], 3)); wg.computeVertexNormals();
        const bm = own(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), wingsL = [], flyers = [];
        const mkWing = (side) => { const g = own(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(side > 0 ? [0, 0, 0, 0.32, 0, 0.22, 0.3, 0, -0.2] : [0, 0, 0, -0.32, 0, 0.22, -0.3, 0, -0.2], 3)); return g; };
        wg.dispose();
        const gL = mkWing(-1), gR = mkWing(1);
        for (let i = 0; i < nb; i++) {
          const b = new THREE.Group(), col = S.butterflies[i % S.butterflies.length], m = own(bm.clone()); m.color.set(col);
          const L = new THREE.Mesh(gL, m), R2 = new THREE.Mesh(gR, m); b.add(L); b.add(R2); wingsL.push([L, R2]);
          b.userData = { a: r() * TAU, rr: 2 + r() * 4, cx: (r() - 0.5) * M.Wu * 0.8, cz: zBand0 + (zBand1 - zBand0) * (0.15 + r() * 0.7), sp: 0.3 + r() * 0.4, ph: r() * 9 };
          b.scale.setScalar(0.5 + r() * 0.3); root.add(b); flyers.push(b);
        }
        anim.push((t) => flyers.forEach((b, i) => {
          const u = b.userData, a = u.a + t * u.sp; b.position.set(u.cx + Math.cos(a) * u.rr, 0.8 + Math.sin(t * 1.3 + u.ph) * 0.5 + Math.sin(a * 2) * 0.3, u.cz + Math.sin(a) * u.rr * 0.5);
          b.rotation.y = -a; const f = Math.sin(t * 16 + u.ph) * 0.9; wingsL[i][0].rotation.z = -f; wingsL[i][1].rotation.z = f;
        }));
      }
    } else if (sc.customImg) { // свой фон — фото позади всего
      const D = far * 0.8, upp = M.kX * D / M.dzMid, tex = own(new THREE.Texture(sc.customImg)); tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
      const iw = sc.customImg.naturalWidth, ih = sc.customImg.naturalHeight, k = Math.max(W / iw, H / ih), pw = iw * k * upp, ph = ih * k * upp;
      const m = new THREE.Mesh(own(new THREE.PlaneGeometry(pw, ph)), own(new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: false })));
      const dir = new THREE.Vector3(0, -Math.sin(M.p0), -Math.cos(M.p0)); m.position.set(0, M.hc, 0).addScaledVector(dir, D); m.rotation.x = -M.p0; m.renderOrder = -5; root.add(m);
      skyMesh.visible = false; sunSpr.visible = false;
    }

    // 6) частицы: снег, светлячки, пыльца/пыль
    let pts = null;
    const ptsKind = S.snow ? 'snow' : S.fireflies ? 'fire' : (S.pollen || S.dust) ? 'dust' : null;
    if (ptsKind && !S.custom) {
      const n = ptsKind === 'snow' ? N(160, 300, 420) : ptsKind === 'fire' ? N(28, 40, 56) : N(30, 60, 90), g = own(new THREE.BufferGeometry()), arr = new Float32Array(n * 3), seeds = [];
      for (let i = 0; i < n; i++) seeds.push([r(), r(), r(), r()]);
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const tex = ptsKind === 'fire' ? radialTex('firefly', [[0, 'rgba(240,255,170,1)'], [0.3, 'rgba(230,255,150,.6)'], [1, 'rgba(230,255,150,0)']]) : radialTex('flake', [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]);
      const mat = own(new THREE.PointsMaterial({ map: tex, size: ptsKind === 'snow' ? 0.35 : ptsKind === 'fire' ? 0.7 : 0.18, transparent: true, depthWrite: false, color: ptsKind === 'dust' ? (S.pollen || S.dust) : '#ffffff', blending: ptsKind === 'fire' ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: ptsKind === 'dust' ? 0.7 : 1 }));
      pts = new THREE.Points(g, mat); pts.frustumCulled = false; root.add(pts);
      anim.push((t, dt, cam) => {
        const cx = cam.target.x, z0 = M.Z(sc.bg.zones.ground[1] * H) + 4, z1 = M.Z(0.6 * H), span = Math.abs(z1 - z0), wx = M.Wu * 0.5;
        for (let i = 0; i < n; i++) {
          const s = seeds[i]; let X, Y, Z;
          if (ptsKind === 'snow') { const fall = (s[1] * 30 + t * (2 + s[2] * 1.5)) % 30; X = cx + (s[0] - 0.5) * wx * 2 + Math.sin(t * 0.7 + s[3] * 9) * 1.2; Z = z0 - s[3] * span; Y = 30 - fall; Y *= (1 + (-Z) / (-z0) * 0.6); }
          else if (ptsKind === 'fire') { X = cx + (s[0] - 0.5) * wx * 1.6 + Math.sin(t * 0.3 + s[1] * 9) * 3; Z = z0 - s[3] * span * 0.8 + Math.cos(t * 0.25 + s[2] * 7) * 2; Y = 0.6 + s[2] * 3 + Math.sin(t * 0.8 + s[0] * 9) * 0.6; }
          else { X = cx + (s[0] - 0.5) * wx * 2 + Math.sin(t * 0.2 + s[1] * 9) * 4; Z = z0 - s[3] * span; Y = 1 + s[2] * 8 + Math.sin(t * 0.5 + s[0] * 7); }
          arr[i * 3] = X; arr[i * 3 + 1] = Y; arr[i * 3 + 2] = Z;
        }
        g.attributes.position.needsUpdate = true;
        if (ptsKind === 'fire') mat.opacity = 0.75 + 0.25 * Math.sin(t * 1.2);
      });
    }

    // свет и туман
    const hemi = new THREE.HemisphereLight(S.hemi[0], S.hemi[1], S.night ? 1.55 : 1.65); root.add(hemi);
    const dir = new THREE.DirectionalLight(S.night ? '#b8c8ff' : S.sun, S.night ? 1.2 : 2.0); dir.position.set(0.45, 1, 0.65).multiplyScalar(50); root.add(dir); root.add(dir.target);
    const fog = new THREE.Fog(S.fog, -Zb * 1.4, far * 0.95);

    /** Время суток: вечер — тёплый свет, ночь — синий, звёзды, луна, светлячки */
    let todKey = null;
    function setTod(tn) {
      const key = S.night ? 'night' : tn ? tn.c : 'day'; if (key === todKey) return; todKey = key;
      if (S.night || S.custom) return;
      const night = tn && tn.night, warm = tn && !night ? C(tn.c) : null;
      const sk = S.sky.map(c => { const k = C(c).clone(); if (night) k.lerp(C('#0c1a3a'), 0.82); else if (warm) k.lerp(C(tn.c === '#ffc79a' ? '#ff9a5a' : '#ffc7b0'), 0.4); return '#' + k.getHexString(); });
      paintSky(sk);
      hemi.intensity = night ? 0.75 : 1.65; dir.intensity = night ? 0.6 : 2.0;
      hemi.color.set(night ? '#6a7ab0' : warm ? C(S.hemi[0]).clone().lerp(warm, 0.5) : S.hemi[0]);
      dir.color.set(night ? '#a8b8ff' : warm ? C(S.sun).clone().lerp(warm, 0.7) : S.sun);
      fog.color.set(night ? '#1c2a48' : warm ? C(S.fog).clone().lerp(warm, 0.45) : S.fog);
      stars.visible = !!night; sunSpr.material.opacity = night ? 0.25 : 1; cloudMat.opacity = night ? 0.25 : 0.92; cloudMat.color.set(night ? '#6a7aa0' : warm ? '#ffe0c8' : '#ffffff');
      sc._todFire = !!night;
    }

    return {
      root, fog, hemi, dir, setTod, sky,
      bg: S.custom ? new THREE.Color('#123') : null,
      update(t, dt, cam) { TIME.value = t; sky.position.set(cam.position.x, 0, cam.position.z); anim.forEach(f => f(t, dt, cam)); },
      dispose() { root.removeFromParent(); disposables.forEach(d => { try { d.dispose(); } catch (e) { /* ignore */ } }); root.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); }
    };
  }
  DP.Nature3D = { build, LOC };
})();
