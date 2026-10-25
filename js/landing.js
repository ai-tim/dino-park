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
  const hero = new DP.Scene($('#hero-scene'), { entrance: false, tod: 'day' });
  hero.showNeeds = false;
  let i = 0;
  function show(k) {
    const b = LOCS[k % LOCS.length];
    hero.setBackground(b.id); hero.setDinos(dinos(b.id), true);
    $('#hero-loc').textContent = '📍 ' + b.name;
  }
  show(0);
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && !/[?&]still=1/.test(location.search)) setInterval(() => { i++; $('#hero-scene').classList.add('fade'); setTimeout(() => { show(i); $('#hero-scene').classList.remove('fade'); }, 600); }, 9000);
  // тап по динозавру в шапке — он подпрыгивает
  $('#hero-scene').addEventListener('click', (e) => { const r = e.target.getBoundingClientRect(); const en = hero.hit(e.clientX - r.left, e.clientY - r.top); if (en) hero.jump(en.uid); });

  // мини-телевизор
  const tv = new DP.Scene($('#tv-scene'), { entrance: false, tod: 'night' });
  tv.showNeeds = false; tv.setBackground('nightforest'); tv.setDinos(dinos('nightforest'), true);

  // превью листа-раскраски
  $('#lp-sheet').innerHTML = DP.Template.pageSVG('trex', 'outline', 'width="100%" viewBox="0 0 297 210" preserveAspectRatio="xMidYMid meet"');
  window.dpLanding = { hero, tv, show };
})();
