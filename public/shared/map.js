// Deterministic world generator shared by server (collision/AI) and client (rendering).
// Same seed + size (+ world) => identical map everywhere, so the map never has to be sent over the wire.
// world: 'random' (procedural continents) or a real-world map from ./geo.js ('india', 'earth').
import { generateGeoMap, geoSpawns } from './geo.js';

export const TILE = 16; // world pixels per tile
export const T = { DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, FOREST: 4, HILL: 5, MOUNTAIN: 6, SNOW: 7 };
export const TILE_NAMES = ['Deep sea', 'Water', 'Sand', 'Grass', 'Forest', 'Hills', 'Mountains', 'Snow'];

// Movement multiplier per tile for each domain (0 = impassable)
export const SPEED = {
  foot: [0, 0.45, 0.9, 1, 0.75, 0.8, 0.6, 0.7],
  land: [0, 0, 0.9, 1, 0.7, 0.75, 0.5, 0.6],
  water: [1, 0.9, 0, 0, 0, 0, 0, 0],
  air: [1, 1, 1, 1, 1, 1, 1, 1],
};

export function rng(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, s, oct) {
  let sum = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, y * f, s + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// Elevation is kept (quantised) so the client can hill-shade terrain and shade water by depth.
export const ELEV_MAX = 1.3;
export function elevAt(map, tx, ty) {
  tx = Math.max(0, Math.min(map.size - 1, tx | 0));
  ty = Math.max(0, Math.min(map.size - 1, ty | 0));
  return (map.elev[ty * map.size + tx] / 255) * ELEV_MAX;
}

export function generateMap(size, seed, world = 'random') {
  if (world && world !== 'random') return { size, seed, world, ...generateGeoMap(size, world, ELEV_MAX) };
  const tiles = new Uint8Array(size * size);
  const elev = new Uint8Array(size * size);
  // feature size grows with the map but caps out, so huge maps get more continents/islands, not just bigger ones
  const scale = Math.min(size / 6, 110);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x / size - 0.5, dy = y / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      let e = fbm(x / scale, y / scale, seed, 6);
      e = (e - 0.5) * 2.2 + 0.5;            // stretch contrast
      e += 0.16 - Math.max(0, d - 0.8) * 2.5;     // ocean around the edges, land in the middle
      const m = fbm(x / (scale * 0.6) + 500, y / (scale * 0.6) + 500, seed + 7, size > 900 ? 3 : 4);
      let t;
      if (e < 0.30) t = T.DEEP;
      else if (e < 0.38) t = T.WATER;
      else if (e < 0.41) t = T.SAND;
      else if (e > 1.1) t = T.SNOW;
      else if (e > 0.93) t = T.MOUNTAIN;
      else if (e > 0.82) t = T.HILL;
      else if (m > 0.52) t = T.FOREST;
      else t = T.GRASS;
      tiles[y * size + x] = t;
      elev[y * size + x] = Math.round((Math.max(0, Math.min(ELEV_MAX, e)) / ELEV_MAX) * 255);
    }
  }
  return { size, seed, world: 'random', tiles, elev };
}

export function tileAt(map, wx, wy) {
  const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
  if (tx < 0 || ty < 0 || tx >= map.size || ty >= map.size) return -1;
  return map.tiles[ty * map.size + tx];
}

export function speedAt(map, wx, wy, domain) {
  const t = tileAt(map, wx, wy);
  if (t < 0) return 0;
  return SPEED[domain][t];
}

// Pick N well-separated land spawn points for kingdoms
export function findSpawns(map, n, seed) {
  if (map.world && map.world !== 'random') {
    // real capitals, snapped to the nearest open patch of land
    return geoSpawns(map, n, seed).map((c) => {
      const cx = Math.round(c.t[0]), cy = Math.round(c.t[1]);
      let found = null;
      for (let s = 0; s < 40 && !found; s++)
        for (let k = 0; k < 16 && !found; k++) {
          const x = Math.round(cx + Math.cos((k / 16) * Math.PI * 2) * s), y = Math.round(cy + Math.sin((k / 16) * Math.PI * 2) * s);
          if (patchOk(map, x, y)) found = { tx: x, ty: y };
        }
      return { ...(found || { tx: cx, ty: cy }), realm: c.realm, city: c.name };
    });
  }
  const r = rng(seed + 99);
  const c = map.size / 2;
  const out = [];
  const rad = map.size * 0.28;
  const off = r() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    let bx = Math.round(c + Math.cos(a) * rad), by = Math.round(c + Math.sin(a) * rad);
    // spiral search for a 5x5 patch of grass/sand/forest
    let found = null;
    for (let s = 0; s < map.size / 2 && !found; s++) {
      for (let k = 0; k < 16 && !found; k++) {
        const aa = (k / 16) * Math.PI * 2;
        const x = Math.round(bx + Math.cos(aa) * s), y = Math.round(by + Math.sin(aa) * s);
        if (patchOk(map, x, y)) found = { tx: x, ty: y };
      }
    }
    out.push(found || { tx: bx, ty: by });
  }
  return out;
}

function patchOk(map, x, y) {
  for (let j = -3; j <= 3; j++)
    for (let i = -3; i <= 3; i++) {
      const xx = x + i, yy = y + j;
      if (xx < 1 || yy < 1 || xx >= map.size - 1 || yy >= map.size - 1) return false;
      const t = map.tiles[yy * map.size + xx];
      if (t !== T.GRASS && t !== T.SAND && t !== T.FOREST) return false;
    }
  return true;
}

export function nearestTile(map, tx, ty, maxR, pred) {
  for (let r = 0; r <= maxR; r++) {
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const x = tx + i, y = ty + j;
        if (x < 0 || y < 0 || x >= map.size || y >= map.size) continue;
        if (pred(map.tiles[y * map.size + x])) return { tx: x, ty: y };
      }
  }
  return null;
}
