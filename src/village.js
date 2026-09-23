// The opening village: every NPC has a job, and each job is a different PINOC clip — a waving
// greeter, a miner, an archer with a target, a sword-drawing guard, a porter moving crates, a
// lumberjack at a tree and a farmer tilling soil. Laid out in the player's initial view.
import * as THREE from 'three';
import { B, KIND, K, SOLID } from './blocks.js';
import { BlockyCharacter, NPC, limbDir, limbQuat, makeCrateMesh } from './character.js';
import { patchFogShader } from './materials.js';

const LOOKS = {
  greeter: { skin: [236, 196, 160], hair: [196, 142, 60], shirt: [196, 70, 58], pants: [70, 60, 50], shoes: [50, 40, 34], eyes: [60, 110, 60] },
  miner: { skin: [150, 100, 70], hair: [24, 20, 20], shirt: [230, 214, 160], pants: [100, 76, 52], shoes: [60, 46, 36], eyes: [40, 30, 24] },
  archer: { skin: [226, 180, 140], hair: [120, 50, 30], shirt: [70, 110, 50], pants: [60, 50, 40], shoes: [40, 32, 26], eyes: [70, 120, 160] },
  guard: { skin: [206, 150, 112], hair: [58, 38, 24], shirt: [150, 156, 166], pants: [70, 74, 84], shoes: [40, 40, 44], eyes: [60, 80, 170] },
  porter: { skin: [236, 196, 160], hair: [90, 60, 36], shirt: [180, 120, 60], pants: [52, 58, 140], shoes: [70, 70, 76], eyes: [60, 110, 60] },
  lumberjack: { skin: [206, 150, 112], hair: [110, 40, 20], shirt: [170, 40, 40], pants: [40, 50, 80], shoes: [50, 40, 34], eyes: [40, 30, 24] },
  farmer: { skin: [226, 180, 140], hair: [220, 190, 110], shirt: [92, 120, 60], pants: [90, 70, 45], shoes: [60, 46, 36], eyes: [70, 120, 160] },
};

const face = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const angleTo = (a, b) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

