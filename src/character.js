// Characters: a procedural blocky humanoid (fallback) and a GLB/GLTF loader driven by
// assets/characters/manifest.json — drop PINOC-generated characters + motions there.
// NPCs wander the terrain, hop up single blocks, avoid water and glance at the player.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { B } from './blocks.js';
import { patchFogShader } from './materials.js';

const PX = 1.8 / 32;

function pixCanvas(w, h, paint) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); paint(g);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const shade = (c, f) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));

export const PALETTES = [
  { skin: [206, 150, 112], hair: [58, 38, 24], shirt: [38, 150, 160], pants: [52, 58, 140], shoes: [70, 70, 76], eyes: [60, 80, 170] },
  { skin: [236, 196, 160], hair: [196, 142, 60], shirt: [196, 70, 58], pants: [70, 60, 50], shoes: [50, 40, 34], eyes: [60, 110, 60] },
  { skin: [150, 100, 70], hair: [24, 20, 20], shirt: [230, 214, 160], pants: [100, 76, 52], shoes: [60, 46, 36], eyes: [40, 30, 24] },
  { skin: [226, 180, 140], hair: [120, 50, 30], shirt: [92, 120, 60], pants: [44, 44, 48], shoes: [30, 30, 30], eyes: [70, 120, 160] },
];

function makeMat(U, map, color) {
  const m = new THREE.MeshStandardMaterial({ map: map || null, color: color || 0xffffff, roughness: 0.85 });
  if (U) m.onBeforeCompile = (s) => patchFogShader(s, U);
  m.customProgramCacheKey = () => 'char';
  return m;
}

