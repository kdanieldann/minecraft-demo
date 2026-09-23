import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { buildAtlas, makeWaterNormals } from './textures.js';
import { B, HOTBAR, INVENTORY, BLOCKS, KIND, K, SOLID, ITEM, DIRS4, TEX_SIDE, isTorch } from './blocks.js';
import { World, SEA, CS, buildItemGeometry, torchTip } from './world.js';
import { renderIcons } from './icons.js';
import { createSharedUniforms, makeBlockMaterials, SKY_GLSL } from './materials.js';
import { SkySystem } from './sky.js';
import { PostFX } from './post.js';
import { Player } from './player.js';
import { BlockyCharacter, GLTFCharacter, NPC, PALETTES, loadManifest, loadGLTFTemplates, loadBlockyMotions } from './character.js';

const $ = (id) => document.getElementById(id);
const settings = { renderDistance: 9, shadows: 2048, reflections: true, godrays: true, bloom: true, pixelRatio: Math.min(window.devicePixelRatio, 1.5) };

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(settings.pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbfd1e5, 0.01);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 3000);
const U = createSharedUniforms();
U.uSea.value = SEA + 0.9;

const atlas = buildAtlas(renderer.capabilities.getMaxAnisotropy());
const materials = makeBlockMaterials(atlas, U);
const worldGroup = new THREE.Group();
scene.add(worldGroup);
const seed = Number(new URLSearchParams(location.search).get('seed')) || 1337;
const world = new World(seed, worldGroup, materials);
const sky = new SkySystem(renderer, scene, U);

// ---------- water ----------
const water = new Water(new THREE.PlaneGeometry(6000, 6000), {
  textureWidth: 1024, textureHeight: 1024, waterNormals: makeWaterNormals(), sunDirection: new THREE.Vector3(),
  sunColor: 0xffffff, waterColor: 0x0b3c46, distortionScale: 1.1, fog: true, alpha: 0.72,
});
water.rotation.x = -Math.PI / 2;
water.position.y = SEA + 0.9;
water.material.transparent = true;
water.receiveShadow = true;
water.material.uniforms.size.value = 1.25;
Object.assign(water.material.uniforms, { uSkyTex: U.uSkyTex, uAerial: U.uAerial, uFogStart: U.uFogStart, uFogEnd: U.uFogEnd });
water.material.fragmentShader = 'uniform sampler2D uSkyTex;\nuniform float uAerial;\nuniform float uFogStart;\nuniform float uFogEnd;\n' + SKY_GLSL + water.material.fragmentShader
  .replace('float rf0 = 0.3;', 'float rf0 = 0.035;')
  .replace('vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight', 'reflectionSample * 0.95 + specularLight')
  .replace('gl_FragColor = vec4( outgoingLight, alpha );', 'gl_FragColor = vec4( outgoingLight, mix( alpha, 1.0, reflectance ) );')
  .replace('#include <fog_fragment>', /* glsl */`
    #ifdef USE_FOG
      vec3 vd = normalize(worldPosition.xyz - cameraPosition);
      vec3 fogC = texture2D(uSkyTex, dirToSkyUv(normalize(vec3(vd.x, max(vd.y, 0.0) + 0.002, vd.z)))).rgb;
      float dist = length(worldPosition.xyz - cameraPosition);
      float ft = clamp((dist - uFogStart) / (uFogEnd - uFogStart), 0.0, 1.0);
      float f1 = 1.0 - exp(-ft * ft * 4.6);
      float f2 = (1.0 - exp(-dist * uAerial)) * 0.5;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, max(f1, f2));
    #endif`);
water.material.needsUpdate = true;
scene.add(water);
const waterReflect = water.onBeforeRender;
const mirrorTex = water.material.uniforms.mirrorSampler.value;
const flatSkyTex = new THREE.DataTexture(new Uint8Array([140, 170, 200, 255]), 1, 1);
flatSkyTex.needsUpdate = true;

// ---------- glowstone point lights (pooled so the shader never recompiles) ----------
const glowLights = [];
for (let i = 0; i < 6; i++) {
  const l = new THREE.PointLight(0xffc27a, 0, 12, 1.7);
  scene.add(l); glowLights.push(l);
}
const heldLight = new THREE.PointLight(0xff9a48, 0, 13, 1.6);
scene.add(heldLight);

