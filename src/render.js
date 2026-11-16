import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { dotTexture } from './textures.js';

// ------------------------------------------------------------------ 调色 / 颗粒 / 色差

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.032 },
    uCA: { value: 0 },
    uFear: { value: 0 },
    uDamage: { value: 0 },
    uVignette: { value: 0.72 },
    uExposure: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uGrain;
    uniform float uCA;
    uniform float uFear;
    uniform float uDamage;
    uniform float uVignette;
    uniform float uExposure;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // 轻微桶形畸变
      uv = 0.5 + c * (1.0 + 0.022 * r2);

      // 径向色差（恐惧时增强）
      float ca = (0.0009 + uCA * 0.006) * (0.3 + r2 * 2.2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;

      // 冷调去饱和，医院绿灰
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l) * vec3(0.90, 1.0, 0.97), 0.22 + uFear * 0.18);

      // 恐惧：压暗部、偏红
      col = pow(max(col, vec3(0.0)), vec3(1.0 + uFear * 0.22));
      col += vec3(0.035, 0.0, 0.0) * uFear * (0.4 + r2 * 1.6);

      // 受击红闪
      col += vec3(0.11, 0.0, 0.0) * uDamage * (0.35 + r2 * 2.0);

      col *= uExposure;

      // 暗角
      float v = smoothstep(0.98, 0.2, length(c) * 1.28);
      col *= mix(1.0, v, uVignette);

      // 胶片颗粒
      float g = hash(uv * uRes + fract(uTime) * 217.0) - 0.5;
      col += g * uGrain * (0.35 + (1.0 - length(c)) * 0.9);

      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }
  `,
};

// ------------------------------------------------------------------ 尘埃

export function createDust(count = 1400, radius = 16) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * radius * 2;
    positions[i * 3 + 1] = Math.random() * 3.2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * radius * 2;
    speeds[i] = 0.02 + Math.random() * 0.08;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.035,
    map: dotTexture(),
    color: 0xc4d2d8,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  return {
    points,
    update(dt, camera) {
      const p = geo.attributes.position.array;
      const cx = camera.position.x;
      const cz = camera.position.z;
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        p[i3 + 1] += speeds[i] * dt;
        p[i3] += Math.sin(p[i3 + 1] * 0.8 + i) * 0.01 * dt * 5;
        if (p[i3 + 1] > 3.3) p[i3 + 1] = 0.05;
        // 围绕相机环绕并循环
        const dx = p[i3] - cx;
        const dz = p[i3 + 2] - cz;
        if (dx > radius) p[i3] -= radius * 2;
        if (dx < -radius) p[i3] += radius * 2;
        if (dz > radius) p[i3 + 2] -= radius * 2;
        if (dz < -radius) p[i3 + 2] += radius * 2;
      }
      geo.attributes.position.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      points.removeFromParent();
    },
  };
}

// ------------------------------------------------------------------ 渲染器

export class Renderer3D {
  constructor(container) {
    this.container = container;
    const qs = new URLSearchParams(location.search);
    const preserve = qs.has('shot') || qs.has('dev');
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: preserve,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 140);
    this.camera.rotation.order = 'YXZ';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x040607);
    this.scene.fog = new THREE.FogExp2(0x05080a, 0.019);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();

    // 后期
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new UnrealBloomPass(size, 0.34, 0.55, 0.9);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uRes.value.set(size.x, size.y);
    this.composer.addPass(this.grade);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.aoPass = null;
    this.quality = 'mid';
    this.time = 0;
    this.frames = 0;
    this.fpsAccum = 0;
    this.fps = 60;

    window.addEventListener('resize', () => this.resize());
  }

  async enableAO() {
    if (this.aoPass) return;
    try {
      const { SSAOPass } = await import('three/addons/postprocessing/SSAOPass.js');
      const pass = new SSAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
      pass.kernelRadius = 0.55;
      pass.minDistance = 0.002;
      pass.maxDistance = 0.16;
      pass.output = SSAOPass.OUTPUT.Default;
      this.composer.insertPass(pass, 1);
      this.aoPass = pass;
    } catch (err) {
      console.warn('SSAO 不可用，已跳过', err);
    }
  }

  setQuality(q) {
    this.quality = q;
    const ratio = q === 'high' ? 1.5 : q === 'mid' ? 1.25 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio));
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.resize();
    if (q === 'high') this.enableAO();
    if (q !== 'high' && this.aoPass) {
      this.composer.removePass(this.aoPass);
      this.aoPass = null;
    }
    if (q === 'low') {
      this.bloom.strength = 0.26;
      this.renderer.shadowMap.enabled = false;
    } else {
      this.bloom.strength = 0.34;
      this.renderer.shadowMap.enabled = true;
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.grade.uniforms.uRes.value.set(w, h);
    if (this.aoPass) this.aoPass.setSize(w, h);
  }

  setGrade({ fear = 0, damage = 0, ca = 0 } = {}) {
    this.grade.uniforms.uFear.value += (fear - this.grade.uniforms.uFear.value) * 0.08;
    this.grade.uniforms.uDamage.value = damage;
    this.grade.uniforms.uCA.value += (ca - this.grade.uniforms.uCA.value) * 0.08;
  }

  render(dt) {
    this.time += dt;
    this.grade.uniforms.uTime.value = this.time;
    this.composer.render(dt);

    this.frames++;
    this.fpsAccum += dt;
    if (this.fpsAccum > 0.5) {
      this.fps = Math.round(this.frames / this.fpsAccum);
      this.frames = 0;
      this.fpsAccum = 0;
    }
  }
}
