// 前后端共用的消息定义（只放常量与结构说明，不含运行时逻辑）

export const PHASE = Object.freeze({
  LOBBY: 'LOBBY', // 等待两名玩家
  HIDE: 'HIDE',   // 各自在自己的地图上躲藏
  HUNT: 'HUNT',   // 互换地图，寻找对方的隐藏体
  RESULT: 'RESULT',
});

// 客户端 -> 服务端
export const C2S = Object.freeze({
  JOIN: 'join',   // { code, name }
  READY: 'ready', // 预留
  HIDE: 'hide',   // { x, z, yaw }
  FOUND: 'found', // 找到对方
  DIED: 'died',   // 被鬼抓住
  TIMEOUT: 'timeout',
  AGAIN: 'again', // 结算后重开
});

// 服务端 -> 客户端
export const S2C = Object.freeze({
  JOINED: 'joined',       // { code, slot, playerId }
  PEER_JOINED: 'peerJoined', // { count }
  PEER_LEFT: 'peerLeft',
  HIDE_PHASE: 'hidePhase', // { seedSelf, seedOther, round }
  PEER_HIDDEN: 'peerHidden',
  START: 'start',         // { seeds:[a,b], youAreOn, peerHidden:{x,z,yaw}, duration }
  RESULT: 'result',       // { winner, reason }
  PHASE: 'phase',         // { phase }
  ERROR: 'error',         // { message }
});

export const DURATION_MS = 240000;
