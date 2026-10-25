/* Динопарк — страница парка (она же «пульт»): меню по нажатию, динозавры с потребностями,
 * кормление (всех / тайно своих), локации и путешествия, фото раскраски, ТВ, управление парком. */
(async function () {
  const U = DP.util, S = DP.store, Y = DP.sync, UI = DP.ui, N = DP.Needs, V = DP.Voices, $ = (s) => document.querySelector(s);
  const ME = S.owner();
  let shownView = null; // какая локация сейчас на экране
  const DEMO = U.param('demo') === '1';
  const LOCS = DP.BG.LIST;
  const locName = (id) => (DP.BG.byId[id] || LOCS[0]).name;
  const spOf = (d) => DP.Dinos.byId[d.species || d.base];
  const dinoName = (d) => d.name || (spOf(d) ? spOf(d).name : 'Мой рисунок');
  const dinoImg = (d) => d.sprite || DP.Dinos.url(d.species, d.palette || 0);

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
    ['fast', 'tod'].forEach(k => { if (U.param(k)) keep.set(k, U.param(k)); });
    history.replaceState(null, '', 'park.html?' + keep.toString()); // PIN из адресной строки убираем
  }
  S.normalize(park);
  document.title = 'Динопарк — ' + park.name;

  const canvas = $('#park');
  const scene = new DP.Scene(canvas, {
    entrance: false, tod: U.param('tod') || localStorage.getItem('dp_tod') || 'auto',
    onEat: (e, f) => { // засчитывает только то устройство, которое бросило корм
      if (f.by !== ME) return;
      const d = dino(e.uid); if (!d) return;
      N.feed(d, f.secret ? 45 : 30); commitSoon();
    },
    onWake: () => { if (current === 'card') refreshCard(); }
  });
  window.dpScene = scene; // для отладки/тестов
  apply(true);
  scene.opts.entrance = true;

  if (!DEMO) {
    Y.subscribe(park);
    Y.on('park', (p) => {
      if (p.id !== park.id) return;
      p.pin = park.pin; park = S.normalize(p); apply();
      if (UI.isOpen() && current === 'menu') screens.menu();
      if (UI.isOpen() && current === 'card') refreshCard();
    });
    Y.on('event', handleEvent);
    Y.on('status', () => { if (UI.isOpen() && current === 'menu') screens.menu(); });
    Y.on('deleted', (id) => { if (id !== park.id) return; S.remove(park.id); U.toast('🗑️ Этот парк удалили', 4000); setTimeout(() => location.replace('parks.html'), 1500); });
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
  let feedModeUntil = 0;
  canvas.addEventListener('click', (e) => {
    if (UI.isOpen()) { UI.close(); return; }
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const en = scene.hit(x, y);
    if (en) { fire({ type: 'jump', uid: en.uid, text: U.pick(['РРРР! 🦖', '😄', '💚', 'Привет! 👋', '🎵', '😝', 'Ррр! 🔥', '⭐', '🤗', 'Ура! 🎉']) }); go('card', en.uid); return; }
    if (Date.now() < feedModeUntil) { const it = scene.foodAt(x, y); it.by = ME; fire({ type: 'feed', items: [it] }); feedModeUntil = Date.now() + 8000; return; }
    screens.menu();
  });

  // --- экраны ---
  let current = null, tvTimer = null, cardTimer = null, cardUid = null;
  UI.onClose(() => { clearInterval(cardTimer); clearInterval(tvTimer); current = null; });
  function go(name, arg) { current = name; clearInterval(tvTimer); clearInterval(cardTimer); screens[name](arg); }
  const voicesRow = () => V && V.isOn() ? ['voices', '🗣️', 'Голоса динозавров: включены', 'Рычат, когда их трогают, едят и просыпаются'] : ['voices', '🤐', 'Голоса динозавров: выключены', 'Нажми, чтобы включить'];
  const musicRow = () => DP.music && DP.music.isOn() ? ['music', '🔊', 'Музыка: включена', 'Приключенческий оркестр и птицы джунглей · нажми, чтобы выключить'] : ['music', '🔇', 'Музыка: выключена', 'Нажми, чтобы включить фоновую музыку'];
  function rows() {
    const h = here(), my = mine(h);
    return [
      ['photo', '📷', 'Сфотографировать динозавра', 'Раскрашенный лист оживёт в парке'],
      ['ready', '🦖', 'Запустить готового динозавра', 'Из набора, без раскрашивания'],
      ['feedall', '🍖', 'Покормить всех', h.length ? 'Корм упадёт для всех динозавров — увидят все экраны' : 'Здесь пока некого кормить'],
      ['secret', '🤫', 'Тайно покормить своих', my.length ? `Корм только возле твоих (${my.length}) — без объявления на ТВ` : 'Своих здесь нет: запусти динозавра с этого устройства'],
      ['dinos', '🦕', 'Динозавры и их желания', `${U.dinoCount(park.dinos.length)} · 🍖 голод · 🎾 игра · 💤 сон`],
      ['locs', '🧭', 'Локации и путешествия', 'Сейчас: ' + locName(park.view)],
      ['coloring', '🖨️', 'Раскраски для печати', DP.Dinos.SPECIES.length + ' видов динозавров на обычном листе А4'],
      ['bg', '🖼️', 'Свой фон', park.customBg ? 'Своя картинка в «' + locName(park.customLoc) + '»' : 'Загрузить свою картинку вместо фона локации'],
      ['cleanup', '🧹', 'Убрать динозавров', 'Удалить лишних из парка'],
      ['tv', '📺', 'Открыть на другом экране', 'На ТВ или смарт-ТВ, телефоне, ПК или планшете'],
      musicRow(), voicesRow(),
      ['admin', '⚙️', 'Управление парком', 'Название, пароль, время суток, удаление'],
      ['parks', '🗂️', 'Мои парки', 'Создайте новые парки, переключайтесь']
    ];
  }
  if (DP.music) { DP.music.button('bl'); DP.music.onChange(() => { if (current === 'menu' && UI.isOpen()) screens.menu(); }); }

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

  const screens = {
    menu() {
      const st = DEMO ? '🎬 Демо-режим' : Y.mode === 'server' ? '<span class="status-dot on"></span>Синхронизация через сервер' : '<span class="status-dot"></span>Локальный режим (это устройство)';
      UI.show(`<div class="panel-head">
          <div style="flex:1;min-width:0"><h2>${U.esc(park.name)} <button class="icon-btn" id="m-rename" title="Переименовать" style="width:34px;height:34px;font-size:15px;vertical-align:middle">✏️</button></h2>
          <div class="sub">${U.dinoCount(park.dinos.length)} · здесь ${here().length} · ${U.esc(locName(park.view))}</div></div>
          <button class="icon-btn" id="m-fs" title="Во весь экран">⛶</button><button class="icon-btn" data-close title="Закрыть">✕</button></div>
        <div class="rows">${rows().map(r => `<button class="row" data-go="${r[0]}"><span class="emo">${r[1]}</span><span class="txt"><div class="t">${r[2]}</div><div class="s">${r[3]}</div></span><span class="chev">›</span></button>`).join('')}</div>
        <div class="menu-foot"><span>${st}</span><a href="index.html" style="color:var(--muted)">🏠 На главную</a></div>`, (p) => {
        UI.wire(p);
        p.querySelector('#m-rename').onclick = () => go('rename');
        p.querySelector('#m-fs').onclick = () => U.toggleFullscreen();
        p.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
          const g = b.dataset.go;
          if (g === 'feedall') return feedAll();
          if (g === 'secret') return feedSecret();
          if (g === 'coloring') return window.open('coloring.html', '_blank');
          if (g === 'music') { if (DP.music) DP.music.toggle(); return; }
          if (g === 'voices') { V.set(!V.isOn()); if (V.isOn()) V.play('trex', 'tap', 'menu'); return screens.menu(); }
          go(g);
        });
      });
    },
    rename() {
      UI.show(`${UI.head('Название парка', { back: true })}
        <input class="field" id="rn" maxlength="40" value="${U.esc(park.name)}" placeholder="Парк" autofocus>
        <div class="btn-row"><button class="btn" data-back>Отмена</button><button class="btn green" id="rn-ok">Сохранить</button></div>`, (p) => {
        UI.wire(p, { back: () => go('menu') });
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
        </div>
        <label class="lbl">🧭 Отправить в…</label>
        <div class="loc-chips">${others.map(l => `<button class="chip" data-travel="${l.id}">${U.esc(l.name)}</button>`).join('')}</div>
        <div class="btn-row" style="margin-top:10px">${own ? '<span class="note">⭐ Это твой динозавр — его можно тайно кормить</span>' : '<button class="btn" id="cd-own">⭐ Это мой динозавр</button>'}</div>`, (p) => {
        UI.wire(p);
        p.querySelector('#cd-feed').onclick = () => {
          const items = scene.makeSecretFeed([uid]).map(it => Object.assign(it, { secret: false, by: ME }));
          if (!items.length) { N.feed(d, 30); commit(); refreshCard(); return; }
          fire({ type: 'feed', items }); UI.close(); showHint('🍖 ' + dinoName(d) + ' бежит к еде!', 2500);
        };
        p.querySelector('#cd-play').onclick = () => { N.play(d); commit(); fire({ type: 'play', uid, u: Math.random() }); UI.close(); showHint('🎾 Играем с ' + dinoName(d) + '!', 2500); };
        p.querySelector('#cd-sleep').onclick = (ev) => {
          if (ev.currentTarget.dataset.act === 'wake') { N.wake(d); commit(); const e = scene.ent(uid); if (e) V.play(e.species || e.base, 'wake', uid); }
          else { N.sleep(d); commit(); }
          refreshCard();
        };
        p.querySelector('#cd-voice').onclick = () => fire({ type: 'jump', uid, text: '🗣️' });
        p.querySelectorAll('[data-travel]').forEach(b => b.onclick = () => {
          d.loc = b.dataset.travel; commit(); UI.close();
          showHint(`🧭 ${dinoName(d)} отправился в «${locName(d.loc)}»`, 3500);
          if (!DEMO) Y.sendEvent(park, { type: 'travel', uid, to: d.loc, name: dinoName(d) });
        });
        const ow = p.querySelector('#cd-own'); if (ow) ow.onclick = () => { d.owner = ME; commit(); go('card', uid); };
        clearInterval(cardTimer); cardTimer = setInterval(refreshCard, 700);
      });
    },
    /** Все динозавры парка со шкалами */
    dinos() {
      const list = park.dinos.slice().sort((a, b) => (a.loc === park.view ? 0 : 1) - (b.loc === park.view ? 0 : 1));
      UI.show(`${UI.head('Динозавры и их желания', { back: true, sub: 'Нажми на динозавра, чтобы покормить, поиграть или уложить спать' })}
        ${list.length ? `<div class="rows">${list.map(d => { const s = N.at(d); return `<button class="row dino-row" data-card="${d.uid}"><img src="${dinoImg(d)}" alt="">
          <span class="txt"><div class="t">${d.owner === ME ? '⭐ ' : ''}${U.esc(dinoName(d))}</div><div class="s">${U.esc(locName(d.loc))}${s.asleep ? ' · 😴 спит' : ''}</div></span>
          <span class="mini">${['food', 'play', 'sleep'].map(k => `<span class="${(k === 'sleep' ? !s.asleep && s[k] < N.LOW : s[k] < N.LOW) ? 'low' : ''}">${N.ICON[k]}${Math.round(s[k])}</span>`).join('')}</span></button>`; }).join('')}</div>`
          : '<div class="empty"><div class="big">🥚</div>В парке пока никого нет.<br>Сфотографируй раскраску или запусти готового динозавра.</div><div class="btn-row"><button class="btn green" id="dn-add">🦖 Запустить динозавра</button></div>'}`, (p) => {
        UI.wire(p, { back: () => go('menu') });
        p.querySelectorAll('[data-card]').forEach(b => b.onclick = () => {
          const d = dino(b.dataset.card); if (!d) return;
          if (d.loc !== park.view) { park.view = d.loc; park.bg = d.loc; commit(); }
          go('card', d.uid);
        });
        const a = p.querySelector('#dn-add'); if (a) a.onclick = () => go('ready');
      }, { wide: true });
    },
    /** Локации: переключение и путешествие */
    locs() {
      UI.show(`${UI.head('Локации и путешествия', { back: true, sub: 'Перейди в другую локацию или отправься туда со всеми динозаврами' })}
        <div class="grid3">${LOCS.map(l => { const n = park.dinos.filter(d => d.loc === l.id).length; const img = park.customBg && park.customLoc === l.id ? park.customBg : DP.BG.thumb(l.id);
          return `<button class="thumb ${park.view === l.id ? 'active' : ''}" data-loc="${l.id}"><img src="${img}" alt=""><div class="cap">${U.esc(l.name)} · ${n ? '🦕 ' + n : 'пусто'}</div></button>`; }).join('')}</div>
        <label class="lbl" style="display:flex;gap:10px;align-items:center;margin-top:12px"><input type="checkbox" id="lc-all"> 🧭 Путешествие: взять с собой всех динозавров отсюда</label>`, (p) => {
        UI.wire(p, { back: () => go('menu') });
        p.querySelectorAll('[data-loc]').forEach(b => b.onclick = () => travelTo(b.dataset.loc, p.querySelector('#lc-all').checked));
      }, { wide: true });
    },
    ready() {
      UI.show(`${UI.head('Кого запустить?', { back: true, sub: 'Нажми на динозавра — он сразу прибежит в «' + locName(park.view) + '»' })}
        <input class="field" id="rd-name" maxlength="20" placeholder="Имя динозавра (необязательно)">
        <div class="hscroll" style="margin-top:12px">${DP.Dinos.SPECIES.map(s => `<button class="card" data-sp="${s.id}">
            <img src="${DP.Dinos.url(s.id, 0)}" alt="${s.name}"><div class="nm">${s.name}</div>
            <div class="meta">${s.diet === 'herb' ? '🌿 травоядный' : '🍖 хищник'} · ${s.habitat === 'sky' ? 'летает' : s.habitat === 'water' ? 'плавает' : 'гуляет'}</div></button>`).join('')}</div>`, (p) => {
        UI.wire(p, { back: () => go('menu') });
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
        UI.wire(p, { back: () => go('menu') });
        p.querySelector('#bg-add').onclick = () => $('#bg-file').click();
        const h = p.querySelector('#bg-here'); if (h) h.onclick = () => { park.customLoc = park.view; commit(); go('bg'); };
        const del = p.querySelector('#bg-del'); if (del) del.onclick = () => { park.customBg = null; park.customLoc = null; commit(); go('bg'); };
      }, { wide: true });
    },
    cleanup() {
      UI.show(`${UI.head('Убрать динозавров', { back: true, sub: park.dinos.length ? 'Нажми ✕, чтобы убрать динозавра из парка' : '' })}
        ${park.dinos.length ? `<div class="dino-grid">${park.dinos.map(d => `<div class="dino-tile"><img src="${dinoImg(d)}" alt=""><div class="nm">${U.esc(d.name || (d.sprite ? '🖍️ ' + (spOf(d) ? spOf(d).name : 'Рисунок') : spOf(d).name))}</div><div class="s">${U.esc(locName(d.loc))}</div><button class="del" data-del="${d.uid}" title="Убрать">✕</button></div>`).join('')}</div><div class="btn-row"><button class="btn danger" id="cl-all">🧹 Убрать всех</button></div>`
        : '<div class="empty"><div class="big">🌴</div>В парке пока никого нет</div>'}`, (p) => {
        UI.wire(p, { back: () => go('menu') });
        p.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { park.dinos = park.dinos.filter(d => d.uid !== b.dataset.del); commit(); go('cleanup'); });
        const all = p.querySelector('#cl-all');
        if (all) all.onclick = () => { if (confirm('Убрать всех динозавров из парка?')) { park.dinos = []; commit(); go('cleanup'); } };
      }, { wide: true });
    },
    async tv() {
      if (DEMO) { UI.show(`${UI.head('Открыть на другом экране', { back: true })}<div class="empty"><div class="big">🎬</div>В демо-режиме парк не сохраняется. Создай свой парк — и его можно будет открыть на телевизоре.</div><div class="btn-row"><a class="btn green" href="parks.html">Создать парк</a></div>`, (p) => UI.wire(p, { back: () => go('menu') })); return; }
      UI.show(`${UI.head('Открыть на другом экране', { back: true })}<div class="spinner"></div>`, (p) => UI.wire(p, { back: () => go('menu') }), { wide: true });
      const info = await Y.tvCode(park);
      if (current !== 'tv') return;
      const url = baseUrl() + 'tv.html?code=' + info.code;
      const warn = location.protocol === 'file:' ? '<div class="note" style="margin-top:12px">⚠️ Страница открыта как файл — QR-код сработает, только если сайт запущен через сервер (см. README).</div>'
        : !info.server ? '<div class="note" style="margin-top:12px">💾 Локальный режим: код работает в другой вкладке/окне этого же браузера. Чтобы открыть парк на телевизоре или другом устройстве, запустите Node-сервер (<code>cd server && npm install && npm start</code>).</div>'
        : '<div class="note" style="margin-top:12px">🟢 Телевизор и этот телефон будут синхронизированы через сервер — всё, что вы делаете здесь, сразу появится на экране.</div>';
      UI.show(`${UI.head('Открыть на другом экране', { back: true, sub: 'На ТВ или смарт-ТВ, телефоне, ПК или планшете' })}
        <div class="tv-split">
          <div class="tv-box"><h3><span class="num">1</span>Отсканируйте QR-код для телевизора</h3><div class="qr">${qr(url)}</div><div class="url">${U.esc(url)}</div></div>
          <div class="tv-box"><h3><span class="num">2</span>Код для телевизора (пять цифр — не путать с паролем)</h3>
            <div class="muted" style="font-weight:700;font-size:14px">Откройте на ТВ <b>${U.esc(baseUrl())}tv.html</b> и введите:</div>
            <div class="tv-code">${info.code}</div>
            <div class="note">Действует 5 минут. По истечении — генерируется новый.</div>
            <div class="timer" id="tv-timer" style="margin-top:8px"></div>
            <button class="btn" style="margin-top:12px" id="tv-open">🪟 Открыть в новой вкладке</button></div>
        </div>${warn}`, (p) => {
        UI.wire(p, { back: () => go('menu') });
        p.querySelector('#tv-open').onclick = () => window.open(url, '_blank');
        const tick = () => {
          const left = Math.max(0, info.exp - Date.now());
          const el = p.querySelector('#tv-timer'); if (el) el.textContent = `⏳ Осталось ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
          if (left <= 0 && current === 'tv') { clearInterval(tvTimer); screens.tv(); }
        };
        tick(); clearInterval(tvTimer); tvTimer = setInterval(tick, 1000);
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
        UI.wire(p, { back: () => go('menu') });
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
        <label class="lbl" style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="ad-rings" ${scene.showNeeds ? 'checked' : ''}> Показывать значки желаний над динозаврами</label>
        ${DEMO ? '' : `<div class="btn-row"><button class="btn danger" id="ad-del">🗑️ Удалить парк</button></div><p class="note">Удалённый парк хранится на сервере ещё 30 дней — его можно восстановить через администратора.</p>`}`, (p) => {
        UI.wire(p, { back: () => go('menu') });
        p.querySelector('#ad-ren').onclick = () => { park.name = p.querySelector('#ad-name').value.trim().slice(0, 40) || 'Парк'; commit(); U.toast('✓ Сохранено'); };
        p.querySelectorAll('[data-tod]').forEach(b => b.onclick = () => { localStorage.setItem('dp_tod', b.dataset.tod); scene.setTimeOfDay(b.dataset.tod); go('admin'); });
        p.querySelector('#ad-rings').onchange = (e) => { scene.showNeeds = e.target.checked; localStorage.setItem('dp_rings', e.target.checked ? '1' : '0'); };
        if (DEMO) return;
        p.querySelector('#ad-show').onclick = () => { const el = p.querySelector('#ad-pin'); el.textContent = el.textContent === '••••' ? el.dataset.pin : '••••'; };
        p.querySelector('#ad-pinok').onclick = async () => {
          const msg = p.querySelector('#ad-msg');
          try { await Y.setPin(park, p.querySelector('#ad-old').value.trim(), p.querySelector('#ad-new').value.trim()); msg.textContent = '✓ Пароль изменён. Запиши новый!'; p.querySelector('#ad-pin').dataset.pin = park.pin; }
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
        UI.wire(p, { back: () => go('menu') });
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
        </div>
        <div class="btn-row"><button class="btn green" id="ob-ready">🦖 Запустить первого динозавра</button><button class="btn" id="ob-photo">📷 Сфотографировать раскраску</button><button class="btn" data-close>Осмотреться</button></div>`, (p) => {
        UI.wire(p); localStorage.setItem('dp_onboarded', '1');
        p.querySelector('#ob-ready').onclick = () => go('ready');
        p.querySelector('#ob-photo').onclick = () => go('photo');
      }, { wide: true });
    }
  };
  Object.keys(screens).forEach((k) => { const f = screens[k]; screens[k] = (a) => { current = k; clearInterval(tvTimer); if (k !== 'card') clearInterval(cardTimer); return f(a); }; });

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
    feedModeUntil = Date.now() + 10000;
    showHint('🍖 Обед для всех! Нажимай на парк — бросай ещё корм', 5000);
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

  if (localStorage.getItem('dp_rings') === '0') scene.showNeeds = false;
  // открыть экран из адресной строки: park.html?id=..&open=menu|camera|card…
  const op = U.param('open');
  if (op === 'camera') openCamera();
  else if (op && screens[op]) go(op);
  else if (!park.dinos.length && !localStorage.getItem('dp_onboarded') && !DEMO) go('onboarding');
  window.dpPark = { get park() { return park; }, screens, processPhoto, feedAll, feedSecret, travelTo, newDino, commit, mode, owner: ME, demo: DEMO };
})();
