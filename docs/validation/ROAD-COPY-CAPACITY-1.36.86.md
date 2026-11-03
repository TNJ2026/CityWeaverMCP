# Road network copy capacity — 1.36.86

## Request and scope

User requested higher capacity after the 460-edge rectangular district exceeded the former 400-edge bounds selection limit. This patch expands selection and transport capacity. It does not change native curve generation, split-count validation, connected corridor readback, commit authorization or automatic retry semantics. No roads were placed, removed or changed during this code update.

## Limits

| Limit | Previous | New |
| --- | ---: | ---: |
| Bounds-selected source edges | 400 | 2048 |
| Explicit source edge IDs | 128 | 1024 |
| Authenticated request frame, including LF | 8192 bytes | 128 KiB |
| Native response frame | 1,500,000 bytes | 8 MiB |
| MCP client response frame | 2 MiB | 8 MiB |

C# production count checks share RoadCopyLimits; MCP schema uses matching capacity-limits exports. The game's get_capabilities response exposes the four new limits. bridge.json advertises frame sizes, and the client honors the minimum of local/advertised limits, retaining legacy defaults when connecting to an older running mod. No unbounded frame allocation is introduced. Bounds selection still rejects the entire oversized request before tool dispatch, without truncating it.

## Validation

Formal staged build: 1.36.86.0, zero warnings/errors. Sixteen focused tests pass:

- Production count helpers accept 460 edges, accept the 1024/2048 boundaries, reject zero/negative/over-limit counts, and match the MCP/transport constants.
- Real MCP handshake/schema forwarding accepts all 1024 IDs and rejects 1025 before calling the game.
- Loopback transport carries 1024 maximum-length IDs and a >2 MiB result with 2048 segment records.
- Exact 128 KiB UTF-8 request including newline succeeds; one additional byte is rejected. Oversized response rejected. Legacy bridge metadata continues enforcing the old request capacity.
- Production geometry/topology verifier accepts a 2048-edge mixed-prefab network with reversed candidate order, rejects missing edges and mismatched prefabs, and retains the existing copy/connection verification regressions.

One unrelated pre-existing handshake fixture expected the model-composition request without its already-declared default preset; the expected forwarded arguments now include preset=static_object. No production model-composition behavior was changed.

Evidence: artifacts/build-1.36.86.log and artifacts/test-1.36.86.log. Not yet deployed or tested at 2048-edge scale in the running game. Previous auto-split and connection_corridor issues are not declared fixed. After deployment, verify advertised capacities and run a cancel-only large selection preview; a valid native preview is still required before any new construction. Current city contains the completed 360 m-clearance copy and should be saved before exiting for deployment.

## Live capacity verification — 2026-10-29

Deployed1.36.86.0 with six file hashes matching the staged build. Sessionb711a2adcddd41d5b7bf3fd5cbfa8d0e, city拉姆齐. get_query_capabilities reports max_explicit_edges1024, max_area_edges2048, max_request_bytes131072 and max_response_bytes8388608. Endpoint capacity metadata matches; no credentials were copied into test artifacts.

Paused the city and rediscovered1657 permanent roads, including all460 original rectangular district roads. The full460-road district was accepted through bounds selection and reached queued/native preview, proving the former400-road cap is removed. A second preview explicitly supplied all460 session-scoped IDs in a20141-byte argument object, proving the former128-ID/8KiB restrictions are removed in the actual bridge. Both requests returned complete operation records selecting460 roads.

Both native previews then failed the existing OverlapExisting and NETWORK_COPY_GEOMETRY_OR_TOPOLOGY_CHANGED checks. Neither commit was dispatched; neither produced permanent road IDs. No build_road call was made. The uncommitted preview cancellation endpoint was invoked for both terminal failures. Independent final snapshot confirms all1657 permanent road IDs, prefabs, curves, edge endpoints and upgrade flags unchanged. City left paused.

Evidence: artifacts/capacity86-capabilities.json, capacity86-before.json, capacity86-area460-preview/result/cancel.json, capacity86-ids460-preview/result/cancel.json and capacity86-live-verification.json. Live testing validates expanded selection/transport capacity, not successful whole-network construction.2048-edge native gameplay preview performance and the previous geometry/corridor issues remain unverified/unfixed respectively.
