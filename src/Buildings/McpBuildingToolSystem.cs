using System;
using System.Collections.Generic;
using System.Linq;
using Colossal.Mathematics;
using Game.Buildings;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Jobs;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed partial class McpBuildingToolSystem : ObjectToolBaseSystem
    {
        private BuildingOperation m_Operation;
        private readonly List<Entity> m_Definitions = new List<Entity>();
        private readonly List<Entity> m_Candidates = new List<Entity>();
        private EntityQuery m_TempQuery, m_WarningQuery;
        private NativeList<ControlPoint> m_ControlPoints;
        private int m_Phase, m_Ticks, m_StableTicks; private string m_LastSignature;
        private int m_BatchIndex; private long m_BatchTotalCost;
        public override string toolID => "McpBuilding";
        public bool Busy => m_Operation != null;
        public override PrefabBase GetPrefab() => m_Operation == null || m_Operation.Prefab == Entity.Null ? null : m_PrefabSystem.GetPrefab<PrefabBase>(m_Operation.Prefab);
        public override bool TrySetPrefab(PrefabBase prefab) => false;

        protected override void OnCreate()
        {
            base.OnCreate();
            m_TempQuery = GetEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Temp>() }, None = new[] { ComponentType.ReadOnly<Deleted>() } });
            m_WarningQuery = GetEntityQuery(ComponentType.ReadOnly<Warning>());
            m_ControlPoints = new NativeList<ControlPoint>(1, Allocator.Persistent);
        }
        protected override void OnDestroy() { if (m_ControlPoints.IsCreated) m_ControlPoints.Dispose(); base.OnDestroy(); }

        public void Begin(BuildingOperation operation)
        {
            if (Busy || !m_TempQuery.IsEmptyIgnoreFilter) throw new QueryException("TOOL_BUSY", "Another tool preview is active.");
            m_Operation = operation; m_Phase = m_Ticks = m_StableTicks = m_BatchIndex = 0; m_BatchTotalCost = 0; m_LastSignature = null; m_Candidates.Clear(); applyMode = ApplyMode.Clear; m_ToolSystem.activeTool = this;
            Mod.log.Info("Building preview queued: " + operation.Id + " type=" + operation.Type + " prefab=" + operation.PrefabName);
        }
        public void AbortForLoading() { if (m_Operation != null && !m_Operation.Terminal) { m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "cancelled"; m_Operation.Error = "CITY_SESSION_CHANGED"; } Finish(); }
        protected override void OnStopRunning() { if (m_Operation != null && !m_Operation.Terminal) { m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "cancelled"; m_Operation.Error = "USER_CHANGED_TOOL"; } DestroyDefinitions(); m_Operation = null; applyMode = ApplyMode.Clear; base.OnStopRunning(); }
        protected override JobHandle OnUpdate(JobHandle inputDeps)
        {
            inputDeps.Complete(); EntityManager.CompleteAllTrackedJobs(); if (m_Operation == null) { applyMode = ApplyMode.Clear; return default; }
            try { Tick(); } catch (Exception e) { Mod.log.Error(e, "Building operation failed: " + m_Operation?.Id); Fail(m_Operation != null && m_Operation.ApplyDispatched ? "APPLY_OUTCOME_UNKNOWN" : "BUILDING_INTERNAL_ERROR"); }
            return default;
        }
        private void Tick()
        {
            var op = m_Operation; ++m_Ticks;
            if (!op.ApplyDispatched && (op.CancelRequested || DateTime.UtcNow >= op.Expires)) { op.State = op.CancelRequested ? "cancelled" : "expired"; Finish(); return; }
            if (op.Type == "batch_place") { TickBatch(); return; }
            if (m_Phase == 0) { if (m_Ticks < 3) return; if (!TargetValid()) { Fail("TARGET_CHANGED"); return; } GenerateDefinitions(); if (op.ExtractorOwnerPlacement && op.AttachmentPrefab == Entity.Null) { Fail("NO_EXTRACTOR_ATTACHMENT_PREFAB"); return; } op.State = "generating_preview"; applyMode = ApplyMode.None; m_Phase = 1; m_Ticks = 0; return; }
            if (m_Phase == 1) { DestroyDefinitions(); applyMode = ApplyMode.None; m_Phase = 2; m_Ticks = 0; return; }
            if (m_Phase == 2)
            {
                if (m_Ticks < 5) return; if (!ReadPreview(out var signature)) { if (m_Ticks < 120) return; Fail("NO_GENERATED_BUILDING"); return; }
                m_StableTicks = signature == m_LastSignature ? m_StableTicks + 1 : 0; m_LastSignature = signature; if (m_StableTicks < 3) return;
                if (op.Errors.Count > 0 || !m_ErrorQuery.IsEmptyIgnoreFilter || !GetAllowApply()) { Fail("GAME_REJECTED_BUILDING"); return; }
                op.State = "preview_ready"; m_Phase = 3; m_Ticks = 0; Mod.log.Info("Building preview ready: " + op.Id + " cost=" + op.Cost + " entities=" + m_Candidates.Count); return;
            }
            if (m_Phase == 3)
            {
                applyMode = ApplyMode.None; if (!op.CommitRequested) return; if (!TargetValid()) { Fail("TARGET_CHANGED"); return; }
                if (!ReadPreview(out var signature) || signature != m_LastSignature || op.Errors.Count > 0 || !m_ErrorQuery.IsEmptyIgnoreFilter || !GetAllowApply()) { Fail("PREVIEW_NO_LONGER_VALID"); return; }
                if (op.Cost > op.MaxCost) { Fail("COST_LIMIT"); return; }
                if (World.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) { Fail("CITY_MUST_BE_PAUSED"); return; }
                op.ApplyDispatched = true; op.State = "applying"; applyMode = ApplyMode.Apply; m_Phase = 4; m_Ticks = 0; Mod.log.Info("Building apply dispatched once: " + op.Id + " cost=" + op.Cost); return;
            }
            if (m_Phase == 4)
            {
                applyMode = ApplyMode.None; if (m_Ticks < 8) return;
                if (VerifyResult()) { op.State = "completed"; Mod.log.Info("Building operation completed: " + op.Id + " results=" + op.ResultEntities.Count); Finish(); return; }
                if (m_Ticks >= 120) Fail("APPLY_OUTCOME_UNKNOWN");
            }
        }

        private void TickBatch()
        {
            var op = m_Operation;
            if (m_Phase == 0)
            {
                if (m_Ticks < 3) return; if (!TargetValid()) { Fail("TARGET_CHANGED"); return; }
                GenerateDefinitions(); op.State = op.CommitRequested ? "applying" : "validating_batch"; applyMode = ApplyMode.None; m_Phase = 1; m_Ticks = 0; return;
            }
            if (m_Phase == 1) { DestroyDefinitions(); applyMode = ApplyMode.None; m_Phase = 2; m_Ticks = m_StableTicks = 0; m_LastSignature = null; return; }
            if (m_Phase == 2)
            {
                if (m_Ticks < 5) return; if (!ReadPreview(out var signature)) { if (m_Ticks < 120) return; Fail("NO_GENERATED_BUILDING"); return; }
                m_StableTicks = signature == m_LastSignature ? m_StableTicks + 1 : 0; m_LastSignature = signature; if (m_StableTicks < 3) return;
                if (op.Errors.Count > 0 || !m_ErrorQuery.IsEmptyIgnoreFilter || !GetAllowApply()) { Fail("GAME_REJECTED_BUILDING_AT_INDEX_" + m_BatchIndex); return; }
                if (!op.CommitRequested)
                {
                    m_BatchTotalCost += op.Cost; applyMode = ApplyMode.Clear; m_Phase = 3; m_Ticks = 0; return;
                }
                op.Cost = m_BatchTotalCost; if (op.Cost > op.MaxCost) { Fail("COST_LIMIT"); return; }
                if (World.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) { Fail("CITY_MUST_BE_PAUSED"); return; }
                op.ApplyDispatched = true; op.State = "applying"; applyMode = ApplyMode.Apply; m_Phase = 4; m_Ticks = 0; return;
            }
            if (m_Phase == 3)
            {
                applyMode = ApplyMode.Clear; if (!m_TempQuery.IsEmptyIgnoreFilter && m_Ticks < 120) return;
                m_BatchIndex++; if (m_BatchIndex >= op.Placements.Count) { op.Cost = m_BatchTotalCost; op.State = "preview_ready"; m_Phase = 5; m_Ticks = 0; Mod.log.Info("Building batch preview ready: " + op.Id + " cost=" + op.Cost + " count=" + op.Placements.Count); }
                else { m_Phase = 0; m_Ticks = m_StableTicks = 0; m_LastSignature = null; }
                return;
            }
            if (m_Phase == 5)
            {
                applyMode = ApplyMode.Clear; if (!op.CommitRequested) return; if (op.Cost > op.MaxCost) { Fail("COST_LIMIT"); return; }
                if (World.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) { Fail("CITY_MUST_BE_PAUSED"); return; }
                m_BatchIndex = 0; m_Phase = 0; m_Ticks = m_StableTicks = 0; m_LastSignature = null; return;
            }
            if (m_Phase == 4)
            {
                applyMode = ApplyMode.None; if (m_Ticks < 8) return;
                if (VerifyBatchCurrent()) { op.Cost = m_BatchTotalCost; applyMode = ApplyMode.Clear; m_Phase = 6; m_Ticks = 0; return; }
                if (m_Ticks >= 120) Fail("APPLY_OUTCOME_UNKNOWN_AT_INDEX_" + m_BatchIndex); return;
            }
            if (m_Phase == 6)
            {
                applyMode = ApplyMode.Clear; if (!m_TempQuery.IsEmptyIgnoreFilter && m_Ticks < 120) return;
                m_BatchIndex++; if (m_BatchIndex >= op.Placements.Count) { op.Cost = m_BatchTotalCost; op.State = "completed"; Mod.log.Info("Building batch completed: " + op.Id + " results=" + op.ResultEntities.Count); Finish(); }
                else { m_Phase = 0; m_Ticks = m_StableTicks = 0; m_LastSignature = null; }
            }
        }

        private bool VerifyBatchCurrent()
        {
            var op = m_Operation; var wanted = op.Placements[m_BatchIndex].Prefab;
            foreach (var e in m_Candidates) if (EntityManager.Exists(e) && !EntityManager.HasComponent<Deleted>(e) && !EntityManager.HasComponent<Temp>(e) && EntityManager.HasComponent<PrefabRef>(e) && EntityManager.GetComponentData<PrefabRef>(e).m_Prefab == wanted)
            { if (!op.ResultEntities.Contains(e)) op.ResultEntities.Add(e); return true; }
            return false;
        }

        private bool TargetValid()
        {
            var op = m_Operation;
            if (op.RoadStopPlacement && (!EntityManager.Exists(op.ParentRoad) || !EntityManager.HasComponent<Road>(op.ParentRoad) || EntityManager.HasComponent<Deleted>(op.ParentRoad) || EntityManager.HasComponent<Temp>(op.ParentRoad))) return false;
            if (op.RoadStopPlacement && !GameQueryService.RoadStopNetworkCompatible(EntityManager, op.Prefab, op.ParentRoad)) return false;
            if (op.Target == Entity.Null) return op.Prefab != Entity.Null && EntityManager.Exists(op.Prefab);
            if (!EntityManager.Exists(op.Target) || EntityManager.HasComponent<Deleted>(op.Target) || EntityManager.HasComponent<Temp>(op.Target)) return false;
            if (!EntityManager.HasComponent<PrefabRef>(op.Target) || EntityManager.GetComponentData<PrefabRef>(op.Target).m_Prefab != op.OriginalPrefab) return false;
            if (op.Type == "move") { var t = EntityManager.GetComponentData<Game.Objects.Transform>(op.Target); return math.distance(t.m_Position, op.OriginalPosition) < .01f && math.distance(t.m_Rotation.value, op.OriginalRotation.value) < .01f; }
            return true;
        }

        private void AddDefinition(Entity prefab, Entity original, Entity owner, CreationFlags flags, float3 position, quaternion rotation)
        {
            var e = EntityManager.CreateEntity(); m_Definitions.Add(e);
            EntityManager.AddComponentData(e, new CreationDefinition { m_Prefab = prefab, m_Original = original, m_Owner = owner, m_Flags = flags, m_RandomSeed = 1 + ((m_Operation.Id.GetHashCode() + m_Definitions.Count) & 0x3fffffff) });
            var localPosition = position; var localRotation = rotation;
            if (owner != Entity.Null && EntityManager.Exists(owner) && EntityManager.HasComponent<Game.Objects.Transform>(owner))
            {
                var parent = EntityManager.GetComponentData<Game.Objects.Transform>(owner); var inverse = math.inverse(parent.m_Rotation);
                localPosition = math.mul(inverse, position - parent.m_Position); localRotation = math.mul(inverse, rotation);
            }
            EntityManager.AddComponentData(e, new ObjectDefinition { m_Position = position, m_LocalPosition = localPosition, m_Rotation = rotation, m_LocalRotation = localRotation, m_ParentMesh = -1, m_Probability = 100, m_PrefabSubIndex = -1, m_Scale = new float3(1), m_Intensity = 1 });
            EntityManager.AddComponent<Updated>(e);
        }
        private NativeReference<AttachmentData> SelectExtractorAttachment(BuildingOperation op)
        {
            if (!op.ExtractorOwnerPlacement) return default;
            op.AttachmentPrefab = Entity.Null;
            op.AttachmentPrefabName = null;
            var placeholder = EntityManager.GetComponentData<PlaceholderBuildingData>(op.Prefab);
            if (!EntityManager.Exists(placeholder.m_ZonePrefab) || !EntityManager.HasComponent<ZoneData>(placeholder.m_ZonePrefab)) return default;
            var zone = EntityManager.GetComponentData<ZoneData>(placeholder.m_ZonePrefab);
            var lot = EntityManager.GetComponentData<BuildingData>(op.Prefab);
            var access = new bool2((lot.m_Flags & Game.Prefabs.BuildingFlags.LeftAccess) != 0, (lot.m_Flags & Game.Prefabs.BuildingFlags.RightAccess) != 0);
            float bestScore = 0f;
            BuildingData bestBuilding = default;
            // Match ObjectToolSystem.FindAttachmentBuildingJob: only level-one buildings
            // in the placeholder's zone spawn group can replace its visual shell.
            using (var query = EntityManager.CreateEntityQuery(ComponentType.ReadOnly<BuildingData>(),
                ComponentType.ReadOnly<SpawnableBuildingData>(), ComponentType.ReadOnly<BuildingSpawnGroupData>(),
                ComponentType.ReadOnly<PrefabData>()))
            {
                query.SetSharedComponentFilter(new BuildingSpawnGroupData(zone.m_ZoneType));
                using (var entities = query.ToEntityArray(Allocator.Temp))
                {
                    var random = new Unity.Mathematics.Random((uint)op.Id.GetHashCode() | 1u);
                    foreach (var candidate in entities)
                    {
                        if (EntityManager.GetComponentData<SpawnableBuildingData>(candidate).m_Level != 1) continue;
                        var building = EntityManager.GetComponentData<BuildingData>(candidate);
                        var size = building.m_LotSize;
                        if (!math.all(size <= lot.m_LotSize)) continue;
                        var candidateAccess = new bool2((building.m_Flags & Game.Prefabs.BuildingFlags.LeftAccess) != 0,
                            (building.m_Flags & Game.Prefabs.BuildingFlags.RightAccess) != 0);
                        var remainder = math.select(lot.m_LotSize - size, 0, size == lot.m_LotSize - 1);
                        float score = size.x * size.y * random.NextFloat(1f, 1.05f);
                        score += remainder.x * size.y * random.NextFloat(.95f, 1f);
                        score += lot.m_LotSize.x * remainder.y * random.NextFloat(.55f, .6f);
                        score /= lot.m_LotSize.x * lot.m_LotSize.y;
                        score *= math.csum(math.select(.01f, .5f, access == candidateAccess));
                        if (score <= bestScore) continue;
                        bestScore = score;
                        bestBuilding = building;
                        op.AttachmentPrefab = candidate;
                    }
                }
            }
            if (op.AttachmentPrefab == Entity.Null) return default;
            op.AttachmentPrefabName = m_PrefabSystem.GetPrefab<PrefabBase>(op.AttachmentPrefab)?.name;
            var attachment = new NativeReference<AttachmentData>(Allocator.TempJob);
            attachment.Value = new AttachmentData {
                m_Entity = op.AttachmentPrefab,
                m_Offset = new float3(0f, 0f, (lot.m_LotSize.y - bestBuilding.m_LotSize.y) * 4f)
            };
            return attachment;
        }
        private void GenerateDefinitions()
        {
            var op = m_Operation; m_Definitions.Clear();
            if (op.Type == "batch_place")
            {
                var config = World.GetExistingSystemManaged<Game.City.CityConfigurationSystem>();
                var placement = op.Placements[m_BatchIndex];
                m_ControlPoints.Clear(); m_ControlPoints.Add(new ControlPoint { m_Position = placement.Position, m_HitPosition = placement.Position, m_Rotation = placement.Rotation, m_OriginalEntity = placement.ParentRoad, m_ElementIndex = new int2(-1) });
                CreateDefinitions(placement.Prefab, Entity.Null, Entity.Null, Entity.Null, Entity.Null, Entity.Null, config.defaultTheme, m_ControlPoints, default(NativeReference<AttachmentData>), false, config.leftHandTraffic, false, false, 100, 0, .5f, 0, 0, RandomSeed.Next(), Snap.All, Game.Tools.AgeMask.Sapling, false, default, default);
            }
            else if (op.Type == "place" || op.Type == "move" || op.Type == "upgrade" || op.Type == "rebuild")
            {
                // Preserve the native roadside snap parent independently from upgrade ownership.
                // This lets a road-side upgrade remain owned by its host while snapping across a road.
                var snapParent = op.Type == "place" || op.Type == "move" ||
                    (op.Type == "upgrade" && op.UpgradePlacementMode == "road_side") ? op.ParentRoad : Entity.Null;
                m_ControlPoints.Clear(); var point = new ControlPoint { m_Position = op.Position, m_HitPosition = op.Position, m_Rotation = op.Rotation, m_OriginalEntity = snapParent, m_ElementIndex = new int2(-1) }; m_ControlPoints.Add(point);
                Entity prefab = op.Type == "rebuild" ? Entity.Null : op.Type == "move" ? op.OriginalPrefab : op.Prefab;
                Entity owner = op.Type == "upgrade" || op.Type == "rebuild" ? op.Target : Entity.Null;
                Entity original = op.Type == "move" ? op.Target : Entity.Null;
                var config = World.GetExistingSystemManaged<Game.City.CityConfigurationSystem>();
                var attachment = SelectExtractorAttachment(op);
                if (op.ExtractorOwnerPlacement && !attachment.IsCreated) return;
                var handle = CreateDefinitions(prefab, Entity.Null, Entity.Null, owner, original, Entity.Null, config.defaultTheme, m_ControlPoints, attachment, false, config.leftHandTraffic, false, false, 100, 0, .5f, 0, 0, RandomSeed.Next(), Snap.All, Game.Tools.AgeMask.Sapling, false, default, default);
                if (attachment.IsCreated) attachment.Dispose(handle);
            }
            else if (op.Type == "demolish" || op.Type == "remove_upgrade") AddDefinition(op.OriginalPrefab, op.Target, Entity.Null, CreationFlags.Delete, op.OriginalPosition, op.OriginalRotation);
            else if (op.Type == "replace")
            {
                AddDefinition(op.OriginalPrefab, op.Target, Entity.Null, CreationFlags.Delete, op.OriginalPosition, op.OriginalRotation);
                m_ControlPoints.Clear(); var point = new ControlPoint { m_Position = op.OriginalPosition, m_HitPosition = op.OriginalPosition, m_Rotation = op.OriginalRotation, m_OriginalEntity = op.ParentRoad, m_ElementIndex = new int2(-1) }; m_ControlPoints.Add(point);
                var config = World.GetExistingSystemManaged<Game.City.CityConfigurationSystem>();
                CreateDefinitions(op.Prefab, Entity.Null, Entity.Null, Entity.Null, Entity.Null, Entity.Null, config.defaultTheme, m_ControlPoints, default(NativeReference<AttachmentData>), false, config.leftHandTraffic, false, false, 100, 0, .5f, 0, 0, RandomSeed.Next(), Snap.All, Game.Tools.AgeMask.Sapling, false, default, default);
            }
            else throw new QueryException("INVALID_BUILDING_OPERATION", "Unsupported building operation.");
        }
        private bool ReadPreview(out string signature)
        {
            var op = m_Operation; op.Errors.Clear(); op.Warnings.Clear(); op.Cost = 0; m_Candidates.Clear();
            void ReadMessages(EntityQuery query, JArray destination, string fallback)
            {
                using (var messages = query.ToEntityArray(Allocator.Temp)) foreach (var message in messages)
                {
                    string value = fallback;
                    if (EntityManager.HasComponent<PrefabRef>(message)) try { value = m_PrefabSystem.GetPrefab<PrefabBase>(EntityManager.GetComponentData<PrefabRef>(message).m_Prefab).name; } catch { }
                    if (!destination.Any(x => (string)x == value)) destination.Add(value);
                }
            }
            ReadMessages(m_ErrorQuery, op.Errors, "GAME_VALIDATION_ERROR"); ReadMessages(m_WarningQuery, op.Warnings, "GAME_VALIDATION_WARNING");
            using (var all = m_TempQuery.ToEntityArray(Allocator.Temp)) foreach (var e in all)
            {
                var temp = EntityManager.GetComponentData<Temp>(e); if ((temp.m_Flags & TempFlags.Cancel) != 0) continue; op.Cost += temp.m_Cost;
                bool relevant = op.Type == "place" || op.Type == "batch_place" ? temp.m_Original == Entity.Null : temp.m_Original == op.Target || temp.m_Original == Entity.Null;
                if (relevant) m_Candidates.Add(e);
            }
            m_Candidates.Sort((a, b) => a.Index.CompareTo(b.Index)); op.PreviewEntities.Clear(); op.PreviewEntities.AddRange(m_Candidates);
            if (op.RoadStopPlacement)
            {
                if (op.Warnings.Count > 0) op.Errors.Add("ROAD_STOP_HAS_NATIVE_WARNINGS");
                bool attached = m_Candidates.Any(e => EntityManager.HasComponent<PrefabRef>(e) && EntityManager.GetComponentData<PrefabRef>(e).m_Prefab == op.Prefab && StopAttachedToRoad(e, op.ParentRoad));
                if (!attached) op.Errors.Add("ROAD_STOP_NOT_ATTACHED");
                using (var all = m_TempQuery.ToEntityArray(Allocator.Temp)) foreach (var e in all)
                {
                    var t = EntityManager.GetComponentData<Temp>(e);
                    if (t.m_Original != Entity.Null && (t.m_Flags & TempFlags.Delete) != 0) { op.Errors.Add("ROAD_STOP_WOULD_DELETE_EXISTING_OBJECT"); break; }
                }
            }
            if (op.ExtractorOwnerPlacement)
            {
                if (op.Warnings.Count > 0) op.Errors.Add("EXTRACTOR_OWNER_HAS_NATIVE_WARNINGS");
                var owner = m_Candidates.FirstOrDefault(e => EntityManager.HasComponent<PrefabRef>(e) &&
                    EntityManager.GetComponentData<PrefabRef>(e).m_Prefab == op.Prefab &&
                    EntityManager.HasComponent<Building>(e));
                if (owner == Entity.Null) op.Errors.Add("EXTRACTOR_OWNER_NOT_GENERATED");
                var facility = m_Candidates.FirstOrDefault(e => EntityManager.HasComponent<PrefabRef>(e) &&
                    EntityManager.GetComponentData<PrefabRef>(e).m_Prefab == op.AttachmentPrefab &&
                    EntityManager.HasComponent<Building>(e));
                if (facility == Entity.Null) op.Errors.Add("EXTRACTOR_ATTACHMENT_NOT_GENERATED");
                if ((op.ExtractorAreaOnOwner && (owner == Entity.Null || !ExtractorOwnerRoadConnected(owner))) ||
                    (!op.ExtractorAreaOnOwner && (op.ParentRoad == Entity.Null ||
                        (owner == Entity.Null || !ExtractorOwnerRoadConnected(owner)) &&
                        (facility == Entity.Null || !ExtractorOwnerRoadConnected(facility)))))
                    op.Errors.Add("EXTRACTOR_OWNER_NOT_ROAD_CONNECTED");
                using (var all = m_TempQuery.ToEntityArray(Allocator.Temp)) foreach (var e in all)
                {
                    var temp = EntityManager.GetComponentData<Temp>(e);
                    if (temp.m_Original != Entity.Null && (temp.m_Flags & TempFlags.Delete) != 0)
                    { op.Errors.Add("EXTRACTOR_OWNER_WOULD_DELETE_EXISTING_OBJECT"); break; }
                }
            }
            signature = op.Cost + ":" + string.Join(",", m_Candidates.Select(e => e.Index + ":" + e.Version)) + ":" + op.Errors + ":" + op.Warnings;
            return m_Candidates.Count > 0;
        }
        private bool VerifyResult()
        {
            var op = m_Operation; op.ResultEntities.Clear();
            if (op.Type == "demolish" || op.Type == "remove_upgrade") return !EntityManager.Exists(op.Target) || EntityManager.HasComponent<Deleted>(op.Target);
            if (op.Type == "move")
            {
                if (EntityManager.Exists(op.Target) && !EntityManager.HasComponent<Deleted>(op.Target) && EntityManager.HasComponent<Game.Objects.Transform>(op.Target) && math.distance(EntityManager.GetComponentData<Game.Objects.Transform>(op.Target).m_Position, op.Position) < .25f) { op.ResultEntities.Add(op.Target); return true; }
            }
            if (op.Type == "rebuild") { if (EntityManager.Exists(op.Target) && !EntityManager.HasComponent<Destroyed>(op.Target)) { op.ResultEntities.Add(op.Target); return true; } }
            foreach (var e in m_Candidates) if (EntityManager.Exists(e) && !EntityManager.HasComponent<Deleted>(e) && !EntityManager.HasComponent<Temp>(e) && EntityManager.HasComponent<PrefabRef>(e) && (op.Prefab == Entity.Null || EntityManager.GetComponentData<PrefabRef>(e).m_Prefab == op.Prefab)) op.ResultEntities.Add(e);
            if (op.RoadStopPlacement) op.ResultEntities.RemoveAll(e => !EntityManager.HasComponent<Game.Routes.TransportStop>(e) || !EntityManager.HasBuffer<Game.Routes.ConnectedRoute>(e) || !StopAttachedToRoad(e, op.ParentRoad) ||
                !GameQueryService.RoadStopNetworkCompatible(EntityManager, op.Prefab, op.ParentRoad) ||
                (op.RoadStopTransportType == "Tram" && !EntityManager.HasComponent<Game.Routes.TramStop>(e)));
            if (op.ExtractorOwnerPlacement)
            {
                op.ResultEntities.RemoveAll(e => !EntityManager.HasComponent<Building>(e) ||
                    (op.ExtractorAreaOnOwner && (!EntityManager.HasBuffer<Game.Areas.SubArea>(e) || !ExtractorOwnerRoadConnected(e))));
                if (op.ResultEntities.Count == 0) return false;
                foreach (var e in m_Candidates)
                    if (EntityManager.Exists(e) && !EntityManager.HasComponent<Deleted>(e) &&
                        !EntityManager.HasComponent<Temp>(e) && EntityManager.HasComponent<PrefabRef>(e) &&
                        EntityManager.GetComponentData<PrefabRef>(e).m_Prefab == op.AttachmentPrefab &&
                        EntityManager.HasComponent<Building>(e) && EntityManager.HasComponent<Game.Objects.Attached>(e) &&
                        EntityManager.GetComponentData<Game.Objects.Attached>(e).m_Parent == op.ResultEntities[0])
                    { op.ResultEntities.Add(e); break; }
                if (op.ResultEntities.Count < 2) return false;
                if (!op.ExtractorAreaOnOwner && !ExtractorOwnerRoadConnected(op.ResultEntities[0]) &&
                    !ExtractorOwnerRoadConnected(op.ResultEntities[1])) return false;
            }
            return op.ResultEntities.Count >= op.ExpectedResultCount && (op.Type != "replace" || !EntityManager.Exists(op.Target) || EntityManager.HasComponent<Deleted>(op.Target));
        }
        private bool ExtractorOwnerRoadConnected(Entity building)
        {
            if (!EntityManager.HasComponent<Building>(building)) return false;
            var road = EntityManager.GetComponentData<Building>(building).m_RoadEdge;
            return road != Entity.Null && EntityManager.Exists(road) && EntityManager.HasComponent<Road>(road) &&
                !EntityManager.HasComponent<Deleted>(road);
        }
        private bool StopAttachedToRoad(Entity e, Entity road)
        {
            if (!EntityManager.HasComponent<Game.Objects.Attached>(e)) return false;
            var parent = EntityManager.GetComponentData<Game.Objects.Attached>(e).m_Parent;
            if (EntityManager.Exists(parent) && EntityManager.HasComponent<Temp>(parent)) parent = EntityManager.GetComponentData<Temp>(parent).m_Original;
            return parent == road && EntityManager.Exists(road) && !EntityManager.HasComponent<Deleted>(road);
        }
        private void DestroyDefinitions() { foreach (var e in m_Definitions) if (EntityManager.Exists(e)) EntityManager.DestroyEntity(e); m_Definitions.Clear(); }
        private void Fail(string reason) { if (m_Operation == null) return; m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "failed"; m_Operation.Error = reason; Mod.log.Warn("Building operation " + m_Operation.Id + ": " + reason); Finish(); }
        private void Finish() { DestroyDefinitions(); applyMode = ApplyMode.Clear; m_Operation = null; if (m_ToolSystem.activeTool == this) m_ToolSystem.activeTool = m_DefaultToolSystem; }
    }
}