export function stageVillage({ world, scene, player, npcs, motions, U, burst }) {
  const P = player.pos.clone();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const mat = (color, map) => { const m = new THREE.MeshStandardMaterial({ color, map: map || null, roughness: 0.85 }); m.onBeforeCompile = (s) => patchFogShader(s, U); return m; };

  // ---- ground queries ----
  const groundY = (x, z, from = Math.floor(P.y) + 12) => world.surfaceY(x, z, from);
  const dry = (x, y, z) => world.getBlock(x, y, z) !== B.WATER && world.getBlock(x, y - 1, z) !== B.WATER;

  // The village sits on the biggest patch of flat dry ground 10–28 blocks away that isn't above
  // the player (so it's seen from spawn), and the player starts out facing it.
  const C = findCenter();
  if (!C) return [];
  const toC = C.clone().sub(P).setY(0), dist = toC.length();
  const f = toC.normalize(), side = V(-f.z, 0, f.x);
  player.yaw = Math.atan2(-f.x, -f.z);
  player.pitch = Math.max(-0.45, Math.min(0, Math.atan2(C.y - (P.y + 1.6), dist) + 0.05));

  const taken = [P.clone()];
  const cell = (x, z) => { const y = groundY(x, z); return dry(x, y, z) && Math.abs(y - C.y) <= 3 ? y : null; };
  const flat = (x, z, r) => {
    const y = cell(x, z); if (y == null) return null;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) { const v = cell(x + dx, z + dz); if (v == null || Math.abs(v - y) > 1) return null; }
    return y;
  };
  const clear = (v, d) => taken.every((t) => Math.hypot(t.x - v.x, t.z - v.z) >= d);
  // Biggest flat dry patch 10–28 blocks away, not above the player.
  function findCenter() {
    let best = null;
    for (let dx = -28; dx <= 28; dx += 2) for (let dz = -28; dz <= 28; dz += 2) {
      const d = Math.hypot(dx, dz); if (d < 10 || d > 28) continue;
      const x = Math.floor(P.x) + dx, z = Math.floor(P.z) + dz, y = groundY(x, z);
      if (!dry(x, y, z)) continue;
      let flatN = 0;
      for (let u = -7; u <= 7; u++) for (let v = -7; v <= 7; v++) {
        if (u * u + v * v > 49) continue;
        const yy = groundY(x + u, z + v);
        if (Math.abs(yy - y) <= 1 && dry(x + u, yy, z + v)) flatN++;
      }
      const score = flatN - Math.max(0, y - P.y - 1) * 10 - Math.abs(d - 17) * 0.8;
      if (!best || score > best.score) best = { score, v: V(x + 0.5, y, z + 0.5) };
    }
    return best?.v;
  }
  // Nearest usable cell to the slot `ahead` blocks past the centre (away from the player) and
  // `across` to the side, searching outward up to `reach`.
  const spot = (ahead, across, { r = 0, gap = 2.8, reach = 5, test } = {}) => {
    const cx = C.x + f.x * ahead + side.x * across, cz = C.z + f.z * ahead + side.z * across;
    for (let rad = 0; rad <= reach; rad++) for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
      const x = Math.floor(cx) + dx, z = Math.floor(cz) + dz, y = flat(x, z, r); if (y == null) continue;
      const v = V(x + 0.5, y, z + 0.5);
      if (!clear(v, gap) || (test && !test(v))) continue;
      taken.push(v); return v;
    }
    return null;
  };
  // straight walk of `len` blocks along dir with no step above one block
  const walkable = (from, dir, len) => {
    let y = from.y;
    for (let s = 0.5; s <= len; s += 0.5) {
      const x = Math.floor(from.x + dir.x * s), z = Math.floor(from.z + dir.z * s), g = cell(x, z);
      if (g == null || Math.abs(g - y) > 1) return false;
      y = g;
    }
    return true;
  };
  const chips = (x, y, z, n = 12) => { const b = world.getBlock(x, y, z); if (SOLID[b]) burst(x, y, z, b, n); };
  const aheadCell = (n, d = 1) => [Math.floor(n.pos.x + Math.sin(n.yaw) * d), Math.floor(n.pos.z + Math.cos(n.yaw) * d)];

  const villager = (look, pos) => {
    const ch = new BlockyCharacter(look, U); ch.setMotions(motions); scene.add(ch.root);
    const n = new NPC(ch, world, pos.x, pos.y, pos.z); n.yaw = face(pos, P); npcs.push(n);
    return n;
  };
  const cast = [];

  // ---- greeter: wanders, waves when it sees you ----
  const gp = motions.wave && (spot(-dist * 0.5, 0, { gap: 2, reach: 4 }) || spot(-4, 0, { gap: 2 }));
  if (gp) { const n = villager(LOOKS.greeter, gp); n.befriend(); cast.push('greeter'); }

  // ---- miner: pickaxe strikes chip the ground ----
  const mp = motions.mine && spot(3, 8, { gap: 3.5 });
  if (mp) {
    const n = villager(LOOKS.miner, mp); n.char.hold('pickaxe', U); n.mine(face(mp, P) + Math.PI / 2);
    n.char.onEvent = (e) => { if (e !== 'strike') return; const [x, z] = aheadCell(n); chips(x, groundY(x, z, Math.floor(n.pos.y) + 1) - 1, z); };
    cast.push('miner');
  }

  // ---- archer: shoots at a target placed across your view ----
  const ap = motions.bow && spot(6, -8, { gap: 3.5 });
  if (ap) {
    let tp = null;
    search: for (const s of [1, -1]) for (const d of [7, 6, 8]) {
      const x = Math.floor(ap.x + side.x * d * s), z = Math.floor(ap.z + side.z * d * s), y = cell(x, z);
      const v = y != null && V(x + 0.5, y, z + 0.5);
      if (v && clear(v, 2)) { tp = v; break search; }
    }
    if (tp) {
      taken.push(tp);
      scene.add(makeTarget(tp, face(tp, ap), mat));
      const aim = limbDir(motions.bow, 'armL', 1.2); aim.y = 0; aim.normalize(); // bow arm while holding the draw
      const up = V(0, 1, 0).applyQuaternion(limbQuat(motions.bow, 'armL', 1.2).invert()); // world-up in that arm's frame
      const n = villager(LOOKS.archer, ap); n.char.hold('bow', U, { up }); n.lookAtPlayer = false;
      let rest = 0.6;
      n.station(face(ap, tp) - Math.atan2(aim.x, aim.z), (dt) => {
        if (n.char.once) return;
        if ((rest -= dt) <= 0) { rest = 1.4; n.char.playOnce('bow'); }
      });
      const aimAt = V(tp.x, tp.y + 1.25, tp.z);
      n.char.onEvent = (e) => { if (e === 'release') shootArrow(n, aimAt); };
      cast.push('archer');
    }
  }

  // ---- guard: draws the sword when you come close, stands ready, sheathes when you leave ----
  const kp = motions.draw && motions.swordIdle && spot(-5, -7, { gap: 3.5 });
  if (kp) {
    const n = villager(LOOKS.guard, kp), post = face(kp, P), sword = n.char.hold('sword', U);
    sword.visible = false;
    let state = 'rest';
    n.station(post, (dt, pp) => {
      const d = pp ? n.pos.distanceTo(pp) : 99;
      if (state === 'rest' && d < 7 && n.sees(pp)) { state = 'draw'; n.char.playOnce('draw', { after: 'swordIdle' }); }
      else if (state !== 'rest' && d > 11) { state = 'rest'; n.char.setActivity(null); sword.visible = false; n.wantYaw = post; }
      if (state !== 'rest' && pp) n.wantYaw = face(n.pos, pp);
    });
    n.char.onEvent = (e, { reverse }) => { if (e === 'grab') sword.visible = !reverse; };
    cast.push('guard');
  }

  // ---- porter: moves crates one at a time between two piles, then back again ----
  const hp = motions.pickup && motions.carryWalk && spot(-5, 7, { gap: 3.5, test: (v) => walkable(v, f, 6) || walkable(v, f.clone().negate(), 6) });
  if (hp) {
    const dir = walkable(hp, f, 6) ? f.clone() : f.clone().negate(); // walks away from you and back
    const ends = [hp, hp.clone().addScaledVector(dir, 6)];
    ends[1].y = groundY(Math.floor(ends[1].x), Math.floor(ends[1].z));
    taken.push(ends[1]);
    const piles = [ends[0].clone().addScaledVector(dir, -0.95), ends[1].clone().addScaledVector(dir, 0.95)].map((p) => ({ p, crates: [] }));
    const addCrate = (pile) => {
      const m = makeCrateMesh(U); const y = groundY(Math.floor(pile.p.x), Math.floor(pile.p.z), Math.floor(pile.p.y) + 3);
      m.position.set(pile.p.x, y + 0.25 + pile.crates.length * 0.5, pile.p.z); scene.add(m); pile.crates.push(m);
    };
    for (let i = 0; i < 3; i++) addCrate(piles[0]);
    const n = villager(LOOKS.porter, ends[0]), box = n.char.hold('box', U);
    box.visible = false;
    let src = 0, state = 'fetch';
    const PICK = { from: 2.9, to: 4.9 }; // the bend-and-lift part of Pick Up Object From Ground
    n.station(face(ends[0], piles[0].p), (dt) => {
      const dst = 1 - src;
      if (state === 'fetch' && n.stepToward(ends[src], 1.6, dt)) state = 'pick';
      else if (state === 'pick') {
        n.wantYaw = face(n.pos, piles[src].p);
        if (angleTo(n.yaw, n.wantYaw) < 0.12) { state = 'lifting'; n.char.playOnce('pickup', { ...PICK, after: 'carryIdle', onDone: () => { state = 'carry'; } }); }
      } else if (state === 'carry') {
        n.char.setActivity('carryWalk');
        if (n.stepToward(ends[dst], 1.2, dt)) { state = 'drop'; n.char.setActivity('carryIdle'); }
      } else if (state === 'drop') {
        n.wantYaw = face(n.pos, piles[dst].p);
        if (angleTo(n.yaw, n.wantYaw) < 0.12) {
          state = 'lowering';
          n.char.playOnce('pickup', { ...PICK, reverse: true, onDone: () => { if (!piles[src].crates.length) src = dst; state = 'fetch'; } });
        }
      }
    });
    n.char.onEvent = (e, { reverse }) => {
      if (e !== 'grab') return;
      if (!reverse) { const top = piles[src].crates.pop(); if (top) scene.remove(top); box.visible = true; }
      else { box.visible = false; addCrate(piles[1 - src]); }
    };
    cast.push('porter');
  }

  // ---- lumberjack: chops the nearest tree in view; chips fly off the trunk ----
  const tree = motions.chop && findTree();
  if (tree) {
    taken.push(tree.stand);
    const n = villager(LOOKS.lumberjack, tree.stand); n.char.hold('axe', U);
    n.work('chop', face(tree.stand, V(tree.x + 0.5, 0, tree.z + 0.5)));
    n.char.onEvent = (e) => { if (e === 'strike') chips(tree.x, tree.y, tree.z, 10); };
    cast.push('lumberjack');
  }

  // ---- farmer: tills a 3×3 patch; each hoe strike kicks up dirt ----
  const fp = motions.hoe && spot(8, 3, { r: 1, gap: 4 });
  if (fp) {
    const yaw = face(fp, P) + Math.PI / 2, fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (let a = -1; a <= 1; a++) for (let b = 1; b <= 3; b++) { // rows 1–3 blocks ahead
      const x = Math.floor(fp.x + fx * b - fz * a), z = Math.floor(fp.z + fz * b + fx * a), y = groundY(x, z, Math.floor(fp.y) + 2);
      if (world.getBlock(x, y - 1, z) === B.GRASS) world.setBlock(x, y - 1, z, B.DIRT);
      if (KIND[world.getBlock(x, y, z)] === K.PLANT) world.setBlock(x, y, z, B.AIR);
    }
    taken.push(V(fp.x + fx * 2, fp.y, fp.z + fz * 2));
    const n = villager(LOOKS.farmer, fp); n.char.hold('hoe', U); n.work('hoe', yaw);
    n.char.onEvent = (e) => { if (e !== 'strike') return; const [x, z] = aheadCell(n); chips(x, groundY(x, z, Math.floor(n.pos.y) + 1) - 1, z, 10); };
    cast.push('farmer');
  }

  return cast;

  // Tree trunk nearest the village (and in the player's view) with a free cell beside it.
  function findTree() {
    let best = null;
    for (let dx = -16; dx <= 16; dx++) for (let dz = -16; dz <= 16; dz++) {
      const x = Math.floor(C.x) + dx, z = Math.floor(C.z) + dz, dc = Math.hypot(dx, dz);
      const px = x + 0.5 - P.x, pz = z + 0.5 - P.z, dp = Math.hypot(px, pz);
      if (dc > 16 || dp < 6 || (px * f.x + pz * f.z) < dp * 0.5) continue; // near the village, in view
      const top = groundY(x, z);
      let y = top - 1;
      while (y > P.y - 8 && !(world.getBlock(x, y, z) === B.LOG || world.getBlock(x, y, z) === B.BIRCH_LOG)) { if (SOLID[world.getBlock(x, y, z)] && world.getBlock(x, y, z) !== B.LEAVES && world.getBlock(x, y, z) !== B.BIRCH_LEAVES) break; y--; }
      const log = world.getBlock(x, y, z);
      if (log !== B.LOG && log !== B.BIRCH_LOG) continue;
      while (world.getBlock(x, y - 1, z) === log) y--; // trunk base
      if (!SOLID[world.getBlock(x, y - 1, z)]) continue;
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cx = x + sx, cz = z + sz;
        if (SOLID[world.getBlock(cx, y, cz)] || SOLID[world.getBlock(cx, y + 1, cz)] || !SOLID[world.getBlock(cx, y - 1, cz)] || !dry(cx, y, cz)) continue;
        const stand = V(cx + 0.5, y, cz + 0.5);
        if (!clear(stand, 2.5)) continue;
        const score = dc;
        if (!best || score < best.score) best = { x, y, z, stand, score };
      }
    }
    return best;
  }

  function shootArrow(n, to) {
    const bow = n.char.props?.bow; if (!bow) return;
    const from = bow.getWorldPosition(new THREE.Vector3());
    const jitter = V((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3);
    arrows.push({ mesh: makeArrow(mat, scene), from, to: to.clone().add(jitter), t: 0, dur: Math.max(0.2, from.distanceTo(to) / 24), stuck: 0 });
  }
}

