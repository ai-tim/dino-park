/* Динопарк — запасной WebCrypto на чистом JS (js/legacy/crypto.js) совместим с настоящим WebCrypto (как в js/relay.js).
 * Использование: node tests/crypto-fallback.js   (Node 18+) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const W = { Promise, Uint8Array, ArrayBuffer, setTimeout, crypto: { getRandomValues: (u) => require('crypto').randomFillSync(u) } };
W.window = W; W.self = W;
vm.createContext(W); vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/legacy/crypto.js'), 'utf8'), W);
const J = W.DP_SUBTLE, N = globalThis.crypto.subtle, te = new TextEncoder();
const res = []; const ok = (n, c, i) => { res.push(!!c); console.log((c ? '✅' : '❌') + ' ' + n + (i ? ' — ' + i : '')); };
const hex = (b) => Buffer.from(new Uint8Array(b)).toString('hex');
(async () => {
  ok('DP_SUBTLE определён', !!J && J._js);
  const msg = te.encode('dinopark-pair|12345 🦖');
  ok('SHA-256 совпадает', hex(await J.digest('SHA-256', msg)) === hex(await N.digest('SHA-256', msg)));
  // PBKDF2 → AES-GCM, как pairKey() в relay.js
  const salt = te.encode('dinopark-v4|AAAA'), pw = te.encode('dinopark-tv|12345');
  const t0 = Date.now();
  const kj = await J.deriveKey({ name: 'PBKDF2', salt, iterations: 40000, hash: 'SHA-256' }, await J.importKey('raw', pw, { name: 'PBKDF2' }, false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const pbMs = Date.now() - t0;
  const kn = await N.deriveKey({ name: 'PBKDF2', salt, iterations: 40000, hash: 'SHA-256' }, await N.importKey('raw', pw, { name: 'PBKDF2' }, false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  ok('PBKDF2 (40000) → тот же ключ AES', hex(await N.exportKey('raw', kn)) === Buffer.from(kj._raw, 'binary').toString('hex'), pbMs + ' мс на чистом JS');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12)), pt = te.encode(JSON.stringify({ t: 'park', n: 'Парк', big: 'x'.repeat(5000) }));
  const cj = await J.encrypt({ name: 'AES-GCM', iv }, kj, pt), cn = await N.encrypt({ name: 'AES-GCM', iv }, kn, pt);
  ok('AES-GCM: шифротекст и тег совпадают', hex(cj) === hex(cn));
  ok('AES-GCM: JS расшифровывает WebCrypto', hex(await J.decrypt({ name: 'AES-GCM', iv }, kj, cn)) === hex(pt));
  const bad = new Uint8Array(cn); bad[5] ^= 1;
  ok('AES-GCM: подделка отклоняется', await J.decrypt({ name: 'AES-GCM', iv }, kj, bad).then(() => false, () => true));
  // ECDH P-256 в обе стороны, как ecdh()/shared() в relay.js
  const a = await J.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const b = await N.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const aRaw = await J.exportKey('raw', a.publicKey), bRaw = await N.exportKey('raw', b.publicKey);
  ok('ECDH: открытый ключ 65 байт (несжатый)', new Uint8Array(aRaw).length === 65 && new Uint8Array(aRaw)[0] === 4);
  const sJ = await J.deriveBits({ name: 'ECDH', public: await J.importKey('raw', bRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, a.privateKey, 256);
  const sN = await N.deriveBits({ name: 'ECDH', public: await N.importKey('raw', aRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, b.privateKey, 256);
  ok('ECDH: общий секрет JS ↔ WebCrypto совпадает', hex(sJ) === hex(sN) && new Uint8Array(sJ).length === 32);
  const f = res.filter(x => !x).length; console.log(`\nИтого: ${res.length - f}/${res.length}`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
