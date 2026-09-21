# Planning and construction with CityWeaverMCP (English Agent route)

This is the English decision guide for planning and building a live Cities: Skylines II city. Paths below are relative to the CityWeaverMCP repository, not the installed skill directory. For specialized mechanics, consult the linked project guide and the running MCP tool schema. Do not treat this guide as a fixed tool inventory.

## Find the live city and preserve scope

1. Call `get_game_status`, then `get_query_capabilities` and inspect available MCP tools/schemas. Record city session, loaded/paused state, funds, simulation speed, theme, unlocks, and relevant map data before planning. A menu or loading screen is not a buildable city.
2. Read current purchased tiles, terrain, slope, water, wind, pollution, resources, existing roads, utilities, and outside connections needed for the task. Use actual city data; never substitute an old plan, screenshot, or another save's entity IDs. On session change, discard old IDs, snapshots, previews, and site bindings.
3. Read-only requests authorize queries and proposals, not construction. A request to plan, draw, or preview does not authorize permanent objects. Do not buy tiles, add money, unlock assets, clear vehicles, demolish outside scope, or flatten the whole map without explicit authorization.
4. Prefab, zone, policy, component, and entity identifiers must be discovered from the current city and passed back **unchanged**. Chinese prose and translated display names are not prefab identifiers. Use `list_zone_types` and the current city theme for zoning; English game UI does not justify guessing internal names.

For a new city, read `docs/workflows/development-strategies.md` and `docs/workflows/new-city.md` when possible. For an existing city, read `docs/workflows/existing-city.md`. If a required Chinese-language domain rule is inaccessible to the Agent, use only operations whose complete constraints are clear from live schemas and this guide; stop before an uncertain write.

## Plan before construction

- Stay within the user's purchased/buildable area unless they explicitly authorize expansion. Keep space for outside access, pollution isolation, utilities, upgrades, and future road widening. Prefer straight, orthogonal, globally aligned 8 m geometry when terrain and native validation permit; do not force a grid through water, rail, highways, or incompatible existing structures.
- Prefer `propose_grid_plan` or `plan.grids[]` for one or more complete, axis-aligned, equally spaced rectangular development units. Use `propose_city_plan` for a broader concept and `plan.roads[]` for irregular routes, rings, arterials, coastlines, and connectors. Multiple grids may be planned and built serially; do not duplicate their shared perimeter roads. If a road group cannot be represented faithfully as a grid, record its reason in `plan.grid_exceptions[]` instead of silently expanding it into many individual road calls.
- Keep internal grid roads the same width. Widen the perimeter or external collector connections when appropriate, not individual internal links. Bind each development unit to the outside network through valid collector connections; do not assume visual touching means topology is connected.
- Conceptual buildings, rails, and utility lines are reservations, not native placement. Keep unbound building `placement_status="conceptual"`, `rotation_source="unresolved"`, and `rotation_degrees=null`. Discover exact prefabs, dimensions, entrances, upgrade footprints, connection ports, and network layers before construction. Rendered SVG pixels are never world coordinates.
- `render_city_plan` produces a reviewable map, not a native game preview. Report the plan's bounds, grids, routes, connections, facility positions, budget, and unresolved assumptions. A changed plan or building binding changes its `plan_id` and requires a fresh rendering and approval before construction.

Read `docs/guides/planning/PLANNING-MAP-GUIDE.md`, `docs/workflows/efficient-deployment.md`, and `docs/workflows/planning-token-efficiency.md` for detailed map, grid, and reference workflows. Use `plan_ref` → `construction_id` and the returned `next_action`/`state_version` when supported by the live schema; do not resend large plans or bypass a stopped workflow by deleting its journal.

## Choose the correct construction entry

| Authorized scope | Preferred path |
| --- | --- |
| Planning or drawing only | `propose_grid_plan` / `propose_city_plan` → `render_city_plan`; no apply |
| Native preview of one grid, no permanent work yet | `prepare_grid_native_preview`; inspect `preview_ready`, cost, errors, and connections |
| One approved grid, staged control | `prepare_grid_native_preview` → `advance_grid_construction` through `commit_roads`, `preview_zoning`, and `apply_zoning` |
| One independent grid with explicit automatic-build authorization | `deploy_grid_district(approval_mode="automatic")`; its default `staged` mode does not permanently build |
| A whole approved construction map | `prepare_city_plan_construction` → `advance_city_plan_construction` by returned batches; retain grids as native grid batches |

