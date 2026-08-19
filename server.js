const express = require('express');
const cors = require('cors');
const Redis = require('ioredis');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 25314);
const REDIS_URL = process.env.REDIS_URL || 'redis://:oWBfA1drb5MzFMAfeDXe0R5Q@fi14.bot-hosting.cloud:25299';

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: false,
  connectTimeout: 8000
});

redis.on('error', (err) => console.error('redis', err.message));
redis.on('connect', () => console.log('redis connected'));

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '400kb' }));
app.use(express.static(__dirname));

function pkey(id) {
  return `cbs:player:${id}`;
}
function presenceKey(id) {
  return `cbs:presence:${id}`;
}
function inboxKey(id) {
  return `cbs:inbox:${id}`;
}
function duelKey(id) {
  return `cbs:duel:${id}`;
}

function sanitizeCards(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 80).map((c) => ({
    id: String(c.id || crypto.randomUUID()).slice(0, 80),
    name: String(c.name || 'Карта').slice(0, 40),
    rarity: String(c.rarity || 'common').slice(0, 20),
    num: Math.max(1, Math.min(5, Number(c.num) || 1)),
    type: c.type === 'heal' ? 'heal' : 'dmg',
    dmg: Math.max(0, Number(c.dmg) || 0),
    heal: Math.max(0, Number(c.heal) || 0)
  }));
}

function sanitize(body) {
  return {
    id: String(body.id || '').slice(0, 80),
    name: String(body.name || 'Боец').slice(0, 24),
    coins: Math.max(0, Number(body.coins) || 0),
    hp: Math.max(0, Number(body.hp) || 0),
    maxHp: Math.max(1, Number(body.maxHp) || 100),
    rolls: Math.max(0, Number(body.rolls) || 0),
    cards: sanitizeCards(body.cards),
    wave: Math.max(1, Number(body.wave) || 1),
    enemyHp: Math.max(0, Number(body.enemyHp) || 0),
    enemyMax: Math.max(1, Number(body.enemyMax) || 30),
    enemyCards: sanitizeCards(body.enemyCards),
    turn: ['idle', 'player', 'enemy'].includes(body.turn) ? body.turn : 'idle',
    queueNum: body.queueNum == null ? null : Number(body.queueNum),
    queueDmg: Math.max(0, Number(body.queueDmg) || 0),
    inBattle: Boolean(body.inBattle),
    duelId: body.duelId ? String(body.duelId).slice(0, 80) : null
  };
}