// ---------- first-person hand (rendered as an overlay pass) ----------
const handScene = new THREE.Scene();
const handCam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 10);
const handHemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a3b2a, 0.9);
handScene.add(handHemi);
const handLight = new THREE.DirectionalLight(0xffffff, 2);
handLight.position.set(0.4, 1, 0.6);
handScene.add(handLight);
handScene.environment = null;
const hand = new THREE.Group();
handScene.add(hand);
const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.72), new THREE.MeshStandardMaterial({ color: 0xce966f, roughness: 0.8 }));
const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.215, 0.215, 0.28), new THREE.MeshStandardMaterial({ color: 0x2696a0, roughness: 0.9 }));
armMesh.position.set(0.0, 0, 0.1); sleeve.position.set(0, 0, 0.34);
const armGroup = new THREE.Group(); armGroup.add(armMesh, sleeve);
armGroup.position.set(0.56, -0.52, -0.62); armGroup.rotation.set(0.45, 0.25, 0.1);
const heldMat = new THREE.MeshStandardMaterial({ map: atlas.albedo, normalMap: atlas.normal, roughnessMap: atlas.rough, emissiveMap: atlas.emissive, emissive: 0xffffff, emissiveIntensity: 1.5, alphaTest: 0.5, side: THREE.DoubleSide });
const held = new THREE.Mesh(new THREE.BufferGeometry(), heldMat);
held.position.set(0.46, -0.36, -0.78);
hand.add(armGroup, held);
const heldGeos = new Map();
function setHeldBlock(b) {
  if (!heldGeos.has(b)) heldGeos.set(b, buildItemGeometry(b));
  held.geometry = heldGeos.get(b);
  const k = KIND[b];
  held.scale.setScalar(k === K.TORCH ? 0.6 : k === K.PLANT ? 0.32 : 0.2);
  if (k === K.TORCH) { held.position.set(0.42, -0.3, -0.7); held.rotation.set(0.25, 0.3, -0.15); }
  else { held.position.set(0.46, -0.36, -0.78); held.rotation.set(0.12, k === K.PLANT ? 0.3 : 0.75, 0); }
}

const post = new PostFX(renderer, scene, camera, handScene, handCam);

// ---------- player, avatar, NPCs ----------
const player = new Player(camera, world, renderer.domElement);
let avatar = new BlockyCharacter(PALETTES[0], U);
scene.add(avatar.root);
const npcs = [];
let gltfTemplates = [];

// ---------- block-break particles ----------
const PMAX = 400;
const pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), new THREE.MeshStandardMaterial({ roughness: 0.9 }), PMAX);
pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
pMesh.count = 0; pMesh.frustumCulled = false; pMesh.castShadow = false;
scene.add(pMesh);
const parts = [];
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();
function burst(x, y, z, b, n = 26) {
  const tile = TEX_SIDE[b];
  for (let i = 0; i < n && parts.length < PMAX; i++) {
    const col = atlas.randomPixel(tile);
    parts.push({
      p: new THREE.Vector3(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6),
      v: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3.5 + 0.5, (Math.random() - 0.5) * 3),
      life: 0.6 + Math.random() * 0.5, s: 0.6 + Math.random() * 0.8,
      c: new THREE.Color().setRGB(col[0], col[1], col[2], THREE.SRGBColorSpace),
    });
  }
}
function updateParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.life -= dt;
    q.v.y -= 16 * dt;
    q.p.addScaledVector(q.v, dt);
    if (SOLID[world.getBlock(Math.floor(q.p.x), Math.floor(q.p.y), Math.floor(q.p.z))]) { q.p.y = Math.floor(q.p.y) + 1.03; q.v.set(q.v.x * 0.3, 0, q.v.z * 0.3); }
    if (q.life <= 0) parts.splice(i, 1);
  }
  pMesh.count = parts.length;
  parts.forEach((q, i) => {
    _s.setScalar(q.s * Math.min(1, q.life * 3));
    _m4.compose(q.p, _q, _s);
    pMesh.setMatrixAt(i, _m4);
    pMesh.setColorAt(i, q.c);
  });
  pMesh.instanceMatrix.needsUpdate = true;
  if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
}

