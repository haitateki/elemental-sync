// HTTP（ゲーム画面の配信）＋ WebSocket（マルチプレイ）サーバー
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('./ws-lite');
const D = require('../shared/data');
const B = require('./battle');
const { planAI } = require('./ai');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  let file;
  if (url.startsWith('/shared/')) file = path.join(ROOT, url);
  else file = path.join(ROOT, 'public', url === '/' ? 'index.html' : url);
  const base = url.startsWith('/shared/') ? path.join(ROOT, 'shared') : path.join(ROOT, 'public');
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();      // code -> room
const clients = new Map();    // playerId -> ws

const AI_NAMES = ['AI・アルト', 'AI・ベル', 'AI・シオン', 'AI・ドーラ'];
const ANIM_BASE = 2000;

function genCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c; do { c = Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join(''); } while (rooms.has(c));
  return c;
}
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function sendTo(playerId, msg) { send(clients.get(playerId), msg); }

// ホストのセーブで解放されている★の上限（そのステージを★Nでクリア済みなら★N+1まで）
function maxStarOf(room, stageId) {
  const host = room.slots.find(s => s && s.playerId === room.hostId);
  const cleared = host && host.clears ? (host.clears[stageId] | 0) : 0;
  return Math.max(1, Math.min(D.STAR_MAX, cleared + 1));
}
function roomPublic(room) {
  return { code: room.code, hostId: room.hostId, timer: room.timer, stageId: room.stageId, star: room.star || 1, maxStar: maxStarOf(room, room.stageId),
    slots: room.slots.map(s => s && { playerId: s.playerId, name: s.name, role: s.role, connected: s.connected, leader: s.leader || null, fame: s.fame || 0, quests: s.quests || [] }),
    retreat: room.retreat ? { from: room.retreat.from, yes: [...room.retreat.yes] } : null, lastRetreat: room.lastRetreat || 0,
    retry: [...(room.retry || [])], members: [...(room.members || [])], ended: !!(room.battle && (room.battle.phase === 'victory' || room.battle.phase === 'defeat')),
    inBattle: !!room.battle };
}
// クライアントから届いた依頼（3つまで・形式チェック）
function cleanQuests(qs) { return Array.isArray(qs) ? qs.filter(D.validQuest).slice(0, 3).map(q => ({ qid: String(q.qid).slice(0, 20), tpl: q.tpl, diff: q.diff, p: q.p })) : []; }
function cleanClears(c) { const o = {}; if (c && typeof c === 'object') for (const s of D.STAGES) if (c[s.id]) o[s.id] = Math.max(0, Math.min(D.STAR_MAX, c[s.id] | 0)); return o; }
function broadcastRoom(room) {
  for (const s of room.slots) if (s) sendTo(s.playerId, { type: 'room', room: roomPublic(room), you: s.playerId });
}
function broadcastBattle(room, events) {
  const b = room.battle;
  for (const s of room.slots) if (s && (room.members || new Set()).has(s.playerId)) sendTo(s.playerId, { type: 'battle', battle: b, events: events || null, deadline: room.deadline, animMs: room.animMs || 0, slot: room.slots.indexOf(s) });
}

function findRoomOf(playerId) {
  for (const r of rooms.values()) if (r.slots.some(s => s && s.playerId === playerId)) return r;
  return null;
}

function validDeck(role, deck, leader) {
  if (!Array.isArray(deck) || deck.length !== D.DECK_SIZE) return false;
  if (new Set(deck).size !== deck.length) return false; // 同じカードは1枚まで
  if (!deck.includes(leader)) return false;
  return deck.every(id => D.CARD_MAP[id] && D.CARD_MAP[id].rarity !== 'unique' && (D.CARD_MAP[id].role === role || D.CARD_MAP[id].role === 'any')); // 固有カードはデッキではなく固有枠
}

