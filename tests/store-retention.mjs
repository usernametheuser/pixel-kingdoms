import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const temp = await mkdtemp(path.join(tmpdir(), 'pixel-kingdoms-retention-'));
process.env.SAVE_DIR = temp;
process.env.SAVE_DAYS = '0';
try {
  const keep = await import('../server/store.js?retention=disabled');
  await keep.saveRoom({
    id: 'OLD01',
    serialize: () => ({ id: 'OLD01', savedAt: Date.now() - 60 * 86400000 }),
    summary: () => ({ name: 'Retained world' }),
  });
  assert.equal(keep.listSaves().has('OLD01'), true, 'SAVE_DAYS=0 must preserve an old world');
  assert.equal((await keep.loadRoomData('OLD01')).id, 'OLD01');
  process.env.SAVE_DAYS = '30';
  const expire = await import('../server/store.js?retention=30');
  assert.equal(expire.listSaves().has('OLD01'), false, 'Configured expiry must still work');
  assert.equal(await expire.loadRoomData('OLD01'), null);
  console.log('PASS: unlimited cloud save retention and configured expiry.');
} finally {
  if (!path.resolve(temp).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(temp).startsWith('pixel-kingdoms-retention-')) throw Error('Unsafe test cleanup path');
  await rm(temp, { recursive: true, force: true });
}
