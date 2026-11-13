'use strict';
// =====================================================================
//  עולם המדינות - צד הלקוח
// =====================================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.floor(n).toLocaleString('en-US');
const short = (n) => {
  n = Math.floor(n);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return fmt(n);
};
const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const clock = (t) => new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;

async function api(action, body = {}) {
  const r = await fetch('/api/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({ error: 'שגיאת תקשורת' }));
  if (!r.ok || j.error) throw new Error(j.error || 'שגיאה');
  return j;
}

function toast(text, kind = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  $('#toasts').prepend(el);
  while ($('#toasts').children.length > 4) $('#toasts').lastChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 5000);
}

const store = {
  get tokens() { return JSON.parse(localStorage.getItem('ww_tokens') || '{}'); },
  setToken(sid, t) {
    const o = this.tokens;
    if (t) o[sid] = t; else delete o[sid];
    localStorage.setItem('ww_tokens', JSON.stringify(o));
  },
  get privates() { return JSON.parse(localStorage.getItem('ww_priv') || '[]'); },
  addPrivate(id) {
    const a = this.privates;
    if (!a.includes(id)) { a.push(id); localStorage.setItem('ww_priv', JSON.stringify(a)); }
  },
};

// =====================================================================
//  נתוני משחק
// =====================================================================
const ITEMS = {
  soldier: { ico: '🪖', name: 'חיילים', desc: 'כוח 1 · צריך תושב 1 · זול וחשוב להגנה' },
  tank: { ico: '🛡️', name: 'טנקים', desc: 'כוח 40 · צוות 4 תושבים · חזק בהגנה ובהתקפה' },
  plane: { ico: '✈️', name: 'מטוסי קרב', desc: 'כוח 120 · צוות 2 · הכוח החזק ביותר' },
  missile: { ico: '🚀', name: 'טילים', desc: 'כוח 200 · להתקפה בלבד · נהרס בשיגור' },
  settlers: { ico: '👨‍👩‍👧', name: 'תושבים', desc: '+100 תושבים מיד. צריך מקום פנוי בבתים' },
  house: { ico: '🏠', name: 'בתים', desc: '+1,000 מקום לתושבים · תופס 2 קמ"ר' },
  factory: { ico: '🏭', name: 'מפעלים', desc: '+40 כסף בכל סבב · תופס 2 קמ"ר' },
};
const MAP_ICON = { soldier: '🪖', tank: '🛡️', plane: '✈️', missile: '🚀', house: '🏠', factory: '🏭' };
const pct = (sign, n) => `<bdi dir="ltr">${sign}${n}%</bdi>`;
const upEff = (label, sign, now, next) => `${label}: <b>${pct(sign, now)}</b> ← ${pct(sign, next)}`;
const UPGRADE_INFO = {
  land: { ico: '🗺️', name: 'הרחבת שטח', eff: () => '+10 קמ"ר · מקום ל-5 בניינים נוספים' },
  economy: { ico: '💰', name: 'כלכלה', eff: (l) => upEff('מסים', '+', l * 20, (l + 1) * 20) },
  housing: { ico: '🏘️', name: 'דיור', eff: (l) => upEff('תושבים לכל בית', '+', l * 25, (l + 1) * 25) },
  industry: { ico: '🏭', name: 'תעשייה', eff: (l) => upEff('הכנסה ממפעלים', '+', l * 25, (l + 1) * 25) },
  weapons: { ico: '⚔️', name: 'נשק', eff: (l) => upEff('כוח התקפה', '+', l * 10, (l + 1) * 10) },
  armor: { ico: '🛡️', name: 'שריון', eff: (l) => upEff('כוח הגנה', '+', l * 10, (l + 1) * 10) },
  logistics: { ico: '🚚', name: 'לוגיסטיקה', eff: (l) => upEff('זמן הגעת הצבא', '-', l * 7, Math.min(70, (l + 1) * 7)) },
};
const STAKES = {
  land: { i: '🗺️', name: 'שטח', desc: '20% מהשטח' },
  equipment: { i: '🛡️', name: 'כלים', desc: '25% מהצבא' },
  money: { i: '💰', name: 'כסף', desc: '40% מהכסף' },
};
const UNIT_KEYS = ['soldier', 'tank', 'plane', 'missile'];
const UNIT_POWER = { soldier: 1, tank: 40, plane: 120, missile: 200 };

const G = {
  mode: 'lobby', // lobby | create | game
  sid: null, token: null, es: null, state: null, offset: 0,
  servers: [], lobbyPlayers: [], selectedServer: null,
  place: null, hover: null, selected: null, chatTo: null, feed: 'news',
  effects: [], panel: null, attackTarget: null, attackStake: 'land',
};
const serverNow = () => Date.now() + G.offset;
const players = () => (G.mode === 'game' && G.state ? G.state.players : G.lobbyPlayers);
const me = () => G.state?.me;
const flagUrl = (sid, pid, v) => `/flag/${sid}/${pid}?v=${v}`;

// =====================================================================
//  דגלים
// =====================================================================
const EMBLEMS = ['🦁', '🦅', '🐉', '⭐', '🌙', '☀️', '⚔️', '🛡️', '🔥', '🌊', '🌲', '🏔️', '👑', '🐺', '⚓', '⚡', '🐻', '🌹'];
const PALETTES = [
  ['#c0392b', '#f1c40f'], ['#1e3a8a', '#ffffff'], ['#166534', '#fde047'], ['#111827', '#ef4444'],
  ['#7c3aed', '#f5f5f5'], ['#0e7490', '#fef3c7'], ['#b45309', '#1f2937'], ['#be185d', '#fce7f3'],
  ['#065f46', '#f87171'], ['#1d4ed8', '#facc15'], ['#7f1d1d', '#e5e7eb'], ['#334155', '#38bdf8'],
  ['#ea580c', '#ffffff'], ['#4c1d95', '#fbbf24'], ['#0f766e', '#0f172a'], ['#991b1b', '#000000'],
  ['#0369a1', '#f0f9ff'], ['#3f6212', '#fef08a'],
];

function makePresetFlag(i) {
  const c = document.createElement('canvas');
  c.width = 150; c.height = 100;
  const x = c.getContext('2d');
  const [a, b] = PALETTES[i];
  x.fillStyle = a; x.fillRect(0, 0, 150, 100);
  x.fillStyle = b;
  switch (i % 4) {
    case 0: x.fillRect(0, 33, 150, 34); break;
    case 1: x.fillRect(50, 0, 50, 100); break;
    case 2: x.beginPath(); x.moveTo(0, 0); x.lineTo(150, 100); x.lineTo(0, 100); x.fill(); break;
    default: x.fillRect(0, 0, 150, 18); x.fillRect(0, 82, 150, 18);
  }
  x.font = '46px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(EMBLEMS[i], 75, 54);
  return c.toDataURL('image/png');
}

