// Infinite voxel world: terrain generation, chunk meshing (culled faces + smooth vertex AO),
// chunk streaming around the player and voxel raycasting.
import * as THREE from 'three';
import { Simplex, hash2i, hash3i, smoothstep } from './noise.js';
import { B, K, KIND, SOLID, OPAQUE, AO_OCC, LIGHT, TEX_TOP, TEX_SIDE, TEX_BOT, BLOCKS, stairBoxes, wallTorchDir } from './blocks.js';
import { tileUV } from './textures.js';

export const CS = 16, CH = 128, SEA = 40;
const P = CS + 2;
const UV = []; for (let i = 0; i < 64; i++) UV[i] = tileUV(i);
const AO_SHADE = [0.38, 0.58, 0.8, 1.0];

const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
const QUAD_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
// For each face vertex: offsets (relative to block) of side1, side2, corner used for AO.
for (const f of FACES) {
  const axis = f.n.findIndex((v) => v !== 0);
  const [u, v] = [0, 1, 2].filter((a) => a !== axis);
  f.ao = f.c.map((c) => {
    const du = c[u] ? 1 : -1, dv = c[v] ? 1 : -1;
    const s1 = [...f.n], s2 = [...f.n], cr = [...f.n];
    s1[u] += du; s2[v] += dv; cr[u] += du; cr[v] += dv;
    return [s1, s2, cr];
  });
}

const key = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.data = new Uint8Array(CS * CS * CH);
    this.maxY = 0;
    this.meshes = null;
    this.dirty = true;
  }
}

class Buf {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.fx = []; this.idx = []; this.n = 0; }
}

function bufToGeometry(buf) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
  g.setAttribute('aFx', new THREE.Float32BufferAttribute(buf.fx, 3));
  g.setIndex(buf.idx);
  g.computeBoundingSphere();
  return g;
}

// Texture coords (s,t) in [0,1] for a point on face f, aligned so sub-boxes tile seamlessly.
function faceST(f, p) {
  switch (f) {
    case 0: return [1 - p[2], p[1]];
    case 1: return [p[2], p[1]];
    case 2: return [p[0], 1 - p[2]];
    case 3: return [p[0], p[2]];
    case 4: return [p[0], p[1]];
    default: return [1 - p[0], p[1]];
  }
}

// Emit an axis-aligned box (unit-cube coords b = [x0,y0,z0,x1,y1,z1]) placed at (x,y,z).
// skip(f) culls faces; xf optionally transforms points/normals (used for tilted wall torches).
function emitBox(buf, x, y, z, b, tiles, skip, shade, fx, xf) {
  for (let f = 0; f < 6; f++) {
    if (skip && skip(f)) continue;
    const F = FACES[f];
    const tile = f === 2 ? tiles[0] : f === 3 ? tiles[2] : tiles[1];
    const uv = UV[tile];
    const base = buf.n;
    for (let v = 0; v < 4; v++) {
      const cv = F.c[v];
      let p = [cv[0] ? b[3] : b[0], cv[1] ? b[4] : b[1], cv[2] ? b[5] : b[2]];
      const [st, tt] = faceST(f, p);
      let n = F.n;
      if (xf) { p = xf.p(p); n = xf.n(n); }
      buf.pos.push(x + p[0], y + p[1], z + p[2]);
      buf.nrm.push(n[0], n[1], n[2]);
      buf.uv.push(uv[0] + st * (uv[2] - uv[0]), uv[1] + tt * (uv[3] - uv[1]));
      const s = typeof shade === 'function' ? shade(f) : shade;
      buf.col.push(s, s, s);
      buf.fx.push(fx[0], fx[1], fx[2]);
    }
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    buf.n += 4;
  }
}

function emitCross(buf, x, y, z, uv, hgt, wave, bl) {
  const quads = [[[0.15, 0.15], [0.85, 0.85]], [[0.15, 0.85], [0.85, 0.15]]];
  for (const [[ax, az], [bx, bz]] of quads) {
    const base = buf.n;
    const pts = [[ax, 0, az], [bx, 0, bz], [bx, hgt, bz], [ax, hgt, az]];
    for (let v = 0; v < 4; v++) {
      buf.pos.push(x + pts[v][0], y + pts[v][1], z + pts[v][2]);
      buf.nrm.push(0, 1, 0);
      buf.uv.push(QUAD_UV[v][0] ? uv[2] : uv[0], QUAD_UV[v][1] ? uv[1] + (uv[3] - uv[1]) * Math.min(1, hgt) : uv[1]);
      const s = v < 2 ? 0.7 : 1.0;
      buf.col.push(s, s, s);
      buf.fx.push(wave && v >= 2 ? 2 : 0, 0, bl);
    }
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    buf.n += 4;
  }
}

