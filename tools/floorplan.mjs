// 从运行中的游戏抓取世界数据，生成建筑户型图（SVG + PNG）
// 用法: node tools/floorplan.mjs [seed]   （需先 npm start）
import fs from 'node:fs';
import { chromium } from 'playwright';

const SEED = process.argv[2] || '1234';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});

// ---------- 抓取地图数据 ----------
const game = await browser.newPage({ viewport: { width: 800, height: 600 } });
game.on('pageerror', (e) => console.log('[pageerror]', e.message));
await game.goto(`http://localhost:3000/?dev=1&shot=1&cam=corridor&seed=${SEED}&noui=1`, { waitUntil: 'load' });
await game.waitForFunction('window.__ready === true', { timeout: 40000 });
await game.waitForTimeout(400);

const data = await game.evaluate(() => {
  const w = window.__game.world;
  return {
    seed: w.seed,
    width: w.width,
    depth: w.depth,
    tile: w.nav.TILE,
    grid: Array.from(w.grid),
    rooms: w.rooms.map((r, i) => ({
      i, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1,
      type: r.type, zone: r.zone,
      doors: r.doors.map((d) => ({ x: d.x, z: d.z, side: d.side })),
    })),
    doors: w.doors.map((d) => ({ x: d.x, z: d.z, side: d.side })),
    hideSpots: w.hideSpots.map((h) => ({ x: h.x, z: h.z, type: h.type, yaw: h.yaw })),
    spawns: w.spawns.map((s) => ({ x: s.x, z: s.z })),
  };
});
await game.close();
console.log(`seed ${data.seed} · ${data.rooms.length} 间房 · ${data.doors.length} 道门 · ${data.hideSpots.length} 个藏身点`);

const S = 30;            // 每格像素
const MX = 72;           // 左边距
const MY = 132;          // 上边距
const W = data.width;
const D = data.depth;
const TILE = data.tile;

const CW = W * S + MX * 2;
const CH = D * S + MY + 172;

const grid = data.grid;
const g = (x, z) => (x >= 0 && z >= 0 && x < W && z < D ? grid[z * W + x] : 0);
const px = (tx) => MX + tx * S;
const pz = (tz) => MY + tz * S;