function fileToFlag(file) {
  return new Promise((ok, bad) => {
    if (!file || !file.type.startsWith('image/')) return bad(new Error('יש לבחור קובץ תמונה'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 150; c.height = 100;
      const scale = Math.max(150 / img.width, 100 / img.height);
      const w = img.width * scale, h = img.height * scale;
      c.getContext('2d').drawImage(img, (150 - w) / 2, (100 - h) / 2, w, h);
      URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => bad(new Error('לא הצלחתי לקרוא את התמונה'));
    img.src = url;
  });
}

let presetCache = null;
function createFlagPicker(container) {
  presetCache ??= PALETTES.map((_, i) => makePresetFlag(i));
  let value = null;
  container.innerHTML = `
    <div class="presets">${presetCache.map((d, i) => `<img src="${d}" data-i="${i}" alt="">`).join('')}</div>
    <div class="upload-row">
      <img class="preview" alt="">
      <label class="btn sm">📁 העלה תמונה מהמחשב<input type="file" accept="image/*" hidden></label>
    </div>`;
  const preview = $('.preview', container);
  const set = (v) => { value = v; preview.src = v; };
  const imgs = $$('.presets img', container);
  imgs.forEach((img) => img.addEventListener('click', () => {
    imgs.forEach((i) => i.classList.remove('sel'));
    img.classList.add('sel');
    set(presetCache[img.dataset.i]);
  }));
  $('input[type=file]', container).addEventListener('change', async (e) => {
    try {
      set(await fileToFlag(e.target.files[0]));
      imgs.forEach((i) => i.classList.remove('sel'));
    } catch (err) { toast(err.message, 'bad'); }
  });
  const start = Math.floor(Math.random() * imgs.length);
  imgs[start].classList.add('sel');
  set(presetCache[start]);
  return { get value() { return value; } };
}

// מטמון תמונות דגלים ואימוג'ים לציור על המפה
const imgCache = new Map();
function flagImg(sid, pid, v) {
  const key = `${sid}/${pid}/${v}`;
  if (!imgCache.has(key)) {
    const img = new Image();
    img.src = flagUrl(sid, pid, v);
    imgCache.set(key, img);
  }
  return imgCache.get(key);
}
const sprites = new Map();
function sprite(emoji) {
  if (!sprites.has(emoji)) {
    const c = document.createElement('canvas');
    c.width = c.height = 72;
    const x = c.getContext('2d');
    x.font = '56px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = 'rgba(0,0,0,0.6)'; x.shadowBlur = 6; x.shadowOffsetY = 2;
    x.fillText(emoji, 36, 40);
    sprites.set(emoji, c);
  }
  return sprites.get(emoji);
}

// =====================================================================
//  ציור העולם על הגלובוס
// =====================================================================
const terrRadius = (land) => 2.2 + Math.sqrt(land) * 0.42; // במעלות
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) { return () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x6D2B79F5 >>> 0) / 4294967296); }
function colorOf(p) {
  const m = me();
  if (m && p.id === m.id) return [255, 200, 69];
  if (m && m.friends.includes(p.id)) return [62, 224, 143];
  const h = hashStr(p.id) % 360;
  // המרת HSL לצבע
  const s = 0.75, l = 0.6, k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round);
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function territoryPath(ctx, lat, lon, rDeg) {
  const C = Globe.center, R = Globe.radius;
  let visible = false;
  ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const [la, lo] = Globe.offset(lat, lon, (i / 64) * 360, rDeg);
    let p = Globe.project(la, lo);
    if (p.z > 0) visible = true;
    else {
      const dx = p.x - C.x, dy = p.y - C.y, len = Math.hypot(dx, dy) || 1;
      p = { x: C.x + dx / len * R, y: C.y + dy / len * R };
    }
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  }
  ctx.closePath();
  return visible;
}

