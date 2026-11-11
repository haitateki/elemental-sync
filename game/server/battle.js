// 戦闘エンジン（サーバー側で判定する）
const D = require('../shared/data');

let uidCounter = 1;
const rnd = (n) => Math.floor(Math.random() * n);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---- 状態（バフ・デバフ） ----
function sumStatus(u, type) { let s = 0; for (const x of u.status) if (x.type === type) s += x.value; return s; }
function addStatus(u, type, value, turns) { u.status.push({ type, value, turns }); }

function makeWave(waveDefs) {
  const list = [];
  for (const defId of waveDefs) {
    const idx = list.length;
    list.push(makeEnemy(defId, null));
    const def = D.ENEMIES[defId];
    (def.parts || []).forEach(pid => list.push(makeEnemy(pid, idx)));
  }
  return list;
}
function makeEnemy(defId, parent) {
  const def = D.ENEMIES[defId];
  return { defId, name: def.name, element: def.element, sprite: def.sprite, boss: !!def.boss, part: !!def.part, parent,
    hp: def.hp, maxHp: def.hp, def: def.def || 0, atkBonus: 0, status: [], patternIndex: 0, intent: null, alive: true, doomIn: null };
}

// players: [{slot, name, role, isAI, deck:[cardId], leader}]
function createBattle(stageId, players) {
  const stage = D.STAGES.find(s => s.id === stageId) || D.STAGES[0];
  const b = { stageId: stage.id, stageName: stage.name, wave: 0, waveCount: stage.waves.length, turn: 0, waveTurn: 0,
    phase: 'planning', cards: {}, players: [], enemies: [], result: null };
  for (const p of players) {
    const stats = D.deckStats(p.deck, p.leader);
    const uids = p.deck.map(cid => { const u = 'c' + (uidCounter++); b.cards[u] = cid; return u; });
    const pl = { slot: p.slot, name: p.name, role: p.role, isAI: !!p.isAI, leader: p.leader,
      hp: stats.hp, maxHp: stats.hp, atk: stats.atk, heal: stats.heal, status: [], energy: 0, maxEnergy: 0, alive: true,
      drawPile: shuffle(uids), hand: [], discard: [], reserved: [], confirmed: false, nextDraw: 0, nextEnergy: 0 };
    drawCards(pl, D.HAND_START);
    b.players.push(pl);
  }
  b.enemies = makeWave(stage.waves[0]);
  startTurn(b);
  return b;
}

function alivePlayers(b) { return b.players.filter(p => p.alive); }
function aliveEnemies(b) { return b.enemies.filter(e => e.alive); }
function getPlayer(b, slot) { return b.players.find(p => p.slot === slot); }

function drawCards(p, n) {
  for (let i = 0; i < n; i++) {
    if (p.hand.length >= D.HAND_MAX) break;
    if (p.drawPile.length === 0) { p.drawPile = shuffle(p.discard); p.discard = []; }
    if (p.drawPile.length === 0) break;
    p.hand.push(p.drawPile.pop());
  }
}

function patternOf(e) { return D.ENEMIES[e.defId].pattern; }
function chooseIntent(b, e) {
  const pat = patternOf(e);
  const act = pat[e.patternIndex % pat.length];
  const intent = { ...act };
  if (act.type === 'attack') {
    const ps = alivePlayers(b);
    intent.target = ps.length ? ps[rnd(ps.length)].slot : null;
  }
  const ultIdx = pat.findIndex(a => a.type === 'ultimate');
  if (ultIdx >= 0) { const cur = e.patternIndex % pat.length; e.doomIn = ((ultIdx - cur + pat.length) % pat.length) + 1; } else e.doomIn = null;
  e.intent = intent;
}

function startTurn(b) {
  b.turn++;
  b.waveTurn++; // ウェーブ内のターン数（エネルギーの最大値はウェーブごとに3からやり直し）
  b.phase = 'planning';
  for (const p of b.players) {
    p.reserved = []; p.confirmed = !p.alive; p.selecting = null;
    if (!p.alive) { p.energy = 0; continue; }
    p.maxEnergy = Math.min(D.ENERGY_MAX, D.ENERGY_START + b.waveTurn - 1);
    p.energy = p.maxEnergy + p.nextEnergy;
    if (b.turn > 1) drawCards(p, D.DRAW_PER_TURN + p.nextDraw);
    p.nextEnergy = 0; p.nextDraw = 0;
  }
  for (const e of aliveEnemies(b)) chooseIntent(b, e);
}