const ROOM_STYLE = {
  ward:    { fill: '#2f4d43', label: '病房' },
  or:      { fill: '#2d4a5b', label: '手术室' },
  storage: { fill: '#4a4430', label: '储藏' },
  office:  { fill: '#4c3c2c', label: '办公' },
  morgue:  { fill: '#28394d', label: '停尸间' },
  bath:    { fill: '#31424a', label: '盥洗' },
};
const HIDE_STYLE = {
  locker:  { color: '#6dd3a0', label: '储物柜' },
  curtain: { color: '#b48ee8', label: '隔帘' },
  bed:     { color: '#e8c56a', label: '病床' },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const out = [];
const push = (s) => out.push(s);

// ---------- 背景 ----------
push(`<rect width="${CW}" height="${CH}" fill="#0a0e10"/>`);
push(`<rect x="0" y="0" width="${CW}" height="${CH}" fill="url(#paperGrain)" opacity="0.35"/>`);

// ---------- 标题 ----------
push(`<text x="${MX}" y="58" fill="#e8eef0" font-family="'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif" font-size="30" font-weight="700" letter-spacing="2">寂静病房 · SILENT WARD</text>`);
push(`<text x="${MX}" y="88" fill="#7d8b90" font-family="'PingFang SC','Hiragino Sans GB',sans-serif" font-size="14" letter-spacing="3">1F 平面图 / FLOOR PLAN · seed ${esc(data.seed)}</text>`);
push(`<text x="${MX}" y="110" fill="#55636a" font-family="'PingFang SC','Hiragino Sans GB',sans-serif" font-size="12">${W} × ${D} 格 · 每格 ${TILE} m · 建筑尺度 ${(W * TILE).toFixed(1)} × ${(D * TILE).toFixed(1)} m · ${data.rooms.length} 间房 / ${data.doors.length} 道门 / ${data.hideSpots.length} 个藏身点</text>`);

// ---------- 地板 ----------
for (let z = 0; z < D; z++) {
  for (let x = 0; x < W; x++) {
    if (g(x, z) === 1) {
      push(`<rect x="${px(x)}" y="${pz(z)}" width="${S}" height="${S}" fill="#374246"/>`);
    }
  }
}

// ---------- 房间填充 ----------
for (const r of data.rooms) {
  const st = ROOM_STYLE[r.type] || { fill: '#333' };
  const x = px(r.x0) + 1;
  const y = pz(r.z0) + 1;
  const w = (r.x1 - r.x0 + 1) * S - 2;
  const h = (r.z1 - r.z0 + 1) * S - 2;
  push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${st.fill}" opacity="0.82"/>`);
}

// ---------- 护士站 ----------
{
  const x = px(16);
  const y = pz(12);
  const w = 6 * S;
  const h = 6 * S;
  push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#5a4326" opacity="0.55"/>`);
  push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" fill="none" stroke="#e8b25a" stroke-width="1.5" stroke-dasharray="7 5" opacity="0.85"/>`);
  push(`<text x="${x + w / 2}" y="${y + h / 2 - 4}" text-anchor="middle" fill="#ffd79a" font-family="'PingFang SC',sans-serif" font-size="15" font-weight="700" letter-spacing="2">中央护士站</text>`);
  push(`<text x="${x + w / 2}" y="${y + h / 2 + 16}" text-anchor="middle" fill="#c9a06a" font-family="'PingFang SC',sans-serif" font-size="11" letter-spacing="1">NURSE STATION</text>`);
}

// ---------- 房间标签 ----------
for (const r of data.rooms) {
  const st = ROOM_STYLE[r.type] || { label: '?' };
  const cx = px((r.x0 + r.x1) / 2 + 0.5);
  const cz = pz((r.z0 + r.z1) / 2 + 0.5);
  const rw = (r.x1 - r.x0 + 1) * TILE;
  const wm = rw.toFixed(1);
  const dm = ((r.z1 - r.z0 + 1) * TILE).toFixed(1);
  const nameSize = Math.max(9.5, Math.min(14, ((r.x1 - r.x0 + 1) * S) / (st.label.length * 1.05)));
  push(`<text x="${cx}" y="${cz - 11}" text-anchor="middle" fill="#8fa0a6" font-family="'SF Mono',Menlo,monospace" font-size="9" letter-spacing="0.5" opacity="0.85">R${String(r.i + 1).padStart(2, '0')}</text>`);
  push(`<text x="${cx}" y="${cz + 6}" text-anchor="middle" fill="#f2f7f8" font-family="'PingFang SC',sans-serif" font-size="${nameSize.toFixed(1)}" font-weight="600">${esc(st.label)}</text>`);
  push(`<text x="${cx}" y="${cz + 21}" text-anchor="middle" fill="#9aa8ad" font-family="'SF Mono',Menlo,monospace" font-size="9">${wm}×${dm}</text>`);
}

// ---------- 墙体 ----------
const WALL = '#93a1a6';
for (let z = 0; z < D; z++) {
  for (let x = 0; x < W; x++) {
    if (g(x, z) !== 1) continue;
    const x0 = px(x);
    const y0 = pz(z);
    if (g(x, z - 1) === 0) push(`<line x1="${x0}" y1="${y0}" x2="${x0 + S}" y2="${y0}" stroke="${WALL}" stroke-width="2.2" stroke-linecap="square"/>`);
    if (g(x, z + 1) === 0) push(`<line x1="${x0}" y1="${y0 + S}" x2="${x0 + S}" y2="${y0 + S}" stroke="${WALL}" stroke-width="2.2" stroke-linecap="square"/>`);
    if (g(x - 1, z) === 0) push(`<line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y0 + S}" stroke="${WALL}" stroke-width="2.2" stroke-linecap="square"/>`);
    if (g(x + 1, z) === 0) push(`<line x1="${x0 + S}" y1="${y0}" x2="${x0 + S}" y2="${y0 + S}" stroke="${WALL}" stroke-width="2.2" stroke-linecap="square"/>`);
  }
}

// ---------- 门 ----------
const INWARD = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] };
for (const d of data.doors) {
  const cx = px(d.x + 0.5);
  const cz = pz(d.z + 0.5);
  const [ix, iz] = INWARD[d.side] || [0, 1];
  const a = Math.atan2(iz, ix);
  const R = S * 0.44;
  const a1 = a - Math.PI / 4;
  const a2 = a + Math.PI / 4;
  const x1 = cx + Math.cos(a1) * R;
  const y1 = cz + Math.sin(a1) * R;
  const x2 = cx + Math.cos(a2) * R;
  const y2 = cz + Math.sin(a2) * R;
  push(`<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="#e0b84c" stroke-width="2" opacity="0.95"/>`);
  push(`<line x1="${cx}" y1="${cz}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" stroke="#e0b84c" stroke-width="2" opacity="0.95"/>`);
}

