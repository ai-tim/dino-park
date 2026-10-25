/* Динопарк — экран телевизора: ввод 5-значного кода → полноэкранный просмотр парка с живой синхронизацией. */
(async function () {
  const U = DP.util, Y = DP.sync, $ = (s) => document.querySelector(s);
  let scene = null, park = null;
  if (DP.music) DP.music.button('br');
  const mode = await Y.connect();
  $('#mode').innerHTML = mode === 'server' ? '<span class="status-dot on"></span>Сервер подключён' : '<span class="status-dot"></span>Локальный режим: код работает в этом же браузере';

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
  function show(p) {
    park = p;
    $('#join').classList.add('hidden'); $('#park').classList.remove('hidden'); $('#bar').classList.remove('hidden'); $('#tvname').classList.remove('hidden');
    if (!scene) { scene = DP.makeScene($('#park'), { entrance: false, tod: U.param('tod') || 'auto', showNeeds: false, needHint: true }); window.dpScene = scene; }
    scene.resize(); render(p); scene.opts.entrance = true;
    sessionStorage.setItem('dp_tv', JSON.stringify({ id: p.id, token: Y.tvToken || null }));
    wake();
  }
  Y.on('park', (p) => { if (park && p.id === park.id) { const prev = park.view; park = p; render(p); if (p.view !== prev) announce('🧭 Путешествие: ' + locName(p.view)); } });
  Y.on('event', (ev) => {
    if (!scene || !ev) return;
    if (ev.type === 'feed') { scene.dropFood(ev.items || []); if (ev.all) announce('🍖 Обед! Все динозавры — к еде!'); } // тайный корм — без объявления
    if (ev.type === 'jump') scene.jump(ev.uid, ev.text);
    if (ev.type === 'play') scene.play(ev.uid, ev.u);
    if (ev.type === 'travel' && ev.name) announce(`🧭 ${ev.name} отправился в «${locName(ev.to)}»`);
  });
  Y.on('deleted', () => { sessionStorage.removeItem('dp_tv'); location.href = 'tv.html'; });

  async function join(code) {
    $('#err').textContent = '';
    if (!/^\d{5}$/.test(code)) { $('#err').textContent = 'Нужно ввести 5 цифр'; return; }
    try { show(await Y.tvJoin(code)); history.replaceState(null, '', 'tv.html'); }
    catch (e) { $('#err').textContent = '⚠️ ' + e.message; }
  }
  $('#go').onclick = () => join($('#code').value.trim());
  $('#code').onkeydown = (e) => { if (e.key === 'Enter') join($('#code').value.trim()); };
  $('#fs').onclick = () => U.toggleFullscreen();
  $('#exit').onclick = () => { sessionStorage.removeItem('dp_tv'); location.href = 'tv.html'; };

  // скрываем кнопки, когда никто не трогает экран
  let wt = null;
  function wake() { $('#bar').classList.remove('fade'); $('#tvname').classList.remove('fade'); clearTimeout(wt); wt = setTimeout(() => { $('#bar').classList.add('fade'); $('#tvname').classList.add('fade'); }, 4000); }
  ['mousemove', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, () => { if (park) wake(); }));
  $('#park').addEventListener('click', (e) => { wake(); const d = scene && scene.hitScreen(e.offsetX, e.offsetY); if (d) scene.jump(d.uid); });

  const code = U.param('code');
  if (code) { $('#code').value = code; join(code); }
  else {
    try { const saved = JSON.parse(sessionStorage.getItem('dp_tv') || 'null'); if (saved) { const p = await Y.tvWatch(saved.id, saved.token); if (p) show(p); } } catch (e) { /* ignore */ }
  }
})();
