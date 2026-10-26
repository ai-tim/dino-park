/* Динопарк — подарки администратора без сервера (GitHub Pages).
 * Каждая запись ленты подписана закрытым ключом администратора (ECDSA P-256), игра проверяет её открытым
 * ключом ADMIN_PUBLIC_KEY из config.js — подделать запись нельзя, где бы она ни лежала.
 * Источники ленты (берутся все, повторы отбрасываются):
 *   1) gifts/feed.json в репозитории (надёжный, админка коммитит его через GitHub API) — с сайта и с raw.githubusercontent.com
 *      (там новая версия видна сразу, без ожидания сборки Pages);
 *   2) retained-сообщения на публичных MQTT-брокерах из relay.js (появляются мгновенно, но брокеры их могут потерять);
 *   3) локальная копия уже проверенных записей (localStorage) — чтобы код работал и без сети.
 * Виды записей (t): 'code' — короткий код DINO-XXXX-XXXX (в ленте только PBKDF2-хеш кода; u: 'once' — один раз
 * на устройстве, 'multi' — один раз в каждом парке), 'all' — подарок всем паркам (каждый парк получает один раз),
 * 'park' — сюрприз одному парку (p — код парка), 'revoke' — отмена записи ref.
 * Copyright (c) 2026 Юрий Власенко. Все права защищены. */