function needsTarget(card) { return card.target === 'enemy' || card.target === 'ally'; }

function reserve(b, slot, uid, target) {
  if (b.phase !== 'planning') return 'いまは予約できません';
  const p = getPlayer(b, slot);
  if (!p || !p.alive) return '行動できません';
  if (p.confirmed) return '確定を解除してください';
  const idx = p.hand.indexOf(uid);
  if (idx < 0) return 'そのカードは手札にありません';
  const card = D.CARD_MAP[b.cards[uid]];
  if (card.cost > p.energy) return 'エネルギーが足りません';
  if (card.target === 'enemy') {
    const e = b.enemies[target];
    if (!e || !e.alive) target = b.enemies.findIndex(x => x.alive && !x.part);
  } else if (card.target === 'ally') {
    const t = getPlayer(b, target);
    if (!t || !t.alive) target = slot;
  } else target = null;
  p.hand.splice(idx, 1);
  p.energy -= card.cost;
  p.reserved.push({ uid, target });
  return null;
}

function unreserve(b, slot, uid) {
  if (b.phase !== 'planning') return 'いまは変更できません';
  const p = getPlayer(b, slot);
  if (!p || p.confirmed) return '確定を解除してください';
  const i = p.reserved.findIndex(r => r.uid === uid);
  if (i < 0) return 'そのカードは予約されていません';
  const [r] = p.reserved.splice(i, 1);
  p.hand.push(r.uid);
  p.energy += D.CARD_MAP[b.cards[r.uid]].cost;
  return null;
}

// 属性ごとの「出した人数」
function syncCounts(b, extra) {
  const counts = {}; D.ELEMENT_ORDER.forEach(el => (counts[el] = 0));
  for (const p of b.players) {
    if (!p.alive) continue;
    const els = new Set(p.reserved.flatMap(r => D.elementsOf(D.CARD_MAP[b.cards[r.uid]])));
    if (extra && extra.slot === p.slot) extra.elements.forEach(el => els.add(el));
    els.forEach(el => counts[el]++);
  }
  return counts;
}
// 味方それぞれが出している属性の集合
function playerElementSets(b) {
  return b.players.filter(p => p.alive).map(p => new Set(p.reserved.flatMap(r => D.elementsOf(D.CARD_MAP[b.cards[r.uid]]))));
}
// そのカードのチェイン人数（2属性カードは両方の属性を合わせて数える）
function chainCount(b, card) { return D.chainCountFor(card, playerElementSets(b)); }
function syncMult(n) { return D.SYNC_MULT[Math.min(n, 4)] || 1; }

// 与ダメージ =（（（カードの数値＋攻撃力）×チェイン倍率 − 敵の防御力）×属性相性）＋与ダメージアップ＋被ダメージアップ
// クリティカルなら×1.5、最後にコスト倍率（4コスト×1.2、5コスト×1.5）
function calcPlayerDamage(base, mult, src, enemy, element, crit, cost) {
  const atk = src.atk + sumStatus(src, 'atkUp');
  const def = Math.max(0, enemy.def - sumStatus(enemy, 'defDown'));
  let d = Math.max(0, Math.floor((base + atk) * mult) - def); // チェイン倍率の端数は切り捨て
  d = d * D.affinity(element, enemy.element) + sumStatus(src, 'dmgUp') + sumStatus(enemy, 'vulnUp');
  if (crit) d *= D.CRIT_MULT;
  d *= D.costMult(cost || 2); // コスト倍率は最終威力にかける
  return Math.max(0, Math.floor(d));
}
function critRate(src) { return Math.min(100, sumStatus(src, 'critUp')) / 100; }
// 回復量 =（カードの回復量＋回復力）×チェイン倍率＋回復量アップ
function calcHeal(base, mult, src, cost) { return Math.max(0, Math.floor((Math.floor((base + src.heal) * mult) + sumStatus(src, 'healUp')) * D.costMult(cost || 2))); }
// 敵の攻撃力（基本値＋強化−攻撃力ダウン）
function enemyAttack(e, base) { return base + e.atkBonus + sumStatus(e, 'atkUp') - sumStatus(e, 'atkDown'); }
// 受けるダメージ =（敵の攻撃力 − 防御アップ）×（1 − カット率）
function calcTaken(raw, target) {
  const cut = Math.min(100, sumStatus(target, 'taunt')) / 100;
  return Math.max(0, Math.floor(Math.max(0, raw - sumStatus(target, 'defUp')) * (1 - cut)));
}

