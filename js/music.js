/* Динопарк — фоновая музыка и звуки джунглей.
 * Трек: «Treasure Hunter» (TAD, CC0) — assets/audio/treasure-hunter.mp3, бесшовный цикл через Web Audio.
 * Поверх — тихие процедурные птицы (Web Audio). Автовоспроизведение запрещено браузерами,
 * поэтому музыка стартует при первом касании/клике/клавише, если не выключена кнопкой 🔊/🔇.
 * Настройка хранится в localStorage (dp_music: '1' | '0').
 */
window.DP = window.DP || {};
(function () {
  const KEY = 'dp_music', SRC = 'assets/audio/treasure-hunter.mp3', VOL = 0.38, BIRDS = 0.05;
  const st = { on: true, started: false, playing: false, mode: null, error: null };
  try { st.on = localStorage.getItem(KEY) !== '0'; } catch (e) { /* приватный режим */ }
  let ctx = null, master = null, musicGain = null, src = null, buffer = null, audioEl = null, birdTimer = null, fadeTimer = null, btn = null, loading = null;
  const listeners = [];

  function save() { try { localStorage.setItem(KEY, st.on ? '1' : '0'); } catch (e) { /* ignore */ } }
  function emit() { if (btn) { btn.textContent = st.on ? '🔊' : '🔇'; btn.title = st.on ? 'Выключить музыку' : 'Включить музыку'; btn.setAttribute('aria-pressed', st.on ? 'true' : 'false'); btn.classList.toggle('off', !st.on); } listeners.forEach(f => { try { f(st.on); } catch (e) { /* ignore */ } }); }

  function makeCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = VOL; musicGain.connect(master);
    return ctx;
  }
  async function loadBuffer() {
    const r = await fetch(SRC); if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.arrayBuffer();
    return await new Promise((res, rej) => { const p = ctx.decodeAudioData(data, res, rej); if (p && p.then) p.then(res, rej); });
  }
  function firstSound(buf) { // начало без тишины — для бесшовного цикла
    const ch = buf.getChannelData(0); for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]) > 0.003) return i / buf.sampleRate; return 0;
  }
  function fadeTo(v, sec) {
    if (ctx && master) { const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(v, t + sec); }
    if (audioEl) {
      clearInterval(fadeTimer); const from = audioEl.volume, to = v * VOL, t0 = performance.now();
      fadeTimer = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / (sec * 1000)); audioEl.volume = Math.max(0, Math.min(1, from + (to - from) * k)); if (k >= 1) { clearInterval(fadeTimer); if (to === 0) audioEl.pause(); } }, 50);
    }
  }

  // --- птицы джунглей (процедурно): короткие трели синусом с частотной модуляцией ---
  function chirp() {
    if (!ctx || !st.playing || document.hidden) return;
    const t = ctx.currentTime + 0.05, n = 2 + Math.floor(Math.random() * 4), base = 2200 + Math.random() * 1800;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const g = ctx.createGain(); g.gain.value = 0;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; g.connect(pan); pan.connect(master); } else g.connect(master);
    const o = ctx.createOscillator(); o.type = 'sine'; o.connect(g);
    for (let i = 0; i < n; i++) {
      const s = t + i * (0.11 + Math.random() * 0.05), f = base * (1 + Math.random() * 0.25);
      o.frequency.setValueAtTime(f, s); o.frequency.exponentialRampToValueAtTime(f * (1.25 + Math.random() * 0.4), s + 0.06);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(BIRDS * (0.6 + Math.random() * 0.4), s + 0.015); g.gain.exponentialRampToValueAtTime(0.0005, s + 0.09);
    }
    o.start(t); o.stop(t + n * 0.17 + 0.2);
  }
  function birdsLoop() { clearTimeout(birdTimer); if (!st.playing) return; chirp(); birdTimer = setTimeout(birdsLoop, 4000 + Math.random() * 8000); }

  async function start() {
    if (!st.on || st.playing) return;
    if (loading) return loading;
    loading = (async () => {
      try {
        if (!ctx && !audioEl) makeCtx();
        if (ctx) {
          if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* без жеста */ } }
          if (ctx.state !== 'running') throw new Error('autoplay-blocked');
          if (!buffer) {
            try { buffer = await loadBuffer(); }
            catch (e) { // file:// или старый браузер — запасной вариант через <audio>
              useElement(); return startElement();
            }
          }
          if (!st.on) return;
          if (!src) {
            src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
            src.loopStart = firstSound(buffer); src.loopEnd = buffer.duration;
            src.connect(musicGain); src.start(0, src.loopStart);
          }
          st.mode = 'webaudio'; st.started = true;
          if (!st.on) return;
          st.playing = true; fadeTo(1, 2.5); birdsLoop();
        } else { useElement(); await startElement(); }
      } catch (e) { st.error = String(e && e.message || e); st.playing = false; }
      finally { loading = null; }
    })();
    return loading;
  }
  function useElement() {
    if (audioEl) return;
    audioEl = new Audio(SRC); audioEl.loop = true; audioEl.preload = 'auto'; audioEl.volume = 0;
  }
  async function startElement() {
    try { await audioEl.play(); st.mode = 'element'; st.started = true; if (!st.on) { audioEl.pause(); return; } st.playing = true; fadeTo(1, 2.5); }
    catch (e) { st.error = String(e && e.message || e); st.playing = false; }
  }
  function stop(sec) {
    if (!st.playing) return;
    st.playing = false; clearTimeout(birdTimer); fadeTo(0, sec == null ? 0.8 : sec);
  }
  function resume() { // после паузы — тот же источник, плавно
    if (!st.on) return;
    if (st.started && ctx && src) { (ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()).then(() => { if (ctx.state === 'running' && st.on) { st.playing = true; fadeTo(1, 1.5); birdsLoop(); } }).catch(() => {}); return; }
    if (st.started && audioEl) { audioEl.play().then(() => { st.playing = true; fadeTo(1, 1.5); }).catch(() => {}); return; }
    start();
  }
  function set(on) { st.on = !!on; save(); if (st.on) resume(); else stop(); emit(); }
  function toggle() { set(!st.on); return st.on; }

  // первый жест пользователя запускает музыку
  const gesture = (e) => { if (e && e.target && e.target.closest && e.target.closest('#music-btn')) return; if (st.on && !st.playing) resume(); };
  ['pointerdown', 'keydown', 'touchend'].forEach(ev => window.addEventListener(ev, gesture, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (st.playing) { stop(0.4); st._wasPlaying = true; } } else if (st._wasPlaying) { st._wasPlaying = false; resume(); } });

  /** Маленькая круглая кнопка в углу. corner: 'bl' | 'br' | 'tl' | 'tr' */
  function button(corner) {
    if (btn) return btn;
    btn = document.createElement('button');
    btn.className = 'music-btn glass ' + (corner || 'bl'); btn.id = 'music-btn'; btn.type = 'button';
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(btn); emit();
    return btn;
  }

  DP.music = { start, stop, set, toggle, button, isOn: () => st.on, state: () => Object.assign({}, st, { ctx: ctx ? ctx.state : null }), onChange: (f) => listeners.push(f) };
})();
