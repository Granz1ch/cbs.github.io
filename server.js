const express = require('express');
const cors = require('cors');
const Redis = require('ioredis');

const PORT = process.env.PORT || 3000;
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
app.use(express.json({ limit: '200kb' }));
app.use(express.static(__dirname));

function key(id) {
  return `cbs:player:${id}`;
}

function sanitize(body) {
  return {
    id: String(body.id || '').slice(0, 80),
    coins: Math.max(0, Number(body.coins) || 0),
    hp: Math.max(0, Number(body.hp) || 0),
    maxHp: Math.max(1, Number(body.maxHp) || 100),
    rolls: Math.max(0, Number(body.rolls) || 0),
    cards: Array.isArray(body.cards) ? body.cards.slice(0, 80) : [],
    wave: Math.max(1, Number(body.wave) || 1),
    enemyHp: Math.max(0, Number(body.enemyHp) || 0),
    enemyMax: Math.max(1, Number(body.enemyMax) || 30)
  };
}

app.get('/api/health', async (_req, res) => {
  try {
    const pong = await redis.ping();
    res.json({ ok: true, redis: pong });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/player/:id', async (req, res) => {
  try {
    const raw = await redis.get(key(req.params.id));
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
    await redis.set(key(player.id), JSON.stringify(player));
    res.json({ ok: true, player });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CBS backend on ${PORT}`);
});
