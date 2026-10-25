/* Динопарк — голоса видов.
 * Файлы: assets/audio/voices/<вид>/1.mp3, 2.mp3 (собраны из записей пользователя, см. voices.json и tools/make-voices.sh).
 * Звук играет при касании динозавра, во время еды и при пробуждении. У каждого динозавра свой «тембр» —
 * небольшой сдвиг высоты (±8 %), зависящий от его uid. Есть ограничение частоты, чтобы стадо не галдело хором.
 * Настройка: localStorage dp_voices = '0' выключает голоса.
 */
window.DP = window.DP || {};
(function () {
  const BASE = 'assets/audio/voices/', KEY = 'dp_voices', VOL = 0.7;
  const LIST = ['trex', 'triceratops', 'stegosaurus', 'brachiosaurus', 'pterodactyl', 'plesiosaur', 'ankylosaurus', 'parasaurolophus', 'velociraptor'];
  // для «своих рисунков» без вида — голос по размеру/среде
  const FALLBACK = { ground: 'triceratops', sky: 'pterodactyl', water: 'plesiosaur' };
  const KIND = { tap: { rate: 1, vol: 1 }, eat: { rate: 1.08, vol: 0.45 }, wake: { rate: 0.94, vol: 0.8 }, play: { rate: 1.12, vol: 0.6 } };
  let on = true; try { on = localStorage.getItem(KEY) !== '0'; } catch (e) { /* ignore */ }
  let ctx = null, gain = null;
  const buffers = {}, last = {}; let lastAny = 0, playing = 0;
  const log = [];

  function hash(s) { s = String(s || ''); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  function speciesOf(sp, habitat) { return LIST.indexOf(sp) >= 0 ? sp : (FALLBACK[habitat] || 'triceratops'); }
  /** Чистая функция выбора: какой файл и с какой скоростью. n — порядковый номер вызова для чередования вариантов. */
  function pick(species, seed, kind, n) {
    const sp = speciesOf(species);
    const variant = ((Math.floor(hash(seed) * 2) + (n || 0)) % 2) + 1;
    const jitter = 1 + (hash('p' + seed) - 0.5) * 0.16; // 0.92 … 1.08 — личный тембр
    const k = KIND[kind] || KIND.tap;
    return { species: sp, url: BASE + sp + '/' + variant + '.mp3', rate: +(jitter * k.rate).toFixed(3), vol: k.vol };
  }
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { ctx = new AC(); gain = ctx.createGain(); gain.gain.value = VOL; gain.connect(ctx.destination); } catch (e) { ctx = null; }
    return ctx;
  }
  function load(url) {
    if (buffers[url]) return buffers[url];
    buffers[url] = fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(data => new Promise((res, rej) => { const p = ctx.decodeAudioData(data, res, rej); if (p && p.then) p.then(res, rej); }))
      .catch(() => { delete buffers[url]; return null; });
    return buffers[url];
  }
  const counter = {};
  /** Сыграть голос. seed — uid динозавра. Возвращает выбранный вариант или null (выключено/слишком часто). */
  function play(species, kind, seed, opts) {
    opts = opts || {};
    const now = performance.now();
    const gap = kind === 'tap' ? 250 : 900, per = kind === 'tap' ? 600 : 4000;
    if (!on) return null;
    if (!opts.force && (now - lastAny < gap || now - (last[seed] || 0) < per || playing >= 3)) return null;
    counter[seed] = (counter[seed] || 0) + 1;
    const v = pick(species, seed, kind, counter[seed]);
    lastAny = now; last[seed] = now;
    log.push(Object.assign({ kind, seed, t: Date.now() }, v)); if (log.length > 50) log.shift();
    if (!ensure()) return v;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    load(v.url).then(buf => {
      if (!buf || !ctx) return;
      const s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = buf; s.playbackRate.value = v.rate; g.gain.value = v.vol * (opts.vol == null ? 1 : opts.vol);
      s.connect(g); g.connect(gain); playing++; s.onended = () => { playing = Math.max(0, playing - 1); };
      s.start();
    });
    return v;
  }
  function preload(speciesList) { if (!ensure()) return; (speciesList || LIST).forEach(sp => [1, 2].forEach(n => load(BASE + speciesOf(sp) + '/' + n + '.mp3'))); }
  // браузер разрешает звук только после жеста — «будим» контекст первым касанием
  const unlock = () => { if (on && ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {}); };
  ['pointerdown', 'keydown', 'touchend'].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));

  DP.Voices = {
    LIST, pick, play, preload, log, speciesOf,
    isOn: () => on,
    set(v) { on = !!v; try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* ignore */ } }
  };
})();
