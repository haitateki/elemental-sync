// 難易度の確認：一斉攻撃AI（目標 約90%）と、適当に出すAI（目標 低い）の勝率を出す
//   node tools/balance.js [回数] [ステージID…]
const D = require('../shared/data'); const B = require('../server/battle'); const { planAI } = require('../server/ai');
const DK = require('./decks'); const ST = require('./strategies');
const N = +process.env.SIM_N || +process.argv[2] || 100;
const stages = process.argv.slice(3).length ? process.argv.slice(3) : D.STAGES.map(s => s.id);
function bossEl(stageId) { const st = D.STAGES.find(x => x.id === stageId); return D.ENEMIES[st.waves[st.waves.length - 1][0]].element; }
// ステージ1は初期デッキ、それ以外はレア入りの弱点デッキが前提
function decks(stageId) {
  const el = bossEl(stageId);
  return D.ROLE_ORDER.map(r => stageId === 'stage1' ? DK.starterDeck(r) : DK.burstDeck(r, el));
}
function run(stageId, mode) {
  const W = D.weaknessOf(bossEl(stageId)); const dk = decks(stageId);
  let win = 0, turns = 0;
  for (let k = 0; k < N; k++) {
    const b = B.createBattle(stageId, D.ROLE_ORDER.map((r, i) => ({ slot: i, name: 'AI' + i, role: r, isAI: true, ...dk[i] })));
    let g = 0;
    while (b.phase === 'planning' && g++ < 40) {
      if (mode === 'burst') ST.planBurstTeam(b, W);
      else if (mode === 'random') b.players.forEach(p => ST.planRandom(b, p.slot));
      else b.players.forEach(p => planAI(b, p.slot));
      B.resolveTurn(b);
    }
    if (b.phase === 'victory') win++; turns += b.turn;
  }
  return { win: +(win / N).toFixed(2), turns: +(turns / N).toFixed(1) };
}
if (require.main === module) for (const s of stages) console.log(s.padEnd(13), '一斉攻撃AI', JSON.stringify(run(s, 'burst')), ' 適当AI', JSON.stringify(run(s, 'random')), ' 賢いAI', JSON.stringify(run(s, 'smart')));
module.exports = { run };
