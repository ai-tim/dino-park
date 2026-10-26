/* Динопарк — экран телевизора: ввод 5-значного кода → полноэкранный просмотр парка с живой синхронизацией.
 * Без сервера (GitHub Pages) связь с телефоном идёт через интернет-ретранслятор со сквозным шифрованием (js/relay.js).
 * Только синтаксис ES2017 (LG webOS Chromium 68+, Samsung Tizen 4+ = Chromium 56+). Для более старых ТВ загрузчик tv.html
 * подключает js/legacy/tv-*.js — тот же код, переведённый в ES5 (tools/build-legacy.js). */
(async function () {
  const U = DP.util, Y = DP.sync, $ = (s) => document.querySelector(s);
  let scene = null, park = null;
  try { if (DP.music) DP.music.button('br'); } catch (e) { /* без музыки */ }

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
    if (!scene) { makeScene(); watchFps(); qLabel(); }
    scene.resize(); render(p); scene.opts.entrance = true;
    sessionStorage.setItem('dp_tv', JSON.stringify({ id: p.id, token: Y.tvToken || null, relay: !!Y.tvRelay }));
    wake(); linkState();
  }
  // ——— v6: качество картинки на ТВ. «Авто» за первые 3–5 с меряет кадры и, если их меньше 24 в секунду, сразу снижает ступень
  // (тени уже выключены → простые шейдеры → меньше буфер и реже трава → 2D). Найденная ступень хранится 36 ч (dp.tvq).
  // Вручную: кнопка «⚙️ Качество» на экране ТВ (пульт: стрелки + OK) или в телефоне: ☰ → 📺 ТВ. ———
  const SC = DP.Scene, P = SC.PERF, MODES = { auto: 'Авто', smooth: 'Плавно', pretty: 'Красиво' };
  const tvLadder = () => !!P.tvL;
  window.dpTvQ = { get level() { return P.tvLevel; }, get mode() { return P.tvMode || 'auto'; }, set: (m) => setMode(m), log: [] };
  function qLabel() { const b = $('#tvq'); if (b) b.textContent = '⚙️ Качество: ' + (MODES[P.tvMode] || 'Авто'); }
  function rebuildScene() {
    if (scene) scene.destroy(); const c = $('#park'), nc = c.cloneNode(false); c.parentNode.replaceChild(nc, c);
    shownView = null; makeScene(); scene.resize(); if (park) render(park);
  }
  function setLevel(lvl) {
    const was2d = !scene || !scene.is3d;
    SC.applyTvLevel(P, { mode: P.tvMode || 'auto', lvl }, !!U.param('q'));
    window.dpTvQ.log.push({ lvl, t: Math.round(performance.now()) });
    if (P.render2d || was2d || !scene.retune) rebuildScene();
    else { scene.retune(); shownView = null; if (park) render(park); }
  }
  function setMode(mode) {
    if (!MODES[mode]) return;
    if (!tvLadder()) SC.applyTvLevel(P, SC.tvqPick('auto')); // компьютер с открытым tv.html: включаем ступени ТВ по запросу
    const lvl = mode === 'pretty' ? 0 : mode === 'smooth' ? 2 : 1;
    P.tvMode = mode; SC.tvqSave(mode, mode === 'auto' ? null : lvl);
    if (lvl !== P.tvLevel || (mode !== 'auto' && P.render2d)) setLevel(lvl);
    qLabel(); announce('⚙️ Качество: ' + MODES[mode] + (mode === 'auto' ? ' — подберём под телевизор' : ''));
    watchFps();
  }
  let watchIv = null;
  function watchFps() {
    clearInterval(watchIv); watchIv = null;
    if (!scene || U.param('r') || U.param('q')) return;
    if (!tvLadder()) return watchFpsOld();
    if (P.tvMode !== 'auto') return;
    // замер: ждём 3 кадра (компиляция шейдеров), затем окно 3 с; потом — окна по 10 с (долгая проверка)
    let f0 = -1, t0 = 0, probe = true, slow = 0, prev = null, wait = 0, no2d = SC.tvqLoad().no2d; // prev: {lvl, fps} — с какой ступени и с каким результатом ушли
    watchIv = setInterval(() => {
      if (!scene) return;
      const f = scene.frames || 0, now = performance.now();
      if (document.hidden) { f0 = -1; return; }
      if (f0 < 0) { f0 = f; t0 = now; wait = f + 3; return; }
      if (wait) { if (f < wait) { f0 = f; t0 = now; return; } wait = 0; f0 = f; t0 = now; return; } // первые кадры после смены — компиляция шейдеров, не считаем
      const el = now - t0; if (el < (probe ? 3000 : 10000)) return;
      const fps = (f - f0) * 1000 / el; f0 = f; t0 = now;
      const lvl = P.tvLevel, last = SC.TVQ.length - (no2d ? 2 : 1);
      let next = lvl;
      // 2D-картинка нагружает процессор, а не видеокарту: если на этом ТВ она вышла не быстрее лёгкого 3D — возвращаемся и остаёмся
      if (probe && P.render2d && prev && fps <= prev.fps * 1.15) {
        probe = false; f0 = -1; no2d = true; SC.tvqSave('auto', prev.lvl, true); const back = prev.lvl; prev = null; setLevel(back);
        announce('🖼️ Оставили лёгкую 3D-графику'); return;
      }
      if (probe) {
        if (fps < 24 && lvl < last) next = Math.min(last, lvl + (fps < 12 ? 2 : 1));
        if (SC.TVQ[next].r2d && fps >= 15) next = Math.max(lvl, next - 1); // 2D — только если и самая лёгкая 3D-ступень совсем не тянет
        if (next === lvl) probe = false;
      } else {
        slow = fps < 18 ? slow + 1 : 0;
        if (slow >= 2 && lvl < last && (lvl < last - 1 || fps < 12)) next = lvl + 1;
      }
      if (next !== lvl) {
        slow = 0; probe = true; f0 = -1; prev = { lvl, fps };
        SC.tvqSave('auto', next, no2d); setLevel(next);
        announce(SC.TVQ[next].r2d ? '🖼️ Включена лёгкая графика для этого телевизора' : '🖼️ Графика упрощена для плавности');
      }
    }, 500);
  }
  // компьютер/планшет с tv.html (без ступеней ТВ): прежний мягкий откат v5
  function watchFpsOld() {
    if (!scene.is3d) return;
    let f0 = scene.frames || 0, t0 = Date.now(), bad = 0, worst = 0;
    const warm = Date.now() + 10000;
    watchIv = setInterval(() => {
      if (!scene || !scene.is3d) { clearInterval(watchIv); return; }
      const fps = ((scene.frames || 0) - f0) * 1000 / (Date.now() - t0); f0 = scene.frames || 0; t0 = Date.now();
      if (document.hidden || Date.now() < warm) { bad = 0; worst = 0; return; }
      bad = fps < 12 && (scene._rs || 1) <= 0.6 ? bad + 1 : 0;
      worst = fps < 4 ? worst + 1 : 0;
      if (bad >= 5 || worst >= 3) {
        clearInterval(watchIv);
        const next = P.quality === 'high' ? 'mid' : P.quality === 'mid' ? 'low' : null;
        try { localStorage.setItem('dp.perf', JSON.stringify(next ? { v: 5, q: next, t: Date.now() } : { v: 5, q: 'low', r: '2d', t: Date.now() })); } catch (e) { /* ignore */ }
        if (next) P.quality = next; else P.render2d = true;
        rebuildScene();
        announce(next ? '🖼️ Графика упрощена для плавности' : '🖼️ Включена лёгкая графика для этого телевизора');
        if (next) watchFpsOld();
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
    if (ev.type === 'tvq' && ev.mode) setMode(ev.mode); // качество выбрали на телефоне
    if (ev.type === 'travel' && ev.name) announce(`🧭 ${ev.name} отправился в «${locName(ev.to)}»`);
  });
  Y.on('deleted', () => { sessionStorage.removeItem('dp_tv'); location.href = 'tv.html'; });

  let joining = false;
  async function join(code) {
    if (joining) return;
    $('#err').textContent = '';
    code = String(code || '').replace(/[\uFF10-\uFF19]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 48)).replace(/\D/g, '');
    if (!/^\d{5}$/.test(code)) { $('#err').textContent = 'Нужно ввести 5 цифр'; return; }
    joining = true; $('#go').disabled = true; $('#err').textContent = '⏳ Подключаемся к телефону…';
    try { show(await Y.tvJoin(code, (t) => { $('#err').textContent = t; })); history.replaceState(null, '', 'tv.html'); }
    catch (e) {
      // разные причины — разные тексты: нет связи с ретранслятором / телефон не ответил / браузер ТВ не умеет шифрование
      const el = $('#err'); el.textContent = (e.kind === 'net' ? '📡 ' : e.kind === 'crypto' ? '🔒 ' : '⚠️ ') + e.message; el.dataset.kind = e.kind || 'code';
      if (e.kind !== 'crypto') { const b = document.createElement('button'); b.className = 'btn'; b.id = 'retry'; b.textContent = '🔄 Попробовать ещё раз'; b.style.marginTop = '10px'; b.onclick = () => join($('#code').value.trim()); el.appendChild(document.createElement('br')); el.appendChild(b); setTimeout(() => b.focus(), 50); }
    }
    finally { joining = false; $('#go').disabled = false; }
  }
  $('#go').onclick = () => join($('#code').value.trim());
  $('#code').onkeydown = (e) => { if (e.key === 'Enter' || e.keyCode === 13) join($('#code').value.trim()); };
  $('#code').oninput = () => { const v = $('#code').value.replace(/[\uFF10-\uFF19]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 48)).replace(/\D/g, '').slice(0, 5); if (v !== $('#code').value) $('#code').value = v; };
  $('#fs').onclick = () => U.toggleFullscreen();
  const order = ['auto', 'smooth', 'pretty'];
  $('#tvq').onclick = () => { const i = order.indexOf(P.tvMode || 'auto'); setMode(order[(i + 1) % order.length]); };
  // пульт: любая стрелка, когда ничего не выбрано, — фокус на кнопки (дальше стрелки ←/→ и OK)
  window.addEventListener('keydown', (e) => {
    if (!park) return; const k = e.key || '', a = document.activeElement, bar = $('#bar');
    if (/^Arrow/.test(k) || [37, 38, 39, 40].indexOf(e.keyCode) >= 0) {
      const bs = Array.prototype.slice.call(bar.querySelectorAll('button')), i = bs.indexOf(a);
      if (i < 0) { $('#tvq').focus(); e.preventDefault(); }
      else if (k === 'ArrowLeft' || e.keyCode === 37) { bs[(i + bs.length - 1) % bs.length].focus(); e.preventDefault(); }
      else if (k === 'ArrowRight' || e.keyCode === 39) { bs[(i + 1) % bs.length].focus(); e.preventDefault(); }
    }
  });
  $('#exit').onclick = () => { sessionStorage.removeItem('dp_tv'); if (Y.viewer) Y.viewer.forget(); location.href = 'tv.html'; };

  // скрываем кнопки, когда никто не трогает экран
  let wt = null;
  function wake() { $('#bar').classList.remove('fade'); $('#tvname').classList.remove('fade'); clearTimeout(wt); wt = setTimeout(() => { $('#bar').classList.add('fade'); $('#tvname').classList.add('fade'); }, 4000); }
  ['mousemove', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, () => { if (park) wake(); }));
  document.body.addEventListener('click', (e) => { if (!park || e.target.id !== 'park') return; wake(); const r = e.target.getBoundingClientRect(); const d = scene && scene.hitScreen(e.clientX - r.left, e.clientY - r.top); if (d) scene.jump(d.uid); });

  // экран ввода кода уже готов (даже если связь ещё устанавливается) — загрузчик tv.html больше не ждёт
  if (window.DPBOOT) window.DPBOOT.ready = true;
  $('#mode').textContent = '⏳ Проверяем связь…';
  const mode = await Y.connect();
  const relayOk = !!(DP.relay && DP.relay.supported());
  $('#mode').innerHTML = mode === 'server' ? '<span class="status-dot on"></span>Сервер подключён'
    : relayOk ? '<span class="status-dot on"></span>Связь с телефоном через интернет — без регистрации, зашифровано'
      : '<span class="status-dot"></span>Этот браузер не поддерживает защищённую связь — откройте сайт по https';

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
})().catch(function (e) { if (window.DPBOOT && window.DPBOOT.fail) window.DPBOOT.fail(e); else throw e; });