// A pixel-art wooden crate, the size a blocky character carries (≈0.5 m).
let crateTex = null;
export function makeCrateMesh(U, size = 9 * PX) {
  crateTex ??= pixCanvas(8, 8, (c) => {
    c.fillStyle = '#6e4a22'; c.fillRect(0, 0, 8, 8);
    c.fillStyle = '#a4743c'; c.fillRect(1, 1, 6, 6);
    c.fillStyle = '#b8864a'; c.fillRect(2, 2, 4, 4);
    c.fillStyle = '#6e4a22'; c.fillRect(1, 3, 6, 1);
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), makeMat(U, crateTex));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export class BlockyCharacter {
  constructor(pal, U) {
    this.root = new THREE.Group();
    this.phase = Math.random() * 10; this.swing = 0; this.t = Math.random() * 10;
    const P = pal;
    const face = pixCanvas(8, 8, (g) => {
      g.fillStyle = rgb(P.skin); g.fillRect(0, 0, 8, 8);
      g.fillStyle = rgb(P.hair); g.fillRect(0, 0, 8, 2); g.fillRect(0, 2, 1, 1); g.fillRect(7, 2, 1, 1);
      g.fillStyle = '#fff'; g.fillRect(1, 4, 2, 1); g.fillRect(5, 4, 2, 1);
      g.fillStyle = rgb(P.eyes); g.fillRect(2, 4, 1, 1); g.fillRect(5, 4, 1, 1);
      g.fillStyle = rgb(shade(P.skin, 0.8)); g.fillRect(3, 5, 2, 1);
      g.fillStyle = rgb(shade(P.skin, 0.62)); g.fillRect(2, 6, 4, 1);
    });
    const hairSide = pixCanvas(8, 8, (g) => { g.fillStyle = rgb(P.skin); g.fillRect(0, 0, 8, 8); g.fillStyle = rgb(P.hair); g.fillRect(0, 0, 8, 3); g.fillRect(0, 3, 3, 2); });
    const hairTop = pixCanvas(8, 8, (g) => { g.fillStyle = rgb(P.hair); g.fillRect(0, 0, 8, 8); g.fillStyle = rgb(shade(P.hair, 1.2)); g.fillRect(2, 2, 3, 1); g.fillRect(5, 5, 2, 1); });
    const hairBack = pixCanvas(8, 8, (g) => { g.fillStyle = rgb(P.hair); g.fillRect(0, 0, 8, 8); g.fillStyle = rgb(shade(P.hair, 0.8)); g.fillRect(1, 6, 6, 1); });
    const shirtFront = pixCanvas(8, 12, (g) => {
      g.fillStyle = rgb(P.shirt); g.fillRect(0, 0, 8, 12);
      g.fillStyle = rgb(P.skin); g.fillRect(3, 0, 2, 1);
      g.fillStyle = rgb(shade(P.shirt, 0.75)); g.fillRect(0, 10, 8, 2); g.fillRect(4, 1, 1, 9);
    });
    const shirt = pixCanvas(8, 12, (g) => { g.fillStyle = rgb(P.shirt); g.fillRect(0, 0, 8, 12); g.fillStyle = rgb(shade(P.shirt, 0.75)); g.fillRect(0, 10, 8, 2); });
    const arm = pixCanvas(4, 12, (g) => { g.fillStyle = rgb(P.shirt); g.fillRect(0, 0, 4, 12); g.fillStyle = rgb(P.skin); g.fillRect(0, 5, 4, 7); g.fillStyle = rgb(shade(P.skin, 0.85)); g.fillRect(0, 11, 4, 1); });
    const leg = pixCanvas(4, 12, (g) => { g.fillStyle = rgb(P.pants); g.fillRect(0, 0, 4, 12); g.fillStyle = rgb(shade(P.pants, 0.8)); g.fillRect(0, 0, 4, 1); g.fillStyle = rgb(P.shoes); g.fillRect(0, 10, 4, 2); });

    const M = (t) => makeMat(U, t);
    const box = (w, h, d, mats) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * PX, h * PX, d * PX), mats);
      m.castShadow = true; m.receiveShadow = true; return m;
    };
    // BoxGeometry face order: +x, -x, +y, -y, +z (front), -z (back)
    const hs = M(hairSide), ht = M(hairTop);
    this.head = new THREE.Group(); this.head.position.y = 24 * PX;
    const headMesh = box(8, 8, 8, [hs, hs, ht, M(null), M(face), M(hairBack)]);
    headMesh.position.y = 4 * PX; this.head.add(headMesh);
    const sm = M(shirt);
    this.body = box(8, 12, 4, [sm, sm, sm, sm, M(shirtFront), sm]); this.body.position.y = 18 * PX;
    const am = M(arm), lm = M(leg);
    const limb = (x, y, mat) => { const g = new THREE.Group(); g.position.set(x * PX, y * PX, 0); const m = box(4, 12, 4, mat); m.position.y = -6 * PX; g.add(m); return g; };
    this.armL = limb(6, 24, am); this.armR = limb(-6, 24, am);
    this.legL = limb(2, 12, lm); this.legR = limb(-2, 12, lm);
    // named so baked mocap tracks (see loadBlockyMotions) can bind to the parts
    this.rig = new THREE.Group(); this.rig.name = 'rig';
    for (const k of ['head', 'body', 'armL', 'armR', 'legL', 'legR']) { this[k].name = k; this.rig.add(this[k]); }
    this.root.add(this.rig);
    this.look = 0;
  }

  // Drive the parts with baked PINOC clips ({ idle, walk, run, ...extras }) instead of the
  // procedural swing. Extra clips (e.g. wave, mine) are looping activities, see setActivity.
  setMotions(clips) {
    if (!clips) return;
    const { idle, walk, run, ...extras } = clips;
    initLocomotion(this, new THREE.AnimationMixer(this.root), { idle, walk: walk || run, run: run || walk });
    this.extras = {};
    for (const [k, c] of Object.entries(extras)) {
      const a = this.mixer.clipAction(c); a.play(); a.setEffectiveWeight(0);
      this.extras[k] = a;
    }
  }

  // Loop a full-body activity clip over locomotion (null to return to idle/walk/run).
  setActivity(name) { this.once = null; this.activity = name && this.extras?.[name] ? name : null; }

  // Play [from, to] of an activity clip once (backwards with reverse), then loop `after`
  // (an activity name, or null for locomotion) and call onDone.
  playOnce(name, { from = 0, to, reverse = false, after = null, onDone } = {}) {
    const a = this.extras?.[name];
    if (!a) { onDone?.(); return; }
    to ??= a.getClip().duration;
    this.once = { name, from, to, reverse, after, onDone, t: reverse ? to : from };
    this.activity = name;
    a.paused = true; a.time = this.once.t;
  }

  // Blocky tools and props. The two-handed tools continue the arm's line so a swing lands the
  // head in front; the sword points forward-up out of the fist; the bow's stave lies along
  // `up` (a direction in the left arm's own frame — world-up at full draw); the crate is
  // carried against the chest. Returns the prop so it can be shown or hidden.
  hold(kind, U, { up } = {}) {
    this.props ??= {};
    if (this.props[kind]) return this.props[kind];
    const wood = makeMat(U, null, 0x8a5a2b), iron = makeMat(U, null, 0x9aa4ad), dark = makeMat(U, null, 0x4a3320);
    const g = new THREE.Group();
    const add = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w * PX, h * PX, d * PX), mat); m.position.set(x * PX, y * PX, z * PX); m.castShadow = true; g.add(m); return m; };
    let parent = this.armR;
    g.position.set(0, -10.5 * PX, 0);
    if (kind === 'pickaxe') { add(1.4, 14, 1.4, wood, 0, -5, 0); add(1.6, 2, 11, iron, 0, -11.5, 1.5); }
    else if (kind === 'axe') { add(1.4, 14, 1.4, wood, 0, -5, 0); add(1.4, 5, 5, iron, 0, -10, 2.6); }
    else if (kind === 'hoe') { add(1.4, 16, 1.4, wood, 0, -6, 0); add(1.4, 1.6, 5, iron, 0, -13.5, 2.6); }
    else if (kind === 'sword') {
      add(1.2, 1.2, 3, dark, 0, 0, -1); add(5, 1.2, 1.2, dark, 0, 0, 1); add(1.2, 1.2, 15, iron, 0, 0, 9);
      g.rotation.x = -0.7; // tip up
    } else if (kind === 'bow') {
      parent = this.armL;
      add(1.2, 18, 1.2, wood, 0, 0, 0); add(1.2, 3, 1.2, wood, 0, 9, -1); add(1.2, 3, 1.2, wood, 0, -9, -1);
      add(0.4, 22, 0.4, makeMat(U, null, 0xe8e2d0), 0, 0, -2.4);
      if (up) g.quaternion.setFromUnitVectors(_Y, up.clone().normalize());
    } else if (kind === 'box') {
      parent = this.rig;
      g.add(makeCrateMesh(U));
      g.position.set(0, 17 * PX, 7.5 * PX);
    }
    parent.add(g);
    this.props[kind] = g;
    return g;
  }
  holdPickaxe(U) { return this.hold('pickaxe', U); }

  // Clip events ({ name, t }) crossed between p and t; `loop` counts a wrap past the end.
  fireEvents(clip, p, t, loop) {
    if (t === p || !this.onEvent) return;
    for (const e of clip.userData?.events || []) {
      const h = e.t;
      const hit = t > p ? p < h && h <= t : loop ? h > p || h <= t : t <= h && h < p;
      if (hit) this.onEvent(e.name, { reverse: !loop && t < p });
    }
  }

  update(dt, speed, headYaw = 0) {
    if (this.mixer) {
      const once = this.once;
      if (once) { // one-shots are driven by hand so they can run backwards and stop exactly
        const a = this.extras[once.name], prev = once.t;
        once.t = clamp(once.t + (once.reverse ? -dt : dt), once.from, once.to);
        a.time = once.t;
        this.fireEvents(a.getClip(), prev, once.t, false);
        if (once.t === (once.reverse ? once.from : once.to)) {
          this.once = null; a.paused = false;
          this.activity = once.after && this.extras[once.after] ? once.after : null;
          once.onDone?.();
        }
      }
      let busy = 0;
      for (const [k, a] of Object.entries(this.extras)) {
        const cur = a.getEffectiveWeight(), want = k === this.activity ? 1 : 0;
        const w = cur + (want - cur) * Math.min(1, dt * 6);
        a.setEffectiveWeight(w); busy += w;
      }
      const act = this.activity && !this.once && this.extras[this.activity];
      if (act) { // a moving activity (carry walk) keeps its cadence matched to ground speed
        const nat = act.getClip().userData?.speed || 0;
        act.setEffectiveTimeScale(nat > 0.2 && speed > 0.2 ? clamp(speed / nat, 0.6, 1.8) : 1);
      }
      driveLocomotion(this, dt, speed, Math.max(0, 1 - busy));
      if (act && act.getEffectiveWeight() > 0.5) {
        const t = act.time;
        this.fireEvents(act.getClip(), this.lastActT ?? t, t, true);
        this.lastActT = t;
      } else this.lastActT = undefined;
      this.look += (headYaw - this.look) * Math.min(1, dt * 5);
      this.head.quaternion.premultiply(_q.setFromAxisAngle(_Y, this.look));
      if (this.swing > 0) {
        this.swing = Math.max(0, this.swing - dt * 4);
        this.armR.quaternion.premultiply(_q.setFromAxisAngle(_X, -1.6 * Math.sin(this.swing * Math.PI)));
      }
      return;
    }
    this.t += dt;
    this.phase += dt * speed * 2.6;
    const amp = Math.min(1, speed / 4) * 0.9;
    const s = Math.sin(this.phase) * amp;
    this.legL.rotation.x = s; this.legR.rotation.x = -s;
    this.armL.rotation.x = -s * 0.8; this.armR.rotation.x = s * 0.8;
    const idle = Math.sin(this.t * 1.6) * 0.04;
    this.armL.rotation.z = 0.05 + idle; this.armR.rotation.z = -0.05 - idle;
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt * 4);
      this.armR.rotation.x = -1.6 * Math.sin(this.swing * Math.PI);
    }
    this.head.rotation.y += (headYaw - this.head.rotation.y) * Math.min(1, dt * 5);
    this.head.position.y = 24 * PX + Math.abs(Math.sin(this.phase)) * 0.02 * amp;
  }
}

