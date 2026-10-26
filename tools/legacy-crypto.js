/* Запасной WebCrypto на чистом JS для браузеров без crypto.subtle (старые ТВ, страница по http).
 * Ровно то, что нужно js/relay.js: SHA-256, PBKDF2-SHA256 → AES-GCM-256, AES-GCM (IV 12 байт, тег 128 бит), ECDH P-256 (raw-ключи).
 * Совместим с настоящим WebCrypto (tests/crypto-fallback.js сверяет в обе стороны). Собирается tools/build-legacy.js → js/legacy/crypto.js.
 * Библиотеки: node-forge (BSD/GPL — используем по BSD), elliptic (MIT). Без BigInt — работает в ES5. */
var forge = require('node-forge/lib/forge');
require('node-forge/lib/util'); require('node-forge/lib/aes'); require('node-forge/lib/cipher'); require('node-forge/lib/cipherModes');
require('node-forge/lib/sha256'); require('node-forge/lib/hmac'); require('node-forge/lib/pbkdf2');
var EC = require('elliptic').ec;
var ec = new EC('p256');
function u8(d) { return d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset || 0, d.byteLength); }
function bin(d) { d = u8(d); var s = '', i; for (i = 0; i < d.length; i += 4096) s += String.fromCharCode.apply(null, Array.prototype.slice.call(d.subarray(i, i + 4096))); return s; }
function ab(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u.buffer; }
function hex(d) { d = u8(d); var s = ''; for (var i = 0; i < d.length; i++) s += (d[i] < 16 ? '0' : '') + d[i].toString(16); return s; }
function P(fn) { return new Promise(function (res, rej) { setTimeout(function () { try { res(fn()); } catch (e) { rej(e); } }, 0); }); }
function opErr(m) { var e = new Error(m || 'OperationError'); e.name = 'OperationError'; return e; }
function aesKey(raw) { return { type: 'secret', algorithm: { name: 'AES-GCM', length: raw.length * 8 }, _raw: raw }; }
var subtle = {
  _js: true,
  digest: function (alg, data) { return P(function () { var md = forge.md.sha256.create(); md.update(bin(data)); return ab(md.digest().getBytes()); }); },
  importKey: function (fmt, raw, alg) {
    return P(function () {
      var n = alg.name || alg;
      if (n === 'AES-GCM') return aesKey(bin(raw));
      if (n === 'PBKDF2') return { type: 'secret', algorithm: { name: 'PBKDF2' }, _raw: bin(raw) };
      if (n === 'ECDH') return { type: 'public', algorithm: { name: 'ECDH', namedCurve: 'P-256' }, _pub: ec.keyFromPublic(hex(raw), 'hex').getPublic() };
      throw opErr('нет алгоритма ' + n);
    });
  },
  deriveKey: function (alg, base, dalg) {
    return P(function () { return aesKey(forge.pkcs5.pbkdf2(base._raw, bin(alg.salt), alg.iterations, (dalg.length || 256) / 8, forge.md.sha256.create())); });
  },
  encrypt: function (alg, key, data) {
    return P(function () {
      var c = forge.cipher.createCipher('AES-GCM', key._raw); c.start({ iv: bin(alg.iv), tagLength: 128 });
      c.update(forge.util.createBuffer(bin(data))); c.finish();
      return ab(c.output.getBytes() + c.mode.tag.getBytes());
    });
  },
  decrypt: function (alg, key, data) {
    return P(function () {
      var s = bin(data); if (s.length < 16) throw opErr();
      var d = forge.cipher.createDecipher('AES-GCM', key._raw);
      d.start({ iv: bin(alg.iv), tagLength: 128, tag: forge.util.createBuffer(s.slice(-16)) });
      d.update(forge.util.createBuffer(s.slice(0, -16)));
      if (!d.finish()) throw opErr('неверный ключ или повреждённые данные');
      return ab(d.output.getBytes());
    });
  },
  generateKey: function () {
    return P(function () { var kp = ec.genKeyPair(); return { publicKey: { type: 'public', _pub: kp.getPublic() }, privateKey: { type: 'private', _kp: kp } }; });
  },
  exportKey: function (fmt, key) { return P(function () { return ab(forge.util.hexToBytes(key._pub.encode('hex', false))); }); },
  deriveBits: function (alg, priv, bits) {
    return P(function () { var x = priv._kp.derive(alg.public._pub); return new Uint8Array(x.toArray('be', (bits || 256) / 8)).buffer; });
  }
};
window.DP_SUBTLE = subtle;
