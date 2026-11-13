// 調整用のデッキを自動で組む
const D = require('../shared/data');

const isAttack = (c) => c.effects.some(e => e.type === 'damage');
const statSum = (c) => c.stats.hp + c.stats.atk * 4 + c.stats.heal * 4;

// レアカード10枚のデッキ（基準）
function rareDeck(role) {
  const rs = D.CARDS.filter(c => c.role === role && c.rarity === 'rare');
  return { deck: rs.map(c => c.id), leader: rs.slice().sort((a, b) => b.stats.hp - a.stats.hp)[0].id };
}

// 攻撃カードを「敵の弱点属性」で固めたデッキ。攻撃以外のカードはレアデッキのものを使う
function advantageDeck(role, enemyElement) {
  const weak = D.weaknessOf(enemyElement);
  const base = rareDeck(role).deck.map(id => D.CARD_MAP[id]);
  const nAttack = base.filter(isAttack).length;
  const support = base.filter(c => !isAttack(c));
  const pool = D.CARDS.filter(c => c.role === role && !['unique', 'item'].includes(c.rarity) && isAttack(c));
  const score = (c) => (D.elementsOf(c).includes(weak) ? 1000 : D.affinity(D.elementsOf(c), enemyElement) >= 1 ? 500 : 0) + statSum(c);
  const attacks = pool.slice().sort((a, b) => score(b) - score(a)).slice(0, nAttack);
  const deck = [...attacks, ...support].slice(0, D.DECK_SIZE).map(c => c.id);
  // 足りなければレアデッキから補う
  for (const c of base) { if (deck.length >= D.DECK_SIZE) break; if (!deck.includes(c.id)) deck.push(c.id); }
  const leader = deck.slice().sort((a, b) => D.CARD_MAP[b].stats.hp - D.CARD_MAP[a].stats.hp)[0];
  return { deck, leader };
}

function starterDeck(role) { return { deck: D.STARTER[role], leader: D.STARTER[role][0] }; }

// 一斉攻撃用：弱点デッキをもとに、弱点属性のカードが最低3枚入るようにする（タンク・ヒーラーもチェインに参加できるように）
function burstDeck(role, enemyElement, base) {
  const W = D.weaknessOf(enemyElement);
  const d = (base || advantageDeck(role, enemyElement)).deck.slice();
  const rank = { rare: 3, uncommon: 2, common: 1 };
  const has = (id) => D.elementsOf(D.CARD_MAP[id]).includes(W);
  const pool = D.CARDS.filter(c => c.role === role && rank[c.rarity] && D.elementsOf(c).includes(W) && !d.includes(c.id))
    .sort((a, b) => rank[b.rarity] - rank[a.rarity] || b.stats.hp - a.stats.hp);
  while (d.filter(has).length < 3 && pool.length) {
    // 弱点属性でない、攻撃以外のカードと入れ替える（ステータスの低いものから）
    const out = d.filter(id => !has(id) && !isAttack(D.CARD_MAP[id])).sort((a, b) => D.CARD_MAP[a].stats.hp - D.CARD_MAP[b].stats.hp)[0]
      || d.filter(id => !has(id)).sort((a, b) => D.CARD_MAP[a].stats.hp - D.CARD_MAP[b].stats.hp)[0];
    if (!out) break;
    d[d.indexOf(out)] = pool.shift().id;
  }
  const leader = d.slice().sort((a, b) => D.CARD_MAP[b].stats.hp - D.CARD_MAP[a].stats.hp)[0];
  return { deck: d, leader };
}

module.exports = { rareDeck, advantageDeck, starterDeck, burstDeck, isAttack };
