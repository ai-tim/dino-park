/* Динопарк — «жизнь парка»: яйца, награды, племя австралопитеков, зверьки-млекопитающие,
 * подарки, достижения, приглашения. Чистая логика без рисования: всё хранится в park.life
 * и в полях динозавров, считается по меткам времени (прогресс идёт и пока приложение закрыто, с ограничением).
 * Темп нарочно медленный: яйцо — раз в несколько часов заботы, навыки — за дни. ?speed=N ускоряет (для проверки). */
window.DP = window.DP || {};
(function () {
  const H = 3600, D = 86400; // игровые секунды
  const now = () => Date.now();
  const speed = () => (DP.Needs ? DP.Needs.speed : 1);

  // ——— яйца ———
  const RARITY = [
    { id: 'common', name: 'Обычное', many: 'обычных', emoji: '🥚', p: 0.76, color: '#f3ead2', spot: '#b48a5a' },
    { id: 'rare', name: 'Редкое', many: 'редких', emoji: '💎', p: 0.19, color: '#9fd3ff', spot: '#3d7fc4' },
    { id: 'epic', name: 'Очень редкое', many: 'очень редких', emoji: '🔮', p: 0.045, color: '#c9a0ff', spot: '#7a3fd1' },
    { id: 'legend', name: 'Легендарное', many: 'легендарных', emoji: '🌟', p: 0.005, color: '#ffd43b', spot: '#d98b00' }
  ];
  const R = {}; RARITY.forEach(r => R[r.id] = r);
  const EGG = { minAge: 1 * H, gap: 3 * H, care: 5, mood: 35, nestLife: 20 * 60 * 1000 };
  const OFFLINE_CAP = 12 * H * 1000; // офлайн засчитывается не больше 12 часов (и вполсилы)

  // ——— награды за яйца ———
  const HATS = [
    { id: 'cap', name: 'Кепка', cost: { common: 3 } },
    { id: 'bow', name: 'Бантик', cost: { common: 4 } },
    { id: 'flower', name: 'Цветочек', cost: { common: 6 } },
    { id: 'sunhat', name: 'Шляпка', cost: { rare: 2 } },
    { id: 'helmet', name: 'Каска спасателя', cost: { rare: 3 } },
    { id: 'grad', name: 'Шапочка учёного', cost: { rare: 2, common: 4 } },
    { id: 'tophat', name: 'Цилиндр', cost: { epic: 1, rare: 2 } },
    { id: 'crown', name: 'Корона', cost: { epic: 3 }, alt: { legend: 1 } }
  ];
  const HAT = {}; HATS.forEach(h => HAT[h.id] = h);
  const TRADES = [
    { id: 'up1', name: '6 обычных → 1 редкое', give: { common: 6 }, get: { rare: 1 } },
    { id: 'up2', name: '5 редких → 1 очень редкое', give: { rare: 5 }, get: { epic: 1 } }
  ];
  const LEGEND_COST = { epic: 5 }, LEGEND_ALT = { legend: 2 };

  // ——— зверьки и племя ———
  const MAMMALS = [
    { kind: 'shrew', name: 'Землеройка', sci: 'морганукодон', emoji: '🐁', at: 40 * 60, col: '#8a6a52', belly: '#d9c2a6', size: 0.22 },
    { kind: 'squirrel', name: 'Летяга', sci: 'воланотерий', emoji: '🐿️', at: 4 * H, col: '#a0663a', belly: '#f0d2a8', size: 0.24 },
    { kind: 'beaver', name: 'Бобрёнок', sci: 'кастрокауда', emoji: '🦫', at: 12 * H, col: '#6b4a32', belly: '#b08a68', size: 0.28 },
    { kind: 'hedgehog', name: 'Ёжик', sci: 'древний ёж', emoji: '🦔', at: 1 * D, col: '#7a6a5a', belly: '#e6d3b8', size: 0.24 },
    { kind: 'badger', name: 'Барсучок', sci: 'репеномам', emoji: '🦡', at: 2 * D, col: '#5a5a62', belly: '#e8e8ea', size: 0.32 }
  ];
  const APES = [
    { name: 'Ук', at: 3 * H, need: 2 },
    { name: 'Ага', at: 2 * D, need: 3 },
    { name: 'Тоба', at: 0, need: 4, chief: true } // приходит, когда кто-то стал вождём
  ];
  // дерево навыков австралопитека (время — игровой «стаж» самого австралопитека)
  const SKILLS = [
    { id: 'walk', e: '🚶', name: 'Прямохождение', at: 0, desc: 'Ходит на двух ногах, как мы' },
    { id: 'berries', e: '🫐', name: 'Собирает ягоды', at: 1 * H, req: 'walk', desc: 'Иногда угощает травоядных ягодами' },
    { id: 'stick', e: '🪵', name: 'Палка-копалка', at: 4 * H, req: 'berries', desc: 'Выкапывает корешки, носит палку' },
    { id: 'stone', e: '🪨', name: 'Каменный топор', at: 10 * H, req: 'stick', desc: 'Первое орудие труда' },
    { id: 'fire', e: '🔥', name: 'Добыл огонь', at: 1 * D, req: 'stone', desc: 'У стоянки горит костёр' },
    { id: 'feed', e: '🍖', name: 'Кормит динозавров', at: 1.5 * D, req: 'fire', desc: 'Сам подкармливает голодных' },
    { id: 'drum', e: '🥁', name: 'Барабан', at: 2 * D, req: 'fire', desc: 'Играет со скучающими динозаврами' },
    { id: 'hut', e: '🛖', name: 'Строит шалаш', at: 3 * D, req: 'stone', desc: 'Появляется шалаш' },
    { id: 'tailor', e: '🧵', name: 'Шляпник', at: 5 * D, req: 'hut', desc: 'Шапки за яйца — дешевле на одно обычное' },
    { id: 'ride', e: '🏇', name: 'Катается на динозавре', at: 5 * D, req: 'feed', desc: 'Подружился и катается верхом (нужно 3+ динозавра)', cond: (p) => p.dinos.length >= 3 },
    { id: 'paint', e: '🎨', name: 'Наскальные рисунки', at: 7 * D, req: 'fire', desc: 'Рисует динозавров на камнях' },
    { id: 'eggs', e: '🧺', name: 'Ищет яйца', at: 10 * D, req: 'ride', desc: 'Раз в день находит обычное яйцо' },
    { id: 'chief', e: '⭐', name: 'Вождь', at: 14 * D, req: 'eggs', desc: 'Зовёт в парк ещё одного австралопитека' }
  ];
  const SK = {}; SKILLS.forEach(s => SK[s.id] = s);

  // ——— подарки от динозавров (редко: нужна любовь и перерыв ≥ 6 ч) ———
  const GIFTS = [
    { id: 'shell', e: '🐚', name: 'Ракушка', r: 'common' }, { id: 'flower', e: '🌼', name: 'Цветок', r: 'common' },
    { id: 'pebble', e: '🪨', name: 'Гладкий камешек', r: 'common' }, { id: 'feather', e: '🪶', name: 'Пёрышко', r: 'common' },
    { id: 'leaf', e: '🍁', name: 'Красивый лист', r: 'common' }, { id: 'mushroom', e: '🍄', name: 'Грибок', r: 'common' },
    { id: 'nut', e: '🌰', name: 'Орешек', r: 'common' }, { id: 'bone', e: '🦴', name: 'Косточка', r: 'common' },
    { id: 'crystal', e: '💠', name: 'Кристалл', r: 'rare' }, { id: 'tooth', e: '🦷', name: 'Зуб динозавра', r: 'rare' },
    { id: 'amber', e: '🟠', name: 'Янтарь с мушкой', r: 'rare' }, { id: 'star', e: '⭐', name: 'Звёздочка', r: 'rare' },
    { id: 'ammonite', e: '🐌', name: 'Аммонит', r: 'epic' }, { id: 'meteor', e: '☄️', name: 'Метеорит', r: 'epic' },
    { id: 'gold', e: '🏅', name: 'Золотой самородок', r: 'epic' }
  ];
  const GIFT = {}; GIFTS.forEach(g => GIFT[g.id] = g);
  const GIFT_RULE = { aff: 8, gap: 6 * H, first: 2 * H, chance: 0.12 };

  // ——— достижения ———
  const A = (id, e, name, desc, goal, val, reward) => ({ id, e, name, desc, goal, val, reward });
  const st = (k) => (L) => L.stats[k] || 0;
  const ACH = [
    A('first', '🦖', 'Первый друг', 'Запусти первого динозавра', 1, (L, p) => p.dinos.length, { common: 1 }),
    A('herd', '🦕', 'Своя стая', '5 динозавров в парке', 5, (L, p) => p.dinos.length, { common: 1 }),
    A('artist', '🖍️', 'Художник', 'Оживи свой рисунок с фото', 1, (L, p) => p.dinos.filter(d => d.sprite).length + (L.stats.photo || 0) * 0, { rare: 1 }),
    A('feeder', '🍖', 'Кормилец', 'Покорми динозавров 30 раз', 30, st('feed'), { common: 1 }),
    A('player', '🎾', 'Весельчак', 'Поиграй 30 раз', 30, st('play'), { common: 1 }),
    A('lullaby', '💤', 'Колыбельная', 'Уложи спать 15 раз', 15, st('sleep'), { common: 1 }),
    A('egg1', '🥚', 'Первое яйцо', 'Собери первое яйцо', 1, st('eggs')),
    A('basket', '🧺', 'Полная корзина', 'Собери 15 яиц', 15, st('eggs'), { rare: 1 }),
    A('rare', '💎', 'Редкая находка', 'Найди редкое яйцо', 1, st('rare')),
    A('epic', '🔮', 'Чудо-яйцо', 'Найди очень редкое яйцо', 1, st('epic')),
    A('legend', '🌟', 'Легенда', 'Легендарное яйцо или золотой динозавр', 1, (L, p) => (L.stats.legend || 0) + p.dinos.filter(d => d.legend).length),
    A('hat', '🎩', 'Модник', 'Надень на динозавра шапку', 1, st('hats')),
    A('seeker', '🙈', 'Сыщик', 'Найди динозавра в прятках 5 раз', 5, st('found'), { rare: 1 }),
    A('gift', '🎁', 'Любимчик', 'Получи подарок от своего динозавра', 1, st('gifts')),
    A('travel', '🧭', 'Путешественник', 'Побывай во всех 5 локациях', 5, (L) => (L.locs || []).length, { common: 1 }),
    A('duo', '💞', 'Не разлей вода', 'Динозавры поиграли вместе 10 раз', 10, st('duo')),
    A('closeup', '🔍', 'Крупный план', 'Рассмотри динозавра вблизи', 1, st('closeup')),
    A('neighbors', '🐿️', 'Соседи', 'В парке живут 3 зверька', 3, (L) => L.mammals.length),
    A('tribe', '🐒', 'Племя', 'В парк пришёл австралопитек', 1, (L) => L.tribe.length),
    A('fire', '🔥', 'Прометей', 'Австралопитек добыл огонь', 1, (L) => L.tribe.some(a => a.sk.includes('fire')) ? 1 : 0, { rare: 1 }),
    A('rider', '🏇', 'Наездник', 'Австралопитек оседлал динозавра', 1, (L) => L.tribe.some(a => a.sk.includes('ride')) ? 1 : 0, { epic: 1 }),
    A('friend', '🤝', 'Позови друга', 'Друг создал парк по твоей ссылке', 1, st('invites'), { rare: 1 }),
    A('share', '📣', 'Расскажи всем', 'Поделись парком в 3 разные дни', 3, st('shares')),
    A('tv', '📺', 'Кинозал', 'Открой парк на другом экране', 1, st('tv')),
    A('loyal', '📅', 'Верный друг', 'Заходи в парк 7 разных дней', 7, (L) => L.stats.days || 0, { rare: 1 })
  ];

  // ——— вспомогательное ———
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const gs = (ms) => ms * speed() / 1000; // реальные мс → игровые секунды

  function ensure(park) {
    const L = park.life = park.life && typeof park.life === 'object' ? park.life : {};
    L.eggs = Object.assign({ common: 0, rare: 0, epic: 0, legend: 0 }, L.eggs || {});
    ['nest', 'tribe', 'mammals', 'gifts', 'redeemed', 'ach', 'inbox', 'ack', 'locs'].forEach(k => { if (!Array.isArray(L[k])) L[k] = []; });
    L.stats = L.stats || {}; L.hats = L.hats || {}; L.acc = L.acc || {}; L.tokens = L.tokens || {};
    if (typeof L.age !== 'number') L.age = 0;
    if (typeof L.t !== 'number') L.t = now();
    L.tribe.forEach(a => { if (!Array.isArray(a.sk)) a.sk = ['walk']; if (typeof a.xp !== 'number') a.xp = 0; });
    L.mammals.forEach(m => { if (typeof m.xp !== 'number') m.xp = 0; });
    return L;
  }
  const total = (L) => RARITY.reduce((s, r) => s + (L.eggs[r.id] || 0), 0);
  const canPay = (L, cost) => Object.keys(cost).every(k => (L.eggs[k] || 0) >= cost[k]);
  const pay = (L, cost) => { if (!canPay(L, cost)) return false; Object.keys(cost).forEach(k => L.eggs[k] -= cost[k]); return true; };
  const addEggs = (L, eggs) => Object.keys(eggs || {}).forEach(k => { if (R[k]) L.eggs[k] = (L.eggs[k] || 0) + eggs[k]; });
  const costText = (cost) => Object.keys(cost).map(k => cost[k] + ' ' + R[k].emoji).join(' + ');
  function hatCost(L, h) {
    const c = Object.assign({}, h.cost);
    if (L.tribe.some(a => a.sk.includes('tailor')) && c.common) c.common = Math.max(1, c.common - 1); // шляпник
    return c;
  }
  function rollRarity(seed, boost) {
    let r = hash(seed); if (boost) r *= boost;
    let acc = 0; for (let i = RARITY.length - 1; i >= 0; i--) { acc += RARITY[i].p; if (r < acc) return RARITY[i].id; }
    return 'common';
  }
  function rollGift(seed) {
    const r = rollRarity(seed + 'g'), pool = GIFTS.filter(g => g.r === (r === 'legend' ? 'epic' : r));
    return pool[Math.floor(hash(seed + 'i') * pool.length)] || GIFTS[0];
  }

  // ——— забота: каждое осмысленное действие даёт «очки заботы» (для яиц) и «любовь» (для подарков) ———
  /** kind: 'feed' | 'play' | 'sleep' | 'found'; before — состояние потребностей до действия; mine — мой динозавр */
  function care(park, d, kind, before, mine, t) {
    t = t || now(); const L = ensure(park), ev = [];
    L.stats[kind] = (L.stats[kind] || 0) + 1;
    const meaningful = !before || kind === 'found' || (kind === 'feed' ? before.food < 80 : kind === 'play' ? before.play < 80 : kind === 'sleep' ? before.sleep < 70 : true);
    if (meaningful) {
      d.care = Math.min(30, (d.care || 0) + (kind === 'found' ? 2 : 1));
      d.aff = Math.min(40, (d.aff || 0) + 1);
    }
    if (mine && meaningful && (d.aff || 0) >= GIFT_RULE.aff) {
      const since = d.lastGift ? gs(t - d.lastGift) : gs(t - (d.added || t));
      if (since >= (d.lastGift ? GIFT_RULE.gap : GIFT_RULE.first) && Math.random() < GIFT_RULE.chance && !L.nest.some(n => n.k === 'gift' && n.uid === d.uid)) {
        const g = rollGift(d.uid + ':' + (d.giftN || 0));
        d.giftN = (d.giftN || 0) + 1; d.lastGift = t; d.aff = 0;
        const item = { id: 'g' + d.uid.slice(-4) + d.giftN, k: 'gift', uid: d.uid, g: g.id, t };
        L.nest.push(item); ev.push({ type: 'giftDrop', item, d });
      }
    }
    return ev;
  }
  /** Может ли динозавр снести яйцо прямо сейчас */
  function canLay(park, d, t) {
    if (!DP.Needs) return false;
    const age = gs(t - (d.added || t)); if (age < EGG.minAge) return false;
    if (d.lastEgg && gs(t - d.lastEgg) < EGG.gap) return false;
    if ((d.care || 0) < EGG.care) return false;
    const s = DP.Needs.at(d, t); if (s.asleep || DP.Needs.mood(s) < EGG.mood) return false;
    return !park.life.nest.some(n => n.k === 'egg' && n.uid === d.uid);
  }
  function lay(park, d, t) {
    const L = park.life, s = DP.Needs.at(d, t);
    const boost = (d.legend ? 0.5 : 1) * ((d.care || 0) >= 12 ? 0.8 : 1) * (Math.min(s.food, s.play, s.sleep) > 70 ? 0.85 : 1);
    const r = rollRarity(park.id + ':' + d.uid + ':' + (d.eggN || 0), boost);
    d.eggN = (d.eggN || 0) + 1; d.lastEgg = t; d.care = 0;
    const egg = { id: 'e' + d.uid.slice(-5) + d.eggN, k: 'egg', uid: d.uid, r, t };
    L.nest.push(egg);
    return egg;
  }
  /** Подобрать яйцо или подарок с земли */
  function collect(park, id) {
    const L = ensure(park), i = L.nest.findIndex(n => n.id === id); if (i < 0) return null;
    const it = L.nest.splice(i, 1)[0];
    if (it.k === 'egg') { L.eggs[it.r] = (L.eggs[it.r] || 0) + 1; L.stats.eggs = (L.stats.eggs || 0) + 1; if (it.r !== 'common') L.stats[it.r] = (L.stats[it.r] || 0) + 1; }
    else if (it.k === 'gift') { const d = park.dinos.find(x => x.uid === it.uid); L.gifts.unshift({ g: it.g, from: d ? d.name : '', uid: it.uid, t: now() }); L.gifts = L.gifts.slice(0, 200); L.stats.gifts = (L.stats.gifts || 0) + 1; }
    return it;
  }

  /** Главный «тик» жизни парка. Возвращает события для показа. */
  function tick(park, t, opts) {
    t = t || now(); opts = opts || {};
    const L = ensure(park), ev = [];
    const dt = Math.max(0, t - L.t); L.t = t;
    const online = dt <= 3 * 60 * 1000;
    let credit = park.dinos.length ? gs(online ? dt : Math.min(dt, OFFLINE_CAP) * 0.5) : 0;
    L.age += credit;
    // учёт дней и локаций
    const dk = dayKey(t); if (L.day !== dk) { L.day = dk; L.stats.days = (L.stats.days || 0) + 1; }
    if (park.view && L.locs.indexOf(park.view) < 0 && park.view !== 'custom') L.locs.push(park.view);
    const jit = (i) => 0.8 + hash(park.id + 'j' + i) * 0.4;
    // зверьки приходят сами
    MAMMALS.forEach((m, i) => {
      if (L.mammals.length === i && park.dinos.length && L.age >= m.at * jit(i)) {
        const a = { id: 'm' + i, kind: m.kind, name: m.name, xp: 0, t };
        L.mammals.push(a); ev.push({ type: 'mammal', m: a, def: m });
      }
    });
    // австралопитеки
    APES.forEach((ap, i) => {
      if (L.tribe.length !== i || park.dinos.length < ap.need) return;
      const ok = ap.chief ? L.tribe.some(a => a.sk.includes('chief')) : L.age >= ap.at * jit(10 + i);
      if (ok) { const a = { id: 'a' + i, name: ap.name, xp: 0, sk: ['walk'], t }; L.tribe.push(a); ev.push({ type: 'ape', a }); }
    });
    L.mammals.forEach(m => { m.xp += credit; });
    L.tribe.forEach(a => {
      a.xp += credit;
      SKILLS.forEach(s => {
        if (a.sk.includes(s.id) || a.xp < s.at || (s.req && !a.sk.includes(s.req)) || (s.cond && !s.cond(park))) return;
        a.sk.push(s.id); ev.push({ type: 'skill', a, s });
      });
    });
    // дела племени (засчитываются только «в игре», чтобы не копить за ночь)
    const has = (id) => L.tribe.find(a => a.sk.includes(id));
    const acc = (k, every, fn) => { if (!online) return; L.acc[k] = (L.acc[k] || 0) + credit; if (L.acc[k] >= every) { L.acc[k] = 0; fn(); } };
    const here = park.dinos.filter(d => d.loc === park.view);
    if (DP.Needs) {
      const berries = has('berries');
      if (berries) acc('berries', 40 * 60, () => { const d = here.filter(x => x.diet !== 'carn' && DP.Needs.at(x, t).food < 60)[0]; if (d) { DP.Needs.feed(d, 15, t); ev.push({ type: 'tribeFeed', a: berries, d, what: '🫐' }); } });
      const feeder = has('feed');
      if (feeder) acc('feed', 30 * 60, () => { const d = here.map(x => [x, DP.Needs.at(x, t)]).filter(x => !x[1].asleep && x[1].food < 45).sort((a, b) => a[1].food - b[1].food)[0]; if (d) { DP.Needs.feed(d[0], 25, t); ev.push({ type: 'tribeFeed', a: feeder, d: d[0], what: '🍖' }); } });
      const drum = has('drum');
      if (drum) acc('drum', 40 * 60, () => { const d = here.map(x => [x, DP.Needs.at(x, t)]).filter(x => !x[1].asleep && x[1].play < 45).sort((a, b) => a[1].play - b[1].play)[0]; if (d) { DP.Needs.play(d[0], 20, t); ev.push({ type: 'tribePlay', a: drum, d: d[0] }); } });
    }
    const finder = has('eggs');
    if (finder) acc('eggfind', D, () => { L.eggs.common++; L.stats.eggs = (L.stats.eggs || 0) + 1; ev.push({ type: 'tribeEgg', a: finder }); });
    // яйца: проверяем динозавров текущей локации
    if (online && opts.lay !== false) here.forEach(d => { if (canLay(park, d, t)) ev.push({ type: 'egg', egg: lay(park, d, t), d }); });
    // забытые на земле яйца и подарки сами попадают в корзину
    L.nest.slice().forEach(n => { if (t - n.t > EGG.nestLife) { const it = collect(park, n.id); if (it) ev.push({ type: 'autoCollect', item: it }); } });
    ev.push(...checkAch(park));
    return ev;
  }
  function checkAch(park) {
    const L = ensure(park), ev = [];
    ACH.forEach(a => {
      if (L.ach.indexOf(a.id) >= 0) return;
      if (a.val(L, park) >= a.goal) { L.ach.push(a.id); if (a.reward) addEggs(L, a.reward); ev.push({ type: 'ach', a }); }
    });
    return ev;
  }

  // ——— обмен ———
  function buyHat(park, id) {
    const L = ensure(park), h = HAT[id]; if (!h) return false;
    const c = hatCost(L, h);
    if (!pay(L, c) && !(h.alt && pay(L, h.alt))) return false;
    L.hats[id] = (L.hats[id] || 0) + 1; return true;
  }
  const hatFree = (park, id) => (ensure(park).hats[id] || 0) - park.dinos.filter(d => d.hat === id).length;
  function trade(park, id) { const L = ensure(park), tr = TRADES.find(x => x.id === id); if (!tr || !pay(L, tr.give)) return false; addEggs(L, tr.get); return true; }
  function buyLegend(park) { const L = ensure(park); if (L.tokens.legend > 0) { L.tokens.legend--; return true; } return pay(L, LEGEND_COST) || pay(L, LEGEND_ALT); }

  // ——— подарочные коды администратора (ECDSA P-256, проверка открытым ключом из config.js) ———
  const b64u = {
    enc(bytes) { let s = ''; bytes = new Uint8Array(bytes); for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
    dec(str) { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; const s = atob(str), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  };
  const utf8 = (s) => new TextEncoder().encode(s);
  function parseCode(code) {
    code = String(code || '').trim().replace(/\s+/g, '');
    const m = /^DP1\.([A-Za-z0-9_-]{8,700})\.([A-Za-z0-9_-]{80,90})$/.exec(code); if (!m) return null;
    try { return { body: 'DP1.' + m[1], sig: b64u.dec(m[2]), payload: JSON.parse(new TextDecoder().decode(b64u.dec(m[1]))) }; } catch (e) { return null; }
  }
  function validGift(g) {
    if (!g || typeof g !== 'object') return false;
    if (g.k === 'eggs') return !!R[g.r] && Number.isInteger(g.q) && g.q > 0 && g.q <= 50;
    if (g.k === 'hat') return !!HAT[g.h];
    if (g.k === 'legend') return true;
    if (g.k === 'item') return typeof g.e === 'string' && g.e.length <= 8 && typeof g.t === 'string' && g.t.length <= 40;
    return false;
  }
  async function verifyCode(code, parkId) {
    const c = parseCode(code); if (!c) throw new Error('Код не похож на подарочный');
    const key = (window.DP_CONFIG || {}).ADMIN_PUBLIC_KEY;
    if (!key || !window.crypto || !crypto.subtle) throw new Error('Проверка кодов недоступна в этом браузере');
    const k = await crypto.subtle.importKey('jwk', Object.assign({ ext: true }, key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, c.sig, utf8(c.body));
    if (!ok) throw new Error('Неверная подпись — код ненастоящий');
    const p = c.payload;
    if (!p || typeof p.n !== 'string' || !validGift(p.g)) throw new Error('Код повреждён');
    if (p.e && now() > p.e) throw new Error('Срок действия кода истёк');
    if (p.p && parkId && p.p !== parkId) throw new Error('Этот код для другого парка');
    return p;
  }
  /** Выдать подарок (от администратора или по коду) */
  function grant(park, g, msg, from) {
    const L = ensure(park);
    if (g.k === 'eggs') addEggs(L, { [g.r]: g.q });
    else if (g.k === 'hat') L.hats[g.h] = (L.hats[g.h] || 0) + 1;
    else if (g.k === 'legend') L.tokens.legend = (L.tokens.legend || 0) + 1;
    L.gifts.unshift({ adm: 1, g: g.k === 'item' ? null : g.k, e: giftEmoji(g), name: giftName(g), msg: msg ? String(msg).slice(0, 140) : '', from: from || 'Динопарк', t: now() });
    L.gifts = L.gifts.slice(0, 200);
  }
  function giftEmoji(g) { return g.k === 'eggs' ? R[g.r].emoji : g.k === 'hat' ? (DP.Scene && DP.Scene.HATS[g.h]) || '🎩' : g.k === 'legend' ? '🌟' : g.e; }
  function giftName(g) { return g.k === 'eggs' ? `${g.q} × ${R[g.r].name.toLowerCase()} яйцо` : g.k === 'hat' ? HAT[g.h].name : g.k === 'legend' ? 'Легендарный динозавр' : g.t; }
  /** Применить подарки администратора из серверного «ящика» (park.life.inbox) */
  function applyInbox(park) {
    const L = ensure(park), out = [];
    L.inbox.forEach(it => { if (!it || L.ack.indexOf(it.id) >= 0 || !validGift(it.g)) return; grant(park, it.g, it.m, 'Динопарк'); L.ack.push(it.id); out.push(it); });
    if (out.length) { L.inbox = L.inbox.filter(it => L.ack.indexOf(it.id) < 0); L.ack = L.ack.slice(-100); }
    return out;
  }

  // ——— приглашения и «поделиться» ———
  function refKey() { let k = localStorage.getItem('dp_refkey'); if (!k) { const b = new Uint8Array(16); crypto.getRandomValues(b); k = Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); localStorage.setItem('dp_refkey', k); } return k; }
  async function myRef() {
    let r = localStorage.getItem('dp_ref'); if (r) return r;
    const k = refKey();
    try { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8('dp-ref:' + k))); r = Array.from(h.slice(0, 5), x => x.toString(16).padStart(2, '0')).join(''); }
    catch (e) { r = Math.floor(hash(k) * 1e12).toString(16).padStart(10, '0').slice(0, 10); }
    localStorage.setItem('dp_ref', r); return r;
  }
  /** Ссылка-приглашение: ведёт на главную с кодом пригласившего */
  async function inviteUrl() { const u = new URL('index.html', location.href); u.search = '?ref=' + (await myRef()); return u.toString(); }
  /** На этом устройстве созданы парки по моей ссылке? (локальный режим) — забрать награду */
  async function claimLocalInvites(park) {
    const me = await myRef(), L = ensure(park);
    let q = []; try { q = JSON.parse(localStorage.getItem('dp_invites') || '[]'); } catch (e) { q = []; }
    const mine = q.filter(x => x.ref === me && !x.claimed && x.park !== park.id);
    mine.slice(0, 3).forEach(x => { x.claimed = park.id; L.eggs.rare++; L.stats.invites = (L.stats.invites || 0) + 1; });
    if (mine.length) localStorage.setItem('dp_invites', JSON.stringify(q.slice(-50)));
    return Math.min(3, mine.length);
  }
  function shareReward(park, t) {
    const L = ensure(park), dk = dayKey(t || now());
    if (L.shareDay === dk) return false;
    L.shareDay = dk; L.eggs.common++; L.stats.shares = (L.stats.shares || 0) + 1; return true;
  }

  DP.Life = {
    H, D, RARITY, R, EGG, HATS, HAT, TRADES, LEGEND_COST, LEGEND_ALT, MAMMALS, APES, SKILLS, SK, GIFTS, GIFT, GIFT_RULE, ACH,
    ensure, tick, care, canLay, lay, collect, checkAch, total, canPay, pay, addEggs, costText, hatCost, buyHat, hatFree, trade, buyLegend,
    rollRarity, rollGift, hash, dayKey, parseCode, verifyCode, validGift, grant, giftEmoji, giftName, applyInbox, b64u,
    refKey, myRef, inviteUrl, claimLocalInvites, shareReward
  };
})();
