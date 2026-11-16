// 逐间房取景，用于人工核对每件家具的摆位
import { chromium } from 'playwright';

const SEED = process.argv[2] || '20261112';
const ONLY = process.argv[3] ? process.argv[3].split(',').map(Number) : null;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:3000/?dev=1&shot=1&seed=${SEED}&noui=1`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 60000 });
await page.waitForTimeout(800);

const rooms = await page.evaluate(() =>
  window.__game.world.rooms.map((r, i) => ({
    i,
    type: r.type,
    zone: r.zone,
    doors: r.doors.map((d) => d.side).join(''),
    w: r.x1 - r.x0 + 1,
    d: r.z1 - r.z0 + 1,
  })),
);
console.log(JSON.stringify(rooms, null, 1));

for (const r of rooms) {
  if (ONLY && !ONLY.includes(r.i)) continue;
  await page.evaluate((i) => {
    const g = window.__game;
    const w = g.world;
    const room = w.rooms[i];
    const d = room.doors[0];
    const T = w.nav.TILE;
    const inward = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] }[d.side];
    const px = (d.x + 0.5) * T + inward[0] * 1.25;
    const pz = (d.z + 0.5) * T + inward[1] * 1.25;
    g.player.teleport(px, pz, Math.atan2(-inward[0], -inward[1]));
    g.player.pitch = -0.16;
    g.player.updateCamera(0);
  }, r.i);
  await page.waitForTimeout(320);
  await page.screenshot({ path: `shots/room-${String(r.i).padStart(2, '0')}-${r.type}.png` });
}
await browser.close();
console.log('done');
