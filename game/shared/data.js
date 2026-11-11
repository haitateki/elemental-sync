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
    atkUp:   { name: '攻撃力', short: '攻↑', desc: '攻撃力+X', good: true },
    healUp:  { name: '回復量', short: '回↑', desc: '回復量+X（最後に加算）', good: true },
    dmgUp:   { name: '与ダメージ', short: '与ダメ', desc: '与えるダメージ+X（最後に加算）', good: true },
    defUp:   { name: '防御', short: '防↑', desc: '受けるダメージ-X', good: true },
    critUp:  { name: '会心率', short: '会心', desc: 'クリティカル率+X%（ダメージ1.5倍）', good: true, pct: true },
    regen:   { name: '再生', short: '再生', desc: 'ターン終了時にHPをX回復', good: true },
    taunt:   { name: '挑発', short: '挑発', desc: '敵の単体攻撃を引きつけ、自分が受けるダメージをX%カット', good: true, pct: true },
    atkDown: { name: '攻撃力ダウン', short: '攻↓', desc: '攻撃力-X', good: false },
    defDown: { name: '防御ダウン', short: '防↓', desc: '防御力-X', good: false },
    vulnUp:  { name: '被ダメージ', short: '被ダメ', desc: '受けるダメージ+X（最後に加算）', good: false },
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
    { id: 'a_light_strike', name: '閃光突き', role: 'attacker', element: 'light', cost: 2, priority: P.ATTACK, target: 'enemy', stats: st(6, 1, 0), effects: [D_(9)], chain: { min: 2, effects: [{ ...S('critUp', 20, 2), self: true }] } },
    { id: 'a_war_cry', name: '闘気', role: 'attacker', element: 'dark', cost: 2, priority: P.BUFF, target: 'self', stats: st(6, 1, 0), effects: [S('atkUp', 4, 2)], chain: { min: 2, effects: [S('atkUp', 3, 2)] } },
    { id: 'a_focus', name: '集中', role: 'attacker', element: 'light', cost: 3, priority: P.BUFF, target: 'self', stats: st(6, 0, 0), effects: [S('critUp', 30, 2)], chain: { min: 3, effects: [S('critUp', 30, 2)] } },
    { id: 'a_whirl', name: '旋風', role: 'attacker', element: 'wind', cost: 3, priority: P.ATTACK, target: 'allEnemies', stats: st(5, 1, 0), effects: [D_(9)], chain: { min: 3, effects: [D_(9)] } },
    { id: 'a_heavy', name: '豪炎撃', role: 'attacker', element: 'fire', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(5, 1, 0), effects: [D_(24)], chain: { min: 3, effects: [D_(12)] } },
    { id: 'a_tide', name: '激流突き', role: 'attacker', element: 'water', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(5, 1, 0), effects: [D_(24)], chain: { min: 3, effects: [D_(12)] } },
    { id: 'a_dark_rend', name: '闇裂き', role: 'attacker', element: 'dark', cost: 5, priority: P.ATTACK, target: 'enemy', stats: st(5, 1, 0), effects: [D_(22)], chain: { min: 3, effects: [D_(22)] } },
    { id: 'a_tempest', name: '連風斬', role: 'attacker', element: 'wind', cost: 3, priority: P.ATTACK, target: 'enemy', stats: st(5, 1, 0), effects: [D_(7), { ...D_(7), hit: 2 }], chain: { min: 2, effects: [{ ...D_(7), hit: 3 }] } },
    { id: 'a_blade_aura', name: '剣気', role: 'attacker', element: 'fire', cost: 3, priority: P.BUFF, target: 'self', stats: st(6, 1, 0), effects: [S('atkUp', 3, 3)], chain: { min: 2, effects: [S('dmgUp', 4, 3)] } },
    { id: 'a_inferno', name: '業火', role: 'attacker', element: 'fire', cost: 5, priority: P.ATTACK, target: 'enemy', stats: st(5, 2, 0), effects: [D_(32)], chain: { min: 4, effects: [D_(32)] } },
    { id: 'a_unique', name: '聖剣解放', role: 'attacker', element: 'light', cost: 5, priority: P.ATTACK, target: 'allEnemies', unique: true, stats: st(8, 3, 0), effects: [D_(28)], chain: { min: 4, effects: [D_(28)] } },

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
    { id: 'd_unique', name: '終焉の刻印', role: 'debuffer', element: 'dark', cost: 5, priority: P.DEBUFF, target: 'enemy', unique: true, stats: st(7, 2, 0), effects: [S('vulnUp', 10, 2), S('poison', 10, 3)], chain: { min: 3, effects: [S('defDown', 8, 2)] } },

    // ---- タンク（挑発＋カットはタンクだけ。防御カードには味方全体のドロー+1。攻撃は防御つきのものだけ） ----
    { id: 't_taunt', name: '挑発', role: 'tank', element: 'fire', cost: 2, priority: P.DEFENSE, target: 'self', stats: st(9, 0, 0), effects: [S('taunt', 25, 2)], chain: { min: 2, effects: [S('taunt', 10, 2)] } },
    { id: 't_ironwall', name: '不動の構え', role: 'tank', element: 'light', cost: 3, priority: P.DEFENSE, target: 'self', stats: st(9, 0, 0), effects: [S('taunt', 35, 2)], chain: { min: 3, effects: [S('taunt', 15, 2)] } },
    { id: 't_bulwark', name: '黒鉄の誓い', role: 'tank', element: 'dark', cost: 4, priority: P.DEFENSE, target: 'self', stats: st(8, 1, 0), effects: [S('taunt', 30, 3)], chain: { min: 2, effects: [S('taunt', 10, 3)] } },
    { id: 't_shield', name: '守護の盾', role: 'tank', element: 'water', cost: 2, priority: P.DEFENSE, target: 'ally', stats: st(9, 0, 0), effects: [S('defUp', 8, 2), DRAW_ALL], chain: { min: 2, effects: [S('defUp', 4, 2)] } },
    { id: 't_guard_all', name: '聖域', role: 'tank', element: 'light', cost: 4, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [S('defUp', 6, 2), DRAW_ALL], chain: { min: 3, effects: [DRAW_ALL] } },
    { id: 't_wall', name: '水の障壁', role: 'tank', element: 'water', cost: 3, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [S('defUp', 4, 3), DRAW_ALL], chain: { min: 3, effects: [S('defUp', 2, 3)] } },
    { id: 't_rally', name: '号令', role: 'tank', element: 'fire', cost: 2, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [{ type: 'draw', value: 1 }], chain: { min: 2, effects: [{ type: 'draw', value: 1 }] } },
    { id: 't_scout', name: '戦術指示', role: 'tank', element: 'wind', cost: 2, priority: P.DEFENSE, target: 'ally', stats: st(8, 0, 0), effects: [{ type: 'draw', value: 2 }], chain: { min: 2, effects: [{ type: 'draw', value: 1 }] } },
    { id: 't_insight', name: '戦況把握', role: 'tank', element: 'light', cost: 3, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [S('defUp', 3, 2), DRAW_ALL], chain: { min: 2, effects: [DRAW_ALL] } },
    { id: 't_counter', name: '迎え撃ち', role: 'tank', element: 'wind', cost: 3, priority: P.DEFENSE, target: 'enemy', stats: st(9, 1, 0), effects: [D_(8), { ...S('defUp', 6, 2), self: true }], chain: { min: 3, effects: [{ ...S('defUp', 4, 2), self: true }] } },
    { id: 't_dark_guard', name: '影の守り', role: 'tank', element: 'dark', cost: 3, priority: P.DEFENSE, target: 'ally', stats: st(9, 0, 0), effects: [S('defUp', 12, 2), DRAW_ALL], chain: { min: 2, effects: [S('defUp', 4, 2)] } },
    { id: 't_command', name: '総指揮', role: 'tank', element: 'fire', cost: 4, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [{ type: 'draw', value: 2 }], chain: { min: 3, effects: [S('defUp', 4, 2)] } },
    { id: 't_fortress', name: '城壁', role: 'tank', element: 'wind', cost: 5, priority: P.DEFENSE, target: 'allAllies', stats: st(8, 0, 0), effects: [S('defUp', 7, 2), DRAW_ALL], chain: { min: 3, effects: [DRAW_ALL] } },
    { id: 't_unique', name: '不落の城塞', role: 'tank', element: 'light', cost: 5, priority: P.DEFENSE, target: 'self', unique: true, stats: st(12, 0, 0), effects: [S('taunt', 40, 2), { ...S('defUp', 8, 2), allAllies: true }], chain: { min: 3, effects: [S('taunt', 20, 2)] } },

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
    { id: 't_holy_flame', name: '聖炎の誓い', role: 'tank', element: 'light', elements: ['light', 'fire'], cost: 3, priority: P.DEFENSE, target: 'self', stats: st(9, 0, 0), effects: [S('taunt', 30, 2)], chain: { min: 2, effects: [S('taunt', 10, 2)] } },
    { id: 'h_dawn', name: '黎明の祈り', role: 'healer', element: 'light', elements: ['light', 'water'], cost: 3, priority: P.HEAL, target: 'allAllies', stats: st(5, 0, 2), effects: [H_(5), S('regen', 2, 2)], chain: { min: 3, effects: [H_(4)] } },
    { id: 'h_ember_hymn', name: '宵火の歌', role: 'healer', element: 'dark', elements: ['dark', 'fire'], cost: 3, priority: P.BUFF, target: 'allAllies', stats: st(5, 0, 1), effects: [S('atkUp', 3, 2)], chain: { min: 3, effects: [S('dmgUp', 3, 2)] } },

    // ---- レアカード（固定報酬枠・名声枠のレアドロップ。効果は通常と同じか少し強い程度、そのぶん基本ステータスが高い） ----
    { id: 'a_r_frost_fang', name: '氷牙の剣', role: 'attacker', element: 'water', rarity: 'rare', cost: 3, priority: P.ATTACK, target: 'enemy', stats: st(13, 3, 0), effects: [D_(17)], chain: { min: 2, effects: [D_(8)] } },
    { id: 'a_r_sun_blade', name: '陽光剣', role: 'attacker', element: 'light', rarity: 'rare', cost: 4, priority: P.ATTACK, target: 'enemy', stats: st(12, 4, 0), effects: [D_(26)], chain: { min: 3, effects: [D_(14)] } },
    { id: 'd_r_venom', name: '毒蛇の呪詛', role: 'debuffer', element: 'wind', rarity: 'rare', cost: 2, priority: P.DEBUFF, target: 'enemy', stats: st(12, 2, 0), effects: [S('poison', 6, 3)], chain: { min: 2, effects: [S('poison', 4, 3)] } },
    { id: 'd_r_eclipse', name: '蝕の帳', role: 'debuffer', element: 'dark', rarity: 'rare', cost: 3, priority: P.DEBUFF, target: 'allEnemies', stats: st(13, 2, 0), effects: [S('vulnUp', 3, 2)], chain: { min: 3, effects: [S('vulnUp', 3, 2)] } },
    { id: 't_r_aegis', name: '神盾の構え', role: 'tank', element: 'light', rarity: 'rare', cost: 3, priority: P.DEFENSE, target: 'self', stats: st(18, 1, 0), effects: [S('taunt', 40, 2)], chain: { min: 2, effects: [S('taunt', 15, 2)] } },
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
    { id: 't_r_flame_oath', name: '炎帝の誓い', role: 'tank', element: 'fire', rarity: 'rare', cost: 2, priority: P.DEFENSE, target: 'self', stats: st(18, 1, 0), effects: [S('taunt', 30, 2)], chain: { min: 2, effects: [S('taunt', 10, 2)] } },
    { id: 't_r_war_horn', name: '戦の角笛', role: 'tank', element: 'fire', rarity: 'rare', cost: 3, priority: P.DEFENSE, target: 'allAllies', stats: st(17, 0, 0), effects: [S('defUp', 3, 2), DRAW_ALL], chain: { min: 2, effects: [DRAW_ALL] } },
    { id: 't_r_gale_guard', name: '風の守護陣', role: 'tank', element: 'wind', rarity: 'rare', cost: 3, priority: P.DEFENSE, target: 'allAllies', stats: st(17, 0, 0), effects: [S('defUp', 4, 3), DRAW_ALL], chain: { min: 3, effects: [S('defUp', 2, 3)] } },
    { id: 't_r_tactics', name: '疾風の采配', role: 'tank', element: 'wind', rarity: 'rare', cost: 2, priority: P.DEFENSE, target: 'ally', stats: st(17, 0, 0), effects: [{ type: 'draw', value: 2 }], chain: { min: 2, effects: [{ type: 'draw', value: 1 }] } },
    { id: 't_r_coral', name: '珊瑚の盾', role: 'tank', element: 'water', rarity: 'rare', cost: 2, priority: P.DEFENSE, target: 'ally', stats: st(18, 0, 0), effects: [S('defUp', 10, 2), DRAW_ALL], chain: { min: 2, effects: [S('defUp', 4, 2)] } },
    { id: 't_r_radiant', name: '光輝の盾陣', role: 'tank', element: 'light', rarity: 'rare', cost: 4, priority: P.DEFENSE, target: 'allAllies', stats: st(17, 0, 0), effects: [S('defUp', 7, 2), DRAW_ALL], chain: { min: 3, effects: [DRAW_ALL] } },
    { id: 't_r_shadow_wall', name: '影鉄の壁', role: 'tank', element: 'dark', rarity: 'rare', cost: 4, priority: P.DEFENSE, target: 'self', stats: st(19, 1, 0), effects: [S('taunt', 35, 3)], chain: { min: 2, effects: [S('taunt', 10, 3)] } },
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

    { id: 'h_unique', name: '女神の加護', role: 'healer', element: 'light', cost: 5, priority: P.HEAL, target: 'allAllies', unique: true, stats: st(7, 0, 3), effects: [H_(18), S('atkUp', 4, 2)], chain: { min: 4, effects: [S('atkUp', 4, 2)] } },
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

  // ---- 名声カード：使うと、選んだカードの名声を上げられる。戦闘ではほぼ役に立たない（9コストで1ダメージ）。どの役職のデッキにも入る ----
  [1, 5, 10].forEach(n => CARDS.push({ id: 'fame_' + n, name: `名声の書・${n}`, role: 'any', element: 'light', rarity: 'item', fameValue: n,
    cost: 9, priority: P.ATTACK, target: 'enemy', stats: { hp: 0, atk: 0, heal: 0 }, effects: [{ type: 'damage', value: 1, flat: true }] }));

  // レア度：common（通常）／uncommon（初期カードの上位版）／rare（レアドロップ）／unique（固有）／item（名声カード）
  const RARITY = { common: { name: 'コモン' }, uncommon: { name: 'アンコモン' }, rare: { name: 'レア' }, unique: { name: '固有' }, item: { name: '名声カード' } };
  const CARD_MAP = {};
  CARDS.forEach(c => { c.rarity = c.rarity || (c.unique ? 'unique' : 'common'); CARD_MAP[c.id] = c; });
  const ALL_RARE = CARDS.filter(c => c.rarity === 'rare').map(c => c.id);
  // テストプレイ用：2属性カードを最初から所持させる
  const TEST_GRANT = ['a_steam', 'a_gale_flare', 'd_miasma', 'd_frostbite', 't_tide_wall', 't_holy_flame', 'h_dawn', 'h_ember_hymn'];
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
    slime_water: { name: '水スライム', element: 'water', hp: 60, def: 0, sprite: 'slime',
      pattern: [{ type: 'attack', value: 9 }, { type: 'attackAll', value: 5 }, { type: 'attack', value: 11 }] },
    slime_fire: { name: '火スライム', element: 'fire', hp: 55, def: 0, sprite: 'slime',
      pattern: [{ type: 'attackAll', value: 5 }, { type: 'attack', value: 10 }, { type: 'attack', value: 10 }] },
    eagle_storm: { name: '嵐の大鷲', element: 'wind', hp: 1400, def: 4, sprite: 'eagle', boss: true,
      parts: ['eagle_crest', 'eagle_wing'],
      pattern: [
        { type: 'attack', value: 22 },
        { type: 'attackAll', value: 12 },
        { type: 'attack', value: 26 },
        { type: 'charge', name: '風を集めている…' },
        { type: 'attack', value: 28 },
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
    { id: 'stage1', name: '風鳴りの丘', desc: 'スライムの群れを抜けると、嵐の大鷲が待ち構える。6ターン目の「破滅の嵐」は、防御アップと攻撃力ダウンを重ねて耐えろ。羽（部位）が残っていると大鷲はどんどん強くなる。',
      waves: [['slime_water', 'slime_fire'], ['eagle_storm']],
      fixedReward: 'a_tempest', randomRewards: 2,
      // レアドロップ：固定報酬枠と名声枠で、それぞれ10%の確率でレアカード（全役職・全属性の40枚から）に変わる
      rareRate: 0.1, rarePool: 'allRare' },
  ];
  // ドラゴンのステージ（ウェーブなし。いきなりボス戦。ステージ1のレアカードを持っている前提の強さ）
  const DRAGON_STAGE = {
    fire: { name: '紅蓮竜の火口', fixed: 'a_inferno' }, wind: { name: '翠嵐竜の峡谷', fixed: 'a_tempest' }, water: { name: '蒼海竜の深淵', fixed: 'd_breaker' },
    light: { name: '聖光竜の神殿', fixed: 'h_halo' }, dark: { name: '冥闇竜の奈落', fixed: 'd_drain' },
  };
  for (const el of ['fire', 'wind', 'water', 'light', 'dark']) {
    STAGES.push({ id: 'dragon_' + el, name: DRAGON_STAGE[el].name, recommended: 'レアカード推奨',
      desc: `${DRAGON_NAMES[el]}が待ち構える。本体は毎ターン全体攻撃、左足は強烈な単体攻撃。背中の棘を放っておくと、竜はどんどん強くなる。`,
      waves: [['dragon_' + el]], fixedReward: DRAGON_STAGE[el].fixed, randomRewards: 2,
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

  const api = { RARITY, ALL_RARE, rarePoolOf, DROP_TABLE, RANDOM_DROP_TABLE, STARTER_IDS, ELEMENTS, ELEMENT_ORDER, affinity, elementsOf, chainCountFor, weaknessOf, SYNC_MULT, costMult, ROLES, ROLE_ORDER, STATUS, P, CARDS, CARD_MAP, STARTER,
    DECK_SIZE, TEST_GRANT, HAND_START, HAND_MAX, DRAW_PER_TURN, ENERGY_START, ENERGY_MAX, CRIT_MULT, FAME_MAX, deckStats, fameOf, applyChain, sameSlot, ENEMIES, STAGES, rewardPool };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameData = api;
})(typeof window !== 'undefined' ? window : globalThis);