// ---- arrows in flight, then stuck in the target for a moment ----
const arrows = [];
export function updateArrows(dt, scene) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (a.t < 1) {
      a.t = Math.min(1, a.t + dt / a.dur);
      const p = a.from.clone().lerp(a.to, a.t); p.y += Math.sin(a.t * Math.PI) * 0.25;
      const q = a.from.clone().lerp(a.to, Math.min(1, a.t + 0.02)); q.y += Math.sin(Math.min(1, a.t + 0.02) * Math.PI) * 0.25;
      a.mesh.position.copy(p); a.mesh.lookAt(q);
    } else if ((a.stuck += dt) > 2.5) { scene.remove(a.mesh); arrows.splice(i, 1); }
  }
}

function makeArrow(mat, scene) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.62), mat(0x8a5a2b)); shaft.position.z = -0.2;
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.1), mat(0x9aa4ad)); tip.position.z = 0.12;
  const fl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.14), mat(0xeeeeee)); fl.position.z = -0.46;
  g.add(shaft, tip, fl); scene.add(g);
  return g;
}

function makeTarget(p, yaw, mat) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d');
  for (const [r, col] of [[8, '#f4f0e6'], [6.5, '#d23a2e'], [5, '#f4f0e6'], [3.5, '#d23a2e'], [2, '#f4f0e6'], [1, '#d23a2e']]) { g.fillStyle = col; g.beginPath(); g.arc(8, 8, r, 0, Math.PI * 2); g.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  const t = new THREE.Group();
  const face = mat(0xffffff, tex), straw = mat(0xc9a86a);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.14), [straw, straw, straw, straw, face, face]);
  board.position.y = 1.25; board.castShadow = true;
  for (const x of [-0.35, 0.35]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), mat(0x6e4a22)); leg.position.set(x, 0.45, -0.05); leg.castShadow = true; t.add(leg); }
  t.add(board);
  t.position.copy(p); t.rotation.y = yaw;
  return t;
}
