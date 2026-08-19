const API = window.CBS_API || (location.port === '3000' ? '' : 'http://127.0.0.1:3000');
const PLAYER_KEY = 'cbs_player_id';
const TURN_MS = 12000;

const CARD_POOL = [
  { name: 'Искра', rarity: 'common', dmg: 8 },
  { name: 'Клинок', rarity: 'common', dmg: 12 },
  { name: 'Шип', rarity: 'common', dmg: 10 },
  { name: 'Буря', rarity: 'rare', dmg: 22 },
  { name: 'Яд', rarity: 'rare', dmg: 18 },
  { name: 'Гром', rarity: 'epic', dmg: 36 },
  { name: 'Феникс', rarity: 'epic', dmg: 42 },
  { name: 'Титан', rarity: 'legendary', dmg: 70 },
  { name: 'Пустота', rarity: 'legendary', dmg: 88 }
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
  coins: 0,
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
  inBattle: false
};

localStorage.setItem(PLAYER_KEY, state.id);

let turnTimer = null;
let turnEndsAt = 0;
let tickId = null;

const $ = (id) => document.getElementById(id);

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

function pickCard() {
  const r = Math.random();
  let rarity = 'common';
  if (r > 0.97) rarity = 'legendary';
  else if (r > 0.85) rarity = 'epic';
  else if (r > 0.55) rarity = 'rare';
  const pool = CARD_POOL.filter((c) => c.rarity === rarity);
  const c = pool[Math.floor(Math.random() * pool.length)];
  return { ...c, id: crypto.randomUUID(), num: randomNum() };
}

function ensureCardNums() {
  state.cards.forEach((c) => {
    if (!c.num) c.num = randomNum();
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
    if (state.turn === 'player' && state.queueNum != null) endPlayerTurn('время вышло');
  }, TURN_MS);
}

function log(msg) {
  $('battleLog').textContent = msg;
}

function render() {
  ensureCardNums();
  $('coins').textContent = state.coins;
  $('hpLabel').textContent = `${state.hp}/${state.maxHp}`;
  $('rollCost').textContent = `${rollPrice()} ◎`;
  $('hpCost').textContent = `${hpUpgradeCost()} ◎`;
  $('healCost').textContent = `${healCost()} ◎`;
  $('wave').textContent = state.wave;
  $('deckCount').textContent = state.cards.length;
  $('enemyDeck').textContent = state.enemyCards.length;
  const e = enemyForWave(state.wave);
  $('enemyName').textContent = e.name;
  $('enemyFace').textContent = e.face;
  $('enemyHp').textContent = `${Math.max(0, state.enemyHp)} / ${state.enemyMax}`;
  $('enemyBar').style.width = `${Math.max(0, (state.enemyHp / state.enemyMax) * 100)}%`;

  const qn = state.queueNum;
  $('queueInfo').textContent = state.inBattle
    ? state.turn === 'player'
      ? qn == null
        ? 'Твой ход: кинь карту — номер очереди зафиксируется'
        : `Очередь №${qn} · урон ${state.queueDmg} · кидай карты с тем же номером`
      : state.turn === 'enemy'
        ? `Ход врага · очередь №${qn ?? '—'} · урон ${state.queueDmg}`
        : 'Бой'
    : 'Начни бой, затем кидай карты одного номера';

  const left = turnEndsAt ? Math.max(0, Math.ceil((turnEndsAt - Date.now()) / 1000)) : 0;
  $('turnClock').textContent = state.turn === 'player' && qn != null ? `${left}с` : '';

  $('cards').innerHTML = state.cards
    .map((c) => {
      const locked = state.inBattle && state.turn === 'player' && qn != null && c.num !== qn;
      const playable = state.inBattle && state.turn === 'player' && !locked;
      return `<article class="card ${c.rarity} ${playable ? 'playable' : ''} ${locked ? 'locked' : ''}" data-id="${c.id}">
        <div class="row"><span class="r">${c.rarity}</span><span class="num">№${c.num}</span></div>
        <div class="n">${c.name}</div>
        <div class="d">⚔ ${c.dmg}</div>
      </article>`;
    })
    .join('');

  $('rollBtn').disabled = state.coins < rollPrice();
  $('hpUpBtn').disabled = state.coins < hpUpgradeCost();
  $('healBtn').disabled = state.coins < healCost() || state.hp >= state.maxHp;
  $('fightBtn').disabled = state.cards.length === 0 || state.hp <= 0 || state.inBattle;
  $('endTurnBtn').disabled = !(state.inBattle && state.turn === 'player' && state.queueNum != null);
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
    if (!res.ok) throw new Error('bad');
    $('sync').textContent = 'online';
    return await res.json();
  } catch {
    $('sync').textContent = 'offline';
    return null;
  }
}