// ---------- 藏身点 ----------
for (const h of data.hideSpots) {
  const cx = px(h.x / TILE);
  const cz = pz(h.z / TILE);
  const st = HIDE_STYLE[h.type] || { color: '#6dd3a0' };
  push(`<rect x="${cx - 4.5}" y="${cz - 4.5}" width="9" height="9" rx="1.5" fill="${st.color}" stroke="#0a0e10" stroke-width="1.5"/>`);
}

// ---------- 出生点 ----------
const spawns = [
  { p: data.spawns[0], c: '#ff5a45', n: 'A' },
  { p: data.spawns[1], c: '#4aa8ff', n: 'B' },
];
for (const s of spawns) {
  const cx = px(s.p.x / TILE);
  const cz = pz(s.p.z / TILE);
  push(`<circle cx="${cx}" cy="${cz}" r="12" fill="${s.c}" fill-opacity="0.22" stroke="${s.c}" stroke-width="2"/>`);
  push(`<circle cx="${cx}" cy="${cz}" r="4" fill="${s.c}"/>`);
  push(`<text x="${cx}" y="${cz + 26}" text-anchor="middle" fill="${s.c}" font-family="'SF Mono',Menlo,monospace" font-size="11" font-weight="700">SPAWN ${s.n}</text>`);
}

// ---------- 走廊标注 ----------
push(`<g font-family="'PingFang SC',sans-serif" fill="#93a1a6" paint-order="stroke" stroke="#0a0e10" stroke-width="4" opacity="0.95">`);
push(`<text x="${px(9)}" y="${pz(2.5) + 4}" text-anchor="middle" font-size="11" letter-spacing="7">外环走廊</text>`);
push(`<text x="${px(18.5)}" y="${pz(24.6)}" text-anchor="middle" font-size="11" letter-spacing="4" transform="rotate(90 ${px(18.5)} ${pz(24.6)})">十字走廊</text>`);
push(`<text x="${px(18.5)}" y="${pz(8)}" text-anchor="middle" font-size="11" letter-spacing="4" transform="rotate(90 ${px(18.5)} ${pz(8)})">十字走廊</text>`);
push(`</g>`);

// ---------- 指北针 ----------
{
  const nx = CW - 78;
  const ny = 64;
  push(`<g transform="translate(${nx} ${ny})">`);
  push(`<circle r="26" fill="none" stroke="#39474c" stroke-width="1.5"/>`);
  push(`<path d="M 0 -19 L 7 6 L 0 1 L -7 6 Z" fill="#e8eef0"/>`);
  push(`<text y="-30" text-anchor="middle" fill="#8b999e" font-family="'SF Mono',Menlo,monospace" font-size="11">N</text>`);
  push(`</g>`);
}

