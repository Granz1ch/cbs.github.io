const API = window.CBS_API || (location.port === '3000' ? '' : 'http://127.0.0.1:3000');
const PLAYER_KEY = 'cbs_player_id';

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
  enemyMax: 30
};

localStorage.setItem(PLAYER_KEY, state.id);

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

function pickCard() {
  const r = Math.random();
  let rarity = 'common';
  if (r > 0.97) rarity = 'legendary';
  else if (r > 0.85) rarity = 'epic';
  else if (r > 0.55) rarity = 'rare';
  const pool = CARD_POOL.filter((c) => c.rarity === rarity);
  const c = pool[Math.floor(Math.random() * pool.length)];
  return { ...c, id: crypto.randomUUID() };
}

function render() {
  $('coins').textContent = state.coins;
  $('hpLabel').textContent = `${state.hp}/${state.maxHp}`;
  $('rollCost').textContent = `${rollPrice()} ◎`;
  $('hpCost').textContent = `${hpUpgradeCost()} ◎`;
  $('healCost').textContent = `${healCost()} ◎`;
  $('wave').textContent = state.wave;
  $('deckCount').textContent = state.cards.length;
  const e = enemyForWave(state.wave);
  $('enemyName').textContent = e.name;
  $('enemyFace').textContent = e.face;
  $('enemyHp').textContent = `${Math.max(0, state.enemyHp)} / ${state.enemyMax}`;
  $('enemyBar').style.width = `${Math.max(0, (state.enemyHp / state.enemyMax) * 100)}%`;

  $('cards').innerHTML = state.cards
    .map(
      (c) => `<article class="card ${c.rarity}">
        <div class="r">${c.rarity}</div>
        <div class="n">${c.name}</div>
        <div class="d">⚔ ${c.dmg}</div>
      </article>`
    )
    .join('');

  $('rollBtn').disabled = state.coins < rollPrice();
  $('hpUpBtn').disabled = state.coins < hpUpgradeCost();
  $('healBtn').disabled = state.coins < healCost() || state.hp >= state.maxHp;
  $('fightBtn').disabled = state.cards.length === 0 || state.hp <= 0;
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
  if (!state.enemyMax) {
    const e = enemyForWave(state.wave || 1);
    state.enemyMax = e.hp;
    state.enemyHp = e.hp;
  }
}

async function save() {
  localStorage.setItem('cbs_state', JSON.stringify(state));
  await api('/api/save', { ...state });
}

async function load() {
  const remote = await api(`/api/player/${state.id}`);
  if (remote && remote.found) {
    applyServer(remote.player);
  } else {
    const local = localStorage.getItem('cbs_state');
    if (local) Object.assign(state, JSON.parse(local));
  }
  if (!state.enemyMax) {
    const e = enemyForWave(state.wave);
    state.enemyHp = e.hp;
    state.enemyMax = e.hp;
  }
  render();
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
  $('reveal').innerHTML = `<div class="r">${card.rarity}</div><div style="font-size:42px">🃏</div><b>${card.name}</b><div class="d">Урон ${card.dmg}</div>`;
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

$('fightBtn').addEventListener('click', () => {
  if (!state.cards.length || state.hp <= 0) return;
  const dmg = state.cards.reduce((s, c) => s + c.dmg, 0);
  state.enemyHp -= dmg;
  const incoming = 8 + state.wave * 4;
  state.hp = Math.max(0, state.hp - incoming);
  let log = `Ты нанёс ${dmg}. Враг ударил на ${incoming}.`;
  if (state.enemyHp <= 0) {
    const reward = 20 + state.wave * 8;
    state.coins += reward;
    state.wave += 1;
    const e = enemyForWave(state.wave);
    state.enemyHp = e.hp;
    state.enemyMax = e.hp;
    log = `Победа! +${reward} ◎  Следующая волна ${state.wave}.`;
  }
  if (state.hp <= 0) {
    log = 'Ты пал. Подлечись и бей снова.';
    const e = enemyForWave(state.wave);
    state.enemyHp = e.hp;
    state.enemyMax = e.hp;
  }
  $('battleLog').textContent = log;
  render();
  save();
});

load();