For whole-plan roads, first produce a road-only stage plan or mark unbound buildings `construction_status="skipped"`. Render and approve that exact `bounds` + structured `plan` + `plan_id`, prepare the virtual road sandbox, and check widths, 8 m alignment, and endpoint topology. Preview each batch at its **final world position**, commit serially, then read back permanent roads. The virtual sandbox is not an underground or off-map build.

After the road backbone exists, use `bind_city_plan_buildings` for buildings with exact live prefabs. It must obtain native candidate position, rotation, and `road_edge_id` or `snap_target_id`; its temporary preview is cancelled and does not build. Restore the full plan, render it again, and obtain approval for the **new** `plan_id` before building the facilities. If native road merging changes edge IDs, verify the new edge's position, compatibility, and topology before continuing; never silently ignore a failed readback. Zoning must use permanent road edge IDs, not IDs from a preview or drawn plan.

## Apply and verify every mutation

1. Discover exact target, unlock and access conditions, capacity, costs, footprint, and relevant permanent network. Read-only discovery may be parallelized; road, terrain, building, utility, and zoning writes remain serial.
2. If a tool requires a paused city, record the original simulation speed before pausing. For `preview_*`, wait for the original operation to reach `preview_ready`; check `can_commit` when exposed, costs, collisions, clearance, warnings, errors, and scope. A rejected native preview cannot be rescued by a visually correct plan.
3. Apply with the returned `operation_id`, a stable `request_id`, and a task-bounded `max_cost`. Poll the **same** operation until `completed`, then query the permanent road, building, network, area, or Zone Cells. Do not call `completed` a long-term outcome.
4. On `failed`, `cancelled`, `expired`, timeout, or `outcome_unknown`, stop dependent writes and inspect the original operation and permanent objects. Do not blindly use a new `request_id`. A confirmed failure may be replanned as a genuinely new operation after its cause is understood; an unknown outcome is not permission to retry.
5. Direct `set_*`, `create_*`, or `delete_*` tools without a preview still need an original-state baseline and permanent readback. Restore the original simulation speed when no transaction remains, unless the user requested otherwise. Population, happiness, traffic, pollution, and service performance require comparable post-simulation measurements.

For transaction states, recovery, and `TOOL_BUSY`, read `docs/workflows/operations.md`. Do not fabricate a preview interface that the live tool schema does not offer.

## Road binding, utilities, and upgrades

- A building that requires roadside access must use a live siting candidate's exact `position`, `rotation_degrees`, and `road_edge_id` (or the prefab's supported `snap_target_id`). Moving or rotating that geometry invalidates the binding and requires a new candidate and native preview. An apparently adjacent lot, a completed operation, or a hand-entered nearby edge ID is insufficient.
- After placement, read the permanent entity and confirm `Game.Buildings.Building.m_RoadEdge` is non-null and refers to a compatible permanent road in the current session. For utilities or vehicle services, also verify real network capacity/connectivity and vehicle reachability. If the road edge is missing, invalid, or incompatible, stop dependent construction and replan; do not repeat the same geometry under a new ID.
- Ordinary roads carry low-voltage power, water, and sewage service; highways do not provide those utility layers. A generator, transformer, water tower, intake, treatment plant, or sewage outlet must genuinely connect to the relevant road/network layer. Shoreline facilities additionally require valid water access. Use `list_utility_connection_points` and compatible targets when independent lines or pipes are needed; never infer connection solely from map proximity.
- For an upgrade, discover its native `placement_geometry` and permitted area. Across-road attachments are valid only when the native upgrade candidates/rules explicitly allow them; verify the attached permanent result and reserve the combined footprint.

Read `docs/guides/buildings/BUILDING-GUIDE.md`, `docs/guides/transport/UTILITY-INFRASTRUCTURE-GUIDE.md`, and the relevant city-service or transit guide for specialized siting. If this guide and the live game disagree, report the discrepancy and prefer the native validation and permanent result.
