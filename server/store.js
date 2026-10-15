// Room saves on disk: <SAVE_DIR>/<ID>.json.gz holds the whole world, <ID>.meta.json a small summary
// for the lobby. Writes go to a temp file first and are renamed into place, so a crash mid-save never
// corrupts the previous save.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SAVE_DIR = path.resolve(process.env.SAVE_DIR || path.join(__dirname, '..', 'saves'));
const retentionDays = Number(process.env.SAVE_DAYS ?? 30);
const KEEP_MS = retentionDays === 0 ? Infinity : (Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 30) * 86400000;
const ID_RE = /^[A-Z0-9]{5}$/;

fs.mkdirSync(SAVE_DIR, { recursive: true });

const file = (id, ext) => path.join(SAVE_DIR, `${id}.${ext}`);

function writeAtomic(target, data) {
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
}

export async function saveRoom(room) {
  const data = room.serialize();
  const gz = await gzip(JSON.stringify(data), { level: 6 });
  writeAtomic(file(room.id, 'json.gz'), gz);
  writeAtomic(file(room.id, 'meta.json'), JSON.stringify({ ...room.summary(), savedAt: data.savedAt, bytes: gz.length }));
  return gz.length;
}

// used on shutdown, where we can't wait for async work
export function saveRoomSync(room) {
  const data = room.serialize();
  const gz = zlib.gzipSync(JSON.stringify(data), { level: 3 });
  writeAtomic(file(room.id, 'json.gz'), gz);
  writeAtomic(file(room.id, 'meta.json'), JSON.stringify({ ...room.summary(), savedAt: data.savedAt, bytes: gz.length }));
}

export async function loadRoomData(id) {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse((await gunzip(fs.readFileSync(file(id, 'json.gz')))).toString());
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[save] could not load ${id}:`, e.message);
    return null;
  }
}

// summaries of every saved room; saves older than SAVE_DAYS are deleted
export function listSaves() {
  const out = new Map();
  for (const f of fs.readdirSync(SAVE_DIR)) {
    if (!f.endsWith('.meta.json')) continue;
    const id = f.slice(0, 5);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(SAVE_DIR, f), 'utf8'));
      if (Date.now() - meta.savedAt > KEEP_MS || !fs.existsSync(file(id, 'json.gz'))) {
        deleteSave(id);
        continue;
      }
      out.set(id, meta);
    } catch {}
  }
  return out;
}

export function deleteSave(id) {
  for (const ext of ['json.gz', 'meta.json']) fs.rmSync(file(id, ext), { force: true });
}
