using System;
using System.Collections.Generic;
using Game.Common;
using Game.Net;
using Game.Rendering;
using Game.Simulation;
using Newtonsoft.Json.Linq;
using Unity.Entities;
using Unity.Mathematics;
using UnityEngine;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private const int CameraImagePayloadLimit = 900000;

        private sealed class CameraFocusBounds
        {
            public bool HasValue;
            public float MinX = float.MaxValue, MinZ = float.MaxValue, MaxX = float.MinValue, MaxZ = float.MinValue;
            public void Add(float x, float z)
            {
                if (!math.isfinite(x) || !math.isfinite(z)) return;
                HasValue = true; MinX = math.min(MinX, x); MinZ = math.min(MinZ, z); MaxX = math.max(MaxX, x); MaxZ = math.max(MaxZ, z);
            }
        }

        private static JObject VectorJson(Vector3 value) => new JObject {
            ["x"] = value.x, ["y"] = value.y, ["z"] = value.z
        };

        private static int CameraInt(JObject args, string name, int fallback, int min, int max)
        {
            var token = args[name];
            if (token == null) return fallback;
            if (token.Type != JTokenType.Integer) throw new QueryException("INVALID_ARGUMENT", name + " must be an integer.");
            var value = (int)token;
            if (value < min || value > max) throw new QueryException("INVALID_ARGUMENT", name + " must be from " + min + " to " + max + ".");
            return value;
        }

        private static float CameraNumber(JObject args, string name, float fallback, float min, float max)
        {
            var token = args[name];
            if (token == null) return fallback;
            if ((token.Type != JTokenType.Integer && token.Type != JTokenType.Float) ||
                !float.TryParse(token.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value) ||
                !math.isfinite(value) || value < min || value > max)
                throw new QueryException("INVALID_ARGUMENT", name + " must be a finite number from " + min + " to " + max + ".");
            return value;
        }

        private static Camera ActiveGameCamera(World world)
        {
            var system = world.GetExistingSystemManaged<CameraUpdateSystem>();
            var camera = system?.activeCamera ?? Camera.main;
            if (camera == null || !camera.isActiveAndEnabled) throw new QueryException("CAMERA_UNAVAILABLE", "The active game camera is unavailable.");
            return camera;
        }

        private static bool PlaneHit(Ray ray, float height, float maxDistance, out Vector3 hit)
        {
            hit = default(Vector3);
            if (Mathf.Abs(ray.direction.y) < 0.00001f) return false;
            var distance = (height - ray.origin.y) / ray.direction.y;
            if (distance < 0 || distance > maxDistance) return false;
            hit = ray.origin + ray.direction * distance;
            return math.isfinite(hit.x) && math.isfinite(hit.y) && math.isfinite(hit.z);
        }

        private static bool TerrainHit(Ray ray, TerrainHeightData terrain, float maxDistance, out Vector3 hit)
        {
            hit = default(Vector3);
            if (!terrain.isCreated) return false;
            const int steps = 256;
            var previousDistance = 0f;
            var previousPoint = ray.origin;
            var previousHeight = TerrainUtils.SampleHeight(ref terrain, previousPoint);
            var previousDelta = previousPoint.y - previousHeight;
            if (!math.isfinite(previousDelta)) return false;
            for (var index = 1; index <= steps; index++)
            {
                var distance = maxDistance * index / steps;
                var point = ray.origin + ray.direction * distance;
                if (math.abs(point.x) > 7168 || math.abs(point.z) > 7168) break;
                var terrainHeight = TerrainUtils.SampleHeight(ref terrain, point);
                var delta = point.y - terrainHeight;
                if (!math.isfinite(delta)) break;
                if (delta <= 0 && previousDelta >= 0)
                {
                    var low = previousDistance;
                    var high = distance;
                    for (var iteration = 0; iteration < 18; iteration++)
                    {
                        var middle = (low + high) * .5f;
                        var sample = ray.origin + ray.direction * middle;
                        var sampleHeight = TerrainUtils.SampleHeight(ref terrain, sample);
                        if (sample.y - sampleHeight > 0) low = middle; else high = middle;
                    }
                    hit = ray.origin + ray.direction * ((low + high) * .5f);
                    hit.y = TerrainUtils.SampleHeight(ref terrain, hit);
                    return true;
                }
                previousDistance = distance;
                previousPoint = point;
                previousDelta = delta;
            }
            return false;
        }

        private static List<Vector2> PerimeterSamples(int edgeSamples)
        {
            var result = new List<Vector2>(edgeSamples * 4);
            for (var i = 0; i < edgeSamples; i++) result.Add(new Vector2((float)i / edgeSamples, 0));
            for (var i = 0; i < edgeSamples; i++) result.Add(new Vector2(1, (float)i / edgeSamples));
            for (var i = 0; i < edgeSamples; i++) result.Add(new Vector2(1f - (float)i / edgeSamples, 1));
            for (var i = 0; i < edgeSamples; i++) result.Add(new Vector2(0, 1f - (float)i / edgeSamples));
            return result;
        }

        private static bool IsPhysicalConstructionTool(string tool)
        {
            if (string.IsNullOrEmpty(tool)) return false;
            return tool.StartsWith("preview_road", StringComparison.Ordinal) ||
                tool == "preview_intersection_roundabout" || tool == "preview_terrain" ||
                tool.StartsWith("preview_building_", StringComparison.Ordinal) || tool == "preview_special_building_placement" ||
                tool == "preview_zoning" || tool.StartsWith("preview_district_", StringComparison.Ordinal) ||
                tool.StartsWith("preview_transport_facility_", StringComparison.Ordinal) || tool.StartsWith("preview_transport_track", StringComparison.Ordinal) ||
                tool.StartsWith("preview_utility_facility_", StringComparison.Ordinal) || tool.StartsWith("preview_utility_network", StringComparison.Ordinal) ||
                tool.StartsWith("preview_city_service_", StringComparison.Ordinal) || tool == "preview_building_area" ||
                tool == "place_landscape_objects" || tool == "plant_landscape_pattern" || tool == "create_water_source";
        }

        private void AddEntityFocusGeometry(string value, EntityManager em, CameraFocusBounds bounds)
        {
            var parts = (value ?? "").Split(':');
            if (parts.Length != 3 || parts[0] != m_Session || !int.TryParse(parts[1], out var index) || !int.TryParse(parts[2], out var version)) return;
            var entity = new Entity { Index = index, Version = version };
            if (!em.Exists(entity) || em.HasComponent<Deleted>(entity) || em.HasComponent<Game.Tools.Temp>(entity)) return;
            if (em.HasComponent<Game.Objects.Transform>(entity))
            {
                var position = em.GetComponentData<Game.Objects.Transform>(entity).m_Position;
                bounds.Add(position.x, position.z);
            }
            if (em.HasComponent<Node>(entity))
            {
                var position = em.GetComponentData<Node>(entity).m_Position;
                bounds.Add(position.x, position.z);
            }
            if (em.HasComponent<Curve>(entity))
            {
                var curve = em.GetComponentData<Curve>(entity).m_Bezier;
                bounds.Add(curve.a.x, curve.a.z); bounds.Add(curve.b.x, curve.b.z); bounds.Add(curve.c.x, curve.c.z); bounds.Add(curve.d.x, curve.d.z);
            }
        }

        private void CollectFocusGeometry(JToken token, EntityManager em, CameraFocusBounds bounds)
        {
            if (token is JObject obj)
            {
                if ((obj["x"]?.Type == JTokenType.Integer || obj["x"]?.Type == JTokenType.Float) &&
                    (obj["z"]?.Type == JTokenType.Integer || obj["z"]?.Type == JTokenType.Float)) bounds.Add((float)obj["x"], (float)obj["z"]);
                if (obj["min_x"] != null && obj["min_z"] != null && obj["max_x"] != null && obj["max_z"] != null)
                {
                    bounds.Add((float)obj["min_x"], (float)obj["min_z"]); bounds.Add((float)obj["max_x"], (float)obj["max_z"]);
                }
                foreach (var property in obj.Properties())
                {
                    if (property.Value.Type == JTokenType.String) AddEntityFocusGeometry((string)property.Value, em, bounds);
                    else CollectFocusGeometry(property.Value, em, bounds);
                }
            }
            else if (token is JArray array) foreach (var item in array) CollectFocusGeometry(item, em, bounds);
        }

        private void AddParameterizedExtent(JObject args, CameraFocusBounds bounds)
        {
            if (args["origin"] is JObject origin && origin["x"] != null && origin["z"] != null)
            {
                var x = (float)origin["x"]; var z = (float)origin["z"];
                var columns = (int?)args["columns"] ?? 0; var rows = (int?)args["rows"] ?? 0;
                var width = (float?)args["block_width_m"] ?? 0; var height = (float?)args["block_height_m"] ?? 0;
                if (columns > 0 && rows > 0 && width > 0 && height > 0) bounds.Add(x + columns * width, z + rows * height);
            }
            var radius = (float?)args["radius_m"] ?? 0;
            var center = args["center"] as JObject ?? args["origin"] as JObject;
            if (radius > 0 && center?["x"] != null && center["z"] != null)
            {
                var x = (float)center["x"]; var z = (float)center["z"];
                bounds.Add(x - radius, z - radius); bounds.Add(x + radius, z + radius);
            }
        }

        private static Vector3 FocusWorldPoint(CameraFocusBounds bounds, float y) => new Vector3((bounds.MinX + bounds.MaxX) * .5f, y, (bounds.MinZ + bounds.MaxZ) * .5f);

        private static bool BoundsVisible(Camera camera, CameraFocusBounds bounds, float y)
        {
            var points = new[] {
                new Vector3(bounds.MinX,y,bounds.MinZ), new Vector3(bounds.MaxX,y,bounds.MinZ),
                new Vector3(bounds.MaxX,y,bounds.MaxZ), new Vector3(bounds.MinX,y,bounds.MaxZ), FocusWorldPoint(bounds,y)
            };
            foreach (var point in points)
            {
                var viewport = camera.WorldToViewportPoint(point);
                if (viewport.z > 0 && viewport.x >= .06f && viewport.x <= .94f && viewport.y >= .08f && viewport.y <= .92f) return true;
            }
            return false;
        }

        private JObject ScheduleCameraFocus(CameraFocusBounds bounds, World world, float duration, float? requestedZoom = null, float? yaw = null, float? pitch = null)
        {
            if (!bounds.HasValue) throw new QueryException("CAMERA_FOCUS_TARGET_REQUIRED", "No world-space construction geometry was found.");
            var terrain = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            var center = new float3((bounds.MinX + bounds.MaxX) * .5f, 0, (bounds.MinZ + bounds.MaxZ) * .5f);
            if (terrain.isCreated) center.y = TerrainUtils.SampleHeight(ref terrain, center);
            var span = math.max(bounds.MaxX - bounds.MinX, bounds.MaxZ - bounds.MinZ);
            var zoom = requestedZoom ?? math.max(120f, span * 1.35f + 40f);
            var cameraSystem = world.GetExistingSystemManaged<CameraUpdateSystem>();
            var controller = cameraSystem?.gamePlayController;
            if (controller == null || !controller.controllerEnabled) throw new QueryException("GAMEPLAY_CAMERA_UNAVAILABLE", "The gameplay camera controller is not active.");
            float2? angle = null;
            if (yaw.HasValue || pitch.HasValue) angle = new float2(yaw ?? controller.angle.x, pitch ?? controller.angle.y);
            var scheduled = world.GetOrCreateSystemManaged<McpCameraFocusSystem>().Begin(center, zoom, angle, duration);
            if (!scheduled) throw new QueryException("GAMEPLAY_CAMERA_UNAVAILABLE", "The gameplay camera controller is not active.");
            return new JObject {
                ["scheduled"] = true, ["smooth"] = true, ["duration_seconds"] = duration,
                ["target"] = new JObject { ["x"] = center.x, ["y"] = center.y, ["z"] = center.z }, ["target_zoom_m"] = zoom,
                ["bounds"] = new JObject { ["min_x"] = bounds.MinX, ["min_z"] = bounds.MinZ, ["max_x"] = bounds.MaxX, ["max_z"] = bounds.MaxZ }
            };
        }

        private JObject FocusCamera(JObject args, World world)
        {
            if (!(args["target"] is JObject target)) throw new QueryException("INVALID_ARGUMENT", "target must contain x and z world coordinates.");
            var width = CameraNumber(args, "width_m", 100, 1, 14336); var depth = CameraNumber(args, "depth_m", 100, 1, 14336);
            var bounds = new CameraFocusBounds(); var x = CameraNumber(target, "x", 0, -7168, 7168); var z = CameraNumber(target, "z", 0, -7168, 7168);
            bounds.Add(x - width * .5f, z - depth * .5f); bounds.Add(x + width * .5f, z + depth * .5f);
            var duration = CameraNumber(args, "duration_seconds", .8f, .05f, 5);
            float? zoom = args["zoom_m"] == null ? (float?)null : CameraNumber(args, "zoom_m", 120, 10, 20000);
            float? yaw = args["yaw_degrees"] == null ? (float?)null : CameraNumber(args, "yaw_degrees", 0, -180, 180);
            float? pitch = args["pitch_degrees"] == null ? (float?)null : CameraNumber(args, "pitch_degrees", -45, -90, 90);
            return ScheduleCameraFocus(bounds, world, duration, zoom, yaw, pitch);
        }

        private void MaybeAutoFocusConstruction(string tool, JObject args, World world)
        {
            if (!IsPhysicalConstructionTool(tool)) return;
            var bounds = new CameraFocusBounds();
            CollectFocusGeometry(args, world.EntityManager, bounds); AddParameterizedExtent(args, bounds);
            if (!bounds.HasValue) return;
            var terrain = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            var center = new float3((bounds.MinX + bounds.MaxX) * .5f, 0, (bounds.MinZ + bounds.MaxZ) * .5f);
            if (terrain.isCreated) center.y = TerrainUtils.SampleHeight(ref terrain, center);
            if (BoundsVisible(ActiveGameCamera(world), bounds, center.y)) return;
            try { ScheduleCameraFocus(bounds, world, .8f); }
            catch (QueryException ex) when (ex.Code == "GAMEPLAY_CAMERA_UNAVAILABLE") { Mod.log.Warn("Automatic construction focus skipped: " + ex.Message); }
        }

        private JObject GetCameraView(JObject args, World world)
        {
            var camera = ActiveGameCamera(world);
            var edgeSamples = CameraInt(args, "edge_samples", 4, 1, 16);
            var surfaceMode = ((string)args["surface_mode"] ?? "terrain").ToLowerInvariant();
            if (surfaceMode != "terrain" && surfaceMode != "plane") throw new QueryException("INVALID_ARGUMENT", "surface_mode must be terrain or plane.");
            var planeHeight = CameraNumber(args, "plane_height_m", 0, -1024, 4096);
            var maxDistance = CameraNumber(args, "max_distance_m", math.min(camera.farClipPlane, 20000), 16, 30000);
            var terrain = default(TerrainHeightData);
            if (surfaceMode == "terrain") terrain = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (surfaceMode == "terrain" && !terrain.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");

            var polygon = new JArray();
            var minX = float.MaxValue; var minZ = float.MaxValue; var maxX = float.MinValue; var maxZ = float.MinValue;
            var terrainHits = 0; var planeHits = 0; var misses = 0;
            foreach (var viewport in PerimeterSamples(edgeSamples))
            {
                var ray = camera.ViewportPointToRay(new Vector3(viewport.x, viewport.y, 0));
                Vector3 hit; var source = surfaceMode;
                var found = surfaceMode == "terrain" ? TerrainHit(ray, terrain, maxDistance, out hit) : PlaneHit(ray, planeHeight, maxDistance, out hit);
                if (!found && surfaceMode == "terrain") { found = PlaneHit(ray, planeHeight, maxDistance, out hit); source = "fallback_plane"; }
                if (!found) { misses++; continue; }
                if (source == "terrain") terrainHits++; else planeHits++;
                minX = math.min(minX, hit.x); minZ = math.min(minZ, hit.z); maxX = math.max(maxX, hit.x); maxZ = math.max(maxZ, hit.z);
                polygon.Add(new JObject {
                    ["viewport"] = new JObject { ["x"] = viewport.x, ["y"] = viewport.y },
                    ["world"] = VectorJson(hit), ["source"] = source
                });
            }
            if (polygon.Count < 3) throw new QueryException("VIEWPORT_GROUND_INTERSECTION_FAILED", "Fewer than three screen-edge rays intersected terrain or the fallback plane. Tilt the camera toward the map or use surface_mode=plane with an appropriate plane_height_m.");

            var centerRay = camera.ViewportPointToRay(new Vector3(.5f, .5f, 0));
            Vector3 center;
            var centerSource = surfaceMode;
            var centerFound = surfaceMode == "terrain" ? TerrainHit(centerRay, terrain, maxDistance, out center) : PlaneHit(centerRay, planeHeight, maxDistance, out center);
            if (!centerFound && surfaceMode == "terrain") { centerFound = PlaneHit(centerRay, planeHeight, maxDistance, out center); centerSource = "fallback_plane"; }

            var transform = camera.transform;
            return new JObject {
                ["camera_name"] = camera.name,
                ["position"] = VectorJson(transform.position), ["rotation_euler_degrees"] = VectorJson(transform.rotation.eulerAngles),
                ["forward"] = VectorJson(transform.forward), ["up"] = VectorJson(transform.up), ["right"] = VectorJson(transform.right),
                ["projection"] = new JObject {
                    ["kind"] = camera.orthographic ? "orthographic" : "perspective", ["field_of_view_degrees"] = camera.fieldOfView,
                    ["orthographic_size"] = camera.orthographicSize, ["aspect"] = camera.aspect,
                    ["near_clip_m"] = camera.nearClipPlane, ["far_clip_m"] = camera.farClipPlane
                },
                ["viewport"] = new JObject {
                    ["pixel_width"] = camera.pixelWidth, ["pixel_height"] = camera.pixelHeight,
                    ["screen_width"] = Screen.width, ["screen_height"] = Screen.height,
                    ["rect"] = new JObject { ["x"] = camera.rect.x, ["y"] = camera.rect.y, ["width"] = camera.rect.width, ["height"] = camera.rect.height }
                },
                ["surface_mode"] = surfaceMode, ["fallback_plane_height_m"] = planeHeight, ["max_distance_m"] = maxDistance,
                ["visible_polygon"] = polygon,
                ["visible_bounds"] = new JObject { ["min_x"] = minX, ["min_z"] = minZ, ["max_x"] = maxX, ["max_z"] = maxZ },
                ["center_hit"] = centerFound ? new JObject { ["world"] = VectorJson(center), ["source"] = centerSource } : null,
                ["sampling"] = new JObject { ["edge_samples_per_side"] = edgeSamples, ["terrain_hits"] = terrainHits, ["plane_hits"] = planeHits, ["misses"] = misses },
                ["notes"] = "The polygon describes the game camera viewport projected onto live terrain, with a horizontal-plane fallback for rays that do not hit terrain. It is not an operating-system desktop capture and does not account for UI occlusion."
            };
        }

        private static byte[] CaptureCameraPng(Camera camera, bool includeUi, int width, int height)
        {
            Texture2D screen = null; Texture2D image = null; RenderTexture target = null;
            var previousActive = RenderTexture.active; var previousTarget = camera.targetTexture; var previousForce = camera.forceIntoRenderTexture;
            try
            {
                target = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
                if (includeUi)
                {
                    screen = ScreenCapture.CaptureScreenshotAsTexture();
                    if (screen == null) throw new QueryException("SCREENSHOT_FAILED", "Unity did not return a game-window framebuffer.");
                    Graphics.Blit(screen, target);
                }
                else
                {
                    camera.forceIntoRenderTexture = true; camera.targetTexture = target; camera.Render();
                }
                RenderTexture.active = target;
                image = new Texture2D(width, height, TextureFormat.RGB24, false);
                image.ReadPixels(new Rect(0, 0, width, height), 0, 0, false); image.Apply(false, false);
                var bytes = image.EncodeToPNG();
                if (bytes == null || bytes.Length == 0) throw new QueryException("SCREENSHOT_FAILED", "PNG encoding returned no data.");
                return bytes;
            }
            finally
            {
                camera.targetTexture = previousTarget; camera.forceIntoRenderTexture = previousForce; RenderTexture.active = previousActive;
                if (target != null) RenderTexture.ReleaseTemporary(target);
                if (screen != null) UnityEngine.Object.Destroy(screen);
                if (image != null) UnityEngine.Object.Destroy(image);
            }
        }

        private JObject CaptureGameView(JObject args, World world)
        {
            var camera = ActiveGameCamera(world);
            var includeUi = (bool?)args["include_ui"] ?? false;
            var maxWidth = CameraInt(args, "max_width", 960, 320, 1280);
            var maxHeight = CameraInt(args, "max_height", 720, 180, 720);
            var sourceWidth = math.max(1, camera.pixelWidth > 0 ? camera.pixelWidth : Screen.width);
            var sourceHeight = math.max(1, camera.pixelHeight > 0 ? camera.pixelHeight : Screen.height);
            var scale = math.min(1f, math.min((float)maxWidth / sourceWidth, (float)maxHeight / sourceHeight));
            var width = math.max(1, (int)math.round(sourceWidth * scale));
            var height = math.max(1, (int)math.round(sourceHeight * scale));
            byte[] png = null;
            for (var attempt = 0; attempt < 4; attempt++)
            {
                png = CaptureCameraPng(camera, includeUi, width, height);
                if (png.Length <= CameraImagePayloadLimit) break;
                width = math.max(320, (int)(width * .8f)); height = math.max(180, (int)(height * .8f));
            }
            if (png == null || png.Length > CameraImagePayloadLimit)
                throw new QueryException("SCREENSHOT_TOO_LARGE", "The PNG exceeds the safe bridge payload after automatic downscaling. Request a smaller max_width or max_height.");
            return new JObject {
                ["mime_type"] = "image/png", ["width"] = width, ["height"] = height, ["byte_length"] = png.Length,
                ["include_ui"] = includeUi, ["capture_scope"] = "game_window_only", ["source_pixel_width"] = sourceWidth, ["source_pixel_height"] = sourceHeight,
                ["base64"] = Convert.ToBase64String(png),
                ["notes"] = includeUi ? "Captured the current game framebuffer, including in-game UI where Unity exposes it." : "Rendered the active game camera without the screen-space UI."
            };
        }
    }
}