function leaveRoom(playerId) {
  const room = findRoomOf(playerId);
  if (!room) return;
  const i = room.slots.findIndex(s => s && s.playerId === playerId);
  // 戦闘に参加している人は席を残す（戻ってこられるように）。結果画面中に途中参加した人などは席を空ける
  if (room.battle && room.members.has(playerId)) { room.slots[i].connected = false; }
  else room.slots[i] = null;
  if (room.origHostId === playerId) room.origHostId = null; // 自分で退出した元ホストには戻さない
  if (room.hostId === playerId) passHost(room);
  if (!room.slots.some(s => s && s.connected)) { clearTimeout(room.timerHandle); rooms.delete(room.code); return; }
  if (checkRetry(room) || checkRetreat(room)) return;
  broadcastRoom(room);
  if (room.battle) { checkAllConfirmed(room); broadcastBattle(room); }
}

// ホストを、つながっている次の人に渡す
function passHost(room) {
  const next = room.slots.find(s => s && s.connected && s.playerId !== room.hostId);
  if (next) room.hostId = next.playerId;
}
// 「もう一度」：つながっている人全員（役職を選んでいる人）が押したら再出発
function checkRetry(room) {
  const b = room.battle;
  if (!b || !(b.phase === 'victory' || b.phase === 'defeat')) return false;
  const humans = room.slots.filter(s => s && s.connected);
  if (humans.length && humans.every(s => s.role && room.retry.has(s.playerId))) {
    clearTimeout(room.timerHandle);
    room.slots.forEach((s, i) => { if (s && !s.connected) room.slots[i] = null; });
    startBattle(room); return true;
  }
  return false;
}

// ---- 戦闘の進行 ----
function aiReplan(room) {
  const b = room.battle;
  if (!b || b.phase !== 'planning') return;
  for (const p of b.players) if (p.isAI) planAI(b, p.slot);
}

function scheduleDeadline(room) {
  clearTimeout(room.timerHandle);
  room.deadline = null;
  if (!room.battle || room.battle.phase !== 'planning') return;
  if (room.timer > 0) {
    room.deadline = Date.now() + (room.animMs || 0) + room.timer * 1000;
    room.timerHandle = setTimeout(() => resolve(room), room.deadline - Date.now());
  }
}

function resolve(room) {
  const b = room.battle;
  if (!b || b.phase !== 'planning') return;
  clearTimeout(room.timerHandle);
  aiReplan(room);
  const events = B.resolveTurn(b);
  const tiers = new Set(events.filter(e => e.t === 'card').map(e => D.CARD_MAP[e.cardId].priority)).size;
  const acts = events.filter(e => e.t === 'enemyAct').length;
  processDrops(room, events);
  room.animMs = ANIM_BASE + tiers * 900 + acts * 700 + events.length * 50 + events.filter(e => e.t === 'drop').length * 900;
  if (b.phase === 'victory' || b.phase === 'defeat') { room.retry = new Set(); broadcastRoom(room); }
  if (b.phase === 'planning') aiReplan(room);
  scheduleDeadline(room);
  broadcastBattle(room, events);
  // 人間が全員倒れているときは、演出が終わったら次のターンも自動で進める
  if (b.phase === 'planning' && !b.players.some(p => !p.isAI && p.alive)) {
    clearTimeout(room.autoHandle);
    room.autoHandle = setTimeout(() => { if (room.battle === b) resolve(room); }, room.animMs || 1500);
  }
}
// 撤退：つながっている人間全員が賛成したら、報酬なしでロビーに戻る
function checkRetreat(room) {
  const rt = room.retreat; if (!rt || !room.battle) return false;
  const humans = room.slots.filter(s => s && s.connected && room.members.has(s.playerId));
  if (humans.length && humans.every(s => rt.yes.has(s.playerId))) {
    clearTimeout(room.timerHandle); clearTimeout(room.autoHandle);
    room.battle = null; room.deadline = null; room.retry = new Set(); room.members = new Set(); room.retreat = null;
    room.lastRetreat = Date.now();
    room.slots.forEach((s, i) => { if (s && !s.connected) room.slots[i] = null; });
    broadcastRoom(room); return true;
  }
  return false;
}

// ---- 報酬：倒した瞬間・部位を壊した瞬間に抽選して確定する ----
let ridCounter = 1;
const newRid = () => 'r' + Date.now().toString(36) + (ridCounter++);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function humansOf(b) { return b.players.filter(p => !p.isAI); }
function addReward(b, slot, item) { (b.rewards[slot] = b.rewards[slot] || []).push(item); return item; }

