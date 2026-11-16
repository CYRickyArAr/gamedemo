// 双人完整流程验证：大厅 → 躲藏 → 交换 → 寻找
// 用两个独立的浏览器进程，避免后台标签页被节流
import { chromium } from 'playwright';

const CODE = String(1000 + Math.floor(Math.random() * 9000));
const base = 'http://localhost:3000';

const ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage',
];

async function openPlayer(name) {
  const browser = await chromium.launch({ headless: true, args: ARGS });
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 576 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name} error]`, m.text());
  });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('#lobby:not(.hidden)', { timeout: 30000 });
  if (name === '甲') {
    await page.waitForTimeout(2200);
    await page.screenshot({ path: 'shots/lobby.png' });
  }
  await page.fill('#code', CODE);
  await page.fill('#name', name);
  await page.click('#join');
  return { page, name, browser };
}

const A = await openPlayer('甲');
const B = await openPlayer('乙');
console.log('房间码', CODE, '两名玩家已加入');

await A.page.waitForSelector('#hud:not(.hidden)', { timeout: 60000 });
await B.page.waitForSelector('#hud:not(.hidden)', { timeout: 60000 });
console.log('✓ 双方进入躲藏阶段');

const hideModeA = await A.page.evaluate(() => window.__game.mode);
const hideModeB = await B.page.evaluate(() => window.__game.mode);
console.log('hide 阶段 mode:', hideModeA, hideModeB);
if (hideModeA !== 'hide' || hideModeB !== 'hide') throw new Error('躲藏阶段状态错误');

// A 躲进柜子（验证 spotId 隐藏），B 躲在空走廊
const spotA = await A.page.evaluate(() => {
  const g = window.__game;
  const spot = g.world.hideSpots.find((s) => s.type === 'locker') || g.world.hideSpots[0];
  g.player.teleport(spot.x, spot.z, 0);
  g.player.enterHide(spot);
  g.confirmHide();
  return { x: spot.x, z: spot.z, yaw: spot.yaw, type: spot.type };
});
await B.page.evaluate(() => {
  const g = window.__game;
  const sp = g.world.spawns[0];
  g.player.teleport(sp.x + 12, sp.z, -Math.PI / 2);
  g.confirmHide();
});
console.log('A 藏在:', spotA);
console.log('双方已确认位置，等待交换…');

await A.page.waitForFunction(() => window.__game.mode === 'play', { timeout: 30000 });
await B.page.waitForFunction(() => window.__game.mode === 'play', { timeout: 30000 });
await A.page.waitForTimeout(1200);
await B.page.waitForTimeout(1200);
console.log('✓ 双方进入寻找阶段');

const stateA = await A.page.evaluate(() => ({
  mode: window.__game.mode,
  hasHider: !!window.__game.hider,
  hiderInside: !!window.__game.hider?.insideSpot,
  hiderPos: window.__game.hider?.position.toArray(),
  huntEnabled: window.__game.ghost?.huntEnabled,
  seed: window.__game.world?.seed,
  timer: document.getElementById('timer').textContent,
  meshes: (() => { let n = 0; window.__game.app.scene.traverse((o) => { if (o.isMesh) n++; }); return n; })(),
  lights: (() => { let n = 0; window.__game.app.scene.traverse((o) => { if (o.isLight) n++; }); return n; })(),
}));
const stateB = await B.page.evaluate(() => ({
  mode: window.__game.mode,
  hasHider: !!window.__game.hider,
  hiderInside: !!window.__game.hider?.insideSpot,
  hiderPos: window.__game.hider?.position.toArray(),
  seed: window.__game.world?.seed,
}));
console.log('A:', JSON.stringify(stateA));
console.log('B:', JSON.stringify(stateB));

if (!stateA.hasHider || !stateB.hasHider) throw new Error('隐藏体未生成');
if (stateA.huntEnabled !== true) throw new Error('鬼未启用猎杀');
if (stateA.seed === stateB.seed) throw new Error('双方地图种子不应相同');
if (stateB.hiderInside !== true) throw new Error('A 躲进柜子后，B 视角里的隐藏体应为 insideSpot');

await A.page.screenshot({ path: 'shots/flow-a.png' });
await B.page.screenshot({ path: 'shots/flow-b.png' });
console.log('✓ 流程截图已保存 shots/flow-a.png, shots/flow-b.png');

// EMF 探测器
await A.page.mouse.move(640, 360);
await A.page.mouse.down({ button: 'right' });
await A.page.waitForTimeout(900);
const emf = await A.page.evaluate(() => ({
  on: document.getElementById('emf').classList.contains('on'),
  reading: document.getElementById('emf-reading').textContent,
}));
await A.page.mouse.up({ button: 'right' });
console.log('EMF:', emf);
if (!emf.on) throw new Error('EMF 未激活');

// 鬼的猎杀状态：直接加速活动度，验证状态机
const hunt = await A.page.evaluate(async () => {
  const g = window.__game.ghost;
  g.activity = 100;
  g.cooldown = 0;
  await new Promise((r) => setTimeout(r, 1200));
  return { state: g.state, visible: g.group.visible, opacity: g.opacity };
});
console.log('鬼状态:', hunt);

// 找到对方：B 的图上，A 藏在柜子里 → B 走到柜子前按 E 检查
const spotInfo = await B.page.evaluate(() => {
  const g = window.__game;
  const s = g.hider.spot;
  if (!s) return null;
  const yaw = Number.isFinite(s.yaw) ? s.yaw : 0;
  const nx = Math.sin(yaw);
  const nz = Math.cos(yaw);
  g.player.teleport(s.x + nx * 1.4, s.z + nz * 1.4, Math.atan2(nx, nz));
  g.player.pitch = 0;
  return { x: s.x, z: s.z, yaw: s.yaw, type: s.type };
});
console.log('B 检查藏身处:', spotInfo);
if (!spotInfo) throw new Error('对方未进入藏身点（spotId 未生效）');
await B.page.bringToFront();
await B.page.waitForTimeout(400);
const diagBefore = await B.page.evaluate(() => {
  const g = window.__game;
  const h = g.hider;
  const p = g.player;
  const dx = h.position.x - p.position.x;
  const dz = h.position.z - p.position.z;
  const d = Math.hypot(dx, dz);
  const f = p.forward();
  return {
    mode: g.mode,
    inside: !!h.insideSpot,
    d,
    dot: (dx / d) * f.x + (dz / d) * f.z,
    player: p.position.toArray(),
    hPos: h.position.toArray(),
  };
});
console.log('E 之前:', diagBefore);
await B.page.keyboard.press('KeyE');
await B.page.waitForTimeout(600);
const diagAfter = await B.page.evaluate(() => ({ mode: window.__game.mode }));
console.log('E 之后:', diagAfter);
await B.page.waitForFunction(() => window.__game.mode === 'done', { timeout: 15000 });
await A.page.waitForSelector('#result:not(.hidden)', { timeout: 15000 });
const result = await A.page.evaluate(() => ({
  title: document.getElementById('result-title').textContent,
  reason: document.getElementById('result-reason').textContent,
}));
console.log('结算页:', result);

await A.page.click('#again');
await B.page.click('#again');
await A.page.waitForFunction(() => window.__game.mode === 'hide', { timeout: 30000 });
await B.page.waitForFunction(() => window.__game.mode === 'hide', { timeout: 30000 });
console.log('✓ 再来一局：回到躲藏阶段');

// 关闭 B，A 应回到大厅
await B.browser.close();
await A.page.waitForTimeout(2000);
const backLobby = await A.page.evaluate(() => ({
  mode: window.__game.mode,
  lobbyVisible: !document.getElementById('lobby').classList.contains('hidden'),
}));
console.log('B 掉线后 A:', backLobby);
if (!backLobby.lobbyVisible) throw new Error('掉线后未回到大厅');

await A.browser.close();
console.log('✓ 双人流程验证通过');
