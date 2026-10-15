import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'pixel-kingdoms-test-'));
const port = 19000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const stopFile = path.join(temp, 'stop');
const env = { ...process.env, PORT: String(port), SAVE_DIR: path.join(temp, 'saves'), STOP_FILE: stopFile, FREE_AI: 'off', LOCAL_AI: 'off' };
for (const key of Object.keys(env)) if (key.startsWith('ANTHROPIC_')) delete env[key];
const sockets = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let logs = '';

async function start() {
  child = spawn(process.execPath, ['--import', 'data:text/javascript,globalThis.fetch=async()=>{throw Error("AI disabled in tests")}', 'server/index.js'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, logs);
    try { if ((await fetch(base + '/healthz', { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
    await delay(50);
  }
  throw Error('Server did not start: ' + logs);
}

async function open() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.add(ws);
  ws.messages = [];
  ws.on('message', data => ws.messages.push(JSON.parse(data)));
  ws.on('error', () => {});
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return ws;
}

async function message(ws, type) {
  for (let i = 0; i < 250; i++) {
    const found = ws.messages.findIndex(m => m.t === type);
    if (found >= 0) return ws.messages.splice(found, 1)[0];
    await delay(20);
  }
  throw Error(`Missing ${type}: ${logs}`);
}

async function stop() {
  const exited = new Promise(resolve => child.once('exit', resolve));
  await writeFile(stopFile, 'stop');
  await Promise.race([exited, delay(10000).then(() => { throw Error('Graceful shutdown timed out'); })]);
  assert.equal(child.exitCode, 0, logs);
}

try {
  await start();
  assert.equal((await fetch(base)).status, 200);
  const malformedStatus = await new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/%E0%A4%A' }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(malformedStatus, 400);
  const invalid = await open();
  await message(invalid, 'rooms');
  for (const value of ['null', '[]', '12', '"hello"', '{']) invalid.send(value);
  invalid.send(JSON.stringify({ t: 'list' }));
  await message(invalid, 'rooms');
  invalid.send('x'.repeat(65537));
  await new Promise(resolve => invalid.once('close', resolve));
  assert.equal((await fetch(base + '/healthz')).status, 200);

  const worlds = [];
  for (const [mode, capacity] of [['duo', 2], ['squad', 4], ['penta', 5]]) {
    const first = await open();
    first.send(JSON.stringify({ t: 'create', mode, size: 'large', bots: false, isPublic: false, name: 'Host' }));
    const joined = await message(first, 'joined');
    assert.equal(joined.room.max, capacity);
    const kingdoms = new Set([joined.kingdom]);
    for (let i = 1; i < capacity; i++) {
      const friend = await open();
      friend.send(JSON.stringify({ t: 'join', id: joined.room.id, name: 'Friend' + i }));
      kingdoms.add((await message(friend, 'joined')).kingdom);
      await message(friend, 's');
    }
    assert.equal(kingdoms.size, capacity);
    const extra = await open();
    extra.send(JSON.stringify({ t: 'join', id: joined.room.id }));
    assert.match((await message(extra, 'error')).text, /full/);
    await message(first, 's');
    worlds.push(joined);
  }
  for (const ws of sockets) ws.close();
  await delay(100);
  await stop();
  assert.equal((await readdir(env.SAVE_DIR)).filter(name => name.endsWith('.json.gz')).length, 3);
  await start();
  for (const world of worlds) {
    const ws = await open();
    ws.send(JSON.stringify({ t: 'rejoin', id: world.room.id, token: world.token, name: 'Host' }));
    assert.equal((await message(ws, 'joined')).kingdom, world.kingdom);
  }
  for (const ws of sockets) ws.close();
  await delay(100);
  await stop();
  console.log('PASS: malformed HTTP/JSON, oversized WebSocket payload, Duo/Squad/Penta capacity and snapshots, graceful save and restart/rejoin.');
} finally {
  for (const ws of sockets) ws.terminate();
  if (child?.exitCode === null) child.kill();
  if (!path.resolve(temp).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(temp).startsWith('pixel-kingdoms-test-')) throw Error('Unsafe test cleanup path');
  await rm(temp, { recursive: true, force: true });
}
