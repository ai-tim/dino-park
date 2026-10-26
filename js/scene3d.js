/* Динопарк — объёмная сцена (WebGL, three.js). Логика парка (потребности, прятки, мячи, синхронизация)
 * остаётся в DP.Scene и считается в тех же «плоских» координатах мира, а здесь только рисуется в 3D:
 * перспективная камера под небольшим углом сверху, рельеф, вода, растения, объёмные динозавры.
 * Подписи, индикаторы и пузыри рисуются поверх на прозрачном 2D-холсте.
 * Если WebGL недоступен — DP.makeScene создаёт обычную 2D-сцену. */
window.DP = window.DP || {};
(function () {
  const TAU = Math.PI * 2, U = () => DP.util, T = () => window.THREE;
  if (!DP.Scene) return;
  const Base = DP.Scene, PERF = Base.PERF, D2R = Math.PI / 180;
  // FXAA (Т. Лоттес, компактный вариант): сглаживает «лесенки» по контрасту яркости, 9 выборок — по силам телефону
  const FXAA = `precision highp float; uniform sampler2D tDiffuse; uniform vec2 inv; varying vec2 vUv;
    void main() {
      vec3 L = vec3(0.299, 0.587, 0.114);
      vec3 rgbM = texture2D(tDiffuse, vUv).rgb;
      float lNW = dot(texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * inv).rgb, L), lNE = dot(texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * inv).rgb, L);
      float lSW = dot(texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * inv).rgb, L), lSE = dot(texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * inv).rgb, L);
      float lM = dot(rgbM, L), lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      if (lMax - lMin < max(0.0312, lMax * 0.125)) { gl_FragColor = vec4(rgbM, 1.0); return; }
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
      float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0), rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
      dir = clamp(dir * rcp, -8.0, 8.0) * inv;
      vec3 A = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 B = A * 0.5 + 0.25 * (texture2D(tDiffuse, vUv - dir * 0.5).rgb + texture2D(tDiffuse, vUv + dir * 0.5).rgb);
      float lB = dot(B, L);
      gl_FragColor = vec4((lB < lMin || lB > lMax) ? A : B, 1.0);
    }`;

  class Scene3D extends Base {
    constructor(canvas, opts) {
      super(canvas, opts);
      this.is3d = true;
      if (!this.opts.maxFps && PERF.mobile) this.opts.maxFps = 30; // телефоны: 30 кадров в секунду — плавно и бережёт батарею
    }
    makeCtx() { this._aux = document.createElement('canvas'); this._aux.width = this._aux.height = 4; return this._aux.getContext('2d'); }
    /** v5: чёткость. Раньше: телевизор — не больше 1 пикселя на CSS-пиксель и бюджет 1,6 Мп (на 1920×1080 рисовали ~1690×950
     *  и растягивали — отсюда «мыло»), телефон — ~1,0 Мп без сглаживания. Теперь: родное разрешение экрана (ТВ 1920×1080,
     *  телефон — DPR 2 в пределах бюджета памяти) и сглаживание; _rs — динамический масштаб, если кадров мало. */
    pickDpr(w, h) {
      const dev = window.devicePixelRatio || 1, cap = Math.min(dev, PERF.tv ? 2 : (this.opts.maxDpr || 2));
      const lowMem = navigator.deviceMemory && navigator.deviceMemory <= 2;
      const budget = this.opts.maxPixels3 || (PERF.mobile ? (lowMem ? 0.75e6 : 1.45e6) : PERF.tv ? 2.2e6 : 4.2e6);
      return Math.max(0.75, Math.min(cap, Math.sqrt(budget / Math.max(1, w * h))) * (this._rs || 1));
    }
    /** Динамическое разрешение: без пересборки мира, только размер буферов */
    setRenderScale(rs) {
      rs = Math.max(0.55, Math.min(1, rs)); if (rs === (this._rs || 1) || !this.VW) return;
      this._rs = rs; this.dpr = this.pickDpr(this.VW, this.VH);
      if (this.renderer) { this.renderer.setPixelRatio(this.dpr); this.renderer.setSize(this.VW, this.VH, false); this.sizeOverlay(); }
      else { this.c.width = Math.round(this.VW * this.dpr); this.c.height = Math.round(this.VH * this.dpr); }
    }
    /** Мягкий авто-откат: спустя 6 с после старта, если 3 замера подряд (6 с) кадров < 60% от цели — уменьшаем разрешение на 15%;
     *  если 10 замеров подряд (20 с) кадров > 90% — возвращаем (каждая неудачная попытка удваивает ожидание). */
    adaptRes() {
      if (this.opts.adapt === false || /[?&]rs=fix\b/.test(location.search)) return;
      const now = performance.now(), A = this._ad || (this._ad = { t0: now, f: 0, bad: 0, good: 0, warm: now + 6000, need: 10, upAt: 0 });
      A.f++; if (now - A.t0 < 2000) return;
      const fps = A.f * 1000 / (now - A.t0); A.f = 0; A.t0 = now; this.fpsNow = Math.round(fps);
      if (now < A.warm || this.dimFps || document.hidden || this.paused) { A.bad = A.good = 0; return; }
      const target = Math.min(60, this.opts.maxFps || PERF.maxFps || 60), rs = this._rs || 1;
      if (fps < target * 0.6) { A.bad++; A.good = 0; } else if (fps > target * 0.9) { A.good++; A.bad = 0; } else { A.bad = 0; A.good = 0; }
      if (A.bad >= 3 && rs > 0.56) { if (now - A.upAt < 12000) A.need = Math.min(160, A.need * 2); this.setRenderScale(rs * 0.85); A.bad = 0; A.good = 0; }
      else if (A.good >= A.need && rs < 1) { this.setRenderScale(rs / 0.85 > 0.97 ? 1 : rs / 0.85); A.upAt = now; A.good = 0; }
    }
    /** Сглаживание: компьютер и ТВ — аппаратное MSAA; телефон — FXAA-проход (в 4 раза меньше памяти, чем MSAA). ?aa=0|fxaa|msaa */
    aaMode() {
      const m = /[?&]aa=(0|fxaa|msaa)\b/.exec(location.search || ''); if (m) return m[1];
      return PERF.mobile ? 'fxaa' : 'msaa';
    }
    ensurePost() {
      const THREE = T(), r = this.renderer, v = this._dbs || (this._dbs = new THREE.Vector2()); r.getDrawingBufferSize(v);
      let P = this.post;
      if (!P) {
        const rt = new THREE.WebGLRenderTarget(v.x, v.y, { depthBuffer: true, stencilBuffer: false, type: THREE.UnsignedByteType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
        // тон-маппинг и перевод в sRGB делаются прямо в материалах (как при выводе на экран), буфер — обычный RGBA8
        rt.texture.colorSpace = THREE.SRGBColorSpace; rt.texture.internalFormat = 'RGBA8'; rt.isXRRenderTarget = true;
        const mat = new THREE.ShaderMaterial({
          uniforms: { tDiffuse: { value: rt.texture }, inv: { value: new THREE.Vector2(1 / v.x, 1 / v.y) } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: FXAA, depthTest: false, depthWrite: false, toneMapped: false
        });
        const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false;
        const sc = new THREE.Scene(); sc.add(q);
        P = this.post = { rt, mat, q, sc, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
      }
      if (P.rt.width !== v.x || P.rt.height !== v.y) { P.rt.setSize(v.x, v.y); P.mat.uniforms.inv.value.set(1 / v.x, 1 / v.y); }
      return P;
    }
    freePost() { const P = this.post; if (!P) return; P.rt.dispose(); P.mat.dispose(); P.q.geometry.dispose(); this.post = null; }
    render3() {
      const r = this.renderer;
      if (this._aa === 'fxaa') {
        const P = this.ensurePost();
        r.setRenderTarget(P.rt); r.render(this.scene3, this.camera); r.setRenderTarget(null); r.render(P.sc, P.cam);
      } else r.render(this.scene3, this.camera);
    }
    // ——— WebGL: создаём лениво (базовый конструктор вызывает resize раньше, чем дойдёт до нашего кода) ———
    init3d() {
      if (this.renderer) return true;
      if (this._failed) return false;
      const THREE = T();
      try {
        this._aa = this.aaMode();
        this.renderer = new THREE.WebGLRenderer({ canvas: this.c, antialias: this._aa === 'msaa', depth: this._aa !== 'fxaa', alpha: false, stencil: false, powerPreference: PERF.mobile ? 'low-power' : 'default' });
      } catch (err) { this._failed = true; return false; }
      // цвет: мягкий тон-маппинг (Khronos Neutral) — цвета детского рисунка почти не меняются, а блики не «выгорают»
      const tm = /[?&]tm=(0|aces|agx)\b/.exec(location.search || '');
      this.renderer.toneMapping = tm ? ({ 0: THREE.NoToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping })[tm[1]] : THREE.NeutralToneMapping;
      this.renderer.toneMappingExposure = 1.06;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      DP.G3.aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy() || 1);
      this.scene3 = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1000);
      this.dyn = new THREE.Group(); this.scene3.add(this.dyn);
      this.models = new Map(); this.critM = new Map(); this.nestM = new Map(); this.propM = []; this.foodSet = new Set(); this.ballSet = new Set(); this.campM = null;
      this.fireLight = new THREE.PointLight('#ffb35a', 0, 0, 2); this.scene3.add(this.fireLight);
      this.mkShadows();
      this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._ray = new THREE.Vector3();
      // поверх — прозрачный 2D-холст для подписей, индикаторов, пузырей, сердечек
      const ov = this.ov = document.createElement('canvas'); ov.setAttribute('aria-hidden', 'true');
      if (this.c.parentNode) this.c.parentNode.insertBefore(ov, this.c.nextSibling);
      this.octx = ov.getContext('2d');
      const sync = () => { ov.className = this.c.className; ov.style.cssText = this.c.style.cssText; ov.style.pointerEvents = 'none'; ov.style.touchAction = 'none'; };
      sync(); try { this._mo = new MutationObserver(sync); this._mo.observe(this.c, { attributes: true, attributeFilter: ['class', 'style'] }); } catch (e) { /* ignore */ }
      // потеря контекста (iOS при нехватке памяти / уходе в фон): ждём восстановления и строим всё заново
      this._onLost = (ev) => { ev.preventDefault(); this._lost = true; };
      this._onRestored = () => { this._lost = false; this.rebuildAll(); };
      this.c.addEventListener('webglcontextlost', this._onLost, false);
      this.c.addEventListener('webglcontextrestored', this._onRestored, false);
      return true;
    }
    /** Настоящие мягкие тени от солнца (PCF soft): карта 1024 (телефон/ТВ) или 2048 (компьютер), камера тени следует за видимой полосой. ?sh=0 — выключить */
    shadowSize() {
      const m = /[?&]sh=(\d+)\b/.exec(location.search || ''); if (m) return +m[1];
      if (PERF.lowMem) return 0;
      return PERF.quality === 'high' ? 2048 : 1024;
    }
    setupSun() {
      const THREE = T(), r = this.renderer, w = this.world, sz = this.shadowSize(), dir = w && w.dir; if (!dir) return;
      this._sh = sz;
      r.shadowMap.enabled = !!sz; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true;
      dir.castShadow = !!sz; if (!sz) return;
      dir.shadow.mapSize.set(sz, sz); dir.shadow.bias = -0.0006; dir.shadow.normalBias = 0.04; dir.shadow.radius = 2;
      this._sunDir = dir.position.clone().normalize();
      const hiQ = PERF.quality !== 'low', top = PERF.quality === 'high';
      w.root.traverse(o => { if (!o.isMesh) return; if (o.userData.cast && (top || !/^trees-/.test(o.name))) o.castShadow = true; if (o.userData.recv && hiQ) o.receiveShadow = true; });
      if (this.shadow && this.shadow.mesh) this.shadow.mesh.material.opacity = 0.75; // контактные тени-пятна остаются, но мягче
    }
    /** Камера тени: охватывает видимую часть полосы прогулок вокруг точки взгляда; шаг привязан к текселям — тени не «дрожат» */
    fitSun() {
      const w = this.world, dir = w && w.dir; if (!this._sh || !dir || !this.M || !this._target) return;
      const M = this.M, z = this.cam.z || 1, tp = this._target, E = Math.max(8, Math.min(M.Wu * 0.62, M.Wu * 0.62 / Math.pow(z, 0.9) + 4));
      const sc = dir.shadow.camera, L = this._sunDir, D = E * 3 + 40, tex = 2 * E / this._sh;
      const cx = Math.round(tp.X / tex) * tex, cz = Math.round((tp.Z - E * 0.25) / tex) * tex;
      this._shMoved = this._shK !== cx + ',' + cz + ',' + E; this._shK = cx + ',' + cz + ',' + E;
      dir.target.position.set(cx, 0, cz); dir.position.set(cx + L.x * D, L.y * D, cz + L.z * D);
      if (sc.right !== E || sc.far !== D * 2) { sc.left = -E; sc.right = E; sc.top = E; sc.bottom = -E; sc.near = 1; sc.far = D * 2; sc.updateProjectionMatrix(); }
      dir.target.updateMatrixWorld(); dir.updateMatrixWorld();
      // карта теней: на компьютере каждый кадр, на ТВ/телефоне — через кадр (тени двигаются медленно, а кадр дешевле)
      this._shF = (this._shF || 0) + 1; if (PERF.quality === 'high' || this._shF % 2 === 0 || this._shMoved) this.renderer.shadowMap.needsUpdate = true;
      // новые динозавры/предметы отбрасывают тень
      if (!this._castT || this.t - this._castT > 1) { this._castT = this.t; this.dyn.traverse(o => { if (o.isMesh && !o.castShadow && !(o.material && (o.material.transparent || o.material.isMeshBasicMaterial))) o.castShadow = true; }); }
    }
    mkShadows() { this.shadow = DP.Things3D.shadows(160); this.scene3.add(this.shadow.mesh); }
    // ——— отображение логических координат (x, y в пикселях мира) в 3D ———
    setupMap() {
      const VW = this.VW, VH = this.VH, W = this.W, H = this.H, bw = this.baseW(), aspect = VW / VH;
      const vfov = U().clamp(2 * Math.atan(Math.tan(26 * D2R) / aspect), 32 * D2R, 62 * D2R), tv = Math.tan(vfov / 2), p0 = 6 * D2R;
      const kX = 4.2 / bw / 0.85, rm = 0.81;
      const A = (r) => p0 + Math.atan((r - 0.5) * 2 * tv);
      const dzMid = kX * VH / (2 * tv), am = A(rm), Rm = dzMid / Math.cos(am - p0), hc = Rm * Math.sin(am);
      const amin = 0.5 * D2R, rh = 0.5 - Math.tan(p0) / (2 * tv);
      const Zg = (y) => -hc / Math.tan(Math.max(amin, A(y / H)));
      const rb = U().clamp(this.bg.zones.ground[0] - 0.02, rh + 0.03, 0.9), Zb = Zg(rb * H);
      const dzAt = (a) => hc / Math.sin(a) * Math.cos(a - p0);
      const ratioG = (y) => dzAt(Math.max(amin * 3, A(y / H))) / dzMid, ratioWall = dzAt(A(rb)) / dzMid;
      const M = this.M = {
        kX, hc, p0, tv, vfov, rb, rh, Zb, dzMid, Wu: W * kX, tanH: tv * aspect, far: hc * 60, waterY: -0.06, A,
        X: (x) => (x - W / 2) * kX, Z: Zg,
        ground: (x, y) => ({ X: (x - W / 2) * kX, Z: Zg(y) }),
        surf: (x, y, o) => { o = o || {}; const r = y / H; o.X = (x - W / 2) * kX; if (r >= rb) { o.Y = 0; o.Z = Zg(y); } else { o.Y = hc - Math.tan(A(r)) * -Zb; o.Z = Zb; } return o; },
        logic: (X, Z) => ({ x: X / kX + W / 2, y: (0.5 + Math.tan(Math.atan(hc / Math.max(0.01, -Z)) - p0) / (2 * tv)) * H }),
        rowOfZ: (Z) => 0.5 + Math.tan(Math.atan(hc / Math.max(0.01, -Z)) - p0) / (2 * tv),
        ratio: (y) => (y / H >= rb ? ratioG(y) : ratioWall), ratioG, ratioWall,
        u: (y) => kX * ratioG(y)
      };
      return M;
    }
    /** Камера 3D из «плоской» камеры (cam.x, cam.y, cam.z): при z=1 видно весь кадр как раньше, при приближении — наклон круче */
    updateCamera3() {
      const M = this.M, c = this.cam, z = c.z, cam = this.camera; if (!M) return;
      const cx = c.x + this.VW / (2 * z), cy = c.y + this.VH / (2 * z), Tp = M.surf(cx, cy, this._tp || (this._tp = {}));
      const RT = Math.hypot(Tp.Y - M.hc, Tp.Z), pz = M.p0 + (z - 1) * 0.13, d = RT / Math.pow(z, 1.3);
      let px = Tp.X;
      if (!this.opts.world) px += (Math.sin(this.t * 0.07) * 0.6 * 0.012 + (this.pointerX || 0) * 0.008) * M.Wu; // лёгкий параллакс
      cam.position.set(px, Tp.Y + Math.sin(pz) * d, Tp.Z + Math.cos(pz) * d);
      cam.rotation.set(-pz, (px - Tp.X) / Math.max(1, d) * 0.5, 0, 'YXZ');
      const fov = M.vfov / D2R, asp = this.VW / this.VH, near = M.hc * 0.02, far = M.far * 1.05;
      if (cam.fov !== fov || cam.aspect !== asp || cam.near !== near || cam.far !== far) { cam.fov = fov; cam.aspect = asp; cam.near = near; cam.far = far; cam.updateProjectionMatrix(); }
      cam.updateMatrixWorld();
      this._target = Tp;
    }
    project(X, Y, Z, out) {
      const v = this._v.set(X, Y, Z).project(this.camera); out = out || {};
      out.x = (v.x + 1) / 2 * this.VW; out.y = (1 - v.y) / 2 * this.VH; out.behind = v.z > 1; return out;
    }
    toScreen(x, y) { if (!this.M || !this.camera) return super.toScreen(x, y); this.updateCamera3(); const s = this.M.surf(x, y); const p = this.project(s.X, s.Y, s.Z); return { x: p.x, y: p.y }; }
    toWorld(sx, sy) {
      if (!this.M || !this.camera) return super.toWorld(sx, sy);
      this.updateCamera3();
      const M = this.M, cam = this.camera, o = cam.position, d = this._ray.set(sx / this.VW * 2 - 1, 1 - sy / this.VH * 2, 0.5).unproject(cam).sub(o).normalize();
      if (d.y < -1e-4) { const t = -o.y / d.y, X = o.x + d.x * t, Z = o.z + d.z * t; if (Z >= M.Zb) return M.logic(X, Z); }
      const t = (M.Zb - o.z) / (Math.abs(d.z) > 1e-6 ? d.z : -1e-6), X = o.x + d.x * t, Y = o.y + d.y * t;
      const a = Math.atan((M.hc - Y) / -M.Zb), r = 0.5 + Math.tan(a - M.p0) / (2 * M.tv);
      return { x: X / M.kX + this.W / 2, y: r * this.H };
    }
    /** «Крупный план»: высоту динозавра для наводки берём из модели (в логических пикселях), а не с экрана — иначе камера раскачивается */
    updateCam(dt) {
      const f = this.follow, e = f && this.M && this.ent(f.uid);
      if (!e || e.state === 'gone') return super.updateCam(dt);
      const r = this.models.get(e.uid), m = r && r.m, sr = e._rect;
      e._rect = { x: 0, y: 0, w: 0, h: m && m._s ? m.hgt * m._s / this.M.u(e.y) : this.baseW() * 0.6 };
      try { super.updateCam(dt); } finally { e._rect = sr; }
    }
    zMax() { return this.opts.world ? Math.max(4, (this.opts.world.zMax || 2.6)) : 2.6; } // в 3D можно подойти ближе
    closeUp(uid, z) { return super.closeUp(uid, z || 3.4); }
    zoomBy(f, sx, sy) { if (sx == null) { sx = this.VW / 2; sy = this.VH * 0.8; } super.zoomBy(f, sx, sy); }
    // ——— фон/мир ———
    _renderStatic() {
      this._rendered = this.bg.id + (this._customUrl || '');
      this.layerCanvases = null;
      if (!this.init3d()) return;
      if (this.staticCanvas) this.staticCanvas.width = this.staticCanvas.height = 0;
      this.setupMap();
      this.renderer.setPixelRatio(this.dpr); this.renderer.setSize(this.VW, this.VH, false);
      this.sizeOverlay();
      this.reflections = [];
      (this.bg.layers || []).forEach((L, i) => (L.pools || []).forEach(p => this.reflections.push({ layer: i, p, top: this.H * p.top, path: DP.BG.poolPath(p, this.W, this.H) })));
      if (this.bg.id === 'custom') { const wz = this.bg.zones.water; if (wz) { const W = this.W, H = this.H, p = { ellipse: true, cx: (wz.x0 + wz.x1) / 2, cy: (wz.y0 + wz.y1) / 2, rx: (wz.x1 - wz.x0) / 2, ry: (wz.y1 - wz.y0) / 2 }; const path = new Path2D(); path.ellipse(p.cx * W, p.cy * H, p.rx * W, p.ry * H, 0, 0, TAU); this.reflections.push({ layer: 0, p, top: wz.y0 * H, path, custom: true }); } }
      if (this.world) this.world.dispose();
      const refl = this.reflections; if (this.bg.id === 'custom') this.reflections = []; // свой фон: воду не рисуем (она на фото)
      this.world = DP.Nature3D.build(this); this.reflections = refl;
      this.scene3.add(this.world.root); this.scene3.fog = this.world.fog; this.setupSun();
      this.renderer.setClearColor(this.world.bg || this.world.fog.color, 1);
      this._propsKey = null;
    }
    buildProps() { if (super.buildProps) super.buildProps(); if (this.renderer) this.buildPropMeshes(); }
    buildPropMeshes() {
      (this.propM || []).forEach(r => this.disposeObj(r.root)); this.propM = [];
      (this.props || []).forEach(p => {
        p._jungle = this.bg.id === 'jungle';
        const r = DP.Things3D.prop(p); r.p = p; r.paint = !!p.paint; r.root.rotation.y = (p.seed % 1) * 0.6 - 0.3; this.dyn.add(r.root); this.propM.push(r);
      });
    }
    sizeOverlay() { if (!this.ov) return; const w = Math.round(this.VW * this.dpr), h = Math.round(this.VH * this.dpr); if (this.ov.width !== w || this.ov.height !== h) { this.ov.width = w; this.ov.height = h; } }
    resize(force) {
      super.resize(force);
      if (this.renderer && this.c.width && (this.renderer.getPixelRatio() !== this.dpr)) { this.renderer.setPixelRatio(this.dpr); this.renderer.setSize(this.VW, this.VH, false); this.sizeOverlay(); }
    }
    loadArt(e) { e.rig = null; e.ready = false; e.aspect = e.aspect || 0.65; } // модели строит Dino3D
    // ——— освобождение памяти ———
    disposeObj(o) {
      if (!o) return; o.removeFromParent();
      o.traverse(n => { if (n.geometry && !n.isSprite && !(n.geometry.userData && n.geometry.userData.cached) && !n.isInstancedMesh) n.geometry.dispose(); if (n.isMesh && n.material && n.material.userData && n.material.userData.own) n.material.dispose(); });
    }
    dropModel(uid) { const r = this.models.get(uid); if (!r) return; if (r.m) r.m.dispose(); if (r.nest) this.disposeObj(r.nest); if (r.glow) r.glow.removeFromParent(); this.models.delete(uid); const e = this.ent(uid); if (e) e.ready = false; }
    clear3d() {
      if (!this.renderer) return;
      [...this.models.keys()].forEach(uid => this.dropModel(uid));
      this.ents.forEach(e => { e.ready = false; e._rect = null; e._srect = null; });
      this.critM.forEach(r => this.disposeObj(r.root)); this.critM.clear();
      this.nestM.forEach(r => this.disposeObj(r.root)); this.nestM.clear();
      (this.propM || []).forEach(r => this.disposeObj(r.root)); this.propM = [];
      this.food.forEach(f => { if (f._m3) { this.disposeObj(f._m3); f._m3 = null; } }); this.foodSet.clear();
      this.balls.forEach(b => { if (b._m3) { this.disposeObj(b._m3); b._m3 = null; } }); this.ballSet.clear();
      if (this.campM) { this.disposeObj(this.campM.root); this.campM = null; }
      if (this.world) { this.world.dispose(); this.world = null; }
      this.shadow.dispose(); this.shadow.mesh.removeFromParent();
      DP.Things3D.purge(); DP.Dino3D.purge(); DP.G3.freeTextures(); this.freePost();
      this.mkShadows();
      this.renderer.renderLists.dispose();
    }
    release() {
      this.clear3d();
      super.release();
      if (this.ov) this.ov.width = this.ov.height = 0;
    }
    rebuildAll() { this.clear3d(); this._renderStatic(); this.buildProps(); }
    destroy() {
      super.destroy();
      if (this._mo) this._mo.disconnect();
      if (this.ov) this.ov.remove();
      if (this.c) { this.c.removeEventListener('webglcontextlost', this._onLost); this.c.removeEventListener('webglcontextrestored', this._onRestored); }
      this.freePost(); if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
    }
    // ——— кадр ———
    draw() {
      if (!this.renderer || this._lost || !this.world || !this.M) return;
      const dt = Math.min(0.05, Math.max(0, this.t - (this._lt == null ? this.t : this._lt))); this._lt = this.t;
      this.updateCamera3();
      const tn = this.bg.id === 'custom' ? null : this.tint(), night = !!(tn && tn.night);
      this.world.setTod(tn);
      this.shadow.begin();
      this.drawEnts3(dt);
      this.drawThings3(dt, night);
      this.shadow.end();
      const tp = this._target; this._tgt = this._tgt || new (T().Vector3)(); this._tgt.set(tp.X, tp.Y, tp.Z);
      this.world.update(this.t, dt, { position: this.camera.position, target: this._tgt });
      this.fitSun();
      this.render3();
      this.measure3();
      this.drawOverlay3();
      this.adaptRes();
    }
    modelKey(e) { const d = e.d || {}; return e.species + '|' + (d.palette || 0) + '|' + (d.sprite ? d.sprite.length + d.sprite.slice(-24) : '') + '|' + (d.legend ? 'L' : ''); }
    drawEnts3(dt) {
      const M = this.M, seen = new Set(), THREE = T();
      for (const e of this.ents) {
        seen.add(e.uid);
        const key = this.modelKey(e);
        let rec = this.models.get(e.uid);
        if (rec && rec.key !== key) { this.dropModel(e.uid); rec = null; }
        if (!rec) {
          rec = { key, m: null }; this.models.set(e.uid, rec); const tok = rec;
          DP.Dino3D.build(e, this).then(m => {
            if (!m) return; if (this.models.get(e.uid) !== tok || this._dead || !this.renderer) { m.dispose(); return; }
            tok.m = m; this.dyn.add(m.root); e.aspect = m.hgt / Math.max(0.1, m.len); e.ready = true;
          }).catch(err => { tok.fail = true; if (window.console) console.warn('Dino3D', err && err.message); });
        }
        const m = rec.m; if (!m) continue;
        const vis = e.state !== 'hidden' && e.state !== 'gone';
        m.root.visible = vis; if (rec.glow) rec.glow.visible = vis; if (rec.nest) rec.nest.visible = false;
        if (!vis) continue;
        DP.Dino3D.pose(m, e, this, dt);
        DP.Dino3D.setHat(m, e.d && e.d.hat && !e.hatHide ? e.d.hat : null);
        const hab = e.habitat, depth = this.depth(e);
        let X, Y, Z, ratio;
        if (hab === 'sky') { const s = M.surf(e.x, e.y); X = s.X; Y = s.Y; Z = s.Z; ratio = M.ratio(e.y); }
        else { X = M.X(e.x); Z = M.Z(e.y); Y = 0; ratio = M.ratioG(e.y); }
        const comp = U().clamp(depth / 0.85 * ratio, 0.6, 3.5), grow = m.root.userData.grow || 1;
        let s = e.size * comp * grow;
        if (e.fade != null && e.fade < 1) s *= 0.55 + 0.45 * Math.max(0, e.fade);
        if (hab === 'sky') Y -= m.hgt * s * 0.5;
        else if (hab === 'water') Y = M.waterY - m.hgt * s * (0.32 + (e.fade != null && e.fade < 1 ? (1 - Math.max(0, e.fade)) * 0.6 : 0));
        // поворот: лицом вправо/влево, разворот через камеру; немного по ходу вглубь сцены
        const vX = (e.vx || 0) * M.kX, vZ = (e.vy || 0) * (M.Z(e.y + 1) - M.Z(e.y));
        const ad = Math.hypot(vX, vZ) > 0.05 ? U().clamp(Math.atan2(vZ, Math.abs(vX)), -0.8, 0.8) : 0;
        e._ad = (e._ad || 0) + (ad - (e._ad || 0)) * Math.min(1, dt * 4);
        const flip = e.flip == null ? (e.facing || 1) : e.flip;
        let yaw = -(1 - flip) / 2 * Math.PI - e._ad * flip;
        if (m.spin) yaw += m.spin * (e.facing || 1);
        m.root.position.set(X, Y, Z); m.root.rotation.set(0, yaw, 0); m.root.scale.setScalar(s);
        m._s = s;
        if (hab === 'ground') {
          const ja = e.jump ? 1 - Math.sin(Math.PI * e.jump / 0.75) * 0.5 : 1;
          this.shadow.add(X, 0, Z, m.len * s * 0.5, Math.max(m.halfZ * s * 2.2, m.len * s * 0.2), ja);
          if (e.nest > 0.01) {
            if (!rec.nest) { rec.nest = DP.Things3D.nest(); this.dyn.add(rec.nest); }
            rec.nest.visible = true; rec.nest.position.set(X, 0, Z); const ns = m.len * s * 0.5 * e.nest; rec.nest.scale.set(ns, ns * 0.8, ns * 0.7);
          }
        } else if (hab === 'water') this.shadow.add(X, M.waterY + 0.04, Z, m.len * s * 0.55, m.len * s * 0.22, 0.8);
        if (e.d && e.d.legend) {
          if (!rec.glow) { rec.glow = DP.Things3D.glow('#ffd84a', 1); this.dyn.add(rec.glow); }
          rec.glow.position.set(X, Y + m.hgt * s * 0.5, Z + 0.1); rec.glow.scale.setScalar(m.len * s * (1.5 + 0.12 * Math.sin(this.t * 2.4 + e.seed)));
        }
        void THREE;
      }
      for (const uid of [...this.models.keys()]) if (!seen.has(uid)) this.dropModel(uid);
    }
    drawThings3(dt, night) {
      const M = this.M, TH = DP.Things3D, bw = this.baseW(), t = this.t, u2 = Math.min(this.VW || this.W, this.H) / 100;
      // зверьки и австралопитеки
      const seen = new Set();
      (this.critters || []).forEach(c => {
        seen.add(c.id);
        const key = c.kind + (c.kind === 'ape' ? ((c.src && c.src.sk) || []).join(',') : (c.def && c.def.kind));
        let r = this.critM.get(c.id);
        if (r && r.key !== key) { this.disposeObj(r.root); r = null; }
        if (!r) { r = c.kind === 'ape' ? TH.ape(c) : TH.mammal(c); r.key = key; this.critM.set(c.id, r); this.dyn.add(r.root); }
        let s = this.critterSize(c) * M.u(c.y), X = M.X(c.x), Y = 0, Z = M.Z(c.y), yaw = (c.facing || 1) > 0 ? 0 : -Math.PI;
        if (c.ride) { const er = this.models.get(c.ride), e = this.ent(c.ride); if (er && er.m && e && er.m.root.visible) { const m = er.m; m.root.updateMatrixWorld(true); const v = this._v2.set(m.saddle.x, m.saddle.y, 0).applyMatrix4(m.body.matrixWorld); X = v.x; Y = v.y; Z = v.z + 0.01; yaw = m.root.rotation.y; s = Math.max(s, m.hgt * m._s * 0.42); } }
        c._yaw = c._yaw == null ? yaw : c._yaw + (yaw - c._yaw) * Math.min(1, dt * 8);
        r.root.position.set(X, Y, Z); r.root.rotation.y = c._yaw; r.root.scale.setScalar(s); r._s = s; r.root.visible = true;
        TH.poseCritter(r, c, t);
        if (r.kind === 'ape') { TH.setApeHat(r, c.task && c.task.type === 'hat' ? c.task.data : null); if (r.flame) { const on = night; r.flame.visible = on; r.flame.userData.glow.visible = on; } }
        if (!c.ride) this.shadow.add(X, 0, Z, s * 0.45, s * 0.3);
      });
      for (const [id, r] of [...this.critM]) if (!seen.has(id)) { this.disposeObj(r.root); this.critM.delete(id); }
      // яйца и подарки
      const ns = new Set();
      Object.keys(this.nestPos || {}).forEach(id => {
        const n = this.nestPos[id]; if (!n.item) return; ns.add(id);
        const key = n.item.k + (n.item.r || '');
        let r = this.nestM.get(id); if (r && r.key !== key) { this.disposeObj(r.root); r = null; }
        if (!r) { r = n.item.k === 'egg' ? TH.egg(n.item) : TH.gift(); r.key = key; this.nestM.set(id, r); this.dyn.add(r.root); }
        const pop = Math.min(1, (t - n.born) * 2.5), sp = Math.max(9, bw * 0.13) * pop, s = sp * M.u(n.y), X = M.X(n.x), Z = M.Z(n.y);
        n.r = sp * 1.6;
        r.root.position.set(X, 0, Z); r.root.scale.setScalar(Math.max(0.001, s));
        if (r.kind === 'egg') { r.root.rotation.z = Math.sin(t * 3 + n.x) * 0.08 + (Math.sin(t * 0.7 + n.x) > 0.93 ? Math.sin(t * 30) * 0.12 : 0); if (n.item.r !== 'common' && Math.random() < 0.06) { const R = (DP.Life.R[n.item.r] || {}); this.parts.push({ kind: 'spark', c: R.color, x: n.x + U().rand(-sp, sp), y: n.y - U().rand(0, sp * 1.8), vx: 0, vy: -14, t: 0, life: 0.8, s: U().rand(0.5, 1) }); } }
        else { r.body.position.y = Math.abs(Math.sin(t * 3)) * 0.25; r.root.rotation.y = Math.sin(t * 0.8) * 0.3; if (Math.random() < 0.05) this.sparkle(n.x, n.y - sp * 1.5); }
        this.shadow.add(X, 0, Z, s * 0.95, s * 0.75);
      });
      for (const [id, r] of [...this.nestM]) if (!ns.has(id)) { this.disposeObj(r.root); this.nestM.delete(id); }
      // корм
      const fs = new Set();
      this.food.forEach(f => {
        fs.add(f);
        if (!f._m3) { f._m3 = TH.food(f.type); this.dyn.add(f._m3); this.foodSet.add(f); }
        const s = u2 * 3.2 * Math.max(0.3, Math.min(1, f.amount + 0.2)), uu = M.u(f.y), X = M.X(f.x), Z = M.Z(f.y);
        let Y = f.zone === 'water' ? M.waterY + Math.sin(t * 2 + f.rot) * 0.05 : 0;
        if (!f.landed) Y += Math.max(0, f.y - f.fy) * uu;
        const m = f._m3; m.position.set(X, Y, Z); m.scale.setScalar(s * uu * 0.75);
        m.rotation.set(f.landed ? 0 : Math.sin(t * 6 + f.rot) * 0.4, f.rot, 0);
        if (f.landed && f.zone !== 'water') this.shadow.add(X, 0, Z, s * uu * 0.9, s * uu * 0.5);
      });
      this.foodSet.forEach(f => { if (!fs.has(f)) { this.disposeObj(f._m3); f._m3 = null; this.foodSet.delete(f); } });
      // мячи
      const bs = new Set(), br = Math.max(7, bw * 0.065);
      this.balls.forEach(b => {
        bs.add(b);
        if (!b._m3) { b._m3 = TH.ball(); this.dyn.add(b._m3); this.ballSet.add(b); }
        const uu = M.u(b.y), r = br * uu * Math.max(0.05, Math.min(1, (9 - b.t) * 2)), X = M.X(b.x), Z = M.Z(b.y);
        b._m3.position.set(X, r + (b.z || 0) * uu, Z); b._m3.rotation.set(0, 0, -(b.rot || 0)); b._m3.scale.setScalar(r);
        this.shadow.add(X, 0, Z, r * (1 - Math.min(0.5, (b.z || 0) / 400)), r * 0.8);
      });
      this.ballSet.forEach(b => { if (!bs.has(b)) { this.disposeObj(b._m3); b._m3 = null; this.ballSet.delete(b); } });
      // кусты и камни (прятки)
      this.propM.forEach(r => {
        const p = r.p;
        if (!!p.paint !== r.paint && p.kind === 'rock') { this.disposeObj(r.root); const nr = DP.Things3D.prop(p); nr.p = p; nr.paint = !!p.paint; nr.root.rotation.y = r.root.rotation.y; Object.assign(r, nr); this.dyn.add(r.root); }
        const uu = M.u(p.y), X = M.X(p.x), Z = M.Z(p.y), s = p.r * uu;
        r.root.position.set(X, 0, Z); r.root.scale.setScalar(s); r._s = s;
        const busy = p.busy && p.busy.state === 'hidden';
        r.body.rotation.z = busy && (t * 0.7 + p.seed) % 3 < 0.5 ? Math.sin(t * 28) * 0.08 : Math.sin(t * 0.9 + p.seed) * 0.012;
        if (p.kind !== 'flowers' && p.kind !== 'shells') this.shadow.add(X, 0, Z, s * 1.1, s * 0.8);
      });
      // стоянка племени: костёр, шалаш
      const cp = this.camp, sk = this.skills || {};
      if (cp && this.life && this.life.tribe && this.life.tribe.length) {
        const key = (sk.fire ? 'f' : '') + (sk.hut ? 'h' : '') + (night ? 'n' : '');
        if (!this.campM || this.campM.key !== key) { if (this.campM) this.disposeObj(this.campM.root); this.campM = TH.camp(sk, night); this.campM.key = key; this.dyn.add(this.campM.root); }
        const s = bw * 0.5 * M.u(cp.y), X = M.X(cp.x), Z = M.Z(cp.y);
        this.campM.root.position.set(X, 0, Z); this.campM.root.scale.setScalar(s);
        TH.poseCamp(this.campM, t, night);
        this.fireLight.position.set(X, s * 0.6, Z);
        this.fireLight.intensity = sk.fire ? (night ? 3 : 1) * s * s * (0.85 + Math.sin(t * 7) * 0.1) * 4 : 0;
        if (sk.fire) { this.shadow.add(X, 0, Z, s * 0.7, s * 0.5); if (Math.random() < 0.15) this.parts.push({ kind: 'spark', c: '#ffb347', x: cp.x + U().rand(-bw * 0.1, bw * 0.1), y: cp.y - bw * 0.3, vx: U().rand(-10, 10), vy: -40, t: 0, life: 0.9, s: 0.4 }); }
      } else { if (this.campM) { this.disposeObj(this.campM.root); this.campM = null; } this.fireLight.intensity = 0; }
    }
    /** Экранные прямоугольники моделей (для касаний, подписей и камеры «крупный план») */
    measure3() {
      const z = this.cam.z, cx = this.cam.x, cy = this.cam.y, v = this._v, P = this._pp || (this._pp = {});
      const rectOf = (obj, x0, x1, y0, y1, z0, z1) => {
        obj.updateMatrixWorld(true); const mw = obj.matrixWorld;
        let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity, bad = false;
        for (let i = 0; i < 8; i++) {
          v.set(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0).applyMatrix4(mw).project(this.camera);
          if (v.z > 1) bad = true;
          const sx = (v.x + 1) / 2 * this.VW, sy = (1 - v.y) / 2 * this.VH;
          a = Math.min(a, sx); c = Math.max(c, sx); b = Math.min(b, sy); d = Math.max(d, sy);
        }
        if (bad) return null;
        if (c - a < 28) { const m = (a + c) / 2; a = m - 14; c = m + 14; }
        if (d - b < 28) { const m = (b + d) / 2; b = m - 14; d = m + 14; }
        return { x0: a, y0: b, x1: c, y1: d };
      };
      for (const e of this.ents) {
        const rec = this.models.get(e.uid), m = rec && rec.m;
        if (!m || !m.root.visible) { e._rect = null; e._srect = null; e._top = null; continue; }
        const r = rectOf(m.body, m.cx - m.len / 2, m.cx + m.len / 2, Math.max(0, m.bottom), m.hgt, -m.halfZ, m.halfZ);
        e._srect = r; if (!r) { e._rect = null; e._top = null; continue; }
        e._rect = { x: cx + r.x0 / z, y: cy + r.y0 / z, w: (r.x1 - r.x0) / z, h: (r.y1 - r.y0) / z };
        const lie = e.lie || 0;
        e._top = cy + (r.y0 + (r.y1 - r.y0) * 0.12 * lie) / z;
        if (e.habitat === 'ground') { this.project(m.root.position.x, m.root.position.y, m.root.position.z, P); e._anchor = cy + P.y / z; }
        else e._anchor = cy + r.y1 / z;
        e._w = (r.x1 - r.x0) / z; e._lx = cx + (r.x0 + r.x1) / 2 / z;
      }
      (this.critters || []).forEach(c => {
        const r = this.critM.get(c.id); if (!r) { c._s = null; return; }
        const H = r.h, rr = rectOf(r.root, -0.4, 0.6, 0, H, -0.25, 0.25); c._srect = rr;
        if (!rr) { c._s = null; return; }
        this.project(r.root.position.x, r.root.position.y, r.root.position.z, P);
        c._bx = cx + P.x / z; c._by = cy + P.y / z; c._s = Math.max(4, (P.y - rr.y0) / z / (c.kind === 'ape' ? 1.45 : 0.6) * (c.kind === 'ape' ? 1 : 0.6));
      });
      Object.keys(this.nestPos || {}).forEach(id => { const n = this.nestPos[id], r = this.nestM.get(id); n._srect = r ? rectOf(r.root, -0.8, 0.8, 0, r.h, -0.8, 0.8) : null; });
      this.propM.forEach(r => { r.p._srect = rectOf(r.root, -1.1, 1.1, 0, r.p.kind === 'rock' || r.p.kind === 'ice' ? 0.8 : 1.15, -0.8, 0.8); });
    }
    // ——— касания: всё сверяем в экранных координатах ———
    _in(r, s, pad) { pad = pad || 0; return r && s.x >= r.x0 - pad && s.x <= r.x1 + pad && s.y >= r.y0 - pad && s.y <= r.y1 + pad; }
    hit(x, y) {
      if (!this.renderer) return super.hit(x, y);
      const s = this.toScreen(x, y), cp = this.camera.position;
      const list = this.ents.filter(e => e._srect && e.state !== 'hidden' && this._in(e._srect, s)).map(e => { const m = this.models.get(e.uid).m; return { e, d: m.root.position.distanceToSquared(cp) }; }).sort((a, b) => a.d - b.d);
      return list.length ? list[0].e : null;
    }
    hitScreen(sx, sy) { const p = this.toWorld(sx, sy); return this.hit(p.x, p.y); }
    hitExtra(x, y) {
      if (!this.renderer) return super.hitExtra ? super.hitExtra(x, y) : null;
      const s = this.toScreen(x, y);
      for (const id of Object.keys(this.nestPos || {})) { const n = this.nestPos[id]; if (n.item && this._in(n._srect, s, 8)) return { kind: 'nest', item: n.item, pos: n }; }
      for (const c of this.critters || []) if (this._in(c._srect, s, 4)) return { kind: 'critter', c };
      return null;
    }
    hitHidden(x, y) {
      if (!this.renderer) return super.hitHidden(x, y);
      const s = this.toScreen(x, y);
      for (const p of this.props) {
        if (!p.busy) continue; const e = p.busy;
        if (this._in(p._srect, s, 10)) return e;
        if (e.state === 'hide' && this._in(e._srect, s)) return e;
      }
      return null;
    }
    // ——— поверх 3D: подписи, индикаторы, пузыри, сердечки, искры, «Zzz», 👀 ———
    anchorFor(p) {
      let best = null, bd = Infinity; const M = this.M;
      const test = (x, y, X, Y, Z) => { const d = Math.abs(p.x - x) + Math.abs(p.y - y) * 0.6; if (d < bd) { bd = d; best = { bx: x, by: y, X, Y, Z }; } };
      this.ents.forEach(e => { const r = this.models.get(e.uid); if (r && r.m && r.m.root.visible) { const q = r.m.root.position; test(e.x, e.habitat === 'ground' ? e.y : e.y + (e._rect ? e._rect.h / 2 : 0), q.x, q.y, q.z); } });
      Object.keys(this.nestPos || {}).forEach(id => { const n = this.nestPos[id]; test(n.x, n.y, M.X(n.x), 0, M.Z(n.y)); });
      (this.critters || []).forEach(c => { const r = this.critM.get(c.id); if (r) { const q = r.root.position; test(c.x, c.y, q.x, q.y, q.z); } });
      (this.props || []).forEach(q => test(q.x, q.y, M.X(q.x), 0, M.Z(q.y)));
      if (this.camp) test(this.camp.x, this.camp.y, M.X(this.camp.x), 0, M.Z(this.camp.y));
      if (!best || bd > this.baseW() * 3) { const s = M.surf(p.x, p.y); best = { bx: p.x, by: p.y, X: s.X, Y: s.Y, Z: s.Z }; }
      best.s = M.u(best.by) * (best.Y > 0.5 && best.Z === M.Zb ? M.ratioWall / M.ratioG(best.by) : 1);
      return best;
    }
    partLE(p, P) {
      const a = p._a || (p._a = this.anchorFor(p));
      this.project(a.X + (p.x - a.bx) * a.s, a.Y + (a.by - p.y) * a.s, a.Z, P);
      P.x = this.cam.x + P.x / this.cam.z; P.y = this.cam.y + P.y / this.cam.z; return P;
    }
    drawOverlay3() {
      const ctx = this.octx; if (!ctx || !this.ov.width) return;
      const z = this.cam.z, sc = this.dpr * z, u = Math.min(this.VW || this.W, this.H) / 100, t = this.t, P = {};
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.ov.width, this.ov.height);
      ctx.setTransform(sc, 0, 0, sc, -this.cam.x * sc, -this.cam.y * sc);
      // подглядывает из-за куста
      this.propM.forEach(r => {
        const p = r.p; if (!(p.busy && p.busy.state === 'hidden') || ((t * 0.5 + p.seed) % 4) >= 1.4) return;
        this.project(r.root.position.x + Math.sin(p.seed) * r._s * 0.3, r._s * 1.35, r.root.position.z, P); if (P.behind) return;
        const fs = Math.max(14, (p.r * 0.55)); ctx.font = `${Math.round(fs)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('👀', this.cam.x + P.x / z, this.cam.y + P.y / z);
      });
      this.parts.forEach(p => {
        const a = 1 - p.t / p.life; this.partLE(p, P); if (P.behind) return;
        if (p.kind === 'heart') this.drawHeart(ctx, P.x + Math.sin(p.t * 6) * 4, P.y, p.s * (u / 6 + 0.6), a);
        else if (p.kind === 'spark') this.drawSpark(ctx, P.x, P.y, u * 0.9 * p.s, a, p.c);
        else if (p.kind === 'leaf') { ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = p.c || '#4f8a3a'; ctx.translate(P.x, P.y); ctx.rotate(p.t * 5 + p.s * 3); ctx.beginPath(); ctx.ellipse(0, 0, u * 0.9 * p.s, u * 0.4 * p.s, 0, 0, TAU); ctx.fill(); ctx.restore(); }
        else if (p.kind === 'z') { const al = Math.min(1, p.t * 3) * a; ctx.save(); ctx.globalAlpha = al; ctx.font = `900 ${Math.round(u * 2.4 * p.s * (0.7 + p.t * 0.3))}px Nunito, sans-serif`; ctx.fillStyle = '#e7ecff'; ctx.strokeStyle = 'rgba(30,40,90,.7)'; ctx.lineWidth = 3; ctx.textAlign = 'center'; ctx.strokeText('Z', P.x + Math.sin(p.t * 3) * 6, P.y); ctx.fillText('Z', P.x + Math.sin(p.t * 3) * 6, P.y); ctx.restore(); }
        else { ctx.fillStyle = `rgba(255,255,255,${a * 0.7})`; ctx.beginPath(); ctx.arc(P.x, P.y, u * 0.6 * p.s, 0, TAU); ctx.fill(); }
      });
      const order = { water: 0, ground: 1, sky: 2 };
      this.ents.slice().sort((a, b) => (order[a.habitat] - order[b.habitat]) || (a.y - b.y)).forEach(e => {
        if (e._top == null || e._lx == null) return; const ox = e.x; e.x = e._lx;
        try { this.drawOverlay(ctx, e); } finally { e.x = ox; }
      });
      if (this.drawOverlayExtras) this.drawOverlayExtras(ctx, this.view());
    }
    // ——— для проверок: память видеокарты и «не пустой ли кадр» ———
    gpuStats() {
      if (!this.renderer) return null;
      const info = this.renderer.info, geos = new Set(); let geoBytes = 0, texBytes = 0; const texs = new Set();
      this.scene3.traverse(o => {
        if (o.geometry && !geos.has(o.geometry)) { geos.add(o.geometry); Object.values(o.geometry.attributes).forEach(a => geoBytes += a.array.byteLength); if (o.geometry.index) geoBytes += o.geometry.index.array.byteLength; }
        if (o.isInstancedMesh) { geoBytes += o.instanceMatrix.array.byteLength; if (o.instanceColor) geoBytes += o.instanceColor.array.byteLength; }
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        ms.forEach(m => ['map', 'normalMap', 'emissiveMap'].forEach(k => { const tx = m[k]; if (tx && !texs.has(tx)) { texs.add(tx); const im = tx.image; const w = (im && (im.width || im.naturalWidth)) || (tx.userData.w || 0), h = (im && (im.height || im.naturalHeight)) || (tx.userData.h || 0); texBytes += (w || 512) * (h || 512) * 4 * (tx.generateMipmaps !== false ? 1.33 : 1); } }));
      });
      const d3 = DP.Dino3D.stats(); texBytes = Math.max(texBytes, 0) + 0; // атласы динозавров уже учтены через материалы
      // буферы: экран (2 цветовых для композитора + глубина) | MSAA ×4 (цвет+глубина) | FXAA: экран без глубины + промежуточный цвет+глубина
      const aa = this._aa, px = this.c.width * this.c.height, buf = px * (aa === 'fxaa' ? 4 * 2 + 8 : aa === 'msaa' ? 4 * 2 + 4 + 32 : 4 * 2 + 4);
      const ovB = this.ov ? this.ov.width * this.ov.height * 4 : 0;
      const shB = this._sh ? this._sh * this._sh * 8 : 0;
      const total = geoBytes + texBytes + buf + ovB + shB;
      return { textures: info.memory.textures, geometries: info.memory.geometries, calls: info.render.calls, triangles: info.render.triangles, texMB: +(texBytes / 1048576).toFixed(2), geoMB: +(geoBytes / 1048576).toFixed(2), bufferMB: +(buf / 1048576).toFixed(2), shadowMB: +(shB / 1048576).toFixed(2), shadow: this._sh || 0, overlayMB: +(ovB / 1048576).toFixed(2), totalMB: +(total / 1048576).toFixed(2), dino: d3, dpr: this.dpr, size: [this.c.width, this.c.height], aa: this._aa, rs: this._rs || 1, toneMapping: this.renderer.toneMapping, fps: this.fpsNow || 0 };
    }
    samplePixels(n) {
      if (!this.renderer || !this.world) return null;
      this.updateCamera3(); this.render3();
      const gl = this.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4), seen = new Set(); let nonBlack = 0; n = n || 8;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { gl.readPixels(Math.floor((i + 0.5) / n * w), Math.floor((j + 0.5) / n * h), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (px[0] + px[1] + px[2] > 24) nonBlack++; seen.add((px[0] >> 4) + ',' + (px[1] >> 4) + ',' + (px[2] >> 4)); }
      return { samples: n * n, nonBlack, distinct: seen.size, w, h };
    }
  }
  DP.Scene3D = Scene3D;

  /** Можно ли рисовать в 3D: есть three.js, работает WebGL, не попросили 2D (?r=2d) */
  function can3D() {
    try {
      if (!window.THREE) return false;
      if (/[?&]r=2d\b/.test(location.search)) return false;
      if (PERF.render2d) return false;
      const c = document.createElement('canvas'), gl = c.getContext('webgl2'); // three.js r163+ работает только с WebGL2 (старые ТВ — 2D)
      if (!gl) return false;
      const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      return true;
    } catch (e) { return false; }
  }
  DP.can3D = can3D;
  DP.makeScene = function (canvas, opts) {
    if (can3D()) {
      const s = new Scene3D(canvas, opts);
      if (!s._failed && s.renderer) return s;
      s.destroy();
    }
    let c2 = null; try { c2 = canvas.getContext && canvas.getContext('2d'); } catch (e) { /* нет */ }
    if (!c2) return stubScene(canvas, new Error('нет 2D canvas'));
    try { return new Base(canvas, opts); } catch (e) { return stubScene(canvas, e); }
  };
  // совсем без графики (нет даже 2D canvas) — пустая сцена с теми же методами: остальная страница работает, видна подсказка
  function stubScene(canvas, err) {
    if (window.DPBOOT) window.DPBOOT.log(err, 'нет 2D-графики');
    const s = { is3d: false, stub: true, ents: [], food: [], balls: [], frames: 0, opts: {}, c: canvas };
    Object.getOwnPropertyNames(Base.prototype).forEach((k) => { if (k !== 'constructor') s[k] = function () { return null; }; });
    const n = document.createElement('div'); n.className = 'glass'; n.textContent = '🦖 Этот браузер не умеет рисовать графику — парк работает, но без картинки. Попробуйте другой браузер.';
    n.setAttribute('style', 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);padding:12px 18px;z-index:4;max-width:90%;text-align:center');
    (document.body || document.documentElement).appendChild(n);
    return s;
  }
})();
