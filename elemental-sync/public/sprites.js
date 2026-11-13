// ドット絵：すべてコードで描く（外部画像なし）
(function () {
  const OUT = '#1b1326';

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(h, f) { // f>0 明るく / f<0 暗く
    const [r, g, b] = hexToRgb(h);
    const m = (c) => Math.max(0, Math.min(255, Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f))));
    return '#' + [m(r), m(g), m(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function fromStrings(rows, pal) {
    const w = Math.max(...rows.map(r => r.length)), h = rows.length;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const c = pal[ch]; if (!c) return; ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1);
    }));
    return cv;
  }
  function overlay(base, over) {
    return base.map((row, y) => {
      const o = over[y] || '';
      return [...row.padEnd(16, '.')].map((ch, x) => (o[x] && o[x] !== ' ' && o[x] !== '_') ? (o[x] === '-' ? '.' : o[x]) : ch).join('');
    });
  }

  // ---- 主人公たち（16x18、右向き） ----
  const BODY = [
    '................',
    '.....oooooo.....',
    '....ohhhhhhoo...',
    '...ohhhhhhhhho..',
    '...ohhHssssssoo.',
    '...ohHsssseesso.',
    '....oHssssssso..',
    '.....osSSSSso...',
    '.....occcccco...',
    '....occlccccCo..',
    '...osoclcccCoso.',
    '...ssoccccccoss.',
    '.....obbbbbbo...',
    '.....occcoCCo...',
    '.....occo.oCo...',
    '.....obbo.obbo..',
    '....obbbo.obbbo.',
    '................',
  ];
  const HERO = {
    attacker: {
      pal: { h: '#c2452d', H: '#7e2414', c: '#d8433a', C: '#8e2420', l: '#f6b04a', w: '#dfe7f2', W: '#8a97ad', g: '#f6b04a' },
      over: [
        '_____________ww_',
        '_____________wW_',
        '____ohhohhho_wW_',
        '___ohhhhhhhhhwW_',
        '___ohhH______wW_',
        '_____________wW_',
        '_____________wW_',
        '____________gggg',
        '_____________bo_',
      ],
    },
    debuffer: {
      pal: { h: '#6a3fa0', H: '#3e2163', c: '#7d4cba', C: '#4a2a78', l: '#c9a3ff', w: '#7a5534', W: '#4d3220', g: '#d77bff' },
      over: [
        '______________g_',
        '_____oooooo__ggg',
        '____ohhhhhhoo_g_',
        '___ohhhhhhhhho_w',
        '___ohhHHsssssooW',
        '___ohHHsseeesso w',
        '___ohHssssssso_W',
        '___ohhosSSSSso_w',
        '____ohhcccccco_W',
        '____ohcclccccCow',
        '___osoclcccCosoW',
        '___ssoccccccossw',
      ],
    },
    tank: {
      pal: { h: '#9aa6bb', H: '#5f6a80', c: '#4a6fb5', C: '#2c4475', l: '#c8d6ef', w: '#b8c2d6', W: '#6d7891', g: '#f2d064', b: '#3a3048' },
      over: [
        '________________',
        '_____oooooo_____',
        '____ohhhhhhoo___',
        '___ohllhhhhhho__',
        '___ohhHhhhhhhoo_',
        '___ohHsseessso__',
        '____oHssssssso__',
        '_____osSSSSso___',
        '_________oooooo_',
        '________owwwwwwo',
        '________owWgWWwo',
        '________owggggwo',
        '________owWgWWwo',
        '________owWgWWwo',
        '_________owWWwo_',
        '__________owwo__',
        '___________oo___',
      ],
    },
    healer: {
      pal: { h: '#f3d27b', H: '#b8913a', c: '#f4f1ea', C: '#b9b2c4', l: '#f2c94c', w: '#c79b4b', W: '#7d5c26', g: '#9ff3ff' },
      over: [
        '_____________ggg',
        '_____oooooo__gWg',
        '____ohhhhhhoo_ggg',
        '___ohhhhhhhhho_w',
        '___ohhHssssssooW',
        '___ohHsssseessow',
        '___ohHssssssso_W',
        '___ohhosSSSSso_w',
        '___ohhocccccco_W',
        '____oocclccccCow',
        '___osoclcccCosoW',
        '___ssoccccccossw',
        '____occccccccC_W',
        '____occcccccCCo_',
        '____occcccccCCo_',
        '____occcccccCCo_',
        '....obbbo.obbbo.',
      ],
    },
  };
  // 描き起こしたキャラのドット絵。役職名をキーにすると、その役職の見た目を差し替えられる
  // （下の silver_swordswoman は、画像をもとに描いた銀髪の剣士。今は使っていない。使うときはキーを attacker にする）
  const CUSTOM_HERO = {
    silver_swordswoman: {
      rows: [
      "..................................",
      "..................................",
      "..........oooooo..................",
      "........oohhHHhHo.................",
      "......ooHhhhHHhHho................",
      ".....orrHhHhHHHhhHo...............",
      "....ohhrHhhHhHHHHho..............o",
      "...ohhhHhHhHhHHHhHho............oM",
      "...ohrhHhHhHHHhsssso...........oMM",
      "...ohhhHhHHHHHsEEEso..........oMML",
      "..ohhhhHhHHHHHseHesso........oMMLo",
      "..ohhhhHHdHHHsseEeso........oMMLo.",
      "..ohdhhhdHdHHSssssSo.......oMMLo..",
      ".ohhdhhhhHHHHSsssSo.......oMMLo...",
      ".ohhdhhhhhhHHHSSoo.......oMMLo....",
      ".ohhddhmmmmmHmSSmmo.....oMMLo.....",
      ".ohHdddmmmmmHymmmmo....oMMLo......",
      ".ohHdddmmmmhHtmnnno...oMMLo.......",
      ".ohHddnmmmNhmmmnnnnoooMMLo........",
      ".ohHddntmmmNNNmmnnnnggMLyo........",
      ".ohhHdnnttmmmNNmttnnggoyo.........",
      "..ohHdnnnntttttNNntgggyo..........",
      "..ohHNNNnnnnwwWnNnoytyo...........",
      "..ohHNNNnbbbtytbbnnoKo............",
      "..ohHNNNnnnnwwbbbnnoo.............",
      "...odNNNnnnbbbWnnnno..............",
      "...ohNNNnnnnwwwnnnno..............",
      "..ohhNNNnnNnNnNnNnno..............",
      "...onNNNnnNnNnNnNnnno.............",
      "...odNNNnnNnNnNnNnnno.............",
      "...onNNNnndnNnNnNnnno.............",
      "...otnNNNhNNNNNNNNnoto............",
      "....otnNnnkkookknntto.............",
      ".....otnookkookkotoo..............",
      "......otoottoottoo................",
      ".......o.okkookko.................",
      ".........okkookko.................",
      ".........okkookkoo................",
      "........oKKKKoKKKKo...............",
      "........oKKtKoKKtKo...............",
      "........oKKKKoKKKKo...............",
      "........oKKKKoKKKKo...............",
      ".........oooo.oooo................"
      ],
      pal: {"o": "#1a1630", "H": "#f4f2fc", "h": "#cecbea", "d": "#9692c4", "s": "#f9dece", "S": "#e2b4a0", "e": "#5078dc", "E": "#1e2864", "w": "#f6f6fa", "W": "#c4c6d8", "n": "#303468", "N": "#1e2048", "m": "#4a508c", "t": "#cdcdda", "b": "#623e2a", "k": "#282430", "K": "#16141e", "r": "#282e78", "M": "#e8eef8", "L": "#96a2be", "y": "#dcb450", "g": "#2c2838"},
    },
  };
  function heroSprite(role) {
    if (CUSTOM_HERO[role]) return fromStrings(CUSTOM_HERO[role].rows, CUSTOM_HERO[role].pal);
    const v = HERO[role];
    const rows = overlay(BODY, v.over);
    const pal = Object.assign({ o: OUT, s: '#f5c9a0', S: '#d49a74', e: '#2b2140', b: '#4a3328', w: '#ccc', W: '#888', g: '#ff0' }, v.pal);
    return fromStrings(rows, pal);
  }

  // ---- ラスター描画の小道具（敵など） ----
  function Grid(w, h) { this.w = w; this.h = h; this.a = new Array(w * h).fill(null); }
  Grid.prototype.set = function (x, y, c) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.a[y * this.w + x] = c; };
  Grid.prototype.get = function (x, y) { return (x >= 0 && y >= 0 && x < this.w && y < this.h) ? this.a[y * this.w + x] : null; };
  Grid.prototype.ellipse = function (cx, cy, rx, ry, fn) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) this.set(x, y, typeof fn === 'function' ? fn(x, y, dx, dy) : fn);
    }
  };
  Grid.prototype.poly = function (pts, fn) {
    const ys = pts.map(p => p[1]); const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
    for (let y = y0; y <= y1; y++) for (let x = 0; x < this.w; x++) {
      let inside = false; const px = x + 0.5, py = y + 0.5;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) this.set(x, y, typeof fn === 'function' ? fn(x, y) : fn);
    }
  };
  Grid.prototype.outline = function (col) {
    const add = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.get(x, y)) continue;
      if (this.get(x + 1, y) || this.get(x - 1, y) || this.get(x, y + 1) || this.get(x, y - 1)) add.push([x, y]);
    }
    add.forEach(([x, y]) => this.set(x, y, col));
  };
  Grid.prototype.toCanvas = function () {
    const cv = document.createElement('canvas'); cv.width = this.w; cv.height = this.h;
    const ctx = cv.getContext('2d');
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const c = this.get(x, y); if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); } }
    return cv;
  };

  function slimeSprite(element) {
    const el = GameData.ELEMENTS[element];
    const base = el.color, dk = el.dark, lt = shade(base, 0.45);
    const g = new Grid(24, 18);
    g.ellipse(12, 11, 10, 7.5, (x, y, dx, dy) => {
      if (y > 15) return null;
      const t = dy * 0.8 + dx * 0.3;
      return t > 0.45 ? dk : t < -0.45 ? lt : base;
    });
    for (let x = 3; x <= 20; x++) if (g.get(x, 15)) g.set(x, 16, dk);
    // 頭のとんがり
    g.set(11, 3, base); g.set(12, 3, base); g.set(12, 2, lt);
    // ハイライト
    g.set(7, 7, '#ffffff'); g.set(8, 7, '#ffffff'); g.set(7, 8, '#ffffff');
    // 目と口
    [[9, 10], [15, 10]].forEach(([x, y]) => { g.set(x, y, OUT); g.set(x, y + 1, OUT); g.set(x + 1, y, OUT); g.set(x + 1, y + 1, OUT); g.set(x, y, '#ffffff'); });
    g.set(12, 13, OUT); g.set(13, 13, OUT);
    g.outline(OUT);
    return g.toCanvas();
  }

  function eagleSprite(element) {
    const el = GameData.ELEMENTS[element];
    const body = '#8a5a3c', bodyD = '#5a3622', bodyL = '#b98458';
    const wing = shade(el.color, -0.25), wingD = el.dark, wingL = shade(el.color, 0.35);
    const g = new Grid(56, 44);
    // 翼（後ろ）
    g.poly([[24, 18], [2, 4], [6, 14], [1, 20], [8, 24], [4, 30], [16, 30], [26, 28]], (x, y) => (y > 26 ? wingD : y < 10 ? wingL : (x - y) % 8 === 0 ? wingD : wing));
    // 体
    g.ellipse(30, 26, 11, 12, (x, y, dx, dy) => dy > 0.35 ? bodyD : dx < -0.4 ? bodyL : body);
    // 翼（前）
    g.poly([[24, 22], [44, 24], [40, 28], [44, 32], [30, 34], [20, 30]], (x, y) => (y > 31 ? wingD : (x + y) % 6 === 0 ? wingL : wing));
    // 胸の白
    g.ellipse(33, 27, 5, 7, (x, y, dx, dy) => dy > 0.5 ? '#c9c0b0' : '#efe8dc');
    // 頭
    g.ellipse(37, 13, 7, 6.5, (x, y, dx, dy) => dy > 0.4 ? '#cfc5b5' : '#f4efe6');
    // くちばし
    g.poly([[42, 11], [50, 13], [47, 18], [42, 16]], (x, y) => y > 15 ? '#c98a1a' : '#f2b632');
    g.set(48, 17, '#c98a1a');
    // 目
    g.set(40, 11, OUT); g.set(41, 11, OUT); g.set(40, 12, '#ff3b30'); g.set(41, 12, OUT);
    g.set(38, 10, OUT); g.set(39, 10, OUT); g.set(42, 10, OUT);
    // 冠羽
    g.poly([[31, 9], [26, 4], [33, 7]], wingL); g.poly([[33, 8], [30, 2], [36, 7]], wing);
    // 尾
    g.poly([[22, 34], [12, 42], [20, 41], [24, 43], [30, 36]], (x, y) => (x % 3 === 0 ? wingD : wing));
    // 足
    [[27, 37], [33, 37]].forEach(([x, y]) => { for (let i = 0; i < 4; i++) g.set(x, y + i, '#e2a32b'); g.set(x - 1, y + 4, '#e2a32b'); g.set(x + 1, y + 4, '#e2a32b'); g.set(x, y + 4, '#e2a32b'); });
    g.outline(OUT);
    return g.toCanvas();
  }

  // 部位（浮遊する結晶）
  function crystalSprite(element) {
    const el = GameData.ELEMENTS[element];
    const base = el.color, dk = el.dark, lt = shade(base, 0.55);
    const g = new Grid(20, 24);
    g.poly([[10, 1], [18, 10], [10, 22], [2, 10]], (x, y) => (x < 10 ? (y < 10 ? lt : base) : (y < 10 ? base : dk)));
    g.poly([[10, 4], [14, 10], [10, 17], [6, 10]], (x, y) => (x < 10 ? '#ffffff' : lt));
    g.set(8, 7, '#ffffff'); g.set(9, 6, '#ffffff');
    g.outline(OUT);
    return g.toCanvas();
  }

  // ドラゴン（右向きで作り、表示時に左右反転）。棘・本体・左足を別レイヤーにして、部位が壊れたら消せるようにする
  const DRAGON_COLORS = {
    fire: ['#d8452b', '#f2c27a', '#ffd36a'], wind: ['#3fae6a', '#d8f2b0', '#e6fff0'], water: ['#3a7fd8', '#bfe3ff', '#e0f4ff'],
    light: ['#e8c33a', '#fff4c8', '#ffffff'], dark: ['#6b3fb0', '#c8b0f0', '#e0c8ff'],
  };
  const DRAGON_W = 64, DRAGON_H = 44;
  function dragonSprite(element) {
    const [base, belly, spike] = DRAGON_COLORS[element] || DRAGON_COLORS.fire;
    const dk = shade(base, -0.35), lt = shade(base, 0.3), bd = shade(belly, -0.2), eye = '#ffe066';
    const body = new Grid(DRAGON_W, DRAGON_H), spikes = new Grid(DRAGON_W, DRAGON_H), leg = new Grid(DRAGON_W, DRAGON_H);
    // 尾
    body.poly([[2, 22], [14, 24], [22, 30], [14, 31], [6, 28]], (x, y) => (y > 27 ? dk : base)); body.set(1, 21, dk); body.set(2, 21, base);
    // 奥の後ろ足
    body.ellipse(21, 29, 6, 6, dk);
    body.poly([[17, 30], [24, 31], [23, 37], [25, 41], [18, 41], [19, 36]], dk); body.poly([[16, 40], [26, 40], [26, 42], [15, 42]], OUT);
    // 胴体
    body.ellipse(30, 27, 15, 10, (x, y, dx, dy) => (dy > 0.35 ? belly : dy < -0.55 ? lt : base));
    // 手前の後ろ足
    body.ellipse(24, 30, 7, 7, (x, y, dx, dy) => (dy < -0.3 ? shade(base, 0.1) : base));
    body.poly([[20, 32], [28, 32], [27, 38], [29, 42], [21, 42], [22, 37]], base); body.poly([[19, 41], [30, 41], [30, 43], [18, 43]], dk);
    [19, 22, 25, 28].forEach(x => body.set(x, 43, '#f0f0f0'));
    // 奥の前足
    body.poly([[38, 29], [44, 29], [45, 35], [43, 41], [38, 41], [39, 35]], dk); body.poly([[37, 40], [46, 40], [46, 42], [36, 42]], OUT);
    // 首と頭
    body.poly([[38, 22], [44, 12], [50, 10], [52, 15], [46, 22], [42, 30]], (x, y) => (x < 44 && y < 20 ? lt : base));
    body.poly([[46, 8], [58, 9], [62, 13], [58, 16], [48, 16], [45, 12]], (x, y) => (y < 13 ? base : dk));
    body.poly([[52, 14], [62, 13], [60, 17], [52, 17]], bd);
    body.poly([[47, 8], [44, 3], [50, 7]], belly); body.poly([[51, 8], [50, 2], [54, 8]], belly);
    body.set(55, 11, eye); body.set(56, 11, eye); body.set(55, 12, OUT);
    body.set(61, 13, OUT); body.set(59, 15, '#ffffff'); body.set(57, 15, '#ffffff');
    for (let x = 22; x < 40; x += 3) { body.set(x, 33, bd); body.set(x + 1, 34, bd); }
    // たたんだ翼
    body.poly([[24, 18], [34, 13], [38, 20], [30, 22]], (x, y) => ((x + y) % 5 === 0 ? dk : shade(base, -0.15)));
    // 背中の棘（部位）
    [[16, 22, 5], [21, 19, 6], [26, 17, 7], [31, 16, 7], [36, 17, 6], [41, 15, 5], [45, 10, 4]].forEach(([x, y, h]) =>
      spikes.poly([[x - 2, y + 1], [x + 1, y - h], [x + 3, y + 1]], (X) => (X < x + 1 ? shade(spike, 0.35) : spike)));
    // 左足（部位：手前の前足）
    leg.poly([[32, 28], [39, 28], [40, 34], [38, 41], [32, 41], [33, 34]], (x) => (x < 36 ? base : dk));
    leg.poly([[30, 40], [41, 40], [41, 43], [29, 43]], dk);
    [30, 33, 36, 39].forEach(x => leg.set(x, 43, '#f0f0f0'));
    body.outline(OUT); spikes.outline(OUT); leg.outline(OUT);
    return { body: body.toCanvas(), spikes: spikes.toCanvas(), leg: leg.toCanvas(), w: DRAGON_W, h: DRAGON_H };
  }

  // 属性アイコン 9x9
  const ICONS = {
    fire: ['....a....', '...aa....', '...aba...', '..abba.a.', '.abbbbaa.', '.abccbba.', '.abcccba.', '..abcba..', '...aaa...'],
    wind: ['.........', '..aaaa...', '.a....a..', '......a..', 'aaaaaaa..', '.........', 'aaaaaa.a.', '.......a.', '....aaa..'],
    water: ['....a....', '...aba...', '...aba...', '..abbba..', '.abbbbba.', '.abcbbba.', '.abccbba.', '..abbba..', '...aaa...'],
    light: ['....a....', '....a....', '...aba...', 'aaabcbaaa', '.abcccba.', '..abcba..', '..ab.ba..', '.ab...ba.', '.a.....a.'],
    dark: ['...aaa...', '..abba...', '.abba....', '.aba.....', '.aba.....', '.abba....', '..abba.a.', '...abbba.', '....aaa..'],
  };
  function elementIcon(element) {
    const el = GameData.ELEMENTS[element];
    return fromStrings(ICONS[element], { a: element === 'wind' ? el.color : OUT, b: el.color, c: shade(el.color, 0.6) });
  }

  // 背景 320x180
  function background(w, h, seed) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    let s = seed || 7; const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const sky = ['#2a2350', '#3b3270', '#53468f', '#7a5fa8', '#b07aa8', '#e39b8e'];
    const band = Math.ceil((h * 0.62) / sky.length);
    sky.forEach((c, i) => {
      ctx.fillStyle = c; ctx.fillRect(0, i * band, w, band + 1);
      if (i < sky.length - 1) { ctx.fillStyle = sky[i + 1]; for (let x = 0; x < w; x += 2) ctx.fillRect(x + ((i % 2)), (i + 1) * band - 1, 1, 1); }
    });
    // 星
    for (let i = 0; i < 40; i++) { ctx.fillStyle = r() > 0.7 ? '#fff6c8' : '#cfc8ff'; ctx.fillRect((r() * w) | 0, (r() * h * 0.3) | 0, 1, 1); }
    // 月
    ctx.fillStyle = '#fff1c4'; for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) if (x * x + y * y <= 36) ctx.fillRect(250 + x, 28 + y, 1, 1);
    ctx.fillStyle = '#e9d9a6'; ctx.fillRect(247, 26, 2, 2); ctx.fillRect(252, 31, 2, 1);
    // 遠くの山
    const hills = (base, amp, col, off) => { ctx.fillStyle = col; for (let x = 0; x < w; x++) { const y = base + Math.sin((x + off) / 23) * amp + Math.sin((x + off) / 9) * amp * 0.3; ctx.fillRect(x, y | 0, 1, h); } };
    hills(h * 0.55, 8, '#4b3b6e', 10);
    hills(h * 0.62, 6, '#3a3058', 80);
    // 地面
    ctx.fillStyle = '#2f4a3a'; ctx.fillRect(0, h * 0.68, w, h);
    ctx.fillStyle = '#3d6048'; ctx.fillRect(0, h * 0.68, w, 3);
    for (let i = 0; i < 260; i++) { ctx.fillStyle = r() > 0.5 ? '#45704f' : '#26402f'; ctx.fillRect((r() * w) | 0, (h * 0.7 + r() * h * 0.3) | 0, 1, 1); }
    // 草
    for (let x = 0; x < w; x += 3) { if (r() > 0.6) { ctx.fillStyle = '#5a8a5e'; ctx.fillRect(x, (h * 0.68 - 1) | 0, 1, 2); } }
    // 木（左右）
    const tree = (tx, ty, sz) => {
      ctx.fillStyle = '#3a2a2a'; ctx.fillRect(tx - 1, ty, 3, sz);
      for (let k = 0; k < 3; k++) { ctx.fillStyle = ['#1f3a2c', '#2a4d38', '#36614a'][k]; const rr = sz * (0.9 - k * 0.22); for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) if (x * x + y * y <= rr * rr) ctx.fillRect(tx + x - k, ty - sz * 0.4 + y - k, 1, 1); }
    };
    tree(12, h * 0.6, 14); tree(300, h * 0.58, 16); tree(160, h * 0.61, 8);
    return cv;
  }

  window.Sprites = { heroSprite, slimeSprite, eagleSprite, crystalSprite, dragonSprite, elementIcon, background, shade };
})();
