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

function roomPublic(room) {
  return { code: room.code, hostId: room.hostId, timer: room.timer, stageId: room.stageId,
    slots: room.slots.map(s => s && { playerId: s.playerId, name: s.name, role: s.role, connected: s.connected, leader: s.leader || null, fame: s.fame || 0 }),
    inBattle: !!room.battle };
}
function broadcastRoom(room) {
  for (const s of room.slots) if (s) sendTo(s.playerId, { type: 'room', room: roomPublic(room), you: s.playerId });
}
function broadcastBattle(room, events) {
  const b = room.battle;
  for (const s of room.slots) if (s) sendTo(s.playerId, { type: 'battle', battle: b, events: events || null, deadline: room.deadline, animMs: room.animMs || 0, slot: room.slots.indexOf(s) });
}

function findRoomOf(playerId) {
  for (const r of rooms.values()) if (r.slots.some(s => s && s.playerId === playerId)) return r;
  return null;
}

function validDeck(role, deck, leader) {
  if (!Array.isArray(deck) || deck.length !== D.DECK_SIZE) return false;
  if (new Set(deck).size !== deck.length) return false; // 同じカードは1枚まで
  if (!deck.includes(leader)) return false;
  return deck.every(id => D.CARD_MAP[id] && (D.CARD_MAP[id].role === role || D.CARD_MAP[id].role === 'any'));
}

function leaveRoom(playerId) {
  const room = findRoomOf(playerId);
  if (!room) return;
  const i = room.slots.findIndex(s => s && s.playerId === playerId);
  if (room.battle) { room.slots[i].connected = false; }
  else room.slots[i] = null;
  if (room.hostId === playerId) {
    const next = room.slots.find(s => s && s.connected);
    room.hostId = next ? next.playerId : null;
  }
  if (!room.slots.some(s => s && s.connected)) { clearTimeout(room.timerHandle); rooms.delete(room.code); return; }
  broadcastRoom(room);
  if (room.battle) { checkAllConfirmed(room); broadcastBattle(room); }
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
  room.animMs = ANIM_BASE + tiers * 900 + acts * 700 + events.length * 50 + (events.some(e => e.t === 'wave') ? 1500 : 0);
  if (b.phase === 'victory') giveRewards(room);
  if (b.phase === 'planning') aiReplan(room);
  scheduleDeadline(room);
  broadcastBattle(room, events);
}

function giveRewards(room) {
  const stage = D.STAGES.find(s => s.id === room.battle.stageId);
  const pool = D.rewardPool();
  const rp = D.rarePoolOf(stage);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  // 固定報酬枠・名声枠：レア10%／名声+10 5%／名声+5 10%／名声+1 10%／残りは通常ドロップ
  const special = () => {
    let r = Math.random();
    for (const d of D.DROP_TABLE) {
      if (r < d.rate) { if (d.kind === 'rare') return rp.length ? { id: pick(rp), kind: 'rare' } : null; return { id: d.id, kind: 'fameItem' }; }
      r -= d.rate;
    }
    return null;
  };
  room.battle.rewards = {};
  const fameDrops = []; // 名声枠で出た報酬は、パーティ全員に配る
  const humans = room.battle.players.filter(p => !p.isAI);
  for (const p of humans) {
    const list = [special() || { id: stage.fixedReward, kind: 'fixed' }];
    // ランダム報酬枠：名声+10 5%／名声+5 10%／名声+1 10%／残りは通常のランダム報酬
    const randomSlot = () => {
      let r = Math.random();
      for (const d of D.RANDOM_DROP_TABLE) { if (r < d.rate) return { id: d.id, kind: 'fameItem', slot: 'random' }; r -= d.rate; }
      return { id: pick(pool), kind: 'random' };
    };
    for (let i = 0; i < stage.randomRewards; i++) list.push(randomSlot());
    room.battle.rewards[p.slot] = list;
    // 名声枠：代表カードの名声1につき1%で発生（この枠も同じドロップ表）
    const slotInfo = room.slots[p.slot];
    const fame = slotInfo ? slotInfo.fame || 0 : 0;
    if (Math.random() * 100 < fame) {
      const sp = special();
      const item = sp || { id: pick([stage.fixedReward, ...pool]), kind: 'fame' };
      fameDrops.push({ ...item, bonus: true, from: p.name, fromSlot: p.slot });
    }
  }
  for (const p of humans) room.battle.rewards[p.slot].push(...fameDrops.map(d => ({ ...d })));
}

