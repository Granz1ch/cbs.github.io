const HOSTED = /fi14\.bot-hosting\.cloud/.test(location.host);
const API = window.CBS_API || (HOSTED || location.port === '25314' ? '' : 'http://fi14.bot-hosting.cloud:25314');
const PLAYER_KEY = 'cbs_player_id';
const NAME_KEY = 'cbs_name';
const TURN_MS = 12000;

const DMG_POOL = [
  { name: 'Искра', rarity: 'common', type: 'dmg', dmg: 8 },
  { name: 'Клинок', rarity: 'common', type: 'dmg', dmg: 12 },
  { name: 'Шип', rarity: 'common', type: 'dmg', dmg: 10 },
  { name: 'Буря', rarity: 'rare', type: 'dmg', dmg: 22 },
  { name: 'Яд', rarity: 'rare', type: 'dmg', dmg: 18 },
  { name: 'Гром', rarity: 'epic', type: 'dmg', dmg: 36 },
  { name: 'Феникс', rarity: 'epic', type: 'dmg', dmg: 42 },
  { name: 'Титан', rarity: 'legendary', type: 'dmg', dmg: 70 },
  { name: 'Пустота', rarity: 'legendary', type: 'dmg', dmg: 88 }
];

const HEAL_POOL = [
  { name: 'Бинт', rarity: 'common', type: 'heal', heal: 10 },
  { name: 'Зелье', rarity: 'common', type: 'heal', heal: 14 },
  { name: 'Капля', rarity: 'common', type: 'heal', heal: 8 },
  { name: 'Аура', rarity: 'rare', type: 'heal', heal: 24 },
  { name: 'Щит жизни', rarity: 'rare', type: 'heal', heal: 20 },
  { name: 'Родник', rarity: 'epic', type: 'heal', heal: 40 },
  { name: 'Феникс-перо', rarity: 'epic', type: 'heal', heal: 48 },
  { name: 'Воскрешение', rarity: 'legendary', type: 'heal', heal: 70 },
  { name: 'Эдем', rarity: 'legendary', type: 'heal', heal: 90 }
];

const ENEMIES = [
  { name: 'Слизень', face: '🟢', hp: 30 },
  { name: 'Гоблин', face: '👺', hp: 48 },
  { name: 'Рыцарь', face: '🛡️', hp: 80 },
  { name: 'Дракон', face: '🐉', hp: 140 },
  { name: 'Повелитель', face: '😈', hp: 220 }
];

const state = {
  id: localStorage.getItem(PLAYER_KEY) || crypto.randomUUID(),
  name: localStorage.getItem(NAME_KEY) || `Боец-${crypto.randomUUID().slice(0, 4)}`,
  coins: 100,
  hp: 100,
  maxHp: 100,
  rolls: 0,
  cards: [],
  wave: 1,
  enemyHp: 30,
  enemyMax: 30,
  enemyCards: [],
  turn: 'idle',
  queueNum: null,
  queueDmg: 0,
  queueHeal: 0,
  inBattle: false,
  duelId: null
};

localStorage.setItem(PLAYER_KEY, state.id);
localStorage.setItem(NAME_KEY, state.name);

let duel = null;
let pendingChallenge = null;
let turnTimer = null;
let turnEndsAt = 0;

const $ = (id) => document.getElementById(id);
$('nick').value = state.name;

function rollPrice() {
  return Math.floor(100 * Math.pow(1.25, state.rolls));
}
function hpUpgradeCost() {
  return 80 + Math.floor((state.maxHp - 100) * 1.4);
}
function healCost() {
  return 40 + state.wave * 5;
}

function enemyForWave(w) {
  const base = ENEMIES[Math.min(ENEMIES.length - 1, Math.floor((w - 1) / 2))];
  const scale = 1 + (w - 1) * 0.35;
  return { ...base, hp: Math.floor(base.hp * scale) };
}

function randomNum() {
  return 1 + Math.floor(Math.random() * 5);
}

function pickRarity() {
  const r = Math.random();
  if (r > 0.97) return 'legendary';
  if (r > 0.85) return 'epic';
  if (r > 0.55) return 'rare';
  return 'common';
}

