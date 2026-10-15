import { generateMap, TILE, T, hash2 } from './shared/map.js';
import { WEAPONS, UNITS, BUILDINGS, BUILD_CATS, CAR_COLORS, PALETTE, SPRITES, ROTATING, NOFLIP, HUMANOID, FACTIONS, DAY_MS, UNIT_GROUPS, shade } from './shared/defs.js';
import { loadGeo, geoLoaded, WORLDS } from './shared/geo.js';
import { Terrain, CH, OV_M, bakeObjects, natureArt, buildSprite, buildingArt, vehicleArt, drawSails, drawFlag, drawPrayerFlags, Particles, fx, Lighting, skyAt, Clouds, rainAt, drawRain, weaponIcon, Ambient, nz } from './gfx.js';

const AI_LABEL = {
  claude: '✨ Claude AI is online: NPCs think and talk, the Forge designs anything you describe.',
  local: '✨ Local Qwen AI is ON (Ollama, free, no key): every NPC talks, chats and plots with AI, and the Forge designs anything.',
  free: '✨ Free online AI is ON for everyone (no key needed): NPCs talk back, AI regents plot, the Forge designs anything.',
  offline: 'AI is offline right now: the Forge and NPC chat use the built-in fallback.',
};
const LEGGED = new Set([...HUMANOID, 'deer', 'wolf', 'bear', 'horse', 'rabbit']);
const CONTRAIL = new Set(['jet', 'fighter', 'bomber']);
const isJetArt = (a) => a && (a.t === 'jet' || a.t === 'wing' || a.t === 'prop');

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

// ------------------------------------------------------------------ state
const S = {
  ws: null,
  me: null,
  myId: 0,
  myK: 0,
  room: null,
  map: null,
  terrain: null,
  kingdoms: [],
  towns: [],
  catalog: new Map(),
  buildings: new Map(),
  bOcc: null,
  players: new Map(),
  units: new Map(),
  bullets: [],
  bulletT: 0,
  slashes: [],
  flashes: [],
  decals: [],
  tracks: [],
  sel: new Set(),
  cmdMode: false,
  drag: null,
  pending: null,
  marks: [],
  inspect: null,
  talkLog: [],
  floats: [],
  bubbles: new Map(),
  mm: { u: [], p: [] },
  zoom: 2,
  cam: { x: 0, y: 0 },
  shake: 0,
  mouse: { x: 0, y: 0, down: false, right: false },
  keys: new Set(),
  buildType: null,
  panel: null,
  talkTarget: null,
  forgeCat: 'npc',
  lastInput: '',
  music: null,
  clockOffset: 0,
};
const P = new Particles();
const AMB = new Ambient();
const LIGHT = new Lighting();
let clouds = new Clouds(7);
window.__pk = { S, P, fx }; // debug handle (dev console)
setTimeout(() => Object.assign(window.__pk, { frame, PERF, CK, drawVehicle, drawMissile, unitInfo, unitArt, P }), 0);

// ------------------------------------------------------------------ lobby
const lobbySel = { mode: 'squad', size: 'huge', h: 4, a: 0, vis: 'public', world: 'random', names: 'india' };
const MAX_KINGDOMS = 10;
function seg(id, key, then) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [...$(id).children].forEach((c) => c.classList.toggle('on', c === b));
    if (key) lobbySel[key] = b.dataset.v;
    else S.forgeCat = b.dataset.v;
    then && then(b);
  });
}
seg('modeSeg', 'mode', (b) => {
  if (b.dataset.h) (lobbySel.h = +b.dataset.h), (lobbySel.a = +b.dataset.a);
  renderCounts();
});
seg('sizeSeg', 'size', renderCounts);
seg('visSeg', 'vis');
seg('worldSeg', 'world', renderCounts);
seg('namesSeg', 'names');
// real-world coastlines download in the background while you're in the lobby
loadGeo('india').catch(() => {});
loadGeo('earth').catch(() => {});
seg('forgeSeg', null);

// how many real players and how many AI kingdoms (up to 10 kingdoms in total)
document.querySelector('.counts').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-step]');
  if (!b) return;
  const k = b.dataset.step, d = +b.dataset.d;
  if (k === 'h') lobbySel.h = Math.max(1, Math.min(MAX_KINGDOMS - lobbySel.a, lobbySel.h + d));
  else lobbySel.a = Math.max(0, Math.min(MAX_KINGDOMS - lobbySel.h, lobbySel.a + d));
  // the matching preset lights up, otherwise "Custom"
  const match = [...$('modeSeg').children].find((x) => x.dataset.h && +x.dataset.h === lobbySel.h && +x.dataset.a === lobbySel.a);
  [...$('modeSeg').children].forEach((x) => x.classList.toggle('on', x === (match || $('modeSeg').querySelector('[data-v="custom"]'))));
  lobbySel.mode = match ? match.dataset.v : 'custom';
  renderCounts();
});
function renderCounts() {
  const { h, a } = lobbySel;
  $('hCount').textContent = h;
  $('aCount').textContent = a;
  const total = h + a;
  const small = lobbySel.size === 'large' || lobbySel.size === 'huge';
  $('countsHint').textContent =
    `${h} player slot${h > 1 ? 's' : ''} for real people + ${a} AI kingdom${a === 1 ? '' : 's'} = ${total} kingdom${total > 1 ? 's' : ''}.` +
    (a ? ' AI kingdoms are always run by AI regents.' : '') +
    (total >= 7 && small ? ' Tip: pick Giant or bigger for this many kingdoms.' : '');
  const w = lobbySel.world;
  $('worldHint').textContent =
    w === 'earth' ? '🌍 The real Earth: continents, mountains, deserts and great rivers; kingdoms start at real capitals and every big city is a town. Pick Colossal or Mega so countries have room.' :
    w === 'india' ? '🗺️ The real Indian subcontinent: Himalaya, Thar, Ghats, Ganga and Brahmaputra; realms like Magadha and Chola start at their real capitals, 80+ real cities to capture.' :
    'A brand-new random world every time.';
  $('namesSeg').style.opacity = w === 'random' ? 1 : 0.5;
}
renderCounts();
$('name').value = localStorageGet('pk_name') || '';

function localStorageGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function localStorageSet(k, v) {
  try { localStorage.setItem(k, v); } catch {}
}

// ---- multiplayer session: survive dropped connections and page refreshes
function sessionGet() {
  try { return JSON.parse(sessionStorage.getItem('pk_session') || 'null'); } catch { return null; }
}
function sessionSet(v) {
  try { v ? sessionStorage.setItem('pk_session', JSON.stringify(v)) : sessionStorage.removeItem('pk_session'); } catch {}
}

// ---- saved games: every room you've ruled in is remembered on this device (newest first), and the
// server keeps the world itself, so "Continue" brings you back even after closing the browser
function savesGet() {
  try { return JSON.parse(localStorage.getItem('pk_saves') || '[]').filter((s) => s && s.room && s.token); } catch { return []; }
}
function savesPut(list) {
  try { localStorage.setItem('pk_saves', JSON.stringify(list.slice(0, 8))); } catch {}
  renderSaves();
}
function saveRemember(entry) {
  savesPut([{ ...entry, at: Date.now() }, ...savesGet().filter((s) => s.room !== entry.room)]);
}
function saveForget(room) {
  savesPut(savesGet().filter((s) => s.room !== room));
}
function ago(t) {
  const s = (Date.now() - t) / 1000;
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
}
function renderSaves() {
  const list = savesGet();
  $('continueBox').classList.toggle('hidden', !list.length);
  $('saveList').innerHTML = list
    .map(
      (s, i) => `<div class="save ${i ? '' : 'last'}"><span class="sw" style="background:${esc(s.color || '#888')}"></span>
      <span class="sinfo"><b>${esc(s.roomName || 'Room')}</b> <span class="dim">${esc(s.room)}</span><br>
      <span class="dim">Kingdom of ${esc(s.kingdom || '?')} · ${esc(s.desc || '')} · ${ago(s.at)}</span></span>
      <button class="${i ? 'ghost sm' : 'primary sm'}" data-cont="${esc(s.room)}">${i ? 'Continue' : '▶ Continue last room'}</button>
      <button class="ghost xs" data-forget="${esc(s.room)}" title="Forget">✕</button></div>`,
    )
    .join('');
}
$('saveList').addEventListener('click', (e) => {
  const c = e.target.closest('button[data-cont]'), f = e.target.closest('button[data-forget]');
  if (f) return saveForget(f.dataset.forget);
  if (!c) return;
  const s = savesGet().find((x) => x.room === c.dataset.cont);
  if (!s) return;
  $('lobbyErr').style.color = '#9dff9d';
  $('lobbyErr').textContent = `Restoring ${s.roomName || s.room}…`;
  send({ t: 'rejoin', id: s.room, token: s.token, name: $('name').value.trim() || s.name, manual: true });
});
renderSaves();
const inviteCode = (new URLSearchParams(location.search).get('join') || '').toUpperCase().slice(0, 5);
if (inviteCode) {
  $('joinCode').value = inviteCode;
  $('lobbyErr').style.color = '#9dff9d';
  $('lobbyErr').textContent = `You've been invited to room ${inviteCode}: enter your name and press Join!`;
}
let wantRejoin = !!sessionGet() && !inviteCode;

function connect() {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  S.ws = ws;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (S.geoWait) return void S.geoWait.push(m); // a real-world map is still loading: hold messages
    if (m.t === 'joined' && !geoLoaded(m.room.world || 'random')) {
      S.geoWait = [m];
      lobbyErr.style.color = '#9dff9d';
      lobbyErr.textContent = `Loading the ${WORLDS[m.room.world]?.name || ''} map…`;
      loadGeo(m.room.world).then(() => {
        const q = S.geoWait;
        S.geoWait = null;
        for (const x of q) onMessage(x);
      });
      return;
    }
    onMessage(m);
  };
  ws.onclose = () => {
    if (S.room) {
      wantRejoin = true;
      $('netStatus').classList.remove('hidden');
      $('netStatus').textContent = 'Connection lost: reconnecting to your kingdom…';
    }
    setTimeout(connect, 1500);
  };
}
connect();

function send(o) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o));
}

function playerName() {
  const n = $('name').value.trim() || 'Ruler' + Math.floor(Math.random() * 999);
  localStorageSet('pk_name', n);
  return n;
}

$('createBtn').onclick = () => send({ t: 'create', name: playerName(), roomName: $('roomName').value.trim(), mode: lobbySel.mode, size: lobbySel.size, bots: $('bots').checked, humans: lobbySel.h, ai: lobbySel.a, isPublic: lobbySel.vis !== 'private', world: lobbySel.world, names: lobbySel.names });
$('quickBtn').onclick = () => send({ t: 'quick', name: playerName() });
$('joinBtn').onclick = () => send({ t: 'join', name: playerName(), id: $('joinCode').value.trim() });
$('refreshBtn').onclick = () => send({ t: 'list' });
$('roomList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (b) send({ t: 'join', name: playerName(), id: b.dataset.id });
});

function renderRooms(list, ai, stats) {
  $('aiStatus').textContent = AI_LABEL[ai] || AI_LABEL.offline;
  if (stats) $('onlineStats').textContent = `· ${stats.online} online · ${stats.rooms} live · ${stats.saved} saved`;
  if (!list.length) return ($('roomList').innerHTML = '<p class="dim">No public rooms yet: create one, or hit ⚡ Quick play!</p>');
  $('roomList').innerHTML = list
    .map((r) => {
      const slots = r.humanSlots ?? r.max;
      const who = (r.rulers || []).filter((x) => x.by).map((x) => (x.on ? '🟢 ' : '') + esc(x.by)).join(', ');
      return `<div class="room${r.live ? '' : ' asleep'}"><span><b>${esc(r.id)}</b> ${WORLDS[r.world]?.icon && r.world !== 'random' ? WORLDS[r.world].icon + ' ' : ''}${esc(r.name)}${r.live ? ' <span class="live">● LIVE</span>' : ' <span class="dim">💤 saved</span>'}<br>
      <span class="dim">${r.humans}/${slots} players${r.aiSlots ? ` + ${r.aiSlots} AI` : ''} · ${r.size}²${who ? ' · ' + who : ''}</span></span>
      ${r.open ? `<button data-id="${esc(r.id)}">${r.live ? 'JOIN' : 'RESUME'}</button>` : '<span class="dim">FULL</span>'}</div>`;
    })
    .join('');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ------------------------------------------------------------------ messages
function onMessage(m) {
  switch (m.t) {
    case 'rooms': {
      renderRooms(m.list, m.ai, m.stats);
      const sess = sessionGet();
      if (wantRejoin && sess) send({ t: 'rejoin', id: sess.room, token: sess.token, name: sess.name });
      wantRejoin = false;
      break;
    }
    case 'rejoinFailed': {
      const s = savesGet().find((x) => x.room === m.id);
      if (s && !S.room) {
        $('lobbyErr').style.color = '';
        $('lobbyErr').textContent = m.gone
          ? `Room ${m.id} no longer exists (saves expire after 30 days unused).`
          : `Your kingdom in ${m.id} was taken over by another player. Join the room again to rule a new one.`;
        saveForget(m.id);
        if (!m.gone) $('joinCode').value = m.id;
      }
    }
      sessionSet(null);
      $('netStatus').classList.add('hidden');
      if (S.room) location.reload();
      break;
    case 'error':
      $('lobbyErr').textContent = m.text;
      break;
    case 'joined':
      startGame(m);
      break;
    case 's':
      onSnap(m);
      break;
    case 'buildings':
      setBuildings(m.list);
      break;
    case 'kingdoms':
      S.kingdoms = m.list;
      renderScores();
      break;
    case 'mm':
      S.mm = m;
      break;
    case 'towns':
      S.towns = m.list;
      break;
    case 'alert':
      log(esc(m.text), 'ev alert');
      toast(m.text);
      S.ping = { x: m.x, y: m.y, until: performance.now() + 20000 };
      sfx('boom', null);
      break;
    case 'victory': {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(8,10,20,.72);color:#fff;font-family:"Pixelify Sans",monospace;text-align:center;padding:16px';
      el.innerHTML = `<div style="font-size:96px">👑</div><h1 style="margin:8px 0;color:${m.color}">${esc(m.ruler)}</h1><h2 style="margin:0 0 18px">Sole ruler of the world · Kingdom of ${esc(m.kingdom)}</h2><button class="primary sm">Keep playing</button>`;
      el.querySelector('button').onclick = () => el.remove();
      document.body.append(el);
      break;
    }
    case 'catalog':
      addCatalog(m.def);
      break;
    case 'chat':
      log(`<b style="color:${m.color}">${esc(m.from)}:</b> ${esc(m.text)}`);
      break;
    case 'event':
      log(esc(m.text), 'ev');
      break;
    case 'toast':
      toast(m.text);
      break;
    case 'jmc': {
      const had = S.jmc ? S.jmc.inbox.length : 0;
      S.jmc = m;
      if (m.inbox.length > had) toast(`📜 ${m.inbox[m.inbox.length - 1].name} proposes an alliance: press J to answer`);
      if (S.panel === 'jmc') renderJmc();
      renderScores();
      break;
    }
    case 'radio':
      S.radio.push(m);
      if (S.radio.length > 40) S.radio.shift();
      log(`📻 <b style="color:${m.color}">${esc(m.from)}:</b> ${esc(m.text)}`, 'radio');
      if (S.panel === 'jmc') renderJmc();
      break;
    case 'inspect':
      if (m.gone) S.sel.delete(m.id);
      if (S.sel.has(m.id) || S.talkTarget === m.id) (S.inspect = m), renderUnitCard(), renderTalkLog();
      break;
    case 'say': {
      if (m.id === S.talkTarget && !m.bark) {
        /* handled below */
      } else if (m.k === S.myK && m.id === S.talkTarget) S.talkLog.push({ who: 'npc', text: m.text }), renderTalkLog();
      if (m.bark) {
        // ambient AI chatter: a short bubble only (conversations between NPCs linger a bit longer)
        S.bubbles.set(m.id, { text: m.text, until: performance.now() + (m.chat ? 5200 : 4000), bark: true });
        break;
      }
      S.bubbles.set(m.id, { text: m.text, until: performance.now() + 8000 });
      if (m.id === S.talkTarget) S.talkLog.push({ who: 'npc', text: m.text }), renderTalkLog();
      if (m.k === S.myK) log(`<b>${esc(m.name)}:</b> ${esc(m.text)}${m.cmd && m.cmd !== 'none' ? ` <i>[${m.all ? 'army' : 'order'}: ${m.cmd}]</i>` : ''}${m.ai === 'offline' ? ' <i class="dim">(offline)</i>' : ''}`, 'npc');
      break;
    }
    case 'forging':
      $('forgeStatus').textContent = 'The forge roars… designing your ' + m.category + '…';
      $('forgeBtn').disabled = true;
      break;
    case 'forged':
      $('forgeBtn').disabled = false;
      $('forgeStatus').innerHTML = `Forged <b>${esc(m.def.name)}</b>${m.def.ai === 'offline' ? ' (offline forge)' : ''}: ${esc(m.def.description)}${m.def.category === 'building' ? '<br>Open Build (B) to place it.' : ''}`;
      break;
  }
}

function startGame(m) {
  sessionSet({ room: m.room.id, token: m.token, name: sessionGet()?.name && !$('name').value.trim() ? sessionGet().name : playerName() });
  const myK = (m.kingdoms || []).find((k) => k.id === m.kingdom);
  saveRemember({
    room: m.room.id, token: m.token, name: sessionGet().name, roomName: m.room.name, kingdom: myK?.name, color: myK?.color,
    desc: `${m.room.humanSlots ?? m.room.max} players${m.room.aiSlots ? ` + ${m.room.aiSlots} AI` : ''} · ${m.room.size}²`,
  });
  $('netStatus').classList.add('hidden');
  if (S.room && S.room.id === m.room.id) {
    // reconnected to the same world: keep the map, refresh state
    S.myId = m.you;
    S.myK = m.kingdom;
    S.clockOffset = (m.room.now || Date.now()) - Date.now();
    S.kingdoms = m.kingdoms;
    S.towns = m.towns || [];
    m.catalog.forEach(addCatalog);
    setBuildings(m.buildings);
    S.players.clear();
    S.units.clear();
    toast('Reconnected!');
    return;
  }
  S.myId = m.you;
  S.myK = m.kingdom;
  S.room = m.room;
  S.clockOffset = (m.room.now || Date.now()) - Date.now();
  S.map = generateMap(m.room.size, m.room.seed, m.room.world || 'random');
  initChunks(m.room.size, m.room.seed, m.room.world || 'random');
  clouds = new Clouds(m.room.seed % 1000);
  S.bOcc = new Int32Array(S.map.size * S.map.size);
  S.kingdoms = m.kingdoms;
  S.towns = m.towns || [];
  m.catalog.forEach(addCatalog);
  setBuildings(m.buildings);
  buildMinimapBase();
  $('lobby').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('roomInfo').innerHTML = `Room <b>${esc(m.room.id)}</b> · ${m.room.mode === 'custom' || m.room.aiSlots ? `${m.room.humanSlots}P+${m.room.aiSlots}AI` : m.room.mode.toUpperCase()} · ${m.room.size}²${m.room.isPublic === false ? ' · 🔒' : ''}`;
  history.replaceState(null, '', location.pathname + (FORCED_TOD != null ? `?tod=${FORCED_TOD}` : ''));
  $('forgeAi').textContent = { local: 'Local Qwen AI (Ollama): describe anything (~5-20s)', claude: 'Powered by Claude: describe anything', free: 'Online · free AI for everyone: describe anything (~10-40s)', offline: 'Offline forge (AI unreachable)' }[m.ai] || '';
  renderScores();
  renderBuildPanel();
  renderArmyPanel();
  log('Welcome, ruler! H help · B build · U army · F AI forge · T talk. Capture free towns!', 'ev');
  startMusic();
}

function setBuildings(list) {
  // which buildings appeared or vanished? their chunks need fresh tree overlays
  const before = new Map([...S.buildings.values()].map((b) => [b.id, b]));
  const now = new Set();
  for (const [id, type, tx, ty] of list) {
    now.add(id);
    if (!before.has(id)) {
      const d = bdef(type);
      touchChunks(tx, ty, d.w, d.h);
    }
  }
  for (const [id, b] of before) if (!now.has(id)) touchChunks(b.tx, b.ty, bdef(b.type).w, bdef(b.type).h);
  S.buildings.clear();
  if (S.bOcc) S.bOcc.fill(0);
  for (const [id, type, tx, ty, k, hp, maxHp] of list) {
    const b = { id, type, tx, ty, k, hp, maxHp };
    S.buildings.set(id, b);
    const d0 = bdef(type);
    b.var = d0.variants ? id % d0.variants : 0;
    if (S.bOcc) {
      const d = d0;
      // clear trees around buildings; fences clear their whole compound, airports a wide apron
      const pad = type === 'fence' ? 5 : type === 'airport' ? 3 : d.decor ? 0 : 1;
      for (let j = -pad; j < d.h + pad; j++) for (let i = -pad; i < d.w + pad; i++) {
        const x = tx + i, y = ty + j;
        if (x >= 0 && y >= 0 && x < S.map.size && y < S.map.size) S.bOcc[y * S.map.size + x] = id;
      }
    }
  }
  // roads: neighbour mask (1 N, 2 E, 4 S, 8 W) picks lane markings, kerbs and crossings
  const roadAt = new Set();
  for (const b of S.buildings.values()) if (b.type === 'road') roadAt.add(b.tx + ',' + b.ty);
  for (const b of S.buildings.values())
    if (b.type === 'road') b.var = (roadAt.has(b.tx + ',' + (b.ty - 1)) ? 1 : 0) | (roadAt.has(b.tx + 1 + ',' + b.ty) ? 2 : 0) | (roadAt.has(b.tx + ',' + (b.ty + 1)) ? 4 : 0) | (roadAt.has(b.tx - 1 + ',' + b.ty) ? 8 : 0);
  indexBuildingLayers(); // after road masks so signatures include them
}

// map the server's snapshot clock onto ours. The fastest-arriving packet defines the offset (least delay);
// it relaxes slowly so clock drift can't build up. Bursty arrivals no longer distort motion.
function sampleTime(m, now) {
  if (!m.ts) return now;
  const o = m.ts - now;
  if (S.tsOff == null || o > S.tsOff || o < S.tsOff - 1500) S.tsOff = o;
  else S.tsOff += (o - S.tsOff) * 0.01;
  return m.ts - S.tsOff;
}

function onSnap(m) {
  S.me = m.me;
  const now = performance.now();
  const st = sampleTime(m, now);
  const seenP = new Set();
  for (const [id, x, y, a, hp, maxHp, k, dead, name, weapon] of m.p) {
    seenP.add(id);
    const o = S.players.get(id);
    let o2 = o;
    if (o) {
      if (hp < o.hp && !dead) damageFloat(o, o.hp - hp, k === S.myK ? '#ff7070' : '#ffffff');
      Object.assign(o, { tx: x, ty: y, hp, maxHp, k, dead, name, weapon });
    } else S.players.set(id, (o2 = { id, x, y, tx: x, ty: y, px: x, py: y, speed: 0, a: a / 100, hp, maxHp, k, dead, name, weapon, hist: [] }));
    pushSample(o2, st, x, y, a / 100, a / 100, 0, 0);
  }
  for (const id of S.players.keys()) if (!seenP.has(id)) S.players.delete(id);
  const seenU = new Set();
  for (const [id, def, x, y, a, hp, maxHp, k, flags, aim, fly = 0, bank = 0, spd = 0, driverName = 0, ammo = -1] of m.u) {
    seenU.add(id);
    let o = S.units.get(id);
    const driven = flags & 1, crewed = !!(flags & 2);
    if (o) {
      if (hp < o.hp) damageFloat(o, o.hp - hp, k === S.myK ? '#ff9a6a' : '#ffffff');
      Object.assign(o, { tx: x, ty: y, hp, maxHp, k, driven, crewed, spdS: spd, driverName, ammo });
    } else S.units.set(id, (o = { id, def, ammo, x, y, tx: x, ty: y, px: x, py: y, speed: 0, trackDist: 0, a: a / 100, aim: aim / 100, fly: fly / 100, bank: bank / 100, hp, maxHp, k, driven, crewed, spdS: spd, trail: [], hist: [] }));
    pushSample(o, st, x, y, a / 100, aim / 100, fly / 100, bank / 100, spd);
  }
  for (const id of S.units.keys()) if (!seenU.has(id)) S.units.delete(id);
  for (const id of S.sel) if (!S.units.has(id)) S.sel.delete(id);
  S.bullets = m.b;
  S.bulletT = now;
  for (const [id, hp] of m.bh) {
    const b = S.buildings.get(id);
    if (b) {
      if (hp < b.hp) {
        const d = bdef(b.type);
        S.floats.push({ x: (b.tx + d.w / 2) * TILE, y: b.ty * TILE, text: String(Math.round(b.hp - hp)), color: '#ffc070', t0: now });
      }
      b.hp = hp;
    }
  }
  const cam = S.cam;
  for (const f of m.fx) {
    if (f.k === 'boom') {
      const r = f.r || 30;
      fx.explosion(P, f.x, f.y, Math.min(70, r));
      S.flashes.push({ x: f.x, y: f.y, r: r * 3 + 40, t0: now });
      S.decals.push({ x: f.x, y: f.y, r: Math.min(40, r * 0.7), t0: now });
      if (S.decals.length > 80) S.decals.shift();
      const d = Math.hypot(f.x - cam.x, f.y - cam.y);
      if (d < 700) S.shake = Math.min(14, S.shake + (r / 5) * (1 - d / 700));
      sfx('boom', f);
    } else if (f.k === 'hit') fx.hit(P, f.x, f.y, f.c, f.b);
    else if (f.k === 'die') {
      fx.puff(P, f.x, f.y);
      S.flashes.push({ x: f.x, y: f.y, r: 40, t0: now, weak: true });
    } else if (f.k === 'slash') S.slashes.push({ ...f, t0: now });
    else if (f.k === 'dust') for (let i = 0; i < 6; i++) fx.dust(P, f.x + (Math.random() - 0.5) * 10, f.y + (Math.random() - 0.5) * 6);
    else if (f.k === 'launch') {
      fx.launch(P, f.x, f.y, f.a);
      S.flashes.push({ x: f.x, y: f.y, r: 50, t0: now, weak: true });
      sfx('launch', f);
    } else if (f.k === 'flare') {
      fx.flares(P, f.x, f.y, f.a);
      S.flashes.push({ x: f.x, y: f.y, r: 90, t0: now });
    }
  }
  updateHud();
}

// optional frame profiler (window.__pk.prof = {} to enable)
function PROF(name) {
  const p = window.__pk && window.__pk.prof;
  if (!p) return;
  const t = performance.now();
  (p[name] ||= []).push(t - PROF.t);
  PROF.t = t;
}

// ---- snapshot interpolation: render ~100ms in the past, blending between server snapshots
const INTERP_MS = 100;
function pushSample(o, t, x, y, a, aim, fly, bank, spd = 0) {
  const h = o.hist;
  if (h.length && t <= h[h.length - 1].t) t = h[h.length - 1].t + 1; // keep sample times strictly increasing
  h.push({ t, x, y, a, aim, fly, bank, spd });
  if (h.length > 6) h.shift();
}
const angLerp = (a, b, f) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
};
function interpolate(o, rt) {
  const h = o.hist;
  if (!h || !h.length) return;
  let s0 = h[0], s1 = h[h.length - 1];
  if (rt <= s0.t) s1 = s0;
  else if (rt >= s1.t) {
    // past the newest snapshot: extrapolate briefly along the last motion
    const p = h[h.length - 2];
    if (p) {
      const f = Math.min(rt - s1.t, 120) / Math.max(30, s1.t - p.t);
      o.x = s1.x + (s1.x - p.x) * f;
      o.y = s1.y + (s1.y - p.y) * f;
      o.a = angLerp(s1.a, s1.a + (s1.a - p.a), Math.min(1, f));
    } else (o.x = s1.x), (o.y = s1.y), (o.a = s1.a);
    o.aim = s1.aim;
    o.fly = s1.fly;
    o.bank = s1.bank;
    return;
  } else
    for (let i = 0; i < h.length - 1; i++)
      if (h[i].t <= rt && h[i + 1].t >= rt) {
        s0 = h[i];
        s1 = h[i + 1];
        break;
      }
  const f = s1.t === s0.t ? 1 : (rt - s0.t) / (s1.t - s0.t);
  o.x = s0.x + (s1.x - s0.x) * f;
  o.y = s0.y + (s1.y - s0.y) * f;
  o.a = angLerp(s0.a, s1.a, f);
  o.aim = angLerp(s0.aim, s1.aim, f);
  o.fly = s0.fly + (s1.fly - s0.fly) * f;
  o.bank = s0.bank + (s1.bank - s0.bank) * f;
}

