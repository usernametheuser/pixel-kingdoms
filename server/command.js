// Joint Military Command: diplomacy (coalitions), coordinated multi-kingdom operations, and the
// strategic "war council" that runs every AI kingdom. Mixed into Room (see game.js).
//
// An operation gathers units from one kingdom (or every member of a coalition), assembles them at a
// staging point out of the enemy's reach, then attacks as combined arms: armour leads, infantry
// follows, artillery fires from range, aircraft cover overhead, ships bombard from the nearest water.
import { TILE, T, nearestTile } from '../public/shared/map.js';
import { WILD, ALIEN, NEUTRAL } from '../public/shared/defs.js';

const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const OP_ADJ = ['Iron', 'Silent', 'Crimson', 'Thunder', 'Steel', 'Golden', 'Shadow', 'Burning', 'Northern', 'Falcon', 'Granite', 'Storm', 'Midnight', 'Lion', 'Viper', 'Royal', 'Desert', 'Arctic'];
const OP_NOUN = ['Hammer', 'Spear', 'Dawn', 'Tempest', 'Shield', 'Anvil', 'Fury', 'Talon', 'Lance', 'Wrath', 'Gale', 'Crown', 'Arrow', 'Torrent', 'Wall', 'Blade', 'Sabre', 'Eclipse'];
const PACT_NAMES = ['Iron Pact', 'Northern Alliance', 'Crimson Accord', 'Silver League', 'Dawn Coalition', 'Union of Free Crowns', 'Oak Covenant', 'Grand Entente', 'Granite Concord', 'Eagle Treaty'];
export const OP_KINDS = { strike: 'Joint Strike', defend: 'Joint Defense', capture: 'Capture Town', patrol: 'Air Patrol' };
const OP_LIFE = { strike: 8 * 60000, defend: 4 * 60000, capture: 6 * 60000, patrol: 12 * 60000 };

// what an AI kingdom recruits to counter what its enemies field
const COUNTER = {
  air: ['f16', 'tejas', 'su30', 'rafale', 'mig29', 'typhoon', 'f22', 'rifleman'],
  armor: ['a10', 'helicopter', 'prachand', 'artillery', 'arjun', 't90', 'mlrs', 'hind'],
  inf: ['tank', 'apc', 'humvee', 'artillery', 'helicopter', 'mlrs', 'arjun'],
  navy: ['destroyer', 'a10', 'submarine', 'corvette'],
  base: ['rifleman', 'rifleman', 'archer', 'knight', 'tank', 'arjun', 'apc', 'f16', 'tejas', 'helicopter', 'artillery'],
};

