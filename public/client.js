// ===== エレメンタル・シンクロ クライアント =====
(() => {
  const D = window.GameData, S = window.Sprites;
  const $ = (id) => document.getElementById(id);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- セーブデータ（ブラウザに保存） ----------
  // 保存先の名前。アップデートしても所持カードが消えないよう、今後この名前は変えない（形式の変更は sanitize で吸収する）
  const SAVE_KEY = 'elemental_sync_save_v2';
  const SAVE_VERSION = 3;
  function defaultSave() {
    const collection = {};
    Object.values(D.STARTER).flat().forEach(id => (collection[id] = (collection[id] || 0) + 1));
    const leaders = {}; D.ROLE_ORDER.forEach(r => (leaders[r] = D.STARTER[r][0]));
    return { fameBonus: {}, name: '', playerId: 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36), collection, decks: JSON.parse(JSON.stringify(D.STARTER)), leaders, uniques: {}, claimed: [], claimedRids: [], quests: [], clears: {} };
  }
  let save;
  try { save = JSON.parse(localStorage.getItem(SAVE_KEY)) || defaultSave(); } catch { save = defaultSave(); }
  save = sanitize(Object.assign(defaultSave(), save));
  // アップデートでカードが変わっても壊れないように、セーブデータを整える
  function sanitize(sv) {
    const out = Object.assign(defaultSave(), sv);
    // 存在しなくなったカードは所持から外す
    const col = {}; Object.entries(out.collection || {}).forEach(([id, n]) => { if (D.CARD_MAP[id] && n > 0) col[id] = Math.floor(n); });
    D.ROLE_ORDER.forEach(r => D.STARTER[r].forEach(id => { if (!col[id]) col[id] = 1; })); // 初期カードは必ず持っている
    Object.values(D.STARTER_UNIQUE).forEach(id => { if (!col[id]) col[id] = 1; }); // 最初の固有カードも必ず持っている
    out.collection = col;
    out.decks = out.decks || {}; out.leaders = out.leaders || {};
    D.ROLE_ORDER.forEach(r => {
      // デッキ：その役職の所持カードだけ・重複なし。足りなければ初期カード→所持カードで補う
      const okDeck = (id) => D.CARD_MAP[id] && D.CARD_MAP[id].rarity !== 'unique' && (D.CARD_MAP[id].role === r || D.CARD_MAP[id].role === 'any') && col[id];
      let deck = [...new Set((out.decks[r] || []).filter(okDeck))].slice(0, D.DECK_SIZE);
      for (const id of [...D.STARTER[r], ...Object.keys(col).filter(id => D.CARD_MAP[id].role === r)]) { if (deck.length >= D.DECK_SIZE) break; if (!deck.includes(id) && okDeck(id)) deck.push(id); }
      out.decks[r] = deck;
      if (!deck.includes(out.leaders[r])) out.leaders[r] = deck[0];
      // 固有枠：その役職の所持している固有カードを最大3枚。空なら最初の固有カード
      out.uniques = out.uniques || {};
      let uq = [...new Set((out.uniques[r] || []).filter(id => D.CARD_MAP[id] && D.CARD_MAP[id].rarity === 'unique' && D.CARD_MAP[id].role === r && col[id]))].slice(0, D.UNIQUE_MAX);
      if (!uq.length && D.STARTER_UNIQUE[r]) uq = [D.STARTER_UNIQUE[r]];
      out.uniques[r] = uq;
    });
    out.claimed = Array.isArray(out.claimed) ? out.claimed.slice(-30) : [];
    out.claimedRids = Array.isArray(out.claimedRids) ? out.claimedRids.slice(-400) : [];
    // 依頼：簡単・普通・難しいを1つずつ。壊れたもの・足りないものは作り直す
    const qs = (Array.isArray(out.quests) ? out.quests : []).filter(D.validQuest);
    out.quests = D.QUEST_DIFFS.map(df => qs.find(q => q.diff === df) || D.genQuest(df, qs));
    // クリア状況：ステージごとにクリアした最高の★
    const cl = {}; Object.entries(out.clears || {}).forEach(([id, n]) => { if (D.STAGES.some(x => x.id === id) && n > 0) cl[id] = Math.min(D.STAR_MAX, n | 0); }); out.clears = cl;
    const fb = {}; Object.entries(out.fameBonus || {}).forEach(([id, n]) => { if (D.CARD_MAP[id] && n > 0) fb[id] = Math.floor(n); }); out.fameBonus = fb;
    out.version = SAVE_VERSION;
    return out;
  }
  const params = new URLSearchParams(location.search);
  const playerId = save.playerId;
  // そのカードの名声（重ねた枚数＋名声カードで上げた分）
  function fameFor(id) { return D.fameOf(save.collection[id], (save.fameBonus || {})[id]); }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { } }
  persist();
  const encodeSave = () => btoa(unescape(encodeURIComponent(JSON.stringify({ n: save.name, c: save.collection, d: save.decks, l: save.leaders, f: save.fameBonus, q: save.quests, cl: save.clears, u: save.uniques }))));
  function importSave(code) {
    const o = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    if (!o.c || !o.d) throw new Error('bad');
    applyImported({ name: o.n, collection: o.c, decks: o.d, leaders: o.l, fameBonus: o.f, quests: o.q, clears: o.cl, uniques: o.u });
  }
  function applyImported(o) {
    if (!o || !o.collection) throw new Error('bad');
    save = sanitize({ ...save, name: o.name || save.name, collection: o.collection, decks: o.decks || {}, leaders: o.leaders || {}, fameBonus: o.fameBonus || save.fameBonus || {}, quests: o.quests || save.quests, clears: o.clears || save.clears || {}, uniques: o.uniques || save.uniques || {} });
    persist();
  }
  // セーブデータをファイルに書き出す（JSON）
  function exportSaveFile() {
    const data = { game: 'elemental-sync', version: SAVE_VERSION, exportedAt: new Date().toISOString(), name: save.name, collection: save.collection, decks: save.decks, leaders: save.leaders, fameBonus: save.fameBonus, quests: save.quests, clears: save.clears, uniques: save.uniques };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date(); const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    a.href = URL.createObjectURL(blob); a.download = `elemental-sync-save-${ymd}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importSaveFile(file, done) {
    const fr = new FileReader();
    fr.onload = () => { try { const o = JSON.parse(fr.result); if (o.game !== 'elemental-sync') throw new Error('bad'); applyImported(o); done(true); } catch { done(false); } };
    fr.readAsText(file);
  }

  // ---------- 通信 ----------
  let ws = null, wsReady = false, retry = 0;
  const outbox = [];
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    setConn(retry ? '再接続中…' : 'サーバーに接続中…（初回は起動に数十秒かかることがあります）');
    ws.onopen = () => {
      wsReady = true; retry = 0; setConn('接続OK');
      ws.send(JSON.stringify({ type: 'hello', playerId }));
      while (outbox.length) ws.send(outbox.shift());
    };
    ws.onmessage = (m) => onMessage(JSON.parse(m.data));
    ws.onclose = () => {
      wsReady = false; retry++;
      setConn('接続が切れました。再接続中…');
      if (state.screen === 'battle' || state.screen === 'room') toast('接続が切れました。再接続しています…', 'info');
      setTimeout(connect, Math.min(1000 * retry, 5000));
    };
  }
  function send(msg) { const s = JSON.stringify(msg); if (wsReady) ws.send(s); else outbox.push(s); }
  function setConn(t) { $('conn-status').textContent = t; }
  setInterval(() => { if (wsReady) send({ type: 'ping' }); }, 20000);

  // 自分の依頼・クリア状況・代表カードの名声をサーバー（ルーム）に知らせる
  function myRoomSlot() { return state.room ? state.room.slots.find(s => s && s.playerId === playerId) : null; }
  function profilePayload() { const me = myRoomSlot(); return { quests: save.quests, clears: save.clears, fame: me && me.leader ? fameFor(me.leader) : undefined }; }
  function sendProfile() { if (state.room) send({ type: 'profile', ...profilePayload() }); }

  // ---------- 状態 ----------
  const state = { screen: 'title', room: null, battle: null, view: null, slot: null, deadline: null,
    anim: [], animating: false, targeting: null, deckRole: 'attacker', logLines: [] };

  function show(screen) {
    state.screen = screen;
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    $('screen-' + screen).classList.remove('hidden');
    if (screen === 'battle') requestAnimationFrame(layoutOverlay);
  }
  function toast(msg, kind) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast' + (kind ? ' ' + kind : '');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  function modal(html, buttons) {
    $('modal-body').innerHTML = html;
    const box = $('modal-btns'); box.innerHTML = '';
    (buttons || [{ label: '閉じる' }]).forEach(b => {
      const el = h('button', 'btn' + (b.primary ? ' primary' : ''), b.label);
      el.onclick = () => { if (!b.keep) closeModal(); b.onClick && b.onClick(); };
      box.appendChild(el);
    });
    $('modal').classList.remove('hidden');
  }
  function closeModal() { $('modal').classList.add('hidden'); }

  // ---------- カード表示 ----------
  const iconCache = {};
  function icon(el) { if (!iconCache[el]) iconCache[el] = S.elementIcon(el); const c = document.createElement('canvas'); c.width = 9; c.height = 9; c.getContext('2d').drawImage(iconCache[el], 0, 0); return c; }
  const heroCache = {};
  function heroCanvas(role) { if (!heroCache[role]) heroCache[role] = S.heroSprite(role); const spr = heroCache[role]; const c = document.createElement('canvas'); c.width = spr.width; c.height = spr.height; c.getContext('2d').drawImage(spr, 0, 0); if (spr.width > 20) c.classList.add('hi'); return c; }
  const PRIO_NAME = { 100: 'バフ', 80: '防御', 60: 'デバフ', 40: '攻撃', 30: '回復' };
  const turnsTxt = (t) => t === 1 ? 'このターン' : `${t}ターン`;
  const TARGET_TEXT = { enemy: '敵1体', allEnemies: '敵全体', ally: '味方1人', self: '自分', allAllies: '味方全体' };

  // ctx: { atk, heal, dmgUp, healUp, element, enemy } を渡すと、現在かかっているバフ込みの数値を表示する（このターンに予約したバフは含まない）
  function effText(ef, mult, ctx, cm) {
    cm = cm || 1;
    const show = (v, up) => (up ? `<span class="up">${v}</span>` : `${v}`);
    const pre = ef.self ? '自分に' : ef.allAllies ? '味方全体に' : '';
    switch (ef.type) {
      case 'damage': {
        if (ef.flat) return pre + `${ef.value}ダメージ（固定）`;
        if (ctx) {
          const e = ctx.enemy;
          if (e) {
            // 狙っている敵の防御力・防御ダウン・相性・被ダメージアップまで含めた数値
            const def = Math.max(0, e.def - sumSt(e, 'defDown'));
            const aff = D.affinity(ctx.elements || ctx.element, e.element);
            const d = Math.floor((Math.max(0, Math.floor((ef.value + ctx.atk) * mult) - def) * aff + ctx.dmgUp + sumSt(e, 'vulnUp')) * cm);
            const tag = aff === 2 ? '<span class="adv">弱点</span>' : aff === 0.5 ? '<span class="disadv">いまひとつ</span>' : '';
            return pre + `<span class="tgt">${show(d, true)}ダメージ</span>${tag}`;
          }
          return pre + show(Math.floor((Math.floor((ef.value + ctx.atk) * mult) + ctx.dmgUp) * cm), true) + 'ダメージ';
        }
        return pre + `(${ef.value}＋攻撃力)${mult > 1 ? '×' + mult : ''}${cm > 1 ? '×' + cm : ''}ダメージ`;
      }
      case 'heal': {
        if (ctx) return pre + 'HP' + show(Math.floor((Math.floor((ef.value + ctx.heal) * mult) + ctx.healUp) * cm), true) + '回復';
        return pre + `HP(${ef.value}＋回復力)${mult > 1 ? '×' + mult : ''}${cm > 1 ? '×' + cm : ''}回復`;
      }
      case 'status': {
        const v = Math.floor(ef.value * mult * cm); const stt = D.STATUS[ef.status];
        const num = show(v, mult > 1 || cm > 1) + (stt.pct ? '%' : '');
        if (ef.status === 'taunt') return pre + `挑発＋被ダメ${num}カット（${turnsTxt(ef.turns)}）`;
        // 方向は名前（アップ／ダウン）で表すので、数値に＋−の記号は付けない
        return pre + `${stt.name}${num}（${turnsTxt(ef.turns)}）`;
      }
      case 'draw': return pre + `次ターンドロー+${ef.value}`;
    }
    return '';
  }
  // 「火チェイン2」のような表記
  const chainLabel = (card) => D.isAllElement(card) ? `<span class="chain-name all-el-text">全属性チェイン${card.chain.min}</span>` : `<span class="chain-name">${D.elementsOf(card).map(e => `<span style="color:${D.ELEMENTS[e].color}">${D.ELEMENTS[e].name}</span>`).join('')}チェイン${card.chain.min}</span>`;
  const elNames = (card) => D.isAllElement(card) ? '全属性' : D.elementsOf(card).map(e => D.ELEMENTS[e].name).join('・');
  function setElVars(el, card) { const els = D.elementsOf(card); el.style.setProperty('--el', D.ELEMENTS[els[0]].color); el.style.setProperty('--el2', D.ELEMENTS[els[1] || els[0]].color); if (D.isAllElement(card)) el.classList.add('all-el'); else if (els.length > 1) el.classList.add('dual'); }
  // チェインの追加効果の文章。元の効果に上乗せされるものは「元の値→チェイン時の値」で書く（例：攻撃力ダウン4→7）
  function chainEffText(card, ce, cm) {
    const base = card.effects.find(e => D.sameSlot(e, ce));
    if (!base) return 'さらに' + effText(ce, 1, null, cm); // チェインで新しく加わる効果
    const pre = ce.self ? '自分の' : ce.allAllies ? '味方全体の' : '';
    const x = cm > 1 ? '×' + cm : '';
    switch (ce.type) {
      case 'damage': return pre + `(${base.value}→${base.value + ce.value}＋攻撃力)${x}ダメージ`;
      case 'heal': return pre + `HP(${base.value}→${base.value + ce.value}＋回復力)${x}回復`;
      case 'draw': return pre + `次ターンドロー${base.value}→${base.value + ce.value}枚`;
      case 'status': {
        const stt = D.STATUS[ce.status]; const pct = stt.pct || ce.status === 'taunt' ? '%' : '';
        const b = Math.floor(base.value * cm), t = Math.floor((base.value + ce.value) * cm);
        return pre + `${ce.status === 'taunt' ? '被ダメカット' : stt.name}${b}${pct}→${t}${pct}`;
      }
    }
    return '';
  }
  function cardDescHTML(card, mult, count, ctx) {
    const cm = D.costMult(card.cost);
    const parts = card.effects.map(ef => effText(ef, mult, ctx, cm));
    let html = `<b>${TARGET_TEXT[card.target]}</b>に ` + parts.join('、');
    if (card.chain) html += `<div class="bonus">${chainLabel(card)}：${card.chain.effects.map(ce => chainEffText(card, ce, cm)).join('、')}</div>`;
    return html;
  }
  // opts: { mult, count, disabled, onClick, showRole, ctx, leader, fame }
  function renderCard(cardId, opts = {}) {
    const c = D.CARD_MAP[cardId]; const el = D.ELEMENTS[c.element];
    const mult = opts.mult || 1;
    const d = h('div', 'card' + (opts.disabled ? ' disabled' : ''));
    setElVars(d, c);
    d.appendChild(h('div', 'c-cost', String(c.cost)));
    const eb = h('div', 'c-el'); D.elementsOf(c).forEach(e => eb.appendChild(icon(e))); eb.appendChild(h('span', '', elNames(c))); d.appendChild(eb);
    d.appendChild(h('div', 'c-name', esc(c.name)));
    if (opts.showRole) d.appendChild(h('div', 'c-role', (D.ROLES[c.role] ? D.ROLES[c.role].name : '全役職') + (c.rarity !== 'common' ? '・' + D.RARITY[c.rarity].name : '')));
    if (c.rarity !== 'common') { d.classList.add('r-' + c.rarity); d.appendChild(h('div', 'c-rarity', D.RARITY[c.rarity].name)); }
    const art = h('div', 'c-art' + (D.isAllElement(c) ? ' all' : '')); D.elementsOf(c).forEach(e => art.appendChild(icon(e))); d.appendChild(art);
    const cmv = D.costMult(c.cost);
    d.appendChild(h('div', 'c-meta', `<span class="c-prio">${PRIO_NAME[c.priority] || ''} 優先${c.priority}</span>${cmv > 1 && c.rarity !== 'item' ? `<span class="c-cm">重×${cmv}</span>` : ''}`));
    d.appendChild(h('div', 'c-desc', cardDescHTML(c, mult, opts.count, opts.ctx)));
    if (opts.leader) { d.classList.add('leader'); d.appendChild(h('div', 'c-leader', '★代表')); }
    if (mult > 1) d.appendChild(h('div', 'c-mult', '×' + mult));
    if (opts.onClick) d.onclick = opts.onClick;
    return d;
  }
  // デッキ編集用：表（効果）と裏（基本ステータス）があるカード。クリックで裏返す
  function flipCard(cardId, opts = {}) {
    const c = D.CARD_MAP[cardId];
    const wrap = h('div', 'card-flip');
    const front = renderCard(cardId, opts); front.classList.add('face', 'front'); front.onclick = null;
    const back = h('div', 'card face back'); setElVars(back, c);
    const m = opts.leader ? 2 : 1;
    back.innerHTML = `<div class="b-title">${esc(c.name)}</div><div class="b-sub">基本ステータス${opts.leader ? '（★代表×2）' : ''}</div>
      <div class="b-stat"><span>HP</span><b>${c.stats.hp * m}</b></div>
      <div class="b-stat"><span>攻撃力</span><b>${c.stats.atk * m}</b></div>
      <div class="b-stat"><span>回復力</span><b>${c.stats.heal * m}</b></div>
      <div class="b-fame" title="代表カードにすると、勝利時に${opts.fame || 0}%の確率で追加報酬">名声 ${opts.fame || 0}<small>（代表時 追加報酬${opts.fame || 0}%）</small></div>`;
    // 名声の書ボタン（押すとその書を1枚使って、このカードの名声を上げる）
    if (c.rarity !== 'item') {
      const row = h('div', 'b-famebtns');
      [1, 5, 10].forEach(n => {
        const have = save.collection['fame_' + n] || 0;
        const b = h('button', 'btn small fame-btn', `+${n}<i>×${have}</i>`);
        b.disabled = !have || fameFor(cardId) >= D.FAME_MAX;
        b.title = have ? `名声の書・${n}を使う（残り${have}枚）` : `名声の書・${n}を持っていません`;
        b.onclick = (ev) => { ev.stopPropagation(); useFameBook(n, cardId); };
        row.appendChild(b);
      });
      back.appendChild(row);
    }
    if (state.flipped && state.flipped.has(cardId)) wrap.classList.add('flipped');
    wrap.append(front, back);
    wrap.appendChild(h('div', 'flip-hint', '↻'));
    wrap.title = 'クリックで裏返す（裏は基本ステータス）';
    wrap.onclick = () => { wrap.classList.toggle('flipped'); state.flipped = state.flipped || new Set(); wrap.classList.contains('flipped') ? state.flipped.add(cardId) : state.flipped.delete(cardId); };
    return wrap;
  }
  // 名声の書を1枚使って、カードの名声を上げる
  function useFameBook(n, targetId) {
    const item = 'fame_' + n;
    if (!save.collection[item]) return toast(`名声の書・${n}を持っていません`);
    if (fameFor(targetId) >= D.FAME_MAX) return toast('このカードの名声はすでに上限です');
    save.collection[item]--; if (!save.collection[item]) delete save.collection[item];
    save.fameBonus[targetId] = (save.fameBonus[targetId] || 0) + n;
    save = sanitize(save); persist(); renderDeck();
    toast(`${D.CARD_MAP[targetId].name} の名声が ${fameFor(targetId)} になりました`, 'info');
  }
  function renderMini(cardId, onClick) {
    const c = D.CARD_MAP[cardId];
    const d = h('div', 'card mini'); setElVars(d, c);
    D.elementsOf(c).forEach(e => d.appendChild(icon(e))); d.appendChild(h('span', '', esc(c.name)));
    attachTooltip(d, () => renderCard(cardId, { showRole: true }));
    if (onClick) d.onclick = (e) => { e.stopPropagation(); onClick(); };
    return d;
  }
  // info: { owner: 出した人の名前, target: 対象の名前 }
  // info.chained: チェイン中なら属性の色で光らせる
  function renderChip(cardId, info) {
    const c = D.CARD_MAP[cardId];
    const d = h('div', 'chip'); setElVars(d, c);
    D.elementsOf(c).forEach(e => d.appendChild(icon(e))); d.appendChild(h('b', '', c.cost));
    if (info && info.chained) { d.classList.add('chained'); d.title = 'チェイン中'; }
    if (info && info.owner) d.appendChild(h('u', '', esc(info.owner.replace(/^AI・/, '').slice(0, 1))));
    attachTooltip(d, () => {
      const wrap = h('div', 'tip-wrap');
      if (info) wrap.appendChild(h('div', 'tip-head', `${info.owner ? esc(info.owner) + ' の予約' : ''}${info.target ? `　→ ${esc(info.target)}` : ''}`));
      wrap.appendChild(renderCard(cardId, { showRole: true }));
      return wrap;
    });
    return d;
  }
  // 予約の対象の名前
  function targetName(b, card, rs) {
    if (card.target === 'enemy') return b.enemies[rs.target] ? b.enemies[rs.target].name : '';
    if (card.target === 'ally') return nameOfSlot(b, rs.target);
    return TARGET_TEXT[card.target];
  }
  // 各キャラ（敵・味方）が受ける予定の予約を集める
  function incomingReservations(b) {
    const inc = { e: {}, p: {} };
    for (const pl of b.players) for (const rs of pl.reserved) {
      const c = D.CARD_MAP[b.cards[rs.uid]];
      const add = (side, i) => ((inc[side][i] = inc[side][i] || []).push({ cardId: c.id, owner: pl.name }));
      if (c.target === 'enemy') add('e', rs.target);
      else if (c.target === 'allEnemies') b.enemies.forEach((e, i) => e.alive && add('e', i));
      else if (c.target === 'ally') add('p', rs.target);
      else if (c.target === 'allAllies') b.players.forEach(x => x.alive && add('p', x.slot));
      else add('p', pl.slot);
    }
    for (const pl of b.players) if (pl.selecting && pl.selecting.target != null) {
      const c = D.CARD_MAP[pl.selecting.cardId];
      if (c.target === 'enemy') (inc.e[pl.selecting.target] = inc.e[pl.selecting.target] || []).push({ cardId: c.id, owner: pl.name, ghost: true });
      if (c.target === 'allEnemies') b.enemies.forEach((e, i) => { if (e.alive) (inc.e[i] = inc.e[i] || []).push({ cardId: c.id, owner: pl.name, ghost: true }); });
      if (c.target === 'ally') (inc.p[pl.selecting.target] = inc.p[pl.selecting.target] || []).push({ cardId: c.id, owner: pl.name, ghost: true });
    }
    return inc;
  }
  // ホバー（タッチは長押し）でカード詳細を表示
  function attachTooltip(el, make) {
    const tip = $('tooltip');
    const open = (x, y) => { tip.innerHTML = ''; tip.appendChild(make()); tip.classList.remove('hidden'); place(x, y); };
    const place = (x, y) => { const r = tip.getBoundingClientRect(); tip.style.left = Math.min(window.innerWidth - r.width - 8, x + 14) + 'px'; tip.style.top = Math.max(8, y - r.height - 10) + 'px'; };
    el.addEventListener('mouseenter', (e) => open(e.clientX, e.clientY));
    el.addEventListener('mousemove', (e) => place(e.clientX, e.clientY));
    el.addEventListener('mouseleave', () => tip.classList.add('hidden'));
    let lp;
    el.addEventListener('touchstart', (e) => { const t = e.touches[0]; lp = setTimeout(() => open(t.clientX, t.clientY), 350); }, { passive: true });
    el.addEventListener('touchend', () => { clearTimeout(lp); setTimeout(() => tip.classList.add('hidden'), 1500); });
  }

  // ---------- タイトル ----------
  function initTitle() {
    $('in-name').value = save.name || '';
    if (params.get('room')) $('in-code').value = params.get('room').toUpperCase();
    const art = $('title-art').getContext('2d'); art.imageSmoothingEnabled = false;
    art.drawImage(S.background(320, 120, 3), 0, 0);
    D.ROLE_ORDER.forEach((r, i) => {
      const spr = S.heroSprite(r); const sc = spr.width > 20 ? 1 : 2; // 細かいドット絵は等倍、16ドットの絵は2倍
      art.drawImage(spr, 30 + i * 40 - spr.width * sc / 2, 112 - spr.height * sc, spr.width * sc, spr.height * sc);
    });
    const sl = S.slimeSprite('water'); art.save(); art.translate(300, 0); art.scale(-1, 1); art.drawImage(S.eagleSprite('wind'), 0, 8, 100, 80); art.restore();
    art.drawImage(sl, 184, 82, 40, 30);
    const needName = () => { const n = $('in-name').value.trim(); if (!n) { toast('なまえを入力してください'); return null; } save.name = n; persist(); return n; };
    $('btn-create').onclick = () => { const n = needName(); if (n) send({ type: 'create', name: n, timer: +$('in-timer').value, quests: save.quests, clears: save.clears }); };
    $('btn-join').onclick = () => { const n = needName(); const code = $('in-code').value.trim().toUpperCase(); if (!n) return; if (code.length !== 4) return toast('4文字のルームコードを入力してください'); send({ type: 'join', name: n, code, quests: save.quests, clears: save.clears }); };
    $('btn-deck').onclick = () => { openDeck(); };
    $('btn-save').onclick = () => {
      const total = Object.values(save.collection).reduce((a, n) => a + n, 0), kinds = Object.keys(save.collection).length;
      modal(`<h2>セーブデータ</h2>
        <p class="hint">所持カードとデッキは、このブラウザに自動で保存されています。ブラウザを閉じても、ゲームをアップデートしても残ります（ブラウザの閲覧データを消した場合や、別のブラウザ・別のURLで開いた場合は引き継がれません）。</p>
        <p>現在の所持：${kinds}種類・${total}枚</p>
        <h3>ファイルに保存</h3>
        <p class="hint">念のためのバックアップや、別のPCへの移動に使えます。</p>
        <div class="row"><button id="btn-export-file" class="btn primary">ファイルに書き出す</button><label class="btn">ファイルから読み込む<input id="in-import-file" type="file" accept=".json,application/json" hidden></label></div>
        <h3>引き継ぎコード</h3><p class="hint">コードをコピーして、移したい先で貼り付けることもできます。</p>
        <textarea id="save-out" readonly>${encodeSave()}</textarea><p class="hint">読み込む場合は、ここにコードを貼り付けて「読み込む」を押します（今のデータは上書きされます）。</p><textarea id="save-in"></textarea>`,
        [{ label: 'コピー', keep: true, onClick: () => { navigator.clipboard && navigator.clipboard.writeText($('save-out').value); toast('コピーしました', 'info'); } },
         { label: '読み込む', primary: true, onClick: () => { try { importSave($('save-in').value); $('in-name').value = save.name; toast('読み込みました', 'info'); } catch { toast('コードが正しくありません'); } } },
         { label: '閉じる' }]);
      $('btn-export-file').onclick = () => { exportSaveFile(); toast('セーブデータを書き出しました', 'info'); };
      $('in-import-file').onchange = (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (!confirmImport()) return;
        importSaveFile(f, (ok) => { if (ok) { $('in-name').value = save.name; toast('セーブデータを読み込みました', 'info'); closeModal(); } else toast('ファイルを読み込めませんでした'); });
      };
    };
    function confirmImport() { return window.confirm('今のセーブデータを、読み込むデータで上書きします。よろしいですか？'); }
  }

  // ---------- デッキ編集 ----------
  function openDeck() { show('deck'); renderDeck(); }
  function renderDeck() {
    $('deck-range').textContent = `ちょうど${D.DECK_SIZE}枚・同じカードは1枚まで・★代表カードはステータス2倍・カードをクリックで裏返し（裏で名声の書を使える）`;
    const tabs = $('deck-tabs'); tabs.innerHTML = '';
    D.ROLE_ORDER.forEach(r => { const b = h('button', 'btn' + (state.deckRole === r ? ' on' : ''), D.ROLES[r].name); b.onclick = () => { state.deckRole = r; renderDeck(); }; tabs.appendChild(b); });
    const role = state.deckRole, deck = save.decks[role];
    if (!deck.includes(save.leaders[role])) save.leaders[role] = deck[0];
    const leader = save.leaders[role];
    const owned = $('deck-owned'); owned.innerHTML = '';
    // 固有枠（デッキとは別。最大3枚）
    renderUniqueSlots(role);
    D.CARDS.filter(c => (c.role === role || c.role === 'any') && c.rarity !== 'unique' && save.collection[c.id]).sort((a, b) => (a.role === 'any') - (b.role === 'any')).forEach(c => {
      const inDeck = deck.includes(c.id);
      const it = h('div', 'owned-item' + (inDeck ? ' in' : ''));
      it.appendChild(flipCard(c.id, { leader: c.id === leader, fame: fameFor(c.id) }));
      const ctl = h('div', 'ctl');
      const tg = h('button', 'btn small' + (inDeck ? ' on' : ''), inDeck ? '✔ デッキに入っている' : 'デッキに入れる'); tg.onclick = () => toggle(c.id);
      tg.title = inDeck ? 'クリックでデッキから外す' : 'クリックでデッキに入れる';
      ctl.appendChild(tg);
      // 代表ボタンは常に表示して、カードの位置がずれないようにする
      const isLeader = c.id === leader;
      const lb = h('button', 'btn small' + (isLeader ? ' leader-on' : ''), isLeader ? '★ 代表カード' : '★ 代表にする');
      lb.disabled = isLeader || !inDeck;
      if (!inDeck) lb.title = 'デッキに入れると代表にできます';
      lb.onclick = () => { save.leaders[role] = c.id; persist(); renderDeck(); };
      ctl.appendChild(lb);
      it.appendChild(ctl); owned.appendChild(it);
    });
    const list = $('deck-list'); list.innerHTML = '';
    deck.slice().sort((a, b) => (b === leader) - (a === leader) || D.CARD_MAP[a].cost - D.CARD_MAP[b].cost).forEach(id => {
      const c = D.CARD_MAP[id];
      const row = h('div', 'dl-row'); row.style.boxShadow = `inset 4px 0 0 ${D.ELEMENTS[c.element].color}`;
      row.append(h('span', 'cost', c.cost), icon(c.element), h('span', '', (id === leader ? '★' : '') + esc(c.name)), h('span', 'n', `HP${c.stats.hp} 攻${c.stats.atk} 回${c.stats.heal}`));
      row.title = 'クリックでデッキから外す'; row.onclick = () => toggle(id);
      attachTooltip(row, () => renderCard(id, { leader: id === leader, fame: fameFor(id) }));
      list.appendChild(row);
    });
    const n = deck.length; const stt = D.deckStats(deck, leader);
    $('deck-count').innerHTML = `<span style="color:${n !== D.DECK_SIZE ? 'var(--danger)' : 'var(--ok)'}">${n}/${D.DECK_SIZE}枚</span>`;
    $('deck-stats').innerHTML = `HP <b>${stt.hp}</b>　攻撃力 <b>${stt.atk}</b>　回復力 <b>${stt.heal}</b><br><span class="hint">代表：${esc(D.CARD_MAP[leader] ? D.CARD_MAP[leader].name : '-')}（名声${fameFor(leader)}＝追加報酬の確率${fameFor(leader)}%）</span>`;
    function toggle(id) {
      const i = deck.indexOf(id);
      if (i >= 0) { deck.splice(i, 1); if (save.leaders[role] === id) save.leaders[role] = deck[0]; }
      else { if (deck.length >= D.DECK_SIZE) return toast(`デッキは${D.DECK_SIZE}枚までです。先に1枚外してください`); deck.push(id); }
      persist(); renderDeck();
    }
  }
  function renderUniqueSlots(role) {
    const box = $('deck-uniques'); box.innerHTML = '';
    const sel = save.uniques[role];
    const owned = D.CARDS.filter(c => c.rarity === 'unique' && c.role === role && save.collection[c.id]);
    owned.forEach(c => {
      const on = sel.includes(c.id);
      const it = h('div', 'owned-item' + (on ? ' in' : ''));
      it.appendChild(renderCard(c.id, {}));
      const ctl = h('div', 'ctl');
      const tg = h('button', 'btn small' + (on ? ' on' : ''), on ? '✔ 固有枠に入っている' : '固有枠に入れる');
      tg.onclick = () => {
        const i = sel.indexOf(c.id);
        if (i >= 0) { if (sel.length <= 1) return toast('固有カードは1枚以上入れてください'); sel.splice(i, 1); }
        else { if (sel.length >= D.UNIQUE_MAX) return toast(`固有枠は${D.UNIQUE_MAX}枚までです`); sel.push(c.id); }
        persist(); renderDeck();
      };
      ctl.appendChild(tg); it.appendChild(ctl); box.appendChild(it);
    });
    $('deck-unique-count').textContent = `${sel.length}/${D.UNIQUE_MAX}枚`;
  }
  $('btn-deck-back').onclick = () => { if (state.room) { show('room'); renderRoom(); } else show('title'); };
  // ---- 名声カードを使う ----
  if ($('btn-use-fame')) $('btn-use-fame').onclick = () => {
    const items = D.CARDS.filter(c => c.rarity === 'item' && save.collection[c.id]);
    if (!items.length) return toast('名声カードを持っていません（勝利報酬で手に入ります）');
    const targets = D.CARDS.filter(c => save.collection[c.id] && c.rarity !== 'item');
    const opt = (c) => `<option value="${c.id}">${esc(D.ROLES[c.role] ? D.ROLES[c.role].name : '')}：${esc(c.name)}（名声${fameFor(c.id)}）</option>`;
    modal(`<h2>名声カードを使う</h2><p class="hint">選んだカードの名声が上がります（上限${D.FAME_MAX}）。代表カードの名声1につき1%の確率で、勝利時に追加報酬がもらえます。使った名声カードはなくなります。</p>
      <div class="row"><label>使うカード <select id="fame-item">${items.map(c => `<option value="${c.id}">${esc(c.name)}（名声+${c.fameValue}・所持${save.collection[c.id]}枚）</option>`).join('')}</select></label></div>
      <div class="row"><label>名声を上げるカード <select id="fame-target">${targets.map(opt).join('')}</select></label></div>`,
      [{ label: '使う', primary: true, onClick: () => {
        const item = D.CARD_MAP[$('fame-item').value], tid = $('fame-target').value;
        if (!item || !save.collection[item.id] || !D.CARD_MAP[tid]) return;
        if (fameFor(tid) >= D.FAME_MAX) return toast('このカードの名声はすでに上限です');
        save.collection[item.id]--; if (!save.collection[item.id]) delete save.collection[item.id];
        save.fameBonus[tid] = (save.fameBonus[tid] || 0) + item.fameValue;
        save = sanitize(save); persist(); renderDeck();
        toast(`${D.CARD_MAP[tid].name} の名声が ${fameFor(tid)} になりました`, 'info');
      } }, { label: 'やめる' }]);
    const leader = save.leaders[state.deckRole]; if (leader) $('fame-target').value = leader;
  };
  $('btn-deck-reset').onclick = () => { save.decks[state.deckRole] = D.STARTER[state.deckRole].slice(); save.leaders[state.deckRole] = D.STARTER[state.deckRole][0]; persist(); renderDeck(); };

  // ---------- ルーム ----------
  function renderRoom() {
    const room = state.room; if (!room) return;
    $('room-code').textContent = room.code;
    const mySlot = room.slots.findIndex(s => s && s.playerId === playerId);
    const me = room.slots[mySlot];
    const isHost = room.hostId === playerId;
    const slots = $('room-slots'); slots.innerHTML = '';
    room.slots.forEach((s, i) => {
      const row = h('div', 'slot' + (i === mySlot ? ' me' : ''));
      if (s) {
        row.appendChild(s.role ? heroCanvas(s.role) : h('canvas'));
        row.appendChild(h('div', 'nm', `${esc(s.name)}${room.hostId === s.playerId ? ' 👑' : ''}<div class="rl">${s.role ? D.ROLES[s.role].name + (s.leader ? `（代表：${esc(D.CARD_MAP[s.leader].name)}・名声${s.fame}）` : '') : '役職を選択中…'}</div>`));
        if (!s.connected) row.appendChild(h('span', 'off', '切断中'));
      } else row.appendChild(h('div', 'nm', '<span class="hint">空き（開始時にAIが入ります）</span>'));
      slots.appendChild(row);
    });
    const pick = $('role-pick'); pick.innerHTML = '';
    D.ROLE_ORDER.forEach(r => {
      const takenBy = room.slots.find((s, i) => s && i !== mySlot && s.role === r);
      const b = h('button', 'btn role-btn' + (me && me.role === r ? ' on' : ''));
      b.appendChild(heroCanvas(r));
      b.appendChild(h('div', '', `${D.ROLES[r].name}<small>${D.ROLES[r].sub}</small>${takenBy ? `<small>（${esc(takenBy.name)}が選択中）</small>` : ''}`));
      b.disabled = !!takenBy;
      b.onclick = () => {
        if (me && me.role === r) return send({ type: 'setRole', role: null });
        const deck = save.decks[r]; const leader = save.leaders[r];
        if (deck.length !== D.DECK_SIZE || !deck.includes(leader)) return toast(`デッキが${D.DECK_SIZE}枚ではありません。デッキ編集で直してください`);
        send({ type: 'setRole', role: r, deck, leader, fame: fameFor(leader), uniques: save.uniques[r] });
      };
      pick.appendChild(b);
    });
    const deckBtn = h('button', 'btn small', 'デッキ編集'); deckBtn.onclick = () => { if (me && me.role) state.deckRole = me.role; openDeck(); };
    pick.appendChild(deckBtn);
    const st = D.STAGES.find(s => s.id === room.stageId);
    const sel = $('room-stage'); sel.innerHTML = '';
    D.STAGES.forEach(sg => { const o = document.createElement('option'); o.value = sg.id; o.textContent = sg.name + (sg.recommended ? `（${sg.recommended}）` : ''); sel.appendChild(o); });
    sel.value = room.stageId; sel.disabled = !isHost;
    fillStarSelect($('room-star'), room, isHost);
    $('stage-info').innerHTML = `<b>${esc(st.name)}</b> <span class="star-badge">${starText(room.star)}</span>
      <p class="hint">${dangerDesc(room.star, room.stageId)}</p>`;
    renderRoomQuests(room);
    $('room-timer').value = String(room.timer); $('room-timer').disabled = !isHost;
    const ready = room.slots.every(s => !s || s.role);
    if (room.inBattle && room.ended) {
      // 途中参加：ほかのメンバーが結果画面を見ている間に役職を選んで「準備OK」を押し、「もう一度」で一緒に出発する
      const meReady = room.retry.includes(playerId);
      $('btn-start').textContent = meReady ? '準備OK（取り消す）' : '準備OK';
      $('btn-start').disabled = !me || !me.role;
      $('start-hint').textContent = 'ほかのメンバーが戦闘結果を見ています。役職を選んで「準備OK」を押し、全員が「もう一度」を押すと一緒に出発します。';
    } else {
      $('btn-start').textContent = '戦闘開始';
      $('btn-start').disabled = !isHost || !ready;
      $('start-hint').textContent = !isHost ? 'ホストが開始するのを待っています' : ready ? '準備OK！' : '全員が役職を選ぶと開始できます';
    }
  }
  $('room-timer').onchange = () => send({ type: 'setTimer', timer: +$('room-timer').value });
  $('room-stage').onchange = () => send({ type: 'setStage', stageId: $('room-stage').value });
  $('room-star').onchange = () => send({ type: 'setStar', star: +$('room-star').value });
  const starText = (n) => '★'.repeat(n) + '☆'.repeat(D.STAR_MAX - n);
  // 危険度の選択肢（ホストのセーブで解放されている★まで）
  function fillStarSelect(el, room, isHost) {
    el.innerHTML = '';
    for (let n = 1; n <= D.STAR_MAX; n++) { const o = document.createElement('option'); o.value = n; o.textContent = `★${n}${n > room.maxStar ? '（未解放）' : ''}`; o.disabled = n > room.maxStar; el.appendChild(o); }
    el.value = String(room.star); el.disabled = !isHost;
  }
  function dangerDesc(star, stageId) {
    if (star <= 1) return '危険度★1：通常の強さ。クリアすると★2が解放されます。';
    const dg = D.dangerFor(star, stageId);
    const cur = dg.curse.map(c => `${D.STATUS[c.status].name}${c.value}`).join('・');
    return `危険度★${star}：敵の強化が×${dg.buff}。敵の攻撃が当たると${cur}（${dg.curse[0].turns}ターン）。${star < D.STAR_MAX ? `クリアすると★${star + 1}が解放されます。` : ''}`;
  }
  // 依頼（ルームにいる全員分）
  function questLine(q) { return `<span class="q-diff ${q.diff}">${D.QUEST_DIFF_NAME[q.diff]}</span>${esc(D.questText(q))}<span class="q-rw">${q.diff === 'hard' ? 'レア確定' : esc(D.CARD_MAP[D.QUEST_REWARD[q.diff].id].name)}</span>`; }
  function renderRoomQuests(room) {
    const box = $('room-quests'); box.innerHTML = '';
    room.slots.forEach(s => {
      if (!s) return;
      const qs = s.playerId === playerId ? save.quests : (s.quests || []);
      const d = h('div', 'quest-who' + (s.playerId === playerId ? ' me' : ''), `<b>${esc(s.name)}</b>`);
      const ul = h('ul', 'quests'); qs.forEach(q => ul.appendChild(h('li', '', questLine(q))));
      d.appendChild(ul); box.appendChild(d);
    });
  }
  $('btn-start').onclick = () => {
    const room = state.room; if (!room) return;
    if (room.inBattle && room.ended) send({ type: 'retry', value: !room.retry.includes(playerId), ...profilePayload() });
    else send({ type: 'start' });
  };
  $('btn-room-leave').onclick = () => { send({ type: 'leave' }); state.room = null; show('title'); };
  $('btn-copy').onclick = () => {
    const url = `${location.origin}${location.pathname}?room=${state.room.code}`;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('招待リンクをコピーしました', 'info')).catch(() => modal(`<p>このリンクを友達に送ってください</p><textarea readonly>${url}</textarea>`));
  };

  // ---------- サーバーからのメッセージ ----------
  function onMessage(m) {
    if (m.type === 'error') return toast(m.msg);
    if (m.type === 'lobby') { if (state.screen === 'room' || state.screen === 'battle') { state.room = null; state.battle = null; show('title'); } return; }
    if (m.type === 'left') return;
    if (m.type === 'room') {
      const wasInBattle = state.screen === 'battle' && state.battle;
      state.room = m.room;
      if (m.room.inBattle && m.room.ended) renderRetry();
      renderRetreat();
      if (wasInBattle && !m.room.inBattle && m.room.lastRetreat && Date.now() - m.room.lastRetreat < 5000) toast('撤退しました（報酬は持ち帰れません）', 'info');
      // 戦闘に参加していない人（結果画面中に途中参加した人）はルーム画面で待つ
      if (!m.room.inBattle || !(m.room.members || []).includes(playerId)) {
        state.battle = null; state.view = null; state.anim = []; state.animating = false;
        if (state.screen !== 'deck') { closeModal(); show('room'); }
        renderRoom();
        history.replaceState(null, '', `?room=${m.room.code}`);
      }
      return;
    }
    if (m.type === 'battle') return onBattle(m);
  }

  // ---------- 戦闘 ----------
  const scene = $('scene'), sctx = scene.getContext('2d');
  sctx.imageSmoothingEnabled = false;
  let bg = null;
  const SW = 320, SH = 180, GROUND = 152;
  const fx = { units: {}, particles: [], shake: 0, pillars: [], flash: 0 };

  function onBattle(m) {
    // 「もう一度」で新しい戦闘が始まったら、前の戦闘の表示をリセットする
    if (state.battle && state.battle.id !== m.battle.id) {
      state.battle = null; state.view = null; state.anim = []; state.animating = false; state.resultFor = null;
      fx.units = {}; fx.particles = []; fx.pillars = []; closeModal(); show('battle');
      state.logLines = []; $('log').innerHTML = '';
    }
    const first = !state.battle;
    state.battle = m.battle; state.slot = m.slot; state.deadline = m.deadline;
    if (state.screen !== 'battle') { show('battle'); state.logLines = []; $('log').innerHTML = ''; }
    if (first || !state.view) { state.view = clone(m.battle); bg = bg || S.background(SW, SH, 11); logLine(`【${m.battle.stageName}】戦闘開始！`); const boss = m.battle.enemies.find(e => !e.part); if (boss && m.battle.turn === 1 && !m.events) banner(`⚠ ${esc(boss.name)} 出現 ⚠`, 1800); }
    if (m.events && m.events.length) {
      state.targeting = null;
      state.anim.push(...m.events.map(e => ({ ...e })));
      if (!state.animating) runAnim();
    } else if (!state.animating) {
      state.view = clone(m.battle); renderBattleUI();
      // 再接続したときなど、演出なしで戦闘の終了を受け取った場合
      if ((m.battle.phase === 'victory' || m.battle.phase === 'defeat') && state.resultFor !== m.battle.id) showResult();
    }
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function unitPos(side, i, view) {
    const v = view || state.view;
    if (side === 'p') {
      const idx = v.players.findIndex(p => p.slot === i);
      const pl = v.players[idx]; const spr = pl && (heroCache[pl.role] || (heroCache[pl.role] = S.heroSprite(pl.role)));
      const sc = spr && spr.width > 20 ? 1 : 2;
      return { x: 30 + idx * 42, y: GROUND, w: spr ? spr.width * sc : 32, hgt: spr ? spr.height * sc : 36 };
    }
    const es = v.enemies; const e = es[i]; if (!e) return { x: 250, y: GROUND, w: 40, hgt: 30 };
    if (e.sprite === 'eagle') return { x: 268, y: GROUND + 4, w: 96, hgt: 76 };
    if (e.sprite === 'dragon') return { x: 252, y: GROUND + 6, w: 128, hgt: 88 };
    const edef = D.ENEMIES[e.defId];
    if (e.part && edef.anchor && es[e.parent]) {
      // 本体のドット絵の上の位置（右向きで定義、表示は左右反転）
      const pp = unitPos('e', e.parent, v); const sc = pp.w / 64; const a = edef.anchor;
      const x0 = pp.x - pp.w / 2 + (64 - (a.x + a.w)) * sc, y0 = pp.y - pp.hgt + a.y * sc;
      return { x: x0 + a.w * sc / 2, y: y0 + a.h * sc, w: a.w * sc, hgt: a.h * sc };
    }
    if (e.part) {
      const k = es.filter((x, j) => x.part && x.parent === e.parent && j < i).length;
      return k === 0 ? { x: 206, y: 98, w: 20, hgt: 24 } : { x: 206, y: GROUND - 2, w: 20, hgt: 24 };
    }
    const mains = es.filter(x => !x.part); const mi = mains.indexOf(e); const n = mains.length;
    const x = n === 1 ? 250 : 214 + mi * (72 / Math.max(1, n - 1));
    return { x, y: GROUND, w: 48, hgt: 36 };
  }
  function fxOf(side, i) { const k = side + i; return (fx.units[k] = fx.units[k] || { lunge: 0, flash: 0, die: 0 }); }

  const enemyCache = {};
  function enemySprite(e) {
    const k = e.sprite + e.element;
    if (!enemyCache[k]) enemyCache[k] = e.sprite === 'dragon' ? S.dragonSprite(e.element) : e.sprite === 'eagle' ? S.eagleSprite(e.element) : e.sprite === 'crystal' ? S.crystalSprite(e.element) : S.slimeSprite(e.element);
    return enemyCache[k];
  }
  function whiteVersion(cv) {
    if (cv._white) return cv._white;
    const w = document.createElement('canvas'); w.width = cv.width; w.height = cv.height;
    const c = w.getContext('2d'); c.drawImage(cv, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = '#fff'; c.fillRect(0, 0, w.width, w.height);
    return (cv._white = w);
  }

  function tintVersion(cv, color) {
    cv._tint = cv._tint || {};
    if (cv._tint[color]) return cv._tint[color];
    const w = document.createElement('canvas'); w.width = cv.width; w.height = cv.height;
    const c = w.getContext('2d'); c.drawImage(cv, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = color; c.fillRect(0, 0, w.width, w.height);
    return (cv._tint[color] = w);
  }
  function drawScene(t) {
    const v = state.view;
    if (state.screen !== 'battle' || !v) return;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    let sx = 0, sy = 0;
    if (fx.shake > 0) { sx = Math.round((Math.random() - .5) * fx.shake); sy = Math.round((Math.random() - .5) * fx.shake); fx.shake *= 0.85; if (fx.shake < 0.5) fx.shake = 0; }
    sctx.translate(sx, sy);
    sctx.drawImage(bg, 0, 0);
    // 味方
    v.players.forEach(p => {
      const pos = unitPos('p', p.slot); const f = fxOf('p', p.slot);
      const spr = heroCache[p.role] || (heroCache[p.role] = S.heroSprite(p.role));
      const bob = p.alive ? Math.round(Math.sin(t / 380 + p.slot) * 1) : 0;
      const lx = f.lunge > 0 ? Math.round(Math.sin(f.lunge * Math.PI) * 10) : 0;
      f.lunge = Math.max(0, f.lunge - 0.06);
      const x = Math.round(pos.x - pos.w / 2 + lx), y = pos.y - pos.hgt + bob;
      sctx.fillStyle = 'rgba(0,0,0,.35)'; sctx.fillRect(pos.x - 12, pos.y - 1, 24, 3);
      sctx.globalAlpha = p.alive ? 1 : 0.35;
      if (!p.alive) { sctx.save(); sctx.translate(x + pos.w / 2, pos.y - 6); sctx.rotate(-Math.PI / 2); sctx.drawImage(spr, -pos.hgt / 2, -pos.w / 2, pos.hgt, pos.w); sctx.restore(); }
      else sctx.drawImage(f.flash > 0 ? whiteVersion(spr) : spr, x, y, pos.w, pos.hgt);
      f.flash = Math.max(0, f.flash - 1);
      sctx.globalAlpha = 1;
    });
    // 敵（左向きに反転）
    v.enemies.forEach((e, i) => {
      const pos = unitPos('e', i); const f = fxOf('e', i);
      if (e.sprite === 'none') return; // 本体のレイヤーとして描く部位
      if (!e.alive) { if (f.die >= 1) return; f.die = Math.min(1, f.die + 0.03); }
      const sprAll = enemySprite(e);
      const spr = e.sprite === 'dragon' ? sprAll.body : sprAll;
      const bob = e.alive ? Math.round(Math.sin(t / (e.sprite === 'eagle' ? 260 : 420) + i * 2) * (e.sprite === 'eagle' ? 2 : 1)) : 0;
      const lx = f.lunge > 0 ? -Math.round(Math.sin(f.lunge * Math.PI) * 14) : 0;
      f.lunge = Math.max(0, f.lunge - 0.05);
      const x = Math.round(pos.x - pos.w / 2 + lx), y = pos.y - pos.hgt + bob;
      sctx.fillStyle = 'rgba(0,0,0,.35)'; sctx.fillRect(pos.x - pos.w * 0.35, pos.y - 1, pos.w * 0.7, 3);
      sctx.save(); sctx.globalAlpha = e.alive ? 1 : 1 - f.die;
      sctx.translate(x + pos.w, y); sctx.scale(-1, 1);
      // 属性のオーラ
      if (e.alive && e.boss) {
        const aura = tintVersion(spr, D.ELEMENTS[e.element].color);
        sctx.globalAlpha = 0.35 + Math.sin(t / 200) * 0.15;
        [[-2, 0], [2, 0], [0, -2], [0, 2]].forEach(([ox, oy]) => sctx.drawImage(aura, ox, oy, pos.w, pos.hgt));
        sctx.globalAlpha = 1;
      }
      if (e.sprite === 'dragon') {
        // 部位レイヤー：棘（奥）→ 本体 → 左足（手前）。壊れた部位はフェードして消える
        const layerOf = (name) => { const pi = v.enemies.findIndex(x => x.part && x.parent === i && D.ENEMIES[x.defId].layer === name); return pi < 0 ? null : { pi, part: v.enemies[pi] }; };
        const drawLayer = (name) => {
          const L = layerOf(name); if (!L) return;
          const pf = fxOf('e', L.pi);
          if (!L.part.alive) { if (pf.die >= 1) return; pf.die = Math.min(1, pf.die + 0.04); }
          sctx.save(); sctx.globalAlpha *= L.part.alive ? 1 : 1 - pf.die;
          const img = sprAll[name]; sctx.drawImage(pf.flash > 0 ? whiteVersion(img) : img, 0, 0, pos.w, pos.hgt);
          sctx.restore(); pf.flash = Math.max(0, pf.flash - 1);
        };
        drawLayer('spikes');
        sctx.drawImage(f.flash > 0 ? whiteVersion(spr) : spr, 0, 0, pos.w, pos.hgt);
        drawLayer('leg');
      } else sctx.drawImage(f.flash > 0 ? whiteVersion(spr) : spr, 0, 0, pos.w, pos.hgt);
      sctx.restore();
      f.flash = Math.max(0, f.flash - 1);
    });
    // レアドロップの光の柱
    fx.pillars = fx.pillars.filter(pl => pl.life > 0);
    fx.pillars.forEach(pl => {
      const a = Math.min(1, pl.life / 40), wgrow = Math.min(1, (90 - pl.life) / 12);
      const w = Math.round(18 * wgrow);
      sctx.globalAlpha = 0.45 * a; sctx.fillStyle = '#ffd84a'; sctx.fillRect(Math.round(pl.x - w / 2), 0, w, pl.y);
      sctx.globalAlpha = 0.8 * a; sctx.fillStyle = '#fff6c2'; sctx.fillRect(Math.round(pl.x - w / 6), 0, Math.max(1, Math.round(w / 3)), pl.y);
      sctx.globalAlpha = 1;
      if (pl.life % 3 === 0) fx.particles.push({ x: pl.x + (Math.random() - .5) * 18, y: pl.y - Math.random() * pl.y, vx: 0, vy: -0.6, life: 25, c: Math.random() > .5 ? '#ffd84a' : '#ffffff', s: 1 });
      pl.life--;
    });
    // パーティクル
    fx.particles = fx.particles.filter(pt => pt.life > 0);
    fx.particles.forEach(pt => { pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.08; pt.life--; sctx.fillStyle = pt.c; sctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.s, pt.s); });
    if (fx.flash > 0) { sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.globalAlpha = fx.flash; sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, SW, SH); sctx.globalAlpha = 1; fx.flash = Math.max(0, fx.flash - 0.04); }
  }
  function burst(x, y, color, n = 14) {
    for (let k = 0; k < n; k++) fx.particles.push({ x, y, vx: (Math.random() - .5) * 3, vy: -Math.random() * 2.5, life: 20 + Math.random() * 20, c: Math.random() > .3 ? color : '#ffffff', s: Math.random() > .7 ? 2 : 1 });
  }
  function loop(t) { drawScene(t); updateTimer(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);

  // オーバーレイ（HPバーなど）をキャンバスに重ねる
  function layoutOverlay() {
    const wrap = $('scene-wrap').getBoundingClientRect();
    const r = scene.getBoundingClientRect();
    const ov = $('overlay');
    ov.style.left = (r.left - wrap.left) + 'px'; ov.style.top = (r.top - wrap.top) + 'px';
    ov.style.width = r.width + 'px'; ov.style.height = r.height + 'px';
  }
  window.addEventListener('resize', layoutOverlay);
  const toPx = (lx, ly) => { const r = scene.getBoundingClientRect(); return { x: lx / SW * r.width, y: ly / SH * r.height }; };

  function syncCountsView(b) {
    const counts = {}; D.ELEMENT_ORDER.forEach(e => (counts[e] = 0));
    b.players.forEach(p => { if (!p.alive) return; new Set(p.reserved.flatMap(r => D.elementsOf(D.CARD_MAP[b.cards[r.uid]]))).forEach(e => counts[e]++); });
    return counts;
  }
  function elementSetsView(b) { return b.players.filter(p => p.alive).map(p => new Set(p.reserved.flatMap(r => D.elementsOf(D.CARD_MAP[b.cards[r.uid]])))); }
  function chainCountView(b, card) { return D.chainCountFor(card, elementSetsView(b)); }
  const multOf = (n) => D.SYNC_MULT[Math.min(n, 4)] || 1;
  const nameOfSlot = (b, slot) => { const p = b.players.find(x => x.slot === slot); return p ? p.name : '?'; };

  function renderBattleUI() {
    const b = state.battle, v = state.view; if (!b || !v) return;
    layoutOverlay();
    $('b-stage').textContent = `${b.stageName} ★${b.star || 1}`;
    $('b-turn').textContent = `ターン ${v.turn}`;
    const planning = !state.animating && b.phase === 'planning';
    const me = b.players.find(p => p.slot === state.slot);
    const counts = syncCountsView(v);

    // ---- オーバーレイ ----
    const ov = $('units'); ov.innerHTML = '';
    const incoming = incomingReservations(b);
    const r = scene.getBoundingClientRect();
    v.players.forEach(p => {
      const pos = unitPos('p', p.slot); const top = toPx(pos.x, pos.y - pos.hgt - 2);
      const u = h('div', 'unit ally' + (p.alive ? '' : ' dead'));
      u.style.left = top.x + 'px'; u.style.bottom = (r.height - top.y) + 'px';
      const res = h('div', 'u-res');
      const src = state.animating ? state.view : b;
      (state.animating ? p : (b.players.find(x => x.slot === p.slot) || p)).reserved.forEach(rs => {
        const c = D.CARD_MAP[src.cards[rs.uid]];
        res.appendChild(renderChip(src.cards[rs.uid], { owner: p.name, target: targetName(src, c, rs), chained: chainCountView(src, c) >= 2 }));
      });
      const selP = !state.animating && b.players.find(x => x.slot === p.slot);
      if (planning && selP && selP.selecting) {
        const sc = D.CARD_MAP[selP.selecting.cardId];
        const tn = selP.selecting.target != null ? targetName(b, sc, { target: selP.selecting.target }) : '対象を選択中';
        const g = renderChip(sc.id, { owner: p.name + '（検討中）', target: tn }); g.classList.add('ghost'); res.appendChild(g);
      }
      u.appendChild(res);
      const bp = b.players.find(x => x.slot === p.slot);
      if (planning && bp && bp.alive) u.appendChild(h('div', 'u-ok', bp.confirmed ? '✔ 確定' : '…考え中'));
      u.appendChild(h('div', 'u-name', `${p.slot === state.slot ? '★' : ''}${esc(p.name)}`));
      u.appendChild(h('div', 'u-role', D.ROLES[p.role].name));
      u.appendChild(bar(p.hp, p.maxHp));
      u.appendChild(gaugeBar(p.gauge || 0, p.gaugeMax || D.GAUGE_MAX));
      const st = h('div', 'u-status');
      statusTags(p.status).forEach(x => st.appendChild(x));
      u.appendChild(st);
      ov.appendChild(u);
      hitbox(ov, 'p', p.slot, pos, p.alive);
    });
    v.enemies.forEach((e, i) => {
      if (!e.alive && fxOf('e', i).die >= 1) return;
      const pos = unitPos('e', i); const edef = D.ENEMIES[e.defId];
      let top = toPx(pos.x, pos.y - pos.hgt - 2);
      if (edef.infoAnchor) { const sc = pos.w / 64; top = toPx(pos.x - pos.w / 2 + (64 - edef.infoAnchor.x) * sc, pos.y - pos.hgt + edef.infoAnchor.y * sc - 2); }
      const u = h('div', 'unit enemy' + (e.alive ? '' : ' dead') + (edef.infoBelow ? ' below' : ''));
      u.style.left = top.x + 'px';
      if (edef.infoBelow) u.style.top = toPx(pos.x, GROUND + 3).y + 'px'; else u.style.bottom = (r.height - top.y) + 'px';
      if (edef.infoBelow) {
        // 足元に置く部位は2行にまとめて表示（画面下で切れないように）
        const r1 = h('div', 'below-row');
        if (e.alive && e.intent) r1.appendChild(intentEl(e, v));
        const elB2 = h('span', 'el-badge'); elB2.appendChild(icon(e.element));
        const nm2 = h('span', 'u-name', esc(e.name) + ' '); nm2.appendChild(elB2); nm2.title = `部位・防御${e.def}・弱点:${D.ELEMENTS[D.weaknessOf(e.element)].name}`;
        r1.appendChild(nm2);
        const r2 = h('div', 'below-row'); r2.appendChild(bar(e.hp, e.maxHp));
        const st2 = h('div', 'u-status'); statusTags(e.status).forEach(x => st2.appendChild(x));
        if (e.atkBonus) st2.appendChild(h('span', 'bad', `攻+${e.atkBonus}`));
        r2.appendChild(st2);
        if (planning && incoming.e[i]) incoming.e[i].forEach(x => { const ch = renderChip(x.cardId, { owner: x.owner + (x.ghost ? '（検討中）' : ''), target: e.name }); if (x.ghost) ch.classList.add('ghost'); r2.appendChild(ch); });
        u.append(r1, r2); ov.appendChild(u); hitbox(ov, 'e', i, pos, e.alive); return;
      }
      if (e.alive && e.intent) u.appendChild(intentEl(e, v));
      if (e.alive && e.doomIn && e.doomIn > 1) {
        const ult = D.ENEMIES[e.defId].pattern.find(a => a.type === 'ultimate');
        u.appendChild(h('div', 'doom-tag', `${esc(ult.name)}まで あと${e.doomIn}ターン`));
      }
      const elB = h('span', 'el-badge'); elB.appendChild(icon(e.element)); elB.appendChild(h('span', '', D.ELEMENTS[e.element].name));
      const nm = h('div', 'u-name', esc(e.name) + ' '); nm.appendChild(elB);
      nm.appendChild(h('span', 'weak-tag', ` 弱点:${D.ELEMENTS[D.weaknessOf(e.element)].name}`));
      u.appendChild(nm);
      const sub = [];
      if (e.part) sub.push('部位');
      if (e.def) sub.push(`防御${e.def}`);
      if (e.atkBonus) sub.push(`<span style="color:#ff8a8a">攻撃力+${e.atkBonus}</span>`);
      if (sub.length) u.appendChild(h('div', 'u-role', sub.join('・')));
      u.appendChild(bar(e.hp, e.maxHp));
      const st = h('div', 'u-status');
      statusTags(e.status).forEach(x => st.appendChild(x));
      if (planning && incoming.e[i]) {
        const row = h('div', 'u-incoming'); row.appendChild(h('span', 'lbl', '狙い'));
        incoming.e[i].forEach(x => { const ch = renderChip(x.cardId, { owner: x.owner + (x.ghost ? '（検討中）' : ''), target: e.name }); if (x.ghost) ch.classList.add('ghost'); row.appendChild(ch); });
        u.appendChild(row);
      }
      u.appendChild(st);
      ov.appendChild(u);
      hitbox(ov, 'e', i, pos, e.alive);
    });

    // ---- 属性チェイン表示 ----
    const sb = $('sync-bar'); sb.innerHTML = '';
    D.ELEMENT_ORDER.forEach(el => {
      const n = counts[el];
      const d = h('div', 'sync' + (n >= 2 ? ' lv' + Math.min(n, 4) : '')); d.style.setProperty('--el', D.ELEMENTS[el].color);
      d.appendChild(icon(el)); d.appendChild(h('span', '', D.ELEMENTS[el].name));
      const pips = h('div', 'pips'); for (let k = 0; k < 4; k++) pips.appendChild(h('i', k < n ? 'on' : ''));
      d.appendChild(pips); d.appendChild(h('span', 'm', '×' + multOf(n)));
      d.title = `${D.ELEMENTS[el].name}属性のチェイン：${n}人`;
      sb.appendChild(d);
    });

    // ---- 手札 ----
    const hand = $('hand'); hand.innerHTML = '';
    $('my-reserved').innerHTML = '';
    if (me) {
      $('energy-orb').innerHTML = state.animating ? '-' : `${me.energy}<small>/${me.maxEnergy}</small>`;
      const atkNow = me.atk + sumSt(me, 'atkUp');
      const extra = [];
      if (sumSt(me, 'dmgUp')) extra.push(`与ダメ+${sumSt(me, 'dmgUp')}`);
      if (sumSt(me, 'healUp')) extra.push(`回復量+${sumSt(me, 'healUp')}`);
      if (sumSt(me, 'critUp')) extra.push(`会心${Math.min(100, sumSt(me, 'critUp'))}%`);
      $('me-stats').innerHTML = `HP ${me.hp}/${me.maxHp}<br>攻撃力 ${atkNow}　回復力 ${me.heal}${extra.length ? '<br>' + extra.join('　') : ''}`;
      state.handCtx = { atk: atkNow, heal: me.heal, dmgUp: sumSt(me, 'dmgUp'), healUp: sumSt(me, 'healUp') };
      const myEls = new Set(me.reserved.map(rs => D.CARD_MAP[b.cards[rs.uid]].element));
      if (!state.animating) {
        me.hand.forEach(uid => {
          const cid = b.cards[uid], c = D.CARD_MAP[cid];
                    const can = planning && me.alive && !me.confirmed && c.cost <= me.energy;
          // 表示はチェインなし（×1.0）の数値。チェインの倍率は下の属性チェイン表示で確認する
          const card = renderCard(cid, { mult: 1, count: null, disabled: !can, onClick: () => can && pickCard(uid), ctx: { ...state.handCtx, element: c.element, elements: D.elementsOf(c) } });
          if (state.targeting && state.targeting.uid === uid) { card.classList.add('selected'); state.targeting.el = card; state.targeting.mult = 1; state.targeting.count = 0; }
          hand.appendChild(card);
        });
        // 固有カード（手札とは別の領域）
        const ua = $('unique-area'); ua.innerHTML = '';
        const full = (me.gauge || 0) >= (me.gaugeMax || D.GAUGE_MAX);
        const uqUsed = me.reserved.some(rs => (me.uniques || []).includes(rs.uid));
        ua.appendChild(h('div', 'ua-head', `固有カード <span class="${full ? 'full' : ''}">${full ? '使用可能！' : `ゲージ ${me.gauge || 0}/${me.gaugeMax || D.GAUGE_MAX}`}</span>`));
        const row = h('div', 'ua-cards');
        (me.uniques || []).forEach(uid => {
          const cid = b.cards[uid], c = D.CARD_MAP[cid];
          const reservedNow = me.reserved.some(rs => rs.uid === uid);
          const can = planning && me.alive && !me.confirmed && full && !uqUsed && c.cost <= me.energy;
          const card = renderCard(cid, { mult: 1, disabled: !can, onClick: () => can && pickCard(uid), ctx: { ...state.handCtx, element: c.element, elements: D.elementsOf(c) } });
          card.classList.add('unique-card'); if (full && !uqUsed) card.classList.add('active'); if (reservedNow) card.classList.add('reserved');
          if (state.targeting && state.targeting.uid === uid) { card.classList.add('selected'); state.targeting.el = card; state.targeting.mult = 1; state.targeting.count = 0; }
          row.appendChild(card);
        });
        ua.appendChild(row);
        me.reserved.forEach(rs => {
          const c = D.CARD_MAP[b.cards[rs.uid]];
          const tgt = c.target === 'enemy' ? ` → ${b.enemies[rs.target] ? b.enemies[rs.target].name : ''}` : c.target === 'ally' ? ` → ${nameOfSlot(b, rs.target)}` : '';
          const mini = renderMini(b.cards[rs.uid], () => { if (planning && !me.confirmed) send({ type: 'unreserve', uid: rs.uid }); });
          mini.title = 'クリックで予約を取り消す' + tgt;
          $('my-reserved').appendChild(mini);
        });
      }
      $('pile-info').textContent = state.animating ? '' : `手札 ${me.hand.length}／山札 ${me.drawPile.length}／捨て札 ${me.discard.length}`;
      const btn = $('btn-confirm');
      btn.disabled = !planning || !me.alive;
      btn.textContent = me.confirmed ? '確定を解除' : '確定';
      btn.className = 'btn big ' + (me.confirmed ? 'on' : 'primary');
      const humans = b.players.filter(p => !p.isAI && p.alive);
      $('confirm-info').textContent = planning ? `確定 ${humans.filter(p => p.confirmed).length}/${humans.length}人` : state.animating ? '行動中…' : '';
      if (!me.alive && planning) $('confirm-info').textContent = '戦闘不能… 仲間を応援しよう';
    }
    $('target-hint').classList.toggle('hidden', !state.targeting);
    if (state.targeting) $('target-hint').textContent = state.targeting.card.target === 'allEnemies' ? '敵をクリック（全体攻撃なので、どの敵を選んでも全体に当たります）' : state.targeting.card.target === 'enemy' ? '対象の敵をクリック（右クリック/Escで取り消し）' : '対象の味方をクリック（右クリック/Escで取り消し）';
  }
  // 固有ゲージ（青いバー）。満タンで光る
  function gaugeBar(v, max) {
    const b = h('div', 'u-gauge' + (v >= max ? ' full' : '')); const i = h('i'); i.style.width = Math.min(100, v / max * 100) + '%'; b.appendChild(i);
    b.title = `固有ゲージ ${v}/${max}（チェインに参加するとたまる。満タンで固有カードが使える）`; return b;
  }
  function bar(hp, max) {
    const b = h('div', 'u-bar'); const i = h('i'); i.style.width = Math.max(0, hp / max * 100) + '%'; b.appendChild(i);
    b.appendChild(h('b', '', `${hp}/${max}`)); return b;
  }
  const sumSt = (u, type) => (u.status || []).reduce((a, x) => a + (x.type === type ? x.value : 0), 0);
  // 同じ種類の状態は合計して表示（カッコ内は最も長い残りターン）
  function statusTags(list) {
    const agg = {};
    (list || []).forEach(x => { const a = agg[x.type] = agg[x.type] || { v: 0, t: 0, parts: [] }; a.v += x.value; a.t = Math.max(a.t, x.turns); a.parts.push(x); });
    return Object.entries(agg).map(([k, a]) => {
      const def = D.STATUS[k] || { short: k, desc: '' };
      const s = h('span', def.good ? '' : 'bad', `${def.short}${a.v}${def.pct ? '%' : ''}<i>${a.t}</i>`);
      s.title = `${def.name}：${def.desc.replace('X', a.v)}\n` + a.parts.map(x => `・${x.value}${def.pct ? '%' : ''}（残り${x.turns}ターン）`).join('\n');
      return s;
    });
  }
  function intentEl(e, v) {
    const it = e.intent;
    const raw = (x) => Math.max(0, x + (e.atkBonus || 0) + sumSt(e, 'atkUp') - sumSt(e, 'atkDown'));
    let cls = 'intent', txt = '';
    if (it.type === 'attack') { cls += ' atk'; txt = `⚔ ${raw(it.value)} → ${esc(nameOfSlot(v, it.target))}`; }
    else if (it.type === 'attackAll') { cls += ' atk'; txt = `⚔ ${raw(it.value)} 全体`; }
    else if (it.type === 'buffBody') txt = `▲ ${esc(it.name || '')}：本体の攻撃力+${it.value}`;
    else if (it.type === 'enrage') txt = `▲ ${esc(it.name || '強化')}：攻撃力+${it.value}`;
    else if (it.type === 'buffAll') txt = `▲ ${esc(it.name || '強化')}：竜全体の攻撃力+${it.value}`;
    else if (it.type === 'charge') txt = `… ${esc(it.name || '力をためている')}`;
    else if (it.type === 'ultimate') { cls += ' doom'; txt = `☠ ${esc(it.name || '必殺')} ${raw(it.value)} 全体`; }
    if (it.curse && it.curse.length) txt += ` ＋${it.curse.map(c => D.STATUS[c.status].short + c.value).join('・')}`;
    const d = h('div', cls, txt);
    if (it.curse && it.curse.length) d.title = `当たると ${it.curse.map(c => `${D.STATUS[c.status].name}${c.value}`).join('・')}（${it.curse[0].turns}ターン）`;
    else if (it.type === 'attack' || it.type === 'attackAll' || it.type === 'ultimate') d.title = '表示は敵の攻撃力。実際のダメージ＝（この数値−防御アップ）×（1−カット率）';
    return d;
  }
  function hitbox(ov, side, i, pos, alive) {
    const tl = toPx(pos.x - pos.w / 2, pos.y - pos.hgt), br = toPx(pos.x + pos.w / 2, pos.y);
    const hb = h('div', 'unit'); hb.style.cssText = `left:${(tl.x + br.x) / 2}px;top:${tl.y}px;width:${br.x - tl.x}px;height:${br.y - tl.y}px;cursor:${state.targeting ? 'pointer' : 'default'}`;
    const t = state.targeting;
    const enemyCard = t && (t.card.target === 'enemy' || t.card.target === 'allEnemies');
    if (t && alive && ((enemyCard && side === 'e') || (t.card.target === 'ally' && side === 'p'))) {
      hb.style.outline = '3px dashed var(--accent)'; hb.style.animation = 'blink .5s infinite alternate';
      hb.onclick = () => { send({ type: 'reserve', uid: t.uid, target: i }); lastSel = ''; state.targeting = null; renderBattleUI(); };
      if (side === 'p') { hb.onmouseenter = () => sendSelecting(t.uid, i); hb.onmouseleave = () => sendSelecting(t.uid, null); }
      if (side === 'e') {
        const e = state.view.enemies[i];
        const ctx = { ...state.handCtx, element: t.card.element, elements: D.elementsOf(t.card), enemy: e };
        // 敵の上に予想ダメージを表示
        const total = previewDamage(t.card, t.mult || 1, t.count || 1, ctx);
        if (total != null) { const tag = h('div', 'pv-tag', `予想 ${total}`); hb.appendChild(tag); }
        hb.onmouseenter = () => { setSelectedDesc(t, ctx); sendSelecting(t.uid, i); };
        hb.onmouseleave = () => { setSelectedDesc(t, { ...state.handCtx, element: t.card.element }); sendSelecting(t.uid, null); };
      }
    }
    ov.appendChild(hb);
  }
  // 選択中カードの説明だけを書き換える（ホバー中の敵に合わせる）
  function setSelectedDesc(t, ctx) {
    if (!t.el) return;
    const d = t.el.querySelector('.c-desc'); if (d) d.innerHTML = cardDescHTML(t.card, t.mult || 1, t.count, ctx);
  }
  // 敵1体への合計予想ダメージ（チェインの追加効果も含む。会心は含まない）
  function previewDamage(card, mult, count, ctx) {
    const effs = D.applyChain(card, count || 0).effects;
    const dmg = effs.filter(ef => ef.type === 'damage' && !ef.self); if (!dmg.length) return null;
    const e = ctx.enemy, cm = D.costMult(card.cost);
    const def = Math.max(0, e.def - sumSt(e, 'defDown')), aff = D.affinity(D.elementsOf(card), e.element);
    return dmg.reduce((a, ef) => a + (ef.flat ? ef.value : 0) + (ef.flat ? 0 : 1) * Math.floor((Math.max(0, Math.floor((ef.value + ctx.atk) * mult) - def) * aff + ctx.dmgUp + sumSt(e, 'vulnUp')) * cm), 0);
  }
  function pickCard(uid) {
    const b = state.battle, c = D.CARD_MAP[b.cards[uid]];
    if (state.targeting && state.targeting.uid === uid) { state.targeting = null; sendSelecting(null, null); return renderBattleUI(); }
    // 敵を狙うカード（単体・全体とも）と味方1人を狙うカードは、対象をクリックして決める。全体攻撃は誰を選んでも全体に当たる
    if (!['enemy', 'allEnemies', 'ally'].includes(c.target)) { lastSel = ''; return send({ type: 'reserve', uid, target: null }); }
    state.targeting = { uid, card: c }; sendSelecting(uid, null); renderBattleUI();
  }
  // 選んでいる最中の状態を仲間に共有（同じ内容は送らない）
  let lastSel = '';
  function sendSelecting(uid, target) {
    const k = uid + ':' + target; if (k === lastSel) return; lastSel = k;
    send({ type: 'selecting', uid, target });
  }
  const cancelTarget = () => { if (state.targeting) { state.targeting = null; sendSelecting(null, null); renderBattleUI(); } };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancelTarget(); });
  $('scene-wrap').addEventListener('contextmenu', (e) => { if (state.targeting) { e.preventDefault(); cancelTarget(); } });
  $('btn-confirm').onclick = () => { const me = state.battle.players.find(p => p.slot === state.slot); send({ type: 'confirm', value: !me.confirmed }); };
  $('btn-log').onclick = () => $('log').classList.toggle('hidden');
  $('btn-help').onclick = () => showRules();

  function updateTimer() {
    const el = $('b-timer');
    if (!state.battle || state.battle.phase !== 'planning' || !state.deadline) { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
    const room = state.room; const total = room ? room.timer : 0;
    el.textContent = left > total ? '' : `残り ${left}秒`;
    el.classList.toggle('warn', left <= 10);
  }

  function logLine(t) { state.logLines.push(t); const d = h('div', '', t); $('log').appendChild(d); $('log').scrollTop = 1e6; }

  // ---------- 演出の再生 ----------
  function floatText(side, i, text, color, small) {
    const pos = unitPos(side, i); const p = toPx(pos.x + (Math.random() - .5) * 10, pos.y - pos.hgt * 0.6);
    const f = h('div', 'float' + (small ? ' small' : ''), text); f.style.left = p.x + 'px'; f.style.top = p.y + 'px'; f.style.color = color;
    $('fxl').appendChild(f); setTimeout(() => f.remove(), 1000);
  }
  function cardPop(slot, cardId, mult, bonus) {
    const pos = unitPos('p', slot); const p = toPx(pos.x, pos.y - pos.hgt - 30);
    const c = D.CARD_MAP[cardId];
    const f = h('div', 'cardpop', `${esc(c.name)}${mult > 1 ? ` <span style="color:var(--accent)">×${mult}</span>` : ''}${bonus ? ` <span style="color:#9fe8ff">${D.elementsOf(c).map(e => D.ELEMENTS[e].name).join('')}チェイン!</span>` : ''}`);
    setElVars(f, c); f.style.left = p.x + 'px'; f.style.top = p.y + 'px';
    $('fxl').appendChild(f); setTimeout(() => f.remove(), 900);
  }
  function banner(html, ms) {
    const b = $('banner'); b.innerHTML = html; b.classList.remove('hidden');
    clearTimeout(banner.t); banner.t = setTimeout(() => b.classList.add('hidden'), ms || 1200);
  }
  function viewObj(side, i) { const v = state.view; return side === 'p' ? v.players.find(p => p.slot === i) : v.enemies[i]; }

  function runAnim() {
    state.animating = true;
    renderBattleUI();
    const HEAD = ['card', 'enemyAct', 'sync', 'victory', 'defeat', 'drop'];
    const step = () => {
      const ev = state.anim.shift();
      if (!ev) {
        state.animating = false; state.view = clone(state.battle);
        renderBattleUI();
        if (state.battle.phase === 'victory' || state.battle.phase === 'defeat') showResult();
        return;
      }
      let wait;
      const prio = (e) => D.CARD_MAP[e.cardId].priority;
      if (ev.t === 'card' || ev.t === 'enemyAct' || !HEAD.includes(ev.t)) {
        // 同じ優先度のカードは同時に発動したように見せる
        const group = [ev];
        while (state.anim.length) {
          const nx = state.anim[0];
          if (!HEAD.includes(nx.t) || (ev.t === 'card' && nx.t === 'card' && prio(nx) === prio(ev))) group.push(state.anim.shift());
          else break;
        }
        const heads = group.filter(g => g.t === 'card' || g.t === 'enemyAct');
        const rest = group.filter(g => !(g.t === 'card' || g.t === 'enemyAct'));
        heads.forEach((g, k) => setTimeout(() => playEvent(g), k * 90));
        const lead = heads.length ? 260 + heads.length * 60 : 0;
        rest.forEach((g, k) => setTimeout(() => playEvent(g), lead + k * 50));
        wait = lead + rest.length * 50 + 380;
        if (ev.t === 'enemyAct' && ev.intent.type === 'ultimate') wait += 900;
      } else wait = playEvent(ev);
      setTimeout(step, wait);
    };
    step();
  }
  function playEvent(ev) {
    const v = state.view;
    switch (ev.t) {
      case 'sync': {
        const best = D.ELEMENT_ORDER.filter(e => ev.counts[e] >= 2).sort((a, b) => ev.counts[b] - ev.counts[a]);
        if (best.length) {
          banner(best.map(e => `<span style="color:${D.ELEMENTS[e].color}">${D.ELEMENTS[e].name}×${ev.counts[e]}人</span>`).join('　') + `<small>属性チェイン！ 倍率 ${best.map(e => '×' + multOf(ev.counts[e])).join(' / ')}</small>`, 1100);
          if (best.some(e => ev.counts[e] >= 4)) fx.shake = 6;
          logLine('属性チェイン：' + best.map(e => `${D.ELEMENTS[e].name}${ev.counts[e]}人(×${multOf(ev.counts[e])})`).join('、'));
          return 1150;
        }
        return 150;
      }
      case 'card': {
        fxOf('p', ev.slot).lunge = 1; cardPop(ev.slot, ev.cardId, ev.mult, ev.chain);
        const pos = unitPos('p', ev.slot); burst(pos.x + 8, pos.y - pos.hgt / 2, D.ELEMENTS[ev.element].color, 10);
        logLine(`${nameOfSlot(v, ev.slot)}：${D.CARD_MAP[ev.cardId].name}${ev.mult > 1 ? `（×${ev.mult}）` : ''}${ev.chain ? '［チェイン発動］' : ''}`);
        return 300;
      }
      case 'damage': {
        const o = viewObj(ev.side, ev.i); if (!o) return 50;
        o.hp = ev.hp;
        const f = fxOf(ev.side, ev.i); f.flash = 6;
        const pos = unitPos(ev.side, ev.i);
        if (ev.element) burst(pos.x, pos.y - pos.hgt / 2, D.ELEMENTS[ev.element].color, 16);
        fx.shake = Math.max(fx.shake, Math.min(8, 2 + ev.amount / 15));
        let txt = String(ev.amount);
        if (ev.crit) txt = '会心! ' + txt;
        let col = ev.poison ? '#b9ff6b' : ev.side === 'e' ? '#ffffff' : '#ff6b6b';
        if (ev.adv === 2) { txt += ' 弱点!'; col = '#ffcf5a'; } else if (ev.adv === 0.5) { txt += ' いまひとつ'; col = '#9aa0b5'; }
        if (ev.crit) col = '#ff9df0';
        if (ev.side === 'p' && ev.raw != null && ev.raw > ev.amount) floatText(ev.side, ev.i, `軽減 -${ev.raw - ev.amount}`, '#8fc0ff', true);
        floatText(ev.side, ev.i, txt, col);
        renderBattleUI();
        return ev.poison ? 200 : 240;
      }
      case 'enemyBuff': { const o = viewObj('e', ev.i); if (o) o.atkBonus = ev.atkBonus; floatText('e', ev.i, `攻撃力+${ev.amount}`, '#ff8a8a', true); renderBattleUI(); return 150; }
      case 'heal': { const o = viewObj(ev.side, ev.i); if (o) o.hp = ev.hp; if (ev.amount > 0) floatText(ev.side, ev.i, `+${ev.amount}`, '#6ee7a0'); const pos = unitPos(ev.side, ev.i); burst(pos.x, pos.y - pos.hgt / 2, '#6ee7a0', 8); renderBattleUI(); return 150; }
      case 'status': { const o = viewObj(ev.side, ev.i); const sd = D.STATUS[ev.status]; if (o) { o.status = o.status || []; o.status.push({ type: ev.status, value: ev.amount, turns: ev.turns }); } floatText(ev.side, ev.i, `${sd.short}${ev.amount}${sd.pct ? '%' : ''}`, sd.good ? '#ffcf5a' : '#d58bff', true); renderBattleUI(); return 150; }
      case 'draw': floatText('p', ev.i, `次ターン手札+${ev.amount}`, '#9fe8ff', true); return 120;
      case 'enemyAct': {
        fxOf('e', ev.i).lunge = 1;
        const e = v.enemies[ev.i];
        if (ev.intent.type === 'ultimate') { banner(`☠ ${esc(ev.intent.name || '必殺')} ☠`, 1200); fx.shake = 14; return 1100; }
        logLine(`${e ? e.name : '敵'}の行動`);
        return 380;
      }
      case 'death': {
        const o = viewObj(ev.side, ev.i); if (o) o.alive = false;
        const pos = unitPos(ev.side, ev.i); burst(pos.x, pos.y - pos.hgt / 2, '#ffffff', 30);
        logLine(`${o ? o.name : ''}は倒れた！`); renderBattleUI(); return 350;
      }
      case 'gauge': { const o = viewObj('p', ev.slot); if (o) { o.gauge = ev.value; o.gaugeMax = ev.max; } return 0; }
      case 'partBreak': floatText('e', ev.i, '部位破壊！', '#ffcf5a'); return 300;
      case 'drop': {
        // 報酬の確定（所持カードに入るのは戦闘が勝利・全滅で終わったとき。撤退すると何も持ち帰れない）
        const mine = ev.items.filter(x => x.slot === state.slot);
        mine.forEach((it, k) => setTimeout(() => floatText('e', ev.i, `${D.CARD_MAP[it.id].name} 獲得！`, it.kind === 'rare' ? '#ffd84a' : '#9fe8ff', true), k * 260));
        const rares = ev.items.filter(x => x.kind === 'rare');
        if (rares.length) {
          const pos = unitPos('e', ev.i);
          fx.pillars.push({ x: pos.x, y: pos.y, life: 90 }); fx.flash = 0.7; fx.shake = Math.max(fx.shake, 6);
          floatText('e', ev.i, 'RARE!', '#ffd84a');
          // 全員への通知（名声ボーナスで全員に配られたレアは1回だけ）
          const seen = new Set();
          rares.forEach(r => {
            const key = r.bonus ? 'b:' + r.id + ':' + r.fromSlot : 'p:' + r.slot + ':' + r.rid;
            if (seen.has(key)) return; seen.add(key);
            notice(r.bonus ? `★${esc(r.from)}の名声ボーナスで、全員がレア「${esc(D.CARD_MAP[r.id].name)}」を入手！` : `${r.slot === state.slot ? 'あなた' : esc(r.name)}がレア「${esc(D.CARD_MAP[r.id].name)}」を入手！`);
          });
        }
        return 250 + mine.length * 260 + (rares.length ? 1300 : 0);
      }
      case 'victory': banner('勝利！', 1500); return 1200;
      case 'defeat': banner('全滅…', 1500); return 1200;
    }
    return 100;
  }

  // ---------- 勝敗 ----------
  function isHost() { return state.room && state.room.hostId === playerId; }
  // 報酬を所持カードに追加する（同じ報酬を2回受け取らないよう、報酬ごとのIDで管理）
  state.claimInfo = {};
  function claimItems(list) {
    let changed = false;
    for (const r of list) {
      if (!r || !r.rid || save.claimedRids.includes(r.rid) || !D.CARD_MAP[r.id]) continue;
      state.claimInfo[r.rid] = { had: save.collection[r.id] || 0 };
      save.collection[r.id] = (save.collection[r.id] || 0) + 1;
      save.claimedRids.push(r.rid); changed = true;
    }
    if (changed) { save.claimedRids = save.claimedRids.slice(-400); persist(); sendProfile(); }
  }
  // 撤退：誰かが提案したら全員に賛成／反対を聞く。全員賛成で撤退
  function renderRetreat() {
    const box = $('retreat-box'); const room = state.room;
    const rt = room && room.inBattle && !room.ended ? room.retreat : null;
    const member = room && (room.members || []).includes(playerId);
    $('btn-retreat').disabled = !(room && room.inBattle && !room.ended && member) || !!rt;
    if (!rt || !member) { box.classList.add('hidden'); return; }
    const humans = room.slots.filter(s => s && s.connected && room.members.includes(s.playerId));
    const yes = humans.filter(s => rt.yes.includes(s.playerId)).length;
    const meYes = rt.yes.includes(playerId);
    box.classList.remove('hidden'); box.innerHTML = '';
    box.appendChild(h('div', '', `<b>${esc(rt.from)}</b>が撤退を提案しました（賛成 ${yes}/${humans.length}）<br><small>全員が賛成すると撤退します。撤退すると報酬は何も持ち帰れません。</small>`));
    const row = h('div', 'row');
    if (!meYes) { const y = h('button', 'btn primary small', '賛成'); y.onclick = () => send({ type: 'retreat', action: 'yes' }); row.appendChild(y); }
    else row.appendChild(h('span', 'hint', 'あなたは賛成済み'));
    const n = h('button', 'btn small', meYes ? '取り消す' : '反対'); n.onclick = () => send({ type: 'retreat', action: 'no' }); row.appendChild(n);
    box.appendChild(row);
  }
  $('btn-retreat').onclick = () => {
    modal('<h2>撤退しますか？</h2><p>撤退を提案します。全員が賛成すると戦闘をやめてロビーに戻ります。<br><b>撤退すると、この戦闘の報酬（部位破壊の報酬も含む）は何も持ち帰れません。</b></p>',
      [{ label: '撤退を提案する', primary: true, onClick: () => send({ type: 'retreat', action: 'propose' }) }, { label: 'やめる' }]);
  };
  function notice(html) {
    const n = h('div', 'notice', html); $('notices').appendChild(n);
    setTimeout(() => n.classList.add('out'), 4200); setTimeout(() => n.remove(), 4800);
  }
  // 依頼の達成とクリア状況をセーブに反映する
  function applyBattleEnd(b) {
    if (state.appliedFor === b.id) return; state.appliedFor = b.id;
    if (b.phase === 'victory') save.clears[b.stageId] = Math.max(save.clears[b.stageId] || 0, b.star || 1);
    for (const qr of (b.questResults || {})[state.slot] || []) {
      const i = save.quests.findIndex(q => q.qid === qr.qid);
      if (i >= 0) save.quests[i] = D.genQuest(save.quests[i].diff, save.quests);
    }
    persist(); sendProfile();
  }
  const KIND = { fixed: 'ステージ報酬', rare: '✦レアドロップ！', random: 'ランダム報酬', fame: '★名声ボーナス', fameItem: '📜名声カード！', part: '部位破壊' };
  function rewardBox(r) {
    const box = h('div', r.kind === 'rare' ? 'rw-rare' : '');
    const from = r.bonus ? (r.fromSlot === state.slot ? '（あなたの名声）' : `（${esc(r.from)}の名声）`) : '';
    let label = KIND[r.kind] || '';
    if (r.kind === 'part') label = `部位破壊（${esc(r.part || '')}）`;
    else if (r.quest) label = `依頼達成 ${r.kind === 'rare' ? '✦レア確定' : ''}`;
    else if (r.slotKind === 'speed') label = `⚡速攻ボーナス ${r.kind === 'fameItem' ? '📜' : ''}`;
    else if (r.slotKind === 'star') label = `★危険度ボーナス ${r.kind === 'fameItem' ? '📜' : ''}`;
    else if (r.kind === 'fameItem' && r.slotKind === 'random') label = 'ランダム報酬 📜名声カード！';
    else if (r.kind === 'fame') label = '';
    box.appendChild(h('div', 'tag', (r.bonus ? `★名声ボーナス${from} ` : '') + label));
    box.appendChild(renderCard(r.id, { showRole: true }));
    const isItem = D.CARD_MAP[r.id].rarity === 'item';
    const ci = state.claimInfo[r.rid];
    box.appendChild(h('div', 'tag', isItem ? `所持 ${save.collection[r.id] || 0}枚（デッキ編集で使えます）` : !ci ? `名声${fameFor(r.id)}` : ci.had > 0 ? `所持済み → 名声+1（名声${fameFor(r.id)}）` : 'NEW!'));
    return box;
  }
  // 戦闘の結果：MVP・与ダメージの割合・最大チェイン数・撃破ターン
  function statsTable(b) {
    const st = b.stats || { p: {} };
    const rows = b.players.map(p => ({ p, s: st.p[p.slot] || {} }));
    const totalDmg = rows.reduce((a, r) => a + (r.s.dmg || 0), 0) || 1;
    const score = (s) => (s.dmg || 0) + (s.heal || 0) + 25 * ((s.buffs || 0) + (s.debuffs || 0)) + 15 * (s.draws || 0) + (s.tanked || 0);
    const mvp = rows.slice().sort((a, c) => score(c.s) - score(a.s))[0];
    const t = h('table', 'stats-table');
    t.innerHTML = `<tr><th></th><th>名前</th><th>与ダメージ</th><th>回復</th><th>バフ/デバフ</th><th>最大チェイン</th><th>貢献</th></tr>` + rows.map(({ p, s }) => {
      const pct = Math.round((s.dmg || 0) / totalDmg * 100);
      return `<tr class="${p.slot === state.slot ? 'me' : ''}"><td>${mvp && mvp.p === p ? '👑' : ''}</td><td>${esc(p.name)}<small>${D.ROLES[p.role].name}</small></td>
        <td><div class="dmg-bar"><i style="width:${pct}%"></i></div>${s.dmg || 0}（${pct}%）</td><td>${s.heal || 0}</td><td>${s.buffs || 0} / ${s.debuffs || 0}</td><td>${s.maxChain || 0}</td><td>${score(s)}</td></tr>`;
    }).join('');
    const wrap = h('div', 'result-stats');
    wrap.appendChild(h('p', '', `${b.phase === 'victory' ? '撃破' : '全滅'}ターン：<b>${b.turn}</b>　部位破壊：<b>${st.partsBroken || 0}</b>　倒れた人数：<b>${st.deaths || 0}</b>${mvp ? `　MVP：<b>👑${esc(mvp.p.name)}</b>` : ''}`));
    wrap.appendChild(t);
    return wrap;
  }
  function showResult() {
    const b = state.battle; if (!b) return;
    state.resultFor = b.id;
    const mine = (b.rewards || {})[state.slot] || [];
    claimItems(mine);
    applyBattleEnd(b);
    const win = b.phase === 'victory';
    const qr = (b.questResults || {})[state.slot] || [];
    modal(`<h2>${win ? '勝利！' : '全滅…'} ${esc(b.stageName)} <span class="star-badge">${starText(b.star || 1)}</span></h2>
      `, []);
    const body = $('modal-body');
    body.appendChild(statsTable(b));
    if (qr.length) { const q = h('div', 'quest-done', '<h3>依頼達成！</h3>'); qr.forEach(x => q.appendChild(h('div', '', `<span class="q-diff ${x.diff}">${D.QUEST_DIFF_NAME[x.diff]}</span>${esc(x.text)}`))); body.appendChild(q); }
    if (mine.length) {
      body.appendChild(h('h3', '', '手に入れたカード'));
      const wrap = h('div', 'rewards'); mine.forEach(r => wrap.appendChild(rewardBox(r))); body.appendChild(wrap);
    } else if (!win) body.appendChild(h('p', 'hint', '持ち帰れた報酬はありません'));
    body.appendChild(h('div', '', '<div id="retry-box" class="retry-box"></div>'));
    renderRetry();
  }
  // もう一度：危険度の選択（ホスト）と、全員の準備状況
  function renderRetry() {
    const box = $('retry-box'); const room = state.room; if (!box || !room) return;
    const host = isHost();
    const humans = room.slots.filter(s => s && s.connected);
    const ready = humans.filter(s => room.retry.includes(s.playerId)).length;
    const meReady = room.retry.includes(playerId);
    box.innerHTML = '';
    const lab = h('label', '', '次の危険度 '); const sel = h('select'); fillStarSelect(sel, room, host);
    sel.onchange = () => send({ type: 'setStar', star: +sel.value }); lab.appendChild(sel);
    box.appendChild(lab);
    const rb = h('button', 'btn primary' + (meReady ? ' on' : ''), meReady ? `準備OK（${ready}/${humans.length}）キャンセル` : `もう一度（${ready}/${humans.length}）`);
    rb.onclick = () => send({ type: 'retry', value: !meReady, ...profilePayload() });
    box.appendChild(rb);
    if (host) { const lb = h('button', 'btn', 'ロビーに戻る'); lb.onclick = () => send({ type: 'backToLobby' }); box.appendChild(lb); }
    box.appendChild(h('p', 'hint', host ? '全員が「もう一度」を押すと、同じメンバー・同じステージで再出発します。★はここで変えられます。' : '全員が「もう一度」を押すと再出発します。★はホストが選びます。'));
  }
  function showRules() {
    modal(`<div class="rules"><h2>ルール</h2>
      <ul>
        <li>毎ターン、全員が手札からカードを<b>予約</b>し、全員が「確定」すると一斉に発動します。発動は<b>優先度の高い順</b>（バフ100 → 防御80 → デバフ60 → 攻撃40 → 回復30）。敵は味方全員の後に行動します。</li>
        <li><b>属性チェイン</b>：同じ属性のカードを出した<b>人数</b>で倍率が決まります（端数は切り捨て）。さらに「火チェイン2」のように書かれた効果は、その属性を2人以上が出したときに上乗せで発動します。1人×1.0／2人×1.2／3人×1.5／4人×2.5（バフ・デバフの持続ターンと、ドロー・エネルギーには倍率なし）</li>
        <li><b>2属性カード</b>：どちらの属性のチェインにも参加します。2属性カードのチェインの人数は、両方の属性を合わせて数えます（例：水・風のカードの「チェイン3」は、他の人が水1人・風1人でも発動）。攻撃の相性は、有利なほうを使います。</li>
        <li><b>属性相性</b>：火→風→水→火、光⇔闇。弱点×2.0、いまひとつ×0.5。</li>
        <li><b>与ダメージ</b>＝（（カードの数値＋攻撃力）×チェイン倍率 − 敵の防御力）×属性相性 ＋ 与ダメージアップ ＋ 被ダメージアップ。クリティカルなら×1.5。</li>
        <li><b>コスト倍率</b>：4コストのカードは×1.2、5コストのカードは×1.5が最終威力（ダメージ・回復量・バフ・デバフの数値）にかかります。</li>
        <li><b>回復量</b>＝（カードの回復量＋回復力）×チェイン倍率 ＋ 回復量アップ</li>
        <li><b>受けるダメージ</b>＝（敵の攻撃力 − 防御アップ）×（1 − カット率）。カット率はタンクの挑発カードを使った本人だけにかかります。挑発で引きつけられるのは単体攻撃だけです。</li>
        <li><b>手札</b>は最初5枚・上限5枚。毎ターン1枚引きます（使わなかったカードは残ります）。<b>エネルギー</b>は3から始まり毎ターン最大値+1（上限10）、毎ターン満タンに戻ります。</li>
        <li><b>ステータス</b>（HP・攻撃力・回復力）はデッキ10枚の合計。★代表カードは2倍で数えます。</li>
        <li><b>ボス</b>は本体と部位に分かれています。本体を倒せば勝ち。部位を壊すと、その部位の行動がなくなります。</li>
        <li><b>固有カード</b>：デッキとは別の固有枠に最大3枚入れられます（デッキ編集で選択）。全属性なので、どのチェインにも参加し、どの敵の弱点も突きます。HPの下の青いゲージは、自分のカードがチェインに入るとたまり（人数が多いほど多く）、満タンになると固有カードを1枚使えます（5エネルギー）。使うとゲージは0に戻ります。</li>
        <li><b>撤退</b>：戦闘画面上部の「撤退」で提案し、全員が賛成すると戦闘をやめてロビーに戻ります。撤退するとその戦闘の報酬は何も持ち帰れません（壊した部位の報酬も、勝利か全滅で戦闘が終わったときに受け取ります）。人間が全員倒れても、AIの味方が残っていれば戦闘は自動で進みます。</li>
        <li><b>危険度</b>：★が上がるほど敵の強化が大きくなり、攻撃にデバフ（毒・攻撃力ダウン・被ダメージアップ）が付きます。ステージを★Nでクリアすると★N+1が解放されます（ホストのセーブで判定）。</li>
        <li><b>依頼</b>：一人3つ（簡単・普通・難しい）。勝利したときに判定し、達成すると新しい依頼に入れ替わります。</li>
      </ul></div>`);
  }

  // ---------- 起動 ----------
  initTitle();
  show('title');
  connect();
})();