function drawIcon(ctx, emoji, x, y, size, rot = 0, alpha = 1) {
  ctx.globalAlpha = alpha;
  if (rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.drawImage(sprite(emoji), -size / 2, -size / 2, size, size);
    ctx.restore();
  } else ctx.drawImage(sprite(emoji), x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = 1;
}

// כל מה שיש למדינה (בניינים, חיילים, טנקים...) מצויר בתוך השטח שלה
function drawCountryContents(ctx, p, rDeg, time, scale) {
  const counts = [
    ['house', Math.min(p.houses, 18)],
    ['factory', Math.min(p.factories, 12)],
    ['soldier', Math.min(Math.ceil(p.soldier / 40), 24)],
    ['tank', Math.min(p.tank, 16)],
    ['missile', Math.min(p.missile, 10)],
  ];
  for (const [type, n] of counts) {
    const r = rng(hashStr(p.id + type));
    for (let i = 0; i < n; i++) {
      const [la, lo] = Globe.offset(p.lat, p.lon, r() * 360, (0.18 + Math.sqrt(r()) * 0.72) * rDeg);
      const q = Globe.project(la, lo);
      if (q.z < 0.08) continue;
      const bob = type === 'soldier' ? Math.sin(time * 3 + i) * 1.2 : 0;
      drawIcon(ctx, MAP_ICON[type], q.x, q.y + bob, 21 * scale * (0.5 + 0.5 * q.z), type === 'missile' ? -0.6 : 0, 0.95);
    }
  }
  // מטוסים מסתובבים מעל המדינה
  const planes = Math.min(p.plane, 10);
  for (let i = 0; i < planes; i++) {
    const b = (i / planes) * 360 + time * 22;
    const d = rDeg * (0.55 + 0.25 * ((i % 3) / 2));
    const [la, lo] = Globe.offset(p.lat, p.lon, b, d);
    const [la2, lo2] = Globe.offset(p.lat, p.lon, b + 4, d);
    const q = Globe.project(la, lo, 1.02), q2 = Globe.project(la2, lo2, 1.02);
    if (q.z < 0.08) continue;
    const ang = Math.atan2(q2.y - q.y, q2.x - q.x);
    drawIcon(ctx, '✈️', q.x, q.y, 26 * scale * (0.5 + 0.5 * q.z), ang + Math.PI / 4);
  }
}

function drawFlagPin(ctx, p, sid, scale, highlight) {
  const q = Globe.project(p.lat, p.lon);
  if (q.z < 0.12) return;
  const s = scale * (0.55 + 0.45 * q.z);
  const fw = 34 * s, fh = 23 * s, pole = 30 * s;
  // עמוד
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.6 * s;
  ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, q.y - pole); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(q.x, q.y, 2.4 * s, 0, Math.PI * 2); ctx.fill();
  // דגל
  const img = flagImg(sid, p.id, p.flagV);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8;
  if (img.complete && img.naturalWidth) ctx.drawImage(img, q.x, q.y - pole, fw, fh);
  else { ctx.fillStyle = '#556'; ctx.fillRect(q.x, q.y - pole, fw, fh); }
  ctx.restore();
  if (highlight) { ctx.strokeStyle = '#ffc845'; ctx.lineWidth = 2; ctx.strokeRect(q.x, q.y - pole, fw, fh); }
  // שם
  const label = (p.shieldUntil > serverNow() ? '🔰 ' : '') + p.name;
  ctx.font = `700 ${Math.round(12 * s)}px Rubik, Segoe UI, sans-serif`;
  const tw = ctx.measureText(label).width + 14 * s;
  const ly = q.y + 8 * s;
  ctx.fillStyle = highlight ? 'rgba(255,200,69,0.92)' : 'rgba(8,12,24,0.72)';
  roundRect(ctx, q.x - tw / 2, ly, tw, 19 * s, 9 * s);
  ctx.fill();
  ctx.fillStyle = highlight ? '#1a1204' : '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, q.x, ly + 10 * s);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawWar(ctx, w, byId, time) {
  const A = byId.get(w.attackerId), D = byId.get(w.defenderId);
  if (!A || !D) return;
  const t = clamp((serverNow() - w.start) / (w.resolveAt - w.start), 0, 1);
  const m = me();
  const mine = m && (w.attackerId === m.id || w.defenderId === m.id);
  const pts = [];
  const N = 48;
  const dist = Math.acos(clamp(Math.sin(A.lat * DEG) * Math.sin(D.lat * DEG) + Math.cos(A.lat * DEG) * Math.cos(D.lat * DEG) * Math.cos((A.lon - D.lon) * DEG), -1, 1));
  const lift = 0.04 + dist * 0.12;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const [la, lo] = Globe.slerp(A.lat, A.lon, D.lat, D.lon, s);
    pts.push(Globe.project(la, lo, 1 + Math.sin(Math.PI * s) * lift));
  }
  ctx.save();
  ctx.lineWidth = mine ? 3 : 2;
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -time * 40;
  ctx.strokeStyle = mine ? 'rgba(255,77,94,0.95)' : 'rgba(255,140,100,0.6)';
  ctx.shadowColor = '#ff4d5e'; ctx.shadowBlur = mine ? 12 : 4;
  ctx.beginPath();
  let pen = false;
  for (const p of pts) {
    if (p.z > -0.05) { pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true; } else pen = false;
  }
  ctx.stroke();
  ctx.restore();
  // הצבא בדרך
  const idx = Math.min(N - 1, Math.floor(t * N));
  const p1 = pts[idx], p2 = pts[idx + 1];
  if (p1.z > -0.05) {
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    drawIcon(ctx, '🚀', p1.x + (p2.x - p1.x) * (t * N - idx), p1.y + (p2.y - p1.y) * (t * N - idx), mine ? 30 : 22, ang + Math.PI / 4);
  }
  // מטרה מהבהבת
  const q = Globe.project(D.lat, D.lon);
  if (q.z > 0) {
    const pulse = (time * 1.5) % 1;
    ctx.strokeStyle = `rgba(255,77,94,${1 - pulse})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(q.x, q.y, 10 + pulse * 40, 0, Math.PI * 2); ctx.stroke();
    if (mine) {
      ctx.font = '900 16px Rubik, sans-serif';
      ctx.fillStyle = '#ff4d5e'; ctx.textAlign = 'center';
      ctx.fillText(fmtTime(w.resolveAt - serverNow()), q.x, q.y + 46);
    }
  }
}

function drawEffects(ctx, time) {
  const now = performance.now();
  G.effects = G.effects.filter((e) => now - e.t0 < 2600);
  for (const e of G.effects) {
    const q = Globe.project(e.lat, e.lon);
    if (q.z < 0) continue;
    const k = (now - e.t0) / 2600;
    for (let i = 0; i < 3; i++) {
      const kk = clamp(k * 1.4 - i * 0.15, 0, 1);
      ctx.strokeStyle = `rgba(255,${150 - i * 40},40,${1 - kk})`;
      ctx.lineWidth = 4 - i;
      ctx.beginPath(); ctx.arc(q.x, q.y, kk * 90, 0, Math.PI * 2); ctx.stroke();
    }
    drawIcon(ctx, '💥', q.x, q.y, 30 + Math.sin(k * Math.PI) * 50, 0, 1 - k * k);
  }
}

function drawPlacement(ctx, time) {
  const all = players();
  // מיקום שנבחר
  if (G.place) {
    const c = [255, 200, 69];
    territoryPath(ctx, G.place.lat, G.place.lon, terrRadius(100));
    ctx.fillStyle = rgba(c, 0.25 + 0.1 * Math.sin(time * 4)); ctx.fill();
    ctx.setLineDash([6, 5]); ctx.lineDashOffset = -time * 20;
    ctx.strokeStyle = rgba(c, 1); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    const q = Globe.project(G.place.lat, G.place.lon);
    if (q.z > 0) drawIcon(ctx, '📍', q.x, q.y - 14 - Math.abs(Math.sin(time * 3)) * 8, 34);
  }
  // סמן העכבר
  if (G.hover?.ll) {
    const ok = placeOk(G.hover.ll, all);
    territoryPath(ctx, G.hover.ll.lat, G.hover.ll.lon, terrRadius(100));
    ctx.strokeStyle = ok === true ? 'rgba(62,224,143,0.9)' : 'rgba(255,77,94,0.8)';
    ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
}

function placeOk(ll, all) {
  if (Math.abs(ll.lat) > 80) return 'רחוק מדי לקטבים';
  if (!Globe.isLand(ll.lat, ll.lon)) return 'צריך לבחור יבשה, לא ים';
  for (const p of all) {
    const d = Math.acos(clamp(Math.sin(ll.lat * DEG) * Math.sin(p.lat * DEG) + Math.cos(ll.lat * DEG) * Math.cos(p.lat * DEG) * Math.cos((ll.lon - p.lon) * DEG), -1, 1)) / DEG;
    if (d < 7) return `קרוב מדי ל${p.name}`;
  }
  return true;
}

function drawWorld(ctx, time) {
  // בלובי הגלובוס זז הצידה כדי שהחלון לא יסתיר אותו
  const { w } = Globe.size;
  const targetShift = G.mode === 'game' || w < 900 ? 0 : -Math.min(260, w * 0.16);
  Globe.shiftX = (Globe.shiftX || 0) + (targetShift - (Globe.shiftX || 0)) * 0.08;
  const list = players();
  const sid = G.mode === 'game' ? G.sid : G.selectedServer?.id;
  const R = Globe.radius;
  const scale = clamp(R / 380, 0.75, 2.2);
  const m = me();
  const now = serverNow();

  // שטחי מדינות
  for (const p of list) {
    const rDeg = terrRadius(p.land);
    if (!territoryPath(ctx, p.lat, p.lon, rDeg)) continue;
    const c = colorOf(p);
    const isMe = m && p.id === m.id;
    const sel = G.selected === p.id;
    ctx.fillStyle = rgba(c, isMe ? 0.28 : 0.2);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = rgba(c, 1); ctx.shadowBlur = isMe || sel ? 16 : 6;
    ctx.strokeStyle = rgba(c, sel ? 1 : 0.85);
    ctx.lineWidth = isMe || sel ? 2.5 : 1.5;
    ctx.stroke();
    ctx.restore();
    if (p.shieldUntil > now) {
      territoryPath(ctx, p.lat, p.lon, rDeg * 1.12);
      ctx.strokeStyle = `rgba(77,184,255,${0.45 + 0.25 * Math.sin(time * 3)})`;
      ctx.setLineDash([3, 6]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // תכולת המדינות (רק כשקרובים מספיק, או המדינה שלי)
  if (G.mode === 'game') {
    for (const p of list) {
      if ((m && p.id === m.id) || R > 650 || G.selected === p.id) drawCountryContents(ctx, p, terrRadius(p.land), time, scale);
    }
  }

  // מלחמות
  if (G.mode === 'game' && G.state) {
    const byId = new Map(list.map((p) => [p.id, p]));
    for (const w of G.state.wars) drawWar(ctx, w, byId, time);
  }

  // דגלים ושמות, מהרחוק לקרוב
  const pins = list.map((p) => ({ p, z: Globe.project(p.lat, p.lon).z })).filter((o) => o.z > 0).sort((a, b) => a.z - b.z);
  for (const { p } of pins) drawFlagPin(ctx, p, sid, scale, (m && p.id === m.id) || G.selected === p.id);

  drawEffects(ctx, time);
  if (G.mode === 'create') drawPlacement(ctx, time);
}

// =====================================================================
//  לחיצות על הגלובוס
// =====================================================================
function pickCountry(x, y) {
  let best = null, bestD = Infinity;
  for (const p of players()) {
    const q = Globe.project(p.lat, p.lon);
    if (q.z < 0.05) continue;
    const d = Math.hypot(q.x - x, q.y - (y + 10));
    const lim = Math.max(28, terrRadius(p.land) * DEG * Globe.radius * q.z);
    if (d < lim && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

Globe.onClick = (x, y, ll) => {
  if (G.mode === 'create') {
    if (!ll) return;
    const ok = placeOk(ll, players());
    if (ok !== true) return toast(ok, 'bad');
    G.place = ll;
    $('#placeStatus').classList.add('ok');
    $('#placeStatus').textContent = `📍 נבחר מקום: ${Math.abs(ll.lat).toFixed(1)}°${ll.lat >= 0 ? 'N' : 'S'}, ${Math.abs(ll.lon).toFixed(1)}°${ll.lon >= 0 ? 'E' : 'W'}`;
    return;
  }
  if (G.mode !== 'game') return;
  const p = pickCountry(x, y);
  if (p) selectCountry(p.id, false); else closeCard();
};

Globe.onHover = (x, y) => {
  const tip = $('#tooltip');
  if (G.mode === 'create') {
    const ll = Globe.unproject(x, y);
    G.hover = { ll };
    if (ll) {
      const ok = placeOk(ll, players());
      tip.textContent = ok === true ? '✅ לחץ כדי להקים כאן' : '❌ ' + ok;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
      tip.classList.remove('hidden');
    } else tip.classList.add('hidden');
    return;
  }
  const p = G.mode !== 'create' && pickCountry(x, y);
  if (p) {
    tip.innerHTML = `<b>${esc(p.name)}</b> · 🛡️ ${short(p.power)} · 🗺️ ${fmt(p.land)}`;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
    tip.classList.remove('hidden');
    $('#ov').style.cursor = 'pointer';
  } else {
    tip.classList.add('hidden');
    $('#ov').style.cursor = '';
  }
};

// =====================================================================
//  לובי
// =====================================================================
async function loadServers() {
  try {
    const { servers } = await api('servers', { ids: store.privates });
    G.servers = servers;
    const mine = store.tokens;
    $('#serverList').innerHTML = servers.map((s) => `
      <div class="server ${G.selectedServer?.id === s.id ? 'sel' : ''}" data-id="${s.id}">
        <div class="s-ico">${s.private ? '🔒' : s.speed > 1 ? '⚡' : '🌍'}</div>
        <div class="s-info">
          <div class="s-name">${esc(s.name)} ${mine[s.id] ? '<span class="tag">המדינה שלך</span>' : ''}</div>
          <div class="s-meta">
            <span>👥 ${s.players} מדינות</span>
            <span><i></i>${s.online} מחוברים</span>
            ${s.private ? `<span class="warn">קוד ${esc(s.code)}</span>` : ''}
          </div>
        </div>
        <div class="s-go">${mine[s.id] ? 'כניסה ←' : 'הצטרף ←'}</div>
      </div>`).join('');
    $$('.server').forEach((el) => {
      const s = servers.find((x) => x.id === el.dataset.id);
      el.addEventListener('click', () => selectServer(s));
      el.addEventListener('mouseenter', () => previewServer(s));
    });
    if (!G.selectedServer && servers.length) previewServer(servers[0]);
  } catch (e) {
    $('#serverList').innerHTML = `<div class="place-status bad">לא מצליח להתחבר לשרת המשחק: ${esc(e.message)}</div>`;
  }
}

async function previewServer(s) {
  if (G.mode !== 'lobby' || G.selectedServer?.id === s.id) return;
  G.selectedServer = s;
  $$('.server').forEach((el) => el.classList.toggle('sel', el.dataset.id === s.id));
  try { G.lobbyPlayers = (await api('peek', { serverId: s.id })).players; } catch { G.lobbyPlayers = []; }
}

let newFlag = null;
async function selectServer(s) {
  G.selectedServer = s;
  const token = store.tokens[s.id];
  if (token) return enterGame(s.id, token);
  try { G.lobbyPlayers = (await api('peek', { serverId: s.id })).players; } catch { G.lobbyPlayers = []; }
  G.mode = 'create';
  G.place = null;
  Globe.view.autoSpin = false;
  newFlag ??= createFlagPicker($('#newFlagPicker'));
  $('#createTitle').textContent = `🏳️ מדינה חדשה ב${s.name}`;
  $('#placeStatus').className = 'place-status';
  $('#placeStatus').textContent = '📍 עוד לא נבחר מקום. לחץ על יבשה בגלובוס';
  $('#lobbyMain').classList.add('hidden');
  $('#lobbyCreate').classList.remove('hidden');
  $('#newName').focus();
}

$('#createBack').addEventListener('click', () => {
  G.mode = 'lobby';
  G.place = null;
  $('#tooltip').classList.add('hidden');
  $('#lobbyCreate').classList.add('hidden');
  $('#lobbyMain').classList.remove('hidden');
  Globe.view.autoSpin = true;
});

$('#foundBtn').addEventListener('click', async () => {
  if (!$('#newName').value.trim()) return toast('תן שם למדינה שלך', 'bad');
  if (!G.place) return toast('לחץ על יבשה בגלובוס כדי לבחור איפה תקום המדינה', 'bad');
  try {
    const { token } = await api('register', {
      serverId: G.selectedServer.id, name: $('#newName').value, flag: newFlag.value, lat: G.place.lat, lon: G.place.lon,
    });
    store.setToken(G.selectedServer.id, token);
    $('#newName').value = '';
    enterGame(G.selectedServer.id, token);
  } catch (e) { toast(e.message, 'bad'); }
});

$('#privCreate').addEventListener('click', async () => {
  try {
    const { server } = await api('createPrivate', { name: $('#privName').value, speed: $('#privSpeed').value });
    store.addPrivate(server.id);
    toast(`השרת נוצר! שלח לחברים את הקוד: ${server.code}`, 'good');
    $('#privName').value = '';
    loadServers();
  } catch (e) { toast(e.message, 'bad'); }
});

$('#joinBtn').addEventListener('click', async () => {
  try {
    const { server } = await api('joinCode', { code: $('#joinCode').value });
    store.addPrivate(server.id);
    $('#joinCode').value = '';
    loadServers();
    selectServer(server);
  } catch (e) { toast(e.message, 'bad'); }
});

// =====================================================================
//  כניסה למשחק
// =====================================================================
function enterGame(sid, token) {
  G.mode = 'game';
  G.sid = sid; G.token = token; G.state = null; G.chatTo = null; G.selected = null;
  if (G.es) G.es.close();
  $('#tooltip').classList.add('hidden');
  $('#lobby').classList.add('hidden');
  $('#lobbyCreate').classList.add('hidden');
  $('#lobbyMain').classList.remove('hidden');
  $('#hud').classList.remove('hidden');
  $('#chatBox').innerHTML = '';
  closeCard();
  let first = true;

  const es = new EventSource('/events?token=' + encodeURIComponent(token));
  G.es = es;
  es.addEventListener('init', (e) => {
    const d = JSON.parse(e.data);
    onState(d);
    $('#chatBox').innerHTML = '';
    d.chat.forEach((m) => addChat(m, false));
    if (first) {
      first = false;
      Globe.flyTo(d.me.lat, d.me.lon, 2.2, 2200);
      toast(`ברוך הבא ל${d.me.name}! לחץ E לחנות ו-F לשדרוגים`, 'good');
    }
  });
  es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  es.addEventListener('chat', (e) => addChat(JSON.parse(e.data), true));
  es.addEventListener('toast', (e) => { const d = JSON.parse(e.data); toast(d.text, d.kind); });
  es.addEventListener('battle', (e) => showBattle(JSON.parse(e.data)));
  es.addEventListener('explosion', (e) => { const d = JSON.parse(e.data); G.effects.push({ ...d, t0: performance.now() }); });
  es.addEventListener('autherror', () => {
    es.close();
    store.setToken(sid, null);
    toast('המדינה לא נמצאה בשרת הזה, צור מדינה חדשה', 'warn');
    exitGame();
  });
}

function exitGame() {
  if (G.es) G.es.close();
  G.es = null; G.mode = 'lobby'; G.state = null; G.selected = null;
  closePanels();
  closeCard();
  $('#hud').classList.add('hidden');
  $('#lobby').classList.remove('hidden');
  Globe.flyTo(Globe.view.lat, Globe.view.lon, 1, 1200);
  setTimeout(() => { Globe.view.autoSpin = true; }, 1300);
  loadServers();
}
$('#exitBtn').addEventListener('click', exitGame);

function act(action, body = {}) {
  return api(action, { token: G.token, ...body }).catch((e) => { toast(e.message, 'bad'); throw e; });
}

function onState(d) {
  G.state = d;
  G.offset = d.now - Date.now();
  renderHud();
  if (G.panel === 'shop') updateShop();
  if (G.panel === 'upgrades') updateUpgrades();
  if (G.panel === 'attack') updateAttack();
  if (G.selected) renderCard();
}

// =====================================================================
//  HUD
// =====================================================================
function renderHud() {
  const { me: m, server, players: list, news, wars } = G.state;
  $('#myFlag').src = flagUrl(G.sid, m.id, m.flagV);
  $('#myName').textContent = m.name;
  $('#srvName').textContent = server.name + (server.private ? ` · קוד ${server.code}` : '');
  $('#srvOnline').textContent = list.filter((p) => p.online).length;
  $('#rMoney').textContent = short(m.money);
  const net = (m.income - m.upkeep) * server.speed;
  $('#rNet').textContent = `${net >= 0 ? '+' : ''}${short(net)}`;
  $('#rNet').className = net >= 0 ? 'good' : 'bad';
  $('#rPop').textContent = `${short(m.pop)}/${short(m.cap)}`;
  $('#rLand').textContent = `${fmt(m.land)} קמ"ר`;
  $('#rBuild').textContent = `${m.houses + m.factories}/${m.maxBuildings}`;
  $('#rDef').textContent = short(m.power);
  $('#rAtk').textContent = short(UNIT_KEYS.reduce((s, k) => s + m[k] * UNIT_POWER[k], 0) * m.attackMult);
  $('#rShieldT').dataset.until = m.shieldUntil;
  $('#rShield').classList.toggle('hidden', m.shieldUntil <= serverNow());
  $$('[data-money]').forEach((el) => { el.textContent = fmt(m.money); });

  // דירוג
  $('#boardList').innerHTML = list.slice(0, 15).map((p, i) => `
    <div class="b-row ${p.id === m.id ? 'me' : ''}" data-pid="${p.id}">
      <span class="rank">${i + 1}</span>
      <span class="dot ${p.online ? 'on' : ''}"></span>
      <img class="flag" src="${flagUrl(G.sid, p.id, p.flagV)}" alt="" style="width:26px">
      <span class="name">${esc(p.name)}${m.friends.includes(p.id) ? ' 🤝' : ''}</span>
      <span class="score">${short(p.score)}</span>
    </div>`).join('');
  $$('#boardList .b-row').forEach((el) => el.addEventListener('click', () => selectCountry(el.dataset.pid, true)));

  // התראות מלחמה
  $('#alerts').innerHTML = wars.filter((w) => w.attackerId === m.id || w.defenderId === m.id).map((w) => {
    const out = w.attackerId === m.id;
    return `<div class="alert ${out ? 'out' : ''}" data-war="${out ? w.defenderId : w.attackerId}">
      <div style="font-size:1.6rem">${out ? '⚔️' : '🚨'}</div>
      <div class="a-txt">${out ? `הצבא שלך בדרך ל<b>${esc(w.defenderName)}</b>` : `<b>${esc(w.attackerName)}</b> תוקפת אותך! קנה צבא מהר [E]`}
        <div class="muted">${STAKES[w.stake].i} על ${STAKES[w.stake].name} · עוצמה ${short(w.power)}</div></div>
      <div class="a-time" data-until="${w.resolveAt}"></div>
    </div>`;
  }).join('');
  $$('#alerts .alert').forEach((el) => el.addEventListener('click', () => selectCountry(el.dataset.war, true)));

  renderFeed();
  tickTimers();
}

