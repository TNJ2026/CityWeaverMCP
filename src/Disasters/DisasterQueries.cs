using System;
using System.Collections.Generic;
using System.Linq;
using Game.Buildings;
using Game.Common;
using Game.Events;
using Game.Objects;
using Game.Prefabs;
using Game.Simulation;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;
using EventMarker = Game.Events.Event;
using WeatherEvent = Game.Events.WeatherPhenomenon;

namespace CityWeaver
{
    internal sealed class DisasterOperation
    {
        public string Id = Guid.NewGuid().ToString("N"), Session, RequestId, Fingerprint, PrefabName, Family, State = "preview_ready";
        public DateTime Created = DateTime.UtcNow, Expires = DateTime.UtcNow.AddMinutes(5);
        public float X, Y, Z, Radius, HotspotRadius, Intensity;
        public int WarningSeconds, DurationSeconds;
        public Entity Prefab, Target, Result;

        public JObject Json(Func<Entity, string> entityId)
        {
            return new JObject {
                ["operation_id"] = Id, ["request_id"] = RequestId, ["state"] = State, ["prefab"] = PrefabName, ["family"] = Family,
                ["position"] = Family == "weather" ? new JObject { ["x"] = X, ["y"] = Y, ["z"] = Z } : null, ["phenomenon_radius"] = Family == "weather" ? new JValue(Radius) : JValue.CreateNull(),
                ["hotspot_radius"] = HotspotRadius, ["initial_intensity"] = Intensity, ["warning_seconds"] = WarningSeconds,
                ["duration_seconds"] = DurationSeconds, ["target_id"] = Target == Entity.Null ? JValue.CreateNull() : new JValue(entityId(Target)),
                ["result_disaster_id"] = Result == Entity.Null ? JValue.CreateNull() : new JValue(entityId(Result)),
                ["can_apply"] = State == "preview_ready" && DateTime.UtcNow < Expires, ["expires_at_utc"] = Expires.ToString("O"),
                ["error"] = JValue.CreateNull()
            };
        }
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string, DisasterOperation> m_DisasterOperations = new Dictionary<string, DisasterOperation>();
        private readonly Dictionary<string, string> m_DisasterRequests = new Dictionary<string, string>();

        private void ResetDisasterOperations() { m_DisasterOperations.Clear(); m_DisasterRequests.Clear(); }
        private static string DisasterRequestKey(JObject args) { var value = ((string)args["request_id"] ?? "").Trim(); if (value.Length == 0) throw new QueryException("REQUEST_ID_REQUIRED", "request_id is required for idempotency."); return value; }
        private static string DisasterFingerprint(JObject args) { return args.ToString(Newtonsoft.Json.Formatting.None); }

