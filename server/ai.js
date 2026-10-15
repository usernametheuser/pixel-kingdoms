// AI layer for the Forge (custom NPCs / weapons / vehicles / buildings with pixel sprites),
// NPC conversations and AI regents (bot kingdom strategy).
//
// Provider chain, first one that works wins:
//   1. Claude (only if Anthropic credentials are configured)
//   2. Local free AI: Ollama with Qwen (auto-detected, no key, no rate limit)
//   3. Free keyless online AI: Pollinations (https://text.pollinations.ai/openai)
//   4. Offline fallback (keyword rules + procedural sprites), so the game never breaks
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { hash2 } from '../public/shared/map.js';
import { UNITS, BUILDINGS } from '../public/shared/defs.js';

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const FREE_URL = process.env.FREE_AI_URL || 'https://text.pollinations.ai/openai';
const FREE_MODEL = process.env.FREE_AI_MODEL || 'openai';
const FREE_DISABLED = process.env.FREE_AI === 'off';

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------
let claude = null;
let claudeOff = false;

function hasClaudeCredentials() {
  const env = process.env;
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE || env.ANTHROPIC_FEDERATION_RULE_ID) return true;
  const home = env.HOME || env.USERPROFILE || '';
  return !!home && fs.existsSync(path.join(home, '.config', 'anthropic')); // `ant auth login` profile
}

function getClaude() {
  if (claudeOff) return null;
  if (!claude) {
    if (!hasClaudeCredentials()) {
      claudeOff = true;
      return null;
    }
    try {
      claude = new Anthropic();
    } catch {
      claudeOff = true;
      return null;
    }
  }
  return claude;
}