// ---- GLB characters (e.g. exported from PINOC) ----
export async function loadManifest() {
  try {
    const r = await fetch('assets/characters/manifest.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const m = await r.json();
    return m && ((m.characters && m.characters.length) || m.blockyMotions) ? m : null;
  } catch { return null; }
}

// Mocap walk/run clips (PINOC library) travel forward on the hip bone. Strip that drift so
// the clip plays in place, and remember the travel speed (model units/s) for time-scaling.
function stripRootMotion(clip) {
  let speed = 0;
  for (const t of clip.tracks) {
    if (!t.name.endsWith('.position') || t.times.length < 2) continue;
    const v = t.values, n = t.times.length, t0 = t.times[0], T = t.times[n - 1] - t0 || 1;
    const d = [0, 1, 2].map((k) => v[(n - 1) * 3 + k] - v[k]);
    const dist = Math.hypot(d[0], d[1], d[2]);
    if (dist < 0.2) continue;
    for (let i = 0; i < n; i++) {
      const f = (t.times[i] - t0) / T;
      for (let k = 0; k < 3; k++) v[i * 3 + k] -= d[k] * f;
    }
    speed = Math.max(speed, dist / T);
  }
  clip.userData = { ...clip.userData, speed };
  return clip;
}

export async function loadGLTFTemplates(manifest, U) {
  const loader = new GLTFLoader();
  const cache = new Map();
  const load = (file) => {
    if (!cache.has(file)) cache.set(file, loader.loadAsync(`assets/characters/${file}`).then((g) => {
      g.animations.forEach(stripRootMotion);
      return g;
    }));
    return cache.get(file);
  };
  const out = [];
  for (const entry of manifest.characters || []) {
    try {
      const gltf = await load(entry.model);
      const clips = [];
      const named = new Set();
      for (const [role, file] of Object.entries(entry.animations || {})) {
        if (!file) continue;
        const a = await load(file);
        if (file === entry.model) named.add(role);
        a.animations.forEach((c, i) => { const cc = c.clone(); cc.userData = c.userData; cc.name = i === 0 ? role : `${role}_${i}`; clips.push(cc); });
      }
      if (!named.size) clips.unshift(...gltf.animations);
      const scene = SkeletonUtils.clone(gltf.scene);
      const colors = Object.entries(entry.colors || {});
      scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
            m = m.clone();
            const hit = colors.find(([key]) => m.name.includes(key));
            if (hit) m.color.set(hit[1]);
            if (U) m.onBeforeCompile = (s) => patchFogShader(s, U);
            m.customProgramCacheKey = () => 'gltf-char';
            return m;
          });
          o.material = Array.isArray(o.material) ? mats : mats[0];
        }
      });
      // skinned bounds are only right once bone matrices exist; animated bounds drift anyway, so skip culling
      scene.updateMatrixWorld(true);
      scene.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); o.frustumCulled = false; } });
      const bb = new THREE.Box3().setFromObject(scene);
      const h = bb.max.y - bb.min.y || 1;
      const scale = (entry.height || 1.8) / h;
      out.push({ entry, scene, clips, scale, minY: bb.min.y, yawOffset: entry.yawOffset || 0 });
    } catch (e) { console.warn('Character failed to load', entry, e); }
  }
  return out;
}