function pickCard() {
  const rarity = pickRarity();
  const pool = (Math.random() < 0.35 ? HEAL_POOL : DMG_POOL).filter((c) => c.rarity === rarity);
  const fallback = (Math.random() < 0.35 ? HEAL_POOL : DMG_POOL).filter((c) => c.rarity === 'common');
  const src = pool.length ? pool : fallback;
  const c = src[Math.floor(Math.random() * src.length)];
  return { ...c, id: crypto.randomUUID(), num: randomNum(), dmg: c.dmg || 0, heal: c.heal || 0 };
}

function ensureCardNums() {
  state.cards.forEach((c) => {
    if (!c.num) c.num = randomNum();
    if (!c.type) c.type = c.heal ? 'heal' : 'dmg';
  });
}

function makeEnemyDeck() {
  const n = 3 + Math.min(8, state.wave);
  state.enemyCards = Array.from({ length: n }, () => pickCard());
}

function clearTurnTimer() {
  if (turnTimer) clearTimeout(turnTimer);
  turnTimer = null;
  turnEndsAt = 0;
}

function startQueueTimer() {
  clearTurnTimer();
  turnEndsAt = Date.now() + TURN_MS;
  turnTimer = setTimeout(() => {
    if (state.turn === 'player' && state.queueNum != null && !duel) endPlayerTurn('время вышло');
  }, TURN_MS);
}

function log(msg) {
  $('battleLog').textContent = msg;
}

function cardPower(c) {
  if (c.type === 'heal') return `♥ ${c.heal}`;
  return `⚔ ${c.dmg}`;
}

function renderCards(list, playableCheck) {
  const qn = duel ? duel.queueNum : state.queueNum;
  return list
    .map((c) => {
      const locked = playableCheck && qn != null && c.num !== qn;
      const playable = playableCheck && !locked;
      return `<article class="card ${c.rarity} ${c.type === 'heal' ? 'heal' : ''} ${playable ? 'playable' : ''} ${locked ? 'locked' : ''}" data-id="${c.id}">
        <div class="row"><span class="r">${c.rarity} · ${c.type === 'heal' ? 'хил' : 'урон'}</span><span class="num">№${c.num}</span></div>
        <div class="n">${c.name}</div>
        <div class="d">${cardPower(c)}</div>
      </article>`;
    })
    .join('');
}

function myDuelSide() {
  if (!duel) return null;
  if (duel.a.id === state.id) return 'a';
  if (duel.b.id === state.id) return 'b';
  return null;
}