async function askClaude(system, user, schema, maxTokens) {
  const c = getClaude();
  if (!c) throw new Error('Claude unavailable');
  try {
    const res = await c.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') throw new Error('request declined');
    if (res.stop_reason === 'max_tokens') throw new Error('response truncated');
    return JSON.parse(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || /authentication method/i.test(e.message)) {
      console.warn('[ai] Claude disabled:', e.message);
      claudeOff = true;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Free keyless online AI (Pollinations, OpenAI-compatible). One request at a time
// because the anonymous tier is rate limited per IP.
// ---------------------------------------------------------------------------
const queue = [];
let busy = false;
let lastFreeCall = 0;
let freeFailures = 0;
let freeRetryAt = 0;

function freeOnline() {
  return !FREE_DISABLED && Date.now() >= freeRetryAt;
}

function extractJson(text) {
  let t = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON in reply');
  return JSON.parse(t.slice(a, b + 1));
}

async function freeRequest(system, user, schema) {
  const body = {
    model: FREE_MODEL,
    messages: [
      { role: 'system', content: `${system}\n\nReply with ONLY one JSON object (no markdown, no commentary) that matches this JSON schema:\n${JSON.stringify(schema)}` },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    // the free model is a reasoning model with a small output budget: keep its thinking short
    reasoning_effort: 'low',
    max_tokens: 4000,
    referrer: 'pixel-kingdoms', // note: `seed` / `private` are paid features on Pollinations (HTTP 402)
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 75000);
    try {
      const res = await fetch(FREE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      // anonymous tier answers 429/402 when we're going too fast: back off and retry
      if ((res.status === 429 || res.status === 402) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 12000));
        continue;
      }
      if (!res.ok) throw new Error(`free AI HTTP ${res.status}`);
      const data = await res.json();
      const msg = data?.choices?.[0]?.message || {};
      try {
        return extractJson(msg.content);
      } catch (e) {
        // reasoning models occasionally leave the answer inside their reasoning text
        if (msg.reasoning) try { return extractJson(msg.reasoning.slice(msg.reasoning.lastIndexOf('{"'))); } catch {}
        if (attempt < 2) continue;
        throw e;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('free AI rate limited');
}

function askFree(system, user, schema, priority) {
  if (!freeOnline()) return Promise.reject(new Error('free AI offline'));
  if (priority === 'low' && (busy || queue.length > 1)) return Promise.reject(new Error('free AI busy'));
  if (queue.length > 12) return Promise.reject(new Error('free AI queue full'));
  return new Promise((resolve, reject) => {
    queue.push({ system, user, schema, resolve, reject });
    pump();
  });
}

async function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const job = queue.shift();
  const wait = Math.max(0, lastFreeCall + 3000 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastFreeCall = Date.now();
  try {
    const out = await freeRequest(job.system, job.user, job.schema);
    freeFailures = 0;
    job.resolve(out);
  } catch (e) {
    if (++freeFailures >= 4) {
      freeRetryAt = Date.now() + 120000; // back off for 2 minutes, then try again
      freeFailures = 0;
      console.warn('[ai] free online AI unreachable, retrying in 2 min:', e.message);
    }
    job.reject(e);
  } finally {
    busy = false;
    pump();
  }
}

// ---------------------------------------------------------------------------
// Local free AI: Ollama (e.g. `ollama pull qwen2.5:3b`). No key, no rate limit, runs on your PC.
// Auto-detected at http://localhost:11434; prefers a Qwen model.
// ---------------------------------------------------------------------------
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const local = { checked: 0, ok: false, model: null, busy: false, queue: [], failures: 0 };

let detecting = null;
export function detectLocalAI() {
  if (process.env.LOCAL_AI !== 'on') return Promise.resolve(false); // default: free online AI (works on every device)
  if (detecting) return detecting;
  if (Date.now() - local.checked < 60000) return Promise.resolve(local.ok);
  detecting = probeLocalAI().finally(() => (detecting = null));
  return detecting;
}
async function probeLocalAI() {
  local.checked = Date.now();
  try {
    const r = await fetch(OLLAMA_URL + '/api/tags', { signal: AbortSignal.timeout(1500) });
    const names = ((await r.json()).models || []).map((m) => m.name);
    const want = process.env.OLLAMA_MODEL;
    const was = local.model;
    local.model = want && names.includes(want) ? want : names.find((n) => /qwen/i.test(n)) || names.find((n) => !/embed/i.test(n)) || null;
    local.ok = !!local.model;
    if (local.ok && was !== local.model) console.log(`[ai] local AI found: Ollama · ${local.model}`);
  } catch {
    local.ok = false;
  }
  return local.ok;
}
detectLocalAI();
setInterval(detectLocalAI, 60000).unref();

async function localRequest(system, user, schema, maxTokens) {
  const res = await fetch(OLLAMA_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify({
      model: local.model,
      stream: false,
      format: schema, // Ollama structured outputs: the reply is forced to match the schema
      keep_alive: '30m',
      options: { temperature: 0.85, num_predict: Math.min(maxTokens, 3000) },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`local AI HTTP ${res.status}`);
  const data = await res.json();
  return extractJson(data?.message?.content);
}

function askLocal(system, user, schema, maxTokens, priority) {
  if (!local.ok) return Promise.reject(new Error('local AI offline'));
  if (priority === 'low' && local.queue.length > 3) return Promise.reject(new Error('local AI busy'));
  if (local.queue.length > 20) return Promise.reject(new Error('local AI queue full'));
  return new Promise((resolve, reject) => {
    const job = { system, user, schema, maxTokens, resolve, reject, low: priority === 'low' };
    // player-facing requests (talk / forge) jump ahead of background chatter
    const firstLow = local.queue.findIndex((j) => j.low);
    if (job.low || firstLow === -1) local.queue.push(job);
    else local.queue.splice(firstLow, 0, job);
    pumpLocal();
  });
}

async function pumpLocal() {
  if (local.busy || !local.queue.length) return;
  local.busy = true;
  const job = local.queue.shift();
  try {
    job.resolve(await localRequest(job.system, job.user, job.schema, job.maxTokens));
    local.failures = 0;
  } catch (e) {
    if (++local.failures >= 3) {
      local.ok = false;
      local.checked = Date.now();
      local.failures = 0;
      console.warn('[ai] local AI stopped answering, falling back to online AI:', e.message);
    }
    job.reject(e);
  } finally {
    local.busy = false;
    pumpLocal();
  }
}

// ---------------------------------------------------------------------------
async function askJson(system, user, schema, maxTokens, priority = 'normal') {
  if (getClaude()) {
    try {
      return { data: await askClaude(system, user, schema, maxTokens), via: 'claude' };
    } catch (e) {
      console.warn('[ai] Claude failed, trying free AI:', e.message);
    }
  }
  if (local.ok) {
    try {
      return { data: await askLocal(system, user, schema, maxTokens, priority), via: 'local' };
    } catch (e) {
      if (priority === 'low') throw e; // don't spill background chatter onto the rate-limited online tier
    }
  }
  return { data: await askFree(system, user, schema, priority), via: 'free' };
}

export function aiStatus() {
  if (getClaude()) return 'claude';
  if (local.ok) return 'local';
  if (freeOnline()) return 'free';
  return 'offline';
}
export function aiModelName() {
  return getClaude() ? CLAUDE_MODEL : local.ok ? local.model : freeOnline() ? 'Pollinations ' + FREE_MODEL : 'offline';
}

// ---------------------------------------------------------------------------
// Forge
// ---------------------------------------------------------------------------
const UNIT_KEYS = Object.keys(UNITS);

const WEAPON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'damage', 'fireRateMs', 'range', 'projectileSpeed', 'splash', 'count', 'spread', 'melee', 'color'],
  properties: {
    name: { type: 'string' },
    damage: { type: 'integer' },
    fireRateMs: { type: 'integer' },
    range: { type: 'integer' },
    projectileSpeed: { type: 'integer' },
    splash: { type: 'integer' },
    count: { type: 'integer' },
    spread: { type: 'number' },
    melee: { type: 'boolean' },
    color: { type: 'string' },
  },
};
const SPRITE_PROPS = {
  palette: {
    type: 'array',
    items: { type: 'object', additionalProperties: false, required: ['ch', 'color'], properties: { ch: { type: 'string' }, color: { type: 'string' } } },
  },
  pixels: { type: 'array', items: { type: 'string' } },
};

const CREATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'domain', 'hp', 'speed', 'personality', 'weapon', 'palette', 'pixels'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    domain: { type: 'string', enum: ['foot', 'land', 'water', 'air'] },
    hp: { type: 'integer' },
    speed: { type: 'integer' },
    personality: { type: 'string' },
    weapon: WEAPON_SCHEMA,
    ...SPRITE_PROPS,
  },
};

const BUILDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'size', 'hp', 'hasWeapon', 'weapon', 'produces', 'productionSeconds', 'palette', 'pixels'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    size: { type: 'integer', enum: [1, 2, 3] },
    hp: { type: 'integer' },
    hasWeapon: { type: 'boolean' },
    weapon: WEAPON_SCHEMA,
    produces: { type: 'string', enum: ['none', ...UNIT_KEYS] },
    productionSeconds: { type: 'integer' },
    ...SPRITE_PROPS,
  },
};

const SPRITE_RULES = `Sprite rules: "pixels" is exactly 16 strings of exactly 16 characters. '.' is transparent. Every other character must be listed in "palette"
with a #rrggbb colour. You may also use 'K' (light) and 'k' (dark) without defining them: they become the owner's kingdom colour (banners, uniforms, paint, roofs).
Use a bold silhouette, a dark outline and 3-6 colours so it reads at tiny size. Fill the 16x16 canvas well; don't draw something tiny in a corner.`;

const BALANCE = `Balance reference (built-ins): knight hp 130 speed 82 sword dmg 24 every 420ms; rifleman hp 95, rifle dmg 9 every 140ms range 520;
tank hp 700 speed 72, cannon dmg 60 every 1100ms splash 42; stealth fighter hp 340 speed 400; attack helicopter hp 420; warship hp 900.
Players asked for no limits, so be generous and fun, but keep numbers in these ranges: hp 20-5000, speed 20-420, damage 1-300,
fireRateMs 50-5000, range 25-1200 (melee weapons: 25-60 and melee true, projectileSpeed 0), projectileSpeed 150-1200, splash 0-150, count 1-12, spread 0-1 radians.`;

const CREATE_SYSTEM = `You are the Forge in Pixel Kingdoms, a top-down pixel-art sandbox war game (medieval kingdoms meet modern tanks, jets, helicopters, animals and aliens).
The player describes something; you design it: a fitting name, a one-sentence description, stats and a 16x16 pixel-art sprite.
${BALANCE}
Domain: foot = walks (people, animals, robots, monsters), land = ground vehicle or mount, water = boat or sea creature, air = flies.
Vehicles, creatures and weapons face RIGHT (east). People face the viewer.
${SPRITE_RULES}`;

const BUILDING_SYSTEM = `You are the Architect in Pixel Kingdoms, a top-down pixel-art sandbox war game (medieval kingdoms meet modern tanks, jets, animals and aliens).
The player describes a building; you design it: name, one-sentence description, footprint size in tiles (1, 2 or 3), hp (100-10000),
whether it has a defensive weapon (turrets, cannons, magic crystals...; if not, still fill "weapon" with zeros and hasWeapon false),
and which existing unit it trains automatically ("produces", or "none") and how often (productionSeconds 10-120).
Trainable units: ${UNIT_KEYS.join(', ')}.
${BALANCE}
The sprite is the building seen from above at a slight angle, filling the whole square.
${SPRITE_RULES}`;

function clamp(v, lo, hi, d) {
  v = Number(v);
  if (!Number.isFinite(v)) return d;
  return Math.max(lo, Math.min(hi, v));
}

function sanitizeSprite(pixels, palette) {
  const pal = {};
  const entries = Array.isArray(palette) ? palette.map((p) => [p?.ch, p?.color]) : Object.entries(palette || {});
  for (const [ch, color] of entries) {
    if (typeof ch === 'string' && ch.length === 1 && /^#[0-9a-fA-F]{6}$/.test(color) && !'.Kk'.includes(ch)) pal[ch] = color;
  }
  const src = Array.isArray(pixels) ? pixels : [];
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let row = String(src[y] || '').slice(0, 16).padEnd(16, '.');
    row = [...row].map((ch) => (ch === '.' || ch === 'K' || ch === 'k' || pal[ch] ? ch : '.')).join('');
    rows.push(row);
  }
  return { pixels: rows, palette: pal };
}

function spriteFilled(sprite) {
  let n = 0;
  for (const r of sprite.pixels) for (const c of r) if (c !== '.') n++;
  return n >= 24;
}

function normalizeWeapon(w = {}) {
  const melee = !!w.melee;
  const weapon = {
    name: String(w.name || 'Weapon').slice(0, 32),
    dmg: clamp(w.damage, 1, 300, 15),
    rate: clamp(w.fireRateMs, 50, 5000, 500),
    range: clamp(w.range, 25, 1200, melee ? 34 : 400),
    speed: melee ? 0 : clamp(w.projectileSpeed, 150, 1200, 500),
    splash: clamp(w.splash, 0, 150, 0),
    count: Math.round(clamp(w.count, 1, 12, 1)),
    spread: clamp(w.spread, 0, 1, 0.04),
    melee,
    color: /^#[0-9a-fA-F]{6}$/.test(w.color) ? w.color : '#ffe066',
  };
  if (weapon.melee) weapon.range = Math.min(weapon.range, 60);
  weapon.size = weapon.splash > 30 || weapon.dmg > 60 ? 4 : weapon.dmg > 25 ? 3 : 2;
  return weapon;
}

export function normalizeCreation(category, raw) {
  if (category === 'building') {
    const size = Math.round(clamp(raw.size, 1, 3, 2));
    const produces = UNITS[raw.produces] ? raw.produces : null;
    return {
      category,
      name: String(raw.name || 'Structure').slice(0, 32),
      description: String(raw.description || '').slice(0, 200),
      building: {
        w: size,
        h: size,
        hp: clamp(raw.hp, 100, 10000, 800),
        weapon: raw.hasWeapon ? normalizeWeapon(raw.weapon) : null,
        produces: produces ? [produces] : null,
        every: produces ? clamp(raw.productionSeconds, 10, 120, 30) * 1000 : 0,
      },
      sprite: sanitizeSprite(raw.pixels, raw.palette),
    };
  }
  let domain = ['foot', 'land', 'water', 'air'].includes(raw.domain) ? raw.domain : 'foot';
  if (category === 'npc' && domain === 'land') domain = 'foot';
  if (category === 'vehicle' && domain === 'foot') domain = 'land';
  return {
    category,
    name: String(raw.name || 'Unnamed').slice(0, 32),
    description: String(raw.description || '').slice(0, 200),
    personality: String(raw.personality || 'loyal').slice(0, 200),
    unit: {
      hp: clamp(raw.hp, 20, 5000, 120),
      speed: clamp(raw.speed, 20, 420, 90),
      domain,
      r: category === 'vehicle' ? 11 : 7,
    },
    weapon: normalizeWeapon(raw.weapon),
    sprite: sanitizeSprite(raw.pixels, raw.palette),
  };
}

export async function designThing(category, prompt) {
  const idea = `Player's idea: """${String(prompt).slice(0, 400)}"""`;
  let system, user, schema;
  if (category === 'building') {
    (system = BUILDING_SYSTEM), (schema = BUILDING_SCHEMA), (user = `Design this building.\n${idea}`);
  } else {
    const what = category === 'weapon' ? 'a hand-held weapon for the player (the sprite shows the weapon itself, pointing right)' : category === 'vehicle' ? 'a vehicle or mount the player can drive' : "an NPC character (person, creature, robot...) that joins the player's kingdom";
    (system = CREATE_SYSTEM), (schema = CREATE_SCHEMA), (user = `Design ${what}.\n${idea}`);
  }
  try {
    const { data, via } = await askJson(system, user, schema, 6000);
    const out = normalizeCreation(category, data);
    if (!spriteFilled(out.sprite)) out.sprite = fallbackDesign(category, prompt).sprite; // keep AI stats, fix a blank drawing
    return { ...out, ai: via };
  } catch (e) {
    console.warn('[ai] design fallback:', e.message);
    return { ...fallbackDesign(category, prompt), ai: 'offline' };
  }
}

// Offline: keyword-driven stats + a procedural sprite seeded by the prompt.
function strHash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function fallbackDesign(category, prompt) {
  const p = String(prompt).toLowerCase();
  const seed = strHash(p);
  const has = (...words) => words.some((w) => p.includes(w));
  const fire = has('fire', 'flame', 'lava', 'dragon', 'inferno');
  const ice = has('ice', 'frost', 'snow');
  const boom = has('rocket', 'missile', 'bomb', 'cannon', 'nuke', 'explo', 'grenade', 'artillery');
  const melee = has('sword', 'axe', 'hammer', 'spear', 'blade', 'katana', 'claw', 'fist', 'mace');
  const rapid = has('machine', 'minigun', 'laser', 'gatling', 'smg', 'rapid', 'auto', 'turret');
  const big = has('giant', 'huge', 'mega', 'titan', 'dragon', 'mech', 'fortress', 'boss', 'castle', 'palace');
  const color = fire ? '#ff6020' : ice ? '#a0e8ff' : has('laser', 'plasma') ? '#ff40ff' : '#ffe066';
  const name = prompt.trim().replace(/[^\w\s-]/g, '').split(/\s+/).filter((w) => w && !/^(a|an|the|that|which|with|of|and)$/i.test(w)).slice(0, 3).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Creation';
  const weapon = {
    name: melee ? 'Blade' : boom ? 'Launcher' : rapid ? 'Auto-gun' : 'Blaster',
    damage: melee ? 35 : boom ? 70 : rapid ? 8 : 18,
    fireRateMs: melee ? 450 : boom ? 1200 : rapid ? 80 : 400,
    range: melee ? 40 : boom ? 600 : 480,
    projectileSpeed: melee ? 0 : boom ? 420 : 750,
    splash: boom ? 55 : fire ? 20 : 0,
    count: has('shotgun', 'spread', 'scatter') ? 6 : 1,
    spread: rapid ? 0.08 : 0.03,
    melee,
    color,
  };
  const main = fire ? '#d04020' : ice ? '#60b0e0' : '#' + ((seed & 0x7f7f7f) + 0x404040).toString(16).padStart(6, '0');
  const r = (i) => hash2(i, seed & 0xffff, seed >>> 16);

  if (category === 'building') {
    let produces = 'none';
    if (has('barrack', 'academy', 'camp', 'fort', 'guild')) produces = has('archer', 'bow') ? 'archer' : has('rifle', 'gun', 'modern') ? 'rifleman' : 'knight';
    else if (has('hangar', 'airport', 'air')) produces = has('heli') ? 'helicopter' : 'fighter';
    else if (has('dock', 'port', 'shipyard')) produces = 'speedboat';
    else if (has('stable', 'ranch')) produces = 'horse';
    else if (has('zoo', 'den', 'kennel')) produces = 'wolf';
    else if (has('lab', 'ufo', 'alien')) produces = 'alien';
    else if (has('garage', 'factory', 'tank')) produces = 'humvee';
    const armed = boom || rapid || has('tower', 'turret', 'defen', 'cannon', 'laser', 'bunker', 'fort');
    // procedural building sprite: walls, K roof, windows, door
    const roof = has('blue') ? '#3a5ad0' : null;
    const pal = [{ ch: 'w', color: has('stone', 'castle', 'fort', 'bunker') ? '#9a9a9a' : '#c9a46a' }, { ch: 'o', color: '#1a1a1e' }, { ch: 'g', color: '#9fd8ff' }, { ch: 'd', color: '#5a3a1c' }, { ch: 'x', color }];
    if (roof) pal.push({ ch: 'R', color: roof });
    const R = roof ? 'R' : 'K';
    const rows = [];
    for (let y = 0; y < 16; y++) {
      let row = '';
      for (let x = 0; x < 16; x++) {
        let ch = '.';
        if (y >= 1 && y <= 6 && x >= 1 && x <= 14) ch = y === 1 || x === 1 || x === 14 ? 'o' : y === 6 ? 'k' : R;
        else if (y >= 7 && y <= 15 && x >= 2 && x <= 13) ch = y === 15 || x === 2 || x === 13 ? 'o' : 'w';
        if (y >= 9 && y <= 10 && (x === 4 || x === 5 || x === 10 || x === 11)) ch = 'g';
        if (y >= 11 && y <= 14 && x >= 7 && x <= 8) ch = 'd';
        if (armed && y >= 3 && y <= 4 && x >= 6 && x <= 9) ch = 'x';
        row += ch;
      }
      rows.push(row);
    }
    return normalizeCreation('building', {
      name,
      description: 'Built from: ' + prompt.slice(0, 120),
      size: big ? 3 : has('small', 'tiny', 'hut', 'tower', 'turret') ? 1 : 2,
      hp: big ? 3000 : 900,
      hasWeapon: armed,
      weapon,
      produces,
      productionSeconds: 30,
      palette: pal,
      pixels: rows,
    });
  }

  let domain = category === 'vehicle' ? 'land' : 'foot';
  if (has('fly', 'jet', 'plane', 'dragon', 'bird', 'heli', 'air', 'wing', 'drone', 'ufo')) domain = 'air';
  else if (has('ship', 'boat', 'sub', 'shark', 'sea', 'navy', 'whale', 'kraken')) domain = 'water';
  const pal = [{ ch: 'a', color: main }, { ch: 'o', color: '#1a1a1e' }, { ch: 'e', color: '#ffffff' }, { ch: 'x', color }];
  const grid = Array.from({ length: 16 }, () => Array(16).fill('.'));
  for (let y = 2; y < 14; y++)
    for (let x = 0; x < 6; x++) {
      const v = r(y * 16 + x);
      const fill = v < 0.55 - Math.abs(y - 8) * 0.02;
      const ch = fill ? (v < 0.08 ? 'x' : v < 0.14 ? 'K' : 'a') : '.';
      grid[y][2 + x] = ch;
      grid[y][13 - x] = ch;
    }
  grid[6][6] = grid[6][9] = 'e';
  const out = grid.map((row) => row.slice());
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++)
      if (grid[y][x] === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy]?.[x + dx] && grid[y + dy][x + dx] !== '.')) out[y][x] = 'o';
  return normalizeCreation(category, {
    name,
    description: 'Forged from: ' + prompt.slice(0, 120),
    domain,
    hp: (category === 'vehicle' ? 600 : 140) * (big ? 3 : 1),
    speed: domain === 'air' ? 230 : category === 'vehicle' ? 80 : 90,
    personality: big ? 'proud and thunderous' : 'loyal and eager',
    weapon,
    palette: pal,
    pixels: out.map((row) => row.join('')),
  });
}