function renderFeed() {
  if (!G.state) return;
  const items = G.feed === 'news' ? G.state.news : G.state.me.log;
  $('#feedList').innerHTML = items.slice(0, 20).map((n) =>
    `<div class="f-item ${n.kind || ''}"><time>${clock(n.t)}</time>${esc(n.text)}</div>`).join('') || '<div class="muted">אין עדיין כלום</div>';
}
$$('[data-feed]').forEach((b) => b.addEventListener('click', () => {
  G.feed = b.dataset.feed;
  $$('[data-feed]').forEach((x) => x.classList.toggle('active', x === b));
  renderFeed();
}));

// =====================================================================
//  כרטיס מדינה
// =====================================================================
function selectCountry(pid, fly) {
  const p = G.state?.players.find((x) => x.id === pid);
  if (!p) return;
  G.selected = pid;
  if (fly) Globe.flyTo(p.lat, p.lon, Math.max(Globe.view.zoom, 1.8));
  renderCard();
}

function closeCard() {
  G.selected = null;
  $('#card').classList.add('hidden');
}

function renderCard() {
  const p = G.state.players.find((x) => x.id === G.selected);
  if (!p) return closeCard();
  const m = G.state.me;
  const isMe = p.id === m.id;
  const isFriend = m.friends.includes(p.id);
  const shielded = p.shieldUntil > serverNow();
  const card = $('#card');
  card.innerHTML = `
    <button class="close" data-x>✖</button>
    <div class="c-head">
      <img class="flag" src="${flagUrl(G.sid, p.id, p.flagV)}" alt="">
      <div>
        <h3>${esc(p.name)}</h3>
        <div class="muted"><span class="dot ${p.online ? 'on' : ''}"></span> ${p.online ? 'מחובר' : 'לא מחובר'}
          ${isMe ? ' · המדינה שלך' : isFriend ? ' · 🤝 חבר' : ''}${shielded ? ' · 🔰 מוגן' : ''}</div>
      </div>
    </div>
    <div class="c-stats">
      <div>🗺️ שטח<b>${fmt(p.land)} קמ"ר</b></div>
      <div>👥 תושבים<b>${short(p.pop)}</b></div>
      <div>🛡️ הגנה<b>${short(p.power)}</b></div>
      <div>🏆 נצ׳/הפ׳<b>${p.wins}/${p.losses}</b></div>
      <div>🪖 ${short(p.soldier)} · 🛡️ ${p.tank}<b>✈️ ${p.plane} · 🚀 ${p.missile}</b></div>
      <div>🏠 ${p.houses} · 🏭 ${p.factories}<b>ניקוד ${short(p.score)}</b></div>
    </div>
    <div class="c-actions">
      ${isMe ? `
        <button class="btn gold" data-k="shop">🛒 חנות [E]</button>
        <button class="btn" data-k="upgrades">⬆️ שדרוגים [F]</button>
        <button class="btn" data-k="flag">🏳️ החלף דגל</button>`
      : `
        <button class="btn red" data-k="attack" ${shielded ? 'disabled' : ''}>⚔️ תקוף</button>
        <button class="btn" data-k="dm">💬 הודעה</button>
        <button class="btn" data-k="friend">${isFriend ? '💔 הסר' : '🤝 חבר'}</button>`}
    </div>`;
  card.classList.remove('hidden');
  $('[data-x]', card).addEventListener('click', closeCard);
  $$('[data-k]', card).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k;
    if (k === 'shop' || k === 'upgrades') openPanel(k);
    if (k === 'flag') openFlagModal();
    if (k === 'attack') openAttack(p.id);
    if (k === 'friend') act('friend', { targetId: p.id }).catch(() => {});
    if (k === 'dm') { G.chatTo = p; updateChatTo(); openChat(); }
  }));
}

