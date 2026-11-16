import * as THREE from 'three';

const STAND_H = 1.62;
const CROUCH_H = 1.08;
const HIDE_H = 1.28;
const WALK_SPEED = 3.35;
const SPRINT_SPEED = 5.85;
const CROUCH_SPEED = 1.5;
const RADIUS = 0.34;

function resolveCollision(pos, radius, colliders) {
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = radius - d;
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
      } else {
        const left = pos.x - c.minX;
        const right = c.maxX - pos.x;
        const up = pos.z - c.minZ;
        const down = c.maxZ - pos.z;
        const m = Math.min(left, right, up, down);
        if (m === left) pos.x = c.minX - radius;
        else if (m === right) pos.x = c.maxX + radius;
        else if (m === up) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      }
    }
  }
}

export class Player {
  constructor(camera, world, audio, input) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.input = input;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.height = STAND_H;
    this.crouching = false;
    this.sprinting = false;
    this.stamina = 100;
    this.bob = 0;
    this.bobAmount = 0;
    this.walkTime = 0;
    this.stepTimer = 0;
    this.noise = 0;
    this.flashlightOn = true;
    this.hiding = null;
    this.nearSpot = null;
    this.hint = '';
    this.moveSpeed = 0;
    this.shake = 0;
    this.dead = false;

