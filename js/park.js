/* Динопарк — страница парка (она же «пульт»): меню по нажатию, динозавры с потребностями,
 * кормление (всех / тайно своих), локации и путешествия, фото раскраски, ТВ, управление парком. */
(async function () {
  const U = DP.util, S = DP.store, Y = DP.sync, UI = DP.ui, N = DP.Needs, V = DP.Voices, Life = DP.Life, $ = (s) => document.querySelector(s);
  const ME = S.owner();
  let shownView = null; // какая локация сейчас на экране
  const DEMO = U.param('demo') === '1';
  const LOCS = DP.BG.LIST;
  const locName = (id) => (DP.BG.byId[id] || LOCS[0]).name;
  const spOf = (d) => DP.Dinos.byId[d.species || d.base];
  const dinoName = (d) => d.name || (spOf(d) ? spOf(d).name : 'Мой рисунок');
  const dinoImg = (d) => d.sprite || DP.Dinos.thumb(d.species, d.palette || 0);

  let park = null, mode = 'local';
  if (DEMO) park = demoPark();
  else {
    mode = await Y.connect();
    const pid = U.param('id'), ppin = U.param('pin');
    if (pid && ppin) { // открыли по QR «сфотографировать телефоном»
      try { park = await Y.openPark(pid, ppin); } catch (e) { U.toast('⚠️ ' + e.message, 5000); }
    }
    park = park || S.get(pid || S.current());
    if (!park) { location.replace('parks.html' + (pid ? '?code=' + encodeURIComponent(pid) : '')); return; }
    S.setCurrent(park.id); S.addMine(park.id);
    const keep = new URLSearchParams(); keep.set('id', park.id);
    ['fast', 'tod', 'speed', 'r'].forEach(k => { if (U.param(k)) keep.set(k, U.param(k)); });
    history.replaceState(null, '', 'park.html?' + keep.toString()); // PIN из адресной строки убираем
  }
  S.normalize(park); Life.ensure(park);
  document.title = 'Динопарк — ' + park.name;

  const canvas = $('#park');
  const scene = DP.makeScene(canvas, {
    entrance: false, tod: U.param('tod') || localStorage.getItem('dp_tod') || 'auto',
    world: { aspect: 1.75 }, showNeeds: false, needHint: false, maxFps: DP.Scene.PERF.mobile ? 30 : 0,
    onEat: (e, f) => { // засчитывает только то устройство, которое бросило корм
      if (f.by !== ME) return;
      const d = dino(e.uid); if (!d) return;
      const before = N.at(d); N.feed(d, f.secret ? 45 : 30); careFor(d, 'feed', before); commitSoon();
    },
    onWake: () => { if (current === 'card') refreshCard(); },
    onDuo: (a, b) => { [a, b].forEach(x => { const d = dino(x.uid); if (d) N.play(d, 12); }); park.life.stats.duo = (park.life.stats.duo || 0) + 1; lifeEvents(Life.checkAch(park)); commitSoon(); },
    onHide: (e, found) => {
      const d = dino(e.uid); if (!d) return;
      if (found) { careFor(d, 'found', null); /* careFor считает stats.found */ showHint(`🎉 Нашёл! ${dinoName(d)} очень рад`, 3500); }
      else showHint(`🙈 ${dinoName(d)} вышел сам — в следующий раз найди быстрее!`, 4000);
      lifeEvents(Life.checkAch(park)); commitSoon();
    },
    onPan: () => { if (!panTold) { panTold = true; showHint('🤏 Двумя пальцами — приблизить и отдалить', 3500); } }
  });
  let panTold = false;
  window.dpScene = scene; // для отладки/тестов
  // v5: пока открыта панель (меню, выбор динозавра), сцена за ней рисуется ~10 к/с — на телефоне это освобождает GPU,
  // и списки/прокрутка перестают подвисать
  document.addEventListener('dp-ui', (ev) => { scene.dimFps = ev.detail.open && DP.Scene.PERF.mobile ? 10 : 0; });
  apply(true);
  scene.opts.entrance = true;
  // v5: миниатюры для меню готовим заранее, в фоне (после загрузки сцены) — выбор динозавров открывается мгновенно
  setTimeout(() => DP.Dinos.warmThumbs(DP.Dinos.SPECIES.map(s => [s.id, 0]).concat(park.dinos.filter(d => !d.sprite && d.species).map(d => [d.species, d.palette || 0]))), 3500);

  if (!DEMO) {
    Y.subscribe(park);
    Y.on('park', (p) => {
      if (p.id !== park.id) return;
      p.pin = park.pin; park = S.normalize(p); Life.ensure(park); apply(); lifeInbox(); updateHud();
      if (UI.isOpen() && current === 'menu') screens.menu(true);
      if (UI.isOpen() && current === 'card') refreshCard();
    });
    Y.on('event', handleEvent);
    Y.on('status', () => { if (UI.isOpen() && current === 'menu') screens.menu(true); });
    Y.on('deleted', (id) => { if (id !== park.id) return; S.remove(park.id); U.toast('🗑️ Этот парк удалили', 4000); setTimeout(() => location.replace('parks.html'), 1500); });
    Y.on('tvs', (n) => { if (n && UI.isOpen() && current === 'tv') { U.toast('📺 Телевизор подключён!', 3500); screens.tv(); } });
    Y.on('error', (m) => { U.toast('⚠️ ' + (m && m.error || 'Ошибка сервера'), 5000); });
  }

  function dino(uid) { return park.dinos.find(d => d.uid === uid); }
  function here() { return park.dinos.filter(d => d.loc === park.view); }
  function mine(list) { return (list || here()).filter(d => d.owner === ME); }
  function apply(instant) {
    if (shownView !== park.view) { instant = true; shownView = park.view; } // смена локации — сразу показываем её обитателей
    const custom = park.customBg && park.customLoc === park.view;
    scene.setBackground(custom ? 'custom' : park.view, park.customBg);
    scene.setDinos(here(), instant);
    scene.setLife(park.life, park);
    document.title = 'Динопарк — ' + park.name;
  }
  function commit() { clearTimeout(soonT); park.updated = Date.now(); if (DEMO) S.normalize(park); else Y.pushPark(park); apply(); }
  let soonT = null;
  function commitSoon() { clearTimeout(soonT); soonT = setTimeout(commit, 400); }
  function handleEvent(ev) {
    if (!ev) return;
    if (ev.type === 'feed') { scene.dropFood(ev.items || []); }
    if (ev.type === 'jump') scene.jump(ev.uid, ev.text);
    if (ev.type === 'play') scene.play(ev.uid, ev.u);
    if (ev.type === 'pet') { const e = scene.ent(ev.uid); if (e) { scene.hearts(e.x, e.y - 40); scene.jump(ev.uid, ev.text || '💚'); } }
  }
  function fire(ev) { handleEvent(ev); if (!DEMO) Y.sendEvent(park, ev); }

  // --- подсказки ---
  const hint = $('#hint');
  let hintTimer = null;
  function showHint(text, ms) { hint.textContent = text; hint.classList.remove('fade'); clearTimeout(hintTimer); hintTimer = setTimeout(() => hint.classList.add('fade'), ms || 4000); }
  if (DEMO) { const b = document.createElement('div'); b.className = 'demo-badge glass'; b.innerHTML = '🎬 Демо-режим — ничего не сохраняется · <a href="parks.html">Создать свой парк</a>'; document.body.appendChild(b); }
  function emptyHint() {
    if (!park.dinos.length) return '👆 Нажми на парк и добавь первого динозавра!';
    if (!here().length) return `🧭 В «${locName(park.view)}» пока никого — динозавры гуляют в других локациях`;
    return '👆 Нажми на динозавра — увидишь, чего он хочет. На пустое место — откроется меню';
  }
  showHint(emptyHint(), 6000);

  // --- нажатия на парк ---
  // v5: после «Покормить всех» нажатия на парк больше НЕ перехватываются режимом корма (раньше каждое нажатие бросало
  // корм и продлевало режим ещё на 8 с — меню было не открыть). Вместо этого — отдельная кнопка «🍖 Ещё корм» на 8 с.
  const feedBtn = document.createElement('button');
  feedBtn.id = 'feed-more'; feedBtn.type = 'button'; feedBtn.className = 'feed-more glass hidden'; feedBtn.innerHTML = '🍖 Ещё корм';
  document.body.appendChild(feedBtn);
  let feedBtnTimer = null;
  const showFeedBtn = (ms) => { feedBtn.classList.remove('hidden'); clearTimeout(feedBtnTimer); feedBtnTimer = setTimeout(() => feedBtn.classList.add('hidden'), ms || 8000); };
  feedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const vw = canvas.clientWidth, vh = canvas.clientHeight;
    const w = scene.toWorld(vw * (0.3 + Math.random() * 0.4), vh * (0.55 + Math.random() * 0.25));
    const it = scene.foodAt(w.x, w.y); it.by = ME; fire({ type: 'feed', items: [it] }); showFeedBtn(8000);
  });
  canvas.addEventListener('click', (e) => {
    if (UI.isOpen()) { UI.close(); return; }
    if (scene.wasDrag()) return;
    const r = canvas.getBoundingClientRect(), w = scene.toWorld(e.clientX - r.left, e.clientY - r.top), x = w.x, y = w.y;
    const hid = scene.hitHidden(x, y);
    if (hid) { scene.unhide(hid, true); return; }
    const ex = scene.hitExtra(x, y);
    if (ex && ex.kind === 'nest') { pickup(ex.item); return; }
    const en = scene.hit(x, y);
    if (ex && ex.kind === 'critter' && !en) { critterSay(ex.c); return; }
    if (en) { fire({ type: 'jump', uid: en.uid, text: U.pick(['РРРР! 🦖', '😄', '💚', 'Привет! 👋', '🎵', '😝', 'Ррр! 🔥', '⭐', '🤗', 'Ура! 🎉']) }); go('card', en.uid); return; }
    feedBtn.classList.add('hidden');
    screens.menu();
  });

  // --- экраны ---
  let current = null, tvTimer = null, cardTimer = null, cardUid = null;
  UI.onClose(() => { clearInterval(cardTimer); clearInterval(tvTimer); current = null; curSection = null; });
  const backTo = () => (curSection ? screens.section(curSection) : go('menu'));
  function go(name, arg) { current = name; clearInterval(tvTimer); clearInterval(cardTimer); screens[name](arg); }
  const voicesRow = () => V && V.isOn() ? ['voices', '🗣️', 'Голоса динозавров: включены', 'Рычат, когда их трогают, едят и просыпаются'] : ['voices', '🤐', 'Голоса динозавров: выключены', 'Нажми, чтобы включить'];
  const musicRow = () => DP.music && DP.music.isOn() ? ['music', '🔊', 'Музыка: включена', 'Приключенческий оркестр и птицы джунглей · нажми, чтобы выключить'] : ['music', '🔇', 'Музыка: выключена', 'Нажми, чтобы включить фоновую музыку'];
  // меню: быстрые действия сверху + шесть больших разделов; внутри разделов — прежние пункты
  const SECTIONS = [
    ['dinos', '🦕', 'Динозавры'], ['acts', '⚡', 'Действия'], ['locs', '🧭', 'Локации'],
    ['rewards', '🏆', 'Награды'], ['tv', '📺', 'ТВ'], ['more', '⚙️', 'Ещё']
  ];
  function secLine(id) {
    const h = here();
    if (id === 'dinos') return U.dinoCount(park.dinos.length) + (park.dinos.some(d => d.owner === ME && N.at(d).low.length) ? ' · ждут заботы' : '');
    if (id === 'acts') return h.length ? 'Корм, игра, сон' : 'Здесь пока никого';
    if (id === 'locs') return locName(park.view);
    if (id === 'rewards') return '🥚 ' + Life.total(park.life) + ' · 🎁 ' + park.life.gifts.length + ' · 🏆 ' + park.life.ach.length;
    if (id === 'tv') { const ti = Y.tvInfo ? Y.tvInfo() : null; return ti && ti.paired ? 'Сопряжено: ' + ti.paired : 'Смарт-ТВ, планшет, ПК'; }
    return 'Музыка, поделиться, парк';
  }
  function sectionRows(id) {
    const h = here(), my = mine(h), anyAwake = park.dinos.some(d => !N.at(d).asleep);
    if (id === 'dinos') return [
      ['dinos', '🦕', 'Мои динозавры и их желания', `${U.dinoCount(park.dinos.length)} · 🍖 голод · 🎾 игра · 💤 сон`],
      ['photo', '📷', 'Сфотографировать динозавра', 'Раскрашенный лист оживёт в парке'],
      ['ready', '🦖', 'Запустить готового динозавра', 'Из набора, без раскрашивания'],
      ['coloring', '🖨️', 'Раскраски для печати', DP.Dinos.SPECIES.length + ' видов динозавров на обычном листе А4'],
      ['cleanup', '🧹', 'Убрать динозавров', 'Удалить лишних из парка']];
    if (id === 'acts') return [
      ['feedall', '🍖', 'Покормить всех', h.length ? 'Корм упадёт для всех динозавров — увидят все экраны' : 'Здесь пока некого кормить'],
      ['secret', '🤫', 'Тайно покормить своих', my.length ? `Корм только возле твоих (${my.length}) — без объявления на ТВ` : 'Своих здесь нет: запусти динозавра с этого устройства'],
      anyAwake || !park.dinos.length ? ['sleepall', '💤', 'Уложить всех спать', 'Все динозавры отдохнут и выспятся'] : ['wakeall', '☀️', 'Разбудить всех', 'Подъём!'],
      ['playall', '🎾', 'Поиграть со всеми', 'Мячи для всех, кто не спит'],
      ['hide', '🙈', 'Прятки', 'Кто-нибудь спрячется — найди его']];
    if (id === 'locs') return [
      ['locs', '🧭', 'Локации и путешествия', 'Сейчас: ' + locName(park.view)],
      ['bg', '🖼️', 'Свой фон', park.customBg ? 'Своя картинка в «' + locName(park.customLoc) + '»' : 'Загрузить свою картинку вместо фона локации']];
    if (id === 'rewards') return [
      ['eggs', '🥚', 'Яйца и награды', eggsLine() + ' · шапки и золотой динозавр'],
      ['gifts', '🎁', 'Подарки', (park.life.gifts.length ? 'Получено: ' + park.life.gifts.length : 'Пока пусто') + ' · ввести подарочный код'],
      ['ach', '🏆', 'Достижения', park.life.ach.length + ' из ' + Life.ACH.length],
      ['tribe', '🐒', 'Соседи и племя', park.life.tribe.length ? park.life.tribe.map(a => a.name).join(', ') + ' · навыки' : park.life.mammals.length ? 'Зверьков: ' + park.life.mammals.length : 'Скоро кто-нибудь придёт…'],
      ['news', '🆕', 'Что нового в парке', 'Яйца, награды, племя, прятки, подарки']];
    return [
      ['invite', '💌', 'Позвать друга и поделиться', 'Награды: 💎 за друга, 🥚 за репост'],
      musicRow(), voicesRow(),
      ['admin', '⚙️', 'Управление парком', 'Название, пароль, время суток, удаление'],
      ['parks', '🗂️', 'Мои парки', 'Создайте новые парки, переключайтесь'],
      ['support', '💬', 'Поддержка', 'Вопрос, идея или ошибка — напишите нам']];
  }
  let curSection = null;
  function doGo(g) {
    if (g === 'feedall') return feedAll();
    if (g === 'secret') return feedSecret();
    if (g === 'sleepall') { UI.close(); sleepAll(); if (!DEMO) Y.sendEvent(park, { type: 'sleepall' }); return; }
    if (g === 'wakeall') { UI.close(); wakeAll(); return; }
    if (g === 'playall') { UI.close(); if (playAll() && !DEMO) Y.sendEvent(park, { type: 'playall' }); return; }
    if (g === 'hide') { UI.close(); const c = scene.ents.filter(e => e.habitat === 'ground' && e.state === 'wander' && !e.enter); if (!c.length || !startHide(U.pick(c).uid)) showHint('🙈 Сейчас некому прятаться — попробуй позже', 3000); return; }
    if (g === 'coloring') return window.open('coloring.html', '_blank');
    if (g === 'music') { if (DP.music) DP.music.toggle(); return; }
    if (g === 'voices') { V.set(!V.isOn()); if (V.isOn()) V.play('trex', 'tap', 'menu'); return screens.section(curSection || 'more'); }
    go(g);
  }
  if (DP.music) { DP.music.button('bl'); DP.music.onChange(() => { if (current === 'menu' && UI.isOpen()) screens.menu(true); if (current === 'section' && UI.isOpen()) screens.section(curSection); }); }

  function bar(k, v, asleep) {
    const low = k === 'sleep' ? !asleep && v < N.LOW : v < N.LOW;
    return `<div class="need ${low ? 'low' : ''}" data-need="${k}"><span class="ico">${N.ICON[k]}</span><span class="nm">${N.NAME[k]}</span>
      <span class="track"><i style="width:${Math.round(v)}%"></i></span><span class="val">${Math.round(v)}</span></div>`;
  }
  function needsHtml(d) {
    const s = N.at(d);
    return bar('food', s.food) + bar('play', s.play) + bar('sleep', s.sleep, s.asleep) +
      `<div class="need-state">${s.asleep ? '😴 Спит — проснётся сам, когда выспится' : s.low.length ? '⚠️ Хочет: ' + s.low.map(k => ({ food: 'есть', play: 'играть', sleep: 'спать' })[k]).join(', ') : '😊 Всё хорошо'}</div>`;
  }
  function refreshCard() {
    const p = document.querySelector('#card-needs'), d = dino(cardUid);
    if (!p || !d) return;
    p.innerHTML = needsHtml(d);
    const s = N.at(d), sl = document.querySelector('#cd-sleep');
    if (sl) { sl.dataset.act = s.asleep ? 'wake' : 'sleep'; sl.innerHTML = s.asleep ? '☀️ Разбудить' : '💤 Уложить спать'; }
  }

  let menuRefresh = false;
  const screens = {
    menu(refresh) {
      curSection = null; menuRefresh = !!refresh;
      const st = DEMO ? '🎬 Демо-режим' : Y.mode === 'server' ? '<span class="status-dot on"></span>Синхронизация через сервер' : '<span class="status-dot"></span>Парк хранится на этом устройстве';
      const anyAwake = park.dinos.some(d => !N.at(d).asleep) || !park.dinos.length;
      const qa = [['feedall', '🍖', 'Покормить всех'], ['secret', '🤫', 'Тайно покормить своих'], anyAwake ? ['sleepall', '💤', 'Уложить всех спать'] : ['wakeall', '☀️', 'Разбудить всех'], ['playall', '🎾', 'Поиграть со всеми']];
      UI.show(`<div class="panel-head">
          <div style="flex:1;min-width:0"><h2>${U.esc(park.name)} <button class="icon-btn" id="m-rename" title="Переименовать" style="width:34px;height:34px;font-size:15px;vertical-align:middle">✏️</button></h2>
          <div class="sub">${U.dinoCount(park.dinos.length)} · здесь ${here().length} · ${U.esc(locName(park.view))}</div></div>
          <button class="icon-btn" id="m-fs" title="Во весь экран">⛶</button><button class="icon-btn" data-close title="Закрыть">✕</button></div>
        <div class="qa-grid" id="m-qa">${qa.map(r => `<button class="qa" data-go="${r[0]}"><span class="e">${r[1]}</span><span class="t">${r[2]}</span></button>`).join('')}</div>
        <div class="tiles" id="m-tiles">${SECTIONS.map(r => `<button class="tile" data-sec="${r[0]}"><span class="e">${r[1]}</span><span class="t">${r[2]}</span><span class="s">${U.esc(secLine(r[0]))}</span></button>`).join('')}</div>
        <div class="menu-foot"><span>${st}</span><a href="index.html" style="color:var(--muted)">🏠 На главную</a></div>`, (p) => {
        UI.wire(p);
        p.querySelector('#m-rename').onclick = () => go('rename');
        p.querySelector('#m-fs').onclick = () => U.toggleFullscreen();
        p.querySelectorAll('[data-go]').forEach(b => b.onclick = () => doGo(b.dataset.go));
        p.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => (b.dataset.sec === 'tv' ? go('tv') : screens.section(b.dataset.sec)));
      }, { refresh: menuRefresh, key: 'menu' });
    },
    /** Раздел меню: список пунктов */
    section(id) {
      curSection = id; const sec = SECTIONS.find(x => x[0] === id) || SECTIONS[5];
      UI.show(`${UI.head(sec[1] + ' ' + sec[2], { back: true })}
        <div class="rows">${sectionRows(id).map(r => `<button class="row" data-go="${r[0]}"><span class="emo">${r[1]}</span><span class="txt"><div class="t">${r[2]}</div><div class="s">${r[3]}</div></span><span class="chev">›</span></button>`).join('')}</div>`, (p) => {
        UI.wire(p, { back: () => go('menu') });
        p.querySelectorAll('[data-go]').forEach(b => b.onclick = () => doGo(b.dataset.go));
      });
    },
    rename() {
      UI.show(`${UI.head('Название парка', { back: true })}
        <input class="field" id="rn" maxlength="40" value="${U.esc(park.name)}" placeholder="Парк" autofocus>
        <div class="btn-row"><button class="btn" data-back>Отмена</button><button class="btn green" id="rn-ok">Сохранить</button></div>`, (p) => {
        UI.wire(p, { back: backTo });
        const ok = () => { park.name = p.querySelector('#rn').value.trim().slice(0, 40) || 'Парк'; commit(); go('menu'); };
        p.querySelector('#rn-ok').onclick = ok; p.querySelector('#rn').onkeydown = (e) => { if (e.key === 'Enter') ok(); };
      });
    },
    /** Карточка динозавра: потребности и действия */
    card(uid) {
      const d = dino(uid); if (!d) return UI.close();
      cardUid = uid;
      const sp = spOf(d), own = d.owner === ME;
      const others = LOCS.filter(l => l.id !== d.loc);
      UI.show(`<div class="panel-head"><img class="card-ava" src="${dinoImg(d)}" alt="">
          <div style="flex:1;min-width:0"><h2>${own ? '⭐ ' : ''}${U.esc(dinoName(d))}</h2>
          <div class="sub">${sp ? sp.emoji + ' ' + sp.name + ' · ' + (sp.diet === 'herb' ? '🌿 травоядный' : '🍖 хищник') : '🖍️ свой рисунок'} · ${U.esc(locName(d.loc))}</div></div>
          <button class="icon-btn" data-close title="Закрыть">✕</button></div>
        <div id="card-needs" class="needs">${needsHtml(d)}</div>
        <div class="act-grid">
          <button class="btn green" id="cd-feed">🍖 Покормить</button>
          <button class="btn" id="cd-play">🎾 Поиграть</button>
          <button class="btn" id="cd-sleep" data-act="sleep">💤 Уложить спать</button>
          <button class="btn" id="cd-voice">🗣️ Голос</button>
          <button class="btn" id="cd-zoom">🔍 Крупный план</button>
          <button class="btn" id="cd-hide">🙈 Прятки</button>
        </div>
        ${cardLife(d)}
        <label class="lbl">🧭 Отправить в…</label>
        <div class="loc-chips">${others.map(l => `<button class="chip" data-travel="${l.id}">${U.esc(l.name)}</button>`).join('')}</div>
        <div class="btn-row" style="margin-top:10px">${own ? '<span class="note">⭐ Это твой динозавр — его можно тайно кормить</span>' : '<button class="btn" id="cd-own">⭐ Это мой динозавр</button>'}</div>`, (p) => {
        UI.wire(p);
        p.querySelector('#cd-feed').onclick = () => {
          const items = scene.makeSecretFeed([uid]).map(it => Object.assign(it, { secret: false, by: ME }));
          if (!items.length) { N.feed(d, 30); commit(); refreshCard(); return; }
          fire({ type: 'feed', items }); UI.close(); showHint('🍖 ' + dinoName(d) + ' бежит к еде!', 2500);
        };
        p.querySelector('#cd-play').onclick = () => { const before = N.at(d); N.play(d); careFor(d, 'play', before); commit(); fire({ type: 'play', uid, u: Math.random() }); UI.close(); showHint('🎾 Играем с ' + dinoName(d) + '!', 2500); };
        p.querySelector('#cd-sleep').onclick = (ev) => {
          if (ev.currentTarget.dataset.act === 'wake') { N.wake(d); commit(); const e = scene.ent(uid); if (e) V.play(e.species || e.base, 'wake', uid); }
          else { const before = N.at(d); N.sleep(d); careFor(d, 'sleep', before); commit(); }
          refreshCard();
        };
        p.querySelector('#cd-voice').onclick = () => fire({ type: 'jump', uid, text: '🗣️' });
        p.querySelector('#cd-zoom').onclick = () => closeUp(uid);
        p.querySelector('#cd-hide').onclick = () => { if (d.loc !== park.view) { U.toast('Динозавр в другой локации'); return; } UI.close(); if (!startHide(uid)) showHint('🙈 Здесь негде спрятаться — попробуй в другой раз', 3000); };
        wireHats(p, d);
        p.querySelectorAll('[data-travel]').forEach(b => b.onclick = () => {
          d.loc = b.dataset.travel; commit(); UI.close();
          showHint(`🧭 ${dinoName(d)} отправился в «${locName(d.loc)}»`, 3500);
          if (!DEMO) Y.sendEvent(park, { type: 'travel', uid, to: d.loc, name: dinoName(d) });
        });
        const ow = p.querySelector('#cd-own'); if (ow) ow.onclick = () => { d.owner = ME; commit(); go('card', uid); };
        clearInterval(cardTimer); cardTimer = setInterval(refreshCard, 700);
      });
    },
    /** Локации: переключение и путешествие */
    locs() {
      UI.show(`${UI.head('Локации и путешествия', { back: true, sub: 'Перейди в другую локацию или отправься туда со всеми динозаврами' })}
        <div class="grid3">${LOCS.map(l => { const n = park.dinos.filter(d => d.loc === l.id).length; const img = park.customBg && park.customLoc === l.id ? park.customBg : DP.BG.thumb(l.id);
          return `<button class="thumb ${park.view === l.id ? 'active' : ''}" data-loc="${l.id}"><img src="${img}" alt=""><div class="cap">${U.esc(l.name)} · ${n ? '🦕 ' + n : 'пусто'}</div></button>`; }).join('')}</div>
        <label class="lbl" style="display:flex;gap:10px;align-items:center;margin-top:12px"><input type="checkbox" id="lc-all"> 🧭 Путешествие: взять с собой всех динозавров отсюда</label>`, (p) => {
        UI.wire(p, { back: backTo });
        p.querySelectorAll('[data-loc]').forEach(b => b.onclick = () => travelTo(b.dataset.loc, p.querySelector('#lc-all').checked));
      }, { wide: true });
    },
    ready() {
      UI.show(`${UI.head('Кого запустить?', { back: true, sub: 'Нажми на динозавра — он сразу прибежит в «' + locName(park.view) + '»' })}
        <input class="field" id="rd-name" maxlength="20" placeholder="Имя динозавра (необязательно)">
        <div class="hscroll" style="margin-top:12px">${DP.Dinos.SPECIES.map(s => `<button class="card" data-sp="${s.id}">
            <img src="${DP.Dinos.thumb(s.id, 0)}" alt="${s.name}" decoding="async"><div class="nm">${s.name}</div>
            <div class="meta">${s.diet === 'herb' ? '🌿 травоядный' : '🍖 хищник'} · ${s.habitat === 'sky' ? 'летает' : s.habitat === 'water' ? 'плавает' : 'гуляет'}</div></button>`).join('')}</div>`, (p) => {
        UI.wire(p, { back: backTo });
        p.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => {
          const sp = DP.Dinos.byId[b.dataset.sp];
          const d = newDino({ species: sp.id, palette: Math.floor(Math.random() * sp.palettes.length), sprite: null, name: p.querySelector('#rd-name').value.trim(), diet: sp.diet, habitat: sp.habitat });
          if (!d) return;
          UI.close(); showHint(`${sp.emoji} ${d.name || sp.name} уже бежит в парк!`, 3000);
        });
      }, { wide: true });
    },
    bg() {
      UI.show(`${UI.head('Свой фон', { back: true, sub: 'Своя картинка заменит фон одной локации. Встроенные локации — в «Локации и путешествия»' })}
        ${park.customBg ? `<div class="preview-box"><img src="${park.customBg}" alt="" style="max-width:100%;border-radius:14px"></div>
          <p class="note">Сейчас показывается в «${U.esc(locName(park.customLoc))}»</p>
          <div class="btn-row"><button class="btn" id="bg-here">📍 Показывать здесь (${U.esc(locName(park.view))})</button><button class="btn" id="bg-add">🔄 Заменить</button><button class="btn danger" id="bg-del">🗑️ Убрать свой фон</button></div>`
          : `<div class="empty"><div class="big">🖼️</div>Загрузи фото или рисунок — динозавры будут гулять на нём в «${U.esc(locName(park.view))}»</div>
          <div class="btn-row"><button class="btn green" id="bg-add">＋ Загрузить картинку</button></div>`}`, (p) => {
        UI.wire(p, { back: backTo });
        p.querySelector('#bg-add').onclick = () => $('#bg-file').click();
        const h = p.querySelector('#bg-here'); if (h) h.onclick = () => { park.customLoc = park.view; commit(); go('bg'); };
        const del = p.querySelector('#bg-del'); if (del) del.onclick = () => { park.customBg = null; park.customLoc = null; commit(); go('bg'); };
      }, { wide: true });
    },
    cleanup() {
      UI.show(`${UI.head('Убрать динозавров', { back: true, sub: park.dinos.length ? 'Нажми ✕, чтобы убрать динозавра из парка' : '' })}
        ${park.dinos.length ? `<div class="dino-grid">${park.dinos.map(d => `<div class="dino-tile"><img src="${dinoImg(d)}" alt=""><div class="nm">${U.esc(d.name || (d.sprite ? '🖍️ ' + (spOf(d) ? spOf(d).name : 'Рисунок') : spOf(d).name))}</div><div class="s">${U.esc(locName(d.loc))}</div><button class="del" data-del="${d.uid}" title="Убрать">✕</button></div>`).join('')}</div><div class="btn-row"><button class="btn danger" id="cl-all">🧹 Убрать всех</button></div>`
        : '<div class="empty"><div class="big">🌴</div>В парке пока никого нет</div>'}`, (p) => {
        UI.wire(p, { back: backTo });
        p.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { park.dinos = park.dinos.filter(d => d.uid !== b.dataset.del); commit(); go('cleanup'); });
        const all = p.querySelector('#cl-all');
        if (all) all.onclick = () => { if (confirm('Убрать всех динозавров из парка?')) { park.dinos = []; commit(); go('cleanup'); } };
      }, { wide: true });
    },
    async tv() {
      const tvqMine = () => { try { return localStorage.getItem('dp.tvq.phone') || 'auto'; } catch (e) { return 'auto'; } };
      if (DEMO) { UI.show(`${UI.head('Открыть на другом экране', { back: true })}<div class="empty"><div class="big">🎬</div>В демо-режиме парк не сохраняется. Создай свой парк — и его можно будет открыть на телевизоре.</div><div class="btn-row"><a class="btn green" href="parks.html">Создать парк</a></div>`, (p) => UI.wire(p, { back: backTo })); return; }
      UI.show(`${UI.head('Открыть на другом экране', { back: true })}<div class="spinner"></div>`, (p) => UI.wire(p, { back: backTo }), { wide: true });
      const info = await Y.tvCode(park);
      if (current !== 'tv') return;
      const url = baseUrl() + 'tv.html?code=' + info.code;
      const ti = Y.tvInfo ? Y.tvInfo() : { paired: 0, online: 0, relays: [] };
      const warn = location.protocol === 'file:' ? '<div class="note" style="margin-top:12px">⚠️ Страница открыта как файл — QR-код сработает, только если сайт запущен через сервер (см. README).</div>'
        : info.server ? '<div class="note" style="margin-top:12px">🟢 Телевизор и этот телефон будут синхронизированы через сервер — всё, что вы делаете здесь, сразу появится на экране.</div>'
        : info.relay ? `<div class="note tv-relay" id="tv-relay" style="margin-top:12px">🔐 Связь через интернет без регистрации, данные зашифрованы. Не закрывайте парк на телефоне, пока смотрите на ТВ.<br><span id="tv-st">${tvStatus(ti)}</span></div>
            ${ti.paired ? '<div class="btn-row"><button class="btn danger" id="tv-off">📴 Отключить телевизоры (' + ti.paired + ')</button></div>' : ''}`
        : '<div class="note" style="margin-top:12px">💾 Этот браузер не поддерживает защищённую связь — код сработает только в другой вкладке этого же браузера.</div>';
      UI.show(`${UI.head('Открыть на другом экране', { back: true, sub: 'На ТВ или смарт-ТВ, телефоне, ПК или планшете' })}
        <div class="tv-split">
          <div class="tv-box"><h3><span class="num">1</span>Отсканируйте QR-код для телевизора</h3><div class="qr">${qr(url)}</div><div class="url">${U.esc(url)}</div></div>
          <div class="tv-box"><h3><span class="num">2</span>Код для телевизора (пять цифр — не путать с паролем)</h3>
            <div class="muted" style="font-weight:700;font-size:14px">Откройте на ТВ <b>${U.esc(baseUrl())}tv.html</b> и введите:</div>
            <div class="tv-code">${info.code}</div>
            <div class="note">Действует 5 минут. По истечении — генерируется новый.</div>
            <div class="timer" id="tv-timer" style="margin-top:8px"></div>
            <button class="btn" style="margin-top:12px" id="tv-open">🪟 Открыть в новой вкладке</button></div>
        </div>${warn}
        <div class="tv-box tv-q" style="margin-top:12px"><h3>⚙️ Качество картинки на телевизоре</h3>
          <div class="btn-row">${[['auto', '🤖 Авто'], ['smooth', '🏃 Плавно'], ['pretty', '✨ Красиво']].map(([m, t]) => `<button class="btn${tvqMine() === m ? ' green' : ''}" data-tvq="${m}">${t}</button>`).join('')}</div>
          <div class="note">«Авто» подбирает сам. Если телевизор подтормаживает — «Плавно». Можно переключить и пультом: кнопка «⚙️ Качество» на экране ТВ.</div></div>`, (p) => {
        UI.wire(p, { back: backTo });
        p.querySelectorAll('[data-tvq]').forEach(b => b.onclick = () => {
          const m = b.dataset.tvq; try { localStorage.setItem('dp.tvq.phone', m); } catch (e) { /* ignore */ }
          Y.sendEvent(park, { type: 'tvq', mode: m });
          p.querySelectorAll('[data-tvq]').forEach(x => x.classList.toggle('green', x === b));
          U.toast('📺 Качество на ТВ: ' + b.textContent.replace(/^\S+\s/, ''), 2500);
        });
        p.querySelector('#tv-open').onclick = () => window.open(url, '_blank');
        const off = p.querySelector('#tv-off'); if (off) off.onclick = async () => { await Y.tvDisconnect(); U.toast('📴 Телевизоры отключены', 3000); screens.tv(); };
        const tick = () => {
          const left = Math.max(0, info.exp - Date.now());
          const el = p.querySelector('#tv-timer'); if (el) el.textContent = `⏳ Осталось ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
          if (left <= 0 && current === 'tv') { clearInterval(tvTimer); screens.tv(); }
        };
        tick(); clearInterval(tvTimer); tvTimer = setInterval(() => { tick(); const st = p.querySelector('#tv-st'); if (st && Y.tvInfo) { const h = tvStatus(Y.tvInfo()); if (st.innerHTML !== h) st.innerHTML = h; } }, 1000);
      }, { wide: true });
    },
    /** Как добавить динозавра: камера здесь, файл или телефон по QR */
    photo() {
      const phoneUrl = DEMO ? '' : baseUrl() + 'park.html?id=' + encodeURIComponent(park.id) + '&pin=' + encodeURIComponent(park.pin) + '&open=camera';
      const coarse = window.matchMedia && matchMedia('(pointer:coarse)').matches;
      const qrNote = Y.mode === 'server' ? 'Наведи камеру телефона на QR — откроется камера сразу в этом парке. Готовый динозавр появится здесь.'
        : 'Локальный режим: QR откроет парк только в этом же браузере. Для телефона запустите сервер (см. README).';
      UI.show(`${UI.head('📷 Сфотографировать динозавра', { back: true, sub: 'Раскрась лист, сфотографируй — и он оживёт в «' + locName(park.view) + '»' })}
        <div class="tv-split">
          <div class="tv-box"><h3><span class="num">1</span>Этим устройством</h3>
            <div class="btn-row" style="flex-direction:column;align-items:stretch"><button class="btn green" id="ph-cam">📷 Открыть камеру</button><button class="btn" id="ph-file">📁 Загрузить фото</button></div>
            <p class="note">Все 4 чёрных квадрата по углам листа должны попасть в кадр.</p></div>
          ${phoneUrl ? `<div class="tv-box ${coarse ? 'soft' : ''}" id="ph-qr"><h3><span class="num">2</span>Или телефоном</h3><div class="qr">${qr(phoneUrl)}</div><p class="note">${qrNote}</p></div>` : ''}
        </div>`, (p) => {
        UI.wire(p, { back: backTo });
        p.querySelector('#ph-cam').onclick = openCamera;
        p.querySelector('#ph-file').onclick = () => $('#photo-file').click();
      }, { wide: true });
    },
    /** Управление парком */
    admin() {
      const tod = scene.tod || 'auto';
      UI.show(`${UI.head('⚙️ Управление парком', { back: true })}
        <label class="lbl">Название</label>
        <div class="btn-row" style="margin-top:0"><input class="field" id="ad-name" maxlength="40" value="${U.esc(park.name)}" style="flex:1"><button class="btn green" id="ad-ren">Сохранить</button></div>
        ${DEMO ? '' : `<label class="lbl">Код парка и пароль (для входа с другого устройства)</label>
        <div class="cred"><div>Код: <b id="ad-id">${U.esc(park.id)}</b></div><div>Пароль: <b id="ad-pin" data-pin="${U.esc(park.pin)}">••••</b> <button class="chip" id="ad-show">👁️ Показать</button></div></div>
        <label class="lbl">Сменить пароль</label>
        <div class="btn-row" style="margin-top:0"><input class="field" id="ad-old" inputmode="numeric" maxlength="12" placeholder="Текущий" style="flex:1"><input class="field" id="ad-new" inputmode="numeric" maxlength="12" placeholder="Новый (4–12 цифр)" style="flex:1"><button class="btn" id="ad-pinok">Сменить</button></div>
        <div class="note" id="ad-msg"></div>`}
        <label class="lbl">🌗 Время суток</label>
        <div class="loc-chips">${[['auto', '🕰️ Как на часах'], ['day', '☀️ День'], ['evening', '🌇 Вечер'], ['night', '🌙 Ночь']].map(t => `<button class="chip ${tod === t[0] ? 'on' : ''}" data-tod="${t[0]}">${t[1]}</button>`).join('')}</div>
        ${DEMO ? '' : `<div class="btn-row"><button class="btn danger" id="ad-del">🗑️ Удалить парк</button></div><p class="note">Удалённый парк хранится на сервере ещё 30 дней — его можно восстановить через администратора.</p>`}`, (p) => {
        UI.wire(p, { back: backTo });
        p.querySelector('#ad-ren').onclick = () => { park.name = p.querySelector('#ad-name').value.trim().slice(0, 40) || 'Парк'; commit(); U.toast('✓ Сохранено'); };
        p.querySelectorAll('[data-tod]').forEach(b => b.onclick = () => { localStorage.setItem('dp_tod', b.dataset.tod); scene.setTimeOfDay(b.dataset.tod); go('admin'); });
        if (DEMO) return;
        p.querySelector('#ad-show').onclick = () => { const el = p.querySelector('#ad-pin'); el.textContent = el.textContent === '••••' ? el.dataset.pin : '••••'; };
        p.querySelector('#ad-pinok').onclick = async () => {
          const msg = p.querySelector('#ad-msg');
          try { const np = p.querySelector('#ad-new').value.trim(); await Y.setPin(park, p.querySelector('#ad-old').value.trim(), np); if (park.pin !== np) { park.pin = np; S.save(park, true); } /* пока ждали ответ, парк мог обновиться с сервера */ msg.textContent = '✓ Пароль изменён. Запиши новый!'; p.querySelector('#ad-pin').dataset.pin = park.pin; }
          catch (e) { msg.textContent = '⚠️ ' + e.message; }
        };
        p.querySelector('#ad-del').onclick = async () => {
          if (!confirm(`Удалить парк «${park.name}»?`)) return;
          try { await Y.deletePark(park); } catch (e) { U.toast('⚠️ ' + e.message, 4000); return; }
          S.remove(park.id); const next = S.myIds()[0]; location.href = next ? 'park.html?id=' + next : 'parks.html';
        };
      }, { wide: true });
    },
    parks() {
      const list = S.myParks();
      UI.show(`${UI.head('Мои парки', { back: true })}
        <div class="rows">${UI.parkRows(list, park.id, true)}</div>
        <div class="btn-row"><button class="btn green" id="pk-new">＋ Новый парк</button></div>`, (p) => {
        UI.wire(p, { back: backTo });
        p.querySelectorAll('[data-open]').forEach(r => r.onclick = (e) => {
          if (e.target.closest('[data-del]')) return;
          const id = r.dataset.open; if (id === park.id && !DEMO) return UI.close();
          location.href = 'park.html?id=' + id;
        });
        p.querySelectorAll('[data-del]').forEach(b => b.onclick = async (e) => {
          e.stopPropagation();
          const target = S.get(b.dataset.del); if (!target) return;
          if (!confirm(`Удалить парк «${target.name}»?`)) return;
          try { await Y.deletePark(target); } catch (er) { U.toast('⚠️ ' + er.message, 4000); return; }
          S.remove(target.id);
          if (target.id === park.id) { const next = S.myIds()[0]; location.href = next ? 'park.html?id=' + next : 'parks.html'; return; }
          go('parks');
        });
        p.querySelector('#pk-new').onclick = () => { current = 'newpark'; UI.newParkFlow((np) => { location.href = 'park.html?id=' + np.id; }, () => go('parks')); };
      });
    },
    /** Первое знакомство */
    onboarding() {
      UI.show(`${UI.head('Добро пожаловать в Динопарк! 🦖')}
        <div class="steps">
          <div class="step"><span class="num">1</span><b>Распечатай</b> раскраску (меню → 🖨️)</div>
          <div class="step"><span class="num">2</span><b>Раскрась</b> динозавра как хочешь</div>
          <div class="step"><span class="num">3</span><b>Сфотографируй</b> — и он оживёт здесь</div>
          <div class="step"><span class="num">4</span><b>Заботься:</b> корми 🍖, играй 🎾 и укладывай спать 💤</div>
          <div class="step"><span class="num">5</span><b>За заботу</b> динозавры несут яйца 🥚 и дарят подарки 🎁, а в парк приходят соседи 🐒 — всё в «🆕 Что нового»</div>
        </div>
        <div class="btn-row"><button class="btn green" id="ob-ready">🦖 Запустить первого динозавра</button><button class="btn" id="ob-photo">📷 Сфотографировать раскраску</button><button class="btn" data-close>Осмотреться</button></div>`, (p) => {
        UI.wire(p); localStorage.setItem('dp_onboarded', '1');
        p.querySelector('#ob-ready').onclick = () => go('ready');
        p.querySelector('#ob-photo').onclick = () => go('photo');
      }, { wide: true });
    }
  };
  Object.assign(screens, v3Screens());
  Object.keys(screens).forEach((k) => { const f = screens[k]; screens[k] = (a) => { current = k; clearInterval(tvTimer); if (k !== 'card') clearInterval(cardTimer); return f(a); }; });

  // ======================= v3: жизнь парка =======================
  const RR = Life.R;
  function eggsLine() { return Life.RARITY.map(r => r.emoji + (park.life.eggs[r.id] || 0)).join(' '); }
  function realDur(gameSec) { const s = Math.max(0, gameSec) / N.speed; return s < 90 ? Math.max(1, Math.round(s)) + ' сек' : s < 5400 ? Math.round(s / 60) + ' мин' : s < 129600 ? Math.round(s / 3600) + ' ч' : Math.round(s / 86400) + ' дн'; }
  const toastQ = []; let toastBusy = false;
  function say(msg, ms) { toastQ.push([msg, ms || 3800]); if (!toastBusy) nextToast(); }
  function nextToast() { const m = toastQ.shift(); if (!m) { toastBusy = false; return; } toastBusy = true; U.toast(m[0], m[1]); setTimeout(nextToast, Math.min(m[1], 3200)); }
  function careFor(d, kind, before) { lifeEvents(Life.care(park, d, kind, before, d.owner === ME)); }
  function lifeEvents(ev) {
    if (!ev || !ev.length) return false;
    let important = false;
    ev.forEach(x => {
      if (x.type !== 'autoCollect') important = true;
      if (x.type === 'egg') { const r = RR[x.egg.r]; showHint(`${r.emoji} ${dinoName(x.d)} снёс${x.egg.r !== 'common' ? ' ' + r.name.toLowerCase() : ''} яйцо! Нажми на него`, 6000); if (x.egg.r !== 'common') say(`${r.emoji} Ого! ${r.name} яйцо!`); }
      else if (x.type === 'giftDrop') showHint(`🎁 ${dinoName(x.d)} оставил тебе подарок! Найди коробку`, 6000);
      else if (x.type === 'mammal') say(`${x.def.emoji} В парке поселился новый сосед: ${x.def.name}!`, 4500);
      else if (x.type === 'ape') say(`🐒 В парк пришёл австралопитек ${x.a.name}! Он будет учиться новому`, 5000);
      else if (x.type === 'skill' && x.s.id !== 'walk') say(`${x.s.e} ${x.a.name} научился: ${x.s.name}!`, 4500);
      else if (x.type === 'tribeFeed' || x.type === 'tribePlay') { scene.setLife(park.life, park); const e = scene.ent(x.d.uid); if (e && e.habitat === 'ground') scene.tribeTask(x.type === 'tribeFeed' ? 'feed' : 'play', x.d.uid, x.what === '🫐' ? 'leaf' : null); }
      else if (x.type === 'tribeEgg') say(`🧺 ${x.a.name} нашёл в кустах яйцо!`);
      else if (x.type === 'ach') say(`🏆 Достижение: ${x.a.e} ${x.a.name}${x.a.reward ? ' · награда ' + Life.costText(x.a.reward) : ''}`, 4500);
    });
    scene.setLife(park.life, park); updateHud();
    return important;
  }
  let lastPush = Date.now();
  function lifeTick() {
    const ev = Life.tick(park, Date.now());
    const imp = lifeEvents(ev);
    maybeHide();
    if (imp || Date.now() - lastPush > 60000) { lastPush = Date.now(); commit(); }
    return ev;
  }
  function lifeInbox() { const got = Life.applyInbox(park); got.forEach(it => say(`🎁 Подарок от Динопарка: ${Life.giftEmoji(it.g)} ${Life.giftName(it.g)}${it.m ? ' — ' + it.m : ''}`, 5000)); if (got.length) { updateHud(); commitSoon(); } celebrateLegend(legendFromGifts()); }
  function pickup(item) {
    const pos = scene.nestPos && scene.nestPos[item.id];
    const it = Life.collect(park, item.id); if (!it) return null;
    if (pos) { scene.sparkle(pos.x, pos.y - 10); scene.hearts(pos.x, pos.y - 24); }
    if (it.k === 'egg') { const r = RR[it.r]; showHint(`${r.emoji} +1 ${r.name.toLowerCase()} яйцо! В корзине: ${eggsLine()}`, 4000); }
    else { const g = Life.GIFT[it.g] || Life.GIFTS[0], d = dino(it.uid); giftReveal(g, d); }
    lifeEvents(Life.checkAch(park)); scene.setLife(park.life, park); updateHud(); commit();
    return it;
  }
  function giftReveal(g, d) {
    UI.show(`${UI.head('🎁 Подарок!')}<div class="success"><div class="gift-big">${g.e}</div><h3>${U.esc(g.name)}</h3>
      <p class="note">${d ? U.esc(dinoName(d)) + ' дарит тебе это за заботу. ' : ''}${g.r === 'epic' ? '✨ Очень редкий подарок!' : g.r === 'rare' ? '💎 Редкий подарок!' : ''}</p></div>
      <div class="btn-row"><button class="btn" id="gr-all">🎁 Все подарки</button><button class="btn green" data-close>Спасибо!</button></div>`, (p) => { UI.wire(p); p.querySelector('#gr-all').onclick = () => go('gifts'); });
  }
  function critterSay(c) {
    if (c.kind === 'ape') { const a = c.src, last = Life.SKILLS.filter(s => a.sk.includes(s.id)).pop(); scene.critterSay(c, `Я ${a.name}! ${last ? last.e : '🙂'}`); }
    else { const def = Life.MAMMALS.find(m => m.kind === c.src.kind); scene.critterSay(c, def ? def.emoji + ' ' + def.name : '🙂'); }
  }
  let nextHide = Date.now() + (3 + Math.random() * 4) * 60000 / Math.max(1, Math.min(N.speed, 60));
  function maybeHide() {
    if (Date.now() < nextHide || UI.isOpen() || document.hidden) return;
    nextHide = Date.now() + (4 + Math.random() * 6) * 60000 / Math.max(1, Math.min(N.speed, 60));
    const c = scene.ents.filter(e => e.habitat === 'ground' && e.state === 'wander' && !e.enter && !(e.need && (e.need.asleep || e.need.low.length)));
    if (!c.length || scene.ents.some(e => e.hideAt)) return;
    startHide(U.pick(c).uid);
  }
  function startHide(uid) {
    if (!scene.hide(uid)) return false;
    const d = dino(uid); showHint(`🙈 ${dinoName(d)} прячется! Ищи за кустами и камнями — листай парк пальцем`, 6000); return true;
  }
  function closeUp(uid) {
    if (!scene.closeUp(uid)) { U.toast('Динозавр сейчас в другой локации'); return false; }
    UI.close(); park.life.stats.closeup = (park.life.stats.closeup || 0) + 1; lifeEvents(Life.checkAch(park)); commitSoon(); return true;
  }
  function playAll(list) {
    list = (list || park.dinos).filter(d => !N.at(d).asleep);
    if (!list.length) { showHint('😴 Все спят — пусть отдохнут', 3000); return 0; }
    list.forEach((d, i) => { const before = N.at(d); N.play(d); careFor(d, 'play', before); if (d.loc === park.view) setTimeout(() => fire({ type: 'play', uid: d.uid, u: Math.random() }), i * 350); });
    commit(); showHint(`🎾 Играем со всеми (${list.length})!`, 3000); return list.length;
  }
  function sleepAll(list) {
    list = (list || park.dinos).filter(d => !N.at(d).asleep);
    list.forEach(d => { const before = N.at(d); N.sleep(d); careFor(d, 'sleep', before); });
    commit(); showHint(list.length ? `💤 Спокойной ночи! Уложили ${U.dinoCount(list.length)}` : '😴 Все уже спят', 3000); return list.length;
  }
  function wakeAll() { const list = park.dinos.filter(d => N.at(d).asleep); list.forEach(d => N.wake(d)); commit(); showHint(list.length ? '☀️ Подъём!' : 'Никто не спит', 2500); }
  function feedOne(d) {
    if (d.loc === park.view && scene.ent(d.uid)) { const items = scene.makeSecretFeed([d.uid]).map(it => Object.assign(it, { secret: false, by: ME })); if (items.length) { fire({ type: 'feed', items }); return; } }
    const before = N.at(d); N.feed(d, 30); careFor(d, 'feed', before); commit();
  }
  function cardLife(d) {
    const lg = d.legend ? '<div class="note legend-note">🌟 Легендарный золотой динозавр — чаще несёт редкие яйца</div>' : '';
    return `${lg}<div class="life-line"><span>❤️ Любовь ${Math.min(Life.GIFT_RULE.aff, d.aff || 0)}/${Life.GIFT_RULE.aff}</span><span>🥚 Забота ${Math.min(Life.EGG.care, d.care || 0)}/${Life.EGG.care}</span><span>Яиц: ${d.eggN || 0}</span></div>
      <label class="lbl">🎩 Шапка</label><div class="loc-chips" id="cd-hats"></div>`;
  }
  function wireHats(p, d) {
    const box = p.querySelector('#cd-hats'); if (!box) return;
    const own = Life.HATS.filter(h => d.hat === h.id || Life.hatFree(park, h.id) > 0);
    box.innerHTML = own.length ? own.map(h => `<button class="chip ${d.hat === h.id ? 'on' : ''}" data-hat="${h.id}">${DP.Scene.HATS[h.id]} ${h.name}</button>`).join('') + (d.hat ? '<button class="chip" data-hat="">✕ Снять</button>' : '')
      : '<span class="note">Шапки — за яйца в «🥚 Яйца и награды». Надевает их австралопитек 🐒</span>';
    box.querySelectorAll('[data-hat]').forEach(b => b.onclick = () => wearHat(d, b.dataset.hat || null));
  }
  function wearHat(d, id) {
    d.hat = id; if (id) park.life.stats.hats = (park.life.stats.hats || 0) + 1;
    commit();
    if (id && d.loc === park.view && scene.tribeTask('hat', d.uid, id)) { UI.close(); showHint('🐒 Австралопитек несёт шапку!', 3000); }
    else if (current === 'card') go('card', d.uid);
    lifeEvents(Life.checkAch(park));
  }
  async function redeem(code) {
    code = String(code || '').trim();
    if (!code) throw new Error('Введи код — например, DINO-ABCD-2345');
    if (!/^DP1\./.test(code) && DP.Gifts && DP.Gifts.looksShort(code)) return redeemShort(code);
    const p = await Life.verifyCode(code, park.id);
    let used = [];
    try { used = JSON.parse(localStorage.getItem('dp_redeemed') || '[]'); } catch (e) { used = []; }
    if (park.life.redeemed.indexOf(p.n) >= 0 || used.indexOf(p.n) >= 0) throw new Error('Этот код уже использован');
    if (Y.mode === 'server' && !DEMO) { const r = await Y.call({ t: 'redeem', id: park.id, pin: park.pin, code: String(code).trim() }); if (!r || !r.ok) throw new Error((r && r.error) || 'Сервер не принял код'); }
    Life.grant(park, p.g, p.m, 'Динопарк');
    park.life.redeemed.push(p.n); park.life.redeemed = park.life.redeemed.slice(-200);
    used.push(p.n); localStorage.setItem('dp_redeemed', JSON.stringify(used.slice(-200)));
    lifeEvents(Life.checkAch(park)); updateHud(); commit();
    p.made = legendFromGifts();
    return p;
  }
  // короткий код DINO-XXXX-XXXX: ищем его хеш в подписанной ленте подарков (js/gifts.js)
  async function redeemShort(code) {
    if (DEMO) throw new Error('В демо-парке коды не работают — открой свой парк');
    const p = await DP.Gifts.findCode(code);
    let used = [];
    try { used = JSON.parse(localStorage.getItem('dp_redeemed') || '[]'); } catch (e) { used = []; }
    if (park.life.redeemed.indexOf(p.id) >= 0) throw new Error('Этот код уже использован в этом парке');
    if (p.u === 'once' && used.indexOf(p.id) >= 0) throw new Error('Этот код уже использован на этом устройстве');
    Life.grant(park, p.g, p.m, 'Динопарк');
    park.life.redeemed.push(p.id); park.life.redeemed = park.life.redeemed.slice(-200);
    if (p.u === 'once') { used.push(p.id); localStorage.setItem('dp_redeemed', JSON.stringify(used.slice(-200))); }
    lifeEvents(Life.checkAch(park)); updateHud(); commit();
    p.made = legendFromGifts();
    return p;
  }
  // Легендарный динозавр из подарка администратора. Раньше подарок давал только «жетон» (L.tokens.legend), а самого
  // динозавра надо было вручную выбрать в «Яйца» → «🌟 Золотой динозавр» — поэтому подарок «пришёл», а в парке никого.
  // Теперь динозавр появляется сразу. Записи в журнале подарков помечаются uid динозавра (g.d) — это же чинит старые
  // парки: при открытии на каждый неотмеченный подарок, пока есть жетон, создаётся ровно один динозавр.
  function legendFromGifts() {
    if (DEMO || !park || !park.life) return [];
    const L = park.life; if (!(L.tokens && L.tokens.legend > 0)) return [];
    const pend = (L.gifts || []).filter(g => g && g.adm && g.g === 'legend' && !g.d).reverse(); // старые первыми
    const made = [];
    for (const gl of pend) {
      if (!(L.tokens.legend > 0)) break;
      if (park.dinos.length >= 80) { showHint('🌟 Золотой динозавр ждёт в «Яйца»: в парке уже 80 динозавров', 5000); break; }
      const pool = DP.Dinos.SPECIES.filter(sp => sp.habitat !== 'water'), sp = pool[Math.floor(Math.random() * pool.length)] || DP.Dinos.SPECIES[0];
      L.tokens.legend--;
      const d = Object.assign({ uid: U.uid(), added: Date.now(), loc: park.view, owner: ME, needs: N.fresh(Date.now()) },
        { species: sp.id, palette: DP.Dinos.LEGEND, legend: true, sprite: null, name: 'Золотой ' + sp.name.toLowerCase(), diet: sp.diet, habitat: sp.habitat });
      park.dinos.push(d); gl.d = d.uid; made.push(d);
    }
    if (made.length) { lifeEvents(Life.checkAch(park)); updateHud(); commit(); }
    return made;
  }
  /** Показать нового легендарного: поставить рядом с камерой, подлететь, праздник */
  function celebrateLegend(list, now) {
    if (!list || !list.length) return;
    const show = () => {
      if (UI.isOpen() && !now) return setTimeout(show, 800);
      now = false;
      const d = list[list.length - 1], e = scene.ent(d.uid);
      list.forEach((x, i) => {
        const en = scene.ent(x.uid); if (!en) return;
        const v = scene.view(), z = scene.zone(en.habitat || 'ground'), cx = (v.x0 + v.x1) / 2 + (i - (list.length - 1) / 2) * 60;
        en.x = en.tx = U.clamp(cx, z.x0 + 20, z.x1 - 20); en.y = en.ty = U.clamp((z.y0 + z.y1) / 2, z.y0, z.y1); en.enter = 0; en.state = 'wander';
      });
      if (e) { scene.closeUp(d.uid, 2.2); setTimeout(() => { scene.hearts(e.x, e.y - 40); scene.jump(d.uid, '🌟'); }, 600); }
      showHint(list.length > 1 ? `🌟 В парке ${list.length} новых золотых динозавра!` : `🌟 ${d.name} появился в парке! Нажми «Отдалить», чтобы увидеть всех`, 5000);
      if (!DEMO) setTimeout(() => fire({ type: 'jump', uid: d.uid, text: '🌟' }), 1200);
    };
    setTimeout(show, 300);
  }
  // подарки «всем» и «сюрприз этому парку» — приходят сами при открытии парка
  let giftBusy = false;
  async function feedGifts() {
    if (DEMO || !DP.Gifts || giftBusy) return [];
    giftBusy = true;
    let r; try { r = await DP.Gifts.load({ mqttMs: 6000 }); } catch (e) { r = null; } finally { giftBusy = false; }
    if (!r) return [];
    const list = DP.Gifts.pending(park, r.list);
    if (!list.length) return [];
    list.forEach(p => { Life.grant(park, p.g, p.m, 'Динопарк'); park.life.redeemed.push(p.id); });
    park.life.redeemed = park.life.redeemed.slice(-200);
    lifeEvents(Life.checkAch(park)); updateHud(); commit();
    const made = legendFromGifts();
    const show = () => {
      if (UI.isOpen()) return setTimeout(show, 1500);
      UI.show(`${UI.head('🎁 Тебе подарок!', { sub: list.length > 1 ? 'Подарков: ' + list.length : 'От Динопарка' })}
        <div class="gift-list">${list.map(p => `<div class="gift" data-gid="${U.esc(p.id)}"><span class="e">${Life.giftEmoji(p.g)}</span><div><b>${U.esc(Life.giftName(p.g))}</b>${p.m ? `<div class="s">${U.esc(p.m)}</div>` : ''}</div></div>`).join('')}</div>
        <div class="btn-row"><button class="btn green" id="gf-ok">Ура, спасибо!</button></div>`, (pp) => { pp.querySelector('#gf-ok').onclick = () => { UI.close(); celebrateLegend(made); }; });
    };
    setTimeout(show, 600);
    return list;
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* старый способ */ }
    try { const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select(); const ok = document.execCommand('copy'); a.remove(); return ok; } catch (e) { return false; }
  }
  async function doShare(kind) {
    const url = await Life.inviteUrl();
    let done = false, how = 'share';
    if (navigator.share) { try { await navigator.share({ title: 'Динопарк', text: 'Раскрась динозавра — и он оживёт! Заходи в мой Динопарк 🦖', url }); done = true; } catch (e) { if (e && e.name === 'AbortError') return { done: false }; } }
    if (!done) { done = await copyText(url); how = 'copy'; }
    if (done) { U.toast(how === 'copy' ? '🔗 Ссылка скопирована — отправь её другу' : '📣 Спасибо, что поделился!', 3000); if (Life.shareReward(park)) { say('🥚 +1 обычное яйцо за то, что поделился! (раз в день)', 4000); lifeEvents(Life.checkAch(park)); commit(); } }
    return { done, url, how, kind };
  }
  async function claimInvites() {
    let n = 0; // награда пригласившему — только через сервер: на одном устройстве её легко накрутить
    if (Y.mode === 'server' && !DEMO) { try { const r = await Y.call({ t: 'refclaim', key: Life.refKey() }); const k = Math.max(0, Math.min(10, (r && r.n) | 0)); if (k) { park.life.eggs.rare += k; park.life.stats.invites = (park.life.stats.invites || 0) + k; n += k; } } catch (e) { /* нет сервера */ } }
    if (n) { say(`💌 По твоей ссылке пришли друзья: ${n}! Награда: ${n} 💎`, 5000); lifeEvents(Life.checkAch(park)); commit(); }
    return n;
  }
  // --- верхняя панель: мои динозавры, яйца, подарки, достижения, меню ---
  let hud = null, zbar = null;
  function buildHud() {
    hud = document.createElement('div'); hud.className = 'hud'; hud.id = 'hud';
    hud.innerHTML = `<button id="hud-dinos" title="Мои динозавры">🦕<i class="dot hidden"></i></button><button id="hud-eggs" title="Яйца и награды">🥚<b id="hud-eggn">0</b></button><button id="hud-gifts" title="Подарки">🎁<i class="dot hidden"></i></button><button id="hud-ach" title="Достижения">🏆</button><button id="hud-menu" title="Меню">☰</button>`;
    document.body.appendChild(hud);
    const on = (id, f) => hud.querySelector(id).addEventListener('click', (e) => { e.stopPropagation(); curSection = null; f(); });
    on('#hud-dinos', () => go('dinos')); on('#hud-eggs', () => go('eggs')); on('#hud-gifts', () => go('gifts')); on('#hud-ach', () => go('ach')); on('#hud-menu', () => screens.menu());
    zbar = document.createElement('div'); zbar.className = 'zoombar glass hidden'; zbar.id = 'zoombar';
    zbar.innerHTML = '<span id="zb-name"></span><button class="chip" id="zb-out">🔍 Отдалить</button>';
    document.body.appendChild(zbar);
    zbar.querySelector('#zb-out').onclick = (e) => { e.stopPropagation(); scene.resetZoom(); };
    // кнопки зума: + / − справа по центру (одним пальцем парк только двигается, зум — щипком, колёсиком или этими кнопками)
    const zc = document.createElement('div'); zc.className = 'zoomctl'; zc.id = 'zoomctl';
    zc.innerHTML = '<button type="button" id="zc-in" title="Приблизить" aria-label="Приблизить">+</button><button type="button" id="zc-out" title="Отдалить" aria-label="Отдалить">−</button>';
    document.body.appendChild(zc);
    const zoomStep = (f) => {
      if (scene.follow) { const z = Math.min(scene.zMax(), Math.max(1, scene.follow.z * f)); if (z <= 1.02) scene.resetZoom(); else scene.follow.z = z; return; }
      scene.zoomBy(f);
    };
    zc.querySelector('#zc-in').addEventListener('click', (e) => { e.stopPropagation(); zoomStep(1.35); });
    zc.querySelector('#zc-out').addEventListener('click', (e) => { e.stopPropagation(); zoomStep(1 / 1.35); });
    zc.addEventListener('wheel', (e) => { e.preventDefault(); zoomStep(Math.exp(-e.deltaY * 0.0018)); }, { passive: false });
    setInterval(() => {
      const f = scene.follow, e = f && scene.ent(f.uid), zoomed = scene.cam.z > 1.05;
      zbar.classList.toggle('hidden', !(e || zoomed));
      const n = zbar.querySelector('#zb-name'), t = e ? '🔍 ' + (e.name || 'Крупный план') : '🔎 ×' + scene.cam.z.toFixed(1);
      if (n.textContent !== t) n.textContent = t;
      const low = park.dinos.some(d => d.owner === ME && N.at(d).low.length);
      hud.querySelector('#hud-dinos .dot').classList.toggle('hidden', !low);
    }, 400);
    updateHud();
  }
  function updateHud() {
    if (!hud) return;
    hud.querySelector('#hud-eggn').textContent = Life.total(park.life);
    const seen = +(localStorage.getItem('dp_gseen_' + park.id) || 0);
    hud.querySelector('#hud-gifts .dot').classList.toggle('hidden', !(park.life.gifts.length > seen || park.life.nest.some(n => n.k === 'gift')));
  }
  function v3Start() {
    buildHud();
    lifeInbox();
    setTimeout(() => { feedGifts(); }, 1500);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) feedGifts(); });
    lifeEvents(Life.tick(park, Date.now(), { lay: false }));
    setInterval(lifeTick, 5000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { Life.tick(park, Date.now(), { lay: false }); commit(); } });
    if (!DEMO) {
      claimInvites();
      const L = park.life;
      if (Y.mode === 'server') { // неотправленные сообщения в поддержку
        try { const list = JSON.parse(localStorage.getItem('dp_feedback') || '[]'); list.filter(x => !x.sent).slice(0, 3).forEach(x => Y.call({ t: 'feedback', text: x.text, contact: x.contact, park: x.park }).then(r => { if (r && r.ok) { x.sent = true; localStorage.setItem('dp_feedback', JSON.stringify(list)); } }).catch(() => {})); } catch (e) { /* ignore */ }
      }
      if (L.refBy && !L.refSent && Y.mode === 'server') { // парк мог ещё не доехать до сервера — несколько попыток
        let tries = 0;
        const sendRef = () => Y.call({ t: 'ref', ref: park.life.refBy, id: park.id, pin: park.pin }).then(r => { if (r && r.ok) { park.life.refSent = 1; commitSoon(); } })
          .catch((e) => { window.dpRefErr = e && e.message; if (++tries < 5 && !/новых парков/.test(String(e && e.message))) setTimeout(sendRef, 3000 * tries); });
        setTimeout(sendRef, 1500);
      }
    }
  }
  function v3Screens() {
    return {
      /** «Что нового в парке» */
      news() {
        localStorage.setItem('dp_news_v3', '1');
        UI.show(`${UI.head('🆕 Что нового в парке')}
          <div class="news">
            <div class="nw"><span>🥚</span><div><b>Яйца.</b> Корми, играй и укладывай спать — примерно раз в несколько часов заботы динозавр снесёт яйцо. Нажми на него в парке, чтобы забрать. Бывают обычные 🥚, редкие 💎, очень редкие 🔮 и легендарные 🌟.</div></div>
            <div class="nw"><span>🎩</span><div><b>Награды за яйца.</b> Шапки для динозавров (надевает австралопитек!) и золотой легендарный динозавр за очень редкие яйца. Обычные яйца можно обменять на редкие.</div></div>
            <div class="nw"><span>🐒</span><div><b>Соседи и племя.</b> В парк сами приходят древние зверьки и австралопитеки. Они медленно учатся: огонь 🔥 → кормить динозавров 🍖 → кататься верхом 🏇 и многое другое. Навыки растут днями.</div></div>
            <div class="nw"><span>🦕</span><div><b>Мои динозавры.</b> Желания больше не висят над головами — смотри их в панели 🦕 (вверху справа). Там же «Поиграть со всеми» и «Уложить всех». Если не помочь, динозавр со временем справится сам.</div></div>
            <div class="nw"><span>🙈</span><div><b>Прятки.</b> Иногда динозавр прячется за кустом или камнем. Найди его и нажми — а если не найдёшь, он выйдет сам.</div></div>
            <div class="nw"><span>🎁</span><div><b>Подарки.</b> Самые любимые динозавры иногда приносят подарок. А ещё есть 🏆 достижения, 🔍 крупный план и большой мир — листай его пальцем, приближай двумя.</div></div>
            <div class="nw"><span>💌</span><div><b>Позови друга</b> — получишь 💎, а поделиться парком можно раз в день за 🥚.</div></div>
          </div>
          <div class="btn-row"><button class="btn" id="nw-eggs">🥚 Яйца и награды</button><button class="btn" id="nw-tribe">🐒 Племя</button><button class="btn green" data-close>Понятно!</button></div>`, (p) => {
          UI.wire(p); p.querySelector('#nw-eggs').onclick = () => go('eggs'); p.querySelector('#nw-tribe').onclick = () => go('tribe');
        }, { wide: true });
      },
      /** Панель «Мои динозавры»: желания и действия, для всех и по отдельности */
      dinos() {
        const list = park.dinos.slice().sort((a, b) => (a.loc === park.view ? 0 : 1) - (b.loc === park.view ? 0 : 1) || (a.owner === ME ? 0 : 1) - (b.owner === ME ? 0 : 1));
        const anyAwake = park.dinos.some(d => !N.at(d).asleep);
        const autoTxt = (d, s) => { const k = s.low.find(x => x !== 'sleep'); if (!k) return ''; const a = N.autoIn(d, k); return a != null ? ` · сам ${k === 'food' ? 'найдёт еду' : 'найдёт игру'} через ~${realDur(a)}` : ''; };
        const rowsHtml = () => list.map(d => { const s = N.at(d); return `<div class="dino-row2" data-uid="${d.uid}">
            <button class="ava" data-card="${d.uid}"><img src="${dinoImg(d)}" alt="">${d.hat ? `<span class="hat">${DP.Scene.HATS[d.hat] || ''}</span>` : ''}</button>
            <div class="mid"><div class="t">${d.owner === ME ? '⭐ ' : ''}${d.legend ? '🌟 ' : ''}${U.esc(dinoName(d))}</div>
              <div class="s">${U.esc(locName(d.loc))}${s.asleep ? ' · 😴 спит' : s.low.length ? ' · хочет ' + s.low.map(k => N.ICON[k]).join('') : ' · 😊'}${autoTxt(d, s)}</div>
              <div class="bars">${['food', 'play', 'sleep'].map(k => `<span class="mb ${(k === 'sleep' ? !s.asleep && s[k] < N.LOW : s[k] < N.LOW) ? 'low' : ''}" data-need="${k}"><i style="width:${Math.round(s[k])}%"></i></span>`).join('')}</div></div>
            <div class="acts"><button class="mini-btn" data-a="feed" title="Покормить">🍖</button><button class="mini-btn" data-a="play" title="Поиграть">🎾</button><button class="mini-btn" data-a="${s.asleep ? 'wake' : 'sleep'}" title="${s.asleep ? 'Разбудить' : 'Уложить'}">${s.asleep ? '☀️' : '💤'}</button></div></div>`; }).join('');
        UI.show(`${UI.head('🦕 Мои динозавры', { back: true, sub: 'Желания и забота. Если не помочь — со временем справятся сами' })}
          ${list.length ? `<div class="qa-grid all-acts"><button class="qa" id="dn-feedall"><span class="e">🍖</span><span class="t">Покормить всех</span></button><button class="qa" id="dn-secret"><span class="e">🤫</span><span class="t">Тайно покормить своих</span></button>${anyAwake ? '<button class="qa" id="dn-sleepall"><span class="e">💤</span><span class="t">Уложить всех спать</span></button>' : '<button class="qa" id="dn-wakeall"><span class="e">☀️</span><span class="t">Разбудить всех</span></button>'}<button class="qa" id="dn-playall"><span class="e">🎾</span><span class="t">Поиграть со всеми</span></button></div>
          <div class="dino-list" id="dn-list">${rowsHtml()}</div>`
            : '<div class="empty"><div class="big">🥚</div>В парке пока никого нет.<br>Сфотографируй раскраску или запусти готового динозавра.</div><div class="btn-row"><button class="btn green" id="dn-add">🦖 Запустить динозавра</button></div>'}`, (p) => {
          UI.wire(p, { back: backTo });
          const wire = () => {
            p.querySelectorAll('[data-card]').forEach(b => b.onclick = () => { const d = dino(b.dataset.card); if (!d) return; if (d.loc !== park.view) { park.view = d.loc; park.bg = d.loc; commit(); } go('card', d.uid); });
            p.querySelectorAll('.dino-row2 [data-a]').forEach(b => b.onclick = () => {
              const d = dino(b.closest('[data-uid]').dataset.uid); if (!d) return; const a = b.dataset.a;
              if (a === 'feed') feedOne(d);
              else if (a === 'play') playAll([d]);
              else if (a === 'sleep') sleepAll([d]);
              else { N.wake(d); commit(); }
              refresh();
            });
          };
          const refresh = () => { const el = p.querySelector('#dn-list'); if (!el || current !== 'dinos') return; const h = rowsHtml(); if (el._h === h) return; el._h = h;
            // кнопки не пересоздаём (иначе нажатие, попавшее на перерисовку, теряется): если набор строк и кнопок тот же — обновляем только текст и шкалы
            const tmp = document.createElement('div'); tmp.innerHTML = h;
            const sig = (root) => [].map.call(root.querySelectorAll('.dino-row2'), r => r.dataset.uid + ':' + (r.querySelector('.ava') ? r.querySelector('.ava').innerHTML : '') + ':' + [].map.call(r.querySelectorAll('[data-a]'), b => b.dataset.a).join(',')).join('|');
            if (sig(tmp) === sig(el)) { const nr = tmp.querySelectorAll('.dino-row2'), or = el.querySelectorAll('.dino-row2'); for (let i = 0; i < nr.length; i++) { const a = or[i].querySelector('.mid'), b = nr[i].querySelector('.mid'); if (a && b && a.innerHTML !== b.innerHTML) a.innerHTML = b.innerHTML; } return; }
            el.innerHTML = h; wire(); }; // перерисовываем только при изменениях, чтобы не терять нажатия
          wire();
          const a = p.querySelector('#dn-add'); if (a) a.onclick = () => go('ready');
          const fa = p.querySelector('#dn-feedall'); if (fa) fa.onclick = () => { park.dinos.filter(d => d.loc !== park.view).forEach(d => { const b = N.at(d); N.feed(d, 30); careFor(d, 'feed', b); }); commit(); feedAll(); };
          const pa = p.querySelector('#dn-playall'); if (pa) pa.onclick = () => { if (playAll() && !DEMO) Y.sendEvent(park, { type: 'playall' }); UI.close(); };
          const se = p.querySelector('#dn-secret'); if (se) se.onclick = () => feedSecret();
          const sa = p.querySelector('#dn-sleepall'); if (sa) sa.onclick = () => { sleepAll(); if (!DEMO) Y.sendEvent(park, { type: 'sleepall' }); go('dinos'); };
          const wa = p.querySelector('#dn-wakeall'); if (wa) wa.onclick = () => { wakeAll(); go('dinos'); };
          clearInterval(cardTimer); cardTimer = setInterval(refresh, 1500);
        }, { wide: true });
      },
      /** Яйца, обмен и награды */
      eggs() {
        const L = park.life;
        const can = (c) => Life.canPay(L, c);
        UI.show(`${UI.head('🥚 Яйца и награды', { back: true, sub: 'Динозавры несут яйца за заботу. Яйца — это монетки парка' })}
          <div class="egg-bank">${Life.RARITY.map(r => `<div class="egg-cell" data-r="${r.id}"><div class="e">${r.emoji}</div><b>${L.eggs[r.id] || 0}</b><span>${r.name}</span><small>${(r.p * 100).toLocaleString('ru-RU')}%</small></div>`).join('')}</div>
          <p class="note">Яйцо — примерно раз в 3+ часа, если динозавра кормить, играть с ним и укладывать спать (нужно 5 дел заботы). Счастливые и легендарные динозавры чаще несут редкие. Забытое на земле яйцо через 20 минут само попадёт в корзину.</p>
          <div class="btn-row" style="margin:4px 0 6px"><button class="chip" id="eg-code">🔑 Ввести подарочный код</button></div>
          <label class="lbl">🔁 Обмен</label>
          <div class="shop">${Life.TRADES.map(t => `<button class="shop-item" data-trade="${t.id}" ${can(t.give) ? '' : 'disabled'}><span class="big">${Life.costText(t.give)} → ${Life.costText(t.get)}</span><span class="s">${t.name}</span></button>`).join('')}</div>
          <label class="lbl">🎩 Шапки для динозавров</label>
          <div class="shop">${Life.HATS.map(h => { const c = Life.hatCost(L, h), ok = can(c) || (h.alt && can(h.alt)), have = L.hats[h.id] || 0; return `<button class="shop-item" data-hat="${h.id}" ${ok ? '' : 'disabled'}><span class="big">${DP.Scene.HATS[h.id]}</span><span class="t">${h.name}${have ? ` · есть ${have}` : ''}</span><span class="s">${Life.costText(c)}${h.alt ? ' или ' + Life.costText(h.alt) : ''}</span></button>`; }).join('')}</div>
          <label class="lbl">🌟 Легендарный динозавр</label>
          <button class="shop-item wide" id="eg-legend" ${(L.tokens.legend > 0 || can(Life.LEGEND_COST) || can(Life.LEGEND_ALT)) ? '' : 'disabled'}><span class="big">🌟🦖</span><span class="t">Золотой динозавр${L.tokens.legend > 0 ? ' · подарок ждёт!' : ''}</span><span class="s">${L.tokens.legend > 0 ? 'Бесплатно' : Life.costText(Life.LEGEND_COST) + ' или ' + Life.costText(Life.LEGEND_ALT)} · сияет и чаще несёт редкие яйца</span></button>`, (p) => {
          UI.wire(p, { back: backTo }); const ec = p.querySelector("#eg-code"); if (ec) ec.onclick = () => go("gifts");
          p.querySelectorAll('[data-trade]').forEach(b => b.onclick = () => { if (Life.trade(park, b.dataset.trade)) { U.toast('🔁 Обмен состоялся!'); commit(); updateHud(); go('eggs'); } });
          p.querySelectorAll('[data-hat]').forEach(b => b.onclick = () => {
            const id = b.dataset.hat; if (!Life.buyHat(park, id)) return;
            commit(); updateHud(); U.toast(`${DP.Scene.HATS[id]} Шапка твоя! Выбери, кому её надеть`, 3000); go('hatfor', id);
          });
          p.querySelector('#eg-legend').onclick = () => go('legend');
        }, { wide: true });
      },
      /** Кому надеть купленную шапку */
      hatfor(id) {
        const list = park.dinos.filter(d => d.loc === park.view).concat(park.dinos.filter(d => d.loc !== park.view));
        UI.show(`${UI.head(`${DP.Scene.HATS[id] || '🎩'} Кому надеть шапку?`, { back: true, sub: 'Австралопитек отнесёт её динозавру' })}
          <div class="dino-grid">${list.map(d => `<button class="dino-tile" data-wear="${d.uid}"><img src="${dinoImg(d)}" alt=""><div class="nm">${U.esc(dinoName(d))}${d.hat ? ' ' + DP.Scene.HATS[d.hat] : ''}</div><div class="s">${U.esc(locName(d.loc))}</div></button>`).join('') || '<div class="empty">Сначала запусти динозавра</div>'}</div>
          <div class="btn-row"><button class="btn" data-back>Потом</button></div>`, (p) => {
          UI.wire(p, { back: () => go('eggs') });
          p.querySelectorAll('[data-wear]').forEach(b => b.onclick = () => { const d = dino(b.dataset.wear); if (d) { UI.close(); wearHat(d, id); } });
        }, { wide: true });
      },
      /** Выбор вида для легендарного динозавра */
      legend() {
        UI.show(`${UI.head('🌟 Золотой динозавр', { back: true, sub: 'Выбери, кто станет легендарным. Он будет сиять золотом' })}
          <div class="hscroll">${DP.Dinos.SPECIES.map(s => `<button class="card" data-lsp="${s.id}"><img src="${DP.Dinos.thumb(s.id, DP.Dinos.LEGEND)}" alt="${s.name}" decoding="async"><div class="nm">${s.name}</div><div class="meta">🌟 легендарный</div></button>`).join('')}</div>`, (p) => {
          UI.wire(p, { back: () => go('eggs') });
          p.querySelectorAll('[data-lsp]').forEach(b => b.onclick = () => {
            if (!Life.buyLegend(park)) { U.toast('Не хватает яиц'); return; }
            const sp = DP.Dinos.byId[b.dataset.lsp];
            const d = newDino({ species: sp.id, palette: DP.Dinos.LEGEND, legend: true, sprite: null, name: 'Золотой ' + sp.name.toLowerCase(), diet: sp.diet, habitat: sp.habitat });
            if (!d) return;
            park.life.stats.legend = (park.life.stats.legend || 0); lifeEvents(Life.checkAch(park)); updateHud(); commit();
            UI.close(); showHint(`🌟 ${d.name} появился в парке!`, 4000);
          });
        }, { wide: true });
      },
      /** Соседи и племя: зверьки и австралопитеки с навыками */
      tribe() {
        const L = park.life;
        const apeHtml = (a) => {
          const sk = Life.SKILLS.map(s => {
            const done = a.sk.includes(s.id), avail = !s.req || a.sk.includes(s.req), pct = done ? 100 : Math.min(99, Math.floor(a.xp / Math.max(1, s.at) * 100));
            return `<div class="sk ${done ? 'done' : avail ? 'next' : 'lock'}" data-sk="${s.id}"><span class="e">${done ? s.e : avail ? s.e : '🔒'}</span><div><b>${s.name}</b><div class="s">${s.desc}${!done && avail ? ` · ${pct}% · ещё ~${realDur(s.at - a.xp)} в игре` : ''}</div></div></div>`;
          }).join('');
          return `<div class="ape"><h3>🐒 ${U.esc(a.name)} <small>${a.sk.length - 1} навыков</small></h3><div class="sk-list">${sk}</div></div>`;
        };
        const nextApe = Life.APES[L.tribe.length];
        UI.show(`${UI.head('🐒 Соседи и племя', { back: true, sub: 'Они приходят сами, живут своей жизнью и медленно учатся' })}
          <label class="lbl">🐿️ Зверьки (первые млекопитающие)</label>
          ${L.mammals.length ? `<div class="mam-list">${L.mammals.map(m => { const def = Life.MAMMALS.find(x => x.kind === m.kind) || {}; return `<div class="mam"><span>${def.emoji || '🐾'}</span><div><b>${U.esc(def.name || m.name)}</b><div class="s">${U.esc(def.sci || '')}</div></div></div>`; }).join('')}</div>` : '<p class="note">Пока никого. Заботься о динозаврах — и первый зверёк появится примерно через час игры.</p>'}
          ${L.mammals.length < Life.MAMMALS.length ? '<p class="note">Скоро придут ещё соседи… 👀</p>' : ''}
          <label class="lbl">🔥 Австралопитеки</label>
          ${L.tribe.length ? L.tribe.map(apeHtml).join('') : `<p class="note">Пока никого. ${nextApe ? `Первый австралопитек придёт, когда в парке будет ${nextApe.need}+ динозавра и пройдёт немного времени.` : ''}</p>`}
          ${L.tribe.length && nextApe ? `<p class="note">${nextApe.chief ? 'Когда кто-нибудь станет вождём ⭐, он позовёт ещё одного.' : `Ещё один придёт позже (нужно ${nextApe.need}+ динозавров).`}</p>` : ''}
          <p class="note">⏳ Навыки растут, пока парк открыт (когда закрыт — вполсилы, не больше 12 часов).</p>`, (p) => UI.wire(p, { back: backTo }), { wide: true });
      },
      /** Подарки: от динозавров и от Динопарка, ввод подарочного кода */
      gifts(code) {
        const L = park.life; localStorage.setItem('dp_gseen_' + park.id, String(L.gifts.length)); updateHud();
        const waiting = L.nest.filter(n => n.k === 'gift').length;
        UI.show(`${UI.head('🎁 Подарки', { back: true, sub: 'Любимые динозавры иногда дарят подарки за заботу — это большая редкость' })}
          ${waiting ? `<div class="note gift-wait">🎁 В парке лежит подарок (${waiting}) — найди коробку и нажми на неё!</div>` : ''}
          ${L.gifts.length ? `<div class="gift-list">${L.gifts.map(g => { const G = g.adm ? null : Life.GIFT[g.g]; return `<div class="gift"><span class="e">${G ? G.e : g.e || '🎁'}</span><div><b>${U.esc(G ? G.name : g.name || 'Подарок')}</b><div class="s">${g.adm ? '🎁 от ' + U.esc(g.from || 'Динопарка') + (g.msg ? ' — ' + U.esc(g.msg) : '') : 'от ' + U.esc(g.from || 'динозавра')}${G && G.r !== 'common' ? (G.r === 'epic' ? ' · ✨ очень редкий' : ' · 💎 редкий') : ''} · ${new Date(g.t).toLocaleDateString('ru-RU')}</div></div></div>`; }).join('')}</div>`
            : '<div class="empty"><div class="big">🎁</div>Пока подарков нет. Корми, играй и укладывай спать своих ⭐ динозавров — и когда-нибудь они отблагодарят тебя.</div>'}
          <label class="lbl" for="gift-code">🔑 Ввести код</label>
          <div class="btn-row" style="margin-top:0"><input class="field" id="gift-code" placeholder="DINO-XXXX-XXXX" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done" style="flex:1 1 auto;min-width:0;width:auto;letter-spacing:.5px" value="${U.esc(code || '')}"><button class="btn green" id="gift-redeem" style="flex:0 0 auto;padding-left:18px;padding-right:18px">Получить</button></div>
          <div class="note" id="gift-msg"></div>`, (p) => {
          UI.wire(p, { back: backTo });
          p.querySelector('#gift-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') p.querySelector('#gift-redeem').click(); });
          p.querySelector('#gift-redeem').onclick = async () => {
            const msg = p.querySelector('#gift-msg'), btn = p.querySelector('#gift-redeem'); btn.disabled = true; msg.textContent = '⏳ Проверяем…';
            try { const r = await redeem(p.querySelector('#gift-code').value); msg.textContent = `✓ Получено: ${Life.giftEmoji(r.g)} ${Life.giftName(r.g)}${r.m ? ' — ' + r.m : ''}`; msg.className = 'note ok'; if (r.made && r.made.length) { setTimeout(() => { UI.close(); celebrateLegend(r.made, true); }, 1200); } else setTimeout(() => { if (current === 'gifts') go('gifts'); }, 1600); }
            catch (e) { msg.textContent = '⚠️ ' + e.message; msg.className = 'note err'; btn.disabled = false; }
          };
        }, { wide: true });
      },
      /** Достижения */
      ach() {
        const L = park.life;
        UI.show(`${UI.head('🏆 Достижения', { back: true, sub: `Получено ${L.ach.length} из ${Life.ACH.length}` })}
          <div class="ach-grid">${Life.ACH.map(a => { const done = L.ach.includes(a.id), v = Math.min(a.goal, a.val(L, park) || 0); return `<div class="ach ${done ? 'done' : ''}" data-ach="${a.id}"><div class="e">${a.e}</div><b>${a.name}</b><div class="s">${a.desc}</div>
            ${done ? '<div class="ok">✓ Получено</div>' : `<div class="pr"><i style="width:${Math.round(v / a.goal * 100)}%"></i></div><div class="s">${v} / ${a.goal}</div>`}${a.reward ? `<div class="rw">Награда: ${Life.costText(a.reward)}</div>` : ''}</div>`; }).join('')}</div>`, (p) => UI.wire(p, { back: backTo }), { wide: true });
      },
      /** Позвать друга и поделиться */
      async invite() {
        UI.show(`${UI.head('💌 Позвать друга', { back: true })}<div class="spinner"></div>`, (p) => UI.wire(p, { back: backTo }), { wide: true });
        const url = await Life.inviteUrl(); if (current !== 'invite') return;
        const L = park.life, today = L.shareDay === Life.dayKey(Date.now());
        UI.show(`${UI.head('💌 Позвать друга и поделиться', { back: true, sub: 'Награды яйцами за друзей и за репост' })}
          <div class="tv-split">
            <div class="tv-box"><h3><span class="num">1</span>Пригласи друга</h3>
              <p class="note">Друг откроет ссылку и создаст свой парк — вы оба получите 💎 редкое яйцо.${Y.mode === 'server' ? ' Награда проверяется на сервере.' : ' Подарок другу — сразу; награда тебе — когда парк работает через сервер (там её нельзя подделать).'}</p>
              <div class="qr">${qr(url)}</div><div class="url" id="inv-url">${U.esc(url)}</div>
              <div class="btn-row"><button class="btn green" id="inv-share">📤 Отправить приглашение</button><button class="btn" id="inv-copy">🔗 Скопировать</button></div>
              <p class="note">Друзей по твоей ссылке: <b>${L.stats.invites || 0}</b></p></div>
            <div class="tv-box"><h3><span class="num">2</span>Поделиться парком</h3>
              <p class="note">Расскажи о Динопарке в чате или соцсети — раз в день получишь 🥚 обычное яйцо.</p>
              <div class="btn-row"><button class="btn" id="inv-repost">📣 Поделиться</button></div>
              <p class="note" id="inv-day">${today ? '✓ Сегодня награда за репост уже получена' : '🥚 Награда за сегодня ещё доступна'}</p></div>
          </div>`, (p) => {
          UI.wire(p, { back: backTo });
          p.querySelector('#inv-share').onclick = () => doShare('invite').then(() => { if (current === 'invite') go('invite'); });
          p.querySelector('#inv-repost').onclick = () => doShare('repost').then(() => { if (current === 'invite') go('invite'); });
          p.querySelector('#inv-copy').onclick = async () => { if (await copyText(url)) U.toast('🔗 Ссылка скопирована'); else U.toast('Скопируй ссылку вручную'); };
        }, { wide: true });
      },
      /** Поддержка: Telegram или форма обратной связи */
      support() {
        const tg = (window.DP_CONFIG || {}).SUPPORT_TELEGRAM_URL || '';
        const ok = /^https:\/\/(t\.me|telegram\.me)\//.test(tg);
        UI.show(`${UI.head('💬 Поддержка', { back: true, sub: 'Вопрос, идея или нашли ошибку — напишите нам' })}
          ${ok ? `<div class="btn-row" style="margin-top:0"><a class="btn green" id="sp-tg" href="${U.esc(tg)}" target="_blank" rel="noopener">✈️ Написать в Telegram</a></div>`
            : `<label class="lbl">Сообщение</label><textarea class="field" id="sp-text" maxlength="1000" rows="5" placeholder="Расскажите, что случилось или что придумали"></textarea>
              <label class="lbl">Как с вами связаться (необязательно)</label><input class="field" id="sp-contact" maxlength="80" placeholder="Telegram, телефон или почта">
              <div class="btn-row"><button class="btn green" id="sp-send">📨 Отправить</button></div><div class="note" id="sp-msg"></div>`}`, (p) => {
          UI.wire(p, { back: backTo });
          const send = p.querySelector('#sp-send'); if (!send) return;
          send.onclick = async () => {
            const text = p.querySelector('#sp-text').value.trim(), contact = p.querySelector('#sp-contact').value.trim(), msg = p.querySelector('#sp-msg');
            if (text.length < 3) { msg.textContent = 'Напишите хотя бы пару слов 🙂'; return; }
            const item = { text: text.slice(0, 1000), contact: contact.slice(0, 80), park: DEMO ? 'demo' : park.id, t: Date.now(), ua: navigator.userAgent.slice(0, 120) };
            let list = []; try { list = JSON.parse(localStorage.getItem('dp_feedback') || '[]'); } catch (e) { list = []; }
            let sent = false;
            if (Y.mode === 'server' && !DEMO) { try { const r = await Y.call({ t: 'feedback', text: item.text, contact: item.contact, park: item.park }); sent = !!(r && r.ok); } catch (e) { sent = false; } }
            item.sent = sent; list.push(item); localStorage.setItem('dp_feedback', JSON.stringify(list.slice(-30)));
            msg.textContent = sent ? '✓ Спасибо! Сообщение отправлено' : '✓ Спасибо! Сообщение сохранено и будет отправлено, когда появится связь с сервером';
            send.disabled = true;
          };
        }, { wide: true });
      }
    };
  }

  function tvStatus(ti) {
    const r = ti.relays && ti.relays.length ? '<span class="status-dot on"></span>Ретранслятор: ' + U.esc(ti.relays.join(', ')) : '<span class="status-dot"></span>Подключаемся к ретранслятору…';
    return r + (ti.paired ? ` · 📺 сопряжено: ${ti.paired}, на связи: ${ti.online}` : '');
  }
  function baseUrl() { return location.href.replace(/[^/]*([?#].*)?$/, ''); }
  function qr(text) { try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (e) { return '<p style="color:#000">QR недоступен</p>'; } }

  function newDino(fields) {
    if (park.dinos.length >= 80) { U.toast('В парке уже 80 динозавров — это максимум. Убери кого-нибудь.', 4000); return null; }
    const d = Object.assign({ uid: U.uid(), added: Date.now(), loc: park.view, owner: ME, needs: N.fresh(Date.now()) }, fields);
    park.dinos.push(d); commit(); return d;
  }
  function travelTo(loc, withAll) {
    const from = park.view; if (loc === from && !withAll) { UI.close(); return; }
    let moved = 0;
    if (withAll) park.dinos.forEach(d => { if (d.loc === from) { d.loc = loc; moved++; } });
    park.view = loc; park.bg = loc; commit(); UI.close();
    showHint(withAll && moved ? `🧭 Путешествие! ${U.dinoCount(moved)} отправились в «${locName(loc)}»` : '🧭 ' + locName(loc) + (here().length ? '' : ' — здесь пока никого'), 4000);
    if (!DEMO && withAll && moved) Y.sendEvent(park, { type: 'travel', to: loc, count: moved });
  }
  function feedAll() {
    UI.close();
    if (!here().length) { showHint('🦕 Здесь пока некого кормить!', 3500); return; }
    fire({ type: 'feed', all: true, items: scene.makeFeed().map(it => Object.assign(it, { by: ME })) });
    showFeedBtn(8000);
    showHint('🍖 Обед для всех! Ещё корм — кнопка 🍖 внизу', 4000);
  }
  function feedSecret() {
    UI.close();
    const my = mine();
    if (!my.length) { showHint('🤫 Здесь нет твоих динозавров. Открой динозавра и нажми «⭐ Это мой динозавр»', 4500); return; }
    const items = scene.makeSecretFeed(my.map(d => d.uid)).map(it => Object.assign(it, { by: ME }));
    fire({ type: 'feed', secret: true, items });
    showHint(`🤫 Тсс… корм только для твоих (${my.length})`, 3500);
  }

  // --- свой фон ---
  $('#bg-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const img = await U.fileToImage(f);
      park.customBg = U.toDataURL(img, 1600, 'image/jpeg', 0.82); park.customLoc = park.view;
      commit(); go('bg');
    } catch (er) { U.toast('Не получилось открыть картинку'); }
  });

  // --- фото ---
  let stream = null;
  const cam = $('#camera'), video = $('#video');
  async function openCamera() {
    UI.close(); current = 'camera';
    cam.classList.remove('hidden');
    $('#cam-tip').textContent = 'Наведи камеру на лист так, чтобы все 4 чёрных квадрата попали в рамку';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { noCamera(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      video.srcObject = stream; $('#cam-shot').disabled = false;
    } catch (e) { noCamera(); }
  }
  function noCamera() { $('#cam-tip').textContent = '📷 Камера недоступна. Нажми «Загрузить фото», чтобы выбрать снимок раскраски'; $('#cam-shot').onclick = () => $('#cam-file').click(); }
  function stopCamera() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } video.srcObject = null; cam.classList.add('hidden'); }
  $('#cam-back').onclick = () => { stopCamera(); screens.menu(); };
  $('#cam-shot').onclick = () => {
    if (!stream || !video.videoWidth) { $('#cam-file').click(); return; }
    const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight; c.getContext('2d').drawImage(video, 0, 0);
    stopCamera(); processPhoto(c);
  };
  const onFile = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    stopCamera();
    try { processPhoto(await U.fileToImage(f)); } catch (er) { U.toast('Не получилось открыть фото'); }
  };
  $('#cam-file').addEventListener('change', onFile);
  $('#photo-file').addEventListener('change', onFile);

  async function processPhoto(src) {
    current = 'photo-res';
    UI.show(`${UI.head('✨ Оживи своего динозавра!')}<div class="spinner"></div><p class="note" style="text-align:center">Вырезаем динозавра из листа…</p>`, (p) => UI.wire(p));
    let res;
    try { await new Promise(r => setTimeout(r, 30)); res = await DP.Photo.process(src); }
    catch (e) {
      console.warn(e);
      const n = e && e.markers != null ? e.markers : null;
      UI.show(`${UI.head('✨ Оживи своего динозавра!')}<div class="empty"><div class="big">🙈</div>Не получилось найти рисунок на фото.${n != null ? `<br><b>Найдено ${n} из 4 меток.</b>` : ''}<br>Сфотографируй лист целиком на светлом фоне, чтобы были видны 4 чёрных квадрата.</div>
        <div class="btn-row"><button class="btn green" id="ph-again">📷 Попробовать ещё раз</button></div>`, (p) => { UI.wire(p); p.querySelector('#ph-again').onclick = openCamera; });
      return;
    }
    photoResult(res);
  }
  function photoResult(res) {
    let sat = 0.35, light = 0;
    const opts = DP.Dinos.SPECIES.map(s => `<option value="${s.id}" ${res.species === s.id ? 'selected' : ''}>${s.name}</option>`).join('');
    const found = res.species ? `Это ${DP.Dinos.byId[res.species].name}! ${DP.Dinos.byId[res.species].emoji}` : 'Кто это? Выбери ниже 👇';
    const mk = res.markers != null ? `Найдено ${res.markers} из 4 меток` : '';
    const how = res.method === 'markers' ? '✓ Лист распознан по угловым меткам' : res.method === 'markers+blob' ? '✓ Лист выпрямлен по меткам' : 'ℹ️ Метки не найдены — динозавр вырезан по контрасту с фоном';
    UI.show(`${UI.head('✨ Оживи своего динозавра!')}
      <p class="note" style="margin-top:-6px">Раскрась динозавра на листе, сфотографируй — и он оживёт в парке</p>
      <div class="preview-box"><canvas id="ph-prev"></canvas></div>
      <div class="found">${found}</div>
      <label class="lbl">Кто это</label>
      <select class="field" id="ph-sp"><option value="">🖍️ Свой рисунок (гуляет по земле)</option>${opts}</select>
      <label class="lbl">Имя (необязательно)</label>
      <input class="field" id="ph-name" maxlength="20" placeholder="Например, Дино">
      <label class="lbl">🎨 Яркие цвета</label>
      <input type="range" id="ph-sat" min="0" max="1" step="0.05" value="${sat}">
      <label class="lbl">☀️ Яркость</label>
      <input type="range" id="ph-light" min="-0.5" max="0.5" step="0.05" value="0">
      <div class="btn-row"><button class="btn green block" id="ph-go">Выпустить в парк! 🦕</button></div>
      <div class="note" id="ph-how" style="text-align:center;margin-top:8px">${how}${mk ? ' · ' + mk : ''}</div>`, (p) => {
      UI.wire(p);
      const prev = p.querySelector('#ph-prev');
      let boosted;
      const render = () => { boosted = DP.Photo.boost(res.canvas, sat, 360, light); prev.width = boosted.width; prev.height = boosted.height; prev.getContext('2d').drawImage(boosted, 0, 0); };
      render();
      p.querySelector('#ph-sat').oninput = (e) => { sat = +e.target.value; render(); };
      p.querySelector('#ph-light').oninput = (e) => { light = +e.target.value; render(); };
      p.querySelector('#ph-go').onclick = () => {
        const spId = p.querySelector('#ph-sp').value, sp = DP.Dinos.byId[spId];
        const d = newDino({ species: null, base: spId || null, sprite: U.toDataURL(boosted, 360, 'image/webp', 0.85), name: p.querySelector('#ph-name').value.trim(), diet: sp ? sp.diet : 'omni', habitat: sp ? sp.habitat : 'ground' });
        if (!d) return;
        UI.show(`${UI.head('✨ Оживи своего динозавра!')}<div class="success"><div class="check">✓</div><h3>Динозавр убежал в парк!</h3><p class="note">Закрой окно — он уже гуляет</p></div>
          <div class="btn-row"><button class="btn" id="ph-more">📷 Сфотографировать ещё одного</button><button class="btn green" data-close>Закрыть</button></div>`, (q) => {
          UI.wire(q); q.querySelector('#ph-more').onclick = openCamera;
        });
      };
    });
  }

  function demoPark() {
    const now = Date.now(), me = S.owner();
    const mk = (species, loc, name, needs, own) => { const sp = DP.Dinos.byId[species]; return { uid: U.uid(), species, palette: Math.floor(Math.random() * sp.palettes.length), sprite: null, name, diet: sp.diet, habitat: sp.habitat, added: now, loc, owner: own ? me : 'demo', needs: Object.assign(N.fresh(now), needs || {}) }; };
    return { id: 'demo', pin: '', name: 'Демо-парк', view: 'jungle', bg: 'jungle', customBg: null, customLoc: null, created: now, updated: now, dinos: [
      mk('trex', 'jungle', 'Рекс', { food: 22 }, true), mk('triceratops', 'jungle', 'Трики', { play: 25 }), mk('brachiosaurus', 'jungle', 'Брахи', null, true),
      mk('pterodactyl', 'jungle', 'Птеро', { sleep: 14 }), mk('velociraptor', 'jungle', 'Шустрик', null, true),
      mk('plesiosaur', 'lagoon', 'Несси'), mk('parasaurolophus', 'lagoon', 'Дудка', null, true),
      mk('stegosaurus', 'canyon', 'Стеги'), mk('velociraptor', 'canyon', 'Рапти'),
      mk('ankylosaurus', 'glacier', 'Танк', { food: 40 }), mk('triceratops', 'nightforest', 'Соня', { sleep: 20 })
    ] };
  }

  // открыть экран из адресной строки: park.html?id=..&open=menu|camera|card…
  const op = U.param('open');
  if (op === 'camera') openCamera();
  else if (U.param('gift')) go('gifts', U.param('gift'));
  else if (op && screens[op]) go(op);
  else if (!park.dinos.length && !localStorage.getItem('dp_onboarded') && !DEMO) go('onboarding');
  else if (park.dinos.length && !localStorage.getItem('dp_news_v3')) go('news');
  v3Start();
  if (window.DPBOOT) window.DPBOOT.ready = true; // загрузчик (js/boot.js): страница запустилась
  window.dpPark = { get park() { return park; }, screens, redeem, feedGifts, legendFromGifts, processPhoto, feedAll, feedSecret, travelTo, newDino, commit, mode, owner: ME, demo: DEMO, lifeTick, pickup, startHide, closeUp, playAll, sleepAll, redeem, doShare, lifeEvents };
})().catch(function (e) { if (window.DPBOOT && window.DPBOOT.fail) window.DPBOOT.fail(e, 'запуск'); else throw e; });