// =====================================================================
//  חלונות: חנות [E] ושדרוגים [F]
// =====================================================================
function openPanel(name) {
  closePanels();
  G.panel = name;
  $('#' + name).classList.remove('hidden');
  $$('.hotbar button').forEach((b) => b.classList.toggle('on', b.dataset.key === name));
  if (name === 'shop') buildShop();
  if (name === 'upgrades') buildUpgrades();
}
function closePanels() {
  G.panel = null;
  G.attackTarget = null;
  $$('.modal').forEach((m) => m.classList.add('hidden'));
  $$('.hotbar button').forEach((b) => b.classList.remove('on'));
}
function togglePanel(name) { G.panel === name ? closePanels() : openPanel(name); }
$$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closePanels(); }));

function maxBuy(key) {
  const m = G.state.me, it = G.state.rules.shop[key];
  let n = Math.floor(m.money / it.price);
  if (it.crew) n = Math.min(n, Math.floor((m.pop - G.state.rules.minPop) / it.crew));
  if (key === 'settlers') n = Math.min(n, Math.floor((m.cap - m.pop) / 100));
  if (key === 'house' || key === 'factory') n = Math.min(n, m.maxBuildings - m.houses - m.factories);
  return Math.max(0, n);
}

function buildShop() {
  const card = (k) => `
    <div class="item" data-item="${k}">
      <div class="i-top">
        <div class="i-ico">${ITEMS[k].ico}</div>
        <div><div class="i-name">${ITEMS[k].name}</div><div class="i-own" data-own></div></div>
      </div>
      <div class="i-desc">${ITEMS[k].desc}</div>
      <div class="i-price" data-price></div>
      <div class="i-btns">
        <button class="btn" data-n="1">+1</button>
        <button class="btn" data-n="10">+10</button>
        <button class="btn" data-n="100">+100</button>
        <button class="btn max" data-n="max">MAX</button>
      </div>
    </div>`;
  $('#shopBody').innerHTML = `
    <div class="cat">⚔️ צבא</div>
    <div class="shop-grid">${['soldier', 'tank', 'plane', 'missile'].map(card).join('')}</div>
    <div class="cat">🏙️ אוכלוסייה ובנייה</div>
    <div class="shop-grid">${['settlers', 'house', 'factory'].map(card).join('')}</div>`;
  $$('#shopBody .item').forEach((el) => {
    const k = el.dataset.item;
    $$('[data-n]', el).forEach((b) => b.addEventListener('click', async () => {
      const n = b.dataset.n === 'max' ? maxBuy(k) : +b.dataset.n;
      if (n < 1) return toast('אי אפשר לקנות כרגע: אין מספיק כסף, תושבים או מקום', 'bad');
      try {
        await act('buy', { item: k, amount: n });
        el.animate([{ transform: 'scale(1.04)', borderColor: '#ffc845' }, { transform: 'scale(1)' }], { duration: 300 });
      } catch { /* כבר הוצג */ }
    }));
  });
  updateShop();
}

