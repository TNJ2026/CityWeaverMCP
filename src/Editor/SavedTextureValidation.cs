using System;
using System.IO;
using Colossal.IO.AssetDatabase;
using UnityEngine;
using UnityEngine.Experimental.Rendering;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private static GraphicsFormat SavedTextureFormat(TextureAsset asset)
        {
            // Rediscovered TextureAssets leave metadata at its defaults until
            // ReadHeader runs. Read the small serialized header before creating
            // a GPU object; GraphicsFormat.None is not evidence of bad content.
            if (asset.format != GraphicsFormat.None) return asset.format;
            using (var reader = new BinaryReader(asset.GetReadStream()))
            {
                int version = reader.ReadUInt16();
                if (version < 1 || version > 5)
                    throw new QueryException("TEXTURE_HEADER_UNSUPPORTED", "Unsupported saved texture header version: " + version);
                int width = reader.ReadUInt16(), height = reader.ReadUInt16();
                int depth = version >= 4 ? reader.ReadUInt16() : 1;
                int mips = reader.ReadByte();
                if (width < 1 || height < 1 || depth < 1 || mips < 1)
                    throw new QueryException("TEXTURE_HEADER_INVALID", "Saved texture has invalid dimensions or mip count.");
                return version >= 3 ? (GraphicsFormat)reader.ReadByte()
                    : (GraphicsFormat)Enum.Parse(typeof(GraphicsFormat), reader.ReadString());
            }
        }

        private static void ValidateSavedTexture(TextureAsset asset)
        {
            if (!SystemInfo.IsFormatSupported(SavedTextureFormat(asset), FormatUsage.Sample))
                throw new QueryException("TEXTURE_GPU_FORMAT_UNSUPPORTED", "Saved texture cannot be sampled by the GPU; original material remains bound.");
            bool loaded = false;
            try
            {
                var texture = asset.Load(0); loaded = true;
                if (texture == null || texture.width < 1 || texture.height < 1)
                    throw new QueryException("TEXTURE_GPU_LOAD_FAILED", "Saved texture failed native loading; original material remains bound.");
            }
            finally { if (loaded) asset.Unload(); }
        }
    }
}