function render() {
  ensureCardNums();
  $('coins').textContent = state.coins;
  $('hpLabel').textContent = `${state.hp}/${state.maxHp}`;
  $('rollCost').textContent = `${rollPrice()} ◎`;
  $('hpCost').textContent = `${hpUpgradeCost()} ◎`;
  $('healCost').textContent = `${healCost()} ◎`;
  $('deckCount').textContent = (duel ? (duel[myDuelSide()] || {}).cards || [] : state.cards).length;

  if (duel) {
    const me = myDuelSide();
    const foe = me === 'a' ? duel.b : duel.a;
    const mine = me === 'a' ? duel.a : duel.b;
    state.hp = mine.hp;
    state.maxHp = mine.maxHp;
    $('hpLabel').textContent = `${mine.hp}/${mine.maxHp}`;
    $('modeLabel').innerHTML = 'ДУЭЛЬ';
    $('enemyName').textContent = foe.name;
    $('enemyFace').textContent = '⚔️';
    $('enemyHp').textContent = `${Math.max(0, foe.hp)} / ${foe.maxHp}`;
    $('enemyBar').style.width = `${Math.max(0, (foe.hp / foe.maxHp) * 100)}%`;
    $('enemyDeck').textContent = foe.cards.length;
    const myTurn = !duel.ended && duel.turn === me;
    const qn = duel.queueNum;
    $('queueInfo').textContent = duel.ended
      ? duel.log
      : myTurn
        ? qn == null
          ? 'Твой ход: кинь карту'
          : `Очередь №${qn} · урон ${duel.queueDmg} · хил ${duel.queueHeal}`
        : 'Ход соперника';
    $('turnClock').textContent = '';
    $('cards').innerHTML = renderCards(mine.cards, myTurn);
    $('fightBtn').classList.add('hidden');
    $('leaveDuelBtn').classList.remove('hidden');
    $('endTurnBtn').disabled = !(myTurn && qn != null);
    $('battleLog').textContent = duel.log;
  } else {
    $('modeLabel').innerHTML = `ВОЛНА <span id="wave">${state.wave}</span>`;
    const e = enemyForWave(state.wave);
    $('enemyName').textContent = e.name;
    $('enemyFace').textContent = e.face;
    $('enemyHp').textContent = `${Math.max(0, state.enemyHp)} / ${state.enemyMax}`;
    $('enemyBar').style.width = `${Math.max(0, (state.enemyHp / state.enemyMax) * 100)}%`;
    $('enemyDeck').textContent = state.enemyCards.length;
    const qn = state.queueNum;
    $('queueInfo').textContent = state.inBattle
      ? state.turn === 'player'
        ? qn == null
          ? 'Твой ход: кинь карту — номер очереди зафиксируется'
          : `Очередь №${qn} · урон ${state.queueDmg} · хил ${state.queueHeal || 0}`
        : `Ход врага · очередь №${qn ?? '—'}`
      : 'Начни бой или вызови игрока на дуэль';
    const left = turnEndsAt ? Math.max(0, Math.ceil((turnEndsAt - Date.now()) / 1000)) : 0;
    $('turnClock').textContent = state.turn === 'player' && qn != null ? `${left}с` : '';
    $('cards').innerHTML = renderCards(state.cards, state.inBattle && state.turn === 'player');
    $('fightBtn').classList.remove('hidden');
    $('leaveDuelBtn').classList.add('hidden');
    $('endTurnBtn').disabled = !(state.inBattle && state.turn === 'player' && state.queueNum != null);
  }

  $('rollBtn').disabled = state.coins < rollPrice() || Boolean(duel);
  $('hpUpBtn').disabled = state.coins < hpUpgradeCost() || Boolean(duel);
  $('healBtn').disabled = state.coins < healCost() || state.hp >= state.maxHp || Boolean(duel);
  $('fightBtn').disabled = state.cards.length === 0 || state.hp <= 0 || state.inBattle || Boolean(duel);
}

function floatText(x, y, text) {
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  $('fx').appendChild(el);
  setTimeout(() => el.remove(), 700);
}

async function api(path, body) {
  try {
    const res = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      let err = 'bad';
      try {
        const j = await res.json();
        err = j.error || err;
      } catch { /* ignore */ }
      $('sync').textContent = 'online';
      throw new Error(err);
    }
    $('sync').textContent = 'online';
    return await res.json();
  } catch (e) {
    if (e.message === 'Failed to fetch' || e.name === 'TypeError') $('sync').textContent = 'offline';
    throw e;
  }
}

async function apiSoft(path, body) {
  try {
    return await api(path, body);
  } catch {
    return null;
  }
}

function applyServer(data) {
  if (!data) return;
  const keep = { id: state.id, name: state.name };
  Object.assign(state, data, keep);
  if (typeof state.coins !== 'number' || Number.isNaN(state.coins)) state.coins = 100;
}

async function save() {
  localStorage.setItem('cbs_state', JSON.stringify(state));
  await apiSoft('/api/save', { ...state, name: state.name });
}

async function load() {
  const remote = await apiSoft(`/api/player/${state.id}`);
  if (remote && remote.found) applyServer(remote.player);
  else {
    const local = localStorage.getItem('cbs_state');
    if (local) Object.assign(state, JSON.parse(local));
  }
  if (!state.enemyMax) {
    const e = enemyForWave(state.wave);
    state.enemyHp = e.hp;
    state.enemyMax = e.hp;
  }
  ensureCardNums();
  if (!Array.isArray(state.enemyCards)) state.enemyCards = [];
  $('nick').value = state.name;
  render();
}

