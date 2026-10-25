/* Динопарк — общий UI: модальное окно-панель и общие экраны (новый парк, код и пароль, список парков). */
window.DP = window.DP || {};
(function () {
  const U = () => DP.util;
  let overlay, panel, onCloseCb = null;
  function ensure() {
    if (overlay) return;
    overlay = document.getElementById('overlay');
    if (!overlay) {
      overlay = document.createElement('div'); overlay.id = 'overlay'; overlay.className = 'overlay closed';
      overlay.innerHTML = '<div class="panel glass" id="panel" role="dialog" aria-modal="true"></div>';
      document.body.appendChild(overlay);
    }
    panel = overlay.querySelector('.panel');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) UI.close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && UI.isOpen()) UI.close(); });
  }
  const UI = {
    get panel() { ensure(); return panel; },
    isOpen() { ensure(); return !overlay.classList.contains('closed'); },
    /** Показать экран: html-строка, bind(panel) навешивает обработчики */
    show(html, bind, opts) {
      ensure(); opts = opts || {};
      panel.className = 'panel glass' + (opts.wide ? ' wide' : '');
      panel.innerHTML = html; panel.scrollTop = 0;
      overlay.classList.remove('closed');
      if (bind) bind(panel);
      const f = panel.querySelector('[autofocus]'); if (f && !('ontouchstart' in window)) setTimeout(() => f.focus(), 60);
    },
    close() {
      ensure(); if (overlay.classList.contains('closed')) return;
      overlay.classList.add('closed');
      const cb = onCloseCb; onCloseCb = null; if (cb) cb();
    },
    onClose(cb) { onCloseCb = cb; },
    head(title, opts) {
      opts = opts || {};
      return `<div class="panel-head">${opts.back ? '<button class="back-btn" data-back>← НАЗАД</button>' : ''}
        <div style="flex:1;min-width:0"><h2>${title}</h2>${opts.sub ? `<div class="sub">${opts.sub}</div>` : ''}</div>
        ${opts.extra || ''}${opts.noClose ? '' : '<button class="icon-btn" data-close title="Закрыть">✕</button>'}</div>`;
    },
    wire(p, handlers) {
      p.querySelectorAll('[data-close]').forEach(b => b.onclick = () => UI.close());
      p.querySelectorAll('[data-back]').forEach(b => b.onclick = () => (handlers && handlers.back ? handlers.back() : UI.close()));
    },
    parkThumb(park) { const v = park.view || park.bg; if (park.customBg && (park.customLoc === v || v === 'custom')) return park.customBg; return DP.BG.thumb(DP.BG.byId[v] ? v : (DP.BG.ALIAS && DP.BG.ALIAS[v]) || 'jungle'); },
    parkRows(parks, currentId, withDelete) {
      return parks.map(p => `<div class="park-row" data-open="${p.id}">
          <img src="${UI.parkThumb(p)}" alt="">
          <div class="info"><div class="nm">${U().esc(p.name)}</div><div class="cnt">${U().dinoCount((p.dinos || []).length)}</div></div>
          ${p.id === currentId ? '<span class="badge">● открыт</span>' : ''}
          ${withDelete ? `<button class="icon-btn" data-del="${p.id}" title="Удалить парк">🗑️</button>` : ''}
        </div>`).join('');
    },
    /** Экран «Новый парк» → «Код парка и пароль» → go(park) */
    newParkFlow(go, back) {
      UI.show(`${UI.head('Новый парк', { back: !!back, sub: 'Придумайте название — например, «Парк Маши» или «Динозавры 2Б»' })}
        <input class="field" id="np-name" placeholder="Парк" maxlength="40" autofocus>
        <div class="btn-row"><button class="btn" data-cancel>Отмена</button><button class="btn green" id="np-create">Создать</button></div>`, (p) => {
        UI.wire(p, { back });
        p.querySelector('[data-cancel]').onclick = () => (back ? back() : UI.close());
        const create = () => {
          const park = DP.store.create(p.querySelector('#np-name').value);
          if (DP.sync.mode === 'server') DP.sync.pushPark(park);
          UI.credsScreen(park, go);
        };
        p.querySelector('#np-create').onclick = create;
        p.querySelector('#np-name').onkeydown = (e) => { if (e.key === 'Enter') create(); };
      });
    },
    credsScreen(park, go) {
      UI.show(`${UI.head('Код парка и пароль', { sub: 'Сохраните их — по ним парк можно открыть на любом устройстве', noClose: true })}
        <div class="cred"><div class="grow"><div class="k">Код парка</div><div class="v">${park.id}</div></div><button class="icon-btn" data-copy="${park.id}" title="Копировать">📋</button></div>
        <div class="cred"><div class="grow"><div class="k">Пароль (PIN)</div><div class="v">${park.pin}</div></div><button class="icon-btn" data-copy="${park.pin}" title="Копировать">📋</button></div>
        <div class="note">💡 Пароль нужен, чтобы управлять парком. Для телевизора используется отдельный временный код из пяти цифр.</div>
        <div class="btn-row"><button class="btn green" id="cr-go">✓ Сохранить, поехали</button></div>`, (p) => {
        p.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => U().copy(b.dataset.copy).then(() => U().toast('Скопировано ✓')));
        p.querySelector('#cr-go').onclick = () => go(park);
      });
    }
  };
  DP.ui = UI;
})();
