/* Динопарк — пять живописных локаций, нарисованных кодом (без чужих картинок).
 * Локация = набор слоёв от дальнего к ближнему. Каждый слой рисуется один раз в свой холст,
 * а в кадре сдвигается с параллаксом (дальние слои — меньше). Поверх слоя может быть анимация (anim),
 * у слоя с водой — водоёмы (pools), в которых сцена рисует живое отражение всего, что за ними.
 * drawFront — передний план над динозаврами (трава качается, частицы), glow — огоньки поверх ночного тона.
 * zones — где живут наземные, летающие и водные динозавры (доли экрана).
 */
window.DP = window.DP || {};
(function () {
  const TAU = Math.PI * 2, PAD = 0.05;
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // ---------- цвет ----------
  const hex = (c) => { c = c.replace('#', ''); return [0, 2, 4].map(i => parseInt(c.substr(i, 2), 16)); };
  const toHex = (a) => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
  const rgba = (c, a) => { const A = hex(c); return `rgba(${A[0]},${A[1]},${A[2]},${a})`; };
  function lin(ctx, x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(s => g.addColorStop(s[0], s[1])); return g; }
  function rad(ctx, x, y, r0, r1, stops) { const g = ctx.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(s => g.addColorStop(s[0], s[1])); return g; }
  const X0 = (w) => -w * PAD, XW = (w) => w * (1 + 2 * PAD);

  // ---------- небо, свет, облака ----------
  function sky(ctx, w, h, stops, yEnd) { ctx.fillStyle = lin(ctx, 0, 0, 0, h * (yEnd || 0.7), stops); ctx.fillRect(X0(w), 0, XW(w), h); }
  function glow(ctx, x, y, r, col, a) { ctx.fillStyle = rad(ctx, x, y, 0, r, [[0, rgba(col, a)], [0.25, rgba(col, a * 0.45)], [1, rgba(col, 0)]]); ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  const cloudCache = {};
  function cloudSprite(key, s, light, shade, seed) {
    const k = key + Math.round(s); if (cloudCache[k]) return cloudCache[k];
    const c = document.createElement('canvas'); c.width = Math.ceil(s * 7); c.height = Math.ceil(s * 3.4);
    const x = c.getContext('2d'), r = rng(seed);
    const puffs = []; for (let i = 0; i < 16; i++) { const t = i / 15; puffs.push([s * (0.9 + t * 5.2), s * (2.2 - Math.sin(t * Math.PI) * (0.6 + r() * 0.5)), s * (0.45 + Math.sin(t * Math.PI) * 0.65 + r() * 0.25)]); }
    puffs.forEach(([px, py, pr]) => { x.fillStyle = rad(x, px, py + pr * 0.3, 0, pr * 1.15, [[0, rgba(shade, 0.85)], [0.75, rgba(shade, 0.55)], [1, rgba(shade, 0)]]); x.beginPath(); x.arc(px, py + pr * 0.3, pr * 1.15, 0, TAU); x.fill(); });
    puffs.forEach(([px, py, pr]) => { x.fillStyle = rad(x, px - pr * 0.25, py - pr * 0.35, 0, pr, [[0, rgba(light, 0.95)], [0.7, rgba(light, 0.75)], [1, rgba(light, 0)]]); x.beginPath(); x.arc(px, py, pr, 0, TAU); x.fill(); });
    return (cloudCache[k] = c);
  }
  function clouds(ctx, w, h, t, list, light, shade) {
    list.forEach(([fx, fy, fs, sp], i) => {
      const s = Math.min(w, h) * fs, spr = cloudSprite(light + shade + i, s, light, shade, 7 + i * 13);
      const span = w + spr.width * 2, x = ((fx * span + t * sp * w * 0.004) % span) - spr.width;
      ctx.drawImage(spr, x, fy * h - spr.height * 0.6);
    });
  }
  // ---------- горы ----------
  function ridgeY(w, baseY, amp, seed, freq, sharp) {
    const r = rng(seed), p = [r() * 10, r() * 10, r() * 10, r() * 10];
    return (x) => {
      const t = x / w * freq;
      let v = 0.5 * Math.sin(t * 2.1 + p[0]) + 0.3 * Math.sin(t * 4.7 + p[1]) + 0.14 * Math.sin(t * 9.3 + p[2]) + 0.06 * Math.sin(t * 21 + p[3]);
      if (sharp) v = 1 - Math.abs(v) * 1.6;
      return baseY - amp * v;
    };
  }
  /** Хребет с освещением склонов (свет слева сверху), снегом и дымкой у подножия */
  function mountains(ctx, w, h, o) {
    const f = ridgeY(w, h * o.base, h * o.amp, o.seed, o.freq || 3, o.sharp), x0 = X0(w), x1 = x0 + XW(w), bottom = h * (o.bottom || 1);
    ctx.save(); ctx.beginPath(); ctx.moveTo(x0, bottom);
    for (let x = x0; x <= x1 + 4; x += 4) ctx.lineTo(x, f(x));
    ctx.lineTo(x1 + 4, bottom); ctx.closePath();
    ctx.fillStyle = o.col; ctx.fill(); ctx.clip();
    // склоны: освещённые — светлее, теневые — темнее
    for (let x = x0; x <= x1; x += 2) {
      const y = f(x), s = (f(x + 6) - f(x - 6)) / 12; // >0 — склон вниз вправо (в тени)
      const k = Math.max(-1, Math.min(1, s * 2.2));
      ctx.fillStyle = k > 0 ? rgba(o.shade, Math.min(0.5, k * 0.5)) : rgba(o.lit, Math.min(0.45, -k * 0.45));
      ctx.fillRect(x, y, 2.4, bottom - y);
    }
    if (o.snow) { // снежные шапки
      const r = rng(o.seed + 5); ctx.fillStyle = o.snow;
      ctx.beginPath(); ctx.moveTo(x0, 0);
      for (let x = x0; x <= x1 + 6; x += 6) { const y = f(x), sl = h * o.snowLine + Math.sin(x * 0.13) * h * 0.012 + Math.sin(x * 0.041 + o.seed) * h * 0.025 + r() * h * 0.008; ctx.lineTo(x, Math.max(sl, y + (sl - y) * 0.15)); }
      ctx.lineTo(x1 + 6, 0); ctx.closePath(); ctx.fill();
      for (let x = x0; x <= x1; x += 2) { const s = (f(x + 6) - f(x - 6)) / 12; if (s > 0.05) { ctx.fillStyle = rgba(o.snowShade || '#9fb3cf', Math.min(0.55, s * 0.9)); ctx.fillRect(x, f(x), 2.4, h * 0.2); } }
    }
    if (o.strata) { // слои горных пород (каньон)
      const r = rng(o.seed + 9);
      for (let i = 0; i < o.strata; i++) {
        const y = h * o.base - h * o.amp * 0.6 + i * (bottom - h * o.base + h * o.amp) / o.strata;
        ctx.strokeStyle = rgba(i % 2 ? o.shade : o.lit, 0.18 + r() * 0.12); ctx.lineWidth = h * (0.004 + r() * 0.006);
        ctx.beginPath(); for (let x = x0; x <= x1; x += 10) ctx.lineTo(x, y + Math.sin(x * 0.011 + i) * h * 0.004); ctx.stroke();
      }
    }
    if (o.haze) { ctx.fillStyle = lin(ctx, 0, h * (o.base - o.amp), 0, bottom, [[0, rgba(o.haze, o.hazeTop || 0)], [1, rgba(o.haze, o.hazeBottom == null ? 0.55 : o.hazeBottom)]]); ctx.fillRect(x0, 0, XW(w), bottom); }
    ctx.restore();
  }
  /** Столовые горы (каньон): плоская вершина, отвесные стены */
  function mesa(ctx, x, y, wd, ht, o) {
    const r = rng(o.seed);
    ctx.save(); ctx.beginPath(); ctx.moveTo(x - wd * 0.62, y);
    ctx.lineTo(x - wd * 0.5, y - ht * 0.55); ctx.lineTo(x - wd * 0.46, y - ht); ctx.lineTo(x + wd * 0.44, y - ht * (0.97 + r() * 0.05)); ctx.lineTo(x + wd * 0.5, y - ht * 0.5); ctx.lineTo(x + wd * 0.64, y);
    ctx.closePath(); ctx.fillStyle = o.col; ctx.fill(); ctx.clip();
    ctx.fillStyle = rgba(o.lit, 0.45); ctx.beginPath(); ctx.moveTo(x - wd * 0.62, y); ctx.lineTo(x - wd * 0.5, y - ht * 0.55); ctx.lineTo(x - wd * 0.46, y - ht); ctx.lineTo(x - wd * 0.2, y - ht); ctx.lineTo(x - wd * 0.3, y); ctx.fill();
    ctx.fillStyle = rgba(o.shade, 0.45); ctx.beginPath(); ctx.moveTo(x + wd * 0.2, y - ht); ctx.lineTo(x + wd * 0.44, y - ht); ctx.lineTo(x + wd * 0.5, y - ht * 0.5); ctx.lineTo(x + wd * 0.64, y); ctx.lineTo(x + wd * 0.25, y); ctx.fill();
    for (let i = 1; i < 7; i++) { ctx.strokeStyle = rgba(i % 2 ? o.shade : o.lit, 0.25); ctx.lineWidth = ht * 0.025; ctx.beginPath(); ctx.moveTo(x - wd, y - ht + i * ht / 7); ctx.lineTo(x + wd, y - ht + i * ht / 7 + Math.sin(i) * ht * 0.02); ctx.stroke(); }
    ctx.fillStyle = rgba(o.top || o.lit, 0.6); ctx.fillRect(x - wd * 0.5, y - ht - 1, wd, ht * 0.04);
    if (o.haze) { ctx.fillStyle = rgba(o.haze, o.hazeA || 0.3); ctx.fillRect(x - wd, y - ht * 1.1, wd * 2, ht * 1.2); }
    ctx.restore();
  }
  // ---------- растительность (мазками) ----------
  /** Облако листвы из мазков: снизу темнее, сверху-слева светлее */
  function clump(ctx, x, y, rad0, cols, r, n) {
    n = n || 26; const ds = [];
    for (let i = 0; i < n; i++) { const a = r() * TAU, d = Math.sqrt(r()) * rad0; const dx = Math.cos(a) * d, dy = Math.sin(a) * d * 0.8; ds.push([dx, dy, rad0 * (0.22 + r() * 0.2), r() * TAU]); }
    ctx.fillStyle = cols[0]; ctx.beginPath(); ctx.ellipse(x, y + rad0 * 0.08, rad0 * 1.02, rad0 * 0.86, 0, 0, TAU); ctx.fill();
    ds.sort((a, b) => (b[1] - b[0] * 0.5) - (a[1] - a[0] * 0.5));
    ds.forEach(([dx, dy, s, rot]) => {
      const l = (-dy - dx * 0.5) / rad0; // освещённость
      ctx.fillStyle = l > 0.35 ? cols[3] : l > -0.05 ? cols[2] : cols[1];
      ctx.beginPath(); ctx.ellipse(x + dx, y + dy, s, s * 0.7, rot, 0, TAU); ctx.fill();
    });
  }
  function trunk(ctx, x, y, h, wd, lean, col, shade) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - wd, y); ctx.quadraticCurveTo(x - wd * 0.6 + lean * h * 0.5, y - h * 0.5, x - wd * 0.35 + lean * h, y - h); ctx.lineTo(x + wd * 0.35 + lean * h, y - h); ctx.quadraticCurveTo(x + wd * 0.6 + lean * h * 0.5, y - h * 0.5, x + wd, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade; ctx.beginPath(); ctx.moveTo(x + wd * 0.15, y); ctx.quadraticCurveTo(x + wd * 0.2 + lean * h * 0.5, y - h * 0.5, x + lean * h + wd * 0.1, y - h); ctx.lineTo(x + wd * 0.35 + lean * h, y - h); ctx.quadraticCurveTo(x + wd * 0.6 + lean * h * 0.5, y - h * 0.5, x + wd, y); ctx.fill();
  }
  function tree(ctx, x, y, h, c, r) {
    trunk(ctx, x, y, h * 0.62, h * 0.045, (r() - 0.5) * 0.15, c.bark, c.barkD);
    const cx = x + (r() - 0.5) * h * 0.08, cy = y - h * 0.66;
    [[-0.22, 0.1, 0.27], [0.24, 0.06, 0.25], [0, -0.14, 0.3], [-0.05, 0.12, 0.25]].forEach(([dx, dy, s]) => clump(ctx, cx + dx * h, cy + dy * h, s * h, c.leaf, r, 22));
  }
  function conifer(ctx, x, y, h, c, r, snow) {
    const wd = h * 0.28;
    ctx.fillStyle = c.bark; ctx.fillRect(x - h * 0.02, y - h * 0.12, h * 0.04, h * 0.14);
    const tiers = 6;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers, ty = y - h * 0.1 - t * h * 0.82, tw = wd * (1 - t * 0.8), th = h * 0.26;
      ctx.fillStyle = c.leaf[1]; ctx.beginPath(); ctx.moveTo(x, ty - th);
      for (let k = 0; k <= 6; k++) { const kx = x - tw + k * tw / 3; ctx.lineTo(kx, ty + (k % 2 ? -th * 0.08 : 0)); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = c.leaf[2]; ctx.beginPath(); ctx.moveTo(x, ty - th); ctx.lineTo(x - tw, ty); ctx.lineTo(x - tw * 0.2, ty - th * 0.1); ctx.closePath(); ctx.fill();
      if (snow) { ctx.fillStyle = snow; ctx.beginPath(); ctx.moveTo(x, ty - th); ctx.lineTo(x - tw * 0.55, ty - th * 0.42); ctx.quadraticCurveTo(x - tw * 0.1, ty - th * 0.5 + r() * th * 0.1, x + tw * 0.45, ty - th * 0.38); ctx.closePath(); ctx.fill(); }
    }
  }
  function palm(ctx, x, y, h, lean, c, r) {
    const tx = x + lean * h, ty = y - h, seg = 12;
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg, t1 = (i + 1) / seg, px = (t) => x + lean * h * t * t, py = (t) => y - h * t;
      ctx.strokeStyle = i % 2 ? c.bark : c.barkD; ctx.lineWidth = h * (0.06 - t0 * 0.025); ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(px(t0), py(t0)); ctx.lineTo(px(t1), py(t1) - 1); ctx.stroke();
    }
    for (let i = 0; i < 9; i++) {
      const ang = -Math.PI / 2 + (i / 8 - 0.5) * Math.PI * 1.8 + (r() - 0.5) * 0.2, len = h * (0.42 + r() * 0.14);
      const droop = len * (0.35 + Math.abs(Math.cos(ang)) * 0.25);
      const ex = tx + Math.cos(ang) * len, ey = ty + Math.sin(ang) * len * 0.45 + droop, mx = tx + Math.cos(ang) * len * 0.5, my = ty + Math.sin(ang) * len * 0.4 - len * 0.1;
      const steps = 14; ctx.lineCap = 'round';
      for (let k = 1; k <= steps; k++) {
        const t = k / steps, it = 1 - t, px = it * it * tx + 2 * it * t * mx + t * t * ex, py = it * it * ty + 2 * it * t * my + t * t * ey;
        const ll = len * 0.2 * Math.sin(t * Math.PI * 0.9 + 0.2);
        ctx.strokeStyle = (i + k) % 3 ? c.leaf[2] : c.leaf[1]; ctx.lineWidth = Math.max(1, h * 0.012);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang + 1.9) * ll, py + Math.abs(Math.sin(ang + 1.9)) * ll + ll * 0.4); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang - 1.9) * ll, py + Math.abs(Math.sin(ang - 1.9)) * ll + ll * 0.4); ctx.stroke();
      }
      ctx.strokeStyle = c.leaf[0]; ctx.lineWidth = Math.max(1, h * 0.01); ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
    }
  }
  function treeFern(ctx, x, y, h, c, r) {
    trunk(ctx, x, y, h * 0.7, h * 0.035, (r() - 0.5) * 0.1, c.bark, c.barkD);
    const tx = x, ty = y - h * 0.7;
    for (let i = 0; i < 8; i++) {
      const ang = -Math.PI / 2 + (i / 7 - 0.5) * 2.8, len = h * (0.4 + r() * 0.1);
      const ex = tx + Math.cos(ang) * len, ey = ty + Math.sin(ang) * len * 0.5 + len * 0.3;
      fernLeaf(ctx, tx, ty, ex, ey, len * 0.12, c.leaf, i);
    }
  }
  function fernLeaf(ctx, x0, y0, x1, y1, lw, cols, seed) {
    const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - Math.abs(x1 - x0) * 0.25, ang = Math.atan2(y1 - y0, x1 - x0);
    ctx.strokeStyle = cols[0]; ctx.lineWidth = Math.max(1, lw * 0.25); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
    for (let k = 1; k < 12; k++) {
      const t = k / 12, it = 1 - t, px = it * it * x0 + 2 * it * t * mx + t * t * x1, py = it * it * y0 + 2 * it * t * my + t * t * y1, s = lw * (1 - t * 0.75);
      ctx.fillStyle = cols[(k + seed) % 2 ? 2 : 1];
      ctx.beginPath(); ctx.ellipse(px, py, s, s * 0.32, ang + 1.0, 0, TAU); ctx.ellipse(px, py, s, s * 0.32, ang - 1.0, 0, TAU); ctx.fill();
    }
  }
  function rock(ctx, x, y, s, c) {
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(x + s * 0.1, y, s * 1.15, s * 0.22, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = c[1]; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x - s * 0.8, y - s * 0.45); ctx.lineTo(x - s * 0.25, y - s * 0.72); ctx.lineTo(x + s * 0.45, y - s * 0.6); ctx.lineTo(x + s, y - s * 0.1); ctx.lineTo(x + s * 0.9, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = c[2]; ctx.beginPath(); ctx.moveTo(x - s * 0.8, y - s * 0.45); ctx.lineTo(x - s * 0.25, y - s * 0.72); ctx.lineTo(x + s * 0.1, y - s * 0.6); ctx.lineTo(x - s * 0.35, y - s * 0.35); ctx.closePath(); ctx.fill();
    ctx.fillStyle = c[0]; ctx.beginPath(); ctx.moveTo(x + s * 0.45, y - s * 0.6); ctx.lineTo(x + s, y - s * 0.1); ctx.lineTo(x + s * 0.9, y); ctx.lineTo(x + s * 0.2, y); ctx.lineTo(x + s * 0.3, y - s * 0.35); ctx.closePath(); ctx.fill();
    if (c[3]) { ctx.fillStyle = c[3]; ctx.beginPath(); ctx.moveTo(x - s * 0.8, y - s * 0.45); ctx.quadraticCurveTo(x - s * 0.2, y - s * 0.85, x + s * 0.45, y - s * 0.6); ctx.quadraticCurveTo(x - s * 0.1, y - s * 0.55, x - s * 0.8, y - s * 0.45); ctx.fill(); }
  }
  /** Неровная земля с мазками */
  function ground(ctx, w, h, y0, cols, seed, wav) {
    const x0 = X0(w), x1 = x0 + XW(w), r = rng(seed), f = ridgeY(w, h * y0, h * (wav || 0.012), seed, 2);
    ctx.save(); ctx.beginPath(); ctx.moveTo(x0, h); for (let x = x0; x <= x1 + 8; x += 8) ctx.lineTo(x, f(x)); ctx.lineTo(x1 + 8, h); ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, h * y0, 0, h, [[0, cols[0]], [0.45, cols[1]], [1, cols[2]]]); ctx.fill(); ctx.clip();
    const n = Math.round(w * h / 900);
    for (let i = 0; i < n; i++) { const x = x0 + r() * XW(w), y = h * y0 + Math.pow(r(), 0.8) * h * (1 - y0), s = (h * 0.004 + r() * h * 0.01) * (0.5 + (y / h - y0) * 2.5); ctx.fillStyle = rgba(cols[3 + (i % (cols.length - 3))], 0.1 + r() * 0.16); ctx.beginPath(); ctx.ellipse(x, y, s * 2.2, s * 0.55, (r() - 0.5) * 0.3, 0, TAU); ctx.fill(); }
    ctx.restore();
    return f;
  }
  function grassTexture(ctx, w, h, y0, y1, cols, seed, density) {
    const r = rng(seed), n = Math.round(w * (y1 - y0) * h / 260 * (density || 1));
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) { const x = X0(w) + r() * XW(w), t = r(), y = h * (y0 + (y1 - y0) * t), s = h * (0.006 + t * 0.016); ctx.strokeStyle = rgba(cols[i % cols.length], 0.55 + r() * 0.35); ctx.lineWidth = Math.max(0.8, s * 0.12); ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + s * 0.1, y - s * 0.6, x + (r() - 0.4) * s * 0.6, y - s); ctx.stroke(); }
  }
  // ---------- вода ----------
  function poolPath(p, w, h) { const P = new Path2D(); if (p.ellipse) P.ellipse(p.cx * w, p.cy * h, p.rx * w, p.ry * h, 0, 0, TAU); else { const f = p.bank; P.moveTo(X0(w), f(X0(w), 0, w, h)); for (let x = X0(w); x <= X0(w) + XW(w) + 8; x += 8) P.lineTo(x, f(x, 0, w, h)); for (let x = X0(w) + XW(w) + 8; x >= X0(w) - 8; x -= 8) P.lineTo(x, f(x, 1, w, h)); P.closePath(); } return P; }
  function water(ctx, w, h, p) {
    const P = poolPath(p, w, h), top = h * p.top, bot = h * p.bottom;
    if (p.shore) { ctx.save(); ctx.translate(0, h * 0.008); ctx.scale(1, 1); ctx.strokeStyle = p.shore; ctx.lineWidth = h * 0.016; ctx.stroke(P); ctx.restore(); }
    ctx.fillStyle = lin(ctx, 0, top, 0, bot, [[0, p.c1], [1, p.c2]]); ctx.fill(P);
  }
  function waterAnim(ctx, w, h, t, p, col, n) {
    const r = rng(p.seed || 3), top = h * p.top, bot = h * p.bottom;
    ctx.save(); ctx.clip(poolPath(p, w, h)); ctx.lineCap = 'round';
    for (let i = 0; i < (n || 26); i++) {
      const bx = X0(w) + r() * XW(w), ty = r(), by = top + (bot - top) * ty, len = w * (0.012 + r() * 0.03) * (0.5 + ty), sp = 0.4 + r();
      const a = 0.5 + 0.5 * Math.sin(t * sp * 1.6 + i * 2.3);
      ctx.strokeStyle = rgba(col, a * 0.55); ctx.lineWidth = Math.max(1, h * 0.002 * (1 + ty * 2));
      const dx = Math.sin(t * sp * 0.7 + i) * len * 0.6;
      ctx.beginPath(); ctx.moveTo(bx + dx, by); ctx.lineTo(bx + dx + len, by); ctx.stroke();
    }
    // мягкая кромка дальнего берега
    ctx.fillStyle = lin(ctx, 0, top, 0, top + (bot - top) * 0.25, [[0, rgba(p.edge || '#ffffff', 0.35)], [1, rgba(p.edge || '#ffffff', 0)]]); ctx.fillRect(X0(w), top - 2, XW(w), (bot - top) * 0.3);
    ctx.restore();
  }
  // ---------- передний план ----------
  function swayGrass(ctx, w, h, t, o) {
    const r = rng(o.seed), n = Math.round(w / (o.step || 9)); ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const x = X0(w) + r() * XW(w), y = h * (o.y0 + r() * (o.y1 - o.y0)) + 2, s = h * (o.size || 0.05) * (0.6 + r() * 0.7);
      const sway = Math.sin(t * 1.4 + x * 0.012) * 0.5 + Math.sin(t * 2.3 + x * 0.03) * 0.2 + Math.sin(t * 0.5) * 0.3;
      const blades = 3 + (i % 3);
      for (let b = 0; b < blades; b++) {
        const off = (b - blades / 2) * s * 0.08, bend = (sway * 0.3 + (b - blades / 2) * 0.12) * s;
        ctx.strokeStyle = o.cols[(i + b) % o.cols.length]; ctx.lineWidth = Math.max(1, s * 0.06);
        ctx.beginPath(); ctx.moveTo(x + off, y); ctx.quadraticCurveTo(x + off + bend * 0.3, y - s * 0.55, x + off + bend, y - s * (0.8 + ((b * 7) % 3) * 0.1)); ctx.stroke();
      }
    }
  }
  function frondFront(ctx, x, y, s, ang, t, cols, ph) {
    const sw = Math.sin(t * 0.9 + ph) * 0.06;
    for (let i = 0; i < 5; i++) { const a = ang + (i - 2) * 0.35 + sw; fernLeaf(ctx, x, y, x + Math.cos(a) * s, y + Math.sin(a) * s, s * 0.1, cols, i); }
  }
  function particles(ctx, w, h, t, o) {
    const r = rng(o.seed);
    for (let i = 0; i < o.n; i++) {
      const bx = r(), by = r(), sp = 0.3 + r(), ph = r() * TAU;
      let x, y, a = 1;
      if (o.kind === 'snow') { y = ((by + t * 0.03 * sp) % 1) * h * 1.05 - h * 0.02; x = ((bx + Math.sin(t * 0.5 * sp + ph) * 0.01) % 1) * w; }
      else if (o.kind === 'firefly') { x = (bx + Math.sin(t * 0.13 * sp + ph) * 0.05) * w; y = h * (o.y0 + (o.y1 - o.y0) * by) + Math.sin(t * 0.7 * sp + ph) * h * 0.03; a = Math.max(0, Math.sin(t * 1.3 * sp + ph)); }
      else { x = ((bx + t * 0.006 * sp) % 1) * w; y = h * (o.y0 + (o.y1 - o.y0) * by) + Math.sin(t * 0.6 * sp + ph) * h * 0.02; a = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.8 * sp + ph)); }
      const s = (o.size || 0.004) * h * (0.6 + r() * 0.8);
      if (o.kind === 'firefly') { ctx.fillStyle = rad(ctx, x, y, 0, s * 5, [[0, `rgba(230,255,150,${0.9 * a})`], [0.3, `rgba(190,255,90,${0.35 * a})`], [1, 'rgba(190,255,90,0)']]); ctx.fillRect(x - s * 5, y - s * 5, s * 10, s * 10); }
      else { ctx.fillStyle = rgba(o.col, (o.a || 0.8) * a); ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill(); }
    }
  }
  function rays(ctx, w, h, t, x, y, col, a) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const an = 1.75 + i * 0.13 + Math.sin(t * 0.1 + i) * 0.02, len = h * 1.1, wd = 0.035 + (i % 3) * 0.015, al = a * (0.5 + 0.5 * Math.sin(t * 0.3 + i * 1.7));
      ctx.fillStyle = lin(ctx, x, y, x + Math.cos(an) * len, y + Math.sin(an) * len, [[0, rgba(col, al)], [1, rgba(col, 0)]]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(an - wd) * len, y + Math.sin(an - wd) * len); ctx.lineTo(x + Math.cos(an + wd) * len, y + Math.sin(an + wd) * len); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function smoke(ctx, cx, top, s, t, col) {
    for (let i = 0; i < 12; i++) {
      const ph = (t * 0.045 + i / 12) % 1, x = cx + Math.sin(ph * 4 + i) * s * 0.5 * ph + ph * s * 2.2, y = top - ph * s * 5, r = s * (0.3 + ph * 1.2);
      ctx.fillStyle = rad(ctx, x, y, 0, r, [[0, rgba(col, 0.5 * (1 - ph))], [1, rgba(col, 0)]]); ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  /** Зернистость «краски» поверх слоя (только там, где уже нарисовано) */
  let grainPat = null;
  function grain(ctx, w, h, a) {
    if (!grainPat) { const c = document.createElement('canvas'); c.width = c.height = 160; const x = c.getContext('2d'), d = x.createImageData(160, 160), r = rng(42); for (let i = 0; i < d.data.length; i += 4) { const v = r() < 0.5 ? 0 : 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = Math.round(r() * 40); } x.putImageData(d, 0, 0); grainPat = c; }
    ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.globalAlpha = a || 0.5; ctx.fillStyle = ctx.createPattern(grainPat, 'repeat'); ctx.fillRect(X0(w), 0, XW(w), h); ctx.restore();
  }

  // ======================= ЛОКАЦИИ =======================
  const LIST = [];
  const JL = { bark: '#6b4a2e', barkD: '#4a3220', leaf: ['#1f4a2a', '#2c6b37', '#3f8a45', '#7fb560'] };

  // 1. Джунгли с вулканом
  LIST.push({
    id: 'jungle', name: 'Джунгли с вулканом', emoji: '🌋',
    zones: { ground: [0.67, 0.95], sky: [0.06, 0.34], water: { x0: 0.6, x1: 0.88, y0: 0.675, y1: 0.765 } },
    layers: [
      { depth: 0, draw(ctx, w, h) {
        sky(ctx, w, h, [[0, '#5fa8d8'], [0.55, '#a9d6e8'], [1, '#f2ead0']]);
        glow(ctx, w * 0.8, h * 0.17, h * 0.5, '#fff3c4', 0.85); ctx.fillStyle = '#fffbe6'; ctx.beginPath(); ctx.arc(w * 0.8, h * 0.17, h * 0.035, 0, TAU); ctx.fill();
      }, anim(ctx, w, h, t) { clouds(ctx, w, h, t, [[0.08, 0.12, 0.05, 1], [0.42, 0.07, 0.035, 0.7], [0.7, 0.22, 0.04, 0.9], [0.92, 0.1, 0.03, 0.6]], '#fffaf0', '#b9cbd8'); } },
      { depth: 0.15, draw(ctx, w, h) {
        mountains(ctx, w, h, { base: 0.5, amp: 0.07, seed: 3, col: '#9fb8c8', lit: '#c9d9e0', shade: '#7f97ab', haze: '#d8e6ea', hazeBottom: 0.6 });
        // вулкан
        const cx = w * 0.27, by = h * 0.6, wd = w * 0.44, ht = h * 0.38, top = by - ht, cw = wd * 0.07;
        ctx.save(); ctx.beginPath(); ctx.moveTo(cx - wd / 2, by); ctx.quadraticCurveTo(cx - wd * 0.16, by - ht * 0.42, cx - cw, top); ctx.lineTo(cx + cw, top + 2); ctx.quadraticCurveTo(cx + wd * 0.17, by - ht * 0.45, cx + wd / 2, by); ctx.closePath();
        ctx.fillStyle = lin(ctx, cx - wd / 2, 0, cx + wd / 2, 0, [[0, '#9b7f6e'], [0.45, '#7a6052'], [1, '#4f3d36']]); ctx.fill(); ctx.clip();
        const r = rng(4); for (let i = 0; i < 14; i++) { const x = cx + (r() - 0.5) * wd * 0.5; ctx.strokeStyle = rgba(r() < 0.5 ? '#3b2c27' : '#b49a86', 0.25); ctx.lineWidth = w * 0.004; ctx.beginPath(); ctx.moveTo(cx + (x - cx) * 0.15, top); ctx.quadraticCurveTo(x, by - ht * 0.5, cx + (x - cx) * 2.4, by); ctx.stroke(); }
        ctx.strokeStyle = '#ff7a2a'; ctx.lineWidth = w * 0.006; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx - cw * 0.3, top + 3); ctx.quadraticCurveTo(cx - cw * 1.6, top + ht * 0.25, cx - cw * 1.1, top + ht * 0.45); ctx.stroke();
        ctx.fillStyle = lin(ctx, 0, top, 0, by, [[0, 'rgba(216,230,234,0)'], [1, 'rgba(216,230,234,.55)']]); ctx.fillRect(cx - wd, top, wd * 2, ht);
        ctx.restore();
        ctx.fillStyle = '#ff9a3c'; ctx.beginPath(); ctx.ellipse(cx, top + 1, cw, cw * 0.25, 0, 0, TAU); ctx.fill();
      }, anim(ctx, w, h, t) {
        const cx = w * 0.27, top = h * 0.22; glow(ctx, cx, top, h * 0.08, '#ff8a3a', 0.25 + 0.12 * Math.sin(t * 1.3));
        smoke(ctx, cx, top - h * 0.01, h * 0.035, t, '#8a8590');
      } },
      { depth: 0.35, draw(ctx, w, h) {
        const r = rng(11), f = ridgeY(w, h * 0.585, h * 0.03, 7, 5);
        ctx.fillStyle = '#6f9a7a'; ctx.beginPath(); ctx.moveTo(X0(w), h); for (let x = X0(w); x <= w * 1.06; x += 8) ctx.lineTo(x, f(x)); ctx.lineTo(w * 1.06, h); ctx.fill();
        const hz = ['#56806a', '#6a9478', '#82a98a', '#a8c7a4'];
        for (let x = X0(w); x < w * 1.06; x += h * 0.035) clump(ctx, x + r() * h * 0.02, f(x) - h * 0.005, h * (0.025 + r() * 0.02), hz, r, 12);
        ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = lin(ctx, 0, h * 0.54, 0, h * 0.66, [[0, 'rgba(216,230,234,.35)'], [1, 'rgba(216,230,234,.08)']]); ctx.fillRect(X0(w), h * 0.5, XW(w), h * 0.2); ctx.restore();
      } },
      { depth: 0.6, draw(ctx, w, h) {
        const r = rng(21), J = { bark: '#5d4430', barkD: '#3f2d1f', leaf: ['#2b5534', '#3a6f40', '#52884e', '#86b067'] };
        tree(ctx, w * 0.42, h * 0.64, h * 0.26, J, r); tree(ctx, w * 0.12, h * 0.64, h * 0.3, J, r);
        treeFern(ctx, w * 0.55, h * 0.65, h * 0.2, J, r); treeFern(ctx, w * 0.33, h * 0.655, h * 0.16, J, r);
        palm(ctx, w * 0.92, h * 0.65, h * 0.3, -0.15, J, r); palm(ctx, w * 0.66, h * 0.645, h * 0.22, 0.12, J, r);
        for (let i = 0; i < 9; i++) clump(ctx, w * (i / 8) + (r() - 0.5) * w * 0.05, h * 0.645, h * (0.03 + r() * 0.025), J.leaf, r, 14);
      } },
      { depth: 1, pools: [{ ellipse: true, cx: 0.74, cy: 0.72, rx: 0.17, ry: 0.06, top: 0.66, bottom: 0.78, c1: '#5f9db0', c2: '#2f6f86', shore: '#8a7a55', alpha: 0.5, tint: '#2c6a80', seed: 4 }],
        draw(ctx, w, h) {
          ground(ctx, w, h, 0.645, ['#7da65a', '#5f8f43', '#3f6e30', '#9cc06a', '#4c7a35', '#b7a56a'], 5);
          grassTexture(ctx, w, h, 0.66, 1, ['#3f6e30', '#6c9a48', '#8db55c'], 6);
          water(ctx, w, h, this.pools[0]);
          const r = rng(8), RC = ['#6f6a62', '#8d877c', '#b3ab9c', '#7f9a5a'];
          rock(ctx, w * 0.58, h * 0.745, h * 0.02, RC); rock(ctx, w * 0.9, h * 0.705, h * 0.016, RC); rock(ctx, w * 0.2, h * 0.86, h * 0.035, RC); rock(ctx, w * 0.47, h * 0.93, h * 0.025, RC);
          for (let i = 0; i < 7; i++) { const x = r() * w, y = h * (0.7 + r() * 0.25); if (x > w * 0.55 && y < h * 0.8) continue; clump(ctx, x, y, h * (0.018 + r() * 0.015), ['#2f5a30', '#3f7a3a', '#5e9a48', '#8fbf62'], r, 12); }
          grain(ctx, w, h, 0.45);
        },
        anim(ctx, w, h, t) { waterAnim(ctx, w, h, t, this.pools[0], '#e8fbff', 22); } }
    ],
    drawFront(ctx, w, h, t) {
      rays(ctx, w, h, t, w * 0.8, h * 0.05, '#fff2c0', 0.045);
      swayGrass(ctx, w, h, t, { seed: 31, y0: 0.93, y1: 1.0, size: 0.06, cols: ['#2f6b2c', '#4d8a3a', '#6fa84a'], step: 7 });
      const s = Math.min(w, h) * 0.22, JC = ['#1f4a26', '#2f6b34', '#447f3e'];
      frondFront(ctx, -w * 0.01, h * 1.02, s, -1.0, t, JC, 0); frondFront(ctx, w * 1.01, h * 1.02, s * 0.9, -2.1, t, JC, 1.3);
      particles(ctx, w, h, t, { seed: 5, n: 14, y0: 0.35, y1: 0.85, col: '#fff7c8', size: 0.0025, a: 0.7 });
    }
  });

  // 2. Озеро / лагуна
  LIST.push({
    id: 'lagoon', name: 'Озеро-лагуна', emoji: '🏝️',
    zones: { ground: [0.74, 0.95], sky: [0.06, 0.3], water: { x0: 0.05, x1: 0.95, y0: 0.52, y1: 0.67 } },
    layers: [
      { depth: 0, draw(ctx, w, h) { sky(ctx, w, h, [[0, '#4f9fd6'], [0.6, '#9fd0ea'], [1, '#fbe8c8']], 0.5); glow(ctx, w * 0.22, h * 0.2, h * 0.45, '#fff1c8', 0.9); ctx.fillStyle = '#fffbe8'; ctx.beginPath(); ctx.arc(w * 0.22, h * 0.2, h * 0.032, 0, TAU); ctx.fill(); },
        anim(ctx, w, h, t) { clouds(ctx, w, h, t, [[0.2, 0.1, 0.04, 0.8], [0.6, 0.16, 0.05, 1], [0.85, 0.07, 0.03, 0.6]], '#ffffff', '#bfd2e0'); } },
      { depth: 0.12, draw(ctx, w, h) { mountains(ctx, w, h, { base: 0.44, amp: 0.1, seed: 12, freq: 2.4, col: '#93abc3', lit: '#c4d4e2', shade: '#6f88a3', haze: '#e3ecf0', hazeBottom: 0.7, bottom: 0.5 }); } },
      { depth: 0.3, draw(ctx, w, h) {
        const r = rng(14), C = ['#3d6a55', '#4f7e5e', '#6a9670', '#97b98c'];
        [[0.0, 0.2, 0.06], [0.83, 0.25, 0.07]].forEach(([fx, fw, fh]) => { ctx.fillStyle = '#4a7458'; ctx.beginPath(); ctx.ellipse(w * (fx + fw / 2), h * 0.5, w * fw * 0.7, h * fh, 0, Math.PI, 0); ctx.fill(); for (let i = 0; i < 14; i++) clump(ctx, w * (fx + r() * fw), h * (0.5 - r() * fh * 0.8), h * (0.02 + r() * 0.015), C, r, 10); });
        ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(227,236,240,.3)'; ctx.fillRect(X0(w), h * 0.38, XW(w), h * 0.14); ctx.restore();
      } },
      { depth: 1, pools: [{ bank: (x, side, w, h) => side ? h * (0.705 + Math.sin(x / w * 7) * 0.008) : h * 0.5, top: 0.5, bottom: 0.72, c1: '#7fb8c8', c2: '#2f7d95', alpha: 0.55, tint: '#3a8aa0', seed: 9, edge: '#fff6e0' }],
        draw(ctx, w, h) {
          water(ctx, w, h, this.pools[0]);
          ctx.fillStyle = lin(ctx, 0, h * 0.62, 0, h * 0.72, [[0, 'rgba(120,210,200,0)'], [1, 'rgba(120,210,200,.45)']]); ctx.fill(poolPath(this.pools[0], w, h));
          ground(ctx, w, h, 0.705, ['#e6d3a3', '#d6be86', '#b99c66', '#f2e2bb', '#c9ad78', '#a8916a'], 15, 0.006);
          ctx.strokeStyle = 'rgba(140,110,70,.35)'; ctx.lineWidth = h * 0.006; ctx.beginPath(); for (let x = X0(w); x < w * 1.06; x += 8) ctx.lineTo(x, h * (0.712 + Math.sin(x / w * 7) * 0.008)); ctx.stroke();
          const r = rng(16), P = { bark: '#8a6a48', barkD: '#6a4e34', leaf: ['#2e5a32', '#3f7a3c', '#5c9a4a', '#8ebf62'] };
          palm(ctx, w * 0.06, h * 0.98, h * 0.55, 0.22, P, r); palm(ctx, w * 0.96, h * 0.96, h * 0.48, -0.25, P, r); palm(ctx, w * 0.88, h * 0.8, h * 0.3, -0.12, P, r);
          const RC = ['#6d6a64', '#8f8a80', '#b8b0a2'];
          rock(ctx, w * 0.32, h * 0.62, h * 0.018, RC); rock(ctx, w * 0.7, h * 0.58, h * 0.012, RC); rock(ctx, w * 0.5, h * 0.88, h * 0.03, RC);
          grassTexture(ctx, w, h, 0.76, 1, ['#8a9a54', '#a3ad62'], 17, 0.15);
          grain(ctx, w, h, 0.4);
        },
        anim(ctx, w, h, t) {
          waterAnim(ctx, w, h, t, this.pools[0], '#ffffff', 34);
          ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = h * 0.005; ctx.lineCap = 'round';
          for (let k = 0; k < 2; k++) { const ph = (t * 0.25 + k * 0.5) % 1; ctx.globalAlpha = Math.sin(ph * Math.PI); ctx.beginPath(); for (let x = X0(w); x < w * 1.06; x += 10) ctx.lineTo(x, h * (0.7 + Math.sin(x / w * 7) * 0.008) - ph * h * 0.012 + Math.sin(x * 0.05 + t) * 1.5); ctx.stroke(); }
          ctx.globalAlpha = 1;
        } }
    ],
    drawFront(ctx, w, h, t) { swayGrass(ctx, w, h, t, { seed: 41, y0: 0.95, y1: 1.0, size: 0.05, cols: ['#8a9a54', '#a8b066', '#6f8443'], step: 22 }); particles(ctx, w, h, t, { seed: 8, n: 10, y0: 0.5, y1: 0.7, col: '#ffffff', size: 0.003, a: 0.9 }); }
  });

  // 3. Пустыня-каньон
  LIST.push({
    id: 'canyon', name: 'Пустыня-каньон', emoji: '🏜️',
    zones: { ground: [0.71, 0.95], sky: [0.06, 0.32], water: { x0: 0.04, x1: 0.96, y0: 0.615, y1: 0.665 } },
    layers: [
      { depth: 0, draw(ctx, w, h) { sky(ctx, w, h, [[0, '#6aa2d0'], [0.5, '#e9c9a0'], [1, '#f4a96e']], 0.6); glow(ctx, w * 0.62, h * 0.36, h * 0.6, '#ffd59a', 0.8); ctx.fillStyle = '#fff1d0'; ctx.beginPath(); ctx.arc(w * 0.62, h * 0.36, h * 0.04, 0, TAU); ctx.fill(); },
        anim(ctx, w, h, t) { clouds(ctx, w, h, t, [[0.15, 0.1, 0.035, 0.5], [0.7, 0.14, 0.03, 0.4]], '#fff4e4', '#e0b8a0'); } },
      { depth: 0.12, draw(ctx, w, h) {
        const H = { col: '#c99a8a', lit: '#e6c0ac', shade: '#a77a72', haze: '#f2c8a4', hazeA: 0.45 };
        [[0.1, 0.18, 0.1, 1], [0.4, 0.12, 0.07, 2], [0.75, 0.2, 0.12, 3], [1.0, 0.14, 0.08, 4]].forEach(([fx, fw, fh, s]) => mesa(ctx, w * fx, h * 0.52, w * fw, h * fh, Object.assign({ seed: s }, H)));
      } },
      { depth: 0.3, draw(ctx, w, h) {
        const H = { col: '#c4724a', lit: '#e8a070', shade: '#8a4a34', haze: '#f2c8a4', hazeA: 0.2, top: '#e0b080' };
        [[0.25, 0.24, 0.16, 5], [0.62, 0.16, 0.12, 6]].forEach(([fx, fw, fh, s]) => mesa(ctx, w * fx, h * 0.6, w * fw, h * fh, Object.assign({ seed: s }, H)));
      } },
      { depth: 0.55, draw(ctx, w, h) {
        const H = { col: '#a85a3a', lit: '#d98a5a', shade: '#6a3424', top: '#d9a070', haze: '#f2c8a4', hazeA: 0.08 };
        mesa(ctx, w * 0.02, h * 0.67, w * 0.5, h * 0.3, Object.assign({ seed: 22 }, H)); mesa(ctx, w * 1.0, h * 0.67, w * 0.42, h * 0.25, Object.assign({ seed: 23 }, H));
        // проём каньона посередине — небо и дальние слои видны
      } },
      { depth: 1, pools: [{ bank: (x, side, w, h) => h * (side ? 0.668 + Math.sin(x / w * 9 + 1) * 0.006 : 0.612 + Math.sin(x / w * 6) * 0.005), top: 0.6, bottom: 0.675, c1: '#7aa6a8', c2: '#3f7c86', alpha: 0.5, tint: '#4f8a90', seed: 12, edge: '#ffe8c8' }],
        draw(ctx, w, h) {
          ground(ctx, w, h, 0.6, ['#d9a06a', '#c9895a', '#a86a44', '#e8b884', '#b87a4c', '#9a6040'], 25, 0.008);
          water(ctx, w, h, this.pools[0]);
          ctx.strokeStyle = 'rgba(110,70,40,.35)'; ctx.lineWidth = h * 0.006; ctx.beginPath(); for (let x = X0(w); x < w * 1.06; x += 8) ctx.lineTo(x, h * (0.672 + Math.sin(x / w * 9 + 1) * 0.006)); ctx.stroke();
          const r = rng(26), RC = ['#7a4632', '#a8623f', '#cf8a5c', null];
          [[0.12, 0.8, 0.045], [0.83, 0.84, 0.06], [0.45, 0.93, 0.028], [0.62, 0.74, 0.02], [0.3, 0.72, 0.018]].forEach(([x, y, s]) => rock(ctx, w * x, h * y, h * s, RC));
          const S = ['#6a6a3a', '#7d7a44', '#9a9658', '#b9b070'];
          for (let i = 0; i < 9; i++) clump(ctx, r() * w, h * (0.72 + r() * 0.24), h * (0.012 + r() * 0.01), S, r, 9);
          // цикадовые
          [[0.92, 0.74, 0.08], [0.06, 0.73, 0.07]].forEach(([x, y, s]) => { trunk(ctx, w * x, h * y, h * s * 0.5, h * s * 0.12, 0, '#7a5a3a', '#5a402a'); for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i / 8 - 0.5) * 2.6; fernLeaf(ctx, w * x, h * y - h * s * 0.5, w * x + Math.cos(a) * h * s * 0.6, h * y - h * s * 0.5 + Math.sin(a) * h * s * 0.35 + h * s * 0.1, h * s * 0.05, ['#3f5a2a', '#5a7a36', '#7d9a48'], i); } });
          grassTexture(ctx, w, h, 0.68, 1, ['#a8955a', '#8a7a48', '#c4ad6a'], 27, 0.2);
          grain(ctx, w, h, 0.5);
        },
        anim(ctx, w, h, t) { waterAnim(ctx, w, h, t, this.pools[0], '#fff2dc', 26); } }
    ],
    drawFront(ctx, w, h, t) { swayGrass(ctx, w, h, t, { seed: 51, y0: 0.94, y1: 1.0, size: 0.05, cols: ['#a8955a', '#c4ad6a', '#8a7a48'], step: 16 }); particles(ctx, w, h, t, { seed: 9, n: 16, y0: 0.4, y1: 0.95, col: '#f8dcb0', size: 0.002, a: 0.6 }); }
  });

  // 4. Ледниковая долина
  LIST.push({
    id: 'glacier', name: 'Ледниковая долина', emoji: '🏔️',
    zones: { ground: [0.71, 0.95], sky: [0.06, 0.3], water: { x0: 0.26, x1: 0.74, y0: 0.61, y1: 0.675 } },
    layers: [
      { depth: 0, draw(ctx, w, h) { sky(ctx, w, h, [[0, '#7fb0d8'], [0.6, '#c3dbea'], [1, '#eef3f6']], 0.55); glow(ctx, w * 0.7, h * 0.14, h * 0.35, '#ffffff', 0.7); },
        anim(ctx, w, h, t) { clouds(ctx, w, h, t, [[0.1, 0.18, 0.045, 0.6], [0.5, 0.08, 0.035, 0.5], [0.8, 0.2, 0.04, 0.7]], '#ffffff', '#c5d3e0'); } },
      { depth: 0.12, draw(ctx, w, h) { mountains(ctx, w, h, { base: 0.42, amp: 0.13, seed: 31, freq: 2.6, sharp: true, col: '#9fb2c8', lit: '#cfdbe6', shade: '#7488a3', snow: '#f4f8fb', snowLine: 0.335, snowShade: '#bcc9da', haze: '#e6eef4', hazeBottom: 0.65, bottom: 0.52 }); } },
      { depth: 0.3, draw(ctx, w, h) {
        mountains(ctx, w, h, { base: 0.52, amp: 0.16, seed: 33, freq: 1.6, sharp: true, col: '#6f7f92', lit: '#9aaabb', shade: '#4b5a6d', snow: '#f7fbff', snowLine: 0.425, snowShade: '#aebfd4', haze: '#e6eef4', hazeBottom: 0.35, bottom: 0.62 });
        // ледниковый язык к озеру
        ctx.fillStyle = lin(ctx, 0, h * 0.4, 0, h * 0.62, [[0, '#e9f3fa'], [1, '#bcd8ea']]);
        ctx.beginPath(); ctx.moveTo(w * 0.44, h * 0.42); ctx.quadraticCurveTo(w * 0.36, h * 0.54, w * 0.32, h * 0.62); ctx.lineTo(w * 0.62, h * 0.62); ctx.quadraticCurveTo(w * 0.56, h * 0.52, w * 0.5, h * 0.42); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(120,160,200,.45)'; ctx.lineWidth = h * 0.003; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(w * (0.45 + i * 0.008), h * 0.44); ctx.quadraticCurveTo(w * (0.4 + i * 0.03), h * 0.54, w * (0.35 + i * 0.05), h * 0.62); ctx.stroke(); }
      } },
      { depth: 0.55, draw(ctx, w, h) {
        const r = rng(35), C = { bark: '#4a3a2e', leaf: ['#1f3a34', '#2c4f44', '#456e5e'] };
        for (let i = 0; i < 22; i++) { const x = r() < 0.5 ? r() * w * 0.3 : w * (0.7 + r() * 0.32); conifer(ctx, x, h * (0.62 + r() * 0.02), h * (0.08 + r() * 0.08), C, r, '#f2f7fb'); }
      } },
      { depth: 1, pools: [{ ellipse: true, cx: 0.5, cy: 0.645, rx: 0.28, ry: 0.045, top: 0.6, bottom: 0.69, c1: '#8fb8cf', c2: '#4f86a6', shore: '#d8e4ee', alpha: 0.6, tint: '#5a8fb0', seed: 15 }],
        draw(ctx, w, h) {
          ground(ctx, w, h, 0.615, ['#eef4f8', '#dfe9f1', '#c6d5e2', '#ffffff', '#b8c9d8', '#a9bccc'], 35, 0.008);
          water(ctx, w, h, this.pools[0]);
          const r = rng(37);
          ctx.save(); ctx.clip(poolPath(this.pools[0], w, h));
          for (let i = 0; i < 6; i++) { const x = w * (0.28 + r() * 0.44), y = h * (0.615 + r() * 0.055), s = h * (0.008 + r() * 0.012); ctx.fillStyle = '#f4f9fc'; ctx.beginPath(); ctx.ellipse(x, y, s * 2.4, s * 0.6, 0, 0, TAU); ctx.fill(); ctx.fillStyle = 'rgba(120,170,210,.5)'; ctx.fillRect(x - s * 2.2, y + s * 0.2, s * 4.4, s * 0.35); }
          ctx.restore();
          const RC = ['#4f5a66', '#6f7a86', '#9aa4ae', '#f6fafd'];
          [[0.14, 0.82, 0.04], [0.86, 0.78, 0.035], [0.6, 0.92, 0.025], [0.3, 0.72, 0.016]].forEach(([x, y, s]) => rock(ctx, w * x, h * y, h * s, RC));
          grassTexture(ctx, w, h, 0.7, 1, ['#9a8f6a', '#b0a47a'], 38, 0.08);
          grain(ctx, w, h, 0.3);
        },
        anim(ctx, w, h, t) { waterAnim(ctx, w, h, t, this.pools[0], '#ffffff', 20); } }
    ],
    drawFront(ctx, w, h, t) { swayGrass(ctx, w, h, t, { seed: 61, y0: 0.95, y1: 1.0, size: 0.045, cols: ['#a89a70', '#8a7f5a'], step: 26 }); particles(ctx, w, h, t, { kind: 'snow', seed: 10, n: 70, col: '#ffffff', size: 0.0035, a: 0.9 }); }
  });

  // 5. Ночной лес
  LIST.push({
    id: 'nightforest', name: 'Ночной лес', emoji: '🌙', night: true,
    zones: { ground: [0.69, 0.95], sky: [0.08, 0.34], water: { x0: 0.13, x1: 0.43, y0: 0.675, y1: 0.765 } },
    layers: [
      { depth: 0, draw(ctx, w, h) {
        sky(ctx, w, h, [[0, '#14244a'], [0.6, '#2d4a7a'], [1, '#5a6f96']], 0.62);
        const r = rng(51); for (let i = 0; i < 160; i++) { const x = X0(w) + r() * XW(w), y = r() * h * 0.5, s = r() * 1.4 + 0.3; ctx.fillStyle = `rgba(255,255,240,${0.3 + r() * 0.6})`; ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill(); }
        glow(ctx, w * 0.76, h * 0.17, h * 0.4, '#dfe8ff', 0.5); ctx.fillStyle = '#f6f3e2'; ctx.beginPath(); ctx.arc(w * 0.76, h * 0.17, h * 0.05, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(200,196,170,.5)'; [[-0.012, -0.01, 0.012], [0.015, 0.012, 0.008], [0.005, -0.02, 0.006]].forEach(([dx, dy, s]) => { ctx.beginPath(); ctx.arc(w * 0.76 + dx * h * 2, h * 0.17 + dy * h * 2, s * h, 0, TAU); ctx.fill(); });
      }, anim(ctx, w, h, t) {
        const r = rng(52); for (let i = 0; i < 24; i++) { const x = r() * w, y = r() * h * 0.45, a = Math.max(0, Math.sin(t * (0.5 + r()) + i * 3)); ctx.fillStyle = `rgba(255,255,255,${a * 0.9})`; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill(); }
        clouds(ctx, w, h, t, [[0.3, 0.12, 0.04, 0.4], [0.75, 0.26, 0.035, 0.3]], '#6a7aa0', '#3a4870');
      } },
      { depth: 0.12, draw(ctx, w, h) { mountains(ctx, w, h, { base: 0.52, amp: 0.08, seed: 53, freq: 2, col: '#3a4f78', lit: '#55709a', shade: '#2a3a5c', haze: '#5a6f96', hazeBottom: 0.5 }); } },
      { depth: 0.3, draw(ctx, w, h) { const r = rng(55), C = { bark: '#1e2a40', leaf: ['#1b2a44', '#22344f', '#2f4a6a'] }; for (let i = 0; i < 40; i++) conifer(ctx, X0(w) + r() * XW(w), h * (0.6 + r() * 0.02), h * (0.07 + r() * 0.07), C, r); ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(90,111,150,.3)'; ctx.fillRect(X0(w), h * 0.45, XW(w), h * 0.2); ctx.restore(); } },
      { depth: 0.55, draw(ctx, w, h) {
        const r = rng(57), C = { bark: '#2a2a34', barkD: '#1a1a24', leaf: ['#142236', '#1d3048', '#2a4560', '#4a6a8a'] };
        tree(ctx, w * 0.06, h * 0.67, h * 0.45, C, r); tree(ctx, w * 0.93, h * 0.67, h * 0.5, C, r); tree(ctx, w * 0.62, h * 0.66, h * 0.28, C, r);
        const Cc = { bark: '#1e2a40', leaf: ['#16263c', '#1f3350', '#35557a'] }; for (let i = 0; i < 8; i++) conifer(ctx, w * (0.2 + r() * 0.65), h * 0.665, h * (0.12 + r() * 0.1), Cc, r);
      } },
      { depth: 1, pools: [{ ellipse: true, cx: 0.28, cy: 0.72, rx: 0.17, ry: 0.055, top: 0.665, bottom: 0.775, c1: '#30486e', c2: '#1a2a48', shore: '#2c3a40', alpha: 0.7, tint: '#203a60', seed: 20, edge: '#9fb4dd' }],
        draw(ctx, w, h) {
          ground(ctx, w, h, 0.655, ['#2f4a4a', '#253c3e', '#18282c', '#3a5a50', '#1e3434', '#46605a'], 45);
          grassTexture(ctx, w, h, 0.67, 1, ['#1e3a34', '#2f5048', '#3f6a5a'], 46);
          water(ctx, w, h, this.pools[0]);
          const RC = ['#2a3036', '#3f4852', '#5a6874', '#3f5a48'];
          [[0.5, 0.8, 0.03], [0.82, 0.88, 0.04], [0.08, 0.84, 0.03]].forEach(([x, y, s]) => rock(ctx, w * x, h * y, h * s, RC));
          // светящиеся грибы
          const r = rng(47); for (let i = 0; i < 8; i++) { const x = w * (0.48 + r() * 0.5), y = h * (0.72 + r() * 0.22), s = h * (0.006 + r() * 0.006); ctx.fillStyle = '#d8e8f0'; ctx.fillRect(x - s * 0.2, y - s, s * 0.4, s); ctx.fillStyle = '#7fe0d0'; ctx.beginPath(); ctx.ellipse(x, y - s, s, s * 0.55, 0, Math.PI, 0); ctx.fill(); }
          grain(ctx, w, h, 0.35);
        },
        anim(ctx, w, h, t) {
          const p = this.pools[0]; waterAnim(ctx, w, h, t, p, '#cfe0ff', 18);
          const r = rng(47); for (let i = 0; i < 8; i++) { const x = w * (0.48 + r() * 0.5), y = h * (0.72 + r() * 0.22), s = h * (0.006 + r() * 0.006); r(); glow(ctx, x, y - s, s * 5, '#7fffe0', 0.25 + 0.12 * Math.sin(t * 1.5 + i)); }
        } }
    ],
    drawFront(ctx, w, h, t) {
      ctx.fillStyle = 'rgba(160,180,220,.08)'; for (let k = 0; k < 2; k++) { const x = ((t * 6 + k * w * 0.6) % (w * 1.6)) - w * 0.3; ctx.beginPath(); ctx.ellipse(x, h * (0.7 + k * 0.08), w * 0.35, h * 0.03, 0, 0, TAU); ctx.fill(); }
      swayGrass(ctx, w, h, t, { seed: 71, y0: 0.93, y1: 1.0, size: 0.06, cols: ['#12261f', '#1b3a30', '#24483c'], step: 8 });
      const s = Math.min(w, h) * 0.22, C = ['#0e1c1a', '#16302a', '#1f4036']; frondFront(ctx, -w * 0.01, h * 1.02, s, -1.0, t, C, 0); frondFront(ctx, w * 1.01, h * 1.02, s, -2.1, t, C, 1);
    },
    glow(ctx, w, h, t) { particles(ctx, w, h, t, { kind: 'firefly', seed: 12, n: 22, y0: 0.45, y1: 0.95, size: 0.004 }); }
  });

  // общий «Свой фон» (фото, загруженное к одной из локаций)
  const CUSTOM = { id: 'custom', name: 'Свой фон', zones: { ground: [0.64, 0.95], sky: [0.06, 0.36], water: { x0: 0.08, x1: 0.92, y0: 0.47, y1: 0.6 } } };
  const ALIAS = { beach: 'lagoon', night: 'nightforest', underwater: 'lagoon' };

  /** Нарисовать локацию целиком без параллакса (для превью и отражений) */
  function drawStatic(b, ctx, w, h, t) {
    b.layers.forEach(L => { L.draw.call(L, ctx, w, h); if (t != null && L.anim) L.anim.call(L, ctx, w, h, t); });
  }
  LIST.forEach(b => { b.drawStatic = function (ctx, w, h) { drawStatic(b, ctx, w, h); }; });

  const byId = {}; LIST.forEach(b => byId[b.id] = b);
  const thumbCache = {};
  function thumb(id, w, h) {
    id = ALIAS[id] || id; if (!byId[id]) id = 'jungle';
    w = w || 240; h = h || 150;
    const key = id + w + 'x' + h; if (thumbCache[key]) return thumbCache[key];
    const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const x = c.getContext('2d');
    const b = byId[id]; drawStatic(b, x, c.width, c.height, 3); b.drawFront && b.drawFront(x, c.width, c.height, 3); b.glow && b.glow(x, c.width, c.height, 3);
    return (thumbCache[key] = c.toDataURL('image/jpeg', 0.85));
  }
  DP.BG = { LIST, byId, CUSTOM, ALIAS, thumb, mix, poolPath, get(id) { id = ALIAS[id] || id; return byId[id] || (id === 'custom' ? CUSTOM : LIST[0]); } };
})();
