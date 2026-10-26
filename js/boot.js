/* Динопарк — загрузчик страниц. СТРОГО ES5 (без let/const/=>/классов/шаблонных строк): должен работать в любом браузере —
 * Samsung Tizen 2.4+, LG webOS 3+, Android TV WebView, Fire TV Silk, VIDAA, Яндекс Браузер, Safari 9+, Firefox, старый Chromium.
 *   <script src="js/boot.js" data-modern='["js/a.js", …]' data-legacy='["js/legacy/polyfills.js", …]' data-css-legacy="css/legacy/style.css"></script>
 * 1) ловит ошибки (window.onerror, unhandledrejection) и пишет журнал в localStorage «dp.errors» / window.DPBOOT.errors;
 * 2) проверяет возможности браузера и грузит современную (ES2017, 3D) или наследную ES5-сборку (2D) — ?legacy=1 принудительно;
 * 3) нет WebCrypto (старый ТВ, http) → подгружает js/legacy/crypto.js (ECDH/PBKDF2/AES-GCM на чистом JS);
 * 4) если страница не запустилась (ошибка или сторож 25 с) — понятный экран с «Перезагрузить» вместо пустого.
 * Страница сообщает о готовности: DPBOOT.ready = true. */
(function () {
  var W = window, D = document;
  var me = D.currentScript || (function () { var s = D.getElementsByTagName('script'); return s[s.length - 1]; })();
  var B = W.DPBOOT = { errors: [], ready: false, mode: '', t0: new Date().getTime(), caps: {} };
  var tv = /SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|VIDAA|Hisense|AFT[A-Z]|Silk|BRAVIA|Android TV|GoogleTV|CrKey|HbbTV|Philips|TCL|Xiaomi|MiTV/i.test(navigator.userAgent);
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function msgOf(e) { return e ? (e.message || String(e)) : 'неизвестная ошибка'; }
  B.log = function (e, where) {
    var now = new Date(), rec = { t: now.toISOString ? now.toISOString() : String(now), m: msgOf(e), w: where || '', mode: B.mode, page: location.pathname.split('/').pop(), ua: navigator.userAgent };
    B.errors.push(rec);
    try { var L = JSON.parse(localStorage.getItem('dp.errors') || '[]'); L.push(rec); localStorage.setItem('dp.errors', JSON.stringify(L.slice(-15))); } catch (x) { /* нет хранилища */ }
    try { if (W.console) console.error('[Динопарк]', rec.m, rec.w); } catch (x) { /* нет консоли */ }
    return rec;
  };
  B.fail = function (e, where, hint, again) {
    var rec = again ? B.errors[B.errors.length - 1] : B.log(e, where);
    if (B.ready && !hint) return; // страница уже работает — мелкая ошибка только в журнал
    // ошибка во время запуска: даём странице 3 с — вдруг она всё-таки запустилась
    if (!hint && !again) { setTimeout(function () { if (!B.ready) B.fail(e, where, null, true); }, 3000); return; }
    var d = D.getElementById('bootmsg');
    if (!d) { d = D.createElement('div'); d.id = 'bootmsg'; (D.body || D.documentElement).appendChild(d); }
    d.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:#04121a;color:#fff;overflow:auto;padding:24px;text-align:center;font:22px/1.4 Nunito,Arial,sans-serif');
    d.innerHTML = '<div style="max-width:760px;margin:6% auto 0"><div style="font-size:54px">🦖</div>' +
      '<h2 style="font-size:32px;margin:6px 0 10px">Динопарк не запустился ' + (tv ? 'на этом телевизоре' : 'в этом браузере') + '</h2>' +
      '<p>' + esc(hint || (tv ? 'Браузер телевизора не смог выполнить страницу.' : 'Браузер не смог выполнить страницу.')) + '</p>' +
      '<p style="color:#cfe;font-size:19px">Что попробовать: «Перезагрузить»; обновить браузер или ПО ' + (tv ? 'телевизора' : 'устройства') + '; открыть сайт в другом браузере (Chrome, Яндекс Браузер, Safari, Firefox)' + (tv ? ' — или показать парк с телефона по HDMI / трансляции экрана' : '') + '.</p>' +
      '<button id="bootre" style="font:inherit;font-size:26px;font-weight:800;min-height:64px;padding:0 28px;border-radius:18px;border:0;background:#2fd17d;color:#04311b;cursor:pointer">🔄 Перезагрузить</button>' +
      '<p style="color:#8aa;font-size:14px;margin-top:18px;word-break:break-all">Для поддержки: ' + esc(rec && rec.m) + (rec && rec.w ? ' · ' + esc(rec.w) : '') + ' · ' + esc(B.mode) + '<br>' + esc(navigator.userAgent) + '</p></div>';
    var b = D.getElementById('bootre'); if (b) { b.onclick = function () { location.reload(); }; try { b.focus(); } catch (x) { /* */ } }
  };
  W.onerror = function (msg, src, line, col, err) { B.fail(err || msg, (src ? String(src).split('/').pop() : '') + (line ? ':' + line : '')); };
  if (W.addEventListener) W.addEventListener('unhandledrejection', function (ev) { B.log(ev && ev.reason, 'promise'); });

  // —— возможности браузера ——
  var C = B.caps;
  try { new Function('"use strict"; async function a() { await 0; } class K { m() { return `${1}`; } } let { x = 1 } = {}; const f = (...r) => r; for (const v of [1]) {}'); C.es2017 = true; } catch (e) { C.es2017 = false; }
  C.builtins = !!(W.Promise && W.Map && W.WeakMap && W.Symbol && Object.assign && Array.prototype.includes && Object.entries && W.TextEncoder && W.Uint8Array);
  C.subtle = !!(W.crypto && W.crypto.subtle);
  C.webgl2 = false; try { var cv = D.createElement('canvas'); C.canvas = !!(cv.getContext && cv.getContext('2d')); } catch (e) { C.canvas = false; }
  C.cssvar = !!(W.CSS && CSS.supports && CSS.supports('color', 'var(--x)'));
  C.flexgap = (function () { try { var f = D.createElement('div'); f.style.display = 'flex'; f.style.flexDirection = 'column'; f.style.rowGap = '1px'; f.appendChild(D.createElement('div')); f.appendChild(D.createElement('div')); D.documentElement.appendChild(f); var ok = f.scrollHeight === 1; f.parentNode.removeChild(f); return ok; } catch (e) { return false; } })();
  var html = D.documentElement;
  if (!C.flexgap) html.className += ' no-flexgap';
  if (!C.cssvar) html.className += ' no-cssvar';
  if (tv) html.className += ' is-tv';

  var modern = C.es2017 && C.builtins && !/[?&]legacy=1/.test(location.search);
  B.mode = modern ? 'modern' : 'legacy';
  function attr(n) { var v = me && me.getAttribute(n); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  var list = (modern ? attr('data-modern') : attr('data-legacy')) || [];
  if (!C.subtle && attr('data-modern') && /relay\.js/.test(attr('data-modern').join(' '))) list = ['js/legacy/crypto.js'].concat(list);
  // CSS: старым движкам (нет inset / flex-gap / clamp — Chromium < 87, Safari < 14.1) — css/legacy/style.css с запасными значениями
  C.newcss = !!(W.CSS && CSS.supports && CSS.supports('inset', '0') && CSS.supports('width', 'clamp(1px, 2px, 3px)')) && C.flexgap && C.cssvar;
  if ((!modern || !C.newcss) && me && me.getAttribute('data-css-legacy')) {
    var links = D.getElementsByTagName('link'), i;
    for (i = 0; i < links.length; i++) if (/css\/style\.css/.test(links[i].getAttribute('href') || '')) links[i].setAttribute('href', me.getAttribute('data-css-legacy'));
  }
  // —— загрузка по порядку (async = false сохраняет порядок выполнения) ——
  var head = D.getElementsByTagName('head')[0] || html, left = list.length, failed = false;
  for (var k = 0; k < list.length; k++) (function (src) {
    var s = D.createElement('script'); s.src = src; s.async = false;
    s.onload = function () { left--; };
    s.onerror = function () { if (failed) return; failed = true; B.fail(new Error('не загрузился файл ' + src), 'сеть', 'Не удалось загрузить файлы сайта. Проверьте интернет и нажмите «Перезагрузить».'); };
    head.appendChild(s);
  })(list[k]);
  if (me && me.getAttribute('data-watch') !== '0') setTimeout(function () {
    if (B.ready || failed) return;
    B.fail(new Error(left > 0 ? 'файлы ещё загружаются (' + left + ')' : 'страница не запустилась'), 'сторож', left > 0 ? 'Сайт загружается слишком долго. Проверьте интернет и нажмите «Перезагрузить».' : (tv ? 'Браузер телевизора не смог запустить страницу.' : 'Браузер не смог запустить страницу.'));
  }, 25000);
})();
