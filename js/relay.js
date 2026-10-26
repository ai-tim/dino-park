/* Динопарк — связь «телефон ↔ телевизор» без своего сервера и без регистрации.
 * Транспорт: публичные MQTT-брокеры через защищённый WebSocket (wss). Подключаемся сразу к нескольким
 * и шлём через все — если один недоступен, работает другой (повторы отбрасываются по номеру сообщения).
 * Брокер видит только случайные имена тем и зашифрованные байты:
 *  • сопряжение: ТВ шлёт свой одноразовый ключ ECDH P-256 и «доказательство кода» (AES-GCM на ключе PBKDF2(код, соль = ключ ТВ));
 *    телефон проверяет код, отвечает своим ключом ECDH, зашифрованным тем же ключом;
 *  • сеансовый секрет = SHA-256(ECDH-секрет | код | оба ключа); из него — имя темы и ключ AES-GCM 256.
 * Код ТВ живёт 5 минут и одноразовый. Телефон — источник правды: шлёт состояние парка и события, ТВ только показывает.
 * Код намеренно без новых возможностей JS (без ?. и ??): старые браузеры телевизоров (Chromium 68+), Safari 12+.
 */
window.DP = window.DP || {};
(function () {
  'use strict';
  var DEFAULT_BROKERS = [
    { name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' },
    { name: 'shiftr.io', url: 'wss://public.cloud.shiftr.io', user: 'public', pass: 'public' },
    { name: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
    { name: 'Mosquitto', url: 'wss://test.mosquitto.org:8081/mqtt' }
  ];
  var PREFIX = 'dinopark/v4/', CHUNK = 24000, CODE_TTL = 5 * 60 * 1000;
  var te = window.TextEncoder ? new TextEncoder() : null, td = window.TextDecoder ? new TextDecoder() : null;
  var cryptoObj = window.crypto || window.msCrypto, subtle = cryptoObj && cryptoObj.subtle;

  function brokers() {
    var cfg = window.DP_CONFIG || {}, list = cfg.RELAYS || DEFAULT_BROKERS, m = /[?&#]relay=([^&#]+)/.exec(location.href);
    if (m) { var want = decodeURIComponent(m[1]).toLowerCase().split(','); list = list.filter(function (b) { return want.indexOf(b.name.toLowerCase()) >= 0 || want.indexOf(b.name.toLowerCase().replace(/\W/g, '')) >= 0; }); }
    return list;
  }
  function utf8(s) { return te.encode(s); }
  function unutf8(u) { return td.decode(u); }
  function concat(list) { var n = 0, i, o = 0; for (i = 0; i < list.length; i++) n += list[i].length; var r = new Uint8Array(n); for (i = 0; i < list.length; i++) { r.set(list[i], o); o += list[i].length; } return r; }
  function rnd(n) { var u = new Uint8Array(n); cryptoObj.getRandomValues(u); return u; }
  function hex(u) { var s = ''; for (var i = 0; i < u.length; i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16); return s; }
  function b64(u) { var s = '', i; for (i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function sha(u) { return subtle.digest('SHA-256', typeof u === 'string' ? utf8(u) : u).then(function (b) { return new Uint8Array(b); }); }
  function fnv(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return h.toString(16) + '_' + s.length.toString(36); }
  function supported() { return !!(te && td && subtle && window.WebSocket && window.Promise && cryptoObj.getRandomValues); }

  // ———————————————— минимальный клиент MQTT 3.1.1 поверх WebSocket ————————————————
  function lenBytes(n) { var out = []; do { var b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0); return new Uint8Array(out); }
  function str16(s) { var u = utf8(s); return concat([new Uint8Array([u.length >> 8, u.length & 255]), u]); }
  function packet(head, body) { return concat([new Uint8Array([head]), lenBytes(body.length), body]); }

  function Conn(b, hub) {
    this.b = b; this.hub = hub; this.open = false; this.stopped = false; this.subs = {}; this.pid = 1; this.tries = 0; this.buf = new Uint8Array(0);
    this.connect();
  }
  Conn.prototype.connect = function () {
    var self = this, ws;
    if (self.stopped) return;
    try { ws = new WebSocket(self.b.url, ['mqtt']); } catch (e) { return self.retry(); }
    ws.binaryType = 'arraybuffer'; self.ws = ws; self.buf = new Uint8Array(0);
    var to = setTimeout(function () { try { ws.close(); } catch (e) { /* ignore */ } }, 10000);
    ws.onopen = function () {
      var id = 'dp' + hex(rnd(8)), flags = 0x02, pl = [str16(id)];
      if (self.b.user) { flags |= 0x80; pl.push(str16(self.b.user)); }
      if (self.b.pass) { flags |= 0x40; pl.push(str16(self.b.pass)); }
      ws.send(packet(0x10, concat([str16('MQTT'), new Uint8Array([4, flags, 0, 60])].concat(pl))));
    };
    ws.onmessage = function (ev) { self.rx = Date.now(); if (ev.data instanceof ArrayBuffer) self.feed(new Uint8Array(ev.data)); };
    ws.onerror = function () { /* дальше будет onclose */ };
    ws.onclose = function () {
      clearTimeout(to); clearInterval(self.ping);
      var was = self.open; self.open = false; if (self.ws === ws) self.ws = null;
      if (was) self.hub.changed();
      self.retry();
    };
    self._to = to;
  };
  Conn.prototype.retry = function () {
    var self = this; if (self.stopped) return;
    self.tries++; var wait = Math.min(30000, 1500 * Math.pow(1.7, Math.min(self.tries, 8)));
    clearTimeout(self.rt); self.rt = setTimeout(function () { self.connect(); }, wait);
  };
  Conn.prototype.feed = function (chunk) {
    var buf = this.buf.length ? concat([this.buf, chunk]) : chunk;
    while (buf.length >= 2) {
      var mul = 1, len = 0, i = 1, b;
      do { if (i >= buf.length) { this.buf = buf; return; } b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while ((b & 128) && i < 5);
      if (buf.length < i + len) break;
      this.handle(buf[0], buf.subarray(i, i + len));
      buf = buf.subarray(i + len);
    }
    this.buf = buf.length ? buf.slice(0) : new Uint8Array(0);
  };
  Conn.prototype.handle = function (h, body) {
    var type = h >> 4, self = this;
    if (type === 2) { // CONNACK
      clearTimeout(self._to);
      if (body[1] !== 0) { try { self.ws.close(); } catch (e) { /* ignore */ } return; }
      self.open = true; self.tries = 0;
      Object.keys(self.subs).forEach(function (t) { self.sendSub(t); });
      // «живость»: PINGREQ каждые 15 с; если брокер молчит 40 с — сокет «завис» (сон телефона, смена сети), переподключаемся
      self.rx = Date.now(); clearInterval(self.ping);
      self.ping = setInterval(function () {
        if (Date.now() - self.rx > 40000) { try { self.ws.close(); } catch (e) { /* ignore */ } return; }
        self.raw(new Uint8Array([0xC0, 0]));
      }, 15000);
      self.hub.changed();
    } else if (type === 3) { // PUBLISH
      var tl = (body[0] << 8) | body[1], topic = unutf8(body.subarray(2, 2 + tl)), qos = (h >> 1) & 3, off = 2 + tl + (qos ? 2 : 0);
      if (qos === 1) self.raw(new Uint8Array([0x40, 2, body[2 + tl], body[3 + tl]]));
      var payload; try { payload = unutf8(body.subarray(off)); } catch (e) { return; }
      self.hub.incoming(topic, payload);
    }
  };
  Conn.prototype.raw = function (u) { if (this.ws && this.ws.readyState === 1) { try { this.ws.send(u); return true; } catch (e) { /* ignore */ } } return false; };
  Conn.prototype.nextId = function () { this.pid = (this.pid % 65000) + 1; return new Uint8Array([this.pid >> 8, this.pid & 255]); };
  Conn.prototype.sendSub = function (t) { if (this.open) this.raw(packet(0x82, concat([this.nextId(), str16(t), new Uint8Array([0])]))); };
  Conn.prototype.sub = function (t) { this.subs[t] = 1; this.sendSub(t); };
  Conn.prototype.unsub = function (t) { delete this.subs[t]; if (this.open) this.raw(packet(0xA2, concat([this.nextId(), str16(t)]))); };
  Conn.prototype.pub = function (t, s) { return this.open && this.raw(packet(0x30, concat([str16(t), utf8(s)]))); };
  Conn.prototype.stop = function () { this.stopped = true; clearTimeout(this.rt); clearInterval(this.ping); if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } } };

  // ———————————————— «хаб»: несколько брокеров, нарезка больших сообщений, отбрасывание повторов ————————————————
  var Hub = {
    conns: [], topics: {}, parts: {}, seen: {}, waiters: [], listeners: [],
    start: function () {
      if (Hub.conns.length) return;
      Hub.conns = brokers().map(function (b) { return new Conn(b, Hub); });
      document.addEventListener('visibilitychange', function () { // iOS рвёт сокеты в фоне — по возвращении переподключаемся сразу
        if (document.hidden) return;
        Hub.conns.forEach(function (c) {
          if (!c.open && !c.stopped) { clearTimeout(c.rt); c.tries = 0; if (!c.ws) c.connect(); return; }
          // сокет «открыт», но после сна мог умереть: пингуем и, если брокер молчит 5 с, переподключаемся
          if (c.open && c.ws) { var t = Date.now(); c.raw(new Uint8Array([0xC0, 0])); setTimeout(function () { if (c.open && c.rx < t && c.ws) { try { c.ws.close(); } catch (e) { /* ignore */ } } }, 5000); }
        });
      });
    },
    online: function () { return Hub.conns.filter(function (c) { return c.open; }).map(function (c) { return c.b.name; }); },
    changed: function () {
      var on = Hub.online();
      if (on.length) { var w = Hub.waiters; Hub.waiters = []; w.forEach(function (f) { f(true); }); }
      Hub.listeners.forEach(function (f) { try { f(on); } catch (e) { /* ignore */ } });
    },
    onChange: function (f) { Hub.listeners.push(f); },
    ready: function (ms) {
      Hub.start(); if (Hub.online().length) return Promise.resolve(true);
      return new Promise(function (res) { Hub.waiters.push(res); setTimeout(function () { res(Hub.online().length > 0); }, ms || 8000); });
    },
    sub: function (t, fn) { Hub.start(); (Hub.topics[t] = Hub.topics[t] || []).push(fn); Hub.conns.forEach(function (c) { c.sub(t); }); },
    unsub: function (t, fn) {
      var l = (Hub.topics[t] || []).filter(function (f) { return f !== fn; });
      if (l.length) { Hub.topics[t] = l; return; }
      delete Hub.topics[t]; Hub.conns.forEach(function (c) { c.unsub(t); });
    },
    send: function (t, s) {
      var id = hex(rnd(6)), n = Math.max(1, Math.ceil(s.length / CHUNK)), sent = 0;
      for (var i = 0; i < n; i++) {
        var fr = 'DP4 ' + id + ' ' + i + ' ' + n + ' ' + s.slice(i * CHUNK, (i + 1) * CHUNK);
        Hub.conns.forEach(function (c) { if (c.pub(t, fr)) sent++; });
      }
      return sent > 0;
    },
    incoming: function (t, fr) {
      var m = /^DP4 ([0-9a-f]{12}) (\d+) (\d+) /.exec(fr); if (!m) return;
      var id = m[1], i = +m[2], n = +m[3], key = t + '|' + id, now = Date.now();
      if (Hub.seen[key] || n > 4000 || i >= n) return;
      var p = Hub.parts[key] || (Hub.parts[key] = { n: n, got: 0, a: [], at: now });
      if (p.a[i] != null) return;
      p.a[i] = fr.slice(m[0].length); p.got++;
      if (p.got < p.n) return;
      delete Hub.parts[key]; Hub.seen[key] = now;
      if (Math.random() < 0.05) Hub.gc();
      var s = p.a.join(''); (Hub.topics[t] || []).slice().forEach(function (f) { try { f(s, t); } catch (e) { console.error(e); } });
    },
    gc: function () { var now = Date.now(); Object.keys(Hub.seen).forEach(function (k) { if (now - Hub.seen[k] > 600000) delete Hub.seen[k]; }); Object.keys(Hub.parts).forEach(function (k) { if (now - Hub.parts[k].at > 120000) delete Hub.parts[k]; }); }
  };

  // ———————————————— шифрование ————————————————
  function aesRaw(u) { return subtle.importKey('raw', u, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
  function seal(key, obj) {
    var iv = rnd(12);
    return subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, utf8(JSON.stringify(obj))).then(function (ct) { return b64(concat([iv, new Uint8Array(ct)])); });
  }
  function open(key, s) {
    var u = unb64(s);
    return subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12)).then(function (pt) { return JSON.parse(unutf8(new Uint8Array(pt))); });
  }
  function pairKey(code, pubB64) {
    return subtle.importKey('raw', utf8('dinopark-tv|' + code), { name: 'PBKDF2' }, false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey({ name: 'PBKDF2', salt: utf8('dinopark-v4|' + pubB64), iterations: 40000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function pairTopic(code) { return sha('dinopark-pair|' + code).then(function (h) { return PREFIX + 'pair/' + hex(h).slice(0, 4); }); }
  function ecdh() {
    return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']).then(function (kp) {
      return subtle.exportKey('raw', kp.publicKey).then(function (raw) { return { kp: kp, pub: b64(new Uint8Array(raw)) }; });
    });
  }
  function sessionSecret(mine, otherPubB64, code, pubT, pubP) {
    return subtle.importKey('raw', unb64(otherPubB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []).then(function (pk) {
      return subtle.deriveBits({ name: 'ECDH', public: pk }, mine.kp.privateKey, 256);
    }).then(function (bits) { return sha(concat([new Uint8Array(bits), utf8('|' + code + '|' + pubT + '|' + pubP)])); });
  }
  function session(secretU8) {
    return Promise.all([sha(concat([utf8('topic|'), secretU8])), sha(concat([utf8('key|'), secretU8]))]).then(function (r) {
      return aesRaw(r[1]).then(function (key) { return { topic: PREFIX + 's/' + hex(r[0]).slice(0, 32), key: key, s: b64(secretU8) }; });
    });
  }

  // ———————————————— телефон (источник правды) ————————————————
  function strip(park, assets) {
    var p = JSON.parse(JSON.stringify(park)); delete p.pin;
    var ref = function (v) { if (typeof v !== 'string' || v.indexOf('data:') !== 0) return v; var h = fnv(v); assets[h] = v; return '#h:' + h; };
    (p.dinos || []).forEach(function (d) { d.sprite = ref(d.sprite); });
    p.customBg = ref(p.customBg);
    return p;
  }
  function Host(parkId) {
    this.parkId = parkId; this.sessions = []; this.assets = {}; this.handlers = {}; this.code = null; this.seq = 0; this.park = null;
    var self = this, saved = [];
    try { saved = JSON.parse(localStorage.getItem('dp_tvs_' + parkId) || '[]'); } catch (e) { saved = []; }
    saved.forEach(function (x) { self.addSession(x.s, x.at, x.name, true); });
    setInterval(function () { if (self.sessions.length) self.broadcast({ t: 'beat' }); }, 20000);
  }
  Host.prototype.on = function (t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); };
  Host.prototype.emit = function (t, d) { (this.handlers[t] || []).forEach(function (f) { try { f(d); } catch (e) { console.error(e); } }); };
  Host.prototype.save = function () { try { localStorage.setItem('dp_tvs_' + this.parkId, JSON.stringify(this.sessions.map(function (s) { return { s: s.s, at: s.at, name: s.name }; }))); } catch (e) { /* ignore */ } };
  Host.prototype.addSession = function (sB64, at, name, quiet) {
    var self = this;
    return session(unb64(sB64)).then(function (ss) {
      if (self.sessions.some(function (x) { return x.s === ss.s; })) return;
      ss.at = at || Date.now(); ss.name = name || 'Телевизор'; ss.sent = {}; ss.last = 0;
      ss.fn = function (str) { open(ss.key, str).then(function (m) { self.fromTv(ss, m); }, function () { /* чужое/битое — пропускаем */ }); };
      self.sessions.push(ss); Hub.sub(ss.topic + '/t', ss.fn);
      if (!quiet) self.save();
      if (self.park) self.sendPark(ss);
      self.emit('tvs', self.sessions.length);
      return ss;
    });
  };
  Host.prototype.fromTv = function (ss, m) {
    var wasOff = Date.now() - ss.last > 60000; ss.last = Date.now();
    if (m.t === 'hello') { ss.sent = {}; this.sendPark(ss); }
    else if (m.t === 'need' && m.h) { var self = this; m.h.slice(0, 40).forEach(function (h) { if (self.assets[h]) self.sendTo(ss, { t: 'asset', h: h, d: self.assets[h] }); }); }
    if (wasOff) this.emit('tvs', this.sessions.length);
  };
  Host.prototype.sendTo = function (ss, obj) { return seal(ss.key, obj).then(function (s) { return Hub.send(ss.topic + '/p', s); }); };
  Host.prototype.broadcast = function (obj) { var self = this; return Promise.all(self.sessions.map(function (ss) { return self.sendTo(ss, obj); })); };
  Host.prototype.sendPark = function (ss) {
    var self = this; if (!self.park) return;
    var p = strip(self.park, self.assets), need = [];
    (p.dinos || []).map(function (d) { return d.sprite; }).concat([p.customBg]).forEach(function (v) { if (typeof v === 'string' && v.indexOf('#h:') === 0 && !ss.sent[v.slice(3)]) need.push(v.slice(3)); });
    need.forEach(function (h) { ss.sent[h] = 1; self.sendTo(ss, { t: 'asset', h: h, d: self.assets[h] }); });
    self.sendTo(ss, { t: 'park', park: p, seq: ++self.seq, at: Date.now() });
  };
  Host.prototype.push = function (park) { this.park = park; var self = this; clearTimeout(this._pt); this._pt = setTimeout(function () { self.sessions.forEach(function (ss) { self.sendPark(ss); }); }, 120); };
  Host.prototype.event = function (ev) { if (this.sessions.length) this.broadcast({ t: 'event', ev: ev }); };
  Host.prototype.tvsOnline = function () { var now = Date.now(); return this.sessions.filter(function (s) { return now - s.last < 60000; }).length; };
  Host.prototype.disconnectAll = function () {
    var self = this, list = self.sessions.slice();
    return Promise.all(list.map(function (ss) { return self.sendTo(ss, { t: 'bye' }); })).then(function () {
      list.forEach(function (ss) { Hub.unsub(ss.topic + '/t', ss.fn); });
      self.sessions = []; self.save(); self.emit('tvs', 0);
    });
  };
  /** Новый 5-значный код: телефон слушает «привет» от ТВ 5 минут, код одноразовый */
  Host.prototype.startCode = function (code, exp) {
    var self = this; self.stopCode();
    if (!supported()) return Promise.resolve(false);
    var c = { code: code, exp: exp || Date.now() + CODE_TTL, busy: {}, replies: {} };
    self.code = c;
    return pairTopic(code).then(function (topic) {
      if (self.code !== c) return false;
      c.topic = topic;
      c.fn = function (str) { self.onHello(c, str); };
      Hub.sub(topic + '/h', c.fn);
      c.timer = setTimeout(function () { if (self.code === c) self.stopCode(); }, c.exp - Date.now());
      return true;
    });
  };
  Host.prototype.stopCode = function () {
    var c = this.code; if (!c) return; this.code = null; clearTimeout(c.timer);
    if (!c.fn) return;
    // код уже сработал — ещё минуту слушаем повторные «привет» того же ТВ и повторяем ответ (он мог потеряться: QoS 0, разные брокеры)
    if (c.used) setTimeout(function () { Hub.unsub(c.topic + '/h', c.fn); }, 60000);
    else Hub.unsub(c.topic + '/h', c.fn);
  };
  Host.prototype.codeInfo = function () { var c = this.code; return c ? { code: c.code, exp: c.exp, used: !!c.used } : null; };
  Host.prototype.onHello = function (c, str) {
    var self = this, m; try { m = JSON.parse(str); } catch (e) { return; }
    if (!m || m.v !== 4 || !m.id || !m.pub || !m.proof) return;
    if (c.replies[m.id]) { Hub.send(c.topic + '/w/' + m.id, c.replies[m.id]); return; } // повтор: ТВ не получил ответ — шлём ещё раз
    if (c.busy[m.id] || c.used || Date.now() > c.exp) return; // срок — по часам ЭТОГО телефона (часы ТВ не сравниваем)
    c.busy[m.id] = 1;
    var K, mine;
    pairKey(c.code, m.pub).then(function (k) { K = k; return open(K, m.proof); }).then(function (pr) {
      if (!pr || pr.hello !== m.id || c.used) throw new Error('bad proof');
      c.used = true; return ecdh();
    }).then(function (me) { mine = me; return sessionSecret(mine, m.pub, c.code, m.pub, mine.pub); }).then(function (S) {
      var name = self.park ? self.park.name : '';
      return seal(K, { ok: 1, park: { id: self.parkId, name: name } }).then(function (box) {
        c.replies[m.id] = JSON.stringify({ v: 4, pub: mine.pub, box: box });
        Hub.send(c.topic + '/w/' + m.id, c.replies[m.id]);
        return self.addSession(b64(S), Date.now(), String(m.dev || 'Телевизор').slice(0, 40));
      });
    }).then(function () { if (self.code === c) self.stopCode(); self.emit('paired', {}); }, function () { /* неверный код — молча игнорируем */ });
  };

  // ———————————————— телевизор (только показывает) ————————————————
  function Viewer() { this.handlers = {}; this.assets = {}; this.ss = null; this.last = 0; this.raw = null; this.lastAt = 0; }
  Viewer.prototype.on = Host.prototype.on;
  Viewer.prototype.emit = Host.prototype.emit;
  function fail(kind, msg) { var e = new Error(msg); e.kind = kind; return e; }
  /** Самопроверка шифрования (старые ТВ: Samsung Tizen, LG webOS) — понятная ошибка вместо «код не найден» */
  function selfTest() {
    if (!supported()) return Promise.reject(fail('crypto', 'Браузер этого телевизора не поддерживает защищённое соединение (нужны https и WebCrypto). ' + (window.isSecureContext === false ? 'Откройте адрес через https://.' : 'Попробуйте другой браузер или приставку.')));
    return Promise.all([ecdh(), pairKey('00000', 'x')]).then(function () { return true; }, function (e) { throw fail('crypto', 'Шифрование в браузере телевизора не работает (' + ((e && e.name) || 'WebCrypto') + '). Попробуйте обновить ПО телевизора или другой браузер.'); });
  }
  Viewer.prototype.join = function (code, dev, onStatus) {
    var self = this, st = function (t) { if (onStatus) try { onStatus(t); } catch (e) { /* ignore */ } };
    code = String(code || '').replace(/[\uFF10-\uFF19]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 48); }).replace(/\D/g, '');
    st('⏳ Подключаемся к интернет-ретранслятору…');
    return selfTest().then(function () { return Hub.ready(15000); }).then(function (ok) {
      if (!ok) throw fail('net', 'Не удалось связаться с сервером соединения (интернет-ретранслятором). Проверьте интернет на телевизоре и нажмите «Попробовать ещё раз».');
      st('⏳ Ищем телефон с этим кодом… (' + Hub.online().join(', ') + ')');
      return Promise.all([ecdh(), pairTopic(code)]);
    }).then(function (r) {
      var me = r[0], topic = r[1], id = hex(rnd(6));
      return pairKey(code, me.pub).then(function (K) {
        return seal(K, { hello: id }).then(function (proof) {
          return new Promise(function (res, rej) {
            var done = false, timer, rep;
            var fn = function (str) {
              var m; try { m = JSON.parse(str); } catch (e) { return; }
              if (!m || !m.pub || !m.box || done) return;
              open(K, m.box).then(function (info) {
                if (done) return; done = true; finish();
                return sessionSecret(me, m.pub, code, me.pub, m.pub).then(function (S) { res({ s: b64(S), park: info.park }); });
              }).catch(function () { /* не наш ответ */ });
            };
            var finish = function () { clearTimeout(timer); clearInterval(rep); Hub.unsub(topic + '/w/' + id, fn); };
            Hub.sub(topic + '/w/' + id, fn);
            var hello = JSON.stringify({ v: 4, id: id, pub: me.pub, proof: proof, dev: dev || 'Телевизор' });
            var say = function () { Hub.send(topic + '/h', hello); };
            // «привет» повторяем каждые 2 с через ВСЕ подключённые брокеры (и те, что подключатся позже) — ждём до 60 с:
            // телефон мог «уснуть» (экран погас) и переподключиться, ответ мог потеряться
            var t0 = Date.now();
            setTimeout(say, 400); rep = setInterval(function () { say(); var left = 60 - Math.round((Date.now() - t0) / 1000); if (left > 0 && left % 10 === 0) st('⏳ Ждём ответ телефона… ещё ' + left + ' с. Держите парк открытым на телефоне (экран «📺 ТВ»).'); }, 2000);
            timer = setTimeout(function () {
              if (done) return; done = true; finish();
              rej(Hub.online().length ? fail('nophone', 'Телефон с кодом ' + code + ' не ответил. Проверьте код и что на телефоне открыт парк (экран «📺 ТВ», код ещё действует), затем нажмите «Попробовать ещё раз».')
                : fail('net', 'Пропала связь с сервером соединения (интернет-ретранслятором). Проверьте интернет на телевизоре и нажмите «Попробовать ещё раз».'));
            }, 60000);
          });
        });
      });
    }).then(function (pair) {
      try { localStorage.setItem('dp_tv_relay', JSON.stringify({ s: pair.s, park: pair.park })); } catch (e) { /* ignore */ }
      return self.attach(pair.s, pair.park);
    });
  };
  /** Подключиться к уже сопряжённому телефону (после перезагрузки ТВ) */
  Viewer.prototype.attach = function (sB64, info) {
    var self = this;
    return session(unb64(sB64)).then(function (ss) {
      self.ss = ss; self.info = info || {};
      var cached = null; try { cached = JSON.parse(localStorage.getItem('dp_tv_last') || 'null'); } catch (e) { cached = null; }
      if (cached && cached.park && cached.park.id === self.info.id) { self.raw = cached.park; self.assets = cached.assets || {}; }
      ss.fn = function (str) { open(ss.key, str).then(function (m) { self.fromPhone(m); }, function () { /* пропускаем */ }); };
      Hub.sub(ss.topic + '/p', ss.fn);
      var hi = function () { seal(ss.key, { t: 'hello' }).then(function (s) { Hub.send(ss.topic + '/t', s); }); };
      Hub.onChange(function (on) { if (on.length && self.ss === ss) hi(); });
      hi();
      clearTimeout(self._ping);
      var loop = function () { if (self.ss !== ss) return; var fresh = self.raw && self.last; seal(ss.key, { t: fresh ? 'ping' : 'hello' }).then(function (s) { Hub.send(ss.topic + '/t', s); }); self._ping = setTimeout(loop, fresh ? 20000 : 3000); };
      self._ping = setTimeout(loop, 3000);
      return new Promise(function (res, rej) {
        if (self.raw) { var p = self.resolve(); if (p) return res(p); }
        var to = setTimeout(function () { rej(new Error('Телефон не отвечает. Откройте парк на телефоне и попробуйте снова')); }, 25000);
        self.on('park', function first(p) { clearTimeout(to); res(p); });
      });
    });
  };
  Viewer.prototype.resolve = function () {
    var self = this; if (!self.raw) return null;
    var p = JSON.parse(JSON.stringify(self.raw)), miss = [];
    var fix = function (v) { if (typeof v === 'string' && v.indexOf('#h:') === 0) { var h = v.slice(3); if (self.assets[h]) return self.assets[h]; miss.push(h); return null; } return v; };
    (p.dinos || []).forEach(function (d) { d.sprite = fix(d.sprite); if (!d.sprite && !d.species && miss.length) d._wait = 1; });
    p.customBg = fix(p.customBg);
    p.dinos = (p.dinos || []).filter(function (d) { return !d._wait; }); // фото-динозавр появится, когда приедет его картинка
    if (miss.length && self.ss) { var ss = self.ss; seal(ss.key, { t: 'need', h: miss }).then(function (s) { Hub.send(ss.topic + '/t', s); }); }
    return p;
  };
  Viewer.prototype.fromPhone = function (m) {
    var self = this; self.last = Date.now();
    if (m.t === 'asset' && m.h && typeof m.d === 'string') { self.assets[m.h] = m.d; clearTimeout(self._ar); self._ar = setTimeout(function () { var p = self.resolve(); if (p) self.emit('park', p); }, 150); }
    else if (m.t === 'park' && m.park) {
      if (m.at && m.at < self.lastAt) return; self.lastAt = m.at || 0;
      self.raw = m.park; var p = self.resolve(); self.emit('park', p);
      clearTimeout(self._sv); self._sv = setTimeout(function () {
        var used = {}; JSON.stringify(self.raw).replace(/#h:([0-9a-z_]+)/g, function (a, h) { if (self.assets[h]) used[h] = self.assets[h]; return a; });
        self.assets = Object.assign({}, used, self.assets); // старые картинки не теряем до перезагрузки
        try { localStorage.setItem('dp_tv_last', JSON.stringify({ park: self.raw, assets: used })); } catch (e) { try { localStorage.setItem('dp_tv_last', JSON.stringify({ park: self.raw, assets: {} })); } catch (er) { /* ignore */ } }
      }, 1500);
    }
    else if (m.t === 'event' && m.ev) self.emit('event', m.ev);
    else if (m.t === 'bye') { self.forget(); self.emit('deleted', self.info && self.info.id); }
  };
  Viewer.prototype.phoneOnline = function () { return Date.now() - this.last < 50000; };
  Viewer.prototype.forget = function () { try { localStorage.removeItem('dp_tv_relay'); localStorage.removeItem('dp_tv_last'); } catch (e) { /* ignore */ } if (this.ss) Hub.unsub(this.ss.topic + '/p', this.ss.fn); this.ss = null; clearTimeout(this._ping); };
  Viewer.saved = function () { try { return JSON.parse(localStorage.getItem('dp_tv_relay') || 'null'); } catch (e) { return null; } };

  var hosts = {};
  DP.relay = {
    supported: supported, selfTest: selfTest, hub: Hub, brokers: brokers, CODE_TTL: CODE_TTL,
    host: function (parkId) { return hosts[parkId] || (hosts[parkId] = new Host(parkId)); },
    viewer: function () { return DP.relay._v || (DP.relay._v = new Viewer()); },
    savedTv: Viewer.saved,
    _t: { fnv: fnv, strip: strip }
  };
})();