export const CommandAI = {
  initCommand() {
    this.coalitions = new Map();
    this.coalN = 0;
    this.ops = new Map();
    this.opN = 0;
    this.proposals = [];
    this.intel = new Map();
    this.valueCache = new Map();
    this.nextBalance = this.now + 150000;
  },

  saveCommand() {
    return { coalitions: [...this.coalitions.values()], coalN: this.coalN, ops: [...this.ops.values()], opN: this.opN, nextBalance: this.nextBalance };
  },

  restoreCommand(d, fix) {
    if (!d) return;
    for (const c of d.coalitions || []) this.coalitions.set(c.id, fix(c));
    for (const o of d.ops || []) this.ops.set(o.id, fix(o));
    this.coalN = d.coalN || 0;
    this.opN = d.opN || 0;
    if (d.nextBalance) this.nextBalance = fix({ v: d.nextBalance }).v;
  },

  // ------------------------------------------------------------------ relations
  allied(a, b) {
    if (a === b) return true;
    if (a < 0 || b < 0) return false;
    const ka = this.kingdoms[a], kb = this.kingdoms[b];
    return !!(ka && kb && ka.coalition && ka.coalition === kb.coalition);
  },
  coalitionOf(kid) {
    const k = this.kingdoms[kid];
    return k && k.coalition ? this.coalitions.get(k.coalition) || null : null;
  },
  bloc(kid) {
    const c = this.coalitionOf(kid);
    return c ? c.members.filter((m) => this.kingdoms[m]) : [kid];
  },
  kName(kid) {
    return this.kingdoms[kid]?.name || this.factionName(kid);
  },
  rulerName(kid) {
    const k = this.kingdoms[kid];
    const p = k && k.playerId && this.players.get(k.playerId);
    return p ? p.name : `the Regent of ${k ? k.name : '?'}`;
  },

  // ------------------------------------------------------------------ intelligence
  unitValue(u) {
    let v = this.valueCache.get(u.def);
    if (v === undefined) {
      const w = this.weaponOf(u.weapon);
      const dps = w ? ((w.dmg * (w.count || 1) * (w.splash ? 1.7 : 1)) / Math.max(40, w.rate)) * 1000 : 0;
      v = u.maxHp / 120 + dps / 25;
      this.valueCache.set(u.def, v);
    }
    return v * (0.35 + 0.65 * (u.hp / u.maxHp));
  },

  roleClass(u) {
    if (u.domain === 'air') return 'air';
    if (u.domain === 'water') return 'navy';
    const w = this.weaponOf(u.weapon);
    if (w && w.range >= 900) return 'arty';
    return u.motion ? 'armor' : 'inf';
  },

  // army strength and composition of every kingdom (refreshed every few seconds)
  gatherIntel() {
    const intel = new Map();
    for (const u of this.units.values()) {
      if (u.civ || !u.weapon || (u.motion && !u.crewed && !u.driver)) continue;
      if (u.kingdom < 0 && u.kingdom !== ALIEN) continue;
      let I = intel.get(u.kingdom);
      if (!I) intel.set(u.kingdom, (I = { power: 0, n: 0, air: 0, armor: 0, inf: 0, navy: 0, arty: 0 }));
      const v = this.unitValue(u);
      I.power += v;
      I.n++;
      I[this.roleClass(u)] += v;
    }
    this.intel = intel;
  },

  // friendly vs hostile combat power around a point, from kid's point of view
  forceAt(x, y, r, kid) {
    let friend = 0, foe = 0, foeB = 0;
    this.query(x, y, r, (e) => {
      if (e.hp <= 0 || dist2(x, y, e.x, e.y) > r * r) return;
      if (e.cat === 'player') {
        if (e.dead) return;
        if (this.allied(e.kingdom, kid)) friend += 3;
        else foe += 3;
        return;
      }
      if (e.civ || e.passive || !e.weapon || e.kingdom === WILD) return;
      if (e.motion && !e.crewed && !e.driver) return;
      const v = this.unitValue(e);
      if (e.kingdom >= 0 && this.allied(e.kingdom, kid)) friend += v;
      else foe += v;
    });
    this.queryBuildings(x, y, r, (b) => {
      if (b.kingdom < 0 && b.kingdom !== NEUTRAL) return;
      if (dist2(x, y, b.x, b.y) > r * r || this.allied(b.kingdom, kid)) return;
      const d = this.bdef(b.type);
      if (!d || d.decor) return;
      if (b.kingdom >= 0) foeB++;
      if (d && d.weapon) foe += b.hp / 150 + 4;
    });
    return { friend, foe, foeB };
  },

  placeName(x, y) {
    let best = null, bd = 900 * 900;
    for (const t of this.towns.values()) {
      const h = this.buildings.get(t.hallId);
      if (!h) continue;
      const d = dist2(h.x, h.y, x, y);
      if (d < bd) (bd = d), (best = t.name);
    }
    if (best) return `near ${best}`;
    for (const k of this.kingdoms) {
      const c = k && k.castle && this.buildings.get(k.castle);
      if (c && dist2(c.x, c.y, x, y) < 1200 * 1200) return `near the castle of ${k.name}`;
    }
    return `at grid ${Math.floor(x / TILE)}·${Math.floor(y / TILE)}`;
  },

  // ------------------------------------------------------------------ radio
  radio(kids, text, fromKid = null) {
    const set = new Set(kids);
    const color = fromKid !== null && fromKid >= 0 ? this.kingdoms[fromKid]?.color : '#9ad0ff';
    const from = fromKid !== null && fromKid >= 0 ? `${this.kName(fromKid)} HQ` : 'Joint Command';
    for (const p of this.players.values()) if (set.has(p.kingdom)) this.send(p.ws, { t: 'radio', from, color, text });
  },
  opRadio(op, text, fromKid = op.owner) {
    this.radio(op.coalition && this.coalitions.has(op.coalition) ? this.coalitions.get(op.coalition).members : [op.owner], `${op.name}: ${text}`, fromKid);
  },

  // ------------------------------------------------------------------ operations
  availableUnits(kid, kind, tx, ty, waterSpot) {
    const out = [];
    for (const u of this.units.values()) {
      if (u.kingdom !== kid || u.civ || !u.weapon || u.driver || u.op || u.crew || u.passive) continue;
      if (u.motion && !u.crewed) continue;
      const role = this.roleClass(u);
      if (kind === 'patrol' && role !== 'air') continue;
      if (role === 'navy' && !waterSpot) continue;
      if (role !== 'air' && role !== 'navy') {
        const lim = kind === 'defend' ? 3500 : 9000;
        if (dist2(u.x, u.y, tx, ty) > lim * lim) continue;
      }
      if (u.launches) continue; // carriers stay with their air wing
      out.push(u);
    }
    return out;
  },

  // kind: strike | defend | capture | patrol. o: { share (0..1 of the owner's free army), joint, by, reinforce }
  launchOp(kind, ownerKid, tx, ty, o = {}) {
    const owner = this.kingdoms[ownerKid];
    if (!owner || !OP_KINDS[kind]) return null;
    tx = Math.max(TILE, Math.min(this.size * TILE - TILE, tx));
    ty = Math.max(TILE, Math.min(this.size * TILE - TILE, ty));
    const coal = o.joint !== false ? this.coalitionOf(ownerKid) : null;
    const water = nearestTile(this.map, Math.floor(tx / TILE), Math.floor(ty / TILE), 28, (t) => t <= T.WATER);
    const waterSpot = water ? { x: (water.tx + 0.5) * TILE, y: (water.ty + 0.5) * TILE } : null;
    const op = {
      id: ++this.opN, name: `Operation ${pick(OP_ADJ)} ${pick(OP_NOUN)}`, kind, owner: ownerKid, coalition: coal ? coal.id : null,
      by: o.by || this.rulerName(ownerKid), tx, ty, sx: tx, sy: ty, wx: waterSpot ? waterSpot.x : null, wy: waterSpot ? waterSpot.y : null,
      phase: 'assemble', units: [], start: 0, created: this.now, deadline: this.now + OP_LIFE[kind], assembleUntil: 0,
      forces: {}, ready: 0, result: null, status: 'Forces moving to the staging area', quietSince: 0, reinforced: false, lastReport: this.now,
    };
    const parts = coal ? coal.members : [ownerKid];
    const chosen = [];
    for (const kid of parts) {
      const k = this.kingdoms[kid];
      if (!k) continue;
      const share = kid === ownerKid ? (o.share ?? 0.6) : (k.contrib ?? (k.bot ? 0.4 : 0));
      if (share <= 0) continue;
      const avail = this.availableUnits(kid, kind, tx, ty, waterSpot);
      avail.sort((a, b) => dist2(a.x, a.y, tx, ty) - dist2(b.x, b.y, tx, ty));
      const n = Math.min(avail.length, Math.max(kid === ownerKid ? o.minUnits || 1 : 0, Math.round(avail.length * share)), kind === 'capture' ? 14 : 60);
      const mine = avail.slice(0, n);
      if (kid === ownerKid && mine.length < (o.minUnits || 1)) return null; // not enough troops for this job
      if (!mine.length) continue;
      op.forces[kid] = mine.length;
      chosen.push(...mine);
      if (kid !== ownerKid && k.bot) {
        const mix = this.mixLabel(mine);
        this.opRadio(op, `${k.name} commits ${mine.length} units (${mix}). Moving out!`, kid);
      }
    }
    if (!chosen.length) return null;
    // staging point: out of the enemy's reach, on the side our forces come from
    const ground = chosen.filter((u) => u.domain !== 'air' && u.domain !== 'water');
    const src = ground.length ? ground : chosen;
    const cx = src.reduce((s, u) => s + u.x, 0) / src.length, cy = src.reduce((s, u) => s + u.y, 0) / src.length;
    const D = Math.hypot(tx - cx, ty - cy);
    if (kind === 'defend' || kind === 'patrol' || D < 1000) op.phase = 'engage';
    else {
      // stage out of the defenders' reach: step back along the approach until the spot is quiet
      let back = Math.min(1100, Math.max(650, D * 0.5));
      for (let tries = 0; tries < 4; tries++) {
        const t = this.nearestFree(Math.floor((tx + ((cx - tx) / D) * back) / TILE), Math.floor((ty + ((cy - ty) / D) * back) / TILE), 20, (v) => v >= T.SAND && v < T.MOUNTAIN);
        op.sx = t ? (t.tx + 0.5) * TILE : tx + ((cx - tx) / D) * back;
        op.sy = t ? (t.ty + 0.5) * TILE : ty + ((cy - ty) / D) * back;
        if (this.forceAt(op.sx, op.sy, 500, ownerKid).foe < 3 || back >= D * 0.85) break;
        back = Math.min(D * 0.85, back + 350);
      }
      let far = 0;
      for (const u of ground) far = Math.max(far, Math.hypot(u.x - op.sx, u.y - op.sy) / Math.max(40, u.speed));
      op.assembleUntil = this.now + Math.max(20000, Math.min(150000, far * 1200 + 8000));
    }
    for (const u of chosen) {
      u.op = op.id;
      u.preOp = { mode: u.mode, gx: u.gx, gy: u.gy };
      u.retreating = null;
      u.boarding = null;
      u.patrol = null;
      u.landOrder = false;
      u.forceLand = false;
      u.app = null;
      if (u.motion && u.motion.air && u.flight === 'ground') u.forceTakeoff = true;
      op.units.push(u.id);
    }
    op.start = chosen.length;
    op.estOwn = Math.round(chosen.reduce((s, u) => s + this.unitValue(u), 0));
    op.estFoe = Math.round(this.forceAt(tx, ty, 650, ownerKid).foe);
    op.risk = op.estFoe < op.estOwn * 0.6 ? 'low' : op.estFoe < op.estOwn * 1.1 ? 'medium' : 'high';
    this.ops.set(op.id, op);
    if (op.phase === 'assemble') this.assembleOp(op);
    else this.engageOp(op, true);
    return op;
  },

  mixLabel(units) {
    const c = { armor: 0, inf: 0, arty: 0, air: 0, navy: 0 };
    for (const u of units) c[this.roleClass(u)]++;
    const names = { armor: 'armour', inf: 'infantry', arty: 'artillery', air: 'air', navy: 'naval' };
    return Object.entries(c).filter(([, n]) => n).map(([r, n]) => `${n} ${names[r]}`).join(', ');
  },

  // formation slots around the staging point: armour in front (toward the target), artillery behind
  assembleOp(op) {
    const a = Math.atan2(op.ty - op.sy, op.tx - op.sx);
    const ca = Math.cos(a), sa = Math.sin(a);
    const rows = { armor: 70, inf: 10, arty: -90, air: 0, navy: 0 };
    const count = {};
    for (const id of op.units) {
      const u = this.units.get(id);
      if (!u) continue;
      const role = this.roleClass(u);
      const i = (count[role] = (count[role] || 0) + 1) - 1;
      const side = ((i % 9) - 4) * 26, depth = rows[role] - Math.floor(i / 9) * 26;
      u.moveOrder = false;
      u.mode = 'guard';
      if (role === 'navy' && op.wx != null) (u.gx = op.wx), (u.gy = op.wy);
      else if (role === 'air') (u.gx = op.sx + (Math.random() - 0.5) * 200), (u.gy = op.sy + (Math.random() - 0.5) * 200);
      else (u.gx = op.sx + ca * depth - sa * side), (u.gy = op.sy + sa * depth + ca * side);
    }
  },

  engageOp(op, first) {
    op.phase = 'engage';
    op.status = op.kind === 'defend' ? 'Defending the position' : op.kind === 'patrol' ? 'Air patrol on station' : 'Engaging the objective';
    const a = Math.atan2(op.ty - op.sy, op.tx - op.sx) || 0;
    for (const id of op.units) {
      const u = this.units.get(id);
      if (!u) continue;
      const role = this.roleClass(u);
      const j = () => (Math.random() - 0.5) * 90;
      u.moveOrder = false;
      if (op.kind === 'patrol' || (role === 'air' && u.role === 'fighter')) {
        // fighters fly a racetrack over the target and pounce on anything in range
        const r = 260 + Math.random() * 200, b = Math.random() * Math.PI * 2;
        u.mode = 'patrol';
        u.patrol = { ax: op.tx + Math.cos(b) * r, ay: op.ty + Math.sin(b) * r, bx: op.tx - Math.cos(b) * r, by: op.ty - Math.sin(b) * r, leg: 1 };
        u.gx = u.patrol.bx;
        u.gy = u.patrol.by;
      } else if (role === 'arty' && op.kind !== 'defend') {
        // artillery stays back at ~85% of its range and shells whatever comes into reach
        const w = this.weaponOf(u.weapon);
        const back = (w ? w.range : 900) * 0.8;
        u.mode = 'guard';
        u.gx = op.tx - Math.cos(a) * back + j();
        u.gy = op.ty - Math.sin(a) * back + j();
      } else if (role === 'navy') {
        u.mode = 'attack';
        u.gx = (op.wx ?? op.tx) + j();
        u.gy = (op.wy ?? op.ty) + j();
      } else if (op.kind === 'defend') {
        u.mode = 'guard';
        u.gx = op.tx + j() * 2;
        u.gy = op.ty + j() * 2;
        u.moveOrder = role !== 'air' && Math.hypot(u.x - op.tx, u.y - op.ty) > 600; // hurry, don't get drawn into side fights
      } else {
        u.mode = 'attack';
        // infantry trails the armour a little so tanks soak the first shots
        const lag = role === 'inf' ? 60 : 0;
        u.gx = op.tx - Math.cos(a) * lag + j();
        u.gy = op.ty - Math.sin(a) * lag + j();
        if (Math.random() < 0.1) this.bark(u, 'march');
      }
    }
    if (op.kind === 'strike' || op.kind === 'capture')
      this.opRadio(op, first ? `launched by ${op.by}. ${op.units.length} units ${op.kind === 'capture' ? 'moving to take' : 'striking'} ${this.placeName(op.tx, op.ty)}!` : `${Math.round(op.ready * 100)}% of forces in position. All units, ENGAGE! Armour lead, infantry follow, artillery cover!`);
    else if (op.kind === 'defend') this.opRadio(op, `${op.by}: all available units to ${this.placeName(op.tx, op.ty)}! ${op.units.length} units responding.`);
    else this.opRadio(op, `${op.units.length} aircraft on combat air patrol ${this.placeName(op.tx, op.ty)}.`);
  },

  endOp(op, result, why) {
    op.phase = 'done';
    op.result = result;
    op.status = why;
    op.ended = this.now;
    const home = this.kingdoms[op.owner];
    for (const id of op.units) {
      const u = this.units.get(id);
      if (u && u.op === op.id) this.releaseUnit(u, result);
    }
    const icon = result === 'success' ? '✅' : result === 'failed' ? '❌' : '⏹';
    this.opRadio(op, `${icon} ${why}`);
    if (result === 'success' && op.kind === 'strike') this.broadcastEvent(`🎖 ${op.name} by ${home ? home.name : '?'}${op.coalition ? ' and allies' : ''} succeeded ${this.placeName(op.tx, op.ty)}!`);
  },

  releaseUnit(u, result) {
    u.op = null;
    u.moveOrder = false;
    u.patrol = null;
    const k = this.kingdoms[u.kingdom];
    const pre = u.preOp;
    u.preOp = null;
    if (k && !k.bot && pre) {
      // a player's units go back to what they were doing
      u.mode = pre.mode === 'attack' || pre.mode === 'patrol' ? 'guard' : pre.mode;
      if (u.mode === 'guard') (u.gx = pre.gx), (u.gy = pre.gy);
      return;
    }
    const c = k && k.castle && this.buildings.get(k.castle);
    u.mode = 'guard';
    if (result === 'success' || !c) (u.gx = u.x), (u.gy = u.y); // hold the ground we took
    else {
      u.gx = c.x + (Math.random() - 0.5) * 300;
      u.gy = c.y + 60 + (Math.random() - 0.5) * 300;
      u.moveOrder = true; // fall back home without getting dragged into fights
    }
  },

  leaveOp(u) {
    if (!u.op) return;
    u.op = null;
    u.preOp = null;
  },

  stepOps() {
    for (const op of this.ops.values()) {
      if (op.phase === 'done') {
        if (this.now - op.ended > 45000) this.ops.delete(op.id);
        continue;
      }
      op.units = op.units.filter((id) => this.units.get(id)?.op === op.id);
      const alive = op.units.length;
      op.forces = {};
      for (const id of op.units) {
        const k = this.units.get(id).kingdom;
        op.forces[k] = (op.forces[k] || 0) + 1;
      }
      if (!alive) {
        this.endOp(op, 'failed', 'All committed forces lost.');
        continue;
      }
      if (this.now > op.deadline) {
        this.endOp(op, op.kind === 'patrol' ? 'success' : 'ended', op.kind === 'patrol' ? 'Patrol complete, returning to base.' : 'Time limit reached, forces standing down.');
        continue;
      }
      if (op.kind !== 'patrol' && op.phase === 'engage' && alive < op.start * 0.3) {
        this.endOp(op, 'failed', `Heavy losses (${op.start - alive} of ${op.start}). Retreat!`);
        continue;
      }
      if (op.phase === 'assemble') {
        let inPos = 0;
        for (const id of op.units) {
          const u = this.units.get(id);
          const role = this.roleClass(u);
          if (role === 'air' || role === 'navy' || dist2(u.x, u.y, op.sx, op.sy) < 300 * 300) inPos++;
        }
        op.ready = inPos / alive;
        op.status = `Assembling: ${Math.round(op.ready * 100)}% in position`;
        if (op.ready >= 0.75) this.engageOp(op);
        else if (alive < op.start * 0.7 && this.forceAt(op.sx, op.sy, 500, op.owner).foe > 3) {
          // being picked apart while waiting is the worst of both worlds: go now
          this.opRadio(op, `Under fire at the staging area! Attacking early with ${alive} units!`);
          this.engageOp(op);
        }
        else if (this.now > op.assembleUntil) {
          if (op.ready < 0.5 && !op.extended) {
            op.extended = true;
            op.assembleUntil = this.now + 45000;
            this.opRadio(op, `Only ${Math.round(op.ready * 100)}% in position. Holding 45 s for stragglers.`);
          } else this.engageOp(op);
        }
        else if (this.now - op.lastReport > 25000) (op.lastReport = this.now), this.opRadio(op, `${Math.round(op.ready * 100)}% of forces at the staging area.`);
        continue;
      }
      // engaged: check the objective
      const f = this.forceAt(op.tx, op.ty, 480, op.owner);
      op.status = `Engaged · ${alive} units fighting · enemy strength at objective ${Math.round(f.foe)}`;
      if (op.kind === 'capture') {
        const t = [...this.towns.values()].find((t) => {
          const h = this.buildings.get(t.hallId);
          return h && dist2(h.x, h.y, op.tx, op.ty) < 200 * 200;
        });
        if (!t) this.endOp(op, 'ended', 'The town is gone.');
        else if (this.allied(t.kingdom, op.owner)) this.endOp(op, 'success', `${t.name} is ours! Garrison holding.`);
        continue;
      }
      if (op.kind === 'defend') {
        if (f.foe < 1) {
          op.quietSince ||= this.now;
          if (this.now - op.quietSince > 20000) this.endOp(op, 'success', 'Area secure. Attackers repelled.');
        } else op.quietSince = 0;
        continue;
      }
      if (op.kind === 'strike') {
        if (f.foe < 2 && f.foeB === 0) {
          // sector clear: push on to the next enemy building nearby, or call it done
          let next = null, bd = 1100 * 1100;
          this.queryBuildings(op.tx, op.ty, 1100, (b) => {
            if (b.kingdom < 0 || this.allied(b.kingdom, op.owner) || b.type === 'fence' || this.bdef(b.type)?.decor) return;
            const d = dist2(b.x, b.y, op.tx, op.ty);
            if (d < bd) (bd = d), (next = b);
          });
          if (next) {
            op.tx = next.x;
            op.ty = next.y;
            for (const id of op.units) {
              const u = this.units.get(id);
              if (u.mode === 'attack') (u.gx = next.x + (Math.random() - 0.5) * 80), (u.gy = next.y + (Math.random() - 0.5) * 80);
            }
            if (this.now - op.lastReport > 12000) (op.lastReport = this.now), this.opRadio(op, `Sector clear. Pushing on to the ${this.bdef(next.type)?.name || 'next target'} ${this.placeName(next.x, next.y)}.`);
          } else this.endOp(op, 'success', 'Objective destroyed. Area secured!');
        } else if (!op.reinforced && f.foe > f.friend * 1.6 && this.now - op.created > 20000) {
          // outgunned: commit the reserves once
          op.reinforced = true;
          let added = 0;
          for (const kid of this.bloc(op.owner)) {
            const k = this.kingdoms[kid];
            if (!k || (!k.bot && kid !== op.owner)) continue;
            for (const u of this.availableUnits(kid, 'strike', op.tx, op.ty, op.wx != null).slice(0, 8)) {
              u.op = op.id;
              u.preOp = { mode: u.mode, gx: u.gx, gy: u.gy };
              u.mode = 'attack';
              u.gx = op.tx;
              u.gy = op.ty;
              if (u.motion && u.motion.air && u.flight === 'ground') u.forceTakeoff = true;
              op.units.push(u.id);
              added++;
            }
          }
          op.start += added;
          if (added) this.opRadio(op, `Meeting heavy resistance! ${added} reserve units committed.`);
        }
      }
    }
  },

  // ------------------------------------------------------------------ diplomacy
  joinCoalition(a, b) {
    const ka = this.kingdoms[a], kb = this.kingdoms[b];
    if (!ka || !kb || a === b) return null;
    let c = this.coalitionOf(a) || this.coalitionOf(b);
    if (this.coalitionOf(a) && this.coalitionOf(b) && ka.coalition !== kb.coalition) return null;
    if (!c) {
      const used = new Set([...this.coalitions.values()].map((x) => x.name));
      c = { id: ++this.coalN, name: PACT_NAMES.find((n) => !used.has(n)) || `Pact ${this.coalN}`, members: [], founded: this.now };
      this.coalitions.set(c.id, c);
    }
    for (const kid of [a, b]) if (!c.members.includes(kid)) c.members.push(kid), (this.kingdoms[kid].coalition = c.id);
    // peace: call off operations against the new ally and forgive old grudges
    for (const op of this.ops.values()) {
      if (op.phase === 'done') continue;
      const tgt = this.ownerAt(op.tx, op.ty);
      if (tgt !== null && this.allied(tgt, op.owner)) this.endOp(op, 'ended', 'Called off: the target is now an ally.');
    }
    for (const kid of c.members) {
      const k = this.kingdoms[kid];
      if (k && k.threat) for (const m of c.members) delete k.threat[m];
    }
    this.kingdomsDirty = true;
    this.broadcastEvent(`🤝 ${ka.name} and ${kb.name} are now allied in the ${c.name}!`);
    return c;
  },

  leaveCoalition(kid, reason = 'left') {
    const c = this.coalitionOf(kid);
    if (!c) return;
    c.members = c.members.filter((m) => m !== kid);
    this.kingdoms[kid].coalition = null;
    // pull our troops out of allied operations and theirs out of ours
    for (const op of this.ops.values()) {
      if (op.phase === 'done' || op.coalition !== c.id) continue;
      for (const id of op.units) {
        const u = this.units.get(id);
        if (u && u.op === op.id && (op.owner === kid) !== (u.kingdom === kid)) this.releaseUnit(u, 'ended');
      }
      if (op.owner === kid) op.coalition = null;
    }
    if (c.members.length < 2) {
      for (const m of c.members) if (this.kingdoms[m]) this.kingdoms[m].coalition = null;
      this.coalitions.delete(c.id);
    }
    this.kingdomsDirty = true;
    this.broadcastEvent(`💔 ${this.kName(kid)} ${reason} the ${c.name}${c.members.length < 2 ? ', which has dissolved' : ''}.`);
  },

  ownedNear(x, y, r, kid) {
    let found = false;
    this.queryBuildings(x, y, r, (b) => {
      if (!found && b.kingdom >= 0 && this.allied(b.kingdom, kid) && dist2(b.x, b.y, x, y) < r * r) found = true;
    });
    return found;
  },

  ownerAt(x, y) {
    let best = null, bd = 400 * 400;
    this.queryBuildings(x, y, 400, (b) => {
      if (b.kingdom < 0 || this.bdef(b.type)?.decor) return;
      const d = dist2(b.x, b.y, x, y);
      if (d < bd) (bd = d), (best = b.kingdom);
    });
    return best;
  },

  totalPower(kids) {
    let s = 0;
    for (const k of kids) s += this.intel.get(k)?.power || 0;
    return s;
  },

  // would the AI kingdom `to` accept an alliance with `from`? returns { ok, reason }
  judgeAlliance(from, to) {
    const kf = this.kingdoms[from], kt = this.kingdoms[to];
    if (!kf || !kt) return { ok: false, reason: 'unknown kingdom' };
    if (this.allied(from, to)) return { ok: false, reason: 'we are already allies' };
    if (this.coalitionOf(from) && this.coalitionOf(to)) return { ok: false, reason: `we are already pledged to the ${this.coalitionOf(to).name}` };
    const live = this.kingdoms.filter(Boolean).map((k) => k.id);
    const all = this.totalPower(live) || 1;
    const blocA = this.coalitionOf(from) ? this.bloc(from) : [from];
    const blocB = this.coalitionOf(to) ? this.bloc(to) : [to];
    const joint = this.totalPower([...new Set([...blocA, ...blocB])]);
    const blood = (kt.threat && kt.threat[from]) || 0;
    // the biggest power outside the would-be alliance
    let rival = null, rp = 0;
    for (const kid of live) {
      if (blocA.includes(kid) || blocB.includes(kid)) continue;
      const pw = this.intel.get(kid)?.power || 0;
      if (pw > rp) (rp = pw), (rival = kid);
    }
    const myP = this.intel.get(to)?.power || 0, avg = all / Math.max(1, live.length);
    let score = Math.random() * 0.8;
    const why = [];
    if (blood > 600) (score -= 3), why.push('your armies have spilled our blood');
    if (rival !== null && rp > Math.max(myP, this.intel.get(from)?.power || 0)) (score += 2), why.push(`together we can stand against ${this.kName(rival)}`);
    if (myP < avg * 0.7) (score += 1.2), why.push('we need strong friends');
    if (joint / all > 0.7 && live.length > 2) (score -= 2.2), why.push('such an alliance would rule the world unopposed');
    if (this.now - (kt.lastHit || 0) < 60000) score += 0.6;
    const ok = score > 0.9;
    return { ok, reason: why.length ? why[ok ? why.length - 1 : 0] : ok ? 'our interests align' : 'we see no gain in it' };
  },

  propose(from, to) {
    const kf = this.kingdoms[from], kt = this.kingdoms[to];
    if (!kf || !kt || from === to) return 'Unknown kingdom';
    if (this.allied(from, to)) return 'Already allies';
    if (this.coalitionOf(from) && this.coalitionOf(to)) return 'Both of you already belong to coalitions: one must leave first';
    if (kt.bot) {
      const j = this.judgeAlliance(from, to);
      this.radio([from], j.ok ? `🤝 The Regent of ${kt.name} accepts: "${j.reason}."` : `✋ The Regent of ${kt.name} declines: "${j.reason}."`, to);
      if (j.ok) this.joinCoalition(from, to);
      else kt.snubbedBy = from;
      return j.ok ? `${kt.name} accepted your alliance!` : `${kt.name} declined`;
    }
    this.proposals = this.proposals.filter((p) => !(p.from === from && p.to === to) && this.now - p.at < 90000);
    this.proposals.push({ from, to, at: this.now });
    this.radio([to], `📜 ${this.rulerName(from)} of ${kf.name} proposes an alliance. Open Joint HQ (J) to answer.`, from);
    return `Alliance proposal sent to ${kt.name}`;
  },

  answer(to, from, yes) {
    const i = this.proposals.findIndex((p) => p.from === from && p.to === to);
    if (i < 0) return 'That proposal has expired';
    this.proposals.splice(i, 1);
    if (!yes) {
      this.radio([from], `✋ ${this.rulerName(to)} of ${this.kName(to)} declined your alliance.`, to);
      return 'Declined';
    }
    if (this.coalitionOf(from) && this.coalitionOf(to) && !this.allied(from, to)) return 'Both of you already belong to coalitions';
    this.joinCoalition(from, to);
    return 'Alliance formed!';
  },

  // every couple of minutes: AI kingdoms balance the power, ganging up on whoever grows too strong,
  // and invite human rulers who share their enemy
  stepDiplomacy() {
    if (this.now < this.nextBalance) return;
    this.nextBalance = this.now + 120000 + Math.random() * 90000;
    const live = this.kingdoms.filter((k) => k && (k.castle || this.intel.get(k.id)));
    if (live.length < 3) return;
    const blocs = new Map();
    for (const k of live) {
      const key = k.coalition ? 'c' + k.coalition : 'k' + k.id;
      blocs.set(key, (blocs.get(key) || 0) + (this.intel.get(k.id)?.power || 0));
    }
    const total = [...blocs.values()].reduce((a, b) => a + b, 0) || 1;
    const ranked = [...blocs.entries()].sort((a, b) => b[1] - a[1]);
    const [topKey, topP] = ranked[0];
    const second = ranked[1] ? ranked[1][1] : 0;
    if (topP / total < 0.4 || topP < second * 1.35) return;
    const isTop = (k) => (k.coalition ? 'c' + k.coalition : 'k' + k.id) === topKey;
    const topName = topKey[0] === 'c' ? this.coalitions.get(+topKey.slice(1))?.name : this.kName(+topKey.slice(1));
    // AI kingdoms outside the dominant bloc band together
    const free = live.filter((k) => !isTop(k) && k.bot && !k.coalition).sort((a, b) => (this.intel.get(b.id)?.power || 0) - (this.intel.get(a.id)?.power || 0));
    const pacts = live.filter((k) => !isTop(k) && k.coalition).map((k) => k.id);
    if (free.length >= 2 && !pacts.length) {
      const c = this.joinCoalition(free[0].id, free[1].id);
      if (c) this.radio(c.members, `Our pact exists to stop ${topName}. Prepare joint operations!`, free[0].id);
    } else if (free.length && pacts.length) {
      const j = this.judgeAlliance(pacts[0], free[0].id);
      if (j.ok) this.joinCoalition(pacts[0], free[0].id);
    }
    // invite a human ruler who isn't part of the dominant bloc
    const humans = live.filter((k) => !k.bot && !isTop(k) && !k.coalition);
    const inviter = live.find((k) => k.bot && !isTop(k) && (k.coalition || free.includes(k)));
    for (const h of humans) {
      if (!inviter || this.proposals.some((p) => p.to === h.id) || inviter.snubbedBy === h.id) continue;
      this.proposals.push({ from: inviter.id, to: h.id, at: this.now });
      this.radio([h.id], `📜 The Regent of ${inviter.name} proposes an alliance against ${topName}. Open Joint HQ (J) to answer.`, inviter.id);
    }
  },

  // ------------------------------------------------------------------ the war council (AI kingdoms)
  warCouncil(k, mine, c, plan) {
    const free = mine.filter((u) => !u.op && u.weapon && !u.crew && !u.passive && !u.launches && !(u.motion && !u.crewed));
    const myOps = [...this.ops.values()].filter((o) => o.owner === k.id && o.phase !== 'done');
    if (k.threat) for (const kid in k.threat) if ((k.threat[kid] *= 0.85) < 20) delete k.threat[kid];
    const strategy = plan ? plan.strategy : null;

    // 1) defence: answer attacks on our land at once, and call allies when outgunned
    const homeGround = k.lastHitX != null && (dist2(k.lastHitX, k.lastHitY, c.x, c.y) < 1400 * 1400 || this.ownedNear(k.lastHitX, k.lastHitY, 700, k.id));
    if (this.now - (k.lastHit || 0) < 15000 && homeGround && !myOps.some((o) => o.kind === 'defend')) {
      const f = this.forceAt(k.lastHitX, k.lastHitY, 650, k.id);
      if (f.foe >= 3) {
        const joint = f.foe > f.friend * 1.2 && !!k.coalition && this.now - (k.helpAskedAt || 0) > 90000;
        if (joint) k.helpAskedAt = this.now;
        const op = this.launchOp('defend', k.id, k.lastHitX, k.lastHitY, { share: Math.min(0.9, 0.35 + f.foe / 60), joint, by: `${k.name} high command` });
        if (op && joint) this.opRadio(op, `⚠ ${k.name} is under attack ${this.placeName(k.lastHitX, k.lastHitY)}! Requesting assistance from all allies!`, k.id);
      }
    }
    if (strategy === 'defend') {
      for (const u of free) if (u.mode === 'attack' && dist2(u.x, u.y, c.x, c.y) > 1500 * 1500) (u.mode = 'guard'), (u.gx = c.x + (Math.random() - 0.5) * 200), (u.gy = c.y + (Math.random() - 0.5) * 200);
      return;
    }

    // 2) offence: one strike at a time, only with a real chance of winning
    const waveDue = this.now >= k.nextWave;
    if (waveDue && !myOps.some((o) => o.kind === 'strike') && free.length >= 8) {
      k.nextWave = this.now + 60000 + Math.random() * 40000;
      const tgt = this.chooseTarget(k, c, plan);
      const commit = free.reduce((s, u) => s + this.unitValue(u), 0) * 0.6 + (k.coalition ? this.totalPower(this.bloc(k.id).filter((m) => m !== k.id)) * 0.3 : 0);
      if (tgt && commit > tgt.defence * 1.1) {
        const op = this.launchOp('strike', k.id, tgt.x, tgt.y, { share: 0.6, minUnits: 6, joint: true, by: `the Regent of ${k.name}` });
        if (op) this.broadcastEvent(`⚔ The armies of ${k.name}${op.coalition ? ' and their allies' : ''} march on ${tgt.label}!`);
      } else if (tgt && Math.random() < 0.35) this.radio(this.bloc(k.id), `Scouts report ${tgt.label} is too well defended (${Math.round(tgt.defence)} vs our ${Math.round(commit)}). Massing more troops.`, k.id);
    }

    // 3) expansion: grab towns we can actually hold
    const caps = myOps.filter((o) => o.kind === 'capture').length;
    if (caps < 2 && free.length > 6 && (strategy === 'capture_towns' || strategy === 'expand' || Math.random() < 0.3)) {
      let best = null, bs = Infinity;
      for (const t of this.towns.values()) {
        if (this.allied(t.kingdom, k.id)) continue;
        const h = this.buildings.get(t.hallId);
        if (!h || [...this.ops.values()].some((o) => o.kind === 'capture' && o.phase !== 'done' && dist2(o.tx, o.ty, h.x, h.y) < 200 * 200)) continue;
        const d = Math.sqrt(dist2(c.x, c.y, h.x, h.y));
        if (d > 6000) continue;
        const def = this.forceAt(h.x, h.y, 400, k.id).foe;
        const s = d / 40 + def * 6 + (t.kingdom >= 0 ? 25 : 0);
        if (s < bs) (bs = s), (best = { h, def, name: t.name });
      }
      if (best) {
        const need = Math.max(4, best.def * 1.6);
        let share = 0, val = 0;
        const total = free.reduce((s, u) => s + this.unitValue(u), 0);
        if (total > 0) share = Math.min(0.45, Math.max(0.15, need / total));
        val = total * share;
        if (val >= best.def * 1.2 + 3 && free.length >= 10) this.launchOp('capture', k.id, best.h.x, best.h.y, { share, minUnits: Math.min(8, Math.max(4, Math.ceil(best.def / 2))), joint: false, by: `the Regent of ${k.name}` });
      }
    }
  },

  // pick the most attractive enemy objective: who hurt us, who is weak, who is close, what the regent wants
  chooseTarget(k, c, plan) {
    let best = null, bs = -Infinity;
    const myP = this.intel.get(k.id)?.power || 1;
    for (const o of this.kingdoms) {
      if (!o || this.allied(o.id, k.id)) continue;
      const P = this.intel.get(o.id)?.power || 0;
      // candidate objectives: their castle and a sample of their buildings and towns
      const cands = [];
      const oc = o.castle && this.buildings.get(o.castle);
      if (oc) cands.push(oc);
      let n = 0;
      for (const b of this.buildings.values()) {
        if (b.kingdom !== o.id || b.type === 'fence' || b.type === 'wall' || this.bdef(b.type)?.decor) continue;
        if (++n % 7 === 0) cands.push(b);
        if (cands.length > 24) break;
      }
      const ruler = o.playerId && this.players.get(o.playerId);
      if (!cands.length && ruler && !ruler.dead) cands.push(ruler);
      for (const b of cands) {
        const d = Math.sqrt(dist2(c.x, c.y, b.x, b.y));
        const defence = this.forceAt(b.x, b.y, 600, k.id).foe;
        let s = -d / 150 - defence * 0.8 + ((k.threat && k.threat[o.id]) || 0) / 80 + (myP / (P + 5)) * 6;
        if (b === oc) s += 8; // castles are the prize
        if (plan && plan.targetKingdom && plan.targetKingdom.toLowerCase().includes(o.name.toLowerCase())) s += 25;
        if (s > bs) (bs = s), (best = { x: b.x, y: b.y, kid: o.id, defence, label: b === oc ? `the castle of ${o.name}` : `${o.name} ${this.placeName(b.x, b.y)}` });
      }
    }
    return best;
  },

  // what to recruit: counter the enemies' army mix
  counterPick(k) {
    const foe = { air: 0, armor: 0, inf: 0, navy: 0 };
    for (const [kid, I] of this.intel) {
      if (kid >= 0 && this.allied(kid, k.id)) continue;
      foe.air += I.air;
      foe.armor += I.armor + I.arty;
      foe.inf += I.inf;
      foe.navy += I.navy;
    }
    const sum = foe.air + foe.armor + foe.inf + foe.navy;
    if (!sum || Math.random() < 0.3) return pick(COUNTER.base);
    let r = Math.random() * sum;
    for (const key of ['air', 'armor', 'inf', 'navy']) if ((r -= foe[key]) <= 0) return pick(COUNTER[key]);
    return pick(COUNTER.base);
  },

  // ------------------------------------------------------------------ Joint HQ data for one player
  jmcFor(p) {
    const me = p.kingdom;
    const c = this.coalitionOf(me);
    const k = this.kingdoms[me];
    const ops = [];
    for (const op of this.ops.values()) {
      if (op.owner !== me && !this.allied(op.owner, me)) continue;
      ops.push({
        id: op.id, name: op.name, kind: op.kind, phase: op.phase, owner: op.owner, by: op.by, result: op.result, status: op.status,
        tx: Math.round(op.tx), ty: Math.round(op.ty), sx: Math.round(op.sx), sy: Math.round(op.sy),
        alive: op.units.length, start: op.start, ready: Math.round(op.ready * 100), forces: op.forces, joint: !!op.coalition,
        left: Math.max(0, Math.round((op.deadline - this.now) / 1000)), risk: op.risk, estFoe: op.estFoe, estOwn: op.estOwn,
      });
    }
    return {
      t: 'jmc',
      coal: c ? { id: c.id, name: c.name, members: c.members } : null,
      contrib: k ? Math.round((k.contrib ?? 0) * 100) : 0,
      kingdoms: this.kingdoms.filter(Boolean).map((o) => ({
        id: o.id, name: o.name, color: o.color, ruler: this.rulerName(o.id), bot: !!o.bot, ai: !!o.aiOnly,
        power: Math.round(this.intel.get(o.id)?.power || 0), ally: this.allied(o.id, me), coal: o.coalition ? this.coalitions.get(o.coalition)?.name : null,
        contrib: Math.round((o.contrib ?? (o.bot ? 0.4 : 0)) * 100),
      })),
      ops,
      inbox: this.proposals.filter((x) => x.to === me && this.now - x.at < 90000).map((x) => ({ from: x.from, name: this.kName(x.from), ruler: this.rulerName(x.from) })),
      aliens: Math.round(this.intel.get(ALIEN)?.power || 0),
    };
  },

  sendJmc() {
    for (const p of this.players.values()) {
      const s = JSON.stringify(this.jmcFor(p));
      if (s !== p.jmcLast) (p.jmcLast = s), p.ws.readyState === 1 && p.ws.send(s);
    }
  },

  handleJmc(p, msg) {
    const me = p.kingdom;
    if (msg.t === 'op') {
      if (msg.action === 'launch') {
        if (this.now - (p.lastOp || 0) < 2500) return this.toast(p, 'Joint HQ is still planning the last operation');
        const mineActive = [...this.ops.values()].filter((o) => o.owner === me && o.phase !== 'done').length;
        if (mineActive >= 5) return this.toast(p, 'You already run 5 operations: cancel one first');
        const kind = OP_KINDS[msg.kind] ? msg.kind : 'strike';
        const share = Math.max(0.1, Math.min(1, Number(msg.share) || 0.5));
        p.lastOp = this.now;
        const x = Number(msg.x), y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const op = this.launchOp(kind, me, x, y, { share, joint: msg.joint !== false, by: p.name });
        if (!op) return this.toast(p, kind === 'patrol' ? 'No aircraft available for an air patrol' : 'No units available for this operation');
        const allies = Object.keys(op.forces).filter((kid) => +kid !== me).length;
        this.toast(p, `${op.name}: ${op.start} units${allies ? ` from ${allies + 1} kingdoms` : ''} ${op.phase === 'assemble' ? 'assembling' : 'deployed'} · intel: enemy ${op.estFoe} vs our ${op.estOwn} (${op.risk} risk)`);
      } else if (msg.action === 'cancel') {
        const op = this.ops.get(Number(msg.id));
        if (!op || op.phase === 'done') return;
        if (op.owner !== me && !(op.coalition && this.allied(op.owner, me))) return this.toast(p, 'Not your operation');
        this.endOp(op, 'ended', `Cancelled by ${p.name}. Forces returning.`);
      }
      this.sendJmc();
      return;
    }
    if (msg.t === 'dip') {
      const to = Number(msg.to);
      let res = '';
      if (msg.action === 'propose') res = this.propose(me, to);
      else if (msg.action === 'accept' || msg.action === 'decline') res = this.answer(me, Number(msg.from), msg.action === 'accept');
      else if (msg.action === 'leave') this.leaveCoalition(me, 'left'), (res = 'You left the coalition');
      else if (msg.action === 'contrib') {
        const v = Math.max(0, Math.min(1, Number(msg.v) || 0));
        this.kingdoms[me].contrib = v;
        res = v ? `You commit ${Math.round(v * 100)}% of your army to allied operations` : 'Your army stays home during allied operations';
      }
      if (res) this.toast(p, res);
      this.sendJmc();
    }
  },
};
