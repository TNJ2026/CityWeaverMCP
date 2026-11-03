# Saved speed reference phase correction — 1.36.84

## Live 1.36.83 outcome

Editor session 8ec3fa48842648b794dcf17035d12da4, 691 roads preserved. The four central ring edges each report 14 stored policies, zero matched policies, and 20 km/h actual/default speed. No speed mutation was applied. Evidence: artifacts/speed83-reloaded-failed.json and speed83-reloaded-discovery.json. This confirms serialized buffers load but prefab-key resolution remains incorrect.

## Native lifecycle finding

Game.Common.SystemOrder registers CheckPrefabReferencesSystem twice in the PrefabReferences phase (lines 728/730 of the local decompile). UpdateSystem.AddSystemUpdate expands relative registrations for each occurrence. The previous relative registration therefore ran the fix twice. PrefabReferences.Check(ref Entity) assumes its input is an unprocessed loaded prefab placeholder; a second call interprets an active prefab's current index as a saved index and can map it to a different prefab without throwing.

## Correction

- Register the custom system before PrimaryPrefabReferencesSystem, which occurs once in the phase.
- Use native PrefabReferences.Check(EntityManager, Entity), whose load-time LoadedIndex guard preserves already-active prefab references. This is safe if a reference is encountered again.
- Log checked/resolved policy counts for load/save phase diagnosis.
- Extend the production-helper regression with distinct saved-placeholder and active indices, a deliberately non-idempotent raw index map, repeated load checks, and save-time discovery. The previous regression incorrectly modeled active indices as mapping to themselves and missed this lifecycle bug.

Five focused tests pass. Formal staged build and deployment are recorded separately. Live restoration and a subsequent save/reload still require verification; no live success is claimed. The already-saved 1.36.82 test map remains unchanged; a read-only backup is artifacts/speed-persistence-saved-test-map.cok. Current loaded editor state remains paused and should not be saved over the good test input before deployment.

## Live old-save restoration passed — 2026-10-29

Deployed 1.36.84.0 (all six files match staged hashes). Loaded the unmodified saved test map; session bb46e155d50d482697078a466f77d1db. Native reference-phase log: policies=56, resolved=56. All four central ring edges have 14 stored and 14 matched policies each. All 56 car-lane records automatically restored actual/default/saved limits to 100 km/h. No policy writes were issued in this session.

Full speed readback also checked all 397 custom eight-lane highway edges (7,890 car-lane records, all 200 km/h) and all 198 custom twelve-lane road edges (5,502 records, all 160 km/h). All 691 road edges remain present. MCP paused the editor; default tool remains active. Evidence: artifacts/speed84-reloaded-ring.json, speed84-reloaded-discovery.json and speed84-reloaded-summary.json. This verifies recovery of the pre-fix saved policies. Still awaiting a fresh save/reload made with 1.36.84 to cover its save-time reference discovery; city creation and NA stencil appearance remain separate unverified checks.

## Fresh 1.36.84 save/reload passed — 2026-10-29

User saved the restored map using 1.36.84 and reloaded it in the editor. New session 30518124e7954d7b972d7b9dba2580d8 confirms a real reload. Native logs show save-time policies=56, resolved=0 (correct: active references remain unchanged), followed by load-time policies=56, resolved=56. No limit writes were issued after loading.

All four ring edges again contain 14 stored and 14 matched policies each; all 56 actual/default/saved values are 100 km/h. Full highway readback: 397 edges, 7,890 car-lane records, all 200 km/h. Full twelve-lane readback: 198 edges, 5,502 car-lane records, all 160 km/h. All 691 road edges remain present. Editor left paused with the default tool active.

Evidence: artifacts/speed84-save-roundtrip-ring.json, speed84-save-roundtrip-discovery.json and speed84-save-roundtrip-summary.json. Editor map persistence is now verified for both the old 1.36.82 saved data and a fresh 1.36.84 save. New-city creation and NA theme physical stencil appearance have not been reverified in this test and should not be reported as passed.