        private IEnumerable<Entity> DisasterPrefabEntities(World world)
        {
            var em = world.EntityManager;
            using (var query = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<EventData>() }, Any = new[] { ComponentType.ReadOnly<WeatherPhenomenonData>(), ComponentType.ReadOnly<FireData>(), ComponentType.ReadOnly<DestructionData>(), ComponentType.ReadOnly<WaterLevelChangeData>() } }))
            using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) if (!em.HasComponent<TrafficAccidentData>(entity) || em.HasComponent<WeatherPhenomenonData>(entity)) yield return entity;
        }

        private static string DisasterFamily(EntityManager em, Entity entity)
        {
            if (em.HasComponent<WeatherPhenomenonData>(entity) || em.HasComponent<WeatherEvent>(entity)) return "weather";
            if (em.HasComponent<FireData>(entity) || em.HasComponent<Game.Events.Fire>(entity)) return "fire";
            if (em.HasComponent<DestructionData>(entity) || em.HasComponent<Game.Events.Destruction>(entity)) return "destruction";
            if (em.HasComponent<WaterLevelChangeData>(entity) || em.HasComponent<WaterLevelChange>(entity)) return "water_level";
            return "unknown";
        }

        private Entity DisasterPrefabByName(string name, World world)
        {
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            foreach (var entity in DisasterPrefabEntities(world)) if (prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab) && string.Equals(prefab.name, name, StringComparison.OrdinalIgnoreCase)) return entity;
            throw new QueryException("DISASTER_PREFAB_NOT_FOUND", "Use an exact name returned by list_disaster_prefabs.");
        }

        private int ActiveDisasterCount(Entity prefab, World world)
        {
            int count = 0; var em = world.EntityManager;
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<EventMarker>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>()))
            using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) if (em.GetComponentData<PrefabRef>(entity).m_Prefab == prefab) count++;
            return count;
        }

        private JObject DisasterPrefabRow(Entity entity, World world)
        {
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var eventData = em.GetComponentData<EventData>(entity); string family = DisasterFamily(em, entity);
            prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab); int active = ActiveDisasterCount(entity, world);
            var row = new JObject {
                ["name"] = prefab?.name ?? "", ["prefab_id"] = EntityId(entity), ["locked"] = RoadOperation.IsLocked(em, entity),
                ["family"] = family, ["concurrent_limit"] = eventData.m_ConcurrentLimit, ["active_instances"] = active, ["can_trigger"] = !RoadOperation.IsLocked(em, entity) && (eventData.m_ConcurrentLimit <= 0 || active < eventData.m_ConcurrentLimit)
            };
            if (family == "weather") { var data = em.GetComponentData<WeatherPhenomenonData>(entity); row["damage_severity"] = data.m_DamageSeverity; row["danger_level"] = data.m_DangerLevel; row["danger_flags"] = data.m_DangerFlags.ToString(); row["occurrence_probability"] = data.m_OccurenceProbability; row["phenomenon_radius"] = new JObject { ["min"] = data.m_PhenomenonRadius.min, ["max"] = data.m_PhenomenonRadius.max }; row["hotspot_radius_ratio"] = new JObject { ["min"] = data.m_HotspotRadius.min, ["max"] = data.m_HotspotRadius.max }; row["duration_seconds"] = new JObject { ["min"] = data.m_Duration.min, ["max"] = data.m_Duration.max }; row["lightning_interval_seconds"] = new JObject { ["min"] = data.m_LightningInterval.min, ["max"] = data.m_LightningInterval.max }; row["occurrence_conditions"] = new JObject { ["temperature"] = new JObject { ["min"] = data.m_OccurenceTemperature.min, ["max"] = data.m_OccurenceTemperature.max }, ["rain"] = new JObject { ["min"] = data.m_OccurenceRain.min, ["max"] = data.m_OccurenceRain.max }, ["cloudiness"] = new JObject { ["min"] = data.m_OccurenceCloudiness.min, ["max"] = data.m_OccurenceCloudiness.max } }; }
            else if (family == "fire") { var data = em.GetComponentData<FireData>(entity); row["target_type"] = data.m_RandomTargetType.ToString(); row["start_probability"] = data.m_StartProbability; row["start_intensity"] = data.m_StartIntensity; row["escalation_rate"] = data.m_EscalationRate; row["spread_probability"] = data.m_SpreadProbability; row["spread_range_m"] = data.m_SpreadRange; }
            else if (family == "destruction") { var data = em.GetComponentData<DestructionData>(entity); row["target_type"] = data.m_RandomTargetType.ToString(); row["occurrence_probability"] = data.m_OccurenceProbability; }
            else if (family == "water_level") { var data = em.GetComponentData<WaterLevelChangeData>(entity); row["target_type"] = data.m_TargetType.ToString(); row["change_type"] = data.m_ChangeType.ToString(); row["escalation_delay"] = data.m_EscalationDelay; row["danger_flags"] = data.m_DangerFlags.ToString(); row["danger_level"] = data.m_DangerLevel; }
            return row;
        }

        private JObject ListDisasterPrefabs(JObject args, World world)
        {
            string search = ((string)args["search"] ?? "").Trim(); int offset = (int?)args["offset"] ?? 0, limit = (int?)args["limit"] ?? 50; var rows = new List<JObject>();
            foreach (var entity in DisasterPrefabEntities(world)) { var row = DisasterPrefabRow(entity, world); if (search.Length == 0 || ((string)row["name"]).IndexOf(search, StringComparison.OrdinalIgnoreCase) >= 0) rows.Add(row); }
            rows = rows.OrderBy(x => (string)x["name"]).ToList(); return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["next_offset"] = offset + limit < rows.Count ? new JValue(offset + limit) : JValue.CreateNull(), ["items"] = new JArray(rows.Skip(offset).Take(limit)) };
        }

        private JObject GetDisasterPrefab(JObject args, World world) { return DisasterPrefabRow(DisasterPrefabByName((string)args["prefab"], world), world); }

        private Entity StableDisaster(string id, World world)
        {
            var em = world.EntityManager; var entity = ParseEntity(id, em); if (!em.HasComponent<EventMarker>(entity) || DisasterFamily(em, entity) == "unknown" || em.HasComponent<Deleted>(entity)) throw new QueryException("DISASTER_NOT_FOUND", "disaster_id must identify a live weather, fire, destruction or water-level event."); return entity;
        }

        private JObject DisasterImpactCounts(Entity disaster, World world, int listLimit)
        {
            var em = world.EntityManager; int facing = 0, danger = 0, fire = 0, flood = 0, destroyed = 0; var ids = new JArray();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<FacingWeather>(), ComponentType.Exclude<Deleted>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (em.GetComponentData<FacingWeather>(e).m_Event == disaster) { facing++; if (ids.Count < listLimit) ids.Add(new JObject { ["entity_id"] = EntityId(e), ["effect"] = "facing_weather", ["severity"] = em.GetComponentData<FacingWeather>(e).m_Severity }); }
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<InDanger>(), ComponentType.Exclude<Deleted>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (em.GetComponentData<InDanger>(e).m_Event == disaster) { danger++; if (ids.Count < listLimit) ids.Add(new JObject { ["entity_id"] = EntityId(e), ["effect"] = "in_danger", ["flags"] = em.GetComponentData<InDanger>(e).m_Flags.ToString() }); }
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<OnFire>(), ComponentType.Exclude<Deleted>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (em.GetComponentData<OnFire>(e).m_Event == disaster) { fire++; if (ids.Count < listLimit) ids.Add(new JObject { ["entity_id"] = EntityId(e), ["effect"] = "on_fire", ["intensity"] = em.GetComponentData<OnFire>(e).m_Intensity }); }
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Flooded>(), ComponentType.Exclude<Deleted>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (em.GetComponentData<Flooded>(e).m_Event == disaster) { flood++; if (ids.Count < listLimit) ids.Add(new JObject { ["entity_id"] = EntityId(e), ["effect"] = "flooded", ["depth"] = em.GetComponentData<Flooded>(e).m_Depth }); }
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Destroyed>(), ComponentType.Exclude<Deleted>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (em.GetComponentData<Destroyed>(e).m_Event == disaster) { destroyed++; if (ids.Count < listLimit) ids.Add(new JObject { ["entity_id"] = EntityId(e), ["effect"] = "destroyed", ["cleared"] = em.GetComponentData<Destroyed>(e).m_Cleared }); }
            return new JObject { ["facing_weather"] = facing, ["in_danger"] = danger, ["on_fire"] = fire, ["flooded"] = flood, ["destroyed"] = destroyed, ["total_records"] = facing + danger + fire + flood + destroyed, ["listed"] = ids.Count, ["items"] = ids };
        }

        private JObject DisasterRow(Entity entity, World world, bool details)
        {
            var em = world.EntityManager; var simulation = world.GetExistingSystemManaged<SimulationSystem>(); var prefabRef = em.GetComponentData<PrefabRef>(entity); var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); prefabs.TryGetPrefab<PrefabBase>(prefabRef.m_Prefab, out var prefab); uint frame = simulation.frameIndex; string family = DisasterFamily(em, entity); bool hasDuration = em.HasComponent<Duration>(entity); var duration = hasDuration ? em.GetComponentData<Duration>(entity) : default; string phase = !hasDuration ? "active" : frame < duration.m_StartFrame ? "warning" : frame <= duration.m_EndFrame ? "active" : "ending"; int targets = em.HasBuffer<TargetElement>(entity) ? em.GetBuffer<TargetElement>(entity, true).Length : 0;
            var row = new JObject { ["disaster_id"] = EntityId(entity), ["prefab"] = prefab?.name ?? "", ["family"] = family, ["phase"] = phase, ["danger_level"] = em.HasComponent<Game.Events.DangerLevel>(entity) ? em.GetComponentData<Game.Events.DangerLevel>(entity).m_DangerLevel : 0, ["start_frame"] = hasDuration ? new JValue(duration.m_StartFrame) : JValue.CreateNull(), ["end_frame"] = hasDuration ? new JValue(duration.m_EndFrame) : JValue.CreateNull(), ["warning_seconds_remaining"] = hasDuration && frame < duration.m_StartFrame ? (duration.m_StartFrame - frame) / 60f : 0, ["active_seconds_remaining"] = hasDuration && frame < duration.m_EndFrame ? (duration.m_EndFrame - Math.Max(frame, duration.m_StartFrame)) / 60f : 0, ["target_count"] = targets };
            if (family == "weather") { var phenomenon = em.GetComponentData<WeatherEvent>(entity); if (phase == "ending" && phenomenon.m_Intensity > 0) row["phase"] = "dissipating"; row["position"] = new JObject { ["x"] = phenomenon.m_PhenomenonPosition.x, ["y"] = phenomenon.m_PhenomenonPosition.y, ["z"] = phenomenon.m_PhenomenonPosition.z }; row["hotspot_position"] = new JObject { ["x"] = phenomenon.m_HotspotPosition.x, ["y"] = phenomenon.m_HotspotPosition.y, ["z"] = phenomenon.m_HotspotPosition.z }; row["hotspot_velocity"] = new JObject { ["x"] = phenomenon.m_HotspotVelocity.x, ["y"] = phenomenon.m_HotspotVelocity.y, ["z"] = phenomenon.m_HotspotVelocity.z }; row["phenomenon_radius"] = phenomenon.m_PhenomenonRadius; row["hotspot_radius"] = phenomenon.m_HotspotRadius; row["intensity"] = phenomenon.m_Intensity; }
            else if (family == "water_level") { var change = em.GetComponentData<WaterLevelChange>(entity); row["intensity"] = change.m_Intensity; row["max_intensity"] = change.m_MaxIntensity; row["danger_height"] = change.m_DangerHeight; row["direction"] = new JObject { ["x"] = change.m_Direction.x, ["z"] = change.m_Direction.y }; }
            else if (targets > 0) { var target = em.GetBuffer<TargetElement>(entity, true)[0].m_Entity; if (em.Exists(target) && em.HasComponent<Transform>(target)) { var transform = em.GetComponentData<Transform>(target); row["position"] = new JObject { ["x"] = transform.m_Position.x, ["y"] = transform.m_Position.y, ["z"] = transform.m_Position.z }; } }
            if (details) row["impacts"] = DisasterImpactCounts(entity, world, 100); return row;
        }

        private JObject ListActiveDisasters(JObject args, World world)
        {
            int offset = (int?)args["offset"] ?? 0, limit = (int?)args["limit"] ?? 50; var em = world.EntityManager; var rows = new List<JObject>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<EventMarker>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (DisasterFamily(em, e) != "unknown") rows.Add(DisasterRow(e, world, false));
            rows = rows.OrderBy(x => (string)x["disaster_id"]).ToList(); return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["next_offset"] = offset + limit < rows.Count ? new JValue(offset + limit) : JValue.CreateNull(), ["items"] = new JArray(rows.Skip(offset).Take(limit)) };
        }

        private JObject GetActiveDisaster(JObject args, World world) { return DisasterRow(StableDisaster((string)args["disaster_id"], world), world, true); }
        private JObject GetDisasterImpacts(JObject args, World world) { int limit = (int?)args["limit"] ?? 100; var e = StableDisaster((string)args["disaster_id"], world); var result = DisasterImpactCounts(e, world, limit); result["disaster_id"] = EntityId(e); return result; }

        private JObject GetDisasterReadiness(World world)
        {
            var em = world.EntityManager; var items = new JArray(); int shelterCount = 0, shelterCapacity = 0, vehicleCapacity = 0, occupants = 0, warning = 0, facilities = 0, response = 0;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Building>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Game.Tools.Temp>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es)
            {
                var prefab = em.GetComponentData<PrefabRef>(e).m_Prefab; bool shelter = em.HasComponent<Game.Buildings.EmergencyShelter>(e); if (shelter) { shelterCount++; if (em.HasComponent<EmergencyShelterData>(prefab)) { var d = em.GetComponentData<EmergencyShelterData>(prefab); shelterCapacity += d.m_ShelterCapacity; vehicleCapacity += d.m_VehicleCapacity; } if (em.HasBuffer<Occupant>(e)) occupants += em.GetBuffer<Occupant>(e, true).Length; }
                if (em.HasComponent<Game.Buildings.EarlyDisasterWarningSystem>(e)) warning++; if (em.HasComponent<Game.Buildings.DisasterFacility>(e)) facilities++; if (em.HasComponent<FireStationData>(prefab)) response += em.GetComponentData<FireStationData>(prefab).m_DisasterResponseCapacity;
            }
            return new JObject { ["natural_disasters_enabled"] = world.GetExistingSystemManaged<Game.City.CityConfigurationSystem>().naturalDisasters, ["active_disasters"] = (int)ListActiveDisasters(new JObject { ["offset"] = 0, ["limit"] = 1 }, world)["total"], ["emergency_shelters"] = shelterCount, ["shelter_capacity"] = shelterCapacity, ["current_shelter_occupants"] = occupants, ["shelter_vehicle_capacity"] = vehicleCapacity, ["early_warning_systems"] = warning, ["disaster_facilities"] = facilities, ["disaster_response_vehicle_capacity"] = response };
        }

        private DisasterOperation PreviewDisaster(JObject args, World world)
        {
            string request = DisasterRequestKey(args), fingerprint = DisasterFingerprint(args); if (m_DisasterRequests.TryGetValue(request, out var existingId)) { var existing = m_DisasterOperations[existingId]; if (existing.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id was already used with different arguments."); return existing; }
            if (m_DisasterOperations.Count >= 128) throw new QueryException("OPERATION_LIMIT", "This city session already contains 128 disaster operations."); string prefabName = ((string)args["prefab"] ?? "").Trim(); var prefab = DisasterPrefabByName(prefabName, world); var em = world.EntityManager; if (RoadOperation.IsLocked(em, prefab)) throw new QueryException("DISASTER_PREFAB_LOCKED", "The selected disaster prefab is locked."); string family = DisasterFamily(em, prefab); var eventData = em.GetComponentData<EventData>(prefab); int current = ActiveDisasterCount(prefab, world); if (eventData.m_ConcurrentLimit > 0 && current >= eventData.m_ConcurrentLimit) throw new QueryException("DISASTER_CONCURRENT_LIMIT", "The native concurrent limit for this disaster prefab has been reached.");
            bool hasTarget = args["target_id"] != null, hasCoordinates = args["x"] != null || args["z"] != null; Entity target = Entity.Null; float x = 0, y = 0, z = 0, radius = 0, hotspot = 0, intensity = 0; int warningSeconds = 0, durationSeconds = 0;
            if (family == "weather") {
                bool completeCoordinates = args["x"] != null && args["z"] != null; if (hasTarget == completeCoordinates || hasCoordinates && !completeCoordinates) throw new QueryException("INVALID_ARGUMENT", "Weather disasters require target_id or both x and z, not both forms.");
                if (hasTarget) { target = ParseEntity((string)args["target_id"], em); ValidateDisasterTarget(target, EventTargetType.None, em); var t = em.GetComponentData<Transform>(target); x = t.m_Position.x; y = t.m_Position.y; z = t.m_Position.z; } else { x = (float)args["x"]; y = (float?)args["y"] ?? .001f; z = (float)args["z"]; }
                var data = em.GetComponentData<WeatherPhenomenonData>(prefab); radius = (float?)args["phenomenon_radius"] ?? (data.m_PhenomenonRadius.min + data.m_PhenomenonRadius.max) * .5f; if (radius < 10 || radius > 5000) throw new QueryException("INVALID_ARGUMENT", "phenomenon_radius must be 10..5000 metres."); hotspot = (float?)args["hotspot_radius"] ?? radius * (data.m_HotspotRadius.min + data.m_HotspotRadius.max) * .5f; if (hotspot < 1 || hotspot > radius) throw new QueryException("INVALID_ARGUMENT", "hotspot_radius must be 1..phenomenon_radius."); intensity = (float?)args["initial_intensity"] ?? 0; if (intensity < 0 || intensity > 1) throw new QueryException("INVALID_ARGUMENT", "initial_intensity must be 0..1."); warningSeconds = (int?)args["warning_seconds"] ?? 0; durationSeconds = (int?)args["duration_seconds"] ?? (int)((data.m_Duration.min + data.m_Duration.max) * .5f); if (warningSeconds < 0 || warningSeconds > 3600 || durationSeconds < 1 || durationSeconds > 7200) throw new QueryException("INVALID_ARGUMENT", "warning_seconds must be 0..3600 and duration_seconds 1..7200.");
            } else if (family == "fire" || family == "destruction") {
                if (!hasTarget || hasCoordinates) throw new QueryException("INVALID_ARGUMENT", "Fire and destruction events require target_id and do not accept coordinates."); target = ParseEntity((string)args["target_id"], em); var expected = family == "fire" ? em.GetComponentData<FireData>(prefab).m_RandomTargetType : em.GetComponentData<DestructionData>(prefab).m_RandomTargetType; ValidateDisasterTarget(target, expected, em);
            } else if (hasTarget || hasCoordinates) throw new QueryException("INVALID_ARGUMENT", "Water-level events are global and do not accept target_id or coordinates.");
            var op = new DisasterOperation { Session = m_Session, RequestId = request, Fingerprint = fingerprint, PrefabName = prefabName, Family = family, Prefab = prefab, Target = target, X = x, Y = y, Z = z, Radius = radius, HotspotRadius = hotspot, Intensity = intensity, WarningSeconds = warningSeconds, DurationSeconds = durationSeconds }; m_DisasterOperations.Add(op.Id, op); m_DisasterRequests.Add(request, op.Id); return op;
        }

        private static void ValidateDisasterTarget(Entity target, EventTargetType expected, EntityManager em)
        {
            if (!em.Exists(target) || em.HasComponent<Deleted>(target) || em.HasComponent<Game.Tools.Temp>(target)) throw new QueryException("INVALID_TARGET", "target_id must identify a permanent live entity."); if (!em.HasComponent<Transform>(target)) throw new QueryException("INVALID_TARGET", "target_id has no world transform.");
            if (expected == EventTargetType.Building && !em.HasComponent<Building>(target)) throw new QueryException("INVALID_TARGET_TYPE", "This event prefab requires a building target.");
            if (expected == EventTargetType.WildTree && !em.HasComponent<Game.Objects.Tree>(target)) throw new QueryException("INVALID_TARGET_TYPE", "This event prefab requires a tree target.");
            if (expected == EventTargetType.Road && !em.HasComponent<Game.Net.Road>(target)) throw new QueryException("INVALID_TARGET_TYPE", "This event prefab requires a road target.");
        }

        private DisasterOperation DisasterOperationById(JObject args)
        {
            string id = (string)args["operation_id"] ?? ""; if (!m_DisasterOperations.TryGetValue(id, out var op) || op.Session != m_Session) throw new QueryException("DISASTER_OPERATION_NOT_FOUND", "operation_id is not valid in this loaded-city session."); if (op.State == "preview_ready" && DateTime.UtcNow >= op.Expires) op.State = "expired"; return op;
        }

        private JObject ApplyDisasterOperation(JObject args, World world)
        {
            RequirePaused(world); var op = DisasterOperationById(args); if (DisasterRequestKey(args) != op.RequestId) throw new QueryException("IDEMPOTENCY_CONFLICT", "Use the same request_id as preview_disaster."); if (op.State == "completed") return op.Json(EntityId); if (op.State != "preview_ready") throw new QueryException("INVALID_OPERATION_STATE", "Only an unexpired preview_ready disaster operation can be applied."); var em = world.EntityManager; if (!em.Exists(op.Prefab)) throw new QueryException("PREFAB_CHANGED", "The selected disaster prefab no longer exists."); var eventData = em.GetComponentData<EventData>(op.Prefab); if (eventData.m_ConcurrentLimit > 0 && ActiveDisasterCount(op.Prefab, world) >= eventData.m_ConcurrentLimit) throw new QueryException("DISASTER_CONCURRENT_LIMIT", "The native concurrent limit was reached after preview.");
            using (var created = em.CreateEntity(eventData.m_Archetype, 1, Allocator.Temp)) { var eventEntity = created[0]; if (em.HasComponent<PrefabRef>(eventEntity)) em.SetComponentData(eventEntity, new PrefabRef(op.Prefab)); else em.AddComponentData(eventEntity, new PrefabRef(op.Prefab)); if (op.Family == "weather") { var phenomenon = em.GetComponentData<WeatherEvent>(eventEntity); phenomenon.m_PhenomenonPosition = new float3(op.X, op.Y, op.Z); phenomenon.m_HotspotPosition = phenomenon.m_PhenomenonPosition; phenomenon.m_PhenomenonRadius = op.Radius; phenomenon.m_HotspotRadius = op.HotspotRadius; phenomenon.m_Intensity = op.Intensity; em.SetComponentData(eventEntity, phenomenon); var simulation = world.GetExistingSystemManaged<SimulationSystem>(); var duration = em.GetComponentData<Duration>(eventEntity); duration.m_StartFrame = simulation.frameIndex + (uint)(op.WarningSeconds * 60); duration.m_EndFrame = duration.m_StartFrame + (uint)(op.DurationSeconds * 60); em.SetComponentData(eventEntity, duration); } if (op.Target != Entity.Null && em.HasBuffer<TargetElement>(eventEntity)) em.GetBuffer<TargetElement>(eventEntity).Add(new TargetElement(op.Target)); op.Result = eventEntity; op.State = "completed"; }
            return op.Json(EntityId);
        }

        private JObject CancelDisasterPreview(JObject args)
        {
            var op = DisasterOperationById(args); if (op.State != "preview_ready") throw new QueryException("INVALID_OPERATION_STATE", "Only an uncommitted preview can be cancelled."); op.State = "cancelled"; return op.Json(EntityId);
        }

        private JObject UpdateDisaster(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var entity = StableDisaster((string)args["disaster_id"], world); string family = DisasterFamily(em, entity); var simulation = world.GetExistingSystemManaged<SimulationSystem>();
            if (family == "weather") { var phenomenon = em.GetComponentData<WeatherEvent>(entity); if (args["x"] != null || args["y"] != null || args["z"] != null) { phenomenon.m_PhenomenonPosition = new float3((float?)args["x"] ?? phenomenon.m_PhenomenonPosition.x, (float?)args["y"] ?? phenomenon.m_PhenomenonPosition.y, (float?)args["z"] ?? phenomenon.m_PhenomenonPosition.z); if ((bool?)args["move_hotspot"] ?? true) phenomenon.m_HotspotPosition = phenomenon.m_PhenomenonPosition; } if (args["phenomenon_radius"] != null) { float value = (float)args["phenomenon_radius"]; if (value < 10 || value > 5000 || value < phenomenon.m_HotspotRadius) throw new QueryException("INVALID_ARGUMENT", "phenomenon_radius must be 10..5000 and at least hotspot_radius."); phenomenon.m_PhenomenonRadius = value; } if (args["hotspot_radius"] != null) { float value = (float)args["hotspot_radius"]; if (value < 1 || value > phenomenon.m_PhenomenonRadius) throw new QueryException("INVALID_ARGUMENT", "hotspot_radius must be 1..phenomenon_radius."); phenomenon.m_HotspotRadius = value; } if (args["intensity"] != null) { float value = (float)args["intensity"]; if (value < 0 || value > 1) throw new QueryException("INVALID_ARGUMENT", "Weather intensity must be 0..1."); phenomenon.m_Intensity = value; } em.SetComponentData(entity, phenomenon); }
            else if (family == "water_level") { var change = em.GetComponentData<WaterLevelChange>(entity); if (args["intensity"] != null) change.m_Intensity = (float)args["intensity"]; if (args["max_intensity"] != null) change.m_MaxIntensity = (float)args["max_intensity"]; if (args["danger_height"] != null) change.m_DangerHeight = (float)args["danger_height"]; if (args["direction_x"] != null || args["direction_z"] != null) { var direction = math.normalizesafe(new float2((float?)args["direction_x"] ?? change.m_Direction.x, (float?)args["direction_z"] ?? change.m_Direction.y), new float2(0, 1)); change.m_Direction = direction; } em.SetComponentData(entity, change); }
            else if (args.Properties().Any(property => property.Name != "disaster_id" && property.Name != "move_hotspot")) throw new QueryException("DISASTER_UPDATE_UNSUPPORTED", "Fire and destruction events have no mutable native event state; stop them or clear their linked effects.");
            if (args["remaining_seconds"] != null) { if (!em.HasComponent<Duration>(entity)) throw new QueryException("DURATION_UNAVAILABLE", "This disaster event has no native Duration component."); int value = (int)args["remaining_seconds"]; var duration = em.GetComponentData<Duration>(entity); duration.m_EndFrame = simulation.frameIndex + (uint)(value * 60); if (duration.m_StartFrame > simulation.frameIndex) duration.m_StartFrame = simulation.frameIndex; em.SetComponentData(entity, duration); }
            if (!em.HasComponent<EffectsUpdated>(entity)) em.AddComponent<EffectsUpdated>(entity); return DisasterRow(entity, world, true);
        }

        private JObject StopDisaster(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var entity = StableDisaster((string)args["disaster_id"], world); var before = DisasterImpactCounts(entity, world, 0); em.AddComponent<Deleted>(entity); return new JObject { ["disaster_id"] = EntityId(entity), ["stopped"] = true, ["remaining_impacts"] = before, ["note"] = "The native event was marked Deleted. Existing fires, floods and destroyed objects remain for native response/recovery systems." };
        }

        private JObject ClearDisasterEffects(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var entity = ParseEntity((string)args["disaster_id"], em); bool includeDamage = (bool?)args["include_damage"] ?? false; int facing = 0, danger = 0, fire = 0, flood = 0, destroyed = 0;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<FacingWeather>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (em.GetComponentData<FacingWeather>(e).m_Event == entity) { em.RemoveComponent<FacingWeather>(e); facing++; }
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<InDanger>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (em.GetComponentData<InDanger>(e).m_Event == entity) { em.RemoveComponent<InDanger>(e); danger++; }
            if (includeDamage) {
                using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<OnFire>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (em.GetComponentData<OnFire>(e).m_Event == entity) { em.RemoveComponent<OnFire>(e); if (!em.HasComponent<EffectsUpdated>(e)) em.AddComponent<EffectsUpdated>(e); fire++; }
                using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Flooded>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (em.GetComponentData<Flooded>(e).m_Event == entity) { em.RemoveComponent<Flooded>(e); if (!em.HasComponent<EffectsUpdated>(e)) em.AddComponent<EffectsUpdated>(e); flood++; }
                using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Destroyed>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (em.GetComponentData<Destroyed>(e).m_Event == entity) { em.RemoveComponent<Destroyed>(e); if (!em.HasComponent<EffectsUpdated>(e)) em.AddComponent<EffectsUpdated>(e); destroyed++; }
            }
            return new JObject { ["disaster_id"] = (string)args["disaster_id"], ["include_damage"] = includeDamage, ["removed"] = new JObject { ["facing_weather"] = facing, ["in_danger"] = danger, ["on_fire"] = fire, ["flooded"] = flood, ["destroyed"] = destroyed }, ["note"] = includeDamage ? "Damage markers were force-cleared; use building rebuild operations when native reconstruction and cost are required." : "Only transient warning and evacuation markers were cleared." };
        }
    }
}
