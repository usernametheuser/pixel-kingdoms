// Pixel Kingdoms graphics engine: terrain synthesis, procedural pixel art (trees, buildings,
// shaded/animated sprites), particles, dynamic lighting, clouds and weather.
import { TILE, T, hash2, ELEV_MAX } from './shared/map.js';
import { shade } from './shared/defs.js';

// ------------------------------------------------------------------ helpers
export function canvas(w, h) {
  // works on the main thread and inside Web Workers (OffscreenCanvas)
  if (typeof document === 'undefined') return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
const hex = (s) => {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgb = (a) => `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Tileable value-noise texture: fast lookups for per-pixel terrain work
const NT = new Float32Array(256 * 256);
(() => {
  const P = 32;
  const lat = (x, y, s) => hash2(((x % P) + P) % P, ((y % P) + P) % P, s);
  const vn = (x, y, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = lat(xi, yi, s), b = lat(xi + 1, yi, s), c = lat(xi, yi + 1, s), d = lat(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) NT[y * 256 + x] = vn(x / 8, y / 8, 11) * 0.65 + vn(x / 4, y / 4, 23) * 0.35;
})();
export const nz = (x, y) => NT[((y | 0) & 255) * 256 + ((x | 0) & 255)];

// ------------------------------------------------------------------ terrain
const PAL = {
  [T.SAND]: ['#d8c48a', '#ecdca8', '#f2e4b4', '#faf0cc'].map(hex),
  [T.GRASS]: ['#58a850', '#78c868', '#80d070', '#a8e490'].map(hex),
  [T.FOREST]: ['#3a8a44', '#50a454', '#58ac5a', '#78c470'].map(hex),
  [T.HILL]: ['#78a85a', '#94c470', '#9ccc78', '#bcdc94'].map(hex),
  [T.MOUNTAIN]: ['#9a7e60', '#c0a482', '#c8ac8a', '#e0caa6'].map(hex),
  [T.SNOW]: ['#c8d8ec', '#e8f0fa', '#f0f6fc', '#ffffff'].map(hex),
};
const DEEP = hex('#2a64b8'), MID = hex('#4088d8'), SHALLOW = hex('#68b4f4'), FOAM = hex('#f4fbff'), WET = hex('#c8b07a');
const FLOWERS = ['#ffffff', '#ffe066', '#ff8fb8', '#9ad0ff', '#ff6b5b', '#c79bff'];
export const CH = 32; // tiles per chunk

export class Terrain {
  constructor(map) {
    this.map = map;
    this.cache = new Map();
    this.building = 0;
  }
  key(cx, cy) {
    return cx + ',' + cy;
  }
  // returns a chunk if ready; builds at most `budget` new chunks per frame so the game never hitches
  get(cx, cy, allowBuild) {
    const k = this.key(cx, cy);
    let c = this.cache.get(k);
    if (c) {
      c.used = performance.now();
      return c;
    }
    if (!allowBuild) return null;
    c = this.build(cx, cy);
    this.cache.set(k, c);
    if (this.cache.size > 90) {
      let oldest = null;
      for (const [kk, v] of this.cache) if (!oldest || v.used < oldest[1].used) oldest = [kk, v];
      this.cache.delete(oldest[0]);
    }
    return c;
  }

  elev(fx, fy) {
    const m = this.map, S = m.size;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const cx = (v) => (v < 0 ? 0 : v >= S ? S - 1 : v);
    const xa = cx(x0), xb = cx(x0 + 1), ya = cx(y0), yb = cx(y0 + 1);
    const e = m.elev;
    const a = e[ya * S + xa], b = e[ya * S + xb], c = e[yb * S + xa], d = e[yb * S + xb];
    return ((a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty) / 255) * ELEV_MAX;
  }

  // step = level of detail: 1 = full 512px chunk, 2 = 256px, 4 = 128px (for zoomed-out views)
  build(cx, cy, step = 1) {
    const m = this.map, S = m.size, tiles = m.tiles;
    const PX = CH * TILE, RES = PX / step, half = step >> 1;
    const cv = canvas(RES, RES);
    const g = cv.getContext('2d');
    const img = g.createImageData(RES, RES);
    const d = img.data;
    const ox = cx * PX, oy = cy * PX;
    for (let py = 0; py < RES; py++) {
      const wy = oy + py * step + half;
      for (let px = 0; px < RES; px++) {
        const wx = ox + px * step + half;
        // domain-warped biome lookup = organic, wavy borders instead of square tiles
        const wxw = wx + (nz(wx * 0.4, wy * 0.4) - 0.5) * 18;
        const wyw = wy + (nz(wx * 0.4 + 131, wy * 0.4 + 71) - 0.5) * 18;
        let tx = wxw >> 4, ty = wyw >> 4;
        if (tx < 0) tx = 0; else if (tx >= S) tx = S - 1;
        if (ty < 0) ty = 0; else if (ty >= S) ty = S - 1;
        const t = tiles[ty * S + tx];
        const fx = wx / 16 - 0.5, fy = wy / 16 - 0.5;
        const e = this.elev(fx, fy);
        let col;
        if (t <= T.WATER) {
          const f = clamp01((e - 0.1) / 0.28);
          col = f < 0.6 ? mix(DEEP, MID, f / 0.6) : mix(MID, SHALLOW, (f - 0.6) / 0.4);
          const n = nz(wx * 0.5, wy * 0.5);
          col = mix(col, SHALLOW, (n - 0.5) * 0.2);
          // tidy rows of little white wave dashes, like handheld RPG water tiles
          const lx = wx & 15, ly = wy & 15, row = (wy >> 4) & 1;
          if (ly === 7 && ((lx + row * 8) & 15) >= 3 && ((lx + row * 8) & 15) <= 6) col = mix(col, FOAM, 0.55);
          const foamLine = 0.367 + (nz(wx * 0.8, wy * 0.8) - 0.5) * 0.014;
          if (e > foamLine) col = mix(col, FOAM, e > foamLine + 0.005 ? 0.8 : 0.4);
        } else {
          const pal = PAL[t] || PAL[T.GRASS];
          // broad, soft colour patches (modern pixel-art look) with a light dithered edge between tones
          const v = nz(wx * 0.55, wy * 0.55) * 0.72 + nz(wx * 1.6 + 50, wy * 1.6 + 20) * 0.28 + (((wx + wy) & 1) ? 0.012 : -0.012);
          // flat, clean two-tone ground with the classic per-tile tuft pattern
          let idx = v < 0.5 ? 1 : 2;
          const lx = wx & 15, ly = wy & 15;
          if (t === T.GRASS || t === T.HILL || t === T.FOREST) {
            for (const [ax, ay] of t === T.FOREST ? [[2, 4], [10, 4], [6, 11], [13, 12]] : [[3, 5], [11, 12]]) {
              if (ly === ay && (lx === ax || lx === ax + 2)) idx = 0;
              else if (ly === ay - 1 && lx === ax + 1) idx = 3;
            }
          } else if (t === T.SAND && ((lx * 7 + ly * 5 + (wx >> 4) * 3) % 23) === 0) idx = 0;
          col = pal[idx];
          // wet sand along the shoreline
          if (e < 0.392 && t <= T.HILL) col = mix(col, WET, clamp01((0.392 - e) / 0.02) * 0.7);
          // hill-shading from elevation: light comes from the top-left
          const ex = this.elev(fx + 1, fy) - e, ey = this.elev(fx, fy + 1) - e;
          const k = t >= T.MOUNTAIN ? 4.2 : t === T.HILL ? 3.2 : 2.2;
          // terraced light: elevation steps read as neat ledges instead of a smooth gradient
          let sh = 1 + Math.round((ex + ey) * k * 4) / 4 * 0.6;
          sh = sh < 0.72 ? 0.72 : sh > 1.16 ? 1.16 : sh;
          col = [col[0] * sh, col[1] * sh, col[2] * (t === T.SNOW && sh < 1 ? sh * 1.05 + 0.04 : sh)];
        }
        const i = (py * RES + px) * 4;
        d[i] = col[0];
        d[i + 1] = col[1];
        d[i + 2] = col[2];
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // flat decorations + y-sorted objects (trees, rocks...)
    const objects = [];
    const R = step === 1 ? (x, y, w, h, c) => ((g.fillStyle = c), g.fillRect(x, y, w, h)) : () => {}; // decor only at full detail
    for (let j = 0; j < CH; j++)
      for (let i = 0; i < CH; i++) {
        const tx = cx * CH + i, ty = cy * CH + j;
        if (tx >= S || ty >= S) continue;
        const t = tiles[ty * S + tx];
        const h1 = hash2(tx, ty, 101), h2 = hash2(tx, ty, 202), h3 = hash2(tx, ty, 303);
        const px = i * TILE + Math.floor(h2 * 12) + 2, py = j * TILE + Math.floor(h3 * 12) + 2;
        const wx = cx * PX + px, wy = cy * PX + py;
        const same = () => {
          const wxw = wx + (nz(wx * 0.4, wy * 0.4) - 0.5) * 18, wyw = wy + (nz(wx * 0.4 + 131, wy * 0.4 + 71) - 0.5) * 18;
          return tiles[Math.min(S - 1, Math.max(0, wyw >> 4)) * S + Math.min(S - 1, Math.max(0, wxw >> 4))] === t;
        };
        if (t === T.GRASS || t === T.HILL) {
          if (h1 < 0.4 && same()) {
            const c1 = t === T.GRASS ? '#4a9a42' : '#6a9a4a', c2 = t === T.GRASS ? '#b0ec98' : '#cce4a0';
            R(px, py, 1, 3, c1);
            R(px + 2, py - 1, 1, 4, c1);
            R(px + 1, py + 1, 1, 2, c2);
            R(px + 4, py + 1, 1, 2, c1);
          } else if (h1 < 0.47 && t === T.GRASS && same()) {
            const fc = FLOWERS[Math.floor(h2 * FLOWERS.length)];
            for (let k = 0; k < 3; k++) {
              const fx = px + Math.floor(hash2(tx, ty, 400 + k) * 8), fy = py + Math.floor(hash2(tx, ty, 500 + k) * 8);
              R(fx, fy + 1, 1, 1, '#3e7a2e');
              R(fx, fy, 1, 1, fc);
            }
          }
        } else if (t === T.FOREST && h1 < 0.3 && same()) {
          R(px, py, 3, 1, '#2c5a25');
          R(px + 1, py - 1, 1, 3, '#2c5a25');
          if (h1 < 0.02) (R(px + 4, py + 2, 2, 1, '#d84040'), R(px + 4, py + 3, 2, 1, '#f0e0d0'));
        } else if (t === T.SAND && h1 < 0.08 && same()) {
          R(px, py, 2, 1, '#a89060');
          R(px, py - 1, 2, 1, '#f4e4b8');
        } else if (t === T.MOUNTAIN && h1 < 0.3 && same()) {
          R(px, py, 1, 1, '#4e473f');
          R(px + 1, py + 1, 1, 1, '#4e473f');
          R(px + 2, py + 1, 2, 1, '#4e473f');
        } else if (t === T.SNOW && h1 < 0.12) {
          R(px, py, 1, 1, '#ffffff');
        }
        // objects
        const ox2 = cx * PX + i * TILE + 2 + hash2(tx, ty, 606) * 12, oy2 = cy * PX + j * TILE + 4 + hash2(tx, ty, 707) * 11;
        const e = this.elev(tx, ty);
        let kind = null;
        const h4 = hash2(tx, ty, 404);
        if (t === T.FOREST) kind = e > 0.72 || h2 < 0.3 ? 'pine' : h2 < 0.38 ? 'bush' : h4 < 0.05 ? 'stump' : h4 < 0.09 ? 'log' : h4 < 0.13 ? 'mushroom' : 'oak';
        else if (t === T.GRASS) kind = h1 > 0.975 ? 'oak' : h1 > 0.955 ? 'bush' : h1 > 0.94 ? 'flowerbush' : h1 > 0.934 ? 'rock' : h1 > 0.93 ? 'stump' : null;
        else if (t === T.SAND) kind = e < 0.39 && h4 < 0.12 ? 'reeds' : h1 > 0.965 && e < 0.405 ? 'palm' : h1 > 0.955 ? 'rock' : null;
        else if (t === T.HILL) kind = h1 > 0.95 ? 'pine' : h1 > 0.9 ? 'rock' : h1 > 0.87 ? 'bush' : h1 > 0.85 ? 'boulder' : null;
        else if (t === T.MOUNTAIN) kind = h1 > 0.9 ? 'rock' : h1 > 0.85 ? 'boulder' : h1 > 0.82 ? 'pine' : null;
        else if (t === T.SNOW) kind = h1 > 0.88 ? 'snowpine' : h1 > 0.84 ? 'rock' : null;
        else if (t === T.WATER && e > 0.33 && h4 < 0.025) {
          // lily pads on calm shallow water, painted flat into the chunk
          R(px, py, 4, 3, '#3f8a3a');
          R(px + 1, py, 2, 1, '#5aa848');
          R(px + 3, py + 1, 1, 1, '#2a5a7a');
          if (h4 < 0.008) R(px + 1, py + 1, 1, 1, '#ff9fd0');
        }
        if (kind) objects.push({ x: ox2, y: oy2, kind, v: Math.floor(h3 * 3), tx, ty });
        if (t === T.FOREST && h3 > 0.55) {
          const k2 = e > 0.72 || h3 > 0.85 ? 'pine' : 'oak';
          objects.push({ x: cx * PX + i * TILE + 2 + hash2(tx, ty, 808) * 12, y: cy * PX + j * TILE + 2 + hash2(tx, ty, 909) * 13, kind: k2, v: Math.floor(h1 * 3), tx, ty });
        }
      }
    objects.sort((a, b) => a.y - b.y);
    return { canvas: cv, objects, used: performance.now() };
  }
}

// ------------------------------------------------------------------ nature art
function pixelBlob(g, cx, cy, rx, ry, tones, outline, seed, bumps = 4) {
  // union of circles with noisy edge, shaded by light from top-left
  const circles = [[cx, cy, rx, ry]];
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2 + hash2(i, seed, 5) * 0.8;
    circles.push([cx + Math.cos(a) * rx * 0.55, cy + Math.sin(a) * ry * 0.5, rx * 0.6, ry * 0.6]);
  }
  const inside = (x, y) => circles.some(([ccx, ccy, a, b]) => ((x - ccx) / a) ** 2 + ((y - ccy) / b) ** 2 < 1 - (hash2(x, y, seed) - 0.5) * 0.25);
  const W = g.canvas.width, H = g.canvas.height;
  const filled = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      filled.push([x, y]);
      const lx = (x - cx) / rx, ly = (y - cy) / ry;
      let l = -lx * 0.55 - ly * 0.75 + 0.15 + (hash2(x, y, seed + 9) - 0.5) * 0.35;
      // leaf clusters: small bright speckles
      const ti = l > 0.55 ? 3 : l > 0.1 ? 2 : l > -0.35 ? 1 : 0;
      g.fillStyle = tones[ti];
      g.fillRect(x, y, 1, 1);
    }
  if (outline) {
    const set = new Set(filled.map(([x, y]) => x + ',' + y));
    g.fillStyle = outline;
    for (const [x, y] of filled)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = x + dx + ',' + (y + dy);
        if (!set.has(k)) g.fillRect(x + dx, y + dy, 1, 1), set.add(k);
      }
  }
}

const NATURE = new Map();
export function natureArt(kind, v) {
  const key = kind + v;
  if (NATURE.has(key)) return NATURE.get(key);
  let c, ax, ay, shadow;
  const seed = v * 17 + kind.length;
  if (kind === 'oak') {
    c = canvas(22, 26);
    const g = c.getContext('2d');
    const R = (x, y, w, h, col) => ((g.fillStyle = col), g.fillRect(x, y, w, h));
    R(9, 15, 4, 10, '#5b3a1e');
    R(9, 15, 1, 10, '#7a5230');
    R(12, 15, 1, 10, '#3e2614');
    R(8, 24, 6, 1, '#3e2614');
    const greens = [['#2a7838', '#3c9a44', '#58b850', '#90d878'], ['#307a30', '#44a040', '#64c050', '#9cdc7c'], ['#26704a', '#38925a', '#52b06c', '#8cd492']][v % 3];
    pixelBlob(g, 11, 9.5, 9.5, 8.5, greens, '#1a3a20', seed, 5);
    (ax = 11), (ay = 25), (shadow = 9);
  } else if (kind === 'pine' || kind === 'snowpine') {
    c = canvas(16, 28);
    const g = c.getContext('2d');
    const R = (x, y, w, h, col) => ((g.fillStyle = col), g.fillRect(x, y, w, h));
    R(7, 21, 2, 6, '#4e3220');
    R(7, 21, 1, 6, '#6b4a2e');
    const tones = ['#1e5a36', '#2c7a44', '#40985a', '#68b878'];
    for (let tier = 0; tier < 4; tier++) {
      const top = 1 + tier * 5, h = 9, half0 = 1 + tier, half1 = 3 + tier * 1.6;
      for (let y = 0; y < h; y++) {
        const hw = Math.round(half0 + (half1 - half0) * (y / (h - 1)));
        for (let x = -hw; x <= hw; x++) {
          const yy = top + y;
          if (yy > 22) continue;
          const l = -x / (hw + 1) * 0.8 - y / h * 0.3 + 0.2 + (hash2(x + 8, yy, seed) - 0.5) * 0.3;
          g.fillStyle = tones[l > 0.45 ? 3 : l > 0 ? 2 : l > -0.45 ? 1 : 0];
          g.fillRect(8 + x, yy, 1, 1);
          if (kind === 'snowpine' && y < 2 + (x < 0 ? 1 : 0)) (g.fillStyle = y === 0 ? '#ffffff' : '#dbe6f0'), g.fillRect(8 + x, yy, 1, 1);
        }
      }
    }
    // outline
    const id = g.getImageData(0, 0, 16, 28).data;
    const solid = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 28 && id[(y * 16 + x) * 4 + 3] > 0;
    g.fillStyle = '#0f2418';
    for (let y = 0; y < 28; y++) for (let x = 0; x < 16; x++) if (!solid(x, y) && (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1))) g.fillRect(x, y, 1, 1);
    (ax = 8), (ay = 27), (shadow = 6);
  } else if (kind === 'palm') {
    c = canvas(22, 26);
    const g = c.getContext('2d');
    for (let i = 0; i < 16; i++) {
      const x = 11 + Math.round(Math.sin(i / 6) * 2), y = 25 - i;
      g.fillStyle = i % 3 === 0 ? '#8a6a40' : '#b08a58';
      g.fillRect(x, y, 2, 1);
      g.fillStyle = '#6a4a28';
      g.fillRect(x + 2, y, 1, 1);
    }
    const leaf = (dx, dy) => {
      for (let i = 0; i < 9; i++) {
        const x = 12 + Math.round(dx * i), y = 9 + Math.round(dy * i + (i * i) / 18);
        g.fillStyle = i < 3 ? '#2f7a2c' : '#4a9a3a';
        g.fillRect(x, y, 2, 1);
        g.fillStyle = '#1e5220';
        g.fillRect(x, y + 1, 2, 1);
      }
    };
    leaf(1, -0.3);
    leaf(-1, -0.3);
    leaf(0.8, 0.4);
    leaf(-0.8, 0.4);
    leaf(0.2, -0.6);
    g.fillStyle = '#5a3a1c';
    g.fillRect(11, 10, 2, 2);
    (ax = 12), (ay = 25), (shadow = 7);
  } else if (kind === 'bush') {
    c = canvas(14, 11);
    const g = c.getContext('2d');
    pixelBlob(g, 7, 5.5, 6, 4.6, ['#1f4d22', '#2f6b2c', '#43893a', '#69ad52'], '#132e15', seed, 3);
    if (v === 2) for (const [x, y] of [[4, 4], [8, 6], [10, 3]]) (g.fillStyle = '#e04050'), g.fillRect(x, y, 1, 1);
    (ax = 7), (ay = 10), (shadow = 6);
  } else if (kind === 'stump' || kind === 'log') {
    c = canvas(kind === 'log' ? 16 : 10, 9);
    const g = c.getContext('2d');
    const R = (x, y, w, h, col) => ((g.fillStyle = col), g.fillRect(x, y, w, h));
    if (kind === 'log') {
      R(1, 3, 13, 5, '#6b4423');
      R(1, 3, 13, 1, '#8a5e34');
      R(1, 7, 13, 1, '#3e2614');
      R(13, 3, 3, 5, '#c8a070');
      R(14, 4, 1, 3, '#8a6a40');
      R(4, 4, 1, 1, '#3e2614');
      R(9, 5, 1, 1, '#3e2614');
      R(6, 2, 2, 1, '#4f8a3a');
    } else {
      R(2, 3, 6, 5, '#6b4423');
      R(2, 2, 6, 2, '#c8a070');
      R(4, 2, 2, 1, '#8a6a40');
      R(1, 7, 8, 1, '#3e2614');
      R(1, 6, 1, 2, '#5a3a1c');
      R(8, 6, 1, 2, '#5a3a1c');
    }
    (ax = c.width / 2), (ay = 8), (shadow = 5);
  } else if (kind === 'reeds') {
    c = canvas(10, 12);
    const g = c.getContext('2d');
    for (let i = 0; i < 6; i++) {
      const x = 1 + i * 1.6, h = 6 + ((i * 7 + v * 3) % 5);
      g.fillStyle = i % 2 ? '#5f8a3a' : '#7aa848';
      g.fillRect(Math.round(x), 12 - h, 1, h);
      if (i % 2 === 0) (g.fillStyle = '#6b4423'), g.fillRect(Math.round(x), 12 - h, 1, 2);
    }
    (ax = 5), (ay = 11), (shadow = 4);
  } else if (kind === 'mushroom') {
    c = canvas(10, 8);
    const g = c.getContext('2d');
    const R = (x, y, w, h, col) => ((g.fillStyle = col), g.fillRect(x, y, w, h));
    for (const [x, y, s] of [[1, 3, 1], [5, 1, 1.4], [7, 4, 0.8]]) {
      R(x + 1, y + 2, 1, 3, '#f0e6d8');
      R(x, y, Math.round(3 * s), 2, v === 1 ? '#c87a3a' : '#d83a3a');
      R(x + 1, y, 1, 1, '#ffffff');
    }
    (ax = 5), (ay = 7), (shadow = 4);
  } else if (kind === 'flowerbush') {
    c = canvas(14, 11);
    const g = c.getContext('2d');
    pixelBlob(g, 7, 5.5, 6, 4.6, ['#1f4d22', '#2f6b2c', '#43893a', '#69ad52'], '#132e15', seed, 3);
    const fc = ['#ff8fb8', '#ffe066', '#ffffff', '#c79bff'][v % 4];
    for (const [x, y] of [[3, 3], [6, 2], [9, 4], [5, 6], [10, 7], [2, 6]]) (g.fillStyle = fc), g.fillRect(x, y, 1, 1);
    (ax = 7), (ay = 10), (shadow = 6);
  } else if (kind === 'boulder') {
    c = canvas(22, 17);
    const g = c.getContext('2d');
    pixelBlob(g, 11, 9, 10, 7, ['#47454c', '#5e5c63', '#7a7880', '#9a98a0'], '#201e26', seed, 4);
    (ax = 11), (ay = 15), (shadow = 10);
  } else {
    c = canvas(14, 11);
    const g = c.getContext('2d');
    pixelBlob(g, 7, 6, 6, 4.4, v === 2 ? ['#5a5a4a', '#6f7058', '#7f9a58', '#9ab870'] : ['#4c4a50', '#66646a', '#848288', '#a6a4aa'], '#24222a', seed, 2);
    (ax = 7), (ay = 10), (shadow = 6);
  }
  const art = { c, ax, ay, shadow };
  NATURE.set(key, art);
  return art;
}

// ------------------------------------------------------------------ sprites: outline, shading, walk frames
const SPRITE_CACHE = new Map();
export function buildSprite(key, rows, pal, color, legs) {
  const ck = key + color;
  if (SPRITE_CACHE.has(ck)) return SPRITE_CACHE.get(ck);
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const dark = shade(color, 0.6);
  const base = rows.map((r) => [...r.padEnd(w, '.')].map((ch) => (ch === '.' ? null : ch === 'K' ? color : ch === 'k' ? dark : pal[ch] || '#ff00ff')));
  const variants = [base];
  if (legs) {
    const cx = Math.floor(w / 2);
    for (const side of [0, 1]) {
      const gcp = base.map((r) => r.slice());
      for (let x = 0; x < w; x++) {
        if (side === 0 ? x >= cx : x < cx) continue;
        for (let y = h - 3; y < h - 1; y++) gcp[y][x] = base[y + 1][x];
        gcp[h - 1][x] = null;
      }
      variants.push(gcp);
    }
  }
  const frames = variants.map((grid) => {
    const c = canvas(w + 2, h + 2);
    const g = c.getContext('2d');
    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? grid[y][x] : null);
    for (let y = -1; y <= h; y++)
      for (let x = -1; x <= w; x++) {
        const col = at(x, y);
        if (!col) {
          if (at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1)) {
            g.fillStyle = 'rgba(12,10,20,0.85)';
            g.fillRect(x + 1, y + 1, 1, 1);
          }
          continue;
        }
        let f = 1.07 - (0.16 * y) / h;
        if (!at(x, y - 1)) f *= 1.16;
        if (!at(x, y + 1)) f *= 0.8;
        if (!at(x - 1, y)) f *= 1.06;
        if (!at(x + 1, y)) f *= 0.9;
        g.fillStyle = shade(col, f);
        g.fillRect(x + 1, y + 1, 1, 1);
      }
    return c;
  });
  const s = { frames, white: silhouette(frames[0], '#ffffff'), dark: silhouette(frames[0], '#000000'), w: w + 2, h: h + 2 };
  SPRITE_CACHE.set(ck, s);
  return s;
}

function silhouette(src, color) {
  const c = canvas(src.width, src.height);
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// ------------------------------------------------------------------ procedural vehicles (jets, helis, ships, tanks)
// Drawn into a colour grid, then outlined and shaded like hand-made sprites. All face east.
const grid = (w, h) => Array.from({ length: h }, () => Array(w).fill(null));
function gset(G, x, y, c) {
  x = Math.round(x);
  y = Math.round(y);
  if (y >= 0 && y < G.length && x >= 0 && x < G[0].length) G[y][x] = c;
}
function gpoly(G, pts, c) {
  const ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      const yc = y + 0.5;
      if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.round(xs[i]); x < Math.round(xs[i + 1]); x++) gset(G, x, y, c);
  }
}
function gellipse(G, cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) gset(G, x, y, c);
}
function gline(G, x0, y0, x1, y1, c) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) gset(G, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
}
// render a colour grid with outline + top-down lighting (light from the north-west)
function gridCanvas(G, topDown = true) {
  const h = G.length, w = G[0].length;
  const c = canvas(w + 2, h + 2);
  const g = c.getContext('2d');
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? G[y][x] : null);
  const cy = h / 2;
  for (let y = -1; y <= h; y++)
    for (let x = -1; x <= w; x++) {
      const col = at(x, y);
      if (!col) {
        if (at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1)) {
          g.fillStyle = 'rgba(10,10,16,0.8)';
          g.fillRect(x + 1, y + 1, 1, 1);
        }
        continue;
      }
      let f = topDown ? 1.06 - (0.14 * y) / h : 1;
      if (!at(x, y - 1)) f *= 1.18;
      if (!at(x, y + 1)) f *= 0.78;
      if (!at(x - 1, y)) f *= 1.05;
      if (!at(x + 1, y)) f *= 0.92;
      if (topDown && y > cy + 1 && at(x, y - 1) && hash2(x, y, 3) < 0.04) f *= 0.94;
      g.fillStyle = col.startsWith('#') ? shade(col, f) : col;
      g.fillRect(x + 1, y + 1, 1, 1);
    }
  return c;
}

const V_CACHE = new Map();
export function vehicleArt(spec, color) {
  const ck = JSON.stringify(spec) + color;
  if (V_CACHE.has(ck)) return V_CACHE.get(ck);
  const K = color, Kd = shade(color, 0.6);
  let G, rotors = [], turret = null, tpx = 0, nozzles = [], tpivot = [0, 0], flash = null, pylons = [];
  const glass = '#4fa8dc', glassHi = '#c8f0ff', dark = '#2a2d33', white = '#eef0f2';
  if (spec.t === 'jet' || spec.t === 'prop') {
    const L = spec.len, S = spec.span, B = spec.body || 4;
    G = grid(L + 2, S + 2);
    const cy = (S + 1) / 2;
    const paint = spec.paint, wingCol = shade(paint, 0.94);
    const W = { delta: [0.12, 0.62, 0.08, 0.17], cropdelta: [0.28, 0.6, 0.27, 0.37], swept: [0.34, 0.62, 0.2, 0.31], straight: [0.42, 0.6, 0.42, 0.56], diamond: [0.24, 0.6, 0.3, 0.43] }[spec.t === 'prop' ? 'straight' : spec.wing] || [0.3, 0.6, 0.25, 0.35];
    const wing = (r0, r1, t0, t1, span, col) => {
      gpoly(G, [[L * r0, cy], [L * r1, cy], [L * t1, cy - span / 2], [L * t0, cy - span / 2]], col);
      gpoly(G, [[L * r0, cy], [L * r1, cy], [L * t1, cy + span / 2], [L * t0, cy + span / 2]], col);
    };
    wing(W[0], W[1], W[2], W[3], S, wingCol);
    // kingdom-coloured wingtips + roundels
    for (const s of [-1, 1]) {
      for (let k = 0; k < 2; k++) gline(G, L * W[2], cy + s * (S / 2 - k), L * W[3], cy + s * (S / 2 - k), K);
      const rx = L * ((W[0] + W[1] + W[2] + W[3]) / 4), ry = cy + s * S * 0.26;
      if (spec.iaf) {
        // Indian Air Force roundel: saffron, white, green
        gellipse(G, rx, ry, 2.3, 2.3, '#ff9933');
        gellipse(G, rx, ry, 1.5, 1.5, '#f6f6f6');
        gset(G, rx, ry, '#138808');
      } else {
        gellipse(G, rx, ry, 1.6, 1.6, K);
        gset(G, rx, ry, white);
      }
    }
    if (!spec.noTailplane && spec.wing !== 'delta') wing(0.0, 0.17, 0.0, 0.08, S * (spec.tail === 'vee' ? 0.3 : 0.42), wingCol);
    if (spec.canard) wing(0.68, 0.78, 0.68, 0.72, S * 0.36, wingCol);
    // pylon slots under the wings: the client draws the missiles still loaded (stealth jets carry them inside)
    if (spec.t === 'jet' && !spec.panels) {
      const cw = L + 4, ch = S + 4;
      for (const fr of [0.18, 0.3, 0.42]) for (const s of [-1, 1]) {
        const py = cy + s * S * fr;
        // on the wing's mid-chord line, from root (span 0) toward the tip
        const midRoot = (L * (W[0] + W[1])) / 2, midTip = (L * (W[2] + W[3])) / 2;
        const px = midRoot + (midTip - midRoot) * fr * 2;
        pylons.push([px + 1 - cw / 2, py + 1 - ch / 2]);
      }
    }
    // crisp light: lit leading edges, shaded trailing edges
    for (const s of [-1, 1]) {
      gline(G, L * W[1], cy, L * W[3], cy + s * (S / 2 - 1), shade(wingCol, 1.2));
      gline(G, L * W[0], cy + s * 1, L * W[2], cy + s * (S / 2 - 1), shade(wingCol, 0.8));
    }
    // engine pods
    if (spec.pods) for (let p = 0; p < spec.pods; p++) for (const s of [-1, 1]) gellipse(G, L * 0.5 - p * 1.5 + 2, cy + s * (S * 0.12 + p * S * 0.09), 3, 1.2, dark);
    if (spec.podEngines) for (const s of [-1, 1]) gellipse(G, L * 0.22, cy + s * B * 0.95, 3.5, 1.8, shade(paint, 0.8));
    // fuselage
    for (let x = 0; x < L; x++) {
      const t = x / (L - 1);
      let hw = B / 2;
      if (t < 0.1) hw = B * 0.42;
      if (t > 0.74) hw = (B / 2) * Math.pow(Math.max(0, (1 - t) / 0.26), spec.t === 'prop' ? 0.35 : 0.85);
      for (let y = Math.round(cy - hw); y <= Math.round(cy + hw); y++) gset(G, x, y, paint);
    }
    // stealth panel lines: subtly lighter / darker radar-absorbent panels
    if (spec.panels) for (let y = 0; y < G.length; y++) for (let x = 0; x < L; x++) if (G[y][x] === paint || G[y][x] === wingCol) {
      const v = nz(x * 5 + 31, y * 5);
      if (v > 0.66) G[y][x] = shade(G[y][x], 1.07);
      else if (v < 0.3) G[y][x] = shade(G[y][x], 0.93);
    }
    // lit spine along the fuselage
    for (let x = Math.round(L * 0.14); x < L * 0.74; x++) gset(G, x, Math.round(cy - (B > 4 ? 1 : 0)), shade(paint, 1.14));
    // camo
    if (spec.camo) for (let y = 0; y < G.length; y++) for (let x = 0; x < L; x++) if (G[y][x] === paint || G[y][x] === wingCol) if (nz(x * 9, y * 9 + L) > 0.56) G[y][x] = spec.camo;
    // vertical tails (seen from above)
    const fin = shade(paint, 0.7);
    if (spec.tail === 'single') (gline(G, 0, cy, L * 0.22, cy, fin), gline(G, 2, cy, L * 0.12, cy, K));
    else if (spec.tail === 'twin') for (const s of [-1, 1]) (gline(G, 1, cy + s * (B * 0.55), L * 0.2, cy + s * (B * 0.4), fin), gset(G, 3, cy + s * (B * 0.55), K));
    else if (spec.tail === 'canted') for (const s of [-1, 1]) (gline(G, 0, cy + s * (B * 1.15), L * 0.2, cy + s * (B * 0.45), fin), gline(G, 1, cy + s * (B * 1.25), L * 0.12, cy + s * (B * 0.85), shade(fin, 1.15)), gset(G, 2, cy + s * (B * 1.1), K))
    else if (spec.tail === 'twinwide') for (const s of [-1, 1]) gline(G, 0, cy + s * S * 0.2, L * 0.08, cy + s * S * 0.2, fin);
    else if (spec.tail === 'vee') for (const s of [-1, 1]) gline(G, 0, cy + s * 4, L * 0.1, cy + s * 1, fin);
    // cockpit
    if (!spec.drone) {
      const cx2 = L * (spec.t === 'prop' ? 0.62 : 0.8);
      gellipse(G, cx2, cy, L * 0.07, Math.max(1, B * 0.3), glass);
      gset(G, cx2 + 1, cy - (B > 4 ? 1 : 0), glassHi);
    } else gellipse(G, L * 0.86, cy, 2, 1.2, shade(paint, 1.2));
    // nozzles / propeller
    const n = spec.engines || 0;
    if (n === 1) (gset(G, 0, cy, dark), gset(G, 1, cy, dark), nozzles.push([0, 0]));
    if (n === 2) for (const s of [-1, 1]) (gset(G, 0, cy + s * 1, dark), gset(G, 1, cy + s * 1, dark), nozzles.push([0, s * 1]));
    if (spec.t === 'prop') for (let y = -4; y <= 4; y++) gset(G, L, cy + y, 'rgba(40,40,40,0.55)');
    turret = null;
  } else if (spec.t === 'car') {
    // civilian traffic, seen from above (facing east): wheels stick out a pixel, glass front & back
    const L = spec.len, Wd = spec.wid, st = spec.style;
    G = grid(L + 2, Wd + 2);
    const body = spec.body === 'K' ? K : spec.body, bodyD = shade(body, 0.78), bodyL = shade(body, 1.16);
    const x0 = 1, x1 = L, y0 = 1, y1 = Wd; // body occupies [x0, x1) × [y0, y1)
    const tyre = '#141418', cy = (Wd + 1) / 2;
    const box = (xa, ya, xb, yb, col) => gpoly(G, [[xa, ya], [xb, ya], [xb, yb], [xa, yb]], col);
    const wheels = (xs) => { for (const x of xs) for (const yy of [y0 - 1, y1]) (gset(G, x, yy, tyre), gset(G, x + 1, yy, tyre)); };
    if (st === 'auto') {
      // three-wheeler: canvas hood over the back, open driver cab, narrow nose
      gpoly(G, [[x0, y0], [x1 - 4, y0], [x1, cy - 1.5], [x1, cy + 1.5], [x1 - 4, y1], [x0, y1]], body);
      box(x0, y0, x1 - 4, y1, '#1d1d1d');
      gline(G, x0, y0, x1 - 5, y0, '#2e8b3a');
      gline(G, x0, y1 - 1, x1 - 5, y1 - 1, '#2e8b3a');
      gset(G, x1 - 3, cy, '#c8e8ff');
      gset(G, x1 - 1, cy, '#fff6c0');
      wheels([x0 + 1]);
      gset(G, x1, cy - 0.5, tyre);
    } else if (st === 'scooter') {
      gline(G, x0, cy, x1 - 1, cy, body);
      gline(G, x0 + 1, cy - 0.6, x1 - 2, cy - 0.6, bodyD);
      gset(G, x0, cy, tyre);
      gset(G, x1 - 1, cy, tyre);
      gline(G, x1 - 2, y0, x1 - 2, y1 - 1, '#3a3a40'); // handlebar
      gellipse(G, x0 + 4, cy, 1.4, 1.4, '#2a2420'); // rider's head
      gset(G, x0 + 4, cy - 1, '#4a4a50');
      gset(G, x0 + 3, cy - 1.6, K);
      gset(G, x0 + 3, cy + 1.6, K);
    } else if (st === 'tractor') {
      box(x0 + 5, cy - 1.5, x1, cy + 1.5, body); // hood
      gset(G, x1 - 1, cy, '#fff6c0');
      for (const yy of [y0 - 1, y0, y1 - 1, y1]) for (let x = x0; x < x0 + 5; x++) gset(G, x, yy, tyre); // big rear wheels
      for (const yy of [y0 + 1, y1 - 2]) (gset(G, x1 - 3, yy, tyre), gset(G, x1 - 2, yy, tyre));
      box(x0 + 1, cy - 2, x0 + 5, cy + 2, bodyD);
      gset(G, x0 + 3, cy, '#2a2a2e'); // seat
      gset(G, x0 + 6, cy - 2, '#3a3a3a'); // exhaust
    } else {
      // cars, jeeps, vans, buses, lorries: rounded box
      box(x0, y0, x1, y1, body);
      for (const [x, y] of [[x0, y0], [x1 - 1, y0], [x0, y1 - 1], [x1 - 1, y1 - 1]]) gset(G, x, y, st === 'bus' || st === 'lorry' ? bodyD : null);
      if (st === 'bus') {
        box(x0 + 1, y0, x1 - 2, y0 + 1, '#203040');
        box(x0 + 1, y1 - 1, x1 - 2, y1, '#203040');
        for (let x = x0 + 3; x < x1 - 3; x += 4) (gset(G, x, y0, bodyD), gset(G, x, y1 - 1, bodyD)); // window pillars
        box(x0 + 1, cy - 1, x1 - 3, cy + 1, '#f2f2f2'); // roof band
        for (const x of [x0 + 5, x0 + 14]) box(x, cy - 1.5, x + 3, cy + 1.5, '#b8bcc4'); // AC units
        box(x1 - 2, y0, x1, y1, '#4a7a9a'); // windscreen
        wheels([x0 + 3, x1 - 6]);
      } else if (st === 'lorry') {
        box(x1 - 6, y0, x1, y1, body); // cab
        box(x1 - 2, y0 + 1, x1, y1 - 1, '#4a7a9a');
        box(x0, y0, x1 - 7, y1, '#3a6ad0'); // tarp-covered cargo bed
        for (let x = x0 + 2; x < x1 - 7; x += 3) gline(G, x, y0, x, y1 - 1, '#2a4a9a');
        // painted truck-art border
        for (let x = x0; x < x1 - 7; x++) (gset(G, x, y0, ['#e02828', '#f0c020', '#28a040'][x % 3]), gset(G, x, y1 - 1, ['#28a040', '#f0c020', '#e02828'][x % 3]));
        wheels([x0 + 2, x0 + 6, x1 - 4]);
      } else if (st === 'jeep') {
        box(x0 + 1, y0 + 1, x1 - 5, y1 - 1, bodyD); // canvas top
        gline(G, x1 - 5, y0 + 1, x1 - 5, y1 - 2, '#4a7a9a');
        gellipse(G, x0 - 0.2, cy, 1, 1.6, tyre); // spare wheel
        wheels([x0 + 2, x1 - 4]);
        gset(G, x1 - 1, y0 + 1, '#fff6c0');
        gset(G, x1 - 1, y1 - 2, '#fff6c0');
      } else {
        // car / van: windscreen, roof, rear window, lights, mirrors
        const ws = st === 'van' ? x1 - 4 : x1 - 6;
        box(ws, y0 + 1, ws + 2, y1 - 1, '#4a7a9a');
        gset(G, ws + 1, y0 + 1, '#c8f0ff');
        if (st !== 'van') box(x0 + 2, y0 + 1, x0 + 4, y1 - 1, '#3a5a74');
        box(st === 'van' ? x0 + 1 : x0 + 4, y0 + 1, ws, y1 - 1, spec.roof || (st === 'van' ? body : bodyL));
        if (spec.stripe) (gline(G, x0, y0, x1 - 1, y0, spec.stripe), gline(G, x0, y1 - 1, x1 - 1, y1 - 1, spec.stripe));
        if (spec.flash === 'ambulance') (gline(G, x0 + 6, cy - 0.5, x0 + 10, cy - 0.5, '#e02828'), gline(G, x0 + 8, cy - 2.5, x0 + 8, cy + 1.5, '#e02828'));
        for (const yy of [y0 + 1, y1 - 2]) (gset(G, x1 - 1, yy, '#fff6c0'), gset(G, x0, yy, '#d02020'));
        gset(G, ws, y0 - 1, body);
        gset(G, ws, y1, body);
        wheels([x0 + 2, x1 - 4]);
      }
    }
    if (spec.flash) {
      const fx0 = Math.round(spec.len * 0.62);
      flash = spec.flash === 'police' ? [[fx0 - L / 2 - 1, -1.5, '#ff2a2a'], [fx0 - L / 2 - 1, 1.5, '#3060ff']] : [[fx0 - L / 2 - 1, -1.5, '#ff2a2a'], [fx0 - L / 2 - 1, 1.5, '#ff2a2a']];
    }
    nozzles = [[-L / 2, 0]];
  } else if (spec.t === 'truck') {
    // military 8x8: cab at the front, canvas cargo or a BrahMos canister on its erector
    const L = spec.len, Wd = spec.wid, paint = spec.paint;
    G = grid(L + 2, Wd + 2);
    const cy = (Wd + 1) / 2, tyre = '#141418';
    const box = (xa, ya, xb, yb, col) => gpoly(G, [[xa, ya], [xb, ya], [xb, yb], [xa, yb]], col);
    for (const x of [3, 7, L - 13, L - 6]) for (const yy of [0, Wd + 1]) for (let k = 0; k < 3; k++) gset(G, x + k, yy, tyre);
    box(1, 1, L + 1, Wd + 1, shade(paint, 0.8)); // chassis
    box(L - 6, 1, L + 1, Wd + 1, paint); // cab
    box(L - 1, 2, L + 1, Wd, '#4a6a7a');
    gset(G, L, 2, '#fff6c0');
    gset(G, L, Wd - 1, '#fff6c0');
    if (spec.cargo === 'missile') {
      box(2, 2, L - 7, Wd, shade(paint, 0.9));
      box(3, cy - 2, L - 8, cy + 2, '#e6e8e6'); // launch canister
      gline(G, 3, cy - 2, L - 9, cy - 2, '#ffffff');
      gline(G, 3, cy + 1.5, L - 9, cy + 1.5, '#b8bcbc');
      for (const x of [Math.round(L * 0.25), Math.round(L * 0.55)]) gline(G, x, cy - 2, x, cy + 1.5, '#ff9933'); // saffron bands
      gline(G, L - 10, cy - 2, L - 10, cy + 1.5, K);
      gellipse(G, 3, cy, 1, 2, '#3a3a3a'); // nozzle cap
    } else {
      box(2, 1, L - 7, Wd + 1, shade(paint, 1.05)); // canvas cover
      for (let x = 4; x < L - 7; x += 4) gline(G, x, 1, x, Wd, shade(paint, 0.82));
      gset(G, L - 9, cy, K);
    }
    nozzles = [[-L / 2, 0]];
  } else if (spec.t === 'wing') {
    const L = spec.len, S = spec.span;
    G = grid(L + 2, S + 2);
    const cy = (S + 1) / 2;
    const pts = [[L, cy], [L * 0.22, cy - S / 2], [0, cy - S * 0.4], [L * 0.2, cy - S * 0.26], [0, cy - S * 0.12], [L * 0.16, cy]];
    gpoly(G, pts, spec.paint);
    gpoly(G, pts.map(([x, y]) => [x, 2 * cy - y]), spec.paint);
    gellipse(G, L * 0.8, cy, 3, 1.5, glass);
    for (const s of [-1, 1]) gellipse(G, L * 0.45, cy + s * S * 0.12, 3, 1.4, shade(spec.paint, 0.75));
    for (const s of [-1, 1]) gset(G, L * 0.24, cy + s * S * 0.47, K);
  } else if (spec.t === 'heli') {
    const L = spec.len, B = spec.body, R = spec.rotor;
    const H = Math.max(B + 2, Math.round(B * 3.2));
    G = grid(L + 2, H);
    const cy = (H - 1) / 2;
    const paint = spec.paint;
    if (spec.twin) {
      gellipse(G, L * 0.5, cy, L * 0.48, B / 2, paint);
      rotors = [[L * 0.12 - L / 2, 0, R], [L * 0.88 - L / 2, 0, R]];
      gellipse(G, L * 0.92, cy, 2.5, B * 0.3, glass);
    } else {
      gline(G, 0, cy, L * 0.55, cy, shade(paint, 0.85));
      gline(G, 0, cy + 1, L * 0.5, cy + 1, shade(paint, 0.7));
      gline(G, 0, cy - 3, 3, cy + 3, shade(paint, 0.7)); // tail rotor
      gellipse(G, L * 0.68, cy, L * 0.24, B / 2, paint);
      if (spec.stubs) {
        gpoly(G, [[L * 0.58, cy - B / 2], [L * 0.66, cy - B / 2], [L * 0.64, cy - B * 1.45], [L * 0.58, cy - B * 1.45]], shade(paint, 0.85));
        gpoly(G, [[L * 0.58, cy + B / 2], [L * 0.66, cy + B / 2], [L * 0.64, cy + B * 1.45], [L * 0.58, cy + B * 1.45]], shade(paint, 0.85));
        for (const s of [-1, 1]) gellipse(G, L * 0.62, cy + s * B * 1.35, 2.4, 1.1, dark);
      }
      gellipse(G, L * 0.86, cy, L * 0.06, B * 0.32, glass);
      gellipse(G, L * 0.76, cy, L * 0.05, B * 0.3, glass);
      gset(G, L * 0.87, cy - 1, glassHi);
      gset(G, L * 0.62, cy, K);
      gset(G, L * 0.6, cy, K);
      rotors = [[L * 0.64 - L / 2, 0, R]];
    }
    if (spec.camo) for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) if (G[y][x] === paint && nz(x * 9, y * 9) > 0.56) G[y][x] = spec.camo;
  } else if (spec.t === 'ship') {
    const L = spec.len, Bm = spec.beam, d = spec.deck;
    G = grid(L + 2, Bm + 2);
    const cy = (Bm + 1) / 2;
    const hull = spec.paint, deck = shade(spec.paint, 1.18), deckD = shade(spec.paint, 0.9), sup = shade(spec.paint, 1.32);
    const hw = (x) => {
      const t = x / L;
      if (d === 'sub') return (Bm / 2) * Math.sqrt(Math.max(0, 1 - ((t - 0.52) / 0.52) ** 2));
      if (t < 0.04) return (Bm / 2) * 0.85;
      if (t > 0.68) return (Bm / 2) * Math.pow((1 - t) / 0.32, 0.75);
      return Bm / 2;
    };
    for (let x = 0; x < L; x++) {
      const h2 = hw(x);
      for (let y = Math.round(cy - h2); y <= Math.round(cy + h2); y++) gset(G, x, y, Math.abs(y - cy) > h2 - 1 ? hull : deck);
    }
    const turretAt = (x, r, barrels, len) => {
      gellipse(G, x, cy, r, r, sup);
      for (let b = 0; b < barrels; b++) gline(G, x + r - 1, cy + (b - (barrels - 1) / 2) * 1.2, x + r + len, cy + (b - (barrels - 1) / 2) * 1.2, dark);
    };
    const block = (x0, x1, w, col = sup, windows = true) => {
      gpoly(G, [[x0, cy - w / 2], [x1, cy - w / 2], [x1, cy + w / 2], [x0, cy + w / 2]], col);
      if (windows) for (let x = Math.round(x0) + 1; x < x1 - 1; x += 2) gset(G, x, cy - w / 2 + 1, dark);
    };
    if (d === 'carrier') {
      gpoly(G, [[2, 1], [L * 0.93, 1], [L - 1, cy], [L * 0.93, Bm], [2, Bm]], '#4a4f57');
      for (let x = 6; x < L * 0.9; x += 5) (gset(G, x, cy, white), gset(G, x + 1, cy, white));
      gline(G, L * 0.35, Bm - 2, L * 0.9, 3, '#f0d050');
      for (let x = 8; x < L * 0.85; x += 9) gset(G, x, 3, white);
      block(L * 0.55, L * 0.7, 5, sup);
      for (let i = 0; i < 3; i++) gset(G, L * 0.57 + i * 3, Bm - 4, K);
      gpoly(G, [[L * 0.55, Bm - 6], [L * 0.7, Bm - 6], [L * 0.7, Bm - 1], [L * 0.55, Bm - 1]], sup);
      gline(G, L * 0.62, Bm - 7, L * 0.62, Bm - 2, dark);
      for (const [x, y] of [[L * 0.15, 4], [L * 0.22, 4], [L * 0.29, 4], [L * 0.8, Bm - 5]]) gpoly(G, [[x, y], [x + 5, y + 1.5], [x, y + 3]], '#9aa2aa');
    } else if (d === 'sub') {
      for (let x = 2; x < L; x++) for (let y = 0; y < G.length; y++) if (G[y][x]) G[y][x] = Math.abs(y - cy) < 1 ? shade(hull, 1.25) : hull;
      gellipse(G, L * 0.6, cy, 3.5, 1.6, shade(hull, 1.5));
      gline(G, 0, cy - 2, 0, cy + 2, hull);
      gset(G, L * 0.6, cy, K);
    } else {
      // warships: forward gun(s), VLS, superstructure + mast, funnel, aft helipad
      if (d === 'battleship') {
        turretAt(L * 0.78, Bm * 0.26, 3, L * 0.09);
        turretAt(L * 0.64, Bm * 0.26, 3, L * 0.07);
        turretAt(L * 0.2, Bm * 0.26, 3, -L * 0.1);
        block(L * 0.36, L * 0.54, Bm * 0.55);
        gellipse(G, L * 0.44, cy, 2.6, 2.2, dark);
      } else {
        turretAt(L * 0.8, Bm * 0.2, 1, L * 0.08);
        if (d === 'destroyer') for (let x = L * 0.66; x < L * 0.74; x += 2) for (let y = cy - 3; y <= cy + 3; y += 2) gset(G, x, y, dark);
        block(L * 0.4, L * 0.6, Bm * 0.6);
        gellipse(G, L * 0.48, cy, 1.6, 1.6, dark);
        if (d !== 'corvette') {
          gpoly(G, [[2, cy - Bm * 0.32], [L * 0.2, cy - Bm * 0.32], [L * 0.2, cy + Bm * 0.32], [2, cy + Bm * 0.32]], deckD);
          const hx = L * 0.1;
          gline(G, hx - 2, cy - 2, hx - 2, cy + 2, white);
          gline(G, hx + 2, cy - 2, hx + 2, cy + 2, white);
          gline(G, hx - 2, cy, hx + 2, cy, white);
        }
      }
      gline(G, L * 0.52, cy - Bm * 0.35, L * 0.52, cy + Bm * 0.35, dark); // mast yard
      for (let x = L * 0.86; x < L * 0.92; x++) gset(G, x, cy, K);
    }
    gset(G, 1, cy, K);
    gset(G, 1, cy - 1, K);
    nozzles = [[-L / 2, 0]];
  } else {
    // tanks & armoured vehicles: hull with tracks/wheels; turret is a separate canvas so it can aim
    const L = spec.len, Wd = spec.wid;
    G = grid(L, Wd);
    const paint = spec.paint;
    for (let y = 0; y < Wd; y++)
      for (let x = 0; x < L; x++) {
        const track = y < 3 || y >= Wd - 3;
        if (track) gset(G, x, y, spec.wheels ? (x % 5 < 3 && (y === 1 || y === Wd - 2) ? '#1c1c20' : '#3a3c40') : x % 2 ? '#2c2e33' : '#45484e');
        else gset(G, x, y, x < 4 ? shade(paint, 0.82) : paint);
      }
    for (let y = 4; y < Wd - 4; y += 2) gline(G, 1, y, 3, y, shade(paint, 0.6)); // engine grille
    gset(G, L - 2, 3, K);
    gset(G, L - 2, Wd - 4, K);
    const T = spec.turret, TG = grid(T + (spec.barrel || 0) + 2, T + 2);
    const tcx = T / 2 + 0.5, tcy = (T + 1) / 2;
    if (spec.box) {
      gpoly(TG, [[0, 1], [T + 4, 1], [T + 4, T + 1], [0, T + 1]], shade(paint, 0.9));
      for (let y = 2; y < T; y += 2) for (let x = 2; x < T + 3; x += 2) gset(TG, x, y, '#1c1c20');
    } else {
      if (spec.round) gellipse(TG, tcx, tcy, T / 2, T / 2, shade(paint, 1.08));
      else gpoly(TG, [[1, 1.5], [T - 1, 0.5], [T, tcy], [T - 1, T + 0.5], [1, T - 0.5]], shade(paint, 1.08));
      gline(TG, T - 1, tcy, T + spec.barrel, tcy, '#2a2c30');
      gline(TG, T - 1, tcy - 0.6, T + spec.barrel * 0.4, tcy - 0.6, '#3c3f45');
      gset(TG, tcx - 1, tcy - 1, K);
      gset(TG, tcx, tcy - 1, K);
    }
    turret = gridCanvas(TG);
    tpivot = [tcx + 1, tcy + 1];
    tpx = -L * 0.05;
    nozzles = [[-L / 2, 0]];
  }
  const c = gridCanvas(G);
  const art = { frames: [c], white: silhouette(c, '#ffffff'), dark: silhouette(c, '#000000'), w: c.width, h: c.height, rotors, turret, tpx, tpivot, nozzles, flash, pylons, stealth: spec.deck === 'sub' };
  V_CACHE.set(ck, art);
  return art;
}

// ------------------------------------------------------------------ buildings with height
// Each building is drawn in 3/4 view: a footprint plus `lift` pixels of height above it.
const LIFT = { apartment: 30, stonehut: 12, shop: 14, highrise: 64, mall: 26, police: 16, jail: 32, railway: 22, powerplant: 32, watertower: 30, pylon: 30, road: 0, lamp: 18, chaistall: 10, fruitcart: 10, busstop: 12, hoarding: 22, signal: 14, mandir: 34, grandmandir: 46, masjid: 30, gurudwara: 30, stupa: 30, archgate: 40, fort: 30, cantonment: 14, armydepot: 16, brahmosbase: 22, castle: 20, townhall: 20, house: 11, market: 9, well: 9, farm: 0, windmill: 18, wall: 8, tower: 22, barracks: 13, stable: 11, factory: 17, airbase: 8, harbor: 5, helipad: 3, shipyard: 16, samsite: 9, bunker: 6, radar: 18, hospital: 15, church: 26, lighthouse: 30, airport: 28, fence: 6 };
const B_CACHE = new Map();

// 3x5 pixel font for signboards (A-Z, 0-9 and a few symbols)
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011',
  H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '111101101101101',
  O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111',
  2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110', 6: '011100110101010', 7: '111001010010010', 8: '010101010101010',
  9: '010101011001110', ' ': '000000000000000', '-': '000000111000000', '+': '000010111010000', '!': '010010010000010', '.': '000000000000010',
};
export function pxText(g, x, y, str, col) {
  g.fillStyle = col;
  [...String(str).toUpperCase()].forEach((ch, k) => {
    const p = FONT[ch] || FONT[' '];
    for (let i = 0; i < 15; i++) if (p[i] === '1') g.fillRect(x + k * 4 + (i % 3), y + Math.floor(i / 3), 1, 1);
  });
}

export function buildingArt(type, w, h, color, customSprite, variant = 0) {
  const ck = type + color + '|' + variant;
  if (B_CACHE.has(ck)) return B_CACHE.get(ck);
  const W = w * TILE, H = h * TILE;
  const lift = customSprite ? Math.round(H * 0.35) : LIFT[type] ?? 8;
  const c = canvas(W, H + lift);
  const m = canvas(W, H + lift); // window glow mask (night)
  const g = c.getContext('2d'), gm = m.getContext('2d');
  const art = { c, mask: m, lift, W, H, flags: [], chimneys: [], lights: [], hub: null, fires: [], dish: null, beacon: null, prayer: [], search: [], steam: [], blink: [], signal: null, flame: null, train: null };
  if (customSprite) {
    g.imageSmoothingEnabled = false;
    g.drawImage(customSprite, 0, 0, W, H + lift);
    art.lights.push([W / 2, lift + H / 2, Math.max(W, H)]);
    B_CACHE.set(ck, art);
    return art;
  }
  const C = hex(color);
  const K = color, Kd = shade(color, 0.62), Kl = shade(color, 1.25), Kdd = shade(color, 0.45);
  const R = (x, y, ww, hh, col) => ((g.fillStyle = col), g.fillRect(x, y, ww, hh));
  const stone = (x, y, ww, hh, base = '#9a968e') => {
    R(x, y, ww, hh, base);
    for (let j = 0; j < hh; j += 3) {
      R(x, y + j, ww, 1, shade(base, 0.82));
      for (let i = (j / 3) % 2 ? 1 : 3; i < ww; i += 5) R(x + i, y + j, 1, 3, shade(base, 0.8));
    }
    for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) if (hash2(x + i, y + j, 3) < 0.08) R(x + i, y + j, 1, 1, shade(base, 1.12));
    R(x, y, 1, hh, shade(base, 1.12));
    R(x + ww - 1, y, 1, hh, shade(base, 0.7));
  };
  const plaster = (x, y, ww, hh, base = '#e6d7b4') => {
    R(x, y, ww, hh, base);
    R(x, y + hh - 1, ww, 1, shade(base, 0.75));
    R(x + ww - 1, y, 1, hh, shade(base, 0.8));
  };
  const planks = (x, y, ww, hh, base = '#8a5a30') => {
    R(x, y, ww, hh, base);
    for (let i = 0; i < ww; i += 3) R(x + i, y, 1, hh, shade(base, 0.75));
    R(x, y, ww, 1, shade(base, 1.2));
  };
  const roof = (x, y, ww, hh, col = K) => {
    // gable roof seen from the front-top: lit upper slope, shaded lower slope, tile rows
    const mid = y + Math.floor(hh * 0.45);
    for (let j = y; j < y + hh; j++) {
      const lit = j < mid;
      const base = lit ? shade(col, 1.12) : shade(col, 0.8);
      R(x, j, ww, 1, (j - y) % 2 === 0 ? base : shade(base, 0.9));
      for (let i = ((j - y) % 4) < 2 ? 1 : 3; i < ww; i += 4) R(x + i, j, 1, 1, shade(base, 0.82));
    }
    R(x, mid, ww, 1, shade(col, 1.35));
    R(x - 1, y + hh, ww + 2, 1, 'rgba(0,0,0,0.35)');
    R(x, y, ww, 1, shade(col, 0.7));
  };
  const win = (x, y, ww = 3, hh = 3) => {
    R(x - 1, y - 1, ww + 2, hh + 2, '#4a3420');
    R(x, y, ww, hh, '#2a3a58');
    R(x, y, 1, 1, '#9fc6ff');
    gm.fillStyle = '#ffd27a';
    gm.fillRect(x, y, ww, hh);
  };
  const door = (x, y, ww = 4, hh = 6) => {
    R(x - 1, y - 1, ww + 2, hh + 1, '#3a2614');
    R(x, y, ww, hh, '#6b4423');
    R(x + ww - 2, y + Math.floor(hh / 2), 1, 1, '#e8c547');
  };
  const cone = (cx, top, rad, hgt, col = K) => {
    for (let j = 0; j < hgt; j++) {
      const hw = Math.round((j / (hgt - 1)) * rad);
      for (let i = -hw; i <= hw; i++) R(cx + i, top + j, 1, 1, i < 0 ? shade(col, 1.15) : i === 0 ? shade(col, 1.3) : shade(col, 0.78));
    }
    R(cx - rad - 1, top + hgt, rad * 2 + 3, 1, 'rgba(0,0,0,0.3)');
  };
  const battlements = (x, y, ww, col = '#8e8a82') => {
    for (let i = 0; i < ww; i += 3) R(x + i, y, 2, 2, col), R(x + i, y + 2, 2, 1, shade(col, 0.7));
  };
  const F = lift; // y of footprint top
  const txt = (x, y, s, col) => pxText(g, x, y, s, col);
  const glow = (x, y, ww, hh, col = '#ffd27a') => ((gm.fillStyle = col), gm.fillRect(x, y, ww, hh));
  // modern window: dark glass, a glint, lit at night
  const pane = (x, y, ww = 2, hh = 2, lit = true) => {
    R(x, y, ww, hh, '#2c4560');
    R(x, y, 1, 1, '#9ec8f0');
    if (lit) glow(x, y, ww, hh);
  };
  // curvilinear temple spire (shikhara): narrow at the top, bulging toward the base, ribbed
  const shikhara = (cx, top, hw, hgt, col) => {
    for (let j = 0; j < hgt; j++) {
      const t = j / Math.max(1, hgt - 1);
      const ww = Math.max(1, Math.round(hw * (0.22 + 0.78 * Math.sin((t * Math.PI) / 2))));
      for (let i = -ww; i <= ww; i++) {
        let cc = i < -ww / 3 ? shade(col, 1.12) : i > ww / 3 ? shade(col, 0.8) : col;
        if (j % 3 === 2) cc = shade(cc, 0.86);
        if (i === 0) cc = shade(col, 1.22);
        R(cx + i, top + j, 1, 1, cc);
      }
    }
    const aw = Math.max(1, Math.round(hw * 0.32));
    R(cx - aw, top - 1, aw * 2 + 1, 1, shade(col, 1.28));
    R(cx, top - 3, 1, 2, '#f0c040');
    R(cx - 1, top - 2, 3, 1, '#d8a020');
  };
  const dome = (cx, top, r, col, finial = '#e8c040') => {
    for (let j = 0; j <= r; j++) {
      const ww = Math.round(Math.sqrt(r * r - (r - j) * (r - j)));
      for (let i = -ww; i <= ww; i++) R(cx + i, top + j, 1, 1, i < -ww / 3 ? shade(col, 1.15) : i > ww / 3 ? shade(col, 0.82) : col);
    }
    if (finial) R(cx, top - 2, 1, 2, finial);
  };
  const pillars = (x, y, ww, hh, n, col) => {
    for (let k = 0; k < n; k++) {
      const px = x + Math.round((k * (ww - 2)) / Math.max(1, n - 1));
      R(px, y, 2, hh, col);
      R(px, y, 1, hh, shade(col, 1.18));
    }
  };
  const wire = (x0, y0, x1) => {
    for (let x = x0; x < x1; x++) R(x, y0 - ((x % 4) < 2 ? 0 : 1), 1, 1, '#9aa0a8');
  };
  switch (type) {
    case 'house': {
      const wallTop = F + H - 9;
      plaster(1, wallTop, 14, 9);
      R(1, wallTop, 1, 9, '#6b4a2a');
      R(14, wallTop, 1, 9, '#6b4a2a');
      R(1, wallTop, 14, 1, '#6b4a2a');
      win(3, wallTop + 3);
      door(9, wallTop + 3, 3, 6);
      roof(0, 2, 16, wallTop - 2);
      R(11, 0, 3, 6, '#8a4a3a');
      R(11, 0, 3, 1, '#5a2a1e');
      art.chimneys.push([12.5, 0]);
      art.lights.push([8, wallTop + 4, 46]);
      break;
    }
    case 'townhall': {
      const wallTop = F + H - 13;
      stone(1, wallTop, 30, 13, '#cfc3a6');
      for (const x of [4, 10, 20, 26]) win(x, wallTop + 3, 3, 4);
      for (const x of [2, 8, 23, 29]) R(x, wallTop, 1, 13, '#f0e8d4');
      door(14, wallTop + 5, 4, 8);
      roof(0, 9, 32, wallTop - 9);
      stone(12, 0, 8, 16, '#d8ccb0');
      R(14, 5, 4, 4, '#f4f0e6');
      R(15, 6, 2, 1, '#2a2a2a');
      R(16, 6, 1, 2, '#2a2a2a');
      cone(16, -1, 5, 6);
      art.flags.push([16, -2]);
      art.lights.push([16, wallTop + 6, 80]);
      break;
    }
    case 'castle': {
      const front = F + H - 12;
      R(2, F - 4, W - 4, H, '#7d786e'); // courtyard
      for (let j = F - 4; j < F + H - 12; j += 4) for (let i = 4; i < W - 4; i += 4) R(i, j, 3, 3, '#86817a');
      stone(2, F - 8, W - 4, 6, '#a29d93'); // back wall
      battlements(2, F - 10, W - 4);
      stone(2, front, W - 4, 12, '#a29d93'); // front wall
      battlements(2, front - 2, W - 4);
      R(2, F - 8, 4, H - 4, '#a29d93');
      R(W - 6, F - 8, 4, H - 4, '#8e8a82');
      // keep
      stone(15, F - 6, 18, 20, '#b4afa4');
      roof(14, F - 16, 20, 10);
      win(19, F + 2, 3, 4);
      win(26, F + 2, 3, 4);
      // gate
      R(20, front + 3, 8, 9, '#2a1a10');
      R(21, front + 4, 6, 8, '#5a3a1c');
      for (let i = 21; i < 27; i += 2) R(i, front + 4, 1, 8, '#3a2614');
      // corner towers with conical roofs
      for (const [x, y] of [[0, F - 12], [W - 12, F - 12], [0, front - 6], [W - 12, front - 6]]) {
        stone(x, y + 4, 12, 14, '#aaa59b');
        battlements(x, y + 2, 12);
        cone(x + 6, y - 9, 6, 11);
        win(x + 5, y + 9, 2, 3);
        art.flags.push([x + 6, y - 10]);
      }
      art.lights.push([24, front + 6, 110], [6, front, 60], [W - 6, front, 60]);
      break;
    }
    case 'tower': {
      stone(2, 8, 12, F + H - 8, '#a6a197');
      R(2, 8, 12, 2, '#8e8a82');
      battlements(2, 6, 12);
      cone(8, -1, 6, 8);
      win(7, 14, 2, 4);
      R(6, F + H - 6, 4, 6, '#2a1a10');
      art.flags.push([8, -2]);
      art.lights.push([8, 12, 55]);
      art.fires.push([3, 9], [13, 9]);
      break;
    }
    case 'wall':
      stone(0, 3, 16, F + H - 3, '#9e998f');
      R(0, 3, 16, 5, '#b2ada3');
      battlements(0, 1, 16);
      R(0, F + 6, 16, 1, Kd);
      break;
    case 'barracks': {
      const wallTop = F + H - 12;
      planks(1, wallTop, 30, 12, '#9a6a3a');
      R(1, wallTop, 30, 1, '#5a3a1c');
      for (const x of [4, 24]) {
        R(x, wallTop + 3, 4, 5, K);
        R(x + 1, wallTop + 4, 2, 3, Kl);
        R(x, wallTop + 7, 4, 1, Kd);
      }
      win(11, wallTop + 3);
      win(19, wallTop + 3);
      door(14, wallTop + 5, 4, 7);
      roof(0, 4, 32, wallTop - 4);
      R(29, 0, 1, 10, '#3a3a3a');
      art.flags.push([30, 0]);
      art.lights.push([16, wallTop + 5, 70]);
      break;
    }
    case 'stable': {
      const wallTop = F + H - 11;
      planks(1, wallTop, 30, 11, '#8a3a2a');
      for (const x of [4, 13, 22]) {
        R(x, wallTop + 3, 6, 8, '#5a2418');
        for (let i = 0; i < 6; i++) R(x + i, wallTop + 3 + Math.round(i * 1.3), 1, 1, '#f0e0c0'), R(x + 5 - i, wallTop + 3 + Math.round(i * 1.3), 1, 1, '#f0e0c0');
      }
      roof(0, 3, 32, wallTop - 3);
      R(27, F + H - 6, 4, 4, '#e8c860');
      R(27, F + H - 6, 4, 1, '#f8e898');
      art.lights.push([16, wallTop + 4, 50]);
      break;
    }
    case 'factory': {
      const wallTop = F + H - 13;
      R(1, wallTop, 26, 13, '#7a808a');
      for (let i = 1; i < 27; i += 3) R(i, wallTop, 1, 13, '#626870');
      R(1, wallTop + 4, 26, 2, K);
      R(8, wallTop + 7, 12, 6, '#3a3e46');
      for (let j = wallTop + 8; j < wallTop + 13; j += 2) R(8, j, 12, 1, '#2a2e36');
      for (let s = 0; s < 3; s++) {
        const x = 1 + s * 9;
        for (let j = 0; j < 9; j++) {
          R(x, 8 + j, 9 - j, 1, '#8e949e');
          R(x + 9 - j - 1, 8 + j, 1, 1, '#5a6068');
        }
        R(x, 8, 2, 9, '#9fd8ff');
        gm.fillStyle = '#ffd27a';
        gm.fillRect(x, 8, 2, 9);
      }
      for (let j = 0; j < F + H - 2; j++) R(27, j, 4, 1, j % 6 < 3 ? '#b04030' : '#e8e0d8');
      R(26, 0, 6, 2, '#3a3a3a');
      art.chimneys.push([29, 0], [29, 0]);
      art.lights.push([14, wallTop + 6, 70]);
      break;
    }
    case 'airbase': {
      R(0, F + 10, W, H - 10, '#3a3c42');
      for (let i = 2; i < W; i += 6) R(i, F + H - 5, 3, 1, '#f0f0f0');
      R(0, F + 10, W, 1, '#55585f');
      for (let i = 1; i < W; i += 5) gm.fillStyle = '#ffe070', gm.fillRect(i, F + 11, 1, 1), R(i, F + 11, 1, 1, '#c8b060');
      // hangar
      for (let j = 0; j < 14; j++) {
        const hw = Math.round(Math.sqrt(1 - ((13 - j) / 13) ** 2) * 9);
        R(10 - hw, F - 4 + j, hw * 2 + 1, 1, j < 5 ? Kl : j < 10 ? K : Kd);
      }
      R(2, F + 6, 17, 6, '#2a2a30');
      R(4, F + 8, 13, 4, '#1a1a1e');
      // control tower
      stone(23, F - 6, 6, 16, '#c8c4bc');
      R(22, F - 8, 8, 4, '#7fd0ff');
      gm.fillStyle = '#ffd27a';
      gm.fillRect(22, F - 8, 8, 4);
      R(22, F - 9, 8, 1, '#3a3a3a');
      art.lights.push([26, F - 6, 50]);
      break;
    }
    case 'harbor': {
      planks(0, F, W, H, '#8a6038');
      for (const [x, y] of [[1, F + H - 3], [9, F + H - 3], [17, F + H - 3], [25, F + H - 3]]) R(x, y, 3, 3, '#4a3020');
      plaster(2, F - 3, 12, 9, '#c9b48a');
      roof(1, F - 5, 14, 4);
      door(6, F + 1, 4, 5);
      for (const [x, y, col] of [[18, F + 4, '#a07040'], [22, F + 4, '#7a5a3a'], [20, F + 1, '#b08050']]) (R(x, y, 4, 4, col), R(x, y, 4, 1, shade(col, 1.3)), R(x + 1, y + 1, 2, 2, shade(col, 0.8)));
      R(27, 0, 2, F + 8, '#e0b020');
      R(18, 0, 11, 2, '#e0b020');
      R(19, 2, 1, 4, '#3a3a3a');
      art.lights.push([8, F + 2, 60]);
      break;
    }
    case 'market':
      for (const [x, y, col] of [[1, 1, K], [17, 1, '#e0c040'], [1, F + 7, '#3f90d8'], [17, F + 7, K]]) {
        R(x, y + 5, 14, 8, '#7a5230');
        for (let i = 0; i < 14; i++) for (let j = 0; j < 5; j++) R(x + i, y + j, 1, 1, Math.floor(i / 2) % 2 ? '#f4f0e6' : col);
        R(x, y + 5, 14, 1, 'rgba(0,0,0,0.35)');
        for (let i = 0; i < 4; i++) R(x + 2 + i * 3, y + 8, 2, 2, ['#e04040', '#60c040', '#f0a020', '#c060e0'][(i + x) % 4]);
      }
      art.lights.push([16, F + 4, 60]);
      break;
    case 'well':
      for (let j = 0; j < 9; j++) for (let i = 0; i < 12; i++) {
        const d = ((i - 5.5) / 6) ** 2 + ((j - 4) / 4.5) ** 2;
        if (d < 1) R(2 + i, F + 3 + j, 1, 1, d < 0.45 ? '#1f4f8f' : d < 0.6 ? '#164070' : '#a29d93');
      }
      R(5, F + 6, 2, 1, '#8fc0ff');
      R(2, 3, 1, F + 4, '#5a3a1c');
      R(13, 3, 1, F + 4, '#5a3a1c');
      roof(1, 0, 14, 4);
      R(4, 5, 8, 1, '#7a5230');
      break;
    case 'farm':
      R(0, 0, W, H, '#6b4f2c');
      for (let j = 1; j < H - 1; j += 3) {
        const wheat = Math.floor(j / 9) % 2 === 0;
        for (let i = 1; i < W - 1; i++) {
          const v = hash2(i, j, 9);
          R(i, j, 1, 2, wheat ? (v < 0.3 ? '#c8a838' : v < 0.7 ? '#dcbc48' : '#ecd268') : v < 0.4 ? '#4a8a30' : '#62a640');
        }
      }
      for (let i = 0; i < W; i += 4) R(i, 0, 1, 2, '#5a3a1c'), R(i, H - 2, 1, 2, '#5a3a1c');
      R(0, 0, W, 1, '#8a6a40');
      R(0, H - 1, W, 1, '#5a3a1c');
      R(24, 6, 1, 7, '#5a3a1c');
      R(22, 8, 5, 1, '#5a3a1c');
      R(23, 8, 3, 3, K);
      R(23, 5, 3, 3, '#e8c060');
      break;
    case 'airport': {
      // row 0: hangars, terminal, tower · row 1: apron with parking boxes · row 2: taxiway · rows 3-4: runway
      const y0 = F, y1 = F + 16, y2 = F + 32, y3 = F + 48;
      R(0, y0, W, H, '#7f8388');
      R(0, y1, W, 16, '#8b8f95');
      for (let i = 0; i < 6; i++) {
        const cx = 20 + i * 22;
        R(cx - 9, y1 + 2, 18, 1, '#e8c840');
        R(cx - 9, y1 + 13, 18, 1, '#e8c840');
        R(cx - 9, y1 + 2, 1, 12, '#e8c840');
        R(cx + 8, y1 + 2, 1, 12, '#e8c840');
      }
      R(0, y2, W, 16, '#5d6067');
      R(0, y2 + 7, W, 1, '#e8c840');
      for (const x of [30, 120, 230]) R(x, y1 + 14, 1, 20, '#e8c840');
      R(0, y3, W, 32, '#36383e');
      for (let x = 0; x < W; x++) for (let y = y3; y < y3 + 32; y++) if (hash2(x, y, 5) < 0.05) R(x, y, 1, 1, '#2e3035');
      R(0, y3 + 1, W, 1, '#e8e8e8');
      R(0, y3 + 30, W, 1, '#e8e8e8');
      for (let x = 30; x < W - 30; x += 14) R(x, y3 + 15, 7, 2, '#f2f2f2');
      for (const tx0 of [4, W - 16]) for (let k = 0; k < 6; k++) R(tx0, y3 + 4 + k * 4, 12, 2, '#f2f2f2');
      for (const tx0 of [44, W - 56]) for (const yy of [y3 + 7, y3 + 22]) R(tx0, yy, 12, 3, '#e0e0e0');
      // runway numbers 09 / 27
      const digit = (x, y, d) => {
        const P = { 0: ['111', '101', '101', '101', '111'], 9: ['111', '101', '111', '001', '111'], 2: ['111', '001', '111', '100', '111'], 7: ['111', '001', '010', '010', '010'] }[d];
        P.forEach((row, j) => [...row].forEach((v, i) => v === '1' && R(x + i, y + j, 1, 1, '#f2f2f2')));
      };
      digit(20, y3 + 13, 0);
      digit(24, y3 + 13, 9);
      digit(W - 28, y3 + 13, 2);
      digit(W - 24, y3 + 13, 7);
      // edge lights (glow at night)
      for (let x = 2; x < W; x += 12) for (const yy of [y3, y3 + 31]) {
        R(x, yy, 1, 1, '#fff0a0');
        gm.fillStyle = '#fff2a0';
        gm.fillRect(x, yy, 1, 1);
      }
      for (const yy of [y3 + 4, y3 + 27]) (R(0, yy, 1, 1, '#40ff60'), (gm.fillStyle = '#40ff60'), gm.fillRect(0, yy, 1, 1), R(W - 1, yy, 1, 1, '#ff4040'), (gm.fillStyle = '#ff4040'), gm.fillRect(W - 1, yy, 1, 1));
      // hangars with arched kingdom-coloured roofs
      for (let h = 0; h < 3; h++) {
        const hx = 4 + h * 30;
        for (let j = 0; j < 14; j++) {
          const hw = Math.round(Math.sqrt(1 - ((13 - j) / 13) ** 2) * 13);
          R(hx + 13 - hw, y0 - 8 + j, hw * 2, 1, j < 4 ? Kl : j < 10 ? K : Kd);
          if (j % 3 === 0) R(hx + 13 - hw, y0 - 8 + j, hw * 2, 1, shade(K, j < 4 ? 1.1 : 0.85));
        }
        R(hx + 1, y0 + 6, 24, 10, '#c8ccd2');
        R(hx + 4, y0 + 8, 18, 8, '#2a2c32');
        R(hx + 4, y0 + 8, 18, 1, '#1a1c20');
      }
      // terminal with glass front
      R(100, y0 - 6, 76, 22, '#d8dce2');
      R(100, y0 - 6, 76, 2, '#f2f4f8');
      for (let x = 103; x < 174; x += 4) win(x, y0 + 4, 2, 6);
      R(100, y0 - 9, 76, 3, Kd);
      R(132, y0 + 9, 10, 7, '#3a5a7a');
      // control tower
      R(196, y0 - 12, 8, 28, '#c8ccd2');
      R(196, y0 - 12, 1, 28, '#e8ecf0');
      R(192, y0 - 20, 16, 8, '#2a3a4a');
      for (let x = 193; x < 207; x += 2) (R(x, y0 - 19, 1, 6, '#7fd0ff'), (gm.fillStyle = '#9fe0ff'), gm.fillRect(x, y0 - 19, 1, 6));
      R(191, y0 - 22, 18, 2, '#4a4e56');
      R(199, y0 - 26, 2, 4, '#3a3a3a');
      art.dish = [200, y0 - 27];
      // windsock
      R(230, y0 - 6, 1, 14, '#9a9a9a');
      R(231, y0 - 6, 6, 3, '#ff7a2a');
      R(233, y0 - 6, 2, 3, '#f2f2f2');
      art.flags.push([240, y0 - 4]);
      art.lights.push([138, y0 + 4, 90], [200, y0 - 16, 70], [40, y2, 70], [128, y2, 70], [216, y2, 70]);
      break;
    }
    case 'fence': {
      R(0, F + 7, 16, 1, '#5a5e64');
      for (let x = 0; x < 16; x++) for (let y = 1; y < F + 7; y++) if ((x + y) % 3 === 0 || (x - y + 30) % 3 === 0) R(x, y, 1, 1, 'rgba(200,205,212,0.55)');
      R(0, 0, 1, F + 8, '#6b7078');
      R(15, 0, 1, F + 8, '#6b7078');
      for (let x = 0; x < 16; x += 2) R(x, 0, 1, 1, '#9aa0a8');
      R(6, F + 5, 4, 2, K);
      break;
    }
    case 'helipad': {
      R(0, F, W, H, '#55595f');
      R(1, F + 1, W - 2, H - 2, '#4a4e54');
      for (let a = 0; a < 64; a++) R(16 + Math.round(Math.cos(a / 10) * 11), F + 16 + Math.round(Math.sin(a / 10) * 11), 1, 1, '#f0d050');
      R(11, F + 10, 2, 12, '#f2f2f2');
      R(19, F + 10, 2, 12, '#f2f2f2');
      R(13, F + 15, 6, 2, '#f2f2f2');
      for (const [x, y] of [[1, F + 1], [W - 2, F + 1], [1, F + H - 2], [W - 2, F + H - 2]]) (R(x, y, 1, 1, '#ff5040'), gm.fillStyle = '#ff6050', gm.fillRect(x, y, 1, 1));
      R(26, F - 3, 5, 4, K);
      art.lights.push([16, F + 16, 46]);
      break;
    }
    case 'shipyard': {
      planks(0, F, W, H, '#7a5a38');
      R(4, F + 4, 30, 22, '#2c4a6a'); // dry dock with a hull under construction
      R(6, F + 9, 24, 12, '#6f7a86');
      R(30, F + 11, 3, 8, '#6f7a86');
      R(8, F + 11, 18, 8, '#8e98a4');
      for (let x = 9; x < 26; x += 4) R(x, F + 12, 2, 2, '#3a3e46');
      stone(36, F - 6, 11, 20, '#b8b4aa');
      roof(35, F - 10, 13, 5);
      win(39, F - 2, 3, 3);
      R(2, 0, 2, F + 6, '#e0b020');
      R(2, 0, 30, 2, '#e0b020');
      R(18, 2, 1, 8, '#3a3a3a');
      R(17, 10, 3, 2, '#3a3a3a');
      art.lights.push([20, F + 14, 80], [41, F, 50]);
      break;
    }
    case 'samsite': {
      R(1, F + 6, 14, 10, '#6b7058');
      R(1, F + 6, 14, 1, '#8a906e');
      R(3, F + 1, 10, 8, '#5a5e4a');
      for (let i = 0; i < 4; i++) (R(4 + i * 2, 1, 2, F + 1, '#e8e8e8'), R(4 + i * 2, 0, 2, 2, '#ff4040'));
      R(12, F + 9, 3, 3, K);
      art.lights.push([8, F + 6, 30]);
      break;
    }
    case 'bunker': {
      for (let j = 0; j < 12; j++) {
        const hw = Math.round(Math.sqrt(1 - ((j - 11) / 12) ** 2) * 8);
        R(8 - hw, F - 4 + j, hw * 2, 1, j < 4 ? '#b8b4a8' : '#9a968c');
      }
      R(1, F + 8, 14, 8, '#8a867c');
      R(4, F + 4, 8, 2, '#1a1a1e');
      R(6, F + 1, 4, 1, K);
      art.lights.push([8, F + 5, 30]);
      break;
    }
    case 'radar': {
      R(6, 8, 4, F + 8, '#9a9a96');
      R(6, 8, 1, F + 8, '#c0c0bc');
      R(3, F + 8, 10, 8, '#7a7e84');
      R(3, F + 8, 10, 1, K);
      art.dish = [8, 6];
      art.lights.push([8, 6, 30]);
      break;
    }
    case 'hospital': {
      const wallTop = F + H - 14;
      plaster(1, wallTop, 30, 14, '#f2f2ee');
      for (const x of [4, 9, 20, 25]) win(x, wallTop + 3, 3, 3);
      door(14, wallTop + 6, 4, 8);
      R(1, wallTop + 10, 30, 1, '#e04848');
      R(0, 3, 32, wallTop - 3, '#e6e6e2');
      R(0, 3, 32, 2, '#ffffff');
      R(0, wallTop - 1, 32, 1, 'rgba(0,0,0,.3)');
      R(13, 5, 6, 2, '#e02828');
      R(15, 3, 2, 6, '#e02828');
      art.lights.push([16, wallTop + 4, 80]);
      break;
    }
    case 'church': {
      const wallTop = F + H - 13;
      stone(4, wallTop, 26, 13, '#c8c0b0');
      win(8, wallTop + 3, 2, 5);
      win(23, wallTop + 3, 2, 5);
      door(15, wallTop + 6, 4, 7);
      roof(3, F - 6, 28, wallTop - F + 6);
      stone(1, 6, 9, wallTop - 6 + 13, '#d0c8b8');
      cone(5, -1, 5, 9);
      R(5, -1, 1, 1, '#f0d050');
      win(4, 18, 2, 3);
      art.lights.push([18, wallTop + 4, 70]);
      break;
    }
    case 'lighthouse': {
      for (let j = 0; j < F + H - 4; j++) {
        const hw = Math.round(3 + (j / (F + H)) * 2.5);
        R(8 - hw, 6 + j, hw * 2, 1, Math.floor(j / 5) % 2 ? '#d83a3a' : '#f4f0e8');
        R(8 + hw - 1, 6 + j, 1, 1, 'rgba(0,0,0,.25)');
      }
      R(4, 2, 8, 5, '#2a2a2e');
      R(5, 3, 6, 3, '#fff2a0');
      gm.fillStyle = '#fff2a0';
      gm.fillRect(5, 3, 6, 3);
      cone(8, -2, 4, 4, '#2a2a2e');
      art.beacon = [8, 4];
      art.lights.push([8, 4, 120]);
      break;
    }
    case 'apartment': {
      const base = ['#e8a0b0', '#f0c850', '#8ab8e0', '#f09a50'][variant % 4];
      const top = 7;
      R(1, top, 14, F + H - top, base);
      R(1, top, 1, F + H - top, shade(base, 1.15));
      R(14, top, 1, F + H - top, shade(base, 0.75));
      for (let fy = top + 3, fl = 0; fy < F + H - 10; fy += 7, fl++) {
        R(1, fy - 1, 14, 1, shade(base, 0.85));
        for (const wx of [3, 10]) pane(wx, fy, 3, 3, hash2(wx, fy, variant) < 0.7);
        R(2, fy + 4, 6, 1, '#f0f0f0'); // balcony rail
        R(2, fy + 3, 1, 2, '#f0f0f0');
        if (hash2(fl, 3, variant) < 0.6) R(12, fy + 1, 2, 2, '#e8e8e8'); // AC unit
        for (let k = 0; k < 4; k++) if (hash2(k, fy, 7) < 0.6) R(9 + k, fy + 4, 1, 1, ['#e04040', '#4080e0', '#f0d040', '#ffffff'][k]); // washing on the line
      }
      R(1, F + H - 8, 14, 7, '#8a9098'); // shop shutter
      for (let j = F + H - 8; j < F + H - 1; j += 2) R(1, j, 14, 1, '#6e747c');
      R(1, F + H - 10, 14, 2, ['#d83a2a', '#2a8a40', '#2a5ac8', '#e0a020'][(variant + 1) % 4]);
      R(0, top - 1, 16, 1, shade(base, 0.6));
      R(2, top - 4, 4, 3, shade(base, 0.85)); // stair room
      R(9, top - 6, 5, 5, '#26262a'); // black water tank
      R(9, top - 6, 5, 1, '#4a4a52');
      R(10, top - 5, 1, 3, '#3a3a40');
      art.lights.push([8, F + H - 12, 46]);
      break;
    }
    case 'stonehut': {
      const wt = F + H - 10;
      stone(2, wt, 12, 10, '#8e8a84');
      R(1, wt - 3, 14, 3, '#6b4a2a');
      R(1, wt - 3, 14, 1, '#8a6a40');
      R(3, wt - 4, 2, 1, '#9a968e');
      R(10, wt - 4, 3, 1, '#9a968e');
      R(6, wt + 3, 5, 1, '#2a60b0');
      R(7, wt + 4, 3, 6, '#5a3a1c');
      R(3, wt + 3, 2, 3, '#c83a2a');
      pane(3, wt + 4, 2, 2);
      R(14, wt - 11, 1, 9, '#5a3a1c');
      art.prayer.push([1, wt - 5, 14, wt - 10]);
      art.lights.push([8, wt + 4, 40]);
      break;
    }
    case 'shop': {
      const words = [['CHAI', 'MED+'], ['PAAN', 'SODA'], ['DOSA', 'MILK'], ['SARI', 'CAKE']][variant % 4];
      const signs = [['#d83a2a', '#2a8a40'], ['#2a5ac8', '#e0a020'], ['#8a2ab0', '#e06020'], ['#d02860', '#2a8ab0']][variant % 4];
      plaster(0, 2, 32, F + H - 2, '#e8d8b8');
      for (let x = 3; x < 30; x += 5) pane(x, 5, 2, 3);
      R(22, 0, 7, 3, '#26262a');
      for (let s = 0; s < 2; s++) {
        const x = s * 16;
        R(x, F - 2, 16, 7, signs[s]);
        R(x, F - 2, 16, 1, shade(signs[s], 1.3));
        txt(x + 1, F - 1, words[s], '#fff8e0');
        glow(x, F - 2, 16, 7, '#ffe8a0');
        for (let i = 0; i < 16; i++) R(x + i, F + 5, 1, 2, Math.floor(i / 2) % 2 ? '#f4f0e6' : signs[s]); // awning
        R(x, F + 7, 16, 7, '#3a2a1a'); // open shop front
        for (let i = 0; i < 6; i++) R(x + 2 + i * 2, F + 9 + (i % 2), 1, 2, ['#e04040', '#60c040', '#f0a020', '#c060e0', '#40a0e0', '#f0e040'][i]);
        R(x, F + 7, 16, 2, '#8a9098'); // rolled-up shutter
        glow(x + 1, F + 9, 14, 5, '#ffcf70');
        art.lights.push([x + 7, F + 10, 40]);
      }
      R(15, F - 2, 1, H + 2, '#6a5a40');
      break;
    }
    case 'highrise': {
      const top = 5;
      for (let y = top; y < F + H - 6; y++) {
        const floor = (y - top) % 4;
        for (let x = 3; x < 29; x++) {
          if (floor === 0) R(x, y, 1, 1, '#4a5868');
          else if (x % 3 === 0) R(x, y, 1, 1, '#566676');
          else {
            const lit = hash2(Math.floor(x / 3), Math.floor((y - top) / 4), 11) < 0.45;
            R(x, y, 1, 1, x < 12 ? '#5a90c0' : x < 22 ? '#4a80b0' : '#3a6a98');
            if (lit) glow(x, y, 1, 1, '#ffe2a0');
          }
        }
      }
      R(3, top, 1, F + H - 6 - top, '#b8d8f0');
      R(28, top, 1, F + H - 6 - top, '#2a3a50');
      R(2, top - 2, 28, 2, '#4a525c');
      R(10, top - 4, 12, 2, '#5a626c');
      R(15, 0, 1, top - 3, '#9a9a9a');
      art.blink.push([15, 0, '#ff3030']);
      R(3, F + H - 6, 26, 6, '#24323e');
      R(10, F + H - 7, 12, 1, K);
      for (let x = 12; x < 20; x += 2) pane(x, F + H - 5, 1, 5);
      art.lights.push([16, F + H - 4, 70], [16, F, 90]);
      break;
    }
    case 'mall': {
      plaster(1, 8, 46, F + H - 18, '#ead8b8');
      R(0, 6, 48, 2, '#b8a888');
      for (const x of [6, 30]) R(x, 3, 8, 3, '#9aa0a8');
      R(14, 16, 20, F + H - 28, '#2c4a6a');
      for (let x = 14; x < 34; x += 4) R(x, 16, 1, F + H - 28, '#8ab0d0');
      glow(14, 16, 20, F + H - 28, '#ffe8b0');
      R(13, 9, 22, 7, '#1a1a2a');
      txt(16, 10, 'MALL', K);
      glow(16, 10, 15, 5, K);
      R(4, 12, 3, 12, '#e0408a');
      R(41, 12, 3, 12, '#2ab0e0');
      R(0, F + H - 10, 48, 10, '#5a5c62');
      for (let x = 3; x < 46; x += 6) R(x, F + H - 9, 1, 7, '#e8e8e8');
      for (const [x, col] of [[5, '#c82a2a'], [17, '#e8e8ea'], [35, '#2a5ac8']]) R(x, F + H - 7, 4, 3, col);
      art.lights.push([24, 24, 110], [8, F + H - 6, 50], [40, F + H - 6, 50]);
      break;
    }
    case 'police': {
      const wt = F + H - 15;
      plaster(1, wt, 30, 15, '#f0f0ec');
      R(1, wt + 1, 30, 7, '#2a4ab0');
      txt(4, wt + 2, 'POLICE', '#ffffff');
      glow(4, wt + 2, 23, 5, '#cfe0ff');
      for (const x of [4, 9, 20, 25]) pane(x, wt + 10, 3, 3);
      R(14, wt + 9, 4, 6, '#1e3a8a');
      R(0, 4, 32, wt - 4, '#d8d8d4');
      R(0, 4, 32, 1, '#f0f0ec');
      R(0, wt - 1, 32, 1, 'rgba(0,0,0,.3)');
      R(13, 2, 6, 2, '#3a3a40');
      art.blink.push([14, 2, '#ff3030', 0], [17, 2, '#3060ff', 1]);
      for (const [x, y] of [[3, 7], [7, 7], [3, 11]]) (R(x, y, 3, 2, '#e8e8e8'), R(x, y + 2, 3, 1, '#9a9a9a')); // AC units
      R(21, 6, 6, 6, '#26262a');
      R(21, 6, 6, 1, '#4a4a52');
      for (let x = 0; x < 32; x += 3) R(x, wt - 2, 2, 1, '#bcbcb8');
      R(28, 0, 1, wt, '#5a5a5a');
      art.flags.push([28, 1]);
      art.lights.push([16, wt + 8, 70]);
      break;
    }
    case 'jail': {
      const wall = '#c8b48a', fw = F + H - 14;
      R(4, F - 2, 56, H - 10, '#8a8070'); // yard
      for (let j = F; j < F + H - 14; j += 4) for (let i = 6; i < 58; i += 6) R(i, j, 2, 1, '#7a7062');
      stone(12, F + 2, 40, 14, '#a8a8a0'); // cell block
      R(11, F - 2, 42, 4, '#6e6e68');
      for (let x = 15; x < 50; x += 5) {
        R(x, F + 6, 3, 5, '#1e1e22');
        for (let b = 0; b < 3; b++) R(x + b, F + 6, 1, 5, b % 2 ? '#1e1e22' : '#7a7a80');
        glow(x, F + 6, 3, 5, '#ffcf80');
      }
      stone(0, F - 8, 64, 8, wall); // back wall
      wire(0, F - 9, 64);
      stone(0, F - 8, 4, H + 8, wall);
      stone(60, F - 8, 4, H + 8, wall);
      stone(0, fw, 64, 14, wall); // front wall
      wire(0, fw - 1, 64);
      R(26, fw + 5, 12, 9, '#2a2a30');
      for (let x = 27; x < 38; x += 2) R(x, fw + 5, 1, 9, '#7a7a80');
      R(22, fw, 20, 6, '#efe6cc');
      txt(25, fw + 1, 'JAIL', '#3a2a1a');
      for (const x of [1, 53]) {
        stone(x, fw - 26, 10, 40, '#b8a47a'); // watchtower
        R(x, fw - 26, 10, 1, '#d8c49a');
        R(x - 2, fw - 34, 14, 8, '#4a3e32');
        R(x - 2, fw - 34, 14, 1, '#6a5a48');
        pane(x, fw - 32, 4, 3);
        pane(x + 6, fw - 32, 4, 3);
        R(x - 3, fw - 37, 16, 3, '#a83a2a');
        R(x - 3, fw - 37, 16, 1, '#c85a48');
        art.search.push([x + 5, fw - 30]);
        art.lights.push([x + 5, fw - 28, 50]);
      }
      R(32, F - 22, 1, 14, '#5a5a5a');
      art.flags.push([32, F - 21]);
      art.lights.push([32, fw + 6, 70]);
      break;
    }
    case 'railway': {
      const brick = '#a84a32';
      R(6, 8, 68, F - 2, brick);
      for (let j = 10; j < F + 6; j += 3) for (let i = 7 + (j % 2) * 2; i < 73; i += 4) R(i, j, 1, 1, shade(brick, 0.85));
      R(6, 6, 68, 2, '#e8dcc0');
      R(5, 4, 70, 2, '#6a3a2a');
      for (let x = 10; x < 72; x += 7) {
        R(x, 13, 4, 6, '#e8dcc0');
        pane(x + 1, 14, 2, 4);
      }
      R(34, 0, 12, 10, '#c86040');
      R(34, 0, 12, 1, '#e8dcc0');
      R(37, 2, 6, 6, '#f6f2e8');
      R(39, 3, 1, 3, '#2a2a2a');
      R(40, 5, 2, 1, '#2a2a2a');
      glow(37, 2, 6, 6, '#fff2c0');
      R(24, F - 4, 32, 7, '#f0e8d0');
      txt(26, F - 3, 'RAILWAY', '#7a1f1a');
      R(0, F + 6, 80, 8, '#b8b4ac'); // platform
      R(0, F + 13, 80, 1, '#e8c840');
      for (let x = 4; x < 80; x += 16) (R(x, F + 4, 1, 6, '#5a5a5a'), R(x - 2, F + 3, 5, 1, '#3a3a3a'));
      R(0, F + 14, 80, H - 14, '#6a6058'); // ballast
      for (let x = 1; x < 80; x += 3) R(x, F + 16, 1, 10, '#4a3626');
      R(0, F + 17, 80, 1, '#c8ccd2');
      R(0, F + 24, 80, 1, '#c8ccd2');
      art.train = { y: F + 20, x0: 0, x1: 80 };
      art.lights.push([40, F + 6, 90], [12, F + 8, 50], [68, F + 8, 50]);
      break;
    }
    case 'powerplant': {
      R(0, F, 48, 48, '#7a7c80');
      for (const tx of [7, 25]) {
        for (let j = 0; j < 36; j++) {
          const t = j / 35; // 0 = rim, 1 = base
          const hw = Math.round(5.2 + 3.6 * (t - 0.32) ** 2 * (t > 0.32 ? 1.6 : 4.5));
          for (let i = -hw; i <= hw; i++) {
            const u2 = (i + hw) / (2 * hw);
            const col = u2 < 0.18 ? '#e6e8e6' : u2 < 0.45 ? '#d0d2d0' : u2 < 0.75 ? '#b8bab8' : '#9a9c9a';
            R(tx + 6 + i, F - 16 + j, 1, 1, j % 9 === 4 ? shade(col, 0.94) : col);
          }
        }
        R(tx, F - 16, 13, 2, '#5a5c5a');
        R(tx + 1, F - 16, 11, 1, '#3a3c3a');
        art.steam.push([tx + 6, F - 17, 1]);
      }
      R(4, F + 22, 40, 14, '#c8ccd2');
      R(4, F + 22, 40, 2, '#e8ecf0');
      for (let x = 7; x < 42; x += 4) pane(x, F + 27, 2, 3);
      for (let j = 4; j < F + 30; j++) R(42, j, 3, 1, Math.floor(j / 4) % 2 ? '#c83a2a' : '#f0f0f0');
      art.chimneys.push([43.5, 4]);
      for (const x of [6, 18, 30]) (R(x, F + 38, 8, 6, '#6a7078'), R(x, F + 38, 8, 1, '#8a9098'));
      for (let x = 2; x < 46; x += 2) R(x, F + 45, 1, 2, '#9aa0a8');
      art.lights.push([24, F + 28, 90]);
      break;
    }
    case 'watertower': {
      for (const x of [3, 12]) R(x, 14, 1, F + H - 15, '#7a7e84');
      for (let j = 16; j < F + H - 2; j += 6) for (let i = 0; i < 9; i++) R(3 + i, j + Math.round(i * 0.6), 1, 1, '#8a8e94');
      R(2, 5, 12, 10, '#d8dad8');
      R(2, 5, 3, 10, '#eceeec');
      R(11, 5, 3, 10, '#b0b4b4');
      R(2, 9, 12, 2, K);
      cone(8, 1, 6, 4, '#a8acb0');
      break;
    }
    case 'pylon': {
      for (let j = 0; j < F + H - 2; j++) {
        const hw = Math.round(1 + (j / (F + H)) * 5);
        R(8 - hw, j + 2, 1, 1, '#8a9098');
        R(8 + hw, j + 2, 1, 1, '#6a7078');
        if (j % 5 === 0) for (let i = -hw; i <= hw; i++) R(8 + i, j + 2, 1, 1, '#7a8088');
      }
      for (const y of [4, 10]) (R(0, y, 16, 1, '#7a8088'), R(0, y + 1, 1, 2, '#c8d8e8'), R(15, y + 1, 1, 2, '#c8d8e8'));
      break;
    }
    case 'road': {
      // variant = neighbour mask (1 N, 2 E, 4 S, 8 W) so roads join up with lane markings
      const m = variant;
      R(0, 0, 16, 16, '#4a4c52');
      for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) if (hash2(i, j, 21) < 0.08) R(i, j, 1, 1, '#55575d');
      const curb = '#a8a8a0', walk = '#8a8680';
      if (!(m & 1)) (R(0, 0, 16, 2, walk), R(0, 2, 16, 1, curb));
      if (!(m & 4)) (R(0, 14, 16, 2, walk), R(0, 13, 16, 1, curb));
      if (!(m & 8)) (R(0, 0, 2, 16, walk), R(2, 0, 1, 16, curb));
      if (!(m & 2)) (R(14, 0, 2, 16, walk), R(13, 0, 1, 16, curb));
      const ew = m & 10, ns = m & 5;
      const links = [1, 2, 4, 8].filter((b) => m & b).length;
      if (links <= 2 && ew && !ns) (R(1, 7, 5, 1, '#f0f0e8'), R(10, 7, 5, 1, '#f0f0e8'));
      else if (links <= 2 && ns && !ew) (R(7, 1, 1, 5, '#f0f0e8'), R(7, 10, 1, 5, '#f0f0e8'));
      else if (links >= 3) {
        if (m & 2) for (let j = 3; j < 13; j += 2) R(13, j, 3, 1, '#f0f0e8');
        if (m & 8) for (let j = 3; j < 13; j += 2) R(0, j, 3, 1, '#f0f0e8');
      }
      break;
    }
    case 'lamp': {
      R(7, 4, 1, F + 6, '#4a4e56');
      R(6, F + 9, 3, 2, '#3a3e46');
      R(7, 3, 5, 1, '#4a4e56');
      R(10, 3, 3, 2, '#f0f0d0');
      glow(10, 3, 3, 2, '#fff2c0');
      art.lights.push([11, 5, 80]);
      break;
    }
    case 'chaistall': {
      R(1, F + 3, 14, 7, '#8a5a30');
      R(1, F + 3, 14, 1, '#a8784a');
      txt(2, F + 5, 'CHAI', '#ffe066');
      R(3, F + 10, 2, 2, '#1a1a1e');
      R(11, F + 10, 2, 2, '#1a1a1e');
      R(10, F, 3, 3, '#c8c8c8');
      R(10, F, 3, 1, '#e8e8e8');
      R(4, F + 1, 1, 2, '#f0e8d0');
      R(6, F + 1, 1, 2, '#f0e8d0');
      for (let i = 0; i < 16; i++) R(i, F - 6, 1, 3, Math.floor(i / 2) % 2 ? '#f4f0e6' : '#d83a2a');
      R(1, F - 3, 1, 6, '#5a3a1c');
      R(14, F - 3, 1, 6, '#5a3a1c');
      art.steam.push([11, F - 1, 0]);
      art.lights.push([8, F + 2, 40]);
      break;
    }
    case 'fruitcart': {
      R(1, F + 4, 14, 5, '#7a5230');
      R(3, F + 9, 2, 2, '#1a1a1e');
      R(11, F + 9, 2, 2, '#1a1a1e');
      for (let i = 0; i < 12; i++) for (let j = 0; j < 3; j++) if (hash2(i, j, 5) < 0.85) R(2 + i, F + 1 + j, 1, 1, ['#f08a24', '#e02828', '#60c040', '#f0e040', '#c060e0'][(i + j * 2) % 5]);
      for (let i = -6; i <= 6; i++) R(8 + i, F - 6 + Math.round((i * i) / 12), 1, 2, i % 3 === 0 ? '#f0f0f0' : '#2a5ac8');
      R(8, F - 6, 1, 8, '#5a3a1c');
      break;
    }
    case 'busstop': {
      R(1, F - 2, 14, 2, '#2a5ac8');
      R(1, F - 2, 14, 1, '#4a7ae8');
      R(2, F, 1, 10, '#6a6e76');
      R(13, F, 1, 10, '#6a6e76');
      R(3, F, 10, 6, 'rgba(160,210,240,0.55)');
      R(4, F + 7, 8, 2, '#7a5230');
      R(13, F - 8, 1, 6, '#6a6e76');
      R(11, F - 13, 5, 7, '#e8e8e8');
      txt(11, F - 12, 'B', '#2a5ac8');
      art.lights.push([8, F + 2, 40]);
      break;
    }
    case 'hoarding': {
      R(3, 13, 1, F + H - 14, '#4a4e56');
      R(12, 13, 1, F + H - 14, '#4a4e56');
      R(0, 2, 16, 12, '#2a2a2e');
      const v = variant % 4;
      if (v === 0) {
        R(1, 3, 14, 10, '#f0d050');
        R(9, 7, 4, 4, '#ffffff');
        R(10, 8, 2, 2, '#8a5a30');
        R(10, 4, 1, 2, '#e0e0e0');
        txt(1, 4, 'CHA', '#7a2a10');
      } else if (v === 1) {
        R(1, 3, 14, 4, '#ff9933');
        R(1, 7, 14, 3, '#f6f6f6');
        R(1, 10, 14, 3, '#138808');
        txt(3, 6, 'JAI', '#1a2a8a');
      } else if (v === 2) {
        R(1, 3, 14, 10, '#2e8a46');
        R(10, 5, 1, 7, '#e8d8a0');
        R(12, 9, 2, 2, '#d83030');
        txt(1, 4, 'SIX', '#ffffff');
      } else {
        R(1, 3, 14, 10, '#3a7ad0');
        for (let i = 0; i < 14; i++) R(1 + i, 13 - Math.abs(((i * 3) % 12) - 6) / 1.5 - 1, 1, 1, '#ffffff');
        txt(1, 4, 'GO!', '#ffffff');
      }
      glow(1, 3, 14, 10, '#fff2d0');
      art.lights.push([8, 8, 46]);
      break;
    }
    case 'signal': {
      R(7, 6, 1, F + 8, '#3a3e46');
      R(6, 0, 4, 10, '#1e1e22');
      art.signal = [8, 1];
      break;
    }
    case 'mandir': {
      const sand = '#e8a050';
      R(2, F + H - 6, 28, 6, '#d8c8a8');
      for (let j = 0; j < 4; j++) R(12 - j, F + H - 4 + j, 8 + j * 2, 1, j % 2 ? '#e8dcc4' : '#cdbf9e');
      shikhara(16, 6, 9, F + H - 24, sand);
      R(5, F + H - 19, 22, 3, '#d88a40');
      R(5, F + H - 19, 22, 1, '#f0b060');
      pillars(6, F + H - 16, 20, 10, 5, '#efd8b0');
      R(13, F + H - 15, 6, 9, '#3a2410');
      glow(13, F + H - 15, 6, 9, '#ffb040');
      art.flags.push([16, 3, '#ff8a1e', 'tri']);
      art.lights.push([16, F + H - 10, 60]);
      for (const x of [4, 28]) (R(x, F + H - 7, 1, 1, '#ffd060'), glow(x, F + H - 7, 1, 1, '#ffd060'));
      break;
    }
    case 'grandmandir': {
      const sand = '#e8b48e', sandD = '#c8906a';
      R(0, F + H - 8, 64, 8, '#e0c4a4');
      for (let j = 0; j < 6; j++) R(24 - j, F + H - 6 + j, 16 + j * 2, 1, j % 2 ? '#ecdcc4' : '#d8c4a0');
      shikhara(32, 6, 13, F + H - 40, sand);
      for (const cx of [18, 46]) shikhara(cx, F + H - 50, 7, 16, sand);
      for (const cx of [8, 56]) shikhara(cx, F + H - 42, 5, 10, sand);
      R(4, F + H - 34, 56, 9, sand);
      for (let x = 6; x < 58; x += 5) (R(x, F + H - 32, 3, 5, sandD), R(x + 1, F + H - 33, 1, 1, sandD));
      R(2, F + H - 25, 60, 3, sandD);
      for (let x = 2; x < 62; x += 2) R(x, F + H - 25, 1, 1, shade(sandD, 1.2));
      pillars(4, F + H - 22, 56, 14, 12, '#f0d0b0');
      R(27, F + H - 20, 10, 12, '#4a2a14');
      glow(27, F + H - 20, 10, 12, '#ffb040');
      // golden festival lights along cornices and spires
      for (let x = 2; x < 62; x += 3) glow(x, F + H - 25, 1, 1, '#ffd060');
      for (let x = 4; x < 60; x += 3) glow(x, F + H - 34, 1, 1, '#ffd060');
      for (let y = 8; y < F + H - 34; y += 3) (glow(32 - 6, y, 1, 1, '#ffd060'), glow(32 + 6, y, 1, 1, '#ffd060'));
      art.flags.push([32, 2, '#ff8a1e', 'tri'], [18, F + H - 54, '#ff8a1e', 'tri'], [46, F + H - 54, '#ff8a1e', 'tri'], [8, F + H - 46, '#ff8a1e', 'tri'], [56, F + H - 46, '#ff8a1e', 'tri']);
      art.lights.push([32, F + H - 14, 130], [12, F + H - 20, 60], [52, F + H - 20, 60], [32, 20, 70]);
      break;
    }
    case 'masjid': {
      plaster(4, F + H - 14, 24, 14, '#f2f0ea');
      for (const x of [7, 14, 21]) {
        R(x, F + H - 10, 4, 9, '#2a6a4a');
        R(x + 1, F + H - 11, 2, 1, '#2a6a4a');
        glow(x, F + H - 10, 4, 9, '#ffe0a0');
      }
      R(3, F + H - 15, 26, 1, '#2a8a5a');
      dome(16, F + H - 25, 8, '#f4f4f0');
      R(9, F + H - 17, 15, 1, '#2a8a5a');
      for (const x of [2, 27]) {
        R(x, 8, 3, F + H - 8, '#f2f0ea');
        R(x + 2, 8, 1, F + H - 8, '#c8c4bc');
        R(x - 1, 14, 5, 1, '#d8d4cc');
        dome(x + 1, 4, 2, '#2e9a46');
        glow(x, 14, 3, 1, '#ffe0a0');
      }
      art.lights.push([16, F + H - 8, 70]);
      break;
    }
    case 'gurudwara': {
      plaster(4, F + H - 15, 24, 15, '#f4f2ec');
      for (const x of [7, 13, 19]) {
        R(x, F + H - 11, 4, 8, '#e8b850');
        R(x + 1, F + H - 10, 2, 7, '#2a2418');
        glow(x + 1, F + H - 10, 2, 7, '#ffd890');
      }
      R(3, F + H - 16, 26, 1, '#e8c060');
      dome(16, F + H - 28, 7, '#f0c040', '#f8e080');
      for (let j = F + H - 27; j < F + H - 21; j += 2) R(12, j, 9, 1, '#d8a828');
      for (const x of [6, 26]) dome(x, F + H - 20, 2, '#f0c040');
      R(29, 0, 1, F + H - 2, '#d8d8d8');
      R(28, F + H - 6, 3, 4, '#ff8a1e');
      art.flags.push([29, 2, '#ff8a1e', 'tri']);
      art.lights.push([16, F + H - 8, 70], [16, F + H - 24, 50]);
      break;
    }
    case 'stupa': {
      plaster(4, F + H - 16, 40, 16, '#f2efe6');
      R(4, F + H - 18, 40, 3, '#7a1f2a');
      R(3, F + H - 22, 42, 4, '#e0b040');
      R(3, F + H - 22, 42, 1, '#f8d870');
      for (const x of [8, 14, 30, 36]) (R(x - 1, F + H - 12, 5, 1, '#c83a2a'), pane(x, F + H - 11, 3, 4));
      R(21, F + H - 11, 6, 11, '#a82a2a');
      R(22, F + H - 10, 4, 10, '#7a1a1a');
      for (let x = 6; x < 44; x += 3) (R(x, F + H - 4, 2, 3, '#e0b040'), R(x, F + H - 4, 2, 1, '#f8d870'));
      dome(24, F + H - 34, 7, '#f6f6f2', null);
      for (let k = 0; k < 9; k++) R(23 - (k < 3 ? 1 : 0), F + H - 44 + k, 3 + (k < 3 ? 2 : 0), 1, k % 2 ? '#c89830' : '#e8c050');
      art.prayer.push([2, F + H - 23, 24, F + H - 44], [24, F + H - 44, 46, F + H - 23]);
      art.lights.push([24, F + H - 8, 70]);
      break;
    }
    case 'archgate': {
      const sand = '#d8b88a';
      R(3, 6, 26, F + H - 6, sand);
      R(3, 6, 2, F + H - 6, shade(sand, 1.12));
      R(27, 6, 2, F + H - 6, shade(sand, 0.78));
      for (let j = 0; j < 26; j++) {
        const hw = j < 5 ? Math.round(Math.sqrt(25 - (5 - j) ** 2)) : 5;
        R(16 - hw, 20 + j, hw * 2, 1, '#3a3028');
      }
      R(2, 6, 28, 2, shade(sand, 1.2));
      R(2, 14, 28, 1, shade(sand, 0.85));
      R(7, 9, 18, 4, shade(sand, 0.88));
      for (let x = 8; x < 24; x += 2) R(x, 10, 1, 2, shade(sand, 0.7));
      R(11, 2, 10, 4, shade(sand, 0.95));
      R(10, 1, 12, 1, shade(sand, 1.15));
      art.flame = [16, F + H - 3];
      art.lights.push([16, F + H - 6, 80], [16, 12, 50]);
      break;
    }
    case 'fort': {
      const red = '#b0442e';
      R(4, F - 4, 56, H - 10, '#a87a5a');
      stone(0, F - 10, 64, 8, red);
      for (let x = 0; x < 64; x += 4) R(x, F - 12, 3, 2, red);
      stone(0, F - 10, 5, H + 10, red);
      stone(59, F - 10, 5, H + 10, red);
      stone(0, F + H - 18, 64, 18, red);
      for (let x = 0; x < 64; x += 4) (R(x, F + H - 20, 3, 2, red), R(x + 1, F + H - 21, 1, 1, red));
      for (const x of [16, 40]) {
        stone(x, F + H - 30, 8, 30, '#c0503a');
        R(x - 1, F + H - 31, 10, 2, '#8a3220');
        dome(x + 4, F + H - 37, 4, '#f2f0ea', '#e8c040');
        pillars(x, F + H - 33, 8, 2, 4, '#f2f0ea');
      }
      R(26, F + H - 13, 12, 13, '#3a2418');
      R(27, F + H - 14, 10, 1, '#3a2418');
      for (const x of [0, 56]) dome(x + 4, F + H - 24, 3, '#f2f0ea');
      R(32, F + H - 46, 1, 14, '#5a5a5a');
      art.flags.push([32, F + H - 45]);
      art.lights.push([32, F + H - 8, 90], [20, F + H - 26, 50], [44, F + H - 26, 50]);
      break;
    }
    case 'cantonment': {
      R(0, F, 48, H, '#a89a78');
      for (const y of [F - 4, F + 10]) {
        R(2, y + 4, 26, 8, '#c8c0a8');
        roof(1, y, 28, 5, '#5e6a3e');
        for (let x = 4; x < 27; x += 5) pane(x, y + 6, 2, 3);
      }
      for (let i = 0; i < 6; i++) R(32 + i * 2, F + H - 6, 2, 2, i % 2 ? '#a8946a' : '#8a7a54');
      R(40, 0, 1, F + 4, '#5a5a5a');
      art.flags.push([40, 1]);
      R(32, F + 4, 14, 1, K);
      art.lights.push([14, F + 6, 60], [40, F + 10, 50]);
      break;
    }
    case 'armydepot': {
      R(0, F, 48, H, '#8a8c80');
      for (const hx of [2, 24]) {
        for (let j = 0; j < 14; j++) {
          const hw = Math.round(Math.sqrt(1 - ((13 - j) / 13) ** 2) * 10);
          R(hx + 11 - hw, F - 8 + j, hw * 2, 1, j < 5 ? '#76845a' : j < 10 ? '#5e6a3e' : '#4a5430');
        }
        R(hx + 1, F + 6, 20, 8, '#c8c4b4');
        R(hx + 4, F + 8, 14, 6, K);
        R(hx + 4, F + 8, 14, 1, Kl);
      }
      for (const x of [6, 30]) (R(x, F + 20, 10, 5, '#56633c'), R(x + 7, F + 20, 3, 5, '#6a7848'));
      art.lights.push([24, F + 10, 70]);
      break;
    }
    case 'brahmosbase': {
      R(0, F, 32, 32, '#8a8c90');
      R(2, F + 2, 28, 28, '#7a7c80');
      for (let x = 4; x < 28; x += 6) R(x, F + 26, 3, 1, '#e8c840');
      for (let k = 0; k < 26; k++) (R(6 + k * 0.7, F + 20 - k, 2, 1, '#3a3e30'), R(8 + k * 0.7, F + 22 - k, 1, 1, '#3a3e30'));
      for (let k = 0; k < 24; k++) R(8 + k * 0.7, F + 17 - k, 3, 2, k > 20 ? '#c8ccd0' : k % 8 === 3 ? '#ff9933' : k === 9 ? K : '#eef0f0');
      R(24, F - 8, 2, 2, '#9aa0a8');
      stone(20, F + 18, 10, 8, '#9a968c');
      art.dish = [26, F + 14];
      art.lights.push([16, F + 16, 60]);
      break;
    }    case 'windmill':
      for (let j = 0; j < F + H - 4; j++) {
        const hw = Math.round(3 + (j / (F + H)) * 3);
        R(8 - hw, 4 + j, hw * 2, 1, '#e8e0d0');
        R(8 + hw - 1, 4 + j, 1, 1, '#b8b0a0');
        R(8 - hw, 4 + j, 1, 1, '#ffffff');
      }
      cone(8, 0, 4, 6);
      door(6, F + H - 7, 4, 6);
      win(7, 12, 2, 2);
      art.hub = [8, 8];
      break;
  }
  if (!NO_OUTLINE.has(type)) outline(c);
  B_CACHE.set(ck, art);
  return art;
}
const NO_OUTLINE = new Set(['road', 'farm', 'helipad', 'airport', 'airbase']);
function outline(c) {
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 160;
  const add = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] < 40 && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) add.push(x, y);
  g.fillStyle = 'rgba(12,12,20,0.55)';
  for (let i = 0; i < add.length; i += 2) g.fillRect(add[i], add[i + 1], 1, 1);
}

// rotating windmill sails
export function drawSails(g, x, y, t) {
  g.save();
  g.translate(x, y);
  g.rotate(t);
  for (let i = 0; i < 4; i++) {
    g.rotate(Math.PI / 2);
    g.fillStyle = '#5a3a1c';
    g.fillRect(-0.5, 0, 1, 12);
    g.fillStyle = 'rgba(240,232,216,0.95)';
    g.fillRect(0.5, 3, 3, 9);
    g.fillStyle = 'rgba(160,150,130,0.9)';
    for (let k = 4; k < 12; k += 2) g.fillRect(0.5, k, 3, 0.6);
  }
  g.fillStyle = '#3a2614';
  g.fillRect(-1, -1, 2, 2);
  g.restore();
}

// waving pixel flag
// shape 'tri' = temple pennant (saffron triangle); otherwise a rectangular kingdom flag
export function drawFlag(g, x, y, color, t, seed, shape) {
  g.fillStyle = '#2a2a2e';
  g.fillRect(Math.round(x), Math.round(y) - 7, 1, 8);
  for (let i = 0; i < 6; i++) {
    const wave = Math.round(Math.sin(t * 6 + i * 0.9 + seed) * 0.8);
    g.fillStyle = i < 3 ? color : shade(color, 0.8);
    if (shape === 'tri') {
      const hgt = Math.max(1, 4 - Math.floor(i * 0.7));
      g.fillRect(Math.round(x) + 1 + i, Math.round(y) - 7 + wave + Math.floor((4 - hgt) / 2), 1, hgt);
    } else g.fillRect(Math.round(x) + 1 + i, Math.round(y) - 7 + wave, 1, 4);
  }
}

// strings of Himalayan prayer flags fluttering between two points
const PRAYER = ['#2a6ad8', '#f4f4f4', '#e02828', '#2e9a46', '#f0c020'];
export function drawPrayerFlags(g, x0, y0, x1, y1, t) {
  const n = Math.max(3, Math.round(Math.hypot(x1 - x0, y1 - y0) / 3));
  g.fillStyle = 'rgba(60,50,40,0.7)';
  for (let i = 0; i <= n; i++) {
    const f = i / n, sag = Math.sin(f * Math.PI) * 3;
    g.fillRect(Math.round(x0 + (x1 - x0) * f), Math.round(y0 + (y1 - y0) * f + sag), 1, 1);
  }
  for (let i = 1; i < n; i++) {
    const f = i / n, sag = Math.sin(f * Math.PI) * 3;
    const wave = Math.round(Math.sin(t * 7 + i * 1.3) * 0.7);
    g.fillStyle = PRAYER[i % 5];
    g.fillRect(Math.round(x0 + (x1 - x0) * f), Math.round(y0 + (y1 - y0) * f + sag) + 1 + wave, 2, 2);
  }
}

// ------------------------------------------------------------------ particles
export class Particles {
  constructor() {
    this.list = [];
  }
  add(p) {
    if (this.list.length > 2600) return;
    p.max = p.life;
    p.z = p.z || 0;
    p.vz = p.vz || 0;
    this.list.push(p);
  }
  update(dt) {
    const out = [];
    const spawn = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.flare && Math.random() < dt * 30) spawn.push({ layer: 'air', x: p.x, y: p.y, vx: 0, vy: 0, rise: 6, drag: 0.3, life: 1 + Math.random() * 0.6, size: 2, size1: 7, c0: hex('#f4f4f2'), c1: hex('#c8ccd2'), a0: 0.45, round: true });
      const drag = p.drag ? Math.pow(p.drag, dt) : 1;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.grav) {
        p.vz -= p.grav * dt;
        p.z += p.vz * dt;
        if (p.z < 0) {
          p.z = 0;
          p.vz *= -0.35;
          p.vx *= 0.6;
          p.vy *= 0.6;
        }
      } else if (p.rise) p.z += p.rise * dt;
      out.push(p);
    }
    this.list = out;
    for (const p of spawn) this.add(p);
  }
  draw(g, layer, vx0, vy0, vx1, vy1) {
    this.pass(g, layer, vx0, vy0, vx1, vy1, false);
    this.pass(g, layer, vx0, vy0, vx1, vy1, true); // fire & sparks over smoke
  }
  pass(g, layer, vx0, vy0, vx1, vy1, top) {
    for (const p of this.list) {
      if (p.layer !== layer || !!p.top !== top) continue;
      if (p.x < vx0 - 40 || p.x > vx1 + 40 || p.y < vy0 - 60 || p.y > vy1 + 40) continue;
      const t = 1 - p.life / p.max;
      const s = p.size1 != null ? p.size + (p.size1 - p.size) * t : p.size;
      const c = p.c1 ? mix(p.c0, p.c1, t) : p.c0;
      g.globalAlpha = (p.a0 ?? 1) * (1 - t) ** (p.fade ?? 1);
      if (p.add) g.globalCompositeOperation = 'lighter';
      if (p.ring) {
        // shockwave: an expanding, flattened ring on the ground
        g.strokeStyle = rgb(c);
        g.lineWidth = Math.max(1, (p.lw || 3) * (1 - t));
        g.beginPath();
        g.ellipse(p.x, p.y, Math.max(0.5, s), Math.max(0.5, s * 0.55), 0, 0, Math.PI * 2);
        g.stroke();
      } else if (p.round && s > 3) {
        g.fillStyle = rgb(c);
        g.beginPath();
        g.arc(Math.round(p.x), Math.round(p.y - p.z), s / 2, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = rgb(c);
        const r = Math.max(1, Math.round(s));
        g.fillRect(Math.round(p.x - r / 2), Math.round(p.y - p.z - r / 2), r, r);
      }
      if (p.add) g.globalCompositeOperation = 'source-over';
    }
    g.globalAlpha = 1;
  }
}

const C_FIRE0 = hex('#fff0a0'), C_FIRE1 = hex('#e8400c'), C_CORE = hex('#ffb030'), C_SMOKE0 = hex('#5a5652'), C_SMOKE1 = hex('#9a9690'), C_DEBRIS = hex('#3a2e24');
const R = Math.random;

export const fx = {
  explosion(P, x, y, r) {
    const n = Math.min(60, 14 + r);
    // blinding core + shockwave rings
    P.add({ layer: 'air', top: true, x, y, vx: 0, vy: 0, life: 0.16, size: r * 1.3 + 10, size1: r * 0.4, c0: hex('#ffffff'), c1: hex('#ffe08a'), add: true, round: true });
    P.add({ layer: 'ground', x, y: y + 2, vx: 0, vy: 0, life: 0.42, size: 4, size1: r * 2.8 + 26, c0: hex('#fff6dc'), a0: 0.8, ring: true, lw: 4 });
    if (r > 30) P.add({ layer: 'ground', x, y: y + 2, vx: 0, vy: 0, life: 0.7, size: 6, size1: r * 4.2 + 40, c0: hex('#e8dccc'), a0: 0.4, ring: true, lw: 2 });
    // rising mushroom of dark smoke
    for (let i = 0; i < Math.min(14, 4 + r / 4); i++)
      P.add({ layer: 'air', x: x + (R() - 0.5) * r * 0.5, y: y + (R() - 0.5) * r * 0.3, vx: (R() - 0.5) * 10 + 6, vy: -4, rise: 22 + R() * 14, drag: 0.3, life: 2.4 + R() * 1.6, size: 6 + R() * 4, size1: 16 + R() * 12, c0: hex('#3a3634'), c1: hex('#8a8682'), a0: 0.6, fade: 1.6, round: true });
    // embers that arc out and bounce
    for (let i = 0; i < 8; i++) {
      const a = R() * Math.PI * 2, s = 30 + R() * 70;
      P.add({ layer: 'air', top: true, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 50 + R() * 80, grav: 200, drag: 0.4, life: 1 + R() * 0.8, size: 1, c0: hex('#ffd060'), c1: hex('#ff5010'), add: true });
    }
    for (let i = 0; i < 6; i++) {
      const a = R() * Math.PI * 2, s = R() * r * 0.6;
      P.add({ layer: 'air', top: true, x: x + Math.cos(a) * r * 0.2, y: y + Math.sin(a) * r * 0.2, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 8, drag: 0.1, life: 0.3 + R() * 0.25, size: r * 0.35 + 4, size1: 2, c0: C_FIRE0, c1: C_CORE });
    }
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, s = (0.3 + R()) * r * 2.2;
      P.add({ layer: 'air', top: true, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 0.04, life: 0.35 + R() * 0.4, size: 3 + R() * 4, size1: 1, c0: C_CORE, c1: C_FIRE1, fade: 0.6 });
    }
    for (let i = 0; i < n * 0.6; i++) {
      const a = R() * Math.PI * 2, s = (0.2 + R()) * r;
      P.add({ layer: 'air', x: x + Math.cos(a) * r * 0.3, y: y + Math.sin(a) * r * 0.3, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, rise: 14, drag: 0.15, life: 1.2 + R() * 1.4, size: 4 + R() * 4, size1: 10 + R() * 8, c0: C_SMOKE0, c1: C_SMOKE1, a0: 0.75, fade: 1.4 });
    }
    for (let i = 0; i < 10; i++) {
      const a = R() * Math.PI * 2, s = 40 + R() * 90;
      P.add({ layer: 'air', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 60 + R() * 90, grav: 260, drag: 0.5, life: 0.9 + R() * 0.6, size: 1 + R() * 2, c0: C_DEBRIS, fade: 0.3 });
    }
    for (let i = 0; i < 14; i++) {
      const a = R() * Math.PI * 2, s = 120 + R() * 160;
      P.add({ layer: 'air', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 0.02, life: 0.2 + R() * 0.25, size: 1, c0: hex('#fff6a0'), add: true, top: true });
    }
  },
  hit(P, x, y, color, building) {
    const c = hex(color || '#ffe066');
    for (let i = 0; i < 5; i++) {
      const a = R() * Math.PI * 2, s = 40 + R() * 80;
      P.add({ layer: 'air', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 0.02, life: 0.12 + R() * 0.15, size: 1, c0: c, add: true, top: true });
    }
    if (building) for (let i = 0; i < 3; i++) P.add({ layer: 'air', x, y, vx: (R() - 0.5) * 30, vy: (R() - 0.5) * 30, vz: 30 + R() * 40, grav: 200, life: 0.5, size: 1, c0: hex('#8a8478') });
  },
  puff(P, x, y, color = '#e8e4dc') {
    const c = hex(color);
    for (let i = 0; i < 10; i++) {
      const a = R() * Math.PI * 2, s = 10 + R() * 30;
      P.add({ layer: 'air', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, rise: 10, drag: 0.1, life: 0.5 + R() * 0.4, size: 2 + R() * 2, size1: 4, c0: c, a0: 0.8 });
    }
  },
  dust(P, x, y) {
    P.add({ layer: 'ground', x: x + (R() - 0.5) * 6, y: y + (R() - 0.5) * 3, vx: (R() - 0.5) * 10, vy: (R() - 0.5) * 6, rise: 2, drag: 0.2, life: 0.6 + R() * 0.4, size: 2, size1: 5, c0: hex('#b8a274'), a0: 0.5 });
  },
  wake(P, x, y) {
    P.add({ layer: 'ground', x: x + (R() - 0.5) * 4, y: y + (R() - 0.5) * 4, vx: (R() - 0.5) * 8, vy: (R() - 0.5) * 8, life: 1.1 + R() * 0.5, size: 2, size1: 6, c0: hex('#e6f4fb'), a0: 0.55 });
  },
  smoke(P, x, y, heavy) {
    P.add({ layer: 'air', x: x + (R() - 0.5) * 3, y, vx: 6 + (R() - 0.5) * 6, vy: -4 + (R() - 0.5) * 4, rise: 12, drag: 0.4, life: 1.6 + R() * 1.2, size: heavy ? 3 : 2, size1: heavy ? 9 : 6, c0: heavy ? hex('#4a4644') : hex('#c8c4be'), c1: hex('#a8a4a0'), a0: heavy ? 0.7 : 0.45, fade: 1.3 });
  },
  fire(P, x, y) {
    P.add({ layer: 'air', x: x + (R() - 0.5) * 8, y: y + (R() - 0.5) * 4, vx: (R() - 0.5) * 8, vy: -6, rise: 18, life: 0.35 + R() * 0.3, size: 2 + R() * 2, size1: 1, c0: C_FIRE0, c1: C_FIRE1, top: true });
  },
  trail(P, x, y, color) {
    P.add({ layer: 'air', x, y, vx: (R() - 0.5) * 6, vy: (R() - 0.5) * 6, rise: 4, drag: 0.3, life: 0.5 + R() * 0.4, size: 2, size1: 5, c0: hex(color || '#c8c4be'), c1: hex('#8a8680'), a0: 0.55 });
  },
  // thick white missile smoke that lingers and spreads
  missileTrail(P, x, y, kind) {
    const dark = kind === 2 || kind === 5;
    P.add({ layer: 'air', x: x + (R() - 0.5) * 2, y: y + (R() - 0.5) * 2, vx: (R() - 0.5) * 8, vy: (R() - 0.5) * 8, rise: 3, drag: 0.25, life: 1.4 + R() * 1.2, size: 2.5, size1: 9 + R() * 5, c0: hex(dark ? '#c8c2b8' : '#f2f2f0'), c1: hex(dark ? '#8a8680' : '#c8ccd2'), a0: 0.55, fade: 1.3, round: true });
  },
  // launch blast: a puff of smoke and a quick flash at the rail
  launch(P, x, y, a) {
    for (let i = 0; i < 7; i++) {
      const s = 20 + R() * 50, aa = a + Math.PI + (R() - 0.5) * 1.6;
      P.add({ layer: 'air', x, y, vx: Math.cos(aa) * s, vy: Math.sin(aa) * s, rise: 4, drag: 0.15, life: 0.6 + R() * 0.6, size: 3, size1: 9, c0: hex('#f0f0ee'), c1: hex('#b8b8b4'), a0: 0.6, round: true });
    }
    P.add({ layer: 'air', top: true, x, y, vx: 0, vy: 0, life: 0.12, size: 9, size1: 3, c0: hex('#fff2c0'), add: true, round: true });
  },
  // flares: bright magnesium balls arcing away behind the aircraft, trailing smoke
  flares(P, x, y, a) {
    for (let i = 0; i < 6; i++) {
      const aa = a + Math.PI + (i - 2.5) * 0.35, s = 60 + R() * 60;
      P.add({ layer: 'air', top: true, x, y, vx: Math.cos(aa) * s, vy: Math.sin(aa) * s + 12, drag: 0.35, life: 1.6 + R() * 0.8, size: 3, size1: 1, c0: hex('#ffffff'), c1: hex('#ffb040'), add: true, flare: true });
    }
  },
  steam(P, x, y, big) {
    P.add({ layer: 'air', x: x + (R() - 0.5) * (big ? 8 : 2), y, vx: 5 + (R() - 0.5) * 4, vy: -8 - R() * 6, rise: big ? 16 : 8, drag: 0.35, life: big ? 2.6 + R() * 1.4 : 1 + R() * 0.6, size: big ? 5 : 1.5, size1: big ? 16 : 4, c0: hex('#f4f6f8'), c1: hex('#c8ccd2'), a0: big ? 0.75 : 0.5, fade: 1.2 });
  },
  sparkle(P, x, y, color) {
    P.add({ layer: 'air', x: x + (R() - 0.5) * 12, y: y + (R() - 0.5) * 12, vx: 0, vy: -10, life: 0.6, size: 1, c0: hex(color), add: true });
  },
};

// ------------------------------------------------------------------ lighting
export class Lighting {
  constructor() {
    this.c = canvas(16, 16);
    this.g = this.c.getContext('2d');
    this.scale = 3;
    this.spot = canvas(64, 64);
    const sg = this.spot.getContext('2d');
    const grd = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.65)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    sg.fillStyle = grd;
    sg.fillRect(0, 0, 64, 64);
    this.tints = new Map();
  }
  tint(color) {
    let t = this.tints.get(color);
    if (t) return t;
    t = canvas(64, 64);
    const g = t.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    this.tints.set(color, t);
    return t;
  }
  // lights: {x, y (screen px), r (screen px), i (0..1), color?, flash?}
  // Both the darkness mask and the coloured glows are rendered at 1/scale resolution into small
  // buffers and composited with ONE full-screen draw each, so 300 lights cost about as much as 3.
  render(ctx, W, H, darkness, ambient, lights, n = lights.length) {
    const sc = this.scale, lw = Math.ceil(W / sc), lh = Math.ceil(H / sc);
    if (lw < 1 || lh < 1) return; // minimised window: nothing to light
    if (this.c.width !== lw || this.c.height !== lh) (this.c.width = lw), (this.c.height = lh);
    if (!this.gc) (this.gc = canvas(lw, lh)), (this.gg = this.gc.getContext('2d'));
    if (this.gc.width !== lw || this.gc.height !== lh) (this.gc.width = lw), (this.gc.height = lh);
    if (darkness > 0.01) {
      const g = this.g;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, lw, lh);
      g.fillStyle = `rgba(${ambient[0]},${ambient[1]},${ambient[2]},${darkness})`;
      g.fillRect(0, 0, lw, lh);
      g.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < n; k++) {
        const l = lights[k], r = l.r / sc;
        if (r < 0.6) continue;
        g.globalAlpha = Math.min(1, l.i);
        g.drawImage(this.spot, l.x / sc - r, l.y / sc - r, r * 2, r * 2);
      }
      g.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.c, 0, 0, W, H);
      ctx.imageSmoothingEnabled = false;
    }
    const gg = this.gg;
    let any = false;
    for (let k = 0; k < n; k++) {
      const l = lights[k];
      if (!l.color) continue;
      const a = l.flash ? l.i * 0.8 : l.i * 0.28 * darkness;
      if (a < 0.02) continue;
      const r = (l.r * (l.flash ? 1 : 0.8)) / sc;
      if (r < 0.6) continue;
      if (!any) {
        any = true;
        gg.globalCompositeOperation = 'source-over';
        gg.clearRect(0, 0, lw, lh);
        gg.globalCompositeOperation = 'lighter';
      }
      gg.globalAlpha = Math.min(1, a);
      gg.drawImage(this.tint(l.color), l.x / sc - r, l.y / sc - r, r * 2, r * 2);
    }
    if (any) {
      gg.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.gc, 0, 0, W, H);
      ctx.imageSmoothingEnabled = false;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
// Day/night: t in [0,1), 0 = midnight. Returns darkness, ambient colour and a colour-grade tint.
export function skyAt(t) {
  const keys = [
    [0.0, 0.66, [8, 14, 44], null],
    [0.2, 0.6, [12, 18, 50], null],
    [0.25, 0.25, [60, 30, 60], [255, 170, 120, 0.16]],
    [0.3, 0.0, [0, 0, 0], [255, 220, 170, 0.08]],
    [0.4, 0.0, [0, 0, 0], null],
    [0.65, 0.0, [0, 0, 0], null],
    [0.72, 0.1, [70, 30, 50], [255, 140, 80, 0.2]],
    [0.78, 0.45, [30, 20, 60], [170, 90, 160, 0.12]],
    [0.85, 0.64, [8, 14, 44], null],
    [1.0, 0.66, [8, 14, 44], null],
  ];
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= t) i++;
  const [t0, d0, a0, g0] = keys[i], [t1, d1, a1, g1] = keys[i + 1];
  const f = (t - t0) / (t1 - t0 || 1);
  const ga = g0 || [g1 ? g1[0] : 255, g1 ? g1[1] : 255, g1 ? g1[2] : 255, 0];
  const gb = g1 || [ga[0], ga[1], ga[2], 0];
  return {
    darkness: d0 + (d1 - d0) * f,
    ambient: mix(a0, a1, f).map(Math.round),
    grade: [Math.round(ga[0] + (gb[0] - ga[0]) * f), Math.round(ga[1] + (gb[1] - ga[1]) * f), Math.round(ga[2] + (gb[2] - ga[2]) * f), ga[3] + (gb[3] - ga[3]) * f],
  };
}

// ------------------------------------------------------------------ clouds + weather
export class Clouds {
  constructor(seed) {
    this.shapes = [];
    for (let s = 0; s < 6; s++) {
      const w = 70 + Math.floor(hash2(s, seed, 1) * 70), h = Math.round(w * (0.45 + hash2(s, seed, 2) * 0.2));
      const c = canvas(w, h);
      const g = c.getContext('2d');
      g.fillStyle = '#0a1220';
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2);
          const n = nz(x * 1.6 + s * 40, y * 1.6 + s * 17);
          if (dx * dx + dy * dy < 0.55 + n * 0.6) g.fillRect(x, y, 1, 1);
        }
      this.shapes.push(c);
    }
    this.seed = seed;
    // puffy cumulus for the visible cloud layer: overlapping round puffs on a flat base, lit from the
    // top-left, grey-blue underneath, with feathered edges
    this.lit = this.shapes.map((sh, s) => {
      const w = sh.width, h = sh.height;
      const c = canvas(w, h);
      const g = c.getContext('2d');
      const img = g.createImageData(w, h), d = img.data;
      const puffs = [];
      const n = 5 + Math.floor(hash2(s, seed, 9) * 4);
      const base = h * 0.84;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        // domed: big puffs in the middle, small ones at the ends, all fitting inside the canvas
        const r = Math.min(w * 0.17, h * (0.16 + 0.26 * Math.sin(t * Math.PI) + hash2(i, s, 3) * 0.06));
        puffs.push([w * (0.16 + t * 0.68), base - r * 0.8 - (hash2(i, s, 4) * h * 0.06), r]);
      }
      // a second, higher row of puffs for a billowing top
      for (let i = 0; i < n - 2; i++) {
        const t = (i + 1) / (n - 1);
        const r = Math.min(w * 0.14, h * (0.12 + 0.18 * Math.sin(t * Math.PI)));
        puffs.push([w * (0.25 + t * 0.5), base - h * 0.32 - r * 0.6, r]);
      }
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let best = 0, nx = 0, ny = 0;
          for (const [px, py, r] of puffs) {
            const dx = (x - px) / r, dy = (y - py) / r, q = 1 - Math.hypot(dx, dy);
            if (q > best) (best = q), (nx = dx), (ny = dy);
          }
          if (best <= 0) continue;
          const flat = Math.max(0, Math.min(1, (base - y) / (h * 0.08))); // flat cloud base
          const a = Math.min(1, best * 3.2) * flat;
          if (a <= 0.02) continue;
          const light = 0.8 + 0.28 * (-ny * 0.75 - nx * 0.35) + (nz(x * 2 + s * 30, y * 2) - 0.5) * 0.08 - (y / h) * 0.12;
          const k = Math.max(0, Math.min(1, light));
          const i = (y * w + x) * 4;
          d[i] = 178 + 77 * k;
          d[i + 1] = 188 + 67 * k;
          d[i + 2] = 210 + 45 * k;
          d[i + 3] = a * 255;
        }
      g.putImageData(img, 0, 0);
      return c;
    });
  }
  // the clouds themselves, up in the sky (offset from their shadows by the sun angle)
  drawSky(g, vx0, vy0, vx1, vy1, time, alpha) {
    if (alpha <= 0.01) return;
    const CELL = 520, SCALE = 4;
    const wx = time * 9 - 70, wy = time * 4 - 110;
    g.globalAlpha = alpha;
    for (let cy = Math.floor((vy0 - wy - 800) / CELL); cy <= Math.floor((vy1 - wy) / CELL); cy++)
      for (let cx = Math.floor((vx0 - wx - 800) / CELL); cx <= Math.floor((vx1 - wx) / CELL); cx++) {
        const h = hash2(cx, cy, this.seed);
        if (h < 0.6) continue; // fewer, puffier clouds than the shadow field
        const shape = this.lit[Math.floor(h * 997) % this.lit.length];
        const x = cx * CELL + hash2(cx, cy, 5) * 200 + wx, y = cy * CELL + hash2(cx, cy, 6) * 200 + wy;
        g.drawImage(shape, Math.round(x), Math.round(y), shape.width * SCALE, shape.height * SCALE);
      }
    g.globalAlpha = 1;
  }
  draw(g, vx0, vy0, vx1, vy1, time, alpha) {
    const CELL = 520, SCALE = 4;
    // clouds live in "wind space" and the whole field drifts with the wind
    const wx = time * 9, wy = time * 4;
    g.globalAlpha = alpha;
    for (let cy = Math.floor((vy0 - wy - 800) / CELL); cy <= Math.floor((vy1 - wy) / CELL); cy++)
      for (let cx = Math.floor((vx0 - wx - 800) / CELL); cx <= Math.floor((vx1 - wx) / CELL); cx++) {
        const h = hash2(cx, cy, this.seed);
        if (h < 0.45) continue;
        const shape = this.shapes[Math.floor(h * 997) % this.shapes.length];
        const x = cx * CELL + hash2(cx, cy, 5) * 200 + wx, y = cy * CELL + hash2(cx, cy, 6) * 200 + wy;
        g.drawImage(shape, Math.round(x), Math.round(y), shape.width * SCALE, shape.height * SCALE);
      }
    g.globalAlpha = 1;
  }
}

// how rainy is it right now (deterministic from server time so every player agrees)
export function rainAt(seconds) {
  const p = seconds / 170;
  const i = Math.floor(p), f = p - i;
  const a = hash2(i, 7, 77), b = hash2(i + 1, 7, 77);
  const v = a + (b - a) * (f * f * (3 - 2 * f));
  return clamp01((v - 0.68) / 0.18);
}

export function drawRain(g, W, H, time, amount, dpr) {
  if (amount <= 0.01) return;
  const n = Math.floor(amount * 420);
  g.strokeStyle = 'rgba(190,210,240,0.45)';
  g.lineWidth = Math.max(1, dpr);
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const sp = 900 + hash2(i, 1, 9) * 500;
    const x = (hash2(i, 2, 9) * (W + 200) + time * sp * 0.25) % (W + 200) - 100;
    const y = (hash2(i, 3, 9) * H + time * sp) % H;
    g.moveTo(x, y);
    g.lineTo(x - 4 * dpr, y + 14 * dpr);
  }
  g.stroke();
}

// ------------------------------------------------------------------ weapon icons (HUD)
const ICONS = new Map();
export function weaponIcon(key, customSprite) {
  if (ICONS.has(key)) return ICONS.get(key);
  const c = canvas(16, 16);
  const g = c.getContext('2d');
  const R = (x, y, w, h, col) => ((g.fillStyle = col), g.fillRect(x, y, w, h));
  if (customSprite) {
    g.imageSmoothingEnabled = false;
    g.drawImage(customSprite, 0, 0, 16, 16);
  } else if (key === 'sword') {
    for (let i = 0; i < 10; i++) R(4 + i, 11 - i, 2, 1, i > 7 ? '#ffffff' : '#d8dce4'), R(4 + i, 12 - i, 1, 1, '#8a90a0');
    R(2, 11, 5, 2, '#c8a038');
    R(1, 13, 3, 2, '#6b4423');
  } else if (key === 'bow') {
    for (let i = 0; i < 12; i++) R(10 - Math.round(Math.sin((i / 11) * Math.PI) * 5), 2 + i, 2, 1, '#9a6a3a');
    R(10, 2, 1, 12, '#e8e8e8');
    R(3, 7, 10, 1, '#c8a060');
    R(13, 6, 2, 3, '#e0e0e0');
  } else if (key === 'rifle') {
    R(1, 7, 14, 2, '#3a3a40');
    R(2, 9, 4, 3, '#6b4423');
    R(8, 9, 2, 2, '#2a2a2e');
    R(13, 6, 1, 1, '#2a2a2e');
    R(1, 7, 14, 1, '#5a5a62');
  } else if (key === 'shotgun') {
    R(1, 6, 13, 3, '#2e2e34');
    R(1, 6, 13, 1, '#58585e');
    R(1, 9, 5, 3, '#7a4a28');
    R(8, 9, 3, 1, '#4a4a50');
  } else if (key === 'rocket') {
    R(1, 6, 13, 4, '#4a5a3a');
    R(1, 6, 13, 1, '#6a7a52');
    R(13, 5, 3, 6, '#2a2a2e');
    R(5, 10, 2, 3, '#2a2a2e');
    R(0, 7, 2, 2, '#ff6a2a');
  } else if (key === 'insas' || key === 'ak203') {
    R(1, 7, 13, 2, '#2e3034');
    R(1, 7, 13, 1, '#52565c');
    R(2, 9, 4, 3, key === 'ak203' ? '#2a2a2e' : '#6b4423');
    R(8, 9, 2, 4, '#2a2a2e');
    R(9, 9, 2, 1, key === 'insas' ? '#3a3e44' : '#2a2a2e');
    R(14, 7, 2, 1, '#1a1a1e');
  } else if (key === 'sniper') {
    R(0, 8, 16, 1, '#2a2e2a');
    R(1, 8, 9, 2, '#4a5a3a');
    R(5, 5, 6, 2, '#1a1a1e');
    R(5, 5, 1, 1, '#7fd0ff');
    R(1, 10, 4, 2, '#4a5a3a');
    R(8, 10, 1, 3, '#2a2a2e');
  } else if (key === 'lmg') {
    R(1, 6, 14, 3, '#2a2a2e');
    R(1, 6, 14, 1, '#56565c');
    R(1, 9, 4, 3, '#3a3a40');
    R(7, 9, 4, 3, '#4a5a3a');
    R(12, 9, 1, 4, '#2a2a2e');
    R(14, 9, 1, 4, '#2a2a2e');
  } else if (key === 'gustaf') {
    R(0, 6, 16, 4, '#4a5638');
    R(0, 6, 16, 1, '#6a7852');
    R(6, 4, 3, 2, '#2a2a2e');
    R(9, 10, 2, 3, '#2a2a2e');
    R(15, 6, 1, 4, '#1a1a1e');
  } else if (key === 'grenade') {
    R(5, 6, 6, 8, '#4a6a2a');
    R(5, 6, 6, 1, '#6a8a42');
    for (let y = 8; y < 14; y += 2) R(5, y, 6, 1, '#3a5220');
    R(7, 3, 2, 3, '#8a8a90');
    R(9, 3, 3, 1, '#8a8a90');
    R(11, 2, 2, 2, '#c8c8d0');
  } else if (key === 'lathi') {
    for (let i = 0; i < 13; i++) R(2 + i, 13 - i, 2, 1, i < 2 ? '#3a2a1a' : '#c8a060');
  } else {
    R(3, 6, 10, 4, '#8a8a90');
  }
  ICONS.set(key, c);
  return c;
}


// ------------------------------------------------------------------ ambient life (client-only decoration)
export class Ambient {
  constructor() {
    this.birds = [];
    this.bugs = [];
    this.splashes = [];
  }
  update(dt, v, map, night) {
    const W = v.x1 - v.x0, H = v.y1 - v.y0;
    const tileAt = (x, y) => {
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      return tx < 0 || ty < 0 || tx >= map.size || ty >= map.size ? -1 : map.tiles[ty * map.size + tx];
    };
    // bird flocks cross the sky in V formation during the day
    if (!night && this.birds.length < 2 && Math.random() < dt * 0.06) {
      const a = Math.random() * Math.PI * 2, sp = 55 + Math.random() * 30;
      const cx = (v.x0 + v.x1) / 2 - Math.cos(a) * (W / 2 + 120), cy = (v.y0 + v.y1) / 2 - Math.sin(a) * (H / 2 + 120);
      const n = 4 + Math.floor(Math.random() * 5), sea = tileAt(cx, cy) <= T.WATER;
      const members = [];
      for (let i = 0; i < n; i++) {
        const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        members.push({ dx: -Math.cos(a) * row * 9 + Math.cos(a + Math.PI / 2) * side * row * 7, dy: -Math.sin(a) * row * 9 + Math.sin(a + Math.PI / 2) * side * row * 7, ph: Math.random() * 6 });
      }
      this.birds.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: (W + H) / sp + 6, members, gull: sea });
    }
    for (const f of this.birds) (f.x += f.vx * dt), (f.y += f.vy * dt), (f.life -= dt);
    this.birds = this.birds.filter((f) => f.life > 0);
    // butterflies by day, fireflies by night
    const want = night ? 26 : 12;
    if (this.bugs.length < want && Math.random() < dt * 8) {
      const x = v.x0 + Math.random() * W, y = v.y0 + Math.random() * H, t = tileAt(x, y);
      if (night ? t === T.FOREST || t === T.GRASS : t === T.GRASS || t === T.HILL)
        this.bugs.push({ x, y, hx: x, hy: y, a: Math.random() * 6, life: 8 + Math.random() * 10, fly: night, col: ['#ffffff', '#ffe066', '#ff9fd0', '#9ad0ff', '#ffa040'][Math.floor(Math.random() * 5)] });
    }
    for (const b of this.bugs) {
      b.a += (Math.random() - 0.5) * dt * 6;
      b.x += Math.cos(b.a) * dt * (b.fly ? 10 : 22);
      b.y += Math.sin(b.a) * dt * (b.fly ? 10 : 22);
      if (Math.hypot(b.x - b.hx, b.y - b.hy) > 50) b.a = Math.atan2(b.hy - b.y, b.hx - b.x);
      b.life -= dt;
    }
    this.bugs = this.bugs.filter((b) => b.life > 0 && b.fly === night && b.x > v.x0 - 60 && b.x < v.x1 + 60 && b.y > v.y0 - 60 && b.y < v.y1 + 60);
    // fish jumping in the water
    if (Math.random() < dt * 0.9) {
      const x = v.x0 + Math.random() * W, y = v.y0 + Math.random() * H;
      if (tileAt(x, y) === T.WATER || tileAt(x, y) === T.DEEP) this.splashes.push({ x, y, t: 0 });
    }
    for (const s of this.splashes) s.t += dt;
    this.splashes = this.splashes.filter((s) => s.t < 1.2);
  }
  drawGround(g, time) {
    // fish splashes + bird shadows
    for (const s of this.splashes) {
      const r = 1 + Math.max(0, s.t) * 7;
      g.strokeStyle = `rgba(220,240,255,${0.7 * (1 - s.t / 1.2)})`;
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(s.x, s.y, r, r * 0.5, 0, 0, Math.PI * 2);
      g.stroke();
      if (s.t < 0.5) {
        g.fillStyle = s.t < 0.25 ? '#c0d8e8' : '#8fb8d8';
        g.fillRect(Math.round(s.x - 1), Math.round(s.y - 3 - Math.sin((s.t / 0.5) * Math.PI) * 6), 3, 1);
      }
    }
    g.fillStyle = 'rgba(8,14,24,0.22)';
    for (const f of this.birds) for (const m of f.members) g.fillRect(Math.round(f.x + m.dx + 14), Math.round(f.y + m.dy + 22), 3, 1);
  }
  drawAir(g, time, night) {
    for (const f of this.birds)
      for (const m of f.members) {
        const x = Math.round(f.x + m.dx), y = Math.round(f.y + m.dy);
        const up = Math.sin(time * 9 + m.ph) > 0;
        g.fillStyle = f.gull ? '#f4f4f0' : '#2a2a30';
        g.fillRect(x, y, 1, 1);
        g.fillRect(x - 2, y + (up ? -1 : 0), 2, 1);
        g.fillRect(x + 1, y + (up ? -1 : 0), 2, 1);
        if (f.gull) (g.fillStyle = '#9a9a9a'), g.fillRect(x - 2, y + (up ? -1 : 0), 1, 1), g.fillRect(x + 2, y + (up ? -1 : 0), 1, 1);
      }
    for (const b of this.bugs) {
      if (b.fly) {
        const on = Math.sin(time * 3 + b.hx) > 0.2;
        if (!on) continue;
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(200,255,120,0.35)';
        g.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 3, 3);
        g.fillStyle = '#f4ffb0';
        g.fillRect(Math.round(b.x), Math.round(b.y), 1, 1);
        g.globalCompositeOperation = 'source-over';
      } else {
        const flap = Math.sin(time * 18 + b.hx) > 0;
        g.fillStyle = b.col;
        g.fillRect(Math.round(b.x) - (flap ? 1 : 0), Math.round(b.y), flap ? 3 : 1, 1);
      }
    }
  }
}
// ------------------------------------------------------------------ baked object overlays (main thread or worker)
// Trees, rocks and their shadows for one chunk, pre-drawn into a single image used when zoomed out.
// `mask` (CH*CH bytes, 1 = building there) hides vegetation under/around buildings.
export const OV_M = 40;
let SHADOW = null;
function shadowEllipse() {
  if (SHADOW) return SHADOW;
  SHADOW = canvas(32, 12);
  const g = SHADOW.getContext('2d');
  g.fillStyle = 'rgba(8,14,24,0.34)';
  for (let y = 0; y < 12; y++) for (let x = 0; x < 32; x++) if (((x - 15.5) / 16) ** 2 + ((y - 5.5) / 6) ** 2 < 1) g.fillRect(x, y, 1, 1);
  return SHADOW;
}
export function bakeObjects(objects, cx, cy, step, mask) {
  const sc = 1 / step, size = Math.ceil((CH * TILE + OV_M * 2) * sc);
  const cv = canvas(size, size);
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  const ox = cx * CH * TILE - OV_M, oy = cy * CH * TILE - OV_M;
  const hidden = (o) => mask && mask[(o.ty - cy * CH) * CH + (o.tx - cx * CH)];
  const objs = step >= 4 ? objects.filter((o) => o.kind === 'oak' || o.kind === 'pine' || o.kind === 'snowpine' || o.kind === 'palm') : objects;
  if (step < 4) {
    g.globalAlpha = 0.55;
    const ell = shadowEllipse();
    for (const o of objs) {
      if (hidden(o)) continue;
      const art = natureArt(o.kind, o.v);
      g.drawImage(ell, Math.round((o.x - ox - art.shadow + 2) * sc), Math.round((o.y - oy - 3) * sc), Math.max(1, (art.shadow * 2 + 3) * sc), Math.max(1, 6 * sc));
    }
    g.globalAlpha = 1;
  }
  for (const o of objs) {
    if (hidden(o)) continue;
    const art = natureArt(o.kind, o.v);
    g.drawImage(art.c, Math.round((o.x - ox - art.ax) * sc), Math.round((o.y - oy - art.ay) * sc), Math.max(1, Math.round(art.c.width * sc)), Math.max(1, Math.round(art.c.height * sc)));
  }
  return cv;
}