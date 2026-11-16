import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  mulberry32,
  floorTiles,
  wallPlaster,
  ceilingTiles,
  metalSurface,
  fabricSurface,
  woodSurface,
  bloodDecal,
  curtainSurface,
  signTexture,
  exitSignTexture,
  screenTexture,
} from './textures.js';

export const TILE = 2.2;
export const WALL_H = 3.4;
const W = 38;
const D = 30;

const idx = (x, z) => z * W + x;
const inBounds = (x, z) => x >= 0 && z >= 0 && x < W && z < D;
const wx = (tx) => (tx + 0.5) * TILE;
const wz = (tz) => (tz + 0.5) * TILE;
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };

// ------------------------------------------------------------------ 几何工具

function scaleBoxUV(geo, w, h, d, uvPerMeter = 0.45) {
  const uv = geo.attributes.uv;
  const dims = [
    [d, h], [d, h],
    [w, d], [w, d],
    [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * du * uvPerMeter, uv.getY(k) * dv * uvPerMeter);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

function makeMaterial(set, opts = {}) {
  return new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(0.9, 0.9),
    ...opts,
  });
}

// ------------------------------------------------------------------ 主入口

/**
 * 布局：外环走廊 + 十字走廊 + 中央护士站，四个街区各切 2x2 间房。
 * 每间房至少 1 个门、部分房间 2-3 个门，形成大量环路与短视线。
 * 环 → 追逐；短视线 → 惊吓；护士站 → 地标与节奏。
 */