function applyServer(data) {
  if (!data) return;
  Object.assign(state, data);
}

async function save() {
  localStorage.setItem('cbs_state', JSON.stringify(state));
  await api('/api/save', { ...state });
}

async function load() {
  const remote = await api(`/api/player/${state.id}`);
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
  render();
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
    startQueueTimer();
  }
  state.cards.splice(idx, 1);
  state.queueDmg += card.dmg;
  state.enemyHp -= card.dmg;
  log(`Кинул ${card.name} (№${card.num}, ⚔${card.dmg}). Сумма очереди ${state.queueDmg}.`);
  if (checkBattleEnd()) return;
  const more = state.cards.some((c) => c.num === state.queueNum);
  render();
  save();
  if (!more) endPlayerTurn('карт с этим номером больше нет');
}

function endPlayerTurn(reason) {
  if (state.turn !== 'player') return;
  clearTurnTimer();
  log(`Очередь закрыта (${reason}). Нанесено ${state.queueDmg}. Ход врага.`);
  state.turn = 'enemy';
  state.queueNum = null;
  state.queueDmg = 0;
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
  state.queueDmg = played.reduce((s, c) => s + c.dmg, 0);
  state.hp = Math.max(0, state.hp - state.queueDmg);
  log(`Враг закрыл очередь №${num}: ${played.length} карт, ⚔${state.queueDmg}.`);
  render();
  if (checkBattleEnd()) return;
  setTimeout(() => {
    state.turn = 'player';
    state.queueNum = null;
    state.queueDmg = 0;
    log('Твой ход. Выбери карту — номер очереди зафиксируется.');
    render();
    save();
  }, 1100);
}

function startBattle() {
  if (state.cards.length === 0 || state.hp <= 0 || state.inBattle) return;
  if (state.hp <= 0) return;
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
  log('Бой! Кидай карты одного номера, затем заверши очередь.');
  render();
  save();
}

$('clickBtn').addEventListener('click', (ev) => {
  state.coins += 1;
  floatText(ev.clientX, ev.clientY, '+1');
  render();
  save();
});

$('rollBtn').addEventListener('click', () => {
  const cost = rollPrice();
  if (state.coins < cost) return;
  state.coins -= cost;
  state.rolls += 1;
  const card = pickCard();
  state.cards.push(card);
  $('reveal').innerHTML = `<div class="r">${card.rarity} · №${card.num}</div><div style="font-size:42px">🃏</div><b>${card.name}</b><div class="d">Урон ${card.dmg}</div>`;
  $('modal').classList.remove('hidden');
  render();
  save();
});

$('modal').addEventListener('click', () => $('modal').classList.add('hidden'));

$('hpUpBtn').addEventListener('click', () => {
  const cost = hpUpgradeCost();
  if (state.coins < cost) return;
  state.coins -= cost;
  state.maxHp += 25;
  state.hp += 25;
  render();
  save();
});

$('healBtn').addEventListener('click', () => {
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

tickId = setInterval(() => {
  if (state.turn === 'player' && state.queueNum != null) render();
}, 400);

load();
