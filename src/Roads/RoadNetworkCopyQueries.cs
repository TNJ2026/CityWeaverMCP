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

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private JObject PreviewRoadNetworkCopy(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["operation_type"] = "network_copy" };
            foreach (var name in new[] { "edge_ids", "bounds", "source_origin", "target_origin", "rotation_degrees", "height_offset_m", "connection_edge_ids", "connection_tolerance_m", "mirror_axis" })
                fingerprint[name] = args[name]?.DeepClone();
            var signature = fingerprint.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != signature) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another road operation.");
                return old.Json();
            }
            if (m_RoadOperations.Count >= 4096) throw new QueryException("ROAD_OPERATION_LIMIT", "Reload the city to reset the road operation journal.");
            var ids = args["edge_ids"] as JArray;
            if ((args["edge_ids"] != null) == (args["bounds"] != null) || (args["edge_ids"] != null && ids == null))
                throw new QueryException("INVALID_ARGUMENT", "Supply exactly one of edge_ids or bounds.");
            // Explicit IDs fit within the bounded 128 KiB transport frame.
            if (ids != null && !RoadCopyLimits.ValidExplicitCount(ids.Count)) throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain 1.." + RoadCopyLimits.MaxExplicitEdges + " unique road IDs.");
            float Number(string name, float fallback, float min, float max)
            {
                var token = args[name]; if (token == null) return fallback;
                if ((token.Type != JTokenType.Float && token.Type != JTokenType.Integer) ||
                    !float.TryParse(token.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var number) ||
                    !math.isfinite(number) || number < min || number > max)
                    throw new QueryException("INVALID_ARGUMENT", name + " is outside its finite supported range.");
                return number;
            }
            float3 Origin(string name)
            {
                var value = args[name] as JObject ?? throw new QueryException("INVALID_ARGUMENT", name + " is required.");
                return new float3(ReadCoordinate(value, name, "x"), 0, ReadCoordinate(value, name, "z"));
            }
            var sourceOrigin = Origin("source_origin"); var targetOrigin = Origin("target_origin");
            bool mirrored = args["mirror_axis"] != null;
            float3 mirrorStart = default, mirrorEnd = default;
            var transformOrigin = sourceOrigin;
            if (mirrored)
            {
                if (!(args["mirror_axis"] is JObject axis) || !(axis["start"] is JObject a) || !(axis["end"] is JObject b))
                    throw new QueryException("INVALID_ARGUMENT", "mirror_axis requires start and end x/z points.");
                mirrorStart = new float3(ReadCoordinate(a,"mirror_axis.start","x"),0,ReadCoordinate(a,"mirror_axis.start","z"));
                mirrorEnd = new float3(ReadCoordinate(b,"mirror_axis.end","x"),0,ReadCoordinate(b,"mirror_axis.end","z"));
                if (!RoadCopyGeometry.ValidMirrorAxis(mirrorStart.x,mirrorStart.z,mirrorEnd.x,mirrorEnd.z))
                    throw new QueryException("INVALID_ARGUMENT", "mirror_axis must be at least one metre long.");
                RoadCopyGeometry.Reflect(sourceOrigin.x,sourceOrigin.z,mirrorStart.x,mirrorStart.z,mirrorEnd.x,mirrorEnd.z,out float ox,out float oz);
                transformOrigin = new float3(ox,0,oz);
            }
            var rotation = Number("rotation_degrees", 0, -360, 360);
            var heightOffset = Number("height_offset_m", 0, -2000, 2000);
            var connectionTolerance = Number("connection_tolerance_m",16, .25f,32);
            if (args["connection_edge_ids"]==null && args["connection_tolerance_m"]!=null)
                throw new QueryException("INVALID_ARGUMENT", "connection_tolerance_m requires connection_edge_ids.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before copying roads.");
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current preview and select the default selection tool first.");
            em.CompleteAllTrackedJobs();
            bool PermanentRoad(Entity e) => em.Exists(e) && em.HasComponent<Road>(e) && em.HasComponent<Edge>(e) &&
                em.HasComponent<Curve>(e) && em.HasComponent<PrefabRef>(e) && !em.HasComponent<Temp>(e) && !em.HasComponent<Deleted>(e);
            var sources = new List<Entity>();
            if (ids != null)
            {
                var unique = new HashSet<Entity>();
                foreach (var id in ids)
                {
                    if (id.Type != JTokenType.String) throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain strings.");
                    var e = ParseEntity((string)id, em);
                    if (!PermanentRoad(e)) throw new QueryException("INVALID_ROAD_EDGE", "Every source must be a permanent road edge.");
                    if (!unique.Add(e)) throw new QueryException("INVALID_ARGUMENT", "Duplicate source edge IDs are not allowed.");
                    sources.Add(e);
                }
            }
            else
            {
                var bounds = ReadPlanningBounds(args);
                using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Road>(), ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<Curve>(), ComponentType.ReadOnly<PrefabRef>()))
                using (var entities = query.ToEntityArray(Allocator.Temp))
                    foreach (var e in entities)
                    {
                        if (!PermanentRoad(e)) continue;
                        var curve = em.GetComponentData<Curve>(e).m_Bezier;
                        // Conservative whole-edge selection: never clip or pull in roads crossing the boundary.
                        if (bounds.Contains(curve.a) && bounds.Contains(curve.b) && bounds.Contains(curve.c) && bounds.Contains(curve.d))
                        {
                            sources.Add(e);
                            if (!RoadCopyLimits.ValidAreaCount(sources.Count)) throw new QueryException("ROAD_COPY_LIMIT", "Selection exceeds " + RoadCopyLimits.MaxAreaEdges + " roads; use a smaller area.");
                        }
                    }
                sources.Sort((a, b) => a.Index.CompareTo(b.Index));
            }
            if (sources.Count == 0) throw new QueryException("NO_ROADS_SELECTED", "No complete road curves are contained in the selection.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            var heights = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (!heights.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");
            float3 Transform(float3 point)
            {
                if (mirrored)
                {
                    RoadCopyGeometry.Reflect(point.x,point.z,mirrorStart.x,mirrorStart.z,mirrorEnd.x,mirrorEnd.z,out float mx,out float mz);
                    point.x=mx; point.z=mz;
                }
                RoadCopyGeometry.Transform(point.x, point.y, point.z, transformOrigin.x, transformOrigin.z, targetOrigin.x, targetOrigin.z,
                    rotation, heightOffset, out var x, out var y, out var z);
                var result = new float3(x, y, z);
                if (!math.all(math.isfinite(result)) || math.abs(x) > 7168 || math.abs(z) > 7168)
                    throw new QueryException("INVALID_ARGUMENT", "Copied road control points must stay inside the map coordinate bounds.");
                return result;
            }
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = signature, CurveMode = "network_copy",
                CopySourceOrigin = sourceOrigin, CopyTargetOrigin = targetOrigin, CopyRotationDegrees = rotation, CopyHeightOffset = heightOffset, CopyNodeCourses = true,
                CopyMirrored = mirrored, CopyMirrorStart = mirrorStart, CopyMirrorEnd = mirrorEnd };
            operation.CopyConnectionTolerance=connectionTolerance;
            foreach (var e in sources)
            {
                if (em.HasComponent<Owner>(e)) throw new QueryException("OWNED_ROAD_NOT_SUPPORTED", "Building-owned roads cannot be copied independently.");
                var prefab = em.GetComponentData<PrefabRef>(e).m_Prefab;
                if (!prefabs.TryGetPrefab<PrefabBase>(prefab, out var asset) || !(asset is RoadPrefab) || !em.HasComponent<PlaceableNetData>(prefab))
                    throw new QueryException("INVALID_ROAD_PREFAB", "Source road prefab is not independently placeable.");
                if (RoadOperation.IsLocked(em, prefab)) throw new QueryException("ROAD_LOCKED", "An inherited road prefab is locked: " + asset.name);
                var edge = em.GetComponentData<Edge>(e); var original = em.GetComponentData<Curve>(e).m_Bezier;
                var curve = new Bezier4x3(Transform(original.a), Transform(original.b), Transform(original.c), Transform(original.d));
                // Curve endpoints can be clipped back from the junction. Shared
                // node positions, not those clipped endpoints, define the course.
                var start = Transform(em.GetComponentData<Node>(edge.m_Start).m_Position);
                var end = Transform(em.GetComponentData<Node>(edge.m_End).m_Position);
                var startTrim = math.distance(curve.a, start) + 1;
                var endTrim = math.distance(curve.d, end) + 1;
                curve = CopyCourse(curve, start, end);
                float Elevation(float value) => value < 0 && value >= -.25f ? 0 : value;
                var elevation = new float2(Elevation(start.y - TerrainUtils.SampleHeight(ref heights, start)), Elevation(end.y - TerrainUtils.SampleHeight(ref heights, end)));
                // Existing game edges may be shorter than the interactive road tool minimum or longer
                // than its maximum. Keep them whole; let the native preview validate their geometry.
                ValidateRoadReplacementElevation(world, prefab, curve, elevation);
                var upgrades = em.HasComponent<Upgraded>(e) ? em.GetComponentData<Upgraded>(e).m_Flags : default(CompositionFlags);
                if (mirrored) RoadCopyGeometry.SwapSides(ref upgrades.m_Left, ref upgrades.m_Right);
                operation.Segments.Add(new RoadSegmentPlan { SourceEdge = e, CopySourceStart = edge.m_Start, CopySourceEnd = edge.m_End,
                    Prefab = prefab, PrefabName = asset.name, Role = "network_copy", Start = start, End = end, Curve = curve,
                    CopyStartTrimLimit = startTrim, CopyEndTrimLimit = endTrim,
                    StartElevation = elevation.x, EndElevation = elevation.y, HasUpgradeFlags = true,
                    UpgradeFlags = upgrades });
            }
            operation.CopySourceNodeCount = operation.Segments.SelectMany(s => new[] { s.CopySourceStart, s.CopySourceEnd }).Distinct().Count();
            if (args["connection_edge_ids"]!=null) PlanRoadCopyConnections(operation,args,world,Transform);
            var first = operation.Segments[0]; var last = operation.Segments[operation.Segments.Count - 1];
            operation.Prefab = first.Prefab; operation.PrefabName = first.PrefabName; operation.Curve = first.Curve;
            operation.Start = first.Start; operation.End = last.End; operation.StartElevation = first.StartElevation; operation.EndElevation = last.EndElevation;
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id);
            return operation.Json();
        }
    }
}
