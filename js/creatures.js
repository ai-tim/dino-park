/* Динопарк — обитатели и детали мира поверх движка сцены: кусты и камни (за ними прячутся в прятках),
 * яйца и подарки на земле, зверьки-млекопитающие, австралопитеки со стоянкой (костёр, шалаш), шапки.
 * Всё рисуется процедурно и дёшево (несколько фигур на объект) — без новых холстов, чтобы не тратить память iPhone. */
window.DP = window.DP || {};
(function () {
  const TAU = Math.PI * 2, U = () => DP.util, P = DP.Scene.prototype;
  const L = () => DP.Life;
  const STYLE = {
    jungle: { leaf: ['#24561f', '#2f6f28', '#3f8a36', '#5aa845'], rock: ['#6d6a62', '#8d897f', '#a9a498'], kinds: ['bush', 'fern', 'bush', 'rock', 'flowers', 'bush'] },
    lagoon: { leaf: ['#2d6340', '#3a7a4a', '#58a060', '#8cc070'], rock: ['#8a7f70', '#a89c88', '#c8bca4'], kinds: ['bush', 'rock', 'reeds', 'bush', 'shells'] },
    canyon: { leaf: ['#5d5a2a', '#7a7a3a', '#9a9a4a', '#b8b060'], rock: ['#9a5a3a', '#b8714a', '#d08a5e'], kinds: ['dry', 'rock', 'cactus', 'rock', 'dry'] },
    glacier: { leaf: ['#34524a', '#4a6a5a', '#6a8a7a', '#eef6fa'], rock: ['#8aa0b0', '#aec2d0', '#dfeaf2'], kinds: ['snowbush', 'ice', 'snowbush', 'rock'] },
    nightforest: { leaf: ['#16302e', '#1f3a3a', '#2a5048', '#3d6a5a'], rock: ['#3d4250', '#545a6a', '#6a7082'], kinds: ['bush', 'mush', 'fern', 'bush', 'rock'] }
  };
  STYLE.custom = STYLE.jungle;
  const HIDE = { bush: 1, fern: 1, snowbush: 1, reeds: 1, dry: 1, rock: 1, ice: 1 };

  // ——— кусты, камни, цветы ———
  P.buildProps = function () {
    (this.ents || []).forEach(e => { if (e.hideAt) { e.hideAt = null; if (e.state === 'hide' || e.state === 'hidden') e.state = 'wander'; } });
    const st = STYLE[this.bg.id] || STYLE.jungle, W = this.W, z = this.zone('ground', true), bw = this.baseW();
    const r = mulberry(hashStr(this.bg.id + (this._customUrl ? 'c' : '')));
    const n = U().clamp(Math.round(W / 165), 5, 12), out = [];
    for (let i = 0; i < n; i++) {
      const kind = st.kinds[i % st.kinds.length];
      let x = z.x0 + (i + 0.2 + r() * 0.6) / n * (z.x1 - z.x0), y = z.y0 + (0.08 + r() * 0.8) * (z.y1 - z.y0);
      for (let k = 0; k < 6 && this.inWater(x, y); k++) { x = z.x0 + r() * (z.x1 - z.x0); y = z.y0 + (0.3 + r() * 0.7) * (z.y1 - z.y0); }
      if (this.inWater(x, y)) continue;
      const depth = 0.6 + 0.6 * (y - z.y0) / Math.max(1, z.y1 - z.y0);
      const big = kind === 'rock' || kind === 'ice' ? 0.34 : kind === 'flowers' || kind === 'shells' || kind === 'mush' ? 0.28 : 0.4;
      const p = { kind, x, y, r: bw * big * depth * (0.85 + r() * 0.3), hide: !!HIDE[kind], leaf: st.leaf[2], st, seed: r() * 100, blobs: [] };
      const nb = kind === 'rock' || kind === 'ice' ? 3 : 7;
      for (let b = 0; b < nb; b++) p.blobs.push({ a: (b / nb) * Math.PI - Math.PI + r() * 0.4, d: 0.45 + r() * 0.45, s: 0.45 + r() * 0.35, c: Math.floor(r() * 3) });
      out.push(p);
    }
    this.props = out;
  };
  P.drawPropItem = function (ctx, p) {
    const t = this.t, r = p.r, st = p.st, busy = p.busy && p.busy.state === 'hidden';
    let wob = busy && (t * 0.7 + p.seed) % 3 < 0.5 ? Math.sin(t * 28) * r * 0.06 : Math.sin(t * 0.9 + p.seed) * r * 0.01;
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(15,25,10,.22)'; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.05, r * 0.22, 0, 0, TAU); ctx.fill();
    if (busy && ((t * 0.5 + p.seed) % 4) < 1.4) { // подсматривает из-за куста
      ctx.font = `${Math.round(r * 0.55)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('👀', r * 0.3 * Math.sin(p.seed), -r * 1.25);
    }
    const k = p.kind;
    if (k === 'rock' || k === 'ice') {
      const c = st.rock;
      ctx.fillStyle = c[0]; ctx.beginPath(); ctx.moveTo(-r, 0); ctx.quadraticCurveTo(-r * 0.95, -r * 0.9, -r * 0.2, -r * 1.05); ctx.quadraticCurveTo(r * 0.7, -r * 1.1, r, -r * 0.2); ctx.lineTo(r, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c[1]; ctx.beginPath(); ctx.moveTo(-r * 0.8, -r * 0.1); ctx.quadraticCurveTo(-r * 0.75, -r * 0.8, -r * 0.15, -r * 0.92); ctx.quadraticCurveTo(r * 0.4, -r * 0.95, r * 0.55, -r * 0.45); ctx.quadraticCurveTo(r * 0.1, -r * 0.3, -r * 0.8, -r * 0.1); ctx.fill();
      ctx.fillStyle = c[2]; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.75, r * 0.25, r * 0.09, -0.3, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      if (k === 'ice') { ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.ellipse(0, -r * 1.0, r * 0.7, r * 0.14, 0, 0, TAU); ctx.fill(); }
      if (p.paint) { ctx.strokeStyle = 'rgba(150,40,20,.75)'; ctx.lineWidth = Math.max(1.2, r * 0.05); ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.4); ctx.quadraticCurveTo(-r * 0.2, -r * 0.75, r * 0.15, -r * 0.5); ctx.lineTo(r * 0.35, -r * 0.62); ctx.moveTo(-r * 0.3, -r * 0.5); ctx.lineTo(-r * 0.35, -r * 0.3); ctx.moveTo(0, -r * 0.55); ctx.lineTo(0.02 * r, -r * 0.33); ctx.stroke(); }
    } else if (k === 'cactus') {
      ctx.fillStyle = '#4f7a3a'; ctx.strokeStyle = '#2f5a24'; ctx.lineWidth = Math.max(1, r * 0.05);
      rr(ctx, -r * 0.16, -r * 1.5, r * 0.32, r * 1.5, r * 0.16); ctx.fill(); ctx.stroke();
      rr(ctx, -r * 0.55, -r * 1.05, r * 0.22, r * 0.6, r * 0.11); ctx.fill(); ctx.stroke(); rr(ctx, r * 0.32, -r * 1.2, r * 0.22, r * 0.55, r * 0.11); ctx.fill(); ctx.stroke();
    } else if (k === 'flowers' || k === 'shells' || k === 'mush') {
      for (let i = 0; i < 6; i++) {
        const b = p.blobs[i % p.blobs.length], x = Math.cos(b.a) * r * b.d * 1.2, y = -Math.abs(Math.sin(b.a)) * r * 0.25;
        if (k === 'flowers') { ctx.strokeStyle = '#3f7a30'; ctx.lineWidth = Math.max(1, r * 0.04); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - r * 0.35); ctx.stroke(); ctx.fillStyle = ['#ff6b9a', '#ffd43b', '#ffffff'][b.c]; ctx.beginPath(); ctx.arc(x, y - r * 0.38, r * 0.1, 0, TAU); ctx.fill(); }
        else if (k === 'shells') { ctx.fillStyle = ['#ffe3d3', '#f7c6a8', '#fff3e0'][b.c]; ctx.beginPath(); ctx.ellipse(x, y, r * 0.12, r * 0.09, b.a, 0, TAU); ctx.fill(); }
        else { const gl = 0.6 + 0.4 * Math.sin(t * 2 + i); ctx.fillStyle = '#e8e2c8'; ctx.fillRect(x - r * 0.03, y - r * 0.25, r * 0.06, r * 0.25); ctx.fillStyle = `rgba(120,240,220,${gl})`; ctx.beginPath(); ctx.ellipse(x, y - r * 0.26, r * 0.14, r * 0.08, 0, Math.PI, 0); ctx.fill(); }
      }
    } else if (k === 'reeds') {
      ctx.lineCap = 'round';
      for (let i = 0; i < 9; i++) { const x = (i / 8 - 0.5) * r * 1.6, h = r * (1.1 + ((i * 37) % 7) / 10); ctx.strokeStyle = st.leaf[i % 3]; ctx.lineWidth = Math.max(1.5, r * 0.07); ctx.beginPath(); ctx.moveTo(x, 0); ctx.quadraticCurveTo(x + wob * 2, -h * 0.6, x + wob * 3 + (i % 2 ? 4 : -4), -h); ctx.stroke(); if (i % 3 === 0) { ctx.fillStyle = '#7a5230'; ctx.beginPath(); ctx.ellipse(x + wob * 3 + (i % 2 ? 4 : -4), -h, r * 0.05, r * 0.14, 0, 0, TAU); ctx.fill(); } }
    } else { // кусты, папоротник, сухой куст, заснеженный куст
      if (k === 'fern') {
        ctx.lineCap = 'round';
        for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i / 6 - 0.5) * 2.4, len = r * (1.1 + (i % 2) * 0.3); ctx.strokeStyle = st.leaf[1 + (i % 2)]; ctx.lineWidth = Math.max(2, r * 0.16); ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(Math.cos(a) * len * 0.5 + wob, Math.sin(a) * len * 0.6, Math.cos(a) * len + wob * 2, Math.sin(a) * len * 0.9); ctx.stroke(); }
      } else {
        const cols = k === 'dry' ? ['#6a5a2a', '#8a7a3a', '#a89a50'] : st.leaf;
        ctx.fillStyle = cols[0]; ctx.beginPath(); ctx.ellipse(wob * 0.5, -r * 0.42, r * 1.0, r * 0.5, 0, 0, TAU); ctx.fill();
        p.blobs.forEach((b, i) => { ctx.fillStyle = cols[1 + (b.c % 2)]; ctx.beginPath(); ctx.arc(Math.cos(b.a) * r * b.d * 0.95 + wob * (1 + i * 0.2), -r * 0.42 + Math.sin(b.a) * r * b.d * 0.75, r * b.s * 0.62, 0, TAU); ctx.fill(); });
        ctx.fillStyle = k === 'snowbush' ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.12)';
        ctx.beginPath(); ctx.ellipse(-r * 0.15 + wob, -r * 0.92, r * (k === 'snowbush' ? 0.75 : 0.35), r * (k === 'snowbush' ? 0.2 : 0.12), -0.1, 0, TAU); ctx.fill();
        if (k === 'bush' && this.bg.id === 'jungle') { ctx.fillStyle = '#d6336c'; [[0.3, -0.7], [-0.45, -0.55], [0.6, -0.4]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(r * a + wob, r * b, r * 0.06, 0, TAU); ctx.fill(); }); }
      }
    }
    ctx.restore();
  };

  // ——— жизнь парка в сцене ———
  P.setLife = function (life, park) {
    this.life = life || null; this._park = park || null;
    if (!life) { this.critters = []; return; }
    const keep = {}, bw = this.baseW();
    this.critters = this.critters || [];
    (life.mammals || []).forEach(m => { keep[m.id] = 1; if (!this.critters.find(c => c.id === m.id)) this.critters.push(this.makeCritter(m, 'mammal')); });
    (life.tribe || []).forEach(a => { keep[a.id] = 1; let c = this.critters.find(x => x.id === a.id); if (!c) { c = this.makeCritter(a, 'ape'); this.critters.push(c); } c.src = a; c.name = a.name; });
    this.critters.forEach(c => { if (c.kind === 'mammal') c.src = (life.mammals || []).find(m => m.id === c.id) || c.src; });
    this.critters = this.critters.filter(c => keep[c.id]);
    const sk = {}; (life.tribe || []).forEach(a => (a.sk || []).forEach(s => sk[s] = 1)); this.skills = sk;
    // стоянка племени
    if (life.tribe && life.tribe.length) {
      const z = this.zone('ground', true);
      if (!this.camp || this.camp.bg !== this.bg.id || this.camp.W !== this.W) {
        let x = this.W * 0.36, y = z.y0 + (z.y1 - z.y0) * 0.22;
        for (let i = 0; i < 8 && this.inWater(x, y); i++) { x = this.W * (0.2 + i * 0.09); }
        this.camp = { x, y, bg: this.bg.id, W: this.W };
      }
      const rock = this.props.find(p => p.kind === 'rock'); if (rock) rock.paint = !!sk.paint;
    } else this.camp = null;
    this.nestPos = this.nestPos || {};
    const ids = {}; (life.nest || []).forEach(n => {
      ids[n.id] = 1; if (this.nestPos[n.id]) return;
      const e = this.ent(n.uid), z = this.zone('ground'), R = U().rand;
      let x, y;
      if (e && e.habitat === 'ground') { x = e.x + R(-0.5, 0.5) * bw; y = U().clamp(e.y + R(0.02, 0.1) * bw, z.y0, z.y1); }
      else { const p = this.randomPoint('ground'); x = p.x; y = p.y; }
      this.nestPos[n.id] = { x, y, born: this.t, item: n };
    });
    Object.keys(this.nestPos).forEach(id => { if (!ids[id]) delete this.nestPos[id]; else this.nestPos[id].item = life.nest.find(n => n.id === id); });
  };
  P.makeCritter = function (src, kind) {
    const p = this.randomPoint('ground'), v = this.view();
    const enter = this.t > 2;
    return { id: src.id, kind, src, name: src.name, def: kind === 'mammal' ? L().MAMMALS.find(m => m.kind === src.kind) : null, x: enter ? (Math.random() < 0.5 ? v.x0 - 30 : v.x1 + 30) : p.x, y: p.y, tx: p.x, ty: p.y, vx: 0, vy: 0, phase: Math.random() * 10, facing: 1, wait: Math.random() * 3, task: null, bubble: null, seed: Math.random() * 100 };
  };
  P.critterSize = function (c) {
    const bw = this.baseW(), z = this.zone('ground', true), k = 0.6 + 0.6 * U().clamp((c.y - z.y0) / Math.max(1, z.y1 - z.y0), 0, 1);
    if (c.kind === 'ape') return bw * 0.5 * k;
    const grow = 0.6 + 0.4 * Math.min(1, (c.src.xp || 0) / (2 * 86400));
    return bw * c.def.size * grow * k;
  };
  /** Задание австралопитеку: подойти к динозавру и сделать дело (надеть шапку, покормить, поиграть) */
  P.tribeTask = function (type, uid, data) {
    const apes = (this.critters || []).filter(c => c.kind === 'ape' && !c.task);
    const e = this.ent(uid);
    if (!apes.length || !e) return false;
    const a = apes.sort((p, q) => Math.abs(p.x - e.x) - Math.abs(q.x - e.x))[0];
    if (a.ride) { const r = this.ent(a.ride); if (r) r.rider = null; a.ride = null; }
    a.task = { type, uid, data, t: 0 };
    if (type === 'hat') e.hatHide = true;
    return a;
  };
  P.critterSay = function (c, text) { if (c) c.bubble = { text, t: 0, life: 2.6 }; };
  P.updateExtras = function (dt) {
    const bw = this.baseW(), R = U().rand;
    this.ents.forEach(e => { if (e.d && e.d.legend && e._rect && Math.random() < dt * 3) this.parts.push({ kind: 'spark', c: '#ffe066', x: e.x + R(-0.5, 0.5) * e._rect.w, y: e._rect.y + R(0.1, 0.9) * e._rect.h, vx: 0, vy: -16, t: 0, life: 0.9, s: R(0.5, 1) }); });
    (this.critters || []).forEach(c => {
      const sz = this.critterSize(c), z = this.zone('ground'), sp = (c.kind === 'ape' ? bw * 0.42 : bw * 0.6) * (c.task ? 1.6 : 1);
      if (c.bubble) { c.bubble.t += dt; if (c.bubble.t > (c.bubble.life || 2.2)) c.bubble = null; }
      if (c.ride) { // катается верхом
        const e = this.ent(c.ride);
        c.rideT -= dt;
        if (!e || e.state === 'leave' || e.state === 'sleep' || e.state === 'hidden' || e.state === 'hide' || c.rideT <= 0) { if (e) e.rider = null; c.ride = null; if (e) { c.x = e.x + bw * 0.4; c.y = e.y; } }
        else { c.x = e.x; c.y = e.y + 0.5; c.facing = e.facing; c.phase += dt * 2; return; }
      }
      if (c.task) {
        const T = c.task, e = this.ent(T.uid); T.t += dt;
        if (!e || T.t > 25) { if (e && T.type === 'hat') e.hatHide = false; c.task = null; }
        else {
          const w = e._w || bw; c.tx = e.x - (e.facing || 1) * w * 0.45; c.ty = e.y + 2;
          if (Math.hypot(c.tx - c.x, (c.ty - c.y) * 2) < Math.max(8, w * 0.12)) {
            if (T.type === 'hat') { e.hatHide = false; this.sparkle(e.x, (e._top || e.y) - 6); e.jump = 0.0001; this.critterSay(c, U().pick(['Тебе идёт! 😊', 'Красота! ✨', 'Держи шапку! 🎩'])); e.bubble = { text: 'Спасибо! 💖', t: 0 }; }
            else if (T.type === 'feed') { this.dropFood([{ type: T.data || (e.diet === 'herb' ? 'leaf' : 'meat'), zone: 'ground', near: e.uid, only: e.uid, dx: (e.facing || 1) * 0.5, dy: 0.01 }]); this.critterSay(c, U().pick(['Кушай! 🍖', 'Ням-ням! 🫐', 'Угощайся! 😊'])); }
            else if (T.type === 'play') { e.jump = 0.0001; this.hearts(e.x, e.y - w * 0.5); this.critterSay(c, 'Бум-бум! 🥁'); e.bubble = { text: 'Весело! 😄', t: 0 }; }
            else if (T.type === 'ride') { c.ride = e.uid; c.rideT = R(25, 50); e.rider = c; this.critterSay(c, 'Йо-хо! 🏇'); }
            c.task = null; c.wait = R(1, 3);
          }
        }
      } else {
        c.wait -= dt;
        if (c.wait <= 0) {
          c.wait = R(2, 7);
          if (c.kind === 'ape' && this.camp && this.skills && this.skills.fire && Math.random() < 0.35 && this.camp.x > z.x0 && this.camp.x < z.x1) { c.tx = this.camp.x + R(-1, 1) * bw * 0.5; c.ty = this.camp.y + R(0.05, 0.2) * bw; }
          else if (c.kind === 'ape' && this.skills && this.skills.ride && Math.random() < 0.12 && !this.critters.some(o => o.ride)) {
            const ok = this.ents.filter(e => e.habitat === 'ground' && e.state === 'wander' && !e.rider && e.size >= 1);
            if (ok.length) { c.task = { type: 'ride', uid: U().pick(ok).uid, t: 0 }; }
          } else if (c.kind === 'mammal' && Math.random() < 0.3 && this.ents.length) { const e = U().pick(this.ents); if (e.habitat === 'ground') { c.tx = e.x + R(-1, 1) * bw * 0.6; c.ty = e.y + R(0, 0.1) * bw; } }
          else { const p = this.randomPoint('ground'); c.tx = p.x; c.ty = p.y; }
          if (c.kind === 'ape' && !c.bubble && Math.random() < 0.15) this.critterSay(c, U().pick(['Уга! 🙂', 'Ук-ук! 🐒', this.skills && this.skills.fire ? 'Огонь — тепло! 🔥' : 'Ягодки! 🫐', 'Хорошо тут! 🌿']));
        }
        // держимся рядом с экраном
        if (c.tx < z.x0 || c.tx > z.x1) c.tx = U().clamp(c.tx, z.x0 + bw * 0.3, z.x1 - bw * 0.3);
      }
      const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
      if (d > 2) { const v = Math.min(sp, d * 3); c.vx = dx / d * v; c.vy = dy / d * v * 0.6; } else { c.vx *= 0.8; c.vy *= 0.8; }
      c.x += c.vx * dt; c.y += c.vy * dt;
      const zf = this.zone('ground', true); c.y = U().clamp(c.y, zf.y0, zf.y1);
      if (c.vx > 4) c.facing = 1; else if (c.vx < -4) c.facing = -1;
      c.moving = Math.min(1, Math.hypot(c.vx, c.vy) / Math.max(1, sp * 0.5));
      c.phase += dt * (2 + 9 * c.moving);
      void sz;
    });
  };
  // ——— рисование ———
  P.extraDrawables = function (v) {
    const out = [], m = this.baseW() * 2, inV = (x) => x > v.x0 - m && x < v.x1 + m;
    this.props.forEach(p => { if (inV(p.x)) out.push({ y: p.y, draw: (ctx) => this.drawPropItem(ctx, p) }); });
    if (this.camp && inV(this.camp.x)) out.push({ y: this.camp.y, draw: (ctx) => this.drawCamp(ctx) });
    Object.keys(this.nestPos || {}).forEach(id => { const n = this.nestPos[id]; if (n.item && inV(n.x)) out.push({ y: n.y, draw: (ctx) => this.drawNestItem(ctx, n) }); });
    (this.critters || []).forEach(c => { if (!inV(c.x)) return; if (c.ride) { const e = this.ent(c.ride); out.push({ y: (e ? e.y : c.y) + 0.6, draw: (ctx) => this.drawCritter(ctx, c) }); } else out.push({ y: c.y, draw: (ctx) => this.drawCritter(ctx, c) }); });
    return out;
  };
  P.drawNestItem = function (ctx, n) {
    const it = n.item, bw = this.baseW(), t = this.t, age = t - n.born, pop = Math.min(1, age * 2.5);
    const s = Math.max(9, bw * 0.13) * pop;
    ctx.save(); ctx.translate(n.x, n.y);
    ctx.fillStyle = 'rgba(20,30,10,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.9, s * 0.25, 0, 0, TAU); ctx.fill();
    if (it.k === 'egg') {
      const R = L().R[it.r] || L().R.common, wob = Math.sin(t * 3 + n.x) * 0.08 + (Math.sin(t * 0.7 + n.x) > 0.93 ? Math.sin(t * 30) * 0.12 : 0);
      if (it.r !== 'common') { const g = ctx.createRadialGradient(0, -s * 0.7, 0, 0, -s * 0.7, s * 2.2); g.addColorStop(0, R.color + 'aa'); g.addColorStop(1, R.color + '00'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -s * 0.7, s * 2.2, 0, TAU); ctx.fill(); }
      ctx.rotate(wob);
      ctx.fillStyle = R.color; ctx.strokeStyle = 'rgba(60,40,20,.55)'; ctx.lineWidth = Math.max(1, s * 0.08);
      ctx.beginPath(); ctx.moveTo(0, -s * 1.5); ctx.bezierCurveTo(s * 0.85, -s * 1.45, s * 0.85, 0, 0, 0); ctx.bezierCurveTo(-s * 0.85, 0, -s * 0.85, -s * 1.45, 0, -s * 1.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = R.spot; [[-0.25, -0.9, 0.13], [0.22, -0.55, 0.1], [0.05, -1.15, 0.08], [-0.2, -0.35, 0.07]].forEach(([a, b, c]) => { ctx.beginPath(); ctx.arc(s * a, s * b, s * c, 0, TAU); ctx.fill(); });
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(-s * 0.28, -s * 1.05, s * 0.12, s * 0.25, -0.4, 0, TAU); ctx.fill();
      if (it.r !== 'common' && Math.random() < 0.06) this.parts.push({ kind: 'spark', c: R.color, x: n.x + U().rand(-s, s), y: n.y - U().rand(0, s * 1.8), vx: 0, vy: -14, t: 0, life: 0.8, s: U().rand(0.5, 1) });
    } else { // подарок
      const b = Math.abs(Math.sin(t * 3)) * s * 0.25; ctx.translate(0, -b);
      ctx.fillStyle = '#ff6b6b'; ctx.strokeStyle = '#a61e4d'; ctx.lineWidth = Math.max(1, s * 0.07);
      ctx.fillRect(-s * 0.8, -s * 1.3, s * 1.6, s * 1.3); ctx.strokeRect(-s * 0.8, -s * 1.3, s * 1.6, s * 1.3);
      ctx.fillStyle = '#ffd43b'; ctx.fillRect(-s * 0.15, -s * 1.3, s * 0.3, s * 1.3); ctx.fillRect(-s * 0.9, -s * 1.5, s * 1.8, s * 0.3);
      ctx.beginPath(); ctx.ellipse(-s * 0.3, -s * 1.65, s * 0.3, s * 0.18, -0.5, 0, TAU); ctx.ellipse(s * 0.3, -s * 1.65, s * 0.3, s * 0.18, 0.5, 0, TAU); ctx.fill();
      if (Math.random() < 0.05) this.sparkle(n.x, n.y - s * 1.5);
    }
    ctx.restore();
    n.r = s * 1.6;
  };
  /** Касание яйца/подарка на земле или зверька */
  P.hitExtra = function (x, y) {
    for (const id of Object.keys(this.nestPos || {})) { const n = this.nestPos[id], r = Math.max(22, (n.r || 16) * 1.3); if (n.item && Math.abs(x - n.x) < r && y < n.y + r * 0.4 && y > n.y - r * 1.6) return { kind: 'nest', item: n.item, pos: n }; }
    for (const c of this.critters || []) { const s = this.critterSize(c) * (c.kind === 'ape' ? 1 : 1.3); if (Math.abs(x - c.x) < s * 0.7 && y < c.y + 6 && y > c.y - s * (c.kind === 'ape' ? 1.6 : 1.1) - (c.ride ? s * 1.4 : 0)) return { kind: 'critter', c }; }
    return null;
  };
  P.drawCritter = function (ctx, c) {
    const s = this.critterSize(c), t = this.t, mv = c.moving || 0;
    let bx = c.x, by = c.y;
    if (c.ride) { const e = this.ent(c.ride); if (e && e._rect) { by = e._rect.y + e._rect.h * 0.32 + s * 0.85; bx = e.x - (e.facing || 1) * e._rect.w * 0.06; } }
    ctx.save(); ctx.translate(bx, by); ctx.scale(c.facing || 1, 1);
    if (!c.ride) { ctx.fillStyle = 'rgba(20,30,10,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.42, s * 0.1, 0, 0, TAU); ctx.fill(); }
    if (c.kind === 'ape') this.drawApe(ctx, c, s, t, mv);
    else this.drawMammal(ctx, c, s, t, mv);
    ctx.restore();
    c._bx = bx; c._by = by; c._s = s;
  };
  P.drawApe = function (ctx, c, s, t, mv) {
    const fur = '#6b4a2f', furD = '#4e3420', skin = '#d2a07a', st = Math.sin(c.phase) * mv, sk = (c.src && c.src.sk) || [];
    const bob = c.ride ? 0 : -Math.abs(Math.sin(c.phase)) * s * 0.04 * mv;
    ctx.translate(0, bob);
    ctx.lineCap = 'round'; ctx.strokeStyle = furD; ctx.lineWidth = s * 0.13;
    if (c.ride) { ctx.beginPath(); ctx.moveTo(-s * 0.05, -s * 0.55); ctx.lineTo(s * 0.12, -s * 0.2); ctx.moveTo(s * 0.05, -s * 0.55); ctx.lineTo(-s * 0.2, -s * 0.22); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(-s * 0.08, -s * 0.55); ctx.lineTo(-s * 0.1 - st * s * 0.18, 0); ctx.moveTo(s * 0.08, -s * 0.55); ctx.lineTo(s * 0.1 + st * s * 0.18, 0); ctx.stroke(); }
    ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(0, -s * 0.78, s * 0.24, s * 0.32, 0.08, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a6a4a'; ctx.beginPath(); ctx.ellipse(s * 0.05, -s * 0.74, s * 0.13, s * 0.2, 0.1, 0, TAU); ctx.fill();
    // руки; в передней — орудие
    const arm = Math.sin(c.phase + 1.5) * 0.4 * mv + (c.task ? -0.6 : 0);
    ctx.strokeStyle = fur; ctx.lineWidth = s * 0.1;
    ctx.beginPath(); ctx.moveTo(-s * 0.12, -s * 0.95); ctx.lineTo(-s * 0.22 - Math.sin(arm) * s * 0.2, -s * 0.5); ctx.stroke();
    const hx = s * 0.22 + Math.sin(arm) * s * 0.22, hy = -s * 0.52 - (c.task ? s * 0.18 : 0);
    ctx.beginPath(); ctx.moveTo(s * 0.12, -s * 0.95); ctx.lineTo(hx, hy); ctx.stroke();
    if (sk.includes('fire') && (this.tint && this.tint() && this.tint().night)) { ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = s * 0.05; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + s * 0.1, hy - s * 0.35); ctx.stroke(); ctx.fillStyle = `rgba(255,${150 + Math.sin(t * 20) * 40},40,.95)`; ctx.beginPath(); ctx.ellipse(hx + s * 0.11, hy - s * 0.42, s * 0.06, s * 0.11, 0, 0, TAU); ctx.fill(); }
    else if (sk.includes('stone')) { ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = s * 0.045; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + s * 0.05, hy - s * 0.3); ctx.stroke(); ctx.fillStyle = '#8d8a80'; ctx.beginPath(); ctx.moveTo(hx + s * 0.02, hy - s * 0.38); ctx.lineTo(hx + s * 0.16, hy - s * 0.3); ctx.lineTo(hx + s * 0.06, hy - s * 0.22); ctx.closePath(); ctx.fill(); }
    else if (sk.includes('stick')) { ctx.strokeStyle = '#7a5230'; ctx.lineWidth = s * 0.045; ctx.beginPath(); ctx.moveTo(hx - s * 0.05, hy + s * 0.25); ctx.lineTo(hx + s * 0.06, hy - s * 0.35); ctx.stroke(); }
    // голова
    ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(s * 0.04, -s * 1.2, s * 0.19, 0, TAU); ctx.fill();
    ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(s * 0.1, -s * 1.16, s * 0.12, s * 0.13, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = furD; ctx.fillRect(s * 0.0, -s * 1.27, s * 0.22, s * 0.035);
    ctx.fillStyle = '#1d140c'; ctx.beginPath(); ctx.arc(s * 0.08, -s * 1.21, s * 0.022, 0, TAU); ctx.arc(s * 0.16, -s * 1.21, s * 0.022, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#6a3a24'; ctx.lineWidth = Math.max(1, s * 0.02); ctx.beginPath(); ctx.arc(s * 0.13, -s * 1.12, s * 0.04, 0.2, Math.PI - 0.2); ctx.stroke();
    if (sk.includes('chief')) { ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.moveTo(-s * 0.1, -s * 1.36); ctx.lineTo(-s * 0.02, -s * 1.62); ctx.lineTo(s * 0.04, -s * 1.36); ctx.fill(); ctx.fillStyle = '#ffd43b'; ctx.beginPath(); ctx.moveTo(s * 0.0, -s * 1.37); ctx.lineTo(s * 0.1, -s * 1.6); ctx.lineTo(s * 0.14, -s * 1.36); ctx.fill(); }
    if (c.task && c.task.type === 'hat' && Scene().HATS[c.task.data]) { ctx.font = `${Math.round(s * 0.32)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.fillText(Scene().HATS[c.task.data], hx, hy - s * 0.05); }
  };
  const Scene = () => DP.Scene;
  P.drawMammal = function (ctx, c, s, t, mv) {
    const d = c.def, hop = -Math.abs(Math.sin(c.phase)) * s * 0.18 * mv;
    ctx.translate(0, hop);
    const k = d.kind;
    // хвост
    ctx.fillStyle = d.col; ctx.strokeStyle = d.col; ctx.lineCap = 'round';
    if (k === 'squirrel') { ctx.beginPath(); ctx.ellipse(-s * 0.5, -s * 0.55, s * 0.2, s * 0.38, -0.5 + Math.sin(t * 3 + c.seed) * 0.1, 0, TAU); ctx.fill(); }
    else if (k === 'beaver') { ctx.fillStyle = '#4a3424'; ctx.beginPath(); ctx.ellipse(-s * 0.55, -s * 0.12, s * 0.22, s * 0.08, 0.2, 0, TAU); ctx.fill(); }
    else if (k !== 'hedgehog') { ctx.lineWidth = s * 0.06; ctx.beginPath(); ctx.moveTo(-s * 0.35, -s * 0.25); ctx.quadraticCurveTo(-s * 0.6, -s * 0.2 + Math.sin(t * 4 + c.seed) * s * 0.06, -s * 0.7, -s * 0.38); ctx.stroke(); }
    // лапки
    const st = Math.sin(c.phase) * mv; ctx.strokeStyle = '#3a2a1e'; ctx.lineWidth = s * 0.07;
    ctx.beginPath(); ctx.moveTo(-s * 0.18, -s * 0.12); ctx.lineTo(-s * 0.2 - st * s * 0.1, 0); ctx.moveTo(s * 0.18, -s * 0.12); ctx.lineTo(s * 0.2 + st * s * 0.1, 0); ctx.stroke();
    // тело
    if (k === 'hedgehog') { ctx.fillStyle = '#4a3a2e'; ctx.beginPath(); for (let i = 0; i <= 10; i++) { const a = Math.PI + (i / 10) * Math.PI, r = i % 2 ? s * 0.42 : s * 0.52; ctx.lineTo(Math.cos(a) * r, -s * 0.18 + Math.sin(a) * r * 0.75); } ctx.fill(); }
    ctx.fillStyle = d.col; ctx.beginPath(); ctx.ellipse(0, -s * 0.26, s * 0.38, s * 0.22, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = d.belly; ctx.beginPath(); ctx.ellipse(s * 0.05, -s * 0.18, s * 0.25, s * 0.12, 0, 0, TAU); ctx.fill();
    if (k === 'badger') { ctx.fillStyle = '#f1f1f1'; ctx.fillRect(-s * 0.3, -s * 0.47, s * 0.6, s * 0.06); }
    // голова
    ctx.fillStyle = d.col; ctx.beginPath(); ctx.ellipse(s * 0.36, -s * 0.36, s * 0.18, s * 0.15, 0.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(s * 0.46, -s * 0.38); ctx.lineTo(s * 0.62, -s * 0.31); ctx.lineTo(s * 0.46, -s * 0.27); ctx.fill();
    ctx.fillStyle = '#2a1a14'; ctx.beginPath(); ctx.arc(s * 0.62, -s * 0.31, s * 0.035, 0, TAU); ctx.fill();
    ctx.fillStyle = d.col; ctx.beginPath(); ctx.arc(s * 0.3, -s * 0.5, s * 0.07, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffb3c1'; ctx.beginPath(); ctx.arc(s * 0.3, -s * 0.5, s * 0.035, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(s * 0.42, -s * 0.4, s * 0.03, 0, TAU); ctx.fill();
    if (k === 'badger') { ctx.fillStyle = '#f1f1f1'; ctx.beginPath(); ctx.ellipse(s * 0.4, -s * 0.44, s * 0.1, s * 0.03, 0.2, 0, TAU); ctx.fill(); }
  };
  P.drawCamp = function (ctx) {
    const c = this.camp, bw = this.baseW(), t = this.t, s = bw * 0.5, sk = this.skills || {};
    ctx.save(); ctx.translate(c.x, c.y);
    if (sk.hut) { // шалаш из веток и листьев
      ctx.save(); ctx.translate(-s * 1.6, -s * 0.05);
      ctx.fillStyle = '#7a5a32'; ctx.beginPath(); ctx.moveTo(-s * 0.9, 0); ctx.lineTo(0, -s * 1.5); ctx.lineTo(s * 0.9, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#5a3e20'; ctx.lineWidth = Math.max(1.5, s * 0.06); for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * s * 0.25, 0); ctx.lineTo(i * s * 0.05, -s * 1.6); ctx.stroke(); }
      ctx.fillStyle = '#4a7a3a'; ctx.beginPath(); ctx.ellipse(0, -s * 1.35, s * 0.45, s * 0.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2a1e12'; ctx.beginPath(); ctx.moveTo(-s * 0.25, 0); ctx.lineTo(0, -s * 0.6); ctx.lineTo(s * 0.25, 0); ctx.fill();
      ctx.restore();
    }
    if (sk.fire) { // костёр: камни, поленья, живое пламя
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.6, s * 0.15, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#5a3a1e'; ctx.lineWidth = s * 0.12; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-s * 0.4, -s * 0.02); ctx.lineTo(s * 0.35, -s * 0.15); ctx.moveTo(-s * 0.35, -s * 0.15); ctx.lineTo(s * 0.4, -s * 0.02); ctx.stroke();
      ctx.fillStyle = '#8d8a80'; for (let i = 0; i < 7; i++) { const a = Math.PI + (i / 6) * Math.PI; ctx.beginPath(); ctx.ellipse(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.12 * -1 + s * 0.02, s * 0.1, s * 0.06, 0, 0, TAU); ctx.fill(); }
      for (let i = 0; i < 3; i++) { const f = 1 - i * 0.28, fl = Math.sin(t * (9 + i * 3) + i) * 0.12; ctx.fillStyle = ['#ff6b1a', '#ffa94d', '#ffe066'][i]; ctx.beginPath(); ctx.moveTo(-s * 0.3 * f, -s * 0.08); ctx.quadraticCurveTo(-s * 0.25 * f, -s * 0.6 * f, s * fl, -s * (0.85 + fl) * f); ctx.quadraticCurveTo(s * 0.25 * f, -s * 0.6 * f, s * 0.3 * f, -s * 0.08); ctx.closePath(); ctx.fill(); }
      if (Math.random() < 0.15) this.parts.push({ kind: 'spark', c: '#ffb347', x: c.x + U().rand(-s * 0.2, s * 0.2), y: c.y - s * 0.6, vx: U().rand(-10, 10), vy: -40, t: 0, life: 0.9, s: 0.4 });
    } else if ((this.life && this.life.tribe && this.life.tribe.length)) { // пока только кострище
      ctx.fillStyle = '#8d8a80'; for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; ctx.beginPath(); ctx.ellipse(Math.cos(a) * s * 0.4, Math.sin(a) * s * 0.1, s * 0.08, s * 0.05, 0, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  };
  /** Тёплое свечение костра (поверх ночного затемнения) */
  P.drawGlows = function (ctx, v, tn) {
    if (!this.camp || !this.skills || !this.skills.fire) return;
    const c = this.camp, r = this.baseW() * (tn && tn.night ? 2.4 : 1.2), a = (tn && tn.night ? 0.32 : 0.14) + Math.sin(this.t * 7) * 0.03;
    const g = ctx.createRadialGradient(c.x, c.y - r * 0.15, 0, c.x, c.y - r * 0.15, r); g.addColorStop(0, `rgba(255,170,70,${a})`); g.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = g; ctx.fillRect(c.x - r, c.y - r * 1.15, r * 2, r * 2);
  };
  P.drawOverlayExtras = function (ctx) {
    (this.critters || []).forEach(c => {
      if (c._s == null) return;
      const s = c._s, top = c._by - s * (c.kind === 'ape' ? 1.5 : 0.7);
      if (c.kind === 'ape' && this.showLabels && this.cam.z > 1.4) { const fs = 11; ctx.font = `800 ${fs}px Nunito, sans-serif`; ctx.fillStyle = 'rgba(6,30,36,.55)'; const tw = ctx.measureText(c.name).width; ctx.fillRect(c._bx - tw / 2 - 5, c._by + 3, tw + 10, fs + 4); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(c.name, c._bx, c._by + 5); }
      if (c.bubble) this.drawBubble(ctx, c._bx, top, c.bubble);
    });
  };
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
})();
