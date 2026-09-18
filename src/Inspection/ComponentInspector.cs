using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using Unity.Entities;

namespace CityWeaver
{
    // Reads value components through EntityManager, never pointers or arbitrary properties/methods.
    public sealed class ComponentInspector
    {
        private readonly SortedDictionary<string, Type> m_Types = new SortedDictionary<string, Type>(StringComparer.Ordinal);
        private readonly Func<Entity, string> m_EntityId;
        private readonly Dictionary<Type, Func<EntityManager, Entity, int, int, JObject>> m_Readers = new Dictionary<Type, Func<EntityManager, Entity, int, int, JObject>>();
        private readonly Dictionary<Type, FieldInfo[]> m_Fields = new Dictionary<Type, FieldInfo[]>();
        public ComponentInspector(Func<Entity, string> entityId)
        {
            m_EntityId = entityId;
            foreach (var type in typeof(Game.Buildings.Building).Assembly.GetTypes())
            {
                if (type.ContainsGenericParameters || type.FullName == null || !type.FullName.StartsWith("Game.", StringComparison.Ordinal)) continue;
                if (!typeof(IComponentData).IsAssignableFrom(type) && !typeof(IBufferElementData).IsAssignableFrom(type) && !typeof(ISharedComponentData).IsAssignableFrom(type)) continue;
                try { ComponentType.ReadOnly(type); m_Types[type.FullName] = type; }
                catch (ArgumentException) { }
            }
        }

        public Type Resolve(string name)
        {
            if (name == null || !m_Types.TryGetValue(name, out var type)) throw new QueryException("UNKNOWN_COMPONENT", "Use a fully qualified component name from list_component_types: " + (name ?? "null"));
            return type;
        }
        private static string Kind(Type t) => typeof(IBufferElementData).IsAssignableFrom(t) ? "buffer" : typeof(ISharedComponentData).IsAssignableFrom(t) ? "shared" : t.IsValueType ? "component" : "managed";
        private static bool Supported(Type t) => t.IsValueType;
        private FieldInfo[] Fields(Type t)
        {
            if (!m_Fields.TryGetValue(t, out var fields)) m_Fields[t] = fields = DeepDataReader.Fields(t);
            return fields;
        }
        public JObject Stats() => new JObject { ["discovered_types"] = m_Types.Count, ["value_readable_types"] = m_Types.Values.Count(Supported), ["scope"] = "Game.dll ECS types in this game build" };
        public JObject Catalog(JObject args)
        {
            var search = (string)args["search"] ?? "";
            var offset = Int(args, "offset", 0, 0, 100000);
            var limit = Int(args, "limit", 50, 1, 100);
            var matches = m_Types.Where(kv => kv.Key.IndexOf(search, StringComparison.OrdinalIgnoreCase) >= 0).ToArray();
            return new JObject { ["total"] = matches.Length, ["offset"] = offset, ["next_offset"] = offset + limit < matches.Length ? new JValue(offset + limit) : JValue.CreateNull(),
                ["items"] = new JArray(matches.Skip(offset).Take(limit).Select(kv => new JObject { ["name"] = kv.Key, ["kind"] = Kind(kv.Value), ["readable"] = Supported(kv.Value), ["field_count"] = Fields(kv.Value).Length })) };
        }
        public JObject Schema(string name)
        {
            var type = Resolve(name);
            var seen = new HashSet<Type>();
            return new JObject { ["component"] = name, ["kind"] = Kind(type), ["readable"] = Supported(type), ["enableable"] = typeof(IEnableableComponent).IsAssignableFrom(type),
                ["fields"] = SchemaFields(type, 0, seen), ["notes"] = "Original public and non-public instance fields. No computed properties. Entity references contain session-scoped IDs. Value units/semantics are not inferred." };
        }
        private JArray SchemaFields(Type type, int depth, HashSet<Type> seen)
        {
            var result = new JArray();
            if (depth >= 3 || !seen.Add(type)) return result;
            foreach (var field in Fields(type).Take(64))
            {
                var t = field.FieldType;
                var item = new JObject { ["name"] = field.Name, ["type"] = t.FullName ?? t.Name, ["visibility"] = field.IsPublic ? "public" : "non_public" };
                if (t == typeof(Entity)) item["representation"] = "entity_id or null";
                else if (t.IsEnum) item["enum_names"] = new JArray(Enum.GetNames(t).Take(128));
                else if (Unsafe(t)) item["representation"] = "typed_native_reader_or_explicit_unavailable";
                else if (t.IsValueType && !t.IsPrimitive && t != typeof(decimal)) item["fields"] = SchemaFields(t, depth + 1, seen);
                result.Add(item);
            }
            seen.Remove(type);
            return result;
        }
        private static bool Unsafe(Type t) => t.IsPointer || t == typeof(IntPtr) || t == typeof(UIntPtr) || t.IsByRef ||
            (t.Namespace?.StartsWith("Unity.Collections", StringComparison.Ordinal) == true) ||
            t.Name.StartsWith("Blob", StringComparison.Ordinal) || t.Name.Contains("Unsafe") || t.Name.Contains("Native");