function updateShop() {
  const m = G.state.me, shop = G.state.rules.shop;
  $$('#shopBody .item').forEach((el) => {
    const k = el.dataset.item;
    const own = k === 'settlers' ? `${short(m.pop)} / ${short(m.cap)}` : k === 'house' ? m.houses : k === 'factory' ? m.factories : m[k];
    $('[data-own]', el).textContent = typeof own === 'number' ? fmt(own) : own;
    const pr = $('[data-price]', el);
    pr.textContent = `💰 ${fmt(shop[k].price)} ליחידה · אפשר עד ${fmt(maxBuy(k))}`;
    pr.classList.toggle('no', m.money < shop[k].price);
    const max = maxBuy(k);
    $$('[data-n]', el).forEach((b) => { b.disabled = b.dataset.n === 'max' ? max < 1 : max < +b.dataset.n; });
  });
}

function buildUpgrades() {
  $('#upBody').innerHTML = Object.keys(UPGRADE_INFO).map((k) => `
    <div class="up" data-up="${k}">
      <div class="u-top">
        <div class="u-ico">${UPGRADE_INFO[k].ico}</div>
        <div style="flex:1"><div class="u-name">${UPGRADE_INFO[k].name}</div><div class="u-lvl" data-lvl></div></div>
      </div>
      ${k === 'land' ? '' : '<div class="pips">' + '<i></i>'.repeat(10) + '</div>'}
      <div class="u-eff" data-eff></div>
      <button class="btn gold" data-buy></button>
    </div>`).join('');
  $$('#upBody .up').forEach((el) => {
    $('[data-buy]', el).addEventListener('click', async () => {
      try {
        await act('upgrade', { key: el.dataset.up });
        el.animate([{ transform: 'scale(1.04)', boxShadow: '0 0 30px #4db8ff' }, { transform: 'scale(1)' }], { duration: 400 });
      } catch { /* כבר הוצג */ }
    });
  });
  updateUpgrades();
}

