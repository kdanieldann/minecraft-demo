# Characters (PINOC)

Drop GLB/GLTF characters here and list them in `manifest.json`. On load the game uses the
first character as the player avatar (visible in third person, `V`) and cycles the rest
through the wandering NPCs. With no manifest it falls back to the built-in blocky characters.

```json
{
  "player": true,
  "characters": [
    {
      "name": "Explorer",
      "model": "explorer.glb",
      "height": 1.8,
      "yawOffset": 0,
      "animations": { "idle": "explorer_idle.glb", "walk": "explorer_walk.glb", "run": "explorer_run.glb" }
    }
  ]
}
```

- `model` — rigged GLB. Animations embedded in it are used too; clip names containing
  `idle` / `walk` / `run` are matched automatically.
- `animations` — optional extra GLB files whose clips target the same skeleton (e.g. PINOC
  library motions exported for that character).
- `height` — the model is rescaled to this many blocks tall (1 block = 1 m).
- `yawOffset` — radians, if the model doesn't face +Z.
- `colors` — optional `{ "<material-name substring>": "#hex" }` recolor, so several entries can
  share one model. The X Bot materials are `Beta_HighLimbsGeoSG3` (body) and `Beta_Joints_MAT1`.
- Walk/run clips with forward root motion (PINOC library mocap) are played in place; their
  capture speed is used to time-scale the cycle to the character's ground speed.

## PINOC motions on the built-in blocky people

To keep the pixel-art blocky characters but animate them with PINOC mocap, add `blockyMotions`
(with `characters` empty, or omitted):

```json
{ "blockyMotions": { "idle": "xbot_idle.glb", "walk": "xbot_walk.glb", "run": "xbot_run.glb" } }
```

Each file is a PINOC clip exported as `skinned-glb` (Mixamo-named skeleton). On load the clip is
baked onto the six blocky parts: limbs follow shoulder→wrist / hip→ankle, the torso follows the
spine, the head copies the head bone. Swap in any other library clip or generated motion the
same way.

Roles other than `idle` / `walk` / `run` are looping activities an NPC can play
(`npc.greet(seconds)` uses `wave`, `npc.mine(yaw)` uses `mine`). A clip whose last frame doesn't
match its first can be trimmed to a clean loop with `{ "file": "...", "loop": [fromSec, toSec] }`.
Two-handed overhead swings are detected in every clip (`userData.strikes`); a character's
`onStrike` callback fires as the activity passes one.

When both clips are present, the opening scene sets up:
- a friendly NPC (`npc.befriend()`) that wanders like the others but stops, turns and waves
  twice whenever it sees the player — within 9 blocks, in front of it, clear line of sight.
  It waves again only after the player has been >14 blocks away and 15 s have passed;
- a miner with a pickaxe, mining in place; each strike chips particles off the block it hits.

Shipped clips, all `skinned-glb`:

| file | source | credits |
|---|---|---|
| `xbot_idle.glb`, `xbot_walk.glb`, `xbot_run.glb` | library: Standing Idle, Walking, Running | 0 |
| `xbot_wave.glb` | library: Wave Hello | 0 |
| `xbot_mine.glb` | generated: "Pickaxe Strike (4)" (asset `6ecb2087-05d3-43e7-87c7-7b25b68ac960`), 4 s, looped 0.20–3.67 s | 4 |
- `"player": false` keeps the built-in avatar for the player and uses PINOC characters for NPCs only.