export function generateHospital(seed = 1234) {
  const rng = mulberry32(seed);
  const grid = new Uint8Array(W * D);
  const roomMask = new Uint8Array(W * D);

  const carve = (x, z) => {
    if (inBounds(x, z)) grid[idx(x, z)] = 1;
  };
  const carveRect = (x0, z0, x1, z1) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) carve(x, z);
  };

  // ---------------------------------------------------------------- 走廊骨架

  // 外环（2 格宽）
  carveRect(2, 2, 35, 3);
  carveRect(2, 26, 35, 27);
  carveRect(2, 2, 3, 27);
  carveRect(34, 2, 35, 27);
  // 十字（2 格宽）
  carveRect(18, 2, 19, 27);
  carveRect(2, 14, 35, 15);
  // 中央护士站（地标 / 安全区）
  carveRect(16, 12, 21, 17);

  const HUB = { x0: 16, z0: 12, x1: 21, z1: 17 };

  // ---------------------------------------------------------------- 街区与房间

  const blocks = [
    { x0: 4, z0: 4, x1: 17, z1: 13, zone: 'ward' },
    { x0: 20, z0: 4, x1: 33, z1: 13, zone: 'or' },
    { x0: 4, z0: 16, x1: 17, z1: 25, zone: 'morgue' },
    { x0: 20, z0: 16, x1: 33, z1: 25, zone: 'office' },
  ];

  const ZONE_TYPES = {
    ward: ['ward', 'ward', 'bath', 'storage', 'office'],
    or: ['or', 'or', 'office', 'storage', 'ward'],
    morgue: ['morgue', 'morgue', 'storage', 'bath', 'office'],
    office: ['office', 'ward', 'storage', 'bath', 'morgue'],
  };

  const rooms = [];
  const doors = [];

  const addDoor = (room, side, frac) => {
    const lenX = room.x1 - room.x0 + 1;
    const lenZ = room.z1 - room.z0 + 1;
    let x;
    let z;
    if (side === 'n') {
      x = room.x0 + Math.floor(frac * lenX);
      z = room.z0 - 1;
    } else if (side === 's') {
      x = room.x0 + Math.floor(frac * lenX);
      z = room.z1 + 1;
    } else if (side === 'w') {
      x = room.x0 - 1;
      z = room.z0 + Math.floor(frac * lenZ);
    } else {
      x = room.x1 + 1;
      z = room.z0 + Math.floor(frac * lenZ);
    }
    if (!inBounds(x, z)) return null;
    if (grid[idx(x, z)] === 1) return null;
    carve(x, z);
    const door = { x, z, side, room };
    doors.push(door);
    return door;
  };

  for (const block of blocks) {
    // 街区内部留 1 格墙边距
    const ax0 = block.x0 + 1;
    const ax1 = block.x1 - 1;
    const az0 = block.z0 + 1;
    const az1 = block.z1 - 1;

    // 3 列 × 2 行，房间约 7~9 米见方
    const sx1 = ax0 + 2 + Math.floor(rng() * 2);
    const sx2 = sx1 + 1 + 3 + Math.floor(rng() * 2);
    const sz1 = az0 + 2 + Math.floor(rng() * 2);

    const cols = [
      [ax0, sx1],
      [sx1 + 2, sx2],
      [sx2 + 2, ax1],
    ].filter(([a, b]) => b - a >= 1);
    const rows = [
      [az0, sz1],
      [sz1 + 2, az1],
    ].filter(([a, b]) => b - a >= 1);

    const blockRooms = [];
    for (const [z0, z1] of rows) {
      for (const [x0, x1] of cols) {
        carveRect(x0, z0, x1, z1);
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) roomMask[idx(x, z)] = 1;
        const types = ZONE_TYPES[block.zone];
        const room = {
          x0, z0, x1, z1,
          zone: block.zone,
          type: types[Math.floor(rng() * types.length)],
          doors: [],
        };
        rooms.push(room);
        blockRooms.push(room);
      }
    }

    // 相邻房间之间开门（形成环路）
    for (const room of blockRooms) {
      for (const other of blockRooms) {
        if (room === other) continue;
        if (room.z1 + 2 === other.z0 && Math.max(room.x0, other.x0) <= Math.min(room.x1, other.x1)) {
          const x =
            Math.max(room.x0, other.x0) +
            Math.floor((Math.min(room.x1, other.x1) - Math.max(room.x0, other.x0)) / 2);
          carve(x, room.z1 + 1);
        }
        if (room.x1 + 2 === other.x0 && Math.max(room.z0, other.z0) <= Math.min(room.z1, other.z1)) {
          const z =
            Math.max(room.z0, other.z0) +
            Math.floor((Math.min(room.z1, other.z1) - Math.max(room.z0, other.z0)) / 2);
          carve(room.x1 + 1, z);
        }
      }
    }
  }

  // 每间房 1~3 个门（角落房间更容易开出双门 → 环路）
  for (const room of rooms) {
    const sides = ['n', 's', 'e', 'w'];
    for (let i = sides.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [sides[i], sides[j]] = [sides[j], sides[i]];
    }
    let count = rng() < 0.45 ? 2 : 1;
    if (rng() < 0.2) count += 1;
    for (const side of sides) {
      if (count <= 0) break;
      const door = addDoor(room, side, 0.28 + rng() * 0.44);
      if (door) {
        room.doors.push(door);
        count -= 1;
      }
    }
    // 兜底：至少连一个门
    if (room.doors.length === 0) {
      for (const side of sides) {
        const door = addDoor(room, side, 0.5);
        if (door) {
          room.doors.push(door);
          break;
        }
      }
    }
  }

  // 保证关键房间类型存在
  const ensureType = (type) => {
    if (!rooms.some((r) => r.type === type)) {
      const room = rooms[Math.floor(rng() * rooms.length)];
      room.type = type;
    }
  };
  ['ward', 'or', 'storage', 'bath', 'morgue', 'office'].forEach(ensureType);

  // ---------------------------------------------------------------- 材质

  const T = {
    floor: floorTiles(seed),
    wall: wallPlaster(seed),
    ceil: ceilingTiles(seed),
    metal: metalSurface(seed),
    fabric: fabricSurface(seed),
    wood: woodSurface(seed),
    blood: bloodDecal(seed),
    curtain: curtainSurface(seed),
  };

  const floorMap = T.floor.map.clone();
  floorMap.repeat.set((W * TILE) / 8.8, (D * TILE) / 8.8);
  floorMap.needsUpdate = true;
  const floorNormal = T.floor.normalMap.clone();
  floorNormal.repeat.copy(floorMap.repeat);
  floorNormal.needsUpdate = true;
  const floorRough = T.floor.roughnessMap.clone();
  floorRough.repeat.copy(floorMap.repeat);
  floorRough.needsUpdate = true;

  const MAT = {
    floor: new THREE.MeshStandardMaterial({
      map: floorMap,
      normalMap: floorNormal,
      roughnessMap: floorRough,
      roughness: 1,
      metalness: 0.05,
      normalScale: new THREE.Vector2(1.1, 1.1),
      color: 0x9aa3a0,
    }),
    wall: makeMaterial(T.wall, { normalScale: new THREE.Vector2(0.7, 0.7) }),
    ceil: makeMaterial(T.ceil, { color: 0x8e918c }),
    metal: makeMaterial(T.metal, { metalness: 0.55, normalScale: new THREE.Vector2(0.6, 0.6) }),
    fabric: makeMaterial(T.fabric, { color: 0x8b908a }),
    wood: makeMaterial(T.wood, { color: 0x6d5c4e }),
    dark: new THREE.MeshStandardMaterial({ color: 0x14181a, roughness: 0.55, metalness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0a0c0d, roughness: 0.85 }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0xdff0ff,
      emissive: 0xcfe8ff,
      emissiveIntensity: 1.2,
      roughness: 0.4,
    }),
    window: new THREE.MeshStandardMaterial({
      color: 0x0a161d,
      emissive: 0x24485a,
      emissiveIntensity: 0.42,
      roughness: 0.1,
      metalness: 0.55,
    }),
    curtain: new THREE.MeshStandardMaterial({
      map: T.curtain.map,
      normalMap: T.curtain.normalMap,
      color: 0x7f8b84,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      roughness: 1,
      depthWrite: false,
    }),
    blood: new THREE.MeshStandardMaterial({
      map: T.blood.map,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      roughness: 0.98,
      metalness: 0.0,
      color: 0x7d4a44,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    puddle: new THREE.MeshStandardMaterial({
      color: 0x0e1a1e,
      roughness: 0.14,
      metalness: 0.2,
      envMapIntensity: 1.0,
      transparent: true,
      opacity: 0.45,
    }),
    carpet: new THREE.MeshStandardMaterial({
      map: T.fabric.map,
      normalMap: T.fabric.normalMap,
      color: 0x3a3128,
      roughness: 1,
    }),
    screen: new THREE.MeshStandardMaterial({
      map: screenTexture(),
      emissiveMap: screenTexture(),
      emissive: 0x64ffa8,
      emissiveIntensity: 1.15,
      roughness: 0.35,
      metalness: 0.35,
    }),
    red: new THREE.MeshStandardMaterial({ color: 0x7d1f18, roughness: 0.45, metalness: 0.25 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xb9b5a7, roughness: 0.95, side: THREE.DoubleSide }),
    mirror: new THREE.MeshStandardMaterial({
      color: 0x9fb4b6,
      roughness: 0.12,
      metalness: 0.85,
      envMapIntensity: 1.8,
    }),
    water: new THREE.MeshStandardMaterial({
      color: 0x2f6076,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.6,
    }),
    jar: new THREE.MeshStandardMaterial({
      color: 0x49663a,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.62,
    }),
  };

  const ZONE_LIGHT = {
    ward: 0xbfd9e6,
    or: 0xdcf0ff,
    morgue: 0x8fb6d6,
    office: 0xe0c9a0,
    hub: 0xffcf9e,
    corridor: 0xbfd9e6,
  };
  const ZONE_TINT = {
    ward: 0x1f3a33,
    or: 0x224151,
    morgue: 0x1a2d40,
    office: 0x40331f,
  };

  const group = new THREE.Group();
  group.name = `hospital-${seed}`;
  group.add(new THREE.AmbientLight(0x121a20, 0.86));
  group.add(new THREE.HemisphereLight(0x2a3a44, 0x05070a, 0.64));

  const colliders = [];
  const hideSpots = [];
  const pillars = [];
  const furnitureBoxes = [];
  const lights = [];

  const buckets = new Map();
  for (const k of ['wall', 'metal', 'fabric', 'wood', 'dark', 'rubber', 'curtain', 'red', 'paper', 'mirror', 'water', 'jar']) {
    buckets.set(k, []);
  }
  const push = (mat, geo) => {
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  };

  function addBox(mat, w, h, d, x, y, z, yaw = 0, uvPerMeter = 0.45) {
    const g = scaleBoxUV(new THREE.BoxGeometry(w, h, d), w, h, d, uvPerMeter);
    if (yaw) g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
    g.translate(x, y, z);
    push(mat, g);
  }

  function addCyl(mat, rTop, rBot, h, x, y, z, seg = 10, yaw = 0) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    if (yaw) g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
    g.translate(x, y, z);
    push(mat, g);
  }

  function addCollider(cx, cz, w, d, yaw = 0) {
    const horizontal = Math.abs(Math.sin(yaw)) > 0.7;
    const ww = horizontal ? d : w;
    const dd = horizontal ? w : d;
    const box = {
      minX: cx - ww / 2,
      maxX: cx + ww / 2,
      minZ: cz - dd / 2,
      maxZ: cz + dd / 2,
      h: WALL_H,
    };
    colliders.push(box);
    furnitureBoxes.push(box);
  }

  // ---------------------------------------------------------------- 墙体

  for (let z = 0; z < D; z++) {
    let runStart = -1;
    for (let x = 0; x <= W; x++) {
      let boundary = false;
      if (x < W) {
        if (grid[idx(x, z)] === 0) {
          boundary = !!(
            (inBounds(x - 1, z) && grid[idx(x - 1, z)]) ||
            (inBounds(x + 1, z) && grid[idx(x + 1, z)]) ||
            (inBounds(x, z - 1) && grid[idx(x, z - 1)]) ||
            (inBounds(x, z + 1) && grid[idx(x, z + 1)])
          );
        }
      }
      if (boundary && runStart < 0) runStart = x;
      if (!boundary && runStart >= 0) {
        const len = x - runStart;
        const cx = (runStart + len / 2) * TILE;
        const cz = wz(z);
        addBox('wall', len * TILE, WALL_H, TILE, cx, WALL_H / 2, cz, 0, 0.45);
        colliders.push({
          minX: runStart * TILE,
          maxX: (runStart + len) * TILE,
          minZ: cz - TILE / 2,
          maxZ: cz + TILE / 2,
          h: WALL_H,
        });
        runStart = -1;
      }
    }
  }

  // ---------------------------------------------------------------- 踢脚线 / 防撞扶手

  const isFloor = (x, z) => inBounds(x, z) && grid[idx(x, z)] === 1;

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      if (!isFloor(x, z)) continue;
      const x0 = x * TILE;
      const z0 = z * TILE;
      const cx = x0 + TILE / 2;
      const cz = z0 + TILE / 2;
      const corridor = !roomMask[idx(x, z)];

      if (!isFloor(x, z - 1)) {
        addBox('dark', TILE, 0.13, 0.045, cx, 0.065, z0 + 0.0225, 0, 1.4);
        if (corridor) addBox('rubber', TILE, 0.12, 0.05, cx, 0.98, z0 + 0.03, 0, 1.2);
      }
      if (!isFloor(x, z + 1)) {
        addBox('dark', TILE, 0.13, 0.045, cx, 0.065, z0 + TILE - 0.0225, 0, 1.4);
        if (corridor) addBox('rubber', TILE, 0.12, 0.05, cx, 0.98, z0 + TILE - 0.03, 0, 1.2);
      }
      if (!isFloor(x - 1, z)) {
        addBox('dark', 0.045, 0.13, TILE, x0 + 0.0225, 0.065, cz, 0, 1.4);
        if (corridor) addBox('rubber', 0.05, 0.12, TILE, x0 + 0.03, 0.98, cz, 0, 1.2);
      }
      if (!isFloor(x + 1, z)) {
        addBox('dark', 0.045, 0.13, TILE, x0 + TILE - 0.0225, 0.065, cz, 0, 1.4);
        if (corridor) addBox('rubber', 0.05, 0.12, TILE, x0 + TILE - 0.03, 0.98, cz, 0, 1.2);
      }
    }
  }

  // ---------------------------------------------------------------- 地面 / 天花板

  const floorGeo = new THREE.PlaneGeometry(W * TILE, D * TILE, 1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate((W * TILE) / 2, 0, (D * TILE) / 2);
  const floorMesh = new THREE.Mesh(floorGeo, MAT.floor);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  const ceilGeo = new THREE.PlaneGeometry(W * TILE, D * TILE, 1, 1);
  ceilGeo.rotateX(Math.PI / 2);
  ceilGeo.translate((W * TILE) / 2, WALL_H, (D * TILE) / 2);
  const ceilClip = MAT.ceil.clone();
  ceilClip.map = T.ceil.map.clone();
  ceilClip.map.repeat.set((W * TILE) / 5.4, (D * TILE) / 5.4);
  ceilClip.map.needsUpdate = true;
  ceilClip.normalMap = T.ceil.normalMap.clone();
  ceilClip.normalMap.repeat.copy(ceilClip.map.repeat);
  ceilClip.normalMap.needsUpdate = true;
  ceilClip.roughnessMap = T.ceil.roughnessMap.clone();
  ceilClip.roughnessMap.repeat.copy(ceilClip.map.repeat);
  ceilClip.roughnessMap.needsUpdate = true;
  group.add(new THREE.Mesh(ceilGeo, ceilClip));

  // ---------------------------------------------------------------- 房间地面分区色

  for (const room of rooms) {
    const w = (room.x1 - room.x0 + 1) * TILE;
    const d = (room.z1 - room.z0 + 1) * TILE;
    const g = new THREE.PlaneGeometry(w - 0.1, d - 0.1);
    g.rotateX(-Math.PI / 2);
    g.translate(((room.x0 + room.x1) / 2 + 0.5) * TILE, 0.006, ((room.z0 + room.z1) / 2 + 0.5) * TILE);
    const m = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color: ZONE_TINT[room.zone] || 0x223030,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    group.add(m);
  }

  // ---------------------------------------------------------------- 门框 / 门楣 / 标识

  const LABELS = {
    ward: ['病房', 'WARD'],
    or: ['手术室', 'OPERATING'],
    storage: ['储藏间', 'STORAGE'],
    office: ['值班室', 'NURSE STATION'],
    morgue: ['停尸间', 'MORGUE'],
    bath: ['盥洗室', 'BATHROOM'],
  };
  const signMats = new Map();

  const doorFacing = (side) => {
    if (side === 'n') return Math.PI;
    if (side === 's') return 0;
    if (side === 'w') return -Math.PI / 2;
    return Math.PI / 2;
  };

  function doorLeaf(hx, hz, angle, width, height) {
    const g = new THREE.BoxGeometry(width, height, 0.05);
    g.translate(width / 2, 0, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(angle));
    g.translate(hx, height / 2 + 0.02, hz);
    push('wood', g);

    const h = new THREE.BoxGeometry(0.03, 0.16, 0.06);
    h.translate(width - 0.12, 0, 0.05);
    h.applyMatrix4(new THREE.Matrix4().makeRotationY(angle));
    h.translate(hx, 1.05, hz);
    push('metal', h);

    const k = new THREE.BoxGeometry(width - 0.08, 0.24, 0.012);
    k.translate(width / 2, 0, 0.032);
    k.applyMatrix4(new THREE.Matrix4().makeRotationY(angle));
    k.translate(hx, 0.16, hz);
    push('metal', k);
  }

  function doubleDoors(cx, cz, side) {
    const dw = 0.92;
    const dh = 2.08;
    const off = TILE / 2 - 0.06;
    if (side === 'n' || side === 's') {
      const dir = side === 'n' ? 1 : -1;
      doorLeaf(cx - off, cz, -dir * Math.PI * 0.38, dw, dh);
      doorLeaf(cx + off, cz, -dir * Math.PI * 0.62, dw, dh);
    } else {
      const dir = side === 'w' ? 1 : -1;
      doorLeaf(cx, cz - off, -Math.PI / 2 + dir * Math.PI * 0.38, dw, dh);
      doorLeaf(cx, cz + off, Math.PI / 2 - dir * Math.PI * 0.38, dw, dh);
    }
  }

  for (const door of doors) {
    const cx = wx(door.x);
    const cz = wz(door.z);
    const horizontal = door.side === 'n' || door.side === 's';
    // 门框
    if (horizontal) {
      addBox('metal', 0.12, 2.35, 0.16, cx - TILE / 2 + 0.08, 1.175, cz, 0, 0.8);
      addBox('metal', 0.12, 2.35, 0.16, cx + TILE / 2 - 0.08, 1.175, cz, 0, 0.8);
      addBox('metal', TILE, 0.14, 0.16, cx, 2.3, cz, 0, 0.8);
      addBox('wall', TILE, WALL_H - 2.36, TILE, cx, (WALL_H + 2.36) / 2, cz, 0, 0.45);
      // 门槛
      addBox('metal', TILE * 0.8, 0.02, 0.22, cx, 0.012, cz, 0, 1.2);
    } else {
      addBox('metal', 0.16, 2.35, 0.12, cx, 1.175, cz - TILE / 2 + 0.08, 0, 0.8);
      addBox('metal', 0.16, 2.35, 0.12, cx, 1.175, cz + TILE / 2 - 0.08, 0, 0.8);
      addBox('metal', 0.16, 0.14, TILE, cx, 2.3, cz, 0, 0.8);
      addBox('wall', TILE, WALL_H - 2.36, TILE, cx, (WALL_H + 2.36) / 2, cz, 0, 0.45);
      addBox('metal', 0.22, 0.02, TILE * 0.8, cx, 0.012, cz, 0, 1.2);
    }

    // 半开的双开门扇
    doubleDoors(cx, cz, door.side);

    // 每间房只在第一个门上挂标识（仅走廊侧的门）
    if (door.room.doors[0] !== door) continue;
    const beyond = {
      n: [door.x, door.z - 1],
      s: [door.x, door.z + 1],
      w: [door.x - 1, door.z],
      e: [door.x + 1, door.z],
    }[door.side];
    const isCorridorDoor = inBounds(beyond[0], beyond[1]) && roomMask[idx(beyond[0], beyond[1])] === 0;
    if (!isCorridorDoor) continue;
    const [label, sub] = LABELS[door.room.type] || LABELS.ward;
    if (!signMats.has(door.room.type)) {
      const tex = signTexture(label, sub);
      signMats.set(
        door.room.type,
        new THREE.MeshStandardMaterial({
          map: tex,
          emissiveMap: tex,
          emissive: 0xffffff,
          emissiveIntensity: 0.16,
          roughness: 0.75,
          metalness: 0.1,
        }),
      );
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.5), signMats.get(door.room.type));
    const off = TILE / 2 + 0.03;
    if (door.side === 'n') sign.position.set(cx, 2.86, cz - off);
    if (door.side === 's') sign.position.set(cx, 2.86, cz + off);
    if (door.side === 'w') sign.position.set(cx - off, 2.86, cz);
    if (door.side === 'e') sign.position.set(cx + off, 2.86, cz);
    sign.rotation.y = doorFacing(door.side);
    group.add(sign);
  }

  // 出口标识
  for (const [px, pz, ry] of [
    [1 * TILE + 0.04, wz(2.5), Math.PI / 2],
    [37 * TILE - 0.04, wz(26.5), -Math.PI / 2],
  ]) {
    const tex = exitSignTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0xff4a34,
      emissiveIntensity: 1.6,
      roughness: 0.4,
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.38), mat);
    sign.position.set(px, 2.55, pz);
    sign.rotation.y = ry;
    group.add(sign);
    const light = new THREE.PointLight(0xff3a22, 4.5, 7, 2);
    light.position.set(px + Math.sin(ry) * 0.5, 2.4, pz);
    group.add(light);
    lights.push({ light, mesh: null, base: 4.5, baseEmissive: 1.6, flicker: false, phase: rng() * 10, fixture: false });
  }

  // ---------------------------------------------------------------- 家具

  function backInfo(room, side) {
    const cx = ((room.x0 + room.x1) / 2 + 0.5) * TILE;
    const cz = ((room.z0 + room.z1) / 2 + 0.5) * TILE;
    const w = (room.x1 - room.x0 + 1) * TILE;
    const d = (room.z1 - room.z0 + 1) * TILE;
    if (side === 'n') return { axis: 'x', along: cx, fixed: room.z0 * TILE + 0.55, extent: w, yaw: 0, dir: 1 };
    if (side === 's') return { axis: 'x', along: cx, fixed: (room.z1 + 1) * TILE - 0.55, extent: w, yaw: 0, dir: -1 };
    if (side === 'w') return { axis: 'z', along: cz, fixed: room.x0 * TILE + 0.55, extent: d, yaw: Math.PI / 2, dir: 1 };
    return { axis: 'z', along: cz, fixed: (room.x1 + 1) * TILE - 0.55, extent: d, yaw: Math.PI / 2, dir: -1 };
  }

  function at(b, t, offset = 0) {
    const along = b.along + t * b.extent * 0.78;
    return b.axis === 'x'
      ? { x: along, z: b.fixed + b.dir * offset, yaw: b.yaw }
      : { x: b.fixed + b.dir * offset, z: along, yaw: b.yaw };
  }

  function bed(x, z, yaw) {
    addBox('metal', 2.0, 0.12, 0.92, x, 0.5, z, yaw, 0.8);
    addBox('fabric', 1.94, 0.24, 0.86, x, 0.68, z, yaw, 0.9);
    // 枕头
    addBox('fabric', 0.5, 0.12, 0.42, x - Math.cos(yaw) * 0.62, 0.83, z + Math.sin(yaw) * 0.62, yaw, 1.2);
    // 被子
    addBox('fabric', 1.2, 0.08, 0.9, x + Math.cos(yaw) * 0.28, 0.81, z - Math.sin(yaw) * 0.28, yaw, 0.9);
    // 床头 / 床尾
    addBox('metal', 0.09, 0.78, 0.96, x - Math.cos(yaw) * 0.98, 0.92, z + Math.sin(yaw) * 0.98, yaw, 0.9);
    addBox('metal', 0.07, 0.5, 0.96, x + Math.cos(yaw) * 0.98, 0.78, z - Math.sin(yaw) * 0.98, yaw, 0.9);
    // 床腿
    for (const [lx, lz] of [[-0.88, -0.36], [0.88, -0.36], [-0.88, 0.36], [0.88, 0.36]]) {
      const px = x + lx * Math.cos(yaw) + lz * Math.sin(yaw);
      const pz = z - lx * Math.sin(yaw) + lz * Math.cos(yaw);
      addCyl('metal', 0.03, 0.03, 0.5, px, 0.25, pz, 6);
    }
    // 侧栏
    for (const lz of [-0.47, 0.47]) {
      const px = x + lz * Math.sin(yaw);
      const pz = z + lz * Math.cos(yaw);
      addBox('metal', 1.0, 0.03, 0.03, px, 1.0, pz, yaw, 1);
    }
    // 呼叫器
    const cb = local(x, z, yaw, -0.98, 0.3);
    addBox('dark', 0.1, 0.14, 0.05, cb.x, 1.0, cb.z, yaw, 1);
    addCollider(x, z, 2.1, 1.0, yaw);
  }

  function ivStand(x, z) {
    addCyl('metal', 0.02, 0.025, 1.7, x, 0.85, z, 8);
    addCyl('metal', 0.2, 0.22, 0.03, x, 0.02, z, 12);
    addBox('metal', 0.3, 0.02, 0.02, x, 1.62, z);
    addCollider(x, z, 0.4, 0.4, 0);
  }

  function gurney(x, z, yaw) {
    addBox('metal', 1.9, 0.08, 0.72, x, 0.765, z, yaw);
    addBox('fabric', 1.84, 0.1, 0.68, x, 0.855, z, yaw);
    for (const [lx, lz] of [[-0.8, -0.28], [0.8, -0.28], [-0.8, 0.28], [0.8, 0.28]]) {
      const px = x + lx * Math.cos(yaw) + lz * Math.sin(yaw);
      const pz = z - lx * Math.sin(yaw) + lz * Math.cos(yaw);
      addCyl('metal', 0.025, 0.025, 0.7, px, 0.375, pz, 8);
      addCyl('rubber', 0.07, 0.07, 0.05, px, 0.025, pz, 8);
    }
    addCollider(x, z, 2.0, 0.85, yaw);
  }

  function bodyBag(x, z, yaw) {
    const g = new THREE.CapsuleGeometry(0.22, 1.25, 4, 8);
    g.rotateZ(Math.PI / 2);
    if (yaw) g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
    g.translate(x, 1.13, z);
    push('rubber', g);
  }

  function locker(x, z, yaw) {
    addBox('metal', 0.72, 1.95, 0.5, x, 0.975, z, yaw, 0.8);
    const fx = x + Math.sin(yaw) * 0.26;
    const fz = z + Math.cos(yaw) * 0.26;
    addBox('dark', 0.58, 1.8, 0.02, fx, 1.0, fz, yaw, 1);
    const hp = local(x, z, yaw, 0.2, 0.29);
    addBox('metal', 0.04, 0.16, 0.04, hp.x, 1.05, hp.z, yaw, 1);
    addCollider(x, z, 0.78, 0.56, yaw);
    hideSpots.push({ x, z, yaw, type: 'locker' });
  }

  function shelf(x, z, yaw) {
    addBox('wood', 1.4, 1.8, 0.06, x, 0.9, z, yaw);
    for (let i = 0; i < 4; i++) {
      addBox('wood', 1.4, 0.04, 0.42, x + Math.sin(yaw) * 0.18, 0.2 + i * 0.5, z + Math.cos(yaw) * 0.18, yaw);
    }
    addCollider(x, z, 1.45, 0.5, yaw);
  }

  function desk(x, z, yaw) {
    addBox('wood', 1.6, 0.06, 0.72, x, 0.76, z, yaw);
    for (const [lx, lz] of [[-0.72, -0.3], [0.72, -0.3], [-0.72, 0.3], [0.72, 0.3]]) {
      const px = x + lx * Math.cos(yaw) + lz * Math.sin(yaw);
      const pz = z - lx * Math.sin(yaw) + lz * Math.cos(yaw);
      addBox('metal', 0.05, 0.76, 0.05, px, 0.38, pz, yaw);
    }
    addCollider(x, z, 1.7, 0.8, yaw);
  }

  function chair(x, z, yaw) {
    addBox('metal', 0.45, 0.06, 0.45, x, 0.46, z, yaw);
    const bp = local(x, z, yaw, 0, -0.2);
    addBox('dark', 0.45, 0.5, 0.05, bp.x, 0.7, bp.z, yaw);
    addCyl('metal', 0.03, 0.03, 0.45, x, 0.23, z, 6);
    addCyl('dark', 0.22, 0.22, 0.03, x, 0.02, z, 10);
    addCollider(x, z, 0.5, 0.5, yaw);
  }

  function operatingTable(x, z, yaw) {
    // 窄而厚的手术台面
    addBox('metal', 1.95, 0.1, 0.72, x, 0.9, z, yaw, 1.2);
    addBox('dark', 1.9, 0.05, 0.68, x, 0.82, z, yaw, 1.2);
    // 中柱（落地）
    addBox('metal', 0.32, 0.76, 0.32, x, 0.42, z, yaw, 1);
    // 底座
    addBox('dark', 0.85, 0.08, 0.55, x, 0.04, z, yaw, 1);
    // 束缚带
    for (const off of [-0.55, 0.55]) {
      addBox('rubber', 0.07, 0.02, 0.78, x + Math.cos(yaw) * off, 0.96, z - Math.sin(yaw) * off, yaw, 1.4);
    }
    // 侧栏
    for (const s of [-1, 1]) {
      addBox('metal', 1.8, 0.03, 0.03, x, 0.72, z + s * 0.38, yaw, 1);
    }
    addCollider(x, z, 2.0, 0.9, yaw);
  }

  function surgicalLamp(x, z) {
    addCyl('metal', 0.06, 0.06, 0.7, x, 3.05, z, 8);
    const disc = new THREE.CylinderGeometry(0.42, 0.36, 0.08, 16);
    disc.translate(x, 2.68, z);
    const lampMat = MAT.lamp.clone();
    lampMat.emissiveIntensity = 1.5;
    const m = new THREE.Mesh(disc, lampMat);
    group.add(m);
    const light = new THREE.PointLight(0xdff2ff, 6, 7, 2);
    light.position.set(x, 2.5, z);
    group.add(light);
    lights.push({ light, mesh: m, base: 6, baseEmissive: 1.5, flicker: rng() > 0.6, phase: rng() * 20, fixture: false });
  }

  function sink(x, z, yaw) {
    addBox('metal', 0.8, 0.16, 0.52, x, 0.86, z, yaw, 0.9);
    // 立柱落地
    addBox('metal', 0.16, 0.78, 0.16, x, 0.39, z, yaw, 0.9);
    // 龙头朝墙
    addBox('metal', 0.1, 0.14, 0.1, x - Math.sin(yaw) * 0.2, 1.0, z - Math.cos(yaw) * 0.2, yaw, 1);
    addCollider(x, z, 0.85, 0.6, yaw);
  }

  function curtain(x, z, w, yaw) {
    const g = new THREE.PlaneGeometry(w, 2.3, 6, 1);
    g.translate(0, 1.15, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
    g.translate(x, 0, z);
    push('curtain', g);
    hideSpots.push({ x, z, yaw, type: 'curtain' });
  }

  function nightstand(x, z, yaw) {
    addBox('wood', 0.5, 0.7, 0.42, x, 0.35, z, yaw);
    addBox('metal', 0.54, 0.03, 0.46, x, 0.715, z, yaw, 0.8);
    addBox('dark', 0.44, 0.02, 0.36, x, 0.5, z, yaw, 1);
    addCollider(x, z, 0.55, 0.46, yaw);
  }

  function monitor(x, z, yaw) {
    addBox('metal', 0.05, 0.62, 0.05, x, 0.55, z, yaw, 1);
    addBox('metal', 0.34, 0.04, 0.22, x, 0.24, z, yaw, 1);
    addBox('dark', 0.42, 0.3, 0.17, x, 1.02, z, yaw, 0.9);
    const g = new THREE.PlaneGeometry(0.34, 0.22);
    const m = new THREE.Mesh(g, MAT.screen);
    m.position.set(x + Math.sin(yaw) * 0.09, 1.03, z + Math.cos(yaw) * 0.09);
    m.rotation.y = yaw;
    group.add(m);
  }

  // ---------------------------------------------------------------- 布景工具

  const roomCenter = (room) => ({
    x: ((room.x0 + room.x1) / 2 + 0.5) * TILE,
    z: ((room.z0 + room.z1) / 2 + 0.5) * TILE,
    w: (room.x1 - room.x0 + 1) * TILE,
    d: (room.z1 - room.z0 + 1) * TILE,
  });

  const local = (x, z, yaw, lx, lz) => ({
    x: x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
    z: z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
  });

  function atWall(room, side, t, offset = 0.55) {
    const c = roomCenter(room);
    const aw = Math.max(0.9, c.w - 1.2);
    const ad = Math.max(0.9, c.d - 1.2);
    if (side === 'n') return { x: c.x + (t - 0.5) * aw, z: room.z0 * TILE + offset, yaw: 0 };
    if (side === 's') return { x: c.x + (t - 0.5) * aw, z: (room.z1 + 1) * TILE - offset, yaw: Math.PI };
    if (side === 'w') return { x: room.x0 * TILE + offset, z: c.z + (t - 0.5) * ad, yaw: Math.PI / 2 };
    return { x: (room.x1 + 1) * TILE - offset, z: c.z + (t - 0.5) * ad, yaw: -Math.PI / 2 };
  }

  function doorCenters(room) {
    return room.doors.map((d) => ({ x: (d.x + 0.5) * TILE, z: (d.z + 0.5) * TILE }));
  }

  function clearOfDoors(room, x, z, r = 1.35) {
    return doorCenters(room).every((d) => Math.hypot(d.x - x, d.z - z) > r);
  }

  // 家具 AABB 是否压到门洞（门洞按 1 格宽）
  function boxHitsDoor(room, minX, maxX, minZ, maxZ, margin = 0.15) {
    return room.doors.some((d) => {
      const dx0 = d.x * TILE - margin;
      const dx1 = (d.x + 1) * TILE + margin;
      const dz0 = d.z * TILE - margin;
      const dz1 = (d.z + 1) * TILE + margin;
      return minX < dx1 && maxX > dx0 && minZ < dz1 && maxZ > dz0;
    });
  }

  function sideSpots(room, side, count, offset, clearance = 1.35) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = atWall(room, side, (i + 0.5) / count, offset);
      if (clearOfDoors(room, p.x, p.z, clearance)) out.push(p);
    }
    return out;
  }

  // 以墙面为基准的局部坐标系：n 指向房间内，t 沿墙
  function wallFrame(room, side, t = 0.5) {
    const c = roomCenter(room);
    const aw = Math.max(0.9, c.w - 2.6);
    const ad = Math.max(0.9, c.d - 2.6);
    if (side === 'n') return { x: c.x + (t - 0.5) * aw, z: room.z0 * TILE, nx: 0, nz: 1, tx: 1, tz: 0, yaw: 0 };
    if (side === 's') return { x: c.x + (t - 0.5) * aw, z: (room.z1 + 1) * TILE, nx: 0, nz: -1, tx: 1, tz: 0, yaw: Math.PI };
    if (side === 'w') return { x: room.x0 * TILE, z: c.z + (t - 0.5) * ad, nx: 1, nz: 0, tx: 0, tz: 1, yaw: Math.PI / 2 };
    return { x: (room.x1 + 1) * TILE, z: c.z + (t - 0.5) * ad, nx: -1, nz: 0, tx: 0, tz: -1, yaw: -Math.PI / 2 };
  }

  // 从墙面沿法线 n、切线 t 偏移
  function place(f, nDist, tDist = 0) {
    return { x: f.x + f.nx * nDist + f.tx * tDist, z: f.z + f.nz * nDist + f.tz * tDist, yaw: f.yaw };
  }

  // 长边垂直于墙的朝向（床头/桌头贴墙）
  const intoRoomYaw = (f) => Math.atan2(-f.nz, f.nx);

  // 沿墙尝试多个位置：同时避门洞和已有家具
  function tryPlace(
    room,
    side,
    normal,
    tangents = [0, 0.2, -0.2, 0.3, -0.3, 0.4, -0.4, 0.5, -0.5, 0.6, -0.6],
    clearance = 1.1,
    footprint = null,
  ) {
    for (const t of tangents) {
      // 超出墙面可用范围会摆到墙角外
      if (Math.abs(t) > 0.45) continue;
      const f = wallFrame(room, side, 0.5 + t);
      const p = place(f, normal, 0);
      if (footprint) {
        const swapped = Math.abs(Math.sin(f.yaw)) > 0.7;
        const hw = (swapped ? footprint[1] : footprint[0]) / 2;
        const hd = (swapped ? footprint[0] : footprint[1]) / 2;
        const minX = p.x - hw;
        const maxX = p.x + hw;
        const minZ = p.z - hd;
        const maxZ = p.z + hd;
        if (boxHitsDoor(room, minX, maxX, minZ, maxZ, 0.15)) continue;
        if (
          furnitureBoxes.some(
            (b) => minX < b.maxX + 0.05 && maxX > b.minX - 0.05 && minZ < b.maxZ + 0.05 && maxZ > b.minZ - 0.05,
          )
        ) {
          continue;
        }
      } else if (!clearOfDoors(room, p.x, p.z, clearance)) {
        continue;
      }
      return { ...p, yaw: f.yaw, f };
    }
    return null;
  }

  // 垃圾桶：在房间中心周围找一个不挡门、不压家具的位置
  function placeBin(room, c) {
    const offsets = [1.4, -1.4, 1.0, -1.0, 0.6, -0.6];
    for (const dx of offsets) {
      for (const dz of offsets) {
        const x = c.x + dx;
        const z = c.z + dz;
        if (!clearOfDoors(room, x, z, 0.9)) continue;
        if (
          furnitureBoxes.some(
            (b) => x > b.minX - 0.25 && x < b.maxX + 0.25 && z > b.minZ - 0.25 && z < b.maxZ + 0.25,
          )
        ) {
          continue;
        }
        bin(x, z);
        return;
      }
    }
  }

  // 四面墙都试，给次要家具更多落地机会
  function tryAnyWall(room, normal, footprint, sides = ['n', 's', 'e', 'w']) {
    for (const side of sides) {
      const p = tryPlace(
        room,
        side,
        normal,
        [0.25, -0.25, 0.4, -0.4, 0.12, -0.12, 0.55, -0.55],
        0,
        footprint,
      );
      if (p) return p;
    }
    return null;
  }

  function addPlane(mat, w, h, x, y, z, yaw) {
    const g = new THREE.PlaneGeometry(w, h);
    if (yaw) g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
    g.translate(x, y, z);
    push(mat, g);
  }

  function addTrack(x1, z1, x2, z2, y) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const g = new THREE.CylinderGeometry(0.018, 0.018, len, 6);
    g.rotateZ(Math.PI / 2);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(-dz, dx)));
    g.translate((x1 + x2) / 2, y, (z1 + z2) / 2);
    push('metal', g);
  }

  function addWheel(mat, r, x, y, z) {
    const g = new THREE.CylinderGeometry(r, r, 0.035, 14);
    g.rotateZ(Math.PI / 2);
    g.translate(x, y, z);
    push(mat, g);
  }

  function wallItem(room, side, t, y, w, h, mat, depth = 0.05) {
    const p = atWall(room, side, t, 0.035 + depth / 2);
    if (!clearOfDoors(room, p.x, p.z, 0.85)) return;
    addPlane(mat, w, h, p.x, y, p.z, p.yaw);
  }

  // ---------------------------------------------------------------- 病房 / 手术 / 停尸 / 办公 / 储藏 / 盥洗

  function overbedTable(x, z, yaw) {
    addCyl('metal', 0.03, 0.03, 0.86, x, 0.43, z, 6);
    addCyl('metal', 0.2, 0.22, 0.04, x, 0.02, z, 10);
    addBox('wood', 0.8, 0.05, 0.5, x, 0.9, z, yaw, 0.9);
    addCollider(x, z, 0.82, 0.52, yaw);
  }

  function vitalMonitor(x, z, yaw) {
    addCyl('metal', 0.025, 0.028, 1.25, x, 0.627, z, 6);
    addCyl('metal', 0.18, 0.2, 0.04, x, 0.02, z, 10);
    addBox('dark', 0.44, 0.32, 0.18, x, 1.28, z, yaw, 0.9);
    const p = local(x, z, yaw, 0, 0.095);
    addPlane('screen', 0.36, 0.24, p.x, 1.28, p.z, yaw);
    addCollider(x, z, 0.5, 0.5, yaw);
  }

  function wardrobe(x, z, yaw) {
    addBox('wood', 1.15, 2.0, 0.6, x, 1.0, z, yaw, 0.55);
    addBox('metal', 1.17, 0.04, 0.62, x, 2.02, z, yaw, 0.9);
    for (const s of [-1, 1]) {
      const p = local(x, z, yaw, s * 0.28, 0.31);
      addBox('dark', 0.04, 1.85, 0.02, p.x, 1.0, p.z, yaw, 1);
      const h = local(x, z, yaw, s * 0.06, 0.34);
      addBox('metal', 0.025, 0.18, 0.025, h.x, 1.0, h.z, yaw, 1);
    }
    addCollider(x, z, 1.2, 0.65, yaw);
  }

  function bin(x, z) {
    addCyl('dark', 0.18, 0.16, 0.4, x, 0.2, z, 12);
    addCyl('metal', 0.19, 0.19, 0.03, x, 0.41, z, 12);
    addCyl('paper', 0.15, 0.13, 0.1, x, 0.45, z, 10);
    addCollider(x, z, 0.38, 0.38, 0);
  }

  function wheelchair(x, z, yaw) {
    addBox('fabric', 0.46, 0.05, 0.4, x, 0.46, z, yaw, 0.9);
    addBox('dark', 0.46, 0.52, 0.05, x + Math.sin(yaw) * 0.2, 0.72, z + Math.cos(yaw) * 0.2, yaw);
    for (const s of [-1, 1]) {
      const p = local(x, z, yaw, 0, s * 0.27);
      addWheel('rubber', 0.25, p.x, 0.27, p.z);
      addWheel('metal', 0.19, p.x, 0.27, p.z);
      const q = local(x, z, yaw, 0.22, s * 0.24);
      addCyl('rubber', 0.055, 0.055, 0.03, q.x, 0.06, q.z, 10);
    }
    addCollider(x, z, 0.6, 0.62, yaw);
  }

  function stretcher(x, z, yaw) {
    addBox('metal', 1.95, 0.07, 0.68, x, 0.72, z, yaw, 0.9);
    addBox('fabric', 1.88, 0.1, 0.62, x, 0.8, z, yaw, 0.9);
    for (const [lx, lz] of [[-0.82, -0.26], [0.82, -0.26], [-0.82, 0.26], [0.82, 0.26]]) {
      const p = local(x, z, yaw, lx, lz);
      addCyl('metal', 0.02, 0.02, 0.68, p.x, 0.36, p.z, 6);
      addCyl('rubber', 0.06, 0.06, 0.04, p.x, 0.05, p.z, 8);
    }
    for (const s of [-1, 1]) {
      const p = local(x, z, yaw, 0, s * 0.36);
      addBox('metal', 1.8, 0.03, 0.03, p.x, 1.02, p.z, yaw, 1);
    }
    addCollider(x, z, 2.0, 0.78, yaw);
  }

  function crashCart(x, z, yaw) {
    addBox('metal', 0.62, 0.9, 0.5, x, 0.46, z, yaw, 0.7);
    for (let i = 0; i < 3; i++) {
      const p = local(x, z, yaw, 0, 0.26);
      addBox('dark', 0.56, 0.02, 0.02, p.x, 0.22 + i * 0.26, p.z, yaw, 1);
    }
    addBox('dark', 0.4, 0.24, 0.22, x, 1.03, z, yaw, 0.9);
    const p = local(x, z, yaw, 0, 0.115);
    addPlane('screen', 0.32, 0.18, p.x, 1.04, p.z, yaw);
    for (const [lx, lz] of [[-0.24, -0.18], [0.24, -0.18], [-0.24, 0.18], [0.24, 0.18]]) {
      const q = local(x, z, yaw, lx, lz);
      addCyl('rubber', 0.05, 0.05, 0.05, q.x, 0.03, q.z, 8);
    }
    addCollider(x, z, 0.68, 0.56, yaw);
  }

  function cleaningCart(x, z, yaw) {
    addBox('metal', 0.6, 0.7, 0.45, x, 0.4, z, yaw, 0.7);
    addBox('dark', 0.5, 0.06, 0.5, x, 0.78, z, yaw, 0.8);
    const pole = local(x, z, yaw, 0.3, 0);
    addCyl('wood', 0.018, 0.018, 1.0, pole.x, 1.28, pole.z, 6);
    const bag = local(x, z, yaw, 0.18, 0.22);
    addCyl('paper', 0.15, 0.13, 0.22, bag.x, 0.92, bag.z, 10);
    for (const [lx, lz] of [[-0.24, -0.18], [0.24, -0.18], [-0.24, 0.18], [0.24, 0.18]]) {
      const q = local(x, z, yaw, lx, lz);
      addCyl('rubber', 0.05, 0.05, 0.05, q.x, 0.025, q.z, 8);
    }
    addCollider(x, z, 0.66, 0.52, yaw);
  }

  function mopBucket(x, z) {
    addBox('paper', 0.34, 0.32, 0.3, x, 0.16, z, 0, 0.8);
    addCyl('metal', 0.15, 0.15, 0.02, x + 0.28, 0.02, z, 10);
    addCyl('wood', 0.016, 0.016, 1.1, x + 0.28, 0.57, z, 6);
    addCollider(x, z, 0.42, 0.42, 0);
  }

  function oxygenCylinder(x, z) {
    addCyl('metal', 0.11, 0.11, 1.0, x, 0.5, z, 12);
    addCyl('dark', 0.06, 0.06, 0.12, x, 1.06, z, 8);
    addCyl('metal', 0.02, 0.02, 0.16, x + 0.08, 1.05, z, 6);
    addCollider(x, z, 0.3, 0.3, 0);
  }

  function anesthesiaMachine(x, z, yaw) {
    addBox('dark', 0.72, 1.15, 0.55, x, 0.58, z, yaw, 0.7);
    addBox('metal', 0.76, 0.05, 0.58, x, 1.18, z, yaw, 0.9);
    const p = local(x, z, yaw, 0, 0.29);
    addPlane('screen', 0.44, 0.26, p.x, 1.07, p.z, yaw);
    for (const s of [-1, 1]) {
      const q = local(x, z, yaw, s * 0.32, -0.1);
      addCyl('metal', 0.1, 0.1, 0.7, q.x, 0.35, q.z, 10);
    }
    addCollider(x, z, 0.8, 0.64, yaw);
  }

  function instrumentTable(x, z, yaw) {
    addBox('metal', 1.2, 0.05, 0.55, x, 0.9, z, yaw, 1.1);
    for (const [lx, lz] of [[-0.52, -0.2], [0.52, -0.2], [-0.52, 0.2], [0.52, 0.2]]) {
      const p = local(x, z, yaw, lx, lz);
      addCyl('metal', 0.018, 0.018, 0.88, p.x, 0.44, p.z, 6);
    }
    const t1 = local(x, z, yaw, -0.25, 0);
    const t2 = local(x, z, yaw, 0.25, 0);
    addBox('metal', 0.3, 0.05, 0.2, t1.x, 0.95, t1.z, yaw, 1.2);
    addBox('metal', 0.28, 0.06, 0.18, t2.x, 0.96, t2.z, yaw, 1.2);
    addCollider(x, z, 1.26, 0.6, yaw);
  }

  function mayoStand(x, z) {
    addCyl('metal', 0.018, 0.018, 1.35, x, 0.68, z, 6);
    addCyl('metal', 0.16, 0.18, 0.03, x, 0.015, z, 10);
    addBox('metal', 0.42, 0.03, 0.32, x, 1.37, z, 0, 1.2);
    addCollider(x, z, 0.42, 0.36, 0);
  }

  function scrubSink(x, z, yaw) {
    addBox('metal', 1.1, 0.18, 0.55, x, 0.92, z, yaw, 0.9);
    addBox('metal', 1.12, 0.04, 0.57, x, 1.02, z, yaw, 1);
    for (const s of [-1, 1]) {
      const p = local(x, z, yaw, s * 0.26, -0.05);
      addCyl('metal', 0.02, 0.02, 0.3, p.x, 1.16, p.z, 6);
      addCyl('metal', 0.05, 0.05, 0.05, p.x, 1.31, p.z, 8);
      const leg = local(x, z, yaw, s * 0.45, -0.12);
      addCyl('metal', 0.025, 0.025, 0.83, leg.x, 0.415, leg.z, 6);
    }
    addCollider(x, z, 1.15, 0.62, yaw);
  }

  function wallCabinet(x, z, yaw, w = 1.2, h = 0.7, y = 1.8) {
    addBox('wood', w, h, 0.38, x, y, z, yaw, 0.65);
    for (const s of [-1, 1]) {
      const p = local(x, z, yaw, s * 0.28, 0.2);
      addBox('dark', 0.02, h - 0.08, 0.02, p.x, y, p.z, yaw, 1);
      const hd = local(x, z, yaw, s * 0.04, 0.21);
      addBox('metal', 0.02, 0.1, 0.02, hd.x, y, hd.z, yaw, 1);
    }
  }

  function xrayViewer(x, z, yaw) {
    addBox('dark', 0.72, 0.92, 0.06, x, 1.65, z, yaw, 0.9);
    const p = local(x, z, yaw, 0, 0.035);
    addPlane('paper', 0.6, 0.8, p.x, 1.65, p.z, yaw);
  }

  function stool(x, z) {
    addCyl('dark', 0.17, 0.17, 0.06, x, 0.62, z, 12);
    addCyl('metal', 0.025, 0.025, 0.58, x, 0.31, z, 6);
    addCyl('metal', 0.17, 0.19, 0.03, x, 0.02, z, 12);
    addCollider(x, z, 0.4, 0.4, 0);
  }

  function morgueDrawers(x, z, yaw) {
    // 柜体 + 3 列 x 2 行 不锈钢遗体抽屉
    addBox('metal', 2.84, 1.62, 0.6, x, 0.81, z, yaw, 0.9);
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 2; r++) {
        const p = local(x, z, yaw, (c - 1) * 0.92, 0.31);
        addBox('metal', 0.88, 0.62, 0.04, p.x, 0.42 + r * 0.68, p.z, yaw, 0.9);
        const h = local(x, z, yaw, (c - 1) * 0.92, 0.34);
        addBox('dark', 0.5, 0.04, 0.04, h.x, 0.42 + r * 0.68, h.z, yaw, 1);
        addBox('metal', 0.16, 0.05, 0.06, h.x, 0.42 + r * 0.68, h.z, yaw, 1.2);
      }
    }
    addCollider(x, z, 2.85, 0.65, yaw);
  }

  function stainlessTable(x, z, yaw) {
    addBox('metal', 1.6, 0.05, 0.7, x, 0.92, z, yaw, 1.1);
    for (const [lx, lz] of [[-0.7, -0.28], [0.7, -0.28], [-0.7, 0.28], [0.7, 0.28]]) {
      const p = local(x, z, yaw, lx, lz);
      addCyl('metal', 0.02, 0.02, 0.9, p.x, 0.45, p.z, 6);
    }
    addBox('metal', 1.4, 0.04, 0.5, x, 0.45, z, yaw, 1);
    addCollider(x, z, 1.66, 0.76, yaw);
  }

  function hangingScale(x, z, yaw = 0) {
    addCyl('metal', 0.02, 0.02, 0.3, x, 3.25, z, 6, yaw);
    addBox('metal', 0.24, 0.2, 0.12, x, 3.0, z, yaw, 0.9);
    addCyl('metal', 0.01, 0.01, 0.5, x, 2.65, z, 5, yaw);
    addBox('metal', 0.22, 0.03, 0.12, x, 2.4, z, yaw, 1);
  }

  function specimenShelf(x, z, yaw) {
    addBox('wood', 1.3, 1.7, 0.4, x, 0.85, z, yaw, 0.6);
    for (let i = 0; i < 3; i++) {
      const y = 0.35 + i * 0.48;
      const p = local(x, z, yaw, 0, 0.02);
      addBox('wood', 1.24, 0.03, 0.36, p.x, y, p.z, yaw, 0.9);
      for (let j = 0; j < 5; j++) {
        const q = local(x, z, yaw, -0.48 + j * 0.24, 0.02);
        addCyl('jar', 0.045, 0.045, 0.17, q.x, y + 0.1, q.z, 8);
      }
    }
    addCollider(x, z, 1.35, 0.45, yaw);
  }

  function toilet(x, z, yaw) {
    addBox('paper', 0.36, 0.42, 0.5, x, 0.21, z, yaw, 0.9);
    addCyl('paper', 0.19, 0.2, 0.12, x, 0.46, z, 14);
    // 水箱朝墙（local -Z）
    addBox('paper', 0.36, 0.55, 0.2, x - Math.sin(yaw) * 0.28, 0.5, z - Math.cos(yaw) * 0.28, yaw, 0.9);
    addCollider(x, z, 0.42, 0.78, yaw);
  }

  function stall(x, z, yaw, w = 1.2) {
    addBox('dark', w, 1.95, 0.05, x, 0.975, z, yaw, 0.9);
    addBox('metal', w, 0.03, 0.08, x, 1.95, z, yaw, 1);
    const h = local(x, z, yaw, w * 0.3, 0.04);
    addBox('metal', 0.03, 0.2, 0.03, h.x, 1.0, h.z, yaw, 1);
    addCollider(x, z, w, 0.12, yaw);
  }

  function shower(x, z, yaw) {
    addCyl('metal', 0.02, 0.02, 0.5, x, 2.15, z, 6);
    addCyl('metal', 0.11, 0.09, 0.06, x + Math.sin(yaw) * 0.18, 1.92, z + Math.cos(yaw) * 0.18, 10);
    addBox('metal', 0.03, 0.95, 0.03, x + Math.sin(yaw) * 0.32, 1.22, z + Math.cos(yaw) * 0.32, yaw, 1);
    // 淋浴间侧板
    for (const s of [-1, 1]) {
      const p = local(x, z, yaw, s * 0.6, 0.2);
      addBox('dark', 0.04, 1.95, 1.15, p.x, 0.975, p.z, yaw, 0.9);
    }
    addCollider(x, z, 1.25, 0.7, yaw);
  }

  function towelDispenser(x, z, yaw) {
    addBox('metal', 0.28, 0.24, 0.16, x, 1.5, z, yaw, 1);
    const p = local(x, z, yaw, 0, 0.09);
    addBox('paper', 0.2, 0.16, 0.02, p.x, 1.45, p.z, yaw, 1);
  }

  function handDryer(x, z, yaw) {
    addBox('metal', 0.24, 0.3, 0.16, x, 1.25, z, yaw, 0.9);
    const p = local(x, z, yaw, 0, 0.09);
    addBox('dark', 0.18, 0.05, 0.02, p.x, 1.2, p.z, yaw, 1);
  }

  function filingCabinet(x, z, yaw) {
    addBox('metal', 0.62, 1.3, 0.5, x, 0.65, z, yaw, 0.7);
    for (let i = 0; i < 4; i++) {
      const p = local(x, z, yaw, 0, 0.26);
      addBox('dark', 0.54, 0.02, 0.02, p.x, 0.25 + i * 0.28, p.z, yaw, 1);
      addBox('metal', 0.16, 0.04, 0.03, p.x, 0.32 + i * 0.28, p.z, yaw, 1.2);
    }
    addCollider(x, z, 0.68, 0.56, yaw);
  }

  function bookshelf(x, z, yaw) {
    addBox('wood', 1.1, 1.9, 0.36, x, 0.95, z, yaw, 0.55);
    for (let i = 0; i < 4; i++) {
      const y = 0.25 + i * 0.45;
      const p = local(x, z, yaw, 0, 0.02);
      addBox('wood', 1.04, 0.03, 0.32, p.x, y, p.z, yaw, 0.9);
      for (let j = 0; j < 7; j++) {
        const q = local(x, z, yaw, -0.42 + j * 0.13, 0.02);
        const h = 0.24 + rng() * 0.1;
        addBox(j % 3 === 0 ? 'red' : j % 3 === 1 ? 'fabric' : 'dark', 0.09, h, 0.2, q.x, y + h / 2 + 0.02, q.z, yaw, 1);
      }
    }
    addCollider(x, z, 1.15, 0.4, yaw);
  }

  function sofa(x, z, yaw) {
    addBox('fabric', 1.9, 0.35, 0.8, x, 0.175, z, yaw, 0.7);
    const back = local(x, z, yaw, 0, -0.3);
    addBox('fabric', 1.9, 0.5, 0.2, back.x, 0.6, back.z, yaw, 0.7);
    for (const s of [-1, 1]) {
      const p = local(x, z, yaw, s * 0.88, 0);
      addBox('fabric', 0.16, 0.45, 0.8, p.x, 0.575, p.z, yaw, 0.7);
    }
    addCollider(x, z, 2.0, 0.9, yaw);
  }

  function coffeeTable(x, z, yaw) {
    addBox('wood', 1.1, 0.05, 0.6, x, 0.42, z, yaw, 0.7);
    for (const [lx, lz] of [[-0.48, -0.24], [0.48, -0.24], [-0.48, 0.24], [0.48, 0.24]]) {
      const p = local(x, z, yaw, lx, lz);
      addBox('wood', 0.05, 0.42, 0.05, p.x, 0.21, p.z, yaw, 1);
    }
    addCollider(x, z, 1.15, 0.65, yaw);
  }

  function waterCooler(x, z, yaw = 0) {
    addBox('metal', 0.36, 0.9, 0.36, x, 0.45, z, yaw, 0.8);
    addCyl('water', 0.14, 0.14, 0.36, x, 1.08, z, 12);
    const t = local(x, z, yaw, 0, 0.19);
    addBox('dark', 0.1, 0.04, 0.06, t.x, 0.8, t.z, yaw, 1);
    addCollider(x, z, 0.42, 0.42, yaw);
  }

  function coatRack(x, z, yaw = 0) {
    addCyl('metal', 0.02, 0.02, 1.7, x, 0.85, z, 6, yaw);
    addCyl('metal', 0.18, 0.2, 0.03, x, 0.015, z, 10, yaw);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const p = local(x, z, yaw, Math.cos(a) * 0.1, Math.sin(a) * 0.1);
      addBox('metal', 0.22, 0.02, 0.02, p.x, 1.6, p.z, yaw + a, 1);
    }
    const cp = local(x, z, yaw, 0, 0.12);
    addBox('fabric', 0.4, 0.5, 0.2, cp.x, 1.3, cp.z, yaw, 0.7);
    addCollider(x, z, 0.4, 0.4, 0);
  }

  function coatRack(x, z) {
    addCyl('metal', 0.02, 0.02, 1.7, x, 0.85, z, 6);
    addCyl('metal', 0.18, 0.2, 0.03, x, 0.02, z, 10);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      addBox('metal', 0.22, 0.02, 0.02, x + Math.cos(a) * 0.1, 1.6, z + Math.sin(a) * 0.1, a, 1);
    }
    addBox('fabric', 0.4, 0.5, 0.2, x + 0.1, 1.3, z, 0.3, 0.7);
  }

  function bulletinBoard(x, z, yaw) {
    addBox('wood', 1.5, 0.95, 0.05, x, 1.6, z, yaw, 0.7);
    for (let i = 0; i < 7; i++) {
      const p = local(x, z, yaw, (Math.random() - 0.5) * 1.2, 0.035);
      addPlane('paper', 0.16 + Math.random() * 0.1, 0.2 + Math.random() * 0.1, p.x, 1.55 + (Math.random() - 0.5) * 0.6, p.z, yaw);
    }
  }

  function wallClock(x, z, yaw) {
    const p = local(x, z, yaw, 0, 0.02);
    addBox('dark', 0.34, 0.34, 0.04, p.x, 2.15, p.z, yaw, 1);
    const face = local(x, z, yaw, 0, 0.045);
    addBox('paper', 0.29, 0.29, 0.012, face.x, 2.15, face.z, yaw, 1);
    const hand1 = local(x, z, yaw, 0, 0.055);
    addBox('dark', 0.012, 0.11, 0.01, hand1.x, 2.19, hand1.z, yaw, 1);
    const hand2 = local(x, z, yaw, 0.04, 0.055);
    addBox('dark', 0.08, 0.012, 0.01, hand2.x, 2.15, hand2.z, yaw, 1);
  }

  function fireExtinguisher(x, z, yaw) {
    const b = local(x, z, yaw, 0, 0.03);
    addCyl('red', 0.075, 0.075, 0.5, b.x, 1.0, b.z, 10);
    addCyl('dark', 0.04, 0.04, 0.07, b.x, 1.29, b.z, 8);
    const br = local(x, z, yaw, 0, 0.03);
    addBox('dark', 0.04, 0.5, 0.04, br.x, 1.0, br.z, yaw, 1);
    const h = local(x, z, yaw, 0.08, 0.03);
    addBox('metal', 0.02, 0.16, 0.02, h.x, 1.2, h.z, 0, 1);
  }

  function sanitizer(x, z, yaw) {
    addBox('metal', 0.14, 0.24, 0.1, x, 1.3, z, yaw, 1);
    const p = local(x, z, yaw, 0, 0.06);
    addBox('paper', 0.1, 0.14, 0.08, p.x, 1.34, p.z, yaw, 1);
  }

  function gloveBox(x, z, yaw) {
    addBox('metal', 0.24, 0.16, 0.1, x, 1.4, z, yaw, 1);
    const p = local(x, z, yaw, 0, 0.06);
    addBox('paper', 0.18, 0.06, 0.04, p.x, 1.36, p.z, yaw, 1);
  }

  function lightSwitch(x, z, yaw) {
    addBox('paper', 0.08, 0.12, 0.02, x, 1.25, z, yaw, 1);
  }

  function gasPanel(x, z, yaw) {
    addBox('metal', 0.5, 0.34, 0.04, x, 1.5, z, yaw, 1);
    for (const s of [-1, 1]) {
      const p = local(x, z, yaw, s * 0.13, 0.04);
      addCyl('dark', 0.035, 0.035, 0.06, p.x, 1.5, p.z, 8);
      const q = local(x, z, yaw, s * 0.13, 0.07);
      addCyl('metal', 0.02, 0.02, 0.02, q.x, 1.5, q.z, 8);
    }
    addBox('dark', 0.1, 0.03, 0.02, x, 1.36, z, yaw, 1);
  }

  function chartHolder(x, z, yaw) {
    addBox('dark', 0.24, 0.32, 0.03, x, 1.45, z, yaw, 1);
    const p = local(x, z, yaw, 0, 0.025);
    addPlane('paper', 0.2, 0.28, p.x, 1.45, p.z, yaw);
  }

  function ceilingVent(x, z) {
    addBox('dark', 0.62, 0.04, 0.62, x, WALL_H - 0.03, z, 0, 0.9);
    for (let i = 0; i < 5; i++) {
      addBox('metal', 0.5, 0.015, 0.02, x, WALL_H - 0.05, z - 0.2 + i * 0.1, 0, 1);
    }
  }

  function bedCurtain(x, z, yaw) {
    const nx = Math.sin(yaw);
    const nz = Math.cos(yaw);
    const x1 = x;
    const z1 = z;
    const x2 = x + nx * 1.7;
    const z2 = z + nz * 1.7;
    addTrack(x1, z1, x2, z2, WALL_H - 0.12);
    const cx = (x1 + x2) / 2 + nx * 0.15;
    const cz = (z1 + z2) / 2 + nz * 0.15;
    const curtainYaw = yaw + Math.PI / 2;
    addPlane('curtain', 1.3, 2.0, cx, 1.35, cz, curtainYaw);
    hideSpots.push({ x: cx, z: cz, yaw: curtainYaw, type: 'curtain' });
  }

  function debris(room, x, z) {
    const n = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const s = 0.05 + rng() * 0.12;
      const bx = x + (rng() - 0.5) * 1.2;
      const bz = z + (rng() - 0.5) * 1.2;
      if (!clearOfDoors(room, bx, bz, 1.2)) continue;
      addBox('dark', s, s * 0.6, s, bx, s * 0.3, bz, rng() * 3, 1.4);
    }
  }

  // ---------------------------------------------------------------- 房间成套布景

  function decorateWalls(room) {
    const fns = [
      (p) => gasPanel(p.x, p.z, p.yaw),
      (p) => chartHolder(p.x, p.z, p.yaw),
      (p) => sanitizer(p.x, p.z, p.yaw),
      (p) => gloveBox(p.x, p.z, p.yaw),
      (p) => lightSwitch(p.x, p.z, p.yaw),
      (p) => wallClock(p.x, p.z, p.yaw),
      (p) => fireExtinguisher(p.x, p.z, p.yaw),
      (p) => bulletinBoard(p.x, p.z, p.yaw),
    ];
    const sides = ['n', 's', 'e', 'w'];
    for (let i = 0; i < 5; i++) {
      const side = sides[Math.floor(rng() * 4)];
      const p = atWall(room, side, 0.15 + rng() * 0.7, 0.09);
      if (!clearOfDoors(room, p.x, p.z, 1.6)) continue;
      if (
        furnitureBoxes.some(
          (b) => p.x > b.minX - 0.3 && p.x < b.maxX + 0.3 && p.z > b.minZ - 0.3 && p.z < b.maxZ + 0.3,
        )
      ) {
        continue;
      }
      fns[Math.floor(rng() * fns.length)](p);
    }
    const c = roomCenter(room);
    const vx = c.x + (rng() - 0.5) * 2.4;
    const vz = c.z + (rng() - 0.5) * 2.4;
    if (Math.hypot(vx - c.x, vz - c.z) >= 1.2) ceilingVent(vx, vz);
  }

  function furnishWard(room, back, left, right) {
    const c = roomCenter(room);
    // 墙长不足 8.6 米时只放 2 张床，避免床头柜/监护仪互相压穿
    const wallLen = back === 'n' || back === 's' ? c.w : c.d;
    const n = wallLen >= 8.6 ? 3 : 2;
    const beds = [];
    for (let i = 0; i < n; i++) {
      const f = wallFrame(room, back, (i + 0.5) / n);
      const p = place(f, 1.02, 0);
      if (!clearOfDoors(room, p.x, p.z, 1.75)) continue;
      beds.push({ f, p, yaw: intoRoomYaw(f) });
    }

    for (const b of beds) {
      bed(b.p.x, b.p.z, b.yaw);
      // 床头柜 / 监护仪贴墙
      const ns = place(b.f, 0.26, 0.8);
      if (clearOfDoors(room, ns.x, ns.z, 1.15)) nightstand(ns.x, ns.z, b.f.yaw);
      const vm = place(b.f, 0.26, -0.8);
      if (clearOfDoors(room, vm.x, vm.z, 1.15)) vitalMonitor(vm.x, vm.z, b.f.yaw);
      // 输液架 / 床上桌（放在床尾外侧，避免立柱穿过床架）
      const iv = place(b.f, 1.48, 1.02);
      ivStand(iv.x, iv.z);
      const ot = place(b.f, 2.28, 0.56);
      overbedTable(ot.x, ot.z, ot.yaw);
    }

    // 相邻病床之间的隔帘（从墙面向房间内）
    for (let i = 0; i < beds.length - 1; i++) {
      const mx = (beds[i].p.x + beds[i + 1].p.x) / 2;
      const mz = (beds[i].p.z + beds[i + 1].p.z) / 2;
      const bx = mx - beds[i].f.nx * 1.02;
      const bz = mz - beds[i].f.nz * 1.02;
      if (!clearOfDoors(room, bx, bz, 1.2)) continue;
      addTrack(bx, bz, bx + beds[i].f.nx * 1.9, bz + beds[i].f.nz * 1.9, WALL_H - 0.12);
      const cx = bx + beds[i].f.nx * 0.95;
      const cz = bz + beds[i].f.nz * 0.95;
      const yaw = intoRoomYaw(beds[i].f);
      addPlane('curtain', 1.05, 2.9, cx, 1.83, cz, yaw);
      hideSpots.push({ x: cx, z: cz, yaw, type: 'curtain' });
    }

    const wf = wallFrame(room, left, 0.5);
    const wp = place(wf, 0.36, 0);
    if (clearOfDoors(room, wp.x, wp.z, 1.5)) wardrobe(wp.x, wp.z, wf.yaw);

    for (const t of [0.32, 0.68]) {
      const f = wallFrame(room, right, t);
      const p = place(f, 0.48, 0);
      if (clearOfDoors(room, p.x, p.z, 1.15)) chair(p.x, p.z, f.yaw);
    }

    placeBin(room, c);
    debris(room, c.x - 1.9, c.z - 1.9);

    // 病房中间的会客区
    if (c.w > 6 && c.d > 5.5) {
      const tx = c.x + (rng() - 0.5) * 1.4;
      const tz = c.z + (rng() - 0.5) * 1.4;
      if (clearOfDoors(room, tx, tz, 2.1)) {
        addCyl('wood', 0.45, 0.45, 0.05, tx, 0.72, tz, 16);
        addCyl('metal', 0.04, 0.05, 0.7, tx, 0.36, tz, 8);
        addCyl('dark', 0.3, 0.34, 0.04, tx, 0.02, tz, 16);
        addCollider(tx, tz, 0.9, 0.9, 0);
        chair(tx + 0.85, tz, -Math.PI / 2);
        chair(tx - 0.85, tz, Math.PI / 2);
      }
    }

    decorateWalls(room);
  }

  function furnishOR(room, back, left, right) {
    const c = roomCenter(room);
    const alongX = c.w >= c.d;
    const yaw = alongX ? 0 : Math.PI / 2;
    const ax = alongX ? 1 : 0;
    const az = alongX ? 0 : 1;
    const px = alongX ? 0 : 1;
    const pz = alongX ? 1 : 0;

    operatingTable(c.x, c.z, yaw);
    surgicalLamp(c.x, c.z);

    anesthesiaMachine(c.x + ax * 1.85, c.z + az * 1.85, yaw + Math.PI);
    instrumentTable(c.x - ax * 1.7 + px * 0.7, c.z - az * 1.7 + pz * 0.7, yaw + Math.PI / 2);
    mayoStand(c.x + ax * 0.55 + px * 1.25, c.z + az * 0.55 + pz * 1.25);

    const bf = wallFrame(room, back, 0.28);
    const sp = place(bf, 0.29, 0);
    if (clearOfDoors(room, sp.x, sp.z, 1.5)) scrubSink(sp.x, sp.z, bf.yaw);

    const lf = wallFrame(room, left, 0.5);
    const lc = place(lf, 0.2, 0);
    if (clearOfDoors(room, lc.x, lc.z, 1.2)) wallCabinet(lc.x, lc.z, lf.yaw, 1.2, 0.65, 1.85);

    const rf = wallFrame(room, right, 0.5);
    const rv = place(rf, 0.05, 0);
    if (clearOfDoors(room, rv.x, rv.z, 1.2)) xrayViewer(rv.x, rv.z, rf.yaw);

    const cf = wallFrame(room, back, 0.78);
    const cy = place(cf, 0.5, 0);
    if (clearOfDoors(room, cy.x, cy.z, 1.2)) oxygenCylinder(cy.x, cy.z);
    const sf = wallFrame(room, right, 0.22);
    const st = place(sf, 0.5, 0);
    if (clearOfDoors(room, st.x, st.z, 1.0)) stool(st.x, st.z);

    // 器械柜（手术室藏身点）
    const lk = tryPlace(room, left, 0.35, [0.28, -0.28, 0.4], 1.2);
    if (lk) locker(lk.x, lk.z, lk.yaw);

    placeBin(room, c);
    debris(room, c.x + 0.5, c.z - 1.6);
    decorateWalls(room);
  }

  function furnishStorage(room, back, left, right) {
    const c = roomCenter(room);

    const bf = wallFrame(room, back, 0.5);
    for (const t of [-1.42, 0, 1.42]) {
      const p = place(bf, 0.18, t);
      if (clearOfDoors(room, p.x, p.z, 1.2)) shelf(p.x, p.z, bf.yaw);
    }
    const lf = wallFrame(room, left, 0.5);
    const lp = place(lf, 0.18, 0);
    if (clearOfDoors(room, lp.x, lp.z, 1.3)) shelf(lp.x, lp.z, lf.yaw);

    const rf = wallFrame(room, right, 0.5);
    for (const t of [-1.0, 0, 1.0]) {
      const p = place(rf, 0.32, t);
      if (clearOfDoors(room, p.x, p.z, 1.1)) locker(p.x, p.z, rf.yaw);
    }

    for (let i = 0; i < 7; i++) {
      const x = c.x + (rng() - 0.5) * (c.w - 3.2);
      const z = c.z + (rng() - 0.5) * (c.d - 3.2);
      if (!clearOfDoors(room, x, z, 1.3)) continue;
      const s = 0.3 + rng() * 0.26;
      addBox('wood', s, s * 0.8, s, x, s * 0.4, z, rng() * 3, 0.9);
      if (rng() > 0.55) addBox('paper', s * 0.7, 0.02, s * 0.7, x, s * 0.81, z, rng() * 3, 1);
    }

    const cart = wallFrame(room, left, 0.82);
    const cp = place(cart, 0.55, 0);
    if (clearOfDoors(room, cp.x, cp.z, 1.2)) cleaningCart(cp.x, cp.z, cart.yaw);
    mopBucket(c.x - 1.5, c.z + 1.4);
    placeBin(room, c);
    decorateWalls(room);
  }

  function furnishOffice(room, back, left, right) {
    const c = roomCenter(room);

    // 办公桌组：任一墙都行，不能被一个门距判定整组丢弃
    let df = tryPlace(room, back, 0.45, [0, 0.2, -0.2], 1.5, [1.7, 0.8]);
    if (!df) df = tryPlace(room, left, 0.45, [0, 0.2, -0.2], 1.5, [1.7, 0.8]);
    if (!df) df = tryPlace(room, right, 0.45, [0, 0.2, -0.2], 1.5, [1.7, 0.8]);
    if (df) {
      desk(df.x, df.z, df.yaw);
      const ch = place(df.f, 1.12, 0);
      chair(ch.x, ch.z, df.yaw + Math.PI);
      const mon = place(df.f, 0.32, 0.28);
      addBox('dark', 0.42, 0.3, 0.14, mon.x, 0.94, mon.z, df.yaw, 0.9);
      const scr = place(df.f, 0.32, 0.28);
      scr.x += df.f.nx * 0.08;
      scr.z += df.f.nz * 0.08;
      addPlane('screen', 0.34, 0.22, scr.x, 0.95, scr.z, df.yaw);
      const kb = place(df.f, 0.35, -0.18);
      addBox('dark', 0.32, 0.02, 0.12, kb.x, 0.8, kb.z, df.yaw, 1);
      const paper = place(df.f, 0.38, -0.55);
      addBox('paper', 0.22, 0.004, 0.3, paper.x, 0.792, paper.z, df.yaw, 1);
    }

    const fc = tryAnyWall(room, 0.32, [0.7, 0.6]);
    if (fc) filingCabinet(fc.x, fc.z, fc.yaw);

    const bs = tryAnyWall(room, 0.32, [1.2, 0.4]);
    if (bs) bookshelf(bs.x, bs.z, bs.yaw);

    const frontSide = doorSideOf(room, back);
    const sofaP = tryAnyWall(room, 0.55, [2.0, 0.9], [frontSide, back, left, right]);
    if (sofaP) {
      sofa(sofaP.x, sofaP.z, sofaP.yaw);
      const ct = place(sofaP.f, 1.36, 0);
      if (!boxHitsDoor(room, ct.x - 0.6, ct.x + 0.6, ct.z - 0.35, ct.z + 0.35, 0.15)) {
        coffeeTable(ct.x, ct.z, sofaP.yaw);
      }
    }

    const wcp = tryAnyWall(room, 0.3, [0.45, 0.45]);
    if (wcp) waterCooler(wcp.x, wcp.z, wcp.yaw);
    const crp = tryAnyWall(room, 0.25, [0.45, 0.45]);
    if (crp) coatRack(crp.x, crp.z, crp.yaw);

    // 文件柜（值班室藏身点）
    const lk = tryAnyWall(room, 0.32, [0.8, 0.6]);
    if (lk) locker(lk.x, lk.z, lk.yaw);

    placeBin(room, c);
    debris(room, c.x + 1.2, c.z + 1.2);
    decorateWalls(room);
  }

  function furnishMorgue(room, back, left, right) {
    const c = roomCenter(room);

    const dpos = tryPlace(room, back, 0.34, [0], 0, [2.9, 0.7]);
    if (dpos) morgueDrawers(dpos.x, dpos.z, dpos.yaw);

    const alongX = c.w >= c.d;
    stainlessTable(c.x, c.z, alongX ? 0 : Math.PI / 2);

    for (const [side, t] of [[left, 0.3], [right, 0.3]]) {
      const g = tryPlace(room, side, 1.05, [t - 0.5], 0, [2.0, 0.85]);
      if (!g) continue;
      gurney(g.x, g.z, g.yaw);
      bodyBag(g.x, g.z, g.yaw);
    }

    const sc = tryPlace(room, back, 1.1, [0.4], 0, [0.3, 0.3]);
    if (sc) hangingScale(sc.x, sc.z, sc.yaw);

    const sp = tryAnyWall(room, 0.22, [1.4, 0.45]);
    if (sp) specimenShelf(sp.x, sp.z, sp.yaw);

    const kp = tryAnyWall(room, 0.29, [0.9, 0.6]);
    if (kp) sink(kp.x, kp.z, kp.yaw);

    const lp = tryAnyWall(room, 0.32, [0.8, 0.6]);
    if (lp) locker(lp.x, lp.z, lp.yaw);

    placeBin(room, c);
    debris(room, c.x - 1.2, c.z - 1.2);
    decorateWalls(room);
  }

  function furnishBath(room, back, left, right) {
    const c = roomCenter(room);
    const bf = wallFrame(room, back, 0.5);

    // 马桶隔间数量按房间宽度自适应
    const n = c.w >= 10 ? 3 : 2;
    for (let i = 0; i <= n; i++) {
      const along = (i - n / 2) * 1.3;
      const p = place(bf, 0.65, along);
      if (!clearOfDoors(room, p.x, p.z, 1.35)) continue;
      addBox('dark', 0.05, 1.95, 1.3, p.x, 0.975, p.z, bf.yaw, 0.9);
    }
    for (let i = 0; i < n; i++) {
      const along = (i - (n - 1) / 2) * 1.3;
      const p = place(bf, 0.72, along);
      if (!clearOfDoors(room, p.x, p.z, 1.35)) continue;
      toilet(p.x, p.z, bf.yaw);
    }
    // 贴墙无障碍扶手（两端带支耳）
    const rail = place(bf, 0.06, 0);
    addBox('metal', n * 1.3 + 0.4, 0.04, 0.04, rail.x, 1.0, rail.z, bf.yaw, 1);
    for (const s of [-1, 1]) {
      const b = place(bf, 0.03, (s * (n * 1.3 + 0.4)) / 2);
      addBox('metal', 0.04, 0.04, 0.08, b.x, 1.0, b.z, bf.yaw, 1);
    }

    // 洗手台 + 镜子
    const lf = wallFrame(room, left, 0.5);
    const sinkCount = c.d >= 10 ? 3 : 2;
    for (let i = 0; i < sinkCount; i++) {
      const t = (i - (sinkCount - 1) / 2) * 1.3;
      const p = place(lf, 0.27, t);
      if (!clearOfDoors(room, p.x, p.z, 1.1)) continue;
      sink(p.x, p.z, lf.yaw);
      const m = place(lf, 0.06, t);
      addPlane('mirror', 0.62, 0.82, m.x, 1.68, m.z, lf.yaw);
    }

    // 淋浴区（远离门口）
    const rf = wallFrame(room, right, 0.5);
    const sc = place(rf, 0.75, -1.25);
    if (clearOfDoors(room, sc.x, sc.z, 1.35)) {
      const tx = rf.tx;
      const tz = rf.tz;
      addTrack(sc.x - tx * 0.6, sc.z - tz * 0.6, sc.x + tx * 0.6, sc.z + tz * 0.6, 2.4);
      const curtainYaw = Math.atan2(-tz, tx);
      addPlane('curtain', 1.15, 2.0, sc.x, 1.35, sc.z, curtainYaw);
      hideSpots.push({ x: sc.x, z: sc.z, yaw: curtainYaw, type: 'curtain' });
      addCyl('metal', 0.11, 0.09, 0.06, sc.x, 2.15, sc.z, 10);
      addCyl('metal', 0.02, 0.02, 0.5, sc.x, 2.15, sc.z, 6);
      // 淋浴托盘 + 地漏
      addBox('dark', 0.95, 0.03, 0.95, sc.x, 0.015, sc.z, curtainYaw, 1);
      addCyl('metal', 0.07, 0.07, 0.02, sc.x, 0.035, sc.z, 10);
    }

    const td = tryPlace(room, right, 0.085, [0.28, -0.28], 1.35);
    if (td) towelDispenser(td.x, td.z, td.yaw);

    placeBin(room, c);
    debris(room, c.x - 1.2, c.z - 1.2);
    decorateWalls(room);
  }

  function doorSideOf(room, back) {
    return OPP[back];
  }

  function furnishRoom(room) {
    const main = room.doors[0];
    const back = main ? OPP[main.side] : 'n';
    const left = main && (main.side === 'n' || main.side === 's') ? 'w' : 'n';
    const right = main && (main.side === 'n' || main.side === 's') ? 'e' : 's';

    if (room.type === 'ward') furnishWard(room, back, left, right);
    else if (room.type === 'or') furnishOR(room, back, left, right);
    else if (room.type === 'storage') furnishStorage(room, back, left, right);
    else if (room.type === 'office') furnishOffice(room, back, left, right);
    else if (room.type === 'morgue') furnishMorgue(room, back, left, right);
    else if (room.type === 'bath') furnishBath(room, back, left, right);
  }

  rooms.forEach(furnishRoom);

  // 护士站：接待台 + 座椅 + 暖光
  {
    const hx = ((HUB.x0 + HUB.x1) / 2 + 0.5) * TILE;
    const hz = ((HUB.z0 + HUB.z1) / 2 + 0.5) * TILE;
    addBox('wood', 3.6, 1.05, 0.7, hx, 0.525, hz, 0, 0.5);
    addBox('metal', 3.7, 0.05, 0.78, hx, 1.05, hz, 0, 0.8);
    addCollider(hx, hz, 3.7, 0.8, 0);
    addBox('dark', 0.5, 0.55, 0.05, hx - 1.4, 0.75, hz + 0.4);
    chair(hx - 1.1, hz + 1.1, Math.PI);
    chair(hx + 1.1, hz + 1.1, Math.PI);
    // 值班表 / 白板
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x3d433f, roughness: 0.95 }),
    );
    board.position.set(hx, 1.9, hz - 2.6);
    group.add(board);
    const hubLight = new THREE.PointLight(ZONE_LIGHT.hub, 14, 11, 2);
    hubLight.position.set(hx, WALL_H - 0.3, hz);
    group.add(hubLight);
    lights.push({ light: hubLight, mesh: null, base: 14, baseEmissive: 1, flicker: false, phase: 0, fixture: false });
    const hubTex = signTexture('护士站', 'NURSE STATION');
    const hubMat = new THREE.MeshStandardMaterial({
      map: hubTex,
      emissiveMap: hubTex,
      emissive: 0xffffff,
      emissiveIntensity: 0.2,
      roughness: 0.6,
    });
    const hubSign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.6), hubMat);
    hubSign.position.set(hx, 2.55, hz - 2.75);
    group.add(hubSign);
  }

  // 走廊陈设：贴墙、平行于墙面摆放
  const spawnA = { x: wx(3), z: wz(3) };
  const spawnB = { x: wx(34), z: wz(26) };
  const doorPts = doors.map((d) => ({ x: (d.x + 0.5) * TILE, z: (d.z + 0.5) * TILE }));
  const placedCorridor = [];

  function corridorFree(x, z, r) {
    if (Math.hypot(x - spawnA.x, z - spawnA.z) < 3.2) return false;
    if (Math.hypot(x - spawnB.x, z - spawnB.z) < 3.2) return false;
    if (doorPts.some((d) => Math.hypot(d.x - x, d.z - z) < r)) return false;
    if (pillars.some((p) => Math.hypot(p[0] - x, p[1] - z) < 1.3)) return false;
    if (placedCorridor.some((p) => Math.hypot(p.x - x, p.z - z) < 2.6)) return false;
    return true;
  }

  // 折叠屏风（可躲藏，也能切断视线）
  function privacyScreen(x, z, yaw) {
    for (const [ox, tilt] of [[-0.62, 0.22], [0, 0], [0.62, -0.22]]) {
      const g = new THREE.PlaneGeometry(0.64, 2.0, 4, 1);
      g.translate(ox, 1.0, 0);
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw + tilt));
      g.translate(x, 0, z);
      push('curtain', g);
    }
    hideSpots.push({ x, z, yaw, type: 'screen' });
    addCollider(x, z, 1.9, 0.2, yaw);
    placedCorridor.push({ x, z });
  }

  for (const [x, z, yaw] of [
    [wx(11.5), 4.72, 0],
    [wx(24.5), 8.48, Math.PI],
    [4.72, wz(12.5), Math.PI / 2],
    [78.88, wz(18.5), -Math.PI / 2],
  ]) {
    privacyScreen(x, z, yaw);
  }

  const corridorWalls = [
    { axis: 'x', fixed: 4.92, from: 6, to: 78, yaw: 0 },
    { axis: 'x', fixed: 8.28, from: 6, to: 78, yaw: Math.PI },
    { axis: 'x', fixed: 57.72, from: 6, to: 78, yaw: 0 },
    { axis: 'x', fixed: 61.08, from: 6, to: 78, yaw: Math.PI },
    { axis: 'z', fixed: 4.92, from: 6, to: 57, yaw: Math.PI / 2 },
    { axis: 'z', fixed: 8.28, from: 6, to: 57, yaw: -Math.PI / 2 },
    { axis: 'z', fixed: 75.32, from: 6, to: 57, yaw: Math.PI / 2 },
    { axis: 'z', fixed: 78.68, from: 6, to: 57, yaw: -Math.PI / 2 },
    { axis: 'z', fixed: 40.12, from: 8, to: 56, yaw: Math.PI / 2 },
    { axis: 'z', fixed: 43.48, from: 8, to: 56, yaw: -Math.PI / 2 },
    { axis: 'x', fixed: 31.32, from: 8, to: 76, yaw: 0 },
    { axis: 'x', fixed: 34.68, from: 8, to: 76, yaw: Math.PI },
  ];

  const corridorKinds = [
    (x, z, yaw) => gurney(x, z, yaw),
    (x, z, yaw) => wheelchair(x, z, yaw),
    (x, z, yaw) => crashCart(x, z, yaw),
    (x, z, yaw) => cleaningCart(x, z, yaw),
    (x, z) => oxygenCylinder(x, z),
    (x, z) => ivStand(x, z),
    (x, z) => bin(x, z),
    (x, z, yaw) => stretcher(x, z, yaw),
  ];

  for (const wall of corridorWalls) {
    const count = wall.axis === 'x' && (wall.fixed === 4.92 || wall.fixed === 61.08) ? 2 : 1;
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 14; tries++) {
        const along = wall.from + rng() * (wall.to - wall.from);
        const x = wall.axis === 'x' ? along : wall.fixed;
        const z = wall.axis === 'x' ? wall.fixed : along;
        if (!corridorFree(x, z, 1.6)) continue;
        corridorKinds[Math.floor(rng() * corridorKinds.length)](x, z, wall.yaw);
        placedCorridor.push({ x, z });
        break;
      }
    }
  }

  // 走廊墙面：公告板 / 时钟 / 灭火器
  for (const [x, z, yaw] of [
    [wx(7), 4.48, 0],
    [wx(16), 8.72, Math.PI],
    [wx(25), 4.48, 0],
    [wx(31), 8.72, Math.PI],
    [4.48, wz(11), Math.PI / 2],
    [8.72, wz(19), -Math.PI / 2],
    [78.92, wz(23), -Math.PI / 2],
  ]) {
    const pick = Math.floor(rng() * 3);
    if (pick === 0) bulletinBoard(x, z, yaw);
    else if (pick === 1) wallClock(x, z, yaw);
    else fireExtinguisher(x, z, yaw);
  }

  // 走廊里的折叠屏风（只保留这一份实现）
  for (const [x, z, yaw] of [
    [wx(11.5), 4.95, 0],
    [wx(24.5), 8.35, Math.PI],
    [4.95, wz(12.5), Math.PI / 2],
    [78.95, wz(18.5), -Math.PI / 2],
  ]) {
    privacyScreen(x, z, yaw);
  }

  // ---------------------------------------------------------------- 灯光

  const corridorLights = [
    [6, 2.5], [13, 2.5], [22, 2.5], [30, 2.5],
    [6, 26.5], [13, 26.5], [22, 26.5], [30, 26.5],
    [2.5, 8], [2.5, 20], [34.5, 8], [34.5, 20],
    [18.5, 7], [18.5, 21], [8, 14.5], [28, 14.5],
  ];
  for (const [tx, tz] of corridorLights) {
    const x = wx(tx);
    const z = wz(tz);
    const fixtureGeo = new THREE.BoxGeometry(1.2, 0.06, 0.22);
    const fixtureMat = MAT.lamp.clone();
    const fixture = new THREE.Mesh(fixtureGeo, fixtureMat);
    fixture.position.set(x, WALL_H - 0.12, z);
    group.add(fixture);
    const light = new THREE.PointLight(ZONE_LIGHT.corridor, 14, 12, 2);
    light.position.set(x, WALL_H - 0.4, z);
    group.add(light);
    lights.push({ light, mesh: fixture, base: 14, baseEmissive: 2.4, flicker: rng() > 0.55, phase: rng() * 20, fixture: true });
  }

  rooms.forEach((room, i) => {
    const x = ((room.x0 + room.x1) / 2 + 0.5) * TILE;
    const z = ((room.z0 + room.z1) / 2 + 0.5) * TILE;

    // 每间房都有微光的应急灯罩（不产生实时光源，只保证可读性）
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.045, 0.16),
      new THREE.MeshStandardMaterial({
        color: 0x8fb0c2,
        emissive: 0x7fa8bc,
        emissiveIntensity: 0.85,
        roughness: 0.6,
      }),
    );
    panel.position.set(x, WALL_H - 0.1, z);
    group.add(panel);

    if (i % 2 !== 0) return;
    const fixtureGeo = new THREE.BoxGeometry(0.9, 0.05, 0.2);
    const fixtureMat = MAT.lamp.clone();
    fixtureMat.emissiveIntensity = 1.6;
    const fixture = new THREE.Mesh(fixtureGeo, fixtureMat);
    fixture.position.set(x, WALL_H - 0.14, z);
    group.add(fixture);
    const light = new THREE.PointLight(ZONE_LIGHT[room.zone] || 0xbfd9e6, 11, 9, 2);
    light.position.set(x, WALL_H - 0.5, z);
    group.add(light);
    lights.push({ light, mesh: fixture, base: 11, baseEmissive: 1.6, flicker: rng() > 0.55, phase: rng() * 20, fixture: true });
  });

  while (lights.length > 18) {
    const L = lights.pop();
    L.light?.removeFromParent();
    if (L.fixture) L.mesh?.removeFromParent();
  }

  // ---------------------------------------------------------------- 走廊节奏：柱列 / 横梁 / 扶手

  // 柱列：打断长走廊，提供贴墙掩体与节奏
  for (const tx of [5, 9, 13, 23, 27, 31]) {
    pillars.push([wx(tx), 4.85], [wx(tx), 8.35], [wx(tx), 57.45], [wx(tx), 61.15]);
  }
  for (const tz of [6, 10, 18, 22]) {
    pillars.push([4.75, wz(tz)], [8.45, wz(tz)], [75.05, wz(tz)], [78.95, wz(tz)]);
  }
  for (const tz of [6, 10, 22, 25]) {
    pillars.push([39.95, wz(tz)], [43.65, wz(tz)]);
  }
  for (const tx of [5, 9, 13, 24, 28, 32]) {
    pillars.push([wx(tx), 31.15], [wx(tx), 34.85]);
  }
  for (const [px, pz] of pillars) {
    addBox('wall', 0.46, WALL_H, 0.46, px, WALL_H / 2, pz, 0, 0.45);
    addBox('metal', 0.52, 0.12, 0.52, px, 0.06, pz, 0, 0.9);
    addCollider(px, pz, 0.52, 0.52, 0);
  }

  // 横梁：压暗顶部，制造纵深
  for (let tx = 4; tx <= 34; tx += 4) {
    addBox('dark', 0.3, 0.34, TILE * 2, wx(tx), WALL_H - 0.17, wz(2.5), 0, 1);
    addBox('dark', 0.3, 0.34, TILE * 2, wx(tx), WALL_H - 0.17, wz(26.5), 0, 1);
  }
  for (let tz = 4; tz <= 26; tz += 4) {
    addBox('dark', TILE * 2, 0.34, 0.3, wx(2.5), WALL_H - 0.17, wz(tz), 0, 1);
    addBox('dark', TILE * 2, 0.34, 0.3, wx(34.5), WALL_H - 0.17, wz(tz), 0, 1);
  }

  // 扶手
  const railY = 1.02;
  addBox('metal', 33 * TILE, 0.1, 0.06, 17.5 * TILE, railY, 4.5, 0, 1);
  addBox('metal', 33 * TILE, 0.1, 0.06, 17.5 * TILE, railY, 8.7, 0, 1);
  addBox('metal', 33 * TILE, 0.1, 0.06, 17.5 * TILE, railY, 57.3, 0, 1);
  addBox('metal', 33 * TILE, 0.1, 0.06, 17.5 * TILE, railY, 61.5, 0, 1);
  addBox('metal', 0.06, 0.1, 23 * TILE, 4.5, railY, 15 * TILE, 0, 1);
  addBox('metal', 0.06, 0.1, 23 * TILE, 8.7, railY, 15 * TILE, 0, 1);
  addBox('metal', 0.06, 0.1, 23 * TILE, 75.1, railY, 15 * TILE, 0, 1);
  addBox('metal', 0.06, 0.1, 23 * TILE, 78.9, railY, 15 * TILE, 0, 1);

  // ---------------------------------------------------------------- 管线

  function addPipe(mat, radius, length, x, y, z, alongX = true, seg = 10) {
    const g = new THREE.CylinderGeometry(radius, radius, length, seg);
    if (alongX) g.rotateZ(Math.PI / 2);
    g.translate(x, y, z);
    push(mat, g);
  }

  const corridorLen = 33 * TILE;
  const corridorMid = 17.5 * TILE;
  for (const [z, r, y] of [
    [2.35 * TILE, 0.05, 3.12],
    [2.5 * TILE, 0.03, 3.2],
    [26.65 * TILE, 0.05, 3.1],
    [26.8 * TILE, 0.03, 3.19],
  ]) {
    addPipe('metal', r, corridorLen, corridorMid, y, z, true, 8);
  }
  for (const [x, z, alongX] of [
    [2.6 * TILE, 9 * TILE, false],
    [2.6 * TILE, 21 * TILE, false],
    [34.4 * TILE, 9 * TILE, false],
    [34.4 * TILE, 21 * TILE, false],
    [18.4 * TILE, 7 * TILE, false],
    [18.4 * TILE, 22 * TILE, false],
  ]) {
    addPipe('metal', 0.04, WALL_H - 0.3, x, (WALL_H - 0.3) / 2, z, alongX, 8);
  }

  // ---------------------------------------------------------------- 窗户（外环）

  function windowAt(x, z, ry, w = 1.5, h = 1.0) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), MAT.window);
    pane.position.set(x, 2.15, z);
    pane.rotation.y = ry;
    group.add(pane);
    const ox = Math.sin(ry) * 0.04;
    const oz = Math.cos(ry) * 0.04;
    for (const [ww, hh, ax, ay] of [
      [w + 0.12, 0.07, 0, h / 2 + 0.03],
      [w + 0.12, 0.07, 0, -h / 2 - 0.03],
      [0.07, h + 0.06, -w / 2 - 0.03, 0],
      [0.07, h + 0.06, w / 2 + 0.03, 0],
      [0.05, h, 0, 0],
    ]) {
      const g = new THREE.BoxGeometry(ww, hh, 0.05);
      if (ry) g.applyMatrix4(new THREE.Matrix4().makeRotationY(ry));
      // 沿墙面切向偏移
      const tx = Math.cos(ry) * ax;
      const tz = -Math.sin(ry) * ax;
      g.translate(x + ox + tx, 2.15 + ay, z + oz + tz);
      push('dark', g);
    }
  }

  windowAt(2 * TILE + 0.03, wz(8), Math.PI / 2);
  windowAt(2 * TILE + 0.03, wz(20), Math.PI / 2);
  windowAt(36 * TILE - 0.03, wz(8), -Math.PI / 2);
  windowAt(36 * TILE - 0.03, wz(20), -Math.PI / 2);

  // ---------------------------------------------------------------- 血迹 / 积水

  const decalPlane = new THREE.PlaneGeometry(1, 1);
  decalPlane.rotateX(-Math.PI / 2);
  for (let i = 0; i < 10; i++) {
    const room = rooms[Math.floor(rng() * rooms.length)];
    const x = (room.x0 + 0.5 + rng() * (room.x1 - room.x0)) * TILE;
    const z = (room.z0 + 0.5 + rng() * (room.z1 - room.z0)) * TILE;
    const m = new THREE.Mesh(decalPlane, MAT.blood);
    const s = 0.8 + rng() * 1.8;
    m.scale.set(s, s, s);
    m.position.set(x, 0.012, z);
    m.rotation.y = rng() * Math.PI * 2;
    group.add(m);
  }

  const puddleGeo = new THREE.CircleGeometry(1, 16);
  puddleGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 16; i++) {
    const spot = placedCorridor[i % placedCorridor.length];
    const m = new THREE.Mesh(puddleGeo, MAT.puddle);
    const s = 0.4 + rng() * 1.1;
    m.scale.set(s, 1, s * 0.8);
    m.position.set(spot.x + (rng() - 0.5) * 1.4, 0.008, spot.z + (rng() - 0.5) * 1.4);
    group.add(m);
  }

  // ---------------------------------------------------------------- 合并静态几何

  for (const [key, list] of buckets) {
    if (!list.length) continue;
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, MAT[key]);
    mesh.castShadow = key !== 'curtain';
    mesh.receiveShadow = true;
    if (key === 'curtain') mesh.renderOrder = 2;
    group.add(mesh);
  }

  // ---------------------------------------------------------------- 导航

  const walkable = (x, z) => inBounds(x, z) && grid[idx(x, z)] === 1;

  function nearestWalkable(tx, tz, maxR = 10) {
    if (walkable(tx, tz)) return { x: tx, z: tz };
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          if (walkable(tx + dx, tz + dz)) return { x: tx + dx, z: tz + dz };
        }
      }
    }
    return null;
  }

  const tileOf = (x, z) => ({ x: Math.floor(x / TILE), z: Math.floor(z / TILE) });
  const centerOf = (tx, tz) => new THREE.Vector3(wx(tx), 0, wz(tz));

  function findPath(fromX, fromZ, toX, toZ) {
    const s = nearestWalkable(fromX, fromZ);
    const t = nearestWalkable(toX, toZ);
    if (!s || !t) return null;
    if (s.x === t.x && s.z === t.z) return [centerOf(t.x, t.z)];

    const key = (x, z) => z * W + x;
    const startKey = key(s.x, s.z);
    const goalKey = key(t.x, t.z);
    const open = [{ x: s.x, z: s.z, g: 0, f: 0 }];
    const gScore = new Map([[startKey, 0]]);
    const came = new Map();
    const closed = new Uint8Array(W * D);
    const h = (x, z) => Math.abs(x - t.x) + Math.abs(z - t.z);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    let guard = 0;
    while (open.length && guard++ < 8000) {
      let best = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
      const cur = open.splice(best, 1)[0];
      const ck = key(cur.x, cur.z);
      if (closed[ck]) continue;
      closed[ck] = 1;
      if (ck === goalKey) {
        const path = [];
        let nk = goalKey;
        while (nk !== startKey) {
          const z = Math.floor(nk / W);
          const x = nk % W;
          path.push(centerOf(x, z));
          nk = came.get(nk);
          if (nk === undefined) break;
        }
        path.reverse();
        return path;
      }
      for (const [dx, dz] of dirs) {
        const nx = cur.x + dx;
        const nz = cur.z + dz;
        if (!walkable(nx, nz)) continue;
        const nk = key(nx, nz);
        if (closed[nk]) continue;
        const ng = cur.g + 1;
        if (ng < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, ng);
          came.set(nk, ck);
          open.push({ x: nx, z: nz, g: ng, f: ng + h(nx, nz) });
        }
      }
    }
    return null;
  }

  const lineOfSight = (ax, az, bx, bz) => {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(dist / 0.35);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (!walkable(Math.floor(x / TILE), Math.floor(z / TILE))) return false;
    }
    return true;
  };

  function randomWalkableNear(cx, cz, minR, maxR, tries = 40) {
    for (let i = 0; i < tries; i++) {
      const a = rng() * Math.PI * 2;
      const r = minR + rng() * (maxR - minR);
      const tx = Math.floor(cx / TILE + Math.cos(a) * r);
      const tz = Math.floor(cz / TILE + Math.sin(a) * r);
      if (walkable(tx, tz)) return new THREE.Vector3(wx(tx), 0, wz(tz));
    }
    return null;
  }

  // ---------------------------------------------------------------- 更新

  let time = 0;
  function update(dt, opts = {}) {
    time += dt;
    const hunt = !!opts.hunt;
    for (const L of lights) {
      let f = 1;
      if (L.flicker) {
        const s = Math.sin(time * 17 + L.phase) * Math.sin(time * 7.3 + L.phase * 2.7);
        f = s > 0.52 ? 0.12 : 1;
        if (hunt) f = Math.min(f, 0.25 + 0.75 * Math.abs(Math.sin(time * 26 + L.phase)));
      } else if (hunt) {
        f = 0.7 + 0.3 * Math.sin(time * 11 + L.phase);
      }
      L.light.intensity = L.base * f;
      if (L.mesh && L.mesh.material) L.mesh.material.emissiveIntensity = L.baseEmissive * f;
    }
  }

  function dispose() {
    group.traverse((o) => {
      if (o.isMesh) o.geometry?.dispose();
    });
    for (const key of Object.keys(MAT)) {
      const m = MAT[key];
      if (m && m.dispose) m.dispose();
    }
    group.removeFromParent();
  }

  const spawns = [
    centerOf(3, 3),
    centerOf(34, 26),
  ];

  return {
    seed,
    group,
    colliders,
    hideSpots,
    lights,
    rooms,
    doors,
    hub: HUB,
    spawns,
    grid,
    width: W,
    depth: D,
    nav: {
      TILE,
      width: W,
      depth: D,
      walkable,
      tileOf,
      centerOf,
      findPath,
      lineOfSight,
      randomWalkableNear,
      nearestWalkable,
    },
    bounds: { minX: 0, maxX: W * TILE, minZ: 0, maxZ: D * TILE },
    update,
    dispose,
  };
}