const TORCH_BOX = [7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16];
const TILT = 0.38;
// Wall torch: lean the stick away from the wall it is attached to.
function torchXf(d) {
  const c = Math.cos(TILT), s = Math.sin(TILT);
  const rot = (q) => {
    const a = q[0] * d[0] + q[2] * d[1];               // component along the lean direction
    const px = q[0] - a * d[0], pz = q[2] - a * d[1];   // perpendicular part
    const a2 = a * c + q[1] * s, y2 = -a * s + q[1] * c;
    return [px + a2 * d[0], y2, pz + a2 * d[1]];
  };
  return {
    p: (p) => { const r = rot([p[0] - 0.5, p[1], p[2] - 0.5]); return [0.5 + r[0] - d[0] * 0.42, r[1] + 0.22, 0.5 + r[2] - d[1] * 0.42]; },
    n: (n) => rot(n),
  };
}
export function torchTip(b, x, y, z) {
  const d = wallTorchDir(b);
  if (!d) return [x + 0.5, y + 0.66, z + 0.5];
  const p = torchXf(d).p([0.5, 0.66, 0.5]);
  return [x + p[0], y + p[1], z + p[2]];
}
function emitTorch(buf, x, y, z, b, bl) {
  const d = wallTorchDir(b);
  const t = [TEX_TOP[b], TEX_SIDE[b], TEX_BOT[b]];
  emitBox(buf, x, y, z, TORCH_BOX, t, d ? null : (f) => f === 3, 1, [0, 0, bl], d ? torchXf(d) : null);
}
function emitStairs(buf, x, y, z, b, at, L) {
  const [lo, hi] = stairBoxes(b);
  const tiles = [TEX_TOP[b], TEX_SIDE[b], TEX_BOT[b]];
  const occ = (f) => { const n = FACES[f].n; return OPAQUE[at(x + n[0], y + n[1], z + n[2])]; };
  const facing = BLOCKS[b].facing;
  const riser = [1, 0, 5, 4][facing];
  const bl = L(x, y, z), blUp = L(x, y + 1, z);
  const shade = (f) => (f === 2 ? 1 : f === 3 ? 0.6 : 0.85);
  // lower slab: everything except its top (drawn per half below)
  emitBox(buf, x, y, z, lo, tiles, (f) => f === 2 || occ(f), shade, [0, 0, bl]);
  // exposed front half of the slab top
  const front = [...lo]; front[4] = 0.5;
  if (facing === 0) front[3] = 0.5; else if (facing === 1) front[0] = 0.5; else if (facing === 2) front[5] = 0.5; else front[2] = 0.5;
  emitBox(buf, x, y, z, front, tiles, (f) => f !== 2, 1, [0, 0, Math.max(bl, blUp)]);
  // raised back half
  emitBox(buf, x, y, z, hi, tiles, (f) => f === 3 || (f !== riser && occ(f)), shade, [0, 0, Math.max(bl, blUp)]);
}

// Stand-alone geometry for an inventory item (icons / held item), centred on the origin.
export function buildItemGeometry(b) {
  const buf = new Buf();
  const k = KIND[b];
  const tiles = [TEX_TOP[b], TEX_SIDE[b], TEX_BOT[b]];
  if (k === K.PLANT) emitCross(buf, 0, 0, 0, UV[TEX_SIDE[b]], 1, false, 0);
  else if (k === K.TORCH) emitBox(buf, 0, 0.15, 0, TORCH_BOX, tiles, null, 1, [0, 0, 0], null);
  else if (k === K.STAIRS) {
    const id = b - BLOCKS[b].facing + 1;
    for (const box of stairBoxes(id)) emitBox(buf, 0, 0, 0, box, tiles, null, 1, [0, 0, 0], null);
  } else emitBox(buf, 0, 0, 0, [0, 0, 0, 1, 1, 1], tiles, null, 1, [0, 0, 0], null);
  const g = bufToGeometry(buf);
  g.translate(-0.5, -0.5, -0.5);
  return g;
}

