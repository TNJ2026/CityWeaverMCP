# 1.36.76 live diagnosis / 1.36.77 fix

Session8410851a419940b886e9701fccbe2c6a, editor1.36.76. Catalog speeds correctly200/160; existing twelve-lane lane data160. Both custom stencils exist in placeholder candidate pool, but custom160 has TrafficSignData(0,0) and empty SubMesh. Native SecondaryObjectSystem selected stockSpeed120 (prefab12873) on sampled road56825. No visual160 pass claimed.

Cause: RoadSpeedMarkingSystem registered after PrefabSystem, missing the native initialization window. Existing ImportedHelipadMenuSystem documents and uses the required before-PrefabSystem ordering. 1.36.77 moves stencil registration before PrefabSystem; skips Created/Deleted source prefabs. Admission now requires actual expected sign speed320/400, speed-sign bit, nonempty meshes, positive X/Z dimensions and valid ObjectData archetype. Merely allocated components no longer count as ready.

Regression includes observed all-zero asset state, missing mesh, invalid archetype, incorrect speed, valid160 and200. Two related test suites passed. Formal staged build zero warnings/errors. Pending deployment and visual verification. Game paused, no automatic save or geometry changes.

Evidence: speed76-custom-components.json, speed76-pool.json, speed76-road-objects.json, speed76-lanes.json, speed76-prefabs.json, speed76-before.png, build-1.36.77.log, tests-1.36.77.log.