export class GLTFCharacter {
  constructor(tpl) {
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(tpl.scene);
    this.model.scale.setScalar(tpl.scale);
    this.model.position.y = -tpl.minY * tpl.scale;
    this.model.rotation.y = tpl.yawOffset;
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    const find = (re) => tpl.clips.find((c) => re.test(c.name));
    const idle = find(/idle|stand|breath/i) || tpl.clips[0];
    const walk = find(/walk/i) || find(/run|jog/i) || tpl.clips[0];
    const run = find(/run|jog|sprint/i) || walk;
    initLocomotion(this, this.mixer, { idle, walk, run }, tpl.scale);
    this.swing = 0;
  }
  update(dt, speed) { driveLocomotion(this, dt, speed); }
}

// ---- shared idle/walk/run blending for mixer-driven characters ----
const _q = new THREE.Quaternion(), _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function initLocomotion(self, mixer, clips, scale = 1) {
  self.mixer = mixer; self.actions = {}; self.native = {};
  for (const [k, c] of Object.entries(clips)) {
    if (!c) continue;
    const a = mixer.clipAction(c); a.play(); a.setEffectiveWeight(k === 'idle' ? 1 : 0);
    a.time = Math.random() * c.duration; // desync characters sharing a clip
    self.actions[k] = a;
    self.native[k] = (c.userData?.speed || 0) * scale; // world m/s the clip was captured at
  }
}