// 戦闘の結果イベントを見て、部位破壊・勝利のときに報酬を確定させ、演出用の drop イベントを差し込む
function processDrops(room, events) {
  const b = room.battle;
  const stage = D.STAGES.find(s => s.id === b.stageId);
  b.rewards = b.rewards || {};
  for (let k = 0; k < events.length; k++) {
    const ev = events[k];
    if (ev.t === 'partBreak' && stage.partReward) {
      // 部位破壊報酬：1部位につき名声の書・1を全員に（このあと全滅しても持ち帰れる）
      const items = humansOf(b).map(p => addReward(b, p.slot, { rid: newRid(), id: stage.partReward, kind: 'part', part: b.enemies[ev.i].name, slot: p.slot, name: p.name }));
      events.splice(k + 1, 0, { t: 'drop', i: ev.i, items, reason: 'part' }); k++;
    }
  }
  if (b.phase === 'victory') {
    const items = rollVictory(room);
    const vi = events.findIndex(e => e.t === 'victory');
    const bossI = Math.max(0, b.enemies.findIndex(e => !e.part));
    events.splice(vi < 0 ? events.length : vi, 0, { t: 'drop', i: bossI, items, reason: 'victory' });
  }
}

function rollVictory(room) {
  const b = room.battle;
  const stage = D.STAGES.find(s => s.id === b.stageId);
  const pool = D.rewardPool();
  const rp = D.rarePoolOf(stage);
  const dg = D.dangerOf(b.star);
  const DT = D.dropTable(b.star), RT = D.randomDropTable(b.star);
  // 固定報酬枠・名声枠：レア／名声の書・10／5／1（★で確率が上がる）／残りは通常ドロップ
  const special = () => {
    let r = Math.random();
    for (const d of DT) {
      if (r < d.rate) { if (d.kind === 'rare') return rp.length ? { id: pick(rp), kind: 'rare' } : null; return { id: d.id, kind: 'fameItem' }; }
      r -= d.rate;
    }
    return null;
  };
  // ランダム報酬枠：名声の書・10／5／1／残りは通常のランダム報酬
  const randomSlot = (kind) => {
    let r = Math.random();
    for (const d of RT) { if (r < d.rate) return { id: d.id, kind: 'fameItem', slotKind: kind }; r -= d.rate; }
    return { id: pick(pool), kind: 'random', slotKind: kind };
  };
  const speed = stage.speedTurns && b.turn <= stage.speedTurns;
  const out = [];
  const fameDrops = []; // 名声枠で出た報酬は、パーティ全員に配る
  const humans = humansOf(b);
  b.questResults = {};
  for (const p of humans) {
    const give = (it) => { const item = { rid: newRid(), ...it, slot: p.slot, name: p.name }; addReward(b, p.slot, item); out.push(item); };
    give(special() || { id: stage.fixedReward, kind: 'fixed' });
    for (let i = 0; i < stage.randomRewards + dg.extraRandom; i++) give(randomSlot(i < stage.randomRewards ? 'random' : 'star'));
    if (speed) give(randomSlot('speed'));
    // 名声枠：代表カードの名声1につき1%で発生（この枠も同じドロップ表）
    const slotInfo = room.slots[p.slot];
    const fame = slotInfo ? slotInfo.fame || 0 : 0;
    if (Math.random() * 100 < fame) {
      const sp = special();
      fameDrops.push({ ...(sp || { id: pick([stage.fixedReward, ...pool]), kind: 'fame' }), bonus: true, from: p.name, fromSlot: p.slot });
    }
    // 依頼の判定
    const qs = slotInfo && slotInfo.quests || [];
    const ctx = { victory: true, stageId: b.stageId, star: b.star, turns: b.turn, stats: b.stats, slot: p.slot, role: p.role };
    b.questResults[p.slot] = [];
    for (const q of qs) {
      if (!D.questCheck(q, ctx)) continue;
      const rw = D.QUEST_REWARD[q.diff];
      let it;
      if (rw.kind === 'rare') { const qs2 = q.p.stage ? D.STAGES.find(s => s.id === q.p.stage) : null; const rpool = (qs2 && D.rarePoolOf(qs2).length) ? D.rarePoolOf(qs2) : D.ALL_RARE; it = { id: pick(rpool), kind: 'rare' }; }
      else it = { id: rw.id, kind: 'fameItem' };
      give({ ...it, quest: true, qid: q.qid, questText: D.questText(q) });
      b.questResults[p.slot].push({ qid: q.qid, diff: q.diff, text: D.questText(q) });
    }
  }
  for (const p of humans) for (const d of fameDrops) { const item = { rid: newRid(), ...d, slot: p.slot, name: p.name }; addReward(b, p.slot, item); out.push(item); }
  return out;
}

