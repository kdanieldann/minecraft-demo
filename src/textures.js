// Procedurally painted 16x16 block textures packed into padded atlases
// (albedo / normal / roughness / emissive) so blocks get full PBR shading.
import * as THREE from 'three';
import { mulberry32, hash2i } from './noise.js';

export const T = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7,
  PLANKS: 8, COBBLE: 9, SNOW: 10, SNOW_SIDE: 11, GLASS: 12, GLOW: 13, TALLGRASS: 14, POPPY: 15,
  DANDELION: 16, COAL: 17, IRON: 18, BRICKS: 19, GRAVEL: 20, BEDROCK: 21, BIRCH_SIDE: 22,
  BIRCH_TOP: 23, BIRCH_LEAVES: 24, TORCH: 25,
};
const COUNT = 26;
const S = 16, CELL = 32, PAD = 8, COLS = 8, ATLAS = 256;

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

class Tile {
  constructor(seed) {
    this.d = new Uint8ClampedArray(S * S * 4);
    this.r = mulberry32(seed);
    this.seed = seed;
    this.rough = 0.8; this.bump = 1; this.emit = false;
    this.roughPx = new Float32Array(S * S).fill(-1);
    this.emitMask = null;
  }
  set(x, y, c, a = 255) {
    x = ((x % S) + S) % S; y = ((y % S) + S) % S;
    const i = (y * S + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  get(x, y) {
    x = ((x % S) + S) % S; y = ((y % S) + S) % S;
    const i = (y * S + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  vary(c, amt) { return mul(c, 1 + (this.r() - 0.5) * amt); }
}

// Tileable value noise over the 16px tile.
function tnoise(x, y, cells, seed) {
  const fx = (x / S) * cells, fy = (y / S) * cells;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const w = (i) => ((i % cells) + cells) % cells;
  const h = (i, j) => hash2i(w(i), w(j), seed);
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  return lerp(lerp(h(x0, y0), h(x0 + 1, y0), sx), lerp(h(x0, y0 + 1), h(x0 + 1, y0 + 1), sx), sy);
}

// Toroidal voronoi: returns [nearestIndex, d1, d2]
function voronoi(x, y, pts) {
  let d1 = 1e9, d2 = 1e9, idx = 0;
  for (let i = 0; i < pts.length; i++) {
    let dx = Math.abs(x - pts[i][0]); dx = Math.min(dx, S - dx);
    let dy = Math.abs(y - pts[i][1]); dy = Math.min(dy, S - dy);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < d1) { d2 = d1; d1 = d; idx = i; } else if (d < d2) d2 = d;
  }
  return [idx, d1, d2];
}

const P = {};
P.dirt = (t) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let c = mix([108, 76, 50], [146, 106, 72], tnoise(x, y, 4, 3) * 0.7 + tnoise(x, y, 8, 4) * 0.3);
    c = t.vary(c, 0.18);
    const r = t.r();
    if (r < 0.08) c = [86, 58, 38]; else if (r < 0.11) c = t.vary([128, 120, 108], 0.1);
    t.set(x, y, c);
  }
  t.bump = 1.6; t.rough = 0.92;
};
P.grassTop = (t) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let c = mix([62, 116, 34], [110, 168, 56], tnoise(x, y, 4, 1) * 0.6 + tnoise(x, y, 8, 2) * 0.4);
    c = t.vary(c, 0.16);
    if (t.r() < 0.07) c = [132, 186, 72];
    t.set(x, y, c);
  }
  t.bump = 1.2; t.rough = 0.85;
};
P.grassSide = (t) => {
  P.dirt(t);
  for (let x = 0; x < S; x++) {
    const depth = 3 + (hash2i(x, 0, 11) < 0.55 ? 1 : 0) + (hash2i(x, 1, 11) < 0.25 ? 1 : 0);
    for (let y = 0; y < depth; y++) {
      let c = t.vary(mix([60, 112, 32], [100, 156, 50], tnoise(x, y, 4, 9)), 0.14);
      if (y === depth - 1 && t.r() < 0.5) c = mul(c, 0.78);
      t.set(x, y, c);
    }
  }
  t.bump = 1.5; t.rough = 0.9;
};
P.stone = (t) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = tnoise(x, y, 4, 21) * 0.55 + tnoise(x, y, 8, 22) * 0.3 + tnoise(x, y, 16, 23) * 0.15;
    let v = lerp(104, 146, n);
    if (tnoise(x, y * 0.5, 8, 24) > 0.78) v *= 0.82;
    const c = t.vary([v, v, v * 1.02], 0.07);
    t.set(x, y, c);
  }
  t.bump = 2.2; t.rough = 0.82;
};
P.cobble = (t) => {
  const pts = []; for (let i = 0; i < 7; i++) pts.push([t.r() * S, t.r() * S]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const [i, d1, d2] = voronoi(x + 0.5, y + 0.5, pts);
    let c;
    if (d2 - d1 < 1.15) c = t.vary([58, 58, 60], 0.1);
    else {
      const base = 96 + hash2i(i, 5, t.seed) * 62;
      const hl = (pts[i][1] - (y + 0.5)) * 2.2 + (pts[i][0] - (x + 0.5)) * 1.2;
      const v = base + hl + (t.r() - 0.5) * 14;
      c = [v, v, v * 1.01];
    }
    t.set(x, y, c);
  }
  t.bump = 3.2; t.rough = 0.85;
};
P.sand = (t) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let c = t.vary(mix([210, 194, 146], [232, 220, 174], tnoise(x, y, 4, 31)), 0.07);
    if (t.r() < 0.06) c = [186, 170, 124];
    t.set(x, y, c);
  }
  t.bump = 0.9; t.rough = 0.95;
};
P.gravel = (t) => {
  const pts = []; for (let i = 0; i < 11; i++) pts.push([t.r() * S, t.r() * S]);
  const pal = [[120, 114, 108], [142, 135, 128], [96, 90, 86], [150, 132, 112], [110, 108, 112]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const [i, d1, d2] = voronoi(x + 0.5, y + 0.5, pts);
    let c = t.vary(pal[Math.floor(hash2i(i, 3, t.seed) * pal.length)], 0.1);
    if (d2 - d1 < 0.8) c = mul(c, 0.65);
    t.set(x, y, c);
  }
  t.bump = 2.6; t.rough = 0.9;
};
P.logSide = (t) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = 0.55 * hash2i(x, 0, 41) + 0.45 * tnoise(x, y, 2, 42);
    let c = mix([74, 56, 32], [118, 92, 56], v);
    if (hash2i(x, 1, 43) < 0.28) c = mul(c, 0.78);
    t.set(x, y, t.vary(c, 0.08));
  }
  t.bump = 2.4; t.rough = 0.88;
};
function logTop(t, bark, light, dark) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    let c;
    if (d > 6.9 || x === 0 || y === 0 || x === 15 || y === 15) c = t.vary(bark, 0.1);
    else {
      const ring = 0.5 + 0.5 * Math.sin(d * 2.3 + tnoise(x, y, 4, 51) * 1.6);
      c = t.vary(mix(dark, light, ring), 0.06);
    }
    t.set(x, y, c);
  }
  t.bump = 1.4; t.rough = 0.8;
}
P.logTop = (t) => logTop(t, [96, 74, 44], [178, 144, 90], [146, 114, 68]);
P.birchTop = (t) => logTop(t, [214, 212, 204], [206, 186, 134], [178, 158, 108]);
P.birchSide = (t) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    t.set(x, y, t.vary(mix([200, 198, 190], [226, 224, 216], tnoise(x, y, 4, 61)), 0.05));
  }
  for (let k = 0; k < 7; k++) {
    const y = Math.floor(t.r() * S), x0 = Math.floor(t.r() * S), len = 2 + Math.floor(t.r() * 4);
    for (let i = 0; i < len; i++) t.set(x0 + i, y, t.vary([46, 42, 38], 0.2));
    if (t.r() < 0.5) t.set(x0 + 1, y + 1, [70, 66, 60]);
  }
  t.bump = 1.6; t.rough = 0.7;
};
function leaves(t, a, b) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let c = t.vary(mix(a, b, tnoise(x, y, 4, 71) * 0.7 + t.r() * 0.3), 0.12);
    const hole = t.r() < 0.2;
    if (!hole && t.r() < 0.1) c = mul(c, 0.7);
    t.set(x, y, c, hole ? 0 : 255);
  }
  t.bump = 1.0; t.rough = 0.62;
}
P.leaves = (t) => leaves(t, [38, 84, 26], [86, 142, 50]);
P.birchLeaves = (t) => leaves(t, [74, 110, 38], [132, 172, 70]);
P.planks = (t) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const board = y >> 2;
    let c;
    if ((y & 3) === 3) c = [102, 78, 44];
    else {
      const g = 0.5 + 0.5 * Math.sin(x * 0.85 + hash2i(board, 0, 81) * 6.3 + tnoise(x, y, 4, 82) * 3);
      c = mix([146, 114, 66], [182, 146, 90], g * 0.7 + hash2i(board, 1, 83) * 0.3);
      if (x === (board * 7 + 3) % 16) c = mul(c, 0.72);
    }
    t.set(x, y, t.vary(c, 0.05));
  }
  t.bump = 1.8; t.rough = 0.6;
};
P.bricks = (t) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = y >> 2;
    const off = row & 1 ? 4 : 0;
    const mortar = (y & 3) === 3 || ((x + off) & 7) === 7;
    let c;
    if (mortar) c = t.vary([172, 166, 156], 0.06);
    else {
      const id = row * 4 + ((x + off) >> 3);
      c = t.vary(mul([152, 74, 56], 0.86 + hash2i(id, 7, 91) * 0.28), 0.08);
    }
    t.set(x, y, c);
  }
  t.bump = 3.0; t.rough = 0.78;
};
P.snow = (t) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    t.set(x, y, t.vary(mix([222, 232, 246], [246, 250, 255], tnoise(x, y, 4, 101)), 0.03));
  }
  t.bump = 0.7; t.rough = 0.42;
};
P.snowSide = (t) => {
  P.dirt(t);
  for (let x = 0; x < S; x++) {
    const depth = 3 + (hash2i(x, 0, 111) < 0.5 ? 1 : 0) + (hash2i(x, 1, 111) < 0.2 ? 1 : 0);
    for (let y = 0; y < depth; y++) t.set(x, y, t.vary([236, 242, 250], 0.04));
  }
  t.bump = 1.4; t.rough = 0.6;
};
P.glass = (t) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const glint = (x - y === 4 && x > 5 && x < 10) || (x - y === 6 && x > 7 && x < 10) || (x === 2 && y === 2);
    t.set(x, y, edge ? [196, 222, 232] : glint ? [236, 246, 250] : [196, 222, 232], edge || glint ? 255 : 0);
  }
  t.bump = 0.3; t.rough = 0.05;
};
P.glow = (t) => {
  const pts = []; for (let i = 0; i < 8; i++) pts.push([t.r() * S, t.r() * S]);
  const pal = [[255, 236, 160], [248, 200, 110], [230, 164, 76], [255, 250, 214]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const [i, d1, d2] = voronoi(x + 0.5, y + 0.5, pts);
    let c = t.vary(pal[Math.floor(hash2i(i, 9, t.seed) * pal.length)], 0.08);
    if (d2 - d1 < 0.9) c = [150, 100, 48];
    t.set(x, y, c);
  }
  t.bump = 1.8; t.rough = 0.5; t.emit = true;
};
function clearTile(t, c) { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, c, 0); }
P.tallgrass = (t) => {
  clearTile(t, [88, 146, 50]);
  for (let b = 0; b < 9; b++) {
    const x0 = 1 + Math.floor(t.r() * 14), h = 6 + Math.floor(t.r() * 9), lean = (t.r() - 0.5) * 0.4;
    for (let i = 0; i < h; i++) {
      const x = Math.round(x0 + lean * i);
      t.set(x, 15 - i, t.vary(mix([52, 98, 30], [124, 182, 70], i / h), 0.1));
    }
  }
  t.bump = 0.5; t.rough = 0.7;
};
P.poppy = (t) => {
  clearTile(t, [60, 110, 40]);
  for (let y = 8; y < 16; y++) t.set(7, y, [56, 108, 38]);
  [[6, 11], [5, 10], [8, 12], [9, 11]].forEach(([x, y]) => t.set(x, y, [70, 128, 44]));
  for (let y = 2; y < 9; y++) for (let x = 4; x < 11; x++) {
    const d = Math.hypot(x - 7, y - 5);
    if (d < 2.8) t.set(x, y, d > 1.9 ? [150, 22, 26] : t.vary([206, 34, 32], 0.08));
  }
  t.set(7, 5, [42, 30, 22]);
  t.bump = 0.5; t.rough = 0.6;
};
P.dandelion = (t) => {
  clearTile(t, [60, 110, 40]);
  for (let y = 8; y < 16; y++) t.set(8, y, [60, 116, 40]);
  [[7, 13], [6, 12], [9, 12], [10, 11]].forEach(([x, y]) => t.set(x, y, [72, 130, 46]));
  for (let y = 3; y < 10; y++) for (let x = 5; x < 12; x++) {
    const d = Math.hypot(x - 8, y - 6);
    if (d < 2.4) t.set(x, y, t.vary(d > 1.5 ? [236, 196, 30] : [255, 232, 90], 0.06));
  }
  t.bump = 0.5; t.rough = 0.6;
};
function ore(t, cols, rough) {
  P.stone(t);
  for (let k = 0; k < 4; k++) {
    const cx = t.r() * S, cy = t.r() * S;
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
      if (Math.hypot(x, y) < 1.7 && t.r() < 0.8) {
        const px = Math.floor(cx + x), py = Math.floor(cy + y);
        t.set(px, py, t.vary(cols[Math.floor(t.r() * cols.length)], 0.08));
        if (rough >= 0) t.roughPx[(((py % S) + S) % S) * S + (((px % S) + S) % S)] = rough;
      }
    }
  }
}
P.coal = (t) => ore(t, [[34, 34, 36], [56, 56, 58]], 0.55);
P.iron = (t) => ore(t, [[216, 175, 147], [188, 146, 118], [230, 196, 170]], 0.28);
// Torch: a 2px-wide stick in columns 7-8; rows 6-8 are the flame/ember (the only emissive pixels).
P.torch = (t) => {
  clearTile(t, [120, 90, 50]);
  t.emitMask = new Uint8Array(S * S);
  const flame = [[255, 246, 196], [255, 206, 96], [236, 128, 44]];
  for (let x = 7; x <= 8; x++) {
    for (let y = 6; y <= 8; y++) { t.set(x, y, flame[y - 6]); t.emitMask[y * S + x] = 1; }
    for (let y = 9; y < 16; y++) t.set(x, y, t.vary(x === 7 ? [124, 92, 52] : [96, 70, 38], 0.08));
  }
  t.bump = 0.6; t.rough = 0.7;
};
P.bedrock = (t) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = lerp(34, 118, tnoise(x, y, 8, 131) * 0.6 + t.r() * 0.4);
    t.set(x, y, [v, v, v]);
  }
  t.bump = 2.6; t.rough = 0.9;
};