// share: how much of the pose locomotion owns (the rest belongs to an activity clip)
function driveLocomotion(self, dt, speed, share = 1) {
  const w = { idle: speed < 0.3 ? 1 : 0, walk: speed >= 0.3 && speed < 5 ? 1 : 0, run: speed >= 5 ? 1 : 0 };
  const loco = self.locoW = (self.locoW ?? { idle: 1, walk: 0, run: 0 });
  for (const [k, a] of Object.entries(self.actions)) {
    loco[k] += (w[k] - loco[k]) * Math.min(1, dt * 6);
    a.setEffectiveWeight(loco[k] * share);
  }
  // match cadence to ground speed (less foot sliding), clamped so it never looks cartoonish
  const { walk, run } = self.actions;
  if (walk) walk.setEffectiveTimeScale(self.native.walk ? clamp(speed / self.native.walk, 0.6, 1.8) : Math.max(0.6, speed / 1.6));
  if (run && run !== walk && self.native.run) run.setEffectiveTimeScale(clamp(speed / self.native.run, 0.8, 2.2));
  self.mixer.update(dt);
}

// ---- PINOC motions on the blocky rig ----
// Bakes a Mixamo-named mocap clip (PINOC library clips as skinned-glb) into rotation tracks for
// the six blocky parts. Minecraft limbs are rigid, so each limb follows shoulder→wrist or
// hip→ankle; the torso follows the spine and shoulder line (damped); the head copies the head
// bone. Hip bob is kept, centred and softened, since rigid legs can't absorb it.
const MOCAP_FPS = 30, BLOCKY_H = 1.8, DOWN = new THREE.Vector3(0, -1, 0);

