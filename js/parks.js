/* Динопарк — «Мои парки»: список парков, создание, открытие по коду и паролю. */
(async function () {
  const U = DP.util, S = DP.store, Y = DP.sync, UI = DP.ui, $ = (s) => document.querySelector(s);
  // живой фон с демо-динозаврами
  const scene = new DP.Scene($('#bgscene'), { entrance: false });
  scene.setTimeOfDay('day'); scene.setBackground('jungle');
  scene.setDinos([
    { uid: 'd1', species: 'trex', palette: 0 }, { uid: 'd2', species: 'triceratops', palette: 0 }, { uid: 'd3', species: 'brachiosaurus', palette: 0 },
    { uid: 'd4', species: 'pterodactyl', palette: 0 }, { uid: 'd5', species: 'plesiosaur', palette: 0 }, { uid: 'd6', species: 'stegosaurus', palette: 0 }
  ]);

  const goPark = (p) => { location.href = 'park.html?id=' + p.id; };
  function renderList() {
    const list = S.myParks();
    $('#my-parks').innerHTML = list.length ? UI.parkRows(list, null, false)
      : '<div class="empty"><div class="big">🥚</div>Пока ни одного парка. Создай первый — это займёт пару секунд.</div>';
    document.querySelectorAll('#my-parks [data-open]').forEach(r => r.onclick = () => goPark({ id: r.dataset.open }));
  }
  renderList();
  $('#new-park').onclick = () => UI.newParkFlow(goPark);

  const mode = await Y.connect();
  $('#mode-note').innerHTML = mode === 'server'
    ? '<span class="status-dot on"></span>Сервер подключён — парк можно открыть с любого устройства.'
    : '<span class="status-dot"></span>Локальный режим: парки хранятся в этом браузере. Для открытия с других устройств запустите сервер (см. README).';

  async function openByCode() {
    const id = $('#open-id').value, pin = $('#open-pin').value;
    if (!id.trim() || !pin.trim()) return U.toast('Введите код парка и пароль');
    try { const p = await Y.openPark(id, pin); goPark(p); }
    catch (e) { U.toast('⚠️ ' + e.message, 4500); }
  }
  if (U.param('code')) { $('#open-id').value = U.param('code'); $('#open-pin').focus(); }
  if (DP.music) DP.music.button('bl');
  $('#open-btn').onclick = openByCode;
  $('#open-pin').onkeydown = (e) => { if (e.key === 'Enter') openByCode(); };
})();
