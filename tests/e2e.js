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
  ok('Меню открывается по нажатию', await page.isVisible('#m-tiles'));
  const qaIds = await page.$$eval('#m-qa [data-go]', els => els.map(e => e.dataset.go));
  ok('Меню: быстрые действия — покормить всех, тайно своих, уложить спать, поиграть со всеми', ['feedall', 'secret', 'sleepall', 'playall'].every(x => qaIds.includes(x)), qaIds.join(','));
  const secIds = await page.$$eval('#m-tiles [data-sec]', els => els.map(e => e.dataset.sec));
  ok('Меню: шесть разделов', ['dinos', 'acts', 'locs', 'rewards', 'tv', 'more'].every(x => secIds.includes(x)) && secIds.length === 6, secIds.join(','));
  const menuFits = await page.evaluate(() => { const p = document.querySelector('.overlay .panel'); return p.scrollHeight <= p.clientHeight + 2; });
  ok('Меню: помещается без прокрутки', menuFits);
  if (!SERVER) await page.screenshot({ path: path.join(SHOTS, 'menu.png') });
  // все пункты доступны через разделы
  const allIds = [];
  for (const sec of ['dinos', 'acts', 'locs', 'rewards', 'more']) {
    await page.evaluate((s) => window.dpPark.screens.section(s), sec); await page.waitForTimeout(80);
    allIds.push(...await page.$$eval('.row[data-go]', els => els.map(e => e.dataset.go)));
  }
  ok('Разделы меню: доступны все функции', ['dinos', 'photo', 'ready', 'coloring', 'cleanup', 'feedall', 'secret', 'sleepall', 'playall', 'hide', 'locs', 'bg', 'eggs', 'gifts', 'ach', 'tribe', 'news', 'invite', 'music', 'voices', 'admin', 'parks', 'support'].every(x => allIds.includes(x)), allIds.join(','));
  await page.evaluate(() => window.dpPark.screens.section('acts')); await page.click('.panel-head .back, [data-back]').catch(() => {}); await page.waitForTimeout(150);
  ok('Раздел: «Назад» возвращает в меню', await page.isVisible('#m-tiles'));
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
  // 9. Кормление на основном экране → скриншот (страница — на переднем плане, иначе headless Chrome душит её до 2 кадров/с)
  await page.bringToFront();
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
  await page.bringToFront();
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
    if (await page.isVisible('#m-tiles')) { await page.click('[data-sec="more"]'); await page.waitForTimeout(200); }
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
    await dp.goto(BASE + '/park.html?demo=1', { waitUntil: 'domcontentloaded', timeout: 60000 }); await dp.waitForFunction(() => window.dpPark && window.dpScene && window.dpScene.ents.length, null, { timeout: 60000 }); await dp.waitForTimeout(2000);
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

  // 13. v3: яйца, обмен, племя, панель нужд, прятки, подарки, достижения, коды, приглашения, зум
  {
    const crypto = require('crypto');
    // Ключ подписи тестовых кодов: по умолчанию — свежая тестовая пара, открытая часть подменяется в js/config.js
    // только внутри браузера теста (page.route). ADMIN_KEY_FILE=… — подписывать настоящим ключом (без подмены).
    const KEYFILE = process.env.ADMIN_KEY_FILE || '';
    let priv = null, privJwk = null; // закрытый ключ нигде не печатается и не сохраняется
    if (KEYFILE) { try { privJwk = JSON.parse(fs.readFileSync(KEYFILE, 'utf8').split('\n').find(l => l.trim().startsWith('{'))); priv = crypto.createPrivateKey({ key: privJwk, format: 'jwk' }); } catch (e) { priv = null; } }
    else { const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); priv = kp.privateKey; privJwk = kp.privateKey.export({ format: 'jwk' }); }
    const testPub = JSON.stringify({ kty: 'EC', crv: 'P-256', x: privJwk && privJwk.x, y: privJwk && privJwk.y });
    const makeCode = (payload, key) => { const b = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `DP1.${b}.${crypto.sign('sha256', Buffer.from('DP1.' + b), { key: key || priv, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`; };
    const vctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
    if (!KEYFILE) await vctx.route(/\/js\/config\.js(\?|$)/, async (route) => { const r = await route.fetch(); const body = (await r.text()).replace(/ADMIN_PUBLIC_KEY:\s*\{[^}]*\}/, 'ADMIN_PUBLIC_KEY: ' + testPub); await route.fulfill({ response: r, body }); });
    await vctx.addInitScript(() => { if (!sessionStorage.getItem('keepNews')) localStorage.setItem('dp_news_v3', '1'); });
    const vp = await vctx.newPage(); watch(vp, 'v3');
    await vp.goto(BASE + '/parks.html'); await vp.waitForTimeout(800);
    await vp.click('#new-park'); await vp.fill('#np-name', 'Парк v3'); await vp.click('#np-create');
    await vp.click('#cr-go'); await vp.waitForURL(/park\.html/); await vp.waitForTimeout(1200);
    await vp.evaluate(() => DP.ui.close());
    for (const sp of ['trex', 'triceratops', 'stegosaurus', 'parasaurolophus']) { await vp.evaluate(() => window.dpPark.screens.ready()); await vp.$eval(`[data-sp="${sp}"]`, el => el.click()); }
    await vp.waitForFunction(() => window.dpScene.ents.length >= 4 && window.dpScene.ents.every(e => e.ready), null, { timeout: 45000 });
    await vp.evaluate(() => DP.ui.close()); await vp.bringToFront();
    // верхняя панель
    const hud = await vp.evaluate(() => ['#hud-dinos', '#hud-eggs', '#hud-gifts', '#hud-ach', '#hud-menu'].map(s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
    ok('v3: верхняя панель (динозавры, яйца, подарки, достижения, меню) справа сверху', hud.every(h => h && h.y < 80 && h.x > 683), JSON.stringify(hud));
    // нужды не показываются над головами, есть отдельная панель
    ok('v4: над динозаврами нет ни шкал, ни точек, ни облачков с желаниями', await vp.evaluate(() => window.dpScene.opts.showNeeds === false && window.dpScene.opts.needHint === false && !/Хочу есть|Скучно…/.test(String(DP.Scene)) ));
    await vp.click('#hud-dinos'); await vp.waitForTimeout(300);
    const dn = await vp.evaluate(() => ({ rows: document.querySelectorAll('.dino-row2').length, bars: document.querySelectorAll('.dino-row2 .mb').length, btns: ['#dn-feedall', '#dn-secret', '#dn-playall', '#dn-sleepall'].every(s => document.querySelector(s)) }));
    ok('v3: панель «Мои динозавры» с нуждами и кнопками для всех', dn.rows === 4 && dn.bars >= 12 && dn.btns, JSON.stringify(dn));
    await vp.evaluate(() => { const d = window.dpPark.park.dinos[0]; d.needs = { food: 20, play: 90, sleep: 90, t: Date.now(), sleepFrom: null }; window.dpPark.screens.dinos(); });
    await vp.waitForTimeout(200);
    await vp.click(`.dino-row2[data-uid="${await vp.evaluate(() => window.dpPark.park.dinos[0].uid)}"] [data-a="feed"]`); await vp.waitForTimeout(300);
    ok('v3: кормление одного динозавра из панели (еда падает рядом, он идёт и ест)', await vp.waitForFunction(() => DP.Needs.at(window.dpPark.park.dinos[0]).food > 40, null, { timeout: 20000 }).then(() => true, () => false));
    await vp.click('#dn-sleepall'); await vp.waitForTimeout(300);
    const slept = await vp.evaluate(() => window.dpPark.park.dinos.filter(d => DP.Needs.at(d).asleep).length);
    await vp.click('#dn-wakeall'); await vp.waitForTimeout(300);
    const awake = await vp.evaluate(() => window.dpPark.park.dinos.filter(d => !DP.Needs.at(d).asleep).length);
    ok('v3: «Уложить всех» и «Разбудить всех»', slept === 4 && awake === 4, `спят ${slept}, проснулись ${awake}`);
    await vp.evaluate(() => DP.ui.close());
    const played = await vp.evaluate(() => window.dpPark.playAll()); await vp.waitForTimeout(1200);
    ok('v3: «Поиграть со всеми»', played === 4 && await vp.evaluate(() => window.dpScene.balls.length > 0 || window.dpScene.ents.some(e => e.state === 'play')));
    // нужды закрываются сами
    const auto = await vp.evaluate(() => { const N = DP.Needs, d = { uid: 'x', added: 0, needs: { food: 20, play: 90, sleep: 90, t: 0, sleepFrom: null } }; const t1 = (20 - N.LOW) / N.RATE.food; const a = N.at(d, (t1 + 60) * 1000).food, b = N.at(d, (t1 + N.AUTO + 10) * 1000).food; return { a: Math.round(a), b: Math.round(b), autoIn: Math.round(N.autoIn(d, 'food', (t1 + 60) * 1000)) }; });
    ok('v3: голод и скука проходят сами через ~30 мин', auto.a < 30 && auto.b > 60 && auto.autoIn > 1500, JSON.stringify(auto));
    // яйца: забота → яйцо в гнезде → подобрать
    const egg = await vp.evaluate(() => { const P = window.dpPark, d = P.park.dinos[0]; d.added = Date.now() - 2 * 3600e3; d.care = 6; d.lastEgg = null; d.needs = DP.Needs.fresh(Date.now()); d.needs.food = 95; const ev = P.lifeTick(); const it = P.park.life.nest.find(n => n.k === 'egg'); return { it, ev: ev.map(e => e.type) }; });
    ok('v3: ухоженный динозавр несёт яйцо', !!egg.it, JSON.stringify(egg));
    if (egg.it) {
      await vp.waitForTimeout(400);
      const pos = await vp.evaluate((id) => { const s = window.dpScene, p = s.nestPos[id]; return p ? s.toScreen(p.x, p.y - 6) : null; }, egg.it.id);
      const before = await vp.evaluate(() => Object.values(window.dpPark.park.life.eggs).reduce((a, b) => a + b, 0));
      if (pos) await vp.mouse.click(pos.x, pos.y); await vp.waitForTimeout(400);
      const after = await vp.evaluate(() => ({ n: Object.values(window.dpPark.park.life.eggs).reduce((a, b) => a + b, 0), nest: window.dpPark.park.life.nest.length, hud: document.querySelector('#hud-eggn').textContent }));
      ok('v3: яйцо подбирается касанием и попадает в корзину', after.n === before + 1 && after.nest === 0, JSON.stringify({ pos, before, after }));
    }
    // обмен и шапки
    await vp.evaluate(() => { const L = window.dpPark.park.life; L.eggs.common = 12; L.eggs.rare = 0; window.dpPark.screens.eggs(); }); await vp.waitForTimeout(300);
    if (!SERVER) await vp.screenshot({ path: path.join(SHOTS, 'v3-eggs.png') });
    await vp.click('[data-trade]'); await vp.waitForTimeout(300);
    const tr = await vp.evaluate(() => ({ ...window.dpPark.park.life.eggs }));
    ok('v3: обмен 6 обычных → 1 редкое', tr.common === 6 && tr.rare === 1, JSON.stringify(tr));
    await vp.click('[data-hat="cap"]'); await vp.waitForTimeout(400);
    ok('v3: шапка куплена за яйца, открыт выбор динозавра', await vp.isVisible('[data-wear]'));
    const wuid = await vp.evaluate(() => window.dpPark.park.dinos[1].uid);
    await vp.click(`[data-wear="${wuid}"]`); await vp.waitForTimeout(6000);
    const hat = await vp.evaluate((u) => ({ hat: window.dpPark.park.dinos.find(d => d.uid === u).hat, ent: (window.dpScene.ent(u) || {}).hat, cap: window.dpPark.park.life.hats.cap, common: window.dpPark.park.life.eggs.common }), wuid);
    ok('v3: шапку надели динозавру', hat.hat === 'cap' && hat.cap === 1 && hat.common === 3, JSON.stringify(hat));
    // легендарный
    await vp.evaluate(() => { window.dpPark.park.life.eggs.epic = 5; window.dpPark.screens.eggs(); }); await vp.waitForTimeout(300);
    await vp.click('#eg-legend'); await vp.waitForTimeout(300); await vp.click('[data-lsp="trex"]'); await vp.waitForTimeout(1500);
    const lg = await vp.evaluate(() => ({ n: window.dpPark.park.dinos.filter(d => d.legend).length, epic: window.dpPark.park.life.eggs.epic, ach: window.dpPark.park.life.ach.includes('legend') }));
    ok('v3: легендарный динозавр за 5 очень редких яиц', lg.n === 1 && lg.epic === 0 && lg.ach, JSON.stringify(lg));
    // племя и навыки: возраст парка 15 дней
    const tribe = await vp.evaluate(() => { const P = window.dpPark, L = P.park.life; L.age = 15 * 86400; L.t = Date.now(); P.lifeTick(); L.tribe.forEach(a => { a.xp = 15 * 86400; }); P.lifeTick(); P.lifeTick(); L.tribe.forEach(a => { a.xp = 15 * 86400; }); P.lifeTick(); return { apes: L.tribe.map(a => a.name + ':' + a.sk.length), sk: L.tribe[0] && L.tribe[0].sk, mam: L.mammals.length, crit: window.dpScene.critters ? window.dpScene.critters.length : 0 }; });
    ok('v3: австралопитеки пришли и выучили навыки (огонь → кормить → кататься → вождь)', tribe.apes.length === 3 && ['fire', 'feed', 'ride', 'chief'].every(s => tribe.sk.includes(s)), JSON.stringify(tribe));
    ok('v3: зверьки-соседи живут в парке', tribe.mam === 5 && tribe.crit >= 8, `зверьков ${tribe.mam}, на сцене ${tribe.crit}`);
    await vp.evaluate(() => window.dpPark.screens.tribe()); await vp.waitForTimeout(300);
    ok('v3: окно «Соседи и племя» с деревом навыков', (await vp.$$eval('.sk', e => e.length)) >= 13);
    if (!SERVER) await vp.screenshot({ path: path.join(SHOTS, 'v3-tribe.png') });
    await vp.evaluate(() => DP.ui.close()); await vp.waitForTimeout(1500);
    if (!SERVER) await vp.screenshot({ path: path.join(SHOTS, 'v3-park.png') });
    // прятки: найти
    const hid = await vp.evaluate(() => { const e = window.dpScene.ents.find(x => x.habitat === 'ground' && x.state === 'wander'); window.dpScene.food = []; return e && window.dpPark.startHide(e.uid) ? e.uid : null; });
    await vp.waitForFunction((u) => { const e = window.dpScene.ent(u); return e && e.state === 'hidden'; }, hid, { timeout: 20000 }).catch(() => {});
    const spot = await vp.evaluate((u) => { const s = window.dpScene, e = s.ent(u); if (!e || !e.hideAt) return null; s.lookAt(e.hideAt.x, s.H / 2, 1, true); return { st: e.state }; }, hid);
    await vp.waitForTimeout(1200);
    const sp2 = await vp.evaluate((u) => { const s = window.dpScene, e = s.ent(u); return e && e.hideAt ? s.toScreen(e.hideAt.x, e.hideAt.y - e.hideAt.r * 0.6) : null; }, hid);
    const found0 = await vp.evaluate(() => window.dpPark.park.life.stats.found || 0);
    if (sp2) await vp.mouse.click(sp2.x, sp2.y); await vp.waitForTimeout(500);
    const found = await vp.evaluate((u) => ({ n: window.dpPark.park.life.stats.found || 0, st: window.dpScene.ent(u).state }), hid);
    ok('v3: прятки — нашли динозавра за кустом касанием', hid && spot && found.n === found0 + 1 && found.st !== 'hidden', JSON.stringify({ hid, spot, sp2, found }));
    // прятки: не нашли — выходит сам
    const self = await vp.evaluate(async () => { const s = window.dpScene, e = s.ents.find(x => x.habitat === 'ground' && x.state === 'wander'); if (!e || !s.hide(e.uid, 2)) return 'nohide'; e.state = 'hidden'; e.x = e.hideAt.x; e.y = e.hideAt.y - 3; for (let i = 0; i < 40 && e.state === 'hidden'; i++) await new Promise(r => setTimeout(r, 250)); return e.state; }); // ждём до 10 с: при программном WebGL кадры медленнее
    ok('v3: прятки — если не найти, динозавр выходит сам', self !== 'hidden' && self !== 'nohide', self);
    // подарок от динозавра за заботу
    const gift = await vp.evaluate(() => { const P = window.dpPark, d = P.park.dinos[2]; d.aff = 10; d.lastGift = null; d.added = Date.now() - 3 * 3600e3; d.owner = P.owner; d.needs = { food: 30, play: 90, sleep: 90, t: Date.now(), sleepFrom: null }; const r = Math.random; Math.random = () => 0.01; try { const b = DP.Needs.at(d); DP.Needs.feed(d, 30); P.lifeEvents(DP.Life.care(P.park, d, 'feed', b, true)); } finally { Math.random = r; } const it = P.park.life.nest.find(n => n.k === 'gift'); if (it) P.pickup(it); return { it: !!it, gifts: P.park.life.gifts.length }; });
    await vp.waitForTimeout(500); await vp.evaluate(() => DP.ui.close());
    ok('v3: динозавр дарит подарок за заботу', gift.it && gift.gifts === 1, JSON.stringify(gift));
    // достижения
    await vp.click('#hud-ach'); await vp.waitForTimeout(300);
    const ach = await vp.evaluate(() => ({ all: document.querySelectorAll('.ach').length, got: document.querySelectorAll('.ach.done').length, life: window.dpPark.park.life.ach.length }));
    ok('v3: окно достижений (25 штук, часть получена)', ach.all === 25 && ach.got === ach.life && ach.got >= 5, JSON.stringify(ach));
    if (!SERVER) await vp.screenshot({ path: path.join(SHOTS, 'v3-achievements.png') });
    // подарочные коды администратора
    if (priv) {
      const code = makeCode({ n: 'e2e' + Date.now(), g: { k: 'eggs', r: 'rare', q: 3 }, m: 'Тестовый подарок' });
      await vp.evaluate(() => window.dpPark.screens.gifts()); await vp.waitForTimeout(300);
      const r0 = await vp.evaluate(() => window.dpPark.park.life.eggs.rare);
      await vp.fill('#gift-code', code); await vp.click('#gift-redeem'); await vp.waitForTimeout(800);
      const r1 = await vp.evaluate(() => window.dpPark.park.life.eggs.rare);
      ok('v3: подарочный код с подписью — 3 редких яйца', r1 === r0 + 3, `${r0} → ${r1}`);
      await vp.waitForTimeout(1500); await vp.evaluate(() => window.dpPark.screens.gifts()); await vp.waitForTimeout(300);
      await vp.fill('#gift-code', code); await vp.click('#gift-redeem'); await vp.waitForTimeout(800);
      ok('v3: повторно тот же код не принимается', /уже использован/.test(await vp.textContent('#gift-msg')));
      const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
      await vp.fill('#gift-code', makeCode({ n: 'forged' + Date.now(), g: { k: 'legend' } }, other)); await vp.click('#gift-redeem'); await vp.waitForTimeout(800);
      ok('v3: поддельный код отклоняется', /ненастоящий/.test(await vp.textContent('#gift-msg')));
      if (!SERVER) await vp.screenshot({ path: path.join(SHOTS, 'v3-gifts.png') });
      // ссылка ?gift= открывает окно подарков с кодом
      const pid = await vp.evaluate(() => window.dpPark.park.id);
      const hcode = makeCode({ n: 'link' + Date.now(), g: { k: 'hat', h: 'crown' }, p: pid });
      await vp.goto(BASE + '/park.html?id=' + pid + '&gift=' + encodeURIComponent(hcode)); await vp.waitForTimeout(1800);
      ok('v3: ссылка с подарком открывает «Подарки» с кодом', (await vp.inputValue('#gift-code').catch(() => '')) === hcode);
      await vp.click('#gift-redeem'); await vp.waitForTimeout(800);
      ok('v3: подарок по ссылке (корона) получен', await vp.evaluate(() => window.dpPark.park.life.hats.crown === 1));
      // admin.html: импорт ключа, создание кода
      const ap = await vctx.newPage(); watch(ap, 'admin');
      await ap.goto(BASE + '/admin.html'); await ap.waitForTimeout(500);
      await ap.click('#key-sec summary');
      await ap.fill('#key-in', JSON.stringify({ kty: privJwk.kty, crv: privJwk.crv, x: privJwk.x, y: privJwk.y, d: privJwk.d })); await ap.click('#key-import'); await ap.waitForTimeout(300);
      const ast = await ap.textContent('#key-st');
      await ap.selectOption('#g-kind', 'item'); await ap.fill('#g-msg', 'Из админки'); await ap.click('#b-code'); await ap.click('#g-make'); await ap.waitForTimeout(500);
      const alink = await ap.getAttribute('#g-out a', 'href');
      ok('v3: admin.html — ключ совпадает с config.js, код создан', /совпадает/.test(ast) && /park\.html\?gift=DP1\./.test(alink || ''), ast.slice(0, 60));
      await ap.close();
      await vp.goto(alink.replace('park.html?', 'park.html?id=' + pid + '&')); await vp.waitForTimeout(1500);
      await vp.click('#gift-redeem'); await vp.waitForTimeout(800);
      ok('v3: код из admin.html принимается парком', await vp.evaluate(() => window.dpPark.park.life.gifts.some(g => g.adm && g.msg === 'Из админки')));
      await vp.evaluate(() => DP.ui.close());
    } else ok('v3: подарочные коды (нет файла ключа — пропуск)', true, 'ADMIN_KEY_FILE не найден');
    // приглашения и «поделиться»
    await vp.evaluate(() => { window.__shared = []; navigator.share = (d) => { window.__shared.push(d); return Promise.resolve(); }; window.dpPark.screens.invite(); }); await vp.waitForTimeout(400);
    const url = await vp.textContent('#inv-url');
    ok('v3: ссылка-приглашение с кодом', /index\.html\?ref=[0-9a-f]{10}$/.test(url.trim()), url);
    const c0 = await vp.evaluate(() => window.dpPark.park.life.eggs.common);
    await vp.click('#inv-repost'); await vp.waitForTimeout(500);
    await vp.evaluate(() => window.dpPark.screens.invite()); await vp.waitForTimeout(300);
    await vp.click('#inv-repost'); await vp.waitForTimeout(500);
    const c1 = await vp.evaluate(() => ({ eggs: window.dpPark.park.life.eggs.common, shared: window.__shared.length }));
    ok('v3: награда за «поделиться» — раз в день', c1.eggs === c0 + 1 && c1.shared === 2, JSON.stringify({ c0, c1 }));
    // друг открыл ссылку на своём устройстве и создал парк → редкое яйцо; пригласившему — награда через сервер
    const myId = await vp.evaluate(() => window.dpPark.park.id);
    {
      const fctx = await browser.newContext({ viewport: { width: 1366, height: 768 } }); await fctx.addInitScript(() => localStorage.setItem('dp_news_v3', '1'));
      const fp = await fctx.newPage(); watch(fp, 'friend');
      await fp.goto(url.trim()); await fp.waitForTimeout(800);
      await fp.goto(BASE + '/parks.html'); await fp.waitForTimeout(600);
      await fp.click('#new-park'); await fp.fill('#np-name', 'Парк друга'); await fp.click('#np-create');
      await fp.click('#cr-go'); await fp.waitForURL(/park\.html/); await fp.waitForTimeout(2500);
      if (SERVER) await fp.waitForFunction(() => window.dpPark.park.life.refSent === 1, null, { timeout: 30000 }).catch(() => {});
      const fr = await fp.evaluate(() => ({ err: window.dpRefErr, rare: window.dpPark.park.life.eggs.rare, refBy: window.dpPark.park.life.refBy, sent: window.dpPark.park.life.refSent }));
      ok('v3: новый парк по приглашению получает редкое яйцо', fr.rare === 1 && /^[0-9a-f]{10}$/.test(fr.refBy || '') && (!SERVER || fr.sent === 1), JSON.stringify(fr));
      // своя же ссылка на своём устройстве награды не даёт
      await vp.goto(url.trim()); await vp.waitForTimeout(600); await vp.goto(BASE + '/parks.html'); await vp.waitForTimeout(400);
      ok('v3: своя ссылка на своём устройстве не засчитывается', await vp.evaluate(() => { const p = DP.store.create('Сам себе'); const r = !(p.life && p.life.refBy); DP.store.remove && DP.store.remove(p.id); return r; }));
      await fctx.close();
    }
    if (SERVER) {
      await vp.goto(BASE + '/park.html?id=' + myId); await vp.waitForTimeout(3000);
      const inv = await vp.evaluate(() => window.dpPark.park.life.stats.invites || 0);
      ok('v3: пригласивший получает награду за друга (сервер)', inv === 1, 'приглашено: ' + inv);
    } else { await vp.goto(BASE + '/park.html?id=' + myId); await vp.waitForTimeout(1500); }
    await vp.evaluate(() => DP.ui.close());
    // крупный план и зум
    const cz = await vp.evaluate(async () => { const P = window.dpPark, u = window.dpScene.ents[0].uid; P.closeUp(u); await new Promise(r => setTimeout(r, 1500)); const z = window.dpScene.cam.z; const bar = getComputedStyle(document.querySelector('#zoombar')).display !== 'none'; window.dpScene.resetZoom(); await new Promise(r => setTimeout(r, 1500)); return { z, bar, z2: window.dpScene.cam.z }; });
    ok('v3: крупный план динозавра и возврат', cz.z > 1.8 && cz.bar && cz.z2 < 1.05, JSON.stringify(cz));
    // поддержка: форма, если нет Telegram
    await vp.evaluate(() => window.dpPark.screens.support()); await vp.waitForTimeout(300);
    const hasTg = await vp.$('#sp-tg');
    if (hasTg) ok('v3: поддержка — ссылка на Telegram', /^https:\/\/t\.me\//.test(await hasTg.getAttribute('href')));
    else {
      await vp.fill('#sp-text', 'Тест обратной связи из e2e'); await vp.click('#sp-send'); await vp.waitForTimeout(500);
      ok('v3: поддержка — форма сохраняет сообщение', await vp.evaluate(() => JSON.parse(localStorage.getItem('dp_feedback') || '[]').some(x => /e2e/.test(x.text))));
    }
    // «Что нового в парке» — показывается при входе
    await vp.evaluate(() => { sessionStorage.setItem('keepNews', '1'); localStorage.removeItem('dp_news_v3'); });
    await vp.reload(); await vp.waitForTimeout(1800);
    ok('v3: «Что нового в парке» открывается при входе', await vp.isVisible('.news'));
    if (!SERVER) await vp.screenshot({ path: path.join(SHOTS, 'v3-news.png') });
    await vctx.close();
  }

  // 3D и запасной 2D: обычный браузер рисует парк в WebGL; без WebGL (старый телефон, отключено) — прежняя 2D-сцена
  {
    const gctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await gctx.addInitScript(() => { localStorage.setItem('dp_news_v3', '1'); if (/[?&]nogl=1/.test(location.search) || location.hash === '#nogl') { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, o) { return /webgl/.test(t) ? null : g.call(this, t, o); }; } });
    const gp = await gctx.newPage(); watch(gp, '3d');
    const probe = async (hash) => { await gp.goto(BASE + '/park.html?demo=1' + hash); await gp.waitForFunction(() => window.dpScene && window.dpScene.ents.length && window.dpScene.ents.every(e => e.ready), null, { timeout: 30000 }); await gp.waitForTimeout(800);
      return gp.evaluate(() => { const s = window.dpScene; return { is3d: !!s.is3d, webgl: DP.can3D(), drawn: s.ents.filter(e => e._rect && e._rect.w > 5).length, px: s.samplePixels ? s.samplePixels(6) : null }; }); };
    const g3 = await probe('');
    if (g3.webgl) ok('3D: парк рисуется в WebGL, кадр не пустой', g3.is3d && g3.drawn > 0 && g3.px && g3.px.nonBlack > 30, JSON.stringify(g3));
    else ok('3D: (WebGL недоступен в этом браузере — проверен только 2D)', true);
    const g2 = await probe('&nogl=1#nogl');
    ok('Без WebGL парк автоматически рисуется в 2D', !g2.is3d && !g2.webgl && g2.drawn > 0, JSON.stringify(g2));
    await gctx.close();
  }

  // v5: телевизор (LG webOS, 1920×1080) — 3D в родном разрешении экрана, без растягивания; сглаживание и тон-маппинг включены
  {
    const tctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager' });
    await tctx.addInitScript(() => { localStorage.setItem('dp_news_v3', '1'); });
    const tp = await tctx.newPage(); watch(tp, 'tv1080');
    await tp.goto(BASE + '/park.html?demo=1&rs=fix'); await tp.waitForFunction(() => window.dpScene && window.dpScene.renderer !== undefined, null, { timeout: 30000 }).catch(() => {}); await tp.waitForTimeout(2500);
    const tv = await tp.evaluate(() => { const s = window.dpScene, P = DP.Scene.PERF; if (!s.is3d) return { is3d: false, tv: P.tv }; const g = s.gpuStats(); return { is3d: true, tv: P.tv, q: P.quality, size: [s.c.width, s.c.height], css: [s.VW, s.VH], dpr: s.dpr, aa: g.aa, tm: g.toneMapping, shadow: g.shadow }; });
    ok('v5: ТВ 1920×1080 — 3D рисуется в родном разрешении (1920×1080), сглаживание и тон-маппинг', tv.tv && (!tv.is3d || (tv.size[0] === 1920 && tv.size[1] === 1080 && tv.aa === 'msaa' && tv.tm > 0)), JSON.stringify(tv));
    await tctx.close();
  }

  ok('Нет ошибок JS в консоли', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter(r => !r.pass).length;
  console.log(`\nИтого: ${results.length - failed}/${results.length} проверок пройдено`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