function updateUpgrades() {
  const m = G.state.me;
  $$('#upBody .up').forEach((el) => {
    const k = el.dataset.up;
    const btn = $('[data-buy]', el);
    if (k === 'land') {
      $('[data-lvl]', el).textContent = `${fmt(m.land)} קמ"ר · ${m.houses + m.factories}/${m.maxBuildings} בניינים`;
      $('[data-eff]', el).innerHTML = UPGRADE_INFO.land.eff();
      btn.textContent = `הרחב · 💰 ${fmt(m.landPrice)}`;
      btn.disabled = m.money < m.landPrice;
      return;
    }
    const lvl = m.up[k];
    $('[data-lvl]', el).textContent = `רמה ${lvl} / 10`;
    $$('.pips i', el).forEach((p, i) => p.classList.toggle('on', i < lvl));
    if (lvl >= 10) {
      $('[data-eff]', el).innerHTML = UPGRADE_INFO[k].eff(lvl).split('←')[0] + ' · רמה מקסימלית';
      btn.textContent = '✔ מקסימום';
      btn.disabled = true;
    } else {
      $('[data-eff]', el).innerHTML = UPGRADE_INFO[k].eff(lvl);
      btn.textContent = `שדרג · 💰 ${fmt(m.upCosts[k])}`;
      btn.disabled = m.money < m.upCosts[k];
    }
  });
}

// =====================================================================
//  התקפה
// =====================================================================
function openAttack(pid) {
  closePanels();
  G.panel = 'attack';
  G.attackTarget = pid;
  G.attackStake = 'land';
  const m = G.state.me;
  $('#attackBody').innerHTML = `
    <div class="atk-head">
      <img class="flag" id="aFlag" alt="">
      <div><div class="muted">הכרזת מלחמה על</div><h2 id="aName"></h2><div class="bad" id="aWarn"></div></div>
    </div>
    <div class="muted">על מה נלחמים?</div>
    <div class="stakes">${Object.entries(STAKES).map(([k, s]) => `
      <div class="stake ${k === 'land' ? 'sel' : ''}" data-stake="${k}">
        <div class="s-i">${s.i}</div><b>${s.name}</b><div class="muted">${s.desc}</div>
      </div>`).join('')}</div>
    <div class="muted">אילו כוחות לשלוח?</div>
    ${UNIT_KEYS.map((k) => `
      <div class="send-row">
        <span>${ITEMS[k].ico} ${ITEMS[k].name}</span>
        <input type="range" min="0" max="${m[k]}" value="${m[k]}" data-send="${k}">
        <b data-val="${k}"></b>
      </div>`).join('')}
    <div class="versus">
      <div class="vs-labels"><span>⚔️ הכוח שלך: <b id="aMine"></b></span><span>🛡️ ההגנה שלהם: <b id="aTheirs"></b></span></div>
      <div class="vs-bar"><i id="aBar"></i></div>
    </div>
    <div class="chance" id="aChance"></div>
    <div class="muted" style="text-align:center" id="aEta"></div>
    <div class="row end">
      <button class="btn ghost" data-close>ביטול</button>
      <button class="btn red" id="aGo">⚔️ הכרז מלחמה!</button>
    </div>`;
  $$('#attackBody [data-stake]').forEach((el) => el.addEventListener('click', () => {
    G.attackStake = el.dataset.stake;
    $$('#attackBody [data-stake]').forEach((x) => x.classList.toggle('sel', x === el));
  }));
  $$('#attackBody [data-send]').forEach((i) => i.addEventListener('input', calcAttack));
  $('#aGo').addEventListener('click', async () => {
    const units = {};
    UNIT_KEYS.forEach((k) => { units[k] = +$(`[data-send=${k}]`).value; });
    try {
      await act('attack', { targetId: G.attackTarget, stake: G.attackStake, units });
      closePanels();
    } catch { /* כבר הוצג */ }
  });
  $('#attack').classList.remove('hidden');
  updateAttack();
}

function updateAttack() {
  const p = G.state.players.find((x) => x.id === G.attackTarget);
  if (!p) return closePanels();
  const m = G.state.me;
  $('#aFlag').src = flagUrl(G.sid, p.id, p.flagV);
  $('#aName').textContent = p.name;
  const t = serverNow();
  const warn = p.shieldUntil > t ? '🔰 למדינה יש מגן כרגע' : m.cooldownUntil > t ? '⏳ הצבא שלך מתארגן אחרי ההתקפה הקודמת' : '';
  $('#aWarn').textContent = warn;
  $('#aGo').disabled = !!warn;
  UNIT_KEYS.forEach((k) => {
    const r = $(`[data-send=${k}]`);
    r.max = m[k];
    if (+r.value > m[k]) r.value = m[k];
  });
  $('#aEta').textContent = `⏱️ הצבא יגיע בעוד ${Math.round(m.travelMs / 1000)} שניות`;
  calcAttack();
}

