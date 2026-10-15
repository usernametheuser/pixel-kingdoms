// Authoritative real-time simulation for one room: 2-5 kingdoms, free towns, wildlife and alien invaders.
import { generateMap, findSpawns, nearestTile, speedAt, tileAt, TILE, T, TILE_NAMES, SPEED, rng } from '../public/shared/map.js';
import { WEAPONS, UNITS, BUILDINGS, KINGDOM_COLORS, MODES, MAP_SIZES, UNIT_CAP, CIV_CAP, PLAYER_WEAPONS, CIVILIANS, CIVILIANS_IN, TRAFFIC, NAME_THEMES, WILD, ALIEN, NEUTRAL, FACTIONS, TOWN_NAMES } from '../public/shared/defs.js';
import { CITIES, projection, WORLDS } from '../public/shared/geo.js';
import { designThing, npcTalk, aiStatus, regentPlan, barkBatch, npcDialogue, FALLBACK_BARKS, BARK_ROLES, BARK_SITUATIONS, VEHICLE_WORDS, parseIntent } from './ai.js';
import { DAY_MS } from '../public/shared/defs.js';
import { CommandAI } from './command.js';

const TICK_MS = 1000 / 30;
const SNAP_EVERY = 2; // 15 snapshots / s
const VIEW_R = 1150;
const PLAYER_SPEED = 125;
const PLAYER_HP = 220;
const CELL = 128;
const BCELL = 256;
const WAKE_R = 2600; // wildlife / civilians / free towns only simulate near players

const NPC_NAMES = ['Aldric', 'Bryn', 'Cedric', 'Dara', 'Edda', 'Finn', 'Gwen', 'Hugo', 'Isla', 'Jory', 'Kara', 'Leif', 'Mira', 'Nils', 'Orla', 'Piet', 'Quinn', 'Rhea', 'Sven', 'Tova', 'Ulric', 'Vera', 'Wren', 'Yara', 'Zed', 'Bram', 'Cora', 'Dag', 'Elin', 'Rook', 'Ada', 'Bert', 'Clem', 'Dora', 'Emil', 'Fay', 'Gus', 'Hilde', 'Ivo', 'Jana'];
const IN_NAMES = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Meera', 'Arjun', 'Kavya', 'Ishaan', 'Diya', 'Kabir', 'Saanvi', 'Rahul', 'Pooja', 'Aditya', 'Neha', 'Siddharth', 'Lakshmi', 'Ravi', 'Sunita', 'Manoj', 'Geeta', 'Harish', 'Anjali', 'Farhan', 'Zoya', 'Gurpreet', 'Simran', 'Tenzin', 'Pema'];
const ALIEN_NAMES = ['Zx\'tal', 'Qorb', 'Vexil', 'Nnn-7', 'Ylm', 'Krr\'ak', 'Oszz'];