function checkAllConfirmed(room) {
  const b = room.battle;
  if (!b || b.phase !== 'planning') return;
  const humans = b.players.filter(p => !p.isAI && p.alive);
  // 人間が全員倒れたら、AIだけで自動で進める
  if (!humans.length) return resolve(room);
  const connected = humans.filter(p => room.slots[p.slot] && room.slots[p.slot].connected);
  if (connected.length && connected.every(p => p.confirmed)) resolve(room);
}

function startBattle(room) {
  const used = new Set(room.slots.filter(Boolean).map(s => s.role));
  const freeRoles = D.ROLE_ORDER.filter(r => !used.has(r));
  const players = [];
  room.slots.forEach((s, i) => {
    if (s) players.push({ slot: i, name: s.name, role: s.role, isAI: false, deck: s.deck, leader: s.leader, uniques: s.uniques });
    else { const role = freeRoles.shift(); players.push({ slot: i, name: AI_NAMES[i], role, isAI: true, deck: D.STARTER[role], leader: D.STARTER[role][0] }); }
  });
  room.star = Math.min(room.star || 1, maxStarOf(room, room.stageId));
  room.battle = B.createBattle(room.stageId, players, { star: room.star });
  room.battle.rewards = {};
  room.retry = new Set(); room.retreat = null;
  room.members = new Set(room.slots.filter(Boolean).map(s => s.playerId)); // この戦闘に参加している人
  room.animMs = 0;
  aiReplan(room);
  scheduleDeadline(room);
  broadcastRoom(room);
  broadcastBattle(room);
}

