/* Динопарк — готовые динозавры: «бумажные марионетки» в SVG.
 * Анатомичные силуэты, градиентная светотень, чешуя (pattern), полосы/пятна, бумажная кромка и зерно бумаги.
 * Каждый вид разбит на части (ноги, хвост, тело, голова/шея, крылья, ласты) с точками вращения —
 * сцена анимирует шаг, взмах хвоста и кивки головы. Режимы: color / outline (раскраска) / mask (вырезание фото).
 * Токены частей: B тело, F дальние конечности, L живот, A акцент (пластины, воротник), D дальние пластины,
 * H рога/когти/зубы, M узоры, S мягкая тень, G блик, N линия, K складка кожи, E глаз.
 * v2: рельеф кожи (feTurbulence + feDiffuseLighting), противотень, затенение у краёв, контровой свет,
 * реалистичные глаза, природные окраски, тонкая бумажная кромка.
 */
window.DP = window.DP || {};
(function () {
  // ---------- геометрия ----------
  const shift = (d, dx, dy) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (m, x, y) => `${+(+x + dx).toFixed(1)},${+(+y + dy).toFixed(1)}`);
  const claws = (x, y, n, gap) => { let o = []; for (let i = 0; i < n; i++) { const cx = x + i * (gap || 7); o.push(['H', `M${cx},${y} C${cx + 4},${y - 1} ${cx + 7},${y + 1} ${cx + 8},${y + 4} C${cx + 4},${y + 4} ${cx + 1},${y + 3} ${cx},${y} Z`]); } return o; };
  const plate = (x, base, h, w) => `M${x - w},${base} C${x - w},${base - h * 0.55} ${x - w * 0.35},${base - h} ${x},${base - h} C${x + w * 0.35},${base - h} ${x + w},${base - h * 0.55} ${x + w},${base} Z`;
  const stripe = (x, y, len, wd, tilt) => `M${x},${y} C${x - wd + (tilt || 0) * 0.5},${y + len * 0.35} ${x - wd * 0.4 + (tilt || 0)},${y + len * 0.75} ${x + (tilt || 0)},${y + len} C${x + wd * 0.6 + (tilt || 0)},${y + len * 0.7} ${x + wd},${y + len * 0.3} ${x},${y} Z`;
  const spot = (x, y, rx, ry) => `M${x - rx},${y} C${x - rx},${y - ry} ${x + rx},${y - ry} ${x + rx},${y} C${x + rx},${y + ry} ${x - rx},${y + ry} ${x - rx},${y} Z`;
  const TAU = Math.PI * 2;

  // Задние «колонные» ноги (слоны/зауроподы) и задние ноги тероподов
  const TREX_LEG = 'M176,138 C184,114 226,112 238,136 C246,154 240,174 228,188 C224,200 230,214 236,230 L252,234 C260,236 262,244 254,246 L214,246 C206,246 204,240 207,232 L204,204 C188,196 172,170 176,138 Z';
  const TREX_ARM = 'M276,146 C286,148 294,156 296,166 L304,170 L297,173 L300,180 L292,176 C286,172 280,164 274,156 Z';
  const TRI_HIND = 'M102,134 C108,112 154,110 164,136 C168,156 162,176 156,190 L158,232 C160,241 155,246 147,246 L121,246 C113,246 110,241 112,232 L115,192 C104,176 98,156 102,134 Z';
  const TRI_FRONT = 'M238,150 C244,132 278,132 284,150 C288,166 282,182 278,194 L280,232 C282,241 277,246 269,246 L247,246 C239,246 236,241 238,232 L241,196 C234,182 234,164 238,150 Z';
  const STE_HIND = 'M124,158 C128,132 172,130 182,158 C186,178 178,196 172,206 L174,234 C176,242 171,246 163,246 L141,246 C133,246 130,241 132,233 L136,206 C126,192 120,176 124,158 Z';
  const STE_FRONT = 'M276,166 C280,154 302,154 306,168 C308,184 304,196 302,206 L304,236 C304,242 300,246 294,246 L278,246 C272,246 270,242 272,236 L274,206 C270,194 272,180 276,166 Z';
  const BRA_HIND = 'M102,158 C106,136 150,134 160,160 C164,180 158,196 154,206 L156,234 C158,242 152,246 144,246 L120,246 C112,246 110,240 112,234 L114,206 C104,192 98,176 102,158 Z';
  const BRA_FRONT = 'M242,154 C246,138 280,138 284,158 C286,178 282,196 280,210 L282,236 C284,242 280,246 272,246 L252,246 C246,246 242,242 244,236 L246,210 C240,192 238,172 242,154 Z';
  const ANK_HIND = 'M108,174 C112,160 152,160 158,178 L158,232 C160,242 154,246 146,246 L124,246 C116,246 112,242 114,234 Z';
  const ANK_FRONT = 'M262,176 C266,166 294,166 298,180 L298,234 C300,242 294,246 286,246 L268,246 C262,246 258,242 260,234 Z';
  const PAR_LEG = 'M168,138 C176,116 218,114 228,138 C234,156 228,174 218,186 C216,200 220,214 224,230 L240,234 C248,236 250,244 242,246 L204,246 C196,246 194,240 197,232 L194,202 C178,192 164,168 168,138 Z';
  const PAR_FRONT = 'M256,146 C272,144 282,154 282,168 L286,232 C288,240 283,246 274,246 L262,246 C255,246 253,240 256,234 L252,172 C250,160 250,148 256,146 Z';
  const PLE_RF = 'M116,168 C138,172 152,190 148,214 C144,232 128,244 114,240 C110,226 110,206 114,186 Z';
  const PLE_FF = 'M224,170 C250,176 272,196 280,220 C282,232 274,238 262,232 C248,220 232,200 222,184 Z';

  const RAP_LEG = 'M190,132 C198,116 226,116 232,136 C236,152 230,168 220,178 L214,206 C220,218 228,228 236,236 L250,238 C258,240 258,246 250,246 L216,246 C208,246 206,240 210,234 L202,212 L200,184 C188,172 184,150 190,132 Z';
  const RAP_ARM = 'M266,134 C278,136 288,146 292,158 L300,166 L292,166 L294,174 L286,168 C278,160 270,150 264,142 Z';
  const SICKLE = 'M214,236 C210,226 212,218 220,214 C218,222 218,230 222,238 Z';
  // складки кожи (только в цветном режиме)
  const fold = (x, y, len, bend) => `M${x},${y} q${len * 0.5},${bend} ${len},0`;

  const ART = {
    trex: [
      { n: 'legF', role: 'leg', off: Math.PI, pivot: [196, 150], s: [['F', shift(TREX_LEG, -18, -4)], ...claws(234, 242, 2, 8).map(c => ['H', shift(c[1], 0, 0)])] },
      { n: 'armF', role: 'arm', off: 1, pivot: [268, 150], s: [['F', shift(TREX_ARM, -10, -2)]] },
      { n: 'tail', role: 'tail', pivot: [150, 124], s: [
        ['B', 'M162,94 C124,92 70,98 8,114 C56,126 108,142 168,154 Z'],
        ['L', 'M168,146 C120,140 64,128 20,118 C70,124 120,132 168,138 Z'],
        ['M', stripe(132, 98, 22, 7, -4)], ['M', stripe(104, 102, 18, 6, -4)], ['M', stripe(76, 106, 13, 5, -3)], ['M', stripe(52, 110, 8, 4, -2)],
        ['S', 'M150,96 C160,110 162,140 156,156 L172,156 L172,94 Z']] },
      { n: 'body', role: 'body', pivot: [220, 140], s: [
        ['B', 'M136,106 C166,80 232,72 270,82 C292,88 306,94 316,104 L324,130 C312,140 298,150 290,162 C278,180 254,192 224,194 C190,196 158,182 142,160 C130,144 126,122 136,106 Z'],
        ['L', 'M150,164 C176,186 220,194 254,184 C278,176 292,160 304,142 L318,130 C302,150 282,168 252,174 C216,180 178,176 150,164 Z'],
        ['M', stripe(176, 84, 30, 8, -3)], ['M', stripe(204, 78, 34, 9, -2)], ['M', stripe(234, 78, 32, 9, 0)], ['M', stripe(262, 84, 24, 7, 2)],
        ['G', 'M170,92 C200,80 250,78 290,90 C250,90 206,96 172,108 Z'],
        ['S', 'M176,150 C196,134 232,134 246,154 C228,148 200,150 180,162 Z'],
        ['N', 'M250,120 C262,132 272,146 276,160']] },
      { n: 'legN', role: 'leg', off: 0, pivot: [206, 152], s: [['B', TREX_LEG], ...claws(244, 239, 2, 6), ['K', fold(210, 206, 14, 3)], ['K', fold(212, 214, 12, 3)], ['K', fold(214, 222, 10, 3)],
        ['N', 'M186,150 C194,170 206,186 222,190'], ['G', 'M190,126 C204,118 222,120 230,132 C216,128 202,128 190,134 Z']] },
      { n: 'head', role: 'head', amp: 1, pivot: [306, 112], s: [
        ['B', 'M288,98 C294,70 322,56 352,58 C374,60 390,68 395,82 C398,94 394,106 386,112 L380,128 C368,138 346,140 326,138 C308,136 296,128 290,118 Z'],
        ['L', 'M302,126 C318,134 348,136 370,132 L380,128 C366,138 344,140 326,138 C314,136 306,132 302,126 Z'],
        ['H', 'M324,116 L328,124 L332,117 L337,125 L341,117 L346,125 L350,117 L355,124 L359,116 L364,123 L368,115 L373,121 L377,113 Z'],
        ['N', 'M318,116 C340,120 362,118 386,110'],
        ['M', stripe(330, 62, 14, 5, 2)], ['M', stripe(350, 60, 12, 5, 2)],
        ['G', 'M310,70 C326,60 352,58 374,66 C352,66 330,70 312,80 Z'],
        ['N', 'M384,78 C387,75 391,75 393,78'],
        ['K', fold(296, 104, 12, 4)], ['K', fold(294, 112, 12, 4)], ['K', fold(298, 120, 10, 3)], ['K', fold(352, 70, 10, -3)],
        ['E', 342, 82, 6.5]] },
      { n: 'armN', role: 'arm', off: 0, pivot: [278, 150], s: [['B', TREX_ARM], ['H', 'M300,178 L306,180 L300,183 Z']] }
    ],
    triceratops: [
      { n: 'legBF', role: 'leg', off: 0, pivot: [146, 146], s: [['F', shift(TRI_HIND, 18, -6)]] },
      { n: 'legFF', role: 'leg', off: Math.PI, pivot: [272, 156], s: [['F', shift(TRI_FRONT, 18, -6)]] },
      { n: 'tail', role: 'tail', pivot: [100, 136], s: [['B', 'M110,110 C74,118 40,134 8,156 C46,154 78,150 112,154 Z'],
        ['M', stripe(76, 124, 12, 6, -2)], ['M', stripe(52, 136, 9, 5, -2)]] },
      { n: 'body', role: 'body', pivot: [200, 140], s: [
        ['B', 'M90,128 C94,90 150,72 210,74 C258,76 292,96 302,124 C308,146 298,172 272,184 C232,198 150,198 112,184 C92,174 86,150 90,128 Z'],
        ['L', 'M104,170 C140,192 230,196 280,176 C240,186 150,186 104,170 Z'],
        ['M', spot(150, 100, 14, 8)], ['M', spot(196, 92, 12, 7)], ['M', spot(240, 100, 11, 6)], ['M', spot(122, 124, 9, 6)], ['M', spot(172, 120, 8, 5)], ['M', spot(220, 122, 8, 5)],
        ['G', 'M120,98 C150,80 210,74 260,90 C220,88 170,90 126,110 Z'],
        ['S', 'M110,150 C126,136 156,136 168,152 C146,148 126,152 112,164 Z'], ['S', 'M238,156 C252,142 278,144 288,160 C270,154 254,158 242,168 Z']] },
      { n: 'legB', role: 'leg', off: Math.PI, pivot: [132, 148], s: [['B', TRI_HIND], ...claws(112, 240, 3, 9), ['N', 'M116,214 C126,218 140,218 152,214']] },
      { n: 'legF', role: 'leg', off: 0, pivot: [262, 158], s: [['B', TRI_FRONT], ...claws(238, 240, 3, 8), ['N', 'M242,214 C252,218 264,218 276,214']] },
      { n: 'head', role: 'head', amp: 0.8, pivot: [282, 130], s: [
        ['A', 'M260,74 C266,40 296,14 330,16 C346,40 346,84 332,120 C312,136 284,138 268,126 C256,112 254,92 260,74 Z'],
        ['H', 'M262,66 L254,58 L266,58 Z'], ['H', 'M276,36 L272,24 L284,30 Z'], ['H', 'M300,20 L302,8 L310,18 Z'], ['H', 'M328,16 L336,6 L338,20 Z'],
        ['M', 'M300,40 C310,60 314,86 312,110'], ['M', spot(306, 54, 9, 7)], ['M', spot(290, 92, 8, 9)],
        ['B', 'M286,96 C304,84 338,86 360,100 C378,112 392,128 396,144 C398,156 392,166 380,168 L374,178 C362,182 344,180 330,174 C310,168 292,156 284,140 C278,126 278,106 286,96 Z'],
        ['L', 'M300,160 C318,172 344,180 370,178 L374,178 C362,182 344,180 330,174 C316,170 306,166 300,160 Z'],
        ['H', 'M378,140 C390,146 398,152 396,160 C394,168 386,170 378,168 C380,158 380,148 378,140 Z'],
        ['H', 'M306,92 C312,68 324,48 342,34 C336,56 328,78 322,98 Z'],
        ['H', 'M322,96 C330,70 346,46 372,30 C360,54 350,78 340,102 Z'],
        ['H', 'M370,122 C374,110 380,102 390,96 C388,108 386,118 384,130 Z'],
        ['N', 'M332,160 C346,166 362,168 376,164'], ['K', fold(292, 140, 12, 4)], ['K', fold(296, 150, 12, 4)],
        ['G', 'M298,98 C316,90 342,92 360,104 C340,100 318,100 300,108 Z'],
        ['E', 328, 118, 6]] }
    ],
    stegosaurus: [
      { n: 'legBF', role: 'leg', off: 0, pivot: [166, 168], s: [['F', shift(STE_HIND, 16, -6)]] },
      { n: 'legFF', role: 'leg', off: Math.PI, pivot: [304, 174], s: [['F', shift(STE_FRONT, 14, -6)]] },
      { n: 'tail', role: 'tail', pivot: [104, 158], s: [
        ['H', 'M52,160 L22,126 L60,152 Z'], ['H', 'M34,170 L6,148 L42,162 Z'],
        ['B', 'M114,132 C82,142 46,162 8,184 C46,184 80,178 116,172 Z'],
        ['M', stripe(84, 148, 12, 6, -2)], ['M', stripe(60, 160, 9, 5, -2)],
        ['H', 'M70,158 L50,124 L80,152 Z'], ['H', 'M46,170 L20,146 L54,164 Z']] },
      { n: 'body', role: 'body', pivot: [210, 150], s: [
        ['D', plate(128, 114, 32, 14)], ['D', plate(166, 92, 50, 19)], ['D', plate(206, 84, 58, 21)], ['D', plate(246, 92, 50, 19)], ['D', plate(282, 112, 34, 15)],
        ['A', plate(110, 128, 30, 13)], ['A', plate(146, 100, 48, 18)], ['A', plate(186, 88, 62, 22)], ['A', plate(226, 88, 56, 21)], ['A', plate(264, 102, 42, 17)], ['A', plate(298, 124, 26, 12)],
        ['B', 'M100,170 C108,120 150,88 200,86 C250,86 292,110 316,140 C328,156 332,170 324,180 C302,196 240,204 180,202 C140,200 110,192 100,170 Z'],
        ['L', 'M112,184 C160,200 260,202 318,182 C260,192 170,194 112,184 Z'],
        ['M', stripe(160, 96, 40, 8, -6)], ['M', stripe(196, 90, 46, 8, -4)], ['M', stripe(232, 94, 42, 8, 0)], ['M', stripe(266, 108, 30, 7, 4)], ['M', stripe(132, 116, 28, 7, -6)],
        ['G', 'M130,112 C160,92 220,86 270,104 C230,100 176,104 136,126 Z'],
        ['S', 'M126,168 C140,152 172,150 184,168 C164,164 142,168 128,180 Z'], ['S', 'M272,170 C282,160 300,160 308,172 C294,168 284,172 276,180 Z']] },
      { n: 'legB', role: 'leg', off: Math.PI, pivot: [152, 172], s: [['B', STE_HIND], ...claws(132, 240, 3, 9)] },
      { n: 'legF', role: 'leg', off: 0, pivot: [290, 178], s: [['B', STE_FRONT], ...claws(272, 240, 2, 9)] },
      { n: 'head', role: 'head', amp: 1, pivot: [312, 164], s: [
        ['B', 'M298,136 C314,146 330,158 346,164 C362,158 386,160 394,172 C399,182 391,191 376,191 C358,192 342,190 330,186 C316,182 306,180 298,180 Z'],
        ['L', 'M304,178 C322,184 350,190 376,191 C358,192 340,190 328,187 C316,184 308,182 304,178 Z'],
        ['N', 'M362,184 C372,186 384,184 392,178'], ['N', 'M390,168 C392,166 394,167 395,169'],
        ['G', 'M340,160 C352,160 368,160 382,164 C366,164 352,164 342,166 Z'],
        ['E', 370, 170, 4.5]] }
    ],
    brachiosaurus: [
      { n: 'legBF', role: 'leg', off: 0, pivot: [144, 170], s: [['F', shift(BRA_HIND, 16, -4)]] },
      { n: 'legFF', role: 'leg', off: Math.PI, pivot: [278, 166], s: [['F', shift(BRA_FRONT, 16, -6)]] },
      { n: 'tail', role: 'tail', pivot: [100, 150], s: [['B', 'M108,130 C72,144 36,170 4,198 C40,194 74,184 108,172 Z'],
        ['M', stripe(78, 146, 14, 6, -3)], ['M', stripe(52, 162, 10, 5, -3)]] },
      { n: 'body', role: 'body', pivot: [190, 150], s: [
        ['B', 'M92,150 C100,112 150,96 200,96 C240,96 266,104 280,120 C292,136 292,160 282,178 C266,196 220,204 170,202 C130,200 96,188 92,150 Z'],
        ['L', 'M104,182 C140,200 230,202 274,182 C230,192 150,194 104,182 Z'],
        ['M', spot(140, 118, 14, 8)], ['M', spot(186, 112, 12, 7)], ['M', spot(230, 116, 11, 6)], ['M', spot(118, 140, 9, 6)], ['M', spot(166, 136, 8, 5)],
        ['G', 'M120,116 C150,100 210,96 256,110 C216,110 166,112 126,128 Z'],
        ['S', 'M108,170 C124,156 154,156 164,172 C144,168 124,172 110,182 Z'], ['S', 'M240,168 C254,152 280,154 288,170 C270,164 256,168 244,178 Z']] },
      { n: 'legB', role: 'leg', off: Math.PI, pivot: [130, 172], s: [['B', BRA_HIND], ...claws(112, 240, 3, 9)] },
      { n: 'legF', role: 'leg', off: 0, pivot: [262, 166], s: [['B', BRA_FRONT], ...claws(246, 240, 3, 8)] },
      { n: 'head', role: 'neck', amp: 0.45, pivot: [262, 126], s: [
        ['B', 'M244,112 C262,84 282,54 302,32 C310,22 324,18 334,24 L324,46 C306,72 292,108 286,142 C276,148 260,146 250,136 Z'],
        ['L', 'M284,140 C290,108 302,76 318,50 L324,46 C306,72 294,106 288,140 Z'],
        ['M', stripe(276, 74, 12, 5, 4)], ['M', stripe(264, 98, 12, 5, 4)], ['M', stripe(290, 50, 10, 4, 3)],
        ['B', 'M300,26 C306,10 330,2 350,6 C366,10 377,18 375,29 C373,40 356,44 340,44 C326,46 312,44 304,38 Z'],
        ['N', 'M310,14 C316,6 328,2 338,6'], ['N', 'M352,38 C362,38 370,35 374,30'], ['N', 'M370,18 C372,16 374,17 375,19'],
        ['G', 'M310,12 C322,6 340,4 356,10 C340,10 326,12 314,18 Z'],
        ['E', 334, 22, 4.5]] }
    ],
    pterodactyl: [
      { n: 'wingF', role: 'wing', off: 0.25, amp: 0.8, pivot: [208, 116], s: [['F', 'M204,112 C234,70 282,36 352,22 C340,42 324,58 304,74 C282,92 252,108 226,126 Z'], ['N', 'M210,110 C246,76 296,44 350,24']] },
      { n: 'legs', role: 'none', pivot: [190, 146], s: [['F', 'M176,146 C178,156 176,164 170,172 L176,174 C182,166 186,156 186,146 Z'], ['F', 'M196,148 C200,158 202,166 198,174 L204,175 C208,166 208,156 206,148 Z']] },
      { n: 'body', role: 'body', pivot: [200, 126], s: [
        ['B', 'M148,124 C154,108 186,100 214,104 C236,108 248,118 246,130 C242,142 218,150 190,150 C168,150 148,140 148,124 Z'],
        ['L', 'M158,138 C176,148 214,150 240,138 C224,146 190,150 168,146 Z'],
        ['M', stripe(190, 104, 14, 6, 0)], ['M', stripe(212, 106, 12, 5, 0)],
        ['G', 'M162,114 C182,104 212,102 232,110 C210,110 186,112 166,122 Z']] },
      { n: 'wingN', role: 'wing', off: 0, amp: 1, pivot: [196, 122], s: [
        ['B', 'M200,118 C166,70 104,40 18,48 C54,70 90,100 108,140 C140,132 170,132 200,138 Z'],
        ['L', 'M108,140 C96,112 74,88 46,68 C84,86 120,112 140,134 Z'],
        ['N', 'M198,116 C160,74 100,48 22,50'], ['M', 'M120,72 C136,90 150,110 158,130'], ['M', 'M80,62 C100,86 116,108 124,130'],
        ['G', 'M190,112 C160,80 110,58 50,52 C110,58 160,82 194,118 Z']] },
      { n: 'head', role: 'head', amp: 0.6, pivot: [238, 120], s: [
        ['A', 'M262,102 C244,86 222,72 196,62 C224,64 258,78 282,100 Z'],
        ['B', 'M230,116 C242,100 266,96 286,102 L394,118 L286,128 C268,136 248,136 234,128 Z'],
        ['H', 'M300,123 L392,118 L300,127 Z'],
        ['N', 'M286,122 L384,118'], ['G', 'M244,106 C258,100 276,100 290,104 C274,104 258,106 246,112 Z'],
        ['E', 268, 112, 5]] }
    ],
    plesiosaur: [
      { n: 'finBF', role: 'flip', off: 1.6, pivot: [134, 166], s: [['F', shift(PLE_RF, 14, -4)]] },
      { n: 'finFF', role: 'flip', off: 0.6, pivot: [238, 168], s: [['F', shift(PLE_FF, 12, -4)]] },
      { n: 'tail', role: 'tail', pivot: [92, 150], s: [['B', 'M100,134 C72,138 40,148 6,162 C40,168 72,166 102,164 Z'], ['M', stripe(64, 146, 8, 4, -2)]] },
      { n: 'body', role: 'body', pivot: [180, 150], s: [
        ['B', 'M86,150 C90,120 140,104 190,104 C236,104 268,120 280,140 C290,158 278,178 250,186 C210,196 140,196 110,186 C92,178 84,166 86,150 Z'],
        ['L', 'M100,172 C140,192 220,194 266,172 C220,182 150,184 100,172 Z'],
        ['M', spot(140, 122, 14, 7)], ['M', spot(186, 116, 12, 6)], ['M', spot(228, 124, 10, 6)], ['M', spot(116, 142, 8, 5)],
        ['G', 'M116,120 C150,106 210,104 252,118 C212,116 164,118 122,132 Z']] },
      { n: 'finB', role: 'flip', off: Math.PI, pivot: [126, 172], s: [['B', PLE_RF], ['N', 'M124,190 C130,206 130,222 124,234']] },
      { n: 'finF', role: 'flip', off: 0, pivot: [232, 176], s: [['B', PLE_FF], ['N', 'M236,190 C248,204 260,216 270,226']] },
      { n: 'head', role: 'neck', amp: 0.55, pivot: [264, 132], s: [
        ['B', 'M254,124 C278,104 300,80 318,62 C326,54 338,52 346,56 L336,74 C320,92 300,118 284,146 C274,150 262,146 256,140 Z'],
        ['L', 'M282,144 C296,118 314,94 332,76 L336,74 C320,92 302,118 288,146 Z'],
        ['M', stripe(296, 84, 10, 4, 3)], ['M', stripe(280, 104, 10, 4, 3)],
        ['B', 'M318,58 C324,42 346,36 366,40 C382,44 394,52 394,62 C392,72 376,76 360,76 C344,78 328,74 320,68 Z'],
        ['H', 'M352,70 L355,75 L358,70 L361,75 L364,70 L367,74 L370,69 L373,73 L376,68 Z'],
        ['N', 'M346,70 C362,70 378,68 392,62'], ['G', 'M328,48 C342,40 362,40 378,46 C360,46 344,48 332,54 Z'],
        ['E', 352, 54, 4.5]] }
    ],
    ankylosaurus: [
      { n: 'legBF', role: 'leg', off: 0, pivot: [150, 182], s: [['F', shift(ANK_HIND, 18, -6)]] },
      { n: 'legFF', role: 'leg', off: Math.PI, pivot: [296, 182], s: [['F', shift(ANK_FRONT, 16, -6)]] },
      { n: 'tail', role: 'tail', amp: 1.4, pivot: [100, 164], s: [
        ['B', 'M106,150 C80,152 56,156 40,160 L42,174 C60,176 82,178 108,178 Z'],
        ['A', 'M14,166 C14,154 26,148 38,150 C50,152 56,160 54,168 C52,178 40,184 28,182 C18,180 14,174 14,166 Z'],
        ['A', 'M44,156 C52,150 62,152 64,160 C66,170 58,176 50,174 Z'],
        ['M', spot(30, 162, 6, 4)], ['M', spot(80, 162, 7, 4)]] },
      { n: 'body', role: 'body', pivot: [200, 160], s: [
        ['H', 'M84,176 L66,192 L94,184 Z'], ['H', 'M120,186 L106,206 L134,192 Z'], ['H', 'M168,190 L162,212 L186,194 Z'], ['H', 'M224,190 L226,212 L244,192 Z'], ['H', 'M278,184 L288,204 L298,182 Z'],
        ['B', 'M80,180 C80,130 130,104 196,104 C262,104 314,130 322,180 C300,190 250,196 200,196 C150,196 100,192 80,180 Z'],
        ['L', 'M96,184 C150,194 260,194 312,182 C260,190 150,190 96,184 Z'],
        ...[[120, 130, 11], [160, 116, 12], [204, 112, 12], [248, 118, 12], [286, 136, 11], [104, 156, 9], [142, 148, 10], [184, 142, 10], [226, 142, 10], [266, 152, 10], [300, 166, 8], [124, 174, 7], [164, 170, 8], [206, 168, 8], [248, 170, 8], [284, 176, 6]].map(([x, y, r]) => ['A', spot(x, y, r, r * 0.8)]),
        ['G', 'M120,120 C150,106 220,102 270,118 C226,114 170,116 126,134 Z'],
        ['S', 'M118,184 C132,172 154,172 164,186 Z'], ['S', 'M262,186 C272,176 292,176 300,188 Z']] },
      { n: 'legB', role: 'leg', off: Math.PI, pivot: [134, 184], s: [['B', ANK_HIND], ...claws(114, 240, 3, 9)] },
      { n: 'legF', role: 'leg', off: 0, pivot: [280, 184], s: [['B', ANK_FRONT], ...claws(260, 240, 3, 9)] },
      { n: 'head', role: 'head', amp: 0.7, pivot: [312, 168], s: [
        ['B', 'M306,152 C318,136 352,134 372,146 C386,154 394,166 392,178 C390,188 378,192 362,190 L322,188 C310,184 302,172 306,152 Z'],
        ['H', 'M320,146 L306,126 L332,140 Z'], ['H', 'M352,186 L360,200 L366,186 Z'],
        ['A', spot(336, 146, 7, 5)], ['A', spot(356, 144, 6, 4)],
        ['N', 'M356,180 C368,182 380,178 390,170'], ['G', 'M320,146 C336,138 356,138 370,146 C352,144 336,146 324,154 Z'],
        ['E', 350, 160, 4.8]] }
    ],
    velociraptor: [
      { n: 'legF', role: 'leg', off: Math.PI, pivot: [208, 140], s: [['F', shift(RAP_LEG, -14, -3)], ['H', shift(SICKLE, -14, -3)]] },
      { n: 'armF', role: 'arm', off: 1, pivot: [262, 138], s: [['F', shift(RAP_ARM, -8, -2)]] },
      { n: 'tail', role: 'tail', amp: 0.6, pivot: [166, 124], s: [
        ['B', 'M172,108 C120,106 60,110 4,118 C60,128 120,136 176,142 Z'],
        ['L', 'M176,136 C124,132 70,126 22,121 C74,126 124,130 176,130 Z'],
        ['M', stripe(140, 108, 14, 5, -3)], ['M', stripe(112, 109, 12, 5, -3)], ['M', stripe(84, 111, 10, 4, -2)], ['M', stripe(58, 113, 7, 3, -2)],
        ['A', 'M40,116 C26,108 14,110 4,118 C16,120 28,121 40,121 Z']] },
      { n: 'body', role: 'body', pivot: [232, 132], s: [
        ['A', 'M166,104 C188,88 220,84 248,90 L242,99 C222,95 196,97 172,112 Z'],
        ['B', 'M160,110 C180,96 230,92 262,100 C282,106 296,114 304,124 L300,142 C290,150 276,158 256,162 C230,168 196,166 176,156 C160,148 152,124 160,110 Z'],
        ['L', 'M172,150 C196,164 236,166 262,158 C280,152 292,144 300,136 C284,150 262,156 236,158 C212,160 190,158 172,150 Z'],
        ['M', stripe(196, 98, 18, 6, -2)], ['M', stripe(220, 95, 20, 6, -1)], ['M', stripe(244, 98, 18, 6, 1)], ['M', stripe(268, 106, 14, 5, 2)],
        ['G', 'M178,104 C204,94 240,92 276,104 C240,102 208,106 182,116 Z'],
        ['S', 'M186,146 C204,134 230,134 242,150 C222,146 202,148 188,158 Z']] },
      { n: 'legN', role: 'leg', off: 0, pivot: [214, 142], s: [['B', RAP_LEG], ['H', SICKLE], ...claws(238, 239, 2, 6),
        ['N', 'M196,150 C202,166 210,178 220,182'], ['K', fold(206, 210, 10, 3)], ['G', 'M196,126 C208,120 222,122 228,132 C216,128 204,128 196,134 Z']] },
      { n: 'head', role: 'head', amp: 1, pivot: [296, 118], s: [
        ['B', 'M286,104 C294,90 304,78 316,72 L334,80 C328,94 320,110 308,128 L294,132 C288,124 284,114 286,104 Z'],
        ['B', 'M312,70 C320,58 344,56 362,62 C378,66 392,72 396,80 C396,88 388,92 376,92 L360,96 C344,98 326,96 316,90 C308,84 306,76 312,70 Z'],
        ['L', 'M318,90 C332,96 350,98 368,94 L376,92 C362,98 342,100 326,96 Z'],
        ['H', 'M338,92 L341,97 L344,92 L347,97 L350,92 L353,96 L356,91 L359,95 L362,90 L365,94 L368,89 Z'],
        ['N', 'M326,90 C348,93 372,90 392,84'], ['N', 'M388,72 C390,70 393,71 394,73'],
        ['M', stripe(300, 88, 12, 4, 3)], ['M', stripe(330, 60, 8, 4, 2)],
        ['K', fold(296, 100, 10, 3)], ['K', fold(294, 110, 10, 3)],
        ['G', 'M318,64 C332,58 352,58 368,64 C350,64 334,66 320,72 Z'],
        ['E', 344, 72, 5]] },
      { n: 'armN', role: 'arm', off: 0, pivot: [268, 140], s: [['A', 'M268,138 C262,150 262,162 272,174 C278,162 282,150 284,142 Z'], ['B', RAP_ARM], ['H', 'M296,170 L302,172 L296,175 Z']] }
    ],
    parasaurolophus: [
      { n: 'legF', role: 'leg', off: Math.PI, pivot: [188, 148], s: [['F', shift(PAR_LEG, -16, -4)], ...claws(226, 242, 2, 8)] },
      { n: 'armF', role: 'leg', off: 0, amp: 0.6, pivot: [262, 150], s: [['F', shift(PAR_FRONT, -12, -4)]] },
      { n: 'tail', role: 'tail', pivot: [126, 128], s: [
        ['B', 'M132,102 C94,102 50,108 6,118 C46,132 92,142 136,150 Z'],
        ['L', 'M136,144 C96,136 56,128 22,120 C60,126 100,132 136,136 Z'],
        ['M', stripe(110, 104, 20, 6, -3)], ['M', stripe(84, 106, 16, 5, -3)], ['M', stripe(58, 110, 11, 4, -2)]] },
      { n: 'body', role: 'body', pivot: [210, 140], s: [
        ['B', 'M114,128 C118,98 166,82 214,82 C246,82 270,92 284,104 C296,116 300,134 296,152 C288,176 254,194 210,194 C166,194 122,176 114,128 Z'],
        ['L', 'M128,166 C160,190 240,196 286,168 C240,182 170,184 128,166 Z'],
        ['M', stripe(160, 86, 30, 7, -3)], ['M', stripe(190, 82, 34, 8, -2)], ['M', stripe(220, 84, 32, 8, 0)], ['M', stripe(250, 90, 26, 7, 2)],
        ['G', 'M140,100 C170,86 230,82 272,98 C232,96 184,98 146,114 Z'],
        ['S', 'M168,146 C186,130 220,130 232,150 C214,144 190,146 172,158 Z']] },
      { n: 'legN', role: 'leg', off: 0, pivot: [198, 150], s: [['B', PAR_LEG], ...claws(232, 238, 2, 8), ['G', 'M182,126 C196,118 214,120 222,132 C208,128 194,128 182,134 Z']] },
      { n: 'armN', role: 'leg', off: Math.PI, amp: 0.6, pivot: [268, 152], s: [['B', PAR_FRONT], ['H', 'M272,244 L282,246 L272,240 Z']] },
      { n: 'head', role: 'neck', amp: 0.7, pivot: [282, 116], s: [
        ['A', 'M310,58 C290,44 262,30 232,24 C228,32 234,40 246,44 C268,50 292,62 306,74 Z'],
        ['B', 'M270,104 C284,90 298,78 310,66 L332,82 C320,98 308,118 300,140 C290,146 278,140 272,130 Z'],
        ['L', 'M298,138 C306,116 316,98 328,84 L332,82 C320,98 310,118 302,140 Z'],
        ['B', 'M304,62 C312,48 334,44 352,50 C368,56 382,62 392,70 C396,76 392,82 384,82 C368,84 352,86 338,86 C322,86 308,80 304,62 Z'],
        ['H', 'M376,70 C384,72 392,72 395,76 C392,82 384,82 378,80 Z'],
        ['N', 'M344,80 C358,80 372,80 386,78'], ['G', 'M314,54 C328,46 348,46 364,54 C348,54 332,56 318,62 Z'],
        ['M', stripe(296, 88, 10, 4, 3)],
        ['E', 334, 62, 4.8]] }
    ]
  };

  const SPECIES = [
    { id: 'trex', name: 'Тираннозавр', short: 'Ти-рекс', diet: 'carn', habitat: 'ground', size: 1.15, speed: 1.1, emoji: '🦖', eye: 'slit',
      palettes: [{ b: '#6f7a3e', l: '#d9cfa0', a: '#3f4a22', h: '#efe6cf' },
                 { b: '#7a5a3a', l: '#e0cba0', a: '#4a3420', h: '#efe6cf' },
                 { b: '#5b6670', l: '#cfd3c8', a: '#2f3a40', h: '#efe6cf' }] },
    { id: 'triceratops', name: 'Трицератопс', short: 'Трицератопс', diet: 'herb', habitat: 'ground', size: 1.1, speed: 0.8, emoji: '🦏',
      palettes: [{ b: '#8a7550', l: '#e3d6b0', a: '#b5512a', h: '#efe6cf' },
                 { b: '#6b6e4a', l: '#d8d3ad', a: '#8c3b2a', h: '#efe6cf' },
                 { b: '#7d6a5a', l: '#e2d3c0', a: '#4a6b7a', h: '#efe6cf' }] },
    { id: 'stegosaurus', name: 'Стегозавр', short: 'Стегозавр', diet: 'herb', habitat: 'ground', size: 1.1, speed: 0.7, emoji: '🦕',
      palettes: [{ b: '#8c8a4a', l: '#e6dfb8', a: '#a8432c', h: '#efe6cf' },
                 { b: '#6a7a5a', l: '#dde0c4', a: '#c46a2a', h: '#efe6cf' },
                 { b: '#8a6e4e', l: '#eadbbd', a: '#5d7a3a', h: '#efe6cf' }] },
    { id: 'brachiosaurus', name: 'Брахиозавр', short: 'Брахиозавр', diet: 'herb', habitat: 'ground', size: 1.4, speed: 0.6, emoji: '🦕',
      palettes: [{ b: '#7a8a6a', l: '#e2dfc6', a: '#4e5c40', h: '#efe6cf' },
                 { b: '#6e7680', l: '#d6d9d4', a: '#4a5058', h: '#efe6cf' },
                 { b: '#9a7f5a', l: '#ebdcbc', a: '#6a5236', h: '#efe6cf' }] },
    { id: 'pterodactyl', name: 'Птеродактиль', short: 'Птеродактиль', diet: 'carn', habitat: 'sky', size: 0.9, speed: 1.4, emoji: '🪽',
      palettes: [{ b: '#8a5a40', l: '#e8cfb4', a: '#c87a3a', h: '#efe6cf' },
                 { b: '#5e5a66', l: '#d8d2d6', a: '#b8502a', h: '#efe6cf' },
                 { b: '#7a6a4a', l: '#e4d6b4', a: '#a83a2a', h: '#efe6cf' }] },
    { id: 'plesiosaur', name: 'Плезиозавр', short: 'Плезиозавр', diet: 'carn', habitat: 'water', size: 1.0, speed: 0.9, emoji: '🌊',
      palettes: [{ b: '#3e5a6e', l: '#d2dce0', a: '#6f8fa0', h: '#efe6cf' },
                 { b: '#4a6a5a', l: '#d0dcd0', a: '#2f4a3e', h: '#efe6cf' },
                 { b: '#5a5a6e', l: '#d6d6e0', a: '#3a3a50', h: '#efe6cf' }] },
    { id: 'ankylosaurus', name: 'Анкилозавр', short: 'Анкилозавр', diet: 'herb', habitat: 'ground', size: 1.0, speed: 0.6, emoji: '🛡️',
      palettes: [{ b: '#8a7856', l: '#e4d8bc', a: '#5e4c30', h: '#efe6cf' },
                 { b: '#6e6a50', l: '#d8d4b8', a: '#4a4632', h: '#efe6cf' },
                 { b: '#7e6250', l: '#e2cfbe', a: '#54382a', h: '#efe6cf' }] },
    { id: 'parasaurolophus', name: 'Паразауролоф', short: 'Паразауролоф', diet: 'herb', habitat: 'ground', size: 1.1, speed: 0.9, emoji: '🎺',
      palettes: [{ b: '#9a7a44', l: '#ecdcb4', a: '#8c3a2e', h: '#efe6cf' },
                 { b: '#5e7a4e', l: '#dee6c8', a: '#a8562a', h: '#efe6cf' },
                 { b: '#7a6a5e', l: '#e6dacc', a: '#3e5a7a', h: '#efe6cf' }] },
    { id: 'velociraptor', name: 'Велоцираптор', short: 'Раптор', diet: 'carn', habitat: 'ground', size: 0.8, speed: 1.5, emoji: '🦅', eye: 'slit',
      palettes: [{ b: '#8a6a44', l: '#e6d4b0', a: '#6a3a22', h: '#efe6cf' },
                 { b: '#5a5e4a', l: '#d4d2b8', a: '#9a4a26', h: '#efe6cf' },
                 { b: '#6e5e5a', l: '#ddd2c8', a: '#3a4a5e', h: '#efe6cf' }] }
  ];

  const byId = {};
  SPECIES.forEach((s, i) => { s.index = i; byId[s.id] = s; });
  // ---------- цвета ----------
  const hex = (c) => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(c.substr(i, 2), 16)); };
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const dark = (c, t) => mix(c, '#101010', t), light = (c, t) => mix(c, '#ffffff', t);

  // Вид сбоку, смотрят вправо. Координаты рисунка 0..400 × 0..254, земля y≈246.
  const VB = { x: -14, y: -14, w: 428, h: 278 };
  const OUTLINE_TYPES = { B: 1, F: 1, L: 1, A: 1, D: 1, H: 1 };

  function defs(id, pal) {
    const b = pal.b, l = pal.l, a = pal.a, h = pal.h || '#f3e6c4';
    // Противотень: тёмная спина → цвет кожи → светлое брюхо (как у настоящих животных) + свет сверху
    return `<defs>
      <linearGradient id="${id}gB" x1="0" y1="0" x2="0.12" y2="1"><stop offset="0" stop-color="${dark(b, 0.24)}"/><stop offset="0.28" stop-color="${b}"/><stop offset="0.62" stop-color="${mix(b, l, 0.28)}"/><stop offset="1" stop-color="${dark(mix(b, l, 0.45), 0.18)}"/></linearGradient>
      <linearGradient id="${id}gF" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${dark(b, 0.3)}"/><stop offset="1" stop-color="${dark(b, 0.52)}"/></linearGradient>
      <linearGradient id="${id}gL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${l}"/><stop offset="1" stop-color="${dark(l, 0.2)}"/></linearGradient>
      <linearGradient id="${id}gA" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${light(a, 0.18)}"/><stop offset="0.55" stop-color="${a}"/><stop offset="1" stop-color="${dark(a, 0.38)}"/></linearGradient>
      <linearGradient id="${id}gD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${dark(a, 0.22)}"/><stop offset="1" stop-color="${dark(a, 0.5)}"/></linearGradient>
      <linearGradient id="${id}gH" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light(h, 0.3)}"/><stop offset="0.6" stop-color="${h}"/><stop offset="1" stop-color="${mix(h, '#5a4026', 0.55)}"/></linearGradient>
      <radialGradient id="${id}iris" cx="0.4" cy="0.38" r="0.7"><stop offset="0" stop-color="#f4cf6a"/><stop offset="0.55" stop-color="#c8861e"/><stop offset="1" stop-color="#5e3406"/></radialGradient>
      <radialGradient id="${id}irisH" cx="0.4" cy="0.38" r="0.7"><stop offset="0" stop-color="#9a6a3a"/><stop offset="0.6" stop-color="#5a3a1e"/><stop offset="1" stop-color="#22140a"/></radialGradient>
      <pattern id="${id}scl" width="7" height="9" patternUnits="userSpaceOnUse">
        <path d="M0,4.5 Q3.5,0.5 7,4.5 M-3.5,9 Q0,5 3.5,9 Q7,5 10.5,9" fill="none" stroke="#000" stroke-opacity=".09" stroke-width="0.7"/></pattern>
      <pattern id="${id}bel" width="10" height="6" patternUnits="userSpaceOnUse"><path d="M0,5 H10" stroke="#000" stroke-opacity=".1" stroke-width="0.9"/></pattern>
      <filter id="${id}soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
      <filter id="${id}soft1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.1"/></filter>
      <filter id="${id}skin" x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.34" numOctaves="2" seed="11" result="t1"/>
        <feDiffuseLighting in="t1" surfaceScale="1.7" diffuseConstant="1" lighting-color="#ffffff" result="l1"><feDistantLight azimuth="235" elevation="52"/></feDiffuseLighting>
        <feComponentTransfer in="l1" result="l1b"><feFuncR type="linear" slope="0.38" intercept="0.68"/><feFuncG type="linear" slope="0.38" intercept="0.68"/><feFuncB type="linear" slope="0.38" intercept="0.68"/></feComponentTransfer>
        <feTurbulence type="turbulence" baseFrequency="0.035" numOctaves="2" seed="5" result="t2"/>
        <feColorMatrix in="t2" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.9 0 0 0 0" result="blot"/>
        <feFlood flood-color="${dark(b, 0.4)}" flood-opacity="0.28"/><feComposite in2="blot" operator="in" result="blotC"/>
        <feBlend in="SourceGraphic" in2="l1b" mode="multiply" result="bump"/>
        <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="ab"/>
        <feOffset in="ab" dx="1" dy="-7" result="abu"/>
        <feComposite in="SourceAlpha" in2="abu" operator="arithmetic" k2="1" k3="-1" result="under"/>
        <feFlood flood-color="${dark(b, 0.8)}" flood-opacity="0.42"/><feComposite in2="under" operator="in" result="ao"/>
        <feOffset in="ab" dx="-3" dy="6" result="abo"/>
        <feComposite in="SourceAlpha" in2="abo" operator="arithmetic" k2="0.6" k3="-0.6" result="rimA"/>
        <feFlood flood-color="#fff2cc" flood-opacity="0.22"/><feComposite in2="rimA" operator="in" result="rim"/>
        <feMerge result="all"><feMergeNode in="bump"/><feMergeNode in="blotC"/><feMergeNode in="ao"/><feMergeNode in="rim"/></feMerge>
        <feComposite in="all" in2="SourceAlpha" operator="in"/>
      </filter>
      <filter id="${id}paper" x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" result="n"/>
        <feColorMatrix in="n" type="saturate" values="0" result="ng"/>
        <feComponentTransfer in="ng" result="g"><feFuncR type="linear" slope="0.14" intercept="0.9"/><feFuncG type="linear" slope="0.14" intercept="0.9"/><feFuncB type="linear" slope="0.14" intercept="0.9"/></feComponentTransfer>
        <feBlend in="SourceGraphic" in2="g" mode="multiply" result="m"/>
        <feComposite in="m" in2="SourceAlpha" operator="in" result="tex"/>
        <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="sb"/><feOffset in="sb" dx="1.5" dy="3" result="so"/>
        <feFlood flood-color="#1b2a10" flood-opacity="0.26"/><feComposite in2="so" operator="in" result="sh"/>
        <feMerge><feMergeNode in="sh"/><feMergeNode in="tex"/></feMerge>
      </filter></defs>`;
  }

  // Реалистичный глаз: глазница, надбровная дуга, радужка, зрачок (у хищников — вертикальный)
  function eyeColor(id, x, y, r, pal, slit) {
    const line = dark(pal.b, 0.6);
    return `<ellipse cx="${x - r * 0.1}" cy="${y + r * 0.15}" rx="${r * 1.6}" ry="${r * 1.35}" fill="${dark(pal.b, 0.45)}" opacity="0.55" filter="url(#${id}soft)"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}${slit ? 'iris' : 'irisH'})" stroke="${line}" stroke-width="1.1"/>
      ${slit ? `<ellipse cx="${x + r * 0.12}" cy="${y}" rx="${r * 0.2}" ry="${r * 0.78}" fill="#0c0804"/>` : `<circle cx="${x + r * 0.12}" cy="${y}" r="${r * 0.46}" fill="#0c0804"/>`}
      <ellipse cx="${x - r * 0.32}" cy="${y - r * 0.38}" rx="${r * 0.26}" ry="${r * 0.18}" fill="#fff" opacity="0.85"/>
      <path d="M${x - r * 1.5},${y - r * 0.55} Q${x - r * 0.2},${y - r * 1.75} ${x + r * 1.55},${y - r * 0.85} Q${x + r * 0.2},${y - r * 1.05} ${x - r * 1.5},${y - r * 0.55} Z" fill="${dark(pal.b, 0.32)}"/>
      <path d="M${x - r * 1.1},${y - r * 0.6} Q${x},${y - r * 1.25} ${x + r * 1.15},${y - r * 0.7}" fill="none" stroke="${line}" stroke-width="1.3" stroke-linecap="round" opacity="0.8"/>`;
  }

  // Один фрагмент (часть тела) в нужном режиме
  function partInner(spId, part, mode, pal, uid) {
    const id = uid, out = [], clipId = `${id}c_${part.n}`;
    const bodyPaths = part.s.filter(s => s[0] === 'B' || s[0] === 'F').map(s => `<path d="${s[1]}"/>`).join('');
    const clip = bodyPaths ? `clip-path="url(#${clipId})"` : '';
    if (mode === 'mask') {
      part.s.forEach(s => { if (OUTLINE_TYPES[s[0]]) out.push(`<path d="${s[1]}"/>`); });
      return `<g fill="#000" stroke="#000" stroke-width="12" stroke-linejoin="round">${out.join('')}</g>`;
    }
    if (mode === 'fill') { // точная заливка силуэта без обводки — для подрезки краёв фото
      part.s.forEach(s => { if (OUTLINE_TYPES[s[0]]) out.push(`<path d="${s[1]}"/>`); });
      return `<g fill="#000">${out.join('')}</g>`;
    }
    if (mode === 'edge') { // кромка вырезанной бумаги — рисуется отдельным слоем под всеми частями, чтобы не было швов
      const edge = part.s.filter(s => OUTLINE_TYPES[s[0]] && s[0] !== 'L').map(s => `<path d="${s[1]}"/>`).join('');
      return `<g fill="#f4eee0" stroke="#f4eee0" stroke-width="5" stroke-linejoin="round" opacity="0.9">${edge}</g>`;
    }
    if (bodyPaths) out.push(`<clipPath id="${clipId}">${bodyPaths}</clipPath>`);
    if (mode === 'outline') {
      part.s.forEach(s => {
        const [t, d] = s;
        if (OUTLINE_TYPES[t]) out.push(`<path d="${d}" fill="#fff" stroke="#111" stroke-width="${t === 'H' ? 3 : 4.2}"/>`);
        else if (t === 'M') out.push(`<path d="${d}" fill="#fff" stroke="#111" stroke-width="2.4" ${clip}/>`);
        else if (t === 'N') out.push(`<path d="${d}" fill="none" stroke="#111" stroke-width="3"/>`);
        else if (t === 'E') { const [, x, y, r] = s; out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#111" stroke-width="2.6"/><circle cx="${x + r * 0.2}" cy="${y}" r="${r * 0.45}" fill="#111"/><circle cx="${x + r * 0.38}" cy="${y - r * 0.2}" r="${r * 0.15}" fill="#fff"/><path d="M${x - r * 1.2},${y - r * 1.1} Q${x},${y - r * 1.9} ${x + r * 1.3},${y - r * 1.2}" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round"/>`); }
      });
      return `<g stroke-linejoin="round" stroke-linecap="round">${out.join('')}</g>`;
    }
    // цвет: тонкая кромка бумаги → кожа (рельеф, противотень, AO, контровой свет) → глаза
    const sp = byId[spId] || {};
    const line = dark(pal.b, 0.6), mark = mix(dark(pal.b, 0.5), pal.a, 0.3);
    const skin = [], eyes = [];
    part.s.forEach(s => {
      const [t, d] = s;
      if (t === 'B' || t === 'F') skin.push(`<path d="${d}" fill="url(#${id}g${t})"/><path d="${d}" fill="url(#${id}scl)"/><path d="${d}" fill="none" stroke="${line}" stroke-width="1.3" stroke-opacity=".7"/>`);
      else if (t === 'L') skin.push(`<path d="${d}" fill="url(#${id}gL)" opacity="0.9" ${clip}/><path d="${d}" fill="url(#${id}bel)" ${clip}/>`);
      else if (t === 'A' || t === 'D') skin.push(`<path d="${d}" fill="url(#${id}g${t})" stroke="${dark(pal.a, 0.55)}" stroke-width="1.2" stroke-opacity=".8"/>`);
      else if (t === 'H') skin.push(`<path d="${d}" fill="url(#${id}gH)" stroke="${dark(pal.h || '#f3e6c4', 0.6)}" stroke-width="1"/>`);
      else if (t === 'M') skin.push(`<g ${clip}><path d="${d}" fill="${pal.m || mark}" opacity="0.62" filter="url(#${id}soft1)"/></g>`);
      else if (t === 'S') skin.push(`<path d="${d}" fill="#000" opacity="0.26" filter="url(#${id}soft)" ${clip}/>`);
      else if (t === 'G') skin.push(`<path d="${d}" fill="#fff6dc" opacity="0.2" filter="url(#${id}soft)" ${clip}/>`);
      else if (t === 'N') skin.push(`<path d="${d}" fill="none" stroke="${line}" stroke-width="1.6" stroke-linecap="round" stroke-opacity=".75"/>`);
      else if (t === 'K') skin.push(`<path d="${d}" fill="none" stroke="${dark(pal.b, 0.5)}" stroke-width="1.2" stroke-linecap="round" opacity="0.45" ${clip}/>`);
      else if (t === 'E') { const [, x, y, r] = s; eyes.push(eyeColor(id, x, y, r, pal, sp.eye === 'slit')); }
    });
    out.push(`<g filter="url(#${id}skin)">${skin.join('')}</g>`);
    out.push(eyes.join(''));
    return `<g filter="url(#${id}paper)" stroke-linejoin="round">${out.join('')}</g>`;
  }

  // палитра 9 — «легендарная», золотая (выдаётся только за яйца/подарок)
  const GOLD = { b: '#d4a72c', l: '#fff3c2', a: '#9a5f00', h: '#fff8e1', m: '#b07a10' };
  const LEGEND = 9;
  function palOf(sp, i) { i = i || 0; return i === LEGEND ? GOLD : sp.palettes[i % sp.palettes.length]; }
  let uidN = 0;
  /** Всё тело в позе покоя. mode: 'color' | 'outline' | 'mask' */
  function inner(id, mode, paletteIndex) {
    const sp = byId[id]; if (!sp) return '';
    mode = mode || 'color';
    const pal = palOf(sp, paletteIndex);
    const u = 'd' + id.slice(0, 3) + (paletteIndex || 0) + (uidN++);
    let body = ART[id].map(p => partInner(id, p, mode, pal, u)).join('');
    if (mode === 'color') body = `<g filter="url(#${u}paper)">${ART[id].map(p => partInner(id, p, 'edge', pal, u)).join('')}</g>` + body;
    return (mode === 'color' ? defs(u, pal) : '') + body;
  }
  const svgDoc = (content) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" width="${VB.w * 2}" height="${VB.h * 2}">${content}</svg>`;
  function svg(id, mode, paletteIndex, attrs) {
    const s = svgDoc(inner(id, mode, paletteIndex));
    return attrs ? s.replace(/width="\d+" height="\d+"/, attrs) : s;
  }
  const enc = (s) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  const urlCache = {};
  function url(id, paletteIndex, mode) {
    const key = id + ':' + (paletteIndex || 0) + ':' + (mode || 'color');
    if (!urlCache[key]) urlCache[key] = enc(svg(id, mode || 'color', paletteIndex));
    return urlCache[key];
  }

  /** v5: миниатюра для списков и выбора вида. SVG с фильтрами «бумаги» браузер декодирует в 800×508 и заново
   *  рисует при прокрутке — на телефоне это и подвешивало выбор динозавров. Один раз (в фоне, по одной) переводим
   *  её в маленькую картинку PNG и дальше отдаём готовую; до готовности — исходный SVG (и подменяем на месте). */
  const thumbCache = {}, thumbWait = {};
  let thumbQ = Promise.resolve();
  const TW = 360;
  function rasterThumb(key, src) {
    if (thumbWait[key]) return thumbWait[key];
    thumbWait[key] = thumbQ = thumbQ.then(() => new Promise((res) => {
      const img = new Image(); img.decoding = 'async';
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = TW; c.height = Math.round(TW * VB.h / VB.w);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const done = (u) => { c.width = c.height = 0; if (u) { thumbCache[key] = u; swap(src, u); } setTimeout(res, 16); };
          if (c.toBlob) c.toBlob(b => done(b && URL.createObjectURL(b)), 'image/png'); else done(c.toDataURL('image/png'));
        } catch (e) { setTimeout(res, 0); }
      };
      img.onerror = () => res(); img.src = src;
    }));
    return thumbWait[key];
  }
  function swap(src, u) { const im = document.images; for (let i = 0; i < im.length; i++) if (im[i].getAttribute('src') === src) im[i].src = u; }
  // исходник миниатюры — тот же рисунок, но с маленьким собственным размером: декодируется в ~7 раз быстрее
  const smallCache = {};
  const smallUrl = (id, pal) => { const k = id + ':' + (pal || 0); return smallCache[k] || (smallCache[k] = enc(svg(id, 'color', pal, `width="${TW}" height="${Math.round(TW * VB.h / VB.w)}"`))); };
  function thumb(id, paletteIndex) {
    const key = id + ':' + (paletteIndex || 0);
    if (thumbCache[key]) return thumbCache[key];
    const src = smallUrl(id, paletteIndex); rasterThumb(key, src); return src;
  }
  function warmThumbs(list) { (list || SPECIES.map(s => [s.id, 0])).forEach(([id, pal]) => { if (byId[id]) rasterThumb(id + ':' + (pal || 0), smallUrl(id, pal)); }); }

  /** Подвижная «марионетка»: каждая часть растеризуется один раз в canvas (с обрезкой по краям). */
  const rigCache = {};
  // пикселей на единицу рисунка: на телефонах динозавры мельче, а память холстов в Safari ограничена
  const SMALL = (function () { try { return Math.min(screen.width, screen.height) <= 820 || (window.matchMedia && matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } })();
  const RES = SMALL ? 1.2 : 1.9;
  // Растеризация частей — строго по одной, с паузой между ними: главный поток не блокируется
  // (нажатия на кнопки срабатывают сразу), а память не взлетает от сотни одновременных SVG с фильтрами.
  let scratch = null, queue = Promise.resolve();
  const pause = () => new Promise(r => setTimeout(r, 0));
  function rasterNow(svgText) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const W = Math.round(VB.w * RES), H = Math.round(VB.h * RES);
        if (!scratch) scratch = document.createElement('canvas');
        if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
        const c = scratch, x = c.getContext('2d', { willReadFrequently: true }); x.clearRect(0, 0, W, H); x.drawImage(img, 0, 0, W, H);
        // обрезаем прозрачные поля
        let d; try { d = x.getImageData(0, 0, W, H).data; } catch (e) { d = null; }
        let x0 = 0, y0 = 0, x1 = W, y1 = H;
        if (d) {
          x0 = W; y0 = H; x1 = 0; y1 = 0;
          for (let yy = 0; yy < H; yy += 2) for (let xx = 0; xx < W; xx += 2) if (d[(yy * W + xx) * 4 + 3] > 4) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
          x0 = Math.max(0, x0 - 3); y0 = Math.max(0, y0 - 3); x1 = Math.min(W, x1 + 4); y1 = Math.min(H, y1 + 4);
          if (x1 <= x0) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
        }
        const cc = document.createElement('canvas'); cc.width = x1 - x0; cc.height = y1 - y0;
        cc.getContext('2d').drawImage(c, x0, y0, cc.width, cc.height, 0, 0, cc.width, cc.height);
        img.onload = img.onerror = null; img.src = '';
        res({ canvas: cc, ox: VB.x + x0 / RES, oy: VB.y + y0 / RES, cw: cc.width / RES, ch: cc.height / RES });
      };
      img.onerror = () => res(null);
      img.src = enc(svgDoc(svgText));
    });
  }
  function raster(svgText) {
    const job = queue.then(() => rasterNow(svgText));
    queue = job.then(pause, pause);
    return job;
  }
  function rig(id, paletteIndex) {
    const key = id + ':' + (paletteIndex || 0);
    if (rigCache[key]) return rigCache[key];
    const sp = byId[id], pal = palOf(sp, paletteIndex);
    const u = 'r' + id.slice(0, 3) + (paletteIndex || 0);
    const parts = ART[id].map(p => { const ey = p.s.filter(x => x[0] === 'E').map(x => ({ x: x[1], y: x[2], r: x[3] })); return { n: p.n, role: p.role, off: p.off || 0, amp: p.amp == null ? 1 : p.amp, pivot: p.pivot, canvas: null, eyes: ey.length ? ey : null }; });
    const promise = Promise.all(ART[id].map((p, i) => Promise.all([
      raster(defs(u, pal) + partInner(id, p, 'color', pal, u)),
      raster(defs(u, pal) + `<g filter="url(#${u}paper)">${partInner(id, p, 'edge', pal, u)}</g>`)
    ]).then(([col, edge]) => { if (col) Object.assign(parts[i], col); if (edge) parts[i].edge = edge; })));
    rigCache[key] = { parts, promise, VB, lid: dark(pal.b, 0.12) };
    return rigCache[key];
  }

  /** Одна часть тела в цвете как отдельный SVG-документ (для текстур 3D-моделей); scale — пикселей на единицу рисунка */
  function partDoc(id, i, paletteIndex, scale) {
    const sp = byId[id], pal = palOf(sp, paletteIndex), u = 'x' + id.slice(0, 3) + (paletteIndex || 0) + '_' + i;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" width="${Math.round(VB.w * scale)}" height="${Math.round(VB.h * scale)}">${defs(u, pal)}${partInner(id, ART[id][i], 'color', pal, u)}</svg>`;
  }

  DP.Dinos = { SPECIES, byId, LEGEND, palOf, inner, svg, url, thumb, warmThumbs, rig, ART, VB, VIEW: { w: 400, h: 254 }, partDoc, enc, dark, mix, OUTLINE_TYPES };
})();