function bakeBlockyClip(scene, clip, name) {
  const bone = (n) => scene.getObjectByName(`mixamorig${n}`);
  const B = {
    hips: bone('Hips'), neck: bone('Neck'), head: bone('Head'), top: bone('HeadTop_End'),
    lArm: bone('LeftArm'), lHand: bone('LeftHand'), rArm: bone('RightArm'), rHand: bone('RightHand'),
    lLeg: bone('LeftUpLeg'), lFoot: bone('LeftFoot'), rLeg: bone('RightUpLeg'), rFoot: bone('RightFoot'),
  };
  const missing = Object.entries(B).filter(([, b]) => !b).map(([k]) => k);
  if (missing.length) throw new Error(`not a Mixamo skeleton (missing ${missing.join(', ')})`);

  const p = (b) => b.getWorldPosition(new THREE.Vector3());
  scene.updateMatrixWorld(true);
  const headBindInv = B.head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const k = BLOCKY_H / (p(B.top).y || BLOCKY_H);

  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip).play();
  // Some captures face -Z (e.g. Carry Object Walk Forward). Turn every clip so the hips face +Z
  // on the first frame, like the blocky rig.
  action.time = 0; mixer.update(0); scene.updateMatrixWorld(true);
  const hipSide = p(B.lLeg).sub(p(B.rLeg)); hipSide.y = 0;
  const face = new THREE.Vector3().crossVectors(hipSide.normalize(), _Y);
  const facing = new THREE.Quaternion().setFromAxisAngle(_Y, -Math.atan2(face.x, face.z));
  const n = Math.max(2, Math.round(clip.duration * MOCAP_FPS) + 1);
  const times = new Float32Array(n);
  const parts = { head: [], body: [], armL: [], armR: [], legL: [], legR: [] };
  const prev = {};
  const push = (part, q) => { // keep hemispheres consistent so interpolation never takes the long way
    q.premultiply(facing);
    if (prev[part] && prev[part].dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    prev[part] = q; parts[part].push(q.x, q.y, q.z, q.w);
  };
  const limb = (a, b) => new THREE.Quaternion().setFromUnitVectors(DOWN, p(b).sub(p(a)).normalize());
  const basis = new THREE.Matrix4();
  const hipsY = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * clip.duration;
    times[i] = t; action.time = t; mixer.update(0); scene.updateMatrixWorld(true);
    const up = p(B.neck).sub(p(B.hips)).normalize();
    const side = p(B.lArm).sub(p(B.rArm)); side.addScaledVector(up, -side.dot(up)).normalize();
    const fwd = new THREE.Vector3().crossVectors(side, up);
    const torso = new THREE.Quaternion().setFromRotationMatrix(basis.makeBasis(side, up, fwd));
    push('body', new THREE.Quaternion().slerp(torso, 0.7));
    push('head', B.head.getWorldQuaternion(new THREE.Quaternion()).multiply(headBindInv));
    push('armL', limb(B.lArm, B.lHand)); push('armR', limb(B.rArm, B.rHand));
    push('legL', limb(B.lLeg, B.lFoot)); push('legR', limb(B.rLeg, B.rFoot));
    hipsY.push(p(B.hips).y * k);
  }
  mixer.stopAllAction(); mixer.uncacheRoot(scene);

  const mean = hipsY.reduce((a, b) => a + b, 0) / n;
  const tracks = Object.entries(parts).map(([part, v]) => new THREE.QuaternionKeyframeTrack(`${part}.quaternion`, times, v));
  tracks.push(new THREE.VectorKeyframeTrack('rig.position', times, hipsY.flatMap((y) => [0, (y - mean) * 0.6, 0])));
  const out = new THREE.AnimationClip(name, clip.duration, tracks);
  out.userData = { speed: (clip.userData?.speed || 0) * k };
  return out;
}

// Rotation (character space) of a baked part at time t.
export function limbQuat(clip, part, t) {
  const track = clip.tracks.find((k) => k.name === `${part}.quaternion`);
  return new THREE.Quaternion().fromArray(track.createInterpolant().evaluate(t)).normalize();
}
// Direction (character space) a baked limb points at time t, e.g. to aim an archer's bow arm.
export function limbDir(clip, part, t) { return DOWN.clone().applyQuaternion(limbQuat(clip, part, t)); }

// Moments a two-handed swing bottoms out: both arms at their lowest after having been raised
// overhead (e.g. a pickaxe landing). Clips without such a swing return none.
function findStrikes(clip) {
  const tl = clip.tracks.find((t) => t.name === 'armL.quaternion'), tr = clip.tracks.find((t) => t.name === 'armR.quaternion');
  if (!tl || !tr) return [];
  const q = new THREE.Quaternion(), d = new THREE.Vector3();
  const y = (t, i) => d.copy(DOWN).applyQuaternion(q.fromArray(t.values, i * 4)).y;
  const ys = Array.from(tl.times, (_, i) => (y(tl, i) + y(tr, i)) / 2);
  const out = [];
  let raised = false;
  for (let i = 1; i < ys.length - 1; i++) {
    if (ys[i] > 0) raised = true;
    if (raised && ys[i] < -0.6 && ys[i] <= ys[i - 1] && ys[i] < ys[i + 1]) { out.push(tl.times[i]); raised = false; }
  }
  return out;
}

