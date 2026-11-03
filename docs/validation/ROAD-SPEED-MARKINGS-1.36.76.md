# 1.36.75 live validation and 1.36.76 follow-up

Live editor session 2dfc35a8628b4ceab2f6a07d79a0c510, bridge 1.36.75. Three sampled existing twelve-lane roads report displayed speed160; raw CarLane speed88.888893 confirms the factor1.8 conversion. Two existing edges changed150 then restored160 successfully through preview/build/inspect. No test roads added. Game paused, no automatic save.

Stencil160/200 source assets survived restart and are ready in list_imported_models/get_vehicle_model. New CityWeaver stencil prefabs were absent; log contained no registration message. Root cause: name-only PrefabID lacks saved user asset GUID. 1.36.76 resolves actual loaded StaticObjectData/PrefabData entities by exact name and caches their managed prefab references. Both source models and stock placeholder/template use this path.

Catalog bug also corrected: RoadQueries reads RoadData (runtime m/s), so speed_limit must use FromLane, not FromPrefab. Existing 1.36.75 catalog returned55.5556 for the desired200 highway; this did not alter the actual lane speed.

Formal staged build1.36.76: zero warnings/errors. Two tests passed: road speed units and editor access. New registration, stencil direction/visibility/selection and catalog200/160 remain pending live deployment. The previous build has not visually passed160/200 markings.

Evidence: speed75-lanes.json, speed75-native-lane.json, speed75-live150/restore160 operation results and lane snapshots, speed75-import160/200.json, build-1.36.76.log, tests-1.36.76.log.