// ---------- torch sparks & smoke ----------
const SMAX = 240;
const sMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 0.045, 0.045), new THREE.MeshBasicMaterial({ color: 0xffffff }), SMAX);
sMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
sMesh.count = 0; sMesh.frustumCulled = false;
scene.add(sMesh);
const sparks = [];
const SPARK_C = new THREE.Color(5.0, 2.0, 0.5), SMOKE_C = new THREE.Color(0.32, 0.32, 0.34);
function spark(t, smoke) {
  if (sparks.length >= SMAX) return;
  sparks.push({
    p: new THREE.Vector3(t[0] + (Math.random() - 0.5) * 0.06, t[1] + 0.02, t[2] + (Math.random() - 0.5) * 0.06),
    v: new THREE.Vector3((Math.random() - 0.5) * 0.25, smoke ? 0.45 + Math.random() * 0.3 : 0.7 + Math.random() * 0.8, (Math.random() - 0.5) * 0.25),
    life: smoke ? 1.2 + Math.random() * 0.8 : 0.35 + Math.random() * 0.4, max: 0, smoke,
  });
  sparks[sparks.length - 1].max = sparks[sparks.length - 1].life;
}
function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const q = sparks[i];
    q.life -= dt;
    q.p.addScaledVector(q.v, dt);
    q.v.x += Math.sin(time * 3 + i) * dt * 0.3;
    if (q.life <= 0) sparks.splice(i, 1);
  }
  sMesh.count = sparks.length;
  sparks.forEach((q, i) => {
    const a = q.life / q.max;
    _s.setScalar(q.smoke ? (0.5 + (1 - a) * 0.9) * Math.min(1, a * 3) : 0.6 + a * 0.6);
    _m4.compose(q.p, _q, _s);
    sMesh.setMatrixAt(i, _m4);
    sMesh.setColorAt(i, q.smoke ? _c.copy(SMOKE_C).multiplyScalar(a) : _c.copy(SPARK_C).multiplyScalar(a));
  });
  sMesh.instanceMatrix.needsUpdate = true;
  if (sMesh.instanceColor) sMesh.instanceColor.needsUpdate = true;
}

// ---------- selection outline ----------
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
);
outline.visible = false;
scene.add(outline);

// ---------- HUD ----------
let slot = 0;
const iconCanvases = renderIcons(atlas, INVENTORY);
const ICON = new Map([...iconCanvases].map(([id, c]) => [id, c.toDataURL()]));
const iconImg = (id) => { const im = new Image(); im.src = ICON.get(ITEM[id]) || ''; im.draggable = false; im.alt = BLOCKS[id].name; return im; };
const hotbarEl = $('hotbar');
function buildHotbar(el, withNumbers = true) {
  el.innerHTML = '';
  HOTBAR.forEach((b, i) => {
    const d = document.createElement('div');
    d.className = 'slot' + (i === slot ? ' sel' : '');
    d.appendChild(iconImg(b));
    if (withNumbers) { const n = document.createElement('span'); n.textContent = i + 1; d.appendChild(n); }
    d.title = BLOCKS[b].name;
    d.dataset.slot = i;
    el.appendChild(d);
  });
}
buildHotbar(hotbarEl);
let nameTimer = 0;
function selectSlot(i) {
  slot = (i + HOTBAR.length) % HOTBAR.length;
  [...hotbarEl.children].forEach((c, j) => c.classList.toggle('sel', j === slot));
  setHeldBlock(HOTBAR[slot]);
  $('blockname').textContent = BLOCKS[HOTBAR[slot]].name;
  $('blockname').style.opacity = 1; nameTimer = 1.6;
  swingT = 0.001;
  if (invOpen) buildHotbar($('invhotbar'));
}
let swingT = 0;
const digitOf = (e) => { const m = /^Digit([1-9])$/.exec(e.code) || /^([1-9])$/.exec(e.key); return m ? Number(m[1]) : 0; };
window.addEventListener('wheel', (e) => { if (player.locked) selectSlot(slot + Math.sign(e.deltaY)); }, { passive: true });
window.addEventListener('keydown', (e) => {
  const n = digitOf(e); if (n) selectSlot(n - 1);
  if (e.code === 'F3') { e.preventDefault(); $('debug').hidden = !$('debug').hidden; }
  if (!player.locked) return;
  if (e.code === 'KeyT') { sky.speed = sky.speed > 0.1 ? 1 / 45 : 0.6; toast(sky.speed > 0.1 ? 'Time: fast-forward ⏩' : 'Time: normal speed'); }
  if (e.code === 'BracketRight') { sky.hour = (sky.hour + 1) % 24; }
  if (e.code === 'BracketLeft') { sky.hour = (sky.hour + 23) % 24; }
  if (e.code === 'KeyP') { sky.paused = !sky.paused; toast(sky.paused ? 'Time paused' : 'Time resumed'); }
});
function toast(t) { const el = $('toast'); el.textContent = t; el.style.opacity = 1; clearTimeout(toast.t); toast.t = setTimeout(() => (el.style.opacity = 0), 1400); }