export class World {
  constructor(seed, group, materials) {
    this.seed = seed;
    this.noise = new Simplex(seed);
    this.noise2 = new Simplex(seed * 31 + 7);
    this.group = group;
    this.materials = materials;
    this.chunks = new Map();
    this.order = [];
    this.lastCenter = null;
    this.pending = 0;
    this.lights = new Map();
    this.frame = 0;
    this.pad = new Uint8Array(P * P * CH);
  }

  // ---------- terrain ----------
  heightAt(x, z) {
    const n = this.noise;
    const cont = n.fbm2(x * 0.0017, z * 0.0017, 4);
    const hills = n.fbm2(x * 0.0075 + 100, z * 0.0075 + 100, 4);
    const det = n.fbm2(x * 0.03 + 300, z * 0.03 - 300, 2);
    const mm = smoothstep(-0.05, 0.4, n.fbm2(x * 0.0013 + 900, z * 0.0013 - 400, 3));
    const rid = n.ridged2(x * 0.0042 + 500, z * 0.0042 + 500, 5);
    const h = SEA + 3 + cont * 18 + hills * 6 * (0.5 + mm) + det * 1.2 + mm * rid * rid * 64;
    return Math.max(2, Math.min(CH - 12, Math.floor(h)));
  }

  topFor(h, slope, x, z) {
    if (h < SEA - 2) {
      const v = this.noise2.noise2(x * 0.05, z * 0.05);
      return v > 0.35 ? B.GRAVEL : v < -0.45 ? B.DIRT : B.SAND;
    }
    if (h <= SEA + 1) return B.SAND;
    const snowLine = SEA + 44 + this.noise2.noise2(x * 0.02, z * 0.02) * 6;
    if (h >= snowLine) return B.SNOW;
    if (slope >= 4 && h > SEA + 10) return B.STONE;
    return B.GRASS;
  }

  treeChance(x, z) {
    const f = this.noise2.fbm2(x * 0.006 + 1234, z * 0.006, 2);
    return 0.0025 + Math.max(0, f + 0.1) * 0.055;
  }

  generate(c) {
    const { cx, cz, data } = c;
    const E = 4, G = CS + E * 2;
    const hs = new Int16Array(G * G);
    for (let ez = 0; ez < G; ez++) for (let ex = 0; ex < G; ex++) hs[ez * G + ex] = this.heightAt(cx * CS + ex - E, cz * CS + ez - E);
    const hAt = (ex, ez) => hs[Math.max(0, Math.min(G - 1, ez)) * G + Math.max(0, Math.min(G - 1, ex))];
    const slopeAt = (ex, ez) => {
      const h = hAt(ex, ez);
      return Math.max(Math.abs(h - hAt(ex + 1, ez)), Math.abs(h - hAt(ex - 1, ez)), Math.abs(h - hAt(ex, ez + 1)), Math.abs(h - hAt(ex, ez - 1)));
    };
    const tops = new Uint8Array(G * G);
    for (let ez = 1; ez < G - 1; ez++) for (let ex = 1; ex < G - 1; ex++) {
      tops[ez * G + ex] = this.topFor(hAt(ex, ez), slopeAt(ex, ez), cx * CS + ex - E, cz * CS + ez - E);
    }
    const s = this.seed;
    const n3 = this.noise;
    let maxY = SEA;

    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const wx = cx * CS + x, wz = cz * CS + z;
      const h = hAt(x + E, z + E), top = tops[(z + E) * G + x + E];
      const sub = top === B.GRASS || top === B.SNOW ? B.DIRT : top === B.STONE ? B.STONE : top;
      if (h > maxY) maxY = h;
      const caveTop = Math.min(h - 5, 84);
      for (let y = 0; y <= Math.max(h, SEA); y++) {
        let b;
        if (y === 0 || (y < 3 && hash3i(wx, y, wz, s) < 0.5)) b = B.BEDROCK;
        else if (y < h - 3) {
          b = B.STONE;
          const cell = hash3i(wx >> 1, y >> 1, wz >> 1, s + 5);
          if (y < 72 && cell < 0.022 && hash3i(wx, y, wz, s + 6) < 0.65) b = B.COAL;
          else if (y < 46 && cell > 0.989 && hash3i(wx, y, wz, s + 7) < 0.6) b = B.IRON;
        } else if (y < h) b = sub;
        else if (y === h) b = top;
        else b = B.WATER;
        if (y > 3 && y < caveTop) {
          const a = n3.noise3(wx * 0.028, y * 0.05, wz * 0.028);
          const bb = this.noise2.noise3(wx * 0.028 + 200, y * 0.05 + 100, wz * 0.028 - 200);
          if (a * a + bb * bb < 0.0085) b = B.AIR;
        }
        data[(y * CS + z) * CS + x] = b;
      }
    }

