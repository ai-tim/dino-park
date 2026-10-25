/* Динопарк — служебная страница подарков: ключ ECDSA P-256 в localStorage, подписанные коды DP1, выдача через сервер.
 * Copyright (c) 2026 Юрий Власенко. Все права защищены. */
'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const KEY = 'dp_admin_key';
  const enc = (bytes) => { let s = ''; bytes = new Uint8Array(bytes); for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const utf8 = (s) => new TextEncoder().encode(s);
  const cfgPub = () => (window.DP_CONFIG || {}).ADMIN_PUBLIC_KEY || null;
  const pubOf = (jwk) => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
  const stored = () => { try { const k = JSON.parse(localStorage.getItem(KEY) || 'null'); return k && k.d ? k : null; } catch (e) { return null; } };

  function status() {
    const k = stored(), c = cfgPub(), st = $('#key-st');
    if (!k) { st.innerHTML = '<span class="warn">Ключа в этом браузере нет.</span> Импортируй сохранённый закрытый ключ или создай новый.'; $('#key-pub-wrap').hidden = true; return; }
    const match = c && c.x === k.x && c.y === k.y;
    st.innerHTML = match ? '<span class="ok">✓ Ключ есть и совпадает с открытым ключом в config.js — коды будут приниматься.</span>'
      : '<span class="bad">⚠ Ключ есть, но НЕ совпадает с config.js.</span> Вставь открытый ключ ниже в js/config.js и опубликуй сайт.';
    $('#key-pub-wrap').hidden = false; $('#key-pub').textContent = JSON.stringify(pubOf(k));
  }
  async function importPriv(jwk) {
    return crypto.subtle.importKey('jwk', Object.assign({}, jwk, { ext: true, key_ops: ['sign'] }), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  $('#key-gen').onclick = async () => {
    if (stored() && !confirm('Заменить текущий ключ? Старые коды перестанут работать, если поменять ключ в config.js.')) return;
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    localStorage.setItem(KEY, JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d })); status();
  };
  $('#key-import').onclick = async () => {
    try {
      const raw = $('#key-in').value.trim(); const j = JSON.parse(raw);
      if (j.kty !== 'EC' || j.crv !== 'P-256' || !j.d) throw new Error('Нужен закрытый ключ EC P-256 (с полем d)');
      await importPriv(j);
      localStorage.setItem(KEY, JSON.stringify({ kty: j.kty, crv: j.crv, x: j.x, y: j.y, d: j.d }));
      $('#key-in').value = ''; status();
    } catch (e) { alert('Не получилось: ' + e.message); }
  };
  $('#key-export').onclick = () => {
    const k = stored(); if (!k) return alert('Ключа нет');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(k)], { type: 'application/json' }));
    a.download = 'dinopark-admin-key.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#key-forget').onclick = () => { if (confirm('Удалить ключ из этого браузера? Без резервной копии новые коды сделать не получится.')) { localStorage.removeItem(KEY); status(); } };

  // ——— форма подарка ———
  const kindSel = $('#g-kind');
  const showKind = () => document.querySelectorAll('[data-for]').forEach(el => { el.hidden = el.dataset.for !== kindSel.value; });
  kindSel.onchange = showKind; showKind();
  function gift() {
    const k = kindSel.value;
    if (k === 'eggs') { const q = Math.round(Number($('#g-q').value)); if (!(q >= 1 && q <= 50)) throw new Error('Яиц: от 1 до 50'); return { k, r: $('#g-r').value, q }; }
    if (k === 'hat') return { k, h: $('#g-h').value };
    if (k === 'item') { const e = $('#g-e').value.trim().slice(0, 8), t = $('#g-t').value.trim().slice(0, 40); if (!e || !t) throw new Error('Нужны эмодзи и название'); return { k, e, t }; }
    return { k: 'legend' };
  }
  async function sign(payload) {
    const k = stored(); if (!k) throw new Error('Сначала добавь ключ');
    const key = await importPriv(k);
    const body = 'DP1.' + enc(utf8(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(body));
    return body + '.' + enc(sig);
  }
  const nonce = () => { const b = new Uint8Array(12); crypto.getRandomValues(b); return enc(b); };
  const parkUrl = (code) => new URL('park.html?gift=' + encodeURIComponent(code), location.href).toString();
  let links = [];
  $('#g-make').onclick = async () => {
    const out = $('#g-out'); out.textContent = '';
    try {
      const g = gift(), msg = $('#g-msg').value.trim().slice(0, 140), park = $('#g-park').value.trim().toLowerCase();
      if (park && !/^[a-z0-9]{6,16}$/.test(park)) throw new Error('Код парка: 6–16 латинских букв и цифр');
      const days = Math.max(0, Math.min(365, Number($('#g-days').value) || 0)), n = Math.max(1, Math.min(50, Math.round(Number($('#g-n').value) || 1)));
      links = [];
      for (let i = 0; i < n; i++) {
        const p = { n: nonce(), g }; if (msg) p.m = msg; if (park) p.p = park; if (days) p.e = Date.now() + days * 864e5;
        const code = await sign(p); links.push(parkUrl(code));
        const div = document.createElement('div'); div.className = 'code'; div.innerHTML = `<b>Код ${i + 1}</b><br>`;
        const c = document.createElement('div'); c.textContent = code; div.appendChild(c);
        const l = document.createElement('a'); l.href = parkUrl(code); l.textContent = '🔗 ссылка для игрока'; l.target = '_blank'; l.rel = 'noopener'; div.appendChild(l);
        out.appendChild(div);
      }
      $('#g-copy').hidden = false;
    } catch (e) { out.innerHTML = `<div class="st bad">${String(e.message).replace(/</g, '&lt;')}</div>`; }
  };
  $('#g-copy').onclick = async () => { try { await navigator.clipboard.writeText(links.join('\n')); $('#g-copy').textContent = '✓ Скопировано'; } catch (e) { prompt('Скопируй:', links.join('\n')); } };

  // ——— через сервер ———
  $('#s-url').value = sessionStorage.getItem('dp_admin_srv') || (location.protocol.startsWith('http') && !/github\.io$/.test(location.hostname) ? location.origin : '');
  $('#s-send').onclick = async () => {
    const msgEl = $('#s-msg'); msgEl.textContent = '…';
    try {
      const url = $('#s-url').value.trim().replace(/\/+$/, ''), token = $('#s-token').value.trim();
      if (!/^https?:\/\//.test(url)) throw new Error('Укажи адрес сервера');
      if (token.length < 8) throw new Error('Укажи ADMIN_TOKEN');
      sessionStorage.setItem('dp_admin_srv', url);
      const list = $('#s-parks').value.trim(), body = { gift: gift(), msg: $('#g-msg').value.trim().slice(0, 140) };
      if (list === '*') body.all = true; else body.parks = list.split(/[\s,;]+/).filter(Boolean).map(s => s.toLowerCase());
      if (!body.all && !body.parks.length) throw new Error('Укажи коды парков');
      const r = await fetch(url + '/api/admin/gift', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 401 ? 'Неверный токен' : r.status === 429 ? 'Слишком много попыток, подожди' : r.status === 404 ? 'На сервере не включён ADMIN_TOKEN' : (j.error || 'Ошибка ' + r.status));
      msgEl.innerHTML = `<span class="ok">✓ Выдано: ${j.given}</span>${j.missing ? ` · не найдено парков: ${j.missing}` : ''}`;
    } catch (e) { msgEl.innerHTML = `<span class="bad">${String(e.message).replace(/</g, '&lt;')}</span>`; }
  };
  status();
})();