// files: { role: "clip.glb" | { file, loop, strikes, events } } under assets/characters.
// `loop` [fromSec, toSec] trims the clip to a span whose ends match; `strikes` overrides the
// detected swing impacts; `events` adds named moments { name: sec }.
// Times are in the trimmed clip. Every strike becomes an event named "strike".
// Resolves to baked clips or null.
export async function loadBlockyMotions(files) {
  const loader = new GLTFLoader();
  const entries = await Promise.all(Object.entries(files || {}).map(async ([role, spec]) => {
    const { file, loop, strikes, events } = typeof spec === 'string' ? { file: spec } : spec;
    try {
      const gltf = await loader.loadAsync(`assets/characters/${file}`);
      if (!gltf.animations.length) throw new Error('no animation in file');
      let clip = bakeBlockyClip(gltf.scene, stripRootMotion(gltf.animations[0]), role);
      if (loop) {
        const { userData } = clip;
        clip = THREE.AnimationUtils.subclip(clip, role, Math.round(loop[0] * MOCAP_FPS), Math.round(loop[1] * MOCAP_FPS), MOCAP_FPS);
        clip.userData = userData;
      }
      clip.userData.strikes = strikes ?? findStrikes(clip);
      clip.userData.events = [
        ...clip.userData.strikes.map((t) => ({ name: 'strike', t })),
        ...Object.entries(events || {}).map(([name, t]) => ({ name, t })),
      ];
      return [role, clip];
    } catch (e) { console.warn('Motion failed to load', file, e); return null; }
  }));
  const clips = Object.fromEntries(entries.filter(Boolean));
  return Object.keys(clips).length ? clips : null;
}

