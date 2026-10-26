/* Динопарк — сервер.
 * Раздаёт файлы сайта (только из белого списка) и синхронизирует парки по WebSocket (/ws).
 *
 * Безопасность:
 *  - PIN хранится только как scrypt-хэш с солью, сравнение через crypto.timingSafeEqual;
 *  - ограничение попыток с растущей блокировкой для PIN и для ТВ-кодов (по IP и по парку);
 *  - лимиты: число парков, динозавров, размер картинок и сообщений (настраиваются переменными окружения);
 *  - каждый парк хранится в своей папке, картинки — отдельными файлами (а не base64 в JSON);
 *  - удалённые парки и картинки 30 дней лежат в корзине;
 *  - запись файлов атомарная (временный файл → rename);
 *  - кривые адреса и битый JSON не роняют сервер.
 *
 *  - «жизнь парка» (яйца, племя, подарки) проверяется по схеме и с лимитами размера;
 *  - подарочные коды проверяются открытым ключом ECDSA из js/config.js, каждый код — один раз;
 *  - приглашения и обратная связь — с лимитами по IP; админ-выдача подарков — POST /api/admin/gift
 *    с заголовком Authorization: Bearer $ADMIN_TOKEN (если ADMIN_TOKEN не задан — выключено).
 *
 * Запуск: cd server && npm install && npm start   (порт: PORT, по умолчанию 8080)
 * Copyright (c) 2026 Юрий Власенко. Все права защищены.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { WebSocketServer } = require('ws');

const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? Number(process.env[k]) : d);
const DEFAULTS = {
  port: env('PORT', 8080),
  root: path.resolve(__dirname, '..'),
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data'),
  maxParks: env('MAX_PARKS', 2000),
  maxDinos: env('MAX_DINOS', 80),
  maxImage: env('MAX_IMAGE_BYTES', 1.5 * 1024 * 1024),     // фото-динозавр
  maxBg: env('MAX_BG_BYTES', 4 * 1024 * 1024),             // свой фон
  maxPayload: env('MAX_PAYLOAD_BYTES', 8 * 1024 * 1024),   // одно сообщение WebSocket
  maxCreatePerHour: env('MAX_CREATE_PER_HOUR', 20),        // новых парков с одного IP в час
  maxMsgPer10s: env('MAX_MSG_PER_10S', 300),
  trashDays: env('TRASH_DAYS', 30),
  tvTtl: env('TV_TTL_MS', 5 * 60 * 1000),
  trustProxy: process.env.TRUST_PROXY === '1',
  scryptN: env('SCRYPT_N', 16384),
  adminToken: process.env.ADMIN_TOKEN || '',
  maxFeedbackPerHour: env('MAX_FEEDBACK_PER_HOUR', 5),
  maxRefPerHour: env('MAX_REF_PER_HOUR', 10)
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.webmanifest': 'application/manifest+json'
};
// Белый список того, что можно отдавать по HTTP
const PAGES = new Set(['/index.html', '/park.html', '/tv.html', '/viewer.html', '/coloring.html', '/parks.html', '/admin.html', '/LICENSE', '/robots.txt']);
const PREFIXES = ['/css/', '/js/', '/assets/', '/legacy/', '/gifts/'];
const ALIASES = { '/': '/index.html', '/tv': '/tv.html', '/tv/': '/tv.html', '/park': '/park.html', '/parks': '/parks.html', '/coloring': '/coloring.html', '/legacy': '/legacy/index.html', '/legacy/': '/legacy/index.html' };

const ID_RE = /^[a-z0-9]{6,16}$/;
const PIN_RE = /^\d{4,12}$/;
const SLUG_RE = /^[a-z][a-z0-9-]{1,23}$/;
const UID_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const IMG_NAME_RE = /^[a-f0-9]{24}\.(png|jpg|webp)$/;
const EVENT_TYPES = new Set(['feed', 'jump', 'play', 'sleep', 'sparkle', 'voice', 'travel', 'wake', 'pet']);
const RARITIES = ['common', 'rare', 'epic', 'legend'];
const HAT_IDS = ['cap', 'bow', 'flower', 'sunhat', 'helmet', 'grad', 'tophat', 'crown'];
const REF_RE = /^[0-9a-f]{10}$/;

/** Подарок администратора: допустимые виды (как в js/life.js) */
function validGift(g) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return false;
  if (g.k === 'eggs') return RARITIES.includes(g.r) && Number.isInteger(g.q) && g.q > 0 && g.q <= 50;
  if (g.k === 'hat') return HAT_IDS.includes(g.h);
  if (g.k === 'legend') return true;
  if (g.k === 'item') return typeof g.e === 'string' && g.e.length <= 8 && typeof g.t === 'string' && g.t.length <= 40;
  return false;
}
function cleanGift(g) {
  if (g.k === 'eggs') return { k: 'eggs', r: g.r, q: g.q };
  if (g.k === 'hat') return { k: 'hat', h: g.h };
  if (g.k === 'item') return { k: 'item', e: g.e, t: g.t };
  return { k: 'legend' };
}
/** Открытый ключ для подарочных кодов — из js/config.js (тот же, что у клиентов) */
function loadPublicKey(root) {
  try {
    const ctx = { window: {} }; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'config.js'), 'utf8'), ctx, { timeout: 200 });
    const jwk = ctx.window.DP_CONFIG && ctx.window.DP_CONFIG.ADMIN_PUBLIC_KEY;
    if (!jwk || jwk.d) return null; // закрытый ключ сюда попадать не должен
    return crypto.createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' });
  } catch (e) { return null; }
}
/** Проверка подарочного кода DP1.<payload>.<подпись P-256 в формате r||s> */
function verifyGiftCode(code, pubKey, parkId) {
  if (!pubKey) throw new Error('Подарочные коды не настроены');
  const m = /^DP1\.([A-Za-z0-9_-]{8,700})\.([A-Za-z0-9_-]{80,90})$/.exec(String(code || '').replace(/\s+/g, ''));
  if (!m) throw new Error('Код не похож на подарочный');
  const sig = Buffer.from(m[2], 'base64url');
  if (sig.length !== 64 || !crypto.verify('sha256', Buffer.from('DP1.' + m[1]), { key: pubKey, dsaEncoding: 'ieee-p1363' }, sig)) throw new Error('Неверная подпись — код ненастоящий');
  let p; try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch (e) { throw new Error('Код повреждён'); }
  if (!p || typeof p.n !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(p.n) || !validGift(p.g)) throw new Error('Код повреждён');
  if (p.e && Date.now() > p.e) throw new Error('Срок действия кода истёк');
  if (p.p && p.p !== parkId) throw new Error('Этот код для другого парка');
  return p;
}