const ORDER = {
  [T.GRASS_TOP]: P.grassTop, [T.GRASS_SIDE]: P.grassSide, [T.DIRT]: P.dirt, [T.STONE]: P.stone,
  [T.SAND]: P.sand, [T.LOG_SIDE]: P.logSide, [T.LOG_TOP]: P.logTop, [T.LEAVES]: P.leaves,
  [T.PLANKS]: P.planks, [T.COBBLE]: P.cobble, [T.SNOW]: P.snow, [T.SNOW_SIDE]: P.snowSide,
  [T.GLASS]: P.glass, [T.GLOW]: P.glow, [T.TALLGRASS]: P.tallgrass, [T.POPPY]: P.poppy,
  [T.DANDELION]: P.dandelion, [T.COAL]: P.coal, [T.IRON]: P.iron, [T.BRICKS]: P.bricks,
  [T.GRAVEL]: P.gravel, [T.BEDROCK]: P.bedrock, [T.BIRCH_SIDE]: P.birchSide,
  [T.BIRCH_TOP]: P.birchTop, [T.BIRCH_LEAVES]: P.birchLeaves, [T.TORCH]: P.torch,
};

export function tileUV(i) {
  const col = i % COLS, row = Math.floor(i / COLS);
  const u0 = (col * CELL + PAD) / ATLAS;
  const v0 = (ATLAS - row * CELL - PAD - S) / ATLAS;
  return [u0, v0, u0 + S / ATLAS, v0 + S / ATLAS];
}

