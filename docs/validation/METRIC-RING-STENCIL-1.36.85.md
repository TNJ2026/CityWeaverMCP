# Metric ring pavement stencil — 1.36.85

## Reproduction

User reports 65 painted on the ring after speed persistence passed on 1.36.84. Session 30518124e7954d7b972d7b9dba2580d8 remains in the editor, paused. Screenshot artifacts/ring65-screen.png confirms six visible 65 labels. Independent road readback confirms all 56 actual/default/saved values remain 100 km/h (speed84-save-roundtrip-ring.json).

The ring's speed stencil prefab has native TrafficSignData.m_SpeedLimit=200 and type mask 1024, with a theme requirement. This is the same internal speed used for EU100 and NA65. Evidence: speed84-ring-sign-diagnosis.json and speed84-current-sign-prefabs.json. The actual speed is correct; the regional pavement label is incorrect for this custom metric road.

## Change

- Add a theme-independent custom 100 stencil using the existing original-font 1/0 glyphs and previously imported projector geometry, matching the 160/200 composition path. No geometry files are created at load time.
- Keep 100 out of the shared native placeholder pool, where its score would tie NA65/EU100 and could affect stock roads.
- Once per second, correct speed pavement objects belonging to the three exact CityWeaver road prefabs, binding them to the initialized 100/160/200 stencil matching the road's uniform default lane limit and the object's native speed metadata.
- Require a pavement-stencil name and speed-only traffic-sign mask. Skip mixed lane limits, unsupported speeds, unrelated roadside signs, roads being rebuilt, and native theme selection still in progress. Gather all changes before adding Updated, following the existing road tree replacement pattern. Native object rendering handles the PrefabRef/Updated change.
- The correction does not write lane limits, persisted policies, geometry, stop/yield signs or any stock road's pavement objects.

## Validation

Six focused regression tests pass, including NA65 metadata -> metric100 when actual speed is 100; supported 160/200; preservation of stock roads, roadside and unrelated signs; rejection of actual65, unsupported90, mismatched native speed and invalid lane speed; correct 100/160/200 glyph order. Existing speed serialization, editor access, units/readiness and native font geometry tests also pass.

Production staged build and deployment tracked in their versioned artifacts. Not yet deployed or visually verified. After deployment load the saved test map, verify all ring actual/default/saved values remain 100, pavement prefab references use the custom100 root, and visually inspect the same camera view. Check stable correction counts and a save/reload before claiming persistence of the displayed style.

## First live verification passed — 2026-10-29

Deployed 1.36.85.0, six installed hashes match staged files. Session 89349cf53c9943899cbc57b664586c55, editor paused/default tool. All four ring edges again have 14 stored/matched policies each and all 56 actual/default/saved values remain 100 km/h. Independently followed every ring SubObject: all 24 speed-sign objects use the same custom100 prefab (48706:5) with native speed metadata 200; no NA65 prefab remains among ring speed stencils. Evidence: speed85-loaded-ring-lanes.json, speed85-loaded-discovery.json, speed85-ring-sign-diagnosis.json.

The first MCP capture was too distant for reliable reading. A subsequent read-only computer-use window observation showed that the user had already zoomed in: all six visible pavement labels clearly read 100. No computer-use input was needed. MCP close-up capture retained at artifacts/speed85-ring-close.png. The log contains only one correction event (12 replacements at 15:12:56), with no repeated corrections through 15:15, while the other 12 ring stencils already use the same target. Awaiting one fresh save/reload to check displayed-style persistence; no save/reload success claimed yet.
