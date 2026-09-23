// Physically based sky: single-scattering atmosphere (Rayleigh + Mie) baked into an
// equirectangular LUT every few frames, used for the sky dome, aerial fog and IBL.
// The dome adds sun/moon discs, twinkling stars and lit fbm clouds. Drives the sun/moon light.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SKY_GLSL } from './materials.js';

const ATMOS_GLSL = /* glsl */`
#define PI 3.14159265
#define I_STEPS 32
#define J_STEPS 8
vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float a = dot(rd, rd), b = 2.0 * dot(rd, r0), c = dot(r0, r0) - sr * sr;
  float d = b * b - 4.0 * a * c;
  if (d < 0.0) return vec2(1e5, -1e5);
  return vec2((-b - sqrt(d)) / (2.0 * a), (-b + sqrt(d)) / (2.0 * a));
}
vec3 atmosphere(vec3 r, vec3 r0, vec3 pSun, float iSun) {
  const float rPlanet = 6371e3, rAtmos = 6471e3;
  const vec3 kRlh = vec3(5.5e-6, 13.0e-6, 22.4e-6);
  const float kMie = 21e-6, shRlh = 8e3, shMie = 1.2e3, g = 0.758;
  pSun = normalize(pSun); r = normalize(r);
  vec2 p = rsi(r0, r, rAtmos);
  if (p.x > p.y) return vec3(0.0);
  vec2 pg = rsi(r0, r, rPlanet);
  if (pg.x > 0.0 && pg.x < pg.y) p.y = min(p.y, pg.x); // only ground in front of the viewer
  float L = max(p.y - max(p.x, 0.0), 0.0);
  vec3 totalRlh = vec3(0.0), totalMie = vec3(0.0);
  float iOdRlh = 0.0, iOdMie = 0.0;
  float mu = dot(r, pSun), mumu = mu * mu, gg = g * g;
  float pRlh = 3.0 / (16.0 * PI) * (1.0 + mumu);
  float pMie = 3.0 / (8.0 * PI) * ((1.0 - gg) * (mumu + 1.0)) / (pow(1.0 + gg - 2.0 * mu * g, 1.5) * (2.0 + gg));
  for (int i = 0; i < I_STEPS; i++) {
    // quadratic spacing: dense samples near the viewer where the air is thickest
    float a0 = float(i) / float(I_STEPS), a1 = float(i + 1) / float(I_STEPS);
    float t0 = L * a0 * a0, t1 = L * a1 * a1, iStep = t1 - t0;
    vec3 iPos = r0 + r * (t0 + iStep * 0.5);
    float iH = length(iPos) - rPlanet;
    float odR = exp(-iH / shRlh) * iStep, odM = exp(-iH / shMie) * iStep;
    vec2 ps = rsi(iPos, pSun, rPlanet);
    if (ps.x > 0.0 && ps.x < ps.y) { iOdRlh += odR; iOdMie += odM; continue; } // in planet shadow
    float jStep = rsi(iPos, pSun, rAtmos).y / float(J_STEPS);
    float jTime = 0.0, jOdRlh = 0.0, jOdMie = 0.0;
    for (int j = 0; j < J_STEPS; j++) {
      vec3 jPos = iPos + pSun * (jTime + jStep * 0.5);
      float jH = length(jPos) - rPlanet;
      jOdRlh += exp(-jH / shRlh) * jStep; jOdMie += exp(-jH / shMie) * jStep;
      jTime += jStep;
    }
    // optical depth to the sample midpoint (half of this step's own depth)
    vec3 attn = exp(-(kMie * (iOdMie + 0.5 * odM + jOdMie) + kRlh * (iOdRlh + 0.5 * odR + jOdRlh)));
    totalRlh += odR * attn; totalMie += odM * attn;
    iOdRlh += odR; iOdMie += odM;
  }
  return iSun * (pRlh * kRlh * totalRlh + 0.4 * pMie * kMie * totalMie);
}
`;

const NOISE_GLSL = /* glsl */`
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
`;