'use strict';
(function () {
  const DP = window.DP = window.DP || {};
  const ALPH = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // без 0/O, 1/I/L, U — их легко перепутать
  const TOPIC = 'dinopark/gifts1/', CACHE = 'dp_gfeed', SALT = 'dinopark-gift-v1', ITER = 100000, MAX = 400;
  const KINDS = { code: 1, all: 1, park: 1, revoke: 1 };
  const utf8 = (s) => new TextEncoder().encode(s);
  const b64u = {
    enc(bytes) { let s = ''; bytes = new Uint8Array(bytes); for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
    dec(str) { str = String(str).replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; const s = atob(str), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  };
  const hex = (u) => Array.prototype.map.call(new Uint8Array(u), (b) => (b < 16 ? '0' : '') + b.toString(16)).join('');
  const cfg = () => window.DP_CONFIG || {};
  const subtle = () => (window.crypto && crypto.subtle) || window.DP_SUBTLE;
  const now = () => Date.now();
  const MQ_AT = 'dp_gmq_at';

  // ——— короткие коды ———
  function normCode(s) {
    s = String(s || '').toUpperCase().replace(/[\s\-_.–—]/g, '');
    if (s.indexOf('DINO') === 0) s = s.slice(4);
    s = s.replace(/O/g, '0'); // «О» вместо нуля — всё равно не наш символ, пусть сообщение будет «проверь код»
    return /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(s) ? s : null;
  }
  const looksShort = (s) => /^\s*(DINO[\s\-]*)?[A-Za-z0-9]{4}[\s\-]*[A-Za-z0-9]{4}\s*$/i.test(String(s || ''));
  const fmtCode = (c8) => 'DINO-' + c8.slice(0, 4) + '-' + c8.slice(4);
  function newCode() {
    let out = '';
    while (out.length < 8) { const b = new Uint8Array(16); crypto.getRandomValues(b); for (let i = 0; i < b.length && out.length < 8; i++) if (b[i] < 240) out += ALPH[b[i] % 30]; }
    return out;
  }
  /** Хеш кода для ленты: PBKDF2 100 000 раз — перебор всех ~6,6·10¹¹ кодов по опубликованной ленте занял бы годы */
  async function codeHash(c8) {
    const S = subtle(), base = await S.importKey('raw', utf8('DINO-' + c8), { name: 'PBKDF2' }, false, ['deriveBits']);
    return hex(await S.deriveBits({ name: 'PBKDF2', salt: utf8(SALT), iterations: ITER, hash: 'SHA-256' }, base, 128));
  }

  // ——— подписи ———
  let keyP = null, keyFor = null;
  function pubKey() {
    const k = cfg().ADMIN_PUBLIC_KEY; if (!k || !subtle()) return Promise.resolve(null);
    const id = k.x + '.' + k.y; if (keyP && keyFor === id) return keyP;
    keyFor = id; keyP = subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: k.x, y: k.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']).catch(() => null);
    return keyP;
  }
  /** Короткий отпечаток открытого ключа — часть темы MQTT (у другого ключа — своя лента) */
  async function fingerprint(pub) {
    pub = pub || cfg().ADMIN_PUBLIC_KEY; if (!pub) return null;
    return hex(await subtle().digest('SHA-256', utf8(pub.x + '.' + pub.y))).slice(0, 16);
  }
  function validPayload(p) {
    if (!p || p.v !== 1 || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(p.id) || !KINDS[p.t]) return false;
    if (p.e != null && typeof p.e !== 'number') return false;
    if (p.t === 'revoke') return typeof p.ref === 'string';
    if (p.m != null && (typeof p.m !== 'string' || p.m.length > 200)) return false;
    if (p.t === 'code' && !(typeof p.h === 'string' && /^[0-9a-f]{32}$/.test(p.h) && (p.u === 'once' || p.u === 'multi'))) return false;
    if (p.t === 'park' && !(typeof p.p === 'string' && /^[a-z0-9]{6,16}$/.test(p.p))) return false;
    return DP.Life && DP.Life.validGift ? DP.Life.validGift(p.g) : !!(p.g && p.g.k);
  }
  async function verifyEntry(e) {
    if (!e || typeof e.b !== 'string' || typeof e.s !== 'string' || e.b.length > 3000 || e.s.length > 200) return null;
    const key = await pubKey(); if (!key) return null;
    try {
      const ok = await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64u.dec(e.s), utf8('DPG1.' + e.b));
      if (!ok) return null;
      const p = JSON.parse(new TextDecoder().decode(b64u.dec(e.b)));
      return validPayload(p) ? p : null;
    } catch (er) { return null; }
  }
  async function signEntry(privKey, payload) {
    const b = b64u.enc(utf8(JSON.stringify(payload)));
    const s = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, utf8('DPG1.' + b));
    return { b, s: b64u.enc(s) };
  }
  const newId = () => { const b = new Uint8Array(12); crypto.getRandomValues(b); return b64u.enc(b); };

  // ——— сбор ленты ———
  function feedUrls() {
    const c = cfg(); if (Array.isArray(c.GIFTS_FEEDS)) return c.GIFTS_FEEDS;
    const list = ['gifts/feed.json'];
    if (c.GIFTS_REPO) list.push('https://raw.githubusercontent.com/' + c.GIFTS_REPO + '/' + (c.GIFTS_BRANCH || 'main') + '/gifts/feed.json');
    return list;
  }
  function withTimeout(p, ms) { return Promise.race([p, new Promise((res) => setTimeout(() => res(null), ms))]); }
  async function fetchFeed(url) {
    try {
      const r = await withTimeout(fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Math.floor(now() / 30000), { cache: 'no-store' }), 7000);
      if (!r || !r.ok) return [];
      const j = await r.json(); return j && Array.isArray(j.entries) ? j.entries : [];
    } catch (e) { return []; }
  }
  async function fetchMqtt(ms, opts0) {
    opts0 = opts0 || {};
    const R = DP.relay; if (!R || !R.subRaw || !R.supported || !R.supported() || !cfg().ADMIN_PUBLIC_KEY) return [];
    const fp = await fingerprint(); if (!fp) return [];
    // Брокеры уже открыты (подключены ТВ) — слушаем бесплатно. Иначе открываем ненадолго и не чаще раза в 20 минут
    // (opts.force — игрок вводит код, которого нет в ленте), потом закрываем: главный источник — gifts/feed.json.
    const wasOn = R.hub.conns.length > 0;
    if (!wasOn && !opts0.force) { let t = 0; try { t = Number(localStorage.getItem(MQ_AT)) || 0; } catch (e) { /* ignore */ } if (now() - t < 20 * 60e3) return []; }
    if (!wasOn) { try { localStorage.setItem(MQ_AT, String(now())); } catch (e) { /* ignore */ } }
    R.hub.start(); if (!R.hub.conns.length && !opts0.keepOpen) return [];
    const got = [];
    const off = R.subRaw(TOPIC + fp + '/+', (s) => { if (s && got.length < MAX) { try { got.push(JSON.parse(s)); } catch (e) { /* мусор */ } } });
    await new Promise((res) => setTimeout(res, ms));
    off();
    if (!wasOn && R.hub.stop && !(R.hub.inUse && R.hub.inUse()) && !R.hub.raws.length) R.hub.stop();
    return got;
  }
  const readCache = () => { try { const c = JSON.parse(localStorage.getItem(CACHE) || '[]'); return Array.isArray(c) ? c : []; } catch (e) { return []; } };
  /** Собрать и проверить ленту. opts.mqttMs — сколько ждать retained-сообщения (0 — не ждать брокеры) */
  async function collect(opts) {
    opts = opts || {};
    const cache = readCache();
    const [feeds, mq] = await Promise.all([Promise.all(feedUrls().map(fetchFeed)), opts.mqttMs === 0 ? [] : fetchMqtt(opts.mqttMs || 5000, opts)]);
    const raw = [], seen = {}, src = { feed: 0, mqtt: mq.length, cache: cache.length };
    const add = (e) => { if (e && typeof e.b === 'string' && !seen[e.b] && raw.length < MAX) { seen[e.b] = 1; raw.push(e); } };
    feeds.forEach((l) => { src.feed += l.length; l.forEach(add); }); mq.forEach(add); cache.forEach(add); (opts.extra || []).forEach(add);
    const ok = [], keep = [], revoked = {};
    for (const e of raw) { const p = await verifyEntry(e); if (!p) continue; if (p.e && now() > p.e + 864e5) continue; ok.push(p); keep.push(e); if (p.t === 'revoke') revoked[p.ref] = 1; }
    try { localStorage.setItem(CACHE, JSON.stringify(keep.slice(-MAX))); } catch (e) { /* место кончилось */ }
    const list = ok.filter((p) => p.t !== 'revoke' && !revoked[p.id]);
    return { list, revoked, src, verified: ok.length, raw: raw.length };
  }
  let last = null;
  function load(opts) { last = collect(opts); return last; }
  const expired = (p) => !!(p.e && now() > p.e);
  /** Подарки, которые этот парк должен получить сам при открытии: «всем» и «сюрприз этому парку» */
  function pending(park, list) {
    const done = (park.life && park.life.redeemed) || [];
    return list.filter((p) => (p.t === 'all' || (p.t === 'park' && p.p === park.id)) && !expired(p) && done.indexOf(p.id) < 0)
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  }
  /** Найти запись короткого кода; если в известной ленте нет — перезагружаем ленту (код могли только что выпустить) */
  async function findCode(code) {
    const c8 = normCode(code); if (!c8) throw new Error('Код выглядит так: DINO-XXXX-XXXX — проверь буквы и цифры');
    if (!subtle()) throw new Error('Проверка кодов недоступна в этом браузере');
    const h = await codeHash(c8);
    const look = (r) => r.list.find((p) => p.t === 'code' && p.h === h);
    let r = await (last || load({ mqttMs: 3000 })), p = look(r);
    if (!p) { r = await load({ mqttMs: 5000, force: true }); p = look(r); }
    if (!p) throw new Error('Такого кода нет. Проверь буквы и цифры — или код ещё не опубликован (подожди пару минут)');
    if (expired(p)) throw new Error('Срок действия кода истёк');
    return p;
  }

  // ——— публикация (админка) ———
  async function publishMqtt(entry, id, waitMs) {
    const R = DP.relay; if (!R || !R.retain) return { n: 0, of: 0 };
    const fp = await fingerprint(); R.hub.start();
    if (!R.hub.conns.length) return { n: 0, of: 0 };
    await R.hub.ready(waitMs || 9000);
    await new Promise((res) => setTimeout(res, 1500)); // даём подключиться остальным брокерам
    const n = R.retain(TOPIC + fp + '/' + id, entry ? JSON.stringify(entry) : '');
    return { n, of: R.hub.conns.length, online: R.hub.online() };
  }
  const ghHeaders = (token) => ({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  const ghPath = (repo) => 'https://api.github.com/repos/' + repo + '/contents/gifts/feed.json';
  const unb64utf8 = (s) => decodeURIComponent(escape(atob(String(s).replace(/\s/g, ''))));
  const b64utf8 = (s) => btoa(unescape(encodeURIComponent(s)));
  async function ghRead(token, repo, branch) {
    const r = await fetch(ghPath(repo) + '?ref=' + encodeURIComponent(branch || 'main') + '&t=' + now(), { headers: ghHeaders(token), cache: 'no-store' });
    if (r.status === 404) return { sha: null, feed: { v: 1, entries: [] } };
    if (r.status === 401) throw new Error('GitHub не принял токен (неверный или истёк)');
    if (r.status === 403) throw new Error('У токена нет доступа к репозиторию ' + repo);
    if (!r.ok) throw new Error('GitHub: ошибка ' + r.status);
    const j = await r.json(); let feed;
    try { feed = JSON.parse(unb64utf8(j.content)); } catch (e) { feed = { v: 1, entries: [] }; }
    if (!Array.isArray(feed.entries)) feed.entries = [];
    return { sha: j.sha, feed };
  }
  /** Добавить записи в gifts/feed.json одним коммитом (повтор при конфликте); просроченные записи удаляем */
  async function ghPublish(token, repo, branch, entries, msg) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await ghRead(token, repo, branch), have = {};
      const kept = [];
      for (const e of cur.feed.entries) { const p = await verifyEntry(e); if (p && p.e && now() > p.e + 7 * 864e5) continue; if (!have[e.b]) { have[e.b] = 1; kept.push(e); } }
      entries.forEach((e) => { if (!have[e.b]) { have[e.b] = 1; kept.push(e); } });
      const body = { message: msg || 'Подарки: обновление ленты', content: b64utf8(JSON.stringify({ v: 1, entries: kept }, null, 1) + '\n'), branch: branch || 'main' };
      if (cur.sha) body.sha = cur.sha;
      const r = await fetch(ghPath(repo), { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(token)), body: JSON.stringify(body) });
      if (r.ok) return { ok: true, count: kept.length };
      if (r.status === 409 || r.status === 422) continue; // кто-то успел поменять файл — перечитываем
      if (r.status === 401) throw new Error('GitHub не принял токен (неверный или истёк)');
      if (r.status === 403 || r.status === 404) throw new Error('У токена нет права записи (Contents: Read and write) в ' + repo);
      throw new Error('GitHub: ошибка ' + r.status);
    }
    throw new Error('GitHub: не удалось записать файл, попробуй ещё раз');
  }

  DP.Gifts = { normCode, looksShort, fmtCode, newCode, codeHash, verifyEntry, signEntry, newId, fingerprint, collect, load, pending, findCode, expired, publishMqtt, ghRead, ghPublish, feedUrls, TOPIC, ITER, _b64u: b64u };
})();
