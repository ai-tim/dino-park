/* Динопарк — хранение парков в localStorage.
 * Парк: { id, pin, name, bg, customBg, dinos:[{uid, species, palette, sprite, name, diet, habitat}], created, updated }
 * sprite — dataURL фото-динозавра (уменьшенный), для готовых динозавров sprite = null.
 */
window.DP = window.DP || {};
(function () {
  const PK = 'dp_park_', LIST = 'dp_myparks', CUR = 'dp_current';
  const ls = window.localStorage;
  const S = {
    myIds() { try { return JSON.parse(ls.getItem(LIST) || '[]'); } catch (e) { return []; } },
    setMyIds(ids) { ls.setItem(LIST, JSON.stringify(ids)); },
    addMine(id) { const ids = S.myIds(); if (ids.indexOf(id) < 0) { ids.unshift(id); S.setMyIds(ids); } },
    removeMine(id) { S.setMyIds(S.myIds().filter(x => x !== id)); },
    myParks() { return S.myIds().map(S.get).filter(Boolean); },
    get(id) { try { return JSON.parse(ls.getItem(PK + id) || 'null'); } catch (e) { return null; } },
    save(park, keepTime) {
      if (!keepTime) park.updated = Date.now();
      try { ls.setItem(PK + park.id, JSON.stringify(park)); return true; }
      catch (e) {
        console.warn('localStorage переполнен', e);
        if (DP.util) DP.util.toast('⚠️ Не хватает места в памяти браузера. Уберите часть динозавров или фото-фон.', 5000);
        return false;
      }
    },
    remove(id) { ls.removeItem(PK + id); S.removeMine(id); if (S.current() === id) ls.removeItem(CUR); },
    current() { return ls.getItem(CUR); },
    setCurrent(id) { ls.setItem(CUR, id); },
    /** Код этого устройства: им помечаются «свои» динозавры (для тайного кормления) */
    owner() {
      let o = ls.getItem('dp_owner');
      if (!o || !/^[a-z0-9]{6,24}$/.test(o)) { o = 'o' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4); ls.setItem('dp_owner', o); }
      return o;
    },
    /** Приводит старые парки к формату v2: локации, потребности */
    normalize(p) {
      if (!p) return p;
      const OLD = { beach: 'lagoon', night: 'nightforest', underwater: 'lagoon' };
      const ok = (DP.BG && DP.BG.LIST) ? DP.BG.LIST.map(b => b.id) : ['jungle', 'lagoon', 'canyon', 'glacier', 'nightforest'];
      const fix = (v) => { v = OLD[v] || v; return ok.indexOf(v) >= 0 ? v : 'jungle'; };
      p.view = fix(p.view || p.bg); p.bg = p.view;
      if (p.customBg && !p.customLoc) p.customLoc = p.view;
      (p.dinos || []).forEach(d => { d.loc = fix(d.loc || p.view); });
      return p;
    },
    create(name) {
      const park = { id: DP.util.parkId(), pin: DP.util.pin(), name: (name || '').trim() || 'Парк', bg: 'jungle', view: 'jungle', customBg: null, customLoc: null, dinos: [], created: Date.now(), updated: Date.now() };
      S.save(park); S.addMine(park.id); return park;
    },
    // Временные 5-значные коды для ТВ в локальном режиме
    tvCodes() { try { return JSON.parse(ls.getItem('dp_tvcodes') || '{}'); } catch (e) { return {}; } },
    setTvCode(code, id, exp) {
      const all = S.tvCodes(), now = Date.now();
      Object.keys(all).forEach(c => { if (all[c].exp < now) delete all[c]; });
      all[code] = { id, exp }; ls.setItem('dp_tvcodes', JSON.stringify(all));
    }
  };
  DP.store = S;
})();
