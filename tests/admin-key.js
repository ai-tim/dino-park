/* Динопарк — тест сохранения/копирования ключа на admin.html в WebKit (как iPhone Safari).
 * Использование: BASE=http://localhost:8000 node admin-key.js */
const { webkit, devices } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:8000';
const results = []; const ok = (n, c, i) => { results.push(!!c); console.log((c ? '✅' : '❌') + ' ' + n + (i ? ' — ' + i : '')); };
(async () => {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  try { await ctx.grantPermissions(['clipboard-read'], { origin: BASE }); } catch (e) { console.log('grantPermissions:', e.message); }
  // «Старый» ключ, уже лежащий в localStorage, в прежнем формате
  const pre = { kty: 'EC', crv: 'P-256', x: 'ZIzvhUoPK1_XyYk2n3hJJYn7D-_PUQovLm2AOEBFlbs', y: 'bcrkqVgl5cz7ycpMZSXbTkfGEQjvBw6Z7bgXPUy-8D8', d: 'TEST_D_VALUE_NOT_REAL' };
  await ctx.addInitScript((k) => {
    if (!localStorage.getItem('dp_admin_key')) localStorage.setItem('dp_admin_key', k);
    window.__shared = null; window.__copied = []; window.__wtOk = 0;
    if (navigator.clipboard && navigator.clipboard.writeText) { const wt = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = (t) => { window.__copied.push(t); return wt(t).then((r) => { window.__wtOk++; return r; }); }; }
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = (d) => { window.__shared = { title: d.title, name: d.files[0].name, type: d.files[0].type, gesture: navigator.userActivation ? navigator.userActivation.isActive : null }; return d.files[0].text().then(t => { window.__shared.text = t; }); };
  }, JSON.stringify(pre));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/admin.html'); await p.waitForTimeout(400);
  ok('раздел «Ключ (не трогать)» свёрнут, опасные кнопки скрыты', !(await p.isVisible('#key-export')) && !(await p.isVisible('#key-gen')) && /не трогать/.test(await p.textContent('#key-sec summary')));
  ok('нет предупреждений — ключ совпадает', (await p.textContent('#warn')).trim() === '', await p.textContent('#warn'));
  await p.tap('#key-sec summary'); await p.waitForTimeout(200);
  const vis = { exp: await p.isVisible('#key-export'), copy: await p.isVisible('#key-copy'), pub: await p.isVisible('#key-pub-copy') };
  ok('кнопки есть', vis.exp && vis.copy && vis.pub, JSON.stringify(vis) + ' ' + (await p.textContent('#key-st')));
  ok('подпись кнопки экспорта', /Поделиться/.test(await p.textContent('#key-export')));
  ok('подсказка про закрытый ключ', /никому не отправляй/.test(await p.textContent('#key-hint')));
  ok('старый ключ из localStorage прочитан', /Ключ совпадает с игрой/.test(await p.textContent('#key-st')) && (await p.textContent('#key-pub')).includes(pre.x));
  await p.tap('#key-export'); await p.waitForTimeout(300);
  const sh = await p.evaluate(() => window.__shared);
  ok('navigator.share вызван с файлом', sh && sh.name === 'dinopark-admin-key.json' && sh.type === 'application/json' && sh.title === 'Ключ Динопарка' && JSON.parse(sh.text).d === pre.d, JSON.stringify(sh && { ...sh, text: undefined }));
  await p.tap('#key-copy'); await p.waitForTimeout(300);
  const c1 = await p.evaluate(() => window.__copied[0]);
  ok('закрытый ключ скопирован (clipboard.writeText выполнен)', JSON.parse(c1).d === pre.d && await p.evaluate(() => window.__wtOk === 1));
  await p.fill('#key-in', ''); await p.focus('#key-in'); await p.keyboard.press('ControlOrMeta+V'); await p.waitForTimeout(200);
  ok('вставка из буфера обмена = закрытый ключ', (await p.inputValue('#key-in')) === JSON.stringify(pre), (await p.inputValue('#key-in')).slice(0, 20)); await p.fill('#key-in', '');
  ok('тост', /Скопировано — вставь в Заметки и закрепи/.test(await p.textContent('#adm-toast')));
  await p.tap('#key-pub-copy'); await p.waitForTimeout(300);
  const c2 = JSON.parse(await p.evaluate(() => window.__copied[1]));
  ok('открытый ключ скопирован (без d)', c2.x === pre.x && !c2.d);
  // fallback: без clipboard API → execCommand
  await p.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); window.__ec = 0; const o = document.execCommand.bind(document); document.execCommand = (c) => { window.__ec++; window.__sel = document.activeElement && document.activeElement.value; return o(c); }; });
  await p.tap('#key-copy'); await p.waitForTimeout(200);
  ok('fallback execCommand(copy)', await p.evaluate(() => window.__ec === 1 && JSON.parse(window.__sel).d === 'TEST_D_VALUE_NOT_REAL'));
  // «Создать новый ключ» и «Удалить» — за подтверждением; «Отмена» ничего не меняет
  const dl = []; p.on('dialog', (d) => { dl.push(d.message()); d.dismiss(); });
  await p.tap('#key-gen'); await p.waitForTimeout(200); await p.tap('#key-forget'); await p.waitForTimeout(200);
  ok('опасные кнопки спрашивают подтверждение', dl.length === 2 && /НОВЫЙ ключ/.test(dl[0]) && /Удалить ключ/.test(dl[1]), dl.length + '');
  ok('localStorage не изменён', (await p.evaluate(() => localStorage.getItem('dp_admin_key'))) === JSON.stringify(pre));
  ok('без ошибок страницы', !errs.length, errs.join('; '));
  await browser.close();
  const f = results.filter(x => !x).length; console.log(f ? `ПРОВАЛ: ${f}` : 'ВСЁ ОК'); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