function applyCardToPve(card) {
  if (card.type === 'heal') {
    const h = card.heal || 0;
    state.hp = Math.min(state.maxHp, state.hp + h);
    state.queueHeal = (state.queueHeal || 0) + h;
    log(`Хил ${card.name} +${h} (№${card.num}).`);
  } else {
    const d = card.dmg || 0;
    state.enemyHp -= d;
    state.queueDmg += d;
    log(`Урон ${card.name} ⚔${d} (№${card.num}). Сумма ${state.queueDmg}.`);
  }
}

function checkBattleEnd() {
  if (state.enemyHp <= 0) {
    const reward = 20 + state.wave * 8;
    state.coins += reward;
    state.wave += 1;
    const e = enemyForWave(state.wave);
    state.enemyHp = e.hp;
    state.enemyMax = e.hp;
    state.inBattle = false;
    state.turn = 'idle';
    state.queueNum = null;
    state.queueDmg = 0;
    state.queueHeal = 0;
    state.enemyCards = [];
    clearTurnTimer();
    log(`Победа! +${reward} ◎  Волна ${state.wave}.`);
    render();
    save();
    return true;
  }
  if (state.hp <= 0) {
    state.inBattle = false;
    state.turn = 'idle';
    state.queueNum = null;
    state.queueDmg = 0;
    state.queueHeal = 0;
    clearTurnTimer();
    const e = enemyForWave(state.wave);
    state.enemyHp = e.hp;
    state.enemyMax = e.hp;
    log('Ты пал. Подлечись и начни бой снова.');
    render();
    save();
    return true;
  }
  return false;
}

function playPlayerCard(id) {
  if (duel) {
    playDuelCard(id);
    return;
  }
  if (!state.inBattle || state.turn !== 'player') return;
  const idx = state.cards.findIndex((c) => c.id === id);
  if (idx < 0) return;
  const card = state.cards[idx];
  if (state.queueNum != null && card.num !== state.queueNum) {
    log(`Сейчас очередь №${state.queueNum}. Карта №${card.num} не подходит.`);
    return;
  }
  if (state.queueNum == null) {
    state.queueNum = card.num;
    state.queueDmg = 0;
    state.queueHeal = 0;
    startQueueTimer();
  }
  state.cards.splice(idx, 1);
  applyCardToPve(card);
  if (checkBattleEnd()) return;
  const more = state.cards.some((c) => c.num === state.queueNum);
  render();
  save();
  if (!more) endPlayerTurn('карт с этим номером больше нет');
}

async function playDuelCard(id) {
  const data = await apiSoft('/api/duel/play', { duelId: state.duelId, playerId: state.id, cardId: id });
  if (data && data.duel) {
    duel = data.duel;
    syncHpFromDuel();
    render();
  }
}

function syncHpFromDuel() {
  if (!duel) return;
  const me = myDuelSide();
  if (!me) return;
  state.hp = duel[me].hp;
  state.maxHp = duel[me].maxHp;
  state.cards = duel[me].cards;
}

function endPlayerTurn(reason) {
  if (duel) {
    apiSoft('/api/duel/endTurn', { duelId: state.duelId, playerId: state.id }).then((data) => {
      if (data && data.duel) {
        duel = data.duel;
        render();
      }
    });
    return;
  }
  if (state.turn !== 'player') return;
  clearTurnTimer();
  log(`Очередь закрыта (${reason}). Ход врага.`);
  state.turn = 'enemy';
  state.queueNum = null;
  state.queueDmg = 0;
  state.queueHeal = 0;
  render();
  save();
  setTimeout(enemyTurn, 700);
}

function enemyTurn() {
  if (!state.inBattle || state.turn !== 'enemy') return;
  if (!state.enemyCards.length) {
    log('У врага нет карт. Твой ход.');
    state.turn = 'player';
    state.queueNum = null;
    state.queueDmg = 0;
    state.queueHeal = 0;
    render();
    return;
  }
  const counts = {};
  state.enemyCards.forEach((c) => {
    counts[c.num] = (counts[c.num] || 0) + 1;
  });
  const num = Number(
    Object.entries(counts).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0][0]
  );
  const played = state.enemyCards.filter((c) => c.num === num);
  state.enemyCards = state.enemyCards.filter((c) => c.num !== num);
  state.queueNum = num;
  let dmg = 0;
  let heal = 0;
  played.forEach((c) => {
    if (c.type === 'heal') {
      heal += c.heal || 0;
    } else dmg += c.dmg || 0;
  });
  state.enemyHp = Math.min(state.enemyMax, state.enemyHp + heal);
  state.hp = Math.max(0, state.hp - dmg);
  state.queueDmg = dmg;
  state.queueHeal = heal;
  log(`Враг очередь №${num}: ⚔${dmg} ♥${heal}.`);
  render();
  if (checkBattleEnd()) return;
  setTimeout(() => {
    state.turn = 'player';
    state.queueNum = null;
    state.queueDmg = 0;
    state.queueHeal = 0;
    log('Твой ход.');
    render();
    save();
  }, 1100);
}

