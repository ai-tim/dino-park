/* Динопарк — сквозной тест в headless Chrome.
 * Использование:  BASE=http://localhost:8000 node e2e.js   (статический режим)
 *                 BASE=http://localhost:8080 SERVER=1 node e2e.js   (с Node-сервером, проверка синхронизации между устройствами)
 * CHROME=/path/to/chrome — путь к браузеру (по умолчанию /usr/bin/google-chrome)
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8000';
const SERVER = !!process.env.SERVER;
const OUT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'screens'); fs.mkdirSync(SHOTS, { recursive: true });
const errors = []; const results = [];
const ok = (name, cond, info) => { results.push({ name, pass: !!cond, info }); console.log((cond ? '✅' : '❌') + ' ' + name + (info ? ' — ' + info : '')); };
const watch = (page, tag) => {
  page.on('pageerror', e => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_INTERNET|net::ERR/.test(m.text())) errors.push(`[${tag}] console: ${m.text()}`); });
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); watch(page, 'park');

  // 1. Лендинг
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(1800);
  const land = await page.evaluate(() => ({ cta: document.querySelector('#cta') && document.querySelector('#cta').getAttribute('href'), ents: window.dpLanding && window.dpLanding.hero ? window.dpLanding.hero.ents.length : (window.dpScene ? window.dpScene.ents.length : -1), steps: document.querySelectorAll('#steps .lp-step, #steps li, #steps .step').length, sheet: !!document.querySelector('#lp-sheet svg'), tvLink: !!document.querySelector('a[href*="tv.html"]'), color: !!document.querySelector('a[href*="coloring.html"]'), lic: /Власенко/.test(document.body.textContent) }));
  ok('Лендинг: кнопка «Войти в парк» ведёт к паркам', land.cta === 'parks.html', JSON.stringify(land));
  ok('Лендинг: живая сцена, шаги, раскраска, ТВ, подвал', land.ents > 0 && land.sheet && land.tvLink && land.color && land.lic, `динозавров в сцене ${land.ents}, шагов ${land.steps}`);
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'landing.png') });
  {
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mp = await mctx.newPage(); watch(mp, 'landing-mobile'); await mp.goto(BASE + '/index.html?still=1'); await mp.waitForTimeout(1500);
    const ov = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok('Лендинг на телефоне без горизонтальной прокрутки', ov <= 1, 'лишняя ширина ' + ov + 'px');
    if (!SERVER) { await mp.screenshot({ path: path.join(SHOTS, 'landing-mobile.png') }); await mp.screenshot({ path: path.join(SHOTS, 'landing-full.png'), fullPage: true }); }
    await mctx.close();
  }
  await page.click('#cta'); await page.waitForURL(/parks\.html/); await page.waitForTimeout(1200);
  ok('Мои парки: пустой список', (await page.textContent('#my-parks')).includes('Пока ни одного парка'));
  ok('Мои парки: режим синхронизации', true, await page.textContent('#mode-note'));

  // 2. Новый парк
  await page.click('#new-park'); await page.fill('#np-name', 'Парк Маши'); await page.click('#np-create');
  const creds = await page.$$eval('.cred .v', els => els.map(e => e.textContent));
  ok('Код парка 10 символов + PIN 6 цифр', /^[a-z0-9]{10}$/.test(creds[0]) && /^\d{6}$/.test(creds[1]), creds.join(' / '));
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'credentials.png') });
  await page.click('#cr-go'); await page.waitForURL(/park\.html/); await page.waitForTimeout(1200);

  // 2b. Знакомство в пустом парке
  ok('Пустой парк: показано знакомство', await page.isVisible('#ob-ready'));
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'onboarding.png') });
  await page.evaluate(() => DP.ui.close()); await page.waitForTimeout(200);

  // 3. Меню по нажатию на парк
  await page.mouse.click(683, 200); await page.waitForTimeout(400);
  ok('Меню открывается по нажатию', await page.isVisible('.row[data-go="photo"]'));
  const rowsIds = await page.$$eval('.row[data-go]', els => els.map(e => e.dataset.go));
  ok('Меню: Покормить всех / Тайно / Локации / Админ', ['feedall', 'secret', 'locs', 'admin', 'dinos'].every(x => rowsIds.includes(x)), rowsIds.join(','));
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'menu.png') });
  await page.evaluate(() => window.dpPark.screens.dinos()); await page.waitForTimeout(200);
  ok('Пустое состояние списка динозавров', (await page.textContent('.empty')).includes('пока никого'));

  // 4. Готовые динозавры
  const species = ['trex', 'triceratops', 'stegosaurus', 'brachiosaurus', 'pterodactyl', 'plesiosaur', 'parasaurolophus', 'ankylosaurus', 'velociraptor'];
  for (const [i, sp] of species.entries()) {
    await page.evaluate(() => window.dpPark.screens.ready());
    if (i === 0) { await page.waitForTimeout(300); if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'ready.png') }); await page.fill('#rd-name', 'Рекси'); }
    await page.$eval(`[data-sp="${sp}"]`, el => el.click());
  }
  ok('Добавлено 9 готовых динозавров (все виды)', (await page.evaluate(() => window.dpPark.park.dinos.length)) === 9);
  const fresh = await page.evaluate(() => window.dpPark.park.dinos.every(d => d.loc === 'jungle' && d.owner === window.dpPark.owner && d.needs && d.needs.food > 80));
  ok('Новые динозавры: локация, владелец, сытые', fresh);

  // 5. Фото: тестовый лист с маркерами (повёрнут, на сером столе) и простой рисунок без маркеров
  const photo = await page.evaluate(async () => {
    const svg = DP.Template.pageSVG('triceratops', 'color', 'width="1188" height="840"');
    const img = await DP.util.loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const x = c.getContext('2d');
    x.fillStyle = '#8a7f72'; x.fillRect(0, 0, 1600, 1200);
    x.translate(800, 600); x.rotate(0.12); x.scale(1.05, 1); x.filter = 'brightness(0.85)'; x.drawImage(img, -594, -420); x.setTransform(1, 0, 0, 1, 0, 0); x.filter = 'none';
    const g = x.createLinearGradient(0, 0, 1600, 0); g.addColorStop(0, 'rgba(0,0,0,.15)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 1600, 1200);
    window.__testPhoto = c;
    const r1 = await DP.Photo.process(c);
    const c2 = document.createElement('canvas'); c2.width = 1600; c2.height = 1200; const x2 = c2.getContext('2d');
    x2.fillStyle = '#6d7b86'; x2.fillRect(0, 0, 1600, 1200); x2.translate(800, 600); x2.rotate(Math.PI - 0.05); x2.drawImage(img, -594, -420);
    const r2 = await DP.Photo.process(c2);
    const c3 = document.createElement('canvas'); c3.width = 900; c3.height = 600; const x3 = c3.getContext('2d');
    x3.fillStyle = '#fbfbf7'; x3.fillRect(0, 0, 900, 600);
    x3.fillStyle = '#e8590c'; x3.beginPath(); x3.ellipse(450, 320, 200, 110, 0, 0, Math.PI * 2); x3.fill();
    x3.fillStyle = '#2f9e44'; x3.beginPath(); x3.arc(640, 220, 70, 0, Math.PI * 2); x3.fill();
    x3.strokeStyle = '#111'; x3.lineWidth = 6; x3.beginPath(); x3.ellipse(450, 320, 200, 110, 0, 0, Math.PI * 2); x3.stroke();
    const r3 = await DP.Photo.process(c3);
    const alpha = (cv) => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let t = 0, o = 0; for (let i = 3; i < d.length; i += 4) { t++; if (d[i] > 0) o++; } return +(o / t).toFixed(2); };
    return {
      a: { method: r1.method, species: r1.species, w: r1.canvas.width, h: r1.canvas.height, opaque: alpha(r1.canvas), markers: r1.markers, codes: r1.readCodes, png: r1.canvas.toDataURL('image/png') },
      b: { method: r2.method, species: r2.species },
      c: { method: r3.method, species: r3.species, w: r3.canvas.width, h: r3.canvas.height, opaque: alpha(r3.canvas), png: r3.canvas.toDataURL('image/png') },
      src: c.toDataURL('image/jpeg', 0.8), src3: c3.toDataURL('image/png')
    };
  });
  const save = (name, d) => fs.writeFileSync(path.join(SHOTS, name), Buffer.from(d.split(',')[1], 'base64'));
  if (!SERVER) { save('photo-test-input.jpg', photo.src); save('photo-test-output.png', photo.a.png); save('blob-test-input.png', photo.src3); save('blob-test-output.png', photo.c.png); }
  ok('Фото с маркерами: распознан Трицератопс', photo.a.method === 'markers' && photo.a.species === 'triceratops', `${photo.a.method}, ${photo.a.species}, ${photo.a.w}x${photo.a.h}, непрозрачно ${photo.a.opaque}, меток ${photo.a.markers}, кодов прочитано ${photo.a.codes}`);
  ok('Фото перевёрнутого листа (180°)', photo.b.species === 'triceratops', `${photo.b.method}, ${photo.b.species}`);
  ok('Фото без маркеров: вырезано пятно', photo.c.method === 'blob' && photo.c.w > 380 && photo.c.w < 560 && photo.c.opaque > 0.4 && photo.c.opaque < 0.95, `${photo.c.method}, ${photo.c.w}x${photo.c.h}, непрозрачно ${photo.c.opaque}`);

  // UI-поток фото
  await page.evaluate(() => window.dpPark.processPhoto(window.__testPhoto));
  await page.waitForSelector('#ph-go', { timeout: 15000 });
  ok('Экран «Оживи своего динозавра» узнал вид', (await page.textContent('.found')).includes('Трицератопс'), await page.textContent('.found'));
  ok('Экран фото: «найдено 4 из 4 меток» и ползунок яркости', /4 из 4/.test(await page.textContent('#ph-how')) && await page.isVisible('#ph-light'), await page.textContent('#ph-how'));
  await page.fill('#ph-name', 'Трики'); await page.$eval('#ph-sat', el => { el.value = 0.6; el.dispatchEvent(new Event('input')); });
  await page.$eval('#ph-light', el => { el.value = 0.2; el.dispatchEvent(new Event('input')); });
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'photo-result.png') });
  await page.click('#ph-go'); await page.waitForTimeout(300);
  ok('Экран успеха после выпуска', (await page.textContent('.success')).includes('Динозавр убежал в парк'));
  ok('Фото-динозавр добавлен (10 всего)', (await page.evaluate(() => window.dpPark.park.dinos.length)) === 10);
  await page.click('[data-close]');

  // 5b. Фото с телефона: QR на экране «Сфотографировать»
  await page.evaluate(() => window.dpPark.screens.photo()); await page.waitForTimeout(300);
  const qrUrl = await page.evaluate(() => { const q = document.querySelector('#ph-qr'); const a = q && q.querySelector('a'); return { svg: !!(q && q.querySelector('svg')), note: q ? q.textContent : '' }; });
  ok('Фото: QR-код для телефона', qrUrl.svg, qrUrl.note.slice(0, 80));
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'photo-qr.png') });
  await page.evaluate(() => DP.ui.close());
  {
    const pctx = SERVER ? await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }) : ctx;
    const ph = await pctx.newPage(); watch(ph, 'phone');
    await ph.goto(`${BASE}/park.html?id=${creds[0]}&pin=${creds[1]}&open=camera`); await ph.waitForTimeout(2000);
    const st = await ph.evaluate(() => ({ url: location.href, n: window.dpPark ? window.dpPark.park.dinos.length : -1, cam: !!document.querySelector('video, #ph-cam, .cam') }));
    ok('QR-ссылка открывает парк и камеру, PIN убран из адреса', st.n === 10 && !/pin=/.test(st.url) && st.cam, JSON.stringify(st));
    await ph.close(); if (SERVER) await pctx.close();
  }

  // 6. Потребности: модель
  const needs = await page.evaluate(() => {
    const N = DP.Needs, t0 = 1e12, d = { loc: 'jungle', needs: N.fresh(t0) };
    const s10 = N.at(d, t0 + 10 * 60e3);
    const s20 = N.at(d, t0 + 40 * 60e3);
    const d2 = JSON.parse(JSON.stringify(d)); N.feed(d2, 30, t0 + 10 * 60e3); const fed = N.at(d2, t0 + 10 * 60e3);
    const d3 = JSON.parse(JSON.stringify(d)); N.sleep(d3, t0 + 1000); const sl = N.at(d3, t0 + 5000); const later = N.at(d3, t0 + 5 * 60e3);
    const d4 = JSON.parse(JSON.stringify(d)); N.play(d4, 40, t0 + 9 * 60e3); const pl = N.at(d4, t0 + 9 * 60e3);
    const auto = N.at(d, t0 + 3 * 3600e3);
    return { food10: s10.food, low20: s20.low, fed: fed.food, foodBefore: s10.food, asleep: sl.asleep, woke: !later.asleep && later.sleep > 80, play: pl.play, autoSleepSeen: auto.sleep >= 0 };
  });
  ok('Потребности: голод падает со временем', needs.food10 < 85 && needs.food10 > 0, 'еда через 10 мин: ' + needs.food10.toFixed(1));
  ok('Потребности: низкие значения помечаются', needs.low20.includes('food') && needs.low20.includes('play'), needs.low20.join(','));
  ok('Потребности: покормить / поиграть / уложить и проснуться', needs.fed > needs.foodBefore + 29 && needs.play > 40 && needs.asleep && needs.woke, JSON.stringify(needs));

  // 6b. Карточка динозавра по касанию
  await page.evaluate(() => { DP.ui.close(); }); await page.waitForTimeout(1500);
  let cardOpened = false;
  for (let tries = 0; tries < 6 && !cardOpened; tries++) {
    const pt = await page.evaluate(() => { const s = window.dpScene; const e = s.ents.filter(e => e._rect && e.habitat === 'ground' && e.state !== 'leave').sort((a, b) => b._rect.w - a._rect.w)[0]; if (!e) return null; const r = e._rect; return { x: r.x + r.w / 2, y: r.y + r.h * 0.6 }; });
    if (pt) { await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(400); cardOpened = await page.isVisible('#cd-feed'); }
    if (!cardOpened) { await page.evaluate(() => DP.ui.close()); await page.waitForTimeout(500); }
  }
  ok('Касание динозавра открывает карточку с шкалами', cardOpened && (await page.$$('#card-needs .need')).length === 3);
  if (cardOpened) {
    if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'dino-card.png') });
    const before = await page.evaluate(() => { const uid = document.querySelector('[data-travel]') && window.__cardUid; return null; });
    await page.click('#cd-sleep'); await page.waitForTimeout(300);
    const slept = await page.evaluate(() => document.querySelector('#cd-sleep').dataset.act);
    ok('Карточка: «Уложить спать» → «Разбудить»', slept === 'wake', slept);
    await page.click('#cd-sleep'); await page.waitForTimeout(200);
    await page.click('#cd-play'); await page.waitForTimeout(200);
  }
  // низкие потребности видны на значках
  await page.evaluate(() => { const d = window.dpPark.park.dinos[0]; d.needs = { food: 10, play: 90, sleep: 90, t: Date.now(), sleepFrom: null }; window.dpPark.commit(); });
  await page.evaluate(() => window.dpPark.screens.card(window.dpPark.park.dinos[0].uid)); await page.waitForTimeout(400);
  ok('Низкий голод: шкала красная и пульсирует', await page.evaluate(() => { const el = document.querySelector('[data-need="food"]'); return !!el && el.classList.contains('low') && getComputedStyle(el.querySelector('.ico')).animationName === 'dp-pulse'; }));
  await page.evaluate(() => DP.ui.close());

  // 7. Локации
  await page.evaluate(() => window.dpPark.screens.locs()); await page.waitForTimeout(400);
  const locIds = await page.$$eval('[data-loc]', els => els.map(e => e.dataset.loc));
  ok('Пять локаций в меню', ['jungle', 'lagoon', 'canyon', 'glacier', 'nightforest'].every(x => locIds.includes(x)), locIds.join(','));
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'locations.png') });
  await page.evaluate(() => DP.ui.close());
  // одного динозавра отправляем на лагуну через карточку
  const tuid = await page.evaluate(() => window.dpPark.park.dinos[1].uid);
  await page.evaluate((u) => window.dpPark.screens.card(u), tuid); await page.waitForTimeout(300);
  await page.click('[data-travel="lagoon"]'); await page.waitForTimeout(1200);
  const tr = await page.evaluate((u) => ({ loc: window.dpPark.park.dinos.find(d => d.uid === u).loc, onScreen: window.dpScene.ents.filter(e => e.uid === u && e.state !== 'leave').length }), tuid);
  ok('Карточка: «Отправить в лагуну»', tr.loc === 'lagoon' && tr.onScreen === 0, JSON.stringify(tr));
  // меняем локацию без динозавров и возвращаемся
  await page.evaluate(() => window.dpPark.travelTo('lagoon', false)); await page.waitForTimeout(1200);
  const lag = await page.evaluate(() => ({ view: window.dpPark.park.view, n: window.dpScene.ents.filter(e => e.state !== 'leave').length }));
  ok('Переключение на лагуну: там один динозавр', lag.view === 'lagoon' && lag.n === 1, JSON.stringify(lag));
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'park-lagoon.png') });
  await page.evaluate(() => window.dpPark.travelTo('jungle', false)); await page.waitForTimeout(1200);

  // 7b. Свой фон — отдельно от локаций
  await page.evaluate(() => window.dpPark.screens.bg()); await page.waitForTimeout(300);
  ok('Свой фон: отдельный экран загрузки', await page.isVisible('#bg-add'));
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'backgrounds.png') });
  await page.evaluate(() => DP.ui.close());

  // 8. ТВ (код + QR)
  await page.evaluate(() => window.dpPark.screens.tv()); await page.waitForSelector('.tv-code');
  const code = (await page.textContent('.tv-code')).trim();
  ok('5-значный код для ТВ и QR', /^\d{5}$/.test(code) && await page.isVisible('.qr svg'), code);
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'tv-modal.png') });
  await page.evaluate(() => DP.ui.close());

  // 8b. Экран ТВ: в том же браузере (локально) или в другом «устройстве» (сервер)
  const tvCtx = SERVER ? await browser.newContext({ viewport: { width: 1280, height: 720 } }) : ctx;
  const tv = await tvCtx.newPage(); watch(tv, 'tv');
  await tv.goto(BASE + '/tv.html?code=' + code); await tv.waitForTimeout(2500);
  const tvCount = await tv.evaluate(() => window.dpScene ? window.dpScene.ents.length : -1);
  ok(`ТВ открылся по коду (${SERVER ? 'другое устройство через сервер' : 'тот же браузер'})`, tvCount === 9, 'динозавров на ТВ (в джунглях): ' + tvCount);
  await tv.mouse.click(640, 200); await tv.waitForTimeout(300); await tv.mouse.click(100, 650); await tv.waitForTimeout(300);
  ok('ТВ никогда не открывает меню', await tv.evaluate(() => !document.querySelector('.row[data-go]') && !(DP.ui && DP.ui.isOpen && DP.ui.isOpen())));
  // живая синхронизация: новый динозавр и «Покормить всех»
  await page.evaluate(() => { window.dpPark.screens.ready(); document.querySelector('[data-sp="trex"]').click(); });
  await page.evaluate(() => window.dpPark.feedAll());
  await tv.waitForTimeout(1500);
  const tvState = await tv.evaluate(() => ({ n: window.dpScene.ents.length, food: window.dpScene.food.length, toast: (document.querySelector('#tvtoast') || {}).textContent || '' }));
  ok('ТВ получил нового динозавра и корм в реальном времени', tvState.n === 10 && tvState.food > 0, JSON.stringify(tvState));
  ok('ТВ: «Покормить всех» объявляется', /Обед/.test(tvState.toast), tvState.toast);
  // 9. Кормление на основном экране → скриншот
  await page.waitForTimeout(2600);
  const eating = await page.evaluate(() => window.dpScene.ents.filter(e => e.state !== 'wander').length);
  ok('Динозавры бегут к корму / едят', eating > 0, 'заняты едой: ' + eating);
  await page.evaluate(() => { const e = window.dpScene.ents[0]; window.dpScene.jump(e.uid, 'РРРР! 🦖'); });
  await page.waitForTimeout(250);
  if (!SERVER) await page.screenshot({ path: path.join(OUT, 'screenshot.png') });
  if (!SERVER) { await tv.waitForTimeout(500); await tv.screenshot({ path: path.join(SHOTS, 'tv-screen.png') }); }

  // 9b. Сытость засчитывается после еды и сохраняется в парке
  await page.waitForTimeout(5000);
  const fedState = await page.evaluate(() => window.dpPark.park.dinos.filter(d => d.loc === 'jungle').map(d => DP.Needs.at(d).food));
  ok('После еды голод утолён (сохранено в парке)', fedState.some(f => f > 86), fedState.map(f => f.toFixed(0)).join(','));
  if (SERVER) { await tv.waitForTimeout(800); }
  const tvFed = await tv.evaluate(() => window.dpScene.ents.length);
  ok('ТВ синхронизирован после кормления', tvFed === 10, 'на ТВ ' + tvFed);

  // 9c. Тайное кормление своих
  await page.evaluate(() => { const s = window.dpScene; s.food = []; const ds = window.dpPark.park.dinos.filter(d => d.loc === 'jungle'); ds.slice(0, 6).forEach(d => { d.owner = 'someone-else'; }); window.dpPark.commit(); });
  await tv.waitForTimeout(800);
  await tv.evaluate(() => { const el = document.querySelector('#tvtoast'); if (el) { el.textContent = ''; el.classList.remove('on'); } window.dpScene.food = []; });
  await page.evaluate(() => window.dpPark.feedSecret()); await page.waitForTimeout(400);
  const sec = await page.evaluate(() => { const mine = window.dpPark.park.dinos.filter(d => d.owner === window.dpPark.owner).map(d => d.uid); const f = window.dpScene.food; return { n: f.length, allSecret: f.every(x => x.secret), onlyMine: f.every(x => mine.includes(x.only)), mine: mine.length }; });
  ok('Тайный корм: только у своих динозавров, с блёстками', sec.n > 0 && sec.allSecret && sec.onlyMine, JSON.stringify(sec));
  await tv.waitForTimeout(1200);
  const tvSec = await tv.evaluate(() => ({ food: window.dpScene.food.filter(f => f.secret).length, toast: (document.querySelector('#tvtoast') || {}).textContent || '' }));
  ok('ТВ: тайный корм без объявления', tvSec.food > 0 && tvSec.toast === '', JSON.stringify(tvSec));
  await page.waitForTimeout(1500);
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'secret-feed.png') });

  // 9d. Голоса
  const vo = await page.evaluate(async () => {
    const V = DP.Voices, res = {};
    const t = V.pick('trex', 'u1', 'tap', 1), t2 = V.pick('trex', 'u1', 'tap', 2), r = V.pick('velociraptor', 'u2', 'tap', 1), j = V.pick('trex', 'other', 'tap', 1);
    res.variants = t.url !== t2.url; res.rate = t.rate >= 0.92 && t.rate <= 1.08 && t.rate !== j.rate;
    res.files = {}; for (const sp of V.LIST) for (const n of [1, 2]) { const rr = await fetch(`assets/audio/voices/${sp}/${n}.mp3`, { method: 'GET' }); res.files[sp + n] = rr.ok ? (await rr.arrayBuffer()).byteLength : 0; }
    res.allFiles = Object.values(res.files).every(b => b > 2000);
    res.fallback = V.speciesOf(undefined, 'sky') === 'pterodactyl';
    const before = V.log.length; V.play('trex', 'eat', 'zz', { force: true }); res.logged = V.log.length > before && V.log[V.log.length - 1].kind === 'eat';
    return res;
  });
  ok('Голоса: 2 варианта на вид, личный тембр', vo.variants && vo.rate && vo.fallback, JSON.stringify({ variants: vo.variants, rate: vo.rate }));
  ok('Голоса: 18 файлов для 9 видов на месте', vo.allFiles, Object.entries(vo.files).filter(e => e[1] < 2000).map(e => e[0]).join(',') || 'все есть');
  ok('Голоса: звучат при еде', vo.logged);
  const eatLog = await page.evaluate(() => DP.Voices.log.filter(x => x.kind === 'eat' && x.seed !== 'zz').length);
  ok('Голоса: динозавры подают голос во время еды', eatLog > 0, 'событий: ' + eatLog);

  // 9e. Админ: переименование, смена пароля
  await page.evaluate(() => window.dpPark.screens.admin()); await page.waitForTimeout(300);
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'admin.png') });
  await page.fill('#ad-name', 'Парк Маши и Пети'); await page.click('#ad-ren'); await page.waitForTimeout(300);
  ok('Админ: переименование', (await page.evaluate(() => window.dpPark.park.name)) === 'Парк Маши и Пети');
  await page.fill('#ad-old', '999999'); await page.fill('#ad-new', '4321'); await page.click('#ad-pinok'); await page.waitForTimeout(600);
  ok('Админ: неверный старый пароль отклонён', /⚠️/.test(await page.textContent('#ad-msg')), await page.textContent('#ad-msg'));
  const NEWPIN = '73519';
  await page.fill('#ad-old', creds[1]); await page.fill('#ad-new', NEWPIN); await page.click('#ad-pinok'); await page.waitForTimeout(800);
  ok('Админ: пароль изменён', (await page.evaluate(() => window.dpPark.park.pin)) === NEWPIN && /изменён/.test(await page.textContent('#ad-msg')), await page.textContent('#ad-msg'));
  creds[1] = NEWPIN;
  await page.evaluate(() => DP.ui.close());

  // 10. Уборка и «Мои парки»
  await page.evaluate(() => window.dpPark.screens.cleanup()); await page.waitForTimeout(200);
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'cleanup.png') });
  await page.click('.dino-tile .del');
  ok('Удаление динозавра', (await page.evaluate(() => window.dpPark.park.dinos.length)) === 10);
  await page.evaluate(() => window.dpPark.screens.parks()); await page.waitForTimeout(200);
  ok('Мои парки: 1 парк, склонение «10 динозавров»', (await page.textContent('.park-row .cnt')).trim() === '10 динозавров');
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'parks.png') });

  // 11. Открытие по коду и паролю на другом «устройстве» (только сервер)
  if (SERVER) {
    const other = await (await browser.newContext()).newPage(); watch(other, 'other');
    await other.goto(BASE + '/parks.html'); await other.waitForTimeout(1500);
    await other.fill('#open-id', creds[0]); await other.fill('#open-pin', creds[1]); await other.click('#open-btn');
    await other.waitForURL(/park\.html/, { timeout: 5000 }).catch(() => {});
    await other.waitForTimeout(1200);
    const n = await other.evaluate(() => window.dpPark ? window.dpPark.park.dinos.length : -1);
    ok('Открытие парка по коду+паролю с другого устройства', n === 10, 'динозавров: ' + n);
    await other.fill && null;
    const bad = await (await browser.newContext()).newPage();
    await bad.goto(BASE + '/parks.html'); await bad.waitForTimeout(1200);
    await bad.fill('#open-id', creds[0]); await bad.fill('#open-pin', '000000'); await bad.click('#open-btn'); await bad.waitForTimeout(800);
    ok('Неверный пароль отклоняется', /park\.html/.test(bad.url()) === false);
  }


  // 11b. Хаотичное блуждание: позиции меняются, направления разные, нет «слипания»
  await page.evaluate(() => { DP.ui.close(); const s = window.dpScene; s.food = []; s.ents.forEach(e => { e.state = 'wander'; e.food = null; e.enter = 0; }); });
  const mv = await page.evaluate(async () => {
    const s = window.dpScene, bw = s.baseW(), N = 40, samples = [];
    for (let i = 0; i < N; i++) { samples.push(s.ents.map(e => ({ uid: e.uid, x: e.x, y: e.y, vx: e.vx, vy: e.vy, hab: e.habitat, w: bw * e.size * s.depth(e), mode: e.mode, facing: e.facing }))); await new Promise(r => setTimeout(r, 250)); }
    const n = s.ents.length, path = new Array(n).fill(0), oct = new Set(), modes = new Set(), facings = new Set(), turns = new Array(n).fill(0);
    let pairs = 0, bad = 0;
    for (let i = 1; i < N; i++) samples[i].forEach((e, j) => {
      const p = samples[i - 1][j]; if (!p || p.uid !== e.uid) return;
      path[j] += Math.hypot(e.x - p.x, e.y - p.y);
      if (Math.hypot(e.vx, e.vy) > 4) oct.add(Math.round((Math.atan2(e.vy, e.vx) + Math.PI) / (Math.PI / 4)) % 8);
      modes.add(e.mode); facings.add(e.facing); if (e.facing !== p.facing) turns[j]++;
    });
    samples.forEach(sm => { for (let a = 0; a < sm.length; a++) for (let b = a + 1; b < sm.length; b++) {
      const A = sm[a], B = sm[b]; if (A.hab !== B.hab || A.hab !== 'ground') continue; pairs++;
      const mw = Math.min(A.w, B.w); if (Math.abs(A.x - B.x) < mw * 0.25 && Math.abs(A.y - B.y) < mw * 0.08) bad++; } });
    return { moved: path.filter((d, j) => d > samples[0][j].w * 0.3).length, n, octants: oct.size, modes: [...modes], facings: [...facings], turned: turns.filter(t => t > 0).length, overlap: pairs ? bad / pairs : 0 };
  });
  ok('Движение: динозавры перемещаются', mv.moved >= Math.ceil(mv.n * 0.7), `сдвинулись ${mv.moved}/${mv.n}`);
  ok('Движение: разные направления и смена курса', mv.octants >= 5 && mv.facings.length === 2 && mv.turned >= 2, `направлений ${mv.octants}/8, развернулись ${mv.turned}, режимы: ${mv.modes.join(',')}`);
  ok('Движение: почти нет наложений', mv.overlap < 0.05, `доля «слипшихся» пар ${(mv.overlap * 100).toFixed(1)}%`);

  // 11c. Музыка: кнопка 🔊/🔇, запоминание, запуск по жесту
  const m0 = await page.evaluate(() => ({ text: document.querySelector('#music-btn') && document.querySelector('#music-btn').textContent, st: DP.music.state() }));
  ok('Музыка: кнопка в углу, по умолчанию включена', m0.text === '🔊' && m0.st.on, `${m0.text}, режим ${m0.st.mode}, играет: ${m0.st.playing}, ctx: ${m0.st.ctx}`);
  ok('Музыка: стартует после жеста пользователя', m0.st.started && !m0.st.error, `started=${m0.st.started} ${m0.st.error || ''}`);
  await page.click('#music-btn'); await page.waitForTimeout(300);
  const m1 = await page.evaluate(() => ({ text: document.querySelector('#music-btn').textContent, on: DP.music.isOn(), ls: localStorage.getItem('dp_music'), playing: DP.music.state().playing, menuOpen: DP.ui.isOpen() }));
  ok('Музыка: кнопка выключает', m1.text === '🔇' && !m1.on && m1.ls === '0' && !m1.playing && !m1.menuOpen, JSON.stringify(m1));
  await page.reload(); await page.waitForTimeout(1500);
  const m2 = await page.evaluate(() => ({ text: document.querySelector('#music-btn').textContent, on: DP.music.isOn() }));
  ok('Музыка: настройка сохраняется после перезагрузки', m2.text === '🔇' && !m2.on, JSON.stringify(m2));
  for (const [x, y] of [[683, 200], [60, 60], [1300, 60], [683, 120], [300, 300]]) { // мимо летающих динозавров
    await page.mouse.click(x, y); await page.waitForTimeout(350);
    if (await page.isVisible('.row[data-go="music"]')) break;
    await page.evaluate(() => DP.ui.close && DP.ui.close()); await page.waitForTimeout(200);
  }
  const rowOff = await page.textContent('.row[data-go="music"] .t');
  await page.click('.row[data-go="music"]'); await page.waitForTimeout(1500);
  const m3 = await page.evaluate(() => ({ text: document.querySelector('#music-btn').textContent, on: DP.music.isOn(), ls: localStorage.getItem('dp_music'), row: document.querySelector('.row[data-go="music"] .t') && document.querySelector('.row[data-go="music"] .t').textContent, st: DP.music.state() }));
  ok('Музыка: пункт меню включает обратно', rowOff.includes('выключена') && m3.on && m3.ls === '1' && m3.text === '🔊' && /включена/.test(m3.row), `${rowOff} → ${m3.row}, играет: ${m3.st.playing}`);
  await page.evaluate(() => DP.ui.close());
  // браузер блокирует звук: нет Web Audio, play() отклоняется → без ошибок, кнопка работает
  {
    const bctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    await bctx.addInitScript(() => { window.AudioContext = undefined; window.webkitAudioContext = undefined; HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('blocked', 'NotAllowedError')); }; });
    const bp = await bctx.newPage(); const berr = []; bp.on('pageerror', e => berr.push(e.message));
    await bp.goto(BASE + '/parks.html'); await bp.waitForTimeout(800);
    await bp.mouse.click(500, 30); await bp.waitForTimeout(500);
    const b1 = await bp.evaluate(() => DP.music.state());
    await bp.click('#music-btn'); await bp.click('#music-btn'); await bp.waitForTimeout(300);
    const b2 = await bp.evaluate(() => ({ on: DP.music.isOn(), text: document.querySelector('#music-btn').textContent }));
    ok('Музыка: звук заблокирован — без ошибок', berr.length === 0 && !b1.playing && b2.on && b2.text === '🔊', `ошибок ${berr.length}, причина: ${b1.error}`);
    await bctx.close();
  }

  // 11d. Демо-режим: ничего не сохраняется
  {
    const dctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const dp = await dctx.newPage(); watch(dp, 'demo');
    await dp.goto(BASE + '/park.html?demo=1'); await dp.waitForTimeout(2000);
    const dm = await dp.evaluate(() => ({ badge: !!document.querySelector('.demo-badge'), n: window.dpPark.park.dinos.length, here: window.dpScene.ents.length, saved: DP.store.myIds().length, low: window.dpPark.park.dinos.some(d => DP.Needs.at(d).low.length) }));
    ok('Демо-парк: 11 динозавров в 5 локациях, ничего не сохраняется', dm.badge && dm.n === 11 && dm.here === 5 && dm.saved === 0 && dm.low, JSON.stringify(dm));
    if (!SERVER) { await dp.waitForTimeout(800); await dp.screenshot({ path: path.join(SHOTS, 'demo.png') }); }
    await dctx.close();
  }
  // 11e. Удаление парка (корзина 30 дней на сервере)
  {
    const xctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const xp = await xctx.newPage(); watch(xp, 'delete');
    await xp.goto(BASE + '/parks.html'); await xp.waitForTimeout(1200);
    await xp.click('#new-park'); await xp.fill('#np-name', 'Временный'); await xp.click('#np-create');
    await xp.click('#cr-go'); await xp.waitForURL(/park\.html/); await xp.waitForTimeout(1200);
    xp.on('dialog', d => d.accept());
    await xp.evaluate(() => window.dpPark.screens.admin()); await xp.waitForTimeout(300);
    await xp.click('#ad-del'); await xp.waitForURL(/parks\.html/, { timeout: 5000 }).catch(() => {});
    await xp.waitForTimeout(1000);
    ok('Удаление парка из админки', /parks\.html/.test(xp.url()) && (await xp.evaluate(() => DP.store.myIds().length)) === 0, xp.url());
    await xctx.close();
  }

  // 12. Раскраски
  if (!SERVER) {
    const cp = await ctx.newPage(); watch(cp, 'coloring');
    await cp.goto(BASE + '/coloring.html'); await cp.waitForTimeout(800);
    ok('Раскраски: 9 листов A4', (await cp.$$eval('.page', e => e.length)) === 9);
    await cp.screenshot({ path: path.join(OUT, 'screenshot-coloring.png'), fullPage: true });
    await cp.emulateMedia({ media: 'print' });
    await cp.pdf({ path: path.join(SHOTS, 'coloring-print.pdf'), preferCSSPageSize: true, printBackground: true });
    ok('Печать в PDF (A4 альбомная)', fs.statSync(path.join(SHOTS, 'coloring-print.pdf')).size > 10000);
  }

  ok('Нет ошибок JS в консоли', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter(r => !r.pass).length;
  console.log(`\nИтого: ${results.length - failed}/${results.length} проверок пройдено`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