export function buildAtlas(maxAnisotropy = 8) {
  const tiles = [];
  for (let i = 0; i < COUNT; i++) {
    const t = new Tile(1000 + i * 7919);
    ORDER[i](t);
    // Give fully transparent pixels the tile's mean colour so mipmaps don't bleed dark halos.
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let p = 0; p < S * S; p++) if (t.d[p * 4 + 3] > 0) { sr += t.d[p * 4]; sg += t.d[p * 4 + 1]; sb += t.d[p * 4 + 2]; n++; }
    if (n) for (let p = 0; p < S * S; p++) if (t.d[p * 4 + 3] === 0) { t.d[p * 4] = sr / n; t.d[p * 4 + 1] = sg / n; t.d[p * 4 + 2] = sb / n; }
    tiles.push(t);
  }

  const alb = new Uint8Array(ATLAS * ATLAS * 4);
  const nrm = new Uint8Array(ATLAS * ATLAS * 4);
  const rgh = new Uint8Array(ATLAS * ATLAS * 4);
  const emi = new Uint8Array(ATLAS * ATLAS * 4);
  for (let i = 0; i < ATLAS * ATLAS; i++) { nrm[i * 4] = 128; nrm[i * 4 + 1] = 128; nrm[i * 4 + 2] = 255; nrm[i * 4 + 3] = 255; }

  tiles.forEach((t, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const lum = (x, y) => { const c = t.get(x, y); return c[3] === 0 ? 0.5 : (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255; };
    for (let py = 0; py < CELL; py++) for (let px = 0; px < CELL; px++) {
      const sx = (((px - PAD) % S) + S) % S, sy = (((py - PAD) % S) + S) % S;
      const c = t.get(sx, sy);
      const o = ((ATLAS - 1 - (row * CELL + py)) * ATLAS + col * CELL + px) * 4;
      alb[o] = c[0]; alb[o + 1] = c[1]; alb[o + 2] = c[2]; alb[o + 3] = c[3];
      // Normal from luminance height (Sobel, wrapped inside the tile).
      const dx = (lum(sx + 1, sy - 1) + 2 * lum(sx + 1, sy) + lum(sx + 1, sy + 1)) - (lum(sx - 1, sy - 1) + 2 * lum(sx - 1, sy) + lum(sx - 1, sy + 1));
      const dy = (lum(sx - 1, sy + 1) + 2 * lum(sx, sy + 1) + lum(sx + 1, sy + 1)) - (lum(sx - 1, sy - 1) + 2 * lum(sx, sy - 1) + lum(sx + 1, sy - 1));
      let nx = -dx * t.bump * 0.5, ny = dy * t.bump * 0.5, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      nrm[o] = (nx * 0.5 + 0.5) * 255; nrm[o + 1] = (ny * 0.5 + 0.5) * 255; nrm[o + 2] = (nz * 0.5 + 0.5) * 255;
      let r = t.roughPx[sy * S + sx];
      if (r < 0) r = t.rough + (0.5 - lum(sx, sy)) * 0.12;
      const rv = Math.max(0.03, Math.min(1, r)) * 255;
      rgh[o] = rv; rgh[o + 1] = rv; rgh[o + 2] = rv; rgh[o + 3] = 255;
      if (t.emit || (t.emitMask && t.emitMask[sy * S + sx])) { emi[o] = c[0]; emi[o + 1] = c[1]; emi[o + 2] = c[2]; }
      emi[o + 3] = 255;
    }
  });

  const mk = (data, srgb) => {
    const tex = new THREE.DataTexture(data, ATLAS, ATLAS, THREE.RGBAFormat);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = maxAnisotropy;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    albedo: mk(alb, true), normal: mk(nrm, false), rough: mk(rgh, false), emissive: mk(emi, true),
    tiles,
    tileCanvas(i) {
      const c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d');
      const id = g.createImageData(S, S); id.data.set(tiles[i].d);
      // restore real alpha for icons
      g.putImageData(id, 0, 0);
      return c;
    },
    randomPixel(i, rnd = Math.random) {
      const t = tiles[i];
      for (let k = 0; k < 8; k++) {
        const p = Math.floor(rnd() * S * S) * 4;
        if (t.d[p + 3] > 0) return [t.d[p] / 255, t.d[p + 1] / 255, t.d[p + 2] / 255];
      }
      return [t.d[0] / 255, t.d[1] / 255, t.d[2] / 255];
    },
  };
}

