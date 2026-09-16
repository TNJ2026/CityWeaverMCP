using System;
using System.Collections.Generic;
using System.Linq;
using Colossal.Mathematics;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CitiesSkylines2Mod
{
    public sealed class RoadOperation
    {
        public static bool IsLocked(EntityManager em, Entity prefab) => em.HasComponent<Locked>(prefab) && em.IsComponentEnabled<Locked>(prefab);
        public string Id = Guid.NewGuid().ToString("N"), Session, RequestId, Fingerprint, PrefabName;
        public string OperationType = "create", OriginalPrefabName;
        public string ControlMode;
        public bool? RoundaboutEnabled;
        public float3 RingCenter;
        public float RingRadius;
        public string TravelDirection;
        public string ParallelSide;
        public float ParallelOffset;
        public float TerrainClearance;
        public float ElevationBeforeMin, ElevationBeforeMax, ElevationTargetMin, ElevationTargetMax;
        public float ParallelRequestedOffset;
        public bool ParallelAvoidObstacles;
        public bool ParallelClosed, ParallelConnectEnds, ParallelInheritedPrefabs;
        public string PlannerStrategy;
        public float PlannerGridSize;
        public int PlannerObstacleCount;
        public string UndoOf;
        public string TransactionKind;
        public List<RoadDirectChange> DirectChanges = new List<RoadDirectChange>();
        public bool ZoningAligned;
        public int GridColumns, GridRows;
        public float GridBlockWidth, GridBlockHeight;
        public float3 GridOrigin;
        public string GridDefaultPrefabName, GridHorizontalPrefabName, GridVerticalPrefabName, GridPerimeterPrefabName;
        public bool GridAutoConnect;
        public float GridConnectionSearchRadius;
        public int GridMinimumConnections, GridMaximumConnections;
        public List<string> GridConnectionSides = new List<string>();
        public string ZoningValidation;
        public bool? ZoningOrderly;
        public int ZoningBlockCount, ZoningCellCount, ZoningClearCellCount, ZoningFrontageClearCellCount;
        public int ZoningBlockedCellCount, ZoningSharedCellCount, ZoningOccupiedCellCount, ZoningRedundantCellCount;
        public string ApproachNodeId;
        public bool? LeftTurnAllowed, RightTurnAllowed, StraightAllowed, CrosswalkEnabled;
        public bool RuleUsesLeftSide;
        public string State = "queued", Error, CommitRequestId;
        public Entity Prefab, StartNode, EndNode;
        public Entity TargetEdge;
        public List<Entity> TargetEdges = new List<Entity>();
        public List<Entity> TargetNodes = new List<Entity>();
        public List<RoadNodeElevationPlan> ElevatedNodes = new List<RoadNodeElevationPlan>();
        public float StartSplit, EndSplit;
        public float StartElevation, EndElevation;
        public float3 Start, End;
        public Bezier4x3 Curve;
        public string CurveMode = "straight";
        public float3? Control1, Control2;
        public long Cost, MaxCost;
        public bool CommitRequested, CancelRequested, ApplyDispatched;
        public DateTime Created = DateTime.UtcNow, Expires = DateTime.UtcNow.AddMinutes(5);
        public JArray Errors = new JArray();
        public List<Entity> CreatedEdges = new List<Entity>();
        public List<RoadSegmentPlan> Segments = new List<RoadSegmentPlan>();
        public bool Terminal => State == "completed" || State == "failed" || State == "cancelled" || State == "expired" || State == "outcome_unknown";
        public string EntityId(Entity e) => e == Entity.Null ? null : Session + ":" + e.Index + ":" + e.Version;
        public JObject Json() => new JObject {
            ["operation_id"] = Id, ["session_id"] = Session, ["request_id"] = RequestId, ["state"] = State,
            ["operation_type"] = OperationType, ["target_edge_id"] = EntityId(TargetEdge), ["original_road_prefab"] = OriginalPrefabName,
            ["control_mode"] = ControlMode,
            ["roundabout_enabled"] = RoundaboutEnabled,
            ["ring_center"] = RingRadius > 0 ? Point(RingCenter) : null,
            ["ring_radius_m"] = RingRadius > 0 ? new JValue(RingRadius) : null,
            ["travel_direction"] = TravelDirection,
            ["parallel_side"] = CurveMode == "parallel" ? ParallelSide : null,
            ["parallel_offset_m"] = CurveMode == "parallel" ? new JValue(ParallelOffset) : null,
            ["parallel_requested_offset_m"] = CurveMode == "parallel" ? new JValue(ParallelRequestedOffset) : null,
            ["parallel_avoid_obstacles"] = CurveMode == "parallel" ? new JValue(ParallelAvoidObstacles) : null,
            ["parallel_closed"] = CurveMode == "parallel" ? new JValue(ParallelClosed) : null,
            ["parallel_connect_ends"] = CurveMode == "parallel" ? new JValue(ParallelConnectEnds) : null,
            ["parallel_inherited_prefabs"] = CurveMode == "parallel" ? new JValue(ParallelInheritedPrefabs) : null,
            ["terrain_clearance_m"] = OperationType == "terrain_elevation" ? new JValue(TerrainClearance) : null,
            ["height_before_m"] = OperationType == "terrain_elevation" ? new JObject { ["min"] = ElevationBeforeMin, ["max"] = ElevationBeforeMax } : null,
            ["target_height_m"] = OperationType == "terrain_elevation" ? new JObject { ["min"] = ElevationTargetMin, ["max"] = ElevationTargetMax } : null,
            ["planner_strategy"] = PlannerStrategy,
            ["planner_grid_size_m"] = PlannerStrategy != null ? new JValue(PlannerGridSize) : null,
            ["planner_obstacle_count"] = PlannerStrategy != null ? new JValue(PlannerObstacleCount) : null,
            ["undo_of_operation_id"] = UndoOf,
            ["transaction_kind"] = TransactionKind,
            ["direct_change_count"] = DirectChanges.Count,
            ["direct_changes"] = DirectChanges.Count == 0 ? null : new JArray(DirectChanges.Select(change => change.Json(this))),
            ["zoning_alignment"] = PlannerStrategy != null ? new JValue(ZoningAligned) : null,
            ["zoning_validation"] = ZoningValidation,
            ["zoning_orderly"] = ZoningOrderly,
            ["zoning_block_count"] = ZoningValidation != null ? new JValue(ZoningBlockCount) : null,
            ["zoning_cell_count"] = ZoningValidation != null ? new JValue(ZoningCellCount) : null,
            ["zoning_clear_cells"] = ZoningValidation != null ? new JValue(ZoningClearCellCount) : null,
            ["zoning_frontage_clear_cells"] = ZoningValidation != null ? new JValue(ZoningFrontageClearCellCount) : null,
            ["zoning_blocked_cells"] = ZoningValidation != null ? new JValue(ZoningBlockedCellCount) : null,
            ["zoning_shared_cells"] = ZoningValidation != null ? new JValue(ZoningSharedCellCount) : null,
            ["zoning_occupied_cells"] = ZoningValidation != null ? new JValue(ZoningOccupiedCellCount) : null,
            ["zoning_redundant_cells"] = ZoningValidation != null ? new JValue(ZoningRedundantCellCount) : null,
            ["grid_origin"] = CurveMode == "grid" ? Point(GridOrigin) : null,
            ["grid_columns"] = CurveMode == "grid" ? new JValue(GridColumns) : null,
            ["grid_rows"] = CurveMode == "grid" ? new JValue(GridRows) : null,
            ["grid_block_width_m"] = CurveMode == "grid" ? new JValue(GridBlockWidth) : null,
            ["grid_block_height_m"] = CurveMode == "grid" ? new JValue(GridBlockHeight) : null,
            ["grid_default_road_prefab"] = CurveMode == "grid" ? GridDefaultPrefabName : null,
            ["grid_horizontal_road_prefab"] = CurveMode == "grid" ? GridHorizontalPrefabName : null,
            ["grid_vertical_road_prefab"] = CurveMode == "grid" ? GridVerticalPrefabName : null,
            ["grid_perimeter_road_prefab"] = CurveMode == "grid" ? GridPerimeterPrefabName : null,
            ["grid_auto_connect"] = CurveMode == "grid" ? new JValue(GridAutoConnect) : null,
            ["grid_connection_search_radius_m"] = CurveMode == "grid" && GridAutoConnect ? new JValue(GridConnectionSearchRadius) : null,
            ["grid_minimum_connections"] = CurveMode == "grid" && GridAutoConnect ? new JValue(GridMinimumConnections) : null,
            ["grid_maximum_connections"] = CurveMode == "grid" && GridAutoConnect ? new JValue(GridMaximumConnections) : null,
            ["grid_requested_connection_sides"] = CurveMode == "grid" && GridAutoConnect ? new JArray(GridConnectionSides) : null,
            ["grid_connection_count"] = CurveMode == "grid" && GridAutoConnect ? new JValue(Segments.Where(s => s.Role == "connection").Select(s => s.GridSide).Distinct().Count()) : null,
            ["grid_connection_segment_count"] = CurveMode == "grid" && GridAutoConnect ? new JValue(Segments.Count(s => s.Role == "connection")) : null,
            ["grid_connected_sides"] = CurveMode == "grid" && GridAutoConnect ? new JArray(Segments.Where(s => s.Role == "connection").Select(s => s.GridSide).Distinct()) : null,
            ["approach_node_id"] = ApproachNodeId,
            ["target_edge_ids"] = new JArray(TargetEdges.Select(EntityId)),
            ["target_node_ids"] = new JArray(TargetNodes.Select(EntityId)),
            ["original_road_prefabs"] = new JArray(Segments.Where(s => s.TargetEdge != Entity.Null).Select(s => s.OriginalPrefabName)),
            ["road_prefab"] = PrefabName, ["start"] = Point(Start), ["end"] = Point(End),
            ["start_node_id"] = StartNode != Entity.Null && StartSplit == 0 && Curve.a.Equals(Start) ? EntityId(StartNode) : null,
            ["end_node_id"] = EndNode != Entity.Null && EndSplit == 0 && Curve.d.Equals(End) ? EntityId(EndNode) : null,
            ["start_target_id"] = EntityId(StartNode), ["end_target_id"] = EntityId(EndNode),
            ["start_target_kind"] = EndpointKind(StartNode, StartSplit), ["end_target_kind"] = EndpointKind(EndNode, EndSplit),
            ["start_split_position"] = StartSplit, ["end_split_position"] = EndSplit,
            ["start_elevation_m"] = StartElevation, ["end_elevation_m"] = EndElevation,
            ["elevation_mode"] = ElevationMode(StartElevation, EndElevation),
            ["curve_mode"] = CurveMode, ["control_1"] = Control1.HasValue ? Point(Control1.Value) : null,
            ["control_2"] = Control2.HasValue ? Point(Control2.Value) : null,
            ["length_m"] = Segments.Count == 0 ? MathUtils.Length(Curve) : Segments.Sum(segment => MathUtils.Length(segment.Curve)),
            ["segment_count"] = Segments.Count == 0 ? 1 : Segments.Count,
            ["segments"] = new JArray(Segments.Select((segment, index) => segment.Json(this, index))),
            ["cost"] = Cost, ["max_cost"] = MaxCost,
            ["errors"] = Errors.DeepClone(), ["error"] = Error,
            ["expires_at_utc"] = Expires.ToString("O"), ["commit_dispatched"] = ApplyDispatched,
            ["created_road_ids"] = new JArray(CreatedEdges.Select(EntityId)),
            ["can_commit"] = State == "preview_ready" && !CancelRequested && !CommitRequested,
            ["note"] = "A preview is temporary. Only completed confirms permanent road entities. Poll this ID after a timeout; do not submit another placement." };
        private string EndpointKind(Entity target, float split) => target == Entity.Null ? "new_node" : split > 0 && split < 1 ? "road_edge" : "road_node";
        public static string ElevationMode(float start, float end) => start <= -12 || end <= -12 ? "tunnel" : start >= 8 || end >= 8 ? "elevated" : math.abs(start) > 0.01f || math.abs(end) > 0.01f ? "graded" : "ground";
        public static JObject Point(float3 p) => new JObject { ["x"] = p.x, ["y"] = p.y, ["z"] = p.z };
    }

    internal sealed class RoadEndpoint
    {
        public float3 Position;
        public Entity Target;
        public float Split;
        public float Elevation;
    }

    public sealed class RoadNodeElevationPlan
    {
        public Entity Node, Prefab;
        public float3 Position, OriginalPosition;
        public float Elevation;
        public bool HadElevation, HadUpdated;
        public float2 OriginalElevation;
    }

    public sealed class RoadSegmentPlan
    {
        public Entity TargetEdge, OriginalPrefab, Prefab, SourceEdge;
        public Entity TargetNode;
        public string OriginalPrefabName, PrefabName, Role, GridSide;
        public CompositionFlags UpgradeFlags;
        public bool HasUpgradeFlags;
        public float3 Start, End;
        public Entity StartTarget, EndTarget;
        public float StartSplit, EndSplit;
        public float StartElevation, EndElevation;
        public Bezier4x3 Curve;
        public JObject Json(RoadOperation operation, int index) => new JObject {
            ["index"] = index, ["start"] = RoadOperation.Point(Start), ["end"] = RoadOperation.Point(End),
            ["road_prefab"] = PrefabName ?? operation.PrefabName,
            ["role"] = Role, ["grid_side"] = GridSide,
            ["target_edge_id"] = operation.EntityId(TargetEdge), ["original_road_prefab"] = OriginalPrefabName,
            ["source_edge_id"] = operation.EntityId(SourceEdge),
            ["target_node_id"] = operation.EntityId(TargetNode),
            ["zoning_left_enabled"] = HasUpgradeFlags ? new JValue((UpgradeFlags.m_Left & CompositionFlags.Side.ZonesDisabled) == 0) : null,
            ["zoning_right_enabled"] = HasUpgradeFlags ? new JValue((UpgradeFlags.m_Right & CompositionFlags.Side.ZonesDisabled) == 0) : null,
            ["left_wide_sidewalk"] = HasUpgradeFlags ? new JValue((UpgradeFlags.m_Left & CompositionFlags.Side.WideSidewalk) != 0) : null,
            ["right_wide_sidewalk"] = HasUpgradeFlags ? new JValue((UpgradeFlags.m_Right & CompositionFlags.Side.WideSidewalk) != 0) : null,
            ["left_decoration"] = HasUpgradeFlags ? Decoration(UpgradeFlags.m_Left) : null,
            ["right_decoration"] = HasUpgradeFlags ? Decoration(UpgradeFlags.m_Right) : null,
            ["wide_median"] = HasUpgradeFlags ? new JValue((UpgradeFlags.m_General & CompositionFlags.General.WideMedian) != 0) : null,
            ["median_decoration"] = HasUpgradeFlags ? MiddleDecoration(UpgradeFlags.m_General) : null,
            ["start_target_id"] = operation.EntityId(StartTarget), ["end_target_id"] = operation.EntityId(EndTarget),
            ["start_target_kind"] = StartTarget == Entity.Null ? "new_node" : StartSplit > 0 && StartSplit < 1 ? "road_edge" : "road_node",
            ["end_target_kind"] = EndTarget == Entity.Null ? "new_node" : EndSplit > 0 && EndSplit < 1 ? "road_edge" : "road_node",
            ["start_split_position"] = StartSplit, ["end_split_position"] = EndSplit,
            ["start_elevation_m"] = StartElevation, ["end_elevation_m"] = EndElevation,
            ["elevation_mode"] = RoadOperation.ElevationMode(StartElevation, EndElevation),
            ["length_m"] = MathUtils.Length(Curve) };
        private static string Decoration(CompositionFlags.Side flags) => (flags & CompositionFlags.Side.SecondaryBeautification) != 0 ? "trees" : (flags & CompositionFlags.Side.PrimaryBeautification) != 0 ? "grass" : "none";
        private static string MiddleDecoration(CompositionFlags.General flags) => (flags & CompositionFlags.General.SecondaryMiddleBeautification) != 0 ? "trees" : (flags & CompositionFlags.General.PrimaryMiddleBeautification) != 0 ? "grass" : "none";
    }

    internal sealed class GridConnectionCandidate
    {
        public string Side;
        public float3 Boundary, Target;
        public Entity TargetEntity, TargetEdge;
        public float Split, Distance;
        public List<float3> Points = new List<float3>();
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string, RoadOperation> m_RoadOperations = new Dictionary<string, RoadOperation>();
        private readonly Dictionary<string, string> m_RoadRequestIds = new Dictionary<string, string>();
        private McpRoadToolSystem RoadTool(World world) => world.GetExistingSystemManaged<McpRoadToolSystem>() ?? throw new QueryException("ROAD_TOOL_UNAVAILABLE", "Road tool was not initialized.");
        private void ResetRoadOperations()
        {
            var world = World.DefaultGameObjectInjectionWorld;
            if (world != null && world.IsCreated) world.GetExistingSystemManaged<McpRoadToolSystem>()?.AbortForLoading();
            m_RoadOperations.Clear(); m_RoadRequestIds.Clear();
        }
        private static string RequestKey(JObject args)
        {
            var key = (string)args["request_id"];
            if (key == null || key.Length < 8 || key.Length > 100 || key.Any(c => !char.IsLetterOrDigit(c) && c != '-' && c != '_'))
                throw new QueryException("INVALID_ARGUMENT", "request_id must be 8..100 letters, digits, hyphens or underscores; reuse it for retries.");
            return key;
        }
        private JObject InspectRoadZoning(JObject args, World world)
        {
            var em = world.EntityManager;
            var edgeIds = args["edge_ids"] as JArray;
            if (edgeIds == null || edgeIds.Count < 1 || edgeIds.Count > 64)
                throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain 1..64 road edge IDs.");
            var unique = new HashSet<Entity>();
            var items = new JArray();
            int totalBlocks = 0, totalCells = 0, totalClear = 0, totalFrontageClear = 0;
            int totalBlocked = 0, totalShared = 0, totalOccupied = 0, totalRedundant = 0;
            int totalAxisAligned = 0, totalSizeMismatch = 0;
            bool latticeConsistent = true; float? phaseX = null, phaseZ = null;
            float Phase(float value)
            {
                var result = value - math.floor(value / 8f) * 8f;
                return result > 7.99f || result < 0.01f ? 0f : result;
            }
            bool SamePhase(float a, float b)
            {
                var delta = math.abs(a - b);
                return math.min(delta, 8f - delta) < 0.05f;
            }
            string Id(Entity entity) => m_Session + ":" + entity.Index + ":" + entity.Version;
            foreach (var token in edgeIds)
            {
                var edgeEntity = ParseEntity((string)token, em);
                if (!unique.Add(edgeEntity)) throw new QueryException("DUPLICATE_ROAD_EDGE", "edge_ids must not contain duplicates.");
                if (!em.HasComponent<Edge>(edgeEntity) || !em.HasComponent<Road>(edgeEntity) || em.HasComponent<Temp>(edgeEntity))
                    throw new QueryException("INVALID_ROAD_EDGE", "Every edge_id must identify an existing permanent road edge.");
                var blocksJson = new JArray();
                int edgeCells = 0, edgeClear = 0, edgeFrontageClear = 0, edgeBlocked = 0, edgeShared = 0, edgeOccupied = 0, edgeRedundant = 0;
                int edgeAxisAligned = 0, edgeSizeMismatch = 0; bool edgeLattice = true; float? edgePhaseX = null, edgePhaseZ = null;
                var subBlocks = em.HasBuffer<Game.Zones.SubBlock>(edgeEntity) ? em.GetBuffer<Game.Zones.SubBlock>(edgeEntity, true) : default(DynamicBuffer<Game.Zones.SubBlock>);
                var seenBlocks = new HashSet<Entity>();
                if (subBlocks.IsCreated)
                {
                    for (int i = 0; i < subBlocks.Length; i++)
                    {
                        var blockEntity = subBlocks[i].m_SubBlock;
                        if (!seenBlocks.Add(blockEntity) || !em.Exists(blockEntity) || em.HasComponent<Deleted>(blockEntity) ||
                            !em.HasComponent<Game.Zones.Block>(blockEntity) || !em.HasBuffer<Game.Zones.Cell>(blockEntity)) continue;
                        var block = em.GetComponentData<Game.Zones.Block>(blockEntity);
                        var cells = em.GetBuffer<Game.Zones.Cell>(blockEntity, true);
                        var expectedCells = math.max(0, block.m_Size.x * block.m_Size.y);
                        var axisAligned = math.abs(math.abs(block.m_Direction.x) - 1f) < 0.001f && math.abs(block.m_Direction.y) < 0.001f ||
                            math.abs(math.abs(block.m_Direction.y) - 1f) < 0.001f && math.abs(block.m_Direction.x) < 0.001f;
                        int clear = 0, frontageClear = 0, blocked = 0, shared = 0, occupied = 0, redundant = 0;
                        bool blockLattice = true; float? blockPhaseX = null, blockPhaseZ = null;
                        for (int cellIndex = 0; cellIndex < cells.Length; cellIndex++)
                        {
                            var cell = cells[cellIndex]; var flags = cell.m_State;
                            if ((flags & Game.Zones.CellFlags.Blocked) != 0) blocked++;
                            if ((flags & Game.Zones.CellFlags.Shared) != 0) shared++;
                            if ((flags & Game.Zones.CellFlags.Occupied) != 0) occupied++;
                            if ((flags & Game.Zones.CellFlags.Redundant) != 0) redundant++;
                            var isClear = (flags & (Game.Zones.CellFlags.Blocked | Game.Zones.CellFlags.Shared | Game.Zones.CellFlags.Occupied | Game.Zones.CellFlags.Redundant)) == 0;
                            if (isClear) { clear++; if ((flags & Game.Zones.CellFlags.Roadside) != 0) frontageClear++; }
                            if (block.m_Size.x <= 0) { blockLattice = false; continue; }
                            var position = Game.Zones.ZoneUtils.GetCellPosition(block, new int2(cellIndex % block.m_Size.x, cellIndex / block.m_Size.x));
                            var px = Phase(position.x); var pz = Phase(position.z);
                            if (!blockPhaseX.HasValue) { blockPhaseX = px; blockPhaseZ = pz; }
                            else if (!SamePhase(blockPhaseX.Value, px) || !SamePhase(blockPhaseZ.Value, pz)) blockLattice = false;
                            if (!edgePhaseX.HasValue) { edgePhaseX = px; edgePhaseZ = pz; }
                            else if (!SamePhase(edgePhaseX.Value, px) || !SamePhase(edgePhaseZ.Value, pz)) edgeLattice = false;
                            if (!phaseX.HasValue) { phaseX = px; phaseZ = pz; }
                            else if (!SamePhase(phaseX.Value, px) || !SamePhase(phaseZ.Value, pz)) latticeConsistent = false;
                        }
                        if (axisAligned) { edgeAxisAligned++; totalAxisAligned++; }
                        if (cells.Length != expectedCells) { edgeSizeMismatch++; totalSizeMismatch++; }
                        edgeCells += cells.Length; edgeClear += clear; edgeFrontageClear += frontageClear; edgeBlocked += blocked;
                        edgeShared += shared; edgeOccupied += occupied; edgeRedundant += redundant;
                        totalBlocks++; totalCells += cells.Length; totalClear += clear; totalFrontageClear += frontageClear; totalBlocked += blocked;
                        totalShared += shared; totalOccupied += occupied; totalRedundant += redundant;
                        blocksJson.Add(new JObject {
                            ["block_id"] = Id(blockEntity), ["position"] = RoadOperation.Point(block.m_Position),
                            ["direction"] = new JObject { ["x"] = block.m_Direction.x, ["z"] = block.m_Direction.y },
                            ["size_cells"] = new JObject { ["width"] = block.m_Size.x, ["depth"] = block.m_Size.y },
                            ["cell_count"] = cells.Length, ["expected_cell_count"] = expectedCells,
                            ["clear_cells"] = clear, ["frontage_clear_cells"] = frontageClear, ["blocked_cells"] = blocked,
                            ["shared_cells"] = shared, ["occupied_cells"] = occupied, ["redundant_cells"] = redundant,
                            ["axis_aligned"] = axisAligned, ["cell_lattice_consistent"] = blockLattice,
                            ["valid_area"] = em.HasComponent<Game.Zones.ValidArea>(blockEntity)
                                ? new JArray(em.GetComponentData<Game.Zones.ValidArea>(blockEntity).m_Area.x,
                                    em.GetComponentData<Game.Zones.ValidArea>(blockEntity).m_Area.y,
                                    em.GetComponentData<Game.Zones.ValidArea>(blockEntity).m_Area.z,
                                    em.GetComponentData<Game.Zones.ValidArea>(blockEntity).m_Area.w) : null
                        });
                    }
                }
                var edgeBlockCount = blocksJson.Count;
                items.Add(new JObject {
                    ["edge_id"] = Id(edgeEntity), ["zone_block_count"] = edgeBlockCount, ["has_zone_blocks"] = edgeBlockCount > 0,
                    ["cell_count"] = edgeCells, ["clear_cells"] = edgeClear, ["frontage_clear_cells"] = edgeFrontageClear,
                    ["blocked_cells"] = edgeBlocked, ["shared_cells"] = edgeShared, ["occupied_cells"] = edgeOccupied, ["redundant_cells"] = edgeRedundant,
                    ["axis_aligned_blocks"] = edgeAxisAligned, ["cell_lattice_consistent"] = edgeLattice,
                    ["orderly_geometry"] = edgeBlockCount > 0 && edgeAxisAligned == edgeBlockCount && edgeLattice && edgeSizeMismatch == 0,
                    ["blocks"] = blocksJson
                });
            }
            return new JObject {
                ["edge_count"] = unique.Count, ["zone_block_count"] = totalBlocks, ["cell_count"] = totalCells,
                ["clear_cells"] = totalClear, ["frontage_clear_cells"] = totalFrontageClear,
                ["blocked_cells"] = totalBlocked, ["shared_cells"] = totalShared, ["occupied_cells"] = totalOccupied, ["redundant_cells"] = totalRedundant,
                ["blocked_ratio"] = totalCells == 0 ? 0 : (double)totalBlocked / totalCells,
                ["axis_aligned_blocks"] = totalAxisAligned, ["cell_lattice_consistent"] = latticeConsistent,
                ["cell_lattice_phase_m"] = phaseX.HasValue ? new JObject { ["x"] = phaseX.Value, ["z"] = phaseZ.Value } : null,
                ["size_mismatch_blocks"] = totalSizeMismatch,
                ["orderly_geometry"] = totalBlocks > 0 && totalAxisAligned == totalBlocks && latticeConsistent && totalSizeMismatch == 0,
                ["items"] = items,
                ["metric_notes"] = "Cells use the game's native 8 metre Zone Block grid. clear_cells excludes Blocked, Shared, Occupied and Redundant flags; frontage_clear_cells also requires Roadside. orderly_geometry checks native block direction, one global cell-lattice phase and buffer-size consistency. It does not promise that every clear cell will accept every building prefab."
            };
        }
        private Entity[] RoadPrefabs(EntityManager em)
        {
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<RoadData>(), ComponentType.ReadOnly<NetData>(), ComponentType.ReadOnly<NetGeometryData>(), ComponentType.ReadOnly<PrefabData>()))
            using (var entities = query.ToEntityArray(Allocator.Temp)) return entities.ToArray();
        }
        private JObject ListRoadPrefabs(JObject args, World world)
        {
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            var search = (string)args["search"] ?? ""; var offset = ComponentInspector.Int(args, "offset", 0, 0, 10000); var limit = ComponentInspector.Int(args, "limit", 50, 1, 100);
            var rows = new List<JObject>();
            foreach (var e in RoadPrefabs(em))
            {
                if (!prefabs.TryGetPrefab<PrefabBase>(e, out var prefab) || !(prefab is RoadPrefab)) continue;
                if (prefab.name.IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0) continue;
                var g = em.GetComponentData<NetGeometryData>(e);
                var road = em.GetComponentData<RoadData>(e);
                var forward = (road.m_Flags & Game.Prefabs.RoadFlags.DefaultIsForward) != 0;
                var backward = (road.m_Flags & Game.Prefabs.RoadFlags.DefaultIsBackward) != 0;
                var row = new JObject { ["name"] = prefab.name, ["prefab_entity_id"] = EntityId(e), ["width_m"] = g.m_DefaultWidth,
                    ["speed_limit"] = road.m_SpeedLimit, ["one_way"] = forward != backward,
                    ["default_direction"] = forward != backward ? (forward ? "forward" : "backward") : "both",
                    ["zoning_enabled"] = (road.m_Flags & Game.Prefabs.RoadFlags.EnableZoning) != 0,
                    ["uses_highway_rules"] = (road.m_Flags & Game.Prefabs.RoadFlags.UseHighwayRules) != 0,
                    ["locked"] = RoadOperation.IsLocked(em, e), ["modes"] = new JArray("straight", "quadratic", "cubic", "elevated", "tunnel", "polyline"), ["max_length_m"] = 256 };
                row.Merge(RoadPrefabTraits(prefab.name, e, em)); rows.Add(row);
            }
            rows = rows.OrderBy(r => (string)r["name"], StringComparer.Ordinal).ToList();
            return new JObject { ["total"] = rows.Count, ["next_offset"] = offset + limit < rows.Count ? new JValue(offset + limit) : JValue.CreateNull(), ["items"] = new JArray(rows.Skip(offset).Take(limit)) };
        }
        private static float ReadCoordinate(JObject point, string key, string field)
        {
            var t = point[field];
            if (t == null || (t.Type != JTokenType.Float && t.Type != JTokenType.Integer) || !float.TryParse(t.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value) || !math.isfinite(value) || math.abs(value) > 7168)
                throw new QueryException("INVALID_ARGUMENT", key + "." + field + " must be a finite world coordinate within +/-7168 metres.");
            return value;
        }
        private static float ClosestCurvePosition(Bezier4x3 curve, float2 requested)
        {
            int best = 0; float bestDistance = float.MaxValue;
            for (int i = 0; i <= 256; i++)
            {
                float t = i / 256f; float distance = math.distancesq(MathUtils.Position(curve, t).xz, requested);
                if (distance < bestDistance) { bestDistance = distance; best = i; }
            }
            float left = math.max(0, (best - 1) / 256f), right = math.min(1, (best + 1) / 256f);
            for (int i = 0; i < 16; i++)
            {
                float a = math.lerp(left, right, 1f / 3f), b = math.lerp(left, right, 2f / 3f);
                if (math.distancesq(MathUtils.Position(curve, a).xz, requested) <= math.distancesq(MathUtils.Position(curve, b).xz, requested)) right = b; else left = a;
            }
            return (left + right) * 0.5f;
        }
        private RoadEndpoint RoadPoint(JObject args, string key, World world, TerrainHeightData heights)
        {
            if (!(args[key] is JObject point)) throw new QueryException("INVALID_ARGUMENT", key + " must contain x and z.");
            var position = new float3(ReadCoordinate(point, key, "x"), 0, ReadCoordinate(point, key, "z")); var target = Entity.Null; float split = 0;
            var em = world.EntityManager;
            if (point["node_id"] != null && point["edge_id"] != null) throw new QueryException("INVALID_ENDPOINT", "Use either node_id or edge_id, not both.");
            if (point["node_id"] != null)
            {
                target = ParseEntity((string)point["node_id"], em);
                if (!em.HasComponent<Node>(target) || !em.HasComponent<ConnectedEdge>(target)) throw new QueryException("INVALID_ENDPOINT", "node_id must identify an existing road node.");
                var edges = em.GetBuffer<ConnectedEdge>(target, true); bool road = false;
                for (int i = 0; i < edges.Length; i++) if (em.HasComponent<Road>(edges[i].m_Edge)) road = true;
                if (!road) throw new QueryException("INVALID_ENDPOINT", "Selected node has no road edges.");
                var snapped = em.GetComponentData<Node>(target).m_Position;
                if (math.distance(snapped.xz, position.xz) > 8) throw new QueryException("INVALID_ENDPOINT", "node_id must be within 8 metres of the requested endpoint.");
                position = snapped;
            }
            else if (point["edge_id"] != null)
            {
                target = ParseEntity((string)point["edge_id"], em);
                if (!em.HasComponent<Edge>(target) || !em.HasComponent<Curve>(target) || !em.HasComponent<Road>(target) || em.HasComponent<Temp>(target))
                    throw new QueryException("INVALID_ENDPOINT", "edge_id must identify an existing permanent road edge.");
                var curve = em.GetComponentData<Curve>(target).m_Bezier; split = ClosestCurvePosition(curve, position.xz);
                position = MathUtils.Position(curve, split);
                if (math.distance(position.xz, new float2(ReadCoordinate(point, key, "x"), ReadCoordinate(point, key, "z"))) > 8)
                    throw new QueryException("INVALID_ENDPOINT", "edge_id must pass within 8 metres of the requested endpoint.");
                var edge = em.GetComponentData<Edge>(target);
                if (split <= 0.001f) { target = edge.m_Start; split = 0; position = em.GetComponentData<Node>(target).m_Position; }
                else if (split >= 0.999f) { target = edge.m_End; split = 0; position = em.GetComponentData<Node>(target).m_Position; }
            }
            float elevation = 0;
            if (point["elevation_m"] != null)
            {
                if ((point["elevation_m"].Type != JTokenType.Float && point["elevation_m"].Type != JTokenType.Integer) ||
                    !float.TryParse(point["elevation_m"].ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out elevation) ||
                    !math.isfinite(elevation) || elevation < -50 || elevation > 50)
                    throw new QueryException("INVALID_ARGUMENT", key + ".elevation_m must be a finite value from -50 to 50 metres.");
                if (target != Entity.Null && math.abs(elevation) > 0.01f)
                    throw new QueryException("INVALID_ENDPOINT", "elevation_m is only supported for new route points; attached nodes and edges use their existing height.");
            }
            if (target == Entity.Null) position.y = TerrainUtils.SampleHeight(ref heights, position) + elevation;
            if (!math.all(math.isfinite(position))) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain height is unavailable.");
            return new RoadEndpoint { Position = position, Target = target, Split = split, Elevation = elevation };
        }
        private static float3 CurveControl(JObject value, string key, float y)
        {
            if (value == null) throw new QueryException("INVALID_ARGUMENT", key + " is required for this curve mode.");
            return new float3(ReadCoordinate(value, key, "x"), y, ReadCoordinate(value, key, "z"));
        }
        private static void ValidateRoadCurve(Bezier4x3 curve, float startElevation, float endElevation, Entity prefabEntity, EntityManager em)
        {
            var distance = MathUtils.Length(curve);
            if (distance < 16 || distance > 256) throw new QueryException("INVALID_ROAD_LENGTH", "Each road curve must be from 16 to 256 metres.");
            var geometry = em.GetComponentData<NetGeometryData>(prefabEntity);
            var placeable = em.GetComponentData<PlaceableNetData>(prefabEntity);
            if (startElevation < placeable.m_ElevationRange.min || startElevation > placeable.m_ElevationRange.max || endElevation < placeable.m_ElevationRange.min || endElevation > placeable.m_ElevationRange.max)
                throw new QueryException("INVALID_ELEVATION", "Road elevation is outside this prefab's supported range.");
            var slopeLimit = geometry.m_MaxSlopeSteepness;
            if (slopeLimit <= 0) slopeLimit = 0.08f;
            float3 previous = curve.a;
            for (int i = 0; i <= 32; i++)
            {
                var p = MathUtils.Position(curve, i / 32f);
                if (i > 0 && math.abs(p.y - previous.y) / math.max(0.01f, math.distance(p.xz, previous.xz)) > slopeLimit) throw new QueryException("STEEP_SLOPE", "Ground road curve exceeds supported slope.");
                previous = p;
            }
        }
        private JObject PreviewRoad(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["road_prefab"] = args["road_prefab"]?.DeepClone(), ["start"] = args["start"]?.DeepClone(), ["end"] = args["end"]?.DeepClone(), ["curve"] = args["curve"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another route.");
                return old.Json();
            }
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>();
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before previewing a road.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); Entity prefabEntity = Entity.Null;
            var name = (string)args["road_prefab"];
            foreach (var e in RoadPrefabs(em)) if (prefabs.TryGetPrefab<PrefabBase>(e, out var p) && p is RoadPrefab && p.name == name) { prefabEntity = e; break; }
            if (prefabEntity == Entity.Null) throw new QueryException("UNKNOWN_ROAD_PREFAB", "Use an exact name from list_road_prefabs.");
            if (RoadOperation.IsLocked(em, prefabEntity)) throw new QueryException("ROAD_LOCKED", "This road is not unlocked.");
            var terrain = world.GetExistingSystemManaged<TerrainSystem>(); var heights = terrain.GetHeightData(true);
            if (!heights.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");
            var start = RoadPoint(args, "start", world, heights); var end = RoadPoint(args, "end", world, heights);
            if (start.Target != Entity.Null && start.Target == end.Target && math.abs(start.Split - end.Split) < 0.001f) throw new QueryException("INVALID_ENDPOINT", "Both endpoints refer to the same network position.");
            string curveMode = "straight"; float3? control1 = null, control2 = null; Bezier4x3 curve;
            if (args["curve"] is JObject curveArgs)
            {
                curveMode = (string)curveArgs["mode"];
                if (curveMode == "quadratic")
                {
                    control1 = CurveControl(curveArgs["control"] as JObject, "curve.control", (start.Position.y + end.Position.y) * 0.5f);
                    curve = new Bezier4x3(start.Position, start.Position + (control1.Value - start.Position) * (2f / 3f), end.Position + (control1.Value - end.Position) * (2f / 3f), end.Position);
                }
                else if (curveMode == "cubic")
                {
                    control1 = CurveControl(curveArgs["control_1"] as JObject, "curve.control_1", math.lerp(start.Position.y, end.Position.y, 1f / 3f));
                    control2 = CurveControl(curveArgs["control_2"] as JObject, "curve.control_2", math.lerp(start.Position.y, end.Position.y, 2f / 3f));
                    curve = new Bezier4x3(start.Position, control1.Value, control2.Value, end.Position);
                }
                else throw new QueryException("INVALID_ARGUMENT", "curve.mode must be quadratic or cubic.");
            }
            else curve = NetUtils.StraightCurve(start.Position, end.Position);
            ValidateRoadCurve(curve, start.Elevation, end.Elevation, prefabEntity, em);
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, Prefab = prefabEntity, PrefabName = name,
                Start = start.Position, End = end.Position, StartNode = start.Target, EndNode = end.Target, StartSplit = start.Split, EndSplit = end.Split,
                StartElevation = start.Elevation, EndElevation = end.Elevation, Curve = curve, CurveMode = curveMode, Control1 = control1, Control2 = control2 };
            operation.Segments.Add(new RoadSegmentPlan { Start = operation.Start, End = operation.End, StartTarget = operation.StartNode, EndTarget = operation.EndNode,
                StartSplit = operation.StartSplit, EndSplit = operation.EndSplit, StartElevation = operation.StartElevation, EndElevation = operation.EndElevation, Curve = operation.Curve });
            tool.Begin(operation);
            m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id);
            return operation.Json();
        }
        private JObject PreviewRoadRoute(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["road_prefab"] = args["road_prefab"]?.DeepClone(), ["points"] = args["points"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another route.");
                return old.Json();
            }
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>();
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before previewing a road route.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            if (!(args["points"] is JArray points) || points.Count < 2 || points.Count > 16) throw new QueryException("INVALID_ARGUMENT", "points must contain 2..16 route points.");
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); Entity prefabEntity = Entity.Null;
            var name = (string)args["road_prefab"];
            foreach (var e in RoadPrefabs(em)) if (prefabs.TryGetPrefab<PrefabBase>(e, out var p) && p is RoadPrefab && p.name == name) { prefabEntity = e; break; }
            if (prefabEntity == Entity.Null) throw new QueryException("UNKNOWN_ROAD_PREFAB", "Use an exact name from list_road_prefabs.");
            if (RoadOperation.IsLocked(em, prefabEntity)) throw new QueryException("ROAD_LOCKED", "This road is not unlocked.");
            var heights = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (!heights.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");
            var endpoints = new List<RoadEndpoint>();
            for (int i = 0; i < points.Count; i++) endpoints.Add(RoadPoint(new JObject { ["point"] = points[i].DeepClone() }, "point", world, heights));
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, Prefab = prefabEntity, PrefabName = name, CurveMode = "polyline" };
            for (int i = 0; i + 1 < endpoints.Count; i++)
            {
                var a = endpoints[i]; var b = endpoints[i + 1];
                if (a.Target != Entity.Null && a.Target == b.Target && math.abs(a.Split - b.Split) < 0.001f) throw new QueryException("INVALID_ENDPOINT", "Adjacent route points refer to the same network position.");
                var curve = NetUtils.StraightCurve(a.Position, b.Position); ValidateRoadCurve(curve, a.Elevation, b.Elevation, prefabEntity, em);
                operation.Segments.Add(new RoadSegmentPlan { Start = a.Position, End = b.Position, StartTarget = a.Target, EndTarget = b.Target, StartSplit = a.Split, EndSplit = b.Split,
                    StartElevation = a.Elevation, EndElevation = b.Elevation, Curve = curve });
            }
            var first = operation.Segments[0]; var last = operation.Segments[operation.Segments.Count - 1];
            operation.Start = first.Start; operation.End = last.End; operation.StartNode = first.StartTarget; operation.EndNode = last.EndTarget;
            operation.StartSplit = first.StartSplit; operation.EndSplit = last.EndSplit; operation.StartElevation = first.StartElevation; operation.EndElevation = last.EndElevation; operation.Curve = first.Curve;
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id);
            return operation.Json();
        }
        private JObject PreviewRoadRing(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["operation_type"] = "ring", ["road_prefab"] = args["road_prefab"]?.DeepClone(),
                ["center"] = args["center"]?.DeepClone(), ["radius_m"] = args["radius_m"]?.DeepClone(), ["direction"] = args["direction"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another route.");
                return old.Json();
            }
            if (!(args["center"] is JObject centerArgs)) throw new QueryException("INVALID_ARGUMENT", "center must contain x and z.");
            if (args["radius_m"] == null || (args["radius_m"].Type != JTokenType.Float && args["radius_m"].Type != JTokenType.Integer) ||
                !float.TryParse(args["radius_m"].ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var radius) ||
                !math.isfinite(radius) || radius < 12 || radius > 160) throw new QueryException("INVALID_ARGUMENT", "radius_m must be from 12 to 160 metres.");
            var direction = (string)args["direction"] ?? "auto";
            if (direction != "auto" && direction != "clockwise" && direction != "counterclockwise") throw new QueryException("INVALID_ARGUMENT", "direction must be auto, clockwise or counterclockwise.");
            if (direction == "auto") direction = world.GetExistingSystemManaged<Game.City.CityConfigurationSystem>().leftHandTraffic ? "clockwise" : "counterclockwise";
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before previewing a road ring.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); Entity prefabEntity = Entity.Null; var name = (string)args["road_prefab"];
            foreach (var e in RoadPrefabs(em)) if (prefabs.TryGetPrefab<PrefabBase>(e, out var p) && p is RoadPrefab && p.name == name) { prefabEntity = e; break; }
            if (prefabEntity == Entity.Null) throw new QueryException("UNKNOWN_ROAD_PREFAB", "Use an exact name from list_road_prefabs.");
            if (RoadOperation.IsLocked(em, prefabEntity)) throw new QueryException("ROAD_LOCKED", "This road is not unlocked.");
            var heights = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (!heights.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");
            var center = new float3(ReadCoordinate(centerArgs, "center", "x"), 0, ReadCoordinate(centerArgs, "center", "z"));
            var points = new float3[4];
            var offsets = direction == "clockwise"
                ? new[] { new float2(radius, 0), new float2(0, -radius), new float2(-radius, 0), new float2(0, radius) }
                : new[] { new float2(radius, 0), new float2(0, radius), new float2(-radius, 0), new float2(0, -radius) };
            for (int i = 0; i < 4; i++)
            {
                points[i] = new float3(center.x + offsets[i].x, 0, center.z + offsets[i].y);
                points[i].y = TerrainUtils.SampleHeight(ref heights, points[i]);
                if (!math.all(math.isfinite(points[i]))) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain height is unavailable around the requested ring.");
            }
            const float kappa = 0.55228475f;
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "create", Prefab = prefabEntity,
                PrefabName = name, CurveMode = "ring", RingCenter = center, RingRadius = radius, TravelDirection = direction };
            for (int i = 0; i < 4; i++)
            {
                var a = points[i]; var d = points[(i + 1) % 4];
                var radialA = math.normalize(a.xz - center.xz); var radialD = math.normalize(d.xz - center.xz);
                var sign = direction == "clockwise" ? -1f : 1f;
                var tangentA = new float2(-radialA.y, radialA.x) * sign;
                var tangentD = new float2(-radialD.y, radialD.x) * sign;
                var b = new float3(a.x + tangentA.x * radius * kappa, math.lerp(a.y, d.y, 1f / 3f), a.z + tangentA.y * radius * kappa);
                var c = new float3(d.x - tangentD.x * radius * kappa, math.lerp(a.y, d.y, 2f / 3f), d.z - tangentD.y * radius * kappa);
                var curve = new Bezier4x3(a, b, c, d); ValidateRoadCurve(curve, 0, 0, prefabEntity, em);
                operation.Segments.Add(new RoadSegmentPlan { Start = a, End = d, Curve = curve });
            }
            operation.Start = points[0]; operation.End = points[0]; operation.Curve = operation.Segments[0].Curve;
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id);
            return operation.Json();
        }
        private JObject PreviewRoadGrid(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["operation_type"] = "grid", ["road_prefab"] = args["road_prefab"]?.DeepClone(),
                ["horizontal_road_prefab"] = args["horizontal_road_prefab"]?.DeepClone(), ["vertical_road_prefab"] = args["vertical_road_prefab"]?.DeepClone(),
                ["perimeter_road_prefab"] = args["perimeter_road_prefab"]?.DeepClone(),
                ["auto_connect"] = args["auto_connect"]?.DeepClone(), ["connection_sides"] = args["connection_sides"]?.DeepClone(),
                ["connection_search_radius_m"] = args["connection_search_radius_m"]?.DeepClone(), ["connection_road_prefab"] = args["connection_road_prefab"]?.DeepClone(),
                ["minimum_connections"] = args["minimum_connections"]?.DeepClone(), ["maximum_connections"] = args["maximum_connections"]?.DeepClone(),
                ["origin"] = args["origin"]?.DeepClone(), ["columns"] = args["columns"]?.DeepClone(), ["rows"] = args["rows"]?.DeepClone(),
                ["block_width_m"] = args["block_width_m"]?.DeepClone(), ["block_height_m"] = args["block_height_m"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another road grid.");
                return old.Json();
            }
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var columns = ComponentInspector.Int(args, "columns", -1, 1, 5); var rows = ComponentInspector.Int(args, "rows", -1, 1, 5);
            var blockWidth = ComponentInspector.Int(args, "block_width_m", -1, 32, 240); var blockHeight = ComponentInspector.Int(args, "block_height_m", -1, 32, 240);
            var autoConnect = args["auto_connect"] != null && (bool)args["auto_connect"];
            var minimumConnections = ComponentInspector.Int(args, "minimum_connections", 1, 1, 4);
            var maximumConnections = ComponentInspector.Int(args, "maximum_connections", 4, 1, 4);
            var connectionSearchRadius = ComponentInspector.Int(args, "connection_search_radius_m", 96, 16, 256);
            if (columns < 1 || rows < 1 || blockWidth < 32 || blockHeight < 32) throw new QueryException("INVALID_ARGUMENT", "columns, rows, block_width_m and block_height_m are required.");
            if (minimumConnections > maximumConnections) throw new QueryException("INVALID_ARGUMENT", "minimum_connections must not exceed maximum_connections.");
            if (blockWidth % 8 != 0 || blockHeight % 8 != 0) throw new QueryException("INVALID_ARGUMENT", "Block dimensions must be multiples of the 8 metre zoning grid.");
            var segmentCount = (rows + 1) * columns + (columns + 1) * rows;
            if (segmentCount > 64) throw new QueryException("ROAD_GRID_TOO_LARGE", "A road grid may contain at most 64 definition segments.");
            if (!(args["origin"] is JObject originArgs)) throw new QueryException("INVALID_ARGUMENT", "origin must contain x and z.");
            var originX = math.round(ReadCoordinate(originArgs, "origin", "x") / 8f) * 8f;
            var originZ = math.round(ReadCoordinate(originArgs, "origin", "z") / 8f) * 8f;
            if (math.abs(originX + columns * blockWidth) > 7168 || math.abs(originZ + rows * blockHeight) > 7168)
                throw new QueryException("INVALID_ARGUMENT", "The generated grid extends outside the supported world coordinate range.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before planning a road grid.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var defaultName = (string)args["road_prefab"];
            Entity ResolvePrefab(string prefabName)
            {
                Entity result = Entity.Null;
                foreach (var e in RoadPrefabs(em)) if (prefabs.TryGetPrefab<PrefabBase>(e, out var p) && p is RoadPrefab && p.name == prefabName) { result = e; break; }
                if (result == Entity.Null) throw new QueryException("UNKNOWN_ROAD_PREFAB", "Use an exact name from list_road_prefabs: " + prefabName);
                if (RoadOperation.IsLocked(em, result)) throw new QueryException("ROAD_LOCKED", "This road is not unlocked: " + prefabName);
                return result;
            }
            var defaultPrefab = ResolvePrefab(defaultName);
            var horizontalName = (string)args["horizontal_road_prefab"] ?? defaultName; var horizontalPrefab = ResolvePrefab(horizontalName);
            var verticalName = (string)args["vertical_road_prefab"] ?? defaultName; var verticalPrefab = ResolvePrefab(verticalName);
            var perimeterName = (string)args["perimeter_road_prefab"] ?? defaultName; var perimeterPrefab = ResolvePrefab(perimeterName);
            var connectionName = (string)args["connection_road_prefab"] ?? perimeterName; var connectionPrefab = ResolvePrefab(connectionName);
            var connectionSides = new List<string>();
            var sideArgs = args["connection_sides"] as JArray;
            if (sideArgs == null || sideArgs.Count == 0) connectionSides.AddRange(new[] { "north", "east", "south", "west" });
            else foreach (var token in sideArgs)
            {
                var side = (string)token;
                if (side != "north" && side != "east" && side != "south" && side != "west") throw new QueryException("INVALID_ARGUMENT", "connection_sides accepts north, east, south and west.");
                if (!connectionSides.Contains(side)) connectionSides.Add(side);
            }
            if (minimumConnections > connectionSides.Count) throw new QueryException("INVALID_ARGUMENT", "minimum_connections cannot exceed the number of requested connection_sides.");
            var heights = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (!heights.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");
            var vertices = new float3[columns + 1, rows + 1];
            for (int x = 0; x <= columns; x++) for (int z = 0; z <= rows; z++)
            {
                var point = new float3(originX + x * blockWidth, 0, originZ + z * blockHeight);
                point.y = TerrainUtils.SampleHeight(ref heights, point); vertices[x, z] = point;
            }
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "create", Prefab = defaultPrefab,
                PrefabName = defaultName, CurveMode = "grid", PlannerStrategy = "grid", PlannerGridSize = 8, ZoningAligned = true, ZoningValidation = "planned",
                GridDefaultPrefabName = defaultName, GridHorizontalPrefabName = horizontalName, GridVerticalPrefabName = verticalName, GridPerimeterPrefabName = perimeterName,
                GridAutoConnect = autoConnect, GridConnectionSearchRadius = connectionSearchRadius, GridMinimumConnections = minimumConnections, GridMaximumConnections = maximumConnections,
                GridOrigin = vertices[0, 0], GridColumns = columns, GridRows = rows, GridBlockWidth = blockWidth, GridBlockHeight = blockHeight };
            operation.GridConnectionSides.AddRange(connectionSides);
            void AddSegment(float3 start, float3 end, Entity prefab, string prefabName, string role, string side, Entity endTarget = default(Entity), float endSplit = 0)
            {
                var curve = NetUtils.StraightCurve(start, end); ValidateRoadCurve(curve, 0, 0, prefab, em);
                operation.Segments.Add(new RoadSegmentPlan { Start = start, End = end, Curve = curve, Prefab = prefab, PrefabName = prefabName,
                    Role = role, GridSide = side, EndTarget = endTarget, EndSplit = endSplit });
            }
            for (int z = 0; z <= rows; z++) for (int x = 0; x < columns; x++)
                AddSegment(vertices[x, z], vertices[x + 1, z], z == 0 || z == rows ? perimeterPrefab : horizontalPrefab, z == 0 || z == rows ? perimeterName : horizontalName, "grid", z == 0 ? "south" : z == rows ? "north" : null);
            for (int x = 0; x <= columns; x++) for (int z = 0; z < rows; z++)
                AddSegment(vertices[x, z], vertices[x, z + 1], x == 0 || x == columns ? perimeterPrefab : verticalPrefab, x == 0 || x == columns ? perimeterName : verticalName, "grid", x == 0 ? "west" : x == columns ? "east" : null);
            if (autoConnect)
            {
                var candidates = new List<GridConnectionCandidate>();
                List<float3> BoundaryPoints(string side)
                {
                    var result = new List<float3>();
                    if (side == "west" || side == "east") { var x = side == "west" ? 0 : columns; for (int z = 0; z <= rows; z++) result.Add(vertices[x, z]); }
                    else { var z = side == "south" ? 0 : rows; for (int x = 0; x <= columns; x++) result.Add(vertices[x, z]); }
                    return result;
                }
                bool Outward(string side, float3 point) => side == "west" ? point.x < originX - 1 : side == "east" ? point.x > originX + columns * blockWidth + 1 :
                    side == "south" ? point.z < originZ - 1 : point.z > originZ + rows * blockHeight + 1;
                using (var query = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<Curve>(), ComponentType.ReadOnly<Road>() },
                    None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Temp>() } }))
                using (var edges = query.ToEntityArray(Allocator.Temp))
                {
                    foreach (var side in connectionSides) foreach (var boundary in BoundaryPoints(side)) foreach (var edgeEntity in edges)
                    {
                        var curve = em.GetComponentData<Curve>(edgeEntity).m_Bezier; var split = ClosestCurvePosition(curve, boundary.xz);
                        var target = MathUtils.Position(curve, split); if (!Outward(side, target)) continue;
                        var direct = math.distance(boundary.xz, target.xz); if (direct < 16 || direct > connectionSearchRadius) continue;
                        var edge = em.GetComponentData<Edge>(edgeEntity); Entity targetEntity = edgeEntity;
                        if (split <= 0.001f) { targetEntity = edge.m_Start; split = 0; target = em.GetComponentData<Node>(targetEntity).m_Position; }
                        else if (split >= 0.999f) { targetEntity = edge.m_End; split = 0; target = em.GetComponentData<Node>(targetEntity).m_Position; }
                        var points = new List<float3> { boundary };
                        if (math.abs(boundary.x - target.x) > 0.1f && math.abs(boundary.z - target.z) > 0.1f)
                        {
                            var bend = side == "west" || side == "east" ? new float3(target.x, 0, boundary.z) : new float3(boundary.x, 0, target.z);
                            bend.y = TerrainUtils.SampleHeight(ref heights, bend); points.Add(bend);
                        }
                        points.Add(target); bool valid = true; float routeLength = 0;
                        for (int i = 0; i + 1 < points.Count; i++) try
                        {
                            routeLength += math.distance(points[i].xz, points[i + 1].xz);
                            ValidateRoadCurve(NetUtils.StraightCurve(points[i], points[i + 1]), 0, 0, connectionPrefab, em);
                        }
                        catch (QueryException) { valid = false; break; }
                        if (valid) candidates.Add(new GridConnectionCandidate { Side = side, Boundary = boundary, Target = target, TargetEntity = targetEntity,
                            TargetEdge = edgeEntity, Split = split, Distance = routeLength, Points = points });
                    }
                }
                var selected = new List<GridConnectionCandidate>(); var usedSides = new HashSet<string>(); var usedEdges = new HashSet<Entity>(); var usedBoundaries = new HashSet<string>();
                foreach (var candidate in candidates.OrderBy(c => c.Distance).ThenBy(c => c.Side, StringComparer.Ordinal))
                {
                    var boundaryKey = candidate.Boundary.x.ToString("R", System.Globalization.CultureInfo.InvariantCulture) + ":" + candidate.Boundary.z.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
                    if (selected.Count >= maximumConnections) break;
                    if (usedSides.Contains(candidate.Side) || usedEdges.Contains(candidate.TargetEdge) || usedBoundaries.Contains(boundaryKey)) continue;
                    usedSides.Add(candidate.Side); usedEdges.Add(candidate.TargetEdge); usedBoundaries.Add(boundaryKey);
                    selected.Add(candidate);
                }
                if (selected.Count < minimumConnections) throw new QueryException("NO_ROAD_CONNECTION", "Fewer than minimum_connections suitable existing-road targets were found within connection_search_radius_m.");
                var connectionSegments = selected.Sum(c => c.Points.Count - 1);
                if (operation.Segments.Count + connectionSegments > 64) throw new QueryException("ROAD_GRID_TOO_LARGE", "The grid and automatic connections require more than 64 definition segments.");
                foreach (var connection in selected) for (int i = 0; i + 1 < connection.Points.Count; i++)
                    AddSegment(connection.Points[i], connection.Points[i + 1], connectionPrefab, connectionName, "connection", connection.Side,
                        i + 2 == connection.Points.Count ? connection.TargetEntity : Entity.Null, i + 2 == connection.Points.Count ? connection.Split : 0);
            }
            var first = operation.Segments[0]; var last = operation.Segments[operation.Segments.Count - 1];
            operation.Start = first.Start; operation.End = last.End; operation.Curve = first.Curve;
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id); return operation.Json();
        }
        private JObject PreviewRoadParallel(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["operation_type"] = "parallel", ["edge_ids"] = args["edge_ids"]?.DeepClone(),
                ["side"] = args["side"]?.DeepClone(), ["offset_m"] = args["offset_m"]?.DeepClone(), ["road_prefab"] = args["road_prefab"]?.DeepClone(),
                ["connect_ends"] = args["connect_ends"]?.DeepClone(), ["connection_road_prefab"] = args["connection_road_prefab"]?.DeepClone(),
                ["avoid_obstacles"] = args["avoid_obstacles"]?.DeepClone(), ["max_offset_m"] = args["max_offset_m"]?.DeepClone(), ["clearance_m"] = args["clearance_m"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another parallel-road operation.");
                return old.Json();
            }
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var ids = args["edge_ids"] as JArray;
            if (ids == null || ids.Count < 1 || ids.Count > 32) throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain 1..32 ordered road edge IDs.");
            var side = (string)args["side"];
            if (side != "left" && side != "right") throw new QueryException("INVALID_ARGUMENT", "side must be left or right.");
            if (args["offset_m"] == null || (args["offset_m"].Type != JTokenType.Float && args["offset_m"].Type != JTokenType.Integer) ||
                !float.TryParse(args["offset_m"].ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var offset) ||
                !math.isfinite(offset) || offset < 4 || offset > 128) throw new QueryException("INVALID_ARGUMENT", "offset_m must be from 4 to 128 metres.");
            var connectEnds = args["connect_ends"] != null && (bool)args["connect_ends"];
            var requestedOffset = offset; var avoidObstacles = args["avoid_obstacles"] != null && (bool)args["avoid_obstacles"];
            var maxOffset = args["max_offset_m"] == null ? 128f : (float)args["max_offset_m"];
            var clearance = args["clearance_m"] == null ? 4f : (float)args["clearance_m"];
            if (!math.isfinite(maxOffset) || maxOffset < offset || maxOffset > 256) throw new QueryException("INVALID_ARGUMENT", "max_offset_m must be between offset_m and 256.");
            if (!math.isfinite(clearance) || clearance < 0 || clearance > 32) throw new QueryException("INVALID_ARGUMENT", "clearance_m must be 0..32.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before planning a parallel road.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            Entity ResolvePrefab(string prefabName)
            {
                Entity result = Entity.Null;
                foreach (var entity in RoadPrefabs(em)) if (prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab) && prefab is RoadPrefab && prefab.name == prefabName) { result = entity; break; }
                if (result == Entity.Null) throw new QueryException("UNKNOWN_ROAD_PREFAB", "Use an exact name from list_road_prefabs: " + prefabName);
                if (RoadOperation.IsLocked(em, result)) throw new QueryException("ROAD_LOCKED", "This road is not unlocked: " + prefabName);
                return result;
            }
            var requestedName = (string)args["road_prefab"]; var requestedPrefab = requestedName == null ? Entity.Null : ResolvePrefab(requestedName);
            var connectionName = (string)args["connection_road_prefab"] ?? requestedName; Entity connectionPrefab = Entity.Null;
            if (connectEnds && connectionName != null) connectionPrefab = ResolvePrefab(connectionName);
            var unique = new HashSet<Entity>(); var sourceEntities = new List<Entity>(); var sourceEdges = new List<Edge>();
            foreach (var token in ids)
            {
                var entity = ParseEntity((string)token, em);
                if (!unique.Add(entity)) throw new QueryException("DUPLICATE_ROAD_EDGE", "edge_ids must not contain duplicates.");
                if (!em.HasComponent<Edge>(entity) || !em.HasComponent<Curve>(entity) || !em.HasComponent<Road>(entity) || !em.HasComponent<PrefabRef>(entity) || em.HasComponent<Temp>(entity))
                    throw new QueryException("INVALID_ROAD_EDGE", "Every edge_id must identify an existing permanent road edge.");
                sourceEntities.Add(entity); sourceEdges.Add(em.GetComponentData<Edge>(entity));
            }
            bool Shares(Edge a, Edge b, Entity node) => (a.m_Start == node || a.m_End == node) && (b.m_Start == node || b.m_End == node);
            var oriented = new List<Tuple<Entity, Bezier4x3, float2, Entity, string>>(); Entity routeStart = Entity.Null, routeEnd = Entity.Null;
            for (int i = 0; i < sourceEntities.Count; i++)
            {
                var entity = sourceEntities[i]; var edge = sourceEdges[i]; bool forward;
                if (i == 0 && sourceEntities.Count > 1)
                {
                    var next = sourceEdges[1];
                    if (Shares(edge, next, edge.m_End)) forward = true;
                    else if (Shares(edge, next, edge.m_Start)) forward = false;
                    else throw new QueryException("PARALLEL_ROUTE_DISCONNECTED", "edge_ids must form one connected route in the supplied order.");
                }
                else if (i == 0) forward = true;
                else if (edge.m_Start == routeEnd) forward = true;
                else if (edge.m_End == routeEnd) forward = false;
                else throw new QueryException("PARALLEL_ROUTE_DISCONNECTED", "edge_ids must form one connected route in the supplied order.");
                var curve = em.GetComponentData<Curve>(entity).m_Bezier; var elevation = em.HasComponent<Elevation>(entity) ? em.GetComponentData<Elevation>(entity).m_Elevation : new float2(0);
                if (!forward) { curve = MathUtils.Invert(curve); elevation = elevation.yx; }
                var sourcePrefab = em.GetComponentData<PrefabRef>(entity).m_Prefab;
                if (!prefabs.TryGetPrefab<PrefabBase>(sourcePrefab, out var sourcePrefabBase)) throw new QueryException("PREFAB_UNAVAILABLE", "A source road prefab is unavailable.");
                var targetPrefab = requestedPrefab != Entity.Null ? requestedPrefab : sourcePrefab;
                if (RoadOperation.IsLocked(em, targetPrefab)) throw new QueryException("ROAD_LOCKED", "An inherited source road prefab is not unlocked.");
                var minimumOffset = (em.GetComponentData<NetGeometryData>(sourcePrefab).m_DefaultWidth + em.GetComponentData<NetGeometryData>(targetPrefab).m_DefaultWidth) * 0.5f + 1f;
                if (offset + 0.001f < minimumOffset) throw new QueryException("PARALLEL_OFFSET_TOO_SMALL", "offset_m must be at least " + minimumOffset.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + " metres for the selected road widths.");
                oriented.Add(Tuple.Create(entity, curve, elevation, targetPrefab, requestedName ?? sourcePrefabBase.name));
                if (i == 0) routeStart = forward ? edge.m_Start : edge.m_End;
                routeEnd = forward ? edge.m_End : edge.m_Start;
            }
            var closed = routeEnd == routeStart;
            if (closed && connectEnds) throw new QueryException("INVALID_ARGUMENT", "connect_ends is only valid for an open source route.");
            var heights = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (!heights.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");
            var sign = side == "left" ? 1f : -1f;
            float2 Normal(Bezier4x3 curve, float t)
            {
                var before = MathUtils.Position(curve, math.max(0, t - 0.01f)).xz; var after = MathUtils.Position(curve, math.min(1, t + 0.01f)).xz;
                var tangent = math.normalizesafe(after - before, new float2(1, 0)); return new float2(-tangent.y, tangent.x) * sign;
            }
            float3 OffsetPoint(float3 source, Bezier4x3 curve, float t, float2 elevation)
            {
                var xz = source.xz + Normal(curve, t) * offset; var result = new float3(xz.x, 0, xz.y);
                result.y = TerrainUtils.SampleHeight(ref heights, result) + math.lerp(elevation.x, elevation.y, t); return result;
            }
            if (avoidObstacles)
            {
                var buildingObstacles = new List<Tuple<float2, float>>();
                using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Game.Buildings.Building>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
                using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities)
                {
                    var transform = em.GetComponentData<Game.Objects.Transform>(entity); var prefab = em.GetComponentData<PrefabRef>(entity).m_Prefab; float radius = 8 + clearance;
                    if (em.HasComponent<ObjectGeometryData>(prefab)) { var bounds = em.GetComponentData<ObjectGeometryData>(prefab).m_Bounds; radius = math.length((bounds.max - bounds.min).xz) * 0.5f + clearance; }
                    buildingObstacles.Add(Tuple.Create(transform.m_Position.xz, radius));
                }
                var roadObstacles = new List<Tuple<Bezier4x3, float>>();
                using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<Road>(), ComponentType.ReadOnly<Curve>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
                using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities)
                {
                    if (sourceEntities.Contains(entity)) continue; var prefab = em.GetComponentData<PrefabRef>(entity).m_Prefab;
                    roadObstacles.Add(Tuple.Create(em.GetComponentData<Curve>(entity).m_Bezier, em.HasComponent<NetGeometryData>(prefab) ? em.GetComponentData<NetGeometryData>(prefab).m_DefaultWidth * 0.5f : 4f));
                }
                bool Clear(float candidate)
                {
                    foreach (var item in oriented)
                    {
                        var source = item.Item2; var targetHalfWidth = em.GetComponentData<NetGeometryData>(item.Item4).m_DefaultWidth * 0.5f;
                        for (int sample = 0; sample <= 16; sample++)
                        {
                            var t = sample / 16f; var point = MathUtils.Position(source, t).xz + Normal(source, t) * candidate;
                            if (buildingObstacles.Any(obstacle => math.distancesq(point, obstacle.Item1) < (obstacle.Item2 + targetHalfWidth) * (obstacle.Item2 + targetHalfWidth))) return false;
                            foreach (var obstacle in roadObstacles)
                            {
                                var minDistance = targetHalfWidth + obstacle.Item2 + clearance;
                                for (int roadSample = 0; roadSample <= 16; roadSample++) if (math.distancesq(point, MathUtils.Position(obstacle.Item1, roadSample / 16f).xz) < minDistance * minDistance) return false;
                            }
                        }
                    }
                    return true;
                }
                bool found = false; for (var candidate = offset; candidate <= maxOffset + 0.01f; candidate += 4f) if (Clear(candidate)) { offset = candidate; found = true; break; }
                if (!found) throw new QueryException("NO_CLEAR_PARALLEL_OFFSET", "No obstacle-free parallel alignment was found between offset_m and max_offset_m.");
            }
            var plans = new List<RoadSegmentPlan>();
            foreach (var item in oriented)
            {
                var source = item.Item2; var elevation = item.Item3;
                var curve = new Bezier4x3(OffsetPoint(source.a, source, 0, elevation), OffsetPoint(source.b, source, 1f / 3f, elevation),
                    OffsetPoint(source.c, source, 2f / 3f, elevation), OffsetPoint(source.d, source, 1, elevation));
                plans.Add(new RoadSegmentPlan { SourceEdge = item.Item1, Prefab = item.Item4, PrefabName = item.Item5, Role = "parallel",
                    Start = curve.a, End = curve.d, StartElevation = elevation.x, EndElevation = elevation.y, Curve = curve });
            }
            void Join(int previous, int next)
            {
                var a = plans[previous]; var b = plans[next]; var sourceJoint = oriented[previous].Item2.d;
                var incomingNormal = Normal(oriented[previous].Item2, 1); var outgoingNormal = Normal(oriented[next].Item2, 0);
                var sum = incomingNormal + outgoingNormal;
                if (math.lengthsq(sum) < 0.01f) throw new QueryException("PARALLEL_SHARP_TURN", "The source route reverses too sharply to construct a parallel join.");
                var miterDirection = math.normalize(sum); var divisor = math.dot(miterDirection, incomingNormal);
                if (math.abs(divisor) < 0.25f) throw new QueryException("PARALLEL_SHARP_TURN", "The source route turn is too sharp for the requested offset.");
                var xz = sourceJoint.xz + miterDirection * (offset / divisor); var elevation = (a.EndElevation + b.StartElevation) * 0.5f;
                var point = new float3(xz.x, 0, xz.y); point.y = TerrainUtils.SampleHeight(ref heights, point) + elevation;
                a.End = point; a.Curve = new Bezier4x3(a.Curve.a, a.Curve.b, a.Curve.c, point);
                b.Start = point; b.Curve = new Bezier4x3(point, b.Curve.b, b.Curve.c, b.Curve.d);
            }
            for (int i = 0; i + 1 < plans.Count; i++) Join(i, i + 1);
            if (closed) Join(plans.Count - 1, 0);
            foreach (var plan in plans) ValidateRoadCurve(plan.Curve, plan.StartElevation, plan.EndElevation, plan.Prefab, em);
            if (connectEnds)
            {
                if (offset < 16) throw new QueryException("PARALLEL_CONNECTION_TOO_SHORT", "connect_ends requires offset_m of at least 16 metres.");
                if (connectionPrefab == Entity.Null) { connectionPrefab = plans[0].Prefab; connectionName = plans[0].PrefabName; }
                void AddEndConnection(float3 parallelPoint, float parallelElevation, Entity sourceNode, string role)
                {
                    var sourcePosition = em.GetComponentData<Node>(sourceNode).m_Position;
                    var curve = NetUtils.StraightCurve(parallelPoint, sourcePosition); ValidateRoadCurve(curve, parallelElevation, 0, connectionPrefab, em);
                    plans.Add(new RoadSegmentPlan { Prefab = connectionPrefab, PrefabName = connectionName, Role = role, Start = parallelPoint, End = sourcePosition,
                        EndTarget = sourceNode, StartElevation = parallelElevation, Curve = curve });
                }
                AddEndConnection(plans[0].Start, plans[0].StartElevation, routeStart, "parallel_start_connection");
                AddEndConnection(plans[oriented.Count - 1].End, plans[oriented.Count - 1].EndElevation, routeEnd, "parallel_end_connection");
            }
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "create", CurveMode = "parallel",
                Prefab = plans[0].Prefab, PrefabName = requestedName ?? plans[0].PrefabName, ParallelSide = side, ParallelOffset = offset, ParallelClosed = closed,
                ParallelRequestedOffset = requestedOffset, ParallelAvoidObstacles = avoidObstacles, ParallelConnectEnds = connectEnds, ParallelInheritedPrefabs = requestedPrefab == Entity.Null, Start = plans[0].Start, End = plans[oriented.Count - 1].End,
                StartElevation = plans[0].StartElevation, EndElevation = plans[oriented.Count - 1].EndElevation, Curve = plans[0].Curve };
            operation.TargetEdges.AddRange(sourceEntities); operation.Segments.AddRange(plans);
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id); return operation.Json();
        }
        private JObject PreviewRoadAutoroute(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["operation_type"] = "autoroute", ["road_prefab"] = args["road_prefab"]?.DeepClone(),
                ["start"] = args["start"]?.DeepClone(), ["end"] = args["end"]?.DeepClone(), ["strategy"] = args["strategy"]?.DeepClone(),
                ["grid_size_m"] = args["grid_size_m"]?.DeepClone(), ["max_detour_m"] = args["max_detour_m"]?.DeepClone(),
                ["zoning_alignment"] = args["zoning_alignment"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another route.");
                return old.Json();
            }
            float Number(string field, float fallback, float min, float max)
            {
                if (args[field] == null) return fallback;
                if ((args[field].Type != JTokenType.Float && args[field].Type != JTokenType.Integer) ||
                    !float.TryParse(args[field].ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value) ||
                    !math.isfinite(value) || value < min || value > max) throw new QueryException("INVALID_ARGUMENT", field + " is outside its supported range.");
                return value;
            }
            var strategy = (string)args["strategy"] ?? "balanced";
            if (strategy != "shortest" && strategy != "balanced" && strategy != "gentle") throw new QueryException("INVALID_ARGUMENT", "strategy must be shortest, balanced or gentle.");
            var zoningAlignment = args["zoning_alignment"] == null || (bool)args["zoning_alignment"];
            var gridSize = Number("grid_size_m", 24, 16, 48); var maxDetour = Number("max_detour_m", 192, 64, 512);
            if (zoningAlignment && math.abs(gridSize / 8f - math.round(gridSize / 8f)) > 0.001f)
                throw new QueryException("INVALID_ARGUMENT", "grid_size_m must be a multiple of 8 metres when zoning_alignment is enabled.");
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before planning a road route.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); Entity prefabEntity = Entity.Null; var name = (string)args["road_prefab"];
            foreach (var e in RoadPrefabs(em)) if (prefabs.TryGetPrefab<PrefabBase>(e, out var p) && p is RoadPrefab && p.name == name) { prefabEntity = e; break; }
            if (prefabEntity == Entity.Null) throw new QueryException("UNKNOWN_ROAD_PREFAB", "Use an exact name from list_road_prefabs.");
            if (RoadOperation.IsLocked(em, prefabEntity)) throw new QueryException("ROAD_LOCKED", "This road is not unlocked.");
            var heights = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (!heights.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");
            var start = RoadPoint(args, "start", world, heights); var end = RoadPoint(args, "end", world, heights);
            bool IsZoningGrid(float2 p) => math.all(math.abs(p / gridSize - math.round(p / gridSize)) < 0.01f);
            void AlignEndpoint(RoadEndpoint endpoint, string field)
            {
                if (!zoningAlignment) return;
                if (endpoint.Target != Entity.Null)
                {
                    if (!IsZoningGrid(endpoint.Position.xz)) throw new QueryException("ZONING_ALIGNMENT_UNAVAILABLE", field + " existing network position is not aligned to grid_size_m.");
                    return;
                }
                endpoint.Position.xz = math.round(endpoint.Position.xz / gridSize) * gridSize;
                endpoint.Position.y = TerrainUtils.SampleHeight(ref heights, endpoint.Position) + endpoint.Elevation;
            }
            AlignEndpoint(start, "start"); AlignEndpoint(end, "end");
            var directDistance = math.distance(start.Position.xz, end.Position.xz);
            if (directDistance < 16 || directDistance > 2048) throw new QueryException("INVALID_ROAD_LENGTH", "Automatic routes must span 16..2048 metres.");
            var geometry = em.GetComponentData<NetGeometryData>(prefabEntity); var slopeLimit = geometry.m_MaxSlopeSteepness > 0 ? geometry.m_MaxSlopeSteepness : 0.08f;
            var roadClearance = geometry.m_DefaultWidth * 0.5f + 4f;
            var min = math.min(start.Position.xz, end.Position.xz) - maxDetour; var max = math.max(start.Position.xz, end.Position.xz) + maxDetour;
            if (zoningAlignment) { min = math.floor(min / gridSize) * gridSize; max = math.ceil(max / gridSize) * gridSize; }
            int columns = (int)math.ceil((max.x - min.x) / gridSize) + 1, rows = (int)math.ceil((max.y - min.y) / gridSize) + 1;
            if ((long)columns * rows > 16000) throw new QueryException("ROUTE_SEARCH_TOO_LARGE", "Increase grid_size_m or reduce max_detour_m for this route.");
            var obstacles = new List<Tuple<float2, float>>();
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Game.Buildings.Building>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.ReadOnly<PrefabRef>()))
            using (var entities = query.ToEntityArray(Allocator.Temp))
            {
                foreach (var entity in entities)
                {
                    if (em.HasComponent<Deleted>(entity) || em.HasComponent<Temp>(entity)) continue;
                    var transform = em.GetComponentData<Game.Objects.Transform>(entity); if (math.any(transform.m_Position.xz < min - 128) || math.any(transform.m_Position.xz > max + 128)) continue;
                    var prefab = em.GetComponentData<PrefabRef>(entity).m_Prefab; float radius = roadClearance + 8;
                    if (em.HasComponent<ObjectGeometryData>(prefab))
                    {
                        var bounds = em.GetComponentData<ObjectGeometryData>(prefab).m_Bounds;
                        radius = math.length((bounds.max - bounds.min).xz) * 0.5f + roadClearance;
                    }
                    obstacles.Add(Tuple.Create(transform.m_Position.xz, radius));
                }
            }
            int Index(int x, int y) => x + y * columns;
            float2 GridPoint(int index) => min + new float2(index % columns, index / columns) * gridSize;
            int Cell(float2 p)
            {
                var cell = (int2)math.round((p - min) / gridSize); cell = math.clamp(cell, 0, new int2(columns - 1, rows - 1)); return Index(cell.x, cell.y);
            }
            bool Blocked(float2 p)
            {
                foreach (var obstacle in obstacles) if (math.distancesq(p, obstacle.Item1) < obstacle.Item2 * obstacle.Item2) return true;
                return false;
            }
            var total = columns * rows; var terrainHeights = Enumerable.Repeat(float.NaN, total).ToArray();
            float Height(int index)
            {
                if (!float.IsNaN(terrainHeights[index])) return terrainHeights[index];
                var p = GridPoint(index); var sample = new float3(p.x, 0, p.y); terrainHeights[index] = TerrainUtils.SampleHeight(ref heights, sample); return terrainHeights[index];
            }
            var startCell = Cell(start.Position.xz); var endCell = Cell(end.Position.xz);
            var scores = Enumerable.Repeat(float.PositiveInfinity, total).ToArray(); var previous = Enumerable.Repeat(-1, total).ToArray(); var closed = new bool[total];
            var open = new SortedSet<Tuple<float, int, int>>(); int serial = 0; scores[startCell] = 0; open.Add(Tuple.Create(directDistance, serial++, startCell));
            var directions = zoningAlignment
                ? new[] { new int2(0,-1), new int2(-1,0), new int2(1,0), new int2(0,1) }
                : new[] { new int2(-1,-1), new int2(0,-1), new int2(1,-1), new int2(-1,0), new int2(1,0), new int2(-1,1), new int2(0,1), new int2(1,1) };
            while (open.Count > 0)
            {
                var item = open.Min; open.Remove(item); var current = item.Item3; if (closed[current]) continue; closed[current] = true; if (current == endCell) break;
                var cx = current % columns; var cy = current / columns; var a = GridPoint(current); var ah = Height(current);
                foreach (var delta in directions)
                {
                    var nx = cx + delta.x; var ny = cy + delta.y; if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
                    var next = Index(nx, ny); if (closed[next]) continue; var b = GridPoint(next);
                    if (next != endCell && next != startCell && Blocked(b)) continue;
                    var distance = math.distance(a, b); var slope = math.abs(Height(next) - ah) / distance; if (slope > slopeLimit * 0.95f) continue;
                    var slopeWeight = strategy == "gentle" ? 12f : strategy == "balanced" ? 4f : 1f;
                    var score = scores[current] + distance * (1f + slope * slopeWeight);
                    if (score >= scores[next]) continue;
                    scores[next] = score; previous[next] = current;
                    open.Add(Tuple.Create(score + math.distance(b, end.Position.xz), serial++, next));
                }
            }
            if (startCell != endCell && previous[endCell] < 0) throw new QueryException("NO_AUTOROUTE", "No route within the requested detour corridor satisfies terrain slope and building clearance.");
            var cells = new List<int>(); for (int at = endCell; at >= 0; at = at == startCell ? -1 : previous[at]) { cells.Add(at); if (at != startCell && previous[at] < 0) break; }
            cells.Reverse(); var raw = new List<float3> { start.Position };
            for (int i = 1; i + 1 < cells.Count; i++) { var p = GridPoint(cells[i]); raw.Add(new float3(p.x, Height(cells[i]), p.y)); }
            raw.Add(end.Position);
            bool ClearLine(float3 a, float3 b)
            {
                var length = math.distance(a.xz, b.xz); if (length > 248) return false; var samples = math.max(2, (int)math.ceil(length / (gridSize * 0.5f)));
                if (zoningAlignment && math.abs(a.x - b.x) > 0.01f && math.abs(a.z - b.z) > 0.01f) return false;
                var previousPoint = a;
                for (int i = 1; i <= samples; i++)
                {
                    var t = i / (float)samples; var xz = math.lerp(a.xz, b.xz, t); if (i < samples && Blocked(xz)) return false;
                    var point = new float3(xz.x, i == samples ? b.y : TerrainUtils.SampleHeight(ref heights, new float3(xz.x, 0, xz.y)), xz.y);
                    if (math.abs(point.y - previousPoint.y) / math.max(0.01f, math.distance(point.xz, previousPoint.xz)) > slopeLimit * 0.95f) return false;
                    previousPoint = point;
                }
                return true;
            }
            var route = new List<float3> { raw[0] }; int anchor = 0;
            while (anchor < raw.Count - 1)
            {
                int next = anchor + 1; for (int candidate = anchor + 2; candidate < raw.Count && ClearLine(raw[anchor], raw[candidate]); candidate++) next = candidate;
                route.Add(raw[next]); anchor = next;
            }
            if (route.Count > 33) throw new QueryException("ROUTE_TOO_COMPLEX", "The planned route needs more than 32 road segments; increase grid size or reduce the route distance.");
            for (int i = 0; i + 1 < route.Count; i++) if (math.distance(route[i].xz, route[i + 1].xz) < 16) throw new QueryException("ROUTE_SEGMENT_TOO_SHORT", "The planned route contains a segment shorter than 16 metres; adjust endpoints or grid size.");
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "create", Prefab = prefabEntity, PrefabName = name,
                CurveMode = "autoroute", PlannerStrategy = strategy, PlannerGridSize = gridSize, PlannerObstacleCount = obstacles.Count, ZoningAligned = zoningAlignment,
                ZoningValidation = zoningAlignment ? "planned" : null };
            for (int i = 0; i + 1 < route.Count; i++)
            {
                var curve = NetUtils.StraightCurve(route[i], route[i + 1]); ValidateRoadCurve(curve, 0, 0, prefabEntity, em);
                operation.Segments.Add(new RoadSegmentPlan { Start = route[i], End = route[i + 1], StartTarget = i == 0 ? start.Target : Entity.Null,
                    EndTarget = i + 1 == route.Count - 1 ? end.Target : Entity.Null, StartSplit = i == 0 ? start.Split : 0, EndSplit = i + 1 == route.Count - 1 ? end.Split : 0,
                    StartElevation = i == 0 ? start.Elevation : 0, EndElevation = i + 1 == route.Count - 1 ? end.Elevation : 0, Curve = curve });
            }
            var first = operation.Segments[0]; var last = operation.Segments[operation.Segments.Count - 1]; operation.Start = first.Start; operation.End = last.End;
            operation.StartNode = first.StartTarget; operation.EndNode = last.EndTarget; operation.StartSplit = first.StartSplit; operation.EndSplit = last.EndSplit;
            operation.StartElevation = first.StartElevation; operation.EndElevation = last.EndElevation; operation.Curve = first.Curve;
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id); return operation.Json();
        }
        private JObject PreviewRoadUpgrade(JObject args, World world) => PreviewExistingRoadOperation(args, world, "upgrade");
        private JObject PreviewRoadDemolition(JObject args, World world) => PreviewExistingRoadOperation(args, world, "demolish");
        private JObject PreviewRoadBatchUpgrade(JObject args, World world) => PreviewExistingRoadOperation(args, world, "upgrade", true);
        private JObject PreviewRoadBatchDemolition(JObject args, World world) => PreviewExistingRoadOperation(args, world, "demolish", true);
        private JObject PreviewRoadElevation(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["operation_type"] = "terrain_elevation", ["edge_ids"] = args["edge_ids"]?.DeepClone(),
                ["clearance_m"] = args["clearance_m"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another road operation.");
                return old.Json();
            }
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var clearance = TerrainNumber(args, "clearance_m", 0.5f, 0.05f, 50f);
            var ids = args["edge_ids"] as JArray;
            if (ids == null || ids.Count < 1 || ids.Count > 64) throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain 1..64 road edge IDs.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before moving roads vertically.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var heights = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (!heights.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var unique = new HashSet<Entity>();
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "terrain_elevation", TransactionKind = "direct_atomic_elevation",
                CurveMode = "existing", TerrainClearance = clearance, ElevationBeforeMin = float.MaxValue, ElevationBeforeMax = float.MinValue,
                ElevationTargetMin = float.MaxValue, ElevationTargetMax = float.MinValue };
            foreach (var token in ids)
            {
                var target = ParseEntity((string)token, em);
                if (!unique.Add(target)) throw new QueryException("DUPLICATE_ROAD_EDGE", "edge_ids must not contain duplicates.");
                if (!em.HasComponent<Edge>(target) || !em.HasComponent<Curve>(target) || !em.HasComponent<Road>(target) || !em.HasComponent<PrefabRef>(target) || em.HasComponent<Temp>(target))
                    throw new QueryException("INVALID_ROAD_EDGE", "Every edge_id must identify an existing permanent road edge.");
                var prefab = em.GetComponentData<PrefabRef>(target).m_Prefab;
                if (!prefabs.TryGetPrefab<PrefabBase>(prefab, out var prefabBase)) throw new QueryException("PREFAB_UNAVAILABLE", "A road prefab is unavailable.");
                var edge = em.GetComponentData<Edge>(target); var oldCurve = em.GetComponentData<Curve>(target).m_Bezier; var curve = oldCurve;
                float Ground(float3 p) { var sample = p; sample.y = 0; return TerrainUtils.SampleHeight(ref heights, sample) + clearance; }
                curve.a.y = Ground(curve.a); curve.b.y = Ground(curve.b); curve.c.y = Ground(curve.c); curve.d.y = Ground(curve.d);
                operation.ElevationBeforeMin = math.min(operation.ElevationBeforeMin, math.cmin(new float4(oldCurve.a.y, oldCurve.b.y, oldCurve.c.y, oldCurve.d.y)));
                operation.ElevationBeforeMax = math.max(operation.ElevationBeforeMax, math.cmax(new float4(oldCurve.a.y, oldCurve.b.y, oldCurve.c.y, oldCurve.d.y)));
                operation.ElevationTargetMin = math.min(operation.ElevationTargetMin, math.cmin(new float4(curve.a.y, curve.b.y, curve.c.y, curve.d.y)));
                operation.ElevationTargetMax = math.max(operation.ElevationTargetMax, math.cmax(new float4(curve.a.y, curve.b.y, curve.c.y, curve.d.y)));
                operation.TargetEdges.Add(target);
                operation.Segments.Add(new RoadSegmentPlan { TargetEdge = target, OriginalPrefab = prefab, Prefab = prefab, OriginalPrefabName = prefabBase.name, PrefabName = prefabBase.name,
                    Start = curve.a, End = curve.d, StartTarget = edge.m_Start, EndTarget = edge.m_End,
                    StartElevation = clearance, EndElevation = clearance, Curve = curve });
                void AddNode(Entity node, float3 position)
                {
                    if (operation.TargetNodes.Contains(node)) return;
                    if (!em.HasComponent<Node>(node) || !em.HasComponent<PrefabRef>(node)) throw new QueryException("INVALID_ROAD_NODE", "Every selected edge endpoint must be a permanent road node.");
                    operation.TargetNodes.Add(node);
                    var hadElevation = em.HasComponent<Elevation>(node);
                    operation.ElevatedNodes.Add(new RoadNodeElevationPlan { Node = node, Prefab = em.GetComponentData<PrefabRef>(node).m_Prefab,
                        Position = position, OriginalPosition = em.GetComponentData<Node>(node).m_Position, Elevation = clearance, HadElevation = hadElevation,
                        OriginalElevation = hadElevation ? em.GetComponentData<Elevation>(node).m_Elevation : new float2(0), HadUpdated = em.HasComponent<Updated>(node) });
                }
                AddNode(edge.m_Start, curve.a); AddNode(edge.m_End, curve.d);
            }
            if (operation.ElevationBeforeMin >= operation.ElevationTargetMin - 0.02f && operation.ElevationBeforeMax >= operation.ElevationTargetMax - 0.02f)
                throw new QueryException("NO_CHANGE", "All selected roads are already at or above the requested terrain clearance.");
            var first = operation.Segments[0]; var last = operation.Segments[operation.Segments.Count - 1];
            operation.TargetEdge = operation.TargetEdges[0]; operation.Prefab = first.OriginalPrefab; operation.PrefabName = first.OriginalPrefabName; operation.OriginalPrefabName = first.OriginalPrefabName;
            operation.Start = first.Start; operation.End = last.End; operation.StartNode = first.StartTarget; operation.EndNode = last.EndTarget;
            operation.StartElevation = clearance; operation.EndElevation = clearance; operation.Curve = first.Curve;
            operation.State = "preview_ready"; operation.Cost = 0;
            m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id);
            return operation.Json();
        }
        private JObject PreviewRoadReverse(JObject args, World world, bool batch = false)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["operation_type"] = batch ? "batch_reverse" : "reverse",
                [batch ? "edge_ids" : "edge_id"] = args[batch ? "edge_ids" : "edge_id"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another road operation.");
                return old.Json();
            }
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before reversing a one-way road.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            var ids = batch ? args["edge_ids"] as JArray : new JArray(args["edge_id"]);
            if (ids == null || ids.Count < 1 || ids.Count > 64) throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain 1..64 road edge IDs.");
            var unique = new HashSet<Entity>();
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint,
                OperationType = batch ? "batch_reverse" : "reverse", CurveMode = "existing" };
            foreach (var token in ids)
            {
                var target = ParseEntity((string)token, em);
                if (!unique.Add(target)) throw new QueryException("DUPLICATE_ROAD_EDGE", "edge_ids must not contain duplicates.");
                if (!em.HasComponent<Edge>(target) || !em.HasComponent<Curve>(target) || !em.HasComponent<Road>(target) || !em.HasComponent<PrefabRef>(target) || em.HasComponent<Temp>(target))
                    throw new QueryException("INVALID_ROAD_EDGE", "Every selected edge must identify an existing permanent road edge.");
                var prefabEntity = em.GetComponentData<PrefabRef>(target).m_Prefab;
                var roadData = em.GetComponentData<RoadData>(prefabEntity);
                var forward = (roadData.m_Flags & Game.Prefabs.RoadFlags.DefaultIsForward) != 0;
                var backward = (roadData.m_Flags & Game.Prefabs.RoadFlags.DefaultIsBackward) != 0;
                if (forward == backward) throw new QueryException("ROAD_NOT_ONEWAY", "Every selected road must be one-way.");
                if (!prefabs.TryGetPrefab<PrefabBase>(prefabEntity, out var prefab)) throw new QueryException("PREFAB_UNAVAILABLE", "A road prefab is unavailable.");
                var edge = em.GetComponentData<Edge>(target); var curve = MathUtils.Invert(em.GetComponentData<Curve>(target).m_Bezier);
                var elevation = em.HasComponent<Elevation>(target) ? em.GetComponentData<Elevation>(target).m_Elevation : new float2(0);
                operation.TargetEdges.Add(target);
                operation.Segments.Add(new RoadSegmentPlan { TargetEdge = target, OriginalPrefab = prefabEntity, OriginalPrefabName = prefab.name,
                    Start = curve.a, End = curve.d, StartTarget = edge.m_End, EndTarget = edge.m_Start,
                    StartElevation = elevation.y, EndElevation = elevation.x, Curve = curve });
            }
            var first = operation.Segments[0]; var last = operation.Segments[operation.Segments.Count - 1];
            operation.TargetEdge = operation.TargetEdges[0]; operation.Prefab = first.OriginalPrefab; operation.PrefabName = first.OriginalPrefabName; operation.OriginalPrefabName = first.OriginalPrefabName;
            operation.Start = first.Start; operation.End = last.End; operation.StartNode = first.StartTarget; operation.EndNode = last.EndTarget;
            operation.StartElevation = first.StartElevation; operation.EndElevation = last.EndElevation; operation.Curve = first.Curve;
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id);
            return operation.Json();
        }
        private JObject PreviewRoadZoning(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["operation_type"] = "zoning", ["edge_ids"] = args["edge_ids"]?.DeepClone(),
                ["left_enabled"] = args["left_enabled"]?.DeepClone(), ["right_enabled"] = args["right_enabled"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another road operation.");
                return old.Json();
            }
            if (args["left_enabled"] == null && args["right_enabled"] == null) throw new QueryException("INVALID_ARGUMENT", "Set left_enabled or right_enabled.");
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before changing road zoning.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var edgeIds = args["edge_ids"] as JArray;
            if (edgeIds == null || edgeIds.Count < 1 || edgeIds.Count > 64) throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain 1..64 road edge IDs.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var unique = new HashSet<Entity>();
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "zoning", CurveMode = "existing" };
            bool changed = false;
            foreach (var token in edgeIds)
            {
                var target = ParseEntity((string)token, em);
                if (!unique.Add(target)) throw new QueryException("DUPLICATE_ROAD_EDGE", "edge_ids must not contain duplicates.");
                if (!em.HasComponent<Edge>(target) || !em.HasComponent<Curve>(target) || !em.HasComponent<Road>(target) || !em.HasComponent<PrefabRef>(target) || em.HasComponent<Temp>(target))
                    throw new QueryException("INVALID_ROAD_EDGE", "Every edge_id must identify an existing permanent road edge.");
                var originalPrefab = em.GetComponentData<PrefabRef>(target).m_Prefab;
                if (!prefabs.TryGetPrefab<PrefabBase>(originalPrefab, out var originalBase)) throw new QueryException("PREFAB_UNAVAILABLE", "A road's prefab is unavailable.");
                var flags = em.HasComponent<Upgraded>(target) ? em.GetComponentData<Upgraded>(target).m_Flags : default(CompositionFlags);
                var before = flags;
                if (args["left_enabled"] != null) { if ((bool)args["left_enabled"]) flags.m_Left &= ~CompositionFlags.Side.ZonesDisabled; else flags.m_Left |= CompositionFlags.Side.ZonesDisabled; }
                if (args["right_enabled"] != null) { if ((bool)args["right_enabled"]) flags.m_Right &= ~CompositionFlags.Side.ZonesDisabled; else flags.m_Right |= CompositionFlags.Side.ZonesDisabled; }
                changed |= flags != before;
                var edge = em.GetComponentData<Edge>(target); var curve = em.GetComponentData<Curve>(target).m_Bezier;
                var elevation = em.HasComponent<Elevation>(target) ? em.GetComponentData<Elevation>(target).m_Elevation : new float2(0);
                operation.TargetEdges.Add(target);
                operation.Segments.Add(new RoadSegmentPlan { TargetEdge = target, OriginalPrefab = originalPrefab, OriginalPrefabName = originalBase.name,
                    HasUpgradeFlags = true, UpgradeFlags = flags, Start = curve.a, End = curve.d, StartTarget = edge.m_Start, EndTarget = edge.m_End,
                    StartElevation = elevation.x, EndElevation = elevation.y, Curve = curve });
            }
            if (!changed) throw new QueryException("NO_CHANGE", "All selected road sides already have the requested zoning state.");
            var first = operation.Segments[0]; var last = operation.Segments[operation.Segments.Count - 1];
            operation.TargetEdge = operation.TargetEdges[0]; operation.Prefab = first.OriginalPrefab; operation.PrefabName = first.OriginalPrefabName; operation.OriginalPrefabName = first.OriginalPrefabName;
            operation.Start = first.Start; operation.End = last.End; operation.StartNode = first.StartTarget; operation.EndNode = last.EndTarget;
            operation.StartElevation = first.StartElevation; operation.EndElevation = last.EndElevation; operation.Curve = first.Curve;
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id);
            return operation.Json();
        }
        private JObject PreviewRoadFeatures(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["operation_type"] = "road_features", ["edge_ids"] = args["edge_ids"]?.DeepClone(),
                ["left_wide_sidewalk"] = args["left_wide_sidewalk"]?.DeepClone(), ["right_wide_sidewalk"] = args["right_wide_sidewalk"]?.DeepClone(),
                ["left_decoration"] = args["left_decoration"]?.DeepClone(), ["right_decoration"] = args["right_decoration"]?.DeepClone(),
                ["wide_median"] = args["wide_median"]?.DeepClone(), ["median_decoration"] = args["median_decoration"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another road operation.");
                return old.Json();
            }
            string[] fields = { "left_wide_sidewalk", "right_wide_sidewalk", "left_decoration", "right_decoration", "wide_median", "median_decoration" };
            if (fields.All(field => args[field] == null)) throw new QueryException("INVALID_ARGUMENT", "Set at least one road feature.");
            string ReadDecoration(string field)
            {
                var value = (string)args[field];
                if (value != null && value != "none" && value != "grass" && value != "trees") throw new QueryException("INVALID_ARGUMENT", field + " must be none, grass or trees.");
                return value;
            }
            var leftDecoration = ReadDecoration("left_decoration"); var rightDecoration = ReadDecoration("right_decoration"); var medianDecoration = ReadDecoration("median_decoration");
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before changing road features.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var edgeIds = args["edge_ids"] as JArray;
            if (edgeIds == null || edgeIds.Count < 1 || edgeIds.Count > 64) throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain 1..64 road edge IDs.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var unique = new HashSet<Entity>();
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "road_features", CurveMode = "existing" };
            bool changed = false;
            foreach (var token in edgeIds)
            {
                var target = ParseEntity((string)token, em);
                if (!unique.Add(target)) throw new QueryException("DUPLICATE_ROAD_EDGE", "edge_ids must not contain duplicates.");
                if (!em.HasComponent<Edge>(target) || !em.HasComponent<Curve>(target) || !em.HasComponent<Road>(target) || !em.HasComponent<PrefabRef>(target) || em.HasComponent<Temp>(target))
                    throw new QueryException("INVALID_ROAD_EDGE", "Every edge_id must identify an existing permanent road edge.");
                var originalPrefab = em.GetComponentData<PrefabRef>(target).m_Prefab;
                if (!prefabs.TryGetPrefab<PrefabBase>(originalPrefab, out var originalBase)) throw new QueryException("PREFAB_UNAVAILABLE", "A road's prefab is unavailable.");
                var netData = em.GetComponentData<NetData>(originalPrefab);
                var requestedGeneral = (args["wide_median"] != null ? CompositionFlags.General.WideMedian : 0) |
                    (args["median_decoration"] != null ? CompositionFlags.General.PrimaryMiddleBeautification | CompositionFlags.General.SecondaryMiddleBeautification : 0);
                var requestedSide = (args["left_wide_sidewalk"] != null || args["right_wide_sidewalk"] != null ? CompositionFlags.Side.WideSidewalk : 0) |
                    (args["left_decoration"] != null || args["right_decoration"] != null ? CompositionFlags.Side.PrimaryBeautification | CompositionFlags.Side.SecondaryBeautification : 0);
                if ((netData.m_GeneralFlagMask & requestedGeneral) != requestedGeneral || (netData.m_SideFlagMask & requestedSide) != requestedSide)
                    throw new QueryException("ROAD_FEATURE_UNSUPPORTED", originalBase.name + " does not support every requested feature.");
                var flags = em.HasComponent<Upgraded>(target) ? em.GetComponentData<Upgraded>(target).m_Flags : default(CompositionFlags); var before = flags;
                void SetSide(ref CompositionFlags.Side side, JToken wide, string decoration)
                {
                    if (wide != null) { if ((bool)wide) side |= CompositionFlags.Side.WideSidewalk; else side &= ~CompositionFlags.Side.WideSidewalk; }
                    if (decoration != null)
                    {
                        side &= ~(CompositionFlags.Side.PrimaryBeautification | CompositionFlags.Side.SecondaryBeautification);
                        if (decoration == "grass") side |= CompositionFlags.Side.PrimaryBeautification;
                        else if (decoration == "trees") side |= CompositionFlags.Side.SecondaryBeautification;
                    }
                }
                SetSide(ref flags.m_Left, args["left_wide_sidewalk"], leftDecoration);
                SetSide(ref flags.m_Right, args["right_wide_sidewalk"], rightDecoration);
                if (args["wide_median"] != null) { if ((bool)args["wide_median"]) flags.m_General |= CompositionFlags.General.WideMedian; else flags.m_General &= ~CompositionFlags.General.WideMedian; }
                if (medianDecoration != null)
                {
                    flags.m_General &= ~(CompositionFlags.General.PrimaryMiddleBeautification | CompositionFlags.General.SecondaryMiddleBeautification);
                    if (medianDecoration == "grass") flags.m_General |= CompositionFlags.General.PrimaryMiddleBeautification;
                    else if (medianDecoration == "trees") flags.m_General |= CompositionFlags.General.SecondaryMiddleBeautification;
                }
                changed |= flags != before;
                var edge = em.GetComponentData<Edge>(target); var curve = em.GetComponentData<Curve>(target).m_Bezier;
                var elevation = em.HasComponent<Elevation>(target) ? em.GetComponentData<Elevation>(target).m_Elevation : new float2(0);
                operation.TargetEdges.Add(target);
                operation.Segments.Add(new RoadSegmentPlan { TargetEdge = target, OriginalPrefab = originalPrefab, OriginalPrefabName = originalBase.name,
                    HasUpgradeFlags = true, UpgradeFlags = flags, Start = curve.a, End = curve.d, StartTarget = edge.m_Start, EndTarget = edge.m_End,
                    StartElevation = elevation.x, EndElevation = elevation.y, Curve = curve });
            }
            if (!changed) throw new QueryException("NO_CHANGE", "All selected roads already have the requested features.");
            var first = operation.Segments[0]; var last = operation.Segments[operation.Segments.Count - 1];
            operation.TargetEdge = operation.TargetEdges[0]; operation.Prefab = first.OriginalPrefab; operation.PrefabName = first.OriginalPrefabName; operation.OriginalPrefabName = first.OriginalPrefabName;
            operation.Start = first.Start; operation.End = last.End; operation.StartNode = first.StartTarget; operation.EndNode = last.EndTarget;
            operation.StartElevation = first.StartElevation; operation.EndElevation = last.EndElevation; operation.Curve = first.Curve;
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id);
            return operation.Json();
        }
        private JObject PreviewIntersectionControl(JObject args, World world)
        {
            var key = RequestKey(args); var mode = (string)args["mode"];
            var fingerprint = new JObject { ["operation_type"] = "intersection_control", ["node_ids"] = args["node_ids"]?.DeepClone(), ["mode"] = mode }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another road operation.");
                return old.Json();
            }
            if (mode != "traffic_lights" && mode != "all_way_stop" && mode != "uncontrolled" && mode != "automatic")
                throw new QueryException("INVALID_ARGUMENT", "mode must be traffic_lights, all_way_stop, uncontrolled or automatic.");
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before changing intersection controls.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var nodeIds = args["node_ids"] as JArray;
            if (nodeIds == null || nodeIds.Count < 1 || nodeIds.Count > 64) throw new QueryException("INVALID_ARGUMENT", "node_ids must contain 1..64 road node IDs.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var unique = new HashSet<Entity>();
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "intersection_control", ControlMode = mode, CurveMode = "node" };
            bool changed = false;
            foreach (var token in nodeIds)
            {
                var node = ParseEntity((string)token, em);
                if (!unique.Add(node)) throw new QueryException("DUPLICATE_ROAD_NODE", "node_ids must not contain duplicates.");
                if (!em.HasComponent<Node>(node) || !em.HasComponent<ConnectedEdge>(node) || !em.HasComponent<PrefabRef>(node) || em.HasComponent<Temp>(node))
                    throw new QueryException("INVALID_ROAD_NODE", "Every node_id must identify an existing permanent road node.");
                var connected = em.GetBuffer<ConnectedEdge>(node, true); int roads = 0;
                for (int i = 0; i < connected.Length; i++) if (em.HasComponent<Road>(connected[i].m_Edge) && !em.HasComponent<Deleted>(connected[i].m_Edge)) roads++;
                if (roads < 3) throw new QueryException("NOT_AN_INTERSECTION", "Intersection control requires at least three connected road edges.");
                var prefab = em.GetComponentData<PrefabRef>(node).m_Prefab;
                if (!prefabs.TryGetPrefab<PrefabBase>(prefab, out var prefabBase)) throw new QueryException("PREFAB_UNAVAILABLE", "A node prefab is unavailable.");
                var flags = em.HasComponent<Upgraded>(node) ? em.GetComponentData<Upgraded>(node).m_Flags : default(CompositionFlags); var before = flags;
                var mask = CompositionFlags.General.TrafficLights | CompositionFlags.General.RemoveTrafficLights | CompositionFlags.General.AllWayStop;
                flags.m_General &= ~mask;
                if (mode == "traffic_lights") flags.m_General |= CompositionFlags.General.TrafficLights;
                else if (mode == "all_way_stop") flags.m_General |= CompositionFlags.General.RemoveTrafficLights | CompositionFlags.General.AllWayStop;
                else if (mode == "uncontrolled") flags.m_General |= CompositionFlags.General.RemoveTrafficLights;
                changed |= flags != before; var position = em.GetComponentData<Node>(node).m_Position;
                operation.TargetNodes.Add(node);
                operation.Segments.Add(new RoadSegmentPlan { TargetNode = node, OriginalPrefab = prefab, OriginalPrefabName = prefabBase.name,
                    HasUpgradeFlags = true, UpgradeFlags = flags, Start = position, End = position, StartTarget = node, EndTarget = node,
                    Curve = new Bezier4x3(position, position, position, position) });
            }
            if (!changed) throw new QueryException("NO_CHANGE", "All selected intersections already have the requested control mode.");
            var first = operation.Segments[0]; operation.Prefab = first.OriginalPrefab; operation.PrefabName = first.OriginalPrefabName;
            operation.Start = first.Start; operation.End = first.End; operation.StartNode = first.TargetNode; operation.EndNode = first.TargetNode; operation.Curve = first.Curve;
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id);
            return operation.Json();
        }
        private JObject PreviewIntersectionRoundabout(JObject args, World world)
        {
            var key = RequestKey(args); var enabled = args["enabled"] != null && (bool)args["enabled"];
            var fingerprint = new JObject { ["operation_type"] = "intersection_roundabout", ["node_id"] = args["node_id"]?.DeepClone(), ["enabled"] = enabled }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another road operation.");
                return old.Json();
            }
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before changing an intersection into a roundabout.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var node = ParseEntity((string)args["node_id"], em);
            if (!em.HasComponent<Node>(node) || !em.HasComponent<ConnectedEdge>(node) || !em.HasComponent<PrefabRef>(node) || em.HasComponent<Temp>(node))
                throw new QueryException("INVALID_ROAD_NODE", "node_id must identify an existing permanent road node.");
            var connected = em.GetBuffer<ConnectedEdge>(node, true); int roads = 0;
            for (int i = 0; i < connected.Length; i++)
            {
                var edge = connected[i].m_Edge;
                if (!em.HasComponent<Road>(edge) || em.HasComponent<Deleted>(edge)) continue;
                roads++;
                if (enabled && em.HasComponent<PrefabRef>(edge))
                {
                    var roadPrefab = em.GetComponentData<PrefabRef>(edge).m_Prefab;
                    if (em.HasComponent<NetGeometryData>(roadPrefab) && (em.GetComponentData<NetGeometryData>(roadPrefab).m_Flags & GeometryFlags.SupportRoundabout) == 0)
                        throw new QueryException("ROUNDABOUT_UNSUPPORTED", "Every connected road prefab must support native roundabouts.");
                }
            }
            if (roads < 3) throw new QueryException("NOT_AN_INTERSECTION", "A native roundabout requires at least three connected road edges.");
            var before = em.HasComponent<Upgraded>(node) ? em.GetComponentData<Upgraded>(node).m_Flags : default(CompositionFlags);
            var flags = before;
            if (enabled)
            {
                flags.m_General |= CompositionFlags.General.Roundabout;
                flags.m_General &= ~(CompositionFlags.General.TrafficLights | CompositionFlags.General.RemoveTrafficLights | CompositionFlags.General.AllWayStop);
            }
            else flags.m_General &= ~CompositionFlags.General.Roundabout;
            if (flags == before) throw new QueryException("NO_CHANGE", "This intersection already has the requested roundabout state.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var prefab = em.GetComponentData<PrefabRef>(node).m_Prefab;
            if (!prefabs.TryGetPrefab<PrefabBase>(prefab, out var prefabBase)) throw new QueryException("PREFAB_UNAVAILABLE", "The node prefab is unavailable.");
            var position = em.GetComponentData<Node>(node).m_Position;
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "intersection_roundabout",
                RoundaboutEnabled = enabled, Prefab = prefab, PrefabName = prefabBase.name, Start = position, End = position, StartNode = node, EndNode = node,
                Curve = new Bezier4x3(position, position, position, position), CurveMode = "node" };
            operation.TargetNodes.Add(node);
            operation.Segments.Add(new RoadSegmentPlan { TargetNode = node, OriginalPrefab = prefab, OriginalPrefabName = prefabBase.name,
                HasUpgradeFlags = true, UpgradeFlags = flags, Start = position, End = position, StartTarget = node, EndTarget = node,
                Curve = operation.Curve });
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id);
            return operation.Json();
        }
        private JObject PreviewIntersectionRules(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["operation_type"] = "intersection_rules", ["edge_id"] = args["edge_id"]?.DeepClone(), ["node_id"] = args["node_id"]?.DeepClone(),
                ["left_turn"] = args["left_turn"]?.DeepClone(), ["right_turn"] = args["right_turn"]?.DeepClone(), ["straight"] = args["straight"]?.DeepClone(), ["crosswalk_enabled"] = args["crosswalk_enabled"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another road operation.");
                return old.Json();
            }
            if (args["left_turn"] == null && args["right_turn"] == null && args["straight"] == null && args["crosswalk_enabled"] == null)
                throw new QueryException("INVALID_ARGUMENT", "Set at least one turn rule or crosswalk_enabled.");
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before changing intersection rules.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var edgeEntity = ParseEntity((string)args["edge_id"], em); var nodeEntity = ParseEntity((string)args["node_id"], em);
            if (!em.HasComponent<Edge>(edgeEntity) || !em.HasComponent<Curve>(edgeEntity) || !em.HasComponent<Road>(edgeEntity) || !em.HasComponent<PrefabRef>(edgeEntity) || em.HasComponent<Temp>(edgeEntity))
                throw new QueryException("INVALID_ROAD_EDGE", "edge_id must identify an existing permanent road edge.");
            if (!em.HasComponent<Node>(nodeEntity) || !em.HasComponent<ConnectedEdge>(nodeEntity) || em.HasComponent<Temp>(nodeEntity))
                throw new QueryException("INVALID_ROAD_NODE", "node_id must identify an existing permanent road node.");
            var edge = em.GetComponentData<Edge>(edgeEntity);
            if (nodeEntity != edge.m_Start && nodeEntity != edge.m_End) throw new QueryException("INVALID_APPROACH", "node_id must be an endpoint of edge_id.");
            var connected = em.GetBuffer<ConnectedEdge>(nodeEntity, true); int roads = 0;
            for (int i = 0; i < connected.Length; i++) if (em.HasComponent<Road>(connected[i].m_Edge) && !em.HasComponent<Deleted>(connected[i].m_Edge)) roads++;
            if (roads < 3) throw new QueryException("NOT_AN_INTERSECTION", "Approach rules require a node with at least three connected road edges.");
            string ReadRule(string field)
            {
                var value = (string)args[field];
                if (value != null && value != "allow" && value != "forbid") throw new QueryException("INVALID_ARGUMENT", field + " must be allow or forbid.");
                return value;
            }
            var left = ReadRule("left_turn"); var right = ReadRule("right_turn"); var straight = ReadRule("straight");
            var flags = em.HasComponent<Upgraded>(edgeEntity) ? em.GetComponentData<Upgraded>(edgeEntity).m_Flags : default(CompositionFlags); var before = flags;
            bool leftHandTraffic = world.GetExistingSystemManaged<Game.City.CityConfigurationSystem>().leftHandTraffic;
            bool useLeftSide = (nodeEntity == edge.m_Start) != leftHandTraffic;
            var side = useLeftSide ? flags.m_Left : flags.m_Right;
            void SetRule(string value, CompositionFlags.Side bit) { if (value == "forbid") side |= bit; else if (value == "allow") side &= ~bit; }
            SetRule(left, CompositionFlags.Side.ForbidLeftTurn); SetRule(right, CompositionFlags.Side.ForbidRightTurn); SetRule(straight, CompositionFlags.Side.ForbidStraight);
            if (args["crosswalk_enabled"] != null)
            {
                if ((bool)args["crosswalk_enabled"]) { side |= CompositionFlags.Side.AddCrosswalk; side &= ~CompositionFlags.Side.RemoveCrosswalk; }
                else { side |= CompositionFlags.Side.RemoveCrosswalk; side &= ~CompositionFlags.Side.AddCrosswalk; }
            }
            if (useLeftSide) flags.m_Left = side; else flags.m_Right = side;
            if (flags == before) throw new QueryException("NO_CHANGE", "This approach already has the requested explicit rules.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var prefab = em.GetComponentData<PrefabRef>(edgeEntity).m_Prefab;
            if (!prefabs.TryGetPrefab<PrefabBase>(prefab, out var prefabBase)) throw new QueryException("PREFAB_UNAVAILABLE", "The road prefab is unavailable.");
            var curve = em.GetComponentData<Curve>(edgeEntity).m_Bezier;
            var elevation = em.HasComponent<Elevation>(edgeEntity) ? em.GetComponentData<Elevation>(edgeEntity).m_Elevation : new float2(0);
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "intersection_rules", TargetEdge = edgeEntity,
                ApproachNodeId = EntityId(nodeEntity), Prefab = prefab, PrefabName = prefabBase.name, OriginalPrefabName = prefabBase.name, Start = curve.a, End = curve.d,
                StartNode = edge.m_Start, EndNode = edge.m_End, StartElevation = elevation.x, EndElevation = elevation.y, Curve = curve, CurveMode = "existing",
                LeftTurnAllowed = left == null ? (bool?)null : left == "allow", RightTurnAllowed = right == null ? (bool?)null : right == "allow",
                StraightAllowed = straight == null ? (bool?)null : straight == "allow", CrosswalkEnabled = args["crosswalk_enabled"] == null ? (bool?)null : (bool)args["crosswalk_enabled"],
                RuleUsesLeftSide = useLeftSide };
            operation.TargetEdges.Add(edgeEntity);
            operation.Segments.Add(new RoadSegmentPlan { TargetEdge = edgeEntity, OriginalPrefab = prefab, OriginalPrefabName = prefabBase.name, HasUpgradeFlags = true, UpgradeFlags = flags,
                Start = curve.a, End = curve.d, StartTarget = edge.m_Start, EndTarget = edge.m_End, StartElevation = elevation.x, EndElevation = elevation.y, Curve = curve });
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id);
            return operation.Json();
        }
        private JObject PreviewExistingRoadOperation(JObject args, World world, string kind, bool batch = false)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["operation_type"] = batch ? "batch_" + kind : kind, ["edge_id"] = args["edge_id"]?.DeepClone(), ["edge_ids"] = args["edge_ids"]?.DeepClone(), ["road_prefab"] = args["road_prefab"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another road operation.");
                return old.Json();
            }
            if (m_RoadOperations.Count >= 128) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 128 road operations; reload the city to reset the journal.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before changing a road.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var edgeIds = batch ? args["edge_ids"] as JArray : new JArray(args["edge_id"]?.DeepClone());
            if (edgeIds == null || edgeIds.Count < 1 || edgeIds.Count > 64) throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain 1..64 road edge IDs.");
            var targets = new List<Entity>(); var unique = new HashSet<Entity>();
            foreach (var token in edgeIds)
            {
                var edgeEntity = ParseEntity((string)token, em);
                if (!unique.Add(edgeEntity)) throw new QueryException("DUPLICATE_ROAD_EDGE", "edge_ids must not contain duplicates.");
                if (!em.HasComponent<Edge>(edgeEntity) || !em.HasComponent<Curve>(edgeEntity) || !em.HasComponent<Road>(edgeEntity) || !em.HasComponent<PrefabRef>(edgeEntity) || em.HasComponent<Temp>(edgeEntity))
                    throw new QueryException("INVALID_ROAD_EDGE", "Every edge_id must identify an existing permanent road edge.");
                targets.Add(edgeEntity);
            }
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            var targetPrefab = Entity.Null; var targetName = kind == "upgrade" ? (string)args["road_prefab"] : null;
            if (kind == "upgrade")
            {
                foreach (var e in RoadPrefabs(em)) if (prefabs.TryGetPrefab<PrefabBase>(e, out var p) && p is RoadPrefab && p.name == targetName) { targetPrefab = e; break; }
                if (targetPrefab == Entity.Null) throw new QueryException("UNKNOWN_ROAD_PREFAB", "Use an exact name from list_road_prefabs.");
                if (RoadOperation.IsLocked(em, targetPrefab)) throw new QueryException("ROAD_LOCKED", "This road is not unlocked.");
            }
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = batch ? "batch_" + kind : kind,
                TargetEdge = targets[0], Prefab = targetPrefab, PrefabName = targetName, CurveMode = "existing" };
            foreach (var edgeEntity in targets)
            {
                var originalPrefab = em.GetComponentData<PrefabRef>(edgeEntity).m_Prefab;
                if (!prefabs.TryGetPrefab<PrefabBase>(originalPrefab, out var originalBase)) throw new QueryException("PREFAB_UNAVAILABLE", "A road's original prefab is unavailable.");
                if (kind == "upgrade" && targetPrefab == originalPrefab) throw new QueryException("NO_CHANGE", "At least one selected road already uses the requested prefab.");
                var edge = em.GetComponentData<Edge>(edgeEntity); var curve = em.GetComponentData<Curve>(edgeEntity).m_Bezier;
                var elevation = em.HasComponent<Elevation>(edgeEntity) ? em.GetComponentData<Elevation>(edgeEntity).m_Elevation : new float2(0);
                operation.TargetEdges.Add(edgeEntity);
                operation.Segments.Add(new RoadSegmentPlan { TargetEdge = edgeEntity, OriginalPrefab = originalPrefab, OriginalPrefabName = originalBase.name,
                    Start = curve.a, End = curve.d, StartTarget = edge.m_Start, EndTarget = edge.m_End,
                    StartElevation = elevation.x, EndElevation = elevation.y, Curve = curve });
            }
            var first = operation.Segments[0]; var last = operation.Segments[operation.Segments.Count - 1];
            operation.OriginalPrefabName = first.OriginalPrefabName; if (kind == "demolish") { operation.Prefab = first.OriginalPrefab; operation.PrefabName = first.OriginalPrefabName; }
            operation.Start = first.Start; operation.End = last.End; operation.StartNode = first.StartTarget; operation.EndNode = last.EndTarget;
            operation.StartElevation = first.StartElevation; operation.EndElevation = last.EndElevation; operation.Curve = first.Curve;
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id);
            return operation.Json();
        }
        private RoadOperation RoadOperationById(JObject args)
        {
            if (!m_RoadOperations.TryGetValue((string)args["operation_id"] ?? "", out var operation) || operation.Session != m_Session)
                throw new QueryException("ROAD_OPERATION_NOT_FOUND", "Unknown operation in this city session. Never replay an old commit after a reload.");
            return operation;
        }
        private JObject CommitRoad(JObject args)
        {
            var op = RoadOperationById(args); var key = RequestKey(args);
            var maxCost = ComponentInspector.Int(args, "max_cost", -1, 0, 10000000);
            if (maxCost < 0) throw new QueryException("INVALID_ARGUMENT", "max_cost is required.");
            if (op.CommitRequestId != null)
            {
                if (op.CommitRequestId != key || op.MaxCost != maxCost) throw new QueryException("IDEMPOTENCY_CONFLICT", "This operation already has a commit request; poll it instead.");
                return op.Json();
            }
            if (op.State != "preview_ready" || op.CancelRequested || DateTime.UtcNow >= op.Expires) throw new QueryException("ROAD_NOT_READY", "Wait for a valid unexpired preview before committing.");
            if (op.Cost > maxCost) throw new QueryException("COST_LIMIT", "Preview cost exceeds max_cost.");
            op.CommitRequestId = key; op.MaxCost = maxCost; op.CommitRequested = true; op.State = "commit_queued";
            if (op.OperationType == "road_policies")
            {
                try { ApplyDirectOperation(op, World.DefaultGameObjectInjectionWorld); }
                catch { op.CommitRequestId = null; op.MaxCost = 0; op.CommitRequested = false; op.State = "preview_ready"; throw; }
            }
            else if (op.TransactionKind == "direct_atomic_elevation")
            {
                try { ApplyRoadElevationDirect(op, World.DefaultGameObjectInjectionWorld); }
                catch { op.CommitRequestId = null; op.MaxCost = 0; op.CommitRequested = false; op.State = "preview_ready"; throw; }
            }
            return op.Json();
        }

        private void ApplyRoadElevationDirect(RoadOperation op, World world)
        {
            var em = world.EntityManager; em.CompleteAllTrackedJobs();
            foreach (var plan in op.ElevatedNodes)
                if (!em.Exists(plan.Node) || em.HasComponent<Deleted>(plan.Node) || !em.HasComponent<Node>(plan.Node) ||
                    math.distance(em.GetComponentData<Node>(plan.Node).m_Position, plan.OriginalPosition) > 0.1f)
                    throw new QueryException("ROAD_CHANGED", "A selected road node changed after preview; create a new elevation preview.");
            foreach (var segment in op.Segments)
                if (!em.Exists(segment.TargetEdge) || em.HasComponent<Deleted>(segment.TargetEdge) || !em.HasComponent<Curve>(segment.TargetEdge) || !em.HasComponent<Edge>(segment.TargetEdge))
                    throw new QueryException("ROAD_CHANGED", "A selected road edge changed after preview; create a new elevation preview.");
            var originalCurves = op.Segments.Select(s => em.GetComponentData<Curve>(s.TargetEdge)).ToArray();
            var edgeElevation = op.Segments.Select(s => em.HasComponent<Elevation>(s.TargetEdge) ? (float2?)em.GetComponentData<Elevation>(s.TargetEdge).m_Elevation : null).ToArray();
            var edgeUpdated = op.Segments.Select(s => em.HasComponent<Updated>(s.TargetEdge)).ToArray();
            try
            {
                foreach (var plan in op.ElevatedNodes)
                {
                    var node = em.GetComponentData<Node>(plan.Node); node.m_Position = plan.Position; em.SetComponentData(plan.Node, node);
                    var elevation = new Elevation { m_Elevation = new float2(plan.Elevation) };
                    if (plan.HadElevation) em.SetComponentData(plan.Node, elevation); else em.AddComponentData(plan.Node, elevation);
                    if (!plan.HadUpdated) em.AddComponent<Updated>(plan.Node);
                }
                for (int i = 0; i < op.Segments.Count; i++)
                {
                    var segment = op.Segments[i]; var curve = originalCurves[i]; curve.m_Bezier = segment.Curve; curve.m_Length = MathUtils.Length(segment.Curve);
                    em.SetComponentData(segment.TargetEdge, curve);
                    var elevation = new Elevation { m_Elevation = new float2(segment.StartElevation, segment.EndElevation) };
                    if (edgeElevation[i].HasValue) em.SetComponentData(segment.TargetEdge, elevation); else em.AddComponentData(segment.TargetEdge, elevation);
                    if (!edgeUpdated[i]) em.AddComponent<Updated>(segment.TargetEdge);
                }
                em.CompleteAllTrackedJobs();
                foreach (var plan in op.ElevatedNodes)
                    if (math.distance(em.GetComponentData<Node>(plan.Node).m_Position, plan.Position) > 0.1f) throw new InvalidOperationException("Node elevation verification failed.");
                foreach (var segment in op.Segments)
                {
                    var curve = em.GetComponentData<Curve>(segment.TargetEdge).m_Bezier;
                    if (math.distance(curve.a, segment.Curve.a) > 0.1f || math.distance(curve.d, segment.Curve.d) > 0.1f) throw new InvalidOperationException("Road elevation verification failed.");
                }
                op.ApplyDispatched = true; op.CreatedEdges = new List<Entity>(op.TargetEdges); op.State = "completed";
                Mod.log.Info("Atomic road elevation completed: " + op.Id + " edges=" + op.TargetEdges.Count + " nodes=" + op.TargetNodes.Count);
            }
            catch (Exception error)
            {
                for (int i = 0; i < op.ElevatedNodes.Count; i++)
                {
                    var plan = op.ElevatedNodes[i]; if (!em.Exists(plan.Node)) continue;
                    var node = em.GetComponentData<Node>(plan.Node); node.m_Position = plan.OriginalPosition; em.SetComponentData(plan.Node, node);
                    if (plan.HadElevation) em.SetComponentData(plan.Node, new Elevation { m_Elevation = plan.OriginalElevation }); else if (em.HasComponent<Elevation>(plan.Node)) em.RemoveComponent<Elevation>(plan.Node);
                    if (!plan.HadUpdated && em.HasComponent<Updated>(plan.Node)) em.RemoveComponent<Updated>(plan.Node);
                }
                for (int i = 0; i < op.Segments.Count; i++)
                {
                    var edge = op.Segments[i].TargetEdge; if (!em.Exists(edge)) continue; em.SetComponentData(edge, originalCurves[i]);
                    if (edgeElevation[i].HasValue) em.SetComponentData(edge, new Elevation { m_Elevation = edgeElevation[i].Value }); else if (em.HasComponent<Elevation>(edge)) em.RemoveComponent<Elevation>(edge);
                    if (!edgeUpdated[i] && em.HasComponent<Updated>(edge)) em.RemoveComponent<Updated>(edge);
                }
                throw new QueryException("ROAD_ELEVATION_FAILED", error.Message);
            }
        }
        private JObject CancelRoad(JObject args)
        {
            var op = RoadOperationById(args);
            if (op.ApplyDispatched) throw new QueryException("ALREADY_COMMITTED", "Application has already started. This operation cannot be cancelled.");
            if (!op.Terminal)
            {
                op.CancelRequested = true;
                if (op.TransactionKind != null && op.TransactionKind.StartsWith("direct_atomic")) op.State = "cancelled";
            }
            return op.Json();
        }
    }
}
