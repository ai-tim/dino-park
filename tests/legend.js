/* Динопарк — подарок «🌟 Легендарный динозавр»: по любому пути (ссылка DP1, короткий код, «всем», сюрприз парку)
 * динозавр сразу появляется в текущем парке рядом с камерой, камера подлетает, он сохраняется после перезагрузки,
 * виден в списке «Динозавры» и на ТВ. Плюс починка старых парков: подарок получен, а динозавра нет → создаётся ровно один.
 * Использование: BASE=http://127.0.0.1:8765 node tests/legend.js */
const { webkit, devices } = require('playwright-core');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const results = []; const ok = (n, c, i) => { results.push(!!c); console.log((c ? '✅' : '❌') + ' ' + n + (i ? ' — ' + i : '')); };
const S = crypto.webcrypto.subtle;
const b64u = (b) => Buffer.from(b).toString('base64url');
(async () => {
  const kp = await S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await S.exportKey('jwk', kp.privateKey), pub = { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y };
  const sign = async (p) => { const b = b64u(JSON.stringify(p)); return { b, s: b64u(await S.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Buffer.from('DPG1.' + b))) }; };
  const dp1 = async (p) => { const body = 'DP1.' + b64u(JSON.stringify(p)); return body + '.' + b64u(await S.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Buffer.from(body))); };
  const hash = (c8) => crypto.pbkdf2Sync('DINO-' + c8, 'dinopark-gift-v1', 100000, 16, 'sha256').toString('hex');
  const nid = () => b64u(crypto.randomBytes(12));
  const entries = [];
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(() => { window.DP_CONFIG = { RELAYS: [] }; });
  await ctx.route('**/js/config.js', async (r) => { const resp = await r.fetch(); let t = await resp.text(); t = t.replace(/ADMIN_PUBLIC_KEY:\s*\{[^}]*\}/, 'ADMIN_PUBLIC_KEY: ' + JSON.stringify(pub)); r.fulfill({ response: resp, body: t, headers: Object.assign({}, resp.headers(), { 'cache-control': 'no-store' }) }); });
  await ctx.route(/\/gifts\/feed\.json/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ v: 1, entries }), headers: { 'Access-Control-Allow-Origin': '*' } }));
  const errs = [];
  const gp = await ctx.newPage(); gp.on('pageerror', (e) => errs.push(e.message));
  await gp.goto(BASE + '/parks.html'); await gp.waitForSelector('#new-park', { state: 'visible' });
  await gp.tap('#new-park'); await gp.fill('#np-name', 'Легенды'); await gp.tap('#np-create'); await gp.waitForSelector('.cred .v');
  const A = (await gp.textContent('.cred .v')).trim();
  await gp.tap('#cr-go'); await gp.waitForURL(/park\.html/); await gp.waitForFunction(() => window.dpPark && window.dpPark.park && window.dpPark.park.life, null, { timeout: 20000 });
  const open = async (q) => { await gp.goto(BASE + '/park.html?id=' + A + (q || '')); await gp.waitForFunction(() => window.dpPark && window.dpPark.park && window.dpPark.park.life && window.dpScene, null, { timeout: 20000 }); };
  const closeUi = () => gp.evaluate(() => DP.ui && DP.ui.close && DP.ui.close());
  const legends = () => gp.evaluate(() => window.dpPark.park.dinos.filter(d => d.legend).map(d => ({ uid: d.uid, name: d.name, loc: d.loc })));
  // ТВ в том же браузере (локальная синхронизация)
  await gp.evaluate(() => window.dpPark.screens.tv()); await gp.waitForSelector('.tv-code');
  const code = (await gp.textContent('.tv-code')).trim(); await closeUi();
  const tv = await ctx.newPage(); tv.on('pageerror', (e) => errs.push('tv: ' + e.message));
  await tv.goto(BASE + '/tv.html?code=' + code); await tv.waitForTimeout(2500);
  const tvLegends = () => tv.evaluate(() => window.dpScene ? window.dpScene.ents.filter(e => e.d && e.d.legend || e.legend || e.palette === 9).length : -1);
  const tv0 = await tvLegends();
  await gp.bringToFront();
  // проверка после получения подарка
  async function check(route, before) {
    await gp.waitForFunction((n) => window.dpPark.park.dinos.filter(d => d.legend).length > n, before.length, { timeout: 15000 }).catch(() => null);
    await gp.waitForTimeout(2600); // окно закрылось, камера подлетела
    const L = await legends(), d = L.find(x => !before.some(b => b.uid === x.uid));
    ok(`${route}: золотой динозавр появился в парке`, L.length === before.length + 1 && d, d ? d.name : JSON.stringify(L));
    if (!d) return null;
    const st = await gp.evaluate((uid) => { const s = window.dpScene, e = s.ent(uid), v = s.view(), p = window.dpPark.park;
      return { ent: !!e, inView: !!e && e.x >= v.x0 && e.x <= v.x1, follow: s.follow && s.follow.uid, loc: p.dinos.find(x => x.uid === uid).loc === p.view, z: s.cam.z, ui: DP.ui.isOpen(), tok: (p.life.tokens || {}).legend || 0 }; }, d.uid);
    ok(`${route}: на поле, в текущей локации, рядом с камерой; камера подлетела; жетон не завис`, st.ent && st.inView && st.loc && st.follow === d.uid && st.z > 1.5 && !st.ui && st.tok === 0, JSON.stringify(st));
    return d;
  }
  async function persisted(route, d) {
    await open(); await gp.waitForTimeout(800);
    const L = await legends();
    const inScene = await gp.evaluate((uid) => !!window.dpScene.ent(uid), d.uid);
    await gp.evaluate(() => window.dpPark.screens.dinos()); await gp.waitForTimeout(300);
    const list = await gp.evaluate(() => document.body.textContent);
    await closeUi();
    ok(`${route}: сохранён после перезагрузки, в списке «Динозавры» и на поле`, L.some(x => x.uid === d.uid) && inScene && list.includes(d.name), 'легендарных ' + L.length);
    return L;
  }
  // 1) ссылка DP1
  let before = await legends();
  const link = await dp1({ v: 1, n: nid(), g: { k: 'legend' }, m: 'Ссылкой', ts: Date.now() });
  await open('&gift=' + encodeURIComponent(link)); await gp.waitForSelector('#gift-redeem', { state: 'visible', timeout: 20000 });
  await gp.tap('#gift-redeem');
  let d = await check('ссылка DP1', before);
  if (process.env.SHOT) await gp.screenshot({ path: process.env.SHOT });
  // ТВ получил (страница ТВ открыта в том же браузере, сохраняется синхронизация через localStorage/BroadcastChannel)
  await tv.waitForTimeout(1500);
  const tv1 = await tvLegends();
  ok('ТВ: показывает нового золотого динозавра', tv1 === tv0 + 1, `${tv0} → ${tv1}`);
  if (d) before = await persisted('ссылка DP1', d);
  // 2) короткий код
  entries.push(await sign({ v: 1, id: nid(), t: 'code', u: 'multi', h: hash('GEMS2345'), g: { k: 'legend' }, m: 'Кодом', ts: Date.now() }));
  await closeUi(); await gp.evaluate(() => window.dpPark.screens.gifts()); await gp.waitForSelector('#gift-code', { state: 'visible' });
  await gp.fill('#gift-code', 'DINO-GEMS-2345'); await gp.tap('#gift-redeem');
  d = await check('короткий код', before);
  if (d) before = await persisted('короткий код', d);
  // 3) «всем» и 4) сюрприз парку — приходят сами при открытии; проверяем по отдельности
  for (const [route, p] of [['«всем»', { t: 'all', m: 'Всем легенду' }], ['сюрприз парку', { t: 'park', p: A, m: 'Тебе легенду' }]]) {
    entries.push(await sign(Object.assign({ v: 1, id: nid(), g: { k: 'legend' }, ts: Date.now() }, p)));
    await open();
    await gp.waitForSelector('#gf-ok', { timeout: 20000 }).catch(() => null);
    const m = await gp.evaluate(() => { const b = document.querySelector('#gf-ok'); return b ? b.closest('.modal, .sheet, body').textContent : ''; });
    ok(`${route}: окно «Тебе подарок» с легендарным`, /Легендарн|легендарн|🌟/.test(m) && m.includes(p.m), m.replace(/\s+/g, ' ').slice(0, 80));
    await gp.tap('#gf-ok').catch(() => {});
    d = await check(route, before);
    if (d) before = await persisted(route, d);
  }
  // 5) починка: подарок записан, жетон есть, динозавра нет (так было до исправления)
  const n0 = (await legends()).length;
  await gp.evaluate(() => { const p = window.dpPark.park, L = p.life; L.tokens = L.tokens || {}; L.tokens.legend = (L.tokens.legend || 0) + 1;
    L.gifts.unshift({ adm: 1, g: 'legend', e: '🌟', name: 'Легендарный динозавр', msg: 'старый', from: 'Динопарк', t: Date.now() - 864e5 }); window.dpPark.commit(); });
  await open(); await gp.waitForTimeout(3500);
  const n1 = (await legends()).length;
  const rep = await gp.evaluate(() => ({ tok: window.dpPark.park.life.tokens.legend, marked: window.dpPark.park.life.gifts.filter(g => g.adm && g.g === 'legend').every(g => g.d) }));
  ok('починка: при открытии создан ровно один динозавр, жетон израсходован', n1 === n0 + 1 && rep.tok === 0 && rep.marked, `${n0} → ${n1} ${JSON.stringify(rep)}`);
  await open(); await gp.waitForTimeout(2500); await open(); await gp.waitForTimeout(1500);
  ok('починка: повторные открытия не создают ещё', (await legends()).length === n1);
  ok('без ошибок страниц', !errs.length, errs.join('; '));
  await browser.close();
  const f = results.filter((x) => !x).length; console.log(f ? `ПРОВАЛ: ${f} из ${results.length}` : `ВСЁ ОК: ${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
