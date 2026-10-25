/* Тесты v3: жизнь парка, подарочные коды, приглашения, обратная связь, админ-подарки. node --test server/test/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');
const { createServer, loadPublicKey } = require('../server.js');

// Тестовая пара ключей (не настоящая админская)
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pubJwk = publicKey.export({ format: 'jwk' });
function makeCode(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign('sha256', Buffer.from('DP1.' + b), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `DP1.${b}.${sig}`;
}
const TOKEN = 'test-admin-token-123456';
let app, port, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-v3-'));
  app = createServer({ dataDir: dir, scryptN: 1024, maxCreatePerHour: 50, publicKeyJwk: pubJwk, adminToken: TOKEN, maxFeedbackPerHour: 3 });
  port = await app.listen(0);
});
test.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => app && app.resetLimits());

function req(method, p, body, headers) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, (resp) => { let b = ''; resp.on('data', d => b += d); resp.on('end', () => res({ status: resp.statusCode, body: b })); });
    r.on('error', rej); if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body)); r.end();
  });
}
function client() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let rid = 0; const pend = {}; ws.pushes = [];
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.rid && pend[m.rid]) { pend[m.rid](m); delete pend[m.rid]; } else ws.pushes.push(m); });
    ws.req = (m) => new Promise((r) => { m.rid = ++rid; pend[m.rid] = r; ws.send(JSON.stringify(m)); });
    ws.on('open', () => res(ws)); ws.on('error', rej);
  });
}
const park = (id, extra) => Object.assign({ id, name: 'Тест', bg: 'jungle', dinos: [], created: Date.now(), updated: Date.now() }, extra || {});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('config.js: настоящий файл + включение сервера; открытый ключ без закрытой части', async () => {
  const r = await req('GET', '/js/config.js');
  assert.match(r.body, /ADMIN_PUBLIC_KEY/);
  assert.match(r.body, /wsUrl: '\/ws', server: true/);
  assert.ok(!/"d"\s*:/.test(r.body), 'в config.js не должно быть закрытого ключа');
  assert.ok(loadPublicKey(path.resolve(__dirname, '..', '..')), 'ключ из js/config.js читается');
  assert.equal((await req('GET', '/admin.html')).status, 200);
});

test('Жизнь парка сохраняется и чистится', async () => {
  const ws = await client();
  const life = { eggs: { common: 3, rare: -5, epic: 'x', legend: 1 }, nest: [{ id: 'e1', k: 'egg', uid: 'dino1', r: 'rare', t: 1 }, { id: 'bad', k: 'evil' }],
    tribe: [{ id: 'a0', name: 'Ук'.repeat(20), xp: 100, sk: ['walk', 'fire', '<script>'] }], hats: { cap: 2, evil: 5 }, stats: { feed: 4, __proto__x: 1 },
    inbox: [{ id: 'fake', g: { k: 'legend' } }], refBy: 'zzz', big: 'x'.repeat(1000) };
  const dinos = [{ uid: 'dino1', name: 'Рекс', care: 99, aff: 5, hat: 'crown', legend: true, eggN: 2 }, { uid: 'dino2', hat: 'evilhat', legend: 'yes' }];
  const r = await ws.req({ t: 'sub', id: 'lifepark1', pin: '1234', park: park('lifepark1', { life, dinos }) });
  assert.equal(r.t, 'park');
  const L = r.park.life;
  assert.deepEqual(L.eggs, { common: 3, rare: 0, epic: 0, legend: 1 });
  assert.equal(L.nest.length, 1);
  assert.equal(L.tribe[0].name.length, 12); assert.deepEqual(L.tribe[0].sk, ['walk', 'fire']);
  assert.deepEqual(L.hats, { cap: 2 });
  assert.deepEqual(L.inbox, [], 'клиент не может сам положить подарок в ящик');
  assert.equal(L.refBy, undefined); assert.equal(L.big, undefined);
  assert.equal(r.park.dinos[0].care, 30); assert.equal(r.park.dinos[0].hat, 'crown'); assert.equal(r.park.dinos[0].legend, true);
  assert.equal(r.park.dinos[1].hat, undefined); assert.equal(r.park.dinos[1].legend, undefined);
  ws.close();
});

test('Подарочный код: подпись, одноразовость, чужой парк, срок', async () => {
  const ws = await client();
  await ws.req({ t: 'sub', id: 'codepark1', pin: '1234', park: park('codepark1') });
  const code = makeCode({ n: 'nonce-' + Date.now(), g: { k: 'eggs', r: 'rare', q: 3 }, m: 'С праздником!' });
  const ok = await ws.req({ t: 'redeem', id: 'codepark1', pin: '1234', code });
  assert.equal(ok.ok, true); assert.deepEqual(ok.g, { k: 'eggs', r: 'rare', q: 3 }); assert.equal(ok.m, 'С праздником!');
  const again = await ws.req({ t: 'redeem', id: 'codepark1', pin: '1234', code });
  assert.equal(again.t, 'error'); assert.equal(again.code, 'used');
  // подделка: другой payload с той же подписью
  const [, , sig] = code.split('.');
  const forged = 'DP1.' + Buffer.from(JSON.stringify({ n: 'forged1', g: { k: 'eggs', r: 'legend', q: 50 } })).toString('base64url') + '.' + sig;
  assert.equal((await ws.req({ t: 'redeem', id: 'codepark1', pin: '1234', code: forged })).code, 'badcode');
  // чужой ключ
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const b = Buffer.from(JSON.stringify({ n: 'otherkey1', g: { k: 'legend' } })).toString('base64url');
  const bad = `DP1.${b}.${crypto.sign('sha256', Buffer.from('DP1.' + b), { key: other, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  assert.equal((await ws.req({ t: 'redeem', id: 'codepark1', pin: '1234', code: bad })).code, 'badcode');
  assert.match((await ws.req({ t: 'redeem', id: 'codepark1', pin: '1234', code: makeCode({ n: 'forother1', g: { k: 'legend' }, p: 'zzzzzz1' }) })).msg, /другого парка/);
  assert.match((await ws.req({ t: 'redeem', id: 'codepark1', pin: '1234', code: makeCode({ n: 'expired1', g: { k: 'legend' }, e: Date.now() - 1000 }) })).msg, /истёк/);
  assert.equal((await ws.req({ t: 'redeem', id: 'codepark1', pin: '9999', code: makeCode({ n: 'badpin01', g: { k: 'legend' } }) })).code, 'badpin');
  // одноразовость переживает перезапуск
  app.flushAll();
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'redeemed.json'), 'utf8')).length >= 1);
  ws.close();
});

test('Перебор подарочных кодов блокируется', async () => {
  const ws = await client();
  await ws.req({ t: 'sub', id: 'brutepk1', pin: '1234', park: park('brutepk1') });
  let last;
  for (let i = 0; i < 12; i++) last = await ws.req({ t: 'redeem', id: 'brutepk1', pin: '1234', code: 'DP1.' + 'A'.repeat(20) + '.' + 'B'.repeat(86) });
  assert.equal(last.code, 'locked');
  ws.close();
});

test('Приглашения: только новый парк, один раз, награда только владельцу ключа', async () => {
  const key = crypto.randomBytes(16).toString('hex');
  const ref = crypto.createHash('sha256').update('dp-ref:' + key).digest('hex').slice(0, 10);
  const ws = await client();
  await ws.req({ t: 'sub', id: 'friendp1', pin: '1234', park: park('friendp1', { life: { refBy: ref } }) });
  assert.equal((await ws.req({ t: 'ref', id: 'friendp1', pin: '1234', ref })).ok, true);
  assert.equal((await ws.req({ t: 'ref', id: 'friendp1', pin: '1234', ref })).dup, true, 'второй раз не считается');
  assert.equal((await ws.req({ t: 'ref', id: 'friendp1', pin: '0000', ref: 'aaaaaaaaaa' })).t, 'error');
  // парк без refBy не может «пригласиться» к кому угодно
  await ws.req({ t: 'sub', id: 'friendp2', pin: '1234', park: park('friendp2') });
  assert.equal((await ws.req({ t: 'ref', id: 'friendp2', pin: '1234', ref })).t, 'error');
  assert.equal((await ws.req({ t: 'refclaim', key: crypto.randomBytes(16).toString('hex') })).n, 0);
  assert.equal((await ws.req({ t: 'refclaim', key })).n, 1);
  assert.equal((await ws.req({ t: 'refclaim', key })).n, 0, 'награда выдаётся один раз');
  assert.equal((await ws.req({ t: 'refclaim', key: 'nothex' })).t, 'error');
  ws.close();
});

test('Обратная связь: сохраняется в файл, лимит по IP', async () => {
  const ws = await client();
  assert.equal((await ws.req({ t: 'feedback', text: 'Очень нравится! Добавьте ещё шапок', contact: '@mama', park: 'demo' })).ok, true);
  assert.equal((await ws.req({ t: 'feedback', text: '' })).t, 'error');
  await ws.req({ t: 'feedback', text: 'два' + '!'.repeat(3) }); await ws.req({ t: 'feedback', text: 'три!!' });
  assert.equal((await ws.req({ t: 'feedback', text: 'четыре' })).code, 'limit');
  const lines = fs.readFileSync(path.join(dir, 'feedback.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines[0].contact, '@mama'); assert.equal(lines.length, 3);
  ws.close();
});

test('Админ-подарок: токен обязателен, подарок попадает в ящик и приходит клиенту', async () => {
  const ws = await client();
  await ws.req({ t: 'sub', id: 'adminpk1', pin: '1234', park: park('adminpk1') });
  assert.equal((await req('POST', '/api/admin/gift', { park: 'adminpk1', gift: { k: 'legend' } })).status, 401);
  assert.equal((await req('POST', '/api/admin/gift', { park: 'adminpk1', gift: { k: 'legend' } }, { Authorization: 'Bearer wrong-token-xx' })).status, 401);
  assert.equal((await req('POST', '/api/admin/gift', { park: 'adminpk1', gift: { k: 'eggs', r: 'legend', q: 999 } }, { Authorization: 'Bearer ' + TOKEN })).status, 400);
  assert.equal((await req('POST', '/api/admin/gift', '{bad', { Authorization: 'Bearer ' + TOKEN })).status, 400);
  const r = await req('POST', '/api/admin/gift', { park: 'adminpk1', gift: { k: 'hat', h: 'crown' }, msg: 'Спасибо!' }, { Authorization: 'Bearer ' + TOKEN });
  assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).given, 1);
  await sleep(100);
  const push = ws.pushes.find(m => m.t === 'park');
  assert.ok(push, 'клиент получил обновление');
  const it = push.park.life.inbox[0];
  assert.deepEqual(it.g, { k: 'hat', h: 'crown' }); assert.equal(it.m, 'Спасибо!');
  // клиент подтвердил (ack) — ящик пустеет; без ack — подарок остаётся
  const p2 = Object.assign({}, push.park, { updated: Date.now(), life: Object.assign({}, push.park.life, { inbox: [] }) });
  let u = await ws.req({ t: 'update', id: 'adminpk1', pin: '1234', park: p2 });
  assert.equal(u.park.life.inbox.length, 1);
  p2.life.ack = [it.id]; p2.updated = Date.now();
  u = await ws.req({ t: 'update', id: 'adminpk1', pin: '1234', park: p2 });
  assert.equal(u.park.life.inbox.length, 0);
  // перебор токена блокируется
  let last; for (let i = 0; i < 7; i++) last = await req('POST', '/api/admin/gift', { park: 'adminpk1', gift: { k: 'legend' } }, { Authorization: 'Bearer nope-nope-' + i });
  assert.equal(last.status, 429);
  // другие POST по-прежнему запрещены
  assert.equal((await req('POST', '/index.html', {})).status, 405);
  ws.close();
});

test('Без ADMIN_TOKEN админ-адрес выключен', async () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-v3b-'));
  const a2 = createServer({ dataDir: d2, scryptN: 1024, adminToken: '' });
  const p2 = await a2.listen(0);
  const r = await new Promise((res) => { const q = http.request({ host: '127.0.0.1', port: p2, path: '/api/admin/gift', method: 'POST' }, (s) => { s.resume(); res(s.statusCode); }); q.end('{}'); });
  assert.equal(r, 404);
  await a2.close(); fs.rmSync(d2, { recursive: true, force: true });
});
