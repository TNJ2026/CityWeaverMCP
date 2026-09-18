using System;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using Unity.Entities;
using Unity.Jobs;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private ComponentSystemBase[] Systems(World world)
        {
            // NoAllocReadOnlyCollection deliberately throws through IEnumerable<T>.
            // foreach binds to its concrete struct enumerator without interface boxing.
            var systems = new System.Collections.Generic.List<ComponentSystemBase>();
            foreach (var system in world.Systems)
                if (system.GetType().FullName.StartsWith("Game.", StringComparison.Ordinal)) systems.Add(system);
            return systems.OrderBy(s => s.GetType().FullName, StringComparer.Ordinal).ToArray();
        }
        private ComponentSystemBase SystemByName(World world, string name) => Systems(world).FirstOrDefault(s => s.GetType().FullName == name) ?? throw new QueryException("UNKNOWN_SYSTEM", "Use an existing system from list_game_systems.");
        private static Type GridBase(Type t)
        {
            for (; t != null; t = t.BaseType) if (t.IsGenericType && t.GetGenericTypeDefinition().FullName == "Game.Simulation.CellMapSystem`1") return t;
            return null;
        }
        private void SyncReads(World world)
        {
            world.EntityManager.CompleteAllTrackedJobs();
            foreach (var system in Systems(world))
                foreach (var field in DeepDataReader.Fields(system.GetType()))
                    if (field.FieldType == typeof(JobHandle)) ((JobHandle)field.GetValue(system)).Complete();
        }
        private JObject ListSystems(JObject args, World world, bool grids)
        {
            var search = (string)args["search"] ?? "";
            var systems = Systems(world).Where(s => (!grids || GridBase(s.GetType()) != null) && s.GetType().FullName.IndexOf(search, StringComparison.OrdinalIgnoreCase) >= 0).ToArray();
            var offset = ComponentInspector.Int(args, "offset", 0, 0, 100000); var limit = ComponentInspector.Int(args, "limit", 50, 1, 100);
            return new JObject { ["total"] = systems.Length, ["next_offset"] = offset + limit < systems.Length ? new JValue(offset + limit) : JValue.CreateNull(),
                ["items"] = new JArray(systems.Skip(offset).Take(limit).Select(s => new JObject { ["system"] = s.GetType().FullName, ["field_count"] = DeepDataReader.Fields(s.GetType()).Length, ["grid_element"] = GridBase(s.GetType())?.GetGenericArguments()[0].FullName })) };
        }
        private JObject SystemSchema(JObject args, World world)
        {
            var system = SystemByName(world, (string)args["system"]);
            return new JObject { ["system"] = system.GetType().FullName, ["fields"] = new JArray(DeepDataReader.Fields(system.GetType()).Select(f => new JObject { ["name"] = f.Name, ["type"] = f.FieldType.ToString(), ["visibility"] = f.IsPublic ? "public" : "non_public", ["declaring_type"] = f.DeclaringType.FullName })) };
        }
        private static string[] FieldPath(JObject args)
        {
            if (args["field_path"] == null) return Array.Empty<string>();
            if (!(args["field_path"] is JArray p) || p.Count > 12 || p.Any(v => v.Type != JTokenType.String || ((string)v).Length > 200)) throw new QueryException("INVALID_ARGUMENT", "field_path must contain at most 12 field names or indices.");
            return p.Select(v => (string)v).ToArray();
        }
        private JObject ReadSystem(JObject args, World world)
        {
            var system = SystemByName(world, (string)args["system"]); var path = FieldPath(args);
            var reader = new DeepDataReader(EntityId);
            SyncReads(world);
            var offset = ComponentInspector.Int(args, "offset", 0, 0, 2000000); var limit = ComponentInspector.Int(args, "limit", 20, 1, 100);
            JToken data;
            if (path.Length == 0)
            {
                var fields = DeepDataReader.Fields(system.GetType()); var items = new JObject();
                foreach (var f in fields.Skip(offset).Take(limit)) items[f.Name] = reader.Read(f.GetValue(system));
                data = new JObject { ["total_fields"] = fields.Length, ["next_offset"] = offset + limit < fields.Length ? new JValue(offset + limit) : JValue.CreateNull(), ["fields"] = items };
            }
            else data = reader.Read(reader.Select(system, path), offset, limit);
            return new JObject { ["system"] = system.GetType().FullName, ["field_path"] = new JArray(path), ["value"] = data, ["consistency"] = "Main-thread live read after tracked ECS and system job handles complete." };
        }
        private JObject ReadEntityField(JObject args, World world)
        {
            var e = ParseEntity((string)args["entity_id"], world.EntityManager); var path = FieldPath(args);
            var offset = ComponentInspector.Int(args, "offset", 0, 0, 268435456); var limit = ComponentInspector.Int(args, "limit", 64, 1, 4096);
            SyncReads(world);
            var raw = Inspector.Raw(world.EntityManager, e, (string)args["component"], ComponentInspector.Int(args, "buffer_index", 0, 0, 2000000));
            var reader = new DeepDataReader(EntityId);
            return new JObject { ["entity_id"] = EntityId(e), ["component"] = (string)args["component"], ["field_path"] = new JArray(path), ["value"] = reader.Read(reader.Select(raw, path), offset, limit) };
        }
        private JObject ReadGrid(JObject args, World world)
        {
            var system = SystemByName(world, (string)args["system"]); var basis = GridBase(system.GetType());
            if (basis == null) throw new QueryException("UNKNOWN_LAYER", "Use list_environment_layers.");
            var offset = ComponentInspector.Int(args, "offset", 0, 0, 2000000); var limit = ComponentInspector.Int(args, "limit", 64, 1, 1024);
            var parameters = new object[] { true, default(JobHandle) };
            var map = basis.GetMethod("GetMap").Invoke(system, parameters); ((JobHandle)parameters[1]).Complete();
            var sizeProperty = system.GetType().GetProperty("TextureSize");
            Unity.Mathematics.int2 size;
            if (sizeProperty != null) size = (Unity.Mathematics.int2)sizeProperty.GetValue(system);
            else if (system is Game.Simulation.GroundWaterSystem)
            {
                // GroundWaterSystem.OnCreate passes kTextureSize to CreateTextures(int).
                var width = (int)system.GetType().GetField("kTextureSize", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static).GetValue(null);
                size = new Unity.Mathematics.int2(width, width);
            }
            else throw new QueryException("LAYER_LAYOUT_UNAVAILABLE", "Layer has no supported resolution accessor.");
            var length = (int)map.GetType().GetProperty("Length").GetValue(map);
            if (size.x <= 0 || size.y <= 0 || (long)size.x * size.y != length)
                throw new QueryException("LAYER_LAYOUT_UNAVAILABLE", "Resolution does not match the allocated cell count.");
            var reader = new DeepDataReader(EntityId);
            return new JObject { ["system"] = system.GetType().FullName, ["element_type"] = basis.GetGenericArguments()[0].FullName,
                ["resolution"] = reader.Read(size), ["world_size"] = JToken.FromObject(basis.GetField("kMapSize", BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy).GetValue(null)),
                ["indexing"] = "row-major: x = index % resolution.x; z = index / resolution.x. Cell center = -world_size/2 + (coordinate+0.5)*world_size/resolution.",
                ["units"] = "Raw game cell fields; no unit conversion.", ["cells"] = reader.Read(map, offset, limit) };
        }
    }
}
