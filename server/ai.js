// AIの味方：手札の組み合わせを全部試し、戦闘を簡易シミュレーションして点数の高い予約を選ぶ
const D = require('../shared/data');
const B = require('./battle');

const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- 敵の今後の攻撃予測 ----
function predictedHits(e, k) {
  const pat = B.patternOf(e);
  const act = k === 0 ? e.intent : pat[(e.patternIndex + k) % pat.length];
  if (!act) return null;
  if (act.type === 'attack') return { raw: B.enemyAttack(e, act.value), single: true, target: k === 0 ? act.target : null };
  if (act.type === 'attackAll' || act.type === 'ultimate') return { raw: B.enemyAttack(e, act.value), single: false };
  return null;
}
function activeAt(u, k) { return { ...u, status: u.status.filter(s => s.turns > k) }; }

// H ターン先までに味方が受ける予想ダメージ（死亡は大きく減点）
function expectedIncoming(b, H) {
  let total = 0;
  const hp = {}; b.players.forEach(p => (hp[p.slot] = p.hp));
  for (let k = 0; k < H; k++) {
    const alive = b.players.filter(p => p.alive && hp[p.slot] > 0);
    if (!alive.length) break;
    const w = k === 0 ? 1 : k === 1 ? 0.8 : 0.6;
    for (const e of b.enemies) {
      if (!e.alive || e.hp <= 0) continue;
      const h = predictedHits(e, k);
      if (!h) continue;
      const raw = B.enemyAttack(activeAt(e, k), predictedRawBase(e, k));
      if (h.single) {
        const taunters = alive.filter(p => B.sumStatus(activeAt(p, k), 'taunt') > 0);
        let tgts;
        if (taunters.length) tgts = [[taunters[0], 1]];
        else if (h.target != null && alive.some(p => p.slot === h.target)) tgts = [[alive.find(p => p.slot === h.target), 1]];
        else tgts = alive.map(p => [p, 1 / alive.length]);
        for (const [p, f] of tgts) { const d = B.calcTaken(raw, activeAt(p, k)) * f; hp[p.slot] -= d; total += d * w; }
      } else {
        for (const p of alive) { const d = B.calcTaken(raw, activeAt(p, k)); hp[p.slot] -= d; total += d * w; }
      }
    }
    // 毒：今かかっている毒と、危険度の呪いでこれから付く毒（ターン終了時に減る）
    const curse = D.dangerFor(b.star || 1, b.stageId).curse.find(c => c.status === 'poison');
    const attacking = curse && b.enemies.some(e => e.alive && e.hp > 0 && predictedHits(e, k));
    for (const p of alive) {
      let pz = B.sumStatus(activeAt(p, k), 'poison');
      if (attacking) pz += curse.value * Math.min(k + 1, curse.turns);
      if (pz > 0) { hp[p.slot] -= pz; total += pz * w; }
    }
    for (const p of b.players) if (p.alive && hp[p.slot] <= 0) { total += 60 * w; hp[p.slot] = -999; }
  }
  return total;
}
function predictedRawBase(e, k) {
  const pat = B.patternOf(e);
  const act = k === 0 ? e.intent : pat[(e.patternIndex + k) % pat.length];
  return act && act.value ? act.value : 0;
}

// ---- 味方の行動フェーズだけを簡易再現（クリティカルは期待値） ----
function simulatePlayers(b) {
  const sets = B.playerElementSets(b);
  const actions = [];
  for (const p of b.players) p.reserved.forEach((r, i) => actions.push({ p, r, card: D.CARD_MAP[b.cards[r.uid]], order: i }));
  actions.sort((a, c) => (c.card.priority - a.card.priority) || (a.p.slot - c.p.slot) || (a.order - c.order));
  const out = { dmg: 0, heal: 0, draw: 0, energy: 0, kills: 0 };
  for (const { p, r, card } of actions) {
    if (!p.alive) continue;
    const n = D.chainCountFor(card, sets), mult = B.syncMult(n);
    const { effects } = D.applyChain(card, n);
    let targets;
    if (card.target === 'enemy') { let e = b.enemies[r.target]; if (!e || !e.alive) e = b.enemies.find(x => x.alive); targets = e ? [e] : []; }
    else if (card.target === 'allEnemies') targets = b.enemies.filter(e => e.alive);
    else if (card.target === 'ally') { let t = B.getPlayer(b, r.target); if (!t || !t.alive) t = p; targets = [t]; }
    else if (card.target === 'allAllies') targets = b.players.filter(x => x.alive);
    else targets = [p];
    const crit = B.critRate(p);
    for (const ef of effects) {
      let tl = targets;
      if (ef.self) tl = [p];
      if (ef.allAllies) tl = b.players.filter(x => x.alive);
      for (const o of tl) {
        if (!o.alive) continue;
        if (ef.type === 'damage' && o.def !== undefined && o.defId) {
          const d = ef.flat ? ef.value : B.calcPlayerDamage(ef.value, mult, p, o, D.elementsOf(card), false, card.cost) * (1 + crit * (D.CRIT_MULT - 1));
          const useful = Math.min(d, o.hp);
          const w = o.part ? (D.ENEMIES[o.defId].pattern.some(a => a.type === 'buffBody') ? 1.1 : 0.8) : 1;
          out.dmg += useful * w;
          o.hp -= d;
          if (o.hp <= 0) { o.alive = false; out.kills += o.part ? 12 : (o.boss ? 200 : 25); if (!o.part) b.enemies.forEach(x => { if (x.part && b.enemies[x.parent] === o) x.alive = false; }); }
        } else if (ef.type === 'heal') {
          const v = B.calcHeal(ef.value, mult, p, card.cost);
          const useful = Math.min(v, o.maxHp - o.hp);
          out.heal += useful * (o.hp / o.maxHp < 0.5 ? 1.2 : 0.6);
          o.hp += useful;
        } else if (ef.type === 'status') {
          o.status.push({ type: ef.status, value: Math.floor(ef.value * mult * D.costMult(card.cost)), turns: ef.turns });
        } else if (ef.type === 'draw') { out.draw += Math.min(ef.value, D.HAND_MAX - o.hand.length + 1); }
        else if (ef.type === 'energy') out.energy += ef.value;
      }
    }
  }
  return out;
}

