/* Динопарк — общие утилиты */
window.DP = window.DP || {};
(function () {
  const ALPH = 'abcdefghijkmnpqrstuvwxyz23456789';
  function rnd(n) {
    const a = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return a[0] % n;
  }
  DP.util = {
    plural(n, forms) {
      const a = Math.abs(n) % 100, b = a % 10;
      if (a > 10 && a < 20) return forms[2];
      if (b > 1 && b < 5) return forms[1];
      if (b === 1) return forms[0];
      return forms[2];
    },
    dinoCount(n) { return n + ' ' + DP.util.plural(n, ['динозавр', 'динозавра', 'динозавров']); },
    parkId() { let s = ''; for (let i = 0; i < 10; i++) s += ALPH[rnd(ALPH.length)]; return s; },
    pin() { let s = ''; for (let i = 0; i < 6; i++) s += rnd(10); return s; },
    code5() { return String(10000 + rnd(90000)); },
    uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
    rand(a, b) { return a + Math.random() * (b - a); },
    pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp(a, b, t) { return a + (b - a) * t; },
    param(name) { return new URLSearchParams(location.search).get(name); },
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    toast(msg, ms) {
      let t = document.getElementById('dp-toast');
      if (!t) { t = document.createElement('div'); t.id = 'dp-toast'; t.className = 'toast'; document.body.appendChild(t); }
      t.textContent = msg; t.classList.add('show');
      clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms || 2600);
    },
    loadImage(src) {
      return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    },
    fileToImage(file) {
      return new Promise((res, rej) => {
        const u = URL.createObjectURL(file); const i = new Image();
        i.onload = () => { res(i); setTimeout(() => URL.revokeObjectURL(u), 1000); };
        i.onerror = rej; i.src = u;
      });
    },
    /** Уменьшить изображение/канвас до max px и вернуть dataURL */
    toDataURL(src, max, type, q) {
      const w0 = src.naturalWidth || src.videoWidth || src.width, h0 = src.naturalHeight || src.videoHeight || src.height;
      const k = Math.min(1, max / Math.max(w0, h0));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
      let d = c.toDataURL(type || 'image/webp', q || 0.85);
      if (type !== 'image/jpeg' && d.indexOf('data:image/webp') !== 0) d = c.toDataURL('image/png');
      return d;
    },
    copy(text) {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      t.remove(); return Promise.resolve();
    },
    toggleFullscreen() {
      const d = document;
      if (!d.fullscreenElement && !d.webkitFullscreenElement) {
        const el = d.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
      } else (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    }
  };
})();