export class SkySystem {
  constructor(renderer, scene, U) {
    this.renderer = renderer;
    this.scene = scene;
    this.U = U;
    this.hour = 7.4;
    this.speed = 1 / 45; // game hours per real second
    this.tilt = 0.46;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.sunColor = new THREE.Color();
    this.lightDir = new THREE.Vector3();
    this.lastLut = -1e9; this.lastEnv = -1e9; this.clock = 0;
    this.daylight = 1;

    this.lutRT = new THREE.WebGLRenderTarget(256, 128, {
      type: THREE.HalfFloatType, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping,
    });
    U.uSkyTex.value = this.lutRT.texture;
    this.lutMat = new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir }, uScale: { value: 0.3 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir, uMoonDir; uniform float uScale; varying vec2 vUv;
        ${ATMOS_GLSL}
        void main() {
          float phi = (vUv.x - 0.5) * 6.2831853, th = (vUv.y - 0.5) * 3.14159265;
          vec3 d = vec3(cos(th) * cos(phi), sin(th), cos(th) * sin(phi));
          d = normalize(vec3(d.x, max(d.y, 0.0) + 0.0015, d.z));
          vec3 r0 = vec3(0.0, 6371e3 + 200.0, 0.0);
          vec3 s = atmosphere(d, r0, uSunDir, 22.0);
          vec3 m = atmosphere(d, r0, uMoonDir, 22.0 * 0.02) * vec3(0.75, 0.9, 1.35);
          vec3 night = vec3(0.0022, 0.0034, 0.0072) * (0.6 + 0.4 * d.y);
          gl_FragColor = vec4((s + m) * uScale + night, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.lutQuad = new FullScreenQuad(this.lutMat);

    this.starRot = new THREE.Matrix3();
    this.domeU = {
      uSkyTex: U.uSkyTex, uTime: U.uTime, uUnderwater: U.uUnderwater, uWaterFog: U.uWaterFog,
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir },
      uSunColor: { value: this.sunColor }, uSunI: { value: 1 }, uMoonI: { value: 0 }, uNight: { value: 0 },
      uStarRot: { value: this.starRot }, uCloudCover: { value: 0.53 }, uWind: { value: new THREE.Vector2() },
    };
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), new THREE.ShaderMaterial({
      uniforms: this.domeU,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          gl_Position.z = gl_Position.w;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uSkyTex; uniform float uTime, uUnderwater, uSunI, uMoonI, uNight, uCloudCover;
        uniform vec3 uWaterFog, uSunDir, uMoonDir, uSunColor; uniform mat3 uStarRot; uniform vec2 uWind;
        varying vec3 vWorld;
        ${SKY_GLSL}
        ${NOISE_GLSL}
        float cloudDen(vec2 p) {
          float n = fbm(p);
          return smoothstep(uCloudCover, uCloudCover + 0.28, n);
        }
        void main() {
          vec3 d = normalize(vWorld - cameraPosition);
          if (uUnderwater > 0.5) { gl_FragColor = vec4(uWaterFog * (0.6 + 0.6 * max(d.y, 0.0)), 1.0); return; }
          vec3 col = texture2D(uSkyTex, dirToSkyUv(d)).rgb;
          float above = smoothstep(-0.02, 0.03, d.y);

          // stars
          vec3 sd = uStarRot * d;
          vec3 g = sd * 170.0, cell = floor(g), f = fract(g) - 0.5;
          float h = h31(cell);
          if (h > 0.9965) {
            float b = (h - 0.9965) / 0.0035;
            float tw = 0.65 + 0.35 * sin(uTime * (2.0 + h * 5.0) + h * 91.0);
            col += vec3(0.85, 0.9, 1.0) * smoothstep(0.32, 0.0, length(f)) * b * b * 1.6 * tw * uNight * above;
          }
          // moon
          float cm = dot(d, uMoonDir);
          if (cm > 0.9997) {
            vec3 tg = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
            vec3 bt = cross(tg, uMoonDir);
            vec2 mp = vec2(dot(d, tg), dot(d, bt)) * 2500.0;
            float crater = 0.72 + 0.28 * vnoise(mp * 0.8) - 0.12 * smoothstep(0.55, 0.7, vnoise(mp * 0.35 + 3.0));
            col += vec3(0.85, 0.88, 0.95) * 1.8 * crater * smoothstep(0.9997, 0.99975, cm) * above * (0.35 + 0.65 * uNight);
          }
          col += vec3(0.5, 0.6, 0.9) * pow(max(cm, 0.0), 600.0) * 0.08 * uNight;
          // sun disc
          float cs = dot(d, uSunDir);
          col += uSunColor * 42.0 * smoothstep(0.99988, 0.99992, cs) * above;

          // clouds
          if (d.y > 0.0) {
            float t = (650.0 - cameraPosition.y) / d.y;
            vec2 p = (cameraPosition.xz + d.xz * t) * 0.0011 + uWind;
            float den = cloudDen(p);
            if (den > 0.002) {
              vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.045;
              float ds = cloudDen(p + toSun) * 0.6 + cloudDen(p + toSun * 2.0) * 0.4;
              float lit = exp(-ds * 2.4);
              vec3 amb = texture2D(uSkyTex, vec2(0.5, 0.97)).rgb * 1.5 + texture2D(uSkyTex, dirToSkyUv(normalize(vec3(d.x, 0.05, d.z)))).rgb * 0.4;
              float phase = 1.0 + 2.2 * pow(max(cs, 0.0), 12.0);
              vec3 sunC = uSunColor * uSunI * 0.34 * phase;
              vec3 moonC = vec3(0.55, 0.65, 0.95) * uMoonI * 0.5;
              vec3 cc = amb * (0.7 + 0.3 * lit) + (sunC + moonC) * lit;
              float fade = smoothstep(0.0, 0.14, d.y) * exp(-t * 0.00012);
              col = mix(col, cc, den * fade);
            }
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    this.dome = dome;
    scene.add(dome);

    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.045;
    this.shadowExtent = 64;
    const sc = light.shadow.camera;
    sc.left = -this.shadowExtent; sc.right = this.shadowExtent; sc.top = this.shadowExtent; sc.bottom = -this.shadowExtent;
    sc.near = 1; sc.far = 500;
    scene.add(light, light.target);
    this.light = light;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this._tmp = new THREE.Vector3();
    this._ax = new THREE.Vector3(); this._ay = new THREE.Vector3();
    this.computeSun();
  }

  setShadowSize(size) {
    if (!size) { this.light.castShadow = false; return; }
    this.light.castShadow = true;
    if (this.light.shadow.mapSize.x !== size) {
      this.light.shadow.mapSize.set(size, size);
      if (this.light.shadow.map) { this.light.shadow.map.dispose(); this.light.shadow.map = null; }
    }
  }

  computeSun() {
    const th = ((this.hour - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(th), Math.sin(th) * Math.cos(this.tilt), Math.sin(th) * Math.sin(this.tilt)).normalize();
    this.moonDir.copy(this.sunDir).negate();
    // Sun colour = atmospheric transmittance along the air mass (Kasten–Young).
    const el = Math.max(-2, (Math.asin(this.sunDir.y) * 180) / Math.PI);
    const m = 1 / (Math.sin((el * Math.PI) / 180) + 0.50572 * Math.pow(el + 6.07995, -1.6364));
    this.sunColor.setRGB(Math.exp(-m * 0.032), Math.exp(-m * 0.08), Math.exp(-m * 0.19));
    const axis = this._tmp.set(0, -Math.sin(this.tilt), Math.cos(this.tilt));
    this.starRot.setFromMatrix4(new THREE.Matrix4().makeRotationAxis(axis, -th));
  }

  update(dt, playerPos) {
    this.clock += dt;
    if (!this.paused) this.hour = (this.hour + dt * this.speed + 24) % 24;
    this.computeSun();
    const sy = this.sunDir.y;
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const sunI = 3.4 * ss(-0.035, 0.08, sy);
    const moonI = 0.5 * ss(-0.02, 0.12, -sy) * (1 - ss(-0.08, 0.02, sy));
    this.daylight = ss(-0.12, 0.2, sy);
    const night = ss(0.06, -0.16, sy);
    const du = this.domeU;
    du.uSunI.value = sunI; du.uMoonI.value = moonI; du.uNight.value = night;
    du.uWind.value.set(this.clock * 0.0045, this.clock * 0.0017);

    const useSun = sunI > moonI * 2;
    this.lightDir.copy(useSun ? this.sunDir : this.moonDir);
    if (useSun) this.light.color.copy(this.sunColor); else this.light.color.setRGB(0.66, 0.76, 1.0);
    this.light.intensity = useSun ? sunI : moonI;
    this.U.uSunVis.value = sunI / 3.4 + moonI * 0.4;
    this.U.uLightDir.value.copy(this.lightDir);
    this.U.uLightCol.value.copy(this.light.color).multiplyScalar(this.light.intensity);

    // Texel-snapped shadow frustum following the player (kills shimmer while walking).
    const z = this.lightDir, x = this._ax.set(0, 1, 0).cross(z).normalize(), y = this._ay.copy(z).cross(x);
    const texel = (this.shadowExtent * 2) / this.light.shadow.mapSize.x;
    const lx = Math.floor(playerPos.dot(x) / texel) * texel, ly = Math.floor(playerPos.dot(y) / texel) * texel, lz = playerPos.dot(z);
    this.light.target.position.set(0, 0, 0).addScaledVector(x, lx).addScaledVector(y, ly).addScaledVector(z, lz);
    this.light.position.copy(this.light.target.position).addScaledVector(z, 250);
    this.light.target.updateMatrixWorld();

    this.dome.position.copy(playerPos);

    if (this.clock - this.lastLut > 0.12) {
      this.lastLut = this.clock;
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.lutRT);
      this.lutQuad.render(this.renderer);
      this.renderer.setRenderTarget(prev);
    }
    if (this.clock - this.lastEnv > 1.5 || this.envRT === null) {
      this.lastEnv = this.clock;
      const old = this.envRT;
      this.envRT = this.pmrem.fromEquirectangular(this.lutRT.texture);
      this.scene.environment = this.envRT.texture;
      if (old) old.dispose();
    }
    this.scene.environmentIntensity = 0.9 + 1.1 * night;
  }

  timeString() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
