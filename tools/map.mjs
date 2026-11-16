// 生成地图俯视图 + 连通性自检
import { chromium } from 'playwright';
import fs from 'node:fs';

const SEED = process.argv[2] || '20261112';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto(`http://localhost:3000/?dev=1&shot=1&cam=corridor&seed=${SEED}&noui=1`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 40000 });
await page.waitForTimeout(800);

const result = await page.evaluate(() => {
  const w = window.__game.world;
  const W = w.width;
  const D = w.depth;
  const grid = w.grid;
  const T = 22;
  const canvas = document.createElement('canvas');
  canvas.width = W * T;
  canvas.height = D * T;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0a0d0e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 地板
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      if (grid[z * W + x] === 1) {
        ctx.fillStyle = '#2b3437';
        ctx.fillRect(x * T, z * T, T, T);
      }
    }
  }

  // 房间底色
  const COLORS = {
    ward: '#2f4d43',
    or: '#2d4a5b',
    storage: '#4a4430',
    office: '#4c3c2c',
    morgue: '#28394d',
    bath: '#31424a',
  };
  for (const r of w.rooms) {
    ctx.fillStyle = COLORS[r.type] || '#333';
    ctx.globalAlpha = 0.75;
    ctx.fillRect(r.x0 * T + 2, r.z0 * T + 2, (r.x1 - r.x0 + 1) * T - 4, (r.z1 - r.z0 + 1) * T - 4);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeRect(r.x0 * T + 2, r.z0 * T + 2, (r.x1 - r.x0 + 1) * T - 4, (r.z1 - r.z0 + 1) * T - 4);
  }

  // 门
  ctx.fillStyle = '#e0b84c';
  for (const d of w.doors) ctx.fillRect(d.x * T + T * 0.25, d.z * T + T * 0.25, T * 0.5, T * 0.5);

  // 藏身点
  ctx.fillStyle = '#62d68a';
  for (const h of w.hideSpots) {
    ctx.beginPath();
    ctx.arc((h.x / w.nav.TILE) * T, (h.z / w.nav.TILE) * T, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 出生点
  const spawnColors = ['#ff5a45', '#4aa8ff'];
  w.spawns.forEach((s, i) => {
    ctx.fillStyle = spawnColors[i];
    ctx.beginPath();
    ctx.arc((s.x / w.nav.TILE) * T, (s.z / w.nav.TILE) * T, 8, 0, Math.PI * 2);
    ctx.fill();
  });

  // 连通性 flood fill
  const seen = new Uint8Array(W * D);
  const sx = Math.floor(w.spawns[0].x / w.nav.TILE);
  const sz = Math.floor(w.spawns[0].z / w.nav.TILE);
  const stack = [[sx, sz]];
  seen[sz * W + sx] = 1;
  let reach = 0;
  while (stack.length) {
    const [x, z] = stack.pop();
    reach++;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
      const k = nz * W + nx;
      if (seen[k] || grid[k] !== 1) continue;
      seen[k] = 1;
      stack.push([nx, nz]);
    }
  }
  let total = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === 1) total++;

  // 门洞是否被家具堵住
  const T2 = w.nav.TILE;
  const blockedDoors = w.doors.filter((d) => {
    const dx = (d.x + 0.5) * T2;
    const dz = (d.z + 0.5) * T2;
    return w.colliders.some(
      (c) => dx > c.minX - 0.35 && dx < c.maxX + 0.35 && dz > c.minZ - 0.35 && dz < c.maxZ + 0.35,
    );
  }).length;

  // 出生点是否被家具占据
  const blockedSpawns = w.spawns.filter((s) =>
    w.colliders.some(
      (c) => s.x > c.minX - 0.35 && s.x < c.maxX + 0.35 && s.z > c.minZ - 0.35 && s.z < c.maxZ + 0.35,
    ),
  ).length;

  // 不可达地板标红
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      if (grid[z * W + x] === 1 && !seen[z * W + x]) {
        ctx.fillStyle = '#ff2a2a';
        ctx.fillRect(x * T + 4, z * T + 4, T - 8, T - 8);
      }
    }
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    stats: {
      rooms: w.rooms.length,
      doors: w.doors.length,
      hideSpots: w.hideSpots.length,
      floorTiles: total,
      reachable: reach,
      unreachable: total - reach,
      blockedDoors,
      blockedSpawns,
      colliders: w.colliders.length,
      types: w.rooms.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {}),
      roomDoors: w.rooms.map((r) => r.doors.length),
    },
  };
});

const base64 = result.dataUrl.split(',')[1];
fs.mkdirSync('shots', { recursive: true });
fs.writeFileSync(`shots/map-${SEED}.png`, Buffer.from(base64, 'base64'));
console.log(JSON.stringify(result.stats, null, 2));
await browser.close();
