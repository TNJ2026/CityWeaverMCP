using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using Unity.Entities;

namespace CitiesSkylines2Mod
{
    // Only known container accessors are invoked. Never dispose or mutate game-owned storage.
    public sealed class DeepDataReader
    {
        private readonly Func<Entity, string> m_Id;
        public DeepDataReader(Func<Entity, string> id) { m_Id = id; }
        public static FieldInfo[] Fields(Type t)
        {
            var fields = new List<FieldInfo>();
            for (; t != null && t != typeof(object) && !t.FullName.StartsWith("Unity.Entities.ComponentSystem"); t = t.BaseType)
                fields.AddRange(t.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly));
            return fields.GroupBy(f => f.Name).Select(g => g.First()).OrderBy(f => f.Name, StringComparer.Ordinal).ToArray();
        }
        public static bool Native(Type t) => t.Namespace == "Unity.Collections" || t.Namespace == "Colossal.Collections";
        private static object Property(object value, string name) => value.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance)?.GetValue(value);
        public object Select(object value, string[] path)
        {
            foreach (var part in path)
            {
                if (value == null) throw new QueryException("FIELD_NOT_FOUND", "Path crosses null.");
                if (int.TryParse(part, out var index))
                {
                    if (value is Array a) { if (index < 0 || index >= a.Length) throw new QueryException("INVALID_ARGUMENT", "Index outside array."); value = a.GetValue(index); }
                    else if (Indexed(value.GetType()))
                    {
                        var length = Convert.ToInt32(Property(value, "Length"));
                        if (index < 0 || index >= length) throw new QueryException("INVALID_ARGUMENT", "Index outside native container.");
                        value = value.GetType().GetProperty("Item").GetValue(value, new object[] { index });
                    }
                    else throw new QueryException("UNSUPPORTED_PATH", "This value has no supported index accessor.");
                }
                else
                {
                    if (Native(value.GetType()) || value.GetType().Name.StartsWith("Blob")) throw new QueryException("UNSUPPORTED_PATH", "Use container indices; internal allocation pointers are not field paths.");
                    var field = Fields(value.GetType()).FirstOrDefault(f => f.Name == part);
                    if (field == null) throw new QueryException("FIELD_NOT_FOUND", part);
                    value = field.GetValue(value);
                }
            }
            return value;
        }
        private static bool Indexed(Type t) => t.IsGenericType && (t.GetGenericTypeDefinition().FullName == "Unity.Collections.NativeArray`1" || t.GetGenericTypeDefinition().FullName == "Unity.Collections.NativeList`1");
        public JToken Read(object value, int offset = 0, int limit = 20) { int budget = 8192; return Read(value, offset, limit, 0, ref budget); }
        private JToken Read(object value, int offset, int limit, int depth, ref int budget)
        {
            if (--budget < 0 || depth > 8) return new JObject { ["truncated"] = true, ["reason"] = "depth_or_node_budget" };
            if (value == null) return JValue.CreateNull();
            var t = value.GetType();
            if (t == typeof(Entity)) return (Entity)value == Entity.Null ? JValue.CreateNull() : new JValue(m_Id((Entity)value));
            if (t == typeof(long) || t == typeof(ulong)) return new JObject { ["integer64"] = value.ToString() };
            if (t.IsEnum) return new JObject { ["name"] = value.ToString(), ["value"] = Read(Convert.ChangeType(value, Enum.GetUnderlyingType(t)), 0, limit, depth + 1, ref budget) };
            if (t == typeof(float) || t == typeof(double)) { var n = Convert.ToDouble(value); return double.IsNaN(n) || double.IsInfinity(n) ? new JObject { ["non_finite"] = n.ToString() } : new JValue(n); }
            if (t.IsPrimitive || t == typeof(decimal)) return JToken.FromObject(value);
            if (value is string s) return s.Length <= 2048 ? new JValue(s) : new JObject { ["preview"] = s.Substring(0, 2048), ["truncated"] = true };
            if (t == typeof(IntPtr) || t == typeof(UIntPtr) || value is Pointer) return new JObject { ["status"] = "unavailable", ["reason"] = "Pointer has no verified element type, allocation bounds or ownership." };
            try
            {
                if (t.IsGenericType && t.GetGenericTypeDefinition() == typeof(BlobAssetReference<>)) return BlobReader.Read(value, offset, limit);
                if (Indexed(t) || value is Array)
                {
                    if (Native(t) && Property(value, "IsCreated") is bool created && !created) return new JObject { ["is_created"] = false };
                    var a = value as Array;
                    var length = a?.Length ?? Convert.ToInt32(Property(value, "Length"));
                    var items = new JArray(); var end = Math.Min(length, offset + limit);
                    for (var i = offset; i < end && budget > 0; i++) items.Add(Read(a != null ? a.GetValue(i) : t.GetProperty("Item").GetValue(value, new object[] { i }), 0, Math.Min(limit, 8), depth + 1, ref budget));
                    return new JObject { ["type"] = t.ToString(), ["length"] = length, ["offset"] = offset, ["next_offset"] = offset + items.Count < length ? new JValue(offset + items.Count) : JValue.CreateNull(), ["items"] = items };
                }
                if (t.IsGenericType && (t.GetGenericTypeDefinition().FullName == "Unity.Collections.NativeReference`1" || t.GetGenericTypeDefinition().FullName == "Colossal.Collections.NativeValue`1"))
                {
                    if (Property(value, "IsCreated") is bool created && !created) return new JObject { ["is_created"] = false };
                    return Read(Property(value, t.Name.StartsWith("NativeValue") ? "value" : "Value"), offset, limit, depth + 1, ref budget);
                }
                if (Native(t) && t.IsGenericType && new[] { "NativeQueue`1", "NativeHashMap`2", "NativeParallelHashMap`2", "NativeParallelMultiHashMap`2", "NativeHashSet`1", "NativeParallelHashSet`1" }.Contains(t.Name))
                {
                    if (Property(value, "IsCreated") is bool created && !created) return new JObject { ["is_created"] = false };
                    var method = t.GetMethod("GetEnumerator", Type.EmptyTypes);
                    if (method != null)
                    {
                        if (offset > 100000) return new JObject { ["status"] = "unavailable", ["reason"] = "Enumeration scan limit is 100000; narrow the source." };
                        var enumerator = method.Invoke(value, null); var et = enumerator.GetType();
                        var move = et.GetMethod("MoveNext"); var current = et.GetProperty("Current");
                        var items = new JArray(); var index = 0; var more = false;
                        try
                        {
                            while ((bool)move.Invoke(enumerator, null))
                            {
                                if (index++ < offset) continue;
                                if (items.Count >= limit || budget <= 0) { more = true; break; }
                                var entry = current.GetValue(enumerator);
                                if (entry != null && entry.GetType().GetProperty("Key") != null && entry.GetType().GetProperty("Value") != null)
                                    items.Add(new JObject { ["key"] = Read(Property(entry, "Key"), 0, 20, depth + 1, ref budget), ["value"] = Read(Property(entry, "Value"), 0, 20, depth + 1, ref budget) });
                                else items.Add(Read(entry, 0, 20, depth + 1, ref budget));
                            }
                        }
                        finally { (enumerator as IDisposable)?.Dispose(); }
                        return new JObject { ["type"] = t.ToString(), ["offset"] = offset, ["items"] = items, ["next_offset"] = more ? new JValue(offset + items.Count) : JValue.CreateNull(), ["consistency"] = "Live container enumeration; order may change between calls." };
                    }
                }
                if (Native(t) || t.Name.StartsWith("Blob") || t.Name.Contains("Unsafe")) return new JObject { ["status"] = "unavailable", ["type"] = t.ToString(), ["reason"] = "No validated read adapter for this allocation layout." };
                if (value is ComponentSystemBase || value is UnityEngine.Object || value is Delegate || t.Namespace?.StartsWith("Unity.Entities") == true && !t.IsValueType)
                    return new JObject { ["reference_type"] = t.FullName };
                if (!t.IsValueType && t.Namespace?.StartsWith("Game.") != true) return new JObject { ["reference_type"] = t.FullName };
                var result = new JObject(); var fields = Fields(t);
                foreach (var f in fields.Skip(offset).Take(limit)) { result[f.Name] = Read(f.GetValue(value), 0, 20, depth + 1, ref budget); if (budget <= 0) break; }
                if (offset + Math.Min(limit, fields.Length) < fields.Length) result["_pagination"] = new JObject { ["total_fields"] = fields.Length, ["next_offset"] = offset + limit };
                return result;
            }
            catch (Exception ex) { return new JObject { ["status"] = "unavailable", ["type"] = t.ToString(), ["error_type"] = (ex.InnerException ?? ex).GetType().Name }; }
        }
    }
}
