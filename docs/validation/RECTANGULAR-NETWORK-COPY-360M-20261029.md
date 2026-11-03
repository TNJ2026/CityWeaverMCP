# Rectangular road copy with 360 m right clearance

City: 拉姆齐, session6039a52315704769a31b356a10d21dd6, CityWeaver1.36.85. User changed the initial request from two copies to one, then requested demolition of that attempt. Demolition was completed and independently verified: original1196 roads unchanged, zero new roads remaining (artifacts/rect-copy-demolition-verification.json).

The final user request was to copy the same rectangular network again, translating right until its right road edge is360m from the twelve-lane road on the right. Used positive worldZ, consistent with camera right; no rotation/vertical shift. Source selection contains398 Small Road and62 Large Road edges,460 edges/299 nodes. Copied only roads; no buildings or zoning occupancy were requested/copied.

## Placement and construction

Source right perimeter road is32m wide; the right-hand twelve-lane road is50m wide along approximatelyZ=0. Translation isX=0,Z=3352.37m. Its boundary is checked against the twelve-lane road's left surface edge rather than its centreline.

The source exceeds the400-edge bounds-copy limit. Partitioned it into346 and114 edges with7 shared junctions. A separately committed perimeter anchor allowed native connected-course reconstruction. The main345-edge batch committed but its operation returned outcome_unknown/NETWORK_COPY_READBACK_FAILED (connection_corridor). This was not replayed. Independent readback found346 roads/222 nodes, one connected component, with every source node uniquely mapped and matching directed edges/prefabs/upgrades.

Remaining114-edge preview revealed a native split of one222m perimeter course into two road edges. The strict network-copy validator rejected the114->115 count change before commit. Committed the other113 edges with all13 incident seam roads allowlisted; this also returned connection_corridor during post-commit validation and was not replayed. Fresh readback showed459 roads/299 nodes, one component and all source nodes uniquely mapped. The last course was then built through ordinary preview_road with mapped node attachments and the native reconstructed cubic controls. That operation completed and returned two road IDs. The subdivided course preserves its physical centreline and adds only a degree-two node.

## Independent final verification

Evidence: artifacts/rect360-final-readback.json, rect360-final-verification.json, verify-rect360-final.mjs and rect360-final-view.png.

- Original1196 roads retain exactly the same IDs, curves, edge endpoints, prefabs and upgrade flags.
- Added461 road edges/300 nodes in one connected component; all460 original source edges map to directed same-prefab/same-upgrade paths, with the one long edge mapping to its two subdivisions. Every copied edge is covered exactly once.
- All299 source nodes map uniquely to translated nodes. The extra node subdivides the last course; cycle rank is preserved.
- Maximum sampled distance of copied centreline curves from their intended native reconstructed courses:0.000265m.
- Measured road-surface edge clearance to the twelve-lane axis, subtracting its25m half-width and the copied road's projected half-width:360.00195m. Numerical tolerance0.05m; actual result within0.002m.
- No second copy was constructed. City left paused, ordinary selection tool. No save was performed.

The two connected-copy operation journals remain outcome_unknown; this document does not relabel them completed. Their actual scene outcomes were resolved by independent geometry/topology readback, with no replay of either mutation. The construction request itself is fully verified in the final scene.
