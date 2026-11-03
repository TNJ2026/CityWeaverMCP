using System;
using System.IO;
using Colossal.AssetPipeline.Importers;
using Colossal.IO.AssetDatabase;
using UnityEngine;
using TextureAsset = Colossal.IO.AssetDatabase.TextureAsset;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private const string RouteCachePath = "ImportedData/CityWeaver/RouteColorCache/v1";

        private static unsafe string RouteBaseKey(VehicleRouteColorMask mask)
        {
            fixed (Color32* pixels = mask.NeutralBase)
            using (var input = new UnmanagedMemoryStream((byte*)pixels, (long)mask.NeutralBase.Length * 4))
                return RouteColorCacheRules.Key(mask.Width, mask.Height, false, (int)mask.Wrap, (int)mask.Filter, true, input);
        }

        private static TextureAsset CachedRouteTexture(VehicleModelOperation op, VehicleRouteColorMask mask, bool neutralBase)
        {
            string key;
            if (neutralBase) key = RouteBaseKey(mask);
            else using (var input = new MemoryStream(mask.Weights ?? new byte[mask.Width * mask.Height], false))
                key = RouteColorCacheRules.Key(mask.Width, mask.Height, true, (int)mask.Wrap, (int)mask.Filter, false, input);
            var path = AssetDataPath.Create(RouteCachePath, "Texture_" + key);
            if (AssetDatabase.user.Exists<TextureAsset>(path, out var cached))
            {
                // Never overwrite an existing shared cache entry, even on corruption.
                ValidateSavedTexture(cached);
                if (cached.width != mask.Width || cached.height != mask.Height) throw new InvalidOperationException("Route colour cache dimensions do not match its content key.");
                op.RouteCacheHits++; return cached;
            }
            var image = new Texture2D(mask.Width, mask.Height, TextureFormat.RGBA32, false, !neutralBase) {
                wrapMode = mask.Wrap, filterMode = mask.Filter, anisoLevel = 1
            };
            try
            {
                var pixels = mask.NeutralBase;
                if (!neutralBase)
                {
                    pixels = new Color32[mask.Width * mask.Height];
                    for (int i = 0; i < pixels.Length; i++) pixels[i] = new Color32(mask.Weights?[i] ?? 0, 0, 0, 0);
                }
                image.SetPixels32(pixels); image.Apply(false, false);
                using (var data = new TextureImporter.Texture(neutralBase ? "RouteNeutralBase" : "RouteControlMask", null, image))
                {
                    data.ComputeMips(mask.Wrap == TextureWrapMode.Clamp, false);
                    var texture = AssetDatabase.user.AddAsset<TextureAsset, TextureImporter.ITexture>(path, data);
                    texture.Save(); ValidateSavedTexture(texture); op.RouteCacheWrites++; return texture;
                }
            }
            finally { UnityEngine.Object.Destroy(image); }
        }
    }
}
