/* Дополнительные полифиллы для наследной сборки (core-js их не даёт): TextEncoder/TextDecoder (UTF-8), requestAnimationFrame,
 * Element.matches/closest, performance.now. Синтаксис — строго ES5. */
(function () {
  var W = window;
  if (!W.TextEncoder) {
    W.TextEncoder = function () { this.encoding = 'utf-8'; };
    W.TextEncoder.prototype.encode = function (s) {
      s = String(s); var out = [], i, c;
      for (i = 0; i < s.length; i++) {
        c = s.charCodeAt(i);
        if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) { var d = s.charCodeAt(i + 1); if (d >= 0xDC00 && d < 0xE000) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; } }
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return new Uint8Array(out);
    };
  }
  if (!W.TextDecoder) {
    W.TextDecoder = function () { this.encoding = 'utf-8'; };
    W.TextDecoder.prototype.decode = function (u) {
      if (!u) return ''; u = u instanceof Uint8Array ? u : new Uint8Array(u.buffer || u);
      var s = '', i = 0, c;
      while (i < u.length) {
        c = u[i++];
        if (c >= 0xF0) c = ((c & 7) << 18) | ((u[i++] & 63) << 12) | ((u[i++] & 63) << 6) | (u[i++] & 63);
        else if (c >= 0xE0) c = ((c & 15) << 12) | ((u[i++] & 63) << 6) | (u[i++] & 63);
        else if (c >= 0xC0) c = ((c & 31) << 6) | (u[i++] & 63);
        if (c >= 0x10000) { c -= 0x10000; s += String.fromCharCode(0xD800 + (c >> 10), 0xDC00 + (c & 1023)); } else s += String.fromCharCode(c);
      }
      return s;
    };
  }
  if (!W.requestAnimationFrame) {
    W.requestAnimationFrame = W.webkitRequestAnimationFrame || function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
    W.cancelAnimationFrame = W.webkitCancelAnimationFrame || clearTimeout;
  }
  if (!W.performance) W.performance = {};
  if (!W.performance.now) { var t0 = Date.now(); W.performance.now = function () { return Date.now() - t0; }; }
  var EP = W.Element && W.Element.prototype;
  if (EP && !EP.matches) EP.matches = EP.webkitMatchesSelector || EP.msMatchesSelector;
  if (EP && !EP.closest) EP.closest = function (sel) { var el = this; while (el && el.nodeType === 1) { if (el.matches(sel)) return el; el = el.parentNode; } return null; };
  if (W.crypto && !W.crypto.subtle && W.crypto.webkitSubtle) { try { W.crypto.subtle = W.crypto.webkitSubtle; } catch (e) { /* только чтение */ } }
})();
