using System;
using System.Collections.Generic;
using System.Linq;
using Game.Buildings;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Game.UI;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private ComponentInspector m_Inspector;
        private ComponentInspector Inspector => m_Inspector ?? (m_Inspector = new ComponentInspector(EntityId));
        private string EntityId(Entity e) => m_Session + ":" + e.Index + ":" + e.Version;
        private static readonly Dictionary<string, string[]> Domains = new Dictionary<string, string[]> {
            ["all"] = Array.Empty<string>(),
            ["buildings"] = new[] { "Game.Buildings.Building" },
            ["citizens"] = new[] { "Game.Citizens.Citizen" },
            ["households"] = new[] { "Game.Citizens.Household" },
            ["companies"] = new[] { "Game.Companies.CompanyData" },
            ["workers"] = new[] { "Game.Citizens.Worker" },
            ["students"] = new[] { "Game.Citizens.Student" },
            ["roads"] = new[] { "Game.Net.Road" },
            ["net_edges"] = new[] { "Game.Net.Edge" },
            ["net_nodes"] = new[] { "Game.Net.Node" },
            ["lanes"] = new[] { "Game.Net.Lane" },
            ["vehicles"] = new[] { "Game.Vehicles.Vehicle" },
            ["transport_lines"] = new[] { "Game.Routes.TransportLine" },
            ["districts"] = new[] { "Game.Areas.District" },
            ["schools"] = new[] { "Game.Buildings.School" },
            ["hospitals"] = new[] { "Game.Buildings.Hospital" },
            ["police_stations"] = new[] { "Game.Buildings.PoliceStation" },
            ["fire_stations"] = new[] { "Game.Buildings.FireStation" },
            ["garbage_facilities"] = new[] { "Game.Buildings.GarbageFacility" },
            ["power_plants"] = new[] { "Game.Buildings.ElectricityProducer" },
            ["water_pumps"] = new[] { "Game.Buildings.WaterPumpingStation" },
            ["sewage_outlets"] = new[] { "Game.Buildings.SewageOutlet" },
            ["parks"] = new[] { "Game.Buildings.Park" },
            ["deathcare"] = new[] { "Game.Buildings.DeathcareFacility" },
            ["public_transport_stations"] = new[] { "Game.Buildings.PublicTransportStation" },
            ["cargo_stations"] = new[] { "Game.Buildings.CargoTransportStation" },
            ["parking_facilities"] = new[] { "Game.Buildings.ParkingFacility" },
            ["resource_holders"] = new[] { "Game.Economy.Resources" },
            ["prefabs"] = new[] { "Game.Prefabs.PrefabData" }
        };

        private string[] Strings(JObject args, string name, int max = 8)
        {
            if (args[name] == null) return Array.Empty<string>();
            if (!(args[name] is JArray list) || list.Count > max || list.Any(x => x.Type != JTokenType.String || ((string)x).Length > 200)) throw new QueryException("INVALID_ARGUMENT", name + " must be a bounded array of component names.");
            return list.Select(x => (string)x).Distinct().OrderBy(x => x, StringComparer.Ordinal).ToArray();
        }
        private Entity ParseEntity(string id, EntityManager em)
        {
            var parts = (id ?? "").Split(':');
            if (parts.Length != 3 || !int.TryParse(parts[1], out var index) || !int.TryParse(parts[2], out var version) || index < 0 || version < 0) throw new QueryException("INVALID_ARGUMENT", "Use an entity_id returned by this bridge.");
            if (parts[0] != m_Session) throw new QueryException("STALE_ENTITY", "Entity belongs to another city session.");
            var entity = new Entity { Index = index, Version = version };
            if (!em.Exists(entity) || em.HasComponent<Deleted>(entity) || em.HasComponent<Temp>(entity)) throw new QueryException("ENTITY_NOT_FOUND", "Entity is deleted or unavailable.");
            return entity;
        }
        private EntityQuery FilteredQuery(JObject args, EntityManager em, out string fingerprint)
        {
            var category = (string)args["category"] ?? "all";
            if (!Domains.TryGetValue(category, out var basis)) throw new QueryException("INVALID_ARGUMENT", "Unknown category; use get_query_capabilities.");
            var all = basis.Concat(Strings(args, "all_components")).Distinct().OrderBy(x => x, StringComparer.Ordinal).ToArray();
            var any = Strings(args, "any_components");
            var none = Strings(args, "none_components");
            if (all.Intersect(none).Any()) throw new QueryException("INVALID_ARGUMENT", "A required component cannot be excluded.");
            var includePrefabs = category == "prefabs" || (bool?)args["include_prefabs"] == true;
            if (!includePrefabs && all.Contains("Game.Prefabs.PrefabData")) throw new QueryException("INVALID_ARGUMENT", "Set include_prefabs=true to query prefab definitions.");
            if (all.Any(n => n == "Game.Common.Deleted" || n == "Game.Tools.Temp")) throw new QueryException("INVALID_ARGUMENT", "Deleted and temporary entities are not queryable.");
            var exclusions = none.Concat(new[] { "Game.Common.Deleted", "Game.Tools.Temp" }).Concat(includePrefabs ? Array.Empty<string>() : new[] { "Game.Prefabs.PrefabData" }).ToArray();
            if (any.Length > 0)
            {
                if (any.Intersect(all).Any()) any = Array.Empty<string>();
                else { any = any.Except(exclusions).ToArray(); if (any.Length == 0) throw new QueryException("INVALID_ARGUMENT", "All any_components are excluded by the filters."); }
            }
            var excluded = none.Select(x => ComponentType.ReadOnly(Inspector.Resolve(x))).ToList();
            excluded.Add(ComponentType.ReadOnly<Deleted>());
            excluded.Add(ComponentType.ReadOnly<Temp>());
            if (!includePrefabs) excluded.Add(ComponentType.ReadOnly<PrefabData>());
            fingerprint = new JObject { ["category"] = category, ["all"] = new JArray(all), ["any"] = new JArray(any), ["none"] = new JArray(none), ["prefabs"] = includePrefabs }.ToString(Formatting.None);
            return em.CreateEntityQuery(new EntityQueryDesc {
                All = all.Select(x => ComponentType.ReadOnly(Inspector.Resolve(x))).ToArray(),
                Any = any.Select(x => ComponentType.ReadOnly(Inspector.Resolve(x))).ToArray(),
                None = excluded.Distinct().ToArray(),
                Options = EntityQueryOptions.IgnoreComponentEnabledState
            });
        }
        private JObject CountEntities(JObject args, EntityManager em)
        {
            using (var query = FilteredQuery(args, em, out _)) return new JObject { ["count"] = query.CalculateEntityCount(), ["category"] = (string)args["category"] ?? "all",
                ["notes"] = "Entity count, not population/household occupancy. Excludes Deleted/Temp and, by default, prefab definitions. Includes disabled component states; Unity Disabled entities remain excluded." };
        }
        private JObject QueryEntities(JObject args, World world, EntityManager em)
        {
            var limit = Integer(args, "limit", 20, 1, 100);
            var offset = Integer(args, "offset", 0, 0, 200000);
            var requested = Strings(args, "include_components");
            foreach (var name in requested) Inspector.Resolve(name);
            var bufferLimit = Integer(args, "buffer_limit", 5, 1, 20);
            Snapshot snapshot;
            using (var query = FilteredQuery(args, em, out var fingerprint))
            {
                fingerprint = "entities:" + fingerprint;
                foreach (var old in m_Snapshots.Where(x => (DateTime.UtcNow - x.Value.Created).TotalSeconds >= 60).Select(x => x.Key).ToArray()) m_Snapshots.Remove(old);
                var snapshotId = (string)args["snapshot_id"];
                if (snapshotId != null)
                {
                    if (!m_Snapshots.TryGetValue(snapshotId, out snapshot)) throw new QueryException("SNAPSHOT_EXPIRED", "Restart pagination at offset 0 without snapshot_id.");
                    if (snapshot.Type != fingerprint) throw new QueryException("INVALID_ARGUMENT", "All entity filters must remain unchanged for a snapshot.");
                }
                else
                {
                    if (offset != 0) throw new QueryException("INVALID_ARGUMENT", "Use snapshot_id for nonzero offsets.");
                    if (query.CalculateEntityCount() > 200000) throw new QueryException("QUERY_TOO_LARGE", "Narrow category/components; membership limit is 200000. count_entities has no membership allocation.");
                    using (var entities = query.ToEntityArray(Allocator.Temp)) snapshot = new Snapshot { Type = fingerprint, Entities = entities.ToArray() };
                    Array.Sort(snapshot.Entities, (a, b) => a.Index != b.Index ? a.Index.CompareTo(b.Index) : a.Version.CompareTo(b.Version));
                    if (m_Snapshots.Count >= 8) m_Snapshots.Remove(m_Snapshots.OrderBy(x => x.Value.Created).First().Key);
                    m_Snapshots[snapshot.Id] = snapshot;
                }
            }
            if (offset > snapshot.Entities.Length) throw new QueryException("INVALID_ARGUMENT", "offset exceeds membership size.");
            var items = new JArray();
            var end = Math.Min(snapshot.Entities.Length, offset + limit);
            var skipped = 0;
            for (var i = offset; i < end; i++)
            {
                var entity = snapshot.Entities[i];
                if (!em.Exists(entity) || em.HasComponent<Deleted>(entity) || em.HasComponent<Temp>(entity)) { skipped++; continue; }
                var row = EntityRow(entity, world, em);
                row["components"] = ComponentValues(em, entity, requested, 0, bufferLimit);
                if (em.HasComponent<PrefabRef>(entity)) row["prefab_entity_id"] = EntityId(em.GetComponentData<PrefabRef>(entity).m_Prefab);
                items.Add(row);
            }
            return new JObject { ["snapshot_id"] = snapshot.Id, ["membership_captured_at_utc"] = snapshot.Created.ToString("O"), ["row_values"] = "live_at_query_time", ["total"] = snapshot.Entities.Length,
                ["offset"] = offset, ["next_offset"] = end < snapshot.Entities.Length ? new JValue(end) : JValue.CreateNull(), ["skipped_deleted"] = skipped, ["items"] = items };
        }
        private JObject FindBuildingsByName(JObject args, World world, EntityManager em)
        {
            var wanted = ((string)args["name"] ?? "").Trim();
            if (wanted.Length == 0 || wanted.Length > 200) throw new QueryException("INVALID_ARGUMENT", "name must contain 1..200 non-whitespace characters after trimming.");
            var mode = ((string)args["match"] ?? "contains").Trim().ToLowerInvariant();
            if (mode != "exact" && mode != "contains") throw new QueryException("INVALID_ARGUMENT", "match must be exact or contains.");
            var type = (string)args["building_type"] ?? "all";
            var caseSensitive = (bool?)args["case_sensitive"] ?? false;
            var limit = Integer(args, "limit", 50, 1, 100);
            var comparison = caseSensitive ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;
            var names = world.GetExistingSystemManaged<NameSystem>();
            var matches = new List<KeyValuePair<Entity, JObject>>();
            using (var query = BuildingQuery(em, type))
            using (var entities = query.ToEntityArray(Allocator.Temp))
            {
                foreach (var building in entities)
                {
                    string name = null;
                    try { name = names?.GetRenderedLabelName(building); } catch { }
                    string address = null;
                    string streetName = null;
                    var street = Entity.Null;
                    int? streetNumber = null;
                    try
                    {
                        // Use the game's address calculation, including aggregate direction,
                        // curved-road distances, roundabouts and odd/even numbering.
                        if (BuildingUtils.GetAddress(em, building, out var road, out var number) &&
                            road != Entity.Null && em.Exists(road) && !em.HasComponent<Deleted>(road) && !em.HasComponent<Temp>(road))
                        {
                            streetName = names?.GetRenderedLabelName(road);
                            if (!string.IsNullOrEmpty(streetName))
                            {
                                street = road;
                                streetNumber = number;
                                address = number.ToString(System.Globalization.CultureInfo.InvariantCulture) + " " + streetName;
                            }
                        }
                    }
                    catch { /* A missing address must not hide a searchable building label. */ }
                    bool Matches(string value) => !string.IsNullOrEmpty(value) &&
                        (mode == "exact" ? string.Equals(value, wanted, comparison) : value.IndexOf(wanted, comparison) >= 0);
                    if (Matches(name) || Matches(address))
                        matches.Add(new KeyValuePair<Entity, JObject>(building, new JObject {
                            ["name"] = name, ["address"] = address, ["street_name"] = streetName,
                            ["street_number"] = streetNumber.HasValue ? new JValue(streetNumber.Value) : JValue.CreateNull(),
                            ["street_id"] = street == Entity.Null ? null : EntityId(street)
                        }));
                }
            }
            var items = new JArray();
            foreach (var match in matches.OrderBy(x => (string)x.Value["name"], StringComparer.Ordinal).ThenBy(x => x.Key.Index).ThenBy(x => x.Key.Version).Take(limit))
            {
                var row = EntityRow(match.Key, world, em);
                foreach (var property in match.Value.Properties()) row[property.Name] = property.Value.DeepClone();
                items.Add(row);
            }
            return new JObject {
                ["query"] = wanted, ["match"] = mode, ["case_sensitive"] = caseSensitive, ["building_type"] = type,
                ["total_matches"] = matches.Count, ["returned_count"] = items.Count, ["truncated"] = matches.Count > items.Count, ["items"] = items
            };
        }
        private JObject FindRoadsByName(JObject args, World world, EntityManager em)
        {
            var wanted = ((string)args["name"] ?? "").Trim();
            if (wanted.Length == 0) throw new QueryException("INVALID_ARGUMENT", "name must contain at least one non-whitespace character.");
            var mode = ((string)args["match"] ?? "contains").Trim().ToLowerInvariant();
            if (mode != "exact" && mode != "contains") throw new QueryException("INVALID_ARGUMENT", "match must be exact or contains.");
            var caseSensitive = (bool?)args["case_sensitive"] ?? false;
            var limit = Integer(args, "limit", 50, 1, 100);
            var comparison = caseSensitive ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;
            var names = world.GetExistingSystemManaged<NameSystem>();
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            var rows = new List<JObject>();
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Road>(), ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<Curve>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = query.ToEntityArray(Allocator.Temp))
            {
                foreach (var road in entities)
                {
                    // Map labels belong to the street aggregate, not its individual road edges.
                    var nameTarget = road;
                    if (em.HasComponent<Aggregated>(road))
                    {
                        var aggregate = em.GetComponentData<Aggregated>(road).m_Aggregate;
                        if (aggregate != Entity.Null && em.Exists(aggregate) &&
                            !em.HasComponent<Deleted>(aggregate) && !em.HasComponent<Temp>(aggregate))
                            nameTarget = aggregate;
                    }
                    string roadName = null;
                    try { roadName = names?.GetRenderedLabelName(nameTarget); } catch { }
                    if (string.IsNullOrEmpty(roadName) && nameTarget != road)
                    {
                        try { roadName = names?.GetRenderedLabelName(road); } catch { }
                    }
                    if (string.IsNullOrEmpty(roadName)) continue;
                    var matched = mode == "exact" ? string.Equals(roadName, wanted, comparison) : roadName.IndexOf(wanted, comparison) >= 0;
                    if (!matched) continue;
                    var curve = em.GetComponentData<Curve>(road);
                    var edge = em.GetComponentData<Edge>(road);
                    var prefabRef = em.GetComponentData<PrefabRef>(road);
                    prefabs.TryGetPrefab<PrefabBase>(prefabRef.m_Prefab, out var prefab);
                    rows.Add(new JObject {
                        ["road_id"] = EntityId(road), ["name"] = roadName, ["prefab"] = prefab?.name, ["length_m"] = curve.m_Length,
                        ["start"] = new JObject { ["x"] = curve.m_Bezier.a.x, ["y"] = curve.m_Bezier.a.y, ["z"] = curve.m_Bezier.a.z },
                        ["end"] = new JObject { ["x"] = curve.m_Bezier.d.x, ["y"] = curve.m_Bezier.d.y, ["z"] = curve.m_Bezier.d.z },
                        ["start_node_id"] = EntityId(edge.m_Start), ["end_node_id"] = EntityId(edge.m_End)
                    });
                }
            }
            rows = rows.OrderBy(x => (string)x["name"], StringComparer.Ordinal).ThenBy(x => (string)x["road_id"], StringComparer.Ordinal).Take(limit).ToList();
            return new JObject { ["query"] = wanted, ["match"] = mode, ["case_sensitive"] = caseSensitive, ["total_matches"] = rows.Count, ["items"] = new JArray(rows) };
        }
        private JObject ComponentValues(EntityManager em, Entity entity, string[] names, int offset, int limit)
        {
            var result = new JObject();
            foreach (var name in names) result[name] = Inspector.Read(em, entity, name, offset, limit);
            return result;
        }
        private JObject ReadEntityComponents(JObject args, EntityManager em)
        {
            var entity = ParseEntity((string)args["entity_id"], em);
            var names = Strings(args, "components", 16);
            var componentOffset = Integer(args, "component_offset", 0, 0, 4096);
            var bufferOffset = Integer(args, "buffer_offset", 0, 0, 2000000);
            var bufferLimit = Integer(args, "buffer_limit", 20, 1, 100);
            var total = names.Length;
            JToken next = JValue.CreateNull();
            if (names.Length == 0)
            {
                using (var types = em.GetComponentTypes(entity, Allocator.Temp))
                {
                    var all = types.ToArray().Select(t => t.GetManagedType()?.FullName).Where(n => n?.StartsWith("Game.", StringComparison.Ordinal) == true).OrderBy(n => n, StringComparer.Ordinal).ToArray();
                    total = all.Length;
                    names = all.Skip(componentOffset).Take(16).ToArray();
                    if (componentOffset + 16 < total) next = new JValue(componentOffset + 16);
                }
            }
            else if (componentOffset != 0) throw new QueryException("INVALID_ARGUMENT", "component_offset is only for auto-discovered components.");
            return new JObject { ["entity_id"] = EntityId(entity), ["total_components"] = total, ["next_component_offset"] = next,
                ["components"] = ComponentValues(em, entity, names, bufferOffset, bufferLimit), ["notes"] = "Public stored fields, not computed properties. Check each component status and buffer next_offset. Original field units are not interpreted." };
        }
        private JObject CityData(JObject args, World world, EntityManager em)
        {
            var result = new JObject();
            var counts = new JObject();
            foreach (var domain in Domains.Keys.Where(k => k != "all" && k != "prefabs"))
            {
                try { counts[domain] = CountEntities(new JObject { ["category"] = domain }, em)["count"]; }
                catch (QueryException) { counts[domain] = JValue.CreateNull(); }
            }
            result["category_counts"] = counts;
            var city = world.GetExistingSystemManaged<CitySystem>()?.City ?? Entity.Null;
            if (city != Entity.Null && em.Exists(city))
            {
                var copy = (JObject)args.DeepClone(); copy["entity_id"] = EntityId(city);
                result["city_entity"] = ReadEntityComponents(copy, em);
            }
            result["notes"] = "Counts overlap across categories and represent ECS instances. Use the city entity for resources, policies and statistics components. Use component_offset to page its components.";
            return result;
        }
    }
}
