/* Динопарк — потребности динозавров (как в «Симс»): Голод 🍖, Игра 🎾, Сон 💤.
 * Значения 0..100 (100 — всё хорошо). Хранятся в парке у каждого динозавра как снимок
 * { food, play, sleep, t, sleepFrom } и дальше считаются по времени — одинаково на всех экранах,
 * поэтому телевизор и телефон видят одно и то же без постоянной пересылки.
 * Сон: когда энергия падает до порога, динозавр засыпает сам и спит, пока не выспится.
 */
window.DP = window.DP || {};
(function () {
  const N = {
    LOW: 30,
    NAP: 25, // минимальная длительность сна, с
    // скорость в единицах за секунду (при speed = 1)
    RATE: { food: 100 / 2400, play: 100 / 1800, sleep: 100 / 2700, rest: 100 / 75 }, // голод с 100 до 0 за 40 мин, игра — 30 мин, сон — 45 мин
    speed: 1,
    // Сами проходят: если нужду долго не закрывают, через AUTO секунд динозавр справляется сам
    // (нашёл еду, поиграл сам с собой) и шкала возвращается к REFILL.
    AUTO: 30 * 60, REFILL: 72,
    threshold(loc) { return loc === 'nightforest' ? 35 : 12; },
    fresh(now) { return { food: 85, play: 80, sleep: 90, t: now || Date.now(), sleepFrom: null }; },
    base(d, now) { return d.needs && typeof d.needs.t === 'number' ? d.needs : N.fresh(d.added || now); },
    /** Состояние на момент now */
    at(d, now) {
      now = now || Date.now();
      const n = N.base(d, now), R = N.RATE, k = N.speed / 1000, TH = N.threshold(d.loc);
      const dt = Math.max(0, now - n.t) * k;
      const food = decay(n.food, R.food, dt), play = decay(n.play, R.play, dt);
      let cur = n.t, e = clamp(n.sleep), asleep = n.sleepFrom != null && n.sleepFrom <= n.t, sleepStart = asleep ? n.sleepFrom : null;
      let explicit = n.sleepFrom != null && n.sleepFrom > n.t ? n.sleepFrom : null, wakeAt = null;
      for (let guard = 0; guard < 200 && cur < now; guard++) {
        if (asleep) {
          const wake = Math.max(cur + (100 - e) / R.rest / k, sleepStart + N.NAP * 1000 / N.speed);
          if (wake >= now) { e = clamp(e + R.rest * (now - cur) * k); wakeAt = wake; cur = now; break; }
          e = 100; cur = wake; asleep = false; sleepStart = null;
        } else {
          let next = explicit != null ? explicit : (e > TH ? cur + (e - TH) / R.sleep / k : cur);
          explicit = null;
          if (next >= now) { e = clamp(e - R.sleep * (now - cur) * k); cur = now; break; }
          e = clamp(e - R.sleep * (next - cur) * k); cur = next; asleep = true; sleepStart = next;
        }
      }
      if (asleep && wakeAt == null) wakeAt = Math.max(now + (100 - e) / R.rest / k, sleepStart + N.NAP * 1000 / N.speed);
      return { food, play, sleep: e, asleep, sleepStart, wakeAt, low: lows(food, play, e, asleep) };
    },
    /** Записать текущее состояние как новый снимок (перед изменением) */
    snap(d, now) {
      now = now || Date.now();
      const s = N.at(d, now);
      d.needs = { food: r1(s.food), play: r1(s.play), sleep: r1(s.sleep), t: now, sleepFrom: s.asleep ? s.sleepStart : null };
      return s;
    },
    feed(d, amount, now) { const s = N.snap(d, now); d.needs.food = Math.min(100, d.needs.food + (amount == null ? 30 : amount)); return s; },
    play(d, amount, now) {
      const s = N.snap(d, now);
      d.needs.play = Math.min(100, d.needs.play + (amount == null ? 40 : amount));
      d.needs.sleep = Math.max(0, d.needs.sleep - 4);
      if (s.asleep) N.wake(d, now);
      return s;
    },
    sleep(d, now) { now = now || Date.now(); const s = N.snap(d, now); if (!s.asleep) d.needs.sleepFrom = now; return s; },
    wake(d, now) {
      now = now || Date.now(); const s = N.snap(d, now);
      d.needs.sleepFrom = null;
      d.needs.sleep = Math.max(d.needs.sleep, N.threshold(d.loc) + 12);
      return s;
    },
    /** Через сколько секунд (игровых) низкая нужда закроется сама; null — если не низкая */
    autoIn(d, key, now) {
      now = now || Date.now();
      if (key === 'sleep') { const s = N.at(d, now); return s.asleep ? null : (s.sleep < N.LOW ? 0 : null); }
      const n = N.base(d, now), r = N.RATE[key], dt = Math.max(0, now - n.t) * N.speed / 1000, v0 = n[key];
      const t1 = (v0 - N.LOW) / r; if (dt < t1) return null;
      const P = N.AUTO + (N.REFILL - N.LOW) / r, x = (dt - t1) % P;
      return x < N.AUTO ? N.AUTO - x : null;
    },
    /** Общее самочувствие 0..100 */
    mood(s) { return Math.min(s.food, s.play, s.asleep ? 100 : s.sleep); },
    ICON: { food: '🍖', play: '🎾', sleep: '💤' },
    NAME: { food: 'Голод', play: 'Игра', sleep: 'Сон' }
  };
  function clamp(v) { return v < 0 ? 0 : v > 100 ? 100 : v; }
  /** Убывание с автозакрытием: v0 → LOW (обычное убывание), дальше период: AUTO секунд «нужда», затем REFILL и снова убывание */
  function decay(v0, r, dt) {
    const t1 = (v0 - N.LOW) / r;
    if (dt <= t1) return clamp(v0 - r * dt);
    const P = N.AUTO + (N.REFILL - N.LOW) / r, x = (dt - t1) % P;
    return x < N.AUTO ? clamp(N.LOW - r * x) : clamp(N.REFILL - r * (x - N.AUTO));
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function lows(food, play, e, asleep) { const o = []; if (food < N.LOW) o.push('food'); if (play < N.LOW) o.push('play'); if (!asleep && e < N.LOW) o.push('sleep'); return o; }
  // скрытые параметры для проверки: ?fast=N (только потребности) и ?speed=N (вся жизнь парка)
  try { const q = new URLSearchParams(location.search), f = q.get('speed') || q.get('fast') || localStorage.getItem('dp_fast'); if (f && +f > 0) N.speed = Math.min(5000, +f); } catch (e) { /* ignore */ }
  DP.Needs = N;
})();
