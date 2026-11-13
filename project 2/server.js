'use strict';
/*
 * עולם המדינות - שרת משחק אונליין
 * ללא תלויות חיצוניות: מספיק Node.js 18 ומעלה.
 * הרצה:  node server.js   ואז לפתוח  http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/game.js': ['game.js', 'application/javascript; charset=utf-8'],
  '/globe.js': ['globe.js', 'application/javascript; charset=utf-8'],
  '/countries-110m.json': ['countries-110m.json', 'application/json; charset=utf-8'],
};

// ---------- חוקי המשחק ----------
const TICK_MS = 5000;                 // כל 5 שניות: הכנסות וגידול אוכלוסייה
const WAR_TRAVEL_MS = 20000;          // זמן הגעת הצבא (לפני שדרוג לוגיסטיקה)
const ATTACK_COOLDOWN_MS = 30000;
const SHIELD_AFTER_LOSS_MS = 120000;
const NEW_PLAYER_SHIELD_MS = 300000;
const MIN_DISTANCE_DEG = 7;           // מרחק מינימלי בין בירות

const UNITS = {
  soldier: { name: 'חייל', price: 50, crew: 1, power: 1, upkeep: 0.05 },
  tank: { name: 'טנק', price: 3000, crew: 4, power: 40, upkeep: 1 },
  plane: { name: 'מטוס קרב', price: 9000, crew: 2, power: 120, upkeep: 3 },
  missile: { name: 'טיל', price: 5000, crew: 0, power: 200, upkeep: 0.5 },
};
const UNIT_KEYS = Object.keys(UNITS);
const DEFENSE_KEYS = ['soldier', 'tank', 'plane']; // טילים משמשים רק להתקפה

const SHOP = {
  ...UNITS,
  settlers: { name: 'מתיישבים (100 תושבים)', price: 800 },
  house: { name: 'בית', price: 2000 },
  factory: { name: 'מפעל', price: 5000 },
};

const UPGRADES = {
  economy: { name: 'כלכלה', base: 4000, max: 10 },    // +20% מסים
  housing: { name: 'דיור', base: 3000, max: 10 },     // +25% תושבים לכל בית
  industry: { name: 'תעשייה', base: 6000, max: 10 },  // +25% הכנסה ממפעלים
  weapons: { name: 'נשק', base: 8000, max: 10 },      // +10% כוח התקפה
  armor: { name: 'שריון', base: 8000, max: 10 },      // +10% כוח הגנה
  logistics: { name: 'לוגיסטיקה', base: 5000, max: 10 }, // הצבא מגיע מהר יותר
};
const UPGRADE_KEYS = Object.keys(UPGRADES);

const LAND_BLOCK = 10;
const BASE_CAP = 2000;
const HOUSE_CAP = 1000;
const FACTORY_INCOME = 40;
const TAX = 0.1;
const MIN_POP = 100;
const STAKES = { land: 'שטח', equipment: 'כלים', money: 'כסף' };

const upCost = (p, k) => Math.round(UPGRADES[k].base * Math.pow(1.7, p.up[k]));
const landPrice = (p) => Math.round(p.land * 150);
const maxBuildings = (p) => Math.floor(p.land / 2);
const popCap = (p) => Math.floor(BASE_CAP + p.houses * HOUSE_CAP * (1 + 0.25 * p.up.housing));
const income = (p) => p.pop * TAX * (1 + 0.2 * p.up.economy) + p.factories * FACTORY_INCOME * (1 + 0.25 * p.up.industry);
const upkeep = (p) => UNIT_KEYS.reduce((s, k) => s + p[k] * UNITS[k].upkeep, 0);
const armyPower = (u) => UNIT_KEYS.reduce((s, k) => s + (u[k] || 0) * UNITS[k].power, 0);
const attackMult = (p) => 1 + 0.1 * p.up.weapons;
const defensePower = (p) => DEFENSE_KEYS.reduce((s, k) => s + p[k] * UNITS[k].power, 0) * (1 + 0.1 * p.up.armor);
const travelMs = (p) => Math.round(WAR_TRAVEL_MS * Math.max(0.3, 1 - 0.07 * p.up.logistics));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const now = () => Date.now();
const newId = (n = 8) => crypto.randomBytes(n).toString('hex');

function angDist(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const c = Math.sin(lat1 * r) * Math.sin(lat2 * r) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon1 - lon2) * r);
  return Math.acos(clamp(c, -1, 1)) / r;
}

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

// ---------- מצב ושמירה ----------
let db = { servers: {} };
const tokens = new Map();   // token -> { sid, pid }
const clients = new Map();  // sid -> Set<{ res, pid }>
let dirty = false;

const DEFAULT_SERVERS = [
  ['s1', 'שרת 1 · ישראל', 1],
  ['s2', 'שרת 2 · אירופה', 1],
  ['s3', 'שרת 3 · עולמי', 1],
  ['s4', 'שרת 4 · מהיר ⚡', 3],
];

// נקודות יבשה ידועות, לשחקנים ישנים בלי מיקום
const LAND_SPOTS = [[31, 35], [48, 2], [40, -100], [-15, -55], [5, 20], [60, 90], [-25, 135], [35, 105], [22, 78], [55, 40], [-5, 25], [45, -75], [-35, -65], [64, 20]];

function makeServer(id, name, speed, isPrivate = false, code = null) {
  return { id, name, speed, private: isPrivate, code, created: now(), players: {}, wars: [], chat: [], news: [] };
}

function migratePlayer(p) {
  p.up = { ...Object.fromEntries(UPGRADE_KEYS.map((k) => [k, 0])), ...(p.up || {}) };
  if (typeof p.lat !== 'number') {
    const [la, lo] = LAND_SPOTS[Math.floor(Math.random() * LAND_SPOTS.length)];
    p.lat = la + rand(-4, 4);
    p.lon = lo + rand(-4, 4);
  }
  p.tokens ||= [];
  p.friends ||= [];
  p.log ||= [];
  delete p.hash;
  delete p.salt;
}

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('לא הצלחתי לקרוא את data.json, מתחיל עולם חדש', e.message);
    db = { servers: {} };
  }
  for (const [id, name, speed] of DEFAULT_SERVERS) {
    if (!db.servers[id]) db.servers[id] = makeServer(id, name, speed);
  }
  for (const srv of Object.values(db.servers)) {
    for (const p of Object.values(srv.players)) {
      migratePlayer(p);
      for (const t of p.tokens) tokens.set(t, { sid: srv.id, pid: p.id });
    }
    for (const w of srv.wars) w.mult ||= 1;
  }
}

function save() {
  if (!dirty) return;
  dirty = false;
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- עזרי שחקן ----------
const nameKey = (n) => n.trim().toLowerCase();

function validFlag(flag) {
  return typeof flag === 'string' && flag.length < 400000 &&
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(flag);
}

function getServer(sid) {
  const srv = db.servers[sid];
  if (!srv) fail('השרת לא נמצא');
  return srv;
}

function auth(body) {
  const t = tokens.get(body.token);
  if (!t) fail('המדינה לא נמצאה');
  const srv = db.servers[t.sid];
  const p = srv && srv.players[t.pid];
  if (!p) fail('המדינה לא נמצאה');
  return { srv, p };
}

function int(v, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) fail('כמות לא חוקית');
  return n;
}

function pushLog(srv, p, text, kind = 'info') {
  p.log.unshift({ t: now(), text, kind });
  if (p.log.length > 60) p.log.length = 60;
  emitTo(srv, p.id, 'toast', { text, kind });
}

function pushNews(srv, text) {
  srv.news.unshift({ t: now(), text });
  if (srv.news.length > 40) srv.news.length = 40;
}

// ---------- תצוגות ----------
function onlineIds(srv) {
  const set = clients.get(srv.id);
  return new Set(set ? [...set].map((c) => c.pid) : []);
}

function serverSummary(srv) {
  return {
    id: srv.id, name: srv.name, speed: srv.speed, private: srv.private,
    code: srv.private ? srv.code : undefined,
    players: Object.keys(srv.players).length, online: onlineIds(srv).size,
  };
}

function publicPlayers(srv) {
  const on = onlineIds(srv);
  const t = now();
  return Object.values(srv.players).map((p) => {
    const power = Math.floor(defensePower(p));
    return {
      id: p.id, name: p.name, flagV: p.flagV, lat: p.lat, lon: p.lon,
      land: p.land, pop: Math.floor(p.pop), houses: p.houses, factories: p.factories,
      soldier: p.soldier, tank: p.tank, plane: p.plane, missile: p.missile,
      power, attack: Math.floor(armyPower(p) * attackMult(p)), wins: p.wins, losses: p.losses,
      score: Math.floor(p.land * 20 + p.pop / 10 + power / 2 + p.factories * 50),
      online: on.has(p.id), shieldUntil: p.shieldUntil > t ? p.shieldUntil : 0,
    };
  }).sort((a, b) => b.score - a.score);
}

function meView(p) {
  return {
    id: p.id, name: p.name, flagV: p.flagV, lat: p.lat, lon: p.lon,
    money: Math.floor(p.money), pop: Math.floor(p.pop), cap: popCap(p),
    land: p.land, houses: p.houses, factories: p.factories, maxBuildings: maxBuildings(p),
    landPrice: landPrice(p),
    soldier: p.soldier, tank: p.tank, plane: p.plane, missile: p.missile,
    power: Math.floor(defensePower(p)), attackMult: attackMult(p),
    income: Math.floor(income(p)), upkeep: Math.ceil(upkeep(p)),
    up: p.up, upCosts: Object.fromEntries(UPGRADE_KEYS.map((k) => [k, upCost(p, k)])),
    travelMs: travelMs(p),
    shieldUntil: p.shieldUntil, cooldownUntil: p.lastAttack + ATTACK_COOLDOWN_MS,
    friends: p.friends, log: p.log, wins: p.wins, losses: p.losses,
  };
}

function warsView(srv, pid) {
  return srv.wars.map((w) => ({
    id: w.id, stake: w.stake, start: w.start, resolveAt: w.resolveAt,
    attackerId: w.attackerId, attackerName: w.attackerName,
    defenderId: w.defenderId, defenderName: w.defenderName,
    power: Math.floor(armyPower(w.sent) * w.mult),
    sent: w.attackerId === pid ? w.sent : undefined,
  }));
}

function chatFor(srv, pid) {
  return srv.chat.filter((m) => !m.to || m.to === pid || m.from === pid).slice(-60);
}

function statePayload(srv, p, players) {
  return {
    now: now(),
    server: { id: srv.id, name: srv.name, speed: srv.speed, private: srv.private, code: srv.private ? srv.code : undefined },
    me: meView(p),
    players: players || publicPlayers(srv),
    wars: warsView(srv, p.id),
    news: srv.news.slice(0, 25),
    rules: { shop: SHOP, upgrades: UPGRADES, minPop: MIN_POP, landBlock: LAND_BLOCK },
  };
}

// ---------- זרם עדכונים (SSE) ----------
function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function emitTo(srv, pid, event, data) {
  const set = clients.get(srv.id);
  if (!set) return;
  for (const c of set) if (c.pid === pid) sse(c.res, event, data);
}

function emitAll(srv, event, data) {
  const set = clients.get(srv.id);
  if (set) for (const c of set) sse(c.res, event, data);
}

function broadcastState(srv) {
  const set = clients.get(srv.id);
  if (!set || !set.size) return;
  const players = publicPlayers(srv);
  for (const c of set) {
    const p = srv.players[c.pid];
    if (p) sse(c.res, 'state', statePayload(srv, p, players));
  }
}

function openStream(req, res, url) {
  const t = tokens.get(url.searchParams.get('token'));
  const srv = t && db.servers[t.sid];
  const p = srv && srv.players[t.pid];
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (!p) {
    sse(res, 'autherror', { error: 'המדינה לא נמצאה' });
    return res.end();
  }
  if (!clients.has(srv.id)) clients.set(srv.id, new Set());
  const client = { res, pid: p.id };
  clients.get(srv.id).add(client);
  sse(res, 'init', { ...statePayload(srv, p), chat: chatFor(srv, p.id) });
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    clients.get(srv.id).delete(client);
  });
}

// ---------- פעולות API ----------
const ACTIONS = {
  servers({ ids }) {
    const want = new Set(Array.isArray(ids) ? ids : []);
    return {
      servers: Object.values(db.servers)
        .filter((s) => !s.private || want.has(s.id))
        .map(serverSummary),
    };
  },

  // מדינות בשרת (לתצוגה על הגלובוס לפני הצטרפות)
  peek({ serverId }) {
    const srv = getServer(serverId);
    return { players: publicPlayers(srv) };
  },

  createPrivate({ name, speed }) {
    name = String(name || '').trim();
    if (name.length < 2 || name.length > 30) fail('שם השרת צריך להיות בין 2 ל-30 תווים');
    const sp = [1, 2, 3].includes(Number(speed)) ? Number(speed) : 1;
    let code;
    do code = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
    while (Object.values(db.servers).some((s) => s.code === code));
    const srv = makeServer('p_' + newId(5), name, sp, true, code);
    db.servers[srv.id] = srv;
    dirty = true;
    return { server: serverSummary(srv) };
  },

  joinCode({ code }) {
    code = String(code || '').trim().toUpperCase();
    const srv = Object.values(db.servers).find((s) => s.private && s.code === code);
    if (!srv) fail('לא נמצא שרת עם הקוד הזה');
    return { server: serverSummary(srv) };
  },

  register({ serverId, name, flag, lat, lon }) {
    const srv = getServer(serverId);
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 20) fail('שם המדינה צריך להיות בין 2 ל-20 תווים');
    if (!validFlag(flag)) fail('יש לבחור תמונה לדגל');
    lat = Number(lat); lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 80 || Math.abs(lon) > 180) fail('יש לבחור מיקום על הגלובוס');
    if (Object.values(srv.players).some((p) => p.nameKey === nameKey(name))) fail('כבר קיימת מדינה בשם הזה בשרת');
    if (Object.values(srv.players).some((p) => angDist(lat, lon, p.lat, p.lon) < MIN_DISTANCE_DEG)) fail('המקום הזה קרוב מדי למדינה אחרת, בחר מקום אחר');
    const p = {
      id: newId(6), name, nameKey: nameKey(name), tokens: [], lat, lon,
      flag, flagV: 1, created: now(),
      money: 10000, pop: 5000, land: 100, houses: 4, factories: 2,
      soldier: 300, tank: 3, plane: 0, missile: 0,
      up: Object.fromEntries(UPGRADE_KEYS.map((k) => [k, 0])),
      shieldUntil: now() + NEW_PLAYER_SHIELD_MS, lastAttack: 0,
      friends: [], log: [], wins: 0, losses: 0, lastChat: 0,
    };
    p.log.push({ t: now(), text: `המדינה ${name} נוסדה! יש לך מגן של 5 דקות.`, kind: 'good' });
    srv.players[p.id] = p;
    pushNews(srv, `🎉 מדינה חדשה הצטרפה לעולם: ${name}`);
    dirty = true;
    broadcastState(srv);
    return { token: issueToken(srv, p) };
  },

  buy(body) {
    const { srv, p } = auth(body);
    const item = SHOP[body.item];
    if (!item) fail('פריט לא מוכר');
    const n = int(body.amount, 1, 1000000);
    const cost = item.price * n;
    if (p.money < cost) fail('אין מספיק כסף');
    if (UNITS[body.item]) {
      const crew = UNITS[body.item].crew * n;
      if (Math.floor(p.pop) - crew < MIN_POP) fail('אין מספיק תושבים שיפעילו את זה');
      p.pop -= crew;
      p[body.item] += n;
    } else if (body.item === 'settlers') {
      if (p.pop + n * 100 > popCap(p)) fail('אין מקום לתושבים חדשים. בנה עוד בתים');
      p.pop += n * 100;
    } else {
      if (p.houses + p.factories + n > maxBuildings(p)) fail('אין מספיק שטח לבנייה. הרחב את השטח בשדרוגים [F]');
      p[body.item === 'house' ? 'houses' : 'factories'] += n;
    }
    p.money -= cost;
    dirty = true;
    broadcastState(srv);
    return { ok: true };
  },

  upgrade(body) {
    const { srv, p } = auth(body);
    if (body.key === 'land') {
      const price = landPrice(p);
      if (p.money < price) fail('אין מספיק כסף');
      p.money -= price;
      p.land += LAND_BLOCK;
    } else {
      const u = UPGRADES[body.key];
      if (!u) fail('שדרוג לא מוכר');
      if (p.up[body.key] >= u.max) fail('השדרוג כבר ברמה המקסימלית');
      const price = upCost(p, body.key);
      if (p.money < price) fail('אין מספיק כסף');
      p.money -= price;
      p.up[body.key]++;
    }
    dirty = true;
    broadcastState(srv);
    return { ok: true };
  },

  attack(body) {
    const { srv, p } = auth(body);
    const target = srv.players[body.targetId];
    if (!target) fail('המדינה לא נמצאה');
    if (target.id === p.id) fail('אי אפשר לתקוף את עצמך');
    if (!STAKES[body.stake]) fail('יש לבחור על מה המלחמה');
    const t = now();
    if (target.shieldUntil > t) fail('למדינה הזו יש מגן כרגע');
    if (p.lastAttack + ATTACK_COOLDOWN_MS > t) fail('הצבא שלך עדיין מתארגן, המתן מעט');
    const sent = {};
    for (const k of UNIT_KEYS) {
      const v = Math.floor(Number(body.units?.[k]) || 0);
      if (v < 0 || v > p[k]) fail(`אין לך מספיק ${UNITS[k].name}`);
      sent[k] = v;
    }
    if (armyPower(sent) <= 0) fail('יש לשלוח לפחות יחידה אחת');
    for (const k of UNIT_KEYS) p[k] -= sent[k];
    p.lastAttack = t;
    p.shieldUntil = 0; // מי שתוקף מאבד את המגן שלו
    const travel = travelMs(p);
    const war = {
      id: newId(6), attackerId: p.id, attackerName: p.name, defenderId: target.id, defenderName: target.name,
      stake: body.stake, sent, mult: attackMult(p), start: t, resolveAt: t + travel,
    };
    srv.wars.push(war);
    const power = Math.floor(armyPower(sent) * war.mult);
    pushLog(srv, p, `⚔️ הצבא שלך יצא לתקוף את ${target.name} על ${STAKES[war.stake]}! מגיע בעוד ${Math.round(travel / 1000)} שניות.`, 'warn');
    pushLog(srv, target, `🚨 ${p.name} תוקפת אותך על ${STAKES[war.stake]}! עוצמה: ${power}. יש לך ${Math.round(travel / 1000)} שניות להתכונן!`, 'bad');
    pushNews(srv, `⚔️ ${p.name} הכריזה מלחמה על ${target.name} (${STAKES[war.stake]})`);
    dirty = true;
    broadcastState(srv);
    return { ok: true };
  },

  chat(body) {
    const { srv, p } = auth(body);
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) fail('ההודעה ריקה');
    if (now() - (p.lastChat || 0) < 800) fail('לאט לאט...');
    p.lastChat = now();
    const msg = { id: newId(5), t: now(), from: p.id, fromName: p.name, flagV: p.flagV, text };
    if (body.to) {
      const to = srv.players[body.to];
      if (!to) fail('השחקן לא נמצא');
      msg.to = to.id;
      msg.toName = to.name;
    }
    srv.chat.push(msg);
    if (srv.chat.length > 200) srv.chat.splice(0, srv.chat.length - 200);
    const set = clients.get(srv.id);
    if (set) for (const c of set) if (!msg.to || c.pid === msg.to || c.pid === msg.from) sse(c.res, 'chat', msg);
    dirty = true;
    return { ok: true };
  },

  setFlag(body) {
    const { srv, p } = auth(body);
    if (!validFlag(body.flag)) fail('תמונה לא חוקית');
    p.flag = body.flag;
    p.flagV++;
    dirty = true;
    broadcastState(srv);
    return { ok: true };
  },

  friend(body) {
    const { srv, p } = auth(body);
    const target = srv.players[body.targetId];
    if (!target || target.id === p.id) fail('שחקן לא חוקי');
    if (p.friends.includes(target.id)) {
      p.friends = p.friends.filter((f) => f !== target.id);
    } else {
      p.friends.push(target.id);
      pushLog(srv, target, `🤝 ${p.name} הוסיפה אותך לחברים`, 'good');
    }
    dirty = true;
    broadcastState(srv);
    return { ok: true };
  },
};

function issueToken(srv, p) {
  const t = newId(24);
  p.tokens.push(t);
  if (p.tokens.length > 10) tokens.delete(p.tokens.shift());
  tokens.set(t, { sid: srv.id, pid: p.id });
  dirty = true;
  return t;
}

// ---------- לוגיקת מלחמה ----------
function resolveWar(srv, war) {
  const A = srv.players[war.attackerId];
  const D = srv.players[war.defenderId];
  if (!A) return;
  if (!D) {
    for (const k of UNIT_KEYS) A[k] += war.sent[k];
    return pushLog(srv, A, 'המדינה שתקפת כבר לא קיימת, הצבא חזר הביתה.');
  }
  const ap = armyPower(war.sent) * war.mult * rand(0.85, 1.15);
  const dp = defensePower(D) * 1.2 * rand(0.85, 1.15); // בונוס הגנה 20%
  const win = ap > dp;
  const aLoss = dp <= 0 ? 0.02 : clamp(0.35 * dp / ap, 0.03, 0.85);
  const dLoss = clamp(0.35 * ap / Math.max(dp, 1), 0.03, 0.75);

  const aLost = {}; const dLost = {};
  for (const k of DEFENSE_KEYS) {
    aLost[k] = Math.ceil(war.sent[k] * aLoss);
    A[k] += war.sent[k] - aLost[k];
    dLost[k] = Math.min(D[k], Math.floor(D[k] * dLoss));
    D[k] -= dLost[k];
  }
  aLost.missile = war.sent.missile; // טילים נצרכים בשיגור

  const lostText = (l) => [
    l.soldier ? `${l.soldier} חיילים` : '', l.tank ? `${l.tank} טנקים` : '',
    l.plane ? `${l.plane} מטוסים` : '', l.missile ? `${l.missile} טילים` : '',
  ].filter(Boolean).join(', ') || 'כלום';

  let loot = '';
  if (win) {
    if (war.stake === 'land') {
      const take = Math.max(0, Math.min(Math.floor(D.land * 0.2), D.land - 20));
      D.land -= take; A.land += take;
      const maxB = maxBuildings(D);
      const total = D.houses + D.factories;
      if (total > maxB) {
        const ratio = maxB / total;
        D.houses = Math.floor(D.houses * ratio);
        D.factories = Math.floor(D.factories * ratio);
      }
      loot = `${take} קמ"ר שטח`;
    } else if (war.stake === 'money') {
      const take = Math.floor(D.money * 0.4);
      D.money -= take; A.money += take;
      loot = `${take.toLocaleString()} כסף`;
    } else {
      const got = {};
      for (const k of UNIT_KEYS) { got[k] = Math.floor(D[k] * 0.25); D[k] -= got[k]; A[k] += got[k]; }
      loot = lostText(got);
    }
    A.wins++; D.losses++;
    D.shieldUntil = now() + SHIELD_AFTER_LOSS_MS;
    pushLog(srv, A, `🏆 ניצחת את ${D.name}! לקחת ${loot}. איבדת: ${lostText(aLost)}.`, 'good');
    pushLog(srv, D, `💥 ${A.name} ניצחה אותך ולקחה ${loot}. איבדת: ${lostText(dLost)}. קיבלת מגן ל-2 דקות.`, 'bad');
    pushNews(srv, `🏆 ${A.name} ניצחה את ${D.name} ולקחה ${loot}`);
  } else {
    D.wins++; A.losses++;
    pushLog(srv, A, `☠️ ההתקפה על ${D.name} נכשלה. איבדת: ${lostText(aLost)}.`, 'bad');
    pushLog(srv, D, `🛡️ הדפת את ההתקפה של ${A.name}! איבדת: ${lostText(dLost)}.`, 'good');
    pushNews(srv, `🛡️ ${D.name} הדפה את ההתקפה של ${A.name}`);
  }
  const summary = { win, attacker: A.name, defender: D.name, stake: war.stake, loot, aPower: Math.round(ap), dPower: Math.round(dp) };
  emitTo(srv, A.id, 'battle', { ...summary, you: 'attacker' });
  emitTo(srv, D.id, 'battle', { ...summary, you: 'defender' });
  emitAll(srv, 'explosion', { lat: D.lat, lon: D.lon, win });
}

function warLoop() {
  const t = now();
  for (const srv of Object.values(db.servers)) {
    const due = srv.wars.filter((w) => w.resolveAt <= t);
    if (!due.length) continue;
    srv.wars = srv.wars.filter((w) => w.resolveAt > t);
    for (const w of due) resolveWar(srv, w);
    dirty = true;
    broadcastState(srv);
  }
}

function economyTick() {
  for (const srv of Object.values(db.servers)) {
    const s = srv.speed;
    for (const p of Object.values(srv.players)) {
      p.money += (income(p) - upkeep(p)) * s;
      if (p.money < 0) { // אין כסף למשכורות - חיילים עוזבים
        p.money = 0;
        p.soldier = Math.floor(p.soldier * 0.98);
      }
      const cap = popCap(p);
      if (p.pop < cap) p.pop = Math.min(cap, p.pop + Math.max(5, p.pop * 0.015) * s);
      else if (p.pop > cap) p.pop = Math.max(cap, p.pop - p.pop * 0.02);
    }
    if (Object.keys(srv.players).length) dirty = true;
    broadcastState(srv);
  }
}

// ---------- HTTP ----------
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) { reject(new GameError('הבקשה גדולה מדי')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new GameError('בקשה לא תקינה')); }
    });
    req.on('error', reject);
  });
}

function serveFlag(res, url) {
  const [, , sid, pid] = url.pathname.split('/');
  const p = db.servers[sid]?.players[pid];
  const m = p && /^data:(image\/[a-z]+);base64,(.*)$/.exec(p.flag);
  if (!m) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.end(Buffer.from(m[2], 'base64'));
}

function serveStatic(res, pathname) {
  const f = STATIC_FILES[pathname];
  if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('לא נמצא'); }
  fs.readFile(path.join(ROOT, f[0]), (err, data) => {
    if (err) { res.writeHead(500); return res.end(); }
    res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const httpServer = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const handler = ACTIONS[url.pathname.slice(5)];
      if (!handler) return send(res, 404, { error: 'פעולה לא קיימת' });
      const body = await readBody(req);
      return send(res, 200, handler(body && typeof body === 'object' ? body : {}));
    }
    if (url.pathname === '/events') return openStream(req, res, url);
    if (url.pathname.startsWith('/flag/')) return serveFlag(res, url);
    return serveStatic(res, url.pathname);
  } catch (e) {
    if (e instanceof GameError) return send(res, 400, { error: e.message });
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'שגיאת שרת' });
  }
});

load();
setInterval(economyTick, TICK_MS);
setInterval(warLoop, 500);
setInterval(save, 15000);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { dirty = true; save(); process.exit(0); });
}

httpServer.listen(PORT, () => {
  console.log(`\n⚔️  עולם המדינות רץ!  http://localhost:${PORT}`);
  const nets = require('os').networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`   חברים באותה רשת:  http://${n.address}:${PORT}`);
    }
  }
});
