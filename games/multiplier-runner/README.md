# Multiplier Runner

A browser-playable prototype of the "crowd runner shooter" ad genre: one squad, a
stone bridge, math gates that multiply or shred your unit count, and a giant at
the end with its hit points floating over its head.

Everything lives in [`index.html`](index.html) — open the file in any browser and
play. No build step, no assets, no server. Three.js r160 is pulled from jsDelivr
(the only network dependency); all geometry is primitives (capsules for units,
scaled blocks for giants, cylinders for coins) generated at runtime, and physics
is plain disc/ellipse overlap rather than a physics engine.

## Controls

| Input | Action |
| --- | --- |
| Drag (mouse or touch) | Steer the squad across the lanes |
| `←` / `→`, `A` / `D` | Steer with the keyboard |
| `R` | Restart |
| `Space` | Start / restart from an end screen |

Forward movement is automatic and constant.

## Rules

- **Gates.** Every gate row spans the full deck, so you always pass through
  exactly one. Blue gates (`+40`, `×3`) grow the squad; red gates (`-99`, `÷2`)
  cut it down. The squad is also your health bar — at zero units the run ends.
- **Combat.** Units auto-fire at the nearest target ahead. Squad damage scales
  with unit count, so growth is the only real weapon.
- **Enemies.** Red infantry waves carry a shared HP tag; giants block the lane
  and must be killed before you can advance, mauling the crowd while they live.
  Giant and boss hit points are scaled to the squad that arrives, so a lean run
  still gets a fight it can win.
- **Resources.** Gold, wood and food drop from crates along the bridge and from
  kills; they feed the top HUD counters and the end-of-run summary.
- **Ending.** Kill the final boss for the victory screen, or lose every unit for
  the game over screen.

## Tuning

The knobs worth touching are all near the top of the script:

- `CFG` — track width, forward speed, unit caps, spawn distance.
- `buildLevel()` — the whole level as an ordered list of `gates` / `wave` /
  `brute` / `boss` / `loot` events keyed by distance.
- `dps()` and `shotsPerSecond()` — how squad size converts into damage.