function startBattle() {
  if (duel || state.cards.length === 0 || state.hp <= 0 || state.inBattle) return;
  const e = enemyForWave(state.wave);
  if (state.enemyHp <= 0) {
    state.enemyHp = e.hp;
    state.enemyMax = e.hp;
  }
  makeEnemyDeck();
  state.inBattle = true;
  state.turn = 'player';
  state.queueNum = null;
  state.queueDmg = 0;
  state.queueHeal = 0;
  log('Бой! Урон бьёт врага, хил лечит тебя. Один номер — одна очередь.');
  render();
  save();
}

function renderOnline(players) {
  const list = Array.isArray(players) ? players.slice() : [];
  if (!list.some((p) => p.id === state.id)) {
    list.unshift({
      id: state.id,
      name: `${state.name} (ты)`,
      hp: state.hp,
      maxHp: state.maxHp,
      cards: state.cards.length,
      duelId: state.duelId,
      self: true
    });
  }
  $('onlineCount').textContent = list.length;
  $('onlineList').innerHTML = list
    .map((p) => {
      const isMe = p.id === state.id || p.self;
      return `<div class="online-row">
        <span>${isMe ? `${p.name.replace(/ \(ты\)$/, '')} (ты)` : p.name} · ♥${p.hp}/${p.maxHp} · ${p.cards} карт</span>
        <button data-chal="${p.id}" ${isMe || p.duelId || duel ? 'disabled' : ''}>${isMe ? 'это ты' : 'Дуэль'}</button>
      </div>`;
    })
    .join('');
}

function clearDeadDuel() {
  duel = null;
  state.duelId = null;
  $('leaveDuelBtn').classList.add('hidden');
}

async function pulse() {
  const pres = await apiSoft('/api/presence', {
    id: state.id,
    name: state.name,
    hp: state.hp,
    maxHp: state.maxHp,
    coins: state.coins,
    cards: state.cards.length,
    duelId: state.duelId
  });
  const online = await apiSoft(`/api/online?me=${encodeURIComponent(state.id)}`);
  if (online) renderOnline(online.players || []);

  const inbox = pres && pres.inbox;
  if (inbox && inbox.type === 'challenge') {
    pendingChallenge = inbox;
    $('challengeText').textContent = `${inbox.fromName} вызывает тебя на дуэль`;
    $('challengeModal').classList.remove('hidden');
  } else if (!inbox || inbox.type !== 'challenge') {
    if (!$('challengeModal').classList.contains('hidden') && pendingChallenge) {
      $('challengeModal').classList.add('hidden');
      pendingChallenge = null;
    }
  }

  if (inbox && inbox.type === 'declined') {
    $('arenaHint').textContent = 'Вызов отклонён';
  }

  if (inbox && inbox.type === 'duel' && inbox.duelId) {
    state.duelId = inbox.duelId;
    const pack = await apiSoft(`/api/duel/${inbox.duelId}`);
    if (pack && pack.found) {
      duel = pack.duel;
      syncHpFromDuel();
      if (duel.ended) {
        $('arenaHint').textContent = duel.log;
        await apiSoft('/api/duel/leave', { playerId: state.id, duelId: state.duelId });
        clearDeadDuel();
        save();
      }
      render();
    } else {
      await apiSoft('/api/duel/leave', { playerId: state.id, duelId: inbox.duelId });
      clearDeadDuel();
      render();
    }
  } else if (state.duelId || duel) {
    const id = state.duelId || (duel && duel.id);
    const pack = id ? await apiSoft(`/api/duel/${id}`) : null;
    if (!pack || !pack.found || (pack.duel && pack.duel.ended)) {
      if (id) await apiSoft('/api/duel/leave', { playerId: state.id, duelId: id });
      clearDeadDuel();
      render();
    } else {
      duel = pack.duel;
      syncHpFromDuel();
      render();
    }
  }
}