function killEnemy(b, e, events) {
  e.alive = false; e.hp = 0;
  events.push({ t: 'death', side: 'e', i: b.enemies.indexOf(e) });
  if (!e.part) b.enemies.forEach((x, i) => { if (x.part && b.enemies[x.parent] === e && x.alive) { x.alive = false; events.push({ t: 'death', side: 'e', i }); } });
}

function resolveTurn(b) {
  b.phase = 'resolving';
  b.players.forEach(p => (p.selecting = null));
  const events = [];
  const counts = syncCounts(b);
  const sets = playerElementSets(b);
  events.push({ t: 'sync', counts });

  const actions = [];
  for (const p of b.players) p.reserved.forEach((r, i) => actions.push({ p, r, card: D.CARD_MAP[b.cards[r.uid]], order: i }));
  actions.sort((a, b2) => (b2.card.priority - a.card.priority) || (a.p.slot - b2.p.slot) || (a.order - b2.order));

  for (const { p, r, card } of actions) {
    if (!p.alive) continue;
    const n = D.chainCountFor(card, sets);
    const mult = syncMult(n);
    const { effects, on: chainOn } = D.applyChain(card, n); // ○○チェイン：追加効果を上乗せ
    events.push({ t: 'card', slot: p.slot, cardId: card.id, element: card.element, mult, count: n, chain: chainOn });

    let targets;
    if (card.target === 'enemy') {
      let e = b.enemies[r.target];
      if (!e || !e.alive) e = aliveEnemies(b).find(x => !x.part) || aliveEnemies(b)[0];
      targets = e ? [{ side: 'e', obj: e }] : [];
    } else if (card.target === 'allEnemies') targets = aliveEnemies(b).map(e => ({ side: 'e', obj: e }));
    else if (card.target === 'ally') { let t = getPlayer(b, r.target); if (!t || !t.alive) t = p; targets = [{ side: 'p', obj: t }]; }
    else if (card.target === 'allAllies') targets = alivePlayers(b).map(t => ({ side: 'p', obj: t }));
    else targets = [{ side: 'p', obj: p }];
    const crit = Math.random() < critRate(p); // 1枚のカードにつき1回判定

    for (const ef of effects) {
      let tlist = targets;
      if (ef.self) tlist = [{ side: 'p', obj: p }];
      if (ef.allAllies) tlist = alivePlayers(b).map(t => ({ side: 'p', obj: t }));
      for (const tg of tlist) {
        const o = tg.obj; if (!o.alive) continue;
        const idx = tg.side === 'e' ? b.enemies.indexOf(o) : o.slot;
        if (ef.type === 'damage' && tg.side === 'e') {
          const amt = ef.flat ? ef.value : calcPlayerDamage(ef.value, mult, p, o, D.elementsOf(card), crit, card.cost); // flat：攻撃力や倍率の影響を受けない固定ダメージ
          o.hp = Math.max(0, o.hp - amt);
          events.push({ t: 'damage', side: 'e', i: idx, amount: amt, hp: o.hp, adv: D.affinity(D.elementsOf(card), o.element), element: card.element, crit });
          if (o.hp <= 0) killEnemy(b, o, events);
        } else if (ef.type === 'heal') {
          const v = calcHeal(ef.value, mult, p, card.cost);
          const before = o.hp; o.hp = Math.min(o.maxHp, o.hp + v);
          events.push({ t: 'heal', side: tg.side, i: idx, amount: o.hp - before, hp: o.hp });
        } else if (ef.type === 'status') {
          const v = Math.floor(ef.value * mult * D.costMult(card.cost)); // バフ・デバフにもチェイン倍率とコスト倍率（端数切り捨て）
          addStatus(o, ef.status, v, ef.turns);
          events.push({ t: 'status', side: tg.side, i: idx, status: ef.status, amount: v, turns: ef.turns });
        } else if (ef.type === 'draw') {
          o.nextDraw += ef.value; events.push({ t: 'draw', side: 'p', i: idx, amount: ef.value });
        }
        // エネルギーを増やす効果は存在しない（仕様）
      }
    }
  }

  // 敵の行動（本体→部位の順）
  for (const e of b.enemies) {
    if (!e.alive || !e.intent) continue;
    const it = e.intent; const ei = b.enemies.indexOf(e);
    events.push({ t: 'enemyAct', i: ei, intent: it });
    const hit = (pl, raw) => {
      const amt = calcTaken(raw, pl);
      pl.hp = Math.max(0, pl.hp - amt);
      events.push({ t: 'damage', side: 'p', i: pl.slot, amount: amt, hp: pl.hp, element: e.element, raw });
      if (pl.hp <= 0 && pl.alive) { pl.alive = false; events.push({ t: 'death', side: 'p', i: pl.slot }); }
    };
    if (it.type === 'attack') {
      const taunters = alivePlayers(b).filter(x => sumStatus(x, 'taunt') > 0).sort((a, c) => sumStatus(c, 'taunt') - sumStatus(a, 'taunt'));
      let tgt = taunters[0] || getPlayer(b, it.target);
      if (!tgt || !tgt.alive) { const ps = alivePlayers(b); tgt = ps[rnd(ps.length)]; }
      if (tgt) hit(tgt, enemyAttack(e, it.value));
    } else if (it.type === 'attackAll' || it.type === 'ultimate') {
      const raw = enemyAttack(e, it.value);
      alivePlayers(b).forEach(pl => hit(pl, raw));
    } else if (it.type === 'buffBody') {
      const body = b.enemies[e.parent];
      if (body && body.alive) { body.atkBonus += it.value; events.push({ t: 'enemyBuff', i: e.parent, amount: it.value, atkBonus: body.atkBonus }); }
    } else if (it.type === 'buffAll') {
      // 本体と生き残っている部位すべての攻撃力を永続で上げる
      const rootIdx = e.part ? e.parent : ei;
      b.enemies.forEach((x, xi) => {
        if (x.alive && (xi === rootIdx || x.parent === rootIdx)) { x.atkBonus += it.value; events.push({ t: 'enemyBuff', i: xi, amount: it.value, atkBonus: x.atkBonus }); }
      });
    } else if (it.type === 'enrage') {
      e.atkBonus += it.value; events.push({ t: 'enemyBuff', i: ei, amount: it.value, atkBonus: e.atkBonus });
    }
    e.patternIndex++;
  }

  // ターン終了：毒・再生 → 持続ターンを1減らす
  const tick = (o, side, i) => {
    if (!o.alive) return;
    const poison = sumStatus(o, 'poison');
    if (poison > 0) {
      o.hp = Math.max(0, o.hp - poison);
      events.push({ t: 'damage', side, i, amount: poison, hp: o.hp, poison: true });
      if (o.hp <= 0) { if (side === 'e') killEnemy(b, o, events); else { o.alive = false; events.push({ t: 'death', side, i }); } }
    }
    const regen = sumStatus(o, 'regen');
    if (o.alive && regen > 0) {
      const before = o.hp; o.hp = Math.min(o.maxHp, o.hp + regen);
      events.push({ t: 'heal', side, i, amount: o.hp - before, hp: o.hp });
    }
    o.status.forEach(x => x.turns--);
    o.status = o.status.filter(x => x.turns > 0);
  };
  b.players.forEach(p => tick(p, 'p', p.slot));
  b.enemies.forEach((e, i) => tick(e, 'e', i));

  for (const p of b.players) { p.discard.push(...p.reserved.map(r => r.uid)); p.reserved = []; }

  const bossesAlive = b.enemies.some(e => e.alive && !e.part);
  if (alivePlayers(b).length === 0) {
    b.phase = 'defeat'; events.push({ t: 'defeat' });
  } else if (!bossesAlive) {
    b.enemies.forEach((e, i) => { if (e.alive) { e.alive = false; events.push({ t: 'death', side: 'e', i }); } });
    if (b.wave + 1 < b.waveCount) {
      b.wave++;
      const stage = D.STAGES.find(s => s.id === b.stageId);
      b.enemies = makeWave(stage.waves[b.wave]);
      b.waveTurn = 0; // 新しいウェーブではエネルギーが3に戻る
      // デッキも初期化：手札・山札・捨て札をすべて混ぜ直し、手札5枚から始める
      for (const p of b.players) {
        p.drawPile = shuffle([...p.hand, ...p.drawPile, ...p.discard]);
        p.hand = []; p.discard = []; p.nextDraw = 0;
        if (p.alive) drawCards(p, D.HAND_START);
      }
      events.push({ t: 'wave', wave: b.wave });
      startTurn(b);
    } else { b.phase = 'victory'; events.push({ t: 'victory' }); }
  } else startTurn(b);
  return events;
}

module.exports = { createBattle, reserve, unreserve, resolveTurn, syncCounts, syncMult, chainCount, playerElementSets, calcPlayerDamage, calcHeal, calcTaken, enemyAttack,
  sumStatus, critRate, getPlayer, aliveEnemies, alivePlayers, needsTarget, patternOf };
