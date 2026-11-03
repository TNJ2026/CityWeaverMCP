using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace CityWeaver
{
    internal static class RouteColorCacheRules
    {
        // The content key deliberately excludes operation, city and vehicle IDs.
        // Sampling, colour space and mip generation are part of texture identity.
        internal static string Key(int width, int height, bool linear, int wrap, int filter, bool neutralBase, Stream pixels)
        {
            long length = (long)width * height * (neutralBase ? 4 : 1);
            if (width < 1 || height < 1 || (long)width * height > 16777216 || pixels == null ||
                !pixels.CanRead || !pixels.CanSeek || pixels.Length - pixels.Position != length)
                throw new ArgumentException("Invalid route colour texture key input.");
            using (var sha = SHA256.Create())
            {
                var header = Encoding.ASCII.GetBytes("CityWeaver.RouteColor.v1|" + width + "|" + height + "|" +
                    (linear ? "linear" : "srgb") + "|" + wrap + "|" + filter + "|" + (neutralBase ? "rgba" : "mask-r000") + "|mips|aniso1|");
                sha.TransformBlock(header, 0, header.Length, header, 0);
                var buffer = new byte[65536]; int count;
                while ((count = pixels.Read(buffer, 0, buffer.Length)) != 0) sha.TransformBlock(buffer, 0, count, buffer, 0);
                sha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
                return BitConverter.ToString(sha.Hash).Replace("-", "").ToLowerInvariant();
            }
        }
    }
}