// ---------- 比例尺 ----------
{
  const bx = MX;
  const by = MY + D * S + 30;
  const seg = S; // 1 格 = TILE m
  push(`<g font-family="'SF Mono',Menlo,monospace" font-size="10" fill="#8b999e">`);
  for (let i = 0; i < 5; i++) {
    push(`<rect x="${bx + i * seg}" y="${by}" width="${seg}" height="7" fill="${i % 2 ? '#0a0e10' : '#c7d2d6'}" stroke="#c7d2d6" stroke-width="1"/>`);
  }
  push(`<text x="${bx}" y="${by + 22}">0</text>`);
  push(`<text x="${bx + 5 * seg}" y="${by + 22}" text-anchor="middle">${(5 * TILE).toFixed(0)} m</text>`);
  push(`</g>`);
}

// ---------- 图例 ----------
{
  const ly = MY + D * S + 92;
  let lx = MX;
  const item = (draw, label) => {
    draw(lx);
    push(`<text x="${lx + 18}" y="${ly + 4}" fill="#9aa8ad" font-family="'PingFang SC',sans-serif" font-size="12">${esc(label)}</text>`);
    lx += 26 + label.length * 12;
  };
  push(`<text x="${MX}" y="${ly - 20}" fill="#55636a" font-family="'PingFang SC',sans-serif" font-size="11" letter-spacing="3">图 例</text>`);
  item((x) => push(`<rect x="${x}" y="${ly - 6}" width="10" height="10" rx="3" fill="none" stroke="#e0b84c" stroke-width="2"/>`), '门');
  item((x) => push(`<rect x="${x + 1}" y="${ly - 4.5}" width="9" height="9" rx="1.5" fill="#6dd3a0"/>`), '储物柜');
  item((x) => push(`<rect x="${x + 1}" y="${ly - 4.5}" width="9" height="9" rx="1.5" fill="#b48ee8"/>`), '隔帘');
  item((x) => push(`<circle cx="${x + 5}" cy="${ly - 1}" r="5.5" fill="#ff5a45" fill-opacity="0.3" stroke="#ff5a45" stroke-width="1.5"/>`), '出生点');
  item((x) => push(`<rect x="${x + 1}" y="${ly - 5}" width="10" height="10" fill="#5a4326" stroke="#e8b25a" stroke-dasharray="3 2"/>`), '护士站');
}

// ---------- 分区说明 ----------
{
  const y0 = MY + D * S + 138;
  const zones = [
    ['#2f4d43', '西北 · 病房区'],
    ['#2d4a5b', '东北 · 手术区'],
    ['#28394d', '西南 · 停尸区'],
    ['#4c3c2c', '东南 · 办公区'],
  ];
  let x = MX;
  for (const [c, t] of zones) {
    push(`<rect x="${x}" y="${y0 - 9}" width="10" height="10" rx="2" fill="${c}"/>`);
    push(`<text x="${x + 16}" y="${y0}" fill="#7d8b90" font-family="'PingFang SC',sans-serif" font-size="11.5">${esc(t)}</text>`);
    x += 115;
  }
  push(`<text x="${CW - MX}" y="${y0}" text-anchor="end" fill="#3d4a4f" font-family="'SF Mono',Menlo,monospace" font-size="10">generated from src/hospital.js</text>`);
}

// ---------- 组装 ----------
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}">
<defs>
  <filter id="paperGrain">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
  </filter>
</defs>
${out.join('\n')}
</svg>`;

fs.mkdirSync('shots', { recursive: true });
fs.writeFileSync(`shots/floorplan-${SEED}.svg`, svg);
console.log(`svg -> shots/floorplan-${SEED}.svg  (${CW}x${CH})`);

// 转 PNG
const page = await browser.newPage({ viewport: { width: CW, height: CH }, deviceScaleFactor: 2 });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#0a0e10}</style></head><body>${svg}</body></html>`;
await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(html), { waitUntil: 'load' });
await page.waitForTimeout(300);
await page.screenshot({ path: `shots/floorplan-${SEED}.png` });
await browser.close();
console.log(`png -> shots/floorplan-${SEED}.png`);