export class NPC {
  constructor(char, world, x, y, z) {
    this.char = char; this.world = world;
    this.pos = new THREE.Vector3(x, y, z);
    this.yaw = Math.random() * Math.PI * 2;
    this.target = null; this.idle = 1 + Math.random() * 2; this.vy = 0; this.speed = 0; this.timer = 0;
    this.home = new THREE.Vector3(x, y, z);
    this.mode = 'wander'; // 'greet': face the player and wave; 'mine': stay put and mine
    this.greetLeft = 0;
    this.friendly = false; this.greetArmed = true; this.greetCool = 0;
    char.root.position.copy(this.pos);
  }
  // Wave at the player; `seconds` counts down only while the game is being played.
  greet(seconds) { this.mode = 'greet'; this.greetLeft = seconds; this.target = null; this.char.setActivity?.('wave'); }
  // Wander as usual, but stop and wave whenever the player comes into view. After a wave it
  // waits until the player has been away (>14 blocks) and at least 15 s have passed.
  befriend() { this.friendly = true; }
  sees(playerPos) {
    const dx = playerPos.x - this.pos.x, dy = playerPos.y - this.pos.y, dz = playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 9) return false;
    let a = Math.atan2(dx, dz) - this.yaw; a = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(a) > 1.75) return false; // behind it
    const steps = Math.ceil(dist * 3); // eye-to-eye line of sight; grass and flowers don't block
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      if (this.world.isSolid(Math.floor(this.pos.x + dx * f), Math.floor(this.pos.y + 1.6 + dy * f), Math.floor(this.pos.z + dz * f))) return false;
    }
    return true;
  }
  // Stay at a post facing `yaw`. `routine(dt, playerPos, playing)` runs each frame and may set
  // wantYaw (turn toward), speed / pos (walk somewhere) and drive the character's clips.
  station(yaw, routine = null) { this.mode = 'station'; this.yaw = this.wantYaw = yaw; this.routine = routine; this.target = null; this.speed = 0; }
  // Loop one activity clip at a post (mining, chopping, dancing...).
  work(activity, yaw) { this.station(yaw); this.char.setActivity?.(activity); }
  mine(yaw) { this.work('mine', yaw); }
  // Stationary modes: gravity, facing, activity clip; returns false once back to wandering.
  updateStationary(dt, playerPos, playing) {
    if (this.mode === 'greet') {
      if (playing) this.greetLeft -= dt;
      if (this.greetLeft <= 0) { this.mode = 'wander'; this.char.setActivity?.(null); this.idle = 0.8; return false; }
      if (playerPos) this.wantYaw = Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
    } else {
      this.speed = 0;
      this.routine?.(dt, playerPos, playing);
    }
    if (this.wantYaw !== undefined) {
      let dy = this.wantYaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 5);
    }
    const g = this.world.surfaceY(Math.floor(this.pos.x), Math.floor(this.pos.z), Math.floor(this.pos.y) + 2);
    this.vy -= 25 * dt; this.pos.y += this.vy * dt;
    if (this.pos.y <= g) { this.pos.y = g; this.vy = 0; }
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw;
    let headYaw = 0;
    if (this.mode === 'station' && this.lookAtPlayer !== false && playerPos && this.pos.distanceTo(playerPos) < 6) {
      const a = Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z) - this.yaw;
      headYaw = Math.max(-1.1, Math.min(1.1, Math.atan2(Math.sin(a), Math.cos(a))));
    }
    this.char.update(dt, this.speed, headYaw);
    return true;
  }
  // Walk straight toward p at `speed` m/s (stations use this to fetch and carry); true on arrival.
  stepToward(p, speed, dt) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.15) return true;
    this.wantYaw = Math.atan2(dx, dz);
    const s = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s; this.speed = speed;
    return false;
  }
  pickTarget() {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 10;
      let tx = this.pos.x + Math.cos(a) * d, tz = this.pos.z + Math.sin(a) * d;
      if (Math.hypot(tx - this.home.x, tz - this.home.z) > 24) { tx = this.home.x + (Math.random() - 0.5) * 10; tz = this.home.z + (Math.random() - 0.5) * 10; }
      const y = this.world.surfaceY(Math.floor(tx), Math.floor(tz), Math.floor(this.pos.y) + 6);
      if (this.world.getBlock(Math.floor(tx), y, Math.floor(tz)) === B.WATER || this.world.getBlock(Math.floor(tx), y - 1, Math.floor(tz)) === B.WATER) continue;
      if (Math.abs(y - this.pos.y) > 5) continue;
      this.target = new THREE.Vector3(tx, y, tz); this.timer = 0; return;
    }
    this.idle = 2;
  }
  update(dt, playerPos, playing = true) {
    if (this.friendly && playerPos && this.mode === 'wander') {
      this.greetCool -= dt;
      if (this.pos.distanceTo(playerPos) > 14) this.greetArmed = true;
      if (this.greetArmed && this.greetCool <= 0 && this.sees(playerPos)) {
        this.greetArmed = false; this.greetCool = 15;
        this.greet(3.4); // two waves
      }
    }
    if (this.mode !== 'wander' && this.updateStationary(dt, playerPos, playing)) return;
    const w = this.world;
    let moveSpeed = 0;
    if (this.idle > 0) { this.idle -= dt; if (this.idle <= 0) this.pickTarget(); }
    else if (this.target) {
      this.timer += dt;
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z, dist = Math.hypot(dx, dz);
      if (dist < 0.4 || this.timer > 12) { this.target = null; this.idle = Math.random() < 0.5 ? 1.5 + Math.random() * 3 : 0.2; }
      else {
        const want = Math.atan2(dx, dz);
        let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * Math.min(1, dt * 6);
        const sp = 1.6;
        const nx = this.pos.x + Math.sin(this.yaw) * sp * dt, nz = this.pos.z + Math.cos(this.yaw) * sp * dt;
        const ground = w.surfaceY(Math.floor(nx), Math.floor(nz), Math.floor(this.pos.y) + 2);
        const wet = w.getBlock(Math.floor(nx), ground, Math.floor(nz)) === B.WATER || w.getBlock(Math.floor(nx), ground - 1, Math.floor(nz)) === B.WATER;
        if (ground - this.pos.y > 1.05 || wet || w.isSolid(Math.floor(nx), Math.floor(this.pos.y) + 1, Math.floor(nz))) { this.target = null; this.idle = 0.5; }
        else {
          this.pos.x = nx; this.pos.z = nz; moveSpeed = sp;
          if (ground > this.pos.y + 0.01) { this.vy = 5.5; }
        }
      }
    } else this.pickTarget();

    const g = w.surfaceY(Math.floor(this.pos.x), Math.floor(this.pos.z), Math.floor(this.pos.y) + 1);
    this.vy -= 25 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= g) { this.pos.y = g; this.vy = 0; }
    this.speed += (moveSpeed - this.speed) * Math.min(1, dt * 8);

    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw;
    let headYaw = 0;
    if (playerPos && this.pos.distanceTo(playerPos) < 7) {
      const a = Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z) - this.yaw;
      headYaw = Math.max(-1.1, Math.min(1.1, Math.atan2(Math.sin(a), Math.cos(a))));
    }
    this.char.update(dt, this.speed, headYaw);
  }
}