// ---------------------------------------------------------------------------
// NPC conversation
// ---------------------------------------------------------------------------
// The ORDER is decided by parseIntent (reliable rules + world lookups on the server);
// the AI only writes what the NPC says, told exactly what it is about to do.
const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply'],
  properties: { reply: { type: 'string' } },
};

export async function npcTalk(ctx) {
  const role = ctx.civilian ? `a civilian (${ctx.npcType}) living in the Kingdom of ${ctx.kingdomName}` : ctx.inVehicle ? `the crew of a ${ctx.npcType} in the forces of the Kingdom of ${ctx.kingdomName}` : `a ${ctx.npcType} serving in the army of the Kingdom of ${ctx.kingdomName}`;
  const system = `You are ${ctx.npcName}, ${role}, in Pixel Kingdoms, a sandbox world of rival kingdoms, free towns, wild animals and alien invaders, with knights AND modern jets, helicopters, tanks and warships.
Your ruler is ${ctx.kingName}. Personality: ${ctx.personality}.
You are fiercely loyal. Speak in character, vivid and specific, 1-2 short sentences, as dialogue only (no stage directions, no labels, no quotes).`;
  const history = (ctx.history || []).slice(-6).map((h) => `${h.who === 'ruler' ? 'Ruler' : 'You'}: ${h.text}`).join('\n');
  const situation = ctx.action
    ? `You are obeying this order right now: ${ctx.action}. Confirm it in character (mention what you're doing).`
    : ctx.failure
      ? `You cannot do what was asked because ${ctx.failure}. Say so respectfully and suggest what would work.`
      : `There is no order to carry out: just answer the ruler naturally, using what you know.`;
  const user = `What you know right now:
- Your current task: ${ctx.doing || ctx.mode}. Health ${ctx.hp}/${ctx.maxHp}.${ctx.inVehicle ? ` You are aboard, ${ctx.flightState}.` : ''}
- Your kingdom: ${ctx.armySize} soldiers/vehicles, ${ctx.civilians} civilians, ${ctx.buildings} buildings, ${ctx.towns} towns. Castle ${ctx.castle ? 'standing' : 'DESTROYED'}.
- Nearby: ${ctx.nearby || 'nothing notable'}. Terrain here: ${ctx.terrain}.
- Empty vehicles nearby: ${ctx.emptyVehicles || 'none'}.
- Rival kingdoms: ${ctx.rivals}. ${ctx.alienThreat ? 'Aliens have been sighted in the land!' : ''}
${history ? `Conversation so far:\n${history}\n` : ''}Your ruler says: "${String(ctx.text).slice(0, 300)}"
${situation}`;
  try {
    const { data, via } = await askJson(system, user, REPLY_SCHEMA, 600);
    let reply = String(data.reply || '').replace(/^["“]|["”]$/g, '').trim();
    if (!goodReply(reply)) reply = fallbackLine(ctx);
    return { reply: reply.slice(0, 300), ai: via };
  } catch {
    return { reply: fallbackLine(ctx), ai: 'offline' };
  }
}

