// Block registry. Tile indices refer to the procedural atlas in textures.js.
import { T } from './textures.js';

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5, LOG: 6, LEAVES: 7, PLANKS: 8,
  COBBLE: 9, SNOW: 10, GLASS: 11, GLOW: 12, TALLGRASS: 13, POPPY: 14, DANDELION: 15,
  COAL: 16, IRON: 17, BRICKS: 18, GRAVEL: 19, BEDROCK: 20, BIRCH_LOG: 21, BIRCH_LEAVES: 22,
  TORCH: 23,            // floor torch; 24..27 wall torches leaning toward +x, -x, +z, -z
  OAK_STAIRS: 28,       // 28..31 ascending toward +x, -x, +z, -z
  COBBLE_STAIRS: 32,    // 32..35
};

// Render kinds
export const K = { NONE: 0, OPAQUE: 1, CUTOUT: 2, PLANT: 3, WATER: 4, TORCH: 5, STAIRS: 6 };

export const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const defs = [];
function def(id, name, kind, top, side = top, bottom = top, extra = {}) {
  defs[id] = { id, name, kind, top, side, bottom, ...extra };
}

def(B.AIR, 'Air', K.NONE, 0);
def(B.GRASS, 'Grass Block', K.OPAQUE, T.GRASS_TOP, T.GRASS_SIDE, T.DIRT);
def(B.DIRT, 'Dirt', K.OPAQUE, T.DIRT);
def(B.STONE, 'Stone', K.OPAQUE, T.STONE);
def(B.SAND, 'Sand', K.OPAQUE, T.SAND);
def(B.WATER, 'Water', K.WATER, 0);
def(B.LOG, 'Oak Log', K.OPAQUE, T.LOG_TOP, T.LOG_SIDE, T.LOG_TOP);
def(B.LEAVES, 'Oak Leaves', K.CUTOUT, T.LEAVES);
def(B.PLANKS, 'Oak Planks', K.OPAQUE, T.PLANKS);
def(B.COBBLE, 'Cobblestone', K.OPAQUE, T.COBBLE);
def(B.SNOW, 'Snow Block', K.OPAQUE, T.SNOW, T.SNOW_SIDE, T.DIRT);
def(B.GLASS, 'Glass', K.CUTOUT, T.GLASS);
def(B.GLOW, 'Glowstone', K.OPAQUE, T.GLOW, T.GLOW, T.GLOW, { light: 15 });
def(B.TALLGRASS, 'Tall Grass', K.PLANT, T.TALLGRASS);
def(B.POPPY, 'Poppy', K.PLANT, T.POPPY);
def(B.DANDELION, 'Dandelion', K.PLANT, T.DANDELION);
def(B.COAL, 'Coal Ore', K.OPAQUE, T.COAL);
def(B.IRON, 'Iron Ore', K.OPAQUE, T.IRON);
def(B.BRICKS, 'Bricks', K.OPAQUE, T.BRICKS);
def(B.GRAVEL, 'Gravel', K.OPAQUE, T.GRAVEL);
def(B.BEDROCK, 'Bedrock', K.OPAQUE, T.BEDROCK);
def(B.BIRCH_LOG, 'Birch Log', K.OPAQUE, T.BIRCH_TOP, T.BIRCH_SIDE, T.BIRCH_TOP);
def(B.BIRCH_LEAVES, 'Birch Leaves', K.CUTOUT, T.BIRCH_LEAVES);
for (let i = 0; i < 5; i++) def(B.TORCH + i, 'Torch', K.TORCH, T.TORCH, T.TORCH, T.TORCH, { light: 14, item: B.TORCH });
for (let i = 0; i < 4; i++) def(B.OAK_STAIRS + i, 'Oak Stairs', K.STAIRS, T.PLANKS, T.PLANKS, T.PLANKS, { item: B.OAK_STAIRS, facing: i });
for (let i = 0; i < 4; i++) def(B.COBBLE_STAIRS + i, 'Cobblestone Stairs', K.STAIRS, T.COBBLE, T.COBBLE, T.COBBLE, { item: B.COBBLE_STAIRS, facing: i });

export const BLOCKS = defs;
const N = 256;
export const KIND = new Uint8Array(N);
export const SOLID = new Uint8Array(N);    // collides with entities
export const OPAQUE = new Uint8Array(N);   // hides neighbour faces, blocks light, casts AO
export const AO_OCC = new Uint8Array(N);   // contributes to ambient occlusion
export const LIGHT = new Uint8Array(N);    // emitted block-light level (0-15)
export const ITEM = new Uint8Array(N);     // canonical inventory item for a (possibly oriented) block
export const TEX_TOP = new Uint8Array(N), TEX_SIDE = new Uint8Array(N), TEX_BOT = new Uint8Array(N);
for (const d of defs) {
  if (!d) continue;
  KIND[d.id] = d.kind;
  SOLID[d.id] = d.kind === K.OPAQUE || d.kind === K.CUTOUT || d.kind === K.STAIRS ? 1 : 0;
  OPAQUE[d.id] = d.kind === K.OPAQUE ? 1 : 0;
  AO_OCC[d.id] = d.kind === K.OPAQUE || d.id === B.LEAVES || d.id === B.BIRCH_LEAVES ? 1 : 0;
  LIGHT[d.id] = d.light || 0;
  ITEM[d.id] = d.item ?? d.id;
  TEX_TOP[d.id] = d.top; TEX_SIDE[d.id] = d.side; TEX_BOT[d.id] = d.bottom;
}

export const isTorch = (b) => b >= B.TORCH && b <= B.TORCH + 4;
export const isStairs = (b) => KIND[b] === K.STAIRS;
export const wallTorchDir = (b) => (b > B.TORCH && b <= B.TORCH + 4 ? DIRS4[b - B.TORCH - 1] : null);

// Collision / model boxes for stairs in unit-cube coords: lower slab + raised back half.
const STAIR_BOXES = [
  [[0, 0, 0, 1, 0.5, 1], [0.5, 0.5, 0, 1, 1, 1]],
  [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 0.5, 1, 1]],
  [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0.5, 1, 1, 1]],
  [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 1, 1, 0.5]],
];
export const stairBoxes = (b) => STAIR_BOXES[BLOCKS[b].facing];

export const HOTBAR = [B.GRASS, B.COBBLE, B.PLANKS, B.OAK_STAIRS, B.LOG, B.GLASS, B.BRICKS, B.TORCH, B.GLOW];

// Everything the creative inventory offers, in display order.
export const INVENTORY = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.SAND, B.GRAVEL, B.SNOW, B.BEDROCK, B.COAL,
  B.IRON, B.LOG, B.PLANKS, B.BIRCH_LOG, B.LEAVES, B.BIRCH_LEAVES, B.GLASS, B.BRICKS, B.GLOW,
  B.TORCH, B.OAK_STAIRS, B.COBBLE_STAIRS, B.TALLGRASS, B.POPPY, B.DANDELION,
];