// ---- メッセージ処理 ----
function handle(ws, playerId, msg) {
  const room = findRoomOf(playerId);
  const err = (m) => send(ws, { type: 'error', msg: m });
  switch (msg.type) {
    case 'create': {
      if (room) leaveRoom(playerId);
      const code = genCode();
      const timer = [0, 30, 60, 90, 120].includes(msg.timer) ? msg.timer : 0;
      const r = { code, hostId: playerId, timer, stageId: D.STAGES[0].id, star: 1, slots: [null, null, null, null], battle: null, retry: new Set(), members: new Set(), origHostId: null };
      r.slots[0] = { playerId, name: String(msg.name || 'プレイヤー').slice(0, 12), role: null, deck: null, connected: true, quests: cleanQuests(msg.quests), clears: cleanClears(msg.clears) };
      rooms.set(code, r);
      return broadcastRoom(r);
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return err('ルームが見つかりません');
      if (r.slots.some(s => s && s.playerId === playerId)) { r.slots.find(s => s.playerId === playerId).connected = true; broadcastRoom(r); if (r.battle) broadcastBattle(r); return; }
      if (r.battle && !(r.battle.phase === 'victory' || r.battle.phase === 'defeat')) return err('このルームは戦闘中です');
      const i = r.slots.findIndex(s => !s);
      if (i < 0) return err('ルームが満員です');
      if (room) leaveRoom(playerId);
      r.slots[i] = { playerId, name: String(msg.name || 'プレイヤー').slice(0, 12), role: null, deck: null, connected: true, quests: cleanQuests(msg.quests), clears: cleanClears(msg.clears) };
      return broadcastRoom(r);
    }
    case 'leave': leaveRoom(playerId); return send(ws, { type: 'left' });
  }
  if (!room) return err('ルームに入っていません');
  const slotIdx = room.slots.findIndex(s => s && s.playerId === playerId);
  const me = room.slots[slotIdx];
  const isHost = room.hostId === playerId;
  switch (msg.type) {
    case 'setRole': {
      // 戦闘中は変更できない。結果画面中は、途中参加した人だけ選べる
      const ended = room.battle && (room.battle.phase === 'victory' || room.battle.phase === 'defeat');
      if (room.battle && !(ended && !room.members.has(playerId))) return err('戦闘中は変更できません');
      if (msg.role === null) { me.role = null; me.deck = null; return broadcastRoom(room); }
      if (!D.ROLES[msg.role]) return err('役職が不正です');
      if (room.slots.some((s, i) => s && i !== slotIdx && s.role === msg.role)) return err('その役職は他の人が選んでいます');
      if (!validDeck(msg.role, msg.deck, msg.leader)) return err(`デッキはその役職のカードをちょうど${D.DECK_SIZE}枚（同じカードは1枚まで）にして、代表カードを選んでください`);
      me.role = msg.role; me.deck = msg.deck; me.leader = msg.leader;
      me.uniques = D.validUniques(msg.role, msg.uniques) && msg.uniques.length ? msg.uniques : [D.STARTER_UNIQUE[msg.role]];
      me.fame = Math.max(0, Math.min(D.FAME_MAX, Math.floor(+msg.fame || 0)));
      return broadcastRoom(room);
    }
    case 'setStage':
      if (!isHost || room.battle) return;
      if (D.STAGES.some(s => s.id === msg.stageId)) room.stageId = msg.stageId;
      room.star = Math.min(room.star || 1, maxStarOf(room, room.stageId));
      return broadcastRoom(room);
    case 'setStar': {
      // 危険度：ロビー、または戦闘終了後（もう一度の前）に変更できる
      const ended = room.battle && (room.battle.phase === 'victory' || room.battle.phase === 'defeat');
      if (!isHost || (room.battle && !ended)) return;
      room.star = Math.max(1, Math.min(maxStarOf(room, room.stageId), msg.star | 0));
      if (ended) room.retry = new Set(); // ★を変えたら「もう一度」の準備をやり直す
      return broadcastRoom(room);
    }
    case 'profile': {
      // 依頼・クリア状況・代表カードの名声の更新（報酬を受け取った後などに送られる）
      if (msg.quests) me.quests = cleanQuests(msg.quests);
      if (msg.clears) me.clears = cleanClears(msg.clears);
      if (msg.fame != null) me.fame = Math.max(0, Math.min(D.FAME_MAX, Math.floor(+msg.fame || 0)));
      if (isHost) room.star = Math.min(room.star || 1, maxStarOf(room, room.stageId));
      return broadcastRoom(room);
    }
    case 'retry': {
      // もう一度：同じメンバー・同じステージで再出発。人間の全員が押したら開始
      const b = room.battle;
      if (!b || !(b.phase === 'victory' || b.phase === 'defeat')) return;
      room.retry = room.retry || new Set();
      if (msg.value) { if (!me.role) return err('役職を選んでください'); room.retry.add(playerId); } else room.retry.delete(playerId);
      if (msg.fame != null) me.fame = Math.max(0, Math.min(D.FAME_MAX, Math.floor(+msg.fame || 0)));
      if (msg.quests) me.quests = cleanQuests(msg.quests);
      if (checkRetry(room)) return;
      return broadcastRoom(room);
    }
    case 'setTimer':
      if (!isHost || room.battle) return;
      room.timer = [0, 30, 60, 90, 120].includes(msg.timer) ? msg.timer : 0;
      return broadcastRoom(room);
    case 'start':
      if (!isHost) return err('開始できるのはホストだけです');
      if (room.battle) return;
      if (room.slots.some(s => s && !s.role)) return err('全員が役職を選ぶと開始できます');
      return startBattle(room);
    case 'selecting': {
      // カードを選んで対象を迷っている途中の状態（ほかの人に見せるだけ。判定には使わない）
      const b = room.battle; if (!b || b.phase !== 'planning') return;
      const p = B.getPlayer(b, slotIdx); if (!p || !p.alive) return;
      const cardId = msg.uid && p.hand.includes(msg.uid) ? b.cards[msg.uid] : null;
      p.selecting = cardId ? { cardId, target: Number.isInteger(msg.target) ? msg.target : null } : null;
      return broadcastBattle(room);
    }
    case 'reserve': case 'unreserve': case 'confirm': {
      const b = room.battle; if (!b) return;
      let e = null;
      const pp = B.getPlayer(b, slotIdx); if (pp) pp.selecting = null;
      if (msg.type === 'reserve') e = B.reserve(b, slotIdx, msg.uid, msg.target);
      else if (msg.type === 'unreserve') e = B.unreserve(b, slotIdx, msg.uid);
      else { const p = B.getPlayer(b, slotIdx); if (b.phase === 'planning' && p && p.alive) p.confirmed = !!msg.value; }
      if (e) err(e);
      aiReplan(room);
      broadcastBattle(room);
      return checkAllConfirmed(room);
    }
    case 'retreat': {
      const b = room.battle;
      if (!b || b.phase === 'victory' || b.phase === 'defeat' || !room.members.has(playerId)) return;
      if (msg.action === 'propose') { if (!room.retreat) room.retreat = { from: me.name, yes: new Set() }; room.retreat.yes.add(playerId); }
      else if (msg.action === 'yes' && room.retreat) room.retreat.yes.add(playerId);
      else if (msg.action === 'no') room.retreat = null; // 誰か一人でも反対したら取り消し
      if (checkRetreat(room)) return;
      return broadcastRoom(room);
    }
    case 'backToLobby':
      if (!isHost) return;
      clearTimeout(room.timerHandle);
      room.battle = null; room.deadline = null; room.retry = new Set(); room.members = new Set();
      room.slots.forEach((s, i) => { if (s && !s.connected) room.slots[i] = null; });
      return broadcastRoom(room);
  }
}