// ---------- interaction ----------
let breakCd = 0, placeCd = 0, mouseL = false, mouseR = false;
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!player.locked) return;
  if (e.button === 0) { mouseL = true; breakCd = 0; }
  if (e.button === 2) { mouseR = true; placeCd = 0; }
  if (e.button === 1) {
    const hit = world.raycast(player.eye(), player.lookDir(), 6);
    if (hit) { const it = ITEM[hit.block]; const i = HOTBAR.indexOf(it); if (i >= 0) selectSlot(i); else { HOTBAR[slot] = it; rebuildHotbarIcon(slot); selectSlot(slot); } }
    e.preventDefault();
  }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
function rebuildHotbarIcon(i) {
  buildHotbar(hotbarEl);
  if (invOpen) buildHotbar($('invhotbar'));
}

function tryBreak() {
  const hit = world.raycast(player.eye(), player.lookDir(), 6);
  if (!hit || hit.block === B.BEDROCK) return;
  burst(hit.x, hit.y, hit.z, hit.block);
  world.setBlock(hit.x, hit.y, hit.z, B.AIR);
  // plants and torches that were resting on / attached to the broken block pop too
  const above = world.getBlock(hit.x, hit.y + 1, hit.z);
  if (KIND[above] === K.PLANT || above === B.TORCH) { burst(hit.x, hit.y + 1, hit.z, above); world.setBlock(hit.x, hit.y + 1, hit.z, B.AIR); }
  DIRS4.forEach(([dx, dz], i) => {
    if (world.getBlock(hit.x + dx, hit.y, hit.z + dz) === B.TORCH + 1 + i) { burst(hit.x + dx, hit.y, hit.z + dz, B.TORCH); world.setBlock(hit.x + dx, hit.y, hit.z + dz, B.AIR); }
  });
  if (hit.y <= SEA) world.flood(hit.x, hit.y, hit.z);
  swingT = 0.001; avatar.swing = 1;
}
function tryPlace() {
  const hit = world.raycast(player.eye(), player.lookDir(), 6);
  if (!hit) return;
  let x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
  if (KIND[hit.block] === K.PLANT) { x = hit.x; y = hit.y; z = hit.z; }
  const cur = world.getBlock(x, y, z);
  if (cur !== B.AIR && cur !== B.WATER && KIND[cur] !== K.PLANT) return;
  const item = HOTBAR[slot];
  let b = item;
  if (item === B.TORCH) {
    const support = KIND[hit.block] === K.PLANT ? world.getBlock(x, y - 1, z) : hit.block;
    if (!SOLID[support] || isTorch(support)) return;
    if (hit.ny === 1 || KIND[hit.block] === K.PLANT) b = B.TORCH;
    else if (hit.ny === -1) return;
    else b = B.TORCH + 1 + DIRS4.findIndex(([dx, dz]) => dx === hit.nx && dz === hit.nz);
  } else if (KIND[item] === K.STAIRS) {
    const f = player.forward();
    b = item + (Math.abs(f.x) > Math.abs(f.z) ? (f.x > 0 ? 0 : 1) : (f.z > 0 ? 2 : 3));
  } else if (KIND[item] === K.PLANT) {
    const below = world.getBlock(x, y - 1, z);
    if (!SOLID[below] || KIND[below] === K.STAIRS) return;
  }
  const p = player.pos;
  const overlap = x + 1 > p.x - 0.3 && x < p.x + 0.3 && z + 1 > p.z - 0.3 && z < p.z + 0.3 && y + 1 > p.y && y < p.y + 1.8;
  if (overlap && SOLID[b]) return;
  world.setBlock(x, y, z, b);
  swingT = 0.001; avatar.swing = 1;
}

