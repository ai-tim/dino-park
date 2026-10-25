/* Динопарк — раскладка листа-раскраски A4 (альбомная, мм).
 * Используется и для печати (coloring.html), и для распознавания фото (photo.js).
 * 4 чёрных квадратных маркера по углам + код шаблона из 7 клеток внизу слева:
 * [страж=1][b3][b2][b1][b0][чётность][страж=1], значение = индекс вида + 1.
 * v2: код вида продублирован в каждом угловом маркере — окошко 3×3 клетки по 2.5 мм:
 *   [1][b3][0]
 *   [b2][b1][b0]    углы (1,0,0,0) задают ориентацию, центр нижнего ряда — чётность.
 *   [0][p ][0]
 * Так вид читается, даже если полоска кода закрыта или помята, и по любой одной метке.
 */
window.DP = window.DP || {};
(function () {
  const T = {
    PAGE: { w: 297, h: 210 },
    MARK: { size: 14, centers: [[20, 20], [277, 20], [277, 190], [20, 190]] }, // по часовой стрелке от левого верхнего
    AREA: { x: 35, y: 28, w: 227, h: 144 },
    CODE: { x: 35, y: 185, cell: 5, step: 7, n: 7 },
    BLANK: [[45, 20], [252, 20], [148.5, 178], [90, 178], [207, 178]],
    encode(index) {
      const v = (index + 1) & 15;
      const bits = [(v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1];
      const par = bits.reduce((a, b) => a ^ b, 0);
      return [1].concat(bits, [par, 1]);
    },
    decode(cells) {
      if (cells.length !== 7 || !cells[0] || !cells[6]) return -1;
      const bits = cells.slice(1, 5), par = bits.reduce((a, b) => a ^ b, 0);
      if (par !== cells[5]) return -1;
      const v = bits[0] * 8 + bits[1] * 4 + bits[2] * 2 + bits[3];
      return v >= 1 ? v - 1 : -1;
    },
    MCELL: 2.5,
    /** 9 клеток маркера (строка, столбец) → бит; null — ориентир */
    markerBits(index) {
      const v = (index + 1) & 15, b = [(v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1], p = b.reduce((x, y) => x ^ y, 0);
      return [[1, b[0], 0], [b[1], b[2], b[3]], [0, p, 0]];
    },
    markerDecode(g) { // g — 3×3 из 0/1
      if (g[0][0] !== 1 || g[0][2] !== 0 || g[2][0] !== 0 || g[2][2] !== 0) return -1;
      const b = [g[0][1], g[1][0], g[1][1], g[1][2]], p = b.reduce((x, y) => x ^ y, 0);
      if (p !== g[2][1]) return -1;
      const v = b[0] * 8 + b[1] * 4 + b[2] * 2 + b[3];
      return v >= 1 ? v - 1 : -1;
    },
    /** Центр клетки (r,c) маркера k в мм листа */
    markerCell(k, r, c) { const [x, y] = T.MARK.centers[k], s = T.MCELL; return [x + (c - 1) * s, y + (r - 1) * s]; },
    cellCenter(i) { const c = T.CODE; return [c.x + i * c.step + c.cell / 2, c.y + c.cell / 2]; },
    /** SVG целого листа. mode: 'outline' (для печати) | 'color' (для тестов) */
    pageSVG(speciesId, mode, attrs) {
      const sp = DP.Dinos.byId[speciesId];
      const m = T.MARK, s = m.size, a = T.AREA, c = T.CODE;
      let o = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${T.PAGE.w} ${T.PAGE.h}" ${attrs || 'width="297mm" height="210mm"'}>`;
      o += `<rect width="${T.PAGE.w}" height="${T.PAGE.h}" fill="#fff"/>`;
      const g = T.markerBits(sp.index), cs = T.MCELL;
      m.centers.forEach(([x, y]) => {
        o += `<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" fill="#000"/>`;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (!g[r][c]) o += `<rect x="${x + (c - 1.5) * cs}" y="${y + (r - 1.5) * cs}" width="${cs}" height="${cs}" fill="#fff"/>`;
      });
      T.encode(sp.index).forEach((bit, i) => {
        o += `<rect x="${c.x + i * c.step}" y="${c.y}" width="${c.cell}" height="${c.cell}" fill="${bit ? '#000' : '#fff'}" stroke="#000" stroke-width="0.3"/>`;
      });
      o += `<text x="148.5" y="19" text-anchor="middle" font-family="Nunito, Arial, sans-serif" font-size="7" font-weight="800" fill="#222">Раскрась меня ярко!</text>`;
      o += `<rect x="${a.x - 3}" y="${a.y - 3}" width="${a.w + 6}" height="${a.h + 6}" rx="6" fill="none" stroke="#bbb" stroke-width="0.4" stroke-dasharray="2 2"/>`;
      o += `<svg x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" viewBox="0 0 400 254">${DP.Dinos.inner(speciesId, mode || 'outline', 0)}</svg>`;
      o += `<text x="148.5" y="195" text-anchor="middle" font-family="Nunito, Arial, sans-serif" font-size="6" font-weight="700" fill="#333">${sp.name} · Динопарк</text>`;
      o += `<text x="262" y="195" text-anchor="end" font-family="Nunito, Arial, sans-serif" font-size="3" fill="#777">Не закрашивай чёрные квадраты</text>`;
      return o + '</svg>';
    }
  };
  DP.Template = T;
})();