    // Trees (scan a margin so canopies cross chunk borders seamlessly)
    const put = (wx, y, wz, b, onlyAir) => {
      const lx = wx - cx * CS, lz = wz - cz * CS;
      if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 0 || y >= CH) return;
      const i = (y * CS + lz) * CS + lx;
      if (onlyAir && data[i] !== B.AIR) return;
      data[i] = b;
      if (y > maxY) maxY = y;
    };
    for (let ez = 1; ez < G - 1; ez++) for (let ex = 1; ex < G - 1; ex++) {
      const wx = cx * CS + ex - E, wz = cz * CS + ez - E;
      const h = hAt(ex, ez);
      if (tops[ez * G + ex] !== B.GRASS || h <= SEA + 1 || slopeAt(ex, ez) > 2) continue;
      if (hash2i(wx, wz, s + 17) >= this.treeChance(wx, wz)) continue;
      const birch = this.noise2.noise2(wx * 0.01 - 777, wz * 0.01) > 0.3;
      const th = 4 + Math.floor(hash2i(wx, wz, s + 18) * 3) + (birch ? 1 : 0);
      const topY = h + th;
      const leaf = birch ? B.BIRCH_LEAVES : B.LEAVES;
      for (let dy = -2; dy <= 1; dy++) {
        const y = topY + dy, r = dy <= -1 ? 2 : 1;
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner && (dy === 1 || hash3i(wx + dx, y, wz + dz, s + 19) < 0.55)) continue;
          put(wx + dx, y, wz + dz, leaf, true);
        }
      }
      for (let y = h + 1; y <= topY; y++) put(wx, y, wz, birch ? B.BIRCH_LOG : B.LOG, false);
      put(wx, h, wz, B.DIRT, false);
    }

    // Grass tufts and flowers
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const wx = cx * CS + x, wz = cz * CS + z;
      const h = hAt(x + E, z + E);
      if (h + 1 >= CH) continue;
      if (data[(h * CS + z) * CS + x] !== B.GRASS || data[((h + 1) * CS + z) * CS + x] !== B.AIR) continue;
      const dens = 0.14 + Math.max(0, this.noise2.noise2(wx * 0.02 + 50, wz * 0.02)) * 0.35;
      const r = hash2i(wx, wz, s + 23);
      if (r < dens) data[((h + 1) * CS + z) * CS + x] = B.TALLGRASS;
      else if (r < dens + 0.014) data[((h + 1) * CS + z) * CS + x] = hash2i(wx, wz, s + 24) < 0.5 ? B.POPPY : B.DANDELION;
    }
    c.maxY = Math.min(CH - 1, maxY + 1);
  }

  // ---------- access ----------
  getChunk(cx, cz) { return this.chunks.get(key(cx, cz)); }
  ensure(cx, cz) {
    let c = this.chunks.get(key(cx, cz));
    if (!c) { c = new Chunk(cx, cz); this.generate(c); this.chunks.set(key(cx, cz), c); }
    return c;
  }
  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= CH) return B.AIR;
    const c = this.chunks.get(key(x >> 4, z >> 4));
    if (!c) return B.AIR;
    return c.data[(y * CS + (z & 15)) * CS + (x & 15)];
  }
  isSolid(x, y, z) { return SOLID[this.getBlock(x, y, z)] === 1; }

  setBlock(x, y, z, b) {
    if (y < 0 || y >= CH) return;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c) return;
    const lx = x & 15, lz = z & 15;
    const i = (y * CS + lz) * CS + lx;
    const old = c.data[i];
    c.data[i] = b;
    if (y >= c.maxY) c.maxY = Math.min(CH - 1, y + 1);
    const k = `${x},${y},${z}`;
    if (LIGHT[b]) this.lights.set(k, { pos: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), level: LIGHT[b], block: b });
    else if (LIGHT[old]) this.lights.delete(k);
    // Any change near a light source can change the flood-filled light in neighbouring chunks.
    let lit = LIGHT[b] || LIGHT[old];
    if (!lit) for (const L of this.lights.values()) if (Math.abs(L.pos.x - x) < 16 && Math.abs(L.pos.y - y) < 16 && Math.abs(L.pos.z - z) < 16) { lit = true; break; }
    const touched = [];
    if (lit) { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) touched.push([cx + dx, cz + dz]); }
    else {
      touched.push([cx, cz]);
      const ex = lx === 0 ? -1 : lx === 15 ? 1 : 0, ez = lz === 0 ? -1 : lz === 15 ? 1 : 0;
      if (ex) touched.push([cx + ex, cz]);
      if (ez) touched.push([cx, cz + ez]);
      if (ex && ez) touched.push([cx + ex, cz + ez]);
    }
    for (const [tx, tz] of touched) {
      const t = this.chunks.get(key(tx, tz));
      if (t && t.meshes) this.buildMesh(t);
    }
  }

  // Flood a freshly opened hole below sea level from adjacent water.
  flood(x, y, z) {
    const q = [[x, y, z]]; let n = 0;
    const touched = new Set();
    while (q.length && n < 300) {
      const [a, b, c] = q.shift();
      if (b > SEA || this.getBlock(a, b, c) !== B.AIR) continue;
      const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]];
      if (!nb.some(([dx, dy, dz]) => this.getBlock(a + dx, b + dy, c + dz) === B.WATER)) continue;
      const ch = this.chunks.get(key(a >> 4, c >> 4)); if (!ch) continue;
      ch.data[(b * CS + (c & 15)) * CS + (a & 15)] = B.WATER; n++;
      touched.add(key(a >> 4, c >> 4));
      q.push([a + 1, b, c], [a - 1, b, c], [a, b - 1, c], [a, b, c + 1], [a, b, c - 1]);
    }
    for (const k of touched) { const ch = this.chunks.get(k); if (ch && ch.meshes) this.buildMesh(ch); }
    return n > 0;
  }

  surfaceY(x, z, fromY) {
    for (let y = Math.min(CH - 1, fromY); y >= 0; y--) if (SOLID[this.getBlock(x, y, z)]) return y + 1;
    return 0;
  }

  // ---------- block light (flood fill from emitters, baked into vertices) ----------
  computeLight(c) {
    const x0 = c.cx * CS - 15, z0 = c.cz * CS - 15, W = CS + 30;
    const em = [];
    for (const L of this.lights.values()) {
      const p = L.pos;
      if (p.x >= x0 - 1 && p.x < x0 + W + 1 && p.z >= z0 - 1 && p.z < z0 + W + 1) em.push(L);
    }
    if (!em.length) return null;
    let ylo = CH, yhi = 0;
    for (const L of em) { ylo = Math.min(ylo, Math.floor(L.pos.y) - 15); yhi = Math.max(yhi, Math.floor(L.pos.y) + 15); }
    ylo = Math.max(0, ylo); yhi = Math.min(CH - 1, yhi);
    const H = yhi - ylo + 1;
    const lv = new Uint8Array(W * W * H);
    const idx = (x, y, z) => ((y - ylo) * W + (z - z0)) * W + (x - x0);
    const q = [];
    for (const L of em) {
      const x = Math.floor(L.pos.x), y = Math.floor(L.pos.y), z = Math.floor(L.pos.z);
      if (x < x0 || x >= x0 + W || z < z0 || z >= z0 + W) continue;
      const i = idx(x, y, z);
      if (lv[i] < L.level) { lv[i] = L.level; q.push(x, y, z); }
    }
    const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let h = 0; h < q.length; h += 3) {
      const x = q[h], y = q[h + 1], z = q[h + 2];
      const l = lv[idx(x, y, z)];
      if (l <= 1) continue;
      for (const [dx, dy, dz] of N6) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < x0 || nx >= x0 + W || nz < z0 || nz >= z0 + W || ny < ylo || ny > yhi) continue;
        const j = idx(nx, ny, nz);
        if (lv[j] >= l - 1) continue;
        if (OPAQUE[this.getBlock(nx, ny, nz)]) continue;
        lv[j] = l - 1; q.push(nx, ny, nz);
      }
    }
    // Sampler in chunk-local coords.
    return (lx, y, lz) => {
      if (y < ylo || y > yhi) return 0;
      return lv[((y - ylo) * W + (lz + 15)) * W + (lx + 15)];
    };
  }

  // ---------- meshing ----------
  buildMesh(c) {
    const pad = this.pad;
    pad.fill(0);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.chunks.get(key(c.cx + dx, c.cz + dz));
      if (!n) continue;
      const x0 = dx === -1 ? 15 : 0, x1 = dx === 1 ? 0 : 15;
      const z0 = dz === -1 ? 15 : 0, z1 = dz === 1 ? 0 : 15;
      for (let y = 0; y <= n.maxY; y++) for (let z = z0; z <= z1; z++) {
        const pz = z + 1 + dz * CS;
        const src = (y * CS + z) * CS, dst = (y * P + pz) * P + 1 + dx * CS;
        for (let x = x0; x <= x1; x++) pad[dst + x] = n.data[src + x];
      }
    }
    const top = Math.min(CH - 1, c.maxY);
    const bufs = [new Buf(), new Buf()];
    const at = (x, y, z) => (y < 0 ? B.BEDROCK : y >= CH ? B.AIR : pad[(y * P + z + 1) * P + x + 1]);
    const light = this.computeLight(c);
    const L = light ? (x, y, z) => light(x, y, z) / 15 : () => 0;

    for (let y = 0; y <= top; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const b = pad[(y * P + z + 1) * P + x + 1];
      const k = KIND[b];
      if (k === K.NONE || k === K.WATER) continue;
      if (k === K.PLANT) { this.plant(bufs[1], x, y, z, b, c, L(x, y, z)); continue; }
      if (k === K.TORCH) { emitTorch(bufs[1], x, y, z, b, Math.max(L(x, y, z), 14 / 15)); continue; }
      if (k === K.STAIRS) { emitStairs(bufs[0], x, y, z, b, at, L); continue; }
      const buf = k === K.OPAQUE ? bufs[0] : bufs[1];
      const leaves = b === B.LEAVES || b === B.BIRCH_LEAVES;
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        const nb = at(x + F.n[0], y + F.n[1], z + F.n[2]);
        if (OPAQUE[nb]) continue;
        if (nb === b && !leaves) continue;
        if (y + F.n[1] < 0) continue;
        const tile = f === 2 ? TEX_TOP[b] : f === 3 ? TEX_BOT[b] : TEX_SIDE[b];
        const uv = UV[tile];
        const sub = nb === B.WATER ? 1 : 0;
        const ao = [0, 0, 0, 0], bl = [0, 0, 0, 0];
        const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
        const l0 = light ? light(nx, ny, nz) : 0;
        for (let v = 0; v < 4; v++) {
          const [s1, s2, cr] = F.ao[v];
          const b1 = at(x + s1[0], y + s1[1], z + s1[2]), b2 = at(x + s2[0], y + s2[1], z + s2[2]), b3 = at(x + cr[0], y + cr[1], z + cr[2]);
          const a = AO_OCC[b1], bq = AO_OCC[b2], cc = AO_OCC[b3];
          ao[v] = a && bq ? 0 : 3 - (a + bq + cc);
          if (light) {
            // smooth light: average the face-neighbour cell with its non-opaque edge/corner cells
            let sum = l0, n = 1;
            if (!OPAQUE[b1]) { sum += light(x + s1[0], y + s1[1], z + s1[2]); n++; }
            if (!OPAQUE[b2]) { sum += light(x + s2[0], y + s2[1], z + s2[2]); n++; }
            if (!OPAQUE[b3] && !(OPAQUE[b1] && OPAQUE[b2])) { sum += light(x + cr[0], y + cr[1], z + cr[2]); n++; }
            bl[v] = sum / n / 15;
          }
        }
        const base = buf.n;
        for (let v = 0; v < 4; v++) {
          const cv = F.c[v];
          buf.pos.push(x + cv[0], y + cv[1], z + cv[2]);
          buf.nrm.push(F.n[0], F.n[1], F.n[2]);
          buf.uv.push(QUAD_UV[v][0] ? uv[2] : uv[0], QUAD_UV[v][1] ? uv[3] : uv[1]);
          const s = AO_SHADE[ao[v]];
          buf.col.push(s, s, s);
          buf.fx.push(leaves ? 1 : 0, sub, bl[v]);
        }
        if (ao[0] + ao[2] < ao[1] + ao[3]) buf.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
        else buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        buf.n += 4;
      }
    }

    if (!c.meshes) c.meshes = [null, null];
    for (let i = 0; i < 2; i++) {
      const buf = bufs[i];
      let mesh = c.meshes[i];
      if (mesh) { mesh.geometry.dispose(); }
      if (buf.n === 0) {
        if (mesh) { this.group.remove(mesh); c.meshes[i] = null; }
        continue;
      }
      const g = bufToGeometry(buf);
      if (!mesh) {
        mesh = new THREE.Mesh(g, i === 0 ? this.materials.opaque : this.materials.cutout);
        mesh.position.set(c.cx * CS, 0, c.cz * CS);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        this.group.add(mesh);
        c.meshes[i] = mesh;
      } else mesh.geometry = g;
    }
    c.dirty = false;
    c.meshed = true;
  }

  plant(buf, x, y, z, b, c, bl = 0) {
    const uv = UV[TEX_SIDE[b]];
    const wx = c.cx * CS + x, wz = c.cz * CS + z;
    const ox = (hash2i(wx, wz, 91) - 0.5) * 0.3, oz = (hash2i(wx, wz, 92) - 0.5) * 0.3;
    const hgt = b === B.TALLGRASS ? 0.75 + hash2i(wx, wz, 93) * 0.35 : 0.9;
    emitCross(buf, x + ox, y, z + oz, uv, hgt, true, bl);
  }

  // ---------- streaming ----------
  update(px, pz, R, budgetMs) {
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    const center = `${pcx},${pcz},${R}`;
    if (center !== this.lastCenter) {
      this.lastCenter = center;
      const list = [];
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const d = dx * dx + dz * dz;
        if (d <= R * R + 1) list.push([pcx + dx, pcz + dz, d]);
      }
      list.sort((a, b) => a[2] - b[2]);
      this.order = list;
    }
    const t0 = performance.now();
    let pending = 0;
    for (const [cx, cz] of this.order) {
      const c = this.chunks.get(key(cx, cz));
      if (c && c.meshed && !c.dirty) continue;
      pending++;
      if (performance.now() - t0 > budgetMs) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.ensure(cx + dx, cz + dz);
      this.buildMesh(this.ensure(cx, cz));
      pending--;
    }
    this.pending = pending;

    if (++this.frame % 60 === 0) {
      const lim = (R + 2) * (R + 2);
      for (const c of this.chunks.values()) {
        if (!c.meshes) continue;
        const dx = c.cx - pcx, dz = c.cz - pcz;
        if (dx * dx + dz * dz > lim) {
          for (const m of c.meshes) if (m) { this.group.remove(m); m.geometry.dispose(); }
          c.meshes = null; c.meshed = false; c.dirty = true;
        }
      }
    }
  }

  meshedCount() { let n = 0; for (const c of this.chunks.values()) if (c.meshes) n++; return n; }

  // ---------- raycast (Amanatides & Woo) ----------
  raycast(o, d, maxDist) {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const tdx = sx ? Math.abs(1 / d.x) : Infinity, tdy = sy ? Math.abs(1 / d.y) : Infinity, tdz = sz ? Math.abs(1 / d.z) : Infinity;
    let tmx = sx > 0 ? (x + 1 - o.x) * tdx : sx < 0 ? (o.x - x) * tdx : Infinity;
    let tmy = sy > 0 ? (y + 1 - o.y) * tdy : sy < 0 ? (o.y - y) * tdy : Infinity;
    let tmz = sz > 0 ? (z + 1 - o.z) * tdz : sz < 0 ? (o.z - z) * tdz : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    while (t <= maxDist) {
      const b = this.getBlock(x, y, z);
      const k = KIND[b];
      if (k !== K.NONE && k !== K.WATER) return { x, y, z, nx, ny, nz, block: b, t };
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }
}
