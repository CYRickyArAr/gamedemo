import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (key, def) => {
  const hit = argv.find((s) => s.startsWith(`--${key}=`));
  return hit ? hit.slice(key.length + 3) : def;
};

const PORT = Number(arg('port', 3000));
const SEED = arg('seed', '20261112');
const SCENES = arg('scene', arg('cam', 'corridor,ward,or,ghost'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = path.resolve(arg('out', 'shots'));
const WIDTH = Number(arg('width', 1600));
const HEIGHT = Number(arg('height', 900));

const base = `http://localhost:${PORT}`;

async function ping() {
  try {
    const res = await fetch(`${base}/src/index.html`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await ping()) return true;
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

let server = null;
if (!(await ping())) {
  console.log('· 启动本地服务器…');
  server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const ok = await waitForServer();
  if (!ok) {
    console.error('服务器启动失败');
    process.exit(1);
  }
}

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
    '--disable-gpu-sandbox',
  ],
});

const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    errors.push(msg.text());
    console.error('[page:error]', msg.text());
  }
});
page.on('pageerror', (err) => {
  errors.push(err.message);
  console.error('[pageerror]', err.message);
});

let failed = false;

for (const scene of SCENES) {
  const url = `${base}/?dev=1&shot=1&cam=${encodeURIComponent(scene)}&seed=${SEED}&noui=1`;
  process.stdout.write(`· 渲染 ${scene} … `);
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction('window.__ready === true', { timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(2600);
    const file = path.join(OUT, `${scene}.png`);
    await page.screenshot({ path: file });
    const info = await page.evaluate(() => {
      const g = window.__game;
      if (!g) return null;
      return {
        fps: g.app?.fps,
        calls: g.app?.renderer?.info?.render?.calls,
        triangles: g.app?.renderer?.info?.render?.triangles,
      };
    });
    console.log(`ok (${JSON.stringify(info)}) → ${path.relative(process.cwd(), file)}`);
  } catch (err) {
    failed = true;
    console.error(`失败: ${err.message}`);
  }
}

await browser.close();
if (server) server.kill();

if (errors.length) {
  console.error(`\n共 ${errors.length} 条页面错误。`);
  failed = true;
}
process.exit(failed ? 1 : 0);
