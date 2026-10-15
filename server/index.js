import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './game.js';
import { saveRoom, saveRoomSync, loadRoomData, listSaves, SAVE_DIR } from './store.js';
import { aiStatus, aiModelName, detectLocalAI } from './ai.js';
import { loadGeo } from '../public/shared/geo.js';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 8080;
const STOP_FILE = process.env.STOP_FILE;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.json': 'application/json', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url.includes('\0')) throw new Error('Invalid path');
  } catch {
    return res.writeHead(400).end('Invalid URL');
  }
  if (url === '/healthz') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, ...stats() }));
  const file = path.normalize(path.join(PUBLIC, url === '/' ? 'index.html' : url));
  const relative = path.relative(PUBLIC, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return res.writeHead(403).end();
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return res.writeHead(404).end('Not found');
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    // text assets go out gzipped (cached in memory until the file changes): much faster over the internet
    if (/^(text|application\/json)/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      const key = file + st.mtimeMs;
      let gz = GZ.get(file);
      if (!gz || gz.key !== key) GZ.set(file, (gz = { key, data: zlib.gzipSync(fs.readFileSync(file), { level: 7 }) }));
      return res.writeHead(200, { 'Content-Type': type, 'Content-Encoding': 'gzip', 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' }).end(gz.data);
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
});
const GZ = new Map();

const rooms = new Map(); // live, simulating rooms
const sleeping = listSaves(); // id -> summary of rooms saved on disk (woken when someone joins)

function roomList() {
  const live = [...rooms.values()].filter((r) => r.isPublic).map((r) => ({ ...r.summary(), live: true }));
  const asleep = [...sleeping.values()].filter((m) => m.isPublic !== false).map((m) => ({ ...m, humans: 0, live: false, open: true }));
  return [...live, ...asleep.sort((a, b) => b.savedAt - a.savedAt).slice(0, 20)];
}

function stats() {
  return { rooms: rooms.size, saved: sleeping.size, online: [...rooms.values()].reduce((n, r) => n + r.players.size, 0) };
}

function code() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)];
  return rooms.has(s) || sleeping.has(s) ? code() : s;
}

// a live room, or a saved one brought back to life
const waking = new Map();
async function getRoom(id) {
  id = String(id || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (rooms.has(id)) return rooms.get(id);
  if (!sleeping.has(id)) return null;
  if (!waking.has(id))
    waking.set(id, (async () => {
      const t0 = Date.now();
      const data = await loadRoomData(id);
      if (!data) {
        sleeping.delete(id);
        return null;
      }
      await loadGeo(data.world || 'random');
      const room = new Room({ id, name: data.name, mode: data.mode, humans: data.humanSlots, ai: data.aiSlots, bots: data.fillBots, isPublic: data.isPublic }, data);
      rooms.set(id, room);
      sleeping.delete(id);
      console.log(`[save] room ${id} restored in ${Date.now() - t0} ms (${room.units.size} units, ${room.buildings.size} buildings)`);
      return room;
    })().finally(() => waking.delete(id)));
  return waking.get(id);
}

async function persist(room) {
  try {
    const bytes = await saveRoom(room);
    room.lastSave = Date.now();
    return bytes;
  } catch (e) {
    console.error(`[save] room ${room.id} failed:`, e.message);
  }
}

// compress snapshots (JSON shrinks ~4-6x), which matters when players connect over the internet
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024, perMessageDeflate: { threshold: 1024, zlibDeflateOptions: { level: 3 } } });

const cleanName = (n) => String(n || 'Ruler').replace(/[^\w \-]/g, '').slice(0, 18) || 'Ruler';