const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
const clampInt = (v, lo, hi, def) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, Math.round(+v))) : Math.max(lo, Math.min(hi, def)));
export const MAX_KINGDOMS = 10;
const RESERVE_MS = 30 * 60000; // a disconnected ruler's kingdom is held for them this long
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Room {
  // opts: { id, name, mode, sizeKey, bots, humans, ai, isPublic }; saved = data from serialize()
  constructor(opts, saved = null) {
    const { id, name, mode, sizeKey, bots } = opts;
    this.id = id;
    this.name = name;
    // real-player slots + AI-only kingdoms (AI kingdoms can never be taken over by a player)
    const preset = MODES[mode] || null;
    const humans = clampInt(opts.humans, 1, MAX_KINGDOMS, preset ? preset.players : 4);
    const ai = clampInt(opts.ai, 0, MAX_KINGDOMS - humans, 0);
    this.humanSlots = humans;
    this.aiSlots = ai;
    this.fillBots = bots !== false; // AI regents rule empty player slots until someone joins
    this.isPublic = opts.isPublic !== false;
    this.max = humans + ai;
    this.mode = !ai && Object.keys(MODES).find((m) => MODES[m].players === humans) || 'custom';
    this.size = saved ? saved.size : MAP_SIZES[sizeKey] || MAP_SIZES.huge;
    this.seed = saved ? saved.seed : Math.floor(Math.random() * 1e9);
    // world: procedural continents or a real-world map; names: theme for kingdoms & towns
    this.world = saved ? saved.world || 'random' : WORLDS[opts.world] ? opts.world : 'random';
    this.names = saved ? saved.names || 'fantasy' : NAME_THEMES[opts.names] ? opts.names : 'india';
    this.theme = NAME_THEMES[this.names];
    this.defaultStyle = this.world === 'india' || this.names === 'india' ? 'india' : 'classic';
    this.map = generateMap(this.size, this.seed, this.world);
    this.spawns = saved ? saved.spawns : findSpawns(this.map, this.max, this.seed);
    this.nextId = 1;
    this.kingdoms = [];
    this.players = new Map();
    this.units = new Map();
    this.buildings = new Map();
    this.bTiles = new Int32Array(this.size * this.size);
    this.bGrid = new Map();
    this.towns = new Map();
    this.townN = 0;
    this.bullets = [];
    this.effects = [];
    this.catalog = new Map();
    this.catalogN = 0;
    this.sockets = new Set();
    this.tickN = 0;
    this.now = Date.now();
    this.started = this.now;
    this.buildingsDirty = false;
    this.kingdomsDirty = true;
    this.townsDirty = true;
    this.emptySince = Date.now();
    this.grid = new Map();
    this.playerPos = [];
    this.closed = false;
    this.initCommand();
    this.wildTarget = Math.min(720, Math.round((this.size * this.size) / 1700));
    // living NPCs: a bank of AI-written barks per role:situation, refreshed in the background
    this.barkBank = new Map(Object.entries(FALLBACK_BARKS).map(([k, v]) => [k, [...v]]));
    this.barkFresh = new Map();
    this.aiBarkKeys = new Set();
    this.lastBarkAt = 0;
    this.nextBarkRefresh = this.now + 4000;
    this.nextDialogue = this.now + 30000;
    this.chatterBusy = false;
    this.nextInvasion = this.now + 6 * 60000;
    this.lastAlienSighting = 0;
    if (saved) this.restore(saved);
    else {
      this.generateTowns();
      this.generateOutposts();
      if (this.fillBots) for (let i = 1; i < this.humanSlots; i++) this.createKingdom(i, null);
      for (let i = this.humanSlots; i < this.max; i++) this.createKingdom(i, null).aiOnly = true;
      this.populateWildlife(this.wildTarget);
    }
    this.interval = setInterval(() => this.step(), TICK_MS);
  }

  destroy() {
    this.closed = true;
    clearInterval(this.interval);
  }

  summary() {
    const humans = this.kingdoms.filter((k) => k && k.playerId).length;
    return {
      id: this.id, name: this.name, mode: this.mode, max: this.max, humans, humanSlots: this.humanSlots, aiSlots: this.aiSlots,
      size: this.size, world: this.world, open: this.hasSlot(), isPublic: this.isPublic, started: this.started,
      rulers: this.kingdoms.filter((k) => k && !k.aiOnly).map((k) => ({ k: k.name, by: k.lastRuler || null, on: !!k.playerId })),
    };
  }

  hasSlot() {
    return this.freeSlot() !== null;
  }

  // Only real-player slots can be joined: an untouched one first, otherwise an AI-run kingdom in a
  // player slot (but not one held for a disconnected player)
  freeSlot() {
    for (let i = 0; i < this.humanSlots; i++) if (!this.kingdoms[i]) return { slot: i, kingdom: null };
    const k = this.kingdoms.find((kk) => kk && kk.id < this.humanSlots && !kk.aiOnly && !kk.playerId && !(kk.reservedUntil > this.now));
    return k ? { slot: k.id, kingdom: k } : null;
  }

  // ------------------------------------------------------------------ saving
  // Everything needed to bring the world back exactly as it was. Players aren't saved (they come back
  // through their kingdom's rejoin token); their vehicles get AI crews and their armies stand guard.
  serialize() {
    const units = [];
    for (const u of this.units.values()) {
      const o = { ...u };
      if (o.driver && this.players.has(o.driver)) (o.driver = null), (o.crewed = true);
      if (o.mode === 'follow') (o.mode = 'guard'), (o.gx = o.x), (o.gy = o.y);
      units.push(o);
    }
    const kingdoms = this.kingdoms.map((k) => {
      if (!k) return null;
      const p = k.playerId && this.players.get(k.playerId);
      return { ...k, playerId: null, bot: true, lastRuler: p ? p.name : k.lastRuler || null, wasHuman: !!p || !!k.wasHuman };
    });
    return {
      v: 1,
      savedAt: Date.now(),
      id: this.id, name: this.name, mode: this.mode, size: this.size, seed: this.seed, spawns: this.spawns, world: this.world, names: this.names,
      humanSlots: this.humanSlots, aiSlots: this.aiSlots, fillBots: this.fillBots, isPublic: this.isPublic,
      started: this.started, nextId: this.nextId, townN: this.townN, catalogN: this.catalogN,
      nextInvasion: this.nextInvasion, wildTarget: this.wildTarget,
      tiles: Buffer.from(this.map.tiles.buffer, this.map.tiles.byteOffset, this.map.tiles.byteLength).toString('base64'),
      catalog: [...this.catalog.entries()],
      kingdoms, units,
      command: this.saveCommand(),
      buildings: [...this.buildings.values()],
      towns: [...this.towns.values()],
    };
  }

  restore(d) {
    // shift every stored timestamp by the time spent asleep, so cooldowns, waves and the day/night clock
    // carry on where they left off instead of all firing at once
    const shift = Date.now() - d.savedAt;
    const fix = (o) => {
      for (const key in o) {
        const v = o[key];
        if (typeof v === 'number' && v > 1e12 && v < 1e13) o[key] = v + shift;
      }
      return o;
    };
    this.started = d.started + shift;
    this.nextId = d.nextId;
    this.townN = d.townN;
    this.catalogN = d.catalogN;
    this.nextInvasion = d.nextInvasion + shift;
    this.wildTarget = d.wildTarget;
    const tiles = Buffer.from(d.tiles, 'base64');
    if (tiles.length === this.map.tiles.length) this.map.tiles.set(tiles);
    this.catalog = new Map(d.catalog);
    this.restoreCommand(d.command, fix);
    for (const k of d.kingdoms) {
      if (!k) continue;
      fix(k);
      // held for its old ruler for a while after a server restart
      if (k.wasHuman) k.reservedUntil = Date.now() + RESERVE_MS;
      this.kingdoms[k.id] = k;
    }
    for (const b of d.buildings) {
      fix(b);
      this.buildings.set(b.id, b);
      for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) this.bTiles[(b.ty + j) * this.size + b.tx + i] = b.id;
      this.bGridAdd(b);
    }
    for (const t of d.towns) this.towns.set(t.id, t);
    for (const u of d.units) {
      fix(u);
      // transient AI state is rebuilt on the first ticks
      u.target = null;
      u.path = null;
      u.app = null;
      u.grudge = null;
      u.asleep = false;
      u.motion = this.unitDef(u.def) ? this.motionFor(this.unitDef(u.def), u.def) : u.motion;
      this.units.set(u.id, u);
    }
    this.emptySince = Date.now();
  }

  factionName(kid) {
    return kid >= 0 ? (this.kingdoms[kid] ? 'the Kingdom of ' + this.kingdoms[kid].name : 'a lost kingdom') : FACTIONS[kid]?.name || 'unknown';
  }

  // ------------------------------------------------------------------ world setup
  landPatch(tx, ty, r) {
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        const x = tx + i, y = ty + j;
        if (x < 2 || y < 2 || x >= this.size - 2 || y >= this.size - 2) return false;
        const t = this.map.tiles[y * this.size + x];
        if (t <= T.WATER || t >= T.MOUNTAIN) return false;
      }
    return true;
  }

  generateTowns() {
    const r = rng(this.seed + 555);
    if (this.world !== 'random') return this.generateGeoTowns(r);
    const n = Math.min(120, Math.round((this.size * this.size) / 28000));
    const sites = [];
    for (let tries = 0; sites.length < n && tries < n * 80; tries++) {
      const tx = 12 + Math.floor(r() * (this.size - 24)), ty = 12 + Math.floor(r() * (this.size - 24));
      if (this.spawns.some((s) => Math.hypot(s.tx - tx, s.ty - ty) < 45)) continue;
      if (sites.some((s) => Math.hypot(s.tx - tx, s.ty - ty) < 34)) continue;
      if (!this.landPatch(tx, ty, 5)) continue;
      sites.push({ tx, ty });
    }
    const names = [...this.theme.towns].sort(() => r() - 0.5);
    sites.forEach((s, i) => this.buildTown(NEUTRAL, s.tx, s.ty, names[i % names.length] + (i >= names.length ? ' ' + (Math.floor(i / names.length) + 1) : ''), r, this.townStyle(s.tx, s.ty), i < n / 6));
  }

  // real-world maps: a town at every real city that fits, biggest cities first
  generateGeoTowns(r) {
    const P = projection(this.world, this.size);
    const capitals = new Set(this.spawns.map((s) => s.city));
    const gap = Math.max(12, Math.round(this.size / 48));
    const sites = [];
    CITIES[this.world].forEach((c, idx) => {
      if (capitals.has(c[0])) return;
      const [fx, fy] = P.toTile(c[1], c[2]);
      const tx = Math.round(fx), ty = Math.round(fy);
      if (tx < 12 || ty < 12 || tx > this.size - 12 || ty > this.size - 12) return;
      let found = null;
      for (let s = 0; s <= 7 && !found; s++)
        for (let k = 0; k < 12 && !found; k++) {
          const x = Math.round(tx + Math.cos((k / 12) * Math.PI * 2) * s), y = Math.round(ty + Math.sin((k / 12) * Math.PI * 2) * s);
          if (this.landPatch(x, y, 4)) found = { tx: x, ty: y };
        }
      if (!found || this.spawns.some((s) => Math.hypot(s.tx - found.tx, s.ty - found.ty) < 30) || sites.some((s) => Math.hypot(s.tx - found.tx, s.ty - found.ty) < gap)) return;
      sites.push({ ...found, name: c[0], big: idx < 26, lon: c[1], lat: c[2] });
    });
    for (const s of sites) this.buildTown(NEUTRAL, s.tx, s.ty, s.name, r, this.townStyle(s.tx, s.ty, s.lon, s.lat), s.big);
  }

  // which kind of town fits here: Indian streets, a Himalayan village, or a classic market town
  townStyle(tx, ty, lon, lat) {
    let indian = this.defaultStyle === 'india';
    if (this.world === 'earth') indian = lon > 60 && lon < 98 && lat > 5 && lat < 37;
    if (!indian) return 'classic';
    let high = 0, n = 0;
    for (let j = -6; j <= 6; j += 2)
      for (let i = -6; i <= 6; i += 2) {
        const x = tx + i, y = ty + j;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
        n++;
        if (this.map.tiles[y * this.size + x] >= T.HILL) high++;
      }
    return high / Math.max(1, n) > 0.28 ? 'himalaya' : 'india';
  }

  buildTown(kid, tx, ty, name, r = Math.random, style = 'classic', big = false) {
    const hall = this.placeBuilding(kid, 'townhall', tx - 1, ty - 1, true);
    if (typeof hall === 'string') return null;
    const town = this.towns.get(hall.townId);
    town.name = name;
    town.style = style;
    town.big = big;
    if (style === 'india') this.buildIndianTown(kid, hall, town, r, big);
    else if (style === 'himalaya') this.buildHimalayanTown(kid, hall, town, r);
    else this.buildClassicTown(kid, hall, town, r);
    if (kid === NEUTRAL) {
      for (let i = 0; i < 3; i++) {
        const u = this.spawnUnit(NEUTRAL, style === 'classic' ? 'militia' : 'police', hall.x + (i - 1) * 24, hall.y + 30);
        if (u) (u.town = town.id), (u.mode = 'guard');
      }
    }
    // first residents move in straight away
    // a few residents to start with; the rest move in over time while players are around
    for (const b of this.buildings.values()) if (b.townId === town.id && this.bdef(b.type)?.residents && (b.type === 'house' || r() < 0.35)) this.spawnResident(b);
    return town;
  }

  // Indian town: crossroads lined with shops and apartment blocks, street life, temples, and a few
  // landmarks; big cities also get towers, a mall, a hospital and a railway station
  buildIndianTown(kid, hall, town, r, big) {
    const extra = { townId: town.id };
    const hx = hall.tx, hy = hall.ty, ry = hy + 2, rx = hx + 2, len = big ? 12 : 8;
    const put = (type, x, y) => {
      const b = this.placeBuilding(kid, type, x, y, false, extra);
      return typeof b === 'string' ? null : b;
    };
    town.roads = [];
    for (let i = -len; i <= len; i++) if (put('road', hx + i, ry)) town.roads.push([hx + i, ry]);
    for (let j = -len; j <= len; j++) if (j !== 0 && put('road', rx, ry + j)) town.roads.push([rx, ry + j]);
    put('signal', rx + 1, ry + 1);
    put('signal', rx + 1, ry - 1);
    const decor = ['lamp', 'lamp', 'chaistall', 'fruitcart', 'busstop', 'hoarding', 'lamp'];
    const frontage = () => {
      const v = r();
      return v < 0.42 ? 'apartment' : v < 0.8 ? 'shop' : 'house';
    };
    for (let i = -len; i <= len; i++)
      for (const y of [ry - 1, ry + 1]) {
        const x = hx + i;
        if (Math.abs(i) % 5 === 3) put(decor[Math.floor(r() * decor.length)], x, y);
        else {
          const t = frontage();
          if (!put(t, x, y) && t === 'shop') put('apartment', x, y);
        }
      }
    for (let j = -len; j <= len; j++) {
      if (Math.abs(j) <= 1) continue;
      for (const x of [rx - 1, rx + 1]) {
        if (Math.abs(j) % 5 === 3) put(decor[Math.floor(r() * decor.length)], x, ry + j);
        else put(r() < 0.6 ? 'apartment' : 'house', x, ry + j);
      }
    }
    const near = (type, a, b) => this.tryPlaceNear(kid, type, hx + 1, hy + 1, a, b, extra, 40);
    near('mandir', 3, 9);
    near('well', 3, 7);
    near('market', 3, 10);
    near('watertower', 4, 11);
    if (r() < 0.55) near(r() < 0.5 ? 'masjid' : 'gurudwara', 4, 12);
    if (big || r() < 0.4) near('police', 3, 11);
    if (big) {
      near('highrise', 4, 13);
      near('highrise', 4, 13);
      near('mall', 4, 13);
      near('hospital', 4, 13);
      near('railway', 6, 15);
      if (r() < 0.5) near('archgate', 4, 11);
      if (r() < 0.35) near('jail', 9, 17);
      if (r() < 0.3) near('grandmandir', 8, 16);
    }
    for (let i = 0; i < 2 + Math.floor(r() * 2); i++) near('farm', len + 1, len + 6);
    town.traffic = Math.min(big ? 12 : 6, Math.floor(town.roads.length / 3));
  }

  // Himalayan village: stone houses, a monastery with prayer flags, a tea stall
  buildHimalayanTown(kid, hall, town, r) {
    const extra = { townId: town.id };
    const near = (type, a, b) => this.tryPlaceNear(kid, type, hall.tx + 1, hall.ty + 1, a, b, extra, 40);
    near('stupa', 3, 8);
    for (let i = 0; i < 7 + Math.floor(r() * 5); i++) near('stonehut', 2, 8);
    near('chaistall', 2, 6);
    near('well', 2, 6);
    if (r() < 0.5) near('mandir', 4, 9);
    for (let i = 0; i < 2; i++) near('farm', 7, 11);
  }

  buildClassicTown(kid, hall, town, r) {
    const tx = hall.tx + 1, ty = hall.ty + 1;
    const extra = { townId: town.id };
    this.tryPlaceNear(kid, 'well', tx, ty, 2, 3, extra);
    this.tryPlaceNear(kid, 'market', tx, ty, 3, 5, extra);
    const houses = 6 + Math.floor(r() * 7);
    for (let i = 0; i < houses; i++) this.tryPlaceNear(kid, 'house', tx, ty, 3, 8, extra);
    for (let i = 0; i < 2 + Math.floor(r() * 2); i++) this.tryPlaceNear(kid, 'farm', tx, ty, 8, 11, extra);
    this.tryPlaceNear(kid, 'windmill', tx, ty, 7, 10, extra);
  }

  tryPlaceNear(kid, type, cx, cy, rMin, rMax, extra, tries = 30) {
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2, d = rMin + Math.random() * (rMax - rMin);
      const res = this.placeBuilding(kid, type, Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), false, extra);
      if (typeof res !== 'string') return res;
    }
    return null;
  }

  populateWildlife(n) {
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      const tx = 2 + Math.floor(Math.random() * (this.size - 4)), ty = 2 + Math.floor(Math.random() * (this.size - 4));
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (this.spawns.some((s) => Math.hypot(s.tx - tx, s.ty - ty) < 22)) continue;
      if (this.playerPos.some(([px, py]) => dist2(px, py, x, y) < 1400 * 1400)) continue;
      const t = this.map.tiles[ty * this.size + tx];
      let key;
      const roll = Math.random();
      if (roll < 0.06) key = 'eagle';
      else if (t <= T.WATER) key = Math.random() < 0.35 ? 'shark' : null;
      else if (t === T.GRASS || t === T.SAND) key = pick(['deer', 'deer', 'rabbit', 'rabbit', 'horse', 'horse', 'wolf']);
      else if (t === T.FOREST) key = pick(['deer', 'deer', 'wolf', 'wolf', 'bear', 'rabbit']);
      else if (t === T.HILL) key = pick(['deer', 'wolf', 'horse', 'bear']);
      else key = pick(['wolf', 'bear']);
      if (!key) continue;
      const u = this.spawnUnit(WILD, key, x, y);
      if (u) (u.mode = 'wander'), i++;
    }
  }

  // ------------------------------------------------------------------ kingdoms
  createKingdom(slot, player) {
    const sp = this.spawns[slot];
    const r = rng(this.seed + slot * 31);
    const k = {
      id: slot,
      name: sp.realm || this.theme.kingdoms[(slot + this.seed) % this.theme.kingdoms.length],
      color: KINGDOM_COLORS[slot % KINGDOM_COLORS.length],
      playerId: player ? player.id : null,
      bot: !player,
      spawn: sp,
      kills: 0,
      losses: 0,
      castle: null,
      botThink: this.now + 3000,
      nextWave: this.now + 150000 + r() * 30000,
      nextPlan: this.now + 45000 + r() * 30000,
      plan: null,
      lastHit: 0,
      castleLostAt: 0,
    };
    this.kingdoms[slot] = k;
    this.placeBuilding(slot, 'castle', sp.tx - 1, sp.ty - 1, true);
    this.placeBuilding(slot, 'tower', sp.tx - 4, sp.ty - 4, true);
    this.placeBuilding(slot, 'tower', sp.tx + 4, sp.ty + 4, true);
    this.placeBuilding(slot, 'barracks', sp.tx + 3, sp.ty - 4, true);
    // the capital: homes, farms and a market around the castle
    for (let i = 0; i < 6; i++) this.tryPlaceNear(slot, 'house', sp.tx, sp.ty, 5, 9);
    this.tryPlaceNear(slot, 'farm', sp.tx, sp.ty, 8, 12);
    this.tryPlaceNear(slot, 'market', sp.tx, sp.ty, 5, 8);
    this.tryPlaceNear(slot, 'well', sp.tx, sp.ty, 4, 6);
    this.tryPlaceNear(slot, 'stable', sp.tx, sp.ty, 6, 9);
    this.tryPlaceNear(slot, 'helipad', sp.tx, sp.ty, 6, 11);
    this.tryPlaceNear(slot, 'hospital', sp.tx, sp.ty, 5, 9);
    this.tryPlaceNear(slot, 'church', sp.tx, sp.ty, 6, 11);
    const indian = this.kingdomStyle(sp) === 'india';
    if (indian) {
      // an Indian capital: apartment blocks, a temple, a police station, a victory arch and the cantonment
      for (let i = 0; i < 4; i++) this.tryPlaceNear(slot, 'apartment', sp.tx, sp.ty, 5, 10);
      this.tryPlaceNear(slot, 'mandir', sp.tx, sp.ty, 6, 11);
      this.tryPlaceNear(slot, 'police', sp.tx, sp.ty, 6, 12);
      this.tryPlaceNear(slot, 'archgate', sp.tx, sp.ty, 5, 10);
      this.tryPlaceNear(slot, 'cantonment', sp.tx, sp.ty, 9, 15);
      this.tryPlaceNear(slot, 'chaistall', sp.tx, sp.ty, 4, 8);
    }
    for (const b of this.buildings.values()) if (b.kingdom === slot && this.bdef(b.type)?.residents) this.spawnResident(b);
    const cx = (sp.tx + 0.5) * TILE, cy = (sp.ty + 0.5) * TILE;
    const starters = indian
      ? ['jawan', 'jawan', 'jawan', 'commando', 'sniper', 'gunner', 'rifleman', 'arjun', 't90', 'gypsy', 'su30', 'tejas', 'prachand', 'horse', 'kolkata', 'speedboat']
      : ['knight', 'knight', 'knight', 'archer', 'archer', 'rifleman', 'rifleman', 'tank', 'humvee', 'f16', 'tejas', 'helicopter', 'horse', 'horse', 'destroyer', 'speedboat'];
    if (player) starters.length = 0; // human rulers start with no army: raise your own
    starters.forEach((d, i) => {
      const a = (i / starters.length) * Math.PI * 2;
      const u = this.spawnUnit(slot, d, cx + Math.cos(a) * 80, cy + Math.sin(a) * 80);
      if (u) u.mode = u.kind === 'vehicle' || k.bot ? 'guard' : 'follow';
    });
    // the kingdom's airport (with parked, crewed jets) and a fenced military base
    const apt = this.tryPlaceNear(slot, 'airport', sp.tx, sp.ty, 13, 30, {}, 80);
    if (apt) for (const j of indian ? ['tejas', 'su30', 'amca', 'rafale'] : ['f16', 'tejas', pick(['rafale', 'su30', 'mig29', 'typhoon', 'f22']), 'a10']) this.parkAircraft(apt, slot, j, true);
    this.buildMilitaryBase(slot, sp.tx, sp.ty, 16, 32, true);
    if (indian) {
      this.tryPlaceNear(slot, 'armydepot', sp.tx, sp.ty, 14, 28, {}, 60);
      this.tryPlaceNear(slot, 'brahmosbase', sp.tx, sp.ty, 10, 20, {}, 60);
      // the capital city itself: a full Indian city district (streets, traffic, landmarks) beside the castle
      const spot = this.findArea(sp.tx, sp.ty, 12, 22, 4, 4);
      if (spot) this.buildTown(slot, spot.tx + 2, spot.ty + 2, sp.city || pick(this.theme.towns), rng(this.seed + slot * 77), 'india', true);
    }
    this.kingdomsDirty = true;
    return k;
  }

  kingdomStyle(sp) {
    if (this.world === 'earth') {
      const [lon, lat] = projection('earth', this.size).toLonLat(sp.tx, sp.ty);
      return lon > 60 && lon < 98 && lat > 5 && lat < 37 ? 'india' : 'classic';
    }
    return this.defaultStyle;
  }

  // spawn an aircraft parked on an airport apron
  parkAircraft(b, kid, key, crewed) {
    const spot = this.parkingSpot(b);
    if (!spot) return null;
    const u = this.spawnUnit(kid, key, spot.x, spot.y);
    if (!u) return null;
    u.x = spot.x;
    u.y = spot.y;
    u.angle = 0;
    u.fly = 0;
    u.flight = 'ground';
    u.spd = 0;
    u.crewed = crewed;
    u.mode = 'guard';
    u.gx = u.x;
    u.gy = u.y;
    return u;
  }

  // find a free rectangle of buildable land near (cx, cy)
  findArea(cx, cy, rMin, rMax, w, h) {
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * Math.PI * 2, d = rMin + Math.random() * (rMax - rMin);
      const tx = Math.round(cx + Math.cos(a) * d - w / 2), ty = Math.round(cy + Math.sin(a) * d - h / 2);
      let ok = tx > 2 && ty > 2 && tx + w < this.size - 2 && ty + h < this.size - 2;
      for (let j = -1; ok && j <= h; j++)
        for (let k = -1; ok && k <= w; k++) {
          const t = this.map.tiles[(ty + j) * this.size + tx + k];
          if (t <= T.WATER || t >= T.MOUNTAIN || this.bTiles[(ty + j) * this.size + tx + k]) ok = false;
        }
      if (ok) return { tx, ty };
    }
    return null;
  }

  // fenced compound: bunkers, SAM sites, radar, war factory, helipad, parked armour and crews
  buildMilitaryBase(kid, cx, cy, rMin, rMax, full) {
    const W = 11, H = 9;
    const a = this.findArea(cx, cy, rMin, rMax, W, H);
    if (!a) return null;
    const { tx, ty } = a;
    for (let i = 0; i < W; i++) for (const y of [ty, ty + H - 1]) if (!(y === ty + H - 1 && (i === 5 || i === 6))) this.placeBuilding(kid, 'fence', tx + i, y);
    for (let j = 1; j < H - 1; j++) for (const x of [tx, tx + W - 1]) this.placeBuilding(kid, 'fence', x, ty + j);
    this.placeBuilding(kid, 'bunker', tx + 1, ty + H - 2);
    this.placeBuilding(kid, 'bunker', tx + W - 2, ty + H - 2);
    this.placeBuilding(kid, 'samsite', tx + 1, ty + 1);
    this.placeBuilding(kid, 'samsite', tx + W - 2, ty + 1);
    this.placeBuilding(kid, 'radar', tx + 5, ty + 1);
    if (full) this.placeBuilding(kid, 'factory', tx + 2, ty + 2);
    const pad = this.placeBuilding(kid, 'helipad', tx + 7, ty + 2);
    const crewed = kid !== NEUTRAL;
    const park = (key, x, y, angle = -Math.PI / 2) => {
      const u = this.spawnUnit(kid, key, (x + 0.5) * TILE, (y + 0.5) * TILE);
      if (!u) return;
      u.x = (x + 0.5) * TILE;
      u.y = (y + 0.5) * TILE;
      u.angle = angle;
      u.crewed = crewed;
      u.mode = 'guard';
      u.gx = u.x;
      u.gy = u.y;
      if (u.motion && u.motion.air) (u.fly = 0), (u.flight = 'ground'), (u.spd = 0);
    };
    if (typeof pad !== 'string') park(pick(['helicopter', 'prachand', 'hind']), tx + 8, ty + 3, 0);
    park(kid === NEUTRAL ? pick(['tank', 't90', 'arjun']) : 'arjun', tx + 3, ty + 6);
    park(pick(['apc', 'tank', 'mlrs']), tx + 5, ty + 6);
    park(pick(['artillery', 'humvee', 't90']), tx + 7, ty + 6);
    if (kid >= 0) for (let i = 0; i < 3; i++) {
      const pu = this.spawnUnit(kid, 'pilot', (tx + 4 + i) * TILE, (ty + 4) * TILE);
      if (pu) (pu.mode = 'guard'), (pu.gx = pu.x), (pu.gy = pu.y);
    } else for (let i = 0; i < 2; i++) {
      const mu = this.spawnUnit(NEUTRAL, 'militia', (tx + 4 + i * 2) * TILE, (ty + 5) * TILE);
      if (mu) mu.mode = 'guard';
    }
    return a;
  }

  // abandoned airfields & depots full of empty vehicles waiting to be commandeered
  generateOutposts() {
    const n = Math.max(1, Math.round(this.size / 380));
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const tx = 20 + Math.floor(Math.random() * (this.size - 40)), ty = 20 + Math.floor(Math.random() * (this.size - 40));
        if (this.spawns.some((s) => Math.hypot(s.tx - tx, s.ty - ty) < 60)) continue;
        const apt = this.tryPlaceNear(NEUTRAL, 'airport', tx, ty, 0, 6, {}, 30);
        if (!apt) continue;
        const n2 = 2 + Math.floor(Math.random() * 3);
        for (let j = 0; j < n2; j++) this.parkAircraft(apt, NEUTRAL, pick(['f16', 'tejas', 'rafale', 'su30', 'mig29', 'f22', 'typhoon', 'a10', 'fighter']), false);
        this.buildMilitaryBase(NEUTRAL, tx, ty + 4, 8, 20, false);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ players
  addPlayer(ws, name, rejoinToken = null) {
    const back = rejoinToken && this.kingdoms.find((kk) => kk && kk.token === rejoinToken && !kk.playerId);
    if (rejoinToken && !back) return null;
    const free = back ? { slot: back.id, kingdom: back } : this.freeSlot();
    if (!free) return null;
    let k = free.kingdom;
    const slot = free.slot;
    const p = {
      id: this.nextId++,
      cat: 'player',
      name: String(name || 'Ruler').slice(0, 18),
      ws,
      x: 0,
      y: 0,
      angle: 0,
      hp: PLAYER_HP,
      maxHp: PLAYER_HP,
      r: 6,
      weapons: [...PLAYER_WEAPONS],
      wi: 2,
      input: { mx: 0, my: 0, ax: 0, ay: 0, fire: false, alt: false, sprint: false },
      cd: 0,
      altCd: 0,
      vehicle: null,
      dead: false,
      respawnAt: 0,
      lastTalk: 0,
      lastCreate: 0,
      lastAction: 0,
      lastHitBy: null,
      lastHitAt: 0,
    };
    if (k) {
      k.playerId = p.id;
      k.bot = false;
      for (const u of this.units.values()) if (u.kingdom === k.id && u.kind !== 'vehicle' && !u.civ) u.mode = 'follow';
    } else {
      k = this.createKingdom(slot, p);
    }
    p.kingdom = k.id;
    k.lastRuler = p.name;
    k.wasHuman = true;
    if (!back) k.token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    k.reservedUntil = 0;
    this.players.set(p.id, p);
    this.nextBarkRefresh = Math.min(this.nextBarkRefresh, this.now + 3000);
    this.respawn(p);
    this.sockets.add(ws);
    this.kingdomsDirty = true;
    this.send(ws, {
      t: 'joined',
      you: p.id,
      kingdom: k.id,
      token: k.token,
      ai: aiStatus(),
      room: { id: this.id, name: this.name, mode: this.mode, seed: this.seed, size: this.size, world: this.world, names: this.names, max: this.max, humanSlots: this.humanSlots, aiSlots: this.aiSlots, isPublic: this.isPublic, started: this.started, now: Date.now() },
      catalog: [...this.catalog.values()],
      buildings: this.buildingList(),
      kingdoms: this.kingdomList(),
      towns: this.townList(),
    });
    this.broadcastEvent(`${p.name} now rules the Kingdom of ${k.name}`);
    return p;
  }

  removePlayer(p) {
    this.sockets.delete(p.ws);
    const pv = p.vehicle && this.units.get(p.vehicle);
    if (pv) (pv.driver = null), (pv.crewed = true), (pv.autoTakeoff = false); // an AI crew takes over
    this.players.delete(p.id);
    const k = this.kingdoms[p.kingdom];
    if (k) {
      k.playerId = null;
      k.bot = true; // the AI regent keeps the kingdom alive
      k.reservedUntil = this.now + RESERVE_MS; // ...and holds it for the player to reconnect
      k.lastRuler = p.name;
      k.wasHuman = true;
      k.nextPlan = this.now + 20000;
      for (const u of this.units.values()) if (u.kingdom === k.id && u.mode === 'follow') (u.mode = 'guard'), (u.gx = u.x), (u.gy = u.y);
    }
    this.kingdomsDirty = true;
    if (!this.players.size) this.emptySince = Date.now();
    this.broadcastEvent(`${p.name} left; an AI regent now rules ${k ? k.name : 'their kingdom'}`);
  }

  respawn(p) {
    const k = this.kingdoms[p.kingdom];
    let tx, ty;
    const c = k.castle && this.buildings.get(k.castle);
    if (c) (tx = c.tx + 1), (ty = c.ty + 4);
    else {
      // nearest town we own, else the original spawn
      let best = null, bd = Infinity;
      for (const t of this.towns.values()) {
        const h = this.buildings.get(t.hallId);
        if (!h || t.kingdom !== p.kingdom) continue;
        const d = dist2(h.x, h.y, p.x, p.y);
        if (d < bd) (bd = d), (best = h);
      }
      if (best) (tx = best.tx), (ty = best.ty + 3);
      else (tx = k.spawn.tx), (ty = k.spawn.ty + 3);
    }
    const t = this.nearestFree(tx, ty, 30, (v) => v >= T.SAND && v < T.MOUNTAIN) || { tx, ty };
    p.x = (t.tx + 0.5) * TILE;
    p.y = (t.ty + 0.5) * TILE;
    p.hp = p.maxHp;
    p.dead = false;
  }

  // ------------------------------------------------------------------ catalog / defs
  unitDef(key) {
    if (UNITS[key]) return { ...UNITS[key], key };
    if (key && key.startsWith('c:')) {
      const c = this.catalog.get(key.slice(2));
      if (!c || !c.unit) return null;
      return { key, name: c.name, kind: c.category === 'vehicle' ? 'vehicle' : 'npc', domain: c.unit.domain, hp: c.unit.hp, speed: c.unit.speed, weapon: c.weapon, r: c.unit.r, personality: c.personality };
    }
    return null;
  }

  bdef(type) {
    if (BUILDINGS[type]) return BUILDINGS[type];
    if (type && type.startsWith('c:')) {
      const c = this.catalog.get(type.slice(2));
      if (c && c.building) return { name: c.name, ...c.building };
    }
    return null;
  }

  weaponOf(w) {
    if (!w) return null;
    if (typeof w !== 'string') return w;
    if (WEAPONS[w]) return WEAPONS[w];
    if (w.startsWith('c:')) {
      const c = this.catalog.get(w.slice(2));
      if (c && c.weapon) return c.weapon;
    }
    return WEAPONS.sword;
  }

  // ------------------------------------------------------------------ units
  countUnits(kid) {
    let army = 0, civ = 0;
    for (const u of this.units.values()) if (u.kingdom === kid) u.civ ? civ++ : army++;
    return { army, civ };
  }

  townsOf(kid) {
    let n = 0;
    for (const t of this.towns.values()) if (t.kingdom === kid) n++;
    return n;
  }

  spawnUnit(kid, key, x, y) {
    const def = this.unitDef(key);
    if (!def) return null;
    if (kid >= 0) {
      const c = this.countUnits(kid);
      const towns = this.townsOf(kid);
      if (def.civ ? c.civ >= 30 + towns * 25 : c.army >= 150 + towns * 30) return null; // more land, bigger kingdom
    }
    const pred = def.domain === 'water' ? (t) => t <= T.WATER : def.domain === 'air' ? () => true : (t) => t >= T.SAND;
    const t = this.nearestFree(Math.floor(x / TILE), Math.floor(y / TILE), def.domain === 'water' ? 45 : 14, pred);
    if (!t) return null;
    const u = {
      id: this.nextId++,
      cat: 'unit',
      def: key,
      name: kid === ALIEN ? pick(ALIEN_NAMES) + ' the ' + def.name : kid === WILD ? def.name : def.kind === 'vehicle' && !def.mount ? `${def.name} ${pick(['Mk-I', 'Mk-II', 'Alpha', 'Bravo', 'Rex', 'Nova', 'Viper', 'Ghost'])}` : `${pick(NPC_NAMES)} the ${def.name}`,
      kind: def.kind,
      domain: def.domain,
      x: (t.tx + 0.5) * TILE + (Math.random() - 0.5) * 6,
      y: (t.ty + 0.5) * TILE + (Math.random() - 0.5) * 6,
      angle: Math.random() * Math.PI * 2,
      hp: def.hp,
      maxHp: def.hp,
      speed: def.speed,
      r: def.r || 6,
      weapon: def.weapon ?? null,
      alt: def.alt || null,
      kingdom: kid,
      mode: def.civ ? 'wander' : 'guard',
      gx: 0,
      gy: 0,
      target: null,
      cd: 0,
      driver: null,
      think: 0,
      steer: 0,
      steerUntil: 0,
      personality: def.personality || 'loyal',
      formation: Math.random() * Math.PI * 2,
      passive: !!def.passive,
      flee: !!def.flee,
      civ: !!def.civ,
      mount: !!def.mount,
      wild: kid === WILD,
      sleepy: kid === WILD || kid === NEUTRAL || !!def.civ,
      asleep: false,
      sleepCheck: 0,
      grudge: null,
      grudgeUntil: 0,
      fleeUntil: 0,
      retreating: null,
      home: null,
      town: null,
      stealth: def.stealth || false,
      traffic: !!def.traffic,
      supply: !!def.supply,
      // aircraft carry a limited load of missiles/bombs on their pylons, plus flares
      alt2: def.alt2 || null,
      ammoMax: def.domain === 'air' && def.alt ? def.ammo ?? (def.role === 'fighter' ? 6 : def.alt === 'carpet' || def.alt === 'bomb' ? 12 : 8) : 0,
      flaresMax: def.domain === 'air' && def.kind === 'vehicle' && key !== 'ufo' ? 6 : 0,
      launches: def.launches || null,
      nextLaunch: this.now + (def.launchEvery || 0),
      launched: [],
      lastBark: 0,
      inCombat: false,
      woundedBark: false,
      // vehicle physics + crew
      motion: this.motionFor(def, key),
      spd: 0,
      bank: 0,
      fly: def.domain === 'air' ? 1 : 0, // altitude 0..1 (0 = landed)
      flight: def.domain === 'air' ? 'air' : null, // air | landing | ground | takeoff | crash
      crewed: def.kind === 'vehicle' && !def.mount,
      role: def.role || null,
      crew: !!def.crew,
      boarding: null,
      idleSince: this.now,
      carrier: null,
    };
    if (u.motion && u.motion.jet) u.spd = u.speed * 0.7;
    u.ammo = u.ammoMax;
    u.flares = u.flaresMax;
    u.gx = u.x;
    u.gy = u.y;
    this.units.set(u.id, u);
    return u;
  }

  // physical handling model per vehicle class (null = simple walkers/animals)
  motionFor(def, key) {
    if (def.kind !== 'vehicle' || def.mount) return null;
    const art = def.art || {};
    if (def.domain === 'air') {
      if (key === 'ufo') return { air: true, heli: true, turn: 4, accel: 320, decel: 320, min: 0 };
      if (art.t === 'heli' || def.sprite === 'heli' || key.startsWith('c:')) return { air: true, heli: true, turn: 2.2, accel: 150, decel: 170, min: 0 };
      const heavy = def.hp >= 700;
      return { air: true, jet: true, turn: heavy ? 0.75 : def.speed > 380 ? 2.0 : 1.6, accel: heavy ? 90 : 190, decel: 110, min: 0.42 };
    }
    if (def.domain === 'water') {
      const big = (def.r || 10) >= 20, mid = (def.r || 10) >= 14;
      return { ship: true, turn: big ? 0.32 : mid ? 0.6 : 1.3, accel: big ? 22 : mid ? 40 : 90, decel: big ? 18 : 40 };
    }
    return { ground: true, turn: def.speed > 120 ? 2.4 : 1.25, accel: def.speed > 120 ? 140 : 80, decel: 160 };
  }

  spawnResident(house) {
    const def = this.bdef(house.type);
    if (!def || house.residents >= (def.residents || 0)) return null;
    const town = house.townId && this.towns.get(house.townId);
    const style = town ? town.style : this.defaultStyle;
    // each town has its own fixed roster of people: only they live there, and they return if lost
    let who = null;
    if (town && !def.residentType) {
      if (!town.people) {
        const pool = style === 'classic' ? NPC_NAMES : IN_NAMES;
        const r = rng(this.seed + town.id * 97);
        town.people = Array.from({ length: 14 }, () => pool[Math.floor(r() * pool.length)]);
      }
      const alive = new Set();
      for (const o of this.units.values()) if (o.town === town.id && o.civ && o.person) alive.add(o.person);
      who = town.people.find((n) => !alive.has(n));
      if (!who) return null; // everyone who lives here is already home
    }
    const u = this.spawnUnit(house.kingdom, def.residentType || pick(style === 'classic' ? CIVILIANS : CIVILIANS_IN), house.x, house.y + house.h * 8 + 6);
    if (u && who) (u.person = who), (u.name = `${who} of ${town.name}`);
    if (!u) return null;
    u.home = house.id;
    u.town = house.townId;
    u.mode = 'wander';
    house.residents++;
    return u;
  }

  removeUnit(u) {
    this.units.delete(u.id);
    if (u.home) {
      const h = this.buildings.get(u.home);
      if (h) h.residents = Math.max(0, h.residents - 1);
    }
  }

  // ------------------------------------------------------------------ buildings
  canPlace(kid, type, tx, ty) {
    const b = this.bdef(type);
    if (!b) return 'Unknown building';
    const k = this.kingdoms[kid];
    if (b.unique && k && k.castle) return 'You already have a castle';
    let water = 0;
    for (let j = 0; j < b.h; j++)
      for (let i = 0; i < b.w; i++) {
        const x = tx + i, y = ty + j;
        if (x < 1 || y < 1 || x >= this.size - 1 || y >= this.size - 1) return 'Out of the world';
        const t = this.map.tiles[y * this.size + x];
        if (t <= T.WATER) return 'Cannot build on water';
        if (this.bTiles[y * this.size + x]) return 'Something is already built there';
      }
    if (b.coastal) {
      for (let j = -1; j <= b.h; j++)
        for (let i = -1; i <= b.w; i++) {
          const x = tx + i, y = ty + j;
          if (x >= 0 && y >= 0 && x < this.size && y < this.size && this.map.tiles[y * this.size + x] <= T.WATER) water++;
        }
      if (!water) return 'Harbors must touch water';
    }
    return null;
  }

  // returns the building, or an error string
  placeBuilding(kid, type, tx, ty, force, extra = {}) {
    const def = this.bdef(type);
    if (!def) return 'Unknown building';
    if (!force) {
      const err = this.canPlace(kid, type, tx, ty);
      if (err) return err;
    } else {
      for (let j = 0; j < def.h; j++)
        for (let i = 0; i < def.w; i++) {
          const x = tx + i, y = ty + j;
          if (x < 1 || y < 1 || x >= this.size - 1 || y >= this.size - 1) return 'bad';
          if (this.bTiles[y * this.size + x]) return 'bad';
        }
      for (let j = 0; j < def.h; j++)
        for (let i = 0; i < def.w; i++) if (this.map.tiles[(ty + j) * this.size + tx + i] <= T.WATER) this.map.tiles[(ty + j) * this.size + tx + i] = T.SAND; // reclaim
    }
    const b = {
      id: this.nextId++,
      cat: 'building',
      type,
      tx,
      ty,
      w: def.w,
      h: def.h,
      x: (tx + def.w / 2) * TILE,
      y: (ty + def.h / 2) * TILE,
      r: (Math.max(def.w, def.h) * TILE) / 2,
      hp: def.hp,
      maxHp: def.hp,
      kingdom: kid,
      cd: 0,
      think: 0,
      nextSpawn: this.now + (def.every || 0),
      nextResident: this.now + 20000 + Math.random() * 20000,
      residents: 0,
      townId: extra.townId || null,
    };
    this.buildings.set(b.id, b);
    for (let j = 0; j < def.h; j++) for (let i = 0; i < def.w; i++) this.bTiles[(ty + j) * this.size + tx + i] = b.id;
    this.bGridAdd(b);
    const k = this.kingdoms[kid];
    if (type === 'castle' && k) k.castle = b.id;
    if (def.town && !b.townId) {
      const town = { id: ++this.townN, name: pick(this.theme.towns) + ' ' + (this.names === 'india' ? ['Nagar', 'Pur', 'Gaon', 'Khurd', 'Kalan'] : ['Nova', 'Minor', 'Vale', 'Ford', 'Hold'])[this.townN % 5], hallId: b.id, kingdom: kid, progress: 0, capturer: null, style: this.defaultStyle };
      this.towns.set(town.id, town);
      b.townId = town.id;
      this.townsDirty = true;
    }
    this.buildingsDirty = true;
    return b;
  }

  removeBuilding(b) {
    this.buildings.delete(b.id);
    this.bGridRemove(b);
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) this.bTiles[(b.ty + j) * this.size + b.tx + i] = 0;
    const k = this.kingdoms[b.kingdom];
    if (b.type === 'castle' && k) {
      k.castle = null;
      k.castleLostAt = this.now;
      this.kingdomsDirty = true;
    }
    const town = b.townId && this.towns.get(b.townId);
    if (town && town.hallId === b.id) {
      this.towns.delete(town.id);
      for (const o of this.buildings.values()) if (o.townId === town.id) o.townId = null;
      this.broadcastEvent(`The town of ${town.name} has been razed!`);
      this.townsDirty = true;
    }
    this.buildingsDirty = true;
  }

  bGridKey(x, y) {
    return Math.floor(x / BCELL) + Math.floor(y / BCELL) * 8192;
  }
  bGridAdd(b) {
    const k = this.bGridKey(b.x, b.y);
    let s = this.bGrid.get(k);
    if (!s) this.bGrid.set(k, (s = new Set()));
    s.add(b);
  }
  bGridRemove(b) {
    this.bGrid.get(this.bGridKey(b.x, b.y))?.delete(b);
  }
  queryBuildings(x, y, r, fn) {
    const x0 = Math.floor((x - r - 48) / BCELL), x1 = Math.floor((x + r + 48) / BCELL);
    const y0 = Math.floor((y - r - 48) / BCELL), y1 = Math.floor((y + r + 48) / BCELL);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const s = this.bGrid.get(cx + cy * 8192);
        if (s) for (const b of s) fn(b);
      }
  }

  buildingList() {
    return [...this.buildings.values()].map((b) => [b.id, b.type, b.tx, b.ty, b.kingdom, Math.ceil(b.hp), b.maxHp]);
  }

  townList() {
    const out = [];
    for (const t of this.towns.values()) {
      const h = this.buildings.get(t.hallId);
      if (h) out.push([t.id, t.name, Math.round(h.x), Math.round(h.y), t.kingdom, t.progress, t.capturer]);
    }
    return out;
  }

  kingdomList() {
    const counts = {};
    for (const u of this.units.values()) if (!u.civ) counts[u.kingdom] = (counts[u.kingdom] || 0) + 1;
    const towns = {};
    for (const t of this.towns.values()) towns[t.kingdom] = (towns[t.kingdom] || 0) + 1;
    return this.kingdoms.filter(Boolean).map((k) => {
      const p = k.playerId && this.players.get(k.playerId);
      return { id: k.id, name: k.name, color: k.color, ruler: p ? p.name : 'AI Regent', bot: !p, kills: k.kills, losses: k.losses, units: counts[k.id] || 0, towns: towns[k.id] || 0, castle: !!k.castle, pid: p ? p.id : null, coal: k.coalition || null };
    });
  }

  // ------------------------------------------------------------------ movement
  // solid buildings are walked around by everyone; fields, runways and helipads are open ground
  blocksMove(b) {
    if (!b) return false;
    const d = this.bdef(b.type);
    return !!d && !d.flat && !d.decor && !d.runway;
  }

  // (fx, fy) = where the mover stands now: anyone already inside a building (spawned there) may walk out
  passable(x, y, domain, kingdom, fx, fy) {
    if (x < 0 || y < 0 || x >= this.size * TILE || y >= this.size * TILE) return false;
    if (speedAt(this.map, x, y, domain) <= 0) return false;
    if (domain !== 'air') {
      const bid = this.bTiles[Math.floor(y / TILE) * this.size + Math.floor(x / TILE)];
      if (bid && this.blocksMove(this.buildings.get(bid))) {
        if (fx !== undefined && this.bTiles[Math.floor(fy / TILE) * this.size + Math.floor(fx / TILE)] === bid) return true;
        return false;
      }
    }
    return true;
  }

  tileOpen(tx, ty, dom) {
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return false;
    const i = ty * this.size + tx;
    if (SPEED[dom][this.map.tiles[i]] <= 0) return false;
    const bid = this.bTiles[i];
    return !(bid && this.blocksMove(this.buildings.get(bid)));
  }

  // nearest open tile (no water for walkers, no solid building) around (tx, ty)
  nearestFree(tx, ty, maxR, pred) {
    for (let r = 0; r <= maxR; r++)
      for (let j = -r; j <= r; j++)
        for (let i = -r; i <= r; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const x = tx + i, y = ty + j;
          if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
          const idx = y * this.size + x;
          if (!pred(this.map.tiles[idx])) continue;
          const bid = this.bTiles[idx];
          if (bid && this.blocksMove(this.buildings.get(bid))) continue;
          return { tx: x, ty: y };
        }
    return null;
  }

  lineOpen(ax, ay, bx, by, dom, maxLen = 640) {
    const len = Math.min(Math.hypot(bx - ax, by - ay), maxLen);
    if (len < 1) return true;
    const ux = (bx - ax) / Math.hypot(bx - ax, by - ay), uy = (by - ay) / Math.hypot(bx - ax, by - ay);
    const st = Math.floor(ax / TILE) + Math.floor(ay / TILE) * 100000;
    for (let s = 6; s <= len; s += 6) {
      const x = ax + ux * s, y = ay + uy * s;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (tx + ty * 100000 === st) continue;
      if (!this.tileOpen(tx, ty, dom)) return false;
    }
    return true;
  }

  // A* over tiles inside a bounded window (long trips get solved in legs)
  findPath(u, gx, gy, dom) {
    const S = this.size;
    const sx = Math.floor(u.x / TILE), sy = Math.floor(u.y / TILE);
    let tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE);
    const R = 44;
    const dx = tx - sx, dy = ty - sy, dl = Math.max(Math.abs(dx), Math.abs(dy));
    if (dl > R) (tx = sx + Math.round((dx * R) / dl)), (ty = sy + Math.round((dy * R) / dl));
    const x0 = Math.max(0, Math.min(sx, tx) - 14), y0 = Math.max(0, Math.min(sy, ty) - 14);
    const x1 = Math.min(S - 1, Math.max(sx, tx) + 14), y1 = Math.min(S - 1, Math.max(sy, ty) + 14);
    const W = x1 - x0 + 1, H = y1 - y0 + 1, N = W * H;
    const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heapI = [], heapF = [];
    const push = (i, f) => {
      let k = heapI.length;
      heapI.push(i);
      heapF.push(f);
      while (k > 0) {
        const p2 = (k - 1) >> 1;
        if (heapF[p2] <= f) break;
        heapI[k] = heapI[p2];
        heapF[k] = heapF[p2];
        k = p2;
      }
      heapI[k] = i;
      heapF[k] = f;
    };
    const pop = () => {
      const top = heapI[0], li = heapI.pop(), lf = heapF.pop();
      if (heapI.length) {
        let k = 0;
        for (;;) {
          let c = 2 * k + 1;
          if (c >= heapI.length) break;
          if (c + 1 < heapI.length && heapF[c + 1] < heapF[c]) c++;
          if (heapF[c] >= lf) break;
          heapI[k] = heapI[c];
          heapF[k] = heapF[c];
          k = c;
        }
        heapI[k] = li;
        heapF[k] = lf;
      }
      return top;
    };
    const idx = (x, y) => (y - y0) * W + (x - x0);
    const h = (x, y) => Math.hypot(x - tx, y - ty);
    const start = idx(sx, sy), goal = tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1 ? idx(tx, ty) : -1;
    g[start] = 0;
    push(start, h(sx, sy));
    let best = start, bestH = h(sx, sy), expanded = 0;
    const open = (x, y) => this.tileOpen(x, y, dom);
    while (heapI.length && expanded < 3500) {
      const cur = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      expanded++;
      if (cur === goal) {
        best = cur;
        break;
      }
      const cx = (cur % W) + x0, cy = Math.floor(cur / W) + y0;
      const hc = h(cx, cy);
      if (hc < bestH) (bestH = hc), (best = cur);
      for (let ddy = -1; ddy <= 1; ddy++)
        for (let ddx = -1; ddx <= 1; ddx++) {
          if (!ddx && !ddy) continue;
          const nx = cx + ddx, ny = cy + ddy;
          if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
          if (!open(nx, ny)) continue;
          if (ddx && ddy && (!open(cx + ddx, cy) || !open(cx, cy + ddy))) continue;
          const ni = idx(nx, ny);
          if (closed[ni]) continue;
          const cost = (ddx && ddy ? 1.414 : 1) / Math.max(0.3, SPEED[dom][this.map.tiles[ny * S + nx]]);
          const ng = g[cur] + cost;
          if (ng < g[ni]) {
            g[ni] = ng;
            came[ni] = cur;
            push(ni, ng + h(nx, ny));
          }
        }
    }
    if (best === start) return null;
    const pts = [];
    for (let c2 = best; c2 !== -1 && c2 !== start; c2 = came[c2]) pts.push([((c2 % W) + x0 + 0.5) * TILE, (Math.floor(c2 / W) + y0 + 0.5) * TILE]);
    pts.reverse();
    if (best === goal && dl <= R) pts.push([gx, gy]);
    // string-pull: skip waypoints we can see past
    const out = [];
    let ax = u.x, ay = u.y, i = 0;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && this.lineOpen(ax, ay, pts[j + 1][0], pts[j + 1][1], dom, 1e9)) j++;
      out.push(pts[j]);
      [ax, ay] = pts[j];
      i = j + 1;
    }
    return out;
  }

  // where to steer next: straight at the goal when the way is clear, otherwise along an A* path
  navTarget(u, tx, ty) {
    if (u.domain === 'air' && !(u.motion && u.fly <= 0.02)) return [tx, ty];
    const dom = u.motion ? (u.motion.air ? 'land' : u.domain) : u.domain;
    if (u.path && u.pathGoal && Math.hypot(u.pathGoal[0] - tx, u.pathGoal[1] - ty) < 64 && this.now < u.pathExpire) {
      while (u.pathI < u.path.length && Math.hypot(u.path[u.pathI][0] - u.x, u.path[u.pathI][1] - u.y) < (u.motion ? 14 : 8)) u.pathI++;
      if (u.pathI < u.path.length) return u.path[u.pathI];
      u.path = null;
    }
    const d = Math.hypot(tx - u.x, ty - u.y);
    if (d < 20) return [tx, ty];
    if (this.now >= (u.losCheck || 0)) {
      u.losCheck = this.now + 500 + Math.random() * 300;
      u.losClear = this.lineOpen(u.x, u.y, tx, ty, dom);
    }
    if (u.losClear) return [tx, ty];
    if (this.pathBudget > 0 && this.now >= (u.nextPath || 0)) {
      this.pathBudget--;
      u.nextPath = this.now + 1500;
      const path = this.findPath(u, tx, ty, dom);
      if (path && path.length) {
        u.path = path;
        u.pathI = 0;
        u.pathGoal = [tx, ty];
        u.pathExpire = this.now + 9000;
        return path[0];
      }
    }
    return [tx, ty];
  }

  moveBy(e, dx, dy, domain) {
    const nx = e.x + dx, ny = e.y + dy;
    let moved = false;
    if (this.passable(nx, e.y, domain, e.kingdom, e.x, e.y)) (e.x = nx), (moved = true);
    if (this.passable(e.x, ny, domain, e.kingdom, e.x, e.y)) (e.y = ny), (moved = true);
    return moved;
  }

  terrainMul(e, domain) {
    return Math.max(0.25, speedAt(this.map, e.x, e.y, domain) || 0.25);
  }

  // ------------------------------------------------------------------ vehicle physics
  // obstacle-aware heading for vehicles: probe ahead and pick the first clear direction
  headingToward(u, tx, ty) {
    const base = Math.atan2(ty - u.y, tx - u.x);
    if (u.motion.air && u.fly > 0.02) return base;
    const look = 14 + Math.abs(u.spd) * 0.45 + u.r;
    const dom = u.motion.air ? 'land' : u.domain;
    const offsets = this.now < u.steerUntil ? [u.steer, 0, -u.steer] : [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3];
    for (const o of offsets) {
      const a = base + o;
      if (this.passable(u.x + Math.cos(a) * look, u.y + Math.sin(a) * look, dom, u.kingdom, u.x, u.y) && this.passable(u.x + Math.cos(a) * look * 0.5, u.y + Math.sin(a) * look * 0.5, dom, u.kingdom, u.x, u.y)) {
        if (o !== 0 && this.now >= u.steerUntil) (u.steer = o), (u.steerUntil = this.now + 900);
        return a;
      }
    }
    return base + Math.PI; // boxed in: back out
  }

  // runway / flight deck under (x, y)? jets need an airport runway or a carrier; helicopters accept any airfield
  runwayAt(x, y, jet = true) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx >= 0 && ty >= 0 && tx < this.size && ty < this.size) {
      const b = this.buildings.get(this.bTiles[ty * this.size + tx]);
      if (b && this.bdef(b.type)?.runway && (b.type === 'airport' ? ty - b.ty >= 1 : !jet)) return { b };
    }
    let found = null;
    this.query(x, y, 90, (e) => {
      if (!found && e.cat === 'unit' && e.launches && dist2(x, y, e.x, e.y) < (e.r + 4) ** 2) found = { carrier: e };
    });
    return found;
  }

  followCarrier(u) {
    const c = this.units.get(u.carrier);
    if (!c) {
      u.carrier = null;
      if (u.fly <= 0 && speedAt(this.map, u.x, u.y, 'land') <= 0) this.damage(u, u.hp + 1, null); // sank with the ship
      return;
    }
    const ca = c.angle;
    u.x = c.x + Math.cos(ca) * u.cdx - Math.sin(ca) * u.cdy;
    u.y = c.y + Math.sin(ca) * u.cdx + Math.cos(ca) * u.cdy;
    u.angle = ca + u.cda;
  }

  // altitude & flight phases for aircraft
  stepFlight(u, dt) {
    const m = u.motion;
    if (u.flight === 'takeoff') {
      u.fly = Math.min(1, u.fly + dt * (m.heli ? 0.8 : 0.5));
      if (u.fly >= 1) u.flight = 'air';
    } else if (u.flight === 'landing') {
      // carriers: short steep approach onto the arrestor wires; runways: a gentle flare
      const rate = m.heli ? 0.6 : u.landRw && u.landRw.carrier ? 1.7 : 0.9;
      u.fly = Math.max(0, u.fly - dt * rate);
      if (u.fly <= 0) this.touchdown(u);
    } else if (u.flight === 'crash') {
      u.fly = Math.max(0, u.fly - dt * 0.4);
      u.angle += dt * 1.6;
      if (u.fly <= 0) this.damage(u, u.hp + 1, null);
    }
  }

  touchdown(u) {
    const m = u.motion;
    const rw = this.runwayAt(u.x, u.y, !!m.jet);
    const ok = rw || (m.heli && speedAt(this.map, u.x, u.y, 'land') > 0);
    if (!ok) {
      u.flight = 'takeoff'; // missed: go around
      u.fly = 0.05;
      u.app = null;
      if (u.driver) this.toast(this.players.get(u.driver), m.jet ? 'Missed the runway: going around. Press L near a runway for the autopilot approach' : "Can't land on water: going around");
      return;
    }
    u.flight = 'ground';
    u.app = null;
    u.gx = u.x;
    u.gy = u.y;
    if (rw && rw.carrier) {
      const c = rw.carrier, ca = c.angle, dx = u.x - c.x, dy = u.y - c.y;
      u.carrier = c.id;
      u.cdx = Math.cos(-ca) * dx - Math.sin(-ca) * dy;
      u.cdy = Math.sin(-ca) * dx + Math.cos(-ca) * dy;
      u.cda = angDiff(u.angle, ca);
      u.spd = 0; // caught the arrestor wire
    } else if (m.jet) u.rollout = u.landDir ?? u.angle;
    if (rw && rw.b && rw.b.type === 'airport' && !u.driver) u.park = this.parkingSpot(rw.b);
    if (m.heli && u.pad) u.pad = null;
    u.landRw = null;
    u.landDir = null;
    u.landOrder = false;
    if (u.driver) this.toast(this.players.get(u.driver), m.jet ? 'Touchdown! Braking…' : 'Landed.');
    if (u.dismountAfter) (u.dismountAfter = false), (u.dismountAt = this.now + 2500);
    this.effects.push({ k: 'dust', x: Math.round(u.x), y: Math.round(u.y) });
  }

  parkingSpot(b) {
    for (let i = 0; i < 6; i++) {
      const x = b.tx * TILE + 20 + i * 22, y = (b.ty + 1.5) * TILE;
      let taken = false;
      this.query(x, y, 14, (e) => { if (e.cat === 'unit' && e.motion?.air && e.fly <= 0) taken = true; });
      if (!taken) return { x, y };
    }
    return null;
  }

  // drive a vehicle with momentum: heading = desired direction (or null), throttle -1..1
  drive(u, heading, throttle, dt, boost = false) {
    const m = u.motion;
    if (u.carrier) {
      if (m.jet && throttle > 0.6) {
        u.carrier = null; // catapult launch
        u.spd = u.speed * 0.6;
        u.flight = 'takeoff';
        u.fly = 0.05;
        this.effects.push({ k: 'hit', x: Math.round(u.x), y: Math.round(u.y), c: '#ffffff' });
      } else if (m.heli && throttle > 0.2) (u.carrier = null), (u.flight = 'takeoff');
      else return;
    }
    const air = m.air && u.fly > 0.02;
    let max = u.speed * (boost && m.jet ? 1.35 : 1);
    if (!air) {
      if (m.air) max = m.heli ? 0 : this.runwayAt(u.x, u.y) ? u.speed * 0.6 : 50; // taxi
      else max *= this.terrainMul(u, u.domain);
    }
    let target = Math.max(-0.45, Math.min(1, throttle)) * max;
    if (air && m.jet && u.flight !== 'crash') target = u.flight === 'landing' ? u.speed * 0.22 : Math.max(target, u.speed * m.min);
    if (u.flight === 'crash') target = Math.max(u.spd, u.speed * 0.5);
    let turnStep = 0;
    if (heading != null && !(m.air && !air && m.heli)) {
      const diff = angDiff(heading, u.angle);
      let tr = m.air && !air ? 1.4 : m.turn;
      if (m.ground && target < 0) tr *= 0.7;
      turnStep = Math.max(-tr * dt, Math.min(tr * dt, diff));
      u.angle += turnStep;
      if (!m.air && Math.abs(diff) > 1.3 && target > 0) target *= 0.45; // slow down for sharp turns
    }
    u.bank += ((air ? turnStep / (m.turn * dt || 1) : 0) - u.bank) * Math.min(1, dt * 5);
    const brakes = u.flight === 'landing' || (m.air && !air) ? 2.6 : 1; // airbrakes / wheel brakes
    const acc = (Math.abs(target) > Math.abs(u.spd) ? m.accel : m.decel * brakes) * dt;
    u.spd += Math.max(-acc, Math.min(acc, target - u.spd));
    if (Math.abs(u.spd) > 0.3) {
      const dom = air ? 'air' : m.air ? 'land' : u.domain;
      if (!this.moveBy(u, Math.cos(u.angle) * u.spd * dt, Math.sin(u.angle) * u.spd * dt, dom)) u.spd *= 0.4;
    }
    // rolling take-off along a runway / vertical lift-off for helicopters
    if (m.jet && u.flight === 'ground' && throttle > 0.6 && u.spd > u.speed * 0.38 && this.runwayAt(u.x, u.y)) u.flight = 'takeoff';
    if (m.heli && u.flight === 'ground' && throttle > 0.2) u.flight = 'takeoff';
    u.steered = true;
  }

  // ------------------------------------------------------------------ runways & approaches
  // nearest runway this aircraft may use: own airports & carriers (plus neutral airfields if allowed)
  homeRunway(u, maxD = 3500, allowNeutral = false) {
    let best = null, bd = maxD * maxD;
    for (const b of this.buildings.values()) {
      if (b.type !== 'airport' || !(b.kingdom === u.kingdom || (allowNeutral && b.kingdom === NEUTRAL))) continue;
      const d = dist2(u.x, u.y, b.x, b.y);
      if (d < bd) (bd = d), (best = { b });
    }
    this.query(u.x, u.y, Math.min(maxD, 3000), (e) => {
      if (e.cat !== 'unit' || !e.launches || e.kingdom !== u.kingdom) return;
      const d = dist2(u.x, u.y, e.x, e.y);
      if (d < bd) (bd = d), (best = { carrier: e });
    });
    return best;
  }

  // runway centre line: centre point, half length, heading of the deck/runway
  runwayRef(rw) {
    if (rw.carrier) {
      const c = this.units.get(rw.carrier.id);
      return c ? { cx: c.x, cy: c.y, half: c.r * 0.75, axis: c.angle } : null;
    }
    const b = this.buildings.get(rw.b.id);
    return b ? { cx: (b.tx + b.w / 2) * TILE, cy: b.ty * TILE + 64, half: (b.w * TILE) / 2 - 22, axis: 0 } : null;
  }

  // plan an approach: land from whichever end of the runway the aircraft is already on
  approachFor(u, rw) {
    const ref = this.runwayRef(rw);
    if (!ref) return null;
    const dir = rw.carrier ? ref.axis : u.x < ref.cx ? 0 : Math.PI;
    return { rw, dir, phase: 'setup', since: this.now };
  }

  // fly a proper approach: out to the final-approach fix, intercept the extended centre line,
  // descend at approach speed and start the flare right over the threshold
  flyApproach(u, dt) {
    const app = u.app;
    const ref = app && this.runwayRef(app.rw);
    if (!ref) return void (u.app = null), false;
    const dir = app.rw.carrier ? ref.axis : app.dir;
    const dx = Math.cos(dir), dy = Math.sin(dir);
    const tx = ref.cx - dx * ref.half, ty = ref.cy - dy * ref.half; // threshold
    const px = u.x - tx, py = u.y - ty;
    const s = px * dx + py * dy, e = -px * dy + py * dx; // along-track, cross-track
    let heading, throttle;
    if (app.phase === 'setup') {
      const fd = app.rw.carrier ? 420 : 500;
      const fx = tx - dx * fd, fy = ty - dy * fd;
      heading = Math.atan2(fy - u.y, fx - u.x);
      throttle = 0.7;
      const lined = s < -220 && Math.abs(e) < 60 && Math.abs(angDiff(u.angle, dir)) < 0.5;
      if (Math.hypot(fx - u.x, fy - u.y) < 110 || lined) app.phase = 'final';
    } else {
      // pure pursuit of a point on the centre line ahead of us
      const look = 150;
      heading = Math.atan2(ty + dy * (s + look) - u.y, tx + dx * (s + look) - u.x);
      throttle = 0.15;
      const gate = app.rw.carrier ? -70 : -30;
      if (s > gate && Math.abs(e) < 14 && Math.abs(angDiff(u.angle, dir)) < 0.3) {
        u.flight = 'landing';
        u.landDir = dir;
        u.landRw = app.rw;
      } else if (s > 40 || Math.abs(e) > 170 || this.now - app.since > 60000) {
        app.phase = 'setup'; // go around
        app.since = this.now;
        if (u.driver) this.toast(this.players.get(u.driver), 'Autopilot: not lined up, going around for another approach');
      }
    }
    this.drive(u, heading, throttle, dt);
    return true;
  }

  // during the flare: hold the runway heading and nudge back onto the centre line
  flareHeading(u) {
    if (!u.landRw) return u.angle;
    const ref = this.runwayRef(u.landRw);
    if (!ref) return u.angle;
    const dir = u.landRw.carrier ? ref.axis : u.landDir ?? u.angle;
    const e = -(u.x - ref.cx) * Math.sin(dir) + (u.y - ref.cy) * Math.cos(dir);
    return dir - Math.max(-0.25, Math.min(0.25, e * 0.05));
  }

  nearestPad(u, maxD = 1500) {
    let best = null, bd = maxD * maxD;
    for (const b of this.buildings.values()) {
      if (b.type !== 'helipad' || b.kingdom !== u.kingdom) continue;
      const d = dist2(u.x, u.y, b.x, b.y);
      if (d >= bd) continue;
      let busy = false;
      this.query(b.x, b.y, 16, (e) => { if (e !== u && e.cat === 'unit' && e.motion?.air && e.fly < 0.3) busy = true; });
      if (!busy) (bd = d), (best = { x: b.x, y: b.y });
    }
    return best;
  }

  // aircraft-specific AI: scramble, patrol, return to base and land. Returns true if it handled movement.
  aircraftAI(u, dt, w) {
    const m = u.motion;
    const t = u.target && this.getById(u.target);
    if (u.forceLand) u.landOrder = true; // a landing order sticks until touchdown
    const hasT = t && this.alive(t) && !u.landOrder;
    if (u.flight === 'ground') {
      if (u.rollout != null) {
        if (Math.abs(u.spd) > 6) return this.drive(u, u.rollout, 0, dt), true;
        u.rollout = null;
      }
      if (u.dismountAt) {
        // ordered to get out: stay put (no scrambling) until the crew has climbed down
        if (this.now >= u.dismountAt) (u.dismountAt = 0), this.dismountCrew(u);
        else if (Math.abs(u.spd) > 1) this.drive(u, null, 0, dt);
        return true;
      }
      const goFar = u.mode === 'guard' && Math.hypot(u.gx - u.x, u.gy - u.y) > 300;
      if (hasT || u.mode === 'attack' || u.mode === 'follow' || u.forceTakeoff || goFar) {
        u.park = null;
        if (m.jet && !u.carrier && !this.runwayAt(u.x, u.y)) {
          // taxi back onto the runway first
          const rw = this.homeRunway(u, 600, true);
          const ref = rw && this.runwayRef(rw);
          if (ref) return this.drive(u, Math.atan2(ref.cy - u.y, ref.cx - ref.half * 0.6 - u.x), 0.5, dt), true;
        }
        this.drive(u, m.jet ? u.angle : null, 1, dt); // scramble!
        if (u.flight !== 'ground') u.forceTakeoff = false;
        return true;
      }
      if (u.park) {
        const d = Math.hypot(u.park.x - u.x, u.park.y - u.y);
        if (d > 5) this.drive(u, Math.atan2(u.park.y - u.y, u.park.x - u.x), 0.3, dt);
        else u.park = null;
      } else if (!u.carrier && m.jet) u.angle = turnToward(u.angle, 0, dt * 1.5); // park facing down the runway
      return true;
    }
    if (u.flight === 'landing') return this.drive(u, m.jet ? this.flareHeading(u) : null, 0, dt), true;
    if (u.flight === 'takeoff') return this.drive(u, u.angle, 1, dt), true;
    if (u.flight === 'crash') return true;
    if (u.app) {
      if (hasT) u.app = null;
      else return this.flyApproach(u, dt);
    }
    if (hasT) {
      u.idleSince = this.now;
      return false;
    }
    const wantLand = u.landOrder || (u.mode === 'guard' && this.now - u.idleSince > (m.heli ? 20000 : 26000) && Math.hypot(u.gx - u.x, u.gy - u.y) < 400);
    if (!wantLand) return false;
    if (m.heli) {
      // helicopters prefer a free helipad, otherwise any flat ground
      if (u.pad === undefined || u.pad === null) u.pad = this.nearestPad(u) || false;
      if (u.pad) {
        const d = Math.hypot(u.pad.x - u.x, u.pad.y - u.y);
        if (d > 8) return this.drive(u, Math.atan2(u.pad.y - u.y, u.pad.x - u.x), d < 90 ? 0.3 : 1, dt), true;
      }
      if (speedAt(this.map, u.x, u.y, 'land') > 0) {
        u.flight = 'landing';
        u.forceLand = false;
      }
      return false;
    }
    const rw = this.homeRunway(u, 3500, u.landOrder);
    u.forceLand = false;
    if (!rw) return false;
    u.app = this.approachFor(u, rw);
    return u.app ? this.flyApproach(u, dt) : false;
  }

  // crew steps out of a stopped vehicle at a safe spot by the door
  exitSpot(v) {
    const base = (v.r || 8) + 8;
    const sides = [Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI * 0.75, -Math.PI * 0.75, 0, Math.PI / 4, -Math.PI / 4];
    for (const rad of [base, base + 10, base + 22])
      for (const a of sides) {
        const x = v.x + Math.cos(v.angle + a) * rad, y = v.y + Math.sin(v.angle + a) * rad;
        const t = tileAt(this.map, x, y);
        if (t >= T.SAND && this.passable(x, y, 'foot', v.kingdom)) return { x, y };
      }
    const t = nearestTile(this.map, Math.floor(v.x / TILE), Math.floor(v.y / TILE), 3, (tt) => tt >= T.SAND);
    return t ? { x: (t.tx + 0.5) * TILE, y: (t.ty + 0.5) * TILE } : null;
  }

  dismountCrew(v) {
    if (!v.crewed || v.driver) return false;
    if (v.motion && v.motion.air && v.fly > 0.05) return false;
    const spot = this.exitSpot(v);
    if (!spot) return false; // at sea
    v.crewed = false;
    v.spd = 0;
    v.standDownUntil = this.now + 60000; // stays parked: idle crews leave it alone for a minute
    const crew = this.spawnUnit(v.kingdom, 'pilot', spot.x, spot.y);
    if (crew) {
      crew.x = spot.x;
      crew.y = spot.y;
      crew.mode = 'guard';
      crew.gx = spot.x;
      crew.gy = spot.y;
      crew.boarding = null;
      crew.lastVehicle = v.id;
      crew.noBoardUntil = this.now + 60000; // ordered out: don't hop straight back in
    }
    this.effects.push({ k: 'dust', x: Math.round(spot.x), y: Math.round(spot.y) });
    return crew;
  }

  // who may operate what: pilots anything, soldiers ground vehicles & boats
  canOperate(u, v) {
    if (!v || !v.motion) return false;
    if (u.crew) return true;
    const def = this.unitDef(u.def);
    return def && def.group === 'Soldiers' && !v.motion.air;
  }

  steerToward(u, tx, ty, dt, speedMul = 1) {
    [tx, ty] = this.navTarget(u, tx, ty);
    if (u.motion) return this.drive(u, this.headingToward(u, tx, ty), Math.min(1, speedMul), dt);
    const base = Math.atan2(ty - u.y, tx - u.x);
    const sp = u.speed * speedMul * dt * this.terrainMul(u, u.domain);
    const offsets = this.now < u.steerUntil ? [u.steer, 0, -u.steer] : [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6];
    for (const o of offsets) {
      const a = base + o;
      const dx = Math.cos(a) * sp, dy = Math.sin(a) * sp;
      if (this.passable(u.x + dx, u.y + dy, u.domain, u.kingdom, u.x, u.y)) {
        u.x += dx;
        u.y += dy;
        u.angle = turnToward(u.angle, a, 8 * dt);
        if (o !== 0 && this.now >= u.steerUntil) (u.steer = o), (u.steerUntil = this.now + 700);
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ spatial grid
  rebuildGrid() {
    this.grid.clear();
    const add = (e) => {
      const key = Math.floor(e.x / CELL) + Math.floor(e.y / CELL) * 16384;
      let c = this.grid.get(key);
      if (!c) this.grid.set(key, (c = []));
      c.push(e);
    };
    this.playerPos = [];
    for (const p of this.players.values()) {
      this.playerPos.push([p.x, p.y]);
      if (!p.dead && !p.vehicle) add(p);
    }
    for (const u of this.units.values()) add(u);
  }

  query(x, y, r, fn) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.grid.get(cx + cy * 16384);
        if (c) for (const e of c) fn(e);
      }
  }

  nearAnyPlayer(x, y, r) {
    for (const [px, py] of this.playerPos) if (dist2(px, py, x, y) < r * r) return true;
    return false;
  }

  alive(e) {
    if (!e || e.hp <= 0) return false;
    if (e.cat === 'player') return !e.dead && !e.vehicle && this.players.has(e.id);
    if (e.cat === 'unit') return this.units.has(e.id);
    return this.buildings.has(e.id);
  }

  // Who will `u` pick a fight with on its own? (anyone can still be hit by stray fire)
  canAutoTarget(u, e) {
    if (this.allied(e.kingdom, u.kingdom) || e.hp <= 0) return false;
    if (e.cat === 'player' && (e.dead || e.vehicle)) return false;
    // swords can't reach aircraft, and tank / artillery cannons can't elevate to hit them
    if (e.motion && e.motion.air && e.fly > 0.3) {
      const w = this.weaponOf(u.weapon);
      if (w && (w.melee || (w.splash && u.domain === 'land' && !w.antiAir))) return false;
    }
    if (u.kingdom === WILD) return !e.wild; // predators hunt anything that isn't wildlife
    if (u.kingdom === ALIEN) return !(e.wild && e.passive);
    if (u.kingdom === NEUTRAL) return false; // town militia only retaliate
    if (e.passive) return false;
    if (e.kingdom === NEUTRAL) return u.mode === 'attack'; // only an army on the offensive storms a free town
    return true;
  }

  canTargetBuilding(u, b) {
    if (this.allied(b.kingdom, u.kingdom) || this.bdef(b.type)?.decor) return false;
    if (u.kingdom === ALIEN) return true;
    return u.kingdom >= 0 && b.kingdom >= 0;
  }

  // smart target choice: close, weakened, and threats to our ruler first
  pickTarget(u, range, withBuildings) {
    let best = null, bs = Infinity;
    this.query(u.x, u.y, range, (e) => {
      if (!this.canAutoTarget(u, e)) return;
      const d = Math.sqrt(dist2(u.x, u.y, e.x, e.y));
      if (d > range || (e.stealth && d > (e.stealth === true ? 200 : e.stealth))) return; // subs and stealth jets are only spotted up close
      let s = d - (1 - e.hp / e.maxHp) * 120;
      const eAir = e.motion && e.motion.air && e.fly > 0.3;
      if (u.role === 'fighter') s += eAir ? -350 : 160; // air superiority first
      else if (u.role === 'attack' && e.kind === 'vehicle' && !eAir) s -= 150; // tank busters
      else if (u.role === 'aa') s += eAir ? -500 : 200;
      if (e.cat === 'player') s -= 60;
      if (e.focusT > this.now - 900) s -= e.hp < e.maxHp * 0.5 ? 80 : 40; // focus fire: help finish what friends are shooting
      if (e.kind === 'vehicle' && u.weapon && this.weaponOf(u.weapon).splash) s -= 80; // splash weapons go for armour
      if (s < bs) (bs = s), (best = e);
    });
    if (!best && withBuildings) {
      this.queryBuildings(u.x, u.y, range, (b) => {
        if (!this.canTargetBuilding(u, b)) return;
        const d = Math.sqrt(dist2(u.x, u.y, b.x, b.y)) - b.r;
        if (d < range && d < bs) (bs = d), (best = b);
      });
    }
    return best;
  }

  nearestThreat(u, range) {
    let best = null, bd = range * range;
    this.query(u.x, u.y, range, (e) => {
      if (this.allied(e.kingdom, u.kingdom) || e.passive || e.hp <= 0) return;
      if (e.cat === 'player' && (e.dead || e.vehicle)) return;
      if (u.kingdom >= 0 && e.kingdom === NEUTRAL) return;
      if (u.kingdom === NEUTRAL && e.kingdom === NEUTRAL) return;
      const d = dist2(u.x, u.y, e.x, e.y);
      if (d < bd) (bd = d), (best = e);
    });
    return best;
  }

  // is there a town hall near (x, y) that `kid` doesn't own yet? (units hold position there until it's captured)
  townToTakeAt(x, y, kid) {
    if (kid < 0) return false;
    let found = false;
    this.queryBuildings(x, y, 150, (b) => {
      if (b.type === 'townhall' && b.kingdom !== kid && dist2(x, y, b.x, b.y) < 150 * 150) found = true;
    });
    return found;
  }

  nearestEnemyBuildingAnywhere(u) {
    let best = null, bd = Infinity;
    for (const b of this.buildings.values()) {
      if (!this.canTargetBuilding(u, b)) continue;
      const d = dist2(u.x, u.y, b.x, b.y);
      if (d < bd) (bd = d), (best = b);
    }
    return best;
  }

  getById(id) {
    return this.units.get(id) || this.players.get(id) || this.buildings.get(id) || null;
  }

  // ------------------------------------------------------------------ combat
  fire(src, weapon, tx, ty, tid = null) {
    if (!weapon) return;
    const a0 = Math.atan2(ty - src.y, tx - src.x);
    if (weapon.melee) {
      const reach = weapon.range + 8;
      this.query(src.x, src.y, reach + 14, (e) => {
        if (this.allied(e.kingdom, src.kingdom) || e.id === src.id) return;
        const d = Math.sqrt(dist2(src.x, src.y, e.x, e.y));
        if (d > reach + e.r) return;
        const da = Math.abs(angDiff(Math.atan2(e.y - src.y, e.x - src.x), a0));
        if (da < 1.3 || d < 10) this.damage(e, weapon.dmg, src);
      });
      this.queryBuildings(src.x, src.y, reach, (b) => {
        if (this.allied(b.kingdom, src.kingdom)) return;
        if (Math.sqrt(dist2(src.x, src.y, b.x, b.y)) < reach + b.r) this.damage(b, weapon.dmg, src);
      });
      if (!weapon.hidden || Math.random() < 0.5) this.effects.push({ k: 'slash', x: src.x + Math.cos(a0) * 12, y: src.y + Math.sin(a0) * 12, a: a0, c: weapon.color });
      return;
    }
    const n = weapon.count || 1;
    if (weapon.mk && weapon.mk !== 4 && weapon.mk !== 6) this.effects.push({ k: 'launch', x: Math.round(src.x + Math.cos(a0) * (src.r + 4)), y: Math.round(src.y + Math.sin(a0) * (src.r + 4)), a: Math.round(a0 * 100) / 100, mk: weapon.mk });
    for (let i = 0; i < n; i++) {
      const a = a0 + (Math.random() - 0.5) * 2 * (weapon.spread || 0) + (n > 1 ? (i / (n - 1) - 0.5) * (weapon.spread || 0) : 0);
      this.bullets.push({
        x: src.x + Math.cos(a) * (src.r + 2),
        y: src.y + Math.sin(a) * (src.r + 2),
        vx: Math.cos(a) * weapon.speed,
        vy: Math.sin(a) * weapon.speed,
        left: weapon.range,
        dmg: weapon.dmg,
        splash: weapon.splash || 0,
        color: weapon.color || '#ffe066',
        size: weapon.size || 2,
        kingdom: src.kingdom,
        srcId: src.id,
        tid: weapon.homing ? tid : null,
        turn: weapon.homing || 0,
        mk: weapon.mk || 0,
      });
    }
  }

  damage(target, amount, src) {
    if (target.hp <= 0) return;
    target.hp -= amount;
    const srcKid = src ? src.kingdom : undefined;
    if (target.kingdom >= 0 && (srcKid >= 0 || srcKid === ALIEN) && !this.allied(srcKid, target.kingdom) && this.kingdoms[target.kingdom]) {
      const kd = this.kingdoms[target.kingdom];
      kd.lastHit = this.now;
      kd.lastHitX = target.x;
      kd.lastHitY = target.y;
      (kd.threat ||= {})[srcKid] = (kd.threat[srcKid] || 0) + amount; // who has hurt us, and how much
      // call for help: idle friends and allies nearby turn on the attacker
      if (src && src.id && target.hp > 0 && !(target.helpAt > this.now)) {
        target.helpAt = this.now + 1200;
        const foe = src.cat === 'unit' && src.driver ? src.driver : src.id;
        this.query(target.x, target.y, 520, (e) => {
          if (e.cat !== 'unit' || e === target || e.civ || e.passive || e.driver || e.moveOrder || !e.weapon || e.kingdom < 0) return;
          if (!this.allied(e.kingdom, target.kingdom) || (e.target && e.grudge)) return;
          if (e.mode !== 'guard' && e.mode !== 'wander' && e.mode !== 'patrol' && e.mode !== 'follow') return;
          e.grudge = foe;
          e.grudgeUntil = this.now + 8000;
          e.asleep = false;
        });
      }
    }
    if (target.cat === 'player' && src && src.id) (target.lastHitBy = src.id), (target.lastHitAt = this.now);
    // reactions: grudges, fleeing, and town militia rallying to defend their people
    if (target.hp > 0 && src && src.id && !this.allied(srcKid, target.kingdom)) {
      if (target.cat === 'unit') {
        if (target.passive || target.civ) {
          target.fleeUntil = this.now + 3000;
          target.fleeFromX = src.x;
          target.fleeFromY = src.y;
        } else if (!target.driver) {
          target.grudge = src.cat === 'unit' && src.driver ? src.driver : src.id;
          target.grudgeUntil = this.now + 10000;
          target.asleep = false;
        }
      }
      if (target.kingdom === NEUTRAL || (target.cat === 'unit' && target.civ)) {
        this.query(target.x, target.y, 450, (e) => {
          if (e.cat === 'unit' && e.kingdom === target.kingdom && !e.passive && !e.driver) {
            e.grudge = src.id;
            e.grudgeUntil = this.now + 12000;
            e.asleep = false;
          }
        });
      }
    }
    if (target.hp > 0) return;
    const killer = srcKid >= 0 && this.kingdoms[srcKid];
    if (killer && srcKid !== target.kingdom) killer.kills++;
    if (src && src.cat === 'unit' && this.units.has(src.id) && target.cat !== 'building' && Math.random() < 0.25) this.bark(src, 'victory');
    const victim = target.kingdom >= 0 && this.kingdoms[target.kingdom];
    if (victim) victim.losses++;
    this.kingdomsDirty = true;
    if (target.cat === 'player') {
      target.dead = true;
      target.respawnAt = this.now + 4000;
      this.effects.push({ k: 'die', x: target.x, y: target.y });
      const by = src ? src.name || 'a tower' : 'the wilds';
      this.broadcastEvent(`${target.name} was slain by ${by}`);
    } else if (target.cat === 'unit') {
      this.removeUnit(target);
      const big = target.kind === 'vehicle' && !target.mount;
      // crews sometimes survive: pilots eject, tank crews bail out
      if (big && target.crewed && target.kingdom >= 0 && Math.random() < (target.motion?.air ? 0.65 : 0.4)) {
        const pu = this.spawnUnit(target.kingdom, 'pilot', target.x + (Math.random() - 0.5) * 30, target.y + (Math.random() - 0.5) * 30);
        if (pu) (pu.hp = pu.maxHp * 0.5), this.effects.push({ k: 'die', x: pu.x, y: pu.y });
      }
      this.effects.push({ k: big ? 'boom' : 'die', x: target.x, y: target.y, r: big ? 40 : 0 });
      if (target.driver) {
        const p = this.players.get(target.driver);
        if (p) {
          p.vehicle = null;
          p.x = target.x;
          p.y = target.y;
          this.ejectToSafety(p);
          this.damage(p, big ? 60 : 15, src);
        }
      }
    } else if (target.cat === 'building') {
      this.effects.push({ k: 'boom', x: target.x, y: target.y, r: target.r * 1.5 });
      this.removeBuilding(target);
      if (target.type === 'castle') {
        const kk = this.kingdoms[target.kingdom];
        this.broadcastEvent(`The castle of ${kk ? kk.name : '?'} has fallen to ${src ? this.factionName(srcKid) : 'ruin'}!`);
      }
    }
  }

  explode(x, y, radius, dmg, kingdom, src) {
    this.effects.push({ k: 'boom', x, y, r: radius });
    this.query(x, y, radius + 20, (e) => {
      if (this.allied(e.kingdom, kingdom)) return;
      const d = Math.sqrt(dist2(x, y, e.x, e.y));
      if (d < radius + e.r) this.damage(e, dmg * (1 - (d / (radius + e.r)) * 0.6), src);
    });
    const hit = [];
    this.queryBuildings(x, y, radius, (b) => {
      if (!this.allied(b.kingdom, kingdom) && Math.sqrt(dist2(x, y, b.x, b.y)) < radius + b.r) hit.push(b);
    });
    for (const b of hit) this.damage(b, dmg * 0.8, src);
  }

  stepBullets(dt) {
    const keep = [];
    for (const b of this.bullets) {
      if (b.tid) {
        // homing missiles steer toward their target
        const t = this.getById(b.tid);
        const tt = t && t.cat === 'player' && t.vehicle ? this.units.get(t.vehicle) : t;
        if (tt && tt.hp > 0 && !b.ecm && tt.flares && tt.motion && tt.motion.air && !tt.driver && dist2(b.x, b.y, tt.x, tt.y) < 420 * 420) {
          b.ecm = true; // the AI pilot sees it coming
          if (Math.random() < 0.7) this.dropFlares(tt);
        }
        if (tt && tt.hp > 0 && b.tid) {
          const cur = Math.atan2(b.vy, b.vx), sp = Math.hypot(b.vx, b.vy);
          // lead pursuit: steer for where the target will be when the missile gets there
          const tvx = tt.motion ? Math.cos(tt.angle) * (tt.spd || 0) : 0, tvy = tt.motion ? Math.sin(tt.angle) * (tt.spd || 0) : 0;
          const tgo = Math.min(1.6, Math.hypot(tt.x - b.x, tt.y - b.y) / Math.max(200, sp));
          const na = cur + Math.max(-b.turn * dt, Math.min(b.turn * dt, angDiff(Math.atan2(tt.y + tvy * tgo - b.y, tt.x + tvx * tgo - b.x), cur)));
          b.vx = Math.cos(na) * sp;
          b.vy = Math.sin(na) * sp;
        } else b.tid = null;
      }
      const sx = b.vx * dt, sy = b.vy * dt;
      const steps = Math.max(1, Math.ceil(Math.hypot(sx, sy) / 8));
      let hit = false;
      for (let s = 0; s < steps && !hit; s++) {
        b.x += sx / steps;
        b.y += sy / steps;
        b.left -= Math.hypot(sx, sy) / steps;
        const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
        if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) {
          hit = true;
          break;
        }
        const bid = this.bTiles[ty * this.size + tx];
        let target = null;
        if (bid) {
          const bb = this.buildings.get(bid);
          const bd = bb && this.bdef(bb.type);
          if (bb && bd && !bd.flat && !bd.decor && !this.allied(bb.kingdom, b.kingdom)) target = bb;
        }
        if (!target)
          this.query(b.x, b.y, 24, (e) => {
            if (target || this.allied(e.kingdom, b.kingdom) || e.id === b.srcId) return;
            if (dist2(b.x, b.y, e.x, e.y) < (e.r + 2) ** 2) target = e;
          });
        if (target) {
          hit = true;
          const src = this.getById(b.srcId) || { kingdom: b.kingdom, name: 'a fallen warrior' };
          if (b.splash) this.explode(b.x, b.y, b.splash, b.dmg, b.kingdom, src);
          else {
            this.damage(target, b.dmg, src);
            this.effects.push({ k: 'hit', x: Math.round(b.x), y: Math.round(b.y), c: b.color, b: target.cat === 'building' ? 1 : 0 });
          }
        }
      }
      if (!hit && b.left <= 0) {
        if (b.dud) this.effects.push({ k: 'boom', x: Math.round(b.x), y: Math.round(b.y), r: 14 }); // detonated on a flare: no damage
        else if (b.splash) this.explode(b.x, b.y, b.splash, b.dmg, b.kingdom, this.getById(b.srcId) || { kingdom: b.kingdom });
        continue;
      }
      if (!hit) keep.push(b);
    }
    this.bullets = keep;
  }

  // ------------------------------------------------------------------ player control
  stepPlayer(p, dt) {
    if (p.dead) {
      if (this.now >= p.respawnAt) this.respawn(p);
      return;
    }
    const inp = p.input;
    const veh = p.vehicle && this.units.get(p.vehicle);
    if (p.vehicle && !veh) p.vehicle = null;
    const body = veh || p;
    let mx = inp.mx, my = inp.my;
    const len = Math.hypot(mx, my);
    if (len > 1) (mx /= len), (my /= len);
    if (veh && veh.motion) {
      // realistic handling: momentum, turn rates, take-off / landing
      const m = veh.motion;
      if (veh.carrier) this.followCarrier(veh);
      if (m.air) this.stepFlight(veh, dt);
      if (!this.units.has(veh.id)) return;
      let heading = null, throttle = 0;
      if (len > 0.01) {
        heading = Math.atan2(my, mx);
        throttle = 1;
        // ground vehicles & ships back up when you steer against the way they face
        if (!m.air && Math.abs(angDiff(heading, veh.angle)) > 2.3 && veh.spd < veh.speed * 0.35) (heading += Math.PI), (throttle = -0.6);
      } else if (m.jet && veh.fly > 0.02) (heading = veh.angle), (throttle = 0.6); // cruise
      if (veh.autoTakeoff) {
        if (veh.flight === 'ground') (heading = veh.angle), (throttle = 1);
        else veh.autoTakeoff = false;
      }
      if (veh.app && len > 0.01) {
        veh.app = null;
        this.toast(p, 'Autopilot off: you have control');
      }
      if (veh.app && veh.flight === 'air') this.flyApproach(veh, dt); // autopilot landing approach
      else if (veh.flight === 'landing' && m.jet) this.drive(veh, this.flareHeading(veh), 0, dt);
      else if (veh.flight === 'ground' && veh.rollout != null && len < 0.01) {
        if (Math.abs(veh.spd) > 6) this.drive(veh, veh.rollout, 0, dt);
        else (veh.rollout = null), this.drive(veh, null, 0, dt);
      } else this.drive(veh, heading, throttle, dt, inp.sprint);
    } else {
      const domain = veh ? veh.domain : 'foot';
      const speed = (veh ? veh.speed : PLAYER_SPEED * (inp.sprint ? 1.6 : 1)) * this.terrainMul(body, domain);
      if (len > 0.01) {
        this.moveBy(body, mx * speed * dt, my * speed * dt, domain);
        if (veh) veh.angle = turnToward(veh.angle, Math.atan2(my, mx), 6 * dt);
      }
    }
    if (veh) {
      p.x = veh.x;
      p.y = veh.y;
      const mouseA = Math.atan2(inp.ay - veh.y, inp.ax - veh.x);
      // jets have forward-firing guns: aim within a cone around the nose
      veh.aim = veh.motion && veh.motion.jet ? veh.angle + Math.max(-0.45, Math.min(0.45, angDiff(mouseA, veh.angle))) : mouseA;
    }
    p.angle = Math.atan2(inp.ay - body.y, inp.ax - body.x);
    p.cd -= dt * 1000;
    p.altCd -= dt * 1000;
    const grounded = veh && veh.motion && veh.motion.air && veh.fly < 0.3; // no shooting while parked
    if (inp.fire && p.cd <= 0 && !grounded) {
      // riders fight with their own weapon; vehicles use their mounted guns
      const w = veh && !veh.mount ? this.weaponOf(veh.weapon) : this.weaponOf(p.weapons[p.wi]);
      if (w) {
        const ax = veh && !veh.mount ? veh.x + Math.cos(veh.aim) * 200 : inp.ax, ay = veh && !veh.mount ? veh.y + Math.sin(veh.aim) * 200 : inp.ay;
        this.fire(veh ? { x: veh.x, y: veh.y, r: veh.r, kingdom: p.kingdom, id: veh.id, name: p.name } : p, w, veh && veh.motion && !veh.motion.jet ? inp.ax : ax, veh && veh.motion && !veh.motion.jet ? inp.ay : ay, w.homing ? this.lockTarget(p, inp.ax, inp.ay) : null);
        p.cd = w.rate;
      }
    }
    if (inp.alt && veh && veh.alt && p.altCd <= 0 && !grounded) {
      if (veh.ammoMax && veh.ammo <= 0) {
        if (this.now - (p.ammoToast || 0) > 2500) (p.ammoToast = this.now), this.toast(p, 'Pylons empty! They reload slowly in flight, or land on a friendly runway to rearm');
      } else {
        let w = this.weaponOf(veh.alt);
        const tid = w.homing || veh.alt2 ? this.lockTarget(p, inp.ax, inp.ay) : null;
        const tgt = tid && this.getById(tid);
        // smart pylon: air-to-ground missiles for ground targets, air-to-air for aircraft
        if (veh.alt2 && tgt && !(tgt.motion && tgt.motion.air && tgt.fly > 0.3)) w = this.weaponOf(veh.alt2);
        const bombs = w.range < 250;
        this.fire({ x: veh.x, y: veh.y, r: veh.r, kingdom: p.kingdom, id: veh.id, name: p.name }, w, bombs ? veh.x + Math.cos(veh.angle) * 40 : inp.ax, bombs ? veh.y + Math.sin(veh.angle) * 40 : inp.ay, w.homing ? tid : null);
        p.altCd = w.rate;
        if (veh.ammoMax) (veh.ammo--, (veh.rearmAt = Math.max(veh.rearmAt || 0, this.now + 12000)));
      }
    }
    if (!veh && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 3 * dt);
  }

  ejectToSafety(p) {
    const t = nearestTile(this.map, Math.floor(p.x / TILE), Math.floor(p.y / TILE), 40, (v) => v >= T.SAND);
    if (t) (p.x = (t.tx + 0.5) * TILE), (p.y = (t.ty + 0.5) * TILE);
  }

  // homing lock: the enemy nearest the cursor
  lockTarget(p, ax, ay) {
    let best = null, bd = 240 * 240;
    this.query(ax, ay, 240, (e) => {
      if (this.allied(e.kingdom, p.kingdom) || e.hp <= 0 || e.passive) return;
      const d = dist2(ax, ay, e.x, e.y);
      if (d < bd) (bd = d), (best = e);
    });
    return best ? best.id : null;
  }

  // Board any empty vehicle (own, abandoned, or an enemy's left unattended), or your own crewed one
  // (its AI crew hops out and waits nearby).
  toggleVehicle(p) {
    if (p.dead) return;
    if (p.vehicle) return this.exitVehicle(p);
    let best = null, bd = Infinity;
    for (const u of this.units.values()) {
      if (u.kind !== 'vehicle' || u.driver || u.hp <= 0) continue;
      const reach = u.r + 36;
      const d = dist2(p.x, p.y, u.x, u.y);
      if (d > reach * reach) continue;
      const tameable = u.kingdom === WILD && u.mount;
      const empty = u.motion && !u.crewed;
      if (u.kingdom !== p.kingdom && !tameable && !empty && !u.traffic) continue;
      if (u.motion && u.motion.air && u.fly > 0.3) continue; // can't climb into a flying plane
      if (d < bd) (bd = d), (best = u);
    }
    if (!best) {
      const enemy = [...this.units.values()].find((u) => u.motion && u.crewed && u.kingdom !== p.kingdom && dist2(p.x, p.y, u.x, u.y) < (u.r + 30) ** 2);
      return this.toast(p, enemy ? `${enemy.name} has an enemy crew aboard: knock it out first` : 'Nothing to board nearby: walk up to any vehicle (yours, abandoned, or an enemy one left empty) or a wild horse');
    }
    if (best.traffic) {
      // carjack: the civilian driver jumps out and runs
      const spot = this.exitSpot(best) || { x: p.x, y: p.y };
      if (best.crewed) {
        const civ = this.spawnUnit(best.kingdom, pick(CIVILIANS_IN), spot.x, spot.y);
        if (civ) (civ.mode = 'wander'), (civ.fleeUntil = this.now + 4000), (civ.fleeFromX = p.x), (civ.fleeFromY = p.y);
      }
      this.broadcastEvent(`🚗 ${p.name} grabbed ${best.name}!`);
      best.traffic = false;
      best.town = null;
      best.kingdom = p.kingdom;
      best.sleepy = false;
      best.mode = 'guard';
    } else if (best.kingdom === WILD) {
      best.kingdom = p.kingdom;
      best.wild = false;
      best.sleepy = false;
      best.name = `${pick(['Thunder', 'Shadow', 'Blaze', 'Storm', 'Comet', 'Maple'])} the Horse`;
      this.toast(p, `You tamed a wild horse: ${best.name}!`);
    } else if (best.kingdom !== p.kingdom) {
      this.broadcastEvent(`${p.name} commandeered ${best.name} from ${this.factionName(best.kingdom).replace(/^the /, '')}!`);
      best.kingdom = p.kingdom;
      best.sleepy = false;
    } else if (best.crewed) {
      // your AI pilot/driver hops out and waits nearby to take it back later
      const spot = this.exitSpot(best) || { x: p.x, y: p.y };
      const crew = this.spawnUnit(p.kingdom, 'pilot', spot.x, spot.y);
      if (crew) (crew.x = spot.x), (crew.y = spot.y), (crew.mode = 'guard'), (crew.gx = spot.x), (crew.gy = spot.y), (crew.boarding = null), (crew.idleSince = this.now), (crew.waitFor = best.id);
      this.effects.push({ k: 'dust', x: Math.round(spot.x), y: Math.round(spot.y) });
    }
    best.crewed = false;
    best.driver = p.id;
    best.autoTakeoff = false;
    p.vehicle = best.id;
    p.ejectArm = 0;
    const m = best.motion;
    const hint = !m ? '' : m.jet ? (best.flight === 'ground' ? ' · Hold W along the runway (or press L) to take off' : ' · L to land on a runway/carrier · Shift = afterburner') : m.heli ? ' · L to take off / land anywhere' : m.ship ? ' · Ships turn slowly: plan ahead' : ' · S/back = reverse';
    this.toast(p, `In command of ${best.name}. E to exit${best.alt ? ' · RMB: ' + this.weaponOf(best.alt).name : ''}${hint}`);
  }

  exitVehicle(p, silent) {
    const v = this.units.get(p.vehicle);
    if (!v) return void (p.vehicle = null);
    const airborne = v.motion && v.motion.air && v.fly > 0.05;
    const spot = airborne ? null : this.exitSpot(v);
    if (!airborne && !spot && !silent) return this.toast(p, `You're at sea: sail `+'within a few tiles of the shore to disembark');
    if (v.motion && v.motion.air && v.fly > 0.05 && !silent) {
      // airborne: first press warns, second press ejects
      if (this.now - (p.ejectArm || 0) > 2500) {
        p.ejectArm = this.now;
        return this.toast(p, 'You are airborne! Press L to land, or E again to EJECT');
      }
      this.broadcastEvent(`${p.name} ejected from ${v.name}!`);
      this.effects.push({ k: 'die', x: v.x, y: v.y });
      v.flight = 'crash';
    }
    p.vehicle = null;
    v.driver = null;
    v.crewed = false; // left empty: a nearby pilot may man it, or anyone can take it
    v.mode = 'guard';
    v.gx = v.x;
    v.gy = v.y;
    if (spot) (p.x = spot.x), (p.y = spot.y);
    else {
      p.x = v.x;
      p.y = v.y;
      this.ejectToSafety(p); // parachute down to the nearest land
    }
    v.spd = airborne ? v.spd : 0;
    this.effects.push({ k: 'dust', x: Math.round(p.x), y: Math.round(p.y) });
    if (!silent) this.toast(p, `Left ${v.name}. It sits empty: your pilots may take it back`);
  }

  // L key: land (runway, carrier deck, or anywhere for helicopters) / take off
  landOrTakeoff(p) {
    const v = p.vehicle && this.units.get(p.vehicle);
    if (!v || !v.motion || !v.motion.air) return this.toast(p, 'L lands / takes off aircraft. Get in a jet or helicopter first.');
    const m = v.motion;
    if (v.app) {
      v.app = null;
      return this.toast(p, 'Autopilot approach cancelled');
    }
    if (v.flight === 'air') {
      if (m.jet) {
        // autopilot flies a full approach to the nearest runway / carrier and lands
        const rw = this.homeRunway(v, 2500, true);
        if (!rw) return this.toast(p, 'No runway or carrier within range: fly toward an airport (see the minimap) and press L');
        v.app = this.approachFor(v, rw);
        return this.toast(p, `Autopilot: approaching ${rw.carrier ? 'the carrier deck' : 'the runway'}. Hands off the controls; steer or press L to cancel`);
      }
      if (speedAt(this.map, v.x, v.y, 'land') <= 0 && !this.runwayAt(v.x, v.y, false)) return this.toast(p, "Helicopters can land anywhere on land or a carrier deck, not on water");
      v.flight = 'landing';
      this.toast(p, 'Landing…');
    } else if (v.flight === 'ground') {
      if (m.heli) v.flight = 'takeoff';
      else if (v.carrier || this.runwayAt(v.x, v.y)) v.autoTakeoff = true;
      else return this.toast(p, 'Taxi onto a runway first (you can steer slowly on the ground)');
      this.toast(p, 'Taking off!');
    }
  }

  // ------------------------------------------------------------------ unit AI
  // pylons reload one missile every 12 s in flight, quickly once parked; flares every 8 s
  rearm(u) {
    if (u.ammoMax && u.ammo < u.ammoMax) {
      if (u.flight === 'ground' && (u.rearmAt || 0) > this.now + 600) u.rearmAt = this.now + 600; // ground crew rearm fast
      if (this.now >= (u.rearmAt || 0)) {
        u.ammo++;
        u.rearmAt = this.now + (u.flight === 'ground' ? 600 : 12000);
      }
    }
    if (u.flaresMax && u.flares < u.flaresMax && this.now >= (u.flareAt || 0)) {
      u.flares++;
      u.flareAt = this.now + 8000;
    }
  }

  // release flares: homing missiles chasing this aircraft may lose their lock
  dropFlares(u) {
    if (!u.flares || this.now - (u.lastFlare || 0) < 1200) return false;
    u.flares--;
    u.lastFlare = this.now;
    u.flareAt = Math.max(u.flareAt || 0, this.now + 8000);
    this.effects.push({ k: 'flare', x: Math.round(u.x), y: Math.round(u.y), a: Math.round(u.angle * 100) / 100 });
    const ids = new Set([u.id, u.driver].filter(Boolean));
    for (const b of this.bullets) {
      if (!b.tid || !ids.has(b.tid) || dist2(b.x, b.y, u.x, u.y) > 1100 * 1100) continue;
      if (Math.random() < 0.72) {
        // decoyed: the seeker chases the flares, swerving off the aircraft's track
        b.tid = null;
        const sp = Math.hypot(b.vx, b.vy), a = Math.atan2(b.vy, b.vx) + (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.35);
        b.vx = Math.cos(a) * sp;
        b.vy = Math.sin(a) * sp;
        b.left = Math.min(b.left, 200);
        b.dud = true; // it will burst harmlessly among the flares
      }
    }
    return true;
  }

  stepUnit(u, dt) {
    if (u.ammoMax || u.flaresMax) this.rearm(u);
    if (u.driver) {
      const p = this.players.get(u.driver);
      if (!p || p.vehicle !== u.id) u.driver = null;
      else return; // the player's input drives it (stepPlayer)
    }
    if (u.motion) {
      if (u.carrier) this.followCarrier(u);
      if (u.motion.air) this.stepFlight(u, dt);
      if (!this.units.has(u.id)) return;
      if (!u.crewed) {
        // empty vehicle: no AI. Parked ones stay put; abandoned aircraft in the air go down.
        if (u.motion.air && u.fly > 0 && u.flight !== 'crash' && u.flight !== 'ground') u.flight = 'crash';
        this.drive(u, null, 0, dt);
        return;
      }
    }
    u.steered = false;
    this.stepUnitAI(u, dt);
    if (u.motion && !u.steered && this.units.has(u.id)) this.drive(u, u.motion.jet && u.fly > 0.02 ? u.angle : null, 0, dt);
  }

  stepUnitAI(u, dt) {
    if (u.sleepy && this.now >= u.sleepCheck) {
      u.sleepCheck = this.now + 1000 + Math.random() * 500;
      u.asleep = !this.nearAnyPlayer(u.x, u.y, WAKE_R) && !(u.grudge && this.now < u.grudgeUntil);
    }
    if (u.asleep) return;
    const w = this.weaponOf(u.weapon);
    u.cd -= dt * 1000;
    const k = u.kingdom >= 0 ? this.kingdoms[u.kingdom] : null;

    // healing: fast near friendly buildings (very fast near a hospital), slow elsewhere
    if (this.tickN % 15 === u.id % 15 && u.hp < u.maxHp) {
      let rate = 0.004;
      if (u.kingdom >= 0 || u.kingdom === NEUTRAL)
        this.queryBuildings(u.x, u.y, 260, (b) => {
          if (!this.allied(b.kingdom, u.kingdom)) return; // allied hospitals and bases heal too
          const d = Math.sqrt(dist2(u.x, u.y, b.x, b.y));
          const heal = this.bdef(b.type)?.heal;
          if (heal && d < heal) rate = Math.max(rate, 0.1);
          else if (d < 140) rate = Math.max(rate, 0.04);
        });
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * rate);
    }
    // supply trucks and ambulances patch up friendly troops (and rulers) around them
    if (u.supply && this.tickN % 30 === u.id % 30)
      this.query(u.x, u.y, 140, (e) => {
        if (e === u || e.hp <= 0 || e.hp >= e.maxHp || !this.allied(e.kingdom, u.kingdom)) return;
        if (e.cat === 'unit' || (e.cat === 'player' && !e.dead)) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.04);
      });
    if (u.traffic && u.mode === 'drive' && this.driveTraffic(u, dt)) return;
    if (u.hp < u.maxHp * 0.35 && !u.woundedBark && !u.civ) {
      u.woundedBark = true;
      if (Math.random() < 0.5) this.bark(u, 'wounded');
    }
    // aircraft carriers launch their own air wing
    if (u.launches && this.now >= u.nextLaunch && u.kingdom >= 0) {
      u.nextLaunch = this.now + (this.unitDef(u.def)?.launchEvery || 40000);
      u.launched = u.launched.filter((id) => this.units.has(id));
      if (u.launched.length < 4) {
        const j = this.spawnUnit(u.kingdom, pick(u.launches), u.x + Math.cos(u.angle) * 30, u.y + Math.sin(u.angle) * 30);
        if (j) {
          j.mode = 'guard';
          j.gx = u.x;
          j.gy = u.y;
          j.angle = u.angle;
          u.launched.push(j.id);
          this.effects.push({ k: 'hit', x: Math.round(j.x), y: Math.round(j.y), c: '#ffffff' });
        }
      } else for (const id of u.launched) {
        const j = this.units.get(id);
        if (j && j.mode === 'guard') (j.gx = u.x), (j.gy = u.y); // escort the carrier
      }
    }

    if (this.now >= u.think) {
      u.think = this.now + 250 + Math.random() * 200;
      // passive creatures and civilians run from danger
      if (u.flee) {
        const threat = this.nearestThreat(u, u.wild ? 150 : 200);
        if (threat && (!u.civ || !threat.passive)) {
          if (u.civ && u.fleeUntil < this.now && Math.random() < 0.15) this.bark(u, 'flee');
          u.fleeUntil = this.now + 2200;
          u.fleeFromX = threat.x;
          u.fleeFromY = threat.y;
        }
      }
      // wounded soldiers fall back to the nearest friendly building to heal
      if (k && !u.civ && w && !u.retreating && !u.moveOrder && (u.hp < u.maxHp * 0.3 || u.outnumbered) && u.mode !== 'attack' && !u.op) {
        if (u.outnumbered && Math.random() < 0.3) this.bark(u, 'wounded');
        u.outnumbered = false;
        let best = null, bd = Infinity;
        this.queryBuildings(u.x, u.y, 1500, (b) => {
          if (b.kingdom !== u.kingdom) return;
          const d = dist2(u.x, u.y, b.x, b.y);
          if (d < bd) (bd = d), (best = b);
        });
        if (best) u.retreating = { x: best.x + (Math.random() - 0.5) * 60, y: best.y + best.r + 20 };
      }
      if (u.retreating && u.hp > u.maxHp * 0.85) u.retreating = null;

      // marching orders: arrive first, then fight; patrols turn around at each end
      const arriveR = u.motion && u.motion.jet ? 140 : 40;
      if (u.moveOrder && Math.hypot(u.gx - u.x, u.gy - u.y) < arriveR) u.moveOrder = false;
      if (u.mode === 'patrol' && u.patrol && Math.hypot(u.gx - u.x, u.gy - u.y) < arriveR) {
        u.patrol.leg ^= 1;
        u.gx = u.patrol.leg ? u.patrol.bx : u.patrol.ax;
        u.gy = u.patrol.leg ? u.patrol.by : u.patrol.ay;
      }
      let enemy = null;
      if (u.moveOrder) u.grudge = null;
      if (u.grudge && this.now < u.grudgeUntil) {
        const g = this.getById(u.grudge);
        const gg = g && g.cat === 'player' && g.vehicle ? this.units.get(g.vehicle) : g;
        if (gg && this.alive(gg) && !this.allied(gg.kingdom, u.kingdom) && dist2(u.x, u.y, gg.x, gg.y) < 900 * 900) enemy = gg;
        else u.grudge = null;
      }
      if (!enemy && w && !u.passive && !u.moveOrder) {
        // bodyguards: punish whoever just hit our ruler
        if (k && u.mode === 'follow' && k.playerId) {
          const ruler = this.players.get(k.playerId);
          if (ruler && ruler.lastHitBy && this.now - ruler.lastHitAt < 5000) {
            const a = this.getById(ruler.lastHitBy);
            if (a && this.alive(a) && dist2(u.x, u.y, a.x, a.y) < 700 * 700) enemy = a;
          }
        }
        if (!enemy) {
          const aggro = u.wild ? 220 : Math.min(1500, Math.max(w.range + 140, 320));
          enemy = this.pickTarget(u, aggro, !u.wild && u.kingdom !== NEUTRAL);
        }
      }
      u.target = enemy ? enemy.id : null;
      if (enemy) enemy.focusT = this.now;
      // morale: badly outnumbered and hurt? fall back instead of dying for nothing
      if (enemy && k && !u.civ && !u.retreating && !u.moveOrder && !u.op && u.mode !== 'attack' && this.now >= (u.moraleAt || 0)) {
        u.moraleAt = this.now + 1500;
        if (u.hp < u.maxHp * 0.75) {
          const f = this.forceAt(u.x, u.y, 380, u.kingdom);
          if (f.foe > f.friend * 2.4 + 2) u.outnumbered = true;
        }
      }
      // crews look for an empty vehicle (own or abandoned) to man
      if (u.crew && !enemy && !u.boarding) {
        let best = null, bd = 700 * 700;
        this.query(u.x, u.y, 700, (e) => {
          if (e.cat !== 'unit' || !e.motion || e.crewed || e.driver || e.hp <= 0) return;
          if (e.kingdom !== u.kingdom && e.kingdom !== NEUTRAL) return;
          if ((u.noBoardUntil > this.now && e.id === u.lastVehicle) || e.standDownUntil > this.now) return;
          const d = dist2(u.x, u.y, e.x, e.y);
          if (d < bd) (bd = d), (best = e);
        });
        if (best) u.boarding = best.id;
      }
      if (enemy && !u.inCombat) {
        u.inCombat = true;
        if (Math.random() < 0.18) this.bark(u, u.kingdom === ALIEN ? 'battle' : 'battle');
      } else if (!enemy && u.inCombat) u.inCombat = false;
      else if (!enemy && Math.random() < 0.0025) this.bark(u, this.isNight() && Math.random() < 0.5 ? 'night' : 'idle');
      if (!enemy && !u.op && u.mode === 'attack' && dist2(u.x, u.y, u.gx, u.gy) < 90 * 90 && !this.townToTakeAt(u.gx, u.gy, u.kingdom)) {
        const b = this.nearestEnemyBuildingAnywhere(u);
        if (b) (u.gx = b.x), (u.gy = b.y);
        else u.mode = 'wander';
      }
      if (u.mode === 'wander' && (!u.wanderAt || this.now > u.wanderAt)) {
        u.wanderAt = this.now + 4000 + Math.random() * 5000;
        const home = u.home && this.buildings.get(u.home);
        const anchor = home || (u.town && this.buildings.get(this.towns.get(u.town)?.hallId)) || null;
        const ax = anchor ? anchor.x : u.x, ay = anchor ? anchor.y : u.y;
        const rad = anchor ? 140 : u.wild ? 400 : 300;
        u.gx = ax + (Math.random() - 0.5) * rad * 2;
        u.gy = ay + (Math.random() - 0.5) * rad * 2;
      }
    }

    if (u.fleeUntil > this.now) {
      const a = Math.atan2(u.y - u.fleeFromY, u.x - u.fleeFromX);
      this.steerToward(u, u.x + Math.cos(a) * 100, u.y + Math.sin(a) * 100, dt, 1.15);
      return;
    }
    if (u.retreating) {
      if (dist2(u.x, u.y, u.retreating.x, u.retreating.y) > 50 * 50) this.steerToward(u, u.retreating.x, u.retreating.y, dt, 1.1);
      return;
    }
    // crew walking to an empty vehicle and climbing in
    if (u.boarding && (!u.target || u.orderBoard)) {
      const v = this.units.get(u.boarding);
      const allowed = v && !v.crewed && !v.driver && this.canOperate(u, v) && (u.orderBoard || v.kingdom === u.kingdom || v.kingdom === NEUTRAL);
      const reachable = v && !(v.motion && v.motion.air && v.fly > 0.3);
      if (!allowed || !reachable) {
        if (u.orderBoard && v && v.crewed && v.kingdom === u.kingdom) this.sayTo(u, `${v.name} already has a crew, sire.`);
        u.boarding = null;
        u.orderBoard = false;
      } else if (Math.hypot(v.x - u.x, v.y - u.y) < v.r + 10) {
        const was = v.kingdom;
        v.crewed = true;
        v.kingdom = u.kingdom;
        v.mode = 'guard';
        v.gx = v.x;
        v.gy = v.y;
        v.sleepy = false;
        v.idleSince = this.now;
        v.crewName = u.name;
        v.personality = u.personality;
        v.chat = u.chat || [];
        if (u.mission) {
          // follow-up orders given together with "take the helicopter…"
          v.mode = u.mission.mode;
          if (u.mission.x != null) (v.gx = u.mission.x), (v.gy = u.mission.y);
          if (v.motion && v.motion.air && v.flight === 'ground') v.forceTakeoff = true;
        }
        if (was !== u.kingdom && was >= 0) this.broadcastEvent(`${u.name} stole ${v.name} from ${this.factionName(was).replace(/^the /, '')}!`);
        this.effects.push({ k: 'dust', x: Math.round(u.x), y: Math.round(u.y) });
        if (u.orderBoard) this.sayTo(v, pick(['Aboard and ready, my liege!', 'In the cockpit. Awaiting orders!', 'Engines on, ready to roll!', 'Crew aboard. Where to?']));
        this.removeUnit(u);
        return;
      } else return void this.steerToward(u, v.x, v.y, dt, 1.15);
    }
    if (u.motion && u.motion.air && this.aircraftAI(u, dt, w)) return;

    const t = u.target && this.getById(u.target);
    if (t && w && this.alive(t)) {
      const d = Math.sqrt(dist2(u.x, u.y, t.x, t.y));
      // jets: fixed forward guns, so dogfight: lead the target, make passes, fire when lined up
      if (u.motion && u.motion.jet) {
        const tt = (d / (w.speed || 700)) * 0.8;
        const lx = t.x + (t.motion ? Math.cos(t.angle) * t.spd * tt : 0), ly = t.y + (t.motion ? Math.sin(t.angle) * t.spd * tt : 0);
        const toT = Math.atan2(ly - u.y, lx - u.x);
        this.drive(u, d < 110 ? u.angle : toT, 1, dt, d > 600);
        const off = angDiff(toT, u.angle);
        u.aim = u.angle + Math.max(-0.12, Math.min(0.12, off));
        if (Math.abs(off) < 0.3 && d <= w.range + t.r && u.cd <= 0) {
          this.fire(u, w, u.x + Math.cos(u.aim) * 100, u.y + Math.sin(u.aim) * 100);
          u.cd = w.rate * (0.9 + Math.random() * 0.3);
        }
        if (u.alt && (u.altCd || 0) <= this.now && Math.abs(off) < 0.7 && (!u.ammoMax || u.ammo > 0)) {
          const aw = this.weaponOf(u.alt2 && !(t.motion && t.motion.air && t.fly > 0.3) ? u.alt2 : u.alt);
          if (d < (aw.range < 250 ? 80 : aw.range)) {
            this.fire(u, aw, t.x, t.y, t.id);
            u.altCd = this.now + aw.rate * 1.6;
            if (u.ammoMax) (u.ammo--, (u.rearmAt = Math.max(u.rearmAt || 0, this.now + 12000)));
          }
        }
        return;
      }
      const want = w.melee ? u.r + t.r + w.range * 0.5 : w.range * (w.range >= 900 ? 0.85 : 0.7); // artillery fights from max range
      if (d > want) this.steerToward(u, t.x, t.y, dt, u.domain === 'air' ? 1 : 1.05);
      else if (u.domain === 'air') this.steerToward(u, t.x + Math.cos(this.now / 600 + u.id) * 120, t.y + Math.sin(this.now / 600 + u.id) * 120, dt);
      else if (!u.motion && !w.melee && u.kingdom >= 0 && d > w.range * 0.3 && t.cat !== 'building') {
        // riflemen & archers sidestep while trading fire instead of standing still
        if (!u.strafeUntil || this.now > u.strafeUntil) (u.strafeDir = Math.random() < 0.5 ? -1 : 1), (u.strafeUntil = this.now + 1200 + Math.random() * 1600);
        const sa = Math.atan2(t.y - u.y, t.x - u.x) + (u.strafeDir * Math.PI) / 2;
        this.steerToward(u, u.x + Math.cos(sa) * 40, u.y + Math.sin(sa) * 40, dt, 0.4);
      } else if (!w.melee && d < w.range * 0.3 && t.cat !== 'building') {
        // kite: ranged units back away from enemies that get too close
        const a = Math.atan2(u.y - t.y, u.x - t.x);
        this.steerToward(u, u.x + Math.cos(a) * 60, u.y + Math.sin(a) * 60, dt, 0.8);
      }
      u.aim = Math.atan2(t.y - u.y, t.x - u.x);
      if (!u.motion) u.angle = u.aim;
      if (d <= w.range + t.r && u.cd <= 0) {
        this.fire(u, w, t.x, t.y, t.id);
        u.cd = w.rate * (0.9 + Math.random() * 0.3);
      }
      if (u.alt && u.domain === 'air' && (u.altCd || 0) <= this.now && (!u.ammoMax || u.ammo > 0)) {
        const aw = this.weaponOf(u.alt);
        if (d < (aw.range < 250 ? 70 : aw.range)) {
          this.fire(u, aw, t.x, t.y, t.id);
          u.altCd = this.now + aw.rate * 1.5;
          if (u.ammoMax) (u.ammo--, (u.rearmAt = Math.max(u.rearmAt || 0, this.now + 12000)));
        }
      }
      return;
    }
    u.target = null;
    let gx = u.gx, gy = u.gy, slack = 20;
    if (u.mode === 'follow') {
      const p = k && k.playerId && this.players.get(k.playerId);
      if (p && !p.dead) {
        const ring = 40 + (u.id % 4) * 16;
        gx = p.x + Math.cos(u.formation) * ring;
        gy = p.y + Math.sin(u.formation) * ring;
        slack = 26;
      }
      if (u.domain === 'water' || u.domain === 'air') slack = 90;
      else if (u.motion) slack = 55;
    }
    if (dist2(u.x, u.y, gx, gy) > slack * slack) this.steerToward(u, gx, gy, dt, u.mode === 'follow' ? 1.15 : u.mode === 'wander' ? 0.6 : 1);
    else if (u.domain === 'air') this.steerToward(u, gx + Math.cos(this.now / 900 + u.id) * 60, gy + Math.sin(this.now / 900 + u.id) * 60, dt, 0.5);
  }

  isRoad(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return false;
    const b = this.buildings.get(this.bTiles[ty * this.size + tx]);
    return !!b && b.type === 'road';
  }

  // city traffic: follow the road tiles, keep left (Indian roads), stop for whatever is in front
  driveTraffic(u, dt) {
    if (u.fleeUntil > this.now) return false; // panicking: the normal flee logic takes over
    const tx = Math.floor(u.x / TILE), ty = Math.floor(u.y / TILE);
    if (!u.nextT || Math.hypot(u.tgtX - u.x, u.tgtY - u.y) < 5) {
      if (!this.isRoad(tx, ty)) {
        let best = null;
        for (let r = 1; r <= 6 && !best; r++)
          for (let j = -r; j <= r && !best; j++)
            for (let i = -r; i <= r && !best; i++) if (this.isRoad(tx + i, ty + j)) best = [tx + i, ty + j];
        if (!best) return void (u.mode = 'wander'), false;
        u.nextT = best;
        u.dir = null;
      } else {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => this.isRoad(tx + dx, ty + dy));
        let opts = dirs.filter(([dx, dy]) => !u.prevT || tx + dx !== u.prevT[0] || ty + dy !== u.prevT[1]);
        if (!opts.length) opts = dirs; // dead end: turn around
        if (!opts.length) return void (u.mode = 'wander'), false;
        const straight = u.dir && opts.find(([dx, dy]) => dx === u.dir[0] && dy === u.dir[1]);
        const d = straight && Math.random() < 0.72 ? straight : opts[Math.floor(Math.random() * opts.length)];
        u.prevT = [tx, ty];
        u.dir = d;
        u.nextT = [tx + d[0], ty + d[1]];
      }
      const d = u.dir || [0, 0];
      u.tgtX = (u.nextT[0] + 0.5) * TILE + d[1] * 3.5;
      u.tgtY = (u.nextT[1] + 0.5) * TILE - d[0] * 3.5;
    }
    // brake for vehicles and people ahead
    const hx = Math.cos(u.angle), hy = Math.sin(u.angle);
    let blocked = false;
    this.query(u.x, u.y, 24, (e) => {
      if (blocked || e === u || (e.cat !== 'unit' && e.cat !== 'player') || (e.cat === 'player' && (e.dead || e.vehicle))) return;
      const dx = e.x - u.x, dy = e.y - u.y, dd = Math.hypot(dx, dy) || 1;
      const lateral = Math.abs(dx * hy - dy * hx); // oncoming traffic in the other lane doesn't count
      if (dd < u.r + (e.r || 6) + 8 && (dx * hx + dy * hy) / dd > 0.6 && lateral < 5) blocked = true;
    });
    u.steered = true;
    if (blocked) {
      u.blockedSince ||= this.now;
      // wait politely, then squeeze past (no gridlock)
      if (this.now - u.blockedSince < 2500) {
        this.drive(u, null, 0, dt);
        if (Math.random() < 0.002) this.bark(u, 'idle');
        return true;
      }
    } else u.blockedSince = 0;
    this.steerToward(u, u.tgtX, u.tgtY, dt, 0.65);
    return true;
  }

  stepBuilding(b) {
    const def = this.bdef(b.type);
    if (!def) return;
    const k = b.kingdom >= 0 ? this.kingdoms[b.kingdom] : null;
    if (def.weapon && this.now >= b.think) {
      b.think = this.now + (this.weaponOf(def.weapon).range > 1200 ? 1500 : 300);
      const w = this.weaponOf(def.weapon);
      const e = this.pickTarget({ x: b.x, y: b.y, kingdom: b.kingdom, weapon: w, role: w.antiAir ? 'aa' : null }, w.range, false);
      if (e && this.now >= b.cd) {
        this.fire(b, w, e.x, e.y, e.id);
        b.cd = this.now + w.rate;
      }
    }
    if (def.produces && k && k.bot && this.now >= b.nextSpawn) { // no auto-spawning for players
      b.nextSpawn = this.now + def.every;
      if (def.parked) return void this.parkAircraft(b, b.kingdom, pick(def.produces), true);
      const u = this.spawnUnit(b.kingdom, pick(def.produces), b.x, b.y + b.r + 10);
      if (u) (u.mode = 'guard'), (u.gx = u.x), (u.gy = u.y);
    }
    if (def.residents && b.kingdom !== WILD && this.now >= b.nextResident) {
      b.nextResident = this.now + 25000 + Math.random() * 15000;
      if (b.kingdom >= 0 || this.nearAnyPlayer(b.x, b.y, WAKE_R)) this.spawnResident(b);
    }
    if (b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.0004);
  }

  // ------------------------------------------------------------------ towns
  // last ruler standing wins: every other kingdom has lost its castle and all its towns
  checkVictory() {
    if (this.winner != null) return;
    const live = this.kingdoms.filter((k) => k && (k.castle || this.townsOf(k.id)));
    if (live.length !== 1 || this.kingdoms.filter(Boolean).length < 2) return;
    const k = live[0];
    this.winner = k.id;
    this.broadcast({ t: 'victory', kingdom: k.name, ruler: this.rulerName(k.id), color: k.color });
    this.broadcastEvent(`👑 ${this.rulerName(k.id)} of ${k.name} is the sole ruler of the world!`);
  }

  stepTowns() {
    this.checkVictory();
    for (const t of this.towns.values()) {
      const hall = this.buildings.get(t.hallId);
      if (!hall) continue;
      if (t.traffic && t.roads && t.roads.length) this.stepTraffic(t, hall);
      const attackers = new Map();
      let defenders = 0;
      this.query(hall.x, hall.y, 260, (e) => {
        if (e.hp <= 0 || (e.cat === 'unit' && (e.civ || e.passive))) return;
        if (this.allied(e.kingdom, t.kingdom)) return void defenders++;
        if (e.kingdom < 0) return;
        if (dist2(hall.x, hall.y, e.x, e.y) < 95 * 95) attackers.set(e.kingdom, (attackers.get(e.kingdom) || 0) + 1);
      });
      // a coalition storming a town together counts as one side; the biggest contingent takes it
      const sides = [...attackers.keys()];
      if (sides.length && defenders === 0 && sides.every((a) => this.allied(a, sides[0]))) {
        const kid = sides.reduce((a, b) => (attackers.get(b) > attackers.get(a) ? b : a));
        if (t.capturer !== kid) (t.capturer = kid), (t.progress = 0);
        t.progress++;
        this.townsDirty = true;
        if (t.progress >= 6) this.captureTown(t, kid);
      } else if (t.progress > 0) {
        t.progress--;
        if (!t.progress) t.capturer = null;
        this.townsDirty = true;
      }
    }
  }

  // keep a handful of autos, cars, buses and scooters on the streets of towns players can see
  stepTraffic(t, hall) {
    const near = this.nearAnyPlayer(hall.x, hall.y, WAKE_R);
    let n = 0;
    const mine = [];
    for (const u of this.units.values()) if (u.town === t.id && u.traffic) (n++), mine.push(u);
    if (near && n < t.traffic && Math.random() < 0.6) {
      const [rx, ry] = pick(t.roads);
      if (this.isRoad(rx, ry)) {
        const u = this.spawnUnit(t.kingdom, pick(TRAFFIC), (rx + 0.5) * TILE, (ry + 0.5) * TILE);
        if (u) {
          u.x = (rx + 0.5) * TILE;
          u.y = (ry + 0.5) * TILE;
          u.town = t.id;
          u.mode = 'drive';
          u.sleepy = false;
        }
      }
    } else if (!near && n && !this.nearAnyPlayer(hall.x, hall.y, WAKE_R * 1.5)) {
      for (const u of mine) if (!u.driver) this.removeUnit(u); // nobody around: clear the streets
    }
  }

  captureTown(t, kid) {
    const old = t.kingdom;
    t.kingdom = kid;
    t.progress = 0;
    t.capturer = null;
    for (const b of this.buildings.values()) if (b.townId === t.id) b.kingdom = kid;
    for (const u of this.units.values())
      if (u.town === t.id && u.kingdom === old) {
        u.kingdom = kid;
        u.sleepy = u.civ;
        if (!u.civ) (u.mode = 'guard'), (u.gx = u.x), (u.gy = u.y);
      }
    const hall = this.buildings.get(t.hallId);
    if (hall) this.query(hall.x, hall.y, 150, (e) => { if (e.cat === 'unit' && e.kingdom === kid && Math.random() < 0.5) this.bark(e, 'capture'); });
    this.buildingsDirty = true;
    this.townsDirty = true;
    this.kingdomsDirty = true;
    this.broadcastEvent(`🏘 ${this.factionName(kid).replace(/^the /, '')} captured the town of ${t.name}${old >= 0 ? ' from ' + this.factionName(old).replace(/^the /, '') : ''}!`);
  }

  // ------------------------------------------------------------------ wildlife & aliens
  stepWorld() {
    let wild = 0, aliens = 0;
    for (const u of this.units.values()) {
      if (u.kingdom === WILD) wild++;
      else if (u.kingdom === ALIEN) aliens++;
    }
    if (wild < this.wildTarget) this.populateWildlife(Math.min(6, this.wildTarget - wild));
    if (this.now >= this.nextInvasion) {
      this.nextInvasion = this.now + (5 + Math.random() * 3) * 60000;
      if (aliens < 60) this.alienInvasion();
    }
  }

  alienInvasion() {
    const targets = this.kingdoms.filter((k) => k && k.castle);
    if (!targets.length) return;
    const k = pick(targets);
    const c = this.buildings.get(k.castle);
    const a = Math.random() * Math.PI * 2;
    const land = nearestTile(this.map, Math.round(c.tx + Math.cos(a) * 45), Math.round(c.ty + Math.sin(a) * 45), 30, (t) => t >= T.SAND && t < T.MOUNTAIN);
    if (!land) return;
    const x = (land.tx + 0.5) * TILE, y = (land.ty + 0.5) * TILE;
    const minutes = (this.now - this.started) / 60000;
    const troopers = Math.min(14, 5 + Math.floor(minutes / 4));
    const ufos = Math.min(5, 2 + Math.floor(minutes / 12));
    for (let i = 0; i < ufos + troopers; i++) {
      const u = this.spawnUnit(ALIEN, i < ufos ? 'ufo' : 'alien', x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 120);
      if (u) (u.mode = 'attack'), (u.gx = c.x), (u.gy = c.y);
      if (u && i === ufos) setTimeout(() => this.units.has(u.id) && this.bark(u, 'invade'), 1500);
    }
    this.lastAlienSighting = this.now;
    this.effects.push({ k: 'boom', x, y, r: 60 });
    this.broadcast({ t: 'alert', text: `👽 ALIEN INVASION! UFOs are landing near the Kingdom of ${k.name}!`, x, y });
  }

  // ------------------------------------------------------------------ direct orders to selected units
  sayTo(u, text) {
    this.broadcast({ t: 'say', id: u.id, name: u.crewName ? `${u.crewName} (${u.name})` : u.name, text, k: u.kingdom });
    (u.chat ||= []).push({ who: 'npc', text });
    if (u.chat.length > 12) u.chat.shift();
  }

  // empty vehicle matching words like "helicopter" / "f-16" / "tank" near (x, y) that `u` can operate
  findEmptyVehicle(u, x, y, word, maxD = 1400, anySkill = false) {
    const frag = word ? this.vehicleFragments(word) : null;
    let best = null, bd = maxD * maxD;
    for (const v of this.units.values()) {
      if (!v.motion || v.crewed || v.driver || v.hp <= 0) continue;
      if (v.motion.air && v.fly > 0.3) continue;
      if (!anySkill && !this.canOperate(u, v)) continue;
      const name = (this.unitDef(v.def)?.name || '').toLowerCase();
      if (frag && !frag.some((f) => name.includes(f))) continue;
      const d = dist2(x, y, v.x, v.y);
      if (d < bd) (bd = d), (best = v);
    }
    return best;
  }

  vehicleFragments(word) {
    word = String(word).toLowerCase().trim();
    for (const [words, frags] of VEHICLE_WORDS) if (new RegExp(`\\b(${words})\\b`).test(word)) return frags.split('|');
    return [word];
  }

  // order = move | attack | follow | guard | wander | board | dismount | land | takeoff
  applyOrder(p, units, order, msg = {}) {
    const S = this.size * TILE;
    const x = clampNum(msg.x ?? p.x, 0, S), y = clampNum(msg.y ?? p.y, 0, S);
    const tgt = msg.target ? this.getById(msg.target) : null;
    const reset = (u) => {
      u.retreating = null;
      u.boarding = null;
      u.orderBoard = false;
      u.app = null;
      u.landOrder = false;
      u.moveOrder = false;
      u.patrol = null;
      u.idleSince = this.now;
    };
    let n = 0;
    for (const u of units) this.leaveOp(u);
    units.forEach((u, i) => {
      const veh = u.kind === 'vehicle' && u.motion;
      if (veh && !u.crewed && !['board'].includes(order)) return; // empty vehicles can't take orders
      switch (order) {
        case 'move': {
          reset(u);
          u.mode = 'guard';
          u.target = null;
          u.grudge = null;
          const a = i * 2.4, r = 16 * Math.sqrt(i);
          u.gx = x + Math.cos(a) * r;
          u.gy = y + Math.sin(a) * r;
          u.moveOrder = true; // marching: don't get distracted until we arrive
          if (veh && u.motion.air && u.flight === 'ground' && Math.hypot(u.gx - u.x, u.gy - u.y) > 300) u.forceTakeoff = true;
          n++;
          break;
        }
        case 'attack':
          reset(u);
          u.mode = 'attack';
          if (tgt && tgt.kingdom !== u.kingdom && this.alive(tgt.cat === 'player' && tgt.vehicle ? this.units.get(tgt.vehicle) : tgt)) {
            u.grudge = tgt.id;
            u.grudgeUntil = this.now + 60000;
            (u.gx = tgt.x), (u.gy = tgt.y);
          } else (u.gx = x + (Math.random() - 0.5) * 60), (u.gy = y + (Math.random() - 0.5) * 60);
          n++;
          break;
        case 'patrol': {
          reset(u);
          u.mode = 'patrol';
          u.target = null;
          const a = i * 2.4, r = 16 * Math.sqrt(i);
          u.patrol = { ax: u.x, ay: u.y, bx: x + Math.cos(a) * r, by: y + Math.sin(a) * r, leg: 1 };
          u.gx = u.patrol.bx;
          u.gy = u.patrol.by;
          if (veh && u.motion.air && u.flight === 'ground') u.forceTakeoff = true;
          n++;
          break;
        }
        case 'follow':
        case 'guard':
        case 'wander':
          if (u.civ && order === 'guard') return;
          reset(u);
          u.mode = order;
          if (order === 'guard') (u.gx = u.x), (u.gy = u.y);
          n++;
          break;
        case 'board': {
          if (veh || u.civ) return;
          const v = tgt && tgt.cat === 'unit' && tgt.motion ? tgt : (this.findEmptyVehicle(u, x, y, msg.vehicle, msg.vehicle ? 1600 : 260) || this.findEmptyVehicle(u, x, y, msg.vehicle, msg.vehicle ? 1600 : 260, true));
          if (!v || v.crewed || v.driver) return void (i === 0 && this.sayTo(u, msg.vehicle ? `I can't see an empty ${msg.vehicle} anywhere near, sire.` : 'There is no empty vehicle there, sire.'));
          if (!this.canOperate(u, v)) return void this.sayTo(u, v.motion.air ? "I'm no pilot, sire. Send a Pilot to fly that!" : "I can't operate that.");
          if (units.some((o) => o !== u && o.boarding === v.id)) return;
          reset(u);
          u.boarding = v.id;
          u.orderBoard = true;
          u.mission = msg.mission || null;
          u.target = null;
          n++;
          break;
        }
        case 'dismount':
          if (!veh) return;
          if (u.motion.air && u.fly > 0.05) {
            u.forceLand = true;
            u.dismountAfter = true;
            this.sayTo(u, 'Landing first, then we hop out.');
          } else if (!this.dismountCrew(u)) return void this.sayTo(u, "We can't get out here: we're at sea!");
          n++;
          break;
        case 'land':
          if (!veh || !u.motion.air) return;
          if (u.flight === 'air' || u.flight === 'takeoff') (u.forceLand = true), (u.app = null), (u.target = null), n++;
          break;
        case 'takeoff':
          if (!veh || !u.motion.air) return;
          if (u.flight === 'ground') (u.forceTakeoff = true), (u.mode = 'guard'), (u.gx = u.x), (u.gy = u.y), n++;
          break;
      }
    });
    return n;
  }

  // turn a parsed spoken order into a concrete plan against the world
  resolveIntent(p, u, it, msg = {}) {
    const k = this.kingdoms[p.kingdom];
    const text = it.text;
    const cmd = it.command;
    const isVeh = !!u.motion;
    const name = (x) => x.name || this.unitDef(x.def)?.name || 'the enemy';
    // the whole army, or just this one
    const group = it.everyone && !['board', 'land', 'takeoff', 'dismount'].includes(cmd) ? [...this.units.values()].filter((x) => x.kingdom === p.kingdom && !x.driver && !x.civ && (!x.motion || x.crewed) && !(x.motion && x.motion.air && x.flight === 'ground' && cmd === 'follow')) : [u];
    const who = group.length > 1 ? `everyone (${group.length} units)` : 'you';
    // where? named town / kingdom / place / "there" / "here"
    const town = [...this.towns.values()].find((t) => text.includes(' ' + t.name.toLowerCase().split(' ')[0] + ' '));
    const rival = this.kingdoms.find((o) => o && o.id !== p.kingdom && text.includes(' ' + o.name.toLowerCase() + ' '));
    const nearestOwn = (types) => {
      let best = null, bd = Infinity;
      for (const b of this.buildings.values()) {
        if (b.kingdom !== p.kingdom || !types.includes(b.type)) continue;
        const d = dist2(u.x, u.y, b.x, b.y);
        if (d < bd) (bd = d), (best = b);
      }
      return best;
    };
    const placeTypes = { castle: ['castle'], airport: ['airport', 'airbase'], base: ['radar', 'bunker', 'barracks', 'factory'], hospital: ['hospital', 'castle'], harbor: ['harbor', 'shipyard'], helipad: ['helipad'] };
    let pt = null, ptName = '';
    if (town) {
      const h = this.buildings.get(town.hallId);
      if (h) (pt = { x: h.x, y: h.y }), (ptName = `the town of ${town.name}`);
    }
    if (!pt && rival) {
      const c = rival.castle && this.buildings.get(rival.castle);
      const rp = rival.playerId && this.players.get(rival.playerId);
      const tgt = c || rp;
      if (tgt) (pt = { x: tgt.x, y: tgt.y, id: tgt.id }), (ptName = `the Kingdom of ${rival.name}${c ? "'s castle" : ''}`);
    }
    if (!pt && it.place) {
      const b = nearestOwn(placeTypes[it.place] || []);
      if (b) (pt = { x: b.x, y: b.y + b.r + 12 }), (ptName = `our ${it.place === 'base' ? 'military base' : this.bdef(b.type)?.name.toLowerCase() || it.place}`);
    }
    if (!pt && it.there) (pt = { x: p.input.ax, y: p.input.ay }), (ptName = 'the spot you pointed at');
    if (!pt && it.here) (pt = { x: p.x, y: p.y }), (ptName = 'your position');
    const out = (desc, apply, extra = {}) => ({ desc, apply, count: group.length, ...extra });
    const fail = (why) => ({ fail: why, count: 0 });
    if (u.civ && !['follow', 'wander', 'none', 'move', 'retreat'].includes(cmd)) return fail('I am a civilian, not a soldier');
    switch (cmd) {
      case 'none':
        return { count: 0 };
      case 'follow':
        return out(`follow and protect ${p.name}${group.length > 1 ? ', with the whole army' : ''}`, () => this.applyOrder(p, group, 'follow'));
      case 'wander':
        return out('stand down and relax nearby', () => this.applyOrder(p, group, 'wander'));
      case 'guard':
        if (pt) return out(`go to ${ptName} and hold it`, () => this.applyOrder(p, group, 'move', { x: pt.x, y: pt.y }));
        return out('hold this position', () => this.applyOrder(p, group, 'guard'));
      case 'defend': {
        const d = pt || (k.castle && this.buildings.get(k.castle)) || null;
        if (!d) return fail('there is nothing of ours there to defend');
        return out(`defend ${pt ? ptName : 'the castle'}`, () => this.applyOrder(p, group, 'move', { x: d.x, y: d.y + (d.r || 0) + 12 }));
      }
      case 'move':
        if (!pt) return fail('you did not say where to go (point at a spot and say "go there", or name a place)');
        return out(`go to ${ptName}`, () => this.applyOrder(p, group, 'move', { x: pt.x, y: pt.y }));
      case 'retreat': {
        const safe = nearestOwn(['hospital']) || (k.castle && this.buildings.get(k.castle)) || nearestOwn(['barracks', 'townhall']);
        if (!safe) return fail('we have nowhere safe left to retreat to');
        return out(`retreat to our ${this.bdef(safe.type)?.name.toLowerCase()} and recover`, () => this.applyOrder(p, group, 'move', { x: safe.x, y: safe.y + safe.r + 14 }));
      }
      case 'attack': {
        let tgt = null;
        if (it.there) tgt = this.pickTarget({ x: p.input.ax, y: p.input.ay, kingdom: p.kingdom, weapon: null }, 220, true);
        if (!tgt && pt && pt.id) tgt = this.getById(pt.id);
        if (!tgt && !pt) tgt = this.pickTarget(u, 1600, true) || this.nearestEnemyBuildingAnywhere(u);
        const tx = tgt ? tgt.x : pt ? pt.x : null, ty = tgt ? tgt.y : pt ? pt.y : null;
        if (tx == null) return fail('I see no enemy to attack');
        return out(`attack ${tgt ? name(tgt) : ptName}`, () => this.applyOrder(p, group, 'attack', { x: tx, y: ty, target: tgt ? tgt.id : null }));
      }
      case 'capture': {
        let tt = town;
        if (!tt) {
          let bd = Infinity;
          for (const t of this.towns.values()) {
            if (t.kingdom === p.kingdom) continue;
            const h = this.buildings.get(t.hallId);
            if (!h) continue;
            const d = dist2(u.x, u.y, h.x, h.y);
            if (d < bd) (bd = d), (tt = t);
          }
        }
        const h = tt && this.buildings.get(tt.hallId);
        if (!h) return fail('there is no town left to capture');
        if (tt.kingdom === p.kingdom) return fail(`${tt.name} is already ours`);
        return out(`march on ${tt.name} and capture its town hall`, () => this.applyOrder(p, group, 'attack', { x: h.x, y: h.y }));
      }
      case 'patrol': {
        const b = pt || { x: u.x + Math.cos(p.angle) * 350, y: u.y + Math.sin(p.angle) * 350 };
        return out(`patrol between here and ${pt ? ptName : 'the area ahead'}`, () => this.applyOrder(p, group, 'patrol', { x: b.x, y: b.y }));
      }
      case 'board': {
        if (isVeh) return fail('I am already crewing a vehicle');
        const v = this.findEmptyVehicle(u, u.x, u.y, it.vehicle, 1600) || this.findEmptyVehicle(u, u.x, u.y, it.vehicle, 1600, true);
        if (!v) return fail(it.vehicle ? `I can't see an empty ${it.vehicle} anywhere near` : 'there is no empty vehicle nearby');
        if (!this.canOperate(u, v)) return fail(`I am no pilot, so I cannot fly the ${this.unitDef(v.def)?.name}. Send a Pilot`);
        // follow-up mission said in the same breath: "take the jet and bomb Ashvale"
        let mission = null;
        if (/\b(attack|bomb|strike|destroy|hunt|kill|raid|fight)\b/.test(text)) {
          const tg = (pt && (pt.id ? this.getById(pt.id) : pt)) || this.nearestEnemyBuildingAnywhere(u);
          if (tg) mission = { mode: 'attack', x: tg.x, y: tg.y };
        } else if (/\b(follow|escort|cover me|protect me)\b/.test(text)) mission = { mode: 'follow' };
        else if (pt) mission = { mode: 'guard', x: pt.x, y: pt.y };
        const vn = this.unitDef(v.def)?.name;
        return out(`run to the empty ${vn} and take it${mission ? (mission.mode === 'attack' ? `, then go attack ${ptName || 'the enemy'}` : mission.mode === 'follow' ? ', then escort you' : `, then head to ${ptName}`) : ''}`, () => this.applyOrder(p, [u], 'board', { target: v.id, mission }), { vehicleId: v.id });
      }
      case 'land':
      case 'takeoff':
      case 'dismount': {
        if (!isVeh) return fail('I am not in a vehicle right now');
        if ((cmd === 'land' || cmd === 'takeoff') && !u.motion.air) return fail('this is not an aircraft');
        if (cmd === 'dismount' && u.motion.ship && !this.exitSpot(u)) return fail('we are at sea, too far from shore to get out');
        const d = { land: u.motion.heli ? 'set down right here' : 'fly the approach and land on the nearest runway', takeoff: 'take off', dismount: u.motion.air && u.fly > 0.05 ? 'land first, then climb out' : 'climb out of the vehicle' }[cmd];
        return out(d, () => this.applyOrder(p, [u], cmd));
      }
    }
    return { count: 0 };
  }

  inspect(p, id) {
    const u = this.units.get(id);
    if (!u) return this.send(p.ws, { t: 'inspect', id, gone: true });
    const def = this.unitDef(u.def);
    const t = u.target && this.getById(u.target);
    const b = u.boarding && this.units.get(u.boarding);
    const doing = u.boarding && b ? `heading to board ${b.name}` : u.app ? 'on landing approach' : u.retreating ? 'falling back to heal' : t ? `fighting ${t.name || this.unitDef(t.def)?.name || 'an enemy'}` : u.flight === 'ground' && u.motion?.air ? 'parked' : { follow: 'following you', guard: 'holding position', attack: 'on the attack', wander: 'at ease' }[u.mode] || u.mode;
    this.send(p.ws, {
      t: 'inspect',
      id,
      own: u.kingdom === p.kingdom,
      name: u.crewName ? `${u.crewName} · ${u.name}` : u.name,
      type: def?.name || '?',
      group: def?.group || '',
      hp: Math.ceil(u.hp),
      maxHp: u.maxHp,
      doing,
      vehicle: !!u.motion,
      air: !!u.motion?.air,
      crewed: !!u.crewed,
      flight: u.flight,
      canFly: !!u.crew,
      soldier: def?.group === 'Soldiers',
      civ: u.civ,
      personality: u.personality,
      chat: (u.chat || []).slice(-8),
    });
  }

  // ------------------------------------------------------------------ living NPCs (AI chatter)
  isNight() {
    const tod = ((this.now - this.started) / DAY_MS + 0.33) % 1;
    return tod < 0.23 || tod > 0.8;
  }

  roleOf(u) {
    if (u.kingdom === WILD || (u.passive && !u.civ)) return null; // animals & horses don't talk
    if (u.kingdom === ALIEN) return 'alien';
    if (u.civ) return 'civilian';
    if (u.kingdom === NEUTRAL) return 'militia';
    if (u.kind === 'vehicle' && !u.mount) return u.domain === 'air' ? 'pilot' : u.domain === 'water' ? 'sailor' : 'tanker';
    return 'soldier';
  }

  // a unit says a line from the AI bark bank (only if a player is close enough to see it)
  bark(u, situation) {
    const role = this.roleOf(u);
    if (!role || this.now - this.lastBarkAt < 1100 || this.now - u.lastBark < 14000) return;
    if (!this.nearAnyPlayer(u.x, u.y, 900)) return;
    const key = role + ':' + situation;
    let pool = this.barkBank.get(key);
    if (!pool || !pool.length) {
      pool = this.barkBank.get(role + ':idle');
      if (!pool || !pool.length) return;
      if (!this.barkBank.has(key)) this.barkBank.set(key, []); // ask the AI to fill this one next
    }
    u.lastBark = this.now;
    this.lastBarkAt = this.now;
    this.broadcast({ t: 'say', id: u.id, name: u.name, text: pick(pool), k: u.kingdom, bark: 1 });
  }

  async refreshBarks() {
    const local = aiStatus() === 'local' || aiStatus() === 'claude';
    this.nextBarkRefresh = this.now + (local ? 45000 : 150000);
    if (this.chatterBusy || aiStatus() === 'offline' || !this.players.size) return;
    // stalest first; among equals, the lines players hear most often (soldiers in battle, idle townsfolk...)
    const all = [];
    for (const s of ['battle', 'idle', 'victory', 'wounded', 'flee', 'night', 'march', 'capture', 'invade'])
      for (const r of ['soldier', 'civilian', 'pilot', 'tanker', 'sailor', 'militia', 'alien']) if (BARK_ROLES[r] && BARK_SITUATIONS[s]) all.push(r + ':' + s);
    all.sort((a, b) => (this.barkFresh.get(a) || 0) - (this.barkFresh.get(b) || 0));
    const keys = all.slice(0, local ? 10 : 6);
    this.chatterBusy = true;
    const got = await barkBatch(keys);
    this.chatterBusy = false;
    if (this.closed) return;
    for (const k of keys) this.barkFresh.set(k, this.now);
    for (const [k, lines] of Object.entries(got)) {
      // the first AI lines for a key replace the canned fallback lines entirely
      const pool = this.aiBarkKeys.has(k) ? this.barkBank.get(k) || [] : [];
      this.aiBarkKeys.add(k);
      pool.push(...lines);
      this.barkBank.set(k, pool.slice(-14));
    }
  }

  // two NPCs near a player hold a short AI-written conversation
  async startDialogue() {
    const local = aiStatus() === 'local' || aiStatus() === 'claude';
    this.nextDialogue = this.now + (local ? 35000 : 110000) + Math.random() * 30000;
    if (this.chatterBusy || aiStatus() === 'offline') return;
    const players = [...this.players.values()].filter((p) => !p.dead);
    if (!players.length) return;
    const p = pick(players);
    const near = [];
    this.query(p.x, p.y, 380, (e) => {
      if (e.cat === 'unit' && this.roleOf(e) && !e.driver && !e.target && e.kingdom !== ALIEN) near.push(e);
    });
    if (near.length < 2) return;
    const a = pick(near);
    const others = near.filter((e) => e !== a && e.kingdom === a.kingdom && dist2(e.x, e.y, a.x, a.y) < 220 * 220);
    if (!others.length) return;
    const b = pick(others);
    const k = a.kingdom >= 0 ? this.kingdoms[a.kingdom] : null;
    const situation = [
      k ? `They serve the Kingdom of ${k.name}, ruled by ${this.players.get(k.playerId)?.name || 'an AI regent'}.` : `They live in a free town.`,
      this.isNight() ? 'It is night.' : 'It is daytime.',
      this.now - this.lastAlienSighting < 300000 ? 'Aliens recently invaded.' : '',
      a.mode === 'follow' ? 'They are escorting their ruler.' : a.mode === 'guard' ? 'They are on guard duty.' : '',
      `Rival kingdoms: ${this.kingdoms.filter((o) => o && o.id !== a.kingdom).map((o) => o.name).join(', ')}.`,
    ].join(' ');
    const desc = (u) => ({ name: u.name, type: this.unitDef(u.def)?.name || 'soldier', personality: u.personality });
    this.chatterBusy = true;
    const lines = await npcDialogue(desc(a), desc(b), situation);
    this.chatterBusy = false;
    if (this.closed) return;
    lines.forEach((l, i) => {
      setTimeout(() => {
        const u = this.units.get(l.speaker ? b.id : a.id);
        if (u && !this.closed) this.broadcast({ t: 'say', id: u.id, name: u.name, text: l.text, k: u.kingdom, bark: 1, chat: 1 });
      }, i * 3800);
    });
  }

  stepChatter() {
    if (this.now >= this.nextBarkRefresh) this.refreshBarks();
    else if (this.now >= this.nextDialogue) this.startDialogue();
  }

  // ------------------------------------------------------------------ AI regents
  stepBot(k) {
    if (!k.bot) return;
    if (this.now >= k.nextPlan && !k.planning) this.askRegent(k);
    if (this.now < k.botThink) return;
    k.botThink = this.now + 6000 + Math.random() * 3000;
    const sp = k.spawn;
    if (!k.castle) {
      if (this.now - k.castleLostAt > 90000) this.placeBuilding(k.id, 'castle', sp.tx - 1, sp.ty - 1);
      return;
    }
    const mine = [...this.units.values()].filter((u) => u.kingdom === k.id && !u.civ);
    const c = this.buildings.get(k.castle);
    const plan = k.plan;
    // recruit: the regent's plan first, otherwise whatever counters the enemies' army mix
    if (mine.length < 40) {
      const key = plan && plan.recruit.length ? plan.recruit.shift() : this.counterPick(k);
      this.spawnUnit(k.id, key, c.x, c.y + 40);
    }
    // build: AA sites when enemy air is strong, otherwise the regent's plan or a balanced base
    const owned = [...this.buildings.values()].filter((b) => b.kingdom === k.id && !b.townId).length;
    if (owned < 26 && Math.random() < 0.6) {
      let foeAir = 0, foeAll = 0;
      for (const [kid, I] of this.intel) if (!(kid >= 0 && this.allied(kid, k.id))) (foeAir += I.air), (foeAll += I.power);
      const type = plan && plan.build.length ? plan.build.shift() : foeAll && foeAir / foeAll > 0.3 && Math.random() < 0.5 ? 'samsite' : pick(['tower', 'tower', 'house', 'barracks', 'factory', 'airbase', 'helipad', 'wall', 'harbor', 'shipyard', 'stable', 'farm', 'samsite', 'bunker', 'radar', 'hospital', 'church', 'lighthouse']);
      this.tryPlaceNear(k.id, type, sp.tx, sp.ty, 4, 14);
    }
    // strategy: defence, strikes and expansion are planned as operations by the war council
    this.warCouncil(k, mine, c, plan);
  }
  async askRegent(k) {
    k.planning = true;
    k.nextPlan = this.now + 150000 + Math.random() * 90000;
    const mine = [...this.units.values()].filter((u) => u.kingdom === k.id);
    const c = k.castle && this.buildings.get(k.castle);
    const kl = this.kingdomList();
    const plan = await regentPlan({
      name: k.name,
      units: mine.filter((u) => !u.civ).length,
      civilians: mine.filter((u) => u.civ).length,
      buildings: [...this.buildings.values()].filter((b) => b.kingdom === k.id).length,
      towns: [...this.towns.values()].filter((t) => t.kingdom === k.id).length,
      castleHp: c ? Math.round((c.hp / c.maxHp) * 100) : 0,
      underAttack: this.now - k.lastHit < 30000,
      aliens: this.now - this.lastAlienSighting < 300000,
      allies: kl.filter((o) => o.id !== k.id && this.allied(o.id, k.id)).map((o) => o.name).join(', ') || 'none',
      rivals: kl.filter((o) => !this.allied(o.id, k.id)).map((o) => `${o.name} (ruled by ${o.ruler}, ${o.units} units, ${o.towns} towns, castle ${o.castle ? 'standing' : 'destroyed'})`).join('; '),
      freeTowns: [...this.towns.values()].filter((t) => t.kingdom === NEUTRAL).length,
    });
    k.planning = false;
    if (this.closed || !plan || !k.bot) return;
    k.plan = plan;
    if (plan.speech) this.broadcast({ t: 'event', text: `👑 Regent of ${k.name}: “${plan.speech}”` });
    if (plan.strategy === 'attack') k.nextWave = Math.min(k.nextWave, this.now + 5000);
  }

  // ------------------------------------------------------------------ main loop
  step() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.now) / 1000);
    this.now = now;
    this.tickN++;
    this.pathBudget = 12; // A* searches allowed this tick
    this.rebuildGrid();
    for (const p of this.players.values()) this.stepPlayer(p, dt);
    for (const u of [...this.units.values()]) if (this.units.has(u.id)) this.stepUnit(u, dt);
    for (const b of [...this.buildings.values()]) if (this.buildings.has(b.id)) this.stepBuilding(b);
    for (const k of this.kingdoms) if (k) this.stepBot(k);
    this.stepBullets(dt);
    if (this.tickN % 30 === 0) this.stepTowns();
    if (this.tickN % 150 === 0) this.stepWorld();
    if (this.tickN % 60 === 30) this.stepChatter();
    if (this.tickN % 3 !== 0) this.sendSnapshots(); // 20 snapshots / s
    if (this.buildingsDirty) {
      this.buildingsDirty = false;
      this.broadcast({ t: 'buildings', list: this.buildingList() });
    }
    if (this.townsDirty && this.tickN % 15 === 0) {
      this.townsDirty = false;
      this.broadcast({ t: 'towns', list: this.townList() });
    }
    if (this.kingdomsDirty && this.tickN % 15 === 0) {
      this.kingdomsDirty = false;
      this.broadcast({ t: 'kingdoms', list: this.kingdomList() });
    }
    if (this.tickN % 30 === 0) this.sendMinimap();
    if (this.tickN % 90 === 45) this.gatherIntel();
    if (this.tickN % 30 === 15) this.stepOps();
    if (this.tickN % 30 === 20) this.sendJmc();
    if (this.tickN % 300 === 150) this.stepDiplomacy();
  }

  sendSnapshots() {
    const fx = this.effects;
    this.effects = [];
    if (!this.players.size) return;
    for (const p of this.players.values()) {
      const veh = p.vehicle && this.units.get(p.vehicle);
      const cx = veh ? veh.x : p.x, cy = veh ? veh.y : p.y;
      const VR = p.viewR || VIEW_R;
      const r2 = VR * VR;
      const pl = [];
      for (const o of this.players.values()) {
        if (o.vehicle || dist2(cx, cy, o.x, o.y) > r2) continue;
        pl.push([o.id, Math.round(o.x), Math.round(o.y), Math.round(o.angle * 100), Math.ceil(o.hp), o.maxHp, o.kingdom, o.dead ? 1 : 0, o.name, o.weapons[o.wi]]);
      }
      const us = [];
      this.query(cx, cy, VR, (u) => {
        if (u.cat !== 'unit') return;
        us.push([u.id, u.def, Math.round(u.x * 10) / 10, Math.round(u.y * 10) / 10, Math.round(u.angle * 100), Math.ceil(u.hp), u.maxHp, u.kingdom, (u.driver ? 1 : 0) | (u.crewed ? 2 : 0), Math.round((u.aim ?? u.angle) * 100), Math.round(u.fly * 100), Math.round(u.bank * 100), Math.round(u.spd), u.driver ? this.players.get(u.driver)?.name || '' : 0, u.ammoMax ? u.ammo : -1]);
      });
      // a driven vehicle isn't in the player list; make sure our own ride is always included
      if (veh && !us.some((x) => x[0] === veh.id)) us.push([veh.id, veh.def, Math.round(veh.x * 10) / 10, Math.round(veh.y * 10) / 10, Math.round(veh.angle * 100), Math.ceil(veh.hp), veh.maxHp, veh.kingdom, 1, Math.round((veh.aim ?? veh.angle) * 100), Math.round(veh.fly * 100), Math.round(veh.bank * 100), Math.round(veh.spd), p.name, veh.ammoMax ? veh.ammo : -1]);
      const bs = [];
      for (const b of this.bullets) {
        if (dist2(cx, cy, b.x, b.y) > r2) continue;
        bs.push([Math.round(b.x), Math.round(b.y), Math.round(b.vx), Math.round(b.vy), b.color, b.size, b.mk || 0]);
      }
      const bhp = [];
      this.queryBuildings(cx, cy, VR, (b) => {
        if (b.hp < b.maxHp) bhp.push([b.id, Math.ceil(b.hp)]);
      });
      const ef = fx.filter((e) => dist2(cx, cy, e.x, e.y) < r2);
      this.send(p.ws, {
        t: 's',
        ts: this.now, // server time of this snapshot: clients time motion by it, not by bursty arrival
        p: pl,
        u: us,
        b: bs,
        bh: bhp,
        fx: ef,
        me: { hp: Math.ceil(p.hp), maxHp: p.maxHp, dead: p.dead, respawn: p.dead ? Math.max(0, p.respawnAt - this.now) : 0, wi: p.wi, weapons: p.weapons, vehicle: p.vehicle, x: Math.round(cx), y: Math.round(cy), veh: veh ? { spd: Math.round(Math.abs(veh.spd)), max: veh.speed, fly: Math.round(veh.fly * 100), flight: veh.flight, ammo: veh.ammo, ammoMax: veh.ammoMax, flares: veh.flares, alt: veh.alt, alt2: veh.alt2, runway: veh.motion?.air ? !!this.runwayAt(veh.x + Math.cos(veh.angle) * 40, veh.y + Math.sin(veh.angle) * 40, !veh.motion.heli) : false } : null },
      });
    }
  }

  sendMinimap() {
    if (!this.players.size) return;
    const pts = [];
    for (const u of this.units.values()) if (u.kingdom >= 0 ? !u.civ : u.kingdom === ALIEN) pts.push(Math.round(u.x / TILE), Math.round(u.y / TILE), u.kingdom);
    const pl = [];
    for (const p of this.players.values()) if (!p.dead) pl.push(p.id, Math.round(p.x / TILE), Math.round(p.y / TILE), p.kingdom);
    this.broadcast({ t: 'mm', u: pts, p: pl });
  }

  // ------------------------------------------------------------------ messages from clients
  async handle(p, msg) {
    const k = this.kingdoms[p.kingdom];
    switch (msg.t) {
      case 'in': {
        const i = p.input;
        i.mx = clampNum(msg.mx, -1, 1);
        i.my = clampNum(msg.my, -1, 1);
        i.ax = clampNum(msg.ax, -1e6, 1e6);
        i.ay = clampNum(msg.ay, -1e6, 1e6);
        i.fire = !!msg.f;
        i.alt = !!msg.a;
        i.sprint = !!msg.s;
        // stream a bigger area when the player zooms out (bounded so bandwidth stays sane)
        if (msg.vw) p.viewR = clampNum(Math.hypot(+msg.vw || 0, +msg.vh || 0) + 120, VIEW_R, 3400);
        break;
      }
      case 'weapon':
        if (Number.isInteger(msg.i) && msg.i >= 0 && msg.i < p.weapons.length) p.wi = msg.i;
        break;
      case 'enter':
        this.toggleVehicle(p);
        break;
      case 'land':
        this.landOrTakeoff(p);
        break;
      case 'flare': {
        const v = p.vehicle && this.units.get(p.vehicle);
        if (!v || !v.flaresMax) return this.toast(p, 'Flares need an aircraft');
        if (!this.dropFlares(v)) this.toast(p, v.flares ? 'Flares recharging…' : 'Out of flares');
        break;
      }
      case 'build': {
        if (this.now - p.lastAction < 150) return;
        p.lastAction = this.now;
        const tx = msg.tx | 0, ty = msg.ty | 0;
        if (Math.hypot((tx + 0.5) * TILE - p.x, (ty + 0.5) * TILE - p.y) > 1100) return this.toast(p, 'Too far away to build there');
        const res = this.placeBuilding(p.kingdom, String(msg.type), tx, ty);
        if (typeof res === 'string') this.toast(p, res);
        else if (res.type === 'townhall') this.broadcastEvent(`${p.name} founded the town of ${this.towns.get(res.townId)?.name}`);
        break;
      }
      case 'demolish': {
        const bid = this.bTiles[(msg.ty | 0) * this.size + (msg.tx | 0)];
        const b = bid && this.buildings.get(bid);
        if (b && b.kingdom === p.kingdom) this.removeBuilding(b);
        break;
      }
      case 'spawn': {
        if (this.now - p.lastAction < 250) return;
        p.lastAction = this.now;
        const u = this.spawnUnit(p.kingdom, String(msg.def), p.x + (Math.random() - 0.5) * 30, p.y + 32);
        if (!u) return this.toast(p, `Cannot spawn here (army limit ${150 + this.townsOf(p.kingdom) * 30}: capture towns to raise it; ships need water within ~45 tiles)`);
        u.mode = u.civ ? 'wander' : u.kind === 'vehicle' ? 'guard' : 'follow';
        u.sleepy = false;
        break;
      }
      case 'cmd': {
        const mode = ['follow', 'guard', 'attack', 'wander'].includes(msg.mode) ? msg.mode : 'guard';
        let n = 0;
        for (const u of this.units.values()) {
          if (u.kingdom !== p.kingdom || u.driver || u.civ) continue;
          if (msg.near && dist2(u.x, u.y, p.x, p.y) > 400 * 400) continue;
          this.leaveOp(u);
          u.mode = mode;
          u.retreating = null;
          if (mode === 'guard') (u.gx = u.x), (u.gy = u.y);
          if (mode === 'attack') (u.gx = clampNum(msg.x, 0, this.size * TILE) + (Math.random() - 0.5) * 80), (u.gy = clampNum(msg.y, 0, this.size * TILE) + (Math.random() - 0.5) * 80);
          n++;
          if (mode === 'attack' && Math.random() < 0.08) this.bark(u, 'march');
        }
        this.toast(p, `${n} units: ${mode.toUpperCase()}`);
        break;
      }
      case 'chat': {
        const text = String(msg.text || '').slice(0, 200).trim();
        if (text) this.broadcast({ t: 'chat', from: p.name, color: k.color, text });
        break;
      }
      case 'talk': {
        const u = this.units.get(msg.id);
        if (!u || u.kingdom !== p.kingdom) return this.toast(p, 'That one does not serve you');
        if (this.now - p.lastTalk < 800) return;
        p.lastTalk = this.now;
        const text = String(msg.text || '').slice(0, 300);
        // 1) understand the order and resolve it against the world (reliable, instant)
        const intent = parseIntent(text);
        const plan = this.resolveIntent(p, u, intent, msg);
        // 2) carry it out immediately: obedience never waits for the AI
        if (plan.apply) plan.apply();
        // 3) the AI writes the NPC's spoken answer, knowing what it's doing
        let enemiesNear = 0;
        const seen = {};
        this.query(u.x, u.y, 500, (e) => {
          if (e === u) return;
          if (!this.allied(e.kingdom, u.kingdom) && !e.passive && e.kingdom !== NEUTRAL && e.kingdom !== WILD) enemiesNear++;
          const label = e.cat === 'player' ? (e.kingdom === u.kingdom ? 'you (the ruler)' : `enemy ruler ${e.name}`) : `${e.kingdom === u.kingdom ? 'friendly' : e.kingdom === WILD ? 'wild' : e.kingdom === ALIEN ? 'ALIEN' : e.kingdom === NEUTRAL ? 'townsfolk' : 'enemy'} ${this.unitDef(e.def)?.name || 'unit'}`;
          seen[label] = (seen[label] || 0) + 1;
        });
        let nearTown = null;
        for (const t of this.towns.values()) {
          const h = this.buildings.get(t.hallId);
          if (h && dist2(h.x, h.y, u.x, u.y) < 600 * 600) nearTown = `${t.name} (${t.kingdom === u.kingdom ? 'ours' : this.factionName(t.kingdom)})`;
        }
        const def = this.unitDef(u.def);
        const empties = [];
        for (const v of this.units.values()) if (v.motion && !v.crewed && !v.driver && dist2(v.x, v.y, u.x, u.y) < 1200 * 1200 && this.canOperate(u, v)) empties.push(this.unitDef(v.def)?.name);
        u.chat ||= [];
        u.chat.push({ who: 'ruler', text });
        this.send(p.ws, { t: 'thinking', id: u.id });
        const res = await npcTalk({
          npcName: u.crewName || u.name,
          npcType: def?.name || 'soldier',
          civilian: u.civ,
          canFly: u.crew,
          inVehicle: !!u.motion,
          flightState: u.motion?.air ? { air: 'flying', ground: 'parked on the ground', landing: 'landing', takeoff: 'taking off' }[u.flight] || 'flying' : 'driving',
          personality: u.personality,
          kingName: p.name,
          kingdomName: k.name,
          mode: u.mode,
          command: intent.command,
          action: plan.desc,
          failure: plan.fail,
          hp: Math.ceil(u.hp),
          maxHp: u.maxHp,
          armySize: this.countUnits(k.id).army,
          civilians: this.countUnits(k.id).civ,
          buildings: [...this.buildings.values()].filter((b) => b.kingdom === k.id).length,
          towns: [...this.towns.values()].filter((t) => t.kingdom === k.id).length,
          castle: !!k.castle,
          enemiesNear,
          nearby: Object.entries(seen).slice(0, 10).map(([l, n]) => `${n} ${l}`).join(', ') + (nearTown ? `; the town of ${nearTown}` : ''),
          emptyVehicles: [...new Set(empties)].slice(0, 6).join(', '),
          terrain: TILE_NAMES[tileAt(this.map, u.x, u.y)] || 'unknown',
          rivals: this.kingdoms.filter((o) => o && !this.allied(o.id, k.id)).map((o) => o.name).join(', ') + (this.coalitionOf(k.id) ? `; allies: ${this.bloc(k.id).filter((m) => m !== k.id).map((m) => this.kName(m)).join(', ')}` : ''),
          alienThreat: this.now - this.lastAlienSighting < 300000,
          history: u.chat.slice(0, -1),
          text,
        });
        const speaker = this.units.get(u.id) || (plan.vehicleId && this.units.get(plan.vehicleId));
        if (!speaker) return;
        u.chat.push({ who: 'npc', text: res.reply });
        while (u.chat.length > 12) u.chat.shift();
        this.broadcast({ t: 'say', id: speaker.id, name: u.crewName ? `${u.crewName} (${u.name})` : u.name, text: res.reply, cmd: plan.fail ? 'none' : intent.command, all: plan.count > 1, k: u.kingdom, ai: res.ai });
        if (plan.toast) this.toast(p, plan.toast);
        break;
      }      case 'order': {
        const ids = Array.isArray(msg.ids) ? msg.ids.slice(0, 80) : [];
        const units = ids.map((id) => this.units.get(id)).filter((u) => u && u.kingdom === p.kingdom && !u.driver);
        if (!units.length) return;
        const order = String(msg.order || '');
        const n = this.applyOrder(p, units, order, { x: msg.x, y: msg.y, target: msg.target, vehicle: msg.vehicle });
        const label = { move: 'moving out', attack: 'attacking', follow: 'following you', guard: 'holding position', wander: 'at ease', board: 'boarding', dismount: 'getting out', land: 'landing', takeoff: 'taking off' }[order] || order;
        if (n) this.toast(p, `${n} unit${n > 1 ? 's' : ''} ${label}`);
        if (n && units[0] && Math.random() < 0.6) this.sayTo(units[0], pick(['Yes, my liege!', 'On it!', 'Right away!', 'As you command!', 'Moving!']));
        break;
      }
      case 'inspect':
        this.inspect(p, msg.id);
        break;
      case 'rename': {
        if (this.now - (p.lastRename || 0) < 2000) return this.toast(p, 'Slow down: one new name at a time');
        const nm = String(msg.name || '').replace(/[^\p{L}\p{N} '\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
        if (nm.length < 2) return this.toast(p, 'Names need at least 2 letters');
        p.lastRename = this.now;
        if (msg.what === 'kingdom') {
          const old = k.name;
          k.name = nm;
          this.kingdomsDirty = true;
          this.broadcastEvent(`👑 ${p.name} renamed the Kingdom of ${old} to ${nm}`);
        } else if (msg.what === 'town') {
          const t = this.towns.get(Number(msg.id));
          if (!t || t.kingdom !== p.kingdom) return this.toast(p, 'You can only rename towns you rule');
          const old = t.name;
          t.name = nm;
          this.townsDirty = true;
          this.broadcastEvent(`🏘 ${old} is now called ${nm}`);
        }
        this.sendJmc();
        break;
      }
      case 'op':
      case 'dip':
        this.handleJmc(p, msg);
        break;
      case 'create': {
        const cat = ['npc', 'weapon', 'vehicle', 'building'].includes(msg.category) ? msg.category : 'npc';
        const prompt = String(msg.prompt || '').slice(0, 400).trim();
        if (!prompt) return;
        if (this.now - p.lastCreate < 8000) return this.toast(p, 'The forge is still hot, wait a moment');
        p.lastCreate = this.now;
        this.send(p.ws, { t: 'forging', category: cat });
        const design = await designThing(cat, prompt);
        if (this.closed) return;
        const id = String(++this.catalogN);
        const entry = { id, key: 'c:' + id, ...design, creator: p.name, kingdom: p.kingdom };
        this.catalog.set(id, entry);
        this.broadcast({ t: 'catalog', def: entry });
        if (!this.players.has(p.id)) return;
        if (cat === 'weapon') {
          p.weapons.push(entry.key);
          p.wi = p.weapons.length - 1;
        } else if (cat !== 'building') {
          const u = this.spawnUnit(p.kingdom, entry.key, p.x + 30, p.y + 30);
          if (u) (u.mode = cat === 'vehicle' ? 'guard' : 'follow'), (u.sleepy = false);
        }
        this.send(p.ws, { t: 'forged', def: entry });
        this.broadcastEvent(`${p.name} forged ${entry.name}${design.ai === 'offline' ? ' (offline forge)' : ''}`);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ net helpers
  send(ws, obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.sockets) if (ws.readyState === 1) ws.send(s);
  }
  broadcastEvent(text) {
    this.broadcast({ t: 'event', text });
  }
  toast(p, text) {
    this.send(p.ws, { t: 'toast', text });
  }
}

Object.assign(Room.prototype, CommandAI);

function clampNum(v, lo, hi) {
  v = Number(v);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0;
}
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function turnToward(a, target, maxStep) {
  const d = angDiff(target, a);
  return a + Math.max(-maxStep, Math.min(maxStep, d));
}