function damageFloat(o, dmg, color) {
  const now = performance.now();
  o.flashT = now;
  if (dmg < 1) return;
  S.floats.push({ x: o.tx + (Math.random() - 0.5) * 8, y: o.ty - 14, text: String(Math.round(dmg)), color, t0: now });
  if (S.floats.length > 120) S.floats.shift();
}

// ------------------------------------------------------------------ catalog / defs
function addCatalog(def) {
  S.catalog.set(def.key, def);
  renderCatalog();
  renderArmyPanel();
  renderBuildPanel();
}

function unitInfo(key) {
  if (UNITS[key]) return { ...UNITS[key], spriteKey: UNITS[key].sprite };
  const c = S.catalog.get(key);
  if (c && c.unit) return { name: c.name, kind: c.category === 'vehicle' ? 'vehicle' : 'npc', domain: c.unit.domain, weapon: c.weapon, spriteKey: key, r: c.unit.r, group: 'Forged' };
  return { name: '?', kind: 'npc', spriteKey: 'knight', weapon: 'sword' };
}

function bdef(type) {
  if (BUILDINGS[type]) return BUILDINGS[type];
  const c = S.catalog.get(type);
  if (c && c.building) return { name: c.name, ...c.building };
  return { name: '?', w: 1, h: 1 };
}

function ammoMax(info) {
  if (info.domain !== 'air' || !info.alt) return 0;
  return info.ammo ?? (info.role === 'fighter' ? 6 : info.alt === 'carpet' || info.alt === 'bomb' ? 12 : 8);
}

function weaponInfo(w) {
  if (!w) return null;
  if (typeof w !== 'string') return w;
  if (WEAPONS[w]) return WEAPONS[w];
  const c = S.catalog.get(w);
  return c ? { ...c.weapon, name: c.name, spriteKey: w } : WEAPONS.sword;
}

// ------------------------------------------------------------------ art lookups
function unitArt(info, color, u) {
  // civilian cars, buses and scooters come in every colour (not kingdom colours)
  if (info.paintVariety && u) color = CAR_COLORS[u.id % CAR_COLORS.length];
  return info.art ? vehicleArt(info.art, color) : spriteSet(info.spriteKey, color);
}
function spriteSet(key, color) {
  if (SPRITES[key]) return buildSprite(key, SPRITES[key], PALETTE, color, LEGGED.has(key));
  const d = S.catalog.get(key);
  if (!d || !d.sprite) return buildSprite('knight', SPRITES.knight, PALETTE, color, true);
  return buildSprite(key, d.sprite.pixels, d.sprite.palette, color, d.category === 'npc' && d.unit?.domain === 'foot');
}
function buildingFor(type, color, variant = 0) {
  const d = bdef(type);
  if (BUILDINGS[type]) return buildingArt(type, d.w, d.h, color, null, variant);
  return buildingArt(type, d.w, d.h, color, S.catalog.has(type) ? spriteSet(type, color).frames[0] : null);
}

// ------------------------------------------------------------------ map chunks: worker threads + LOD + baked overlays
// Terrain chunks are rendered on background threads (no main-thread stalls), at a level of detail that
// matches the zoom (512 / 256 / 128 px per chunk). When zoomed out, trees & rocks are baked into one
// overlay image per chunk instead of being drawn one by one every frame.
const CK = { workers: [], rr: 0, cache: new Map(), pending: new Map(), ver: new Map(), sync: null, syncBudget: 1, bakeBudget: 2 };
function initChunks(size, seed, world = 'random') {
  for (const w of CK.workers) w.terminate();
  for (const c of CK.cache.values()) c.img.close && c.img.close();
  CK.workers = [];
  CK.cache.clear();
  CK.pending.clear();
  CK.ver.clear();
  CK.sync = new Terrain(S.map);
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return;
  const n = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 2));
  for (let i = 0; i < n; i++) {
    try {
      const w = new Worker('chunkworker.js', { type: 'module' });
      w.onmessage = onChunk;
      w.onerror = () => {
        // worker failed (old browser?): fall back to building on the main thread
        CK.workers = CK.workers.filter((x) => x !== w);
        CK.pending.clear();
      };
      w.postMessage({ t: 'init', size, seed, world });
      CK.workers.push(w);
    } catch {
      break;
    }
  }
}
function onChunk(e) {
  const m = e.data;
  CK.pending.delete(m.key);
  const old = CK.cache.get(m.key);
  if (old) {
    old.img.close && old.img.close();
    old.ov && old.ov.close && old.ov.close();
  }
  CK.cache.set(m.key, { img: m.bmp, ov: m.ov, ovVer: m.ver, objects: m.objects, step: m.step, cx: m.cx, cy: m.cy, used: performance.now() });
  evictChunks();
}
function evictChunks() {
  const limits = { 1: 60, 2: 140, 4: 500 };
  for (const step of [1, 2, 4]) {
    const list = [...CK.cache.entries()].filter(([, c]) => c.step === step);
    if (list.length <= limits[step]) continue;
    list.sort((a, b) => a[1].used - b[1].used);
    for (const [k, c] of list.slice(0, list.length - limits[step])) {
      c.img.close && c.img.close();
      c.ov && c.ov.close && c.ov.close();
      CK.cache.delete(k);
    }
  }
}
function getChunk(cx, cy, step, request) {
  const k = step + ':' + cx + ',' + cy;
  const c = CK.cache.get(k);
  if (c) {
    c.used = performance.now();
    // buildings changed here since it was baked: quietly rebuild in the background (old image stays up)
    if (request && c.ovVer !== (CK.ver.get(cx + ',' + cy) || 0)) requestChunk(cx, cy, step, k);
    return c;
  }
  if (request) requestChunk(cx, cy, step, k);
  return null;
}
// which tiles of a chunk have buildings (vegetation there is hidden)
function chunkMask(cx, cy) {
  const mask = new Uint8Array(CH * CH), msz = S.map.size, occ = S.bOcc;
  for (let j = 0; j < CH; j++) {
    const ty = cy * CH + j;
    if (ty >= msz) break;
    for (let i = 0; i < CH; i++) {
      const tx = cx * CH + i;
      if (tx < msz && occ[ty * msz + tx]) mask[j * CH + i] = 1;
    }
  }
  return mask;
}
function requestChunk(cx, cy, step, k) {
  const now = performance.now();
  const p = CK.pending.get(k);
  if (p && now - p < 6000) return;
  const ver = CK.ver.get(cx + ',' + cy) || 0;
  if (CK.workers.length) {
    if (CK.pending.size >= CK.workers.length * 3) return;
    CK.pending.set(k, now);
    CK.workers[CK.rr++ % CK.workers.length].postMessage({ t: 'build', cx, cy, step, key: k, ver, mask: chunkMask(cx, cy) });
  } else if (CK.syncBudget > 0) {
    // no worker support: build on the main thread, one chunk per frame
    CK.syncBudget--;
    const c = CK.sync.build(cx, cy, step);
    CK.cache.set(k, { img: c.canvas, ov: bakeObjects(c.objects, cx, cy, step, chunkMask(cx, cy)), ovVer: ver, objects: c.objects, step, cx, cy, used: now });
    evictChunks();
  }
}// a building appeared / vanished: re-bake the overlays it touches (trees under it disappear)
function touchChunks(tx, ty, w, h) {
  const pad = 5;
  for (let cy = Math.floor((ty - pad) / CH); cy <= Math.floor((ty + h + pad) / CH); cy++)
    for (let cx = Math.floor((tx - pad) / CH); cx <= Math.floor((tx + w + pad) / CH); cx++) {
      const k = cx + ',' + cy;
      CK.ver.set(k, (CK.ver.get(k) || 0) + 1);
    }
}

// ------------------------------------------------------------------ minimap
const MM_COL = ['#2a64b8', '#4c98e0', '#ecdca8', '#78c868', '#50a454', '#94c470', '#c0a482', '#f0f6fc'];
let mmBase = null;
function buildMinimapBase() {
  const n = S.map.size;
  mmBase = document.createElement('canvas');
  mmBase.width = mmBase.height = n;
  const g = mmBase.getContext('2d');
  const img = g.createImageData(n, n);
  const cols = MM_COL.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const E = S.map.elev;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const t = S.map.tiles[i];
      const c = cols[t];
      let f = 1;
      if (t > T.WATER) f = 1 + ((E[Math.min(n * n - 1, i + 1)] - E[i]) + (E[Math.min(n * n - 1, i + n)] - E[i])) * 0.035;
      else f = 0.75 + (E[i] / 255) * 0.9;
      img.data[i * 4] = c[0] * f;
      img.data[i * 4 + 1] = c[1] * f;
      img.data[i * 4 + 2] = c[2] * f;
      img.data[i * 4 + 3] = 255;
    }
  g.putImageData(img, 0, 0);
}

function kColor(k) {
  if (k < 0) return FACTIONS[k]?.color || '#888';
  return (S.kingdoms.find((x) => x && x.id === k) || {}).color || '#888';
}
function kName(k) {
  if (k < 0) return FACTIONS[k]?.name || '?';
  return (S.kingdoms.find((x) => x && x.id === k) || {}).name || '?';
}

function drawMinimap() {
  const mc = $('minimap');
  const g = mc.getContext('2d');
  const n = S.map.size;
  const s = mc.width / n;
  g.imageSmoothingEnabled = true;
  g.drawImage(mmBase, 0, 0, mc.width, mc.height);
  g.imageSmoothingEnabled = false;
  for (const b of S.buildings.values()) {
    const def = bdef(b.type);
    if (def.decor) {
      // streets show as thin grey lines; other street furniture is too small to matter
      if (b.type === 'road') (g.fillStyle = 'rgba(70,72,78,0.9)'), g.fillRect(b.tx * s, b.ty * s, Math.max(1, s), Math.max(1, s));
      continue;
    }
    if (b.k === -3 && b.type !== 'townhall') continue;
    g.fillStyle = kColor(b.k);
    const big = b.type === 'castle' || b.type === 'townhall' ? 2 : 0;
    g.fillRect(b.tx * s - big, b.ty * s - big, Math.max(1.5, def.w * s) + big * 2, Math.max(1.5, def.h * s) + big * 2);
  }
  for (const [, , x, y, k] of S.towns) {
    g.strokeStyle = k < 0 ? 'rgba(0,0,0,.7)' : '#fff';
    g.lineWidth = 1;
    g.strokeRect((x / TILE) * s - 3.5, (y / TILE) * s - 3.5, 7, 7);
  }
  if (S.ping && performance.now() < S.ping.until) {
    const pr = 4 + ((performance.now() / 120) % 10);
    g.strokeStyle = '#60ff60';
    g.beginPath();
    g.arc((S.ping.x / TILE) * s, (S.ping.y / TILE) * s, pr, 0, Math.PI * 2);
    g.stroke();
  }
  if (S.jmc)
    for (const o of S.jmc.ops) {
      if (o.phase === 'done') continue;
      const x = (o.tx / TILE) * s, y = (o.ty / TILE) * s;
      g.strokeStyle = o.owner === S.myK ? '#ffd27a' : '#7fd8ff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.moveTo(x - 8, y);
      g.lineTo(x + 8, y);
      g.moveTo(x, y - 8);
      g.lineTo(x, y + 8);
      g.stroke();
      if (o.phase === 'assemble') {
        g.setLineDash([2, 2]);
        g.beginPath();
        g.moveTo((o.sx / TILE) * s, (o.sy / TILE) * s);
        g.lineTo(x, y);
        g.stroke();
        g.setLineDash([]);
      }
    }
  const u = S.mm.u;
  for (let i = 0; i < u.length; i += 3) {
    g.fillStyle = kColor(u[i + 2]);
    g.fillRect(u[i] * s, u[i + 1] * s, 1.5, 1.5);
  }
  const p = S.mm.p;
  for (let i = 0; i < p.length; i += 4) {
    g.fillStyle = '#000';
    g.fillRect(p[i + 1] * s - 2.5, p[i + 2] * s - 2.5, 6, 6);
    g.fillStyle = p[i] === S.myId ? '#fff' : kColor(p[i + 3]);
    g.fillRect(p[i + 1] * s - 1.5, p[i + 2] * s - 1.5, 4, 4);
  }
  const vw = canvas.width / (S.zoom * RS) / TILE, vh = canvas.height / (S.zoom * RS) / TILE;
  g.strokeStyle = 'rgba(255,255,255,.85)';
  g.lineWidth = 1;
  g.strokeRect((S.cam.x / TILE - vw / 2) * s, (S.cam.y / TILE - vh / 2) * s, vw * s, vh * s);
}