// ---------- menu / settings ----------
const overlay = $('overlay');
$('play').addEventListener('click', () => renderer.domElement.requestPointerLock());
renderer.domElement.addEventListener('click', () => { if (!player.locked && ready) renderer.domElement.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  overlay.hidden = locked || invOpen;
  $('hud').classList.toggle('dim', !locked);
});
document.addEventListener('pointerlockerror', () => { if (!invOpen) overlay.hidden = false; });

// ---------- inventory (E) ----------
let invOpen = false, invHover = null;
const invEl = $('inventory'), invGrid = $('invgrid');
INVENTORY.forEach((id) => {
  const d = document.createElement('div');
  d.className = 'slot item';
  d.appendChild(iconImg(id));
  d.title = BLOCKS[id].name;
  d.addEventListener('mouseenter', () => { invHover = id; $('invname').textContent = BLOCKS[id].name; });
  d.addEventListener('mouseleave', () => { if (invHover === id) { invHover = null; $('invname').textContent = ''; } });
  d.addEventListener('click', (e) => { e.stopPropagation(); assignSlot(slot, id); });
  d.draggable = true;
  d.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(id)));
  invGrid.appendChild(d);
});
const invBar = $('invhotbar');
invBar.addEventListener('click', (e) => { const t = e.target.closest('.slot'); if (t) { e.stopPropagation(); selectSlot(Number(t.dataset.slot)); buildHotbar(invBar); } });
invBar.addEventListener('dragover', (e) => e.preventDefault());
invBar.addEventListener('drop', (e) => { e.preventDefault(); const t = e.target.closest('.slot'); const id = Number(e.dataTransfer.getData('text/plain')); if (t && id) assignSlot(Number(t.dataset.slot), id); });
function assignSlot(i, id) {
  HOTBAR[i] = id;
  buildHotbar(hotbarEl); buildHotbar(invBar);
  selectSlot(i); buildHotbar(invBar);
}
function openInv() {
  invOpen = true;
  player.keys.clear(); mouseL = mouseR = false;
  buildHotbar(invBar);
  invEl.hidden = false; overlay.hidden = true;
  document.exitPointerLock();
}
function closeInv(relock) {
  invOpen = false; invHover = null;
  invEl.hidden = true;
  if (relock) renderer.domElement.requestPointerLock(); else overlay.hidden = false;
}
invEl.addEventListener('click', (e) => { if (e.target === invEl) closeInv(true); });
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && !e.repeat) {
    if (invOpen) closeInv(true); else if (player.locked) openInv();
    return;
  }
  if (!invOpen) return;
  if (e.code === 'Escape') closeInv(false);
  const n = digitOf(e); if (n && invHover) { assignSlot(n - 1, invHover); e.stopImmediatePropagation(); }
}, true);
function bindRange(id, fmt, apply) {
  const el = $(id), out = $(id + 'Val');
  const f = () => { out.textContent = fmt(Number(el.value)); apply(Number(el.value)); };
  el.addEventListener('input', f); f();
}
bindRange('rd', (v) => `${v} chunks`, (v) => (settings.renderDistance = v));
bindRange('tod', (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`, (v) => (sky.hour = v));
bindRange('res', (v) => `${Math.round(v * 100)}%`, (v) => { settings.pixelRatio = v; renderer.setPixelRatio(v); onResize(); });
$('res').value = settings.pixelRatio; $('res').dispatchEvent(new Event('input'));
const selShadow = $('shadowq');
selShadow.addEventListener('change', () => { settings.shadows = Number(selShadow.value); sky.setShadowSize(settings.shadows); renderer.shadowMap.enabled = settings.shadows > 0; materials.opaque.needsUpdate = true; materials.cutout.needsUpdate = true; });
$('refl').addEventListener('change', (e) => (settings.reflections = e.target.checked));
$('god').addEventListener('change', (e) => (post.godEnabled = e.target.checked));
$('bloomchk').addEventListener('change', (e) => (post.bloom.enabled = e.target.checked));

function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  handCam.aspect = w / h; handCam.updateProjectionMatrix();
  post.setSize(w, h);
}
window.addEventListener('resize', onResize);

// ---------- spawn & loading ----------
let ready = false;
function findSpawn() {
  for (let r = 0; r < 400; r += 4) {
    for (let a = 0; a < 16; a++) {
      const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r), z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
      const h = world.heightAt(x, z);
      if (h > SEA + 3 && h < SEA + 22) return [x, h, z];
    }
  }
  return [0, world.heightAt(0, 0), 0];
}
const [sx, sh, sz] = findSpawn();
player.pos.set(sx + 0.5, sh + 12, sz + 0.5);

async function spawnCharacters() {
  const manifest = await loadManifest();
  let motions = null;
  if (manifest && manifest.blockyMotions) {
    motions = await loadBlockyMotions(manifest.blockyMotions);
    if (motions) {
      if (avatar instanceof BlockyCharacter) avatar.setMotions(motions);
      toast('Blocky characters · PINOC motions');
      $('charsrc').textContent = `Characters: blocky people · PINOC motions (${Object.keys(motions).join(', ')})`;
    }
  }
  if (manifest) {
    gltfTemplates = await loadGLTFTemplates(manifest, U);
    if (gltfTemplates.length) {
      toast(`Loaded ${gltfTemplates.length} PINOC character${gltfTemplates.length > 1 ? 's' : ''}`);
      $('charsrc').textContent = `Characters: PINOC (${gltfTemplates.map((t) => t.entry.name || t.entry.model).join(', ')})`;
      if (manifest.player !== false) {
        scene.remove(avatar.root);
        avatar = new GLTFCharacter(gltfTemplates[0]);
        avatar.swing = 0;
        scene.add(avatar.root);
      }
    }
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4, d = 6 + i * 2;
    const x = Math.floor(player.pos.x + Math.cos(a) * d), z = Math.floor(player.pos.z + Math.sin(a) * d);
    const y = world.surfaceY(x, z, 120);
    if (world.getBlock(x, y, z) === B.WATER || world.getBlock(x, y - 1, z) === B.WATER) continue;
    const npcTpls = manifest && manifest.player !== false && gltfTemplates.length > 1 ? gltfTemplates.slice(1) : gltfTemplates;
    const ch = npcTpls.length ? new GLTFCharacter(npcTpls[i % npcTpls.length]) : new BlockyCharacter(PALETTES[(i % (PALETTES.length - 1)) + 1], U);
    if (ch instanceof BlockyCharacter) ch.setMotions(motions);
    scene.add(ch.root);
    npcs.push(new NPC(ch, world, x + 0.5, y, z + 0.5));
  }
  if (motions) stageOpening(motions);
}

// Opening scene: one NPC waves at you from just ahead, another mines a little further off.
function stageOpening(motions) {
  const f = player.forward();
  // dry ground in the initial view: first hit over these angles (radians off straight ahead) × distances
  const spot = (angles, dist) => {
    for (const ang of angles) {
      const c = Math.cos(ang), s = Math.sin(ang), dx = f.x * c - f.z * s, dz = f.x * s + f.z * c;
      for (let d = dist; d < dist + 6; d++) {
        const x = Math.floor(player.pos.x + dx * d), z = Math.floor(player.pos.z + dz * d);
        const y = world.surfaceY(x, z, 120);
        if (world.getBlock(x, y, z) === B.WATER || world.getBlock(x, y - 1, z) === B.WATER || Math.abs(y - player.pos.y) > 3) continue;
        return new THREE.Vector3(x + 0.5, y, z + 0.5);
      }
    }
    return null;
  };
  const place = (n, p) => { n.pos.copy(p); n.home.copy(p); n.target = null; };
  const toPlayer = (p) => Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
  const [greeter, miner] = npcs;
  // the greeter wanders like everyone else but waves whenever it spots you; start it nearby
  const gp = motions.wave && greeter && spot([0, 0.3, -0.3], 4);
  if (gp) { place(greeter, gp); greeter.yaw = toPlayer(gp); greeter.befriend(); }
  const mp = motions.mine && miner && spot([0.55, -0.55, 0.3, -0.3, 0.8, -0.8], 7);
  if (mp) {
    place(miner, mp); miner.char.holdPickaxe(U); miner.mine(toPlayer(mp) + Math.PI / 2); // side-on to the camera
    miner.char.onStrike = () => { // chips fly off the block the pickaxe lands on
      const x = Math.floor(miner.pos.x + Math.sin(miner.yaw)), z = Math.floor(miner.pos.z + Math.cos(miner.yaw));
      const y = world.surfaceY(x, z, Math.floor(miner.pos.y) + 1) - 1;
      const b = world.getBlock(x, y, z);
      if (SOLID[b]) burst(x, y, z, b, 12);
    };
  }
}

// ---------- main loop ----------
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fps = 0, time = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  time += dt;
  U.uTime.value = time;

  const budget = ready ? 5 : 40;
  world.update(player.pos.x, player.pos.z, settings.renderDistance, budget);
  if (!ready) {
    const total = world.order.length, done = total - world.pending;
    $('loadbar').style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
    const near = world.order.filter(([, , d]) => d <= 9).every(([cx, cz]) => { const c = world.getChunk(cx, cz); return c && c.meshed; });
    if (near) {
      ready = true;
      const y = world.surfaceY(Math.floor(player.pos.x), Math.floor(player.pos.z), 127);
      player.pos.y = y + 0.01;
      $('loading').hidden = true; $('play').disabled = false; $('play').textContent = 'Click to Play';
      spawnCharacters();
    }
  }

  if (ready) {
    player.update(dt);
    if (player.locked) {
      breakCd -= dt; placeCd -= dt;
      if (mouseL && breakCd <= 0) { tryBreak(); breakCd = 0.22; }
      if (mouseR && placeCd <= 0) { tryPlace(); placeCd = 0.22; }
    }
  }
  player.updateCamera();

  // sky, sun & shadows
  sky.update(dt, player.pos);
  const u = water.material.uniforms;
  u.time.value = time * 0.6;
  u.sunDirection.value.copy(sky.lightDir);
  u.sunColor.value.copy(sky.light.color).multiplyScalar(Math.min(1.6, sky.light.intensity * 0.45));
  u.waterColor.value.setRGB(0.02, 0.12, 0.14).multiplyScalar(0.12 + 0.88 * sky.daylight);
  water.position.x = Math.round(camera.position.x / 64) * 64;
  water.position.z = Math.round(camera.position.z / 64) * 64;
  water.onBeforeRender = settings.reflections ? waterReflect : () => {};
  u.mirrorSampler.value = settings.reflections ? mirrorTex : flatSkyTex;
  if (!settings.reflections) {
    const d = sky.daylight;
    flatSkyTex.image.data.set([20 + 110 * d, 28 + 140 * d, 45 + 165 * d, 255]); flatSkyTex.needsUpdate = true;
  }

  const camBlock = world.getBlock(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z));
  const underwater = camBlock === B.WATER && camera.position.y < SEA + 0.9;
  U.uUnderwater.value = underwater ? 1 : 0;
  U.uWaterFog.value.setRGB(0.012, 0.07, 0.09).multiplyScalar(0.08 + 0.92 * sky.daylight);
  U.uWaterTint.value.setRGB(0.004, 0.028, 0.034).multiplyScalar(0.1 + 0.9 * sky.daylight);
  U.uFogStart.value = settings.renderDistance * CS * 0.6;
  U.uFogEnd.value = settings.renderDistance * CS - 6;

  // torch flicker (baked light) + dynamic point lights on the nearest emitters
  const flick = (ph) => 0.9 + 0.06 * Math.sin(time * 13.0 + ph) + 0.04 * Math.sin(time * 23.7 + ph * 1.7);
  U.uTorch.value = flick(0);
  const nearLights = [];
  if (world.lights.size) {
    for (const L of world.lights.values()) { const d2 = L.pos.distanceToSquared(player.pos); if (d2 < 1600) nearLights.push([d2, L]); }
    nearLights.sort((a, b) => a[0] - b[0]);
  }
  glowLights.forEach((l, i) => {
    const e = nearLights[i];
    if (!e) { l.intensity = 0; return; }
    const L = e[1], torch = isTorch(L.block);
    if (torch) { const t = torchTip(L.block, Math.floor(L.pos.x), Math.floor(L.pos.y), Math.floor(L.pos.z)); l.position.set(t[0], t[1] + 0.1, t[2]); }
    else l.position.copy(L.pos);
    l.color.setHex(torch ? 0xff9a48 : 0xffc98a);
    l.intensity = (torch ? 2.2 : 3.2) * flick(i * 2.1);
  });
  // carrying a torch / glowstone lights up your surroundings
  const carry = HOTBAR[slot] === B.TORCH ? 1 : HOTBAR[slot] === B.GLOW ? 0.8 : 0;
  heldLight.intensity += (carry * 3.2 * flick(7) - heldLight.intensity) * Math.min(1, dt * 10);
  heldLight.position.copy(player.eye()).addScaledVector(player.lookDir(), 0.6);
  // fire sparks & smoke from nearby torches
  for (const [d2, L] of nearLights) {
    if (d2 > 576 || !isTorch(L.block)) continue;
    const t = torchTip(L.block, Math.floor(L.pos.x), Math.floor(L.pos.y), Math.floor(L.pos.z));
    if (Math.random() < dt * 3) spark(t, false);
    if (Math.random() < dt * 0.7) spark(t, true);
  }
  updateSparks(dt);

  // night: eyes adapt (exposure) and baked light matters more
  U.uDaylight.value = sky.daylight;
  renderer.toneMappingExposure = 1.0 + 0.4 * (1 - sky.daylight);

  // selection outline
  const hit = ready && player.locked ? world.raycast(player.eye(), player.lookDir(), 6) : null;
  outline.visible = !!hit && player.view === 0;
  if (hit) outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

  // avatar (visible in 3rd person) and NPCs
  avatar.root.visible = player.view !== 0;
  avatar.root.position.copy(player.pos);
  avatar.root.rotation.y = player.yaw + Math.PI;
  avatar.update(dt, player.speed, 0);
  for (const n of npcs) n.update(dt, player.pos, player.locked);
  updateParticles(dt);

  // first-person hand
  hand.visible = player.view === 0;
  if (swingT > 0) { swingT += dt * 3.5; if (swingT >= 1) swingT = 0; }
  const sw = Math.sin(swingT * Math.PI);
  const bob = Math.sin(player.bob) * 0.025 * player.bobAmt;
  hand.position.set(bob, -Math.abs(Math.cos(player.bob)) * 0.02 * player.bobAmt - sw * 0.12, -sw * 0.1);
  hand.rotation.set(-sw * 0.9, sw * 0.3, 0);
  handLight.color.copy(sky.light.color); handLight.intensity = sky.light.intensity * 0.55;
  handHemi.intensity = Math.max(0.03, 0.06 + 0.84 * sky.daylight - (underwater ? 0.3 : 0));
  handCam.fov = player.fov; handCam.updateProjectionMatrix();

  renderer.info.reset();
  post.update(sky, camera.position, underwater, time);
  post.render(dt);

  // HUD
  if (nameTimer > 0) { nameTimer -= dt; if (nameTimer <= 0) $('blockname').style.opacity = 0; }
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  $('clock').textContent = `${sky.timeString()}${player.flying ? ' · Flying' : ''}`;
  if (!$('debug').hidden) {
    const p = player.pos;
    $('debug').textContent = `FPS ${fps}\nXYZ ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}\nChunks ${world.meshedCount()}  pending ${world.pending}\nDraw calls ${renderer.info.render.calls}  Triangles ${(renderer.info.render.triangles / 1000).toFixed(0)}k\nSeed ${seed}`;
  }
}
selectSlot(0);
onResize();
frame();
window.__game = { world, player, sky, post, renderer, scene, camera, settings, npcs, tryBreak, tryPlace, selectSlot, openInv, closeInv };