app.get('/api/health', async (_req, res) => {
  try {
    const pong = await redis.ping();
    res.json({ ok: true, redis: pong, port: PORT });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/player/:id', async (req, res) => {
  try {
    const raw = await redis.get(pkey(req.params.id));
    if (!raw) return res.json({ found: false });
    res.json({ found: true, player: JSON.parse(raw) });
  } catch (e) {
    res.status(500).json({ found: false, error: e.message });
  }
});

app.post('/api/save', async (req, res) => {
  try {
    const player = sanitize(req.body || {});
    if (!player.id) return res.status(400).json({ ok: false, error: 'id required' });
    await redis.set(pkey(player.id), JSON.stringify(player));
    res.json({ ok: true, player });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/presence', async (req, res) => {
  try {
    const id = String(req.body.id || '').slice(0, 80);
    if (!id) return res.status(400).json({ ok: false });
    const payload = {
      id,
      name: String(req.body.name || 'Боец').slice(0, 24),
      hp: Math.max(0, Number(req.body.hp) || 0),
      maxHp: Math.max(1, Number(req.body.maxHp) || 100),
      coins: Math.max(0, Number(req.body.coins) || 0),
      cards: Math.max(0, Number(req.body.cards) || 0),
      duelId: req.body.duelId || null,
      ts: Date.now()
    };
    await redis.set(presenceKey(id), JSON.stringify(payload), 'EX', 20);
    await redis.sadd('cbs:online', id);
    const inboxRaw = await redis.get(inboxKey(id));
    const inbox = inboxRaw ? JSON.parse(inboxRaw) : null;
    res.json({ ok: true, inbox });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/online', async (req, res) => {
  try {
    const me = String(req.query.me || '');
    const ids = await redis.smembers('cbs:online');
    const players = [];
    for (const id of ids) {
      const raw = await redis.get(presenceKey(id));
      if (!raw) {
        await redis.srem('cbs:online', id);
        continue;
      }
      const p = JSON.parse(raw);
      players.push(p);
    }
    res.json({ players });
  } catch (e) {
    res.status(500).json({ players: [], error: e.message });
  }
});

app.post('/api/duel/challenge', async (req, res) => {
  try {
    const from = String(req.body.from || '').slice(0, 80);
    const to = String(req.body.to || '').slice(0, 80);
    const fromName = String(req.body.fromName || 'Боец').slice(0, 24);
    if (!from || !to || from === to) return res.status(400).json({ ok: false, error: 'bad ids' });
    const targetOnline = await redis.get(presenceKey(to));
    if (!targetOnline) return res.status(404).json({ ok: false, error: 'игрок оффлайн' });
    const existing = await redis.get(inboxKey(to));
    if (existing) {
      const box = JSON.parse(existing);
      if (box.type === 'duel') return res.status(409).json({ ok: false, error: 'уже в дуэли' });
      if (box.type === 'challenge') return res.status(409).json({ ok: false, error: 'уже есть вызов' });
    }
    const myBox = await redis.get(inboxKey(from));
    if (myBox) {
      const box = JSON.parse(myBox);
      if (box.type === 'duel') return res.status(409).json({ ok: false, error: 'ты уже в дуэли' });
    }
    const challenge = { type: 'challenge', from, fromName, to, at: Date.now() };
    await redis.set(inboxKey(to), JSON.stringify(challenge), 'EX', 60);
    res.json({ ok: true, challenge });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/duel/respond', async (req, res) => {
  try {
    const to = String(req.body.to || '').slice(0, 80);
    const accept = Boolean(req.body.accept);
    const raw = await redis.get(inboxKey(to));
    if (!raw) return res.status(404).json({ ok: false, error: 'нет вызова' });
    const box = JSON.parse(raw);
    if (box.type !== 'challenge') return res.status(400).json({ ok: false, error: 'это не вызов' });
    await redis.del(inboxKey(to));
    if (!accept) {
      await redis.set(
        inboxKey(box.from),
        JSON.stringify({ type: 'declined', by: to, at: Date.now() }),
        'EX',
        15
      );
      return res.json({ ok: true, accepted: false });
    }
    const aRaw = await redis.get(pkey(box.from));
    const bRaw = await redis.get(pkey(to));
    const a = aRaw ? JSON.parse(aRaw) : null;
    const b = bRaw ? JSON.parse(bRaw) : null;
    if (!a || !b) return res.status(400).json({ ok: false, error: 'нет сохранений' });
    if (!a.cards?.length || !b.cards?.length) {
      return res.status(400).json({ ok: false, error: 'нужна хотя бы одна карта у обоих' });
    }
    const duelId = crypto.randomUUID();
    const duel = {
      id: duelId,
      a: { id: a.id, name: a.name || box.fromName, hp: a.hp, maxHp: a.maxHp, cards: sanitizeCards(a.cards) },
      b: { id: b.id, name: b.name || 'Боец', hp: b.hp, maxHp: b.maxHp, cards: sanitizeCards(b.cards) },
      turn: 'a',
      queueNum: null,
      queueDmg: 0,
      queueHeal: 0,
      log: 'Дуэль началась. Ходит вызывающий.',
      winner: null,
      ended: false
    };
    await redis.set(duelKey(duelId), JSON.stringify(duel), 'EX', 3600);
    const pointer = { type: 'duel', duelId };
    await redis.set(inboxKey(a.id), JSON.stringify(pointer), 'EX', 3600);
    await redis.set(inboxKey(b.id), JSON.stringify(pointer), 'EX', 3600);
    a.duelId = duelId;
    b.duelId = duelId;
    a.inBattle = false;
    b.inBattle = false;
    await redis.set(pkey(a.id), JSON.stringify(a));
    await redis.set(pkey(b.id), JSON.stringify(b));
    res.json({ ok: true, accepted: true, duel });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/duel/:id', async (req, res) => {
  try {
    const raw = await redis.get(duelKey(req.params.id));
    if (!raw) return res.json({ found: false });
    res.json({ found: true, duel: JSON.parse(raw) });
  } catch (e) {
    res.status(500).json({ found: false, error: e.message });
  }
});

function sideOf(duel, playerId) {
  if (duel.a.id === playerId) return 'a';
  if (duel.b.id === playerId) return 'b';
  return null;
}

function applyEnd(duel) {
  if (duel.a.hp <= 0 && duel.b.hp <= 0) {
    duel.ended = true;
    duel.winner = 'draw';
    duel.log = 'Оба пали. Ничья.';
  } else if (duel.a.hp <= 0) {
    duel.ended = true;
    duel.winner = 'b';
    duel.log = `${duel.b.name} побеждает!`;
  } else if (duel.b.hp <= 0) {
    duel.ended = true;
    duel.winner = 'a';
    duel.log = `${duel.a.name} побеждает!`;
  }
}

app.post('/api/duel/play', async (req, res) => {
  try {
    const duelId = String(req.body.duelId || '');
    const playerId = String(req.body.playerId || '');
    const cardId = String(req.body.cardId || '');
    const raw = await redis.get(duelKey(duelId));
    if (!raw) return res.status(404).json({ ok: false, error: 'дуэль не найдена' });
    const duel = JSON.parse(raw);
    if (duel.ended) return res.json({ ok: true, duel });
    const side = sideOf(duel, playerId);
    if (!side || duel.turn !== side) return res.status(400).json({ ok: false, error: 'не твой ход' });
    const me = duel[side];
    const foe = duel[side === 'a' ? 'b' : 'a'];
    const idx = me.cards.findIndex((c) => c.id === cardId);
    if (idx < 0) return res.status(400).json({ ok: false, error: 'нет карты' });
    const card = me.cards[idx];
    if (duel.queueNum != null && card.num !== duel.queueNum) {
      return res.status(400).json({ ok: false, error: `очередь №${duel.queueNum}` });
    }
    if (duel.queueNum == null) {
      duel.queueNum = card.num;
      duel.queueDmg = 0;
      duel.queueHeal = 0;
    }
    me.cards.splice(idx, 1);
    if (card.type === 'heal') {
      const h = card.heal || 0;
      me.hp = Math.min(me.maxHp, me.hp + h);
      duel.queueHeal += h;
      duel.log = `${me.name} хил ${card.name} +${h} (№${card.num})`;
    } else {
      const d = card.dmg || 0;
      foe.hp = Math.max(0, foe.hp - d);
      duel.queueDmg += d;
      duel.log = `${me.name} урон ${card.name} ⚔${d} (№${card.num})`;
    }
    applyEnd(duel);
    const more = me.cards.some((c) => c.num === duel.queueNum);
    if (!more && !duel.ended) {
      duel.turn = side === 'a' ? 'b' : 'a';
      duel.queueNum = null;
      duel.queueDmg = 0;
      duel.queueHeal = 0;
      duel.log += ' · очередь закрыта, ход соперника.';
    }
    await redis.set(duelKey(duelId), JSON.stringify(duel), 'EX', 3600);
    res.json({ ok: true, duel });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/duel/endTurn', async (req, res) => {
  try {
    const duelId = String(req.body.duelId || '');
    const playerId = String(req.body.playerId || '');
    const raw = await redis.get(duelKey(duelId));
    if (!raw) return res.status(404).json({ ok: false });
    const duel = JSON.parse(raw);
    const side = sideOf(duel, playerId);
    if (!side || duel.turn !== side || duel.ended) return res.json({ ok: true, duel });
    if (duel.queueNum == null) return res.status(400).json({ ok: false, error: 'кинь карту' });
    duel.turn = side === 'a' ? 'b' : 'a';
    duel.queueNum = null;
    duel.queueDmg = 0;
    duel.queueHeal = 0;
    duel.log = 'Очередь закрыта вручную. Ход соперника.';
    await redis.set(duelKey(duelId), JSON.stringify(duel), 'EX', 3600);
    res.json({ ok: true, duel });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/duel/leave', async (req, res) => {
  try {
    const playerId = String(req.body.playerId || '');
    const duelId = String(req.body.duelId || '');
    const raw = await redis.get(duelKey(duelId));
    if (raw) {
      const duel = JSON.parse(raw);
      if (!duel.ended) {
        const side = sideOf(duel, playerId);
        if (side) {
          duel.ended = true;
          duel.winner = side === 'a' ? 'b' : 'a';
          duel.log = 'Соперник сдался.';
          await redis.set(duelKey(duelId), JSON.stringify(duel), 'EX', 120);
        }
      }
    }
    await redis.del(inboxKey(playerId));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CBS backend on ${PORT}`);
});