$('homeBtn').onclick = () => {
  const b = $('homeBtn');
  if (!b.dataset.armed) {
    b.dataset.armed = 1;
    b.textContent = '🏠 Sure?';
    toast('Click Home again to leave. Your kingdom is saved: Continue brings you back.');
    setTimeout(() => ((b.dataset.armed = ''), (b.textContent = '🏠 Home')), 3000);
    return;
  }
  sessionSet(null);
  location.href = '/';
};
function renameKingdom() {
  const k = S.kingdoms.find((x) => x && x.id === S.myK);
  const name = prompt('New name for your kingdom:', k ? k.name : '');
  if (name && name.trim()) send({ t: 'rename', what: 'kingdom', name: name.trim() });
}
function renameTown(id, old) {
  const name = prompt('New name for this town:', old || '');
  if (name && name.trim()) send({ t: 'rename', what: 'town', id, name: name.trim() });
}
$('kName').onclick = renameKingdom;
$('invite').onclick = async () => {
  const link = `${location.origin}/?join=${S.room.id}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied: send it to your friends!');
  } catch {
    prompt('Copy this invite link and send it to your friends:', link);
  }
};

$('minimap').addEventListener('mousedown', (e) => {
  const r = e.target.getBoundingClientRect();
  const wx = ((e.clientX - r.left) / r.width) * S.map.size * TILE, wy = ((e.clientY - r.top) / r.height) * S.map.size * TILE;
  if (S.pending && S.pending.startsWith('op:')) return launchOpAt({ x: wx, y: wy });
  if (e.shiftKey) send({ t: 'cmd', mode: 'attack', x: wx, y: wy });
  else toast('Shift+click the minimap to send your army there');
});

// ------------------------------------------------------------------ input
let vignette = null;
// Dynamic resolution (like DLSS/FSR upscaling): when frames get slow the game renders at a lower internal
// resolution and the browser upscales it (pixel-art friendly); when there's headroom it goes back to native.
let RS = devicePixelRatio;
const PERF = { acc: 0, n: 0, since: performance.now(), fps: 60, frames: 0, fpsSince: performance.now() };
function adaptResolution(frameMs) {
  PERF.acc += frameMs;
  PERF.n++;
  PERF.frames++;
  const now = performance.now();
  if (now - PERF.fpsSince > 1000) (PERF.fps = Math.round((PERF.frames * 1000) / (now - PERF.fpsSince))), (PERF.frames = 0), (PERF.fpsSince = now);
  if (now - PERF.since < 1500 || PERF.n < 20) return;
  const avg = PERF.acc / PERF.n;
  PERF.acc = 0;
  PERF.n = 0;
  PERF.since = now;
  if (document.hidden) return;
  const native = devicePixelRatio, min = Math.max(0.5, native * 0.5);
  // judge our own frame cost, not the browser's frame rate (vsync / throttling isn't our fault), and only
  // act on sustained trends with a cooldown, so the canvas never flips between sizes
  PERF.bad = avg > 14 ? (PERF.bad || 0) + 1 : 0;
  PERF.good = avg < 6 ? (PERF.good || 0) + 1 : 0;
  const since = now - (PERF.changedAt || 0);
  if (PERF.bad >= 2 && RS > min + 0.01 && since > 4000) {
    RS = Math.max(min, RS * 0.85);
    PERF.changedAt = now;
    PERF.bad = 0;
    resize();
  } else if (PERF.good >= 4 && RS < native - 0.01 && since > 15000) {
    RS = Math.min(native, RS * 1.1);
    PERF.changedAt = now;
    PERF.good = 0;
    resize();
  }
}
function resize() {
  canvas.width = Math.floor(innerWidth * RS);
  canvas.height = Math.floor(innerHeight * RS);
  vignette = null;
}
addEventListener('resize', resize);
resize();

const typing = () => document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);

addEventListener('keydown', (e) => {
  if (!S.room) return;
  if (e.key === 'Escape') {
    if (S.pending) return void ((S.pending = null), toast('Order cancelled'));
    if (S.sel.size && !S.panel && $('talkBox').classList.contains('hidden')) return clearSelection();
    closeAll();
    return;
  }
  if (typing()) {
    if (e.key === 'Enter') {
      if (document.activeElement === $('chatInput')) {
        const v = $('chatInput').value.trim();
        if (v) send({ t: 'chat', text: v });
        $('chatInput').value = '';
        $('chatInput').classList.add('hidden');
        $('chatInput').blur();
      } else if (document.activeElement === $('talkInput')) {
        const v = $('talkInput').value.trim();
        if (v && S.talkTarget) {
          send({ t: 'talk', id: S.talkTarget, text: v });
          S.talkLog.push({ who: 'ruler', text: v });
          renderTalkLog(true);
          S.bubbles.set(S.talkTarget, { text: '…', until: performance.now() + 60000 });
        }
        $('talkInput').value = '';
      } else if (document.activeElement === $('forgePrompt') && !e.shiftKey) {
        e.preventDefault();
        forge();
      }
    }
    return;
  }
  const k = e.key.toLowerCase();
  S.keys.add(k);
  if (k === 't' || k === 'f' || k === 'enter' || k === 'q') e.preventDefault();
  if (k === 'enter') {
    $('chatInput').classList.remove('hidden');
    $('chatInput').focus();
  } else if (k >= '1' && k <= '9') send({ t: 'weapon', i: +k - 1 });
  else if (k === 'e') send({ t: 'enter' });
  else if (k === 'l') S.sel.size && !S.me?.vehicle ? sendOrder('land') : send({ t: 'land' });
  else if (k === 'q') toggleCommandMode();
  else if (k === 'b') togglePanel('build');
  else if (k === 'u') togglePanel('army');
  else if (k === 'f') togglePanel('forge');
  else if (k === 'h') togglePanel('help');
  else if (k === 'j') togglePanel('jmc');
  else if (k === 'z') order('follow', e.altKey);
  else if (k === 'x') order('guard', e.altKey);
  else if (k === 'c') order('attack', e.altKey);
  else if (k === 'v') order('wander', e.altKey);
  else if (k === 'g' && S.sel.size) sendOrder('dismount');
  else if (k === 't') openTalk();
  else if (k === 'm') toggleMusic();
  else if (k === ' ' && S.me?.vehicle) (e.preventDefault(), send({ t: 'flare' }));
  if (e.altKey) e.preventDefault();
});
addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => S.keys.clear());

// ------------------------------------------------------------------ command mode & selection
const commanding = () => S.cmdMode || S.keys.has('control');
function toggleCommandMode() {
  S.cmdMode = !S.cmdMode;
  document.body.classList.toggle('cmd', S.cmdMode);
  toast(S.cmdMode ? 'Command mode: click / drag to select your units · right-click to order · Q to exit' : 'Command mode off: back to combat');
}
function clearSelection() {
  S.sel.clear();
  S.inspect = null;
  renderUnitCard();
}
function selectedIds() {
  return [...S.sel].filter((id) => S.units.has(id));
}
function sendOrder(orderName, extra = {}) {
  const ids = selectedIds();
  if (!ids.length) return toast('Select units first (Q, then click or drag)');
  const w = mouseWorld();
  send({ t: 'order', ids, order: orderName, x: Math.round(w.x), y: Math.round(w.y), ...extra });
}
// unit under the cursor (world coords); prefers units over buildings
function unitAt(wx, wy, pred = () => true) {
  let best = null, bd = Infinity;
  for (const u of S.units.values()) {
    const info = u.info || (u.info = unitInfo(u.def));
    const r = (info.r || 6) + 6;
    const d = Math.hypot(u.x - wx, u.y - wy);
    if (d < r && d < bd && pred(u, info)) (bd = d), (best = u);
  }
  return best;
}
function enemyAt(wx, wy) {
  const u = unitAt(wx, wy, (u, info) => !isAlly(u.k) && !(info.passive && !info.mount));
  if (u) return u.id;
  for (const p of S.players.values()) if (!isAlly(p.k) && !p.dead && Math.hypot(p.x - wx, p.y - wy) < 12) return p.id;
  for (const b of S.buildings.values()) {
    const d = bdef(b.type);
    if (!isAlly(b.k) && b.k >= 0 && wx >= b.tx * TILE && wx < (b.tx + d.w) * TILE && wy >= b.ty * TILE && wy < (b.ty + d.h) * TILE) return b.id;
  }
  return null;
}
function selectUnit(u, add) {
  if (!add) S.sel.clear();
  if (S.sel.has(u.id) && add) S.sel.delete(u.id);
  else S.sel.add(u.id);
  S.inspect = null;
  requestInspect();
  renderUnitCard();
}
function requestInspect() {
  const id = selectedIds()[0];
  if (id) send({ t: 'inspect', id });
}
setInterval(() => S.room && S.sel.size && requestInspect(), 1000);

// right-click (or a pending card order) on the map → contextual order for the selection
function contextOrder(w, forced) {
  const ids = selectedIds();
  if (!ids.length) return false;
  const mark = (color) => S.marks.push({ x: w.x, y: w.y, t0: performance.now(), color });
  if (forced === 'move') return send({ t: 'order', ids, order: 'move', x: w.x, y: w.y }), mark('#7cff7c'), true;
  const foe = enemyAt(w.x, w.y);
  if (forced === 'attack' || (!forced && foe)) return send({ t: 'order', ids, order: 'attack', x: w.x, y: w.y, target: foe }), mark('#ff5050'), true;
  const veh = unitAt(w.x, w.y, (u, info) => info.kind === 'vehicle' && !info.mount && !u.crewed && !u.driven);
  if (forced === 'board' || (!forced && veh)) return send({ t: 'order', ids, order: 'board', x: w.x, y: w.y, target: veh ? veh.id : null }), mark('#ffd27a'), true;
  send({ t: 'order', ids, order: 'move', x: w.x, y: w.y });
  mark('#7cff7c');
  return true;
}

canvas.addEventListener('mousemove', (e) => {
  S.mouse.x = e.clientX * RS;
  S.mouse.y = e.clientY * RS;
  if (S.drag) (S.drag.x1 = S.mouse.x), (S.drag.y1 = S.mouse.y);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  if (S.buildType) {
    if (e.button === 2) return (S.buildType = null), renderBuildPanel();
    const { tx, ty } = mouseTile();
    if (S.buildType === 'demolish') send({ t: 'demolish', tx, ty });
    else send({ t: 'build', type: S.buildType, tx, ty });
    if (!e.shiftKey && S.buildType !== 'wall') (S.buildType = null), renderBuildPanel();
    return;
  }
  const w = mouseWorld();
  if (S.pending && S.pending.startsWith('op:')) {
    if (e.button === 0) launchOpAt(w);
    else (S.pending = null), toast('Operation cancelled');
    return;
  }
  if (S.pending && e.button === 0) {
    contextOrder(w, S.pending);
    S.pending = null;
    return;
  }
  if (commanding()) {
    if (e.button === 0) S.drag = { x0: S.mouse.x, y0: S.mouse.y, x1: S.mouse.x, y1: S.mouse.y, add: e.shiftKey };
    if (e.button === 2) contextOrder(w);
    return;
  }
  if (e.button === 0) S.mouse.down = true;
  if (e.button === 2) S.mouse.right = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) S.mouse.down = false;
  if (e.button === 2) S.mouse.right = false;
  if (e.button === 0 && S.drag) {
    const d = S.drag;
    S.drag = null;
    const z = S.zoom * RS;
    const toW = (sx, sy) => ({ x: S.cam.x + (sx - canvas.width / 2) / z, y: S.cam.y + (sy - canvas.height / 2) / z });
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 8) {
      // click: select the unit under the cursor (yours to command; others just to inspect)
      const w = toW(d.x1, d.y1);
      const u = unitAt(w.x, w.y, (u) => u.k === S.myK) || unitAt(w.x, w.y);
      if (u) selectUnit(u, d.add);
      else if (!d.add) clearSelection();
      return;
    }
    const a = toW(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1)), b = toW(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
    if (!d.add) S.sel.clear();
    for (const u of S.units.values()) if (u.k === S.myK && !u.driven && u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y) S.sel.add(u.id);
    toast(S.sel.size ? `${S.sel.size} units selected: right-click to order` : 'No units of yours there');
    S.inspect = null;
    requestInspect();
    renderUnitCard();
  }
});canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.shiftKey && S.me) {
    const n = S.me.weapons.length;
    send({ t: 'weapon', i: (S.me.wi + (e.deltaY > 0 ? 1 : n - 1)) % n });
    return;
  }
  // zoom levels: 0.25x strategic overview … 5x close-up
  const ZL = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5];
  let zi = ZL.findIndex((v) => Math.abs(v - S.zoom) < 0.01);
  if (zi < 0) zi = 4;
  S.zoom = ZL[Math.max(0, Math.min(ZL.length - 1, zi + (e.deltaY > 0 ? -1 : 1)))];
}, { passive: false });

function mouseWorld() {
  const z = S.zoom * RS;
  return { x: S.cam.x + (S.mouse.x - canvas.width / 2) / z, y: S.cam.y + (S.mouse.y - canvas.height / 2) / z };
}
function mouseTile() {
  const w = mouseWorld();
  const def = S.buildType && S.buildType !== 'demolish' ? bdef(S.buildType) : { w: 1, h: 1 };
  return { tx: Math.floor(w.x / TILE - (def.w - 1) / 2), ty: Math.floor(w.y / TILE - (def.h - 1) / 2) };
}

function order(mode, near) {
  // with units selected, orders go to the selection; otherwise to the whole army
  if (S.sel.size) return mode === 'attack' ? void ((S.pending = 'attack'), toast('Click a target or a spot to attack')) : sendOrder(mode);
  const w = mouseWorld();
  send({ t: 'cmd', mode, x: w.x, y: w.y, near });
}
document.querySelectorAll('#cmdbar [data-cmd]').forEach((b) => (b.onclick = () => order(b.dataset.cmd, false)));
$('talkBtn').onclick = () => openTalk();

setInterval(() => {
  if (!S.room) return;
  let mx = 0, my = 0;
  if (!typing()) {
    if (S.keys.has('a') || S.keys.has('arrowleft')) mx -= 1;
    if (S.keys.has('d') || S.keys.has('arrowright')) mx += 1;
    if (S.keys.has('w') || S.keys.has('arrowup')) my -= 1;
    if (S.keys.has('s') || S.keys.has('arrowdown')) my += 1;
  }
  const w = mouseWorld();
  const msg = { t: 'in', mx, my, vw: S.viewHalf ? S.viewHalf[0] : 0, vh: S.viewHalf ? S.viewHalf[1] : 0, ax: Math.round(w.x), ay: Math.round(w.y), f: S.mouse.down && !S.buildType, a: S.mouse.right && !S.buildType, s: !typing() && S.keys.has('shift') };
  const s = JSON.stringify(msg);
  if (s !== S.lastInput && S.ws.readyState === 1) {
    S.lastInput = s;
    S.ws.send(s);
    if (msg.f) sfx('shot');
  }
}, 50);

// ------------------------------------------------------------------ panels
function togglePanel(p) {
  const was = S.panel;
  closeAll();
  if (was !== p) {
    S.panel = p;
    $('p' + p[0].toUpperCase() + p.slice(1)).classList.remove('hidden');
    document.querySelector(`#toolbar [data-p="${p}"]`)?.classList.add('on');
    if (p === 'forge') setTimeout(() => $('forgePrompt').focus(), 0);
    if (p === 'jmc') (S.jmcHtml = ''), renderJmc();
  }
}
function closeAll() {
  S.panel = null;
  S.buildType = null;
  ['pBuild', 'pArmy', 'pForge', 'pHelp', 'pJmc', 'talkBox'].forEach((id) => $(id).classList.add('hidden'));
  document.querySelectorAll('#toolbar [data-p]').forEach((b) => b.classList.remove('on'));
  $('chatInput').classList.add('hidden');
  S.talkTarget = null;
  if (document.activeElement) document.activeElement.blur();
  renderBuildPanel();
}
document.querySelectorAll('#toolbar [data-p]').forEach((b) => (b.onclick = () => togglePanel(b.dataset.p)));
$('cmdToggle').onclick = () => toggleCommandMode();

function previewCanvas(src, w = 56) {
  const c = document.createElement('canvas');
  c.width = c.height = w;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const sc = Math.min(w / src.width, w / src.height);
  g.drawImage(src, Math.round((w - src.width * sc) / 2), Math.round((w - src.height * sc) / 2), src.width * sc, src.height * sc);
  return c;
}

