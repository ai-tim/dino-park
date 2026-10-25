/* Динопарк — объёмные мелочи мира: австралопитеки, зверьки, яйца, подарки, корм, мячи, гнёзда, стоянка
 * (костёр с живым пламенем и светом, шалаш), кусты и камни для пряток, мягкие тени.
 * Простые фигуры, склеенные в одну геометрию с цветами вершин — мало вызовов отрисовки, почти без текстур. */
window.DP = window.DP || {};
(function () {
  const TAU = Math.PI * 2, T = () => window.THREE, G = () => DP.G3;
  const geoCache = {}; let mat = null, matD = null, glowMat = {}, shadowMat = null;
  function material() { if (!mat) mat = new (T().MeshLambertMaterial)({ vertexColors: true }); return mat; }
  function materialDouble() { if (!matD) matD = new (T().MeshLambertMaterial)({ vertexColors: true, side: T().DoubleSide }); return matD; }
  function cached(key, fn) { if (!geoCache[key]) { geoCache[key] = fn(); if (geoCache[key].userData) geoCache[key].userData.cached = true; } return geoCache[key]; }
  const ell = (rx, ry, rz, x, y, z, col, d) => G().paint(G().place(new (T().IcosahedronGeometry)(1, d == null ? 1 : d), x, y, z, 0, 0, 0, rx, ry, rz), col);
  const sph = (r, x, y, z, col) => G().paint(G().place(new (T().SphereGeometry)(r, 8, 6), x, y, z), col);
  /** Конечность: цилиндр от шарнира вниз на длину len (шарнир в начале координат) */
  const limb = (r, len, col, foot) => { const p = [G().paint(G().place(new (T().CylinderGeometry)(r, r * 0.85, len, 6, 1), 0, -len / 2, 0), col)]; if (foot) p.push(G().paint(G().place(new (T().SphereGeometry)(r * 1.15, 6, 4), r * 0.4, -len, 0, 0, 0, 0, 1.5, 0.6, 1), foot)); return G().merge(p); };
  function mesh(geo, m) { const o = new (T().Mesh)(geo, m || material()); return o; }
  function glow(col, size) {
    const THREE = T(), key = col; if (!glowMat[key]) glowMat[key] = new THREE.SpriteMaterial({ map: G().radialTex('glow', [[0, 'rgba(255,255,255,.9)'], [0.35, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]), color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(glowMat[key]); s.scale.setScalar(size || 1); return s;
  }

  // ——— австралопитек (рост ≈ 1.45 в единицах «s») ———
  const FUR = '#6b4a2f', FURD = '#4e3420', SKIN = '#d2a07a';
  function ape(c) {
    const THREE = T(), sk = (c.src && c.src.sk) || [], chief = sk.includes('chief');
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    body.add(mesh(cached('ape-body' + (chief ? 'c' : ''), () => {
      const p = [ell(0.22, 0.31, 0.19, 0, 0.8, 0, FUR), ell(0.13, 0.2, 0.1, 0.1, 0.76, 0, '#8a6a4a'),
        ell(0.19, 0.19, 0.18, 0.03, 1.2, 0, FUR), ell(0.11, 0.12, 0.13, 0.12, 1.16, 0, SKIN),
        G().paint(G().place(new (T().BoxGeometry)(0.06, 0.035, 0.22), 0.18, 1.27, 0), FURD),
        sph(0.024, 0.205, 1.21, 0.045, '#1d140c'), sph(0.024, 0.205, 1.21, -0.045, '#1d140c'),
        sph(0.05, 0.03, 1.22, 0.18, FUR), sph(0.05, 0.03, 1.22, -0.18, FUR), ell(0.035, 0.02, 0.05, 0.225, 1.12, 0, '#8a4a34')];
      if (chief) { p.push(G().paint(G().place(G().cone(0.05, 0.28, 4), -0.06, 1.34, 0.03, 0, 0, 0.3), '#ff6b6b')); p.push(G().paint(G().place(G().cone(0.05, 0.25, 4), 0.02, 1.35, -0.03, 0, 0, -0.1), '#ffd43b')); }
      return G().merge(p);
    })));
    const legs = [0.08, -0.08].map(z => { const g = new THREE.Group(); g.position.set(0, 0.56, z); g.add(mesh(cached('ape-leg', () => limb(0.06, 0.55, FURD, SKIN)))); body.add(g); return g; });
    const arms = [0.21, -0.21].map(z => { const g = new THREE.Group(); g.position.set(0.02, 0.98, z); g.add(mesh(cached('ape-arm', () => limb(0.048, 0.46, FUR, SKIN)))); body.add(g); return g; });
    // орудие в «передней» руке: факел / каменный топор / палка
    const tool = new THREE.Group(); tool.position.set(0.05, -0.44, 0); arms[0].add(tool);
    let flame = null;
    const kind = sk.includes('fire') ? 'torch' : sk.includes('stone') ? 'axe' : sk.includes('stick') ? 'stick' : null;
    if (kind) tool.add(mesh(cached('tool-' + kind, () => {
      const p = [G().paint(G().place(G().cyl(0.022, 0.025, kind === 'stick' ? 0.75 : 0.42, 5), 0, kind === 'stick' ? -0.3 : -0.05, 0, 0, 0, -0.15), kind === 'torch' ? '#5a3a1a' : '#7a5230')];
      if (kind === 'axe') p.push(G().paint(G().jitter(G().place(new (T().IcosahedronGeometry)(0.09, 0), 0.07, 0.34, 0, 0, 0, 0, 1.3, 0.8, 0.5), 0.02, 3), '#8d8a80'));
      return G().merge(p);
    })));
    if (kind === 'torch') { flame = mesh(cached('flame-s', () => G().paint(G().cone(0.06, 0.18, 6), '#ffa94d')), flameMat()); flame.position.set(0.06, 0.36, 0); tool.add(flame); const gl = glow('#ffb347', 0.45); gl.position.copy(flame.position); tool.add(gl); flame.userData.glow = gl; }
    return { root, body, legs, arms, tool, flame, kind: 'ape', torch: kind === 'torch', hat: null, hatId: null, h: 1.45 };
  }
  let _flameMat = null;
  function flameMat() { if (!_flameMat) _flameMat = new (T().MeshBasicMaterial)({ color: '#ffb347', transparent: true, opacity: 0.9, blending: T().AdditiveBlending, depthWrite: false }); return _flameMat; }

  // ——— зверёк (длина ≈ 1.2 «s») ———
  function mammal(c) {
    const THREE = T(), d = c.def || { col: '#8a6a52', belly: '#d9c2a8', kind: 'shrew' }, k = d.kind;
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    body.add(mesh(cached('mam-' + k, () => {
      const p = [ell(0.38, 0.22, 0.24, 0, 0.27, 0, d.col), ell(0.26, 0.12, 0.2, 0.05, 0.19, 0, d.belly),
        ell(0.18, 0.15, 0.15, 0.36, 0.37, 0, d.col), G().paint(G().place(G().cone(0.08, 0.2, 6), 0.5, 0.33, 0, 0, 0, -Math.PI / 2), d.col),
        sph(0.035, 0.62, 0.33, 0, '#2a1a14'), sph(0.07, 0.3, 0.5, 0.08, d.col), sph(0.07, 0.3, 0.5, -0.08, d.col), sph(0.035, 0.335, 0.5, 0.1, '#ffb3c1'), sph(0.035, 0.335, 0.5, -0.1, '#ffb3c1'),
        sph(0.03, 0.46, 0.41, 0.085, '#111'), sph(0.03, 0.46, 0.41, -0.085, '#111')];
      if (k === 'hedgehog') for (let i = 0; i < 16; i++) { const a = Math.PI * (0.1 + 0.8 * (i % 8) / 7), z = i < 8 ? 0.09 : -0.09; p.push(G().paint(G().place(G().cone(0.05, 0.22, 4), -Math.cos(a) * 0.3 - 0.02, 0.27 + Math.sin(a) * 0.2, z, 0, 0, Math.PI / 2 - a), '#4a3a2e')); }
      if (k === 'badger') { p.push(ell(0.3, 0.035, 0.08, -0.02, 0.48, 0, '#f1f1f1')); p.push(ell(0.1, 0.03, 0.06, 0.42, 0.47, 0, '#f1f1f1')); }
      if (k === 'beaver') p.push(ell(0.22, 0.04, 0.12, -0.55, 0.1, 0, '#4a3424'));
      return G().merge(p);
    })));
    const tail = new THREE.Group(); tail.position.set(-0.34, 0.27, 0); body.add(tail);
    if (k === 'squirrel') tail.add(mesh(cached('tail-sq-' + d.col, () => ell(0.18, 0.36, 0.14, -0.15, 0.28, 0, d.col))));
    else if (k !== 'hedgehog' && k !== 'beaver') tail.add(mesh(cached('tail-' + d.col, () => G().paint(G().place(new (T().CylinderGeometry)(0.025, 0.04, 0.4, 5, 1), -0.17, 0.05, 0, 0, 0, Math.PI / 2 + 0.4), d.col))));
    const legs = [[0.2, 0.1], [0.2, -0.1], [-0.18, 0.1], [-0.18, -0.1]].map(([x, z]) => { const g = new THREE.Group(); g.position.set(x, 0.14, z); g.add(mesh(cached('mam-leg', () => limb(0.035, 0.14, '#3a2a1e')))); body.add(g); return g; });
    return { root, body, legs, tail, kind: 'mammal', h: 0.6 };
  }
  function poseCritter(m, c, t) {
    const mv = Math.min(1, c.moving || 0), st = Math.sin(c.phase) * mv;
    if (m.kind === 'ape') {
      m.body.position.y = c.ride ? 0 : Math.abs(Math.sin(c.phase)) * 0.04 * mv;
      if (c.ride) { m.legs[0].rotation.set(-1.2, 0, 1.0); m.legs[1].rotation.set(1.2, 0, 1.0); m.body.position.y = -0.5; }
      else { m.legs[0].rotation.set(0, 0, st * 0.5); m.legs[1].rotation.set(0, 0, -st * 0.5); }
      const arm = Math.sin(c.phase + 1.5) * 0.4 * mv + (c.task ? 0.9 : 0);
      m.arms[0].rotation.set(0, 0, arm); m.arms[1].rotation.set(0, 0, -Math.sin(c.phase + 1.5) * 0.4 * mv);
      if (m.flame) { const f = 1 + Math.sin(t * 20 + c.seed) * 0.15; m.flame.scale.set(f, f * (1 + Math.sin(t * 13) * 0.2), f); }
    } else {
      m.body.position.y = Math.abs(Math.sin(c.phase)) * 0.18 * mv;
      m.legs.forEach((g, i) => { g.rotation.z = (i % 2 ? -1 : 1) * st * 0.6; });
      if (m.tail) m.tail.rotation.z = Math.sin(t * 4 + c.seed) * 0.15;
    }
  }
  function setApeHat(m, hat) {
    if (m.hatId === hat) return; m.hatId = hat;
    if (m.hat) { m.hat.removeFromParent(); m.hat = null; }
    if (!hat || !DP.Scene.HATS[hat] || !DP.Dino3D) return;
    const mt = DP.Dino3D._hatMat ? DP.Dino3D._hatMat(hat) : null; if (!mt) return;
    const s = new (T().Sprite)(mt); s.scale.set(0.34, 0.34, 1); s.position.set(0.1, -0.5, 0); m.arms[0].add(s); m.hat = s;
  }

  // ——— яйцо и подарок (высота ≈ 1.5 «s») ———
  function egg(it) {
    const R = (DP.Life && DP.Life.R && (DP.Life.R[it.r] || DP.Life.R.common)) || { color: '#f1e3c6', spot: '#c9a87a' };
    const THREE = T(), root = new THREE.Group();
    root.add(mesh(cached('egg-' + R.color + R.spot, () => {
      const prof = []; for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI, y = (1 - Math.cos(a)) / 2 * 1.5, r = Math.sin(a) * 0.62 * (1 - 0.18 * (y / 1.5)); prof.push(new THREE.Vector2(Math.max(0.001, r), y)); }
      const p = [G().paint(new THREE.LatheGeometry(prof, 16), R.color)];
      [[0.4, 0.9, 0.45, 0.13], [-0.5, 0.55, 0.3, 0.1], [0.1, 1.2, -0.45, 0.08], [-0.3, 0.35, -0.5, 0.07], [0.55, 0.5, -0.2, 0.08], [-0.15, 1.0, 0.55, 0.09]].forEach(([x, y, z, s]) => { const v = new THREE.Vector3(x, 0, z).normalize(); const prR = Math.sin(Math.acos(1 - 2 * y / 1.5)) * 0.62 * (1 - 0.18 * y / 1.5); p.push(G().paint(G().place(new THREE.SphereGeometry(s, 6, 4), v.x * prR, y, v.z * prR, 0, Math.atan2(-v.z, v.x), 0, 0.35, 1, 1), R.spot)); });
      p.push(G().paint(G().place(new THREE.SphereGeometry(0.12, 6, 4), -0.2, 1.05, 0.48, 0, 0, 0, 0.5, 1.2, 0.5), '#ffffff'));
      return G().merge(p);
    })));
    if (it.r !== 'common') { const g = glow(R.color, 4.4); g.position.y = 0.75; root.add(g); root.userData.glow = g; }
    return { root, kind: 'egg', h: 1.5 };
  }
  function gift() {
    const THREE = T(), root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    body.add(mesh(cached('gift', () => G().merge([
      G().paint(G().place(new THREE.BoxGeometry(1.6, 1.3, 1.6), 0, 0.65, 0), '#ff6b6b'),
      G().paint(G().place(new THREE.BoxGeometry(0.3, 1.32, 1.62), 0, 0.65, 0), '#ffd43b'), G().paint(G().place(new THREE.BoxGeometry(1.62, 1.32, 0.3), 0, 0.65, 0), '#ffd43b'),
      G().paint(G().place(new THREE.BoxGeometry(1.8, 0.28, 1.8), 0, 1.36, 0), '#ff8787'),
      G().paint(G().place(new THREE.TorusGeometry(0.28, 0.09, 5, 10), -0.3, 1.65, 0, 0, 0, 0.6, 1, 0.65, 1), '#ffd43b'), G().paint(G().place(new THREE.TorusGeometry(0.28, 0.09, 5, 10), 0.3, 1.65, 0, 0, 0, -0.6, 1, 0.65, 1), '#ffd43b')
    ]))));
    return { root, body, kind: 'gift', h: 1.9 };
  }
  // ——— корм и мяч ———
  function food(type) {
    const THREE = T();
    return mesh(cached('food-' + type, () => {
      if (type === 'leaf') return G().merge([-0.6, 0.5].map(r => G().paint(G().place(G().frond(1.3, 0.42, 0.1, 5, 0.2), 0, 0, 0, Math.PI / 2, 0, Math.PI / 2 + r), (x, y, z) => G().C(Math.abs(z) < 0.05 ? '#1e7a1e' : '#4cd137'))));
      if (type === 'fish') return G().merge([ell(0.55, 0.28, 0.16, 0, 0.3, 0, '#4dabf7'), G().paint(G().place(G().cone(0.25, 0.35, 4), -0.65, 0.3, 0, 0, 0, Math.PI / 2, 1, 1, 0.3), '#339af0'), sph(0.05, 0.38, 0.38, 0.12, '#111'), ell(0.3, 0.1, 0.17, 0.05, 0.2, 0, '#d0ebff')]);
      return G().merge([G().paint(G().place(new THREE.CylinderGeometry(0.13, 0.13, 0.8, 6), 0.5, 0.35, 0, 0, 0, Math.PI / 2 - 0.5), '#fff3e0'), sph(0.17, 0.85, 0.6, 0.12, '#fff3e0'), sph(0.17, 0.85, 0.6, -0.12, '#fff3e0'), ell(0.55, 0.42, 0.42, -0.1, 0.35, 0, '#d9480f')]);
    }), type === 'leaf' ? materialDouble() : material());
  }
  function ball() {
    const cols = ['#ff4d4d', '#ffffff', '#ffd43b', '#ffffff', '#4dabf7', '#ffffff'];
    return mesh(cached('ball', () => G().paint(new (T().SphereGeometry)(1, 18, 12), (x, y, z) => G().C(cols[Math.floor(((Math.atan2(z, x) + Math.PI) / TAU) * 6) % 6]))), cached('ballMat', () => new (T().MeshPhongMaterial)({ vertexColors: true, shininess: 60, specular: new (T().Color)('#444444') })));
  }
  // ——— гнездо (радиус 1) ———
  function nest() {
    return mesh(cached('nest', () => {
      const p = [G().paint(G().place(new (T().CylinderGeometry)(0.85, 0.95, 0.1, 14, 1), 0, 0.05, 0), '#5a3a1e')];
      for (let i = 0; i < 30; i++) { const a = i / 30 * TAU, r = 0.82 + (i * 37 % 10) / 60; p.push(G().paint(G().place(new (T().CylinderGeometry)(0.035, 0.035, 0.55, 4, 1), Math.cos(a) * r, 0.12 + (i % 3) * 0.03, Math.sin(a) * r, Math.PI / 2, 0, -a + 0.4 * (i % 2 ? 1 : -1), 1, 1, 1), i % 3 ? '#8a5a2b' : '#c08a4a')); }
      return G().merge(p);
    }));
  }
  // ——— стоянка (размер «s» = половина ширины динозавра) ———
  function camp(sk, night) {
    const THREE = T(), root = new THREE.Group(), out = { root, flames: [], light: null, glow: null };
    const stones = G().merge(Array.from({ length: 8 }, (_, i) => { const a = i / 8 * TAU; return G().paint(G().jitter(G().place(new THREE.IcosahedronGeometry(0.11, 0), Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.3 * 1.6, 0, a, 0, 1.2, 0.7, 1), 0.03, i), '#8d8a80'); }));
    root.add(mesh(stones));
    if (sk.fire) {
      root.add(mesh(cached('logs', () => G().merge([G().paint(G().place(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6), 0, 0.08, 0, 0, 0.6, Math.PI / 2), '#5a3a1e'), G().paint(G().place(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6), 0, 0.12, 0, 0, -0.6, Math.PI / 2), '#6a4424')]))));
      ['#ff6b1a', '#ffa94d', '#ffe066'].forEach((col, i) => {
        const m = new THREE.Mesh(cached('flame' + i, () => new THREE.ConeGeometry(0.28 - i * 0.07, 0.8 - i * 0.18, 7, 1).translate(0, (0.8 - i * 0.18) / 2, 0)), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        m.position.y = 0.1; root.add(m); out.flames.push(m);
      });
      out.glow = glow('#ffb347', night ? 3.5 : 2.2); out.glow.position.y = 0.4; root.add(out.glow);
      out.light = new THREE.PointLight('#ffb35a', night ? 30 : 8, 0, 2); out.light.position.y = 0.6; root.add(out.light);
    }
    if (sk.hut) {
      const hut = new THREE.Group(); hut.position.set(-1.6, 0, -0.3); root.add(hut);
      hut.add(mesh(cached('hut', () => {
        const p = [G().paint(G().jitter(G().place(new THREE.ConeGeometry(0.95, 1.6, 9, 2, true), 0, 0.8, 0), 0.05, 2), (x, y) => G().C(y > 1.2 ? '#4a7a3a' : '#7a5a32'))];
        for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; p.push(G().paint(G().place(new THREE.CylinderGeometry(0.025, 0.035, 1.9, 4), Math.cos(a) * 0.45, 0.85, Math.sin(a) * 0.45, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5), '#5a3e20')); }
        p.push(G().paint(G().place(new THREE.CircleGeometry(0.28, 3), 0.0, 0.25, 0.86, 0, 0, Math.PI / 2, 1, 1.6, 1), '#2a1e12'));
        p.push(G().paint(G().place(new THREE.SphereGeometry(0.45, 8, 4), 0, 1.4, 0, 0, 0, 0, 1, 0.45, 1), '#4a7a3a'));
        return G().merge(p);
      }), materialDouble()));
    }
    return out;
  }
  function poseCamp(o, t, night) {
    o.flames.forEach((m, i) => { const fl = Math.sin(t * (9 + i * 3) + i) * 0.12; m.scale.set(1 + fl * 0.5, 1 + fl + Math.sin(t * 17 + i) * 0.08, 1 + fl * 0.5); m.rotation.z = fl * 0.4; });
    if (o.light) o.light.intensity = (night ? 30 : 8) * (0.85 + Math.sin(t * 7) * 0.1 + Math.sin(t * 13) * 0.05);
    if (o.glow) o.glow.material.opacity = 0.75 + Math.sin(t * 7) * 0.15;
  }
  // ——— куст/камень для пряток: из логического «p» (радиус r в 1) ———
  function prop(p) {
    const K = G().KIT, st = p.st || {}, L = { leaf: st.leaf || ['#24561f', '#2f6f28', '#3f8a36', '#5aa845'], bark: '#5d4430' }, r = G().rng(Math.floor((p.seed || 1) * 1000)), k = p.kind;
    let geo, mt = material(), sx = 1;
    if (k === 'rock' || k === 'ice') geo = K.rock(st.rock || ['#6d6a62', '#8d897f', '#a9a498'], r, k === 'ice');
    else if (k === 'cactus') { geo = K.cactus(r); sx = 1 / 1.5; }
    else if (k === 'flowers') { geo = K.flowers(L, r, ['#ff6b9a', '#ffd43b', '#ffffff']); sx = 2; }
    else if (k === 'shells') { geo = K.shells(r); sx = 1.2; }
    else if (k === 'mush') { geo = K.mushStem(G().rng(7)); sx = 1.6; }
    else if (k === 'reeds') { geo = K.reeds(L, r); mt = materialDouble(); sx = 1.1; }
    else if (k === 'fern') { geo = K.fern(L, r); mt = materialDouble(); sx = 1.2; }
    else geo = K.bush(L, r, k === 'bush' && p._jungle ? 'berry' : k);
    const THREE = T(), root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const m = new THREE.Mesh(geo, mt); m.scale.setScalar(sx); body.add(m);
    if (k === 'mush') { // светящиеся шляпки
      const R2 = G().rng(7); const caps = []; for (let i = 0; i < 5; i++) { const x = (R2() - 0.5) * 0.9, z = (R2() - 0.5) * 0.5, h = 0.18 + R2() * 0.15; caps.push(G().place(new THREE.SphereGeometry(0.11, 8, 4, 0, TAU, 0, Math.PI / 2), x, h, z, 0, 0, 0, 1, 0.55, 1)); }
      const cm = new THREE.Mesh(G().merge(caps.map(g => G().paint(g, '#7fe0d0'))), cached('mushMat', () => new THREE.MeshBasicMaterial({ vertexColors: true }))); cm.scale.setScalar(sx); body.add(cm);
      const gl = glow('#7fffe0', 2.6); gl.position.y = 0.4; body.add(gl);
    }
    if (p.paint && (k === 'rock')) { // наскальный рисунок племени
      const pm = new THREE.Mesh(cached('paint', () => { const pts = [[-0.5, 0.35], [-0.2, 0.6], [0.15, 0.42], [0.35, 0.55]]; return G().merge(pts.slice(1).map((q, i) => { const a = pts[i], len = Math.hypot(q[0] - a[0], q[1] - a[1]); return G().paint(G().place(new THREE.CylinderGeometry(0.03, 0.03, len, 4), (a[0] + q[0]) / 2, (a[1] + q[1]) / 2, 0.78, 0, 0, Math.atan2(q[1] - a[1], q[0] - a[0]) - Math.PI / 2), '#963c1e'); })); }), material());
      body.add(pm); root.userData.paint = pm;
    }
    return { root, body, geo, kind: k };
  }
  /** Мягкие тени-пятна: одна «пачка» на все объекты */
  function shadows(n) {
    const THREE = T();
    if (!shadowMat) shadowMat = new THREE.MeshBasicMaterial({ map: G().radialTex('shadow', [[0, 'rgba(0,0,0,.42)'], [0.55, 'rgba(0,0,0,.2)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const g = new THREE.PlaneGeometry(2, 2); g.rotateX(-Math.PI / 2);
    const m = new THREE.InstancedMesh(g, shadowMat, n); m.count = 0; m.frustumCulled = false; m.renderOrder = 2;
    const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    let i = 0;
    return { mesh: m, begin() { i = 0; }, add(X, Y, Z, rx, rz, a) { if (i >= n) return; mx.compose(v.set(X, Y + 0.03, Z), q, s.set(rx * (a == null ? 1 : a), 1, rz * (a == null ? 1 : a))); m.setMatrixAt(i++, mx); }, end() { m.count = i; m.instanceMatrix.needsUpdate = true; }, dispose() { g.dispose(); m.dispose(); } };
  }
  function purge() {
    Object.keys(geoCache).forEach(k => { const g = geoCache[k]; if (g && g.dispose) g.dispose(); delete geoCache[k]; });
    [mat, matD, shadowMat, _flameMat].forEach(m => m && m.dispose()); mat = matD = shadowMat = _flameMat = null;
    Object.keys(glowMat).forEach(k => { glowMat[k].dispose(); delete glowMat[k]; });
  }
  DP.Things3D = { ape, mammal, poseCritter, setApeHat, egg, gift, food, ball, nest, camp, poseCamp, prop, shadows, glow, purge };
})();
