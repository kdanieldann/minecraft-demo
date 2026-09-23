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

Roles other than `idle` / `walk` / `run` are activities an NPC can play: looped
(`char.setActivity(name)`, `npc.work(name, yaw)`) or once, optionally backwards
(`char.playOnce(name, { from, to, reverse, after })`). Each entry can be a file name or
`{ "file", "loop", "strikes", "events" }`:
- `loop: [fromSec, toSec]` trims a clip whose ends don't match to a clean loop;
- `strikes` lists swing impacts (detected automatically for overhead swings when omitted) and
  `events: { name: sec }` adds named moments; both reach `char.onEvent(name, { reverse })`.

Clips are turned on load so the hips face +Z on the first frame (some captures face -Z).

## The village (`src/village.js`)

With these clips the opening scene is a village on the biggest flat patch in view of spawn, and
the player starts out facing it. Each villager's job is a different PINOC clip:

| villager | clips | what happens |
|---|---|---|
| greeter | Wave Hello + locomotion | wanders; stops and waves when it sees you (9 blocks, in front, clear line of sight), again only after you've been >14 blocks away and 15 s passed |
| miner | Pickaxe Strike | each strike chips the ground |
| archer | Bow Draw And Release | shoots arrows into a target at the release moment; bow arm is aimed at it |
| guard | Drawing Sword → Sword Idle | draws when you come within 7 blocks, turns to face you, sheathes when you leave |
| porter | Pick Up Object From Ground, Carry Object Walk / Idle | carries crates one by one between two piles (put-down is the pick-up played backwards) |
| lumberjack | Axe Chop | chops the nearest tree trunk; chips fly off it |
| farmer | Hoe Chop | tills a 3×3 dirt patch; each strike kicks up dirt |

Shipped clips, all `skinned-glb`:

| file | source | credits |
|---|---|---|
| `xbot_idle.glb`, `xbot_walk.glb`, `xbot_run.glb` | library: Standing Idle, Walking, Running | 0 |
| `xbot_wave.glb` | library: Wave Hello | 0 |
| `xbot_bow.glb` | library: Bow Draw And Release | 0 |
| `xbot_sword_draw.glb`, `xbot_sword_idle.glb` | library: Drawing Sword, Sword Idle | 0 |
| `xbot_pickup.glb`, `xbot_carry_walk.glb`, `xbot_carry_idle.glb` | library: Pick Up Object From Ground, Carry Object Walk Forward, Carry Object Idle | 0 |
| `xbot_mine.glb` | generated: "Pickaxe Strike (4)" (asset `6ecb2087-05d3-43e7-87c7-7b25b68ac960`), 4 s, looped 0.20–3.67 s | 4 |
| `xbot_chop.glb` | generated: "Axe Chop (2)" (asset `29228e00-6207-452d-92e0-463374d3e700`), 4 s, looped 0–3.53 s | 4 |
| `xbot_hoe.glb` | generated: "Hoe Chop (3)" (asset `b6403cd2-cc79-41f0-b006-378f274bb506`), 4 s, looped 0.20–2.33 s | 4 |

`"player": false` keeps the built-in avatar for the player and uses PINOC characters for NPCs only.