    this.setupFlashlight();
  }

  setupFlashlight() {
    const spot = new THREE.SpotLight(0xd8e6ff, 46, 30, 0.46, 0.55, 2);
    spot.position.set(0.16, -0.14, 0.02);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 0.4;
    spot.shadow.camera.far = 32;
    spot.shadow.bias = -0.0016;
    spot.shadow.normalBias = 0.02;
    const target = new THREE.Object3D();
    target.position.set(0.02, -0.04, -6);
    this.camera.add(spot);
    this.camera.add(target);
    spot.target = target;
    this.spot = spot;

    // 手电不额外叠加体积光锥（硬边会破坏画面），仅保留灯光本身
    this.beam = new THREE.Object3D();
    this.camera.add(this.beam);

    // 走廊里补一点极弱的跟随光，避免全黑
    const fill = new THREE.PointLight(0x4b6472, 1.6, 4.5, 2);
    fill.position.set(0, 0.2, 0);
    this.camera.add(fill);
    this.fill = fill;
  }

  dispose() {
    this.camera.remove(this.spot, this.beam, this.spot.target, this.fill);
    this.spot.shadow?.map?.dispose?.();
    this.spot.dispose?.();
    this.fill.dispose?.();
  }

  teleport(x, z, yaw = 0) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.hiding = null;
    this.height = STAND_H;
    this.stamina = 100;
    this.updateCamera(0);
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn;
    this.spot.visible = this.flashlightOn && !this.hiding;
    this.beam.visible = this.flashlightOn && !this.hiding;
    this.audio.uiClick();
  }

  enterHide(spot) {
    if (this.hiding) return;
    this.hideExit = this.position.clone();
    this.hiding = spot;
    const outwardX = Math.sin(spot.yaw);
    const outwardZ = Math.cos(spot.yaw);
    this.position.set(spot.x - outwardX * 0.05, 0, spot.z - outwardZ * 0.05);
    this.yaw = spot.yaw + Math.PI;
    this.height = HIDE_H;
    this.velocity.set(0, 0, 0);
    this.spot.visible = false;
    this.beam.visible = false;
    this.audio.setHidden(true);
  }

  exitHide() {
    if (!this.hiding) return;
    this.hiding = null;
    if (this.hideExit) this.position.copy(this.hideExit);
    this.height = this.crouching ? CROUCH_H : STAND_H;
    this.spot.visible = this.flashlightOn;
    this.beam.visible = this.flashlightOn;
    this.audio.setHidden(false);
  }

  update(dt) {
    const input = this.input;

    // 视角
    const look = input.consumeLook();
    if (this.shake <= 0) {
      this.yaw -= look.dx * 0.0022;
      this.pitch -= look.dy * 0.0022;
      this.pitch = Math.max(-1.42, Math.min(1.42, this.pitch));
    }

    if (input.pressed('KeyF')) this.toggleFlashlight();

    if (this.hiding) {
      if (input.pressed('KeyE')) this.exitHide();
      this.noise = 0.03;
      this.updateCamera(dt);
      return;
    }

    if (input.pressed('KeyC')) {
      this.crouching = !this.crouching;
      this.height = this.crouching ? CROUCH_H : STAND_H;
    }
    if (input.pressed('KeyE') && this.nearSpot && !this.suppressHide) {
      this.enterHide(this.nearSpot);
      this.updateCamera(dt);
      return;
    }

    // 移动
    let ix = 0;
    let iz = 0;
    if (input.down('KeyW') || input.down('ArrowUp')) iz -= 1;
    if (input.down('KeyS') || input.down('ArrowDown')) iz += 1;
    if (input.down('KeyA') || input.down('ArrowLeft')) ix -= 1;
    if (input.down('KeyD') || input.down('ArrowRight')) ix += 1;
    const moving = ix !== 0 || iz !== 0;
    const len = Math.hypot(ix, iz) || 1;
    ix /= len;
    iz /= len;

    const wantsSprint = (input.down('ShiftLeft') || input.down('ShiftRight')) && !this.crouching;
    this.sprinting = wantsSprint && moving && this.stamina > 1;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * 19);
      if (this.stamina <= 0) this.sprinting = false;
    } else {
      this.stamina = Math.min(100, this.stamina + dt * (moving ? 9 : 14));
    }

    const speed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;

    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    const dirX = ix * cos + iz * sin;
    const dirZ = -ix * sin + iz * cos;
    const targetX = dirX * speed;
    const targetZ = dirZ * speed;

    const accel = 1 - Math.exp(-14 * dt);
    this.velocity.x += (targetX - this.velocity.x) * accel;
    this.velocity.z += (targetZ - this.velocity.z) * accel;

    this.position.x += this.velocity.x * dt;
    resolveCollision(this.position, RADIUS, this.world.colliders);
    this.position.z += this.velocity.z * dt;
    resolveCollision(this.position, RADIUS, this.world.colliders);

    const b = this.world.bounds;
    this.position.x = Math.max(b.minX + RADIUS, Math.min(b.maxX - RADIUS, this.position.x));
    this.position.z = Math.max(b.minZ + RADIUS, Math.min(b.maxZ - RADIUS, this.position.z));

    this.moveSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    // 噪声（供鬼听声）
    let noise = 0;
    if (this.moveSpeed > 0.4) {
      noise = this.crouching ? 0.12 : this.sprinting ? 1.0 : 0.4;
    }
    this.noise = noise;

    // 脚步
    if (this.moveSpeed > 0.6) {
      this.walkTime += dt * (this.sprinting ? 9.5 : 6.2);
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = this.sprinting ? 0.31 : 0.47;
        this.audio.footstep(this.sprinting);
      }
    } else {
      this.stepTimer = 0.2;
    }

    // 头部起伏
    const targetBob = this.moveSpeed > 0.4 ? (this.sprinting ? 1 : 0.55) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 6);
    this.bob += dt * (this.sprinting ? 11 : 7.2);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 1.8);

    // 交互检测
    this.nearSpot = null;
    let bestDot = 0.1;
    for (const s of this.world.hideSpots) {
      const dx = s.x - this.position.x;
      const dz = s.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.1) continue;
      const f = this.forward();
      const dot = (dx / (d || 1)) * f.x + (dz / (d || 1)) * f.z;
      if (dot > bestDot || d < 0.9) {
        bestDot = dot;
        this.nearSpot = s;
      }
    }
    this.hint = this.nearSpot ? '按 E 躲进这里' : '';

    this.updateCamera(dt);
  }

  updateCamera(dt) {
    const bobY = Math.sin(this.bob * 2) * 0.022 * this.bobAmount;
    const bobX = Math.cos(this.bob) * 0.014 * this.bobAmount;
    const breathe = Math.sin(performance.now() * 0.0016) * 0.006;
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * 0.05 * this.shake : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * 0.05 * this.shake : 0;

    this.camera.position.set(
      this.position.x + bobX + shakeX,
      this.height + bobY + breathe + shakeY,
      this.position.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    const targetFov = this.sprinting ? 78 : 72;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, (dt || 0.016) * 6);
      this.camera.updateProjectionMatrix();
    }
  }
}