// reject the junk small models sometimes produce ("guard", "command", "reply: …")
function goodReply(r) {
  if (!r || r.length < 8 || !/\s/.test(r)) return false;
  if (/^(command|reply|vehicle|everyone|action|order)\s*[:=]/i.test(r) || /"(command|reply)"/.test(r)) return false;
  if (/^(guard|attack|follow|wander|board|land|takeoff|dismount|none|move|retreat|patrol)\.?$/i.test(r)) return false;
  return true;
}

const LINES = {
  follow: ['Right behind you, my liege!', 'Lead the way, I follow.', 'At your side, sire.'],
  guard: ['None shall pass while I stand.', 'Holding this ground, sire.', 'I will stand right here.'],
  move: ['On my way!', 'Moving out now, sire.', 'Heading there at once.'],
  attack: ['For the kingdom! CHARGE!', 'They will regret crossing us!', 'Engaging the enemy!'],
  retreat: ['Falling back!', 'Pulling back to safety, sire.', 'Retreating, as you command.'],
  defend: ['I will defend it with my life.', 'Taking up a defensive position.'],
  capture: ['That town will fly our banner by nightfall!', 'Moving to take the town.'],
  patrol: ['Starting my patrol.', 'I will keep watch over the area.'],
  wander: ['A moment of peace, then. Thank you.', 'I will stretch my legs nearby.'],
  board: ['On my way to the cockpit!', 'Climbing aboard now, sire.'],
  land: ['Bringing her down.', 'Lining up for landing.'],
  takeoff: ['Wheels up!', 'Taking off, sire!'],
  dismount: ['Getting out now.', 'Hopping out, my liege.'],
  fail: ["I'm afraid I can't do that here, sire.", 'That is beyond me, my liege.'],
};
function fallbackLine(ctx) {
  const opts = ctx.failure ? [`Forgive me, sire, ${ctx.failure}.`] : LINES[ctx.command] || [`At your service, ${ctx.kingName}.`, ctx.enemiesNear ? 'Enemies are close, stay sharp!' : 'All quiet here, my liege.', ctx.civilian ? 'The harvest looks good this year, my liege.' : 'Our kingdom grows stronger every day.'];
  return opts[Math.floor(Math.random() * opts.length)];
}

