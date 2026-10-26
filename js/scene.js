/* Динопарк — движок сцены: фон, динозавры, корм, сердечки, пузыри с эмодзи.
 * v2: потребности (голод/игра/сон) с индикаторами, сон в гнезде, игра с мячом и догонялки,
 * тайный корм только для своих, уход динозавров в другую локацию. */
window.DP = window.DP || {};
(function () {
  const TAU = Math.PI * 2, U = () => DP.util;
  const ROARS = ['РРРР! 🦖', '😄', '💚', 'Привет! 👋', '🎵', '😝', 'Ррр! 🔥', '⭐', '🤗', 'Ура! 🎉'];
  const FOOD_FOR = { herb: ['leaf'], carn: ['meat', 'fish'], omni: ['leaf', 'meat', 'fish'] };
  const NEEDS = () => DP.Needs;
  const voice = (e, kind) => { if (DP.Voices && e) DP.Voices.play(e.species || e.base || DP.Voices.speciesOf(null, e.habitat), kind, e.uid); };

  class Scene {
    constructor(canvas, opts) {
      this.c = canvas; this.ctx = this.makeCtx(canvas);
      this.opts = opts || {};
      this.ents = []; this.food = []; this.parts = []; this.balls = []; this.showNeeds = this.opts.showNeeds !== false; this.needT = 0;
      // камера: мир может быть больше экрана (opts.world) — тогда парк листается пальцем и приближается щипком
      this.cam = { x: 0, y: 0, z: 1 }; this.camT = null; this.follow = null; this.props = []; this.extras = [];
      this.bg = DP.BG.get('jungle'); this.customImg = null; this.staticCanvas = document.createElement('canvas');
      this.t = 0; this.last = performance.now(); this.showLabels = true; this.camX = 0; this.pointerX = 0; this.tod = this.opts.tod || 'auto';
      canvas.addEventListener('pointermove', (ev) => { const r = canvas.getBoundingClientRect(); this.pointerX = ((ev.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2; });
      if (this.opts.bg) this.bg = DP.BG.get(this.opts.bg);
      this._layerPool = []; this._reflPool = []; this._lastFrame = 0;
      // iOS Safari шлёт resize при каждом скрытии/показе адресной строки — собираем их в один пересчёт
      this.resize = this.resize.bind(this);
      this._onResize = () => { clearTimeout(this._rzT); this._rzT = setTimeout(() => this.resize(), 150); };
      window.addEventListener('resize', this._onResize);
      window.addEventListener('orientationchange', this._onResize);
      // невидимую сцену не рисуем (экономим батарею и процессор телефона)
      this._offscreen = false;
      if (window.IntersectionObserver) { try { this._io = new IntersectionObserver((en) => { this._offscreen = !en[en.length - 1].isIntersecting; }); this._io.observe(canvas); } catch (e) { this._io = null; } }
      this.resize(true); Scene.all.push(this);
      if (this.opts.world) this.attachGestures();
      this.loop = this.loop.bind(this); requestAnimationFrame(this.loop);
    }
    /** Контекст рисования (3D-сцена подменяет его маленьким вспомогательным холстом) */
    makeCtx(canvas) { return canvas.getContext('2d'); }
    /** Остановить сцену насовсем: снять обработчики и убрать из списка */
    destroy() {
      this._dead = true; window.removeEventListener('resize', this._onResize); window.removeEventListener('orientationchange', this._onResize);
      if (this._io) { try { this._io.disconnect(); } catch (e) { /* ignore */ } }
      const i = Scene.all.indexOf(this); if (i >= 0) Scene.all.splice(i, 1);
      this.release();
    }
    /** Плотность пикселей: не больше 2 и не больше бюджета пикселей (на телефонах — меньше, чтобы не упереться в лимит памяти Safari) */
    pickDpr(w, h) {
      const P = Scene.PERF, cap = Math.min(window.devicePixelRatio || 1, this.opts.maxDpr || P.maxDpr);
      const budget = this.opts.maxPixels || P.maxPixels;
      return Math.max(0.75, Math.min(cap, Math.sqrt(budget / Math.max(1, w * h))));
    }
    resize(force) {
      const r = this.c.getBoundingClientRect();
      const vw = Math.max(1, r.width || window.innerWidth), vh = Math.max(1, r.height || window.innerHeight);
      const dpr = this.pickDpr(vw, vh);
      // мир: на узком экране (телефон) — шире экрана; холсты слоёв мира укладываются в тот же бюджет пикселей
      const WO = this.opts.world, w = WO ? Math.max(vw, Math.round(vh * (WO.aspect || 1.75))) : vw, h = vh;
      const wd = WO ? Math.max(0.75, Math.min(dpr, Math.sqrt((WO.maxPixels || (Scene.PERF.mobile ? 1.2e6 : 4.5e6)) / Math.max(1, w * h)))) : dpr;
      if (force !== true && this.W === w && this.H === h && this.VW === vw && this.dpr === dpr && this.c.width > 0) return; // размер не изменился — ничего не пересоздаём
      const ow = this.W || w, oh = this.H || h, first = !this.W;
      this.W = w; this.H = h; this.dpr = dpr; this.wd = wd; this.VW = vw; this.VH = vh;
      this.c.width = Math.round(vw * dpr); this.c.height = Math.round(vh * dpr);
      if (WO) { if (first) this.cam.x = (w - vw) / 2; else this.cam.x *= w / ow; this.clampCam(); }
      this.ents.forEach(e => { e.x *= w / ow; e.y *= h / oh; e.tx *= w / ow; e.ty *= h / oh; });
      this.food.forEach(f => { f.x *= w / ow; f.y *= h / oh; f.fy *= h / oh; });
      this.renderStatic();
    }
    // ——— камера ———
    /** Видимая часть мира (в координатах мира) */
    view() { const z = this.cam.z; return { x0: this.cam.x, y0: this.cam.y, x1: this.cam.x + this.VW / z, y1: this.cam.y + this.VH / z }; }
    /** Полоса мира вокруг экрана, где обычно гуляют динозавры (чтобы не разбредались по всему миру) */
    band() {
      if (!this.opts.world) return { x0: 0, x1: this.W };
      const v = this.view(), cx = (v.x0 + v.x1) / 2, half = Math.min(this.W / 2, this.VW * 0.78);
      let x0 = cx - half, x1 = cx + half;
      if (x0 < 0) { x1 -= x0; x0 = 0; } if (x1 > this.W) { x0 -= x1 - this.W; x1 = this.W; }
      return { x0: Math.max(0, x0), x1 };
    }
    toWorld(sx, sy) { return { x: this.cam.x + sx / this.cam.z, y: this.cam.y + sy / this.cam.z }; }
    toScreen(x, y) { return { x: (x - this.cam.x) * this.cam.z, y: (y - this.cam.y) * this.cam.z }; }
    zMax() { return this.opts.world ? (this.opts.world.zMax || 2.6) : 2.6; }
    clampCam(c) {
      c = c || this.cam;
      c.z = U().clamp(c.z, 1, this.zMax());
      c.x = U().clamp(c.x, 0, Math.max(0, this.W - this.VW / c.z)); c.y = U().clamp(c.y, 0, Math.max(0, this.H - this.VH / c.z));
      return c;
    }
    /** Плавно переместить камеру: центр (cx, cy) в мире и зум z */
    lookAt(cx, cy, z, instant) {
      z = U().clamp(z || this.cam.z, 1, this.zMax());
      const t = this.clampCam({ x: cx - this.VW / z / 2, y: cy - this.VH / z / 2, z });
      if (instant) { this.cam = t; this.camT = null; } else this.camT = t;
    }
    /** Крупный план: камера следует за динозавром */
    closeUp(uid, z) { const e = this.ent(uid); if (!e) return false; this.follow = { uid, z: z || 2.4 }; return true; }
    resetZoom() { this.follow = null; const v = this.view(); this.lookAt((v.x0 + v.x1) / 2, this.H / 2, 1); }
    zoomBy(f, sx, sy) {
      if (sx == null) { sx = this.VW / 2; sy = this.VH / 2; }
      const p = this.toWorld(sx, sy), z = U().clamp(this.cam.z * f, 1, this.zMax());
      this.cam = this.clampCam({ x: p.x - sx / z, y: p.y - sy / z, z }); this.camT = null;
    }
    /** Только что был жест (листание/щипок) — нажатие не считаем касанием */
    wasDrag() { return performance.now() - (this._dragEnd || 0) < 280 || (this._moved || 0) > 9; }
    attachGestures() {
      const c = this.c, pts = new Map();
      c.style.touchAction = 'none';
      let pinch = null, vel = { x: 0, y: 0 }, lastT = 0;
      const rect = () => c.getBoundingClientRect();
      const local = (ev) => { const r = rect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
      const startPinch = () => {
        const [a, b] = [...pts.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        pinch = { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z: this.cam.z, w: this.toWorld(mid.x, mid.y) };
      };
      c.addEventListener('pointerdown', (ev) => {
        try { c.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        pts.set(ev.pointerId, local(ev)); if (pts.size === 1) { this._moved = 0; vel = { x: 0, y: 0 }; this._inertia = null; }
        if (pts.size === 2) { startPinch(); this._moved = 99; }
      });
      c.addEventListener('pointermove', (ev) => {
        if (!pts.has(ev.pointerId)) return;
        const prev = pts.get(ev.pointerId), cur = local(ev); pts.set(ev.pointerId, cur);
        if (pts.size >= 2 && pinch) {
          const [a, b] = [...pts.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const z = U().clamp(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, 1, this.zMax());
          this.cam = this.clampCam({ x: pinch.w.x - mid.x / z, y: pinch.w.y - mid.y / z, z }); this.camT = null; this.follow = null; return;
        }
        const dx = cur.x - prev.x, dy = cur.y - prev.y; this._moved = (this._moved || 0) + Math.abs(dx) + Math.abs(dy);
        if (this._moved > 9) {
          this.cam.x -= dx / this.cam.z; this.cam.y -= dy / this.cam.z; this.clampCam(); this.camT = null; this.follow = null;
          const now = performance.now(), k = Math.min(1, (now - lastT) / 60); lastT = now;
          vel.x = vel.x * (1 - k) + (-dx / this.cam.z) * k * 60; vel.y = vel.y * (1 - k) + (-dy / this.cam.z) * k * 60;
        }
      });
      const up = (ev) => {
        if (!pts.has(ev.pointerId)) return;
        pts.delete(ev.pointerId);
        if (pts.size === 1) { pinch = null; }
        if (pts.size === 0) {
          if ((this._moved || 0) > 9) { this._dragEnd = performance.now(); if (Math.hypot(vel.x, vel.y) > 30) this._inertia = { x: vel.x, y: vel.y }; if (this.opts.onPan) this.opts.onPan(); }
          setTimeout(() => { if (!pts.size) this._moved = 0; }, 0);
        }
      };
      c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
      c.addEventListener('wheel', (ev) => { ev.preventDefault(); const p = local(ev); if (ev.ctrlKey || Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) this.zoomBy(Math.exp(-ev.deltaY * 0.0018), p.x, p.y); else { this.cam.x += ev.deltaX / this.cam.z; this.clampCam(); } this.follow = null; }, { passive: false });
      ['gesturestart', 'gesturechange'].forEach(n => c.addEventListener(n, (ev) => ev.preventDefault()));
    }
    updateCam(dt) {
      if (this._inertia) { const I = this._inertia; this.cam.x += I.x * dt; this.cam.y += I.y * dt; const f = Math.pow(0.04, dt); I.x *= f; I.y *= f; this.clampCam(); if (Math.hypot(I.x, I.y) < 8) this._inertia = null; }
      if (this.follow) {
        const e = this.ent(this.follow.uid);
        if (!e || e.state === 'gone') this.follow = null;
        else { const h = (e._rect ? e._rect.h : this.baseW() * 0.6); this.lookAt(e.x, (e.habitat === 'ground' ? e.y - h * 0.45 : e.y), this.follow.z); }
      }
      if (this.camT) {
        const a = Math.min(1, dt * 4), c = this.cam, t = this.camT;
        c.z += (t.z - c.z) * a; c.x += (t.x - c.x) * a; c.y += (t.y - c.y) * a; this.clampCam();
        if (!this.follow && Math.abs(t.x - c.x) < 0.5 && Math.abs(t.z - c.z) < 0.003) { this.cam = this.clampCam({ x: t.x, y: t.y, z: t.z }); this.camT = null; }
      }
    }
    renderStatic() { this._renderStatic(); if (this.buildProps) this.buildProps(); }
    _renderStatic() {
      this._rendered = this.bg.id + (this._customUrl || '');
      this.layerCanvases = null; this.reflections = null;
      const s = this.staticCanvas;
      if (this.bg.layers && this.bg.id !== 'custom') { s.width = s.height = 0; return this.renderLayers(); } // статичный холст не нужен — не держим память
      s.width = Math.round(this.W * this.wd); s.height = Math.round(this.H * this.wd); this.freePool(this._layerPool, 0); this.freePool(this._reflPool, 0);
      const x = s.getContext('2d'); x.setTransform(this.wd, 0, 0, this.wd, 0, 0);
      if (this.bg.id === 'custom') {
        x.fillStyle = '#123'; x.fillRect(0, 0, this.W, this.H);
        if (this.customImg) {
          const iw = this.customImg.naturalWidth, ih = this.customImg.naturalHeight, k = Math.max(this.W / iw, this.H / ih);
          x.drawImage(this.customImg, (this.W - iw * k) / 2, (this.H - ih * k) / 2, iw * k, ih * k);
        }
        return;
      }
      this.bg.drawStatic(x, this.W, this.H);
    }
    /** Холст из пула: переиспользуем вместо создания нового (Safari на iPhone освобождает память холстов очень неохотно) */
    poolCanvas(pool, i, w, h) {
      const c = pool[i] || (pool[i] = document.createElement('canvas'));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else c.getContext('2d').clearRect(0, 0, w, h);
      const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      return c;
    }
    freePool(pool, from) { for (let i = from; i < pool.length; i++) { pool[i].width = pool[i].height = 0; } pool.length = Math.min(pool.length, from); }
    /** Освободить всю память холстов (уход со страницы); вернуть — resize(true) */
    release() {
      this.freePool(this._layerPool, 0); this.freePool(this._reflPool, 0);
      this.staticCanvas.width = this.staticCanvas.height = 0; this.c.width = this.c.height = 0;
      this.layerCanvases = null; this.reflections = null; this._rendered = null;
    }
    renderLayers() {
      // слои локации: каждый в свой холст с запасом по краям для параллакса
      const PADX = this.opts.world ? 0.03 : 0.05, d = this.wd, W = this.W, H = this.H; this.PADX = PADX;
      this.layerCanvases = this.bg.layers.map((L, li) => {
        const c = this.poolCanvas(this._layerPool, li, Math.ceil(W * (1 + 2 * PADX) * d), Math.ceil(H * d));
        const cx = c.getContext('2d'); cx.setTransform(d, 0, 0, d, W * PADX * d, 0); L.draw.call(L, cx, W, H);
        return { L, c };
      });
      // отражения: всё, что позади водоёма, переворачиваем относительно линии воды
      this.freePool(this._layerPool, this.layerCanvases.length);
      this.reflections = []; let ri = 0;
      this.layerCanvases.forEach((lc, i) => {
        (lc.L.pools || []).forEach(p => {
          const top = H * p.top, bot = H * p.bottom, hh = Math.max(1, bot - top);
          const rc = this.poolCanvas(this._reflPool, ri++, Math.ceil(W * d), Math.ceil(hh * d));
          const r = rc.getContext('2d');
          r.save(); r.setTransform(1, 0, 0, -1, 0, top * d); // строка источника y → строка top - y (зеркало у линии воды)
          for (let k = 0; k < i; k++) r.drawImage(this.layerCanvases[k].c, -W * PADX * d, 0);
          r.restore(); r.setTransform(1, 0, 0, 1, 0, 0);
          r.globalCompositeOperation = 'source-atop'; r.fillStyle = p.tint || '#2a6080'; r.globalAlpha = 0.35; r.fillRect(0, 0, rc.width, rc.height);
          r.globalAlpha = 1; r.globalCompositeOperation = 'destination-in';
          const g = r.createLinearGradient(0, 0, 0, rc.height); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0.25)'); r.fillStyle = g; r.fillRect(0, 0, rc.width, rc.height);
          this.reflections.push({ layer: i, p, c: rc, top, path: DP.BG.poolPath(p, W, H) });
        });
      });
      this.freePool(this._reflPool, ri);
    }
    /** Время суток: 'auto' (по часам), 'day', 'evening', 'night' */
    setTimeOfDay(mode) { this.tod = mode || 'auto'; }
    tint() {
      if (this.bg.night) return { c: '#9aa6e0', a: 1, night: true };
      let m = this.tod || 'auto';
      if (m === 'auto') { const hr = new Date().getHours(); m = hr >= 21 || hr < 6 ? 'night' : hr >= 18 ? 'evening' : hr < 8 ? 'dawn' : 'day'; }
      if (m === 'night') return { c: '#8794d0', a: 1, night: true };
      if (m === 'evening') return { c: '#ffc79a', a: 1 };
      if (m === 'dawn') return { c: '#ffe2cc', a: 1 };
      return null;
    }
    setBackground(id, customUrl) {
      if (id === 'custom' && customUrl) {
        if (this._customUrl === customUrl && this.bg.id === 'custom') return;
        this._customUrl = customUrl; this.bg = DP.BG.CUSTOM;
        U().loadImage(customUrl).then(img => { this.customImg = img; this.renderStatic(); }).catch(() => {});
      } else { this.bg = DP.BG.get(id === 'custom' ? 'jungle' : id); this._customUrl = null; }
      if (this._rendered !== this.bg.id + (this._customUrl || '')) this.renderStatic(); // тот же фон — не перерисовываем
      this.ents.forEach(e => { const p = this.randomPoint(e.habitat); if (!this.inZone(e)) { e.x = p.x; e.y = p.y; } e.tx = e.x; e.ty = e.y; });
    }
    /** Зона обитания. full = весь мир; иначе (большой мир) — полоса вокруг экрана */
    zone(hab, full) {
      const z = this.bg.zones, W = this.W, H = this.H;
      if (hab === 'water') return { hab, x0: W * z.water.x0, x1: W * z.water.x1, y0: H * z.water.y0, y1: H * z.water.y1 };
      const r = hab === 'sky' ? { hab, x0: W * 0.05, x1: W * 0.95, y0: H * z.sky[0], y1: H * z.sky[1] } : { hab: 'ground', x0: W * 0.04, x1: W * 0.96, y0: H * z.ground[0], y1: H * z.ground[1] };
      if (!full && this.opts.world) { const b = this.band(); r.x0 = Math.max(r.x0, b.x0); r.x1 = Math.min(r.x1, b.x1); }
      return r;
    }
    inZone(e) { const z = this.zone(e.habitat); return e.x >= z.x0 && e.x <= z.x1 && e.y >= z.y0 && e.y <= z.y1; }
    randomPoint(hab) {
      const z = this.zone(hab);
      for (let i = 0; i < 12; i++) { const p = { x: U().rand(z.x0, z.x1), y: U().rand(z.y0, z.y1) }; if (hab !== 'ground' || !this.inWater(p.x, p.y)) return p; }
      return { x: U().rand(z.x0, z.x1), y: z.y1 };
    }
    /** Точка в водоёме локации? (наземные динозавры обходят пруды стороной) */
    inWater(x, y) {
      if (!this.reflections || !this.reflections.length) return false;
      const ctx = this.ctx; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      const r = this.reflections.some(rf => ctx.isPointInPath(rf.path, x, y + this.baseW() * 0.02)); ctx.restore(); return r;
    }
    depth(e) {
      const z = this.zone(e.habitat);
      const f = (e.y - z.y0) / Math.max(1, z.y1 - z.y0);
      if (e.habitat === 'ground') return 0.55 + 0.6 * U().clamp(f, 0, 1);
      if (e.habitat === 'water') return (0.6 + 0.35 * U().clamp(f, 0, 1)) * Math.min(1, (z.x1 - z.x0) / (this.VW * 0.35));
      return 0.65 + 0.25 * U().clamp(f, 0, 1);
    }
    baseW() { return Math.min(this.VW || this.W, this.H * 1.7) * 0.15; }

    /** Синхронизировать список динозавров (по uid) */
    setDinos(list, instant) {
      const keep = {};
      const prevEnt = this.opts.entrance;
      if (instant) this.opts.entrance = false;
      list.forEach(d => {
        keep[d.uid] = 1;
        let e = this.ents.find(x => x.uid === d.uid);
        if (!e) { e = this.makeEnt(d); this.ents.push(e); }
        else { e.name = d.name; e.d = d; e.owner = d.owner; if (e.state === 'leave') { e.state = 'wander'; e.enter = 1; } }
      });
      this.opts.entrance = prevEnt;
      this.ents = this.ents.filter(e => {
        if (keep[e.uid]) return true;
        if (instant || e.state === 'gone') return false;
        if (e.hideAt) { e.hideAt.busy = null; e.hideAt = null; }
        if (e.state !== 'leave') this.leave(e); // уходит в другую локацию — красиво убегает за край
        return true;
      });
      this.tickNeeds(true);
    }
    /** Динозавр убегает за край экрана (переезд в другую локацию) */
    leave(e) {
      if (e.food) { e.food.eaters = Math.max(0, e.food.eaters - 1); e.food = null; }
      const v = this.view(); e.hidden = null;
      e.state = 'leave'; e.leaveDir = e.x < (v.x0 + v.x1) / 2 ? -1 : 1; e.bubble = { text: U().pick(['Пока! 👋', 'В путь! 🧭', 'Я скоро! 🌍']), t: 0 };
    }
    ent(uid) { return this.ents.find(x => x.uid === uid); }
    makeEnt(d, spawn) {
      const sp = DP.Dinos.byId[d.species || d.base];
      const habitat = d.habitat || (sp ? sp.habitat : 'ground');
      const p = this.randomPoint(habitat);
      const e = {
        uid: d.uid, d, owner: d.owner, species: d.species || d.base || null, name: d.name || '', habitat, lie: 0, blinkT: 2 + Math.random() * 4, nest: 0, diet: d.diet || (sp ? sp.diet : 'omni'),
        size: sp ? sp.size : 1.05, speedK: sp ? sp.speed : 1, img: new Image(), ready: false,
        x: p.x, y: p.y, tx: p.x, ty: p.y, vx: 0, vy: 0, idle: Math.random() * 2, facing: Math.random() < 0.5 ? 1 : -1, flip: 1,
        phase: Math.random() * 10, jump: 0, bubble: null, state: 'wander', food: null, eatT: 0, born: this.t, seed: Math.random() * 100
      };
      e.flip = e.facing;
      Object.assign(e, { heading: Math.random() * TAU, wA: 0, spd: 0.6, spdT: 0.6, mode: 'walk', modeT: U().rand(1, 4), act: null, headA: 0 });
      this.loadArt(e, d, sp);
      if (this.opts.entrance !== false) { // забегает из-за края
        const v = this.view(); e.x = Math.random() < 0.5 ? v.x0 - this.baseW() : v.x1 + this.baseW();
        if (habitat === 'water') e.x = U().rand(this.zone('water').x0, this.zone('water').x1);
        e.enter = 1;
      }
      return e;
    }
    /** Загрузка картинки динозавра: готовый — марионетка из частей, нарисованный ребёнком — спрайт */
    loadArt(e, d, sp) {
      if (!d.sprite && sp && DP.Dinos.rig) {
        e.rig = DP.Dinos.rig(sp.id, d.palette || 0);
        const VB = e.rig.VB; e.aspect = VB.h / VB.w;
        e.rig.promise.then(() => { e.ready = true; });
      } else {
        e.img.onload = () => { e.ready = true; e.aspect = e.img.naturalHeight / e.img.naturalWidth || 0.65; };
        e.img.src = d.sprite || DP.Dinos.url(d.species, d.palette || 0);
      }
    }
    hit(x, y) {
      const sorted = this.ents.slice().sort((a, b) => b.y - a.y);
      for (const e of sorted) { const r = e._rect; if (r && e.state !== 'hidden' && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return e; }
      return null;
    }
    /** Касание экрана (экранные координаты) → динозавр */
    hitScreen(sx, sy) { const p = this.toWorld(sx, sy); return this.hit(p.x, p.y); }
    jump(uid, text) {
      const e = this.ents.find(x => x.uid === uid); if (!e) return;
      if (e.state === 'sleep') { e.bubble = { text: 'Zzz… 😴', t: 0 }; return; }
      e.jump = 0.0001; e.bubble = { text: text || U().pick(ROARS), t: 0 };
      voice(e, 'tap');
    }
    /** Мяч для игры рядом с динозавром (u — смещение 0..1, одинаково на всех экранах) */
    play(uid, u) {
      const e = this.ent(uid); if (!e) return;
      if (e.state === 'sleep') { e.state = 'wander'; e.wakeShow = 1; }
      if (e.habitat !== 'ground') { // летающие и водные — кувырок и брызги
        e.jump = 0.0001; e.spin = 1; e.bubble = { text: U().pick(['Ура! 🎾', 'Весело! 🤸', 'Ещё! 😄']), t: 0 };
        this.hearts(e.x, e.y - this.baseW() * 0.3); voice(e, 'play'); return;
      }
      const z = this.zone('ground'), bw = this.baseW();
      const side = (u == null ? Math.random() : u) < 0.5 ? -1 : 1;
      const x = U().clamp(e.x + side * bw * (0.9 + (u || 0.5) * 0.6), z.x0 + 20, z.x1 - 20), y = U().clamp(e.y + bw * 0.08, z.y0, z.y1);
      const ball = { x, y, z: this.H * 0.35, vx: 0, vy: 0, vz: 0, t: 0, owner: uid, kicks: 0, rot: 0 };
      this.balls.push(ball);
      e.state = 'play'; e.ball = ball; e.playT = 0; e.bubble = { text: U().pick(['Мячик! 🎾', 'Играем! 😄', 'Лови! ⚽']), t: 0 };
      // кому скучно — присоединяются
      this.ents.forEach(o => { if (o !== e && o.habitat === 'ground' && o.state === 'wander' && o.need && o.need.play < 70 && !o.need.asleep && Math.random() < 0.7) { o.state = 'play'; o.ball = ball; o.playT = 0; } });
    }
    sleepNow(uid) { const e = this.ent(uid); if (e) { this.tickNeeds(true); } }
    /** items: [{type, zone:'ground'|'water'|'any', u, v}] — u,v в долях зоны (одинаково на всех экранах) */
    dropFood(items) {
      items.forEach(it => {
        const z = this.zone(it.zone === 'water' ? 'water' : 'ground');
        let x = z.x0 + (it.u || 0.5) * (z.x1 - z.x0), y = z.y0 + (it.v || 0.5) * (z.y1 - z.y0), fy;
        if (it.near) { // корм прямо возле конкретного динозавра (тайное кормление)
          const e = this.ent(it.near); if (!e) return;
          const w = this.baseW() * e.size * this.depth(e);
          x = U().clamp(e.x + (it.dx || 0.5) * w, z.x0 + 6, z.x1 - 6);
          y = U().clamp((e.habitat === z.hab ? e.y : z.y0 + (z.y1 - z.y0) * 0.5) + (it.dy || 0) * this.H, z.y0, z.y1);
          fy = y - this.H * 0.07;
        } else fy = it.zone === 'water' ? z.y0 - this.H * 0.05 : -this.H * 0.05 - Math.random() * this.H * 0.2;
        this.food.push({ type: it.type, zone: it.zone, x, y, fy, vy: 0, landed: false, amount: 1, eaters: 0, born: this.t, rot: Math.random() * TAU, only: it.only || null, secret: !!it.secret, by: it.by || null });
      });
    }
    /** Сгенерировать набор корма под текущих динозавров */
    makeFeed(n) {
      const diets = {}, habs = {};
      this.ents.filter(e => e.state !== 'leave').forEach(e => { diets[e.diet] = 1; habs[e.habitat] = 1; });
      const types = [];
      if (diets.herb) types.push('leaf');
      if (diets.carn) types.push('meat');
      if (diets.omni || !types.length) types.push('leaf', 'meat');
      const items = []; const count = n || U().clamp(this.ents.length + 2, 4, 9);
      for (let i = 0; i < count; i++) items.push({ type: U().pick(types), zone: 'ground', u: Math.random(), v: 0.15 + Math.random() * 0.8 });
      if (habs.water) for (let i = 0; i < 3; i++) items.push({ type: 'fish', zone: 'water', u: Math.random(), v: 0.2 + Math.random() * 0.7 });
      return items;
    }
    /** Тайный корм: по 2 кусочка рядом с каждым из указанных динозавров, есть может только он */
    makeSecretFeed(uids) {
      const items = [];
      uids.forEach(uid => {
        const e = this.ent(uid); if (!e) return;
        const type = e.diet === 'herb' ? 'leaf' : e.habitat === 'water' ? 'fish' : e.diet === 'carn' ? 'meat' : U().pick(['leaf', 'meat']);
        const zone = e.habitat === 'water' ? 'water' : 'ground';
        for (let i = 0; i < 2; i++) items.push({ type, zone, near: uid, only: uid, secret: true, dx: (i ? 1 : -1) * U().rand(0.35, 0.6), dy: U().rand(0.005, 0.03) });
      });
      return items;
    }
    /** Корм в точке нажатия */
    foodAt(x, y) {
      const wz = this.zone('water'), gz = this.zone('ground');
      const inWater = x >= wz.x0 && x <= wz.x1 && y >= wz.y0 && y <= wz.y1;
      const diets = {}; this.ents.forEach(e => diets[e.diet] = 1);
      const types = diets.herb && diets.carn ? ['leaf', 'meat'] : diets.carn ? ['meat'] : diets.herb ? ['leaf'] : ['leaf', 'meat'];
      if (inWater && this.ents.some(e => e.habitat === 'water')) return { type: 'fish', zone: 'water', u: (x - wz.x0) / (wz.x1 - wz.x0), v: (y - wz.y0) / (wz.y1 - wz.y0) };
      return { type: U().pick(types), zone: 'ground', u: U().clamp((x - gz.x0) / (gz.x1 - gz.x0), 0, 1), v: U().clamp((y - gz.y0) / (gz.y1 - gz.y0), 0.05, 1) };
    }
    canEat(e, f) {
      if (f.only && f.only !== e.uid) return false; // тайный корм — только своему
      if (FOOD_FOR[e.diet].indexOf(f.type) < 0) return false;
      if (e.habitat === 'water') return f.zone === 'water';
      if (e.habitat === 'ground') return f.zone !== 'water';
      return true; // летающие достают везде
    }

    /** Пересчитать потребности (раз в 0.25 с) и переходы сон ↔ бодрствование */
    tickNeeds(force) {
      if (!NEEDS()) return;
      const now = Date.now();
      this.ents.forEach(e => {
        if (!e.d) return;
        const n = NEEDS().at(e.d, now), was = e.need;
        e.need = n;
        if (e.state === 'leave' || e.state === 'gone' || e.state === 'hide' || e.state === 'hidden') return;
        if (n.asleep && e.state !== 'sleep') {
          if (e.food) { e.food.eaters = Math.max(0, e.food.eaters - 1); e.food = null; }
          e.state = 'sleep'; e.ball = null; e.bubble = force && !was ? null : { text: 'Zzz… 😴', t: 0 };
          if (force && !was) { e.lie = 1; e.nest = 1; }
        } else if (!n.asleep && e.state === 'sleep') {
          e.state = 'wander'; e.mode = 'idle'; e.act = 'look'; e.modeT = 1.2;
          if (!force) { e.jump = 0.0001; e.bubble = { text: U().pick(['Доброе утро! ☀️', 'Выспался! 😊', 'Ааа-ууу! 🥱']), t: 0 }; voice(e, 'wake'); if (this.opts.onWake) this.opts.onWake(e); }
        }
      });
    }
    update(dt) {
      const W = this.W, H = this.H, bw = this.baseW();
      this.needT -= dt; if (this.needT <= 0) { this.needT = 0.25; this.tickNeeds(); }
      // корм падает
      this.food.forEach(f => {
        if (!f.landed) {
          f.vy += (f.zone === 'water' ? 300 : 1400) * dt; f.vy = Math.min(f.vy, f.zone === 'water' ? 120 : 1200);
          f.fy += f.vy * dt;
          if (f.fy >= f.y) { f.fy = f.y; f.landed = true; f.secret ? this.sparkle(f.x, f.y) : this.burst(f.x, f.y, 'dust'); }
        }
        if (f.secret && Math.random() < dt * 3) this.parts.push({ kind: 'spark', x: f.x + U().rand(-8, 8), y: (f.landed ? f.y : f.fy) - U().rand(4, 14), vx: 0, vy: -12, t: 0, life: 0.7, s: U().rand(0.5, 1) });
        if (this.t - f.born > 40) f.amount -= dt; // испаряется со временем
      });
      this.food = this.food.filter(f => f.amount > 0);
      // мячи: прыгают, катятся, исчезают
      const gz = this.zone('ground');
      this.balls.forEach(b => {
        b.t += dt; b.vz -= 1600 * dt; b.z += b.vz * dt; if (b.z < 0) { b.z = 0; b.vz = Math.abs(b.vz) * 0.5; if (b.vz < 40) b.vz = 0; }
        b.x += b.vx * dt; b.y += b.vy * dt; const fr = Math.pow(0.35, dt); b.vx *= fr; b.vy *= fr; b.rot += b.vx * dt * 0.05;
        if (b.x < gz.x0 + 10 || b.x > gz.x1 - 10) { b.vx = -b.vx; b.x = U().clamp(b.x, gz.x0 + 10, gz.x1 - 10); }
        if (b.y < gz.y0 || b.y > gz.y1) { b.vy = -b.vy; b.y = U().clamp(b.y, gz.y0, gz.y1); }
      });
      this.balls = this.balls.filter(b => b.t < 9);

      this.ents.forEach(e => {
        const k = this.depth(e), w = bw * e.size * k;
        let speed = bw * 0.55 * e.speedK * k;
        const n = e.need;
        if (e.enter) { // выход на сцену
          const z = this.zone(e.habitat);
          if (e.x > z.x0 && e.x < z.x1) e.enter = 0; else { e.tx = U().clamp(e.x, z.x0 + w, z.x1 - w); e.ty = e.y; }
        }
        // уход в другую локацию
        if (e.state === 'leave') {
          const v = this.view();
          e.tx = e.leaveDir < 0 ? v.x0 - w * 1.2 : v.x1 + w * 1.2; e.ty = e.y; speed *= 2;
          if (e.habitat === 'water') { e.fade = (e.fade || 1) - dt * 0.8; if (e.fade <= 0) e.state = 'gone'; }
          else if (e.x < v.x0 - w || e.x > v.x1 + w) e.state = 'gone';
        }
        // сон: лежит в гнезде
        if (e.state === 'sleep') {
          e.lie = Math.min(1, e.lie + dt * 1.5); e.nest = Math.min(1, e.nest + dt * 0.8);
          e.vx *= 0.85; e.vy *= 0.85;
          if (Math.random() < dt * 0.9) this.parts.push({ kind: 'z', x: e.x + w * 0.25 * e.facing, y: (e.habitat === 'ground' ? e.y : e.y + w * 0.3) - w * (e.aspect || 0.6) * 0.55, vx: U().rand(4, 14) * e.facing, vy: -22, t: 0, life: 2.2, s: U().rand(0.8, 1.3) });
        } else { e.lie = Math.max(0, e.lie - dt * 2.5); e.nest = Math.max(0, e.nest - dt * 0.6); }
        // моргание
        e.blinkT -= dt; if (e.blinkT < -0.14) e.blinkT = 2.5 + Math.random() * 4;
        // игра с мячом
        if (e.state === 'play') {
          const b = e.ball;
          e.playT += dt;
          if (!b || this.balls.indexOf(b) < 0 || e.playT > 8) { e.state = 'wander'; e.ball = null; e.mode = 'idle'; e.act = 'look'; e.modeT = 0.8; }
          else {
            const side = e.x < b.x ? -1 : 1;
            e.tx = b.x + side * w * 0.3; e.ty = b.y; speed *= 2.2;
            if (Math.hypot(e.tx - e.x, e.ty - e.y) < Math.max(10, w * 0.12) && b.z < 30) { // пинок!
              const a = U().rand(-0.7, 0.7);
              b.vx = -side * U().rand(260, 420) * (this.VW / 1200); b.vy = Math.sin(a) * 120; b.vz = U().rand(380, 560); b.kicks++;
              e.jump = 0.0001; e.facing = -side;
              if (b.kicks === 1 || Math.random() < 0.3) { e.bubble = { text: U().pick(['Хоп! ⚽', 'Ура! 🎾', 'Йе! 😄', 'Гол! 🥅']), t: 0 }; }
              if (b.owner === e.uid && !e.playedReported) { e.playedReported = true; if (this.opts.onPlay) this.opts.onPlay(e); voice(e, 'play'); }
            }
          }
        } else e.playedReported = false;
        // догонялки: когда скучно — гоняется за другом
        if (e.state === 'chase') {
          const o = e.chase; e.chaseT -= dt;
          if (!o || this.ents.indexOf(o) < 0 || o.state === 'sleep' || o.state === 'leave' || e.chaseT <= 0) { e.state = 'wander'; e.chase = null; if (o && o.state === 'flee') o.state = 'wander'; }
          else {
            e.tx = o.x; e.ty = o.y; speed *= 1.9;
            if (Math.hypot(o.x - e.x, (o.y - e.y) * 2) < w * 0.5) { // поймал!
              e.jump = 0.0001; o.jump = 0.0001; e.bubble = { text: U().pick(['Поймал! 😆', 'Ты водишь! 🏃', 'Попался! 😄']), t: 0 };
              this.hearts((e.x + o.x) / 2, e.y - w * 0.5);
              e.state = 'wander'; e.mode = 'idle'; e.modeT = 1; e.chase = null;
              if (Math.random() < 0.6) { o.state = 'chase'; o.chase = e; o.chaseT = U().rand(3, 6); e.state = 'flee'; e.fleeFrom = o; } else o.state = 'wander';
            }
          }
        }
        if (e.state === 'flee') {
          const o = e.fleeFrom;
          if (!o || o.state !== 'chase' || o.chase !== e) e.state = 'wander';
          else { const z = this.zone('ground'); const dx = e.x - o.x || 1; e.tx = U().clamp(e.x + Math.sign(dx) * w, z.x0 + w * 0.6, z.x1 - w * 0.6); e.ty = U().clamp(e.y + (e.y - o.y), z.y0, z.y1); speed *= 1.7; }
        }
        if (e.state === 'duo' || e.state === 'explore' || e.state === 'hide' || e.state === 'hidden') speed = this.behave(e, dt, w, speed);
        // поиск корма
        if ((e.state === 'wander' || e.state === 'chase' || e.state === 'flee' || e.state === 'play' || e.state === 'duo' || e.state === 'explore') && this.food.length && !(n && n.asleep)) {
          let best = null, bd = Infinity;
          this.food.forEach(f => {
            if (!f.landed && f.fy < f.y - H * 0.25) return;
            if (!this.canEat(e, f) || f.eaters >= 3) return;
            if (n && n.food > 97 && !f.only) return; // сытый не бежит
            const d = Math.hypot(f.x - e.x, f.y - e.y); if (d < bd) { bd = d; best = f; }
          });
          if (best) {
            if (e.state === 'flee' && e.fleeFrom) e.fleeFrom.state = 'wander';
            e.state = 'food'; e.food = best; best.eaters++; e.ball = null; e.chase = null; e.duo = null;
            e.bubble = best.secret ? { text: '🤫😋', t: 0 } : { text: U().pick(['Ням! 😋', '🍽️', 'Еда! 🤤', '😍']), t: 0 };
          }
        }
        if (e.state === 'food') {
          const f = e.food;
          if (!f || this.food.indexOf(f) < 0) { e.state = 'wander'; e.food = null; e.modeT = 0; }
          else {
            const side = e.x < f.x ? -1 : 1;
            e.tx = f.x + side * w * 0.38; e.ty = e.habitat === 'sky' ? f.y - w * 0.15 : f.y + (e.habitat === 'ground' ? 2 : 0);
            speed *= (n && n.food < NEEDS().LOW) ? 3 : 2.4; // голодные бегут быстрее
            if (Math.hypot(e.tx - e.x, e.ty - e.y) < Math.max(8, w * 0.08) && f.landed) { e.state = 'eat'; e.eatT = 0; e.facing = -side; if (Math.random() < 0.5) voice(e, 'eat'); }
          }
        }
        if (e.state === 'eat') {
          e.eatT += dt; e.vx *= 0.8; e.vy *= 0.8;
          const f = e.food;
          if (f && this.food.indexOf(f) >= 0) {
            f.amount -= dt * 0.7;
            if (f.amount <= 0) { this.hearts(e.x, e.y - w * (e.aspect || 0.6) * 0.8); }
          }
          if (!f || this.food.indexOf(f) < 0 || f.amount <= 0 || e.eatT > 2.2) {
            if (f && f.amount <= 0) { e.bubble = { text: f.secret ? U().pick(['🤫💚', 'Тсс… вкусно! 😋']) : U().pick(['💖', 'Вкусно! 😋', '😊', 'Спасибо! 💚']), t: 0 }; }
            if (f) f.eaters = Math.max(0, f.eaters - 1);
            if (f && this.opts.onEat) this.opts.onEat(e, f);
            e.state = 'wander'; e.food = null; e.mode = 'idle'; e.act = 'look'; e.modeT = 0.6 + Math.random();
            this.hearts(e.x, e.y - w * (e.aspect || 0.6) * 0.7);
          }
        }
        // движение
        if (e.state === 'hidden') { e.vx = 0; e.vy = 0; }
        else if (e.state !== 'eat' && e.state !== 'sleep') this.steer(e, dt, w, speed);
        e.x += e.vx * dt; e.y += e.vy * dt;
        if (!e.enter && e.state !== 'leave' && e.state !== 'gone') { const z = this.zone(e.habitat, true); e.y = U().clamp(e.y, z.y0 - 2, z.y1 + 2); e.x = U().clamp(e.x, z.x0 - w * 0.2, z.x1 + w * 0.2); }
        if (e.returning) { const v = this.view(); if (e.x > v.x0 + w * 0.5 && e.x < v.x1 - w * 0.5) { e.returning = 0; e.bubble = { text: U().pick(['Я вернулся! 😊', 'А вот и я! 👋', 'Видел столько всего! 🌿']), t: 0 }; } }
        if (e.vx > speed * 0.12) e.facing = 1; else if (e.vx < -speed * 0.12) e.facing = -1;
        e.flip += (e.facing - e.flip) * Math.min(1, dt * 9);
        const mv = Math.hypot(e.vx, e.vy) / Math.max(1, speed);
        e.moving = e.state === 'sleep' ? 0 : mv;
        e.phase += dt * (1.5 + 8 * Math.min(1.6, e.moving)) * (e.habitat === 'ground' ? 1 : 0.6);
        // голова: жуёт, нюхает, озирается; во сне опущена
        let ht = Math.sin(e.phase * 2) * 0.04 * Math.min(1, mv);
        if (e.state === 'eat') ht = 0.3 + Math.sin(this.t * 13 + e.seed) * 0.09;
        else if (e.state === 'sleep') ht = 0.34 + Math.sin(this.t * 1.2 + e.seed) * 0.02;
        else if (e.mode === 'idle' && e.state === 'wander') ht = e.act === 'sniff' ? 0.24 + Math.sin(this.t * 9 + e.seed) * 0.04 : e.act === 'look' ? Math.sin(this.t * 0.9 + e.seed) * 0.18 - 0.06 : Math.sin(this.t * 1.3 + e.seed) * 0.03;
        if (e.jump) ht = -0.32;
        e.headA += (ht - e.headA) * Math.min(1, dt * 6);
        if (e.jump) { e.jump += dt; if (e.jump > 0.75) { e.jump = 0; e.spin = 0; } }
        if (e.bubble) { e.bubble.t += dt; if (e.bubble.t > (e.bubble.life || 2.2)) e.bubble = null; }
      });
      this.ents = this.ents.filter(e => e.state !== 'gone');
      if (this.updateExtras) this.updateExtras(dt);
      // частицы
      this.parts.forEach(p => { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; });
      this.parts = this.parts.filter(p => p.t < p.life);
    }
    /** Новый «замысел» динозавра: шагать, бежать, постоять (осмотреться/понюхать) */
    nextMode(e) {
      const r = Math.random(), R = U().rand;
      e.act = null;
      const n = e.need;
      if (e.habitat === 'ground' && n && n.play < 45 && Math.random() < 0.5) { // скучно — догонялки
        const mates = this.ents.filter(o => o !== e && o.habitat === 'ground' && o.state === 'wander' && !(o.need && o.need.asleep));
        if (mates.length) { const o = U().pick(mates); e.state = 'chase'; e.chase = o; e.chaseT = R(4, 7); o.state = 'flee'; o.fleeFrom = e; e.bubble = { text: U().pick(['Догоню! 😆', 'Бежим! 🏃', 'Салки! 😄']), t: 0 }; return; }
      }
      if (e.habitat === 'ground' && n && !n.asleep && n.play < 80 && this.t - (this._duoT || -99) > 25 && Math.random() < 0.16 && this.startDuo(e)) return;
      if (this.opts.world && e.habitat !== 'water' && this.t > 20 && Math.random() < 0.012 && !this.ents.some(o => o.state === 'explore')) { this.explore(e); return; }
      if (e.habitat === 'ground' && r < 0.24) {
        e.mode = 'idle'; e.modeT = R(1.2, 3.8); e.act = U().pick(['look', 'sniff', 'rest']);
        if (e.act === 'look' && Math.random() < 0.45) e.facing = -e.facing; // оглянулся
      } else if (e.habitat === 'water' && r < 0.18) { e.mode = 'idle'; e.modeT = R(1.5, 4); e.act = 'rest'; }
      else if (r < (e.habitat === 'sky' ? 0.2 : 0.36)) { e.mode = 'sprint'; e.modeT = R(0.8, 2.2); e.wA += R(-1.5, 1.5); }
      else { e.mode = 'walk'; e.modeT = R(2, 6); e.spdT = R(0.35, 1.05); e.heading += R(-1.3, 1.3); }
    }
    steer(e, dt, w, speed) {
      const z = this.zone(e.habitat), R = U().rand;
      let tvx = 0, tvy = 0;
      const flat = e.habitat === 'ground' ? 0.55 : e.habitat === 'water' ? 0.7 : 0.8; // перспектива: по глубине медленнее
      // раздвигание: не толпиться на одном месте
      let sx = 0, sy = 0;
      const bw = this.baseW();
      for (const o of this.ents) {
        if (o === e || o.habitat !== e.habitat || o.enter || o.state === 'leave') continue;
        const wo = bw * o.size * this.depth(o);
        const dx = e.x - o.x, dy = (e.y - o.y) * 2.6, d = Math.hypot(dx, dy), minD = (w + wo) * 0.42;
        if (d < minD) { const f = 1 - d / minD; if (d < 0.01) { sx += R(-1, 1); sy += R(-1, 1); } else { sx += dx / d * f; sy += dy / d * f * 0.8; } }
      }
      if (e.state === 'food' || e.enter || e.state === 'leave' || e.state === 'play' || e.state === 'chase' || e.state === 'flee' || e.state === 'duo' || e.state === 'explore' || e.state === 'hide') {
        const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy), slow = Math.min(1, d / (w * 0.4));
        if (d > 1) { tvx = dx / d * speed * slow; tvy = dy / d * speed * slow * 0.7; }
        if (e.state !== 'leave' && !e.enter && e.state !== 'hide') { tvx += sx * speed * 0.5; tvy += sy * speed * 0.3; }
        if (d > 1) e.heading = Math.atan2(dy, dx);
      } else {
        e.modeT -= dt; if (e.modeT <= 0) this.nextMode(e);
        const mul = e.mode === 'idle' ? 0 : e.mode === 'sprint' ? 2.1 : e.spdT;
        e.spd += (mul - e.spd) * Math.min(1, dt * 1.6);
        // блуждание Рейнольдса: точка на окружности перед носом случайно скользит
        e.wA = U().clamp(e.wA + R(-1, 1) * 5 * dt, -1.3, 1.3);
        let hx = Math.cos(e.heading), hy = Math.sin(e.heading);
        let dx = hx * 1.4 + Math.cos(e.heading + e.wA) * 0.8, dy = hy * 1.4 + Math.sin(e.heading + e.wA) * 0.8;
        // мягкий обход границ своей зоны
        const mx = Math.max(w * 0.55, 30), my = Math.max(8, (z.y1 - z.y0) * 0.18);
        if (e.x < z.x0 + mx) dx += 3 * (z.x0 + mx - e.x) / mx; else if (e.x > z.x1 - mx) dx -= 3 * (e.x - (z.x1 - mx)) / mx;
        if (e.y < z.y0 + my) dy += 3 * (z.y0 + my - e.y) / my; else if (e.y > z.y1 - my) dy -= 3 * (e.y - (z.y1 - my)) / my;
        dx += sx * 2.4; dy += sy * 2.4;
        if (e.habitat === 'ground' && this.reflections && this.reflections.length) { // обходим пруд
          const lx = e.x + hx * w * 0.7, ly = e.y + hy * w * 0.25;
          if (this.inWater(lx, ly) || this.inWater(e.x, e.y)) {
            const rf = this.reflections[0], p = rf.p, cx = p.ellipse ? p.cx * this.W : e.x, cy = p.ellipse ? p.cy * this.H : (p.top * this.H);
            const ax = e.x - cx, ay = (e.y - cy) * 3, d = Math.hypot(ax, ay) || 1; dx += ax / d * 4; dy += ay / d * 4;
          }
        }
        // плавный поворот курса к желаемому (без «волчка»)
        let diff = Math.atan2(dy, dx) - e.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const turn = (e.mode === 'sprint' ? 3.2 : 2.2) * dt;
        e.heading += U().clamp(diff * Math.min(1, dt * 1.8), -turn, turn);
        dx = Math.cos(e.heading); dy = Math.sin(e.heading);
        const sp = speed * e.spd;
        tvx = dx * sp; tvy = dy * sp * flat;
        if (e.mode === 'idle') { tvx = sx * speed * 0.6; tvy = sy * speed * 0.35; }
        if (e.habitat === 'sky') tvy += Math.sin(this.t * 0.8 + e.seed) * speed * 0.15;
      }
      const a = Math.min(1, dt * (e.state !== 'wander' ? 4 : e.mode === 'sprint' ? 3 : 2.2));
      e.vx += (tvx - e.vx) * a; e.vy += (tvy - e.vy) * a;
    }
    // ——— совместные игры, прогулки и прятки ———
    /** Двое подходят друг к другу, здороваются (сердечки) и играют в мяч */
    startDuo(e, o) {
      if (!o) {
        const bw = this.baseW();
        const mates = this.ents.filter(x => x !== e && x.habitat === 'ground' && x.state === 'wander' && !x.enter && !(x.need && x.need.asleep) && Math.abs(x.x - e.x) < bw * 4);
        if (!mates.length) return false; o = U().pick(mates);
      }
      this._duoT = this.t;
      [e, o].forEach((a, i) => { a.state = 'duo'; a.duo = i ? e : o; a.duoT = 0; a.duoMet = 0; a.ball = null; });
      e.bubble = { text: U().pick(['Поиграем вместе? 🤝', 'Давай дружить! 💞', 'Пошли играть! 😄']), t: 0 };
      return true;
    }
    explore(e) {
      const v = this.view(), z = this.zone(e.habitat, true), bw = this.baseW(), b = this.band();
      const left = [z.x0 + bw, b.x0 - bw * 2], right = [b.x1 + bw * 2, z.x1 - bw], opts = [left, right].filter(r => r[1] - r[0] > bw);
      if (!opts.length) return false;
      const rg = U().pick(opts);
      e.state = 'explore'; e.exT = U().rand(28, 50); e.tx = U().rand(rg[0], rg[1]); e.ty = U().rand(z.y0, z.y1); e.explored = 1; e.exView = v;
      e.bubble = { text: U().pick(['Пойду погуляю! 🧭', 'Что там вдали? 👀', 'Я на разведку! 🗺️']), t: 0 };
      return true;
    }
    /** Прятки: динозавр бежит за куст или камень. cb(found) — когда нашли или вышел сам */
    hide(uid, maxT) {
      const e = this.ent(uid); if (!e || e.habitat !== 'ground' || e.state === 'leave' || e.state === 'gone') return false;
      const spots = this.props.filter(p => p.hide && !p.busy); if (!spots.length) return false;
      if (e.need && e.need.asleep) { this.tickNeeds(true); }
      const v = this.view(), far = spots.filter(p => (p.x < v.x0 || p.x > v.x1) && Math.abs(p.x - e.x) < this.VW * 1.6);
      const near = spots.filter(p => Math.abs(p.x - e.x) < this.VW * 1.2);
      const p = U().pick(far.length && Math.random() < 0.6 ? far : near.length ? near : spots);
      if (e.food) { e.food.eaters = Math.max(0, e.food.eaters - 1); e.food = null; }
      p.busy = e; e.hideAt = p; e.state = 'hide'; e.hideT = 0; e.hideMax = maxT || 75; e.ball = null; e.chase = null;
      e.bubble = { text: 'Раз, два, три — ищи меня! 🙈', t: 0, life: 2.6 };
      return true;
    }
    /** Касание куста/камня, за которым кто-то прячется */
    hitHidden(x, y) {
      for (const p of this.props) {
        if (!p.busy) continue;
        const e = p.busy, r = p.r * 1.25;
        if (x > p.x - r && x < p.x + r && y > p.y - r * 2 && y < p.y + r * 0.4) return e;
        if (e.state === 'hide' && e._rect) { const q = e._rect; if (x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) return e; }
      }
      return null;
    }
    unhide(e, found) {
      const p = e.hideAt; if (p) p.busy = null;
      e.hideAt = null; e.state = 'wander'; e.mode = 'idle'; e.act = 'look'; e.modeT = 1.2; e.jump = 0.0001;
      e.y = Math.min(e.y + this.baseW() * 0.12, this.zone('ground', true).y1);
      e.bubble = { text: found ? U().pick(['Нашёл! 🎉', 'Ой, нашёл! 😆', 'Ты меня нашёл! 💚']) : U().pick(['Я тут! 😝', 'Не нашёл? Я здесь! 🙈', 'Ку-ку! 😄']), t: 0, life: 2.6 };
      if (found) { this.hearts(e.x, e.y - this.baseW() * 0.5); this.sparkle(e.x, e.y - this.baseW() * 0.3); }
      if (p) for (let i = 0; i < 8; i++) this.parts.push({ kind: 'leaf', x: p.x + U().rand(-p.r, p.r), y: p.y - U().rand(0, p.r * 1.4), vx: U().rand(-60, 60), vy: U().rand(-90, -30), g: 160, t: 0, life: 1, s: U().rand(0.6, 1.2), c: p.leaf });
      voice(e, found ? 'play' : 'tap');
      if (this.opts.onHide) this.opts.onHide(e, !!found);
    }
    behave(e, dt, w, speed) {
      if (e.state === 'duo') {
        const o = e.duo; e.duoT += dt;
        if (!o || this.ents.indexOf(o) < 0 || o.state !== 'duo' || o.duo !== e || e.duoT > 9) { e.state = 'wander'; e.duo = null; e.modeT = 0; return speed; }
        const side = e.x < o.x ? -1 : 1, gap = (w + this.baseW() * o.size * this.depth(o)) * 0.3;
        e.tx = (e.x + o.x) / 2 + side * gap; e.ty = (e.y + o.y) / 2;
        if (Math.abs(e.x - o.x) < gap * 2.6 && Math.abs(e.y - o.y) < w * 0.3) {
          e.facing = -side;
          if (!e.duoMet) { e.duoMet = this.t; e.jump = 0.0001; if (e.uid < o.uid) { this.hearts((e.x + o.x) / 2, e.y - w * 0.7); e.bubble = { text: U().pick(['Друзья! 💞', 'Привет, дружок! 🤗', 'Обнимашки! 🤗']), t: 0 }; voice(e, 'play'); if (this.opts.onDuo) this.opts.onDuo(e, o); } }
          else if (this.t - e.duoMet > 1.3 && e.uid < o.uid) { // мяч — между ними, пинают друг другу
            const z = this.zone('ground', true);
            const ball = { x: (e.x + o.x) / 2, y: U().clamp((e.y + o.y) / 2 + w * 0.05, z.y0, z.y1), z: w * 0.8, vx: 0, vy: 0, vz: 0, t: 0, owner: null, kicks: 0, rot: 0 };
            this.balls.push(ball);
            [e, o].forEach(a => { a.state = 'play'; a.ball = ball; a.playT = 0; a.duo = null; });
            o.bubble = { text: U().pick(['Пасуй! ⚽', 'Лови! 🎾', 'Ура! 😄']), t: 0 };
          }
          return speed * 0.4;
        }
        return speed * 1.4;
      }
      if (e.state === 'explore') {
        e.exT -= dt;
        if (Math.hypot(e.tx - e.x, e.ty - e.y) < w * 0.3) { e.mode = 'idle'; return 0.0001; }
        if (e.exT <= 0) { e.state = 'wander'; e.modeT = 0; e.returning = 1; }
        return speed * 1.1;
      }
      if (e.state === 'hide') {
        const p = e.hideAt; if (!p) { e.state = 'wander'; return speed; }
        e.tx = p.x + (e.x < p.x ? -1 : 1) * 2; e.ty = p.y - 3; e.hideT += dt;
        if (Math.hypot(e.tx - e.x, (e.ty - e.y) * 2) < Math.max(10, w * 0.15) || e.hideT > 14) { e.state = 'hidden'; e.x = p.x; e.y = p.y - 3; e.hideT = 0; }
        return speed * 2.4;
      }
      if (e.state === 'hidden') {
        e.hideT += dt;
        if (e.hideT > e.hideMax) this.unhide(e, false);
        return 0;
      }
      return speed;
    }
    /** Угол поворота части марионетки */
    partAngle(e, p) {
      const t = this.t, mv = Math.min(1.4, e.moving || 0), A = p.amp;
      switch (p.role) {
        case 'leg': return Math.sin(e.phase + p.off) * 0.36 * mv * A * (1 - (e.lie || 0));
        case 'arm': return Math.sin(e.phase + p.off) * 0.14 * mv + Math.sin(t * 2 + e.seed) * 0.05;
        case 'tail': return (e.state === 'play' || e.state === 'chase' ? Math.sin(t * 9 + e.seed) * 0.1 : 0) + (Math.sin(t * (1.5 - (e.lie || 0)) + e.seed) * 0.06 + Math.sin(e.phase) * 0.05 * mv + (e.state === 'eat' ? Math.sin(t * 6) * 0.06 : 0)) * A;
        case 'head': case 'neck': return e.headA * A;
        case 'wing': return e.lie ? 0.5 * e.lie * A + Math.sin(t * 6 + e.seed) * 0.42 * A * (1 - e.lie) : Math.sin(t * (6 + 3 * mv) + e.seed + p.off) * 0.42 * A;
        case 'flip': return Math.sin(t * 2.6 + e.seed + p.off) * 0.32 * (0.4 + mv);
        default: return 0;
      }
    }
    hearts(x, y) {
      for (let i = 0; i < 4; i++) this.parts.push({ kind: 'heart', x: x + U().rand(-15, 15), y, vx: U().rand(-25, 25), vy: U().rand(-90, -50), t: 0, life: 1.6 + Math.random() * 0.4, s: U().rand(0.7, 1.2) });
    }
    burst(x, y) {
      for (let i = 0; i < 5; i++) this.parts.push({ kind: 'dust', x, y, vx: U().rand(-50, 50), vy: U().rand(-40, -10), g: 80, t: 0, life: 0.5, s: U().rand(0.5, 1) });
    }

    drawFood(ctx, f, u) {
      const s = u * 3.2 * Math.max(0.3, Math.min(1, f.amount + 0.2));
      const y = f.landed ? f.y : f.fy;
      ctx.save(); ctx.translate(f.x, y - s * 0.5);
      if (!f.landed) ctx.rotate(Math.sin(this.t * 6 + f.rot) * 0.4);
      if (f.landed && f.zone !== 'water') { ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(0, s * 0.5, s * 0.9, s * 0.22, 0, 0, TAU); ctx.fill(); }
      if (f.type === 'leaf') {
        ctx.fillStyle = '#4cd137'; ctx.strokeStyle = '#1e7a1e'; ctx.lineWidth = s * 0.08;
        for (const r of [-0.6, 0.5]) {
          ctx.save(); ctx.rotate(r); ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * 0.6, -s * 0.5, 0, -s * 1.3); ctx.quadraticCurveTo(-s * 0.6, -s * 0.5, 0, 0); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -s * 1.1); ctx.stroke(); ctx.restore();
        }
      } else if (f.type === 'meat') {
        ctx.rotate(-0.5);
        ctx.fillStyle = '#fff3e0'; ctx.strokeStyle = '#7a4a2a'; ctx.lineWidth = s * 0.08;
        ctx.beginPath(); ctx.rect(s * 0.2, -s * 0.13, s * 0.75, s * 0.26); ctx.fill(); ctx.stroke();
        [[0.95, -0.17], [0.95, 0.17]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(s * a, s * b, s * 0.17, 0, TAU); ctx.fill(); ctx.stroke(); });
        ctx.fillStyle = '#d9480f'; ctx.beginPath(); ctx.ellipse(-s * 0.15, 0, s * 0.55, s * 0.42, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(-s * 0.3, -s * 0.15, s * 0.2, s * 0.1, -0.4, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = '#ffa94d'; ctx.strokeStyle = '#a14d00'; ctx.lineWidth = s * 0.08;
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.7, s * 0.38, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.6, 0); ctx.lineTo(s * 1.05, -s * 0.35); ctx.lineTo(s * 1.05, s * 0.35); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-s * 0.35, -s * 0.07, s * 0.08, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    drawHeart(ctx, x, y, s, a) {
      ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(s, s);
      ctx.fillStyle = '#ff4d79'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.bezierCurveTo(-14, -4, -8, -14, 0, -7); ctx.bezierCurveTo(8, -14, 14, -4, 0, 6); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    drawBubble(ctx, x, y, b) {
      const L = b.life || 2.2, a = Math.min(1, b.t * 5, (L - b.t) * 3);
      const pop = (b.t < 0.2 ? 0.6 + b.t * 2 : 1) / Math.sqrt(this.cam.z);
      ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.translate(x, y); ctx.scale(pop, pop);
      const fs = Math.max(16, Math.min(28, this.VW * 0.018));
      ctx.font = `800 ${fs}px Nunito, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      const tw = ctx.measureText(b.text).width, pw = tw + fs * 1.1, ph = fs * 1.7;
      ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-pw / 2, -ph, pw, ph, ph / 2) : ctx.rect(-pw / 2, -ph, pw, ph);
      ctx.moveTo(-6, 0); ctx.lineTo(0, 10); ctx.lineTo(6, 0); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1d2b2b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.text, 0, -ph / 2 + 1);
      ctx.restore();
    }
    drawEnt(ctx, e, bw) {
      if (!e.ready) return;
      const k = this.depth(e), w = bw * e.size * k, h = w * e.aspect, t = this.t;
      let sx = 1, sy = 1, rot = 0, oy = 0;
      const mv = Math.min(1, e.moving || 0), lie = e.lie || 0;
      const R = e.rig ? 0.45 : 1; // у марионеток шагают ноги, корпус качается меньше
      if (e.habitat === 'ground') {
        oy = -Math.abs(Math.sin(e.phase)) * h * 0.07 * mv * R;
        sy = 1 + Math.sin(e.phase * 2) * 0.035 * mv * R + Math.sin(t * 2.2 + e.seed) * 0.012 * (1 - Math.min(1, mv));
        rot = Math.sin(e.phase) * 0.05 * mv * R;
      } else if (e.habitat === 'sky') {
        sy = 1 + Math.sin(t * 7 + e.seed) * 0.12 * R * (1 - lie); oy = Math.sin(t * (1.8 - lie) + e.seed) * h * 0.12; rot = e.vy * 0.0012;
      } else {
        rot = Math.sin(t * 2.5 + e.seed) * 0.06 * (1 - lie * 0.7); oy = Math.sin(t * 1.4 + e.seed) * h * 0.06; sy = 1 + Math.sin(t * 2.5 + e.seed) * 0.03;
      }
      if (lie) { // лежит: присел, дышит медленно
        sy *= 1 - 0.17 * lie + Math.sin(t * 1.7 + e.seed) * 0.018 * lie;
        if (e.habitat === 'ground') { oy += h * 0.05 * lie; rot *= 1 - lie; }
      }
      if (e.state === 'eat') { sy *= 1 + Math.sin(t * 22) * 0.05; rot += 0.12 * e.facing; }
      if (e.jump) {
        const j = e.jump / 0.75; oy -= Math.sin(Math.PI * Math.min(1, j * 1.15)) * h * 0.7;
        if (j < 0.12) sy *= 1 - (0.12 - j) * 1.5; if (j > 0.85) sy *= 1 - (j - 0.85) * 1.2;
        if (e.spin) rot += j * TAU * (e.facing || 1);
      }
      sx = 1 / Math.sqrt(sy);
      const anchorY = e.habitat === 'ground' ? e.y : e.y + h / 2;
      ctx.save();
      if (e.fade != null) ctx.globalAlpha = Math.max(0, Math.min(1, e.fade));
      // гнездо и тень
      if (e.habitat === 'ground' && e.nest > 0.01) this.drawNest(ctx, e.x, e.y, w, e.nest);
      if (e.d && e.d.legend) { // легендарный: золотое сияние
        const cy = anchorY + oy - h * 0.45, rr = w * (0.62 + 0.05 * Math.sin(t * 2.4 + e.seed));
        const g = ctx.createRadialGradient(e.x, cy, 0, e.x, cy, rr); g.addColorStop(0, 'rgba(255,224,102,.42)'); g.addColorStop(0.55, 'rgba(255,200,60,.16)'); g.addColorStop(1, 'rgba(255,200,60,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, cy, rr, 0, TAU); ctx.fill();
      }
      if (e.habitat === 'ground') {
        const ja = e.jump ? 1 - Math.sin(Math.PI * e.jump / 0.75) * 0.5 : 1;
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, w * 0.42 * ja);
        g.addColorStop(0, 'rgba(20,30,10,.34)'); g.addColorStop(0.6, 'rgba(20,30,10,.16)'); g.addColorStop(1, 'rgba(20,30,10,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(e.x, e.y - h * 0.01, w * 0.42 * ja, h * 0.08 * ja, 0, 0, TAU); ctx.fill();
      } else if (e.habitat === 'water') {
        ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(e.x, anchorY - h * 0.15, w * (0.35 + 0.05 * Math.sin(t * 3 + e.seed)), h * 0.05, 0, 0, TAU); ctx.stroke();
      }
      ctx.translate(e.x, anchorY + oy); ctx.rotate(rot * (e.flip < 0 ? -1 : 1));
      ctx.scale(sx * (Math.abs(e.flip) < 0.08 ? 0.08 * Math.sign(e.flip || 1) : e.flip), sy);
      const age = this.t - e.born; if (age < 0.4) { const s = 0.3 + age / 0.4 * 0.7; ctx.scale(s, s); }
      const hat = e.d && e.d.hat && !e.hatHide && Scene.HATS[e.d.hat];
      if (e.rig) {
        const VB = e.rig.VB, k2 = w / VB.w;
        ctx.scale(k2, k2); ctx.translate(-VB.x - VB.w / 2, e.habitat === 'ground' ? -248 : -VB.y - VB.h);
        const closed = lie > 0.55 || e.blinkT < 0;
        for (const p of e.rig.parts) { // 1) бумажная кромка всех частей
          if (!p.edge) continue;
          const a = this.partAngle(e, p), E = p.edge;
          if (a) { ctx.save(); ctx.translate(p.pivot[0], p.pivot[1]); ctx.rotate(a); ctx.translate(-p.pivot[0], -p.pivot[1]); ctx.drawImage(E.canvas, E.ox, E.oy, E.cw, E.ch); ctx.restore(); }
          else ctx.drawImage(E.canvas, E.ox, E.oy, E.cw, E.ch);
        }
        for (const p of e.rig.parts) { // 2) сами части
          if (!p.canvas) continue;
          const a = this.partAngle(e, p);
          ctx.save();
          if (a) { ctx.translate(p.pivot[0], p.pivot[1]); ctx.rotate(a); ctx.translate(-p.pivot[0], -p.pivot[1]); }
          ctx.drawImage(p.canvas, p.ox, p.oy, p.cw, p.ch);
          if (closed && p.eyes) p.eyes.forEach(E => this.drawLid(ctx, E, e.rig.lid, lie));
          if (hat && (p.role === 'head' || p.role === 'neck')) this.drawHat(ctx, hat, p, e);
          ctx.restore();
        }
      } else {
        if (e.habitat === 'ground') ctx.transform(1, 0, Math.sin(e.phase) * 0.05 * mv, 1, 0, 0);
        ctx.drawImage(e.img, -w / 2, -h, w, h);
        if (hat) { const fs = w * 0.26; ctx.font = `${Math.round(fs)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(hat, w * 0.24, -h * 0.86); }
      }
      ctx.restore();
      e._rect = { x: e.x - w / 2, y: anchorY + oy - h, w, h };
      e._top = anchorY + oy - h * (1 - 0.12 * lie); e._anchor = anchorY; e._w = w;
    }
    /** Шапка на голове марионетки (в координатах рисунка, уже повёрнута вместе с головой) */
    drawHat(ctx, hat, p, e) {
      const A = (Scene.HAT_AT[e.species] || {})[p.role] || (p.role === 'neck' ? [0.82, 0.02] : [0.6, 0.06]);
      const fs = U().clamp(Math.min(p.cw, p.ch) * (A[2] || 0.62), 34, 74);
      ctx.save(); ctx.translate(p.ox + p.cw * A[0], p.oy + p.ch * A[1] + fs * 0.22); ctx.rotate(-0.12);
      ctx.font = `${Math.round(fs)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(hat, 0, 0); ctx.restore();
    }
    /** Закрытый глаз: веко цвета кожи и линия ресниц */
    drawLid(ctx, E, col, lie) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(E.x, E.y, E.r * 1.25, E.r * 1.18, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(20,14,8,.8)'; ctx.lineWidth = Math.max(1.4, E.r * 0.32); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(E.x - E.r * 1.05, E.y + E.r * 0.05); ctx.quadraticCurveTo(E.x, E.y + E.r * (0.55 + 0.2 * lie), E.x + E.r * 1.1, E.y); ctx.stroke();
    }
    drawNest(ctx, x, y, w, a) {
      ctx.save(); ctx.globalAlpha *= a;
      const rx = w * 0.5, ry = w * 0.11;
      ctx.fillStyle = 'rgba(70,45,20,.55)'; ctx.beginPath(); ctx.ellipse(x, y + ry * 0.2, rx, ry, 0, 0, TAU); ctx.fill();
      ctx.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        const ang = (i / 26) * TAU, r1 = 0.82 + ((i * 37) % 10) / 60;
        const px = x + Math.cos(ang) * rx * r1, py = y + ry * 0.2 + Math.sin(ang) * ry * r1;
        ctx.strokeStyle = i % 3 ? '#8a5a2b' : '#c08a4a'; ctx.lineWidth = Math.max(1.5, w * 0.012);
        ctx.beginPath(); ctx.moveTo(px - Math.sin(ang) * rx * 0.22, py + Math.cos(ang) * ry * 0.5); ctx.lineTo(px + Math.sin(ang) * rx * 0.22, py - Math.cos(ang) * ry * 0.5); ctx.stroke();
      }
      ctx.restore();
    }
    drawBall(ctx, b) {
      const r = Math.max(7, this.baseW() * 0.065), a = Math.min(1, (9 - b.t) * 2);
      ctx.save(); ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(b.x, b.y, r * (1 - Math.min(0.5, b.z / 400)), r * 0.3, 0, 0, TAU); ctx.fill();
      ctx.translate(b.x, b.y - r - b.z); ctx.rotate(b.rot);
      const cols = ['#ff4d4d', '#ffffff', '#ffd43b', '#ffffff', '#4dabf7', '#ffffff'];
      for (let i = 0; i < 6; i++) { ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, i * TAU / 6, (i + 1) * TAU / 6); ctx.fill(); }
      const g = ctx.createRadialGradient(-r * 0.4, -r * 0.4, 0, 0, 0, r); g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.restore();
    }
    /** Надписи над динозаврами: имя, индикаторы 🍖🎾💤, пузырь */
    drawOverlay(ctx, e) {
      if (!e.ready || e._top == null) return;
      const w = e._w, t = this.t;
      if (e.fade != null && e.fade < 0.5) return;
      const zs = 1 / Math.sqrt(this.cam.z);
      if (this.showLabels && e.name) {
        const fs = Math.max(12, Math.min(18, w * 0.11)) * zs;
        ctx.font = `800 ${fs}px Nunito, sans-serif`; const tw = ctx.measureText(e.name).width;
        const ly = e._anchor + (e.habitat === 'ground' ? fs * 0.9 : fs * 0.4);
        ctx.fillStyle = 'rgba(6,30,36,.6)'; ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(e.x - tw / 2 - 8, ly - fs * 0.75, tw + 16, fs * 1.5, fs) : ctx.rect(e.x - tw / 2 - 8, ly - fs * 0.75, tw + 16, fs * 1.5);
        ctx.fill(); ctx.fillStyle = e.d && e.d.legend ? '#ffd43b' : '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e.name, e.x, ly + 1);
      }
      let top = e._top - 4;
      // потребности над головами больше не рисуем нигде (лендинг, парк, ТВ) — они только в панели «Мои динозавры»
      if (e.bubble) this.drawBubble(ctx, e.x, top, e.bubble);
    }
    draw() {
      const ctx = this.ctx, W = this.W, H = this.H, VW = this.VW || W, u = Math.min(VW, H) / 100, bw = this.baseW();
      // камера: медленное «дыхание» + лёгкий отклик на указатель → параллакс слоёв
      this.camX += ((Math.sin(this.t * 0.07) * 0.6 + (this.opts.world ? 0 : (this.pointerX || 0) * 0.6)) * VW * 0.012 - this.camX) * 0.04;
      const z = this.cam.z, sc = this.dpr * z, tx = -this.cam.x * sc, ty = -this.cam.y * sc;
      const simple = !this.opts.world && z === 1 && !this.cam.x && !this.cam.y; // обычный экран без камеры — самый быстрый путь
      const setT = () => ctx.setTransform(sc, 0, 0, sc, tx, ty);
      const v = this.view();
      if (this.layerCanvases) {
        const d = this.wd, PADX = this.PADX || 0.05, pan = this.opts.world ? (v.x0 + v.x1) / 2 - W / 2 : 0;
        this.layerCanvases.forEach((lc, i) => {
          let off = this.camX * (1 - lc.L.depth);
          if (pan) off = U().clamp(off + pan * 0.06 * (1 - lc.L.depth), -W * PADX * 0.95, W * PADX * 0.95);
          if (simple) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(lc.c, Math.round((-W * PADX + off) * d), 0); }
          else {
            setT();
            const ox = -W * PADX + off;
            const sx0 = Math.max(0, Math.floor((v.x0 - ox) * d) - 2), sy0 = Math.max(0, Math.floor(v.y0 * d) - 2);
            const sw = Math.min(lc.c.width - sx0, Math.ceil((v.x1 - v.x0) * d) + 4), sh = Math.min(lc.c.height - sy0, Math.ceil((v.y1 - v.y0) * d) + 4);
            if (sw > 0 && sh > 0) ctx.drawImage(lc.c, sx0, sy0, sw, sh, ox + sx0 / d, sy0 / d, sw / d, sh / d);
          }
          setT();
          (this.reflections || []).forEach(rf => { if (rf.layer === i) this.drawReflection(ctx, rf); });
          if (lc.L.anim) { ctx.save(); ctx.translate(off, 0); lc.L.anim.call(lc.L, ctx, W, H, this.t); ctx.restore(); }
        });
      } else if (simple) {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.staticCanvas, 0, 0);
      } else { setT(); if (this.staticCanvas.width) ctx.drawImage(this.staticCanvas, 0, 0, W, H); }
      setT();
      if (this.bg.drawAnim) this.bg.drawAnim(ctx, W, H, this.t);
      const order = { water: 0, ground: 1, sky: 2 };
      const list = this.ents.slice().sort((a, b) => (order[a.habitat] - order[b.habitat]) || (a.y - b.y));
      this.food.filter(f => f.zone === 'water').forEach(f => this.drawFood(ctx, f, u));
      // всё, что стоит на земле, рисуем по глубине вместе с динозаврами: корм, мячи, кусты, яйца, зверьки, костёр
      let props = this.food.filter(f => f.zone !== 'water').map(f => ({ y: f.y, f })).concat(this.balls.map(b => ({ y: b.y, b })));
      if (this.extraDrawables) props = props.concat(this.extraDrawables(v));
      props.sort((a, b) => a.y - b.y);
      let fi = 0;
      const drawProp = (p) => p.f ? this.drawFood(ctx, p.f, u) : p.b ? this.drawBall(ctx, p.b) : p.draw(ctx);
      const vis = (e) => e.x > v.x0 - bw * 3 && e.x < v.x1 + bw * 3;
      list.forEach(e => {
        while (fi < props.length && e.habitat !== 'water' && (props[fi].y <= e.y || e.habitat === 'sky')) drawProp(props[fi++]);
        if (e.state === 'hidden') { e._rect = null; return; }
        if (simple || vis(e)) this.drawEnt(ctx, e, bw); else { e._rect = null; e._top = null; }
      });
      for (; fi < props.length; fi++) drawProp(props[fi]);
      this.parts.forEach(p => {
        const a = 1 - p.t / p.life;
        if (p.kind === 'heart') this.drawHeart(ctx, p.x + Math.sin(p.t * 6) * 4, p.y, p.s * (u / 6 + 0.6), a);
        else if (p.kind === 'spark') this.drawSpark(ctx, p.x, p.y, u * 0.9 * p.s, a, p.c);
        else if (p.kind === 'leaf') { ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = p.c || '#4f8a3a'; ctx.translate(p.x, p.y); ctx.rotate(p.t * 5 + p.s * 3); ctx.beginPath(); ctx.ellipse(0, 0, u * 0.9 * p.s, u * 0.4 * p.s, 0, 0, TAU); ctx.fill(); ctx.restore(); }
        else if (p.kind !== 'z') { ctx.fillStyle = `rgba(255,255,255,${a * 0.7})`; ctx.beginPath(); ctx.arc(p.x, p.y, u * 0.6 * p.s, 0, TAU); ctx.fill(); }
      });
      if (this.bg.drawFront) { ctx.save(); ctx.translate(-this.camX * 0.3, 0); this.bg.drawFront(ctx, W, H, this.t); ctx.restore(); }
      const tn = this.bg.id === 'custom' ? null : this.tint();
      if (tn) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = tn.c; ctx.fillRect(v.x0 - 2, v.y0 - 2, v.x1 - v.x0 + 4, v.y1 - v.y0 + 4); ctx.restore(); }
      if (this.bg.glow) this.bg.glow(ctx, W, H, this.t);
      else if (tn && tn.night && this.bg.id !== 'custom') this.fireflies(ctx, W, H);
      if (this.drawGlows) this.drawGlows(ctx, v, tn);
      // поверх всего: «Zzz», индикаторы, имена, пузыри
      this.parts.forEach(p => {
        if (p.kind !== 'z') return;
        const a = Math.min(1, p.t * 3) * (1 - p.t / p.life);
        ctx.save(); ctx.globalAlpha = a; ctx.font = `900 ${Math.round(u * 2.4 * p.s * (0.7 + p.t * 0.3))}px Nunito, sans-serif`;
        ctx.fillStyle = '#e7ecff'; ctx.strokeStyle = 'rgba(30,40,90,.7)'; ctx.lineWidth = 3; ctx.textAlign = 'center';
        ctx.strokeText('Z', p.x + Math.sin(p.t * 3) * 6, p.y); ctx.fillText('Z', p.x + Math.sin(p.t * 3) * 6, p.y); ctx.restore();
      });
      list.forEach(e => this.drawOverlay(ctx, e));
      if (this.drawOverlayExtras) this.drawOverlayExtras(ctx, v);
    }
    drawReflection(ctx, rf) {
      const d = this.wd || this.dpr, rc = rf.c, top = rf.top, t = this.t;
      ctx.save(); ctx.clip(rf.path); ctx.globalAlpha = rf.p.alpha == null ? 0.5 : rf.p.alpha;
      const step = Math.max(2, Math.round(2 * d)), cw = rc.width / d, sh = step / d;
      for (let y = 0; y < rc.height; y += step) {
        const k = y / rc.height, dx = Math.sin(t * 1.7 + y * 0.09 / d) * (1 + k * 4) + Math.sin(t * 0.9 + y * 0.031 / d) * k * 3;
        ctx.drawImage(rc, 0, y, rc.width, step, dx, top + y / d, cw, sh);
      }
      ctx.restore();
    }
    fireflies(ctx, W, H) {
      for (let i = 0; i < 14; i++) {
        const ph = i * 2.39, x = (0.5 + 0.45 * Math.sin(this.t * 0.11 + ph * 3)) * W, y = H * (0.55 + 0.35 * ((i * 0.37) % 1)) + Math.sin(this.t * 0.8 + ph) * H * 0.02, a = Math.max(0, Math.sin(this.t * 1.2 + ph));
        const g = ctx.createRadialGradient(x, y, 0, x, y, 10); g.addColorStop(0, `rgba(230,255,150,${a})`); g.addColorStop(1, 'rgba(230,255,150,0)'); ctx.fillStyle = g; ctx.fillRect(x - 10, y - 10, 20, 20);
      }
    }
    drawSpark(ctx, x, y, s, a, c) {
      ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.fillStyle = c || '#fff6b0'; ctx.translate(x, y); ctx.beginPath();
      for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.32 : s; const an = i * Math.PI / 4; ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r); }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    sparkle(x, y) { for (let i = 0; i < 6; i++) this.parts.push({ kind: 'spark', x: x + U().rand(-14, 14), y: y - U().rand(0, 16), vx: U().rand(-14, 14), vy: U().rand(-30, -8), t: 0, life: 0.9, s: U().rand(0.6, 1.2) }); }
    loop(now) {
      if (this._dead) return;
      requestAnimationFrame(this.loop);
      const fps = this.opts.maxFps || Scene.PERF.maxFps;
      if (fps && now - this._lastFrame < 1000 / fps - 2) return; // ограничение частоты кадров на слабых устройствах
      this._lastFrame = now;
      // медленный кадр (слабый телефон, тяжёлая 3D-сцена): логику догоняем шагами ≤ 50 мс, но не больше 150 мс за кадр
      const dt = Math.min(0.15, Math.max(0, (now - this.last) / 1000)); this.last = now;
      if (this._offscreen || document.hidden || !this.c.width) return; // сцену не видно — не тратим батарею
      this.t += dt; this.frames = (this.frames || 0) + 1;
      if (!this.paused) { this.updateCam(dt); for (let left = dt; left > 1e-4; left -= 0.05) this.update(Math.min(0.05, left)); this.draw(); }
    }
  }
  // Профиль производительности: телефоны/планшеты (сенсорный экран, маленький экран) и «экономия энергии»
  Scene.PERF = (function () {
    const mm = (q) => { try { return !!(window.matchMedia && matchMedia(q).matches); } catch (e) { return false; } };
    const sw = (window.screen && Math.min(screen.width, screen.height)) || 1024;
    const mobile = mm('(pointer: coarse)') || sw <= 820 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
    const reduce = mm('(prefers-reduced-motion: reduce)');
    const lowMem = navigator.deviceMemory && navigator.deviceMemory <= 2;
    // телевизоры (LG webOS, Tizen…): большой экран, но слабая видеокарта — средняя детализация, 30 кадров/с
    const tv = /Web0S|webOS|SmartTV|SMART-TV|Tizen|NetCast|BRAVIA|HbbTV/i.test(navigator.userAgent || '');
    // уровень детализации 3D: low — телефоны, mid — телевизоры и слабые ПК, high — компьютеры; ?q=low|mid|high — вручную
    const qp = /[?&]q=(low|mid|high)\b/.exec(location.search || '');
    const quality = qp ? qp[1] : mobile || lowMem ? 'low' : tv || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) ? 'mid' : 'high';
    return { mobile, tv, quality, reduce, maxDpr: tv ? 1 : 2, maxPixels: mobile ? (lowMem ? 0.9e6 : 1.4e6) : tv ? 2.1e6 : 4.5e6, maxFps: reduce || lowMem || tv ? 30 : 0 };
  })();
  Scene.all = [];
  // шапки (эмодзи) и где они сидят на голове у каждого вида: [доля ширины, доля высоты, размер]
  Scene.HATS = { cap: '🧢', bow: '🎀', flower: '🌸', sunhat: '👒', helmet: '⛑️', grad: '🎓', tophat: '🎩', crown: '👑' };
  Scene.HAT_AT = {};
  // уходим со страницы — сразу отдаём память холстов (иначе следующая страница на iPhone может не поместиться в лимит);
  // вернулись кнопкой «Назад» из кэша — рисуем заново
  window.addEventListener('pagehide', () => Scene.all.forEach(sc => sc.release()));
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) Scene.all.forEach(sc => sc.resize(true)); });
  DP.Scene = Scene;
  // фабрика сцены: 3D-движок (scene3d.js) подменяет её, если WebGL доступен
  DP.makeScene = DP.makeScene || ((canvas, opts) => new Scene(canvas, opts));
})();