wss.on('connection', (ws) => {
  let room = null;
  let player = null;
  let busy = false;
  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  send({ t: 'rooms', list: roomList(), ai: aiStatus(), stats: stats() });

  const enter = (r, pl) => {
    if (!pl) return send({ t: 'error', text: 'No player slot available' });
    if (ws.readyState !== 1) return r.removePlayer(pl);
    room = r;
    player = pl;
  };

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return;
    if (player && room) {
      try {
        await room.handle(player, msg);
      } catch (e) {
        console.error('[room]', e);
      }
      return;
    }
    if (msg.t === 'list') return send({ t: 'rooms', list: roomList(), ai: aiStatus(), stats: stats() });
    if (busy) return;
    busy = true;
    try {
      if (msg.t === 'rejoin') {
        // back to your own kingdom: after a dropped connection, a page refresh or a server restart
        const r = msg.token && (await getRoom(msg.id));
        const pl = r && r.addPlayer(ws, cleanName(msg.name), String(msg.token || ''));
        if (!pl) return send({ t: 'rejoinFailed', id: msg.id, gone: !r });
        return enter(r, pl);
      }
      const name = cleanName(msg.name);
      if (msg.t === 'create') {
        const id = code();
        const r = new Room({
          id, name: String(msg.roomName || `${name}'s realm`).slice(0, 30),
          mode: ['duo', 'squad', 'penta'].includes(msg.mode) ? msg.mode : 'squad',
          sizeKey: ['large', 'huge', 'giant', 'colossal', 'mega'].includes(msg.size) ? msg.size : 'huge',
          bots: msg.bots !== false, humans: msg.humans, ai: msg.ai, isPublic: msg.isPublic !== false,
          world: ['random', 'india', 'earth'].includes(msg.world) ? msg.world : 'random',
          names: ['india', 'fantasy'].includes(msg.names) ? msg.names : 'india',
        });
        rooms.set(id, r);
        console.log(`[lobby] room ${id} created (${r.humanSlots} players + ${r.aiSlots} AI, ${r.world} ${r.size}x${r.size}, ${r.names} names, ${r.isPublic ? 'public' : 'private'})`);
        return enter(r, r.addPlayer(ws, name));
      }
      if (msg.t === 'join' || msg.t === 'quick') {
        let r = null;
        if (msg.t === 'quick') {
          // quick play: the busiest public room with a free player slot, else a fresh one
          r = [...rooms.values()].filter((x) => x.isPublic && x.hasSlot()).sort((a, b) => b.players.size - a.players.size)[0];
          if (!r) {
            const id = code();
            r = new Room({ id, name: `${name}'s open realm`, mode: 'squad', sizeKey: 'huge', bots: true, humans: 4, ai: 1, isPublic: true });
            rooms.set(id, r);
            console.log(`[lobby] quick-play room ${id} created`);
          }
        } else {
          r = await getRoom(msg.id);
          if (!r) return send({ t: 'error', text: 'Room not found' });
        }
        const pl = r.addPlayer(ws, name);
        if (!pl) return send({ t: 'error', text: 'Room is full: every player slot is taken or held for a ruler who will be back' });
        return enter(r, pl);
      }
    } catch (e) {
      console.error('[lobby]', e.message);
      send({ t: 'error', text: 'Unable to enter the room. Please try again.' });
    } finally {
      busy = false;
    }
  });

  ws.on('close', () => {
    if (room && player) room.removePlayer(player);
  });
  ws.on('error', (e) => console.warn('[socket]', e.message));
});

// autosave rooms with players every minute; rooms empty for 2 minutes are saved and put to sleep
let saving = false;
setInterval(async () => {
  if (saving || shuttingDown) return;
  saving = true;
  try {
    for (const [id, r] of rooms) {
      if (r.players.size === 0 && Date.now() - r.emptySince > 120000) {
        if (!(await persist(r))) continue;
        if (r.players.size || Date.now() - r.emptySince <= 120000) continue;
        rooms.delete(id);
        r.destroy();
        sleeping.set(id, { ...r.summary(), savedAt: Date.now() });
        console.log(`[lobby] room ${id} saved and asleep`);
      } else if (r.players.size && Date.now() - (r.lastSave || r.started) > SAVE_EVERY) await persist(r);
    }
  } finally {
    saving = false;
  }
}, 10000);
const SAVE_EVERY = (Number(process.env.SAVE_EVERY_S) || 60) * 1000;

// save everything before the process goes away (Ctrl+C, docker stop, host redeploy)
let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  let n = 0;
  for (const r of rooms.values()) {
    try {
      r.destroy();
      saveRoomSync(r);
      n++;
    } catch (e) {
      console.error(`[save] room ${r.id} failed:`, e.message);
    }
  }
  console.log(`[save] ${sig}: saved ${n} room(s) to ${SAVE_DIR}`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
if (STOP_FILE) setInterval(() => {
  if (!fs.existsSync(STOP_FILE)) return;
  fs.unlinkSync(STOP_FILE);
  shutdown('local stop request');
}, 1000).unref();
await Promise.all(['india', 'earth'].map((w) => loadGeo(w))); // real-world coastlines, before any room is built

server.listen(PORT, async () => {
  console.log(`Pixel Kingdoms running at http://localhost:${PORT}`);
  console.log(`Saves: ${SAVE_DIR} (${sleeping.size} saved room(s))`);
  await detectLocalAI();
  const label = { claude: 'Claude (API key found)', local: 'local free AI via Ollama (no key)', free: 'free online AI (Pollinations, no key)', offline: 'offline fallback' }[aiStatus()];
  console.log(`AI for NPCs / chatter / forge / regents: ${label} · model: ${aiModelName()}`);
});

