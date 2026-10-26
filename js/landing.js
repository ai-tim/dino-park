/* Динопарк — посадочная страница: живая сцена в шапке (локации сменяются), мини-ТВ и превью раскраски. */
(function () {
  const $ = (s) => document.querySelector(s);
  const LOCS = DP.BG.LIST;
  const cast = {
    jungle: ['trex', 'triceratops', 'brachiosaurus', 'pterodactyl', 'velociraptor'],
    lagoon: ['plesiosaur', 'parasaurolophus', 'stegosaurus', 'pterodactyl'],
    canyon: ['stegosaurus', 'velociraptor', 'ankylosaurus', 'trex'],
    glacier: ['ankylosaurus', 'brachiosaurus', 'triceratops', 'plesiosaur'],
    nightforest: ['triceratops', 'parasaurolophus', 'velociraptor', 'pterodactyl']
  };
  const dinos = (loc) => (cast[loc] || cast.jungle).map((sp, i) => ({ uid: loc + i, species: sp, palette: i % 2, needs: DP.Needs ? DP.Needs.fresh(Date.now()) : null, loc }));
  const PERF = DP.Scene.PERF, still = PERF.reduce || /[?&]still=1/.test(location.search);
  const hero = DP.makeScene($('#hero-scene'), { entrance: false, tod: 'day', bg: LOCS[0].id, maxFps: PERF.mobile ? 30 : 0 });
  hero.showNeeds = false;
  let i = 0;
  function show(k) {
    const b = LOCS[k % LOCS.length];
    hero.setBackground(b.id); hero.setDinos(dinos(b.id), true);
    $('#hero-loc').textContent = '📍 ' + b.name;
  }
  show(0);
  // смена локаций в шапке (не при «уменьшить движение»; на телефоне — реже и только пока шапку видно)
  if (!still) setInterval(() => {
    if (document.hidden || hero._offscreen) return;
    i++; $('#hero-scene').classList.add('fade'); setTimeout(() => { show(i); $('#hero-scene').classList.remove('fade'); }, 600);
  }, PERF.mobile ? 12000 : 9000);
  // тап по динозавру в шапке — он подпрыгивает
  $('#hero-scene').addEventListener('click', (e) => { const r = e.target.getBoundingClientRect(); const en = hero.hitScreen(e.clientX - r.left, e.clientY - r.top); if (en) hero.jump(en.uid); });

  // мини-телевизор: запускаем, только когда до него долистали
  const api = { hero, tv: null, show };
  function startTv() {
    if (api.tv) return;
    const tv = api.tv = new DP.Scene($('#tv-scene'), { entrance: false, tod: 'night', bg: 'nightforest', maxDpr: 1.5, maxFps: PERF.mobile ? 24 : 0 });
    tv.showNeeds = false; tv.setBackground('nightforest'); tv.setDinos(dinos('nightforest'), true);
  }
  if (window.IntersectionObserver) {
    const io = new IntersectionObserver((en) => { if (en.some(x => x.isIntersecting)) { io.disconnect(); startTv(); } }, { rootMargin: '300px 0px' });
    io.observe($('#tv-scene'));
  } else setTimeout(startTv, 3000);

  // превью листа-раскраски
  $('#lp-sheet').innerHTML = DP.Template.pageSVG('trex', 'outline', 'width="100%" viewBox="0 0 297 210" preserveAspectRatio="xMidYMid meet"');
  window.dpLanding = api;
  if (window.DPBOOT) window.DPBOOT.ready = true; // загрузчик (js/boot.js): страница запустилась
})();
