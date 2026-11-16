// 房间协议冒烟测试：模拟两名玩家走完 躲藏 → 交换 → 找到
import WebSocket from 'ws';

const URL = process.env.WS_URL || 'ws://localhost:3000';
const CODE = String(1000 + Math.floor(Math.random() * 9000));

function client(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const state = { name, ws, msgs: [], slot: null };
    const timer = setTimeout(() => reject(new Error(`${name} 超时`)), 8000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code: CODE, name })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      state.msgs.push(msg);
      if (msg.t === 'joined') {
        state.slot = msg.slot;
        clearTimeout(timer);
        resolve(state);
      }
      if (msg.t === 'error') reject(new Error(msg.message));
    });
    ws.on('error', reject);
  });
}

const waitFor = (state, type, ms = 6000) =>
  new Promise((resolve, reject) => {
    const found = state.msgs.find((m) => m.t === type);
    if (found) return resolve(found);
    const timer = setTimeout(() => reject(new Error(`${state.name} 未收到 ${type}`)), ms);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.t === type) {
        clearTimeout(timer);
        state.ws.off('message', handler);
        resolve(msg);
      }
    };
    state.ws.on('message', handler);
  });

const a = await client('A');
const b = await client('B');
console.log('joined:', a.slot, b.slot);

const ha = await waitFor(a, 'hidePhase');
const hb = await waitFor(b, 'hidePhase');
console.log('hidePhase seeds:', ha.seedSelf, hb.seedSelf, 'slot:', ha.slot, hb.slot);

a.ws.send(JSON.stringify({ t: 'hide', x: 10, z: 10, yaw: 0 }));
b.ws.send(JSON.stringify({ t: 'hide', x: 20, z: 20, yaw: 1.5 }));

const sa = await waitFor(a, 'start');
const sb = await waitFor(b, 'start');
console.log('start:', {
  aOn: sa.youAreOn,
  bOn: sb.youAreOn,
  aSeesHidden: sa.peerHidden,
  bSeesHidden: sb.peerHidden,
  duration: sa.duration,
});

if (sa.youAreOn !== 1 || sb.youAreOn !== 0) throw new Error('youAreOn 映射错误');
if (Math.abs(sa.peerHidden.x - 20) > 0.001) throw new Error('peerHidden 错误');

a.ws.send(JSON.stringify({ t: 'found' }));
const ra = await waitFor(a, 'result');
const rb = await waitFor(b, 'result');
console.log('result:', { winner: ra.winner, reason: ra.reason, names: ra.names, you: ra.you });
if (ra.winner !== 0) throw new Error('winner 应为 0');
if (rb.winner !== 0) throw new Error('双方应看到同一结果');

console.log('✓ 协议冒烟测试通过');
a.ws.close();
b.ws.close();
process.exit(0);