$('clickBtn').addEventListener('click', (ev) => {
  state.coins += 1;
  floatText(ev.clientX, ev.clientY, '+1');
  render();
  save();
});

$('rollBtn').addEventListener('click', () => {
  if (duel) return;
  const cost = rollPrice();
  if (state.coins < cost) return;
  state.coins -= cost;
  state.rolls += 1;
  const card = pickCard();
  state.cards.push(card);
  const power = card.type === 'heal' ? `Хил ${card.heal}` : `Урон ${card.dmg}`;
  $('reveal').innerHTML = `<div class="r">${card.rarity} · ${card.type === 'heal' ? 'ХИЛ' : 'УРОН'} · №${card.num}</div><div style="font-size:42px">${card.type === 'heal' ? '💚' : '🃏'}</div><b>${card.name}</b><div class="d">${power}</div>`;
  $('modal').classList.remove('hidden');
  render();
  save();
});

$('modal').addEventListener('click', () => $('modal').classList.add('hidden'));

$('hpUpBtn').addEventListener('click', () => {
  if (duel) return;
  const cost = hpUpgradeCost();
  if (state.coins < cost) return;
  state.coins -= cost;
  state.maxHp += 25;
  state.hp += 25;
  render();
  save();
});

$('healBtn').addEventListener('click', () => {
  if (duel) return;
  const cost = healCost();
  if (state.coins < cost || state.hp >= state.maxHp) return;
  state.coins -= cost;
  state.hp = state.maxHp;
  render();
  save();
});

$('fightBtn').addEventListener('click', startBattle);
$('endTurnBtn').addEventListener('click', () => endPlayerTurn('вручную'));

$('cards').addEventListener('click', (ev) => {
  const el = ev.target.closest('.card');
  if (!el) return;
  playPlayerCard(el.dataset.id);
});

$('onlineList').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-chal]');
  if (!btn) return;
  if (state.cards.length === 0) {
    $('arenaHint').textContent = 'Сначала накрути хотя бы одну карту';
    return;
  }
  await save();
  try {
    await api('/api/duel/challenge', { from: state.id, to: btn.dataset.chal, fromName: state.name });
    $('arenaHint').textContent = 'Вызов отправлен (60с)';
  } catch (e) {
    $('arenaHint').textContent = e.message || 'Не вышло';
  }
});

$('acceptDuel').addEventListener('click', async () => {
  $('challengeModal').classList.add('hidden');
  if (state.cards.length === 0) {
    $('arenaHint').textContent = 'Нужна карта, чтобы принять';
    await apiSoft('/api/duel/respond', { to: state.id, accept: false });
    return;
  }
  await save();
  const data = await apiSoft('/api/duel/respond', { to: state.id, accept: true });
  pendingChallenge = null;
  if (data && data.duel) {
    duel = data.duel;
    state.duelId = data.duel.id;
    state.inBattle = false;
    syncHpFromDuel();
    render();
  } else {
    $('arenaHint').textContent = 'Не удалось принять дуэль';
  }
});

$('declineDuel').addEventListener('click', async () => {
  $('challengeModal').classList.add('hidden');
  pendingChallenge = null;
  await apiSoft('/api/duel/respond', { to: state.id, accept: false });
});

$('leaveDuelBtn').addEventListener('click', async () => {
  if (!state.duelId) return;
  await apiSoft('/api/duel/leave', { playerId: state.id, duelId: state.duelId });
  duel = null;
  state.duelId = null;
  render();
  save();
});

$('nick').addEventListener('change', () => {
  state.name = $('nick').value.trim().slice(0, 24) || state.name;
  localStorage.setItem(NAME_KEY, state.name);
  save();
});

setInterval(() => {
  if (state.turn === 'player' && state.queueNum != null && !duel) render();
}, 400);

setInterval(pulse, 2500);

load().then(pulse);