// ---------- утилиты ----------
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function scrypt(pin, salt, N) {
  return new Promise((res, rej) => crypto.scrypt(String(pin), salt, 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
}
async function hashPin(pin, N) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pin, salt, N);
  return { alg: 'scrypt', N, salt: salt.toString('hex'), hash: key.toString('hex') };
}
async function checkPin(pin, rec) {
  if (!rec || !rec.hash || typeof pin !== 'string') { await scrypt('x', 'pad', DEFAULTS.scryptN).catch(() => {}); return false; }
  const key = await scrypt(pin, Buffer.from(rec.salt, 'hex'), rec.N || DEFAULTS.scryptN);
  const want = Buffer.from(rec.hash, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

/** Ограничитель попыток: после `free` неудач — блокировка base·2^k, но не больше cap. */
class Limiter {
  constructor(free, baseMs, capMs) { this.free = free; this.base = baseMs; this.cap = capMs; this.m = new Map(); }
  wait(key) { const r = this.m.get(key); if (!r) return 0; const left = r.until - Date.now(); return left > 0 ? left : 0; }
  fail(key) {
    const now = Date.now(); let r = this.m.get(key);
    if (!r || now - r.last > 60 * 60 * 1000) r = { n: 0, until: 0, last: now };
    r.n++; r.last = now;
    if (r.n >= this.free) r.until = now + Math.min(this.cap, this.base * Math.pow(2, r.n - this.free));
    this.m.set(key, r); return r;
  }
  ok(key) { this.m.delete(key); }
  sweep() { const now = Date.now(); for (const [k, r] of this.m) if (now - r.last > 2 * 60 * 60 * 1000 && r.until < now) this.m.delete(k); }
}

function createServer(opts) {
  const C = Object.assign({}, DEFAULTS, opts || {});
  const PARKS_DIR = path.join(C.dataDir, 'parks');
  const TRASH_DIR = path.join(C.dataDir, 'trash');
  fs.mkdirSync(PARKS_DIR, { recursive: true }); fs.mkdirSync(TRASH_DIR, { recursive: true });

  const parks = new Map();      // id -> { park, auth, ver }
  const saveTimers = new Map();
  const tvCodes = new Map();    // code -> { id, exp }
  const tvTokens = new Map();   // token -> { id, exp }
  const L = {
    pinIp: new Limiter(5, 30 * 1000, 60 * 60 * 1000),
    pinPark: new Limiter(25, 60 * 1000, 60 * 60 * 1000),
    tvIp: new Limiter(8, 30 * 1000, 60 * 60 * 1000),
    redeemIp: new Limiter(10, 30 * 1000, 60 * 60 * 1000),
    admin: new Limiter(5, 60 * 1000, 60 * 60 * 1000)
  };
  const creates = new Map();    // ip -> [timestamps]

  const parkDir = (id) => path.join(PARKS_DIR, id);
  const imgDir = (id) => path.join(PARKS_DIR, id, 'img');

  // ---------- загрузка ----------
  for (const id of fs.readdirSync(PARKS_DIR)) {
    if (!ID_RE.test(id)) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(parkDir(id), 'park.json'), 'utf8'));
      if (rec && rec.park && rec.auth) parks.set(id, { park: rec.park, auth: rec.auth, ver: 1 });
    } catch (e) { console.warn('Пропускаю повреждённый парк', id, e.message); }
  }

  function saveNow(id) {
    const r = parks.get(id); if (!r) return;
    writeAtomic(path.join(parkDir(id), 'park.json'), JSON.stringify({ v: 2, park: r.park, auth: r.auth }));
  }
  function save(id) {
    clearTimeout(saveTimers.get(id));
    saveTimers.set(id, setTimeout(() => { saveTimers.delete(id); try { saveNow(id); } catch (e) { console.error('Не удалось сохранить парк', id, e); } }, 150));
  }
  function flushAll() { for (const [id, t] of saveTimers) { clearTimeout(t); try { saveNow(id); } catch (e) { /* ignore */ } } saveTimers.clear(); }

  // ---------- картинки ----------
  const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] };
  function storeImage(id, value, max) {
    if (value == null || value === '') return null;
    if (typeof value !== 'string') throw new Error('Неверная картинка');
    if (value.startsWith('/img/' + id + '/')) {
      const name = value.slice(('/img/' + id + '/').length);
      if (IMG_NAME_RE.test(name) && fs.existsSync(path.join(imgDir(id), name))) return value;
      return null;
    }
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
    if (!m) return null; // внешние ссылки и прочее не принимаем
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    if (m[2].length * 0.75 > max + 4) throw new Error(`Картинка слишком большая (максимум ${Math.round(max / 1024)} КБ)`);
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > max) throw new Error(`Картинка слишком большая (максимум ${Math.round(max / 1024)} КБ)`);
    if (!MAGIC[ext].every((b, i) => buf[i] === b)) throw new Error('Файл не похож на картинку');
    const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24) + '.' + ext;
    const file = path.join(imgDir(id), name);
    if (!fs.existsSync(file)) writeAtomic(file, buf);
    return `/img/${id}/${name}`;
  }

  // ---------- проверка присланного парка ----------
  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '');
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function cleanNeeds(n) {
    if (!n || typeof n !== 'object') return undefined;
    return { food: clamp(num(n.food, 80), 0, 100), play: clamp(num(n.play, 80), 0, 100), sleep: clamp(num(n.sleep, 80), 0, 100), t: num(n.t, Date.now()), sleepFrom: n.sleepFrom == null ? null : num(n.sleepFrom, null) };
  }
  function cleanPark(id, src) {
    if (!src || typeof src !== 'object') throw new Error('Неверные данные парка');
    const dinos = Array.isArray(src.dinos) ? src.dinos : [];
    if (dinos.length > C.maxDinos) throw new Error(`Слишком много динозавров (максимум ${C.maxDinos})`);
    const out = {
      id, name: str(src.name, 60) || 'Парк',
      bg: typeof src.bg === 'string' && SLUG_RE.test(src.bg) ? src.bg : 'jungle',
      view: typeof src.view === 'string' && SLUG_RE.test(src.view) ? src.view : undefined,
      customBg: storeImage(id, src.customBg, C.maxBg),
      customLoc: typeof src.customLoc === 'string' && SLUG_RE.test(src.customLoc) ? src.customLoc : undefined,
      created: num(src.created, Date.now()), updated: num(src.updated, Date.now()),
      dinos: []
    };
    const seen = new Set();
    for (const d of dinos) {
      if (!d || typeof d !== 'object' || typeof d.uid !== 'string' || !UID_RE.test(d.uid) || seen.has(d.uid)) continue;
      seen.add(d.uid);
      out.dinos.push({
        uid: d.uid,
        species: typeof d.species === 'string' && SLUG_RE.test(d.species) ? d.species : null,
        base: typeof d.base === 'string' && SLUG_RE.test(d.base) ? d.base : null,
        palette: clamp(Math.floor(num(d.palette, 0)), 0, 9),
        sprite: storeImage(id, d.sprite, C.maxImage),
        name: str(d.name, 24),
        diet: ['herb', 'carn', 'omni'].includes(d.diet) ? d.diet : 'omni',
        habitat: ['ground', 'sky', 'water'].includes(d.habitat) ? d.habitat : 'ground',
        added: num(d.added, Date.now()),
        owner: typeof d.owner === 'string' && /^[a-z0-9]{6,32}$/.test(d.owner) ? d.owner : undefined,
        loc: typeof d.loc === 'string' && SLUG_RE.test(d.loc) ? d.loc : undefined,
        needs: cleanNeeds(d.needs),
        care: clamp(Math.floor(num(d.care, 0)), 0, 30), aff: clamp(Math.floor(num(d.aff, 0)), 0, 40),
        eggN: clamp(Math.floor(num(d.eggN, 0)), 0, 1e6), lastEgg: d.lastEgg == null ? undefined : num(d.lastEgg, undefined),
        giftN: clamp(Math.floor(num(d.giftN, 0)), 0, 1e6), lastGift: d.lastGift == null ? undefined : num(d.lastGift, undefined),
        hat: HAT_IDS.includes(d.hat) ? d.hat : undefined, legend: d.legend === true ? true : undefined
      });
    }
    out.life = cleanLife(src.life);
    return out;
  }
  /** «Жизнь парка»: только известные поля, с ограничением длины. inbox ведёт только сервер. */
  function cleanLife(l) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) return undefined;
    const arr = (v, max, f) => (Array.isArray(v) ? v.slice(0, max).map(f).filter(x => x != null) : []);
    const slug = (v) => (typeof v === 'string' && /^[a-z0-9_-]{1,24}$/i.test(v) ? v : null);
    const int = (v, max) => clamp(Math.floor(num(v, 0)), 0, max);
    const nums = (o, keys, max) => { const r = {}; if (o && typeof o === 'object') Object.keys(o).slice(0, 60).forEach(k => { if ((!keys || keys.includes(k)) && /^[a-z0-9_]{1,16}$/i.test(k) && typeof o[k] === 'number' && isFinite(o[k])) r[k] = clamp(o[k], 0, max); }); return r; };
    const out = {
      eggs: {}, nest: arr(l.nest, 40, n => n && typeof n === 'object' && slug(n.id) && UID_RE.test(String(n.uid)) && (n.k === 'egg' || n.k === 'gift')
        ? { id: n.id, k: n.k, uid: n.uid, r: RARITIES.includes(n.r) ? n.r : undefined, g: slug(n.g) || undefined, t: num(n.t, Date.now()) } : null),
      tribe: arr(l.tribe, 6, a => a && typeof a === 'object' && slug(a.id) ? { id: a.id, name: str(a.name, 12), xp: num(a.xp, 0), sk: arr(a.sk, 20, slug), t: num(a.t, Date.now()) } : null),
      mammals: arr(l.mammals, 10, a => a && typeof a === 'object' && slug(a.id) ? { id: a.id, kind: slug(a.kind) || 'shrew', name: str(a.name, 20), xp: num(a.xp, 0), t: num(a.t, Date.now()) } : null),
      gifts: arr(l.gifts, 200, g => g && typeof g === 'object' ? { g: slug(g.g) || undefined, e: str(g.e, 8) || undefined, name: str(g.name, 40) || undefined, msg: str(g.msg, 140) || undefined, from: str(g.from, 40) || undefined, uid: typeof g.uid === 'string' && UID_RE.test(g.uid) ? g.uid : undefined, adm: g.adm ? 1 : undefined, t: num(g.t, Date.now()) } : null),
      redeemed: arr(l.redeemed, 200, v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null)),
      ach: arr(l.ach, 60, slug), ack: arr(l.ack, 100, slug), locs: arr(l.locs, 10, slug), inbox: [],
      stats: nums(l.stats, null, 1e9), acc: nums(l.acc, null, 1e9), hats: nums(l.hats, HAT_IDS, 99), tokens: nums(l.tokens, ['legend'], 10),
      age: clamp(num(l.age, 0), 0, 1e10), t: num(l.t, Date.now()),
      day: str(l.day, 12) || undefined, shareDay: str(l.shareDay, 12) || undefined,
      refBy: typeof l.refBy === 'string' && REF_RE.test(l.refBy) ? l.refBy : undefined, refSent: l.refSent ? 1 : undefined
    };
    RARITIES.forEach(r => { out.eggs[r] = int(l.eggs && l.eggs[r], 100000); });
    Object.keys(out.hats).forEach(k => { out.hats[k] = Math.floor(out.hats[k]); });
    return out;
  }

  // ---------- корзина ----------
  function trashPark(id) {
    const src = parkDir(id);
    if (!fs.existsSync(src)) return;
    fs.renameSync(src, path.join(TRASH_DIR, `${id}__${Date.now()}`));
  }
  function collectGarbage() {
    const now = Date.now(), maxAge = C.trashDays * 24 * 60 * 60 * 1000;
    // старые удалённые парки
    for (const n of fs.readdirSync(TRASH_DIR)) {
      const ts = Number(n.split('__')[1]);
      if (ts && now - ts > maxAge) fs.rmSync(path.join(TRASH_DIR, n), { recursive: true, force: true });
    }
    // неиспользуемые картинки → корзина парка; старше 30 дней — удалить
    for (const [id, r] of parks) {
      const used = new Set();
      (r.park.dinos || []).forEach(d => d.sprite && used.add(path.basename(d.sprite)));
      if (r.park.customBg) used.add(path.basename(r.park.customBg));
      const dir = imgDir(id), tdir = path.join(parkDir(id), 'trash');
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) {
        if (used.has(f) || !IMG_NAME_RE.test(f)) continue;
        const st = fs.statSync(path.join(dir, f));
        if (now - st.mtimeMs < 10 * 60 * 1000) continue; // только что загружена — может ещё понадобиться
        fs.mkdirSync(tdir, { recursive: true });
        fs.renameSync(path.join(dir, f), path.join(tdir, `${now}__${f}`));
      }
      if (fs.existsSync(tdir)) for (const f of fs.readdirSync(tdir)) {
        const ts = Number(f.split('__')[0]);
        if (ts && now - ts > maxAge) fs.rmSync(path.join(tdir, f), { force: true });
      }
    }
  }

  // ---------- миграция со старого формата (server/data/parks.json, PIN открытым текстом) ----------
  async function migrateV1() {
    const old = path.join(C.dataDir, 'parks.json');
    if (!fs.existsSync(old)) return;
    let all = {}; try { all = JSON.parse(fs.readFileSync(old, 'utf8')); } catch (e) { return; }
    for (const id of Object.keys(all)) {
      const p = all[id];
      if (!ID_RE.test(id) || parks.has(id) || !p || !PIN_RE.test(String(p.pin || ''))) continue;
      try {
        const park = cleanPark(id, Object.assign({}, p, { dinos: (p.dinos || []).slice(0, C.maxDinos) }));
        parks.set(id, { park, auth: await hashPin(String(p.pin), C.scryptN), ver: 1 }); saveNow(id);
      } catch (e) { console.warn('Миграция парка не удалась', id, e.message); }
    }
    fs.renameSync(old, old + '.migrated-' + Date.now());
  }

  // ---------- TV ----------
  function newTvCode(id) {
    const now = Date.now();
    for (const [c, r] of tvCodes) if (r.exp < now) tvCodes.delete(c);
    let code; do { code = String(10000 + crypto.randomInt(90000)); } while (tvCodes.has(code));
    const exp = now + C.tvTtl; tvCodes.set(code, { id, exp }); return { code, exp };
  }

  /** Подарки администратора, которые клиент ещё не подтвердил (ack), сохраняются на сервере */
  function keepInbox(next, prev) {
    const box = (prev && prev.life && prev.life.inbox) || [];
    if (!box.length) return;
    if (!next.life) next.life = cleanLife({});
    const ack = next.life.ack || [];
    next.life.inbox = box.filter(it => !ack.includes(it.id));
  }
  // ---------- приглашения, подарочные коды, обратная связь ----------
  const PUBKEY = C.publicKeyJwk ? crypto.createPublicKey({ key: C.publicKeyJwk, format: 'jwk' }) : loadPublicKey(C.root);
  const jsonFile = (n) => path.join(C.dataDir, n);
  const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(jsonFile(n), 'utf8')); } catch (e) { return d; } };
  const refs = readJson('refs.json', { byPark: {}, pending: {}, claimed: {} });
  const redeemed = new Set(readJson('redeemed.json', []));
  const saveRefs = () => writeAtomic(jsonFile('refs.json'), JSON.stringify(refs));
  const saveRedeemed = () => writeAtomic(jsonFile('redeemed.json'), JSON.stringify([...redeemed]));
  const hourly = new Map(); // "вид:ip" -> [метки времени]
  function quota(kind, ip, max) {
    const k = kind + ':' + ip, now = Date.now(), list = (hourly.get(k) || []).filter(t => now - t < 60 * 60 * 1000);
    if (list.length >= max) { hourly.set(k, list); return false; }
    list.push(now); hourly.set(k, list); return true;
  }
  /** Выдать подарок администратора в «ящик» парка (клиент применит и подтвердит) */
  function giveGift(id, gift, msg) {
    const r = parks.get(id); if (!r) return false;
    if (!r.park.life) r.park.life = cleanLife({});
    const box = r.park.life.inbox || (r.park.life.inbox = []);
    if (box.length >= 50) return false;
    box.push({ id: 'a' + crypto.randomBytes(6).toString('hex'), g: cleanGift(gift), m: str(msg, 140) || undefined, t: Date.now() });
    r.park.updated = Date.now(); save(id);
    broadcast(id, { t: 'park', park: pub(r.park) });
    return true;
  }
  function readBody(req, max) {
    return new Promise((res, rej) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > max) { rej(new Error('too big')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => res(Buffer.concat(chunks).toString('utf8'))); req.on('error', rej);
    });
  }
  const tokenHash = C.adminToken ? crypto.createHash('sha256').update(C.adminToken).digest() : null;
  async function adminGift(req, res) {
    const ip = ipOf(req);
    if (!tokenHash) return send(res, 404, 'Не найдено');
    const w = L.admin.wait('ip:' + ip); if (w) return send(res, 429, JSON.stringify({ error: 'locked', retryIn: w }), 'application/json');
    const auth = String(req.headers.authorization || ''), m = /^Bearer (.{8,200})$/.exec(auth);
    const given = crypto.createHash('sha256').update(m ? m[1] : '').digest();
    if (!m || !crypto.timingSafeEqual(given, tokenHash)) { L.admin.fail('ip:' + ip); return send(res, 401, JSON.stringify({ error: 'unauthorized' }), 'application/json'); }
    L.admin.ok('ip:' + ip);
    let b; try { b = JSON.parse(await readBody(req, 16 * 1024)); } catch (e) { return send(res, 400, JSON.stringify({ error: 'bad json' }), 'application/json'); }
    if (!b || !validGift(b.gift)) return send(res, 400, JSON.stringify({ error: 'bad gift' }), 'application/json');
    const ids = b.all === true ? [...parks.keys()] : (Array.isArray(b.parks) ? b.parks : [b.park]).filter(x => typeof x === 'string' && ID_RE.test(x)).slice(0, 500);
    const done = ids.filter(id => giveGift(id, b.gift, b.msg));
    return send(res, 200, JSON.stringify({ ok: true, given: done.length, missing: ids.length - done.length }), 'application/json');
  }

  // ---------- HTTP ----------
  function send(res, code, body, type, extra) {
    res.writeHead(code, Object.assign({ 'Content-Type': type || 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }, extra || {}));
    res.end(body);
  }
  function serveFile(req, res, file, cache) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Не найдено');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache || 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
      if (req.method === 'HEAD') return res.end();
      const s = fs.createReadStream(file); s.on('error', () => res.destroy()); s.pipe(res);
    });
  }
  const server = http.createServer((req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/api/admin/gift') { adminGift(req, res).catch((e) => { console.error(e); try { send(res, 500, 'Ошибка'); } catch (er) { /* ignore */ } }); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', null, { Allow: 'GET, HEAD' });
      let url;
      try {
        if (typeof req.url !== 'string' || req.url.length > 2048) throw new Error('long');
        url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      } catch (e) { return send(res, 400, 'Bad request'); }
      if (url.indexOf('\0') >= 0 || url.indexOf('\\') >= 0) return send(res, 400, 'Bad request');
      if (url === '/health') return send(res, 200, JSON.stringify({ ok: true, parks: parks.size }), 'application/json');
      if (url === '/js/config.js') { // настоящий config.js (ключ, поддержка) + включение сервера
        let base = ''; try { base = fs.readFileSync(path.join(C.root, 'js', 'config.js'), 'utf8'); } catch (e) { /* нет файла */ }
        return send(res, 200, base + "\nwindow.DP_CONFIG = Object.assign(window.DP_CONFIG || {}, { wsUrl: '/ws', server: true });\n", 'application/javascript; charset=utf-8', { 'Cache-Control': 'no-cache' });
      }
      const im = /^\/img\/([a-z0-9]{6,16})\/([^/]+)$/.exec(url);
      if (im) {
        if (!parks.has(im[1]) || !IMG_NAME_RE.test(im[2])) return send(res, 404, 'Не найдено');
        return serveFile(req, res, path.join(imgDir(im[1]), im[2]), 'public, max-age=31536000, immutable');
      }
      url = ALIASES[url] || url;
      if (url.endsWith('/')) url += 'index.html';
      const norm = path.posix.normalize(url);
      if (norm !== url || norm.split('/').some(s => s.startsWith('.'))) return send(res, 404, 'Не найдено');
      const ext = path.extname(norm).toLowerCase();
      const allowed = PAGES.has(norm) || (PREFIXES.some(p => norm.startsWith(p)) && MIME[ext]);
      if (!allowed) return send(res, 404, 'Не найдено');
      const file = path.join(C.root, norm);
      if (!file.startsWith(C.root + path.sep)) return send(res, 404, 'Не найдено');
      return serveFile(req, res, file);
    } catch (e) { console.error(e); try { send(res, 500, 'Ошибка'); } catch (er) { /* ignore */ } }
  });

  // ---------- WebSocket ----------
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: C.maxPayload });
  const pub = (p) => p; // в park нет секретов: хэш PIN хранится отдельно (auth)
  function broadcast(id, msg, except) {
    const data = JSON.stringify(msg);
    wss.clients.forEach((c) => { if (c !== except && c.readyState === 1 && c.parkId === id) c.send(data); });
  }
  function ipOf(req) {
    if (C.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return req.socket.remoteAddress || '?';
  }

  wss.on('connection', (ws, req) => {
    const ip = ipOf(req);
    ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    ws.auth = new Map(); // id -> ver, проверенный PIN в этой сессии
    let win = Date.now(), count = 0;
    const reply = (m, extra) => { if (ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ rid: m && m.rid }, extra))); };
    const err = (m, msg, more) => reply(m, Object.assign({ t: 'error', msg }, more || {}));
    const lockMsg = (ms) => `Слишком много неверных попыток. Попробуйте через ${Math.ceil(ms / 1000)} с.`;

    /** Проверка PIN с блокировками; сессия запоминает успех, пока PIN не сменят. */
    async function authorize(m, id) {
      const r = parks.get(id); if (!r) return false;
      if (ws.auth.get(id) === r.ver && (m.pin == null || ws.authPin === String(m.pin) + id)) return true;
      const w = Math.max(L.pinIp.wait('ip:' + ip), L.pinPark.wait('park:' + id));
      if (w) { err(m, lockMsg(w), { code: 'locked', retryIn: w }); return null; }
      const pin = typeof m.pin === 'string' || typeof m.pin === 'number' ? String(m.pin) : '';
      const ok = PIN_RE.test(pin) && await checkPin(pin, r.auth);
      if (!ok) { L.pinIp.fail('ip:' + ip); L.pinPark.fail('park:' + id); return false; }
      L.pinIp.ok('ip:' + ip); ws.auth.set(id, r.ver); ws.authPin = pin + id;
      return true;
    }
    function canCreate() {
      const now = Date.now(), list = (creates.get(ip) || []).filter(t => now - t < 60 * 60 * 1000);
      creates.set(ip, list);
      return list.length < C.maxCreatePerHour && parks.size < C.maxParks;
    }

    async function handle(m) {
      const id = typeof m.id === 'string' ? m.id : '';
      switch (m.t) {
        case 'sub': case 'update': {
          if (!ID_RE.test(id)) return err(m, 'Неверный код парка');
          const r = parks.get(id);
          if (!r) { // создание нового парка
            if (!m.park || !PIN_RE.test(String(m.pin || ''))) return err(m, 'Парк с таким кодом не найден');
            if (!canCreate()) return err(m, 'Слишком много новых парков. Попробуйте позже.', { code: 'limit' });
            let park; try { park = cleanPark(id, m.park); } catch (e) { return err(m, e.message, { code: 'invalid' }); }
            const auth = await hashPin(String(m.pin), C.scryptN);
            if (parks.has(id)) return err(m, 'Парк уже существует');
            parks.set(id, { park, auth, ver: 1, born: Date.now() }); creates.get(ip).push(Date.now());
            saveNow(id); ws.auth.set(id, 1); ws.authPin = String(m.pin) + id; ws.parkId = id;
            return reply(m, { t: 'park', park: pub(park), self: true });
          }
          const a = await authorize(m, id);
          if (a === null) return;
          if (!a) return err(m, 'Неверный пароль', { code: 'badpin' });
          ws.parkId = id;
          if (m.park && (m.t === 'update' || (num(m.park.updated, 0) > (r.park.updated || 0)))) {
            let park; try { park = cleanPark(id, m.park); } catch (e) { return err(m, e.message, { code: 'invalid' }); }
            keepInbox(park, r.park);
            r.park = park; save(id);
            broadcast(id, { t: 'park', park: pub(park) }, ws);
          }
          return reply(m, { t: 'park', park: pub(r.park), self: true });
        }
        case 'open': {
          if (!ID_RE.test(id)) return err(m, 'Неверный код парка');
          const w0 = L.pinIp.wait('ip:' + ip);
          if (w0) return err(m, lockMsg(w0), { code: 'locked', retryIn: w0 });
          if (!parks.has(id)) { L.pinIp.fail('ip:' + ip); await checkPin('0000', null); return err(m, 'Парк с таким кодом не найден или неверный пароль', { code: 'badpin' }); }
          const a = await authorize(m, id);
          if (a === null) return;
          if (!a) return err(m, 'Парк с таким кодом не найден или неверный пароль', { code: 'badpin' });
          return reply(m, { t: 'park', park: pub(parks.get(id).park) });
        }
        case 'event': {
          if (!parks.has(id) || !m.ev || typeof m.ev !== 'object' || !EVENT_TYPES.has(m.ev.type)) return;
          if (JSON.stringify(m.ev).length > 32 * 1024) return;
          const a = await authorize(m, id); if (!a) return;
          return broadcast(id, { t: 'event', id, ev: m.ev }, ws);
        }
        case 'setpin': {
          const r = parks.get(id); if (!r) return err(m, 'Парк не найден');
          ws.auth.delete(id); // смена PIN — всегда со старым PIN
          const a = await authorize(m, id);
          if (a === null) return;
          if (!a) return err(m, 'Неверный текущий пароль', { code: 'badpin' });
          if (!PIN_RE.test(String(m.newPin || ''))) return err(m, 'Новый пароль: от 4 до 12 цифр');
          r.auth = await hashPin(String(m.newPin), C.scryptN); r.ver++;
          saveNow(id); ws.auth.set(id, r.ver); ws.authPin = String(m.newPin) + id;
          return reply(m, { t: 'ok' });
        }
        case 'delete': {
          if (!parks.has(id)) return reply(m, { t: 'ok' });
          const a = await authorize(m, id); if (a === null) return;
          if (!a) return err(m, 'Неверный пароль', { code: 'badpin' });
          clearTimeout(saveTimers.get(id)); saveTimers.delete(id);
          saveNow(id); parks.delete(id); trashPark(id);
          broadcast(id, { t: 'deleted', id }, ws);
          return reply(m, { t: 'ok' });
        }
        case 'tvcode': {
          if (!parks.has(id)) return err(m, 'Парк не найден');
          const a = await authorize(m, id); if (a === null) return;
          if (!a) return err(m, 'Неверный пароль', { code: 'badpin' });
          return reply(m, Object.assign({ t: 'tvcode' }, newTvCode(id)));
        }
        case 'tvjoin': {
          const w = L.tvIp.wait('ip:' + ip);
          if (w) return err(m, lockMsg(w), { code: 'locked', retryIn: w });
          const code = String(m.code || '');
          const rec = /^\d{5}$/.test(code) && tvCodes.get(code);
          if (!rec || rec.exp < Date.now() || !parks.has(rec.id)) { L.tvIp.fail('ip:' + ip); return err(m, 'Код не найден или истёк', { code: 'badcode' }); }
          L.tvIp.ok('ip:' + ip);
          const token = crypto.randomBytes(16).toString('hex'); tvTokens.set(token, { id: rec.id, exp: Date.now() + 7 * 24 * 3600 * 1000 });
          ws.parkId = rec.id;
          return reply(m, { t: 'park', park: pub(parks.get(rec.id).park), token });
        }
        case 'tvwatch': {
          const t = typeof m.token === 'string' && tvTokens.get(m.token);
          if (!t || t.id !== id || t.exp < Date.now() || !parks.has(id)) return err(m, 'Нужен новый код');
          ws.parkId = id; return reply(m, { t: 'park', park: pub(parks.get(id).park) });
        }
        case 'ref': { // новый парк пришёл по приглашению
          const ref = String(m.ref || '');
          if (!REF_RE.test(ref) || !parks.has(id)) return err(m, 'Неверное приглашение');
          if (!quota('ref', ip, C.maxRefPerHour)) return err(m, 'Слишком много приглашений. Попробуйте позже.', { code: 'limit' });
          const a = await authorize(m, id); if (a === null) return;
          if (!a) return err(m, 'Неверный пароль', { code: 'badpin' });
          const r = parks.get(id), born = r.born || num(r.park.created, 0);
          if (refs.byPark[id]) return reply(m, { t: 'ok', ok: true, dup: true });
          if (Date.now() - born > 48 * 3600 * 1000) return err(m, 'Приглашение действует только для новых парков');
          if ((r.park.life && r.park.life.refBy) !== ref) return err(m, 'Неверное приглашение');
          refs.byPark[id] = ref; refs.pending[ref] = Math.min(50, (refs.pending[ref] || 0) + 1); saveRefs();
          return reply(m, { t: 'ok', ok: true });
        }
        case 'refclaim': { // пригласивший забирает награду: доказывает владение ключом, из которого получен код
          const key = String(m.key || '');
          if (!/^[0-9a-f]{32}$/.test(key)) return err(m, 'Неверный ключ');
          if (!quota('refclaim', ip, 60)) return err(m, 'Слишком часто', { code: 'limit' });
          const ref = crypto.createHash('sha256').update('dp-ref:' + key).digest('hex').slice(0, 10);
          const n = Math.min(10, refs.pending[ref] || 0);
          if (n) { refs.pending[ref] -= n; if (!refs.pending[ref]) delete refs.pending[ref]; refs.claimed[ref] = (refs.claimed[ref] || 0) + n; saveRefs(); }
          return reply(m, { t: 'ok', ok: true, n });
        }
        case 'redeem': { // подарочный код: проверка подписи и одноразовости
          const w = L.redeemIp.wait('ip:' + ip);
          if (w) return err(m, lockMsg(w), { code: 'locked', retryIn: w });
          if (!parks.has(id)) return err(m, 'Парк не найден');
          const a = await authorize(m, id); if (a === null) return;
          if (!a) return err(m, 'Неверный пароль', { code: 'badpin' });
          let p; try { p = verifyGiftCode(m.code, PUBKEY, id); } catch (e) { L.redeemIp.fail('ip:' + ip); return err(m, e.message, { code: 'badcode' }); }
          if (redeemed.has(p.n)) { L.redeemIp.fail('ip:' + ip); return err(m, 'Этот код уже использован', { code: 'used' }); }
          redeemed.add(p.n); saveRedeemed();
          return reply(m, { t: 'ok', ok: true, g: cleanGift(p.g), m: str(p.m, 140) });
        }
        case 'feedback': {
          const text = str(m.text, 1000).trim();
          if (text.length < 3) return err(m, 'Пустое сообщение');
          if (!quota('fb', ip, C.maxFeedbackPerHour)) return err(m, 'Слишком много сообщений. Попробуйте позже.', { code: 'limit' });
          const rec = { t: new Date().toISOString(), text, contact: str(m.contact, 80), park: typeof m.park === 'string' && (ID_RE.test(m.park) || m.park === 'demo') ? m.park : '' };
          fs.mkdirSync(C.dataDir, { recursive: true });
          fs.appendFileSync(jsonFile('feedback.jsonl'), JSON.stringify(rec) + '\n');
          return reply(m, { t: 'ok', ok: true });
        }
        default: return err(m, 'Неизвестная команда');
      }
    }

    ws.on('message', (raw, isBinary) => {
      const now = Date.now();
      if (now - win > 10000) { win = now; count = 0; }
      if (++count > C.maxMsgPer10s) { try { ws.close(1008, 'too many messages'); } catch (e) { /* ignore */ } return; }
      if (isBinary) return;
      let m; try { m = JSON.parse(raw); } catch (e) { return err(null, 'Неверный JSON'); }
      if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return err(m && typeof m === 'object' ? m : null, 'Неверное сообщение');
      handle(m).catch((e) => { console.error('Ошибка обработки', e); err(m, 'Ошибка сервера'); });
    });
  });

  const timers = [
    setInterval(() => { wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }); }, 30000),
    setInterval(() => { Object.values(L).forEach(l => l.sweep()); const now = Date.now(); for (const [k, t] of tvTokens) if (t.exp < now) tvTokens.delete(k); }, 10 * 60 * 1000),
    setInterval(() => { try { collectGarbage(); } catch (e) { console.error(e); } }, 6 * 60 * 60 * 1000)
  ];
  timers.forEach(t => t.unref && t.unref());

  return {
    server, wss, parks, config: C, collectGarbage, flushAll,
    resetLimits() { Object.values(L).forEach(l => l.m.clear()); creates.clear(); hourly.clear(); },
    giveGift,
    async listen(port) {
      await migrateV1();
      try { collectGarbage(); } catch (e) { console.error(e); }
      await new Promise((res) => server.listen(port == null ? C.port : port, res));
      return server.address().port;
    },
    close() {
      timers.forEach(clearInterval); flushAll();
      wss.clients.forEach(c => c.terminate());
      return new Promise((res) => { wss.close(); server.close(() => res()); });
    }
  };
}

module.exports = { createServer, Limiter, hashPin, checkPin, writeAtomic, verifyGiftCode, validGift, loadPublicKey };

if (require.main === module) {
  const app = createServer();
  app.listen().then((port) => {
    console.log(`🦖 Динопарк запущен: http://localhost:${port}`);
    console.log(`📺 Экран телевизора: http://localhost:${port}/tv`);
  });
  const stop = () => { app.flushAll(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
