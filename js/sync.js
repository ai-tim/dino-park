/* Динопарк — синхронизация.
 * Режим "server": WebSocket к Node-серверу (server/server.js) по адресу /ws — работает между устройствами.
 * Режим "local": localStorage + BroadcastChannel — между вкладками/окнами одного браузера.
 * Клиент сам пробует сервер и при его отсутствии переключается на локальный режим.
 */
window.DP = window.DP || {};
(function () {
  const S = () => DP.store;
  let ws = null, mode = 'local', rid = 0, sub = null, connecting = null;
  const pending = {}, handlers = { park: [], event: [], status: [], error: [], deleted: [] };
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('dinopark') : null;

  function emit(t, d) { (handlers[t] || []).forEach(fn => { try { fn(d); } catch (e) { console.error(e); } }); }
  function on(t, fn) { handlers[t].push(fn); }

  if (bc) bc.onmessage = (e) => {
    const m = e.data || {};
    if (!sub || m.id !== sub.id) return;
    if (m.t === 'park') { S().save(m.park, true); emit('park', m.park); }
    if (m.t === 'event') emit('event', m.ev);
    if (m.t === 'deleted') emit('deleted', m.id);
  };
  // резерв: событие storage (если нет BroadcastChannel)
  window.addEventListener('storage', (e) => {
    if (bc || !sub || e.key !== 'dp_park_' + sub.id || !e.newValue) return;
    try { emit('park', JSON.parse(e.newValue)); } catch (er) { /* ignore */ }
  });

  function handle(m) {
    if (m.rid && pending[m.rid]) { const p = pending[m.rid]; delete pending[m.rid]; m.t === 'error' ? p.rej(new Error(m.msg || 'Ошибка')) : p.res(m); return; }
    if (m.t === 'park' && sub && m.park && m.park.id === sub.id) {
      const local = S().get(sub.id);
      // эхо своего сохранения: принимаем, только если на устройстве нет более свежих правок
      if (m.self && local && (m.park.updated || 0) < (local.updated || 0)) return;
      if (sub.pin) { m.park.pin = sub.pin; S().save(m.park, true); }
      emit('park', m.park);
    }
    if (m.t === 'event' && sub && m.id === sub.id) emit('event', m.ev);
    if (m.t === 'deleted' && sub && m.id === sub.id) emit('deleted', m.id);
    if (m.t === 'error' && !m.rid) emit('error', m);
  }
  function send(m) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; }
  function request(m, timeout) {
    return new Promise((res, rej) => {
      m.rid = ++rid; pending[m.rid] = { res, rej };
      if (!send(m)) { delete pending[m.rid]; return rej(new Error('Нет связи с сервером')); }
      setTimeout(() => { if (pending[m.rid]) { delete pending[m.rid]; rej(new Error('Сервер не ответил')); } }, timeout || 8000);
    });
  }

  function connect() {
    if (connecting) return connecting;
    connecting = new Promise((resolve) => {
      const cfg = window.DP_CONFIG || {};
      if (!cfg.wsUrl || !window.WebSocket || (cfg.wsUrl[0] === '/' && !/^https?:$/.test(location.protocol))) { mode = 'local'; return resolve(mode); }
      const wsUrl = cfg.wsUrl[0] === '/' ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + cfg.wsUrl : cfg.wsUrl;
      let done = false;
      const finish = (m) => { if (done) return; done = true; mode = m; emit('status', mode); resolve(mode); };
      try { ws = new WebSocket(wsUrl); }
      catch (e) { return finish('local'); }
      const to = setTimeout(() => { try { ws.close(); } catch (e) { /* ignore */ } ws = null; finish('local'); }, 3000);
      ws.onopen = () => { clearTimeout(to); finish('server'); };
      ws.onerror = () => { clearTimeout(to); if (!done) { ws = null; finish('local'); } };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (er) { return; } handle(m); };
      ws.onclose = () => {
        if (!done) return;
        ws = null; emit('status', 'reconnecting');
        setTimeout(() => { connecting = null; connect().then(md => { if (md === 'server' && sub) resubscribe(); }); }, 2500);
      };
    });
    return connecting;
  }
  function resubscribe() {
    if (!sub) return;
    if (sub.tv) send({ t: 'tvwatch', id: sub.id, token: sub.token });
    else { const p = S().get(sub.id); send({ t: 'sub', id: sub.id, pin: sub.pin, park: p }); }
  }

  const API = {
    on, connect,
    get mode() { return mode; },
    /** Открыть парк по id+PIN (с сервера или из localStorage) */
    async openPark(id, pin) {
      id = (id || '').trim().toLowerCase(); pin = (pin || '').trim();
      if (mode === 'server') {
        try { const r = await request({ t: 'open', id, pin }); r.park.pin = pin; S().save(r.park, true); S().addMine(id); return r.park; }
        catch (e) { const lp = S().get(id); if (lp && lp.pin === pin) return lp; throw e; }
      }
      const p = S().get(id);
      if (!p) throw new Error('Парк с таким кодом не найден на этом устройстве. Для открытия с другого устройства запустите сервер (см. README).');
      if (p.pin !== pin) throw new Error('Неверный пароль');
      S().addMine(id); return p;
    },
    /** Подписаться на изменения парка (пульт/телефон) */
    subscribe(park) {
      sub = { id: park.id, pin: park.pin };
      if (mode === 'server') send({ t: 'sub', id: park.id, pin: park.pin, park });
    },
    pushPark(park) {
      S().save(park);
      if (bc) bc.postMessage({ t: 'park', id: park.id, park });
      if (mode === 'server') send({ t: 'update', id: park.id, pin: park.pin, park });
    },
    sendEvent(park, ev) {
      if (bc) bc.postMessage({ t: 'event', id: park.id, ev });
      if (mode === 'server') send({ t: 'event', id: park.id, pin: park.pin, ev });
    },
    async deletePark(park) {
      if (mode === 'server') await request({ t: 'delete', id: park.id, pin: park.pin });
      if (bc) bc.postMessage({ t: 'deleted', id: park.id });
    },
    /** Сменить пароль (нужен текущий) */
    async setPin(park, oldPin, newPin) {
      if (!/^\d{4,12}$/.test(String(newPin || ''))) throw new Error('Новый пароль: от 4 до 12 цифр');
      if (String(oldPin) !== String(park.pin)) throw new Error('Неверный текущий пароль');
      if (mode === 'server') await request({ t: 'setpin', id: park.id, pin: String(oldPin), newPin: String(newPin) });
      park.pin = String(newPin); if (sub && sub.id === park.id) sub.pin = park.pin;
      S().save(park, true);
    },
    /** Временный 5-значный код для ТВ (5 минут) */
    async tvCode(park) {
      if (mode === 'server') { try { const r = await request({ t: 'tvcode', id: park.id, pin: park.pin }); return { code: r.code, exp: r.exp, server: true }; } catch (e) { console.warn(e); } }
      const code = DP.util.code5(), exp = Date.now() + 5 * 60 * 1000;
      S().setTvCode(code, park.id, exp); return { code, exp, server: false };
    },
    /** ТВ: войти по 5-значному коду, получить парк и подписаться только на чтение */
    async tvJoin(code) {
      code = String(code || '').trim();
      if (mode === 'server') {
        try { const r = await request({ t: 'tvjoin', code }); sub = { id: r.park.id, tv: true, token: r.token }; API.tvToken = r.token; return r.park; }
        catch (e) { if (!/не найден|истёк/i.test(e.message)) throw e; /* пробуем локально */ var serr = e; }
      }
      const all = S().tvCodes(), rec = all[code];
      if (!rec || rec.exp < Date.now()) throw (serr || new Error('Код не найден или истёк. Получите новый код в меню «Открыть на другом экране».'));
      const p = S().get(rec.id); if (!p) throw new Error('Парк не найден');
      sub = { id: p.id, tv: true }; API.tvToken = null; return p;
    },
    /** ТВ: после перезагрузки страницы — следить за парком по id (без PIN) */
    tvWatch(id, token) {
      sub = { id, tv: true, token };
      if (mode === 'server' && token) return request({ t: 'tvwatch', id, token }).then(r => r.park).catch(() => S().get(id));
      return Promise.resolve(S().get(id));
    }
  };
  DP.sync = API;
})();
