// 調整用のAI作戦（自動対戦ツール専用）
const D = require('../shared/data');
const B = require('../server/battle');
const { planAI, bestTarget } = require('../server/ai');

const rnd = (n) => Math.floor(Math.random() * n);
function clearReserve(b, p) {
  for (const r of p.reserved.slice()) { p.hand.push(r.uid); p.energy += D.CARD_MAP[b.cards[r.uid]].cost; }
  p.reserved = [];
}

// ---- 適当に出すAI：出せるカードをランダムに出す（対象もランダム） ----
function planRandom(b, slot) {
  const p = B.getPlayer(b, slot); if (!p || !p.alive) return;
  clearReserve(b, p);
  const hand = p.hand.slice().sort(() => Math.random() - 0.5);
  for (const u of hand) {
    const c = D.CARD_MAP[b.cards[u]];
    if (c.cost > p.energy || Math.random() < 0.3) continue;
    let target = null;
    if (c.target === 'enemy' || c.target === 'allEnemies') { const es = b.enemies.map((e, i) => (e.alive ? i : -1)).filter(i => i >= 0); target = es[rnd(es.length)]; }
    else if (c.target === 'ally') { const ps = B.alivePlayers(b); target = ps[rnd(ps.length)].slot; }
    B.reserve(b, slot, u, target);
  }
  p.confirmed = true;
}

// ---- 準備して一斉攻撃するAI（4人で連携） ----
// ボス戦のエネルギー8のターンに、全員が弱点属性のカードを出して4チェインを狙う。それまでは弱点属性のカードを温存する
const BURST_ENERGY = 8;
const hasEl = (c, W) => D.elementsOf(c).includes(W);
function planBurstTeam(b, W) {
  const bossWave = b.wave === b.waveCount - 1;
  const burstTurn = BURST_ENERGY - D.ENERGY_START + 1; // ウェーブ内の何ターン目か
  for (const p of b.players) {
    if (!p.alive) continue;
    if (!bossWave || b.waveTurn > burstTurn) { planAI(b, p.slot); continue; }
    if (b.waveTurn < burstTurn) {
      // 準備：弱点属性のカードのうち強いもの2枚までは温存し、それ以外で賢く戦う
      clearReserve(b, p);
      const val0 = (c) => c.effects.reduce((a, e) => a + (e.type === 'damage' ? e.value : 0), 0) * D.costMult(c.cost) + 1;
      const stash = p.hand.filter(u => hasEl(D.CARD_MAP[b.cards[u]], W))
        .sort((x, y) => val0(D.CARD_MAP[b.cards[y]]) - val0(D.CARD_MAP[b.cards[x]])).slice(0, 2);
      p.hand = p.hand.filter(u => !stash.includes(u));
      planAI(b, p.slot);
      p.hand.push(...stash);
      continue;
    }
    // 一斉攻撃のターン：弱点属性のカードを出せるだけ出し、残りのエネルギーでバフ・デバフを足す
    clearReserve(b, p);
    const val = (c) => c.effects.reduce((a, e) => a + (e.type === 'damage' ? e.value : 0), 0) * D.costMult(c.cost) + (c.priority === D.P.BUFF ? 5 : 0);
    const wCards = p.hand.filter(u => hasEl(D.CARD_MAP[b.cards[u]], W)).sort((x, y) => val(D.CARD_MAP[b.cards[y]]) - val(D.CARD_MAP[b.cards[x]]));
    // 一斉攻撃は本体を狙う
    const bodyIdx = b.enemies.findIndex(e => e.alive && !e.part);
    const tgt = (c) => (c.target === 'enemy' && bodyIdx >= 0 && c.effects.some(e => e.type === 'damage')) ? bodyIdx : bestTarget(b, p, c);
    for (const u of wCards) { const c = D.CARD_MAP[b.cards[u]]; if (c.cost <= p.energy) B.reserve(b, p.slot, u, tgt(c)); }
    const others = p.hand.filter(u => !hasEl(D.CARD_MAP[b.cards[u]], W))
      .sort((x, y) => { const a = D.CARD_MAP[b.cards[x]], c = D.CARD_MAP[b.cards[y]]; return (c.priority - a.priority) || (c.cost - a.cost); });
    for (const u of others) { const c = D.CARD_MAP[b.cards[u]]; if (c.cost <= p.energy && c.rarity !== 'item') B.reserve(b, p.slot, u, tgt(c)); }
    p.confirmed = true;
  }
}

module.exports = { planRandom, planBurstTeam, BURST_ENERGY };