wss.on('connection', (ws) => {
  let playerId = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'hello') {
      playerId = String(msg.playerId || '').slice(0, 64);
      if (!playerId) return;
      const old = clients.get(playerId); if (old && old !== ws) old.close();
      clients.set(playerId, ws);
      const room = findRoomOf(playerId);
      if (room) {
        room.slots.find(s => s && s.playerId === playerId).connected = true;
        if (room.origHostId === playerId) { room.hostId = playerId; room.origHostId = null; } // 元のホストが戻ってきたらホストを返す
        broadcastRoom(room); if (room.battle) broadcastBattle(room);
      } else send(ws, { type: 'lobby' });
      return;
    }
    if (!playerId) return;
    if (msg.type === 'ping') return send(ws, { type: 'pong' });
    try { handle(ws, playerId, msg); } catch (e) { console.error(e); send(ws, { type: 'error', msg: 'サーバーでエラーが起きました' }); }
  });
  ws.on('close', () => {
    if (!playerId || clients.get(playerId) !== ws) return;
    clients.delete(playerId);
    const room = findRoomOf(playerId);
    if (!room) return;
    const s = room.slots.find(x => x && x.playerId === playerId);
    s.connected = false;
    // 戦闘外で切断した場合は30秒待ってから席を空ける
    setTimeout(() => {
      if (clients.has(playerId)) return;
      const r = findRoomOf(playerId);
      if (!r) return;
      if (!r.battle || !r.members.has(playerId)) return leaveRoom(playerId);
      if (!r.slots.some(x => x && x.connected)) { clearTimeout(r.timerHandle); rooms.delete(r.code); return; }
      // 30秒たっても戻らないホストは、仮のホストに交代（戻ってきたら返す）
      if (r.hostId === playerId) { r.origHostId = playerId; passHost(r); broadcastRoom(r); }
    }, 30000);
    if (checkRetry(room) || checkRetreat(room)) return;
    broadcastRoom(room);
    if (room.battle) { checkAllConfirmed(room); broadcastBattle(room); }
  });
});

// 切れた接続の掃除
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 25000);

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
