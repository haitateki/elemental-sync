// AI4人で自動対戦させて勝率などを出す： node tools/sim.js [回数] [starter|rare|adv] [ステージID]
const D = require('../shared/data'); const B = require('../server/battle'); const { planAI } = require('../server/ai');
const N = +process.argv[2] || 100;
// 2つ目の引数：rare＝各役職のレアカード10枚のデッキ／adv＝攻撃カードを敵の弱点属性で固めたデッキ（後のステージの調整用）
const MODE = process.argv[3] || 'starter';
const DK = require('./decks');
const STAGE = process.argv[4] || 'stage1';
const bossEl = (() => { const st = D.STAGES.find(x => x.id === STAGE); return D.ENEMIES[st.boss].element; })();
function deckFor(r) { return MODE === 'rare' ? DK.rareDeck(r) : MODE === 'adv' ? DK.advantageDeck(r, bossEl) : DK.starterDeck(r); }
let win = 0, turns = 0, lost = {}, deaths = 0, ultSurvive = 0, ultSeen = 0, bossTurns = 0, partsBroken = 0;
for (let k = 0; k < N; k++) {
  const b = B.createBattle(STAGE, D.ROLE_ORDER.map((r, i) => ({ slot: i, name: 'AI' + i, role: r, isAI: true, ...deckFor(r) })));
  let g = 0;
  while (b.phase === 'planning' && g++ < 40) {
    b.players.forEach(p => planAI(b, p.slot));
    const ult = b.enemies.some(e => e.alive && e.intent && e.intent.type === 'ultimate');
    bossTurns++;
    const ev = B.resolveTurn(b);
    if (ult) { ultSeen++; if (b.phase !== 'defeat') ultSurvive++; }
  }
  if (b.phase === 'victory') win++; else lost.boss = (lost.boss || 0) + 1;
  partsBroken += b.enemies.filter(e => e.part && !e.alive && e.hp <= 0).length;
  deaths += b.players.filter(p => !p.alive).length; turns += b.turn;
}
console.log({ win: win / N, avgTurn: (turns / N).toFixed(1), avgBossTurns: (bossTurns / N).toFixed(1), lostAtWave: lost, avgDeaths: (deaths / N).toFixed(2), ultSurviveRate: ultSeen ? (ultSurvive / ultSeen).toFixed(2) : '-' });