// ---------------------------------------------------------------------------
// Order understanding: rules, not a small LLM, so orders are always obeyed.
// Returns { command, everyone, vehicle, place, here, there, question }
// ---------------------------------------------------------------------------
export function parseIntent(text) {
  const t = ' ' + String(text).toLowerCase().replace(/[^\w\s'-]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const has = (re) => re.test(t);
  const everyone = has(/\b(all|everyone|everybody|army|troops|men|squad|soldiers|units|guys|team|forces)\b/);
  let vehicle = '';
  for (const [words] of VEHICLE_WORDS) {
    const m = t.match(new RegExp(`\\b(${words})\\b`));
    if (m) {
      vehicle = m[1];
      break;
    }
  }
  const place = has(/\b(castle|keep|throne|capital)\b/) ? 'castle' : has(/\b(airport|airfield|runway|air base|airbase)\b/) ? 'airport' : has(/\b(military base|army base|the base|our base|barracks|camp|bunker)\b/) ? 'base' : has(/\b(hospital|medic|doctor|heal)\b/) ? 'hospital' : has(/\b(harbou?r|port|docks?|shipyard|shore|coast)\b/) ? 'harbor' : has(/\b(helipad)\b/) ? 'helipad' : has(/\b(home)\b/) ? 'castle' : null;
  const here = has(/\b(here|to me|over here|my position|my location|where i am)\b/);
  const there = has(/\b(there|over there|that way|that spot|that place|where i( a)?m (pointing|aiming)|the cursor|that)\b/);
  const question = /^\s*(what|where|how|why|who|whose|when|are|is|do|does|did|can you tell|tell me|status|report|any)\b/.test(t) && !has(/\b(go|attack|move|follow|come|retreat|land|take off|get out|fly|board|capture|defend)\b/);
  let command = 'none';
  if (question) command = 'none';
  else if (has(/\b(take ?off|lift ?off|scramble|get airborne|launch|wheels up)\b/)) command = 'takeoff';
  else if (has(/\b(land|touch down|set (it|her) down|bring (it|her) down)\b/) && !has(/\bland (the|a|our|your|that)\b/)) command = 'land';
  else if (has(/\b(get out|get down|dismount|hop out|bail out|climb out|step out|disembark|exit|leave the|abandon)\b/)) command = 'dismount';
  else if (has(/\b(board|get in|get into|hop in|climb in|fly|pilot|drive|take the|take a|take that|man the|crew the|use the|jump in|go fly)\b/) && (vehicle || has(/\b(fly|pilot|board|get in|drive)\b/))) command = 'board';
  else if (has(/\b(retreat|fall back|run away|withdraw|pull back|back off|regroup|flee|escape)\b/)) command = 'retreat';
  else if (has(/\b(capture|take over|conquer|seize|occupy|claim|liberate)\b/)) command = 'capture';
  else if (has(/\b(patrol|scout|sweep|keep watch|recon|look around)\b/)) command = 'patrol';
  else if (has(/\b(follow|come|come here|escort|with me|to me|protect me|guard me|cover me|stay close|stick with)\b/)) command = 'follow';
  else if (has(/\b(defend|protect|secure|hold the|guard the)\b/) && (place || there)) command = 'defend';
  else if (has(/\b(attack|charge|kill|fight|destroy|hunt|assault|raid|engage|bomb|shoot|strike|invade|smash|crush|wipe)\b/)) command = 'attack';
  else if (has(/\b(go|move|head|walk|run|march|travel|get to|go to|sail|drive to|fly to)\b/) && (place || there || here || / to /.test(t))) command = here && !there && !place ? 'follow' : 'move';
  else if (has(/\b(hold|stay|stop|halt|wait|stand|freeze|guard|don't move|dont move|stay put|hold position|defend|protect)\b/)) command = 'guard';
  else if (has(/\b(at ease|relax|rest|dismissed|wander|free roam|take a break|chill)\b/)) command = 'wander';
  return { command, everyone, vehicle, place, here, there, question, text: t };
}
// vehicle words a ruler might use, mapped to unit-name fragments
export const VEHICLE_WORDS = [
  ['helicopter|heli|chopper|apache', 'apache|prachand|hind|chinook|helicopter'], ['chinook', 'chinook'], ['hind', 'hind'], ['prachand', 'prachand'],
  ['f-16|f16|falcon', 'f-16'], ['tejas', 'tejas'], ['rafale', 'rafale'], ['su-30|su30|flanker|sukhoi', 'su-30'], ['f-22|f22|raptor', 'f-22'], ['f-35|f35|lightning', 'f-35'],
  ['mig', 'mig'], ['typhoon|eurofighter', 'typhoon'], ['a-10|a10|warthog', 'a-10'], ['b-52|b52|stratofortress', 'b-52'], ['b-2|b2|spirit|stealth bomber', 'b-2'],
  ['bomber', 'b-52|b-2'], ['drone|reaper', 'reaper'], ['jet|plane|fighter|aircraft|airplane', 'f-16|tejas|rafale|su-30|f-22|f-35|mig|typhoon|a-10|prop fighter'],
  ['abrams', 'abrams'], ['arjun', 'arjun'], ['t-90|t90', 't-90'], ['tank', 'abrams|arjun|t-90'], ['apc', 'apc'], ['humvee|jeep|truck', 'humvee'],
  ['artillery|howitzer', 'howitzer'], ['rocket launcher|mlrs', 'rocket launcher'], ['destroyer', 'destroyer'], ['frigate', 'frigate'], ['corvette', 'corvette'],
  ['battleship', 'battleship'], ['carrier', 'carrier'], ['submarine|sub', 'submarine'], ['speedboat|boat', 'speedboat|corvette'], ['ship|warship', 'frigate|destroyer|corvette|battleship'],
];

function keywordOrder(text) {
  const t = String(text).toLowerCase();
  const everyone = /\b(all|everyone|army|troops|men|squad)\b/.test(t);
  let vehicle = '';
  for (const [words] of VEHICLE_WORDS) {
    const m = t.match(new RegExp(`\\b(${words})\\b`));
    if (m) {
      vehicle = m[1];
      break;
    }
  }
  let command = 'none';
  if (/\b(take ?off|lift ?off|scramble|get airborne)\b/.test(t)) command = 'takeoff';
  else if (/\b(land|touch down|set (it|her) down)\b/.test(t)) command = 'land';
  else if (/\b(get out|get down|dismount|hop out|bail out|exit|leave the|step out|disembark)\b/.test(t)) command = 'dismount';
  else if (/\b(board|get in|get into|hop in|climb in|fly|pilot|drive|take the|take a|man the|crew the|go fly)\b/.test(t) && (vehicle || /\b(fly|pilot|board|get in)\b/.test(t))) command = 'board';
  else if (/\b(follow|come with|escort|with me|to me)\b/.test(t)) command = 'follow';
  else if (/\b(guard|hold|defend|stay here|protect)\b/.test(t)) command = 'guard';
  else if (/\b(attack|charge|fight|kill|hunt|destroy|assault|raid)\b/.test(t)) command = 'attack';
  else if (/\b(at ease|wander|rest|relax|dismissed)\b/.test(t)) command = 'wander';
  return { command, everyone, vehicle };
}

// ---------------------------------------------------------------------------
// Living NPCs: AI-written barks (battle cries, panic, idle chatter...) kept in a shared bank,
// and short AI conversations between NPCs standing near players.
// ---------------------------------------------------------------------------
export const BARK_ROLES = {
  soldier: 'a foot soldier (knight, archer or rifleman) of a medieval-meets-modern kingdom',
  pilot: 'a fighter / helicopter pilot on the radio',
  sailor: 'a warship sailor or captain',
  tanker: 'a tank or armoured-vehicle crewman',
  civilian: 'a townsperson (villager, farmer, merchant)',
  militia: 'a free-town militia guard defending their town',
  alien: 'an invading alien trooper speaking in eerie broken phrases',
};
export const BARK_SITUATIONS = {
  idle: 'a quiet moment, small talk',
  battle: 'enemies just spotted, combat begins',
  wounded: 'badly hurt in battle',
  victory: 'just defeated an enemy',
  flee: 'panicking and running from danger',
  march: 'ordered to march and attack',
  capture: 'their side just captured a town',
  invade: 'aliens are invading the land',
  night: 'it is night time, dark and tense',
};

export const FALLBACK_BARKS = {
  'soldier:idle': ['Quiet day. Too quiet.', 'My boots need mending.', 'Long live the crown!'],
  'soldier:battle': ['Enemy spotted! To arms!', 'Shields up, here they come!', 'For the kingdom!'],
  'soldier:wounded': ['I\'m hit! Medic!', 'Just a scratch… mostly.', 'Need to fall back!'],
  'soldier:victory': ['One less to worry about.', 'Ha! Next!', 'Victory is ours!'],
  'soldier:march': ['Marching out!', 'Onward!', 'Move, move, move!'],
  'soldier:night': ['Keep the torches lit.', 'Who goes there?'],
  'pilot:battle': ['Bandits, engaging!', 'Fox two!', 'Tally ho!'],
  'pilot:idle': ['Clear skies today.', 'Fuel\'s good, ammo\'s good.'],
  'pilot:wounded': ['Mayday, mayday!', 'I\'m losing altitude!'],
  'pilot:victory': ['Splash one!', 'Target down!'],
  'sailor:battle': ['Enemy off the bow!', 'All guns, fire!'],
  'sailor:idle': ['Calm seas, captain.', 'Smell that salt air.'],
  'tanker:battle': ['Target acquired, firing!', 'Load HEAT!'],
  'tanker:idle': ['Engine purrs like a kitten.'],
  'civilian:idle': ['Fresh bread, two coins!', 'Lovely weather.', 'Did you hear about the aliens?'],
  'civilian:flee': ['Run for your lives!', 'Help! Guards!', 'Not my cabbages!'],
  'militia:battle': ['Defend the town!', 'Not one step further!'],
  'militia:idle': ['All quiet at the gate.'],
  'alien:battle': ['Zxx… humans detected.', 'Resistance… futile.'],
  'alien:invade': ['This planet… ours now.', 'Begin harvest.'],
};

const BARK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lines'],
  properties: {
    lines: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['key', 'text'], properties: { key: { type: 'string' }, text: { type: 'string' } } },
    },
  },
};

// keys look like "soldier:battle"; returns { key: [lines...] }
export async function barkBatch(keys) {
  const list = keys
    .filter((k) => BARK_ROLES[k.split(':')[0]] && BARK_SITUATIONS[k.split(':')[1]])
    .map((k) => `- ${k}: ${BARK_ROLES[k.split(':')[0]]}, ${BARK_SITUATIONS[k.split(':')[1]]}`)
    .join('\n');
  if (!list) return {};
  const system = `You write short spoken lines ("barks") for NPCs in Pixel Kingdoms, a pixel-art sandbox war game where medieval kingdoms fight with knights AND modern jets, tanks and warships, plus wild animals and alien invaders.
Each line: max 12 words, punchy, in character, varied, a little funny sometimes. No quotation marks, no emojis.`;
  const user = `Write 3 different lines for EACH of these keys. Use the exact key string in "key".\n${list}`;
  try {
    const { data } = await askJson(system, user, BARK_SCHEMA, 1500, 'low');
    const out = {};
    for (const l of Array.isArray(data.lines) ? data.lines : []) {
      const key = String(l?.key || '').trim().toLowerCase();
      const text = String(l?.text || '').replace(/["“”]/g, '').trim().slice(0, 90);
      if (!keys.includes(key) || text.length < 2) continue;
      (out[key] ||= []).push(text);
    }
    return out;
  } catch {
    return {};
  }
}

const DIALOGUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lines'],
  properties: {
    lines: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['speaker', 'text'], properties: { speaker: { type: 'integer', enum: [0, 1] }, text: { type: 'string' } } },
    },
  },
};

export async function npcDialogue(a, b, situation) {
  const system = `You write a tiny overheard conversation between two NPCs in Pixel Kingdoms, a pixel-art sandbox war game (medieval kingdoms + modern jets, tanks, warships, wild animals, alien invasions).
3 or 4 lines total, alternating speakers, each max 16 words. Natural, characterful, specific to what's around them, a bit of humour. speaker 0 = ${a.name}, speaker 1 = ${b.name}.`;
  const user = `${a.name}: ${a.type}, personality: ${a.personality}.
${b.name}: ${b.type}, personality: ${b.personality}.
Situation: ${situation}`;
  try {
    const { data } = await askJson(system, user, DIALOGUE_SCHEMA, 800, 'low');
    // be lenient: small models vary field names and speaker formats
    const raw = Array.isArray(data) ? data : Array.isArray(data.lines) ? data.lines : Array.isArray(data.dialogue) ? data.dialogue : Object.values(data).find(Array.isArray) || [];
    const bFirst = b.name.split(' ')[0].toLowerCase();
    return raw
      .map((l, i) => {
        if (typeof l === 'string') return { speaker: i % 2, text: l };
        const sp = l?.speaker;
        const speaker = sp === 1 || sp === '1' || (typeof sp === 'string' && sp.toLowerCase().includes(bFirst)) ? 1 : sp === 0 || sp === '0' || typeof sp === 'string' ? 0 : i % 2;
        return { speaker, text: String(l?.text ?? l?.line ?? l?.dialogue ?? l?.content ?? '') };
      })
      .map((l) => ({ ...l, text: l.text.replace(/^[^:]{1,30}:\s*/, '').replace(/["“”]/g, '').trim().slice(0, 120) }))
      .filter((l) => l.text.length > 1)
      .slice(0, 4);
  } catch {
    return [];
  }
}

function fallbackTalk(ctx) {
  let { command, everyone } = keywordOrder(ctx.text);
  if (ctx.civilian && command !== 'follow' && command !== 'wander') command = 'none';
  const lines = {
    board: ctx.canFly ? ['On my way to the cockpit!', 'Strapping in now, my liege.'] : ['I can drive tanks, trucks and boats, sire, but I am no pilot.', 'If it has wheels or tracks, I will take it!'],
    land: ['Bringing her down.', 'Lining up for landing.'],
    takeoff: ['Wheels up!', 'Taking off, sire!'],
    dismount: ['Getting out now.', 'Hopping out, my liege.'],
    follow: ['Right behind you, my liege!', 'Lead the way, I follow.'],
    guard: ['None shall pass while I stand.', 'I will hold this ground.'],
    attack: ['For the kingdom! CHARGE!', 'They will regret crossing us!'],
    wander: ['A moment of peace, then. Thank you.', 'I will stretch my legs nearby.'],
    none: [`At your service, ${ctx.kingName}.`, 'Our kingdom grows stronger every day.', ctx.civilian ? 'The harvest looks good this year, my liege.' : ctx.enemiesNear ? 'Enemies are close, stay sharp!' : 'All quiet here, my liege.'],
  };
  const opts = lines[command];
  return { reply: opts[Math.floor(Math.random() * opts.length)], command, everyone };
}

// ---------------------------------------------------------------------------
// AI regent: strategy for kingdoms with no human ruler
// ---------------------------------------------------------------------------
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['speech', 'strategy', 'targetKingdom', 'build', 'recruit'],
  properties: {
    speech: { type: 'string' },
    strategy: { type: 'string', enum: ['defend', 'expand', 'attack', 'capture_towns'] },
    targetKingdom: { type: 'string' },
    build: { type: 'array', items: { type: 'string', enum: Object.keys(BUILDINGS).filter((b) => b !== 'castle') } },
    recruit: { type: 'array', items: { type: 'string', enum: UNIT_KEYS.filter((u) => !UNITS[u].civ && UNITS[u].group !== 'Animals') } },
  },
};

export async function regentPlan(ctx) {
  const system = `You are the AI Regent ruling the Kingdom of ${ctx.name} in Pixel Kingdoms, a real-time sandbox war game. Play to survive and dominate, with personality.
Choose a strategy for the next few minutes: defend (fortify, keep army home), expand (build economy, capture free towns), attack (raid a rival kingdom), capture_towns (take neutral or rival towns).
Pick up to 3 buildings to construct and up to 6 units to recruit. targetKingdom is the rival to attack (or "" if none); never name an ally.
"speech" is a short, dramatic royal proclamation (max 25 words) announced to every player.`;
  const user = `Your state: ${ctx.units} army units, ${ctx.civilians} civilians, ${ctx.buildings} buildings, ${ctx.towns} towns, castle health ${ctx.castleHp}%.
Under attack recently: ${ctx.underAttack ? 'YES' : 'no'}. Aliens sighted: ${ctx.aliens ? 'yes' : 'no'}.
Allies (your coalition, never attack them): ${ctx.allies || 'none'}
Rivals: ${ctx.rivals}
Free towns still unclaimed: ${ctx.freeTowns}.`;
  try {
    const { data } = await askJson(system, user, PLAN_SCHEMA, 2000, 'low');
    return {
      speech: String(data.speech || '').slice(0, 200),
      strategy: ['defend', 'expand', 'attack', 'capture_towns'].includes(data.strategy) ? data.strategy : 'expand',
      targetKingdom: String(data.targetKingdom || ''),
      build: (Array.isArray(data.build) ? data.build : []).filter((b) => BUILDINGS[b] && b !== 'castle' && !BUILDINGS[b].decor && !BUILDINGS[b].town).slice(0, 3),
      recruit: (Array.isArray(data.recruit) ? data.recruit : []).filter((u) => UNITS[u] && !UNITS[u].civ).slice(0, 6),
      ai: true,
    };
  } catch {
    return null; // caller uses its built-in heuristics
  }
}
