// Background terrain renderer: builds map chunks (terrain + baked trees/rocks overlay) off the main
// thread so panning and zooming never stutter. The map is regenerated here from the same seed
// (deterministic), so only (cx, cy, step, building mask) travel over the wire.
import { generateMap } from './shared/map.js';
import { loadGeo } from './shared/geo.js';
import { Terrain, bakeObjects } from './gfx.js';

let terrain = null;
const backlog = [];

onmessage = async (e) => {
  const m = e.data;
  if (m.t === 'init') {
    await loadGeo(m.world || 'random'); // real-world maps need their coastlines first
    terrain = new Terrain(generateMap(m.size, m.seed, m.world || 'random'));
    for (const b of backlog.splice(0)) build(b);
    return;
  }
  if (m.t === 'build') terrain ? build(m) : backlog.push(m);
};

function build(m) {
  const c = terrain.build(m.cx, m.cy, m.step);
  const bmp = c.canvas.transferToImageBitmap();
  const ov = bakeObjects(c.objects, m.cx, m.cy, m.step, m.mask).transferToImageBitmap();
  postMessage({ t: 'chunk', key: m.key, cx: m.cx, cy: m.cy, step: m.step, ver: m.ver, bmp, ov, objects: m.step === 1 ? c.objects : [] }, [bmp, ov]);
}
