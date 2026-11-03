# Saved road speed repair — 1.36.82

## Reproduction

See EDITOR-RING-SPEED-PERSISTENCE-20261029.md: all four central ring edges changed from 100 to 20 km/h after saving and reloading the test map on 1.36.81. No road upgrade or city creation was needed.

## Implementation

- `SavedRoadSpeed` is a native serialized buffer on the permanent road edge, independent of generated lane entity IDs. Road and lane prefab references use the game's remapping serializer. The match key includes start/middle/end lane indices, endpoint curve positions and carriageway group; it excludes transient path node owner IDs.
- Committed speed edits persist actual/default speed intent. A request equal to the current runtime value can still establish the saved intent. Previews do not modify saved data.
- Commit conflict checks cover both the original lane data and the saved override. Failure rollback and exact undo restore the previous override, including absence of an override.
- `SavedRoadSpeedSystem` runs after custom default migration, while paused in the editor or city. It checks only edges with saved policies once per second, skips roads being rebuilt, and reapplies matching speeds with `PathfindUpdated` and sign refresh. It preserves other lane flags and ignores unmatched/upgraded road prefabs.
- `inspect_road_lanes` reports `saved_speed_limit_kph`; policy previews report the saved before/after speed.
- The custom 160/200 stencil roots no longer inherit the EU-only `ThemeObject`. Native glyph geometry/materials remain unchanged. No runtime geometry generation was added.

## Verification and remaining live checks

Five focused regression tests pass: saved policy serialization/remapped prefabs, generated lane owner changes, 90 km/h restoration, unrelated lane flag preservation, idempotent replacement, undo/removal, mismatch rejection; native font geometry/crops; speed units/readiness; editor access bounds. Production build: zero warnings/errors.

Not yet deployed or verified in the running game. Deployment requires closing Cities2 per build.ps1. After deployment, reapply the lost 100 km/h override (old saves contain no policy to recover), verify `saved_speed_limit_kph`, save/reload in editor and inspect all ring lanes. Include a temporary 90 km/h save/reload test to distinguish persistence from a fixed prefab default. Then create a city from the test map and verify limits and regional 160/200 stencils. The stock 100 km/h stencil remains theme-specific; changing that separate regional glyph mapping is not part of this patch.

## Live editor check — 2026-10-29

Deployed 1.36.82.0 with all six installed file hashes matching staged artifacts. The first loaded map contained no edges; user then loaded the intended test map. Session 0b75aaa6e1ba48b6b561e2994c6b340e, Editor, default tool; paused through MCP. Rediscovered 691 road edges and precisely four central ring edges by exact prefab and all Bezier points within 160 m of origin.

All 56 ring car-lane records initially had actual/default 20 and no saved override. A 90 km/h preview left both live data and saved intent unchanged. Commit set all 56 actual/default/saved values to 90. A subsequent commit restored all 56 to 100 km/h with saved intent 100. No road geometry was changed. Game remains paused; awaiting manual editor save/reload to verify native persistence. Evidence: artifacts/speed82-discovery.json, speed82-initial.json, speed82-preview-no-write.json, speed82-at90.json, speed82-at100.json, and speed82-apply* transaction records.
