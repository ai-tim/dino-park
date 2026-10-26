/* Динопарк — экран телевизора: ввод 5-значного кода → полноэкранный просмотр парка с живой синхронизацией.
 * Без сервера (GitHub Pages) связь с телефоном идёт через интернет-ретранслятор со сквозным шифрованием (js/relay.js).
 * Только синтаксис ES2017: браузеры телевизоров LG webOS (Chromium 68–87). */
(async function () {
  const U = DP.util, Y = DP.sync, $ = (s) => document.querySelector(s);
  let scene = null, park = null;
  if (DP.music) DP.music.button('br');
  const mode = await Y.connect();
  const relayOk = !!(DP.relay && DP.relay.supported());
  $('#mode').innerHTML = mode === 'server' ? '<span class="status-dot on"></span>Сервер подключён'
    : relayOk ? '<span class="status-dot on"></span>Связь с телефоном через интернет — без регистрации, зашифровано'
      : '<span class="status-dot"></span>Этот браузер не поддерживает защищённую связь — откройте сайт по https';

  // экранная клавиатура: удобно с пульта (стрелки + OK)
  const kp = $('#kp');
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].forEach((k) => {
    const b = document.createElement('button'); b.textContent = k; b.type = 'button'; b.setAttribute('data-k', k); if (k === 'OK') b.className = 'ok';
    b.onclick = () => { const f = $('#code'); if (k === '⌫') f.value = f.value.slice(0, -1); else if (k === 'OK') join(f.value.trim()); else if (f.value.length < 5) { f.value += k; if (f.value.length === 5) join(f.value); } };
    kp.appendChild(b);
  });

  const S = DP.store;
  let shownView = null;
  const locName = (id) => (DP.BG.byId[id] || DP.BG.LIST[0]).name;
  const here = (p) => (p.dinos || []).filter(d => d.loc === p.view);
  function render(p) {
    S.normalize(p);
    const custom = p.customBg && p.customLoc === p.view, jump = shownView !== p.view; shownView = p.view;
    scene.setBackground(custom ? 'custom' : p.view, p.customBg); scene.setDinos(here(p), jump);
    if (DP.Life && scene.setLife) scene.setLife(DP.Life.ensure(p), p);
    $('#tvname').textContent = '🦖 ' + p.name + ' · ' + locName(p.view) + ' · ' + U.dinoCount(here(p).length);
  }
  let toastT = null;
  function announce(text) { const el = $('#tvtoast'); if (!el) return U.toast(text, 3500); el.textContent = text; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3800); }
  function makeScene() {
    scene = DP.makeScene($('#park'), { entrance: false, tod: U.param('tod') || 'auto', showNeeds: false, needHint: false, maxFps: TV ? 30 : 0 });
    window.dpScene = scene;
  }
  const TV = /Web0S|webOS|SmartTV|SMART-TV|Tizen|NetCast|BRAVIA|HbbTV/i.test(navigator.userAgent);
  function show(p) {
    park = p;
    $('#join').classList.add('hidden'); $('#park').classList.remove('hidden'); $('#bar').classList.remove('hidden'); $('#tvname').classList.remove('hidden');
    if (!scene) { makeScene(); watchFps(); }
    scene.resize(); render(p); scene.opts.entrance = true;
    sessionStorage.setItem('dp_tv', JSON.stringify({ id: p.id, token: Y.tvToken || null, relay: !!Y.tvRelay }));
    wake(); linkState();
  }
  // слабая видеокарта телевизора. v5: сначала сцена сама снижает разрешение (Scene3D.adaptRes, обратимо). Если и это не помогло —
  // после 10 с разогрева и 5 замеров подряд (10 с) меньше 12 кадров/с (или 3 замера меньше 4 кадров/с): шаг 1 — детализация ниже, шаг 2 — 2D.
  // Решение хранится 36 ч (dp.perf), потом телевизор снова пробует полное качество.
  function watchFps() {
    if (!scene.is3d) return;
    let f0 = scene.frames || 0, t0 = Date.now(), bad = 0, worst = 0;
    const warm = Date.now() + 10000;
    const iv = setInterval(() => {
      if (!scene || !scene.is3d) return clearInterval(iv);
      const fps = ((scene.frames || 0) - f0) * 1000 / (Date.now() - t0); f0 = scene.frames || 0; t0 = Date.now();
      if (document.hidden || Date.now() < warm) { bad = 0; worst = 0; return; }
      bad = fps < 12 && (scene._rs || 1) <= 0.6 ? bad + 1 : 0;
      worst = fps < 4 ? worst + 1 : 0; // 1–3 кадра/с: снижением разрешения уже не спасти — сразу ступенька вниз
      if ((bad >= 5 || worst >= 3) && !U.param('r') && !U.param('q')) {
        clearInterval(iv);
        const P = DP.Scene.PERF, next = P.quality === 'high' ? 'mid' : P.quality === 'mid' ? 'low' : null;
        try { localStorage.setItem('dp.perf', JSON.stringify(next ? { v: 5, q: next, t: Date.now() } : { v: 5, q: 'low', r: '2d', t: Date.now() })); } catch (e) { /* ignore */ }
        if (next) P.quality = next; else P.render2d = true;
        scene.destroy(); const c = $('#park'), nc = c.cloneNode(false); c.parentNode.replaceChild(nc, c);
        shownView = null; makeScene(); scene.resize(); render(park);
        announce(next ? '🖼️ Графика упрощена для плавности' : '🖼️ Включена лёгкая графика для этого телевизора');
        if (next) watchFps();
      }
    }, 2000);
  }
  function linkState() {
    const el = $('#tvlink'); if (!Y.tvRelay || !Y.viewer) { el.classList.add('hidden'); return; }
    const on = Y.viewer.phoneOnline(), relays = DP.relay.hub.online();
    el.classList.remove('hidden');
    el.innerHTML = on ? '<span class="status-dot on"></span>📱 Телефон на связи' : '<span class="status-dot"></span>📱 Ждём телефон… (откройте парк на телефоне)';
    el.title = relays.join(', ');
    el.dataset.on = on ? '1' : '0';
  }
  setInterval(() => { if (park) linkState(); }, 3000);
  Y.on('park', (p) => { if (park && p.id === park.id) { const prev = park.view; park = p; render(p); if (p.view !== prev) announce('🧭 Путешествие: ' + locName(p.view)); linkState(); } });
  Y.on('event', (ev) => {
    if (!scene || !ev) return;
    if (ev.type === 'feed') { scene.dropFood(ev.items || []); if (ev.all) announce('🍖 Обед! Все динозавры — к еде!'); } // тайный корм — без объявления
    if (ev.type === 'jump') scene.jump(ev.uid, ev.text);
    if (ev.type === 'play') scene.play(ev.uid, ev.u);
    if (ev.type === 'pet') { const e = scene.ent(ev.uid); if (e) { scene.hearts(e.x, e.y - 40); scene.jump(ev.uid, ev.text || '💚'); } }
    if (ev.type === 'sleepall') announce('💤 Спокойной ночи, динозавры!');
    if (ev.type === 'playall') announce('🎾 Играем со всеми!');
    if (ev.type === 'closeup' && scene.closeUp) scene.closeUp(ev.uid);
    if (ev.type === 'zoomout' && scene.resetZoom) scene.resetZoom();
    if (ev.type === 'travel' && ev.name) announce(`🧭 ${ev.name} отправился в «${locName(ev.to)}»`);
  });
  Y.on('deleted', () => { sessionStorage.removeItem('dp_tv'); location.href = 'tv.html'; });

  let joining = false;
  async function join(code) {
    if (joining) return;
    $('#err').textContent = '';
    if (!/^\d{5}$/.test(code)) { $('#err').textContent = 'Нужно ввести 5 цифр'; return; }
    joining = true; $('#go').disabled = true; $('#err').textContent = '⏳ Подключаемся к телефону…';
    try { show(await Y.tvJoin(code)); history.replaceState(null, '', 'tv.html'); }
    catch (e) { $('#err').textContent = '⚠️ ' + e.message; }
    finally { joining = false; $('#go').disabled = false; }
  }
  $('#go').onclick = () => join($('#code').value.trim());
  $('#code').onkeydown = (e) => { if (e.key === 'Enter' || e.keyCode === 13) join($('#code').value.trim()); };
  $('#code').oninput = () => { const v = $('#code').value.replace(/\D/g, '').slice(0, 5); if (v !== $('#code').value) $('#code').value = v; };
  $('#fs').onclick = () => U.toggleFullscreen();
  $('#exit').onclick = () => { sessionStorage.removeItem('dp_tv'); if (Y.viewer) Y.viewer.forget(); location.href = 'tv.html'; };

  // скрываем кнопки, когда никто не трогает экран
  let wt = null;
  function wake() { $('#bar').classList.remove('fade'); $('#tvname').classList.remove('fade'); clearTimeout(wt); wt = setTimeout(() => { $('#bar').classList.add('fade'); $('#tvname').classList.add('fade'); }, 4000); }
  ['mousemove', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, () => { if (park) wake(); }));
  document.body.addEventListener('click', (e) => { if (!park || e.target.id !== 'park') return; wake(); const r = e.target.getBoundingClientRect(); const d = scene && scene.hitScreen(e.clientX - r.left, e.clientY - r.top); if (d) scene.jump(d.uid); });

  const hm = /[#&]code=(\d{5})/.exec(location.hash), code = U.param('code') || (hm && hm[1]);
  if (code) { $('#code').value = code; join(code); }
  else {
    try {
      const saved = JSON.parse(sessionStorage.getItem('dp_tv') || 'null'), rs = DP.relay && DP.relay.savedTv();
      if (saved && !saved.relay) { const p = await Y.tvWatch(saved.id, saved.token); if (p) show(p); }
      else if (rs && mode !== 'server') { // телевизор уже сопряжён с телефоном — подключаемся сами
        $('#err').textContent = '⏳ Подключаемся к телефону…';
        const p = await Y.tvWatch(null, null, true); if (p) show(p);
      }
    } catch (e) { $('#err').textContent = '⚠️ ' + e.message + ' — или введите новый код'; }
  }
})();
