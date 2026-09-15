using System;
using System.Reflection;
using System.Runtime.InteropServices;
using Newtonsoft.Json.Linq;
using Unity.Entities;
using Unity.Collections.LowLevel.Unsafe;

namespace CitiesSkylines2Mod
{
    public static class BlobReader
    {
        public static JToken Read(object value, int offset, int limit) => (JToken)typeof(BlobReader).GetMethod(nameof(ReadTyped), BindingFlags.Static | BindingFlags.NonPublic).MakeGenericMethod(value.GetType().GetGenericArguments()).Invoke(null, new object[] { value, offset, limit });
        private static unsafe JToken ReadTyped<T>(object value, int offset, int limit) where T : unmanaged
        {
            var blob = (BlobAssetReference<T>)value;
            if (!blob.IsCreated) return new JObject { ["is_created"] = false };
            // Resolve the installed Entities header layout rather than assuming offsets.
            var header = typeof(BlobAssetReference<>).Assembly.GetType("Unity.Entities.BlobAssetHeader", true);
            var size = Marshal.SizeOf(header);
            var lengthOffset = Marshal.OffsetOf(header, "Length").ToInt32();
            if (size != 32 || lengthOffset != 8) return new JObject { ["status"] = "unavailable", ["reason"] = "Unrecognized Entities BlobAssetHeader layout." };
            var root = (byte*)blob.GetUnsafePtr();
            var length = Marshal.ReadInt32((IntPtr)(root - size), lengthOffset);
            if (length < UnsafeUtility.SizeOf<T>() || length > 268435456) return new JObject { ["status"] = "unavailable", ["reason"] = "Invalid blob allocation length." };
            var count = Math.Max(0, Math.Min(limit, length - offset)); var bytes = new byte[count];
            if (count > 0) Marshal.Copy((IntPtr)(root + offset), bytes, 0, count);
            return new JObject { ["kind"] = "blob_payload", ["root_type"] = typeof(T).FullName, ["root_size_bytes"] = UnsafeUtility.SizeOf<T>(), ["length_bytes"] = length,
                ["offset"] = offset, ["next_offset"] = offset + count < length ? new JValue(offset + count) : JValue.CreateNull(), ["base64"] = Convert.ToBase64String(bytes),
                ["encoding"] = "Original allocation bytes. BlobArray/BlobPtr offsets are relative to their original field positions within this payload; this is not a decoded object." };
        }
    }
}
