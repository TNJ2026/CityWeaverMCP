# Road network copy geometry and readback repair — 1.36.87

## Reproduced causes

1. Independent copy used clipped Curve endpoints as shared junction positions. The460-edge district therefore produced OverlapExisting and geometry/topology errors even in empty land. Connected mode already reconstructed a course from actual nodes; independent mode now uses that same native fit.
2. The native tool split the last222m perimeter course into two edges. Strict edge-count equality rejected the otherwise valid114-to115 preview. The user-authorized final build retained all460 source paths as461 edges/300 nodes instead of299 nodes.
3. Apply deleted the temporary corridor replacement and retained the original road entity. In the captured346-edge partial copy the listed replacement remnant no longer existed, but both target endpoint IDs survived and the original corridor remained correctly connected. The old verifier failed immediately when it saw the deleted temporary entity.

## Implementation

- Plan every copy from transformed source Node positions plus original directed tangents through native NetUtils.FitCurve. Preserve original clipping allowances when applying explicit connections; height/elevation validation remains native.
- Verify each source edge as a unique same-prefab/same-upgrade directed path. All original junctions map bijectively within0.35m. Native subdivision nodes must have degree two and cannot coincide with another source junction or alias an existing foreign node. Every candidate road is used exactly once. Centreline shape tolerance remains0.5m; monotonic progress, internal curve/node continuity and bounded endpoint trimming are checked.
- Apply the same verifier to preview and permanent readback, including explicit connections. Missing roads, direction changes, changed prefabs/upgrades, branches, ambiguity, extra roads and unexpected external adjacency still reject the copy.
- Ignore stale deleted temporary remnants only while proving the actual surviving corridor. Include a retained original edge using its actual geometric interval where it fills a non-overlapping gap; require complete coverage, connected endpoint identities and binding-node membership. A missing or truncated corridor remains a failure.
- Existing capacity limits remain2048 bounds-selected/1024 explicit IDs with128KiB/8MiB transport. Native game errors and building replacement checks still block commit. No automatic commit retry is introduced.

## Regression evidence

Sixteen focused tests pass (artifacts/test-1.36.87.log), including the production path verifier on a2048-edge mixed-prefab network and anonymized actual460-source/461-result scene data in mcp/test/fixtures/road-copy-460-native.json. The real scene fixture maps all299 original nodes onto300 result nodes without requiring an artificial anchor. Tests exercise missing/reversed/changed split pieces, physical gaps, off-course bends, foreign attachments, retained originals after temp deletion, retained partial corridors, and complete mixed original/replacement corridors.

Formal staged build1.36.87.0: zero warnings/errors (artifacts/build-1.36.87.log). No city mutations were made during this code repair. Deployment/live preview verification still pending; no successful live one-shot copy is claimed yet. Next: save/close game, deploy, preview the full460-edge original district in empty land and cancel without building; then validate a small explicit-connected preview and controlled apply/readback if needed. Existing completed360m-clearance copy should remain unchanged.

## Live preview validation passed — 2026-10-29

Deployed1.36.87.0 (six installed file hashes match staged package). Loaded city拉姆齐, sessiondb8e71a3f9444d3ab88496c043b899ea. Baseline1673 permanent roads; full source selection remains460 roads/299 original junctions.

The first whole-network preview was cancelled by a tool change without commit. A new request then reached preview_ready/can_commit=true with no game errors or copy-validation failure. Native log for operation5f3dcbce427644c09a0e8ee0da5373a1: cost275536, edges461, split_remnants0. Thus the full460-source selection, actual node-course reconstruction and automatic subdivision passed in one native preview without a temporary anchor. The operation was cancelled, not committed.

Also previewed two connected Small Road source edges transversely across an explicitly allowlisted, clear degree-two junction between two existing twelve-lane road edges. Operation37bc4c16658b40819e472a5f494bf439 reached preview_ready/can_commit=true, no errors, no copy failure, cost1376; then cancelled without commit. This exercises live temporary corridor coverage and source-node binding.

Independent final snapshot proves all1673 permanent road IDs, prefabs, curves, edge endpoints and upgrade flags unchanged. Both successful previews report cancelled, commit_dispatched=false and no created permanent road IDs. No build_road call was made. City left paused.

Evidence: artifacts/copy87-before.json, copy87-full460-retry-preview/result/cancel.json, copy87-connected-preview/result/cancel.json and copy87-live-verification.json. Actual post-commit corridor readback is covered by regressions (including surviving original/deleted temp) but was not live-applied in this test because the user was promised preview-only verification. No successful permanent one-shot copy is claimed from this run.