function checkAllConfirmed(room) {
  const b = room.battle;
  if (!b || b.phase !== 'planning') return;
  const humans = b.players.filter(p => !p.isAI && p.alive);
  const connected = humans.filter(p => room.slots[p.slot] && room.slots[p.slot].connected);
  if (connected.length && connected.every(p => p.confirmed)) resolve(room);
}

function startBattle(room) {
  const used = new Set(room.slots.filter(Boolean).map(s => s.role));
  const freeRoles = D.ROLE_ORDER.filter(r => !used.has(r));
  const players = [];
  room.slots.forEach((s, i) => {
    if (s) players.push({ slot: i, name: s.name, role: s.role, isAI: false, deck: s.deck, leader: s.leader });
    else { const role = freeRoles.shift(); players.push({ slot: i, name: AI_NAMES[i], role, isAI: true, deck: D.STARTER[role], leader: D.STARTER[role][0] }); }
  });
  room.battle = B.createBattle(room.stageId, players);
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
      const r = { code, hostId: playerId, timer, stageId: D.STAGES[0].id, slots: [null, null, null, null], battle: null };
      r.slots[0] = { playerId, name: String(msg.name || 'プレイヤー').slice(0, 12), role: null, deck: null, connected: true };
      rooms.set(code, r);
      return broadcastRoom(r);
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return err('ルームが見つかりません');
      if (r.slots.some(s => s && s.playerId === playerId)) { r.slots.find(s => s.playerId === playerId).connected = true; broadcastRoom(r); if (r.battle) broadcastBattle(r); return; }
      if (r.battle) return err('このルームは戦闘中です');
      const i = r.slots.findIndex(s => !s);
      if (i < 0) return err('ルームが満員です');
      if (room) leaveRoom(playerId);
      r.slots[i] = { playerId, name: String(msg.name || 'プレイヤー').slice(0, 12), role: null, deck: null, connected: true };
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
      if (room.battle) return err('戦闘中は変更できません');
      if (msg.role === null) { me.role = null; me.deck = null; return broadcastRoom(room); }
      if (!D.ROLES[msg.role]) return err('役職が不正です');
      if (room.slots.some((s, i) => s && i !== slotIdx && s.role === msg.role)) return err('その役職は他の人が選んでいます');
      if (!validDeck(msg.role, msg.deck, msg.leader)) return err(`デッキはその役職のカードをちょうど${D.DECK_SIZE}枚（同じカードは1枚まで）にして、代表カードを選んでください`);
      me.role = msg.role; me.deck = msg.deck; me.leader = msg.leader;
      me.fame = Math.max(0, Math.min(D.FAME_MAX, Math.floor(+msg.fame || 0)));
      return broadcastRoom(room);
    }
    case 'setStage':
      if (!isHost || room.battle) return;
      if (D.STAGES.some(s => s.id === msg.stageId)) room.stageId = msg.stageId;
      return broadcastRoom(room);
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
    case 'backToLobby':
      if (!isHost) return;
      clearTimeout(room.timerHandle);
      room.battle = null; room.deadline = null;
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
      if (r && !r.battle) leaveRoom(playerId);
      else if (r && !r.slots.some(x => x && x.connected)) { clearTimeout(r.timerHandle); rooms.delete(r.code); }
    }, 30000);
    broadcastRoom(room);
    if (room.battle) { checkAllConfirmed(room); broadcastBattle(room); }
  });
});

// 切れた接続の掃除
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 25000);

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