function lingeringValue(b) {
  let v = 0;
  for (const e of b.enemies) if (e.alive) for (const s of e.status) {
    if (s.type === 'poison') v += Math.min(s.value * s.turns, e.hp) * 0.8;
    if ((s.type === 'defDown' || s.type === 'vulnUp') && s.turns > 1) v += s.value * (s.turns - 1) * 2;
  }
  for (const p of b.players) if (p.alive) for (const s of p.status) {
    if (s.type === 'regen') v += Math.min(s.value * s.turns, p.maxHp - p.hp + s.value) * 0.4;
    if ((s.type === 'atkUp' || s.type === 'dmgUp') && s.turns > 1) v += s.value * (s.turns - 1) * (p.role === 'attacker' ? 2 : 0.8);
    if (s.type === 'critUp' && s.turns > 1) v += s.value * (s.turns - 1) * 0.1;
  }
  return v;
}

function bestTarget(b, p, card) {
  if (card.target === 'enemy') {
    let best = -1e9, bi = b.enemies.findIndex(e => e.alive);
    const isDebuff = card.effects.some(e => e.type === 'status');
    const atkDown = card.effects.some(e => e.status === 'atkDown');
    b.enemies.forEach((e, i) => {
      if (!e.alive) return;
      let sc;
      if (atkDown) { const h = predictedHits(e, 0); sc = h ? h.raw * (h.single ? 1 : 3) : 0; }
      else {
        sc = D.affinity(D.elementsOf(card), e.element) * 10 - e.def * 0.5;
        if (e.part && D.ENEMIES[e.defId].pattern.some(a => a.type === 'buffBody')) sc += 4;
        if (!e.part && e.boss) sc += (e.doomIn != null && e.doomIn <= 1) ? 8 : 2;
        if (isDebuff && !e.part) sc += 5;
        if (e.hp < 25) sc += 6;
      }
      if (sc > best) { best = sc; bi = i; }
    });
    return bi;
  }
  if (card.target === 'ally') {
    const ps = B.alivePlayers(b);
    if (card.effects.some(e => e.type === 'heal')) return ps.slice().sort((a, c) => a.hp / a.maxHp - c.hp / c.maxHp)[0].slot;
    if (card.effects.some(e => e.status === 'defUp')) {
      const tank = ps.find(x => x.role === 'tank');
      const weakest = ps.slice().sort((a, c) => a.hp - c.hp)[0];
      return (weakest || tank || p).slot;
    }
    if (card.effects.some(e => e.status === 'atkUp' || e.status === 'dmgUp')) return (ps.find(x => x.role === 'attacker') || p).slot;
    if (card.effects.some(e => e.type === 'draw')) return ps.slice().sort((a, c) => a.hand.length - c.hand.length)[0].slot;
    if (card.effects.some(e => e.status === 'regen')) return ps.slice().sort((a, c) => a.hp / a.maxHp - c.hp / c.maxHp)[0].slot;
    return p.slot;
  }
  return null;
}

function evaluate(b0, slot, set) {
  const b = clone(b0);
  const p = B.getPlayer(b, slot);
  for (const u of set) {
    const c = D.CARD_MAP[b.cards[u]];
    if (p.hand.includes(u)) p.hand.splice(p.hand.indexOf(u), 1); p.energy -= c.cost;
    p.reserved.push({ uid: u, target: bestTarget(b0, B.getPlayer(b0, slot), c) });
  }
  const o = simulatePlayers(b);
  const incoming = expectedIncoming(b, 3);
  return o.dmg + o.kills + o.heal + o.draw * 2.5 + lingeringValue(b) - incoming * 1.0;
}

function planAI(b, slot) {
  const p = B.getPlayer(b, slot);
  if (!p || !p.alive) return;
  for (const r of p.reserved.slice()) { if (!(p.uniques || []).includes(r.uid)) p.hand.push(r.uid); p.energy += D.CARD_MAP[b.cards[r.uid]].cost; }
  p.reserved = []; p.confirmed = false;
  // 固有ゲージが足りる固有カードも候補に入れる（1ターンに1枚まで）
  const uq = (p.uniques || []).filter(u => (p.gauge || 0) >= (D.CARD_MAP[b.cards[u]].gauge || D.GAUGE_SEGS) * D.GAUGE_SEG);
  const hand = p.hand.concat(uq);
  const n = hand.length;
  let best = { score: -1e9, set: [] };
  for (let mask = 0; mask < (1 << n); mask++) {
    let cost = 0; const set = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { set.push(hand[i]); cost += D.CARD_MAP[b.cards[hand[i]]].cost; }
    if (cost > p.energy) continue;
    if (set.filter(u => uq.includes(u)).length > 1) continue;
    // 手札を使い切りすぎないよう、残す枚数にも少し価値をつける
    const score = evaluate(b, slot, set) + (n - set.length) * 1.5 - (p.energy - cost) * 0.3;
    if (score > best.score) best = { score, set };
  }
  for (const u of best.set) B.reserve(b, slot, u, bestTarget(b, p, D.CARD_MAP[b.cards[u]]));
  p.confirmed = true;
}

module.exports = { planAI, bestTarget };
