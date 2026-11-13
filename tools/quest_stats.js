// 依頼の目安を決めるための測定：一斉攻撃AIで勝った戦闘の、役職ごとの1戦あたりの数値
//   node tools/quest_stats.js [回数] [ステージID…]
const D = require('../shared/data'); const B = require('../server/battle');
const DK = require('./decks'); const ST = require('./strategies');
const N = +process.argv[2] || 60;
const stages = process.argv.slice(3).length ? process.argv.slice(3) : D.STAGES.map(s => s.id);
const keys = { attacker: 'dmg', debuffer: 'debuffs', tank: 'draws', healer: 'heal' };
const acc = {}; D.ROLE_ORDER.forEach(r => (acc[r] = []));
for (const sid of stages) {
  const st = D.STAGES.find(x => x.id === sid); const el = D.ENEMIES[st.boss].element; const W = D.weaknessOf(el);
  for (let k = 0; k < N; k++) {
    const b = B.createBattle(sid, D.ROLE_ORDER.map((r, i) => ({ slot: i, name: 'AI' + i, role: r, isAI: true, ...(sid === 'stage1' ? DK.starterDeck(r) : DK.burstDeck(r, el)) })));
    let g = 0; while (b.phase === 'planning' && g++ < 40) { ST.planBurstTeam(b, W); B.resolveTurn(b); }
    if (b.phase !== 'victory') continue;
    D.ROLE_ORDER.forEach((r, i) => acc[r].push(b.stats.p[i][keys[r]]));
  }
}
const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(f * (s.length - 1))]; };
for (const r of D.ROLE_ORDER) console.log(r.padEnd(9), keys[r].padEnd(10), 'n', acc[r].length, '25%', q(acc[r], .25), '50%', q(acc[r], .5), '75%', q(acc[r], .75), '90%', q(acc[r], .9));
