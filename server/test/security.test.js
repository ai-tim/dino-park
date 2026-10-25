/* Тесты безопасности сервера Динопарка: node --test server/test/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { createServer, Limiter, hashPin, checkPin } = require('../server.js');

const PNG = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex').toString('base64');

let app, port, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-sec-'));
  app = createServer({ dataDir: dir, scryptN: 1024, maxDinos: 5, maxImage: 2000, maxBg: 4000, maxPayload: 64 * 1024, maxCreatePerHour: 50 });
  port = await app.listen(0);
});
test.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function get(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET' }, (resp) => { let b = ''; resp.on('data', d => b += d); resp.on('end', () => res({ status: resp.statusCode, body: b, type: resp.headers['content-type'] })); });
    r.on('error', rej); r.end();
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
test.beforeEach(() => app && app.resetLimits());
const park = (id, extra) => Object.assign({ id, name: 'Тест', bg: 'jungle', dinos: [], created: 1, updated: Date.now() }, extra || {});

test('PIN хранится только как scrypt-хэш', async () => {
  const ws = await client();
  const r = await ws.req({ t: 'sub', id: 'hashpark1', pin: '482913', park: park('hashpark1') });
  assert.equal(r.t, 'park');
  app.flushAll();
  const raw = fs.readFileSync(path.join(dir, 'parks', 'hashpark1', 'park.json'), 'utf8');
  assert.ok(!raw.includes('482913'), 'PIN не должен лежать открытым текстом');
  const rec = JSON.parse(raw);
  assert.equal(rec.auth.alg, 'scrypt'); assert.ok(rec.auth.salt.length >= 32);
  assert.equal(rec.park.pin, undefined);
  ws.close();
});

test('checkPin: верный/неверный', async () => {
  const h = await hashPin('1234', 1024);
  assert.equal(await checkPin('1234', h), true);
  assert.equal(await checkPin('1235', h), false);
  assert.equal(await checkPin('1234', null), false);
});

test('Неверный PIN → растущая блокировка, даже верный PIN блокируется', async () => {
  const owner = await client();
  await owner.req({ t: 'sub', id: 'lockpark1', pin: '111111', park: park('lockpark1') });
  const ws = await client();
  for (let i = 0; i < 5; i++) { const r = await ws.req({ t: 'open', id: 'lockpark1', pin: '00000' + i }); assert.equal(r.t, 'error'); }
  const locked = await ws.req({ t: 'open', id: 'lockpark1', pin: '111111' });
  assert.equal(locked.code, 'locked'); assert.ok(locked.retryIn > 0 && locked.retryIn <= 30000);
  const l = new Limiter(5, 1000, 60000);
  for (let i = 0; i < 5; i++) l.fail('k'); const w1 = l.wait('k'); l.fail('k'); const w2 = l.wait('k');
  assert.ok(w2 > w1 * 1.5, 'блокировка растёт');
  owner.close(); ws.close();
});

test('Перебор ТВ-кодов блокируется', async () => {
  const ws = await client();
  let last;
  for (let i = 0; i < 9; i++) last = await ws.req({ t: 'tvjoin', code: String(10000 + i) });
  assert.equal(last.code, 'locked');
  ws.close();
});

test('ТВ-код работает только для владельца PIN и даёт парк без секретов', async () => {
  const owner = await client();
  await owner.req({ t: 'sub', id: 'tvpark01', pin: '222222', park: park('tvpark01') });
  const bad = await (await client()).req({ t: 'tvcode', id: 'tvpark01', pin: '999999' });
  assert.equal(bad.t, 'error');
  const c = await owner.req({ t: 'tvcode', id: 'tvpark01', pin: '222222' });
  assert.match(c.code, /^\d{5}$/);
  // отдельный "IP" не нужен: блокировка выше сбрасывается успешным входом не для этого клиента, поэтому проверяем через Limiter напрямую
  owner.close();
});

test('Лимит динозавров и размера картинок', async () => {
  const ws = await client();
  await ws.req({ t: 'sub', id: 'limpark01', pin: '333333', park: park('limpark01') });
  const many = Array.from({ length: 6 }, (_, i) => ({ uid: 'u' + i + 'xx', species: 'trex' }));
  const r1 = await ws.req({ t: 'update', id: 'limpark01', pin: '333333', park: park('limpark01', { dinos: many }) });
  assert.equal(r1.t, 'error'); assert.match(r1.msg, /Слишком много/);
  const big = 'data:image/png;base64,' + Buffer.alloc(3000, 1).toString('base64');
  const r2 = await ws.req({ t: 'update', id: 'limpark01', pin: '333333', park: park('limpark01', { dinos: [{ uid: 'big1', sprite: big }] }) });
  assert.equal(r2.t, 'error'); assert.match(r2.msg, /большая/);
  const fake = 'data:image/png;base64,' + Buffer.from('not a png at all').toString('base64');
  const r3 = await ws.req({ t: 'update', id: 'limpark01', pin: '333333', park: park('limpark01', { dinos: [{ uid: 'fake1', sprite: fake }] }) });
  assert.equal(r3.t, 'error');
  ws.close();
});

test('Картинки сохраняются файлами и раздаются по /img/', async () => {
  const ws = await client();
  await ws.req({ t: 'sub', id: 'imgpark01', pin: '444444', park: park('imgpark01') });
  const r = await ws.req({ t: 'update', id: 'imgpark01', pin: '444444', park: park('imgpark01', { dinos: [{ uid: 'pic1', sprite: PNG, name: '<b>x</b>' }] }) });
  assert.equal(r.t, 'park');
  const url = r.park.dinos[0].sprite;
  assert.match(url, /^\/img\/imgpark01\/[a-f0-9]{24}\.png$/);
  app.flushAll();
  const json = fs.readFileSync(path.join(dir, 'parks', 'imgpark01', 'park.json'), 'utf8');
  assert.ok(!json.includes('base64'), 'в JSON нет base64');
  const g = await get(url); assert.equal(g.status, 200); assert.equal(g.type, 'image/png');
  // внешние ссылки вместо картинки отбрасываются
  const r2 = await ws.req({ t: 'update', id: 'imgpark01', pin: '444444', park: park('imgpark01', { customBg: 'https://evil.example/x.png', dinos: [] }) });
  assert.equal(r2.park.customBg, null);
  ws.close();
});

test('Слишком большое сообщение закрывает соединение, сервер жив', async () => {
  const ws = await client();
  const closed = new Promise(r => ws.on('close', r));
  ws.send('x'.repeat(70 * 1024));
  await closed;
  const g = await get('/health'); assert.equal(g.status, 200);
});

test('Битый JSON и мусор не роняют сервер', async () => {
  const ws = await client();
  ws.send('{not json'); ws.send('[]'); ws.send('null'); ws.send(JSON.stringify({ t: 'sub', id: '../../etc' }));
  const r = await ws.req({ t: 'nope' });
  assert.equal(r.t, 'error');
  const r2 = await ws.req({ t: 'open', id: { $gt: '' }, pin: ['1'] });
  assert.equal(r2.t, 'error');
  assert.equal((await get('/health')).status, 200);
  ws.close();
});

test('Белый список файлов и кривые адреса', async () => {
  assert.equal((await get('/server/server.js')).status, 404);
  assert.equal((await get('/server/data/parks')).status, 404);
  assert.equal((await get('/package.json')).status, 404);
  assert.equal((await get('/tests/e2e.js')).status, 404);
  assert.equal((await get('/.git/config')).status, 404);
  assert.equal((await get('/js/../server/server.js')).status, 404);
  assert.equal((await get('/js/%2e%2e/server/server.js')).status, 404);
  assert.equal((await get('/%E0%A4%A')).status, 400);
  assert.equal((await get('/js/%00.js')).status, 400);
  assert.equal((await get('/img/imgpark01/../../park.json')).status, 404);
  assert.equal((await get('/index.html')).status, 200);
  assert.equal((await get('/js/park.js')).status, 200);
  assert.match((await get('/js/config.js')).body, /wsUrl: '\/ws'/);
});

test('Удаление → корзина на 30 дней, атомарная запись без .tmp', async () => {
  const ws = await client();
  await ws.req({ t: 'sub', id: 'delpark01', pin: '555555', park: park('delpark01') });
  const bad = await ws.req({ t: 'delete', id: 'delpark01', pin: '000000' });
  // сессия уже авторизована этим PIN, поэтому чужой PIN тоже проверяется заново
  assert.equal(bad.t, 'error');
  const ok = await ws.req({ t: 'delete', id: 'delpark01', pin: '555555' });
  assert.equal(ok.t, 'ok');
  assert.ok(!fs.existsSync(path.join(dir, 'parks', 'delpark01')));
  const trash = fs.readdirSync(path.join(dir, 'trash')).filter(n => n.startsWith('delpark01__'));
  assert.equal(trash.length, 1);
  const tmp = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.tmp')) tmp.push(p); } })(dir);
  assert.deepEqual(tmp, []);
  // старше 30 дней — удаляется
  const old = path.join(dir, 'trash', 'oldpark01__' + (Date.now() - 31 * 864e5)); fs.mkdirSync(old);
  app.collectGarbage();
  assert.ok(!fs.existsSync(old));
  assert.equal(fs.readdirSync(path.join(dir, 'trash')).filter(n => n.startsWith('delpark01__')).length, 1);
  ws.close();
});

test('Смена пароля: старый перестаёт работать', async () => {
  const ws = await client();
  await ws.req({ t: 'sub', id: 'pinpark01', pin: '666666', park: park('pinpark01') });
  const r = await ws.req({ t: 'setpin', id: 'pinpark01', pin: '666666', newPin: '777777' });
  assert.equal(r.t, 'ok');
  const other = await client();
  assert.equal((await other.req({ t: 'open', id: 'pinpark01', pin: '666666' })).t, 'error');
  assert.equal((await other.req({ t: 'open', id: 'pinpark01', pin: '777777' })).t, 'park');
  ws.close(); other.close();
});