function calcAttack() {
  const p = G.state.players.find((x) => x.id === G.attackTarget);
  if (!p) return;
  let power = 0;
  UNIT_KEYS.forEach((k) => {
    const v = +$(`[data-send=${k}]`).value;
    $(`[data-val=${k}]`).textContent = fmt(v);
    power += v * UNIT_POWER[k];
  });
  power *= G.state.me.attackMult;
  const def = p.power * 1.2;
  $('#aMine').textContent = fmt(power);
  $('#aTheirs').textContent = fmt(def);
  $('#aBar').style.width = (power + def > 0 ? (power / (power + def)) * 100 : 50) + '%';
  const ratio = power / Math.max(1, def);
  const [txt, cls] = power === 0 ? ['בחר כוחות לשליחה', 'muted']
    : ratio > 1.35 ? ['💪 סיכוי גבוה מאוד לניצחון', 'good']
    : ratio > 1.0 ? ['🤔 קרב צמוד, יתרון קטן לך', 'warn']
    : ratio > 0.75 ? ['😬 קרב צמוד, יתרון קטן לאויב', 'warn']
    : ['☠️ סיכוי נמוך מאוד', 'bad'];
  $('#aChance').innerHTML = `<span class="${cls}">${txt}</span>`;
}

// =====================================================================
//  תוצאת קרב, דגל, צ'אט
// =====================================================================
function showBattle(b) {
  const iWon = (b.you === 'attacker') === b.win;
  const st = STAKES[b.stake];
  closePanels();
  G.panel = 'battle';
  $('#battleBody').innerHTML = `
    <div class="b-emoji">${iWon ? '🏆' : '💥'}</div>
    <h2 class="${iWon ? 'good' : 'bad'}">${iWon ? 'ניצחון!' : 'הפסד...'}</h2>
    <p>${esc(b.attacker)} ⚔️ ${esc(b.defender)} · על ${st.i} ${st.name}</p>
    <div class="versus">
      <div class="vs-labels"><span>⚔️ התקפה: <b>${fmt(b.aPower)}</b></span><span>🛡️ הגנה: <b>${fmt(b.dPower)}</b></span></div>
      <div class="vs-bar"><i style="width:${(b.aPower / Math.max(1, b.aPower + b.dPower)) * 100}%"></i></div>
    </div>
    ${b.win ? `<p>${b.you === 'attacker' ? 'לקחת' : 'נלקחו ממך'}: <b>${esc(b.loot)}</b></p>` : ''}
    <p class="muted">הפרטים המלאים ביומן 📜</p>
    <button class="btn gold" data-close>המשך</button>`;
  $('#battle').classList.remove('hidden');
}

let editFlag = null;
function openFlagModal() {
  closePanels();
  G.panel = 'flag';
  editFlag ??= createFlagPicker($('#editFlagPicker'));
  $('#flagModal').classList.remove('hidden');
}
$('#saveFlag').addEventListener('click', async () => {
  try {
    await act('setFlag', { flag: editFlag.value });
    toast('הדגל עודכן!', 'good');
    closePanels();
  } catch { /* כבר הוצג */ }
});

function addChat(m, live) {
  const meId = G.state?.me.id;
  const mine = m.from === meId;
  const el = document.createElement('div');
  el.className = `msg ${m.to ? 'dm' : ''} ${mine ? 'mine' : ''}`;
  const dm = m.to ? (mine ? ` ← ל${esc(m.toName)}` : ' (פרטי)') : '';
  el.innerHTML = `<img class="flag" src="${flagUrl(G.sid, m.from, m.flagV)}" alt=""><span class="who" data-pid="${m.from}">${esc(m.fromName)}${dm}:</span> ${esc(m.text)}`;
  $('.who', el).addEventListener('click', () => selectCountry(m.from, true));
  const box = $('#chatBox');
  box.appendChild(el);
  while (box.children.length > 80) box.firstChild.remove();
  box.scrollTop = 1e9;
  if (live && !mine && m.to) toast(`💬 ${m.fromName}: ${m.text}`, 'info');
}

function openChat() {
  $('#chat').classList.add('open');
  $('#chatInput').focus();
}
$('#chatInput').addEventListener('focus', () => $('#chat').classList.add('open'));
$('#chatInput').addEventListener('blur', () => setTimeout(() => {
  if (document.activeElement !== $('#chatInput')) $('#chat').classList.remove('open');
}, 150));

function updateChatTo() {
  const el = $('#chatTo');
  if (G.chatTo) {
    el.innerHTML = `<span>🔒 הודעה פרטית ל<b>${esc(G.chatTo.name)}</b></span><button>✖ לכולם</button>`;
    $('button', el).addEventListener('mousedown', (e) => { e.preventDefault(); G.chatTo = null; updateChatTo(); });
  }
  el.classList.toggle('hidden', !G.chatTo);
}

$('#chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) { input.blur(); return; }
  try {
    await act('chat', { text, to: G.chatTo?.id });
    input.value = '';
  } catch { /* כבר הוצג */ }
});

// =====================================================================
//  מקלדת וכפתורים
// =====================================================================
function flyHome() {
  const m = me();
  if (!m) return;
  Globe.flyTo(m.lat, m.lon, Math.max(2.2, Globe.view.zoom));
  selectCountry(m.id, false);
}

function hotkey(k) {
  if (G.mode !== 'game') return;
  if (k === 'shop' || k === 'upgrades') togglePanel(k);
  if (k === 'home') flyHome();
  if (k === 'board') $('#board').classList.toggle('hidden');
  if (k === 'chat') openChat();
}
$$('.hotbar button').forEach((b) => b.addEventListener('click', () => hotkey(b.dataset.key)));
$('#meBtn').addEventListener('click', flyHome);
$('#zoomIn').addEventListener('click', () => Globe.flyTo(Globe.view.lat, Globe.view.lon, Math.min(6, Globe.view.zoom * 1.5), 400));
$('#zoomOut').addEventListener('click', () => Globe.flyTo(Globe.view.lat, Globe.view.lon, Math.max(0.7, Globe.view.zoom / 1.5), 400));

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (G.mode !== 'game') return;
  // e.code עובד גם כשהמקלדת בעברית
  switch (e.code) {
    case 'KeyE': hotkey('shop'); break;
    case 'KeyF': hotkey('upgrades'); break;
    case 'KeyH': hotkey('home'); break;
    case 'Tab': e.preventDefault(); hotkey('board'); break;
    case 'Enter': case 'NumpadEnter': e.preventDefault(); hotkey('chat'); break;
    case 'Escape': G.panel ? closePanels() : closeCard(); break;
    default: return;
  }
});

function tickTimers() {
  const t = serverNow();
  $$('[data-until]').forEach((el) => {
    const until = +el.dataset.until;
    if (until) el.textContent = fmtTime(until - t);
  });
  if (G.state && G.state.me.shieldUntil <= t) $('#rShield').classList.add('hidden');
}
setInterval(tickTimers, 500);

// =====================================================================
//  התחלה
// =====================================================================
(async () => {
  Globe.onDraw = drawWorld;
  try {
    await Globe.init($('#gl'), $('#ov'));
  } catch (e) {
    $('#loading').innerHTML = `<div class="bad">שגיאה בטעינת הגלובוס: ${esc(e.message)}</div>`;
    return;
  }
  $('#loading').classList.add('fade');
  setTimeout(() => $('#loading').remove(), 700);
  loadServers();
  setInterval(() => { if (G.mode === 'lobby') loadServers(); }, 10000);
})();