// sorted panels: category tabs + search box
S.buildTab = 'All';
S.armyTab = 'All';
function renderTabs(el, cats, cur, pick) {
  el.innerHTML = ['All', ...cats].map((c) => `<button data-c="${esc(c)}" class="${c === cur ? 'on' : ''}">${esc(c)}</button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('button[data-c]');
    if (b) pick(b.dataset.c);
  };
}
function renderBuildPanel() {
  const el = $('buildList');
  if (!el || !S.room) return;
  const color = kColor(S.myK);
  const custom = [...S.catalog.values()].filter((c) => c.category === 'building').map((c) => [c.key, { name: c.name, cat: 'Forged', ...c.building }]);
  const all = [...Object.entries(BUILDINGS), ...custom];
  const cats = BUILD_CATS.filter((cat) => all.some(([, d]) => (d.cat || 'Forged') === cat));
  renderTabs($('buildTabs'), cats, S.buildTab, (cat) => ((S.buildTab = cat), renderBuildPanel()));
  const q = ($('buildSearch').value || '').trim().toLowerCase();
  const list = all
    .filter(([type, d]) => (S.buildTab === 'All' || (d.cat || 'Forged') === S.buildTab) && (!q || `${d.name} ${type} ${d.cat || ''}`.toLowerCase().includes(q)))
    .sort((a, b) => BUILD_CATS.indexOf(a[1].cat || 'Forged') - BUILD_CATS.indexOf(b[1].cat || 'Forged'));
  el.innerHTML = '';
  const demo = document.createElement('div');
  demo.className = 'card' + (S.buildType === 'demolish' ? ' on' : '');
  demo.innerHTML = '<div class="icon-big">⛏</div><b>Demolish</b><small>remove yours</small>';
  demo.onclick = () => ((S.buildType = S.buildType === 'demolish' ? null : 'demolish'), renderBuildPanel());
  el.appendChild(demo);
  let group = null;
  for (const [type, def] of list) {
    if (S.buildTab === 'All' && (def.cat || 'Forged') !== group) {
      group = def.cat || 'Forged';
      el.insertAdjacentHTML('beforeend', `<h4 class="grp">${esc(group)}</h4>`);
    }
    const card = document.createElement('div');
    card.className = 'card' + (S.buildType === type ? ' on' : '');
    card.appendChild(previewCanvas(buildingFor(type, color, type === 'road' ? 10 : 0).c));
    const what = def.produces ? 'trains ' + [...new Set(def.produces)].map((p) => UNITS[p]?.name || p).slice(0, 3).join(', ') + (new Set(def.produces).size > 3 ? '…' : '') : def.weapon ? 'auto-defense · ' + (WEAPONS[def.weapon]?.name || '') : def.heal ? 'heals troops' : def.town ? 'founds a town' : def.residents ? `home for ${def.residents}` : def.decor ? 'street decor' : def.w + '×' + def.h;
    card.insertAdjacentHTML('beforeend', `<b>${esc(def.name)}</b><small>${type.startsWith('c:') ? '✨ ' : ''}${esc(what)}</small>`);
    card.onclick = () => {
      S.buildType = S.buildType === type ? null : type;
      renderBuildPanel();
    };
    el.appendChild(card);
  }
  if (!list.length) el.insertAdjacentHTML('beforeend', '<p class="dim" style="grid-column:1/-1">Nothing matches.</p>');
}
$('buildSearch').addEventListener('input', renderBuildPanel);

function renderArmyPanel() {
  const el = $('armyList');
  if (!el || !S.room) return;
  const color = kColor(S.myK);
  const entries = [...Object.keys(UNITS), ...[...S.catalog.values()].filter((c) => c.unit).map((c) => c.key)].map((key) => [key, unitInfo(key)]);
  const groups = UNIT_GROUPS.filter((g) => entries.some(([, i]) => i.group === g));
  renderTabs($('armyTabs'), groups, S.armyTab, (g) => ((S.armyTab = g), renderArmyPanel()));
  const q = ($('armySearch').value || '').trim().toLowerCase();
  const sorted = entries
    .filter(([key, i]) => (S.armyTab === 'All' || i.group === S.armyTab) && (!q || `${i.name} ${key} ${i.group}`.toLowerCase().includes(q)))
    .sort((a, b) => UNIT_GROUPS.indexOf(a[1].group) - UNIT_GROUPS.indexOf(b[1].group));
  el.innerHTML = '';
  let group = null;
  for (const [key, info] of sorted) {
    if (info.group !== group) {
      group = info.group;
      el.insertAdjacentHTML('beforeend', `<h4 class="grp">${esc(group || 'Other')}</h4>`);
    }
    const card = document.createElement('div');
    card.className = 'card';
    card.appendChild(previewCanvas(unitArt(info, color, { id: key.length }).frames[0]));
    const tag = info.kind === 'vehicle' ? (info.mount ? 'mount' : info.traffic ? 'traffic · drive it' : 'ride · ' + info.domain) : info.civ ? 'civilian' : info.passive ? 'pet' : info.domain === 'air' ? 'flying' : (WEAPONS[info.weapon]?.name || 'fighter');
    card.insertAdjacentHTML('beforeend', `<b>${esc(info.name)}</b><small>${esc(tag)}</small>`);
    card.title = `${info.name}${info.hp ? ` · ${info.hp} HP` : ''}${info.weapon ? ` · ${WEAPONS[info.weapon]?.name || info.weapon}` : ''}${info.alt ? ` + ${WEAPONS[info.alt]?.name || info.alt}` : ''}`;
    card.onclick = () => send({ t: 'spawn', def: key });
    el.appendChild(card);
  }
  if (!sorted.length) el.insertAdjacentHTML('beforeend', '<p class="dim" style="grid-column:1/-1">Nothing matches.</p>');
}
$('armySearch').addEventListener('input', renderArmyPanel);
function renderCatalog() {
  const el = $('catalog');
  if (!el || !S.room) return;
  el.innerHTML = '';
  const color = kColor(S.myK);
  const list = [...S.catalog.values()].reverse();
  if (!list.length) el.innerHTML = '<p class="dim" style="grid-column:1/-1">Nothing forged yet. Describe anything above!</p>';
  for (const c of list) {
    const card = document.createElement('div');
    card.className = 'card';
    card.title = `${c.description}\nby ${c.creator}`;
    card.appendChild(previewCanvas(spriteSet(c.key, color).frames[0]));
    card.insertAdjacentHTML('beforeend', `<b>${esc(c.name)}</b><small>${c.category} · ${esc(c.creator)}</small>`);
    card.onclick = () => {
      if (c.category === 'weapon') toast("Weapons go to their forger's hotbar");
      else if (c.category === 'building') {
        togglePanel('build');
        S.buildType = c.key;
        renderBuildPanel();
      } else send({ t: 'spawn', def: c.key });
    };
    el.appendChild(card);
  }
}

function forge() {
  const prompt = $('forgePrompt').value.trim();
  if (!prompt) return;
  send({ t: 'create', category: S.forgeCat, prompt });
  $('forgeStatus').textContent = 'Sending to the forge…';
}
$('forgeBtn').onclick = forge;

// ---- unit card: the selected unit(s) and quick orders
const ORDER_BTNS = {
  talk: ['💬 Talk', 'T'],
  follow: ['Follow me', 'Z'],
  guard: ['Hold here', 'X'],
  move: ['Move to…', 'RMB'],
  attack: ['Attack…', 'C'],
  board: ['Board vehicle…', ''],
  dismount: ['Get out', 'G'],
  takeoff: ['Take off', ''],
  land: ['Land', 'L'],
  wander: ['At ease', 'V'],
};
function renderUnitCard() {
  const el = $('unitCard');
  const ids = selectedIds();
  if (!ids.length) return el.classList.add('hidden');
  el.classList.remove('hidden');
  const first = S.units.get(ids[0]);
  const info = first ? first.info || unitInfo(first.def) : null;
  const I = S.inspect && S.inspect.id === ids[0] ? S.inspect : null;
  const own = first && first.k === S.myK;
  let html = '';
  if (ids.length === 1 && first) {
    html += `<div class="uc-head"><canvas id="ucPortrait" width="48" height="48"></canvas><div><b>${esc(I ? I.name : info.name)}</b><small>${esc(info.name)}${I && I.canFly ? ' · ✈ trained pilot' : ''}</small>
      <div class="bar sm"><div style="width:${(first.hp / first.maxHp) * 100}%" class="${first.hp / first.maxHp > 0.5 ? '' : first.hp / first.maxHp > 0.25 ? 'mid' : 'low'}"></div></div>
      <small>${I ? '▸ ' + esc(I.doing) : ''}${I && I.vehicle ? (I.crewed ? ' · crewed' : ' · EMPTY') : ''}</small></div></div>`;
  } else {
    const counts = {};
    for (const id of ids) {
      const u = S.units.get(id);
      const n = (u.info || unitInfo(u.def)).name;
      counts[n] = (counts[n] || 0) + 1;
    }
    html += `<div class="uc-multi"><b>${ids.length} units selected</b><small>${Object.entries(counts).slice(0, 6).map(([n, c]) => `${c}× ${esc(n)}`).join(' · ')}</small></div>`;
  }
  if (own) {
    const isVeh = info && info.kind === 'vehicle' && !info.mount;
    const isAir = isVeh && info.domain === 'air';
    const canBoard = ids.some((id) => {
      const u = S.units.get(id);
      const inf = u && (u.info || unitInfo(u.def));
      return inf && (inf.crew || inf.group === 'Soldiers');
    });
    const btns = ['talk', 'follow', 'guard', 'move', 'attack'];
    if (canBoard) btns.push('board');
    if (isVeh && (!I || I.crewed)) btns.push('dismount');
    if (isAir) btns.push(first.fly > 0.3 ? 'land' : 'takeoff');
    btns.push('wander');
    html += `<div class="uc-btns">${btns.map((b) => `<button data-o="${b}">${ORDER_BTNS[b][0]}${ORDER_BTNS[b][1] ? ` <kbd>${ORDER_BTNS[b][1]}</kbd>` : ''}</button>`).join('')}</div>`;
    if (info && info.domain === 'air' && canBoard === false && !isVeh) html += '';
  } else html += `<div class="uc-hint">Not yours: only inspect</div>`;
  html += `<div class="uc-hint">Q command mode · click / drag to select · right-click to order · Esc to deselect</div>`;
  el.innerHTML = html;
  const pc = $('ucPortrait');
  if (pc && first) {
    const g = pc.getContext('2d');
    g.imageSmoothingEnabled = false;
    const spr = unitArt(info, kColor(first.k)).frames[0];
    const sc = Math.min(44 / spr.width, 44 / spr.height);
    g.drawImage(spr, (48 - spr.width * sc) / 2, (48 - spr.height * sc) / 2, spr.width * sc, spr.height * sc);
  }
}
$('unitCard').addEventListener('click', (e) => {
  const b = e.target.closest('[data-o]');
  if (!b) return;
  const o = b.dataset.o;
  if (o === 'talk') return openTalk();
  if (o === 'move' || o === 'attack' || o === 'board') {
    S.pending = o;
    return toast(o === 'board' ? 'Click an EMPTY vehicle to board it (pilots fly aircraft, soldiers drive ground vehicles)' : `Click on the map to ${o === 'move' ? 'move there' : 'attack'}`);
  }
  sendOrder(o);
});

function renderTalkLog(scroll) {
  const el = $('talkLog');
  if (!el) return;
  if (!S.talkLog.length && S.inspect && S.inspect.id === S.talkTarget) S.talkLog = (S.inspect.chat || []).slice();
  el.innerHTML = S.talkLog.map((l) => `<div class="${l.who === 'ruler' ? 'me' : 'npc'}">${esc(l.text)}</div>`).join('') || '<div class="dim">Say anything: ask what they see, give orders like "take the helicopter and attack" or "land and get out".</div>';
  if (scroll !== false) el.scrollTop = el.scrollHeight;
  if (S.inspect && S.inspect.id === S.talkTarget) $('talkWho').textContent = `💬 ${S.inspect.name} · ${S.inspect.type}${S.inspect.canFly ? ' · pilot' : ''}`;
}

function openTalk() {
  const own = selectedIds().map((id) => S.units.get(id)).find((u) => u && u.k === S.myK);
  if (own) return startTalk(own);
  const w = mouseWorld();
  let best = null, bd = 140 * 140;
  for (const u of S.units.values()) {
    if (u.k !== S.myK) continue;
    const d = (u.x - w.x) ** 2 + (u.y - w.y) ** 2;
    if (d < bd) (bd = d), (best = u);
  }
  if (!best && S.me) {
    bd = 260 * 260;
    for (const u of S.units.values()) {
      if (u.k !== S.myK) continue;
      const d = (u.x - S.me.x) ** 2 + (u.y - S.me.y) ** 2;
      if (d < bd) (bd = d), (best = u);
    }
  }
  if (!best) return toast('Select a unit (Q + click) or point at one of yours to talk');
  startTalk(best);
}
function startTalk(u) {
  if (S.talkTarget !== u.id) S.talkLog = [];
  S.talkTarget = u.id;
  $('talkWho').textContent = '💬 ' + unitInfo(u.def).name;
  $('talkBox').classList.remove('hidden');
  send({ t: 'inspect', id: u.id }); // loads their name + what you talked about before
  renderTalkLog();
  $('talkInput').focus();
}

// ------------------------------------------------------------------ Joint Military Command
const OPK = {
  strike: ['⚔', 'Joint Strike', 'Destroy enemy forces and buildings at the target, then push on to nearby targets'],
  defend: ['🛡', 'Joint Defense', 'Rush forces to protect a position until the attackers are repelled'],
  capture: ['🏘', 'Capture Town', 'Take a town hall and hold it until the town is yours'],
  patrol: ['✈', 'Air Patrol', 'Fighters and helicopters patrol the airspace over a point'],
};
S.jmc = null;
S.radio = [];
S.jmcSel = { kind: 'strike', share: 0.5, joint: true };

function isAlly(k) {
  if (k === S.myK) return true;
  if (k == null || k < 0 || !S.jmc || !S.jmc.coal) return false;
  return S.jmc.coal.members.includes(k);
}

function renderJmc() {
  const j = S.jmc;
  if (!j) return void ($('jmcBody').innerHTML = '<p class="dim">Contacting command…</p>');
  const sel = S.jmcSel;
  const maxP = Math.max(1, ...j.kingdoms.map((k) => k.power), j.aliens || 0);
  $('jmcSub').textContent = j.coal ? `Coalition: ${j.coal.name} · ${j.coal.members.length} kingdoms` : 'No coalition yet: you fight alone. Propose an alliance below.';
  let h = '';
  for (const x of j.inbox)
    h += `<div class="inbox">📜 <b>${esc(x.ruler)}</b> of ${esc(x.name)} proposes an alliance.<div class="row"><button class="primary sm" data-act="accept" data-k="${x.from}">🤝 Accept</button> <button class="ghost" data-act="decline" data-k="${x.from}">Decline</button></div></div>`;
  const mineK = j.kingdoms.find((k) => k.id === S.myK);
  const myTowns = (S.towns || []).filter((t) => t[4] === S.myK);
  h += `<h4>Your realm</h4><div class="jk"><span class="sw" style="background:${mineK ? mineK.color : '#888'}"></span><span class="nm"><b>Kingdom of ${esc(mineK ? mineK.name : '?')}</b></span><button data-act="renameK">✏️ Rename</button></div>`;
  for (const t of myTowns.slice(0, 12)) h += `<div class="jk"><span class="sw" style="background:#fff3"></span><span class="nm">🏘 ${esc(t[1])}</span><button data-act="renameT" data-id="${t[0]}" data-name="${esc(t[1])}">✏️</button></div>`;
  if (!myTowns.length) h += '<p class="hint">Capture towns to rename them.</p>';
  h += '<h4>Kingdoms</h4>';
  for (const k of j.kingdoms) {
    const mine = k.id === S.myK;
    const chip = mine ? '<span class="chip you">YOU</span>' : k.ally ? '<span class="chip ally">ALLY</span>' : '<span class="chip war">AT WAR</span>';
    const btn = mine ? (j.coal ? '<button class="ghost" data-act="leave">Leave pact</button>' : '') : k.ally ? '' : `<button data-act="propose" data-k="${k.id}">🤝 Propose</button>`;
    h += `<div class="jk"><span class="sw" style="background:${k.color}"></span><span class="nm"><b>${esc(k.name)}</b> <span class="dim">${esc(k.ruler)}${k.coal && !k.ally ? ' · ' + esc(k.coal) : ''}</span></span><span class="pw" title="Military strength ${k.power}"><i style="width:${(k.power / maxP) * 100}%"></i></span>${chip}${btn}</div>`;
  }
  if (j.aliens) h += `<div class="jk"><span class="sw" style="background:#80ff90"></span><span class="nm"><b>Alien invaders</b></span><span class="pw" title="Strength ${j.aliens}"><i style="width:${(j.aliens / maxP) * 100}%"></i></span><span class="chip war">HOSTILE</span></div>`;
  h += '<h4>Launch an operation</h4><div class="seg" data-grp="kind">' + Object.entries(OPK).map(([k, [ic, nm, d]]) => `<button data-v="${k}" class="${sel.kind === k ? 'on' : ''}" title="${d}">${ic} ${nm}</button>`).join('') + '</div>';
  h += `<p class="hint">${OPK[sel.kind][2]}.</p><p class="hint">Commit of your army:</p><div class="seg small" data-grp="share">` + [0.25, 0.5, 0.75, 1].map((v) => `<button data-v="${v}" class="${sel.share === v ? 'on' : ''}">${v * 100}%</button>`).join('') + '</div>';
  if (j.coal) h += `<label class="check"><input type="checkbox" id="jmcJoint" ${sel.joint ? 'checked' : ''}> Joint: allies send their committed forces too</label>`;
  h += '<button class="primary launch" data-act="pick">🎯 Pick the target on the map</button>';
  h += '<h4>Your army in allied operations</h4><div class="seg small" data-grp="contrib">' + [0, 25, 50, 75].map((v) => `<button data-v="${v}" class="${j.contrib === v ? 'on' : ''}">${v ? v + '%' : 'None'}</button>`).join('') + '</div>';
  h += `<p class="hint">Share of your army that joins operations launched by your allies${j.coal ? '' : ' (once you have allies)'}.</p>`;
  const ops = j.ops.slice().sort((a, b) => (a.phase === 'done') - (b.phase === 'done') || b.id - a.id);
  h += `<h4>Operations (${ops.filter((o) => o.phase !== 'done').length} active)</h4>`;
  if (!ops.length) h += '<p class="hint">No operations yet. Allied AI kingdoms launch their own, and you can join them.</p>';
  for (const o of ops) {
    const owner = j.kingdoms.find((k) => k.id === o.owner);
    const phase = o.phase === 'done' ? (o.result === 'success' ? '✅ SUCCESS' : o.result === 'failed' ? '❌ FAILED' : '⏹ ENDED') : o.phase === 'assemble' ? `⏳ ASSEMBLING ${o.ready}%` : '⚔ ENGAGED';
    const forces = Object.entries(o.forces)
      .map(([kid, n]) => {
        const k = j.kingdoms.find((x) => x.id === +kid);
        return `<span style="border-color:${k ? k.color : '#888'}">${esc(k ? k.name : '?')} ${n}</span>`;
      })
      .join('');
    const canCancel = o.phase !== 'done' && (o.owner === S.myK || o.joint);
    h += `<div class="opc ${o.phase === 'done' ? 'done' : ''}"><div class="t">${OPK[o.kind][0]} <b>${esc(o.name)}</b>${o.risk && o.phase !== 'done' ? `<span class="chip ${o.risk}" title="Intel at launch: enemy ${o.estFoe} vs our ${o.estOwn}">${o.risk.toUpperCase()} RISK</span>` : ''}</div>
      <div class="dim">${OPK[o.kind][1]} · ${phase} · by ${esc(o.by)}${owner && o.owner !== S.myK ? ' (' + esc(owner.name) + ')' : ''}${o.joint ? ' · joint' : ''}</div>
      <div class="bar"><i style="width:${o.start ? Math.min(100, (o.alive / o.start) * 100) : 0}%"></i></div>
      <div class="dim">${o.alive}/${o.start} units · ${esc(o.status || '')}${o.phase !== 'done' ? ` · ${Math.floor(o.left / 60)}:${String(o.left % 60).padStart(2, '0')} left` : ''}</div>
      <div class="forces">${forces}</div>
      <div class="btns"><button data-act="show" data-x="${o.tx}" data-y="${o.ty}">📍 Show</button>${canCancel ? `<button data-act="cancel" data-id="${o.id}">✖ Cancel</button>` : ''}</div></div>`;
  }
  h += '<h4>Coalition radio</h4><div class="radiofeed">' + (S.radio.length ? S.radio.slice(-14).reverse().map((r) => `<div style="border-color:${r.color}"><b>${esc(r.from)}:</b> ${esc(r.text)}</div>`).join('') : '<span class="hint">Silence on the radio.</span>') + '</div>';
  if (h !== S.jmcHtml) (S.jmcHtml = h), ($('jmcBody').innerHTML = h);
}

$('jmcBody').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const grp = b.parentElement.dataset.grp;
  if (grp === 'kind') S.jmcSel.kind = b.dataset.v;
  else if (grp === 'share') S.jmcSel.share = +b.dataset.v;
  else if (grp === 'contrib') send({ t: 'dip', action: 'contrib', v: +b.dataset.v / 100 });
  const act = b.dataset.act;
  if (act === 'renameK') return renameKingdom();
  if (act === 'renameT') return renameTown(+b.dataset.id, b.dataset.name);
  if (act === 'propose') send({ t: 'dip', action: 'propose', to: +b.dataset.k });
  else if (act === 'accept' || act === 'decline') send({ t: 'dip', action: act, from: +b.dataset.k });
  else if (act === 'leave') {
    // two clicks so a pact isn't broken by accident
    if (b.dataset.armed) send({ t: 'dip', action: 'leave' });
    else return void ((b.dataset.armed = 1), (b.textContent = 'Click again to leave'));
  } else if (act === 'cancel') send({ t: 'op', action: 'cancel', id: +b.dataset.id });
  else if (act === 'show') {
    S.ping = { x: +b.dataset.x, y: +b.dataset.y, until: performance.now() + 8000 };
    toast('Objective marked on the minimap');
  } else if (act === 'pick') {
    closeAll();
    S.pending = 'op:' + S.jmcSel.kind;
    toast(`${OPK[S.jmcSel.kind][1]}: click the target on the map or minimap (Esc cancels)`);
    return;
  }
  renderJmc();
});
$('jmcBody').addEventListener('change', (e) => {
  if (e.target.id === 'jmcJoint') S.jmcSel.joint = e.target.checked;
});

function launchOpAt(w) {
  const kind = S.pending.slice(3);
  S.pending = null;
  send({ t: 'op', action: 'launch', kind, x: Math.round(w.x), y: Math.round(w.y), share: S.jmcSel.share, joint: S.jmcSel.joint });
  S.marks.push({ x: w.x, y: w.y, t0: performance.now(), color: '#ffd27a' });
}

// objectives of our (and our allies') operations: crosshair on the target, dashed approach from staging
function drawOpMarkers(now, toSX, toSY, dpr) {
  if (!S.jmc) return;
  ctx.font = `700 ${Math.round(11 * dpr)}px "Pixelify Sans", monospace`;
  ctx.textAlign = 'center';
  for (const o of S.jmc.ops) {
    if (o.phase === 'done') continue;
    const col = o.owner === S.myK ? '255,215,120' : '120,215,255';
    const tx = toSX(o.tx), ty = toSY(o.ty);
    ctx.lineWidth = 2 * dpr;
    if (o.phase === 'assemble') {
      const sx = toSX(o.sx), sy = toSY(o.sy);
      ctx.setLineDash([8 * dpr, 7 * dpr]);
      ctx.strokeStyle = `rgba(${col},0.55)`;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(${col},0.9)`;
      ctx.beginPath();
      ctx.arc(sx, sy, 9 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(${col},0.95)`;
      ctx.fillText(`STAGING ${o.ready}%`, sx, sy - 14 * dpr);
    }
    const R = (15 + Math.sin(now / 260) * 2) * dpr;
    ctx.strokeStyle = `rgba(${col},0.95)`;
    ctx.beginPath();
    ctx.arc(tx, ty, R, 0, Math.PI * 2);
    ctx.moveTo(tx - R - 7 * dpr, ty);
    ctx.lineTo(tx - R + 6 * dpr, ty);
    ctx.moveTo(tx + R - 6 * dpr, ty);
    ctx.lineTo(tx + R + 7 * dpr, ty);
    ctx.moveTo(tx, ty - R - 7 * dpr);
    ctx.lineTo(tx, ty - R + 6 * dpr);
    ctx.moveTo(tx, ty + R - 6 * dpr);
    ctx.lineTo(tx, ty + R + 7 * dpr);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.lineWidth = 3 * dpr;
    const label = `${OPK[o.kind][0]} ${o.name}`;
    ctx.strokeText(label, tx, ty - R - 10 * dpr);
    ctx.fillStyle = `rgb(${col})`;
    ctx.fillText(label, tx, ty - R - 10 * dpr);
  }
  ctx.textAlign = 'left';
}

// ------------------------------------------------------------------ HUD
function updateHud() {
  const me = S.me;
  if (!me) return;
  const k = S.kingdoms.find((x) => x && x.id === S.myK);
  if (k) $('kName').innerHTML = `<i style="background:${k.color}"></i>Kingdom of ${esc(k.name)}`;
  const f = Math.max(0, me.hp / me.maxHp);
  $('hpFill').style.width = f * 100 + '%';
  $('hpFill').className = f > 0.5 ? '' : f > 0.25 ? 'mid' : 'low';
  $('hpText').textContent = `${Math.max(0, me.hp)} / ${me.maxHp}`;
  const wkey = me.weapons.join(',') + me.wi;
  if ($('weapons').dataset.k !== wkey) {
    $('weapons').dataset.k = wkey;
    $('weapons').innerHTML = '';
    me.weapons.forEach((w, i) => {
      const info = weaponInfo(w);
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === me.wi ? ' on' : '');
      slot.dataset.i = i;
      slot.title = info.name;
      const icon = weaponIcon(w, S.catalog.has(w) ? spriteSet(w, '#888888').frames[0] : null);
      const c = previewCanvas(icon, 32);
      slot.appendChild(c);
      slot.insertAdjacentHTML('beforeend', `<span class="num">${i + 1}</span><span class="wname">${esc(info.name)}</span>`);
      $('weapons').appendChild(slot);
    });
  }
  const v = me.vehicle && S.units.get(me.vehicle);
  const vs = me.veh;
  if (v && vs) {
    const info = unitInfo(v.def);
    const isAir = info.domain === 'air';
    const state = !isAir ? '' : { air: '✈ Airborne', landing: '⬇ Landing', takeoff: '⬆ Taking off', ground: '🛬 On the ground', crash: '🔥 Going down!' }[vs.flight] || '';
    const heli = info.art ? info.art.t === 'heli' : info.spriteKey === 'heli';
    const hint = !isAir ? 'E exit · steer against your heading to reverse' : vs.flight === 'ground' ? (heli ? 'L: lift off · E exit' : 'L or W along the runway: take off · E exit') : heli ? 'L: land anywhere on land · E E: bail out' : vs.runway ? '🛬 Runway ahead: press L to land' : 'L: land on a runway/carrier · Shift: afterburner · E E: eject';
    const altM = Math.round(vs.fly * (heli ? 3 : 95)) * (heli ? 1 : 1);
    const load = vs.ammoMax ? `<span class="ammo${vs.ammo ? '' : ' empty'}">🚀 ${vs.ammo}/${vs.ammoMax} ${esc(weaponInfo(vs.alt)?.name || '')}${vs.alt2 ? ' · auto AGM on ground targets' : ''}</span>` : '';
    const flares = isAir && vs.flares != null ? `<span>✨ ${vs.flares} flares · Space</span>` : '';
    $('vehicleInfo').innerHTML = `<b>${esc(info.name)}</b> · ${v.hp}/${v.maxHp} HP<div class="vstats"><span>${Math.round(vs.spd * 3.2)} km/h</span>${isAir ? `<span>ALT ${altM} m</span><span>${state}</span>` : ''}</div>${load || flares ? `<div class="vstats">${load}${flares}</div>` : ''}<div class="vhint">${hint}</div>`;
  } else $('vehicleInfo').textContent = '';
  $('dead').classList.toggle('hidden', !me.dead);
  if (me.dead) $('respawnIn').textContent = `Respawning in ${Math.ceil(me.respawn / 1000)}…`;
}
$('weapons').addEventListener('click', (e) => {
  const d = e.target.closest('[data-i]');
  if (d) send({ t: 'weapon', i: +d.dataset.i });
});

// the road to victory: a clear sequence of goals, from a first army to ruling the whole world
function renderGoals() {
  const me = S.kingdoms.find((k) => k && k.id === S.myK);
  if (!me) return;
  const rivals = S.kingdoms.filter((k) => k && k.id !== S.myK);
  const steps = [
    ['Raise an army of 25 (U)', me.units >= 25],
    ['Capture a free town', (me.towns || 0) >= 2],
    ['Rule 6 towns', (me.towns || 0) >= 6],
    ['Destroy a rival castle', rivals.some((k) => !k.castle)],
    ['Become the sole ruler 👑', rivals.length > 0 && rivals.every((k) => !k.castle && !(k.towns || 0))],
  ];
  const cur = steps.findIndex((s) => !s[1]);
  $('goals').innerHTML = '<b>Campaign</b>' + steps.map(([t, done], i) => `<div class="g ${done ? 'done' : i === cur ? 'now' : ''}">${done ? '✔' : i === cur ? '▶' : '•'} ${esc(t)}</div>`).join('');
}

function renderScores() {
  renderGoals();
  $('scores').innerHTML = S.kingdoms
    .filter(Boolean)
    .map((k) => `<div class="${k.id === S.myK ? 'me' : ''}" title="Kingdom of ${esc(k.name)}"><span><i style="background:${k.color}"></i>${esc(k.ruler)}${k.castle ? '' : ' 💀'}${k.id !== S.myK && isAlly(k.id) ? ' 🤝' : ''}</span><span>⚔${k.kills} 👥${k.units} 🏘${k.towns || 0}</span></div>`)
    .join('');
}

let toastTimer = 0;
function toast(t) {
  $('toast').textContent = t;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3200);
}
function log(html, cls = '') {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  $('log').appendChild(d);
  setTimeout(() => d.classList.add('old'), 14000);
  while ($('log').children.length > 12) $('log').firstChild.remove();
}

// ------------------------------------------------------------------ audio
const MUSIC = ['music/andrewbeck-ancient.mp3', 'music/battle-epic.mp3', 'music/andrewbeck-stings.mp3'];
function startMusic() {
  if (localStorageGet('pk_music') === 'off') return;
  const a = new Audio(MUSIC[Math.floor(Math.random() * MUSIC.length)]);
  a.volume = 0.25;
  a.onended = () => {
    S.music = null;
    startMusic();
  };
  a.play().catch(() => {
    addEventListener('mousedown', () => a.play().catch(() => {}), { once: true });
  });
  S.music = a;
}
function toggleMusic() {
  if (S.music) {
    S.music.pause();
    S.music = null;
    localStorageSet('pk_music', 'off');
    toast('Music off');
  } else {
    localStorageSet('pk_music', 'on');
    startMusic();
    toast('Music on');
  }
}
let actx = null;
let lastShot = 0;
function sfx(kind, f) {
  try {
    actx = actx || new AudioContext();
    if (kind === 'lock' || kind === 'seek') {
      // fighter radar tones: a steady high beep when locked, short low chirps while seeking
      const o = actx.createOscillator(), gn = actx.createGain(), t = actx.currentTime;
      o.type = 'square';
      o.frequency.value = kind === 'lock' ? 1320 : 660;
      gn.gain.setValueAtTime(0.035, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'lock' ? 0.18 : 0.05));
      o.connect(gn).connect(actx.destination);
      o.start(t);
      o.stop(t + 0.2);
      return;
    }
    if (kind === 'launch') {
      if (S.me && f && Math.hypot(f.x - S.me.x, f.y - S.me.y) > 900) return;
      const t = actx.currentTime, len = 0.9;
      const buf = actx.createBuffer(1, actx.sampleRate * len, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.5);
      const src = actx.createBufferSource();
      src.buffer = buf;
      const bp = actx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(400, t);
      bp.frequency.exponentialRampToValueAtTime(2400, t + len); // rising whoosh
      const gn = actx.createGain();
      gn.gain.value = 0.18;
      src.connect(bp).connect(gn).connect(actx.destination);
      src.start(t);
      return;
    }
    if (kind === 'shot') {
      if (performance.now() - lastShot < 60) return;
      lastShot = performance.now();
    }
    if (kind === 'boom' && S.me && f && Math.hypot(f.x - S.me.x, f.y - S.me.y) > 700) return;
    const t = actx.currentTime;
    const len = kind === 'boom' ? 0.5 : 0.06;
    const buf = actx.createBuffer(1, actx.sampleRate * len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, kind === 'boom' ? 2 : 4);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const gain = actx.createGain();
    gain.gain.value = kind === 'boom' ? 0.25 : 0.06;
    const filt = actx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = kind === 'boom' ? 500 : 3000;
    src.connect(filt).connect(gain).connect(actx.destination);
    src.start(t);
  } catch {}
}

// ------------------------------------------------------------------ render
const serverNow = () => Date.now() + S.clockOffset;
// ?tod=0.9 pins the time of day (0 = midnight, 0.5 = noon) — handy for screenshots
const FORCED_TOD = (() => {
  const v = parseFloat(new URLSearchParams(location.search).get('tod'));
  return Number.isFinite(v) ? ((v % 1) + 1) % 1 : null;
})();
let lastFrame = performance.now();
let shadowEllipse = null;
function ellipseShadow() {
  if (shadowEllipse) return shadowEllipse;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 12;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,14,24,0.34)';
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 32; x++) if (((x - 15.5) / 16) ** 2 + ((y - 5.5) / 6) ** 2 < 1) g.fillRect(x, y, 1, 1);
  return (shadowEllipse = c);
}

function frame(now) {
  requestAnimationFrame(frame);
  const f0 = performance.now();
  S.frameStart = f0;
  PROF.t = f0;
  const dt = Math.max(0, Math.min(0.1, (now - lastFrame) / 1000));
  lastFrame = now;
  if (!S.room || !S.me) return drawLobbyBg(now, dt);
  const time = serverNow() / 1000;
  const tod = FORCED_TOD ?? (((serverNow() - (S.room.started || 0)) / DAY_MS) + 0.33) % 1;
  const sky = skyAt(tod);
  const rain = rainAt(time);

  // interpolate entities + detect movement for animations and emitters
  const rt = now - INTERP_MS;
  const myVehId = S.me.vehicle || 0;
  for (const o of S.players.values()) {
    // our own character is predicted below (unless driving): interpolating it first made it jitter
    if (o.id !== S.myId || myVehId || S.me.dead || !o.predInit) interpolate(o, rt);
    o.speed = o.speed * 0.7 + (Math.hypot(o.x - o.px, o.y - o.py) / Math.max(dt, 0.001)) * 0.3;
    o.px = o.x;
    o.py = o.y;
  }
  for (const o of S.units.values()) {
    if (o.id !== myVehId || !o.predInit) interpolate(o, rt);
    o.speed = o.speed * 0.8 + (Math.hypot(o.x - o.px, o.y - o.py) / Math.max(dt, 0.001)) * 0.2;
    o.vx = (o.x - o.px) / Math.max(dt, 0.001);
    o.vy = (o.y - o.py) / Math.max(dt, 0.001);
    o.px = o.x;
    o.py = o.y;
  }
  const meP = S.players.get(S.myId);
  const meV = S.me.vehicle && S.units.get(S.me.vehicle);
  // your own character/vehicle: predict ahead of the newest snapshot so controls feel instant
  if (meP && !meV && !S.me.dead && meP.hist.length) {
    const s1 = meP.hist[meP.hist.length - 1];
    const el = Math.min(160, now - s1.t) / 1000;
    let mx = 0, my = 0;
    if (!typing()) {
      if (S.keys.has('a') || S.keys.has('arrowleft')) mx -= 1;
      if (S.keys.has('d') || S.keys.has('arrowright')) mx += 1;
      if (S.keys.has('w') || S.keys.has('arrowup')) my -= 1;
      if (S.keys.has('s') || S.keys.has('arrowdown')) my += 1;
    }
    const l = Math.hypot(mx, my) || 1;
    const sp = 125 * (S.keys.has('shift') ? 1.6 : 1);
    const px = s1.x + (mx / l) * sp * el, py = s1.y + (my / l) * sp * el;
    if (!meP.predInit || Math.hypot(px - meP.x, py - meP.y) > 120) (meP.x = px), (meP.y = py), (meP.predInit = true);
    else {
      const k2 = 1 - Math.exp(-dt * 16);
      meP.x += (px - meP.x) * k2;
      meP.y += (py - meP.y) * k2;
    }
    meP.a = Math.atan2(mouseWorld().y - meP.y, mouseWorld().x - meP.x);
  }
  if (meV && meV.hist.length) {
    // your vehicle: newest server state pushed forward by its real speed & heading (sent by the server),
    // then eased toward that target. No finite differences of bursty packets, so no wild jumps.
    const h = meV.hist, b = h[h.length - 1], a = h.length > 1 ? h[h.length - 2] : null;
    const el = Math.max(0, Math.min(150, now - b.t)) / 1000;
    let vx = Math.cos(b.a) * b.spd, vy = Math.sin(b.a) * b.spd;
    if (Math.abs(b.spd) < 1 && a) {
      // mounts (horses) don't report speed: use the last two samples over a sane time gap
      const g = Math.max(30, b.t - a.t) / 1000;
      vx = (b.x - a.x) / g;
      vy = (b.y - a.y) / g;
    }
    const px = b.x + vx * el, py = b.y + vy * el;
    if (!meV.predInit || Math.hypot(px - meV.x, py - meV.y) > 160) (meV.x = px), (meV.y = py), (meV.a = b.a), (meV.predInit = true);
    else {
      const k2 = 1 - Math.exp(-dt * 14);
      meV.x += (px - meV.x) * k2;
      meV.y += (py - meV.y) * k2;
      meV.a = angLerp(meV.a, b.a, k2);
      meV.aim = angLerp(meV.aim ?? b.aim, b.aim, k2);
      meV.fly = b.fly;
      meV.bank = meV.bank + (b.bank - meV.bank) * k2;
    }
    meV.lvx = vx;
    meV.lvy = vy;
  }
  const focus = S.spectate || meV || meP || S.me; // S.spectate = {x, y}: debug camera override
  // camera: smooth look-ahead in the direction you're driving/flying, so you see where you're going
  const ke = 1 - Math.exp(-dt * 2.5);
  S.lead ||= { x: 0, y: 0 };
  S.lead.x += ((meV && !S.spectate ? (meV.lvx || 0) * 0.45 : 0) - S.lead.x) * ke;
  S.lead.y += ((meV && !S.spectate ? (meV.lvy || 0) * 0.45 : 0) - S.lead.y) * ke;
  const fx2 = focus.x + S.lead.x, fy2 = focus.y + S.lead.y;
  const kc = 1 - Math.exp(-dt * 7);
  S.cam.x += (fx2 - S.cam.x) * kc;
  S.cam.y += (fy2 - S.cam.y) * kc;
  if (Math.abs(focus.x - S.cam.x) > 600 || Math.abs(focus.y - S.cam.y) > 600) (S.cam.x = focus.x), (S.cam.y = focus.y);
  S.shake *= Math.exp(-dt * 7);
  P.update(dt);

  const z = S.zoom * RS;
  const W = canvas.width, H = canvas.height;
  S.viewHalf = [Math.round(W / 2 / z), Math.round(H / 2 / z)];
  const sh = S.shake > 0.3 ? S.shake : 0;
  const camX = Math.round((S.cam.x + (Math.random() - 0.5) * sh) * z) / z, camY = Math.round((S.cam.y + (Math.random() - 0.5) * sh) * z) / z;
  const vx0 = camX - W / 2 / z, vy0 = camY - H / 2 / z, vx1 = camX + W / 2 / z, vy1 = camY + H / 2 / z;
  const toSX = (x) => (x - camX) * z + W / 2, toSY = (y) => (y - camY) * z + H / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0f325f';
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(z, 0, 0, z, Math.round(W / 2 - camX * z), Math.round(H / 2 - camY * z));

  // ---- terrain: level of detail by zoom, chunks from worker threads, prefetched around the view
  const cs = CH * TILE;
  const maxC = Math.floor((S.map.size - 1) / CH);
  const step = z >= 0.9 ? 1 : z >= 0.45 ? 2 : 4; // 512 / 256 / 128 px chunks
  const baked = S.zoom < 2; // zoomed out: trees & rocks come pre-drawn per chunk
  CK.syncBudget = 1;
  CK.bakeBudget = 2;
  const cx0 = Math.max(0, Math.floor(vx0 / cs)), cx1 = Math.min(maxC, Math.floor(vx1 / cs));
  const cy0 = Math.max(0, Math.floor(vy0 / cs)), cy1 = Math.min(maxC, Math.floor(vy1 / cs));
  const chunks = [], drawn = [];
  // visible chunks first (closest to the camera first), then a one-chunk ring ahead of time
  const want = [];
  for (let cy = Math.max(0, cy0 - 1); cy <= Math.min(maxC, cy1 + 1); cy++)
    for (let cx = Math.max(0, cx0 - 1); cx <= Math.min(maxC, cx1 + 1); cx++) want.push([cx, cy, cx < cx0 || cx > cx1 || cy < cy0 || cy > cy1]);
  const ccx = camX / cs, ccy = camY / cs;
  want.sort((a, b) => a[2] - b[2] || Math.hypot(a[0] + 0.5 - ccx, a[1] + 0.5 - ccy) - Math.hypot(b[0] + 0.5 - ccx, b[1] + 0.5 - ccy));
  for (const [cx, cy, ring] of want) {
    const c = getChunk(cx, cy, step, true);
    if (ring) continue;
    // not ready yet: show any other detail level we already have, else the minimap colours
    const show = c || getChunk(cx, cy, step === 1 ? 2 : 1, false) || getChunk(cx, cy, 4, false) || getChunk(cx, cy, 2, false);
    if (show) {
      ctx.drawImage(show.img, cx * cs, cy * cs, cs, cs);
      drawn.push(show);
      if (show.step === 1) chunks.push(show);
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mmBase, cx * CH, cy * CH, CH, CH, cx * cs, cy * cs, cs, cs);
      ctx.imageSmoothingEnabled = false;
    }
  }
  // zoomed out: one pre-baked image of trees & rocks per chunk (built by the worker)
  if (baked) for (const c of drawn) if (c.ov) ctx.drawImage(c.ov, c.cx * cs - OV_M, c.cy * cs - OV_M, cs + OV_M * 2, cs + OV_M * 2);

  PROF('terrain');
  // ---- animated water glints (close-up only)
  if (S.zoom >= 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (let ty = Math.max(0, Math.floor(vy0 / TILE)); ty <= Math.min(S.map.size - 1, Math.floor(vy1 / TILE)); ty++)
      for (let tx = Math.max(0, Math.floor(vx0 / TILE)); tx <= Math.min(S.map.size - 1, Math.floor(vx1 / TILE)); tx++) {
        if (S.map.tiles[ty * S.map.size + tx] > T.WATER) continue;
        const h = hash2(tx, ty, 77);
        if (h > 0.3) continue;
        const ph = (time * 0.5 + h * 10) % 3;
        if (ph < 1.2) {
          const len = ph < 0.6 ? 2 + Math.floor(ph * 6) : 6 - Math.floor((ph - 0.6) * 6);
          ctx.fillRect(tx * TILE + 3 + Math.floor(h * 40) % 8, ty * TILE + 3 + Math.floor(h * 70) % 10, Math.max(1, len), 1);
        }
      }
  }

  // ---- strategic view: every army as dots (the server only streams nearby units in detail)
  if (S.zoom < 1) {
    const u2 = S.mm.u;
    const sz = Math.max(3, 3 / z);
    for (let i = 0; i < u2.length; i += 3) {
      const x = (u2[i] + 0.5) * TILE, y = (u2[i + 1] + 0.5) * TILE;
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      ctx.fillStyle = kColor(u2[i + 2]);
      ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
  }
  // ---- tank tracks in the dirt
  S.tracks = S.tracks.filter((t) => now - t.t0 < 25000);
  for (const t of S.tracks) {
    if (t.x < vx0 - 20 || t.x > vx1 + 20 || t.y < vy0 - 20 || t.y > vy1 + 20) continue;
    ctx.fillStyle = `rgba(40,30,20,${0.32 * (1 - (now - t.t0) / 25000)})`;
    const px = -Math.sin(t.a) * t.w, py = Math.cos(t.a) * t.w;
    ctx.fillRect(Math.round(t.x + px), Math.round(t.y + py), 2, 2);
    ctx.fillRect(Math.round(t.x - px), Math.round(t.y - py), 2, 2);
  }

  // ---- ground decals (scorch marks)
  S.decals = S.decals.filter((d) => now - d.t0 < 45000);
  for (const d of S.decals) {
    ctx.globalAlpha = 0.45 * (1 - (now - d.t0) / 45000);
    ctx.drawImage(ellipseShadow(), d.x - d.r, d.y - d.r * 0.6, d.r * 2, d.r * 1.2);
  }
  ctx.globalAlpha = 1;

  PROF('ground fx');
  // ---- collect visible objects
  const objs = [];
  const occ = S.bOcc, msz = S.map.size;
  if (!baked) for (const c of chunks)
    for (const o of c.objects) {
      if (o.x < vx0 - 24 || o.x > vx1 + 24 || o.y < vy0 - 4 || o.y > vy1 + 30) continue;
      if (occ[o.ty * msz + o.tx]) continue;
      objs.push({ y: o.y, kind: 'nature', o });
    }
  const visB = [];
  const groundB = [];
  // zoomed out: buildings come from per-chunk baked layers (one image per 32×32 tiles) instead of
  // thousands of individual sprites
  const lodB = S.zoom < 0.75;
  for (const b of S.buildings.values()) {
    const d = b.def || (b.def = bdef(b.type));
    const x = b.tx * TILE, y = b.ty * TILE;
    if (x > vx1 + 20 || y - 70 > vy1 || x + d.w * TILE < vx0 - 40 || y + d.h * TILE < vy0) continue;
    const col = kColor(b.k);
    if (b.artCol !== col) (b.art = buildingFor(b.type, col, b.var || 0)), (b.artCol = col);
    const v = { b, d, art: b.art, x, y };
    visB.push(v);
    if (lodB) continue;
    // flat things (roads, fields, helipads, runways) lie on the ground: everything walks over them
    if (d.ground) groundB.push(v);
    else objs.push({ y: y + d.h * TILE, kind: 'building', v });
  }
  if (lodB) drawBuildingLayers(vx0, vy0, vx1, vy1, sky);
  for (const v of groundB) drawBuilding(v, now, time, sky);
  const air = [];
  for (const u of S.units.values()) {
    if (u.x < vx0 - 60 || u.x > vx1 + 60 || u.y < vy0 - 60 || u.y > vy1 + 60) continue;
    const info = unitInfo(u.def);
    u.info = info;
    if (info.domain === 'air' && (u.fly ?? 1) > 0.25) air.push(u);
    else objs.push({ y: u.y + 5, kind: 'unit', u });
  }
  for (const p of S.players.values()) if (!p.dead) objs.push({ y: p.y + 6, kind: 'player', p });

  PROF('collect');
  // ---- shadows
  const sun = 1 - sky.darkness;
  ctx.globalAlpha = 0.35 + sun * 0.65;
  const ell = ellipseShadow();
  for (const it of objs) {
    if (it.kind === 'nature') {
      const art = natureArt(it.o.kind, it.o.v);
      ctx.drawImage(ell, Math.round(it.o.x - art.shadow + 2), Math.round(it.o.y - 3), art.shadow * 2 + 3, 6);
    } else if (it.kind === 'building') {
      const { x, y, d, art } = it.v;
      ctx.fillStyle = 'rgba(8,14,24,0.3)';
      const L = art.lift * 0.8;
      ctx.beginPath();
      ctx.moveTo(x + d.w * TILE, y + 2);
      ctx.lineTo(x + d.w * TILE + L, y + 2 + L * 0.5);
      ctx.lineTo(x + d.w * TILE + L, y + d.h * TILE + L * 0.5);
      ctx.lineTo(x + L * 0.6, y + d.h * TILE + 2);
      ctx.lineTo(x, y + d.h * TILE);
      ctx.closePath();
      ctx.fill();
    } else if (it.kind === 'unit') {
      const r = it.u.info.r || 6;
      ctx.drawImage(ell, Math.round(it.u.x - r - 1), Math.round(it.u.y + r * 0.55 - 2), r * 2 + 2, Math.max(4, r * 0.7));
    } else ctx.drawImage(ell, Math.round(it.p.x - 6), Math.round(it.p.y + 4), 12, 5);
  }
  ctx.globalAlpha = 1;
  // aircraft cast a crisp silhouette shadow on the ground, offset by altitude
  for (const u of air) {
    const set = unitArt(u.info, kColor(u.k));
    const rot = u.info.art || ROTATING.has(u.info.spriteKey) || !SPRITES[u.info.spriteKey];
    ctx.save();
    const fl = u.fly ?? 1;
    ctx.globalAlpha = 0.22 + sun * 0.12;
    ctx.translate(Math.round(u.x + 2 + 16 * fl), Math.round(u.y + 3 + 22 * fl));
    if (rot) ctx.rotate(u.a);
    if (u.info.art) ctx.scale(0.86 + 0.14 * fl, (0.86 + 0.14 * fl) * (1 - Math.abs(u.bank || 0) * 0.28));
    ctx.drawImage(set.dark, -Math.floor(set.w / 2), -Math.floor(set.h / 2));
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  AMB.drawGround(ctx, time);

  P.draw(ctx, 'ground', vx0, vy0, vx1, vy1);

  PROF('shadows');
  // ---- y-sorted world
  objs.sort((a, b) => a.y - b.y);
  const focusX = focus.x, focusY = focus.y;
  for (const it of objs) {
    if (it.kind === 'nature') {
      const o = it.o, art = natureArt(o.kind, o.v);
      const x = Math.round(o.x - art.ax), y = Math.round(o.y - art.ay);
      // fade trees that hide the player
      const hide = o.kind !== 'rock' && o.kind !== 'bush' && focusX > x && focusX < x + art.c.width && focusY > y && focusY < o.y - 2;
      if (hide) ctx.globalAlpha = 0.45;
      ctx.drawImage(art.c, x, y);
      if (hide) ctx.globalAlpha = 1;
    } else if (it.kind === 'building') drawBuilding(it.v, now, time, sky);
    else if (it.kind === 'unit') drawUnit(it.u, it.u.info, now, dt);
    else drawPlayer(it.p, now);
  }

  PROF('world');
  // ---- projectiles as glowing tracers
  const bt = (now - S.bulletT) / 1000;
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, y, vx, vy, color, size, mk = 0] of S.bullets) {
    const bx = x + vx * bt, by = y + vy * bt;
    const sp = Math.hypot(vx, vy) || 1;
    if (mk && mk !== 3) {
      drawMissile(bx, by, Math.atan2(vy, vx), mk, now);
      continue;
    }
    if (size >= 5 || mk === 3) {
      // cruise missile (BrahMos): draw the airframe, a hot exhaust and a thick smoke trail
      const a = Math.atan2(vy, vx);
      ctx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(a);
      ctx.fillStyle = '#1a1a20';
      ctx.fillRect(-9, -2, 15, 4);
      ctx.fillStyle = '#eef0f0';
      ctx.fillRect(-8, -1.5, 12, 3);
      ctx.fillStyle = '#ff9933';
      ctx.fillRect(-3, -1.5, 1, 3);
      ctx.fillStyle = '#c8ccd0';
      ctx.fillRect(4, -1, 3, 2);
      ctx.fillRect(-7, -3, 2, 6);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,170,60,0.9)';
      ctx.fillRect(-15 - Math.random() * 6, -1, 7, 2);
      ctx.fillStyle = 'rgba(255,245,200,0.95)';
      ctx.fillRect(-10, -0.5, 2, 1);
      ctx.restore();
      ctx.globalCompositeOperation = 'lighter'; // back to additive for the other tracers
      if (Math.random() < 0.9) fx.trail(P, bx - Math.cos(a) * 12, by - Math.sin(a) * 12, '#e8e4dc');
      continue;
    }
    const len = Math.min(16, sp * 0.02);
    const tx = bx - (vx / sp) * len, ty = by - (vy / sp) * len;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = size + 2;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, size * 0.5);
    ctx.beginPath();
    ctx.moveTo((tx + bx) / 2, (ty + by) / 2);
    ctx.lineTo(bx, by);
    ctx.stroke();
    if (size >= 3 && Math.random() < 0.7) fx.trail(P, tx, ty);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // ---- clouds in the sky: the further out you zoom, the more you see them below the jets
  clouds.drawSky(ctx, vx0, vy0, vx1, vy1, time, Math.max(0, Math.min(0.55, (1.6 - S.zoom) * 0.4)) * (1 - sky.darkness * 0.5));
  ctx.globalCompositeOperation = 'source-over';

  // ---- aircraft (above everything on the ground)
  air.sort((a, b) => a.y - b.y);
  for (const u of air) drawUnit(u, u.info, now, dt);

  // ---- melee swings
  S.slashes = S.slashes.filter((f) => now - f.t0 < 180);
  for (const f of S.slashes) {
    const t = (now - f.t0) / 180;
    ctx.strokeStyle = f.c || '#fff';
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(f.x - Math.cos(f.a) * 6, f.y - Math.sin(f.a) * 6, 11, f.a - 1.1 + t * 0.6, f.a + 0.6 + t * 0.6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  PROF('bullets+air');
  P.draw(ctx, 'air', vx0, vy0, vx1, vy1);
  PROF('particles');
  AMB.update(dt, { x0: vx0, y0: vy0, x1: vx1, y1: vy1 }, S.map, sky.darkness > 0.35);
  AMB.drawAir(ctx, time, sky.darkness > 0.35);

  // ---- cloud shadows
  clouds.draw(ctx, vx0, vy0, vx1, vy1, time, (0.1 + rain * 0.12) * (0.4 + sun * 0.6));

  // ---- build ghost
  if (S.buildType) drawGhost();

  PROF('clouds');
  // ================= screen space =================
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const lights = collectLights(objs, air, visB, now, toSX, toSY, z, W, H, sky.darkness);
  const darkness = Math.min(0.85, sky.darkness + rain * 0.12);
  LIGHT.render(ctx, W, H, darkness, sky.ambient, lights, lightN);
  if (sky.grade[3] > 0.005) {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = `rgba(${sky.grade[0]},${sky.grade[1]},${sky.grade[2]},${sky.grade[3] * 2.2})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (rain > 0.01) {
    ctx.fillStyle = `rgba(30,45,70,${rain * 0.16})`;
    ctx.fillRect(0, 0, W, H);
    drawRain(ctx, W, H, time, rain, RS);
  }
  PROF('lighting');
  if (!vignette) {
    vignette = document.createElement('canvas');
    vignette.width = W;
    vignette.height = H;
    const vg = vignette.getContext('2d');
    const grd = vg.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,10,0.45)');
    vg.fillStyle = grd;
    vg.fillRect(0, 0, W, H);
  }
  ctx.drawImage(vignette, 0, 0);

  PROF('vignette');
  drawLabels(objs, air, visB, now, toSX, toSY, z);
  PROF('labels');
  if (now - (S.mmDrawn || 0) > 200) (S.mmDrawn = now), drawMinimap(); // minimap at 5 fps is plenty
  updateClock(tod, rain);
  adaptResolution(performance.now() - f0);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ world drawing
function drawBuilding(v, now, time, sky) {
  const { b, d, art, x, y } = v;
  const top = y - art.lift;
  ctx.drawImage(art.c, x, top);
  if (sky.darkness > 0.15) {
    ctx.globalAlpha = Math.min(1, sky.darkness * 1.4) * (0.85 + Math.sin(now / 400 + b.id) * 0.08);
    ctx.drawImage(art.mask, x, top);
    ctx.globalAlpha = 1;
  }
  const color = kColor(b.k);
  for (const [fx2, fy2, fcol, shape] of art.flags) drawFlag(ctx, x + fx2, top + fy2, fcol || color, time, b.id, shape);
  for (const [x0, y0, x1, y1] of art.prayer) drawPrayerFlags(ctx, x + x0, top + y0, x + x1, top + y1, time + b.id);
  for (const [bx, by, bcol, ph] of art.blink)
    if (Math.floor(time * 2 + (ph || 0) + b.id * 0.37) % 2 === 0) {
      ctx.fillStyle = bcol;
      ctx.fillRect(x + bx, top + by, 1, 1);
    }
  if (art.signal) {
    const st = Math.floor(time / 3 + b.id) % 3;
    ['#ff3030', '#ffd030', '#30ff60'].forEach((col, i) => ((ctx.fillStyle = i === st ? col : '#3a3a3a'), ctx.fillRect(x + art.signal[0] - 1, top + art.signal[1] + i * 3, 2, 2)));
  }
  if (art.flame && Math.random() < 0.3) fx.fire(P, x + art.flame[0], top + art.flame[1]);
  for (const [sx, sy, big] of art.steam) if (Math.random() < (big ? 0.18 : 0.05)) fx.steam(P, x + sx, top + sy, big);
  if (art.search.length && sky.darkness > 0.25) {
    // jail searchlights sweeping the approaches
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,250,215,${0.13 * sky.darkness})`;
    art.search.forEach(([sx, sy], i) => {
      const a = Math.PI / 2 + Math.sin(time * 0.7 + i * 2 + b.id) * 0.9, bx = x + sx, by = top + sy;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(a - 0.1) * 150, by + Math.sin(a - 0.1) * 150);
      ctx.lineTo(bx + Math.cos(a + 0.1) * 150, by + Math.sin(a + 0.1) * 150);
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
  }
  if (art.train) drawTrain(x, top, art, time + b.id * 7);
  if (art.hub) drawSails(ctx, x + art.hub[0], top + art.hub[1], time * 1.4 + b.id);
  if (art.dish) {
    // spinning radar dish
    const a = time * 1.8 + b.id, dx = Math.cos(a) * 7;
    ctx.fillStyle = '#d8dce0';
    ctx.fillRect(Math.round(x + art.dish[0] - Math.abs(dx)), top + art.dish[1] - 2, Math.max(2, Math.round(Math.abs(dx) * 2)), 3);
    ctx.fillStyle = '#8a9096';
    ctx.fillRect(Math.round(x + art.dish[0] - Math.abs(dx)), top + art.dish[1] + 1, Math.max(2, Math.round(Math.abs(dx) * 2)), 1);
    ctx.fillStyle = '#ff4040';
    if (Math.sin(time * 4) > 0) ctx.fillRect(x + art.dish[0], top + art.dish[1] - 4, 1, 1);
  }
  if (art.beacon && sky.darkness > 0.25) {
    // sweeping lighthouse beam
    const a = time * 0.9 + b.id, bx = x + art.beacon[0], by = top + art.beacon[1];
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,240,170,${0.16 * sky.darkness})`;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(a - 0.12) * 220, by + Math.sin(a - 0.12) * 220);
    ctx.lineTo(bx + Math.cos(a + 0.12) * 220, by + Math.sin(a + 0.12) * 220);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  for (const [cx2, cy2] of art.chimneys) if (Math.random() < (b.type === 'factory' ? 0.12 : 0.025)) fx.smoke(P, x + cx2, top + cy2, b.type === 'factory');
  if (sky.darkness > 0.2) for (const [fx3, fy3] of art.fires) if (Math.random() < 0.25) fx.fire(P, x + fx3, top + fy3);
  // burning when badly damaged
  const hpf = b.hp / b.maxHp;
  if (hpf < 0.55) {
    const n = hpf < 0.25 ? 0.5 : 0.22;
    if (Math.random() < n) fx.fire(P, x + Math.random() * d.w * TILE, top + art.lift * 0.5 + Math.random() * d.h * TILE * 0.6);
    if (Math.random() < n * 0.6) fx.smoke(P, x + Math.random() * d.w * TILE, top + Math.random() * art.lift, true);
  }
}

function drawUnit(u, info, now, dt) {
  const color = kColor(u.k);
  const key = info.spriteKey;
  const art = info.art;
  const set = unitArt(info, color, u);
  const moving = u.speed > 10;
  let fi = 0;
  if (moving && set.frames.length > 1) fi = [0, 1, 0, 2][Math.floor(now / (key === 'horse' || key === 'deer' || key === 'wolf' ? 90 : 130) + u.id) % 4];
  const spr = set.frames[fi];
  const rot = art ? true : SPRITES[key] ? ROTATING.has(key) : info.kind === 'vehicle' || info.domain !== 'foot';
  const isAir = info.domain === 'air';
  const bob = !rot && fi !== 0 ? -1 : 0;

  if (art) return drawVehicle(u, info, set, now, dt, color, moving);

  // kingdom ring under units (readability; skipped when zoomed far out)
  if (u.k >= 0 && !isAir && S.zoom >= 1.5) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = u.k === S.myK ? 0.7 : 0.5;
    ctx.lineWidth = 1;
    const r = (info.r || 6) + 1;
    ctx.beginPath();
    ctx.ellipse(Math.round(u.x) + 0.5, Math.round(u.y + r * 0.55) + 0.5, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // contrails for jets
  if (CONTRAIL.has(key)) {
    u.trail.push([u.x - Math.cos(u.a) * 8, u.y - Math.sin(u.a) * 8]);
    if (u.trail.length > 26) u.trail.shift();
    if (u.trail.length > 2) {
      ctx.strokeStyle = 'rgba(240,248,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      u.trail.forEach(([tx, ty], i) => (i ? ctx.lineTo(tx, ty) : ctx.moveTo(tx, ty)));
      ctx.stroke();
    }
  }
  // emitters
  if (moving && info.domain === 'land' && Math.random() < dt * 14) fx.dust(P, u.x - Math.cos(u.a) * 6, u.y - Math.sin(u.a) * 6 + 3);
  if (moving && info.domain === 'water' && Math.random() < dt * 30) fx.wake(P, u.x - Math.cos(u.a) * (info.r || 8), u.y - Math.sin(u.a) * (info.r || 8));
  if (info.kind === 'vehicle' && !info.mount && u.hp / u.maxHp < 0.4) {
    if (Math.random() < dt * 10) fx.smoke(P, u.x, u.y - 4, true);
    if (Math.random() < dt * 8) fx.fire(P, u.x, u.y - 2);
  }
  if (key === 'ufo' && Math.random() < dt * 8) fx.sparkle(P, u.x, u.y + 4, '#80ff80');

  ctx.save();
  ctx.translate(Math.round(u.x), Math.round(u.y) + bob);
  if (rot) {
    ctx.rotate(u.a);
    ctx.drawImage(spr, -Math.floor(spr.width / 2), -Math.floor(spr.height / 2));
    if (now - (u.flashT || 0) < 90) ctx.drawImage(set.white, -Math.floor(spr.width / 2), -Math.floor(spr.height / 2));
  } else {
    if (key === 'ufo') ctx.translate(0, Math.round(Math.sin(now / 300 + u.id) * 2));
    else if (!NOFLIP.has(key) && Math.cos(u.aim ?? u.a) < 0) ctx.scale(-1, 1);
    ctx.drawImage(spr, -Math.floor(spr.width / 2), -Math.floor(spr.height / 2));
    if (now - (u.flashT || 0) < 90) ctx.drawImage(set.white, -Math.floor(spr.width / 2), -Math.floor(spr.height / 2));
  }
  ctx.restore();
  if (key === 'heli') {
    const ra = now / 35;
    ctx.fillStyle = 'rgba(20,20,26,0.18)';
    ctx.beginPath();
    ctx.arc(u.x, u.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(25,25,30,0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const o of [0, Math.PI / 2]) {
      ctx.moveTo(u.x + Math.cos(ra + o) * 12, u.y + Math.sin(ra + o) * 12);
      ctx.lineTo(u.x - Math.cos(ra + o) * 12, u.y - Math.sin(ra + o) * 12);
    }
    ctx.stroke();
  }
  if (S.zoom >= 1.5 && !rot && (HUMANOID.has(key) || !SPRITES[key])) drawWeapon(u.x, u.y + bob, u.aim ?? u.a, info.weapon);
}

// ---- baked building layers for zoomed-out views
// Each map chunk (32×32 tiles) gets one half-resolution image of all its buildings (with shadows) plus a
// night-glow mask. Rebuilt only when that chunk's buildings change.
const BL = { cache: new Map(), byChunk: new Map(), sig: new Map() };
const BL_W = CH * TILE, BL_UP = 72, BL_RIGHT = 16 * TILE, BL_S = 0.5;
function indexBuildingLayers() {
  BL.byChunk.clear();
  BL.sig.clear();
  for (const b of S.buildings.values()) {
    const key = Math.floor(b.tx / CH) + ',' + Math.floor(b.ty / CH);
    let arr = BL.byChunk.get(key);
    if (!arr) BL.byChunk.set(key, (arr = []));
    arr.push(b);
    BL.sig.set(key, ((BL.sig.get(key) || 0) * 31 + b.id * 7 + (b.k + 5) * 131 + (b.var || 0)) % 2147483647);
  }
}
function buildLayer(cx, cy, list) {
  const w = Math.ceil((BL_W + BL_RIGHT) * BL_S), h = Math.ceil((BL_W + BL_UP) * BL_S);
  const c = document.createElement('canvas'), m = document.createElement('canvas');
  c.width = m.width = w;
  c.height = m.height = h;
  const g = c.getContext('2d'), gm = m.getContext('2d');
  g.scale(BL_S, BL_S);
  gm.scale(BL_S, BL_S);
  g.imageSmoothingEnabled = gm.imageSmoothingEnabled = false;
  const ox = cx * BL_W, oy = cy * BL_W - BL_UP;
  const sorted = [...list].sort((a, b) => (a.def?.ground ? 0 : 1) - (b.def?.ground ? 0 : 1) || a.ty + (a.def?.h || 1) - (b.ty + (b.def?.h || 1)));
  for (const b of sorted) {
    const d = b.def || (b.def = bdef(b.type));
    const art = b.art || (b.art = buildingFor(b.type, kColor(b.k), b.var || 0));
    const x = b.tx * TILE - ox, y = b.ty * TILE - oy;
    if (!d.ground && art.lift > 4) {
      g.fillStyle = 'rgba(8,14,24,0.3)';
      const L = art.lift * 0.8;
      g.beginPath();
      g.moveTo(x + d.w * TILE, y + 2);
      g.lineTo(x + d.w * TILE + L, y + 2 + L * 0.5);
      g.lineTo(x + d.w * TILE + L, y + d.h * TILE + L * 0.5);
      g.lineTo(x + L * 0.6, y + d.h * TILE + 2);
      g.lineTo(x, y + d.h * TILE);
      g.closePath();
      g.fill();
    }
    g.drawImage(art.c, x, y - art.lift);
    gm.drawImage(art.mask, x, y - art.lift);
  }
  return { c, m };
}
let blBudget = 0;
function drawBuildingLayers(vx0, vy0, vx1, vy1, sky) {
  blBudget = 3;
  for (let cy = Math.floor(vy0 / BL_W); cy <= Math.floor((vy1 + BL_UP) / BL_W); cy++)
    for (let cx = Math.floor((vx0 - BL_RIGHT) / BL_W); cx <= Math.floor(vx1 / BL_W); cx++) {
      const key = cx + ',' + cy;
      const list = BL.byChunk.get(key);
      if (!list) continue;
      let L = BL.cache.get(key);
      const sig = BL.sig.get(key);
      if (!L || L.sig !== sig) {
        if (blBudget-- <= 0 && L) {
          /* keep showing the stale layer until there's time to rebuild it */
        } else {
          L = { sig, ...buildLayer(cx, cy, list) };
          BL.cache.set(key, L);
        }
      }
      if (!L) continue;
      const x = cx * BL_W, y = cy * BL_W - BL_UP;
      ctx.drawImage(L.c, x, y, BL_W + BL_RIGHT, BL_W + BL_UP);
      if (sky.darkness > 0.15) {
        ctx.globalAlpha = Math.min(1, sky.darkness * 1.4) * 0.85;
        ctx.drawImage(L.m, x, y, BL_W + BL_RIGHT, BL_W + BL_UP);
        ctx.globalAlpha = 1;
      }
    }
  if (BL.cache.size > 160) for (const k of [...BL.cache.keys()].slice(0, 40)) BL.cache.delete(k);
}

// guided weapons in flight: 1 AAM, 2 AGM, 4 bomb, 5 rocket, 6 torpedo, 7 SAM (3 = cruise, drawn separately)
function drawMissile(x, y, a, mk, now) {
  const c = Math.cos(a), s = Math.sin(a);
  ctx.globalCompositeOperation = 'source-over';
  if (mk === 4) {
    // bomb: dark tumbling teardrop, its shadow racing below
    ctx.fillStyle = 'rgba(8,14,24,0.35)';
    ctx.fillRect(Math.round(x + 6), Math.round(y + 9), 4, 2);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = '#1e2024';
    ctx.fillRect(-4, -1.5, 7, 3);
    ctx.fillStyle = '#4a4e56';
    ctx.fillRect(-3, -1.5, 5, 1);
    ctx.fillStyle = '#2a2c30';
    ctx.fillRect(-5, -2.5, 2, 5);
    ctx.restore();
  } else if (mk === 6) {
    // torpedo: a dark shape just under the surface with a bubble wake
    ctx.fillStyle = 'rgba(10,30,50,0.55)';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillRect(-5, -1, 9, 2);
    ctx.restore();
    if (Math.random() < 0.6) fx.wake(P, x - c * 6, y - s * 6);
  } else {
    const len = mk === 2 ? 9 : mk === 5 ? 6 : 8;
    const body = mk === 2 ? '#a8ac9c' : mk === 5 ? '#6a6e62' : '#f2f2ee';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(10,10,16,0.75)';
    ctx.fillRect(-len / 2 - 1, -1.5, len + 2, 3);
    ctx.fillStyle = body;
    ctx.fillRect(-len / 2, -1, len, 2);
    ctx.fillStyle = mk === 1 || mk === 7 ? '#d83a2a' : '#3a3a3a';
    ctx.fillRect(len / 2 - 2, -1, 2, 2); // seeker head
    ctx.fillStyle = '#5a5e66';
    ctx.fillRect(-len / 2, -2.5, 2, 5); // tail fins
    // exhaust: hot core + flickering plume
    ctx.globalCompositeOperation = 'lighter';
    const fl = 4 + Math.random() * 5;
    ctx.fillStyle = 'rgba(255,150,50,0.85)';
    ctx.fillRect(-len / 2 - fl, -1, fl, 2);
    ctx.fillStyle = 'rgba(255,250,220,0.95)';
    ctx.fillRect(-len / 2 - 2, -0.5, 2, 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    if (Math.random() < 0.85) fx.missileTrail(P, x - c * (len / 2 + 3), y - s * (len / 2 + 3), mk);
  }
  ctx.globalCompositeOperation = 'lighter';
}

// a three-coach train calls at the station every ~40 s: pulls in, waits, departs
function drawTrain(x, top, art, t) {
  const ph = t % 40;
  if (ph > 22) return;
  const W = art.W, mid = W * 0.75;
  const tx = ph < 6 ? -10 + (mid + 10) * (1 - (1 - ph / 6) ** 2) : ph < 14 ? mid : mid + ((ph - 14) / 8) ** 2 * (W + 90);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, top, W, art.c.height);
  ctx.clip();
  const y = top + art.train.y;
  for (let k = 0; k < 3; k++) {
    const cx = x + tx - k * 25;
    ctx.fillStyle = 'rgba(10,10,16,0.7)';
    ctx.fillRect(cx - 24, y - 5, 24, 10);
    ctx.fillStyle = '#eef0f4';
    ctx.fillRect(cx - 23, y - 4, 22, 8);
    ctx.fillStyle = '#2a4ab0';
    ctx.fillRect(cx - 23, y + 1, 22, 2);
    ctx.fillStyle = '#22303e';
    for (let w = 0; w < 5; w++) ctx.fillRect(cx - 21 + w * 4, y - 2, 2, 2);
  }
  ctx.fillStyle = '#ff9933';
  ctx.fillRect(x + tx - 1, y - 4, 2, 8);
  ctx.fillStyle = '#fff6c0';
  ctx.fillRect(x + tx, y - 1, 1, 2);
  ctx.restore();
}

// procedural modern vehicles: jets, helicopters, warships, tanks
function drawVehicle(u, info, set, now, dt, color, moving) {
  const art = info.art;
  const cos = Math.cos(u.a), sin = Math.sin(u.a);
  const half = set.w / 2;
  const fly = info.domain === 'air' ? u.fly ?? 1 : 0;
  const isAir = fly > 0.25, isSea = info.domain === 'water';
  const own = u.k === S.myK;
  moving = moving && (u.spdS ?? 1) > 3;
  // tank tracks
  if (art.t === 'tank' && moving) {
    u.trackDist += u.speed * dt;
    if (u.trackDist > 5) {
      u.trackDist = 0;
      S.tracks.push({ x: u.x - cos * half * 0.6, y: u.y - sin * half * 0.6, a: u.a, w: (art.wid || 14) / 2 - 2, t0: now });
      if (S.tracks.length > 900) S.tracks.shift();
    }
  }
  // ground ring (not on civilian traffic)
  if (u.k >= 0 && !isAir && !info.civ && S.zoom >= 1.5) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = own ? 0.6 : 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(Math.round(u.x) + 0.5, Math.round(u.y) + 0.5, half + 2, set.h / 2 + 2, u.a, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // wingtip vapour when pulling a hard bank
  if (isJetArt(art) && moving && fly > 0.5 && Math.abs(u.bank || 0) > 0.45 && Math.random() < 0.7) {
    const span = (art.span || 20) / 2;
    for (const sd of [-1, 1]) fx.missileTrail(P, u.x - cos * half * 0.3 + sin * span * sd, u.y - sin * half * 0.3 - cos * span * sd, 1);
  }
  // contrails from wingtips / engines (only at altitude)
  if (isJetArt(art) && moving && fly > 0.7) {
    const span = (art.span || 20) / 2;
    u.trail.push([u.x - cos * half + sin * span, u.y - sin * half - cos * span, u.x - cos * half - sin * span, u.y - sin * half + cos * span]);
    if (u.trail.length > 30) u.trail.shift();
  } else if (u.trail.length) u.trail.shift();
  if (u.trail.length > 2) {
    ctx.lineWidth = 1;
    for (const side of [0, 2]) {
      ctx.beginPath();
      u.trail.forEach((p, i) => (i ? ctx.lineTo(p[side], p[side + 1]) : ctx.moveTo(p[side], p[side + 1])));
      ctx.strokeStyle = 'rgba(240,248,255,0.4)';
      ctx.stroke();
    }
  }
  // wakes for ships, dust for armour
  if (isSea && moving) {
    if (Math.random() < dt * (art.len / 2)) fx.wake(P, u.x - cos * half * 0.9 + (Math.random() - 0.5) * sin * 6, u.y - sin * half * 0.9 + (Math.random() - 0.5) * cos * 6);
    if (Math.random() < dt * 14) for (const s of [-1, 1]) fx.wake(P, u.x + cos * half * 0.8 + s * sin * art.beam * 0.4, u.y + sin * half * 0.8 - s * cos * art.beam * 0.4);
  }
  if (!isAir && !isSea && moving && Math.random() < dt * 16) fx.dust(P, u.x - cos * half, u.y - sin * half + 2);
  if (u.hp / u.maxHp < 0.4) {
    if (Math.random() < dt * 10) fx.smoke(P, u.x, u.y - 4, true);
    if (Math.random() < dt * 8) fx.fire(P, u.x, u.y - 2);
  }
  // body
  ctx.save();
  ctx.translate(Math.round(u.x), Math.round(u.y));
  ctx.rotate(u.a);
  if (info.domain === 'air') {
    // closer to the camera when high; wings foreshorten when banking
    const sc = 0.86 + 0.14 * fly;
    ctx.scale(sc, sc * (1 - Math.abs(u.bank || 0) * 0.28));
  }
  if (set.stealth && !own) ctx.globalAlpha = 0.5;
  ctx.drawImage(set.frames[0], -Math.floor(set.w / 2), -Math.floor(set.h / 2));
  if (now - (u.flashT || 0) < 90) ctx.drawImage(set.white, -Math.floor(set.w / 2), -Math.floor(set.h / 2));
  // missiles still on the pylons (they disappear one by one as they're fired)
  if (set.pylons && set.pylons.length && u.ammo >= 0) {
    const max = ammoMax(info);
    const n = max ? Math.ceil((u.ammo / max) * set.pylons.length) : 0;
    for (let i = 0; i < n; i++) {
      const [px, py] = set.pylons[set.pylons.length - 1 - i];
      ctx.fillStyle = 'rgba(10,10,16,0.7)';
      ctx.fillRect(Math.round(px - 3), Math.round(py - 1), 7, 2);
      ctx.fillStyle = info.alt2 && i % 2 ? '#c8ccbc' : '#f4f4f0';
      ctx.fillRect(Math.round(px - 2), Math.round(py - 0.5), 5, 1);
      ctx.fillStyle = '#d83a2a';
      ctx.fillRect(Math.round(px + 2), Math.round(py - 0.5), 1, 1);
    }
  }
  // afterburner
  if (isJetArt(art) && moving && fly > 0.05) {
    ctx.globalCompositeOperation = 'lighter';
    const fl = 2 + Math.random() * 3;
    const boost = (u.spdS || 0) > (info.speed || 300) * 1.05; // afterburner (Shift) pushes past top speed
    for (const [nx, ny] of set.nozzles) {
      const len = fl + (boost ? 5 : 0);
      ctx.fillStyle = boost ? 'rgba(120,170,255,0.55)' : 'rgba(255,120,40,0.45)';
      ctx.fillRect(-Math.floor(set.w / 2) - len - 2, ny - 1.5, len + 2, 3); // soft outer plume
      ctx.fillStyle = 'rgba(255,170,60,0.85)';
      ctx.fillRect(-Math.floor(set.w / 2) - len, ny - 0.5, len, 1.5);
      ctx.fillStyle = 'rgba(255,240,200,0.95)';
      ctx.fillRect(-Math.floor(set.w / 2) - 2, ny - 0.5, 2, 1.5);
      if (boost) for (let d = 3; d < len; d += 3) (ctx.fillStyle = 'rgba(255,255,255,0.7)'), ctx.fillRect(-Math.floor(set.w / 2) - d, ny - 0.5, 1, 1.5); // shock diamonds
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // police / ambulance light bars
  if (set.flash && (u.crewed || u.driven)) {
    const on = Math.floor(now / 170) % 2;
    set.flash.forEach(([fx2, fy2, fcol], i) => {
      if ((i + on) % 2) return;
      ctx.fillStyle = fcol;
      ctx.fillRect(Math.round(fx2), Math.round(fy2 - 0.5), 2, 1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35;
      ctx.fillRect(Math.round(fx2) - 2, Math.round(fy2) - 2, 6, 4);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    });
  }
  // tank turret aims independently
  if (set.turret) {
    ctx.translate(set.tpx, 0);
    ctx.rotate((u.aim ?? u.a) - u.a);
    ctx.drawImage(set.turret, -set.tpivot[0], -set.tpivot[1]);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // rotors
  // rotors spin up with altitude; parked empty helicopters sit still
  const spin = fly > 0.02 || u.driven || u.crewed ? 0.35 + 0.65 * Math.min(1, fly * 3 + (u.driven ? 0.4 : 0)) : 0;
  u.rotorA = (u.rotorA || 0) + dt * 30 * spin;
  for (const [rx, ry, rr] of set.rotors || []) {
    const x = u.x + cos * rx - sin * ry, y = u.y + sin * rx + cos * ry;
    if (spin > 0.3) {
      ctx.fillStyle = `rgba(20,20,26,${0.1 + spin * 0.08})`;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    const ra = u.rotorA + rx;
    ctx.strokeStyle = 'rgba(28,28,34,0.85)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let b = 0; b < 4; b++) {
      const a = ra + (b * Math.PI) / 2;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.stroke();
    ctx.fillStyle = '#2a2a30';
    ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
  }
}

function drawPlayer(p, now) {
  const color = kColor(p.k);
  const set = spriteSet('king', color);
  const moving = p.speed > 10;
  const fi = moving ? [0, 1, 0, 2][Math.floor(now / 110) % 4] : 0;
  const spr = set.frames[fi];
  const bob = fi ? -1 : 0;
  // royal glow ring
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(Math.round(p.x) + 0.5, Math.round(p.y + 6) + 0.5, 8, 3.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (moving && Math.random() < 0.15) fx.dust(P, p.x, p.y + 6);
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y) + bob);
  if (Math.cos(p.a) < 0) ctx.scale(-1, 1);
  ctx.drawImage(spr, -7, -8);
  if (now - (p.flashT || 0) < 90) ctx.drawImage(set.white, -7, -8);
  ctx.restore();
  drawWeapon(p.x, p.y + bob, p.a, p.weapon);
}

function drawWeapon(x, y, a, wkey) {
  const w = weaponInfo(wkey);
  if (!w || w.hidden) return;
  if (w.spriteKey) {
    const spr = spriteSet(w.spriteKey, '#888888').frames[0];
    ctx.save();
    ctx.translate(Math.round(x + Math.cos(a) * 6), Math.round(y + 1 + Math.sin(a) * 6));
    ctx.rotate(a);
    if (Math.cos(a) < 0) ctx.scale(1, -1);
    ctx.drawImage(spr, 0, -5, 11, 11);
    ctx.restore();
    return;
  }
  const len = w === WEAPONS.spear ? 13 : w.melee ? 9 : w.splash ? 9 : 7;
  const col = w === WEAPONS.spear ? '#8a6a40' : w.melee ? '#e8ecf4' : w === WEAPONS.bow || w === WEAPONS.towerbow ? '#8a5a30' : w === WEAPONS.laser ? '#a0ffa0' : '#2a2a30';
  const x0 = Math.round(x + Math.cos(a) * 3), y0 = Math.round(y + 1 + Math.sin(a) * 3);
  const x1 = Math.round(x + Math.cos(a) * (3 + len)), y1 = Math.round(y + 1 + Math.sin(a) * (3 + len));
  ctx.strokeStyle = 'rgba(10,10,16,0.8)';
  ctx.lineWidth = (w.splash ? 3 : 2) + 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = col;
  ctx.lineWidth = w.splash ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function drawGhost() {
  const { tx, ty } = mouseTile();
  const def = S.buildType === 'demolish' ? { w: 1, h: 1 } : bdef(S.buildType);
  let ok = true;
  for (let j = 0; j < def.h; j++)
    for (let i = 0; i < def.w; i++) {
      const t = S.map.tiles[(ty + j) * S.map.size + tx + i];
      if (t === undefined || t <= T.WATER) ok = false;
      for (const b of S.buildings.values()) {
        if (Math.abs(b.tx - tx) > 4 || Math.abs(b.ty - ty) > 4) continue;
        const bd = bdef(b.type);
        if (tx + i >= b.tx && tx + i < b.tx + bd.w && ty + j >= b.ty && ty + j < b.ty + bd.h) ok = S.buildType === 'demolish' ? b.k === S.myK : false;
      }
    }
  ctx.fillStyle = ok ? 'rgba(90,255,120,0.18)' : 'rgba(255,70,70,0.22)';
  ctx.fillRect(tx * TILE, ty * TILE, def.w * TILE, def.h * TILE);
  if (S.buildType !== 'demolish') {
    const art = buildingFor(S.buildType, kColor(S.myK));
    ctx.globalAlpha = 0.65;
    ctx.drawImage(art.c, tx * TILE, ty * TILE - art.lift);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = ok ? '#60ff80' : '#ff4040';
  ctx.lineWidth = 1;
  ctx.strokeRect(tx * TILE + 0.5, ty * TILE + 0.5, def.w * TILE - 1, def.h * TILE - 1);
}

// ------------------------------------------------------------------ lights
// pooled light records: no per-frame garbage (GC pauses were a source of frame spikes)
const LPOOL = [];
const LMAX = 400;
let lightN = 0;
function collectLights(objs, air, visB, now, toSX, toSY, z, W, H, darkness) {
  lightN = 0;
  const add = (x, y, r, i, color, flash) => {
    if (lightN >= LMAX) return;
    const sx = toSX(x), sy = toSY(y), R = r * z;
    if (sx < -R || sy < -R || sx > W + R || sy > H + R) return;
    const l = LPOOL[lightN] || (LPOOL[lightN] = {});
    lightN++;
    l.x = sx; l.y = sy; l.r = R; l.i = i; l.color = color; l.flash = !!flash;
  };
  const out = LPOOL;
  const night = darkness > 0.05;
  if (night) {
    for (const { b, art, x, y } of visB) {
      const flick = 0.85 + Math.sin(now / 160 + b.id * 3) * 0.06;
      for (const [lx, ly, lr] of art.lights) add(x + lx, y - art.lift + ly, lr, flick, '#ffb060');
      for (const [bx, by, bcol] of art.blink) add(x + bx, y - art.lift + by, 22, 0.9, bcol);
      if (art.signal) add(x + art.signal[0], y - art.lift + art.signal[1] + 3, 14, 0.8, ['#ff3030', '#ffd030', '#30ff60'][Math.floor(now / 3000 + b.id) % 3]);
      for (const [fx2, fy2] of art.fires) add(x + fx2, y - art.lift + fy2, 34, 0.9 + Math.random() * 0.1, '#ff8a30');
      if (b.hp / b.maxHp < 0.55) add(x + art.W / 2, y, 70, 0.8, '#ff7020');
    }
    for (const it of objs) {
      if (it.kind === 'player') add(it.p.x, it.p.y, 95, 0.95, '#ffd9a0');
      else if (it.kind === 'unit') {
        const u = it.u;
        if (u.info.spriteKey === 'alien') add(u.x, u.y, 32, 0.7, '#80ff90');
        else if (u.info.kind === 'vehicle' && !u.info.mount) {
          add(u.x + Math.cos(u.a) * 14, u.y + Math.sin(u.a) * 14, 48, 0.75, '#fff2c8');
          if (u.info.art?.flash && (u.crewed || u.driven)) add(u.x, u.y, 54, 0.85, Math.floor(now / 170) % 2 && u.info.art.flash === 'police' ? '#3060ff' : '#ff3030');
        }
        else if (u.k >= 0 && u.id % 3 === 0) add(u.x, u.y, 34, 0.55, '#ffc070');
      }
    }
    for (const u of air) add(u.x, u.y, u.info.spriteKey === 'ufo' ? 110 : 40, 0.8, u.info.spriteKey === 'ufo' ? '#80ff80' : '#ff6060');
    const bt = (now - S.bulletT) / 1000;
    for (const [x, y, vx, vy, color] of S.bullets) add(x + vx * bt, y + vy * bt, 20, 0.8, color);
  }
  // missile and rocket exhausts glow even by day
  const bt2 = (now - S.bulletT) / 1000;
  for (const [x, y, vx, vy, , , mk] of S.bullets) if (mk && mk !== 4 && mk !== 6) add(x + vx * bt2, y + vy * bt2, 30, 0.45, '#ff9a40', true);
  if (S.flashes.length && now - S.flashes[0].t0 >= 450) S.flashes = S.flashes.filter((f) => now - f.t0 < 450);
  for (const f of S.flashes) {
    const t = (now - f.t0) / 450;
    add(f.x, f.y, f.r * (f.weak ? 0.6 : 1), (1 - t) * (f.weak ? 0.4 : 1), f.weak ? '#e0e8ff' : '#ffb050', true);
  }
  return out;
}

// ------------------------------------------------------------------ crisp screen-space labels
// selection rings, drag box, order markers, runway guide, who's driving what
// missile lock: hold the cursor near an enemy while flying; the diamond closes in and turns red when locked
function drawLockOn(now, toSX, toSY, dpr) {
  const vs = S.me && S.me.veh;
  const v = S.me && S.me.vehicle && S.units.get(S.me.vehicle);
  if (!vs || !vs.ammoMax || !v || (v.fly ?? 0) < 0.3) return void (S.lock = null);
  const w = mouseWorld();
  let best = null, bd = 240;
  for (const u of S.units.values()) {
    if (isAlly(u.k) || u.k === -1 || u.id === v.id) continue;
    const info = u.info || (u.info = unitInfo(u.def));
    if (info.passive || info.civ) continue;
    const d = Math.hypot(u.x - w.x, u.y - w.y);
    if (d < bd) (bd = d), (best = u);
  }
  for (const p of S.players.values()) {
    if (isAlly(p.k) || p.dead) continue;
    const d = Math.hypot(p.x - w.x, p.y - w.y);
    if (d < bd) (bd = d), (best = p);
  }
  if (!best) return void (S.lock = null);
  if (!S.lock || S.lock.id !== best.id) S.lock = { id: best.id, t0: now, beeped: false, chirp: 0 };
  const prog = Math.min(1, (now - S.lock.t0) / 650);
  const locked = prog >= 1;
  if (locked && !S.lock.beeped) (S.lock.beeped = true), sfx('lock');
  else if (!locked && now - S.lock.chirp > 160) (S.lock.chirp = now), sfx('seek');
  const air = (best.fly ?? 0) > 0.3 || (best.info && best.info.domain === 'air' && (best.fly ?? 1) > 0.3);
  const sx = toSX(best.x), sy = toSY(best.y);
  const r = (12 + (1 - prog) * 22) * dpr;
  ctx.strokeStyle = locked ? '#ff3a3a' : '#ffd84a';
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(sx, sy - r);
  ctx.lineTo(sx + r, sy);
  ctx.lineTo(sx, sy + r);
  ctx.lineTo(sx - r, sy);
  ctx.closePath();
  ctx.stroke();
  if (locked) {
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.45, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.font = `700 ${Math.round(11 * dpr)}px "Pixelify Sans", monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = locked ? '#ff6a6a' : '#ffe48a';
  ctx.fillText(locked ? `LOCK · ${air || !vs.alt2 ? 'AAM' : 'AGM'} · RMB` : 'SEEKING…', sx, sy - r - 6 * dpr);
}

function drawCommandOverlay(now, toSX, toSY, z) {
  const dpr = RS;
  drawLockOn(now, toSX, toSY, dpr);
  ctx.lineWidth = 2 * dpr;
  // runway guide: dashed extended centre lines when you're flying a jet
  const meV = S.me.vehicle && S.units.get(S.me.vehicle);
  if (meV && (meV.info || unitInfo(meV.def)).art?.t !== 'heli' && (meV.info || unitInfo(meV.def)).domain === 'air' && (meV.fly ?? 1) > 0.2) {
    ctx.setLineDash([10 * dpr, 10 * dpr]);
    for (const b of S.buildings.values()) {
      if (b.type !== 'airport' || (b.k !== S.myK && b.k !== -3)) continue;
      const cy = b.ty * TILE + 64, x0 = b.tx * TILE + 22, x1 = (b.tx + 16) * TILE - 22;
      if (Math.hypot((x0 + x1) / 2 - meV.x, cy - meV.y) > 3000) continue;
      ctx.strokeStyle = 'rgba(120,255,160,0.75)';
      ctx.beginPath();
      ctx.moveTo(toSX(x0 - 520), toSY(cy));
      ctx.lineTo(toSX(x0), toSY(cy));
      ctx.moveTo(toSX(x1), toSY(cy));
      ctx.lineTo(toSX(x1 + 520), toSY(cy));
      ctx.stroke();
      ctx.font = `700 ${Math.round(11 * dpr)}px "Pixelify Sans", monospace`;
      ctx.fillStyle = 'rgba(160,255,190,0.95)';
      ctx.textAlign = 'center';
      ctx.fillText('RWY 09 ▶', toSX(x0 - 260), toSY(cy) - 8 * dpr);
      ctx.fillText('◀ RWY 27', toSX(x1 + 260), toSY(cy) - 8 * dpr);
    }
    ctx.setLineDash([]);
  }
  // selected units
  const pulse = 0.65 + Math.sin(now / 200) * 0.25;
  for (const id of S.sel) {
    const u = S.units.get(id);
    if (!u) continue;
    const info = u.info || (u.info = unitInfo(u.def));
    const r = ((info.r || 6) + 4) * z;
    ctx.strokeStyle = u.k === S.myK ? `rgba(110,255,140,${pulse})` : `rgba(255,210,120,${pulse})`;
    ctx.beginPath();
    ctx.ellipse(toSX(u.x), toSY(u.y + (info.r || 6) * 0.3), r, r * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawOpMarkers(now, toSX, toSY, dpr);
  // order markers
  S.marks = S.marks.filter((m) => now - m.t0 < 900);
  for (const m of S.marks) {
    const t = (now - m.t0) / 900;
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = m.color;
    ctx.beginPath();
    ctx.arc(toSX(m.x), toSY(m.y), (6 + t * 18) * dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // drag box
  if (S.drag) {
    const d = S.drag;
    ctx.fillStyle = 'rgba(110,255,140,0.08)';
    ctx.strokeStyle = 'rgba(110,255,140,0.8)';
    ctx.lineWidth = dpr;
    ctx.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
  }
  // pending order hint at the cursor
  if (S.pending || commanding()) {
    ctx.font = `700 ${Math.round(12 * dpr)}px "Pixelify Sans", monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff6dc';
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.lineWidth = 3 * dpr;
    const label = S.pending ? (S.pending.startsWith('op:') ? `🎯 click the target: ${OPK[S.pending.slice(3)][1]} (map or minimap · Esc cancels)` : { move: '➜ click to MOVE', attack: '⚔ click to ATTACK', board: '✈ click an EMPTY vehicle' }[S.pending]) : S.sel.size ? '⌖ right-click: order' : '⌖ click / drag: select';
    ctx.strokeText(label, S.mouse.x + 16 * dpr, S.mouse.y + 4 * dpr);
    ctx.fillText(label, S.mouse.x + 16 * dpr, S.mouse.y + 4 * dpr);
  }
}

// town name plates are rendered once into small images (outlined text is expensive every frame)
const LABELS = new Map();
function townLabel(name, col, sub, dpr) {
  const key = name + '|' + col + '|' + sub + '|' + dpr;
  let c = LABELS.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  const g = c.getContext('2d');
  const f1 = `700 ${Math.round(14 * dpr)}px "Pixelify Sans", "VT323", monospace`, f2 = `500 ${Math.round(10 * dpr)}px "Pixelify Sans", "VT323", monospace`;
  g.font = f1;
  let w = g.measureText(name).width;
  g.font = f2;
  if (sub) w = Math.max(w, g.measureText(sub).width);
  c.width = Math.ceil(w + 8 * dpr);
  c.height = Math.ceil((sub ? 32 : 19) * dpr);
  g.textAlign = 'center';
  g.lineWidth = 3 * dpr;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.font = f1;
  g.strokeText(name, c.width / 2, 14 * dpr);
  g.fillStyle = col;
  g.fillText(name, c.width / 2, 14 * dpr);
  if (sub) {
    g.font = f2;
    g.strokeText(sub, c.width / 2, 27 * dpr);
    g.fillStyle = 'rgba(230,230,230,0.9)';
    g.fillText(sub, c.width / 2, 27 * dpr);
  }
  if (LABELS.size > 400) LABELS.clear();
  LABELS.set(key, c);
  return c;
}

function drawLabels(objs, air, visB, now, toSX, toSY, z) {
  drawCommandOverlay(now, toSX, toSY, z);
  // other rulers' names over the vehicles they're driving
  for (const u of S.units.values()) {
    if (!u.driverName || u.id === S.me.vehicle) continue;
    const sx = toSX(u.x), sy = toSY(u.y - ((u.info || (u.info = unitInfo(u.def))).r || 8) - 12);
    if (sx < -50 || sy < -50 || sx > canvas.width + 50 || sy > canvas.height + 50) continue;
    ctx.font = `700 ${Math.round(12 * RS)}px "Pixelify Sans", monospace`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3 * RS;
    ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.strokeText('👑 ' + u.driverName, sx, sy);
    ctx.fillStyle = kColor(u.k);
    ctx.fillText('👑 ' + u.driverName, sx, sy);
  }
  const dpr = RS;
  const font = (px, weight = 600) => `${weight} ${Math.round(px * dpr)}px "Pixelify Sans", "VT323", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const bar = (sx, sy, w, f, col) => {
    w = Math.round(w);
    const h = Math.max(3, Math.round(3 * dpr));
    sx = Math.round(sx - w / 2);
    sy = Math.round(sy);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(sx - 1, sy - 1, w + 2, h + 2);
    ctx.fillStyle = '#3a1416';
    ctx.fillRect(sx, sy, w, h);
    ctx.fillStyle = col || (f > 0.5 ? '#5fd36e' : f > 0.25 ? '#f0c94a' : '#f05050');
    ctx.fillRect(sx, sy, Math.max(0, Math.round(w * f)), h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(sx, sy, Math.max(0, Math.round(w * f)), 1);
  };
  const text = (s, sx, sy, col, px, weight) => {
    ctx.font = font(px, weight);
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(s, sx, sy);
    ctx.fillStyle = col;
    ctx.fillText(s, sx, sy);
  };
  // buildings hp
  for (const { b, art, x, y } of visB) if (b.hp < b.maxHp && b.k !== -3) bar(toSX(x + art.W / 2), toSY(y - art.lift - 4), art.W * z * 0.8, b.hp / b.maxHp);
  // towns
  for (const [, name, x, y, k, progress, capturer] of S.towns) {
    const sx = toSX(x), sy = toSY(y - 34);
    if (sx < -200 || sy < -50 || sx > canvas.width + 200 || sy > canvas.height + 50) continue;
    const img = townLabel(name, k < 0 ? '#fff4d6' : kColor(k), z < 0.6 ? '' : k < 0 ? 'Free town · capture it!' : kName(k), dpr);
    ctx.drawImage(img, Math.round(sx - img.width / 2), Math.round(sy - 14 * dpr));
    if (progress > 0) bar(sx, sy + 18 * dpr, 70 * dpr, progress / 6, kColor(capturer));
  }
  // units / players
  for (const it of objs) {
    if (it.kind === 'unit') {
      const u = it.u;
      if (u.hp < u.maxHp) bar(toSX(u.x), toSY(u.y - (u.info.r || 6) - 9), Math.max(14, (u.info.r || 6) * 2.4) * z, u.hp / u.maxHp);
    } else if (it.kind === 'player') {
      const p = it.p;
      text(p.name, toSX(p.x), toSY(p.y - 15), p.id === S.myId ? '#ffffff' : kColor(p.k), 12, 700);
      bar(toSX(p.x), toSY(p.y - 13), 18 * z, p.hp / p.maxHp);
    }
  }
  for (const u of air) if (u.hp < u.maxHp) bar(toSX(u.x), toSY(u.y - 16), 22 * z, u.hp / u.maxHp);
  // vehicles: EMPTY tags and an "E to enter" prompt for the nearest one you can board
  const me = S.players.get(S.myId);
  if (me && !S.me.vehicle && !S.me.dead) {
    let best = null, bd = Infinity;
    for (const u of S.units.values()) {
      const info = u.info || (u.info = unitInfo(u.def));
      if (info.kind !== 'vehicle' || u.driven) continue;
      const d = Math.hypot(u.x - me.x, u.y - me.y);
      const empty = !info.mount && !u.crewed;
      if (empty && d < 420 && (u.fly ?? 0) < 0.3) text('EMPTY', toSX(u.x), toSY(u.y + (info.r || 8) + 9), '#ffd27a', 10, 700);
      const ok = u.k === S.myK || empty || (u.k === -1 && info.mount);
      if (ok && d < (info.r || 8) + 30 && d < bd && (u.fly ?? 0) < 0.3) (bd = d), (best = [u, info, empty]);
    }
    if (best) {
      const [u, info, empty] = best;
      const label = `E  ${u.k !== S.myK && !info.mount ? 'Commandeer' : 'Enter'} ${info.name}${empty ? '' : u.k === S.myK && !info.mount ? ' (crew hops out)' : ''}`;
      ctx.font = font(13, 700);
      const w = ctx.measureText(label).width + 18 * dpr, sx = toSX(u.x), sy = toSY(u.y - (info.r || 8) - 18);
      ctx.fillStyle = 'rgba(14,17,30,0.85)';
      roundRect(sx - w / 2, sy - 16 * dpr, w, 22 * dpr, 8 * dpr);
      ctx.fill();
      ctx.strokeStyle = '#f4c95d';
      ctx.lineWidth = dpr;
      ctx.stroke();
      ctx.fillStyle = '#fff6dc';
      ctx.fillText(label, sx, sy);
    }
  }
  // floating damage numbers
  S.floats = S.floats.filter((f) => now - f.t0 < 900);
  for (const f of S.floats) {
    const t = (now - f.t0) / 900;
    ctx.globalAlpha = 1 - t * t;
    text(f.text, toSX(f.x), toSY(f.y) - t * 26 * dpr, f.color, 13 + (1 - t) * 3, 700);
  }
  ctx.globalAlpha = 1;
  // speech bubbles
  for (const [id, b] of S.bubbles) {
    if (now > b.until) {
      S.bubbles.delete(id);
      continue;
    }
    const u = S.units.get(id);
    if (u) bubble(toSX(u.x), toSY(u.y - 18), b.text === '…' ? '.'.repeat(1 + (Math.floor(now / 300) % 3)) : b.text);
  }
}

function bubble(x, y, text) {
  const dpr = RS;
  ctx.font = `500 ${Math.round(12 * dpr)}px "Pixelify Sans", "VT323", monospace`;
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).length > 34) lines.push(cur), (cur = w);
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  const shown = lines.slice(0, 5);
  const lh = 15 * dpr, pad = 8 * dpr;
  const w = Math.max(...shown.map((l) => ctx.measureText(l).width)) + pad * 2, h = shown.length * lh + pad * 1.4;
  const bx = Math.round(x - w / 2), by = Math.round(y - h - 8 * dpr);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(bx + 2 * dpr, by + 3 * dpr, w, h, 8 * dpr);
  ctx.fill();
  ctx.fillStyle = 'rgba(252,248,236,0.97)';
  roundRect(bx, by, w, h, 8 * dpr);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 6 * dpr, by + h);
  ctx.lineTo(x, by + h + 7 * dpr);
  ctx.lineTo(x + 6 * dpr, by + h);
  ctx.fill();
  ctx.fillStyle = '#1e1a24';
  ctx.textAlign = 'center';
  shown.forEach((l, i) => ctx.fillText(l, x, by + pad + lh * (i + 0.75)));
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

let lastClock = '';
function updateClock(tod, rain) {
  const mins = Math.floor(tod * 24 * 60);
  const hh = String(Math.floor(mins / 60)).padStart(2, '0'), mm = String(Math.floor((mins % 60) / 10) * 10).padStart(2, '0');
  const icon = tod > 0.27 && tod < 0.74 ? '☀️' : tod > 0.22 && tod < 0.8 ? '🌅' : '🌙';
  const res = Math.round((RS / devicePixelRatio) * 100);
  const txt = `${icon} ${hh}:${mm}${rain > 0.05 ? ' · 🌧' : ''} · ${PERF.fps} fps${res < 100 ? ' · ' + res + '%' : ''}`;
  if (txt !== lastClock) $('clock').textContent = lastClock = txt;
}

// ------------------------------------------------------------------ lobby background: drifting over a living world
let demo = null;
function drawLobbyBg(now, dt) {
  if (!demo) {
    const map = generateMap(160, 4242);
    demo = { map, terrain: new Terrain(map), clouds: new Clouds(3) };
  }
  const z = 3;
  const W = canvas.width, H = canvas.height;
  ctx.imageSmoothingEnabled = false;
  const cx = 1280 + Math.sin(now / 24000) * 520, cy = 1280 + Math.cos(now / 31000) * 520;
  ctx.setTransform(z, 0, 0, z, Math.round(W / 2 - cx * z), Math.round(H / 2 - cy * z));
  const cs = CH * TILE;
  const vx0 = cx - W / 2 / z, vy0 = cy - H / 2 / z, vx1 = cx + W / 2 / z, vy1 = cy + H / 2 / z;
  let budget = 1;
  const chunks = [];
  for (let y = Math.max(0, Math.floor(vy0 / cs)); y <= Math.min(4, Math.floor(vy1 / cs)); y++)
    for (let x = Math.max(0, Math.floor(vx0 / cs)); x <= Math.min(4, Math.floor(vx1 / cs)); x++) {
      let c = demo.terrain.get(x, y, false);
      if (!c && budget-- > 0) c = demo.terrain.get(x, y, true);
      if (c) ctx.drawImage(c.canvas, x * cs, y * cs), chunks.push(c);
    }
  for (const c of chunks)
    for (const o of c.objects) {
      if (o.x < vx0 - 20 || o.x > vx1 + 20 || o.y < vy0 || o.y > vy1 + 30) continue;
      const art = natureArt(o.kind, o.v);
      ctx.drawImage(art.c, Math.round(o.x - art.ax), Math.round(o.y - art.ay));
    }
  demo.clouds.draw(ctx, vx0, vy0, vx1, vy1, now / 1000 * 4, 0.12);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(255,150,90,0.08)';
  ctx.fillRect(0, 0, W, H);
  void dt, nz;
}