// Isometric block icon for the hotbar.
export function drawBlockIcon(atlas, topTile, sideTile, size = 48) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const k = size / 48;
  const face = (tile, m, shade) => {
    g.save();
    g.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
    g.drawImage(atlas.tileCanvas(tile), 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(0,0,0,${shade})`;
    g.fillRect(0, 0, 16, 16);
    g.restore();
  };
  face(sideTile, [1.375, 0.6875, 0, 1.375, 2, 13], 0.22);
  face(sideTile, [1.375, -0.6875, 0, 1.375, 24, 24], 0.42);
  face(topTile, [1.375, -0.6875, 1.375, 0.6875, 2, 13], 0);
  return c;
}

// Tileable normal map for the water surface (sum of integer-frequency waves + noise).
export function makeWaterNormals(N = 256) {
  const h = new Float32Array(N * N);
  const r = mulberry32(77);
  const waves = [];
  for (let i = 0; i < 64; i++) {
    const ang = r() * Math.PI * 2, mag = 4 + Math.pow(r(), 1.5) * 30;
    const kx = Math.round(Math.cos(ang) * mag), ky = Math.round(Math.sin(ang) * mag);
    if (!kx && !ky) continue;
    waves.push([kx, ky, r() * Math.PI * 2, 1 / Math.pow(Math.hypot(kx, ky), 1.25)]);
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const [kx, ky, ph, a] of waves) v += a * Math.sin(((kx * x + ky * y) / N) * Math.PI * 2 + ph);
    h[y * N + x] = v;
  }
  const data = new Uint8Array(N * N * 4);
  const at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let nx = (at(x - 1, y) - at(x + 1, y)) * 5.0, ny = (at(x, y - 1) - at(x, y + 1)) * 5.0, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * N + x) * 4;
    data[o] = (nx * 0.5 + 0.5) * 255; data[o + 1] = (ny * 0.5 + 0.5) * 255; data[o + 2] = (nz * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}
