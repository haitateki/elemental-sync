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
// opts.star：危険度（1〜5）
let battleCounter = 1;
function newPStats() { return { dmg: 0, heal: 0, buffs: 0, debuffs: 0, draws: 0, chain3: 0, chain4: 0, maxChain: 0, tauntPulls: 0, tanked: 0, cards: 0 }; }
function createBattle(stageId, players, opts) {
  const stage = D.STAGES.find(s => s.id === stageId) || D.STAGES[0];
  const star = Math.max(1, Math.min(D.STAR_MAX, (opts && opts.star) | 0 || 1));
  const b = { id: 'b' + Date.now().toString(36) + (battleCounter++), stageId: stage.id, stageName: stage.name, star, turn: 0,
    phase: 'planning', cards: {}, players: [], enemies: [], result: null,
    // 戦闘の記録（結果表示と依頼の判定に使う）
    stats: { p: {}, deaths: 0, partsBroken: 0, finisher: null, ultSurvived: false } };
  players.forEach(p => (b.stats.p[p.slot] = newPStats()));
  for (const p of players) {
    const stats = D.deckStats(p.deck, p.leader);
    const uids = p.deck.map(cid => { const u = 'c' + (uidCounter++); b.cards[u] = cid; return u; });
    // 固有カード：デッキとは別枠（指定がなければその役職の最初の固有カード）
    const uq = D.validUniques(p.role, p.uniques) && p.uniques.length ? p.uniques : (D.STARTER_UNIQUE[p.role] ? [D.STARTER_UNIQUE[p.role]] : []);
    const uniqueUids = uq.map(cid => { const u = 'u' + (uidCounter++); b.cards[u] = cid; return u; });
    const pl = { slot: p.slot, name: p.name, role: p.role, isAI: !!p.isAI, leader: p.leader,
      hp: stats.hp, maxHp: stats.hp, atk: stats.atk, heal: stats.heal, status: [], energy: 0, maxEnergy: 0, alive: true,
      drawPile: shuffle(uids), hand: [], discard: [], reserved: [], confirmed: false, nextDraw: 0, nextEnergy: 0,
      uniques: uniqueUids, gauge: 0, gaugeMax: D.GAUGE_MAX };
    drawCards(pl, D.HAND_START);
    b.players.push(pl);
  }
  b.enemies = makeWave([stage.boss]);
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
  const dg = D.dangerFor(b.star, b.stageId);
  // 危険度：自己強化の数値が上がり、攻撃にデバフ（呪い）が付く
  if (['buffBody', 'buffAll', 'enrage'].includes(act.type)) intent.value = Math.round(act.value * dg.buff);
  if (['attack', 'attackAll', 'ultimate'].includes(act.type) && dg.curse.length) intent.curse = dg.curse.map(c => ({ ...c }));
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
  b.phase = 'planning';
  for (const p of b.players) {
    p.reserved = []; p.confirmed = !p.alive; p.selecting = null;
    if (!p.alive) { p.energy = 0; continue; }
    p.maxEnergy = Math.min(D.ENERGY_MAX, D.ENERGY_START + b.turn - 1);
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
  const isUnique = (p.uniques || []).includes(uid);
  const idx = p.hand.indexOf(uid);
  if (!isUnique && idx < 0) return 'そのカードは手札にありません';
  if (isUnique) {
    if (p.gauge < p.gaugeMax) return '固有ゲージがたまっていません';
    if (p.reserved.some(r => p.uniques.includes(r.uid))) return '固有カードは1ターンに1枚までです';
  }
  const card = D.CARD_MAP[b.cards[uid]];
  if (card.cost > p.energy) return 'エネルギーが足りません';
  if (card.target === 'enemy') {
    const e = b.enemies[target];
    if (!e || !e.alive) target = b.enemies.findIndex(x => x.alive && !x.part);
  } else if (card.target === 'ally') {
    const t = getPlayer(b, target);
    if (!t || !t.alive) target = slot;
  } else target = null;
  if (!isUnique) p.hand.splice(idx, 1);
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
  if (!(p.uniques || []).includes(r.uid)) p.hand.push(r.uid); // 固有カードは固有枠に残ったまま
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
  const atk = Math.max(0, src.atk + sumStatus(src, 'atkUp') - sumStatus(src, 'atkDown')); // 攻撃力ダウン（危険度の呪い）も反映
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
// 受けるダメージ =（敵の攻撃力 − 防御アップ ＋ 被ダメージアップ）×（1 − カット率）
function calcTaken(raw, target) {
  const cut = Math.min(100, sumStatus(target, 'taunt')) / 100;
  return Math.max(0, Math.floor((Math.max(0, raw - sumStatus(target, 'defUp')) + sumStatus(target, 'vulnUp')) * (1 - cut)));
}

// broke：攻撃や毒でHPを0にした（部位破壊として数える）
function killEnemy(b, e, events, broke) {
  e.alive = false; e.hp = 0;
  events.push({ t: 'death', side: 'e', i: b.enemies.indexOf(e) });
  if (e.part && broke) { b.stats.partsBroken++; events.push({ t: 'partBreak', i: b.enemies.indexOf(e) }); }
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
  const usedUnique = new Set();
  for (const p of b.players) p.reserved.forEach((r, i) => actions.push({ p, r, card: D.CARD_MAP[b.cards[r.uid]], order: i }));
  actions.sort((a, b2) => (b2.card.priority - a.card.priority) || (a.p.slot - b2.p.slot) || (a.order - b2.order));

  for (const { p, r, card } of actions) {
    if (!p.alive) continue;
    const n = D.chainCountFor(card, sets);
    const mult = syncMult(n);
    const { effects, on: chainOn } = D.applyChain(card, n); // ○○チェイン：追加効果を上乗せ
    events.push({ t: 'card', slot: p.slot, cardId: card.id, element: card.element, mult, count: n, chain: chainOn });
    const ps = b.stats.p[p.slot] || (b.stats.p[p.slot] = newPStats());
    ps.cards++; ps.maxChain = Math.max(ps.maxChain, n); if (n >= 3) ps.chain3++; if (n >= 4) ps.chain4++;
    // 固有ゲージ：固有カード以外のカードがチェインに入るとたまる。固有カードを使ったらそのターンの終わりに0へ
    if ((p.uniques || []).includes(r.uid)) usedUnique.add(p.slot);
    else if (D.GAUGE_GAIN[Math.min(n, 4)]) p.gauge = Math.min(p.gaugeMax, (p.gauge || 0) + D.GAUGE_GAIN[Math.min(n, 4)]);

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
          const hb = o.hp;
          o.hp = Math.max(0, o.hp - amt);
          ps.dmg += hb - o.hp;
          events.push({ t: 'damage', side: 'e', i: idx, amount: amt, hp: o.hp, adv: D.affinity(D.elementsOf(card), o.element), element: card.element, crit });
          if (o.hp <= 0) {
            if (!o.part) b.stats.finisher = { slot: p.slot, cardId: card.id, count: n, elements: D.elementsOf(card) };
            killEnemy(b, o, events, true);
          }
        } else if (ef.type === 'heal') {
          const v = calcHeal(ef.value, mult, p, card.cost);
          const before = o.hp; o.hp = Math.min(o.maxHp, o.hp + v);
          if (tg.side === 'p') ps.heal += o.hp - before;
          events.push({ t: 'heal', side: tg.side, i: idx, amount: o.hp - before, hp: o.hp });
        } else if (ef.type === 'status') {
          const v = Math.floor(ef.value * mult * D.costMult(card.cost)); // バフ・デバフにもチェイン倍率とコスト倍率（端数切り捨て）
          addStatus(o, ef.status, v, ef.turns);
          if (tg.side === 'e') ps.debuffs++; else ps.buffs++;
          events.push({ t: 'status', side: tg.side, i: idx, status: ef.status, amount: v, turns: ef.turns });
        } else if (ef.type === 'draw') {
          o.nextDraw += ef.value; ps.draws += ef.value; events.push({ t: 'draw', side: 'p', i: idx, amount: ef.value });
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
      if (sumStatus(pl, 'taunt') > 0 && b.stats.p[pl.slot]) b.stats.p[pl.slot].tanked += amt;
      events.push({ t: 'damage', side: 'p', i: pl.slot, amount: amt, hp: pl.hp, element: e.element, raw });
      if (pl.hp <= 0 && pl.alive) { pl.alive = false; b.stats.deaths++; events.push({ t: 'death', side: 'p', i: pl.slot }); return; }
      // 危険度の呪い：攻撃が当たった相手にデバフ
      for (const c of it.curse || []) { addStatus(pl, c.status, c.value, c.turns); events.push({ t: 'status', side: 'p', i: pl.slot, status: c.status, amount: c.value, turns: c.turns }); }
    };
    if (it.type === 'attack') {
      const taunters = alivePlayers(b).filter(x => sumStatus(x, 'taunt') > 0).sort((a, c) => sumStatus(c, 'taunt') - sumStatus(a, 'taunt'));
      let tgt = taunters[0] || getPlayer(b, it.target);
      if (taunters[0] && b.stats.p[taunters[0].slot]) b.stats.p[taunters[0].slot].tauntPulls++;
      if (!tgt || !tgt.alive) { const ps = alivePlayers(b); tgt = ps[rnd(ps.length)]; }
      if (tgt) hit(tgt, enemyAttack(e, it.value));
    } else if (it.type === 'attackAll' || it.type === 'ultimate') {
      const raw = enemyAttack(e, it.value);
      alivePlayers(b).forEach(pl => hit(pl, raw));
      if (it.type === 'ultimate' && alivePlayers(b).length) b.stats.ultSurvived = true;
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
      if (o.hp <= 0) { if (side === 'e') killEnemy(b, o, events, true); else { o.alive = false; b.stats.deaths++; events.push({ t: 'death', side, i }); } }
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

  for (const p of b.players) {
    if (usedUnique.has(p.slot)) p.gauge = 0;
    events.push({ t: 'gauge', slot: p.slot, value: p.gauge || 0, max: p.gaugeMax || D.GAUGE_MAX });
    p.discard.push(...p.reserved.filter(r => !(p.uniques || []).includes(r.uid)).map(r => r.uid)); p.reserved = [];
  }

  const bossesAlive = b.enemies.some(e => e.alive && !e.part);
  if (alivePlayers(b).length === 0) {
    b.phase = 'defeat'; events.push({ t: 'defeat' });
  } else if (!bossesAlive) {
    b.enemies.forEach((e, i) => { if (e.alive) { e.alive = false; events.push({ t: 'death', side: 'e', i }); } });
    b.phase = 'victory'; events.push({ t: 'victory' });
  } else startTurn(b);
  return events;
}

module.exports = { createBattle, reserve, unreserve, resolveTurn, syncCounts, syncMult, chainCount, playerElementSets, calcPlayerDamage, calcHeal, calcTaken, enemyAttack,
  sumStatus, critRate, getPlayer, aliveEnemies, alivePlayers, needsTarget, patternOf };
