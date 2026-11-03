# Saved speed prefab reference repair — 1.36.83

## Live failure on 1.36.82

After the user's save/reload, session c85493ba62fb47e29a962ed8ad632ea1 contained all 691 roads, including the four central ring edges. All 56 ring car-lane records reverted to 20 km/h with no matching saved policy. Evidence: artifacts/speed82-reloaded-failed.json and speed82-reloaded-discovery.json. The game remains paused. No post-reload speed writes were made.

Read-only examination of the user's FlatRect.cok archive found the SavedRoadSpeed schema and all 56 serialized records, with speed/default 100 km/h, in the decompressed MapData block (artifacts/speed82-mapblock-37.bin). This distinguishes lost serialization from reference mismatch: the data was actually written. Endpoint/middle lane indices in those records match regenerated lane keys.

Native Game.Serialization.PrimaryPrefabReferencesSystem explicitly calls PrefabReferences.Check on built-in prefab references. Ordinary entity deserialization only remaps the saved references to loaded placeholder prefab entities. The custom buffer lacked the native PrefabReferences phase needed to map those placeholders to the active prefab entities; strict matching correctly rejected the mismatched references.

## Change

- SavedRoadSpeedPrefabReferencesSystem participates in SystemUpdatePhase.PrefabReferences before CheckPrefabReferencesSystem, so both save-time referenced-prefab discovery and load-time placeholder resolution cover the custom buffer's road/lane references. It completes dependencies and checks synchronously, guards unresolved references, and retains unmatched policies.
- Serialization layout is unchanged from 1.36.82. The already-saved test map remains the intended verification input; no file patching or guessed lane matching is used.
- Road inspection now reports stored_speed_policy_count and matched_speed_policy_count separately.
- Regression reproduces the missing second mapping stage, then exercises the same ResolvePrefabReferences method used in production, verifies stable save-time checking and restored lane matching.

## Validation

Production build 1.36.83: zero warnings/errors. Five focused tests pass, including the amended two-stage prefab remapping regression and prior speed/font/editor checks. Staged package only; not yet deployed or live-verified. Next: close game, deploy, load the already saved test map without saving the broken loaded state again, inspect stored/matched counts and 100 km/h, then save/reload once more.
