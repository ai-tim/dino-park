/* Динопарк — подарки v2 без сервера: короткие коды DINO-XXXX-XXXX, «Отправить всем», «Сюрприз одному парку», отмена,
 * публикация через GitHub API (подменён) и MQTT retained (через hub.rawIn). WebKit как iPhone Safari.
 * Использование: BASE=http://127.0.0.1:8765 node tests/gifts.js   (обычный статический сервер с рабочей копией) */
const { webkit, devices } = require('playwright-core');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const results = []; const ok = (n, c, i) => { results.push(!!c); console.log((c ? '✅' : '❌') + ' ' + n + (i ? ' — ' + i : '')); };
const S = crypto.webcrypto.subtle;
const b64u = (b) => Buffer.from(b).toString('base64url');
(async () => {
  // тестовый ключ администратора (не настоящий): подменяем открытый ключ в config.js
  const kp = await S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await S.exportKey('jwk', kp.privateKey), pub = { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y };
  const sign = async (p, key) => { const b = b64u(JSON.stringify(p)); return { b, s: b64u(await S.sign({ name: 'ECDSA', hash: 'SHA-256' }, key || kp.privateKey, Buffer.from('DPG1.' + b))) }; };
  const hash = (c8) => crypto.pbkdf2Sync('DINO-' + c8, 'dinopark-gift-v1', 100000, 16, 'sha256').toString('hex');
  const nid = () => b64u(crypto.randomBytes(12));
  // «GitHub»: файл gifts/feed.json в памяти
  let feed = { v: 1, entries: [] }, sha = null, puts = 0, badAuth = 0;
  const TOKEN = 'github_pat_TEST_' + 'x'.repeat(30);
  const extra = []; // записи, которые подкладываем в ленту сами (истёкшие, поддельные)
  async function route(ctx) {
    await ctx.addInitScript(() => { window.DP_CONFIG = { RELAYS: [] }; }); // без настоящих брокеров — MQTT проверяем через hub.rawIn
    await ctx.route('**/js/config.js', async (r) => { const resp = await r.fetch(); let t = await resp.text(); t = t.replace(/ADMIN_PUBLIC_KEY:\s*\{[^}]*\}/, 'ADMIN_PUBLIC_KEY: ' + JSON.stringify(pub)); r.fulfill({ response: resp, body: t }); });
    const serveFeed = (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ v: 1, entries: feed.entries.concat(extra) }), headers: { 'Access-Control-Allow-Origin': '*' } });
    await ctx.route(/\/gifts\/feed\.json/, (r) => /api\.github\.com/.test(r.request().url()) ? r.fallback() : serveFeed(r));
    await ctx.route('https://api.github.com/**', async (r) => {
      const q = r.request(), u = q.url(), h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT' };
      if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: h });
      if ((q.headers().authorization || '') !== 'Bearer ' + TOKEN) { badAuth++; return r.fulfill({ status: 401, headers: h, body: '{}' }); }
      if (/\/repos\/ai-tim\/dino-park$/.test(u.split('?')[0])) return r.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ default_branch: 'main', permissions: { push: true } }) });
      if (/\/contents\/gifts\/feed\.json/.test(u)) {
        if (q.method() === 'GET') return sha ? r.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ sha, content: Buffer.from(JSON.stringify(feed)).toString('base64').replace(/(.{60})/g, '$1\n') }) }) : r.fulfill({ status: 404, headers: h, body: '{}' });
        const body = JSON.parse(q.postData());
        if ((body.sha || null) !== sha) return r.fulfill({ status: 409, headers: h, body: '{}' });
        feed = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')); sha = 's' + (++puts);
        return r.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) });
      }
      r.fulfill({ status: 404, headers: h, body: '{}' });
    });
  }
  const browser = await webkit.launch();
  const errs = [];
  // ——— админка (iPhone Safari) ———
  const actx = await browser.newContext({ ...devices['iPhone 13'] });
  await route(actx);
  await actx.addInitScript((k) => { localStorage.setItem('dp_admin_key', k); }, JSON.stringify(priv));
  const ap = await actx.newPage(); ap.on('pageerror', (e) => errs.push('admin: ' + e.message));
  ap.on('dialog', (d) => d.accept());
  await ap.goto(BASE + '/admin.html'); await ap.waitForTimeout(500);
  ok('админка: ключ совпадает — предупреждений нет', (await ap.textContent('#warn')).trim() === '', await ap.textContent('#warn'));
  ok('админка: три больших кнопки сверху', await ap.isVisible('#b-code') && await ap.isVisible('#b-all') && await ap.isVisible('#b-park'));
  ok('админка: ключ и сервер свёрнуты', !(await ap.isVisible('#key-gen')) && !(await ap.isVisible('#s-send')) && !(await ap.isVisible('#gh-token')));
  // GitHub: неверный токен → ошибка; верный → сохранён
  await ap.tap('#gh-sec summary'); await ap.fill('#gh-token', 'github_pat_WRONG_' + 'y'.repeat(30)); await ap.tap('#gh-save'); await ap.waitForSelector('#gh-msg .bad');
  ok('GitHub: неверный токен — понятная ошибка', /не принял токен/.test(await ap.textContent('#gh-msg')));
  await ap.fill('#gh-token', TOKEN); await ap.tap('#gh-save'); await ap.waitForSelector('#gh-msg .ok');
  const ghs = await ap.evaluate(() => JSON.parse(localStorage.getItem('dp_admin_gh')));
  ok('GitHub: токен сохранён только в localStorage, поле очищено', ghs.token === TOKEN && ghs.repo === 'ai-tim/dino-park' && (await ap.inputValue('#gh-token')) === '');
  await ap.tap('#gh-sec summary');
  const waitPub = async () => { await ap.waitForFunction(() => /Сохранено на GitHub|GitHub:/.test(document.querySelector('#g-out').textContent), null, { timeout: 30000 }); return ap.textContent('#g-out'); };
  // 1) два одноразовых кода: 2 редких яйца
  await ap.selectOption('#g-kind', 'eggs'); await ap.selectOption('#g-r', 'rare'); await ap.fill('#g-q', '2'); await ap.fill('#g-msg', 'Спасибо, что играешь!');
  await ap.tap('#b-code'); await ap.fill('#g-n', '2'); await ap.tap('#g-make');
  let t = await waitPub();
  const once = await ap.$$eval('#g-out .short', (els) => els.map((e) => e.textContent.trim()));
  const onceLinks = await ap.$$eval('#g-out a', (els) => els.map((e) => e.href));
  ok('одноразовые коды: 2 кода DINO-XXXX-XXXX и ссылки', once.length === 2 && once.every((c) => /^DINO-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/.test(c)) && onceLinks.every((l) => /park\.html\?gift=DP1\./.test(l)), once.join(' '));
  ok('опубликовано на GitHub (PUT), в файле только хеши', /Сохранено на GitHub/.test(t) && feed.entries.length === 2 && !JSON.stringify(feed).includes(once[0].slice(5, 9) + once[0].slice(10)), 'записей ' + feed.entries.length);
  // 2) код для всех: шапка-корона
  await ap.selectOption('#g-kind', 'hat'); await ap.selectOption('#g-h', 'crown'); await ap.fill('#g-msg', '');
  await ap.check('input[name="g-use"][value="multi"]'); await ap.tap('#g-make'); await waitPub();
  const multi = (await ap.textContent('#g-out .short')).trim();
  ok('код для всех создан', /^DINO-/.test(multi) && feed.entries.length === 3, multi);
  // 3) всем: 5 обычных яиц
  await ap.selectOption('#g-kind', 'eggs'); await ap.selectOption('#g-r', 'common'); await ap.fill('#g-q', '5'); await ap.fill('#g-msg', 'Всем привет');
  await ap.tap('#b-all'); await waitPub();
  ok('«Отправить всем» опубликован', feed.entries.length === 4);
  // ——— игра: два парка на одном iPhone ———
  const gctx = await browser.newContext({ ...devices['iPhone 13'] });
  await route(gctx);
  const gp = await gctx.newPage(); gp.on('pageerror', (e) => errs.push('park: ' + e.message));
  async function newPark(name) {
    await gp.goto(BASE + '/parks.html'); await gp.waitForSelector('#new-park', { state: 'visible' });
    await gp.tap('#new-park'); await gp.fill('#np-name', name); await gp.tap('#np-create'); await gp.waitForSelector('.cred .v');
    const id = (await gp.textContent('.cred .v')).trim();
    await gp.tap('#cr-go'); await gp.waitForURL(/park\.html/); await gp.waitForFunction(() => window.dpPark && window.dpPark.park, null, { timeout: 20000 });
    return id;
  }
  const A = await newPark('Парк А');
  const B = await newPark('Парк Б');
  // 4) сюрприз парку А (админка)
  await ap.selectOption('#g-kind', 'legend'); await ap.fill('#g-msg', 'Только для А');
  await ap.tap('#b-park'); await ap.fill('#g-park', A); await ap.tap('#g-park-send'); await waitPub();
  ok('«Сюрприз одному парку» опубликован', feed.entries.length === 5);
  const open = async (id) => { await gp.goto(BASE + '/park.html?id=' + id); await gp.waitForFunction(() => window.dpPark && window.dpPark.park && window.dpPark.park.life, null, { timeout: 20000 }); };
  const life = () => gp.evaluate(() => { const l = window.dpPark.park.life; return { c: l.eggs.common, r: l.eggs.rare, crown: l.hats.crown || 0, gifts: l.gifts.length, red: l.redeemed.slice() }; });
  const closeUi = () => gp.evaluate(() => DP.ui && DP.ui.close && DP.ui.close());
  // в парке Б: только «всем»
  await open(B); const b0 = await life();
  await gp.waitForSelector('#gf-ok', { timeout: 20000 }).catch(() => null);
  const bModal = await gp.evaluate(() => { const m = document.querySelector('#gf-ok'); return m ? m.closest('.modal, .sheet, body').textContent : ''; });
  const b1 = await life();
  ok('парк Б: при открытии «🎁 Тебе подарок!» — только подарок всем', /Тебе подарок/.test(bModal) && /Всем привет/.test(bModal) && !/Только для А/.test(bModal) && b1.c === b0.c + 5, `${b0.c} → ${b1.c}`);
  await gp.tap('#gf-ok').catch(() => {});
  await open(B); await gp.waitForTimeout(4000);
  ok('парк Б: повторно подарок не приходит', !(await gp.isVisible('#gf-ok')) && (await life()).c === b1.c);
  // в парке А: всем + сюрприз
  await open(A); const a0 = await life();
  await gp.waitForSelector('#gf-ok', { timeout: 20000 }).catch(() => null);
  const aModal = await gp.evaluate(() => { const m = document.querySelector('#gf-ok'); return m ? m.closest('.modal, .sheet, body').textContent : ''; });
  const a1 = await life();
  ok('парк А: получил подарок всем и сюрприз', /Только для А/.test(aModal) && /Всем привет/.test(aModal) && a1.c === a0.c + 5 && a1.gifts >= a0.gifts + 1, aModal.replace(/\s+/g, ' ').slice(0, 80));
  await gp.tap('#gf-ok').catch(() => {}); await closeUi();
  // короткие коды
  const enter = async (code) => {
    await closeUi(); await gp.evaluate(() => window.dpPark.screens.gifts()); await gp.waitForSelector('#gift-code', { state: 'visible' });
    await gp.fill('#gift-code', code); await gp.tap('#gift-redeem');
    await gp.waitForFunction(() => { const m = document.querySelector('#gift-msg'); return !document.querySelector('#gift-code') || (m && m.textContent.trim() && !/⏳|Проверяем/.test(m.textContent)); }, null, { timeout: 20000 }).catch(() => null);
    await gp.waitForTimeout(300);
    const m = (await gp.textContent('#gift-msg').catch(() => '')) || '';
    if (/✓/.test(m)) await gp.waitForTimeout(1900); // экран «Подарки» перерисуется сам через 1,6 с
    return m;
  };
  const ar = (await life()).r;
  await enter(once[0]);
  ok('одноразовый код в парке А: +2 редких яйца', (await life()).r === ar + 2);
  ok('тот же код в парке А ещё раз — «уже использован»', /уже использован/.test(await enter(once[0])));
  await open(B); await closeUi();
  ok('тот же одноразовый код в парке Б (то же устройство) — «уже использован на этом устройстве»', /на этом устройстве/.test(await enter(once[0])));
  const bc = (await life()).crown;
  await enter(multi.toLowerCase().replace(/-/g, ' '));
  ok('код для всех в парке Б (строчными, с пробелами) — корона', (await life()).crown === bc + 1);
  ok('код для всех в парке Б повторно — нет', /уже использован в этом парке/.test(await enter(multi)));
  await open(A); await closeUi();
  const ac = (await life()).crown; await enter(multi);
  ok('код для всех в парке А — тоже работает (каждый парк один раз)', (await life()).crown === ac + 1);
  ok('несуществующий код — «Такого кода нет»', /Такого кода нет/.test(await enter('DINO-2345-6789')));
  ok('код не того вида — подсказка про формат', /DINO-XXXX-XXXX/.test(await enter('DINO-1111-0000')));
  // второй одноразовый — по ссылке DP1, после этого короткий код того же подарка уже не срабатывает
  await gp.goto(onceLinks[1].replace('park.html?', 'park.html?id=' + A + '&')); await gp.waitForSelector('#gift-redeem', { state: 'visible', timeout: 20000 });
  const r2 = (await life()).r; await gp.tap('#gift-redeem'); await gp.waitForTimeout(2400);
  ok('ссылка одноразового кода работает', (await life()).r === r2 + 2);
  { const m = await enter(once[1]); ok('короткий код того же подарка после ссылки — «уже использован»', /уже использован/.test(m), m); }
  // истёкший и поддельный
  const c8x = 'ABCD2345', c8f = 'WXYZ6789';
  extra.push(await sign({ v: 1, id: nid(), t: 'code', u: 'multi', h: hash(c8x), g: { k: 'legend' }, ts: Date.now() - 5e6, e: Date.now() - 3600e3 }));
  const other = await S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  extra.push(await sign({ v: 1, id: nid(), t: 'code', u: 'multi', h: hash(c8f), g: { k: 'legend' }, ts: Date.now() }, other.privateKey));
  const good = await sign({ v: 1, id: nid(), t: 'all', g: { k: 'legend' }, ts: Date.now() });
  extra.push({ b: b64u(JSON.stringify({ v: 1, id: nid(), t: 'all', g: { k: 'eggs', r: 'legend', q: 50 }, ts: Date.now() })), s: good.s }); // подменённое содержимое
  ok('истёкший код — «Срок действия кода истёк»', /истёк/.test(await enter('DINO-ABCD-2345')));
  ok('код с чужой подписью не принимается', /Такого кода нет/.test(await enter('DINO-WXYZ-6789')));
  const lg = (await life()).c; await gp.evaluate(() => window.dpPark.feedGifts()); await gp.waitForTimeout(1500);
  ok('подменённая запись «всем» отклонена', (await life()).c === lg && !(await gp.isVisible('#gf-ok')));
  extra.length = 0;
  // MQTT retained: подписанная запись приходит через брокер (hub.rawIn), чужая — нет
  const fp = crypto.createHash('sha256').update(pub.x + '.' + pub.y).digest('hex').slice(0, 16);
  const c8m = 'MQTT2345', mq = await sign({ v: 1, id: nid(), t: 'code', u: 'multi', h: hash(c8m), g: { k: 'eggs', r: 'epic', q: 1 }, ts: Date.now() });
  const mres = await gp.evaluate(async ([topic, e, forged]) => {
    const p = DP.Gifts.collect({ mqttMs: 1500, keepOpen: true, force: true });
    setTimeout(() => { DP.relay.hub.rawIn(topic + 'a', JSON.stringify(e)); DP.relay.hub.rawIn(topic + 'b', JSON.stringify(forged)); }, 300);
    const r = await p; return { n: r.src.mqtt, ok: r.list.some((x) => x.h && x.t === 'code' && x.u === 'multi' && x.g.r === 'epic') };
  }, ['dinopark/gifts1/' + fp + '/', mq, { b: mq.b, s: good.s }]);
  ok('MQTT retained: запись принята, подделка отброшена', mres.n === 2 && mres.ok, JSON.stringify(mres));
  const ep = (await life()); await enter('DINO-MQTT-2345');
  const ep2 = await gp.evaluate(() => window.dpPark.park.life.eggs.epic);
  ok('код, пришедший только по MQTT (из кэша), работает', ep2 >= 1, 'epic ' + ep2);
  // отмена в админке: новый код → «Отменить» → в игре кода больше нет
  await ap.selectOption('#g-kind', 'legend'); await ap.fill('#g-msg', 'Отменим'); await ap.tap('#b-code'); await ap.check('input[name="g-use"][value="multi"]'); await ap.tap('#g-make'); await waitPub();
  const rv = (await ap.textContent('#g-out .short')).trim();
  await ap.tap('#sent-sec summary'); await ap.waitForFunction(() => document.querySelectorAll('#sent-list .sent').length >= 5, null, { timeout: 20000 });
  ok('список отправленных показывает подарки и код', (await ap.textContent('#sent-list')).includes(rv));
  const before = feed.entries.length;
  await ap.evaluate((code) => { const row = [...document.querySelectorAll('#sent-list .sent')].find((r) => r.textContent.includes(code)); row.querySelector('button').click(); }, rv);
  await ap.waitForFunction((n) => true, null); await ap.waitForTimeout(500);
  for (let i = 0; i < 40 && feed.entries.length === before; i++) await ap.waitForTimeout(250);
  ok('отмена опубликована', feed.entries.length === before + 1);
  { const m = await enter(rv); ok('отменённый код в игре не принимается', /Такого кода нет/.test(m), m + ' / ' + JSON.stringify(feed.entries.length)); }
  // ——— предупреждения: встроенный браузер и чужой ключ ———
  const ictx = await browser.newContext({ ...devices['iPhone 13'], userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Telegram-iOS/11.0' });
  await route(ictx);
  const ip = await ictx.newPage(); await ip.goto(BASE + '/admin.html'); await ip.waitForTimeout(400);
  const iw = await ip.textContent('#warn');
  ok('открыто в Telegram — «Открыть в Safari» и «нет ключа»', /Открыть в Safari/.test(iw) && /нет ключа/.test(iw), iw.slice(0, 70));
  await ip.tap('#b-all'); await ip.waitForTimeout(300);
  ok('без ключа «Отправить всем» не публикует', /нет ключа/.test(await ip.textContent('#g-out')) && feed.entries.length === before + 1);
  const mctx = await browser.newContext({ ...devices['iPhone 13'] }); await route(mctx);
  const wrong = await S.exportKey('jwk', other.privateKey);
  await mctx.addInitScript((k) => { localStorage.setItem('dp_admin_key', k); }, JSON.stringify(wrong));
  const mp = await mctx.newPage(); await mp.goto(BASE + '/admin.html'); await mp.waitForTimeout(400);
  ok('чужой ключ — «не совпадает … открой в Safari»', /не совпадает/.test(await mp.textContent('#warn')) && /Safari/.test(await mp.textContent('#warn')));
  ok('токен ни разу не ушёл не туда (401 только от проверки неверного)', badAuth === 1, 'badAuth ' + badAuth);
  ok('без ошибок страниц', !errs.length, errs.join('; '));
  await browser.close();
  const f = results.filter((x) => !x).length; console.log(f ? `ПРОВАЛ: ${f} из ${results.length}` : `ВСЁ ОК: ${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