        public JObject Read(EntityManager em, Entity entity, string component, int offset, int limit)
        {
            var t = Resolve(component);
            if (!em.HasComponent(entity, ComponentType.ReadOnly(t))) return new JObject { ["present"] = false };
            if (!Supported(t)) return new JObject { ["present"] = true, ["status"] = "unsupported", ["kind"] = Kind(t), ["reason"] = "Managed component objects are not exported." };
            if (Kind(t) == "component" && Fields(t).Length == 0)
            {
                var tag = new JObject { ["present"] = true, ["kind"] = "tag_or_private_fields", ["fields"] = new JObject() };
                if (typeof(IEnableableComponent).IsAssignableFrom(t)) tag["enabled"] = em.IsComponentEnabled(entity, ComponentType.ReadOnly(t));
                return tag;
            }
            try
            {
                if (!m_Readers.TryGetValue(t, out var reader))
                {
                    var methodName = Kind(t) == "buffer" ? nameof(ReadBuffer) : Kind(t) == "shared" ? nameof(ReadShared) : nameof(ReadComponent);
                    var method = GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic).MakeGenericMethod(t);
                    m_Readers[t] = reader = (Func<EntityManager, Entity, int, int, JObject>)Delegate.CreateDelegate(typeof(Func<EntityManager, Entity, int, int, JObject>), this, method);
                }
                var result = reader(em, entity, offset, limit);
                result["present"] = true;
                if (typeof(IEnableableComponent).IsAssignableFrom(t)) result["enabled"] = em.IsComponentEnabled(entity, ComponentType.ReadOnly(t));
                return result;
            }
            catch (Exception ex) { return new JObject { ["present"] = true, ["status"] = "unavailable", ["error_type"] = ex.GetType().Name }; }
        }
        private JObject ReadComponent<T>(EntityManager em, Entity entity, int offset, int limit) where T : unmanaged, IComponentData
        {
            var budget = 512;
            return new JObject { ["kind"] = "component", ["fields"] = Value(em.GetComponentData<T>(entity), typeof(T), 0, ref budget) };
        }
        private JObject ReadShared<T>(EntityManager em, Entity entity, int offset, int limit) where T : struct, ISharedComponentData
        {
            var budget = 512;
            return new JObject { ["kind"] = "shared", ["fields"] = Value(em.GetSharedComponentManaged<T>(entity), typeof(T), 0, ref budget) };
        }
        private JObject ReadBuffer<T>(EntityManager em, Entity entity, int offset, int limit) where T : unmanaged, IBufferElementData
        {
            var buffer = em.GetBuffer<T>(entity, true);
            var items = new JArray();
            var end = Math.Min(buffer.Length, offset + limit);
            for (var i = offset; i < end; i++) { var budget = 256; items.Add(Value(buffer[i], typeof(T), 0, ref budget)); }
            return new JObject { ["kind"] = "buffer", ["length"] = buffer.Length, ["offset"] = offset, ["next_offset"] = end < buffer.Length ? new JValue(end) : JValue.CreateNull(), ["items"] = items,
                ["consistency"] = "Live buffer; indices can shift between calls while simulation runs." };
        }
        private JToken Value(object value, Type type, int depth, ref int budget)
        {
            return new DeepDataReader(m_EntityId).Read(value, 0, 64);
        }
        public static int Int(JObject args, string key, int fallback, int min, int max)
        {
            var token = args[key];
            if (token == null) return fallback;
            if (token.Type != JTokenType.Integer || !long.TryParse(token.ToString(), out var value) || value < min || value > max) throw new QueryException("INVALID_ARGUMENT", key + " outside supported range.");
            return (int)value;
        }
        public object Raw(EntityManager em, Entity entity, string name, int index)
        {
            var type = Resolve(name);
            if (!em.HasComponent(entity, ComponentType.ReadOnly(type))) throw new QueryException("COMPONENT_NOT_FOUND", name);
            var method = Kind(type) == "buffer" ? nameof(RawBuffer) : Kind(type) == "shared" ? nameof(RawShared) : nameof(RawComponent);
            try { return GetType().GetMethod(method, BindingFlags.Static | BindingFlags.NonPublic).MakeGenericMethod(type).Invoke(null, new object[] { em, entity, index }); }
            catch (TargetInvocationException e) { throw new QueryException("FIELD_UNAVAILABLE", e.InnerException?.GetType().Name ?? "Read failed"); }
        }
        private static object RawComponent<T>(EntityManager em, Entity e, int index) where T : unmanaged, IComponentData => em.GetComponentData<T>(e);
        private static object RawShared<T>(EntityManager em, Entity e, int index) where T : struct, ISharedComponentData => em.GetSharedComponentManaged<T>(e);
        private static object RawBuffer<T>(EntityManager em, Entity e, int index) where T : unmanaged, IBufferElementData
        {
            var buffer = em.GetBuffer<T>(e, true);
            if (index < 0 || index >= buffer.Length) throw new QueryException("INVALID_ARGUMENT", "Buffer index outside length.");
            return buffer[index];
        }
    }
}

