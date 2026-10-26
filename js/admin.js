/* Динопарк — служебная страница подарков: ключ ECDSA P-256 в localStorage; короткие коды DINO-XXXX-XXXX, подарки «всем»
 * и «сюрприз парку» через подписанную ленту (js/gifts.js: MQTT retained + gifts/feed.json через GitHub API); длинные коды DP1.
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

  // ——— предупреждения: встроенный браузер мессенджера (там нет ключа из Safari), нет ключа, ключ не тот ———
  const UA = navigator.userAgent;
  const IOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IN_APP = /Telegram|MAX\/|MaxMessenger|OneMe|FBAN|FBAV|Instagram|\bLine\/|VKClient|vkontakte|OKApp|WhatsApp|YaApp|GSA\/|; wv\)/i.test(UA) || (IOS && !/Safari\//.test(UA));
  const OTHER_IOS = IOS && /CriOS|FxiOS|EdgiOS|YaBrowser|OPiOS/.test(UA);
  const keyState = () => { const k = stored(), c = cfgPub(); return !k ? 'none' : (c && c.x === k.x && c.y === k.y ? 'ok' : 'bad'); };
  function warnings() {
    const w = [], ks = keyState();
    if (IN_APP) w.push(['bad', '⚠️ Страница открыта внутри приложения (Telegram, MAX или другого). Здесь нет твоего ключа, и подарки отсюда не сработают.<br>Нажми <b>⋯</b> или <b>⤴</b> → <b>«Открыть в Safari»</b> — настоящий ключ там.']);
    else if (OTHER_IOS) w.push(['warn', '⚠️ Это не Safari. Если ключ ты сохранял в Safari — открой страницу в Safari, ключ там.']);
    if (ks === 'none') w.push(['warn', '🔑 В этом браузере нет ключа. ' + (IOS ? 'Обычно подарки делаются в <b>Safari</b> — открой эту страницу там.' : 'Открой браузер, где ключ сохранён, или импортируй копию ключа в «🔑 Ключ».')]);
    if (ks === 'bad') w.push(['bad', '⛔ Ключ в этом браузере <b>не совпадает</b> с игрой — подарки не сработают. ' + (IOS ? 'Открой страницу в <b>Safari</b>, где настоящий ключ.' : 'Открой браузер с настоящим ключом.')]);
    $('#warn').innerHTML = w.map(([c, t]) => `<div class="banner ${c}">${t}</div>`).join('');
  }
  function status() {
    warnings();
    const k = stored(), c = cfgPub(), st = $('#key-st');
    if (!k) { st.innerHTML = '<span class="warn">Ключа в этом браузере нет.</span> Импортируй сохранённый закрытый ключ или создай новый.'; $('#key-pub-wrap').hidden = true; return; }
    const match = c && c.x === k.x && c.y === k.y;
    st.innerHTML = match ? '<span class="ok">✅ Ключ совпадает с игрой — коды будут приниматься.</span>'
      : '<span class="bad">⚠ Ключ есть, но НЕ совпадает с config.js.</span> Вставь открытый ключ ниже в js/config.js и опубликуй сайт.';
    $('#key-pub-wrap').hidden = false; $('#key-pub').textContent = JSON.stringify(pubOf(k));
  }
  async function importPriv(jwk) {
    return crypto.subtle.importKey('jwk', Object.assign({}, jwk, { ext: true, key_ops: ['sign'] }), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  $('#key-gen').onclick = async () => {
    if (!confirm(stored() ? 'Создать НОВЫЙ ключ вместо текущего?\n\nВсе старые коды и подарки перестанут работать, когда новый ключ попадёт в игру. Обычно это не нужно.' : 'Создать новый ключ? Его открытую часть нужно будет вставить в js/config.js.')) return;
    if (stored() && !confirm('Точно заменить ключ? Отменить это нельзя (если нет копии).')) return;
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
  // ——— сохранение/копирование ключа (iPhone Safari не умеет a.download → «Поделиться» / буфер обмена) ———
  function toast(msg, ms) {
    let t = document.getElementById('adm-toast');
    if (!t) { t = document.createElement('div'); t.id = 'adm-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms || 3000);
  }
  // Копирование синхронно внутри жеста: сначала clipboard API, при отказе — скрытая textarea + execCommand('copy').
  function copyText(text, okMsg) {
    const legacy = () => {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
      document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
      let done = false; try { done = document.execCommand('copy'); } catch (e) { done = false; }
      ta.remove(); return done;
    };
    const fail = () => { prompt('Скопируй вручную:', text); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast(okMsg), () => { if (legacy()) toast(okMsg); else fail(); });
    } else if (legacy()) toast(okMsg); else fail();
  }
  $('#key-export').onclick = () => {
    const k = stored(); if (!k) return alert('Ключа нет');
    const json = JSON.stringify(k), name = 'dinopark-admin-key.json';
    let file = null; try { file = new File([json], name, { type: 'application/json' }); } catch (e) { file = null; }
    // navigator.share вызывается синхронно, без await перед ним — иначе Safari потеряет жест пользователя.
    if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Ключ Динопарка' })
        .then(() => toast('Сохранено — выбери «Сохранить в Файлы» или Заметки'))
        .catch((e) => { if (!e || e.name !== 'AbortError') toast('Не получилось поделиться — скопируй ключ кнопкой ниже', 4000); });
      return;
    }
    const a = document.createElement('a');
    if ('download' in a && !/iP(hone|ad|od)/.test(navigator.userAgent)) {
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } else {
      const u = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const w = window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000);
      if (!w) copyText(json, 'Скопировано — вставь в Заметки и закрепи');
    }
  };
  $('#key-copy').onclick = () => {
    const k = stored(); if (!k) return alert('Ключа нет');
    copyText(JSON.stringify(k), 'Скопировано — вставь в Заметки и закрепи');
  };
  $('#key-pub-copy').onclick = () => {
    const k = stored(); if (!k) return alert('Ключа нет');
    copyText(JSON.stringify(pubOf(k)), 'Открытый ключ скопирован — его можно отправить');
  };
  $('#key-forget').onclick = () => { if (confirm('Удалить ключ из этого браузера? Без резервной копии новые подарки сделать не получится.') && confirm('Точно удалить? Сначала сохрани копию ключа.')) { localStorage.removeItem(KEY); status(); } };

  // ——— форма подарка ———
  const kindSel = $('#g-kind');
  const showKind = () => document.querySelectorAll('[data-for]').forEach(el => { el.hidden = el.dataset.for !== kindSel.value; });
  kindSel.onchange = showKind; showKind();
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function gift() {
    const k = kindSel.value;
    if (k === 'eggs') { const q = Math.round(Number($('#g-q').value)); if (!(q >= 1 && q <= 50)) throw new Error('Яиц: от 1 до 50'); return { k, r: $('#g-r').value, q }; }
    if (k === 'hat') return { k, h: $('#g-h').value };
    if (k === 'item') { const e = $('#g-e').value.trim().slice(0, 8), t = $('#g-t').value.trim().slice(0, 40); if (!e || !t) throw new Error('Нужны эмодзи и название'); return { k, e, t }; }
    return { k: 'legend' };
  }
  const R_NAME = { common: 'обычных 🥚', rare: 'редких 💎', epic: 'очень редких 🔮', legend: 'легендарных 🌟' };
  const giftText = (g) => g.k === 'eggs' ? `${g.q} ${R_NAME[g.r] || ''} яиц` : g.k === 'hat' ? 'шапка ' + (($('#g-h option[value="' + g.h + '"]') || {}).textContent || g.h) : g.k === 'item' ? g.e + ' ' + g.t : '🌟 легендарный динозавр';
  async function sign(payload) {
    const k = stored(); if (!k) throw new Error('Сначала добавь ключ');
    const key = await importPriv(k);
    const body = 'DP1.' + enc(utf8(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(body));
    return body + '.' + enc(sig);
  }
  const parkUrl = (code) => new URL('park.html?gift=' + encodeURIComponent(code), location.href).toString();
  function common() {
    const ks = keyState();
    if (ks === 'none') throw new Error('В этом браузере нет ключа — ' + (IOS ? 'открой страницу в Safari' : 'импортируй ключ в «🔑 Ключ»'));
    if (ks === 'bad') throw new Error('Ключ не совпадает с игрой — ' + (IOS ? 'открой страницу в Safari' : 'открой браузер с настоящим ключом'));
    const g = gift(), m = $('#g-msg').value.trim().slice(0, 140), days = Math.max(0, Math.min(365, Number($('#g-days').value) || 0));
    const base = { v: 1, g, ts: Date.now() }; if (m) base.m = m; if (days) base.e = Date.now() + days * 864e5;
    return base;
  }
  const sentKey = 'dp_admin_sent';
  const sentLocal = () => { try { return JSON.parse(localStorage.getItem(sentKey) || '[]'); } catch (e) { return []; } };
  const remember = (items) => { const l = sentLocal().concat(items); localStorage.setItem(sentKey, JSON.stringify(l.slice(-300))); };
  // ——— публикация: брокеры MQTT (сразу) + GitHub (надёжно) ———
  const ghCfg = () => { try { return JSON.parse(localStorage.getItem('dp_admin_gh') || 'null'); } catch (e) { return null; } };
  async function publish(entries, ids, note) {
    const res = { mqtt: null, gh: null, ghErr: null };
    const jobs = [];
    jobs.push((async () => { let n = 0, of = 0; for (let i = 0; i < entries.length; i++) { const r = await DP.Gifts.publishMqtt(entries[i], ids[i]); n = Math.max(n, r.n); of = r.of; } res.mqtt = { n, of }; })().catch((e) => { res.mqtt = { n: 0, of: 0, err: e.message }; }));
    const gh = ghCfg();
    if (gh && gh.token) jobs.push(DP.Gifts.ghPublish(gh.token, gh.repo, gh.branch, entries, note).then((r) => { res.gh = r; }, (e) => { res.ghErr = e.message; }));
    await Promise.all(jobs);
    return res;
  }
  function pubStatus(el, res) {
    const m = res.mqtt || { n: 0, of: 0 };
    const parts = [];
    parts.push(m.n ? `<span class="ok">📡 Отправлено на ${m.n} из ${m.of} серверов сообщений</span>` : '<span class="warn">📡 Серверы сообщений сейчас недоступны</span>');
    if (res.gh) parts.push('<span class="ok">☁️ Сохранено на GitHub — подарок не потеряется (на сайте появится за 1–2 минуты)</span>');
    else if (res.ghErr) parts.push(`<span class="bad">☁️ GitHub: ${esc(res.ghErr)}</span>`);
    else parts.push('<span class="warn">☁️ GitHub не настроен — подарок держится только на серверах сообщений, они могут его забыть. Настрой «☁️ Публикация» (2 минуты), и потом нажми «Опубликовать ещё раз».</span>');
    el.innerHTML = parts.join('<br>');
    if (!res.gh) { const b = document.createElement('button'); b.className = 'btn small ghost'; b.textContent = '🔁 Опубликовать ещё раз'; b.style.marginTop = '8px'; b.onclick = () => { el.textContent = '⏳ Публикуем…'; publish(el._entries, el._ids, 'Подарки: повторная публикация').then((r) => { pubStatus(el, r); listSent(); }); }; el.appendChild(document.createElement('br')); el.appendChild(b); }
  }
  let links = [];
  const out = $('#g-out');
  const fail = (e) => { out.innerHTML = `<div class="banner bad">${esc(e.message || e)}</div>`; };
  async function finish(card, entries, ids, note) {
    const st = document.createElement('div'); st.className = 'st'; st.textContent = '⏳ Публикуем…'; st._entries = entries; st._ids = ids; card.appendChild(st);
    const res = await publish(entries, ids, note); pubStatus(st, res); listSent();
    return res;
  }
  // выбор способа: большие кнопки раскрывают свои настройки
  const modes = { code: ['#b-code', '#opt-code'], park: ['#b-park', '#opt-park'] };
  const pick = (m) => Object.keys(modes).forEach((k) => { $(modes[k][0]).classList.toggle('on', k === m); $(modes[k][1]).hidden = k !== m; });
  $('#b-code').onclick = () => pick($('#opt-code').hidden ? 'code' : null);
  $('#b-park').onclick = () => pick($('#opt-park').hidden ? 'park' : null);
  const useSel = () => (document.querySelector('input[name="g-use"]:checked') || {}).value || 'once';
  document.querySelectorAll('input[name="g-use"]').forEach((r) => r.onchange = () => { $('#g-n-wrap').hidden = useSel() !== 'once'; });

  $('#g-make').onclick = async () => {
    out.textContent = ''; links = []; const btn = $('#g-make'); btn.disabled = true;
    try {
      const base = common(), use = useSel(), n = use === 'once' ? Math.max(1, Math.min(20, Math.round(Number($('#g-n').value) || 1))) : 1;
      const entries = [], ids = [], local = [];
      const priv = await importPriv(stored());
      for (let i = 0; i < n; i++) {
        const id = DP.Gifts.newId(), c8 = DP.Gifts.newCode(), code = DP.Gifts.fmtCode(c8);
        const p = Object.assign({}, base, { id, t: 'code', u: use, h: await DP.Gifts.codeHash(c8) });
        entries.push(await DP.Gifts.signEntry(priv, p)); ids.push(id);
        // ссылка: одноразовый — длинный код DP1 (работает сразу и без сети, тот же id); для всех — короткий код в ссылке
        let link;
        if (use === 'once') { const dp = { n: id, g: base.g }; if (base.m) dp.m = base.m; if (base.e) dp.e = base.e; link = parkUrl(await sign(dp)); }
        else link = parkUrl(code);
        links.push(code + '  ' + link); local.push({ id, t: 'code', u: use, code, link, g: base.g, m: base.m || '', ts: base.ts, e: base.e || 0 });
        const div = document.createElement('div'); div.className = 'result';
        div.innerHTML = `<b>${use === 'once' ? 'Код ' + (n > 1 ? i + 1 : '') + ' (одноразовый)' : 'Код для всех (каждый парк — один раз)'}</b> · ${esc(giftText(base.g))}<div class="short">${code}</div>`;
        const c = document.createElement('button'); c.className = 'btn small'; c.textContent = '📋 Скопировать код'; c.onclick = () => copyText(code, 'Код скопирован'); div.appendChild(c);
        const sh = document.createElement('button'); sh.className = 'btn small ghost'; sh.textContent = '🔗 Скопировать ссылку'; sh.style.marginLeft = '6px'; sh.onclick = () => copyText(link, 'Ссылка скопирована'); div.appendChild(sh);
        const l = document.createElement('a'); l.href = link; l.textContent = 'ссылка для игрока'; l.target = '_blank'; l.rel = 'noopener'; l.className = 'code'; l.style.display = 'block'; div.appendChild(l);
        out.appendChild(div);
      }
      remember(local);
      $('#g-copy').hidden = false;
      const card = document.createElement('div'); card.className = 'result'; card.innerHTML = '<div class="st">' + (use === 'once' ? 'Ссылка работает сразу. Короткий код заработает, когда опубликуется:' : 'Код заработает, когда опубликуется:') + '</div>'; out.appendChild(card);
      await finish(card, entries, ids, 'Подарки: ' + (use === 'once' ? n + ' одноразовых кода' : 'код для всех'));
    } catch (e) { fail(e); } finally { btn.disabled = false; }
  };
  $('#b-all').onclick = async () => {
    pick(null); out.textContent = '';
    try {
      const base = common();
      if (!confirm('Отправить «' + giftText(base.g) + '» ВСЕМ паркам?\n\nКаждый парк получит подарок один раз, когда его откроют.')) return;
      const id = DP.Gifts.newId(), p = Object.assign({}, base, { id, t: 'all' });
      const entry = await DP.Gifts.signEntry(await importPriv(stored()), p);
      remember([{ id, t: 'all', g: base.g, m: base.m || '', ts: base.ts, e: base.e || 0 }]);
      const card = document.createElement('div'); card.className = 'result'; card.innerHTML = `<b>📣 Подарок всем:</b> ${esc(giftText(base.g))}${base.m ? ' — «' + esc(base.m) + '»' : ''}`; out.appendChild(card);
      await finish(card, [entry], [id], 'Подарки: всем');
    } catch (e) { fail(e); }
  };
  $('#g-park-send').onclick = async () => {
    out.textContent = '';
    try {
      const base = common(), pk = $('#g-park').value.trim().toLowerCase();
      if (!/^[a-z0-9]{6,16}$/.test(pk)) throw new Error('Код парка: 6–16 латинских букв и цифр (его видно в «Мои парки» у игрока)');
      const id = DP.Gifts.newId(), p = Object.assign({}, base, { id, t: 'park', p: pk });
      const entry = await DP.Gifts.signEntry(await importPriv(stored()), p);
      remember([{ id, t: 'park', p: pk, g: base.g, m: base.m || '', ts: base.ts, e: base.e || 0 }]);
      const card = document.createElement('div'); card.className = 'result'; card.innerHTML = `<b>🎯 Сюрприз парку ${esc(pk)}:</b> ${esc(giftText(base.g))}`; out.appendChild(card);
      await finish(card, [entry], [id], 'Подарки: сюрприз парку');
    } catch (e) { fail(e); }
  };
  $('#g-copy').onclick = () => copyText(links.join('\n'), '✓ Скопировано');

  // ——— отправленные (из ленты) и отмена ———
  async function listSent() {
    const el = $('#sent-list'); if (!el) return;
    el.textContent = '⏳ Загружаем…';
    try {
      const r = await DP.Gifts.collect({ mqttMs: 4000 });
      const mine = {}; sentLocal().forEach((x) => { mine[x.id] = x; });
      const live = r.list.filter((p) => !DP.Gifts.expired(p)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      if (!live.length) { el.textContent = 'Пока ничего не опубликовано.'; return; }
      el.innerHTML = '';
      live.forEach((p) => {
        const loc = mine[p.id] || {}, row = document.createElement('div'); row.className = 'sent';
        const what = p.t === 'all' ? '📣 Всем' : p.t === 'park' ? '🎯 Парку ' + esc(p.p) : (p.u === 'multi' ? '🎟️ Код для всех' : '🎟️ Одноразовый код') + (loc.code ? ' <b>' + loc.code + '</b>' : '');
        row.innerHTML = `<div>${what} · ${esc(giftText(p.g))}${p.m ? ' — «' + esc(p.m) + '»' : ''}<br><small>${new Date(p.ts || 0).toLocaleString('ru-RU')}${p.e ? ' · до ' + new Date(p.e).toLocaleDateString('ru-RU') : ''}</small></div>`;
        const b = document.createElement('button'); b.className = 'btn small ghost'; b.textContent = 'Отменить';
        b.onclick = async () => {
          if (!confirm('Отменить этот подарок? Кто ещё не получил — уже не получит.')) return;
          b.disabled = true; b.textContent = '⏳';
          try {
            const id = DP.Gifts.newId(), e = await DP.Gifts.signEntry(await importPriv(stored()), { v: 1, id, t: 'revoke', ref: p.id, ts: Date.now() });
            const res = await publish([e], [id], 'Подарки: отмена');
            try { await DP.Gifts.publishMqtt(null, p.id, 3000); } catch (er) { /* не важно */ }
            const c = JSON.parse(localStorage.getItem('dp_gfeed') || '[]'); c.push(e); localStorage.setItem('dp_gfeed', JSON.stringify(c));
            toast(res.gh ? 'Отменено' : 'Отменено (без GitHub — только на серверах сообщений)', 3500); listSent();
          } catch (er) { alert('Не получилось: ' + er.message); b.disabled = false; b.textContent = 'Отменить'; }
        };
        row.appendChild(b); el.appendChild(row);
      });
    } catch (e) { el.textContent = 'Не удалось загрузить: ' + e.message; }
  }
  $('#sent-reload').onclick = listSent;
  $('#sent-sec').addEventListener('toggle', () => { if ($('#sent-sec').open) listSent(); });

  // ——— настройка GitHub ———
  const repoDefault = () => (window.DP_CONFIG || {}).GIFTS_REPO || '';
  function ghStatus() {
    const g = ghCfg();
    $('#gh-repo').value = (g && g.repo) || repoDefault(); $('#gh-repo-name').textContent = ($('#gh-repo').value.split('/')[1] || 'репозиторий сайта');
    $('#gh-st').innerHTML = g && g.token ? '<span class="ok">✅ Настроено: подарки сохраняются в ' + esc(g.repo) + '</span>' : '<span class="warn">Не настроено — подарки хранятся только на серверах сообщений.</span>';
  }
  $('#gh-save').onclick = async () => {
    const token = $('#gh-token').value.trim(), repo = $('#gh-repo').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, ''), m = $('#gh-msg');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { m.innerHTML = '<span class="bad">Репозиторий в виде владелец/имя, например ai-tim/dino-park</span>'; return; }
    const old = ghCfg(), tk = token || (old && old.token);
    if (!tk || tk.length < 20) { m.innerHTML = '<span class="bad">Вставь токен (github_pat_…)</span>'; return; }
    m.textContent = '⏳ Проверяем…';
    try {
      const r = await fetch('https://api.github.com/repos/' + repo, { headers: { Authorization: 'Bearer ' + tk, Accept: 'application/vnd.github+json' } });
      if (r.status === 401) throw new Error('GitHub не принял токен');
      if (!r.ok) throw new Error('Нет доступа к ' + repo + ' (ошибка ' + r.status + ')');
      const j = await r.json();
      if (j.permissions && !j.permissions.push) throw new Error('У токена нет права записи — включи Contents: Read and write');
      localStorage.setItem('dp_admin_gh', JSON.stringify({ token: tk, repo, branch: j.default_branch || 'main' }));
      $('#gh-token').value = ''; m.innerHTML = '<span class="ok">✅ Готово! Теперь подарки будут сохраняться надёжно.</span>'; ghStatus();
    } catch (e) { m.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
  };
  $('#gh-forget').onclick = () => { if (confirm('Удалить токен GitHub из этого браузера?')) { localStorage.removeItem('dp_admin_gh'); ghStatus(); $('#gh-msg').textContent = ''; } };
  ghStatus();

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
