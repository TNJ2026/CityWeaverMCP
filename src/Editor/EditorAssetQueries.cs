using System;
using System.Collections.Generic;
using System.Linq;
using Colossal.Mathematics;
using Game.Common;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed class EditorAssetOperation
    {
        public string Id = Guid.NewGuid().ToString("N"), Session, Request, Fingerprint, PrefabName, Kind, State = "queued", Error, CommitRequest;
        public Entity Prefab, Parent;
        public float3 Position;
        public quaternion Rotation;
        public float Elevation;
        public bool TransformPrefab, OutsideConnection, RoadSide, Floating, Hovering, CommitRequested, ApplyDispatched, CancelRequested;
        public long Cost, MaxCost;
        public DateTime Expires = DateTime.UtcNow.AddMinutes(5);
        public readonly List<float3> Points = new List<float3>();
        public readonly List<RoadSegmentPlan> Segments = new List<RoadSegmentPlan>();
        public readonly List<Entity> Results = new List<Entity>();
        public readonly JArray Errors = new JArray(), Warnings = new JArray();
        public bool Terminal => EditorAssetRules.Terminal(State);
        public string EntityId(Entity e) => e == Entity.Null ? null : Session + ":" + e.Index + ":" + e.Version;
        public JObject Json() => new JObject {
            ["operation_id"] = Id, ["request_id"] = Request, ["session_id"] = Session, ["prefab"] = PrefabName, ["kind"] = Kind,
            ["state"] = State, ["error"] = Error, ["errors"] = Errors.DeepClone(), ["warnings"] = Warnings.DeepClone(),
            ["cost"] = Cost, ["max_cost"] = MaxCost, ["expires_at_utc"] = Expires.ToString("O"), ["commit_dispatched"] = ApplyDispatched,
            ["can_commit"] = EditorAssetRules.CanCommit(State, CancelRequested, Expires, DateTime.UtcNow, Cost, long.MaxValue, Errors.Count, Warnings.Count),
            ["position"] = new JObject { ["x"] = Position.x, ["y"] = Position.y, ["z"] = Position.z },
            ["rotation"] = new JObject { ["x"] = Rotation.value.x, ["y"] = Rotation.value.y, ["z"] = Rotation.value.z, ["w"] = Rotation.value.w },
            ["point_count"] = Points.Count, ["segment_count"] = Segments.Count,
            ["parent_id"] = EntityId(Parent), ["outside_connection"] = OutsideConnection,
            ["created_entity_ids"] = new JArray(Results.Select(EntityId)),
            ["note"] = "Native editor preview/apply. Only completed plus permanent readback confirms placement; not simulation, external traffic or map saving."
        };
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string, EditorAssetOperation> m_EditorAssets = new Dictionary<string, EditorAssetOperation>();
        private readonly Dictionary<string, string> m_EditorAssetRequests = new Dictionary<string, string>();
        private void ResetEditorAssets()
        {
            var world=World.DefaultGameObjectInjectionWorld;
            if(world!=null && world.IsCreated) world.GetExistingSystemManaged<McpEditorAssetToolSystem>()?.AbortForLoading();
            m_EditorAssets.Clear(); m_EditorAssetRequests.Clear();
        }
        private static string EditorAssetKind(EntityManager em, Entity e, PrefabBase p)
        {
            if (p is TransformPrefab || em.HasComponent<AssetStampData>(e)) return "stamp";
            if (p is ObjectPrefab && em.HasComponent<Game.Prefabs.ObjectData>(e)) return "object";
            if (p is NetPrefab && em.HasComponent<NetGeometryData>(e) && em.HasComponent<PlaceableNetData>(e)) return "network";
            if (p is AreaPrefab && em.HasComponent<AreaData>(e)) return "area";
            return "data";
        }
        private Entity ResolveEditorAsset(JObject args, World world, out PrefabBase prefab)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>();
            if (args["prefab_id"] != null) {
                var e = ParseEntity((string)args["prefab_id"], em);
                if (!em.HasComponent<PrefabData>(e) || !ps.TryGetPrefab<PrefabBase>(e, out prefab)) throw new QueryException("UNKNOWN_EDITOR_ASSET", "Expected a loaded prefab ID.");
                if (args["prefab"] != null && (string)args["prefab"] != prefab.name) throw new QueryException("PREFAB_MISMATCH", "Prefab name and ID differ.");
                return e;
            }
            string name = (string)args["prefab"]; Entity match = Entity.Null; prefab = null;
            if (string.IsNullOrWhiteSpace(name)) throw new QueryException("INVALID_ARGUMENT", "Specify an exact prefab or prefab_id from list_editor_assets.");
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.Exclude<Deleted>()))
            using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) {
                if (!ps.TryGetPrefab<PrefabBase>(e, out var p) || p.name != name) continue;
                if (match != Entity.Null) throw new QueryException("AMBIGUOUS_EDITOR_ASSET", "Duplicate names: select the session-scoped prefab_id.");
                match = e; prefab = p;
            }
            if (match == Entity.Null) throw new QueryException("UNKNOWN_EDITOR_ASSET", "Use an exact loaded asset from list_editor_assets.");
            return match;
        }
        private JObject EditorAssetInfo(World world, Entity e, PrefabBase p)
        {
            var em = world.EntityManager; string kind = EditorAssetKind(em,e,p);
            var row = new JObject { ["prefab_id"] = EntityId(e), ["name"] = p.name, ["type"] = p.GetType().FullName, ["kind"] = kind,
                ["automatic_placement"] = kind != "data", ["placement_input"] = kind == "network" ? "points and optional curves" : kind == "area" ? "polygon points" : kind == "object" || kind == "stamp" ? "position and rotation_degrees" : null,
                ["support_status"] = kind == "data" ? "specialized_tool_or_non_placeable_data" : "native_preview_required",
                ["reason"] = kind == "data" ? "This prefab is not a standalone object, geometric network or polygon. Use its dedicated editor workflow or select_editor_asset to ask the native editor tool." : "Availability depends on native geometry, ownership, attachment and content validation; catalog listing is not a placement guarantee.",
                ["source"] = PrefabSource(world,e), ["locked"] = RoadOperation.IsLocked(em,e), ["outside_connection"] = em.HasComponent<OutsideConnectionData>(e) };
            if (em.HasComponent<OutsideConnectionData>(e)) row["outside_transfer_type"] = em.GetComponentData<OutsideConnectionData>(e).m_Type.ToString();
            if (em.HasComponent<TransportStopData>(e)) row["transport_type"] = em.GetComponentData<TransportStopData>(e).m_TransportType.ToString();
            if (em.HasComponent<PlaceableObjectData>(e)) { var place=em.GetComponentData<PlaceableObjectData>(e);row["placement_flags"] = place.m_Flags.ToString();row["placement_offset_y_m"]=place.m_PlacementOffset.y;row["height_default"]="native terrain/water/hovering calculation; omit y"; }
            if (em.HasComponent<NetGeometryData>(e)) row["width_m"] = em.GetComponentData<NetGeometryData>(e).m_DefaultWidth;
            if (em.HasComponent<NetData>(e)) row["connection_layers"] = em.GetComponentData<NetData>(e).m_ConnectLayers.ToString();
            return row;
        }
        private JObject ListEditorAssets(JObject args, World world)
        {
            RequireEditor(); string search = ((string)args["search"] ?? "").Trim(), kind = (string)args["kind"] ?? "all";
            if (!new[]{"all","object","stamp","network","area","data","outside_connection"}.Contains(kind)) throw new QueryException("INVALID_ARGUMENT", "Unknown asset kind.");
            int offset=ComponentInspector.Int(args,"offset",0,0,200000), limit=ComponentInspector.Int(args,"limit",30,1,100);
            var em=world.EntityManager; var ps=world.GetExistingSystemManaged<PrefabSystem>(); var matches=new List<Tuple<Entity,PrefabBase,string>>();
            using(var q=em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(),ComponentType.Exclude<Deleted>()))
            using(var es=q.ToEntityArray(Allocator.Temp)) foreach(var e in es) {
                if(!ps.TryGetPrefab<PrefabBase>(e,out var p)) continue;
                var k=EditorAssetKind(em,e,p);
                if(kind!="all" && (kind=="outside_connection" ? !em.HasComponent<OutsideConnectionData>(e) : kind!=k)) continue;
                if(search.Length>0 && p.name.IndexOf(search,StringComparison.OrdinalIgnoreCase)<0 && p.GetType().Name.IndexOf(search,StringComparison.OrdinalIgnoreCase)<0) continue;
                matches.Add(Tuple.Create(e,p,k));
            }
            matches=matches.OrderBy(v=>v.Item2.name,StringComparer.Ordinal).ThenBy(v=>v.Item1.Index).ToList();
            var heights=world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if(!heights.isCreated)throw new QueryException("TERRAIN_UNAVAILABLE","Live map bounds unavailable.");
            var bounds=TerrainUtils.GetBounds(ref heights);
            return new JObject { ["total"]=matches.Count,["offset"]=offset,["next_offset"]=offset+limit<matches.Count?(int?)(offset+limit):null,
                ["items"]=new JArray(matches.Skip(offset).Take(limit).Select(v=>EditorAssetInfo(world,v.Item1,v.Item2))),
                ["world_bounds"]=new JObject{["min_x"]=bounds.min.x,["max_x"]=bounds.max.x,["min_z"]=bounds.min.z,["max_z"]=bounds.max.z},
                ["note"]="All loaded prefab types are discoverable, including non-placeable data. No content downloads or progression unlock writes. Outside connections belong at native world bounds, not the inner buildable-tile boundary." };
        }
        private JObject GetEditorAsset(JObject args, World world)
        {
            RequireEditor(); var e=ResolveEditorAsset(args,world,out var p); return EditorAssetInfo(world,e,p);
        }
        private JObject SelectEditorAsset(JObject args, World world)
        {
            RequireEditor(); RequireEditorIdle(world);
            var e=ResolveEditorAsset(args,world,out var p); RequireEditorAssetContent(world,e);
            var tools=world.GetExistingSystemManaged<ToolSystem>(); bool selected=tools.ActivatePrefabTool(p);
            return new JObject{["selected"]=selected,["prefab_id"]=EntityId(e),["active_tool"]=tools.activeTool?.toolID,["placed"]=false,
                ["note"]=selected?"Native tool selected. No permanent placement performed.":"No native placement tool accepts this prefab; use its dedicated data/configuration editor."};
        }
        private void RequireEditorAssetContent(World world,Entity e)
        {
            var source=PrefabSource(world,e);
            if(source["content_available"]?.Type==JTokenType.Boolean && !(bool)source["content_available"])
                throw new QueryException("ASSET_CONTENT_UNAVAILABLE","Required content is unavailable; the editor will not unlock or download it.");
        }
        private static float EditorNumber(JToken value,string name,float fallback=0)
        {
            if(value==null) return fallback;
            if((value.Type!=JTokenType.Float && value.Type!=JTokenType.Integer) || !double.TryParse(value.ToString(),System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out var n) || !EditorAssetRules.Coordinate(n))
                throw new QueryException("INVALID_ARGUMENT",name+" must be a finite bounded number.");
            return (float)n;
        }
        private float3 EditorPoint(JToken value,World world,bool outside=false)
        {
            if(!(value is JObject p) || p["x"]==null || p["z"]==null) throw new QueryException("INVALID_ARGUMENT","A position requires x and z.");
            var heights=world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if(!heights.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE","Live CPU height data unavailable.");
            var bounds=TerrainUtils.GetBounds(ref heights);
            var v=new float3(EditorNumber(p["x"],"x"),0,EditorNumber(p["z"],"z"));
            if(v.x<bounds.min.x || v.x>bounds.max.x || v.z<bounds.min.z || v.z>bounds.max.z) throw new QueryException("OUTSIDE_MAP","Position must lie within native terrain bounds.");
            if(outside && math.min(math.min(math.abs(v.x-bounds.min.x),math.abs(v.x-bounds.max.x)),math.min(math.abs(v.z-bounds.min.z),math.abs(v.z-bounds.max.z)))>1f)
                throw new QueryException("OUTSIDE_CONNECTION_BOUNDARY_REQUIRED","Place outside connections at world bounds from list_editor_assets, not the buildable boundary.");
            v.y=p["y"]==null?TerrainUtils.SampleHeight(ref heights,v):EditorNumber(p["y"],"y");
            return v;
        }
        private JObject PreviewEditorAsset(JObject args,World world)
        {
            RequireEditor(); string request=RequestKey(args); var copy=(JObject)args.DeepClone();copy.Remove("request_id");string fingerprint=copy.ToString(Formatting.None);
            if(m_EditorAssetRequests.TryGetValue(request,out var previous)) {
                var old=m_EditorAssets[previous]; if(old.Fingerprint!=fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT","Request already belongs to different asset placement."); return old.Json();
            }
            RequireEditorIdle(world);
            if(m_EditorAssets.Count>=4096) throw new QueryException("EDITOR_OPERATION_LIMIT","This session has reached its asset journal limit.");
            var prefab=ResolveEditorAsset(args,world,out var p);RequireEditorAssetContent(world,prefab);var em=world.EntityManager;
            string kind=EditorAssetKind(em,prefab,p);
            if(kind=="data") throw new QueryException("ASSET_NOT_AUTOMATICALLY_PLACEABLE","Use the catalog's dedicated workflow or select_editor_asset; this is not a geometric placement asset.");
            var op=new EditorAssetOperation{Session=m_Session,Request=request,Fingerprint=fingerprint,Prefab=prefab,PrefabName=p.name,Kind=kind,TransformPrefab=p is TransformPrefab,OutsideConnection=em.HasComponent<OutsideConnectionData>(prefab)};
            if(args["parent_id"]!=null) {
                op.Parent=ParseEntity((string)args["parent_id"],em);
                if(em.HasComponent<Temp>(op.Parent)||em.HasComponent<Deleted>(op.Parent)||em.HasComponent<PrefabData>(op.Parent)) throw new QueryException("INVALID_PARENT","Parent must be a permanent placed entity.");
            }
            if(kind=="object" || kind=="stamp") {
                if(args["points"]!=null || args["curves"]!=null) throw new QueryException("INVALID_ARGUMENT","Object placement requires position, not points.");
                op.Position=EditorPoint(args["position"],world,op.OutsideConnection);
                float angle=EditorNumber(args["rotation_degrees"],"rotation_degrees"); if(math.abs(angle)>360) throw new QueryException("INVALID_ARGUMENT","Rotation must be -360..360 degrees.");
                op.Rotation=quaternion.RotateY(math.radians(angle));
                var heights=world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
                if(op.OutsideConnection && args["rotation_degrees"]==null) {
                    var bounds=TerrainUtils.GetBounds(ref heights);
                    float dx=math.abs(op.Position.x-bounds.min.x)<=1?-1:math.abs(op.Position.x-bounds.max.x)<=1?1:0;
                    float dz=math.abs(op.Position.z-bounds.min.z)<=1?-1:math.abs(op.Position.z-bounds.max.z)<=1?1:0;
                    op.Rotation=quaternion.LookRotationSafe(new float3(dx,0,dz),math.up());
                }
                float terrainReference=TerrainUtils.SampleHeight(ref heights,op.Position);
                op.Elevation=args["position"]?["y"]==null?0:op.Position.y-terrainReference;
                if(em.HasComponent<PlaceableObjectData>(prefab)) {
                    var place=em.GetComponentData<PlaceableObjectData>(prefab);op.Floating=(place.m_Flags&Game.Objects.PlacementFlags.Floating)!=0;
                    op.Hovering=(place.m_Flags&Game.Objects.PlacementFlags.Hovering)!=0;
                    bool shoreline=(place.m_Flags&Game.Objects.PlacementFlags.Shoreline)!=0;
                    op.RoadSide=(place.m_Flags&Game.Objects.PlacementFlags.RoadSide)!=0;
                    if(op.RoadSide && (op.Parent==Entity.Null||!em.HasComponent<Game.Net.Road>(op.Parent)||!em.HasComponent<Game.Net.Edge>(op.Parent))) throw new QueryException("ROAD_PARENT_REQUIRED","Roadside assets require the exact permanent road edge parent.");
                    if((place.m_Flags&Game.Objects.PlacementFlags.OwnerSide)!=0 && op.Parent==Entity.Null) throw new QueryException("ASSET_PARENT_REQUIRED","Owner-side assets require a permanent parent.");
                    if(op.RoadSide && em.HasComponent<BuildingData>(prefab))terrainReference=TerrainUtils.SampleHeight(ref heights,Game.Buildings.BuildingUtils.CalculateFrontPosition(new Game.Objects.Transform(op.Position,op.Rotation),em.GetComponentData<BuildingData>(prefab).m_LotSize.y));
                    if(op.Floating||op.Hovering||shoreline) {
                        var water=world.GetExistingSystemManaged<WaterSystem>().GetSurfaceData(out var deps);deps.Complete();
                        if(!water.isCreated) throw new QueryException("WATER_UNAVAILABLE","Water-relative asset requires live water.");
                        if((op.Floating||op.Hovering)&&args["position"]?["y"]!=null) throw new QueryException("INVALID_ARGUMENT","Floating/hovering asset height is native; omit y.");
                        if(args["position"]?["y"]==null)op.Position.y=(float)EditorAssetRules.PlacementHeight(terrainReference,WaterUtils.SampleHeight(ref water,ref heights,op.Position),WaterUtils.SampleDepth(ref water,op.Position),place.m_PlacementOffset.y,op.Hovering,op.Floating,shoreline);
                        op.Elevation=op.Floating||op.Hovering?FloatingPlacement.Elevation(op.Position.y,terrainReference):0;
                    } else if(args["position"]?["y"]==null) op.Position.y=terrainReference+place.m_PlacementOffset.y;
                }
            } else {
                if(args["position"]!=null || args["rotation_degrees"]!=null || (kind=="network"&&op.Parent!=Entity.Null)) throw new QueryException("INVALID_ARGUMENT","Use points for networks/areas; networks attach with node_id.");
                if(!(args["points"] is JArray points) || points.Count<(kind=="area"?3:2) || points.Count>(kind=="area"?128:16)) throw new QueryException("INVALID_ARGUMENT","Networks require 2..16 points; polygons 3..128 points.");
                foreach(var point in points)op.Points.Add(EditorPoint(point,world));
                if(kind=="area") {
                    if(args["curves"]!=null || points.Any(v=>v["node_id"]!=null)) throw new QueryException("INVALID_ARGUMENT","Areas require a polygon, without network node IDs or curves.");
                    if(!EditorAssetRules.SimplePolygon(op.Points.Select(v=>(double)v.x).ToArray(),op.Points.Select(v=>(double)v.z).ToArray())) throw new QueryException("INVALID_POLYGON","Polygon must be simple, nonzero and not duplicate its first point.");
                } else {
                    var curves=args["curves"] as JArray;if(args["curves"]!=null&&(curves==null||curves.Count!=points.Count-1))throw new QueryException("INVALID_ARGUMENT","curves must have one entry per segment.");
                    var heights=world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);var place=em.GetComponentData<PlaceableNetData>(prefab);var geom=em.GetComponentData<NetGeometryData>(prefab);
                    bool floating=(place.m_PlacementFlags&Game.Net.PlacementFlags.Floating)!=0;
                    var water=world.GetExistingSystemManaged<WaterSystem>().GetSurfaceData(out var waterDeps);waterDeps.Complete();
                    if(floating&&!water.isCreated)throw new QueryException("WATER_UNAVAILABLE","Floating networks require live water.");
                    var nodes=new List<Entity>();var elevations=new List<float>();
                    for(int i=0;i<points.Count;i++) {
                        Entity node=Entity.Null;var pos=op.Points[i];
                        if(points[i]["node_id"]!=null) {
                            node=ParseEntity((string)points[i]["node_id"],em);
                            if(!em.HasComponent<Game.Net.Node>(node)||em.HasComponent<Temp>(node)||em.HasComponent<Deleted>(node)||!em.HasBuffer<Game.Net.ConnectedEdge>(node))throw new QueryException("INVALID_ENDPOINT","Expected permanent network node.");
                            var live=em.GetComponentData<Game.Net.Node>(node).m_Position;if(math.distance(pos.xz,live.xz)>8)throw new QueryException("INVALID_ENDPOINT","Node is more than 8m from requested point.");
                            pos=live;op.Points[i]=live;
                        }
                        if(floating && node==Entity.Null){if(points[i]["y"]!=null)throw new QueryException("INVALID_ARGUMENT","Floating network heights use the water surface; omit y.");pos.y=WaterUtils.SampleHeight(ref water,ref heights,pos);op.Points[i]=pos;}
                        float elevation=floating?0:pos.y-TerrainUtils.SampleHeight(ref heights,pos);
                        if(elevation<place.m_ElevationRange.min-.25f || elevation>place.m_ElevationRange.max+.25f)throw new QueryException("INVALID_ELEVATION","Outside prefab elevation range.");
                        nodes.Add(node);elevations.Add(elevation);
                    }
                    for(int i=0;i+1<points.Count;i++) {
                        var a=op.Points[i];var d=op.Points[i+1];var curve=Game.Net.NetUtils.StraightCurve(a,d);
                        if(curves?[i] is JObject shape) {
                            var mode=(string)shape["mode"];
                            if(mode=="cubic")curve=new Bezier4x3(a,CurveControl(shape["control_1"] as JObject,"control_1",math.lerp(a.y,d.y,1f/3)),CurveControl(shape["control_2"] as JObject,"control_2",math.lerp(a.y,d.y,2f/3)),d);
                            else if(mode=="quadratic") {var c=CurveControl(shape["control"] as JObject,"control",(a.y+d.y)/2);curve=new Bezier4x3(a,a+(c-a)*2/3,d+(c-d)*2/3,d);}
                            else throw new QueryException("INVALID_ARGUMENT","Unknown curve mode.");
                        }
                        float length=MathUtils.Length(curve);if(!math.isfinite(length)||length<16||length>256)throw new QueryException("INVALID_NETWORK_LENGTH","Each generic network segment must be 16..256 metres.");
                        var prev=curve.a;for(int j=1;j<=32;j++){var v=MathUtils.Position(curve,j/32f);if(!math.all(math.isfinite(v))||math.abs(v.y-prev.y)/math.max(.01f,math.distance(v.xz,prev.xz))>math.max(.01f,geom.m_MaxSlopeSteepness))throw new QueryException("STEEP_SLOPE","Curve exceeds native prefab slope.");prev=v;}
                        if(em.HasComponent<WaterwayData>(prefab))ValidateWaterwayCurve(curve,prefab,world,4f);
                        op.Segments.Add(new RoadSegmentPlan{Start=a,End=d,StartTarget=nodes[i],EndTarget=nodes[i+1],StartElevation=elevations[i],EndElevation=elevations[i+1],Curve=curve});
                    }
                }
            }
            world.GetOrCreateSystemManaged<McpEditorAssetToolSystem>().Begin(op);
            m_EditorAssets.Add(op.Id,op);m_EditorAssetRequests.Add(request,op.Id);return op.Json();
        }
        private EditorAssetOperation EditorAssetOperationById(JObject args)
        {
            RequireEditor();if(!m_EditorAssets.TryGetValue((string)args["operation_id"]??"",out var op)||op.Session!=m_Session)throw new QueryException("EDITOR_ASSET_OPERATION_NOT_FOUND","Unknown operation in this map session.");return op;
        }
        private JObject ApplyEditorAsset(JObject args,World world)
        {
            var op=EditorAssetOperationById(args);var request=RequestKey(args);long ceiling=ComponentInspector.Int(args,"max_cost",-1,0,10000000);
            if(ceiling<0)throw new QueryException("INVALID_ARGUMENT","max_cost is required.");
            if(op.CommitRequest!=null){if(op.CommitRequest!=request||op.MaxCost!=ceiling)throw new QueryException("IDEMPOTENCY_CONFLICT","Poll original committed operation.");return op.Json();}
            RequirePaused(world); RequireEditorAssetContent(world,op.Prefab);
            if(world.EntityManager.HasComponent<WaterwayData>(op.Prefab))foreach(var segment in op.Segments)ValidateWaterwayCurve(segment.Curve,op.Prefab,world,4f);
            if(!EditorAssetRules.CanCommit(op.State,op.CancelRequested,op.Expires,DateTime.UtcNow,op.Cost,ceiling,op.Errors.Count,op.Warnings.Count))throw new QueryException("EDITOR_ASSET_NOT_READY","Require valid unexpired preview and sufficient cost ceiling.");
            op.CommitRequest=request;op.MaxCost=ceiling;op.CommitRequested=true;op.State="commit_queued";return op.Json();
        }
        private JObject CancelEditorAsset(JObject args)
        {
            var op=EditorAssetOperationById(args);if(op.ApplyDispatched)throw new QueryException("ALREADY_COMMITTED","Read permanent outcome; cannot cancel dispatched apply.");if(!op.Terminal)op.CancelRequested=true;return op.Json();
        }
    }
}
