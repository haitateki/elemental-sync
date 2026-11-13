// 共通データ：サーバー(Node)とブラウザの両方で読み込む
(function (root) {
  const ELEMENTS = {
    fire:  { name: '火', color: '#ff6b3d', dark: '#9c2a12' },
    wind:  { name: '風', color: '#5fe08a', dark: '#1f7a45' },
    water: { name: '水', color: '#4aa8ff', dark: '#1a4f9c' },
    light: { name: '光', color: '#ffe066', dark: '#a8861a' },
    dark:  { name: '闇', color: '#b07cff', dark: '#4b2a8c' },
  };
  const ELEMENT_ORDER = ['fire', 'wind', 'water', 'light', 'dark'];

  // 攻撃側 → 受ける側 の倍率（循環：火→風→水→火、光⇔闇。光闇と火風水は等倍）
  // atk には属性の配列も渡せる（2属性カードは有利なほうの相性を使う）
  function affinity(atk, def) {
    if (Array.isArray(atk)) return Math.max(...atk.map(a => affinity(a, def)));
    if (!atk || !def) return 1;
    const beats = { fire: 'wind', wind: 'water', water: 'fire' };
    if (beats[atk] === def) return 2.0;
    if (beats[def] === atk) return 0.5;
    if ((atk === 'light' && def === 'dark') || (atk === 'dark' && def === 'light')) return 2.0;
    return 1;
  }
  // カードの属性（2属性カードは elements に2つ）
  function elementsOf(card) { return card.elements || [card.element]; }
  // あるカードのチェイン人数：そのカードのどちらかの属性を出している味方の人数（本人を含む）
  function chainCountFor(card, playerElementSets) {
    const els = elementsOf(card);
    return playerElementSets.filter(set => els.some(e => set.has(e))).length;
  }
  function weaknessOf(def) {
    const m = { wind: 'fire', water: 'wind', fire: 'water', light: 'dark', dark: 'light' };
    return m[def];
  }

  // 同じ属性を出した「人数」ごとの倍率
  const SYNC_MULT = [1.0, 1.0, 1.2, 1.5, 2.5];
  // コストによる倍率（重いカードに役割を持たせる）：2〜3コスト×1.0、4コスト×1.2、5コスト×1.5。最終威力にかける
  function costMult(cost) { return cost >= 5 ? 1.5 : cost === 4 ? 1.2 : 1.0; }

  const ROLES = {
    attacker: { name: 'アタッカー', sub: 'フルアタッカー', color: '#e8483c' },
    debuffer: { name: 'デバッファー', sub: 'デバフ＋サブアタッカー', color: '#9b59d0' },
    tank:     { name: 'タンク', sub: '挑発＋防御（防御カードで味方全体のドロー+1）', color: '#4a7fd4' },
    healer:   { name: 'ヒーラー', sub: '回復＋バフ', color: '#f0d27a' },
  };
  const ROLE_ORDER = ['attacker', 'debuffer', 'tank', 'healer'];

  // 状態（バフ・デバフ）。値は「同じ種類の合計」で効く。持続ターンは1つずつ別に数える
  // pct: true は%表示
  const STATUS = {
    atkUp:   { name: '攻撃力アップ', short: '攻↑', desc: '攻撃力+X', good: true },
    healUp:  { name: '回復量アップ', short: '回↑', desc: '回復量+X（最後に加算）', good: true },
    dmgUp:   { name: '与ダメージアップ', short: '与ダメ', desc: '与えるダメージ+X（最後に加算）', good: true },
    defUp:   { name: '防御アップ', short: '防↑', desc: '受けるダメージ-X', good: true },
    critUp:  { name: '会心率アップ', short: '会心', desc: 'クリティカル率+X%（ダメージ1.5倍）', good: true, pct: true },
    regen:   { name: '再生', short: '再生', desc: 'ターン終了時にHPをX回復', good: true },
    taunt:   { name: '挑発', short: '挑発', desc: '敵の単体攻撃を引きつけ、自分が受けるダメージをX%カット', good: true, pct: true },
    atkDown: { name: '攻撃力ダウン', short: '攻↓', desc: '攻撃力-X', good: false },
    defDown: { name: '防御ダウン', short: '防↓', desc: '防御力-X', good: false },
    vulnUp:  { name: '被ダメージアップ', short: '被ダメ↑', desc: '受けるダメージ+X（最後に加算）', good: false },
    poison:  { name: '毒', short: '毒', desc: 'ターン終了時にXダメージ', good: false },
  };

  // 優先度：大きいほど先に発動
  const P = { BUFF: 100, DEFENSE: 80, DEBUFF: 60, ATTACK: 40, HEAL: 30 };

  // stats: カード1枚が持つ基本ステータス（デッキの合計がキャラのステータス。代表カードは2倍）
  // effects: damage / heal / status(status, value, turns) / draw（エネルギーを増やす効果は作らない）
  //   turns: 1 = このターンのみ、2 = 次のターンまで …
  // target: enemy / allEnemies / ally / self / allAllies
  // chain: { min: 同じ属性を出した人数, effects: [...] } …「○○チェイン」
  const st = (hp, atk, heal) => ({ hp, atk, heal });
  const S = (status, value, turns) => ({ type: 'status', status, value, turns });
  const DRAW_ALL = { type: 'draw', value: 1, allAllies: true }; // タンクの防御カード：味方全体のドロー+1
  const D_ = (value) => ({ type: 'damage', value });
  const H_ = (value) => ({ type: 'heal', value });
  // chain: { min: 必要な人数, effects: [...] } … 「○○チェイン」。同じ種類の効果には数値を上乗せ、なければ追加
  const CARDS = [
    // ---- アタッカー（自己バフと攻撃のみ） ----
    { id: 'a_fire_slash', name: '炎の斬撃', role: 'attacker', element: 'fire', cost: 2, priority: P.ATTACK, target: 'enemy', stats: st(6, 1, 0), effects: [D_(10)], chain: { min: 2, effects: [D_(6)] } },
    { id: 'a_wind_slash', name: '疾風斬り', role: 'attacker', element: 'wind', cost: 2, priority: P.ATTACK, target: 'enemy', stats: st(6, 1, 0), effects: [D_(10)], chain: { min: 2, effects: [D_(6)] } },
    { id: 'a_water_slash', name: '水刃', role: 'attacker', element: 'water', cost: 2, priority: P.ATTACK, target: 'enemy', stats: st(6, 1, 0), effects: [D_(10)], chain: { min: 2, effects: [D_(6)] } },
    { id: 'a_light_strike', name: '閃光突き', role: 'attacker', element: 'light', cost: 2, priority: P.ATTACK, target: 'enemy', stats: st(6, 1, 0), effects: [D_(10)], chain: { min: 2, effects: [D_(6)] } },
    { id: 'a_war_cry', name: '闘気', role: 'attacker', element: 'dark', cost: 2, priority: P.BUFF, target: 'self', stats: st(6, 1, 0), effects: [S('atkUp', 4, 2)], chain: { min: 2, effects: [S('atkUp', 3, 2)] } },
    { id: 'a_focus', name: '集中', role: 'attacker', element: 'light', cost: 3, priority: P.BUFF, target: 'self', stats: st(6, 0, 0), effects: [S('critUp', 30, 2)], chain: { min: 3, effects: [S('critUp', 30, 2)] } },
    { id: 'a_whirl', name: '旋風', role: 'attacker', element: 'wind', cost: 3, priority: P.ATTACK, target: 'allEnemies', stats: st(5, 1, 0), effects: [D_(9)], chain: { min: 3, effects: [D_(9)] } },
    { id: 'a_heavy', name: '豪炎撃', role: 'attacker', element: 'fire', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(5, 1, 0), effects: [D_(24)], chain: { min: 3, effects: [D_(12)] } },
    { id: 'a_tide', name: '激流突き', role: 'attacker', element: 'water', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(5, 1, 0), effects: [D_(24)], chain: { min: 3, effects: [D_(12)] } },
    { id: 'a_dark_rend', name: '闇裂き', role: 'attacker', element: 'dark', cost: 5, priority: P.ATTACK, target: 'enemy', stats: st(5, 1, 0), effects: [D_(22)], chain: { min: 3, effects: [D_(22)] } },
    { id: 'a_tempest', name: '連風斬', role: 'attacker', element: 'wind', cost: 3, priority: P.ATTACK, target: 'enemy', stats: st(5, 1, 0), effects: [D_(7), { ...D_(7), hit: 2 }], chain: { min: 2, effects: [{ ...D_(7), hit: 3 }] } },
    { id: 'a_blade_aura', name: '剣気', role: 'attacker', element: 'fire', cost: 3, priority: P.BUFF, target: 'self', stats: st(6, 1, 0), effects: [S('atkUp', 3, 3)], chain: { min: 2, effects: [S('dmgUp', 4, 3)] } },
    { id: 'a_inferno', name: '業火', role: 'attacker', element: 'fire', cost: 5, priority: P.ATTACK, target: 'enemy', stats: st(5, 2, 0), effects: [D_(32)], chain: { min: 4, effects: [D_(32)] } },
    { id: 'a_unique', name: '聖剣解放', role: 'attacker', element: 'light', elements: ['fire', 'wind', 'water', 'light', 'dark'], cost: 5, priority: P.ATTACK, target: 'allEnemies', unique: true, gauge: 3, critMult: 2.0, stats: st(0, 0, 0), effects: [D_(10)], chain: { min: 4, effects: [D_(18)] } },
    { id: 'a_unique1', name: '聖刃一閃', role: 'attacker', element: 'light', elements: ['fire', 'wind', 'water', 'light', 'dark'], cost: 2, priority: P.ATTACK, target: 'enemy', unique: true, gauge: 1, critMult: 1.3, stats: st(0, 0, 0), effects: [D_(8)], chain: { min: 4, effects: [D_(12)] } },
    { id: 'a_unique2', name: '聖剣連舞', role: 'attacker', element: 'light', elements: ['fire', 'wind', 'water', 'light', 'dark'], cost: 3, priority: P.ATTACK, target: 'enemy', unique: true, gauge: 2, critMult: 1.6, stats: st(0, 0, 0), effects: [D_(12), S('atkDown', 2, 2)], chain: { min: 4, effects: [D_(18), S('atkDown', 3, 2)] } },

    // ---- デバッファー（低コスト＝デバフ、高コスト＝攻撃にも参加） ----
    { id: 'd_scorch', name: '灼熱の呪い', role: 'debuffer', element: 'fire', cost: 2, priority: P.DEBUFF, target: 'enemy', stats: st(5, 0, 0), effects: [S('defDown', 5, 2)], chain: { min: 2, effects: [S('defDown', 3, 2)] } },
    { id: 'd_poison', name: '毒の霧', role: 'debuffer', element: 'wind', cost: 2, priority: P.DEBUFF, target: 'enemy', stats: st(5, 0, 0), effects: [S('poison', 5, 3)], chain: { min: 2, effects: [S('poison', 3, 3)] } },
    { id: 'd_curse', name: '弱点看破', role: 'debuffer', element: 'light', cost: 2, priority: P.DEBUFF, target: 'enemy', stats: st(6, 0, 0), effects: [S('vulnUp', 4, 2)], chain: { min: 2, effects: [S('vulnUp', 3, 2)] } },
    { id: 'd_frost', name: '凍てつく霧', role: 'debuffer', element: 'water', cost: 2, priority: P.DEBUFF, target: 'enemy', stats: st(6, 0, 0), effects: [S('atkDown', 5, 2)], chain: { min: 2, effects: [S('atkDown', 3, 2)] } },
    { id: 'd_hex', name: '呪縛', role: 'debuffer', element: 'dark', cost: 2, priority: P.DEBUFF, target: 'enemy', stats: st(5, 0, 0), effects: [S('vulnUp', 3, 3)], chain: { min: 3, effects: [S('defDown', 4, 3)] } },
    { id: 'd_flash', name: '目くらまし', role: 'debuffer', element: 'light', cost: 3, priority: P.DEBUFF, target: 'allEnemies', stats: st(6, 0, 0), effects: [S('atkDown', 4, 2)], chain: { min: 3, effects: [S('atkDown', 3, 2)] } },
    { id: 'd_chill', name: '氷の枷', role: 'debuffer', element: 'water', cost: 3, priority: P.DEBUFF, target: 'allEnemies', stats: st(5, 0, 0), effects: [S('atkDown', 3, 3)], chain: { min: 2, effects: [S('atkDown', 2, 3)] } },
    { id: 'd_ember', name: '火炎弾', role: 'debuffer', element: 'fire', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(6, 1, 0), effects: [D_(16), S('poison', 4, 3)], chain: { min: 3, effects: [D_(10)] } },
    { id: 'd_shadow', name: '影縫い', role: 'debuffer', element: 'dark', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(6, 1, 0), effects: [D_(18)], chain: { min: 2, effects: [S('vulnUp', 4, 2)] } },
    { id: 'd_storm', name: '毒風の刃', role: 'debuffer', element: 'wind', cost: 5, priority: P.ATTACK, target: 'allEnemies', stats: st(5, 1, 0), effects: [D_(12), S('poison', 4, 3)], chain: { min: 3, effects: [S('poison', 4, 3)] } },
    { id: 'd_gale', name: '風縛り', role: 'debuffer', element: 'wind', cost: 3, priority: P.DEBUFF, target: 'allEnemies', stats: st(5, 0, 0), effects: [S('atkDown', 5, 2)], chain: { min: 3, effects: [S('atkDown', 3, 2)] } },
    { id: 'd_breaker', name: '砕氷', role: 'debuffer', element: 'water', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(5, 1, 0), effects: [D_(14), S('defDown', 5, 2)], chain: { min: 3, effects: [D_(8)] } },
    { id: 'd_drain', name: '吸命', role: 'debuffer', element: 'dark', cost: 5, priority: P.ATTACK, target: 'enemy', stats: st(6, 1, 1), effects: [D_(24)], chain: { min: 2, effects: [{ ...H_(10), self: true }] } },
    { id: 'd_unique', name: '終焉の刻印', role: 'debuffer', element: 'dark', elements: ['fire', 'wind', 'water', 'light', 'dark'], cost: 5, priority: P.DEBUFF, target: 'enemy', unique: true, gauge: 3, stats: st(0, 0, 0), effects: [S('vulnUp', 3, 2), S('poison', 3, 3)], chain: { min: 4, effects: [S('vulnUp', 7, 2), S('poison', 7, 3)] } },
    { id: 'd_unique1', name: '呪いの兆し', role: 'debuffer', element: 'dark', elements: ['fire', 'wind', 'water', 'light', 'dark'], cost: 2, priority: P.DEBUFF, target: 'allEnemies', unique: true, gauge: 1, stats: st(0, 0, 0), effects: [S('atkDown', 2, 2)], chain: { min: 4, effects: [S('atkDown', 4, 2)] } },
    { id: 'd_unique2', name: '蝕みの鎖', role: 'debuffer', element: 'dark', elements: ['fire', 'wind', 'water', 'light', 'dark'], cost: 3, priority: P.DEBUFF, target: 'allEnemies', unique: true, gauge: 2, stats: st(0, 0, 0), effects: [S('defDown', 2, 2), S('poison', 2, 3)], chain: { min: 4, effects: [S('defDown', 3, 2), S('poison', 3, 3)] } },

    // ---- タンク（挑発＋カットはタンクだけ。防御カードには味方全体のドロー+1。攻撃は防御つきのものだけ） ----
    { id: 't_taunt', name: '挑発', role: 'tank', element: 'fire', cost: 2, priority: P.DEFENSE, target: 'self', stats: st(9, 0, 0), effects: [S('taunt', 25, 1)], chain: { min: 2, effects: [S('taunt', 10, 1)] } },
    { id: 't_ironwall', name: '不動の構え', role: 'tank', element: 'light', cost: 3, priority: P.DEFENSE, target: 'self', stats: st(9, 0, 0), effects: [S('taunt', 35, 1)], chain: { min: 3, effects: [S('taunt', 15, 1)] } },
    { id: 't_bulwark', name: '黒鉄の誓い', role: 'tank', element: 'dark', cost: 4, priority: P.DEFENSE, target: 'self', stats: st(8, 1, 0), effects: [S('taunt', 30, 1)], chain: { min: 2, effects: [S('taunt', 10, 1)] } },
    { id: 't_shield', name: '守護の盾', role: 'tank', element: 'water', cost: 2, priority: P.DEFENSE, target: 'ally', stats: st(9, 0, 0), effects: [S('defUp', 8, 2), DRAW_ALL], chain: { min: 2, effects: [S('defUp', 4, 2)] } },
    { id: 't_guard_all', name: '聖域', role: 'tank', element: 'light', cost: 4, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [S('defUp', 6, 2), DRAW_ALL], chain: { min: 3, effects: [DRAW_ALL] } },
    { id: 't_wall', name: '水の障壁', role: 'tank', element: 'water', cost: 3, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [S('defUp', 4, 3), DRAW_ALL], chain: { min: 3, effects: [S('defUp', 2, 3)] } },
    { id: 't_rally', name: '号令', role: 'tank', element: 'fire', cost: 2, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [S('defUp', 2, 2), { type: 'draw', value: 1 }], chain: { min: 2, effects: [{ type: 'draw', value: 1 }] } },
    { id: 't_scout', name: '戦術指示', role: 'tank', element: 'wind', cost: 2, priority: P.ATTACK, target: 'enemy', stats: st(8, 0, 0), effects: [D_(10), { type: 'draw', value: 2, self: true }], chain: { min: 2, effects: [{ type: 'draw', value: 1, self: true }] } },
    { id: 't_insight', name: '戦況把握', role: 'tank', element: 'light', cost: 3, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [S('defUp', 3, 2), DRAW_ALL], chain: { min: 2, effects: [DRAW_ALL] } },
    { id: 't_counter', name: '迎え撃ち', role: 'tank', element: 'wind', cost: 3, priority: P.DEFENSE, target: 'enemy', stats: st(9, 1, 0), effects: [D_(8), { ...S('defUp', 6, 2), self: true }], chain: { min: 3, effects: [{ ...S('defUp', 4, 2), self: true }] } },
    { id: 't_dark_guard', name: '影の守り', role: 'tank', element: 'dark', cost: 3, priority: P.DEFENSE, target: 'ally', stats: st(9, 0, 0), effects: [S('defUp', 12, 2), DRAW_ALL], chain: { min: 2, effects: [S('defUp', 4, 2)] } },
    { id: 't_command', name: '総指揮', role: 'tank', element: 'fire', cost: 4, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [S('defUp', 4, 2), { type: 'draw', value: 2 }], chain: { min: 3, effects: [S('defUp', 4, 2)] } },
    { id: 't_fortress', name: '城壁', role: 'tank', element: 'wind', cost: 5, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [S('defUp', 7, 2), DRAW_ALL], chain: { min: 3, effects: [DRAW_ALL] } },
    { id: 't_unique', name: '不落の城塞', role: 'tank', element: 'light', elements: ['fire', 'wind', 'water', 'light', 'dark'], cost: 5, priority: P.DEFENSE, target: 'self', unique: true, gauge: 3, stats: st(0, 0, 0), effects: [S('taunt', 10, 1), { ...S('defUp', 2, 2), allAllies: true }], chain: { min: 4, effects: [S('taunt', 30, 1), { ...S('defUp', 6, 2), allAllies: true }] } },
    { id: 't_unique1', name: '鉄壁の構え', role: 'tank', element: 'light', elements: ['fire', 'wind', 'water', 'light', 'dark'], cost: 2, priority: P.DEFENSE, target: 'self', unique: true, gauge: 1, stats: st(0, 0, 0), effects: [S('taunt', 10, 1), { ...S('defUp', 4, 2), allAllies: true }], chain: { min: 4, effects: [{ ...S('defUp', 6, 2), allAllies: true }] } },
    { id: 't_unique2', name: '守護結界', role: 'tank', element: 'light', elements: ['fire', 'wind', 'water', 'light', 'dark'], cost: 3, priority: P.DEFENSE, target: 'allAllies', unique: true, gauge: 2, stats: st(0, 0, 0), effects: [S('defUp', 2, 2), { type: 'draw', value: 4 }], chain: { min: 4, effects: [S('defUp', 4, 2)] } },

    // ---- ヒーラー（攻撃しない。攻撃しながら回復するものだけ例外） ----
    { id: 'h_heal', name: '癒しの光', role: 'healer', element: 'light', cost: 2, priority: P.HEAL, target: 'ally', stats: st(5, 0, 2), effects: [H_(10)], chain: { min: 2, effects: [H_(6)] } },
    { id: 'h_regen', name: '再生の雫', role: 'healer', element: 'water', cost: 2, priority: P.BUFF, target: 'ally', stats: st(5, 0, 1), effects: [S('regen', 4, 3)], chain: { min: 2, effects: [S('regen', 2, 3)] } },
    { id: 'h_bless', name: '戦意の祝福', role: 'healer', element: 'fire', cost: 2, priority: P.BUFF, target: 'ally', stats: st(5, 0, 1), effects: [S('atkUp', 4, 2)], chain: { min: 2, effects: [S('atkUp', 2, 2)] } },
    { id: 'h_dark_pact', name: '闇の契約', role: 'healer', element: 'dark', cost: 2, priority: P.BUFF, target: 'ally', stats: st(5, 0, 1), effects: [S('dmgUp', 4, 2)], chain: { min: 2, effects: [S('dmgUp', 3, 2)] } },
    { id: 'h_tailwind', name: '追い風', role: 'healer', element: 'wind', cost: 3, priority: P.BUFF, target: 'allAllies', stats: st(5, 0, 1), effects: [S('critUp', 15, 2)], chain: { min: 3, effects: [S('critUp', 15, 2)] } },
    { id: 'h_aegis', name: '風の加護', role: 'healer', element: 'wind', cost: 3, priority: P.BUFF, target: 'allAllies', stats: st(5, 0, 1), effects: [S('defUp', 3, 3)], chain: { min: 2, effects: [S('defUp', 2, 3)] } },
    { id: 'h_holy_arrow', name: '癒しの矢', role: 'healer', element: 'light', cost: 3, priority: P.ATTACK, target: 'enemy', stats: st(5, 0, 1), effects: [D_(8), { ...H_(4), allAllies: true }], chain: { min: 2, effects: [{ ...H_(3), allAllies: true }] } },
    { id: 'h_spring', name: '癒しの泉', role: 'healer', element: 'water', cost: 4, priority: P.HEAL, target: 'allAllies', stats: st(5, 0, 2), effects: [H_(6)], chain: { min: 2, effects: [S('regen', 3, 2)] } },
    { id: 'h_inspire', name: '鬨の声', role: 'healer', element: 'fire', cost: 4, priority: P.BUFF, target: 'allAllies', stats: st(5, 0, 1), effects: [S('atkUp', 3, 2)], chain: { min: 3, effects: [S('dmgUp', 3, 2)] } },
    { id: 'h_sanctuary', name: '慈雨', role: 'healer', element: 'water', cost: 5, priority: P.HEAL, target: 'allAllies', stats: st(5, 0, 2), effects: [H_(8), S('regen', 3, 2)], chain: { min: 3, effects: [H_(6)] } },
    { id: 'h_war_hymn', name: '戦いの賛歌', role: 'healer', element: 'fire', cost: 4, priority: P.BUFF, target: 'allAllies', stats: st(5, 0, 1), effects: [S('dmgUp', 4, 2)], chain: { min: 2, effects: [S('dmgUp', 2, 2)] } },
    { id: 'h_halo', name: '光輪', role: 'healer', element: 'light', cost: 4, priority: P.BUFF, target: 'allAllies', stats: st(5, 0, 2), effects: [S('defUp', 5, 2), H_(4)], chain: { min: 3, effects: [S('defUp', 3, 2)] } },
    { id: 'h_mend', name: '闇の癒し', role: 'healer', element: 'dark', cost: 3, priority: P.HEAL, target: 'ally', stats: st(5, 0, 2), effects: [H_(8), S('regen', 3, 2)], chain: { min: 2, effects: [S('regen', 2, 2)] } },
    // ---- 2属性カード（報酬枠。どちらの属性のチェインにも参加し、チェインの人数は両方の属性を合わせて数える） ----
    { id: 'a_steam', name: '蒸気爆斬', role: 'attacker', element: 'water', elements: ['water', 'fire'], cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(5, 1, 0), effects: [D_(20)], chain: { min: 3, effects: [D_(14)] } },
    { id: 'a_gale_flare', name: '風炎の舞', role: 'attacker', element: 'fire', elements: ['fire', 'wind'], cost: 3, priority: P.ATTACK, target: 'allEnemies', stats: st(5, 1, 0), effects: [D_(8)], chain: { min: 3, effects: [D_(8)] } },
    { id: 'd_miasma', name: '瘴気の霧', role: 'debuffer', element: 'wind', elements: ['wind', 'dark'], cost: 2, priority: P.DEBUFF, target: 'enemy', stats: st(5, 0, 0), effects: [S('poison', 4, 3), S('vulnUp', 2, 3)], chain: { min: 3, effects: [S('poison', 3, 3)] } },
    { id: 'd_frostbite', name: '凍傷', role: 'debuffer', element: 'water', elements: ['water', 'light'], cost: 3, priority: P.DEBUFF, target: 'enemy', stats: st(6, 0, 0), effects: [S('atkDown', 4, 2), S('defDown', 4, 2)], chain: { min: 3, effects: [S('atkDown', 3, 2)] } },
    { id: 't_tide_wall', name: '潮風の盾', role: 'tank', element: 'water', elements: ['water', 'wind'], cost: 3, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [S('defUp', 4, 2), DRAW_ALL], chain: { min: 3, effects: [DRAW_ALL] } },
    { id: 't_holy_flame', name: '聖炎の誓い', role: 'tank', element: 'light', elements: ['light', 'fire'], cost: 3, priority: P.DEFENSE, target: 'self', stats: st(9, 0, 0), effects: [S('taunt', 30, 1)], chain: { min: 2, effects: [S('taunt', 10, 1)] } },
    { id: 'h_dawn', name: '黎明の祈り', role: 'healer', element: 'light', elements: ['light', 'water'], cost: 3, priority: P.HEAL, target: 'allAllies', stats: st(5, 0, 2), effects: [H_(5), S('regen', 2, 2)], chain: { min: 3, effects: [H_(4)] } },
    { id: 'h_ember_hymn', name: '宵火の歌', role: 'healer', element: 'dark', elements: ['dark', 'fire'], cost: 3, priority: P.BUFF, target: 'allAllies', stats: st(5, 0, 1), effects: [S('atkUp', 3, 2)], chain: { min: 3, effects: [S('dmgUp', 3, 2)] } },

    // ---- レアカード（固定報酬枠・名声枠のレアドロップ。効果は通常と同じか少し強い程度、そのぶん基本ステータスが高い） ----
    { id: 'a_r_frost_fang', name: '氷牙の剣', role: 'attacker', element: 'water', rarity: 'rare', cost: 3, priority: P.ATTACK, target: 'enemy', stats: st(13, 3, 0), effects: [D_(17)], chain: { min: 2, effects: [D_(8)] } },
    { id: 'a_r_sun_blade', name: '陽光剣', role: 'attacker', element: 'light', rarity: 'rare', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(12, 4, 0), effects: [D_(26)], chain: { min: 3, effects: [D_(14)] } },
    { id: 'd_r_venom', name: '毒蛇の呪詛', role: 'debuffer', element: 'wind', rarity: 'rare', cost: 2, priority: P.DEBUFF, target: 'enemy', stats: st(12, 2, 0), effects: [S('poison', 6, 3)], chain: { min: 2, effects: [S('poison', 4, 3)] } },
    { id: 'd_r_eclipse', name: '蝕の帳', role: 'debuffer', element: 'dark', rarity: 'rare', cost: 3, priority: P.DEBUFF, target: 'allEnemies', stats: st(13, 2, 0), effects: [S('vulnUp', 3, 2)], chain: { min: 3, effects: [S('vulnUp', 3, 2)] } },
    { id: 't_r_aegis', name: '神盾の構え', role: 'tank', element: 'light', rarity: 'rare', cost: 3, priority: P.DEFENSE, target: 'self', stats: st(18, 1, 0), effects: [S('taunt', 40, 1)], chain: { min: 2, effects: [S('taunt', 15, 1)] } },
    { id: 't_r_tidewall', name: '大海の城壁', role: 'tank', element: 'water', rarity: 'rare', cost: 4, priority: P.DEFENSE, target: 'allAllies', stats: st(17, 1, 0), effects: [S('defUp', 7, 2), DRAW_ALL], chain: { min: 3, effects: [S('defUp', 3, 2)] } },
    { id: 'h_r_lifesong', name: '生命の歌', role: 'healer', element: 'water', rarity: 'rare', cost: 3, priority: P.HEAL, target: 'allAllies', stats: st(12, 0, 4), effects: [H_(7)], chain: { min: 2, effects: [S('regen', 3, 2)] } },
    { id: 'h_r_valor', name: '勇気の灯', role: 'healer', element: 'fire', rarity: 'rare', cost: 3, priority: P.BUFF, target: 'allAllies', stats: st(12, 0, 3), effects: [S('atkUp', 4, 2)], chain: { min: 3, effects: [S('dmgUp', 3, 2)] } },

    // ---- レアカード追加分（各役職：5属性×2枚＝10枚になるように） ----
    // アタッカー
    { id: 'a_r_blaze', name: '紅蓮の太刀', role: 'attacker', element: 'fire', rarity: 'rare', cost: 2, priority: P.ATTACK, target: 'enemy', stats: st(12, 3, 0), effects: [D_(12)], chain: { min: 2, effects: [D_(7)] } },
    { id: 'a_r_phoenix', name: '鳳凰斬', role: 'attacker', element: 'fire', rarity: 'rare', cost: 5, priority: P.ATTACK, target: 'enemy', stats: st(12, 4, 0), effects: [D_(24)], chain: { min: 3, effects: [D_(24)] } },
    { id: 'a_r_gust', name: '疾風迅雷', role: 'attacker', element: 'wind', rarity: 'rare', cost: 3, priority: P.ATTACK, target: 'enemy', stats: st(12, 3, 0), effects: [D_(8), { ...D_(8), hit: 2 }], chain: { min: 2, effects: [{ ...D_(8), hit: 3 }] } },
    { id: 'a_r_cyclone', name: '天嵐の構え', role: 'attacker', element: 'wind', rarity: 'rare', cost: 3, priority: P.BUFF, target: 'self', stats: st(13, 3, 0), effects: [S('atkUp', 4, 3)], chain: { min: 2, effects: [S('critUp', 20, 3)] } },
    { id: 'a_r_wave', name: '蒼波斬', role: 'attacker', element: 'water', rarity: 'rare', cost: 4, priority: P.ATTACK, target: 'allEnemies', stats: st(12, 3, 0), effects: [D_(12)], chain: { min: 3, effects: [D_(8)] } },
    { id: 'a_r_halo_edge', name: '聖光の型', role: 'attacker', element: 'light', rarity: 'rare', cost: 2, priority: P.BUFF, target: 'self', stats: st(13, 2, 0), effects: [S('critUp', 25, 3)], chain: { min: 2, effects: [S('critUp', 15, 3)] } },
    { id: 'a_r_abyss', name: '深淵斬り', role: 'attacker', element: 'dark', rarity: 'rare', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(12, 4, 0), effects: [D_(26)], chain: { min: 3, effects: [D_(14)] } },
    { id: 'a_r_dark_aura', name: '冥気', role: 'attacker', element: 'dark', rarity: 'rare', cost: 2, priority: P.BUFF, target: 'self', stats: st(13, 3, 0), effects: [S('atkUp', 5, 2)], chain: { min: 2, effects: [S('atkUp', 3, 2)] } },
    // デバッファー
    { id: 'd_r_hellfire', name: '獄炎の呪い', role: 'debuffer', element: 'fire', rarity: 'rare', cost: 2, priority: P.DEBUFF, target: 'enemy', stats: st(12, 2, 0), effects: [S('defDown', 6, 3)], chain: { min: 2, effects: [S('defDown', 3, 3)] } },
    { id: 'd_r_magma', name: '熔岩弾', role: 'debuffer', element: 'fire', rarity: 'rare', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(12, 2, 0), effects: [D_(18), S('poison', 5, 3)], chain: { min: 3, effects: [D_(10)] } },
    { id: 'd_r_squall', name: '嵐の刃', role: 'debuffer', element: 'wind', rarity: 'rare', cost: 5, priority: P.ATTACK, target: 'allEnemies', stats: st(12, 2, 0), effects: [D_(14), S('atkDown', 3, 2)], chain: { min: 3, effects: [S('atkDown', 3, 2)] } },
    { id: 'd_r_glacier', name: '氷河の枷', role: 'debuffer', element: 'water', rarity: 'rare', cost: 3, priority: P.DEBUFF, target: 'allEnemies', stats: st(13, 1, 0), effects: [S('atkDown', 4, 3)], chain: { min: 2, effects: [S('atkDown', 2, 3)] } },
    { id: 'd_r_deepsea', name: '深海の圧', role: 'debuffer', element: 'water', rarity: 'rare', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(12, 2, 0), effects: [D_(16), S('defDown', 6, 2)], chain: { min: 3, effects: [D_(8)] } },
    { id: 'd_r_judgment', name: '審判の光', role: 'debuffer', element: 'light', rarity: 'rare', cost: 2, priority: P.DEBUFF, target: 'enemy', stats: st(13, 1, 0), effects: [S('vulnUp', 5, 2)], chain: { min: 2, effects: [S('vulnUp', 3, 2)] } },
    { id: 'd_r_blind', name: '閃光の呪縛', role: 'debuffer', element: 'light', rarity: 'rare', cost: 3, priority: P.DEBUFF, target: 'allEnemies', stats: st(13, 1, 0), effects: [S('atkDown', 5, 2)], chain: { min: 3, effects: [S('atkDown', 3, 2)] } },
    { id: 'd_r_void', name: '虚無の刃', role: 'debuffer', element: 'dark', rarity: 'rare', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(12, 2, 0), effects: [D_(20)], chain: { min: 2, effects: [S('vulnUp', 5, 2)] } },
    // タンク
    { id: 't_r_flame_oath', name: '炎帝の誓い', role: 'tank', element: 'fire', rarity: 'rare', cost: 2, priority: P.DEFENSE, target: 'self', stats: st(18, 1, 0), effects: [S('taunt', 30, 1)], chain: { min: 2, effects: [S('taunt', 10, 1)] } },
    { id: 't_r_war_horn', name: '戦の角笛', role: 'tank', element: 'fire', rarity: 'rare', cost: 3, priority: P.DEFENSE, target: 'allAllies', stats: st(17, 0, 0), effects: [S('defUp', 3, 2), DRAW_ALL], chain: { min: 2, effects: [DRAW_ALL] } },
    { id: 't_r_gale_guard', name: '風の守護陣', role: 'tank', element: 'wind', rarity: 'rare', cost: 3, priority: P.DEFENSE, target: 'allAllies', stats: st(17, 0, 0), effects: [S('defUp', 4, 3), DRAW_ALL], chain: { min: 3, effects: [S('defUp', 2, 3)] } },
    { id: 't_r_tactics', name: '疾風の采配', role: 'tank', element: 'wind', rarity: 'rare', cost: 2, priority: P.ATTACK, target: 'enemy', stats: st(17, 0, 0), effects: [D_(14), { type: 'draw', value: 2, self: true }], chain: { min: 2, effects: [{ type: 'draw', value: 1, self: true }] } },
    { id: 't_r_coral', name: '珊瑚の盾', role: 'tank', element: 'water', rarity: 'rare', cost: 2, priority: P.DEFENSE, target: 'ally', stats: st(18, 0, 0), effects: [S('defUp', 10, 2), DRAW_ALL], chain: { min: 2, effects: [S('defUp', 4, 2)] } },
    { id: 't_r_radiant', name: '光輝の盾陣', role: 'tank', element: 'light', rarity: 'rare', cost: 4, priority: P.DEFENSE, target: 'allAllies', stats: st(17, 0, 0), effects: [S('defUp', 7, 2), DRAW_ALL], chain: { min: 3, effects: [DRAW_ALL] } },
    { id: 't_r_shadow_wall', name: '影鉄の壁', role: 'tank', element: 'dark', rarity: 'rare', cost: 4, priority: P.DEFENSE, target: 'self', stats: st(19, 1, 0), effects: [S('taunt', 35, 1)], chain: { min: 2, effects: [S('taunt', 10, 1)] } },
    { id: 't_r_night_watch', name: '夜警', role: 'tank', element: 'dark', rarity: 'rare', cost: 3, priority: P.DEFENSE, target: 'ally', stats: st(18, 0, 0), effects: [S('defUp', 13, 2), DRAW_ALL], chain: { min: 2, effects: [S('defUp', 4, 2)] } },
    // ヒーラー
    { id: 'h_r_ember_bless', name: '炎の加護', role: 'healer', element: 'fire', rarity: 'rare', cost: 2, priority: P.BUFF, target: 'ally', stats: st(12, 0, 3), effects: [S('atkUp', 5, 2)], chain: { min: 2, effects: [S('atkUp', 2, 2)] } },
    { id: 'h_r_breeze', name: '癒しの風', role: 'healer', element: 'wind', rarity: 'rare', cost: 3, priority: P.HEAL, target: 'allAllies', stats: st(12, 0, 4), effects: [H_(5), S('regen', 2, 2)], chain: { min: 2, effects: [S('regen', 2, 2)] } },
    { id: 'h_r_swift', name: '迅風の祝福', role: 'healer', element: 'wind', rarity: 'rare', cost: 3, priority: P.BUFF, target: 'allAllies', stats: st(12, 0, 3), effects: [S('critUp', 18, 2)], chain: { min: 3, effects: [S('critUp', 15, 2)] } },
    { id: 'h_r_spring', name: '聖泉', role: 'healer', element: 'water', rarity: 'rare', cost: 2, priority: P.BUFF, target: 'ally', stats: st(12, 0, 3), effects: [S('regen', 5, 3)], chain: { min: 2, effects: [S('regen', 2, 3)] } },
    { id: 'h_r_sacred', name: '聖女の祈り', role: 'healer', element: 'light', rarity: 'rare', cost: 2, priority: P.HEAL, target: 'ally', stats: st(12, 0, 4), effects: [H_(12)], chain: { min: 2, effects: [H_(6)] } },
    { id: 'h_r_sanctum', name: '光の聖域', role: 'healer', element: 'light', rarity: 'rare', cost: 4, priority: P.BUFF, target: 'allAllies', stats: st(12, 0, 4), effects: [S('defUp', 5, 2), H_(5)], chain: { min: 3, effects: [S('defUp', 3, 2)] } },
    { id: 'h_r_moon', name: '月光の契約', role: 'healer', element: 'dark', rarity: 'rare', cost: 2, priority: P.BUFF, target: 'ally', stats: st(12, 0, 3), effects: [S('dmgUp', 5, 2)], chain: { min: 2, effects: [S('dmgUp', 3, 2)] } },
    { id: 'h_r_night_mend', name: '夜想の癒し', role: 'healer', element: 'dark', rarity: 'rare', cost: 3, priority: P.HEAL, target: 'ally', stats: st(12, 0, 4), effects: [H_(9), S('regen', 3, 2)], chain: { min: 2, effects: [S('regen', 2, 2)] } },

    { id: 'h_unique', name: '女神の加護', role: 'healer', element: 'light', elements: ['fire', 'wind', 'water', 'light', 'dark'], cost: 5, priority: P.HEAL, target: 'allAllies', unique: true, gauge: 3, stats: st(0, 0, 0), effects: [H_(6), S('atkUp', 1, 2)], chain: { min: 4, effects: [H_(12), S('atkUp', 3, 2)] } },
    { id: 'h_unique1', name: '女神の息吹', role: 'healer', element: 'light', elements: ['fire', 'wind', 'water', 'light', 'dark'], cost: 2, priority: P.HEAL, target: 'allAllies', unique: true, gauge: 1, stats: st(0, 0, 0), effects: [H_(8)], chain: { min: 4, effects: [H_(12)] } },
    { id: 'h_unique2', name: '祝福の光雨', role: 'healer', element: 'light', elements: ['fire', 'wind', 'water', 'light', 'dark'], cost: 3, priority: P.HEAL, target: 'allAllies', unique: true, gauge: 2, stats: st(0, 0, 0), effects: [H_(4), S('regen', 2, 3)], chain: { min: 4, effects: [H_(6), S('regen', 3, 3)] } },
  ];
  // 初期デッキ（各役職10枚。最初の1枚が代表カード）
  const STARTER = {
    attacker: ['a_heavy', 'a_fire_slash', 'a_wind_slash', 'a_water_slash', 'a_light_strike', 'a_war_cry', 'a_focus', 'a_whirl', 'a_tide', 'a_dark_rend'],
    debuffer: ['d_hex', 'd_scorch', 'd_poison', 'd_curse', 'd_frost', 'd_flash', 'd_chill', 'd_ember', 'd_shadow', 'd_storm'],
    tank:     ['t_ironwall', 't_taunt', 't_bulwark', 't_shield', 't_guard_all', 't_wall', 't_rally', 't_scout', 't_insight', 't_counter'],
    healer:   ['h_heal', 'h_regen', 'h_bless', 'h_dark_pact', 'h_tailwind', 'h_aegis', 'h_holy_arrow', 'h_spring', 'h_inspire', 'h_sanctuary'],
  };
  const STARTER_IDS = new Set(Object.values(STARTER).flat());

  // ---- 初期カードの上位版（アンコモン）：効果は約1.1倍（最低+1）、基本ステータスはコモンとレアの間 ----
  const up = (v) => Math.max(v + 1, Math.round(v * 1.1));
  const upEff = (e) => (e.type === 'damage' || e.type === 'heal' || e.type === 'status') ? { ...e, value: up(e.value) } : { ...e };
  CARDS.filter(c => STARTER_IDS.has(c.id)).forEach(c => {
    CARDS.push({ ...c, id: c.id + '_p', name: c.name + '＋', rarity: 'uncommon', upgradeOf: c.id,
      stats: { hp: c.stats.hp + 3, atk: c.stats.atk + (c.stats.atk > 0 ? 1 : 0), heal: c.stats.heal + (c.stats.heal > 0 ? 1 : 0) },
      effects: c.effects.map(upEff), chain: c.chain && { min: c.chain.min, effects: c.chain.effects.map(upEff) } });
  });

  { const sp = CARDS.find(c => c.id === 't_scout_p'); if (sp) sp.effects[0].value = 12; }

  // ---- 名声カード：使うと、選んだカードの名声を上げられる。戦闘ではほぼ役に立たない（9コストで1ダメージ）。どの役職のデッキにも入る ----
  [1, 5, 10].forEach(n => CARDS.push({ id: 'fame_' + n, name: `名声の書・${n}`, role: 'any', element: 'light', rarity: 'item', fameValue: n,
    cost: 9, priority: P.ATTACK, target: 'enemy', stats: { hp: 0, atk: 0, heal: 0 }, effects: [{ type: 'damage', value: 1, flat: true }] }));

  // レア度：common（通常）／uncommon（初期カードの上位版）／rare（レアドロップ）／unique（固有）／item（名声カード）
  const RARITY = { common: { name: 'コモン' }, uncommon: { name: 'アンコモン' }, rare: { name: 'レア' }, unique: { name: '固有' }, item: { name: '名声カード' } };
  const CARD_MAP = {};
  CARDS.forEach(c => { c.rarity = c.rarity || (c.unique ? 'unique' : 'common'); CARD_MAP[c.id] = c; });
  const ALL_RARE = CARDS.filter(c => c.rarity === 'rare').map(c => c.id);
  // テストプレイ用：2属性カードを最初から所持させる
  const DECK_SIZE = 10;
  const HAND_START = 5, HAND_MAX = 5, DRAW_PER_TURN = 1;
  const ENERGY_START = 3, ENERGY_MAX = 10;
  const CRIT_MULT = 1.5;
  const FAME_MAX = 100;

  // チェインの追加効果を元の効果に上乗せする（同じ種類・同じ対象・同じ持続ターンなら数値を足す。なければ効果を追加）
  function sameSlot(a, b) {
    return a.type === b.type && !!a.self === !!b.self && !!a.allAllies === !!b.allAllies && (a.hit || 1) === (b.hit || 1) &&
      (a.type !== 'status' || (a.status === b.status && a.turns === b.turns));
  }
  function applyChain(card, count) {
    const effects = card.effects.map(e => ({ ...e }));
    const on = !!(card.chain && count >= card.chain.min);
    if (on) for (const ce of card.chain.effects) {
      const t = effects.find(e => sameSlot(e, ce));
      if (t) t.value += ce.value; else effects.push({ ...ce });
    }
    return { effects, on };
  }

  // デッキ（カードIDの配列）と代表カードからステータスを計算
  function deckStats(deck, leader) {
    const s = { hp: 0, atk: 0, heal: 0 };
    deck.forEach(id => {
      const c = CARD_MAP[id]; if (!c) return;
      const m = id === leader ? 2 : 1;
      s.hp += c.stats.hp * m; s.atk += c.stats.atk * m; s.heal += c.stats.heal * m;
    });
    return s;
  }
  // 名声：2枚目以降1枚につき1＋名声カードで上げた分（上限100）
  function fameOf(count, bonus) { return Math.max(0, Math.min(FAME_MAX, (count || 0) - 1 + (bonus || 0))); }

  // 敵の定義
  // 行動: attack(単体) / attackAll(全体) / buffBody(本体の攻撃力を永続で+X) / charge(力をためる：何もしない)
  //       ultimate(ラストターンの全体大技) / enrage(本体の攻撃力を永続で+X)
  // parts: 部位。本体のHPが0になると勝ち。部位を壊すとその部位の行動がなくなる
  const ENEMIES = {
    eagle_storm: { name: '嵐の大鷲', element: 'wind', hp: 1380, def: 4, sprite: 'eagle', boss: true,
      parts: ['eagle_crest', 'eagle_wing'],
      pattern: [
        { type: 'attack', value: 22 },
        { type: 'attackAll', value: 12 },
        { type: 'attack', value: 26 },
        { type: 'charge', name: '風を集めている…' },
        { type: 'attack', value: 28 },
        { type: 'charge', name: '嵐が渦巻いている…' },
        { type: 'ultimate', value: 240, name: '破滅の嵐' },
        { type: 'enrage', value: 6, name: '怒りの咆哮' },
      ] },
    eagle_crest: { name: '雷冠の羽', element: 'light', hp: 110, def: 9, sprite: 'crystal', part: true,
      pattern: [{ type: 'buffBody', value: 3, name: '嵐を呼ぶ' }] },
    eagle_wing: { name: '蒼き風切羽', element: 'water', hp: 130, def: 9, sprite: 'crystal', part: true,
      pattern: [{ type: 'attackAll', value: 5 }, { type: 'attack', value: 8 }] },
  };

  // ===== バランス調整の前提 =====
  // ステージ1より後に追加する敵は、プレイヤーがステージ1のレアカード（各役職10枚）を持っている前提で調整する。
  // 基準デッキは「攻撃カードを敵の弱点属性で固め、それ以外はレアカード」のデッキ（tools/decks.js の advantageDeck）。
  // 確認は `node tools/sim.js 300 adv ステージID` で行い、勝率 約65〜70% を目安にする。
  // ===== ドラゴン（全属性・同じ造形の色違い） =====
  // 部位：背中の棘（バフを撒き続ける）と左足（威力の高い単体攻撃を続ける）。本体はずっと全体攻撃。
  // layer / anchor は見た目用（右向きのドット絵上の位置。表示では左右反転する）
  const DRAGON_NAMES = { fire: '紅蓮竜', wind: '翠嵐竜', water: '蒼海竜', light: '聖光竜', dark: '冥闇竜' };
  // 属性ごとの強さ。鱗が硬い（防御が高い）ので、ふだんの攻撃は通りにくく、防御ダウンと4チェインを重ねた一撃で崩すのが前提。
  // 10ターン目に「竜王の咆哮」（ラストターン）。調整の目安（tools/balance.js、レア入りの弱点デッキ）：
  //   準備して一斉攻撃するAI＝勝率 約90%／適当に出すAI＝ほぼ勝てない
  const DRAGON_TUNE = {
    fire:  { hp: 3400, def: 30, aoe: 22, leg: 50, buff: 9, ult: 250 },
    wind:  { hp: 3800, def: 30, aoe: 22, leg: 50, buff: 9, ult: 250 },
    water: { hp: 4000, def: 30, aoe: 22, leg: 50, buff: 9, ult: 250 },
    light: { hp: 1900, def: 30, aoe: 22, leg: 50, buff: 9, ult: 250 },
    dark:  { hp: 2800, def: 30, aoe: 22, leg: 50, buff: 9, ult: 250 },
  };
  for (const el of ['fire', 'wind', 'water', 'light', 'dark']) {
    ENEMIES['dragon_' + el] = { name: DRAGON_NAMES[el], element: el, hp: DRAGON_TUNE[el].hp, def: DRAGON_TUNE[el].def, sprite: 'dragon', boss: true,
      parts: ['dragon_' + el + '_spikes', 'dragon_' + el + '_leg'],
      infoAnchor: { x: 60, y: 3 },
      // 9ターンは全体攻撃、10ターン目にラストターンの大技（全体攻撃）。耐えると竜が猛り、また繰り返す
      pattern: [...Array(9).fill({ type: 'attackAll', value: DRAGON_TUNE[el].aoe, name: '竜の息吹' }),
        { type: 'ultimate', value: DRAGON_TUNE[el].ult, name: '竜王の咆哮' }, { type: 'enrage', value: 10, name: '竜の猛り' }] };
    ENEMIES['dragon_' + el + '_spikes'] = { name: '背中の棘', element: el, hp: 800, def: 12, sprite: 'none', part: true,
      layer: 'spikes', anchor: { x: 12, y: 6, w: 26, h: 17 },
      pattern: [{ type: 'buffAll', value: DRAGON_TUNE[el].buff, name: '闘気の棘' }] };
    ENEMIES['dragon_' + el + '_leg'] = { name: '左足', element: el, hp: 1000, def: 12, sprite: 'none', part: true,
      layer: 'leg', anchor: { x: 29, y: 28, w: 13, h: 16 }, infoBelow: true,
      pattern: [{ type: 'attack', value: DRAGON_TUNE[el].leg, name: '踏みつけ' }] };
  }

  const STAGES = [
    { id: 'stage1', name: '風鳴りの丘', boss: 'eagle_storm',
      fixedReward: 'a_tempest', randomRewards: 2,
      // レアドロップ：固定報酬枠と名声枠で、それぞれ10%の確率でレアカード（全役職・全属性の40枚から）に変わる
      rareRate: 0.1, rarePool: 'allRare', dangerScale: 2.8 },
  ];
  // ドラゴンのステージ（いきなりボス戦。ステージ1のレアカードを持っている前提の強さ）
  const DRAGON_STAGE = {
    fire: { name: '紅蓮竜の火口', fixed: 'a_inferno' }, wind: { name: '翠嵐竜の峡谷', fixed: 'a_tempest' }, water: { name: '蒼海竜の深淵', fixed: 'd_breaker' },
    light: { name: '聖光竜の神殿', fixed: 'h_halo' }, dark: { name: '冥闇竜の奈落', fixed: 'd_drain' },
  };
  for (const el of ['fire', 'wind', 'water', 'light', 'dark']) {
    STAGES.push({ id: 'dragon_' + el, name: DRAGON_STAGE[el].name, recommended: 'レアカード推奨',
      boss: 'dragon_' + el, fixedReward: DRAGON_STAGE[el].fixed, randomRewards: 2,
      rareRate: 0.1, rarePool: 'element:' + el });
  }

  // ランダム報酬に出るのは通常カードだけ（レア・固有は出ない）
  function rarePoolOf(stage) {
    if (stage.rarePool === 'allRare') return ALL_RARE;
    if (typeof stage.rarePool === 'string' && stage.rarePool.startsWith('element:')) { const el = stage.rarePool.slice(8); return ALL_RARE.filter(id => elementsOf(CARD_MAP[id]).includes(el)); }
    return stage.rarePool || [];
  }
  // ランダム報酬に出るのは、初期カード以外のコモンと、初期カードの上位版（アンコモン）
  function rewardPool() { return CARDS.filter(c => (c.rarity === 'common' && !STARTER_IDS.has(c.id)) || c.rarity === 'uncommon').map(c => c.id); }
  // 固定報酬枠・名声枠のドロップ表（上から順に判定。残りは通常ドロップ）
  const DROP_TABLE = [
    { kind: 'rare', rate: 0.10 },
    { kind: 'fame', id: 'fame_10', rate: 0.05 },
    { kind: 'fame', id: 'fame_5', rate: 0.10 },
    { kind: 'fame', id: 'fame_1', rate: 0.10 },
  ];
  // ランダム報酬枠のドロップ表（上から順に判定。残りは通常のランダム報酬）
  const RANDOM_DROP_TABLE = [
    { kind: 'fame', id: 'fame_10', rate: 0.05 },
    { kind: 'fame', id: 'fame_5', rate: 0.10 },
    { kind: 'fame', id: 'fame_1', rate: 0.10 },
  ];

  // ドラゴンのステージだけ：部位破壊報酬（1部位につき名声の書・1を全員に）と速攻ボーナス（5ターン以内でランダム枠+1）
  STAGES.forEach(s => { if (s.id.startsWith('dragon_')) s.partReward = 'fame_1'; });
  // 速攻ボーナス：このターン数以内に倒すとランダム報酬+1（賢いAI・レア入りの弱点デッキで、だいたい半分くらいが達成できる値）
  const SPEED_TURNS = { stage1: 6, dragon_fire: 8, dragon_wind: 7, dragon_water: 7, dragon_light: 7, dragon_dark: 8 };
  STAGES.forEach(s => { s.speedTurns = SPEED_TURNS[s.id] || 0; });

  // ===== 危険度（★1〜★5） =====
  // buff：敵の自己強化（buffBody / buffAll / enrage）の数値にかける倍率
  // curse：敵の攻撃（単体・全体・必殺）が当たった相手に付けるデバフ
  // rare / fame：報酬のドロップ率の上乗せ　extraRandom：ランダム報酬枠の追加数
  // 調整の目安（tools/balance.js の一斉攻撃AI・レア入り弱点デッキ）：ドラゴンで ★1 約90% → ★5 約30%
  const DANGER = [null,
    { buff: 1.0, curse: [], rare: 0, fame: 0, extraRandom: 0 },
    { buff: 1.1, curse: [{ status: 'poison', value: 1, turns: 2 }], rare: 0.05, fame: 1, extraRandom: 0 },
    { buff: 1.2, curse: [{ status: 'poison', value: 2, turns: 2 }, { status: 'atkDown', value: 1, turns: 2 }], rare: 0.10, fame: 2, extraRandom: 1 },
    { buff: 1.2, curse: [{ status: 'poison', value: 2, turns: 2 }, { status: 'atkDown', value: 2, turns: 2 }, { status: 'vulnUp', value: 1, turns: 2 }], rare: 0.15, fame: 3, extraRandom: 1 },
    { buff: 1.3, curse: [{ status: 'poison', value: 3, turns: 2 }, { status: 'atkDown', value: 2, turns: 2 }, { status: 'vulnUp', value: 2, turns: 2 }], rare: 0.20, fame: 4, extraRandom: 2 },
  ];
  const STAR_MAX = 5;
  const dangerOf = (star) => DANGER[Math.max(1, Math.min(STAR_MAX, star | 0 || 1))];
  // ステージに合わせた危険度（stage.dangerScale：攻撃の回数が少ないステージほど、強化と呪いを大きくする）
  function dangerFor(star, stageId) {
    const dg = dangerOf(star); const st = STAGES.find(s => s.id === stageId); const sc = (st && st.dangerScale) || 1;
    return { ...dg, buff: +(1 + (dg.buff - 1) * sc).toFixed(2), curse: dg.curse.map(c => ({ ...c, value: Math.round(c.value * sc) })) };
  }
  // ★ごとのドロップ表（★1が基準。★が1つ上がるごとにレア+5%、名声の書・10 +1%、名声の書・5と1 +2%）
  function dropTable(star) {
    const k = dangerOf(star).fame;
    return [{ kind: 'rare', rate: 0.10 + dangerOf(star).rare }, { kind: 'fame', id: 'fame_10', rate: 0.05 + 0.01 * k },
      { kind: 'fame', id: 'fame_5', rate: 0.10 + 0.02 * k }, { kind: 'fame', id: 'fame_1', rate: 0.10 + 0.02 * k }];
  }
  function randomDropTable(star) {
    const k = dangerOf(star).fame;
    return [{ kind: 'fame', id: 'fame_10', rate: 0.05 + 0.01 * k }, { kind: 'fame', id: 'fame_5', rate: 0.10 + 0.02 * k }, { kind: 'fame', id: 'fame_1', rate: 0.10 + 0.02 * k }];
  }

  // ===== 依頼 =====
  // プレイヤーごとに3つ（簡単・普通・難しい）。達成するまで残り、達成すると同じ難しさの新しい依頼に入れ替わる。
  // 判定は勝利したときだけ。報酬：簡単＝名声の書・5／普通＝名声の書・10／難しい＝レア確定（ステージ指定ありならそのステージのレアから）
  const QUEST_DIFFS = ['easy', 'normal', 'hard'];
  const QUEST_DIFF_NAME = { easy: '簡単', normal: '普通', hard: '難しい' };
  const QUEST_REWARD = { easy: { kind: 'fameItem', id: 'fame_5' }, normal: { kind: 'fameItem', id: 'fame_10' }, hard: { kind: 'rare' } };
  // 役職の依頼：勝った戦闘の成績を累計する（その役職で戦ったときだけ）。目安は1戦の中央値の約1.5／3／6戦分
  const ROLE_GOAL = {
    attacker: { key: 'dmg', label: 'ダメージ', unit: 'ダメージを与える', easy: 6000, normal: 12000, hard: 25000 },
    debuffer: { key: 'debuffs', label: 'デバフ', unit: '回デバフを付ける', easy: 30, normal: 65, hard: 130 },
    tank:     { key: 'draws', label: 'ドロー', unit: '枚、味方にドローさせる', easy: 70, normal: 140, hard: 280 },
    healer:   { key: 'heal', label: '回復', unit: '回復する', easy: 600, normal: 1200, hard: 2400 },
  };
  const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const roleTpl = (diff) => ({ diff, cumul: true, gen: () => ({ role: pickOf(ROLE_ORDER) }),
    goal: (p) => ROLE_GOAL[p.role][diff],
    text: (p) => `${ROLES[p.role].name}で合計${fmtN(ROLE_GOAL[p.role][diff])}${ROLE_GOAL[p.role].unit}（勝った戦闘で累計）`,
    gain: (c, p) => (c.role === p.role ? (me(c)[ROLE_GOAL[p.role].key] || 0) : 0),
    check: (c, p) => (c.prog || 0) + (c.role === p.role ? (me(c)[ROLE_GOAL[p.role].key] || 0) : 0) >= ROLE_GOAL[p.role][diff] });
  const stageName = (id) => (STAGES.find(s => s.id === id) || {}).name || id;
  const pickOf = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const DRAGON_STAGE_IDS = () => STAGES.filter(s => s.id.startsWith('dragon_')).map(s => s.id);
  const bossOfStage = (id) => { const s = STAGES.find(x => x.id === id); return s ? ENEMIES[s.boss] : null; };
  const me = (c) => c.stats.p[c.slot] || {};
  const QUEST_TPL = {
    // ---- 簡単 ----
    e_clear: { diff: 'easy', gen: () => ({ stage: pickOf(STAGES).id }), text: (p) => `${stageName(p.stage)}をクリアする`, check: (c, p) => c.stageId === p.stage },
    e_chain3: { diff: 'easy', gen: () => ({ n: 3 }), text: (p) => `3チェイン以上のカードを1戦で${p.n}回出して勝つ`, check: (c, p) => (me(c).chain3 || 0) >= p.n },
    e_role: roleTpl('easy'),
    // ---- 普通 ----
    n_star2: { diff: 'normal', gen: () => ({ stage: pickOf(DRAGON_STAGE_IDS()) }), text: (p) => `${stageName(p.stage)}を★2以上でクリアする`, check: (c, p) => c.stageId === p.stage && c.star >= 2 },
    n_nodeath: { diff: 'normal', gen: () => ({ stage: pickOf(STAGES).id }), text: (p) => `${stageName(p.stage)}を★2以上・誰も倒れずにクリアする`, check: (c, p) => c.stageId === p.stage && c.star >= 2 && c.stats.deaths === 0 },
    n_parts: { diff: 'normal', gen: () => ({ stage: pickOf(DRAGON_STAGE_IDS()) }), text: (p) => `${stageName(p.stage)}で部位を2つとも壊して勝つ`, check: (c, p) => c.stageId === p.stage && c.stats.partsBroken >= 2 },
    n_chain4: { diff: 'normal', gen: () => ({ n: 3 }), text: (p) => `4チェインのカードを1戦で${p.n}回出して勝つ`, check: (c, p) => (me(c).chain4 || 0) >= p.n },
    n_role: roleTpl('normal'),
    // ---- 難しい ----
    h_star3: { diff: 'hard', gen: () => ({ stage: pickOf(DRAGON_STAGE_IDS()) }), text: (p) => `${stageName(p.stage)}を★4以上でクリアする`, check: (c, p) => c.stageId === p.stage && c.star >= 4 },
    h_finish: { diff: 'hard', gen: () => ({ stage: pickOf(DRAGON_STAGE_IDS()) }),
      text: (p) => { const w = weaknessOf(bossOfStage(p.stage).element); return `${stageName(p.stage)}で、${ELEMENTS[w].name}の4チェインのカードでとどめを刺す`; },
      check: (c, p) => { const f = c.stats.finisher; const w = weaknessOf(bossOfStage(p.stage).element); return c.stageId === p.stage && f && f.count >= 4 && f.elements.includes(w); } },
    h_nodeath2: { diff: 'hard', gen: () => ({ stage: pickOf(DRAGON_STAGE_IDS()) }), text: (p) => `${stageName(p.stage)}を★3以上・誰も倒れずにクリアする`, check: (c, p) => c.stageId === p.stage && c.star >= 3 && c.stats.deaths === 0 },
    h_role: roleTpl('hard'),
  };
  // 新しい依頼を作る（avoid：今持っている依頼。同じ内容は出さない）
  function genQuest(diff, avoid) {
    const keys = Object.keys(QUEST_TPL).filter(k => QUEST_TPL[k].diff === diff);
    const same = (a, b) => a.tpl === b.tpl && JSON.stringify(a.p) === JSON.stringify(b.p);
    for (let i = 0; i < 30; i++) {
      const tpl = pickOf(keys);
      const q = { qid: 'q' + Math.random().toString(36).slice(2, 10), tpl, diff, p: QUEST_TPL[tpl].gen() };
      if (!(avoid || []).some(a => same(a, q))) return q;
    }
    const tpl = keys[0]; return { qid: 'q' + Math.random().toString(36).slice(2, 10), tpl, diff, p: QUEST_TPL[tpl].gen() };
  }
  function validQuest(q) { return q && QUEST_TPL[q.tpl] && QUEST_TPL[q.tpl].diff === q.diff && q.p && (!q.p.stage || STAGES.some(s => s.id === q.p.stage)) && (!q.p.role || ROLES[q.p.role]); }
  function questGoal(q) { try { const T = QUEST_TPL[q.tpl]; return T.cumul ? T.goal(q.p) : 0; } catch { return 0; } }
  // 累計の依頼の進み具合の表示（例：「ダメージ 2,300 / 6,000」）。累計でない依頼は空文字
  function questProgressText(q) { const g = questGoal(q); if (!g) return ''; return `${ROLE_GOAL[q.p.role].label} ${fmtN(Math.min(g, q.prog || 0))} / ${fmtN(g)}`; }
  // この戦闘で累計に足す量（累計の依頼で、勝ったときだけ）
  function questGain(q, ctx) { try { const T = QUEST_TPL[q.tpl]; return (T.cumul && ctx.victory) ? T.gain(ctx, q.p) : 0; } catch { return 0; } }
  function questText(q) { try { return QUEST_TPL[q.tpl].text(q.p); } catch { return '（不明な依頼）'; } }
  function questCheck(q, ctx) { try { return !!(ctx.victory && QUEST_TPL[q.tpl].check({ ...ctx, prog: q.prog || 0 }, q.p)); } catch { return false; } }

  // ===== 固有カード =====
  // デッキ10枚とは別の「固有枠」に最大3枚。全属性（どのチェインにも参加し、どの敵の弱点も突く）で基本ステータスなし。
  // 青バー（固有ゲージ）が満タンのときだけ、どれか1枚を使える（5エネルギー）。使うとゲージは0に戻る。
  // ゲージは自分のカードが入ったチェインの人数でたまる（カード1枚ごと。固有カード自身のチェインではたまらない）。
  const UNIQUE_MAX = 3;
  const STARTER_UNIQUE = { attacker: 'a_unique', debuffer: 'd_unique', tank: 't_unique', healer: 'h_unique' };
  const GAUGE_GAIN = { 2: 1, 3: 2, 4: 4 };
  const GAUGE_SEG = 9;  // 1区切りの長さ
  const GAUGE_SEGS = 3; // 区切りの数
  const GAUGE_MAX = GAUGE_SEG * GAUGE_SEGS; // うまくチェインすると8ターン目あたりで満タン（tools で測定）
  // 固有カードの入手：竜のステージをどれか1つクリアで1ゲージ、依頼の点数が25点で2ゲージ（4役職ぶん全部）
  const UNIQUE_BY_GAUGE = (g) => CARDS.filter(c => c.unique && (c.gauge || 3) === g).map(c => c.id);
  const QUEST_POINTS = { easy: 1, normal: 2, hard: 3 };
  const QUEST_POINTS_FOR_U2 = 25;
  // 今のセーブ内容から、持っているべき固有カードを返す（clears：ステージID→最高★、questPts：依頼の点数）
  function unlockedUniques(clears, questPts) {
    const ids = UNIQUE_BY_GAUGE(3);
    if (Object.keys(clears || {}).some(k => k.startsWith('dragon_'))) ids.push(...UNIQUE_BY_GAUGE(1));
    if ((questPts || 0) >= QUEST_POINTS_FOR_U2) ids.push(...UNIQUE_BY_GAUGE(2));
    return ids;
  }
  const isAllElement = (c) => elementsOf(c).length >= ELEMENT_ORDER.length;
  function validUniques(role, list) {
    if (!Array.isArray(list)) return false;
    if (list.length > UNIQUE_MAX || new Set(list).size !== list.length) return false;
    return list.every(id => CARD_MAP[id] && CARD_MAP[id].rarity === 'unique' && CARD_MAP[id].role === role);
  }

  // カードの種類を漢字1文字で（最初に書かれた効果で決める）：攻・妨・治・支・防・挑
  const KIND_NAME = { atk: '攻', debuff: '妨', heal: '治', buff: '支', def: '防', taunt: '挑' };
  function cardKind(card) {
    const e = (card && card.effects || [])[0] || {};
    if (e.type === 'damage') return '攻';
    if (e.type === 'heal') return '治';
    if (e.type === 'status') {
      if (e.status === 'taunt') return '挑';
      if (e.status === 'defUp') return '防';
      if (e.status === 'regen') return '治';
      return STATUS[e.status] && STATUS[e.status].good ? '支' : '妨';
    }
    return '支';
  }
  const api = { UNIQUE_MAX, cardKind, KIND_NAME, STARTER_UNIQUE, GAUGE_GAIN, GAUGE_MAX, GAUGE_SEG, GAUGE_SEGS, UNIQUE_BY_GAUGE, QUEST_POINTS, QUEST_POINTS_FOR_U2, unlockedUniques, isAllElement, validUniques, DANGER, STAR_MAX, dangerOf, dangerFor, dropTable, randomDropTable, QUEST_DIFFS, QUEST_DIFF_NAME, QUEST_REWARD, QUEST_TPL, ROLE_GOAL, genQuest, validQuest, questText, questCheck, questGoal, questGain, questProgressText,
    RARITY, ALL_RARE, rarePoolOf, DROP_TABLE, RANDOM_DROP_TABLE, STARTER_IDS, ELEMENTS, ELEMENT_ORDER, affinity, elementsOf, chainCountFor, weaknessOf, SYNC_MULT, costMult, ROLES, ROLE_ORDER, STATUS, P, CARDS, CARD_MAP, STARTER,
    DECK_SIZE, HAND_START, HAND_MAX, DRAW_PER_TURN, ENERGY_START, ENERGY_MAX, CRIT_MULT, FAME_MAX, deckStats, fameOf, applyChain, sameSlot, ENEMIES, STAGES, rewardPool };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameData = api;
})(typeof window !== 'undefined' ? window : globalThis);
