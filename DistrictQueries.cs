using System;
using System.Collections.Generic;
using System.Linq;
using Colossal.Entities;
using Game.Areas;
using Game.Common;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CitiesSkylines2Mod
{
    public sealed class DistrictOperation
    {
        public string Id = Guid.NewGuid().ToString("N"), Session, RequestId, Fingerprint, Type, State = "queued", Error, Name;
        public Entity Prefab, Target, Result;
        public bool NameApplied;
        public readonly List<float3> Points = new List<float3>();
        public readonly List<float3> OriginalPoints = new List<float3>();
        public bool CommitRequested, CancelRequested, ApplyDispatched;
        public DateTime Created = DateTime.UtcNow, Expires = DateTime.UtcNow.AddMinutes(5);
        public JArray Errors = new JArray(), Warnings = new JArray();
        public bool Terminal => State == "completed" || State == "failed" || State == "cancelled" || State == "expired" || State == "outcome_unknown";
        public string EntityId(Entity e) => e == Entity.Null ? null : Session + ":" + e.Index + ":" + e.Version;
        public JObject Json() => new JObject {
            ["operation_id"] = Id, ["session_id"] = Session, ["request_id"] = RequestId, ["state"] = State,
            ["operation_type"] = Type, ["target_district_id"] = EntityId(Target), ["result_district_id"] = EntityId(Result),
            ["name"] = Name, ["point_count"] = Points.Count, ["surface_area_m2"] = Points.Count >= 3 ? GameQueryService.PolygonArea(Points) : 0,
            ["boundary"] = new JArray(Points.Select(GameQueryService.PointJson)), ["errors"] = Errors, ["warnings"] = Warnings,
            ["error"] = Error, ["can_commit"] = State == "preview_ready", ["expires_at_utc"] = Expires.ToString("O")
        };
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string, DistrictOperation> m_DistrictOperations = new Dictionary<string, DistrictOperation>();
        private readonly Dictionary<string, string> m_DistrictRequestIds = new Dictionary<string, string>();
        private void ResetDistrictOperations() { m_DistrictOperations.Clear(); m_DistrictRequestIds.Clear(); }

        internal static JObject PointJson(float3 p) => new JObject { ["x"] = p.x, ["y"] = p.y, ["z"] = p.z };
        internal static float PolygonArea(IList<float3> p) { double a = 0; for (int i = 0; i < p.Count; i++) { var x = p[i]; var y = p[(i + 1) % p.Count]; a += (double)x.x * y.z - (double)y.x * x.z; } return (float)Math.Abs(a * .5); }
        private static float Cross(float2 a, float2 b, float2 c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
        private static bool SegmentsCross(float2 a, float2 b, float2 c, float2 d) => Cross(a,b,c)*Cross(a,b,d) < 0 && Cross(c,d,a)*Cross(c,d,b) < 0;
        private static void ValidatePolygon(List<float3> points)
        {
            if (points.Count < 3 || points.Count > 64) throw new QueryException("INVALID_ARGUMENT", "boundary must contain 3..64 points.");
            for (int i=0;i<points.Count;i++) {
                if (!math.all(math.isfinite(points[i])) || math.any(math.abs(points[i].xz) > 7168)) throw new QueryException("INVALID_ARGUMENT", "boundary coordinates must be finite and inside the playable coordinate range.");
                if (math.distance(points[i].xz, points[(i+1)%points.Count].xz) < 4) throw new QueryException("DISTRICT_EDGE_TOO_SHORT", "Adjacent district points must be at least 4 metres apart.");
            }
            if (PolygonArea(points) < 100) throw new QueryException("DISTRICT_TOO_SMALL", "District surface area must be at least 100 square metres.");
            for (int i=0;i<points.Count;i++) for (int j=i+1;j<points.Count;j++) {
                if (j==i || j==(i+1)%points.Count || i==(j+1)%points.Count) continue;
                if (SegmentsCross(points[i].xz, points[(i+1)%points.Count].xz, points[j].xz, points[(j+1)%points.Count].xz)) throw new QueryException("DISTRICT_SELF_INTERSECTION", "District boundary must not self-intersect.");
            }
        }
        private List<float3> ParseBoundary(JArray array)
        {
            if (array == null) throw new QueryException("INVALID_ARGUMENT", "boundary is required."); var result = new List<float3>();
            foreach (var t in array) { float x=(float)t["x"], z=(float)t["z"], y=(float?)t["y"] ?? 0; result.Add(new float3(x,y,z)); }
            if (result.Count > 3 && math.distance(result[0].xz, result[result.Count-1].xz) < .01f) result.RemoveAt(result.Count-1);
            ValidatePolygon(result); return result;
        }
        private static bool PermanentDistrict(EntityManager em, Entity e) => em.Exists(e) && em.HasComponent<District>(e) && em.HasBuffer<Game.Areas.Node>(e) && !em.HasComponent<Temp>(e) && !em.HasComponent<Deleted>(e);
        private Entity ResolveDistrict(JObject args, World world)
        {
            var e=ParseEntity((string)args["district_id"], world.EntityManager); if (!PermanentDistrict(world.EntityManager,e)) throw new QueryException("DISTRICT_NOT_FOUND", "district_id is not a permanent district in this city session."); return e;
        }
        private List<float3> ReadDistrictPoints(EntityManager em, Entity e) { var r=new List<float3>(); var b=em.GetBuffer<Game.Areas.Node>(e,true); for(int i=0;i<b.Length;i++) r.Add(b[i].m_Position); return r; }
        private string CustomName(World world, Entity e) { string n=null; world.GetExistingSystemManaged<Game.UI.NameSystem>()?.TryGetCustomName(e,out n); return n; }
        private JObject DistrictRow(World world, Entity e, bool boundary)
        {
            var em=world.EntityManager; var points=ReadDistrictPoints(em,e); var row=new JObject { ["district_id"]=m_Session+":"+e.Index+":"+e.Version, ["custom_name"]=CustomName(world,e), ["point_count"]=points.Count, ["surface_area_m2"]=em.HasComponent<Geometry>(e)?em.GetComponentData<Geometry>(e).m_SurfaceArea:PolygonArea(points), ["option_mask"]=em.GetComponentData<District>(e).m_OptionMask };
            if (em.HasComponent<Geometry>(e)) { var g=em.GetComponentData<Geometry>(e); row["center"]=PointJson(g.m_CenterPosition); row["bounds"]=new JObject{{"min",PointJson(g.m_Bounds.min)},{"max",PointJson(g.m_Bounds.max)}}; }
            if (boundary) row["boundary"]=new JArray(points.Select(PointJson));
            if (em.HasBuffer<Game.Policies.Policy>(e)) row["policies"]=new JArray(ReadPolicies(world,e));
            return row;
        }
        private JObject ListDistricts(JObject args, World world)
        {
            var rows=new List<JObject>(); using(var q=world.EntityManager.CreateEntityQuery(ComponentType.ReadOnly<District>(),ComponentType.ReadOnly<Game.Areas.Node>(),ComponentType.Exclude<Temp>(),ComponentType.Exclude<Deleted>())) using(var es=q.ToEntityArray(Allocator.Temp)) foreach(var e in es) rows.Add(DistrictRow(world,e,false));
            rows.Sort((a,b)=>string.CompareOrdinal((string)a["district_id"],(string)b["district_id"])); return new JObject{{"total",rows.Count},{"items",new JArray(rows)}};
        }
        private JObject GetDistrict(JObject args, World world) => DistrictRow(world,ResolveDistrict(args,world),true);
        private static bool Contains(IList<float3> p,float2 v) { bool inside=false; for(int i=0,j=p.Count-1;i<p.Count;j=i++) { var a=p[i].xz;var b=p[j].xz;if(((a.y>v.y)!=(b.y>v.y))&&(v.x<(b.x-a.x)*(v.y-a.y)/(b.y-a.y)+a.x))inside=!inside;}return inside; }
        private JObject FindDistrictAt(JObject args, World world)
        {
            float2 p=new float2((float)args["x"],(float)args["z"]); JObject found=null; using(var q=world.EntityManager.CreateEntityQuery(ComponentType.ReadOnly<District>(),ComponentType.ReadOnly<Game.Areas.Node>(),ComponentType.Exclude<Temp>(),ComponentType.Exclude<Deleted>())) using(var es=q.ToEntityArray(Allocator.Temp)) foreach(var e in es) if(Contains(ReadDistrictPoints(world.EntityManager,e),p)){found=DistrictRow(world,e,false);break;}
            return new JObject{{"position",new JObject{{"x",p.x},{"z",p.y}}},{"found",found!=null},{"district",found}};
        }
        private IEnumerable<JObject> ReadPolicies(World world,Entity district)
        {
            var em=world.EntityManager; var prefabs=world.GetExistingSystemManaged<PrefabSystem>(); DynamicBuffer<Game.Policies.Policy> current=default; bool hc=em.TryGetBuffer<Game.Policies.Policy>(district,true,out current);
            using(var q=em.CreateEntityQuery(ComponentType.ReadOnly<PolicyData>())) using(var es=q.ToEntityArray(Allocator.Temp)) foreach(var p in es) {
                bool applies=em.HasComponent<DistrictOptionData>(p)||em.HasBuffer<DistrictModifierData>(p); if(!applies||!prefabs.TryGetPrefab<PrefabBase>(p,out var prefab))continue;
                bool active=false;float adjustment=em.HasComponent<PolicySliderData>(p)?em.GetComponentData<PolicySliderData>(p).m_Default:0; if(hc)for(int i=0;i<current.Length;i++)if(current[i].m_Policy==p){active=(current[i].m_Flags&Game.Policies.PolicyFlags.Active)!=0;adjustment=current[i].m_Adjustment;break;}
                var row=new JObject{{"name",prefab.name},{"active",active},{"adjustment",adjustment},{"locked",RoadOperation.IsLocked(em,p)}}; if(em.HasComponent<DistrictOptionData>(p))row["option_mask"]=em.GetComponentData<DistrictOptionData>(p).m_OptionMask;
                if(em.HasComponent<PolicySliderData>(p)){var s=em.GetComponentData<PolicySliderData>(p);row["slider"]=new JObject{{"min",s.m_Range.min},{"max",s.m_Range.max},{"default",s.m_Default},{"step",s.m_Step},{"unit",s.m_Unit}};} yield return row;
            }
        }
        private JObject ListDistrictPolicies(JObject args,World world){var d=ResolveDistrict(args,world);return new JObject{{"district_id",m_Session+":"+d.Index+":"+d.Version},{"items",new JArray(ReadPolicies(world,d).OrderBy(x=>(string)x["name"]))}};}
        private JObject SetDistrictPolicy(JObject args,World world)
        {
            if(world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed!=0)throw new QueryException("CITY_MUST_BE_PAUSED","Pause the city before changing district policy."); var d=ResolveDistrict(args,world);var em=world.EntityManager;string wanted=((string)args["policy"]??"").Trim();Entity selected=Entity.Null;PrefabBase pf=null;
            using(var q=em.CreateEntityQuery(ComponentType.ReadOnly<PolicyData>()))using(var es=q.ToEntityArray(Allocator.Temp))foreach(var p in es)if((em.HasComponent<DistrictOptionData>(p)||em.HasBuffer<DistrictModifierData>(p))&&world.GetExistingSystemManaged<PrefabSystem>().TryGetPrefab<PrefabBase>(p,out var x)&&string.Equals(x.name,wanted,StringComparison.OrdinalIgnoreCase)){selected=p;pf=x;break;}
            if(selected==Entity.Null)throw new QueryException("DISTRICT_POLICY_NOT_FOUND","Use an exact name from list_district_policies.");if(RoadOperation.IsLocked(em,selected))throw new QueryException("DISTRICT_POLICY_LOCKED","The selected district policy is locked.");bool active=(bool)args["active"];float adjustment=(float?)args["adjustment"]??(em.HasComponent<PolicySliderData>(selected)?em.GetComponentData<PolicySliderData>(selected).m_Default:0);
            if(em.HasComponent<PolicySliderData>(selected)){var s=em.GetComponentData<PolicySliderData>(selected);if(adjustment<s.m_Range.min||adjustment>s.m_Range.max)throw new QueryException("INVALID_ARGUMENT","adjustment is outside the policy slider range.");} else if(math.abs(adjustment)>.0001f)throw new QueryException("INVALID_ARGUMENT","This policy has no adjustment slider.");
            world.GetOrCreateSystemManaged<Game.UI.InGame.PoliciesUISystem>().SetPolicy(d,selected,active,adjustment);return new JObject{{"district_id",m_Session+":"+d.Index+":"+d.Version},{"policy",pf.name},{"requested_active",active},{"requested_adjustment",adjustment},{"change_queued",true}};
        }
        private JObject SetDistrictName(JObject args,World world){var d=ResolveDistrict(args,world);string n=((string)args["name"]??"").Trim();if(n.Length>100)throw new QueryException("INVALID_ARGUMENT","name must contain at most 100 characters.");world.GetOrCreateSystemManaged<Game.UI.NameSystem>().SetCustomName(d,n);return new JObject{{"district_id",m_Session+":"+d.Index+":"+d.Version},{"custom_name",string.IsNullOrWhiteSpace(n)?null:n},{"cleared",string.IsNullOrWhiteSpace(n)}};}

        private JObject GetDistrictCoverage(JObject args,World world)
        {
            var d=ResolveDistrict(args,world);int limit=ComponentInspector.Int(args,"limit",100,1,1000),total=0;var items=new JArray();var em=world.EntityManager;
            using(var q=em.CreateEntityQuery(ComponentType.ReadOnly<CurrentDistrict>(),ComponentType.Exclude<Temp>(),ComponentType.Exclude<Deleted>()))using(var es=q.ToEntityArray(Allocator.Temp))foreach(var e in es)if(em.GetComponentData<CurrentDistrict>(e).m_District==d){total++;if(items.Count<limit)items.Add(new JObject{{"entity_id",m_Session+":"+e.Index+":"+e.Version},{"building",em.HasComponent<Game.Buildings.Building>(e)},{"road",em.HasComponent<Game.Net.Road>(e)}});}
            return new JObject{{"district_id",m_Session+":"+d.Index+":"+d.Version},{"member_count",total},{"items_truncated",total>items.Count},{"items",items}};
        }
        private Entity ResolveService(JObject args,World world){var e=ParseEntity((string)args["service_id"],world.EntityManager);if(!world.EntityManager.Exists(e)||!world.EntityManager.HasBuffer<ServiceDistrict>(e)||world.EntityManager.HasComponent<Deleted>(e))throw new QueryException("SERVICE_DISTRICT_UNSUPPORTED","service_id must identify a service building that supports district coverage.");return e;}
        private JObject GetServiceDistricts(JObject args,World world){var s=ResolveService(args,world);var b=world.EntityManager.GetBuffer<ServiceDistrict>(s,true);var ids=new JArray();for(int i=0;i<b.Length;i++)ids.Add(m_Session+":"+b[i].m_District.Index+":"+b[i].m_District.Version);return new JObject{{"service_id",m_Session+":"+s.Index+":"+s.Version},{"covers_all_districts",b.Length==0},{"district_ids",ids}};}
        private JObject SetServiceDistricts(JObject args,World world)
        {
            if(world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed!=0)throw new QueryException("CITY_MUST_BE_PAUSED","Pause the city before changing service coverage.");var s=ResolveService(args,world);var ids=args["district_ids"] as JArray;if(ids==null)throw new QueryException("INVALID_ARGUMENT","district_ids is required; use [] for all districts.");var wanted=new List<Entity>();foreach(var id in ids){var d=ParseEntity((string)id,world.EntityManager);if(!PermanentDistrict(world.EntityManager,d))throw new QueryException("DISTRICT_NOT_FOUND","Every district_id must identify a permanent district.");if(wanted.Contains(d))throw new QueryException("DUPLICATE_DISTRICT","district_ids must not contain duplicates.");wanted.Add(d);}var b=world.EntityManager.GetBuffer<ServiceDistrict>(s);b.Clear();foreach(var d in wanted)b.Add(new ServiceDistrict(d));if(!world.EntityManager.HasComponent<Updated>(s))world.EntityManager.AddComponent<Updated>(s);return GetServiceDistricts(new JObject{{"service_id",m_Session+":"+s.Index+":"+s.Version}},world);
        }
        private Entity DefaultDistrictPrefab(EntityManager em){using(var q=em.CreateEntityQuery(ComponentType.ReadOnly<AreasConfigurationData>())){if(q.IsEmptyIgnoreFilter)throw new QueryException("DISTRICT_PREFAB_UNAVAILABLE","The default district prefab is unavailable.");return q.GetSingleton<AreasConfigurationData>().m_DefaultDistrictPrefab;}}
        private DistrictOperation PreviewDistrict(JObject args,World world,string type)
        {
            string key=RequestKey(args),fingerprint=type+":"+args.ToString(Formatting.None);if(m_DistrictRequestIds.TryGetValue(key,out var id)){var old=m_DistrictOperations[id];if(old.Fingerprint!=fingerprint)throw new QueryException("REQUEST_ID_CONFLICT","request_id was already used with different district arguments.");return old;}if(m_DistrictOperations.Count>=128)throw new QueryException("TOO_MANY_OPERATIONS","This city session already contains 128 district operations.");
            var op=new DistrictOperation{Session=m_Session,RequestId=key,Fingerprint=fingerprint,Type=type,Prefab=DefaultDistrictPrefab(world.EntityManager),Name=((string)args["name"]??"").Trim()};if(op.Name.Length>100)throw new QueryException("INVALID_ARGUMENT","name must contain at most 100 characters.");
            if(type=="create"||type=="boundary")op.Points.AddRange(ParseBoundary(args["boundary"] as JArray));if(type!="create"){op.Target=ResolveDistrict(args,world);op.OriginalPoints.AddRange(ReadDistrictPoints(world.EntityManager,op.Target));if(type=="delete")op.Points.AddRange(op.OriginalPoints);}
            m_DistrictOperations.Add(op.Id,op);m_DistrictRequestIds.Add(key,op.Id);if(type=="create")world.GetOrCreateSystemManaged<McpDistrictToolSystem>().Begin(op);else op.State="preview_ready";return op;
        }
        private DistrictOperation DistrictOperationById(JObject args){string id=(string)args["operation_id"];if(id==null||!m_DistrictOperations.TryGetValue(id,out var op))throw new QueryException("UNKNOWN_OPERATION","Unknown district operation for this city session.");return op;}
        private JObject GetDistrictOperation(JObject args,World world){var op=DistrictOperationById(args);if(op.State=="completed"&&!op.NameApplied&&op.Result!=Entity.Null&&!string.IsNullOrWhiteSpace(op.Name)){world.GetOrCreateSystemManaged<Game.UI.NameSystem>().SetCustomName(op.Result,op.Name);op.NameApplied=true;}return op.Json();}
        private JObject ApplyDistrict(JObject args,World world)
        {
            var op=DistrictOperationById(args);if(RequestKey(args)!=op.RequestId)throw new QueryException("REQUEST_ID_CONFLICT","Use the same request_id as the district preview.");if(op.State=="completed")return GetDistrictOperation(args,world);if(op.State!="preview_ready")throw new QueryException("INVALID_OPERATION_STATE","Only a preview_ready district operation can be applied.");if(world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed!=0)throw new QueryException("CITY_MUST_BE_PAUSED","Pause the city before applying a district operation.");
            if(op.Type=="create"){op.CommitRequested=true;return op.Json();}var em=world.EntityManager;if(!PermanentDistrict(em,op.Target))throw new QueryException("TARGET_CHANGED","The target district no longer exists.");var now=ReadDistrictPoints(em,op.Target);if(now.Count!=op.OriginalPoints.Count||now.Where((p,i)=>math.distance(p,op.OriginalPoints[i])>.01f).Any())throw new QueryException("DISTRICT_CONFLICT","The district boundary changed after preview; nothing was applied.");
            if(op.Type=="delete"){em.AddComponent<Deleted>(op.Target);op.Result=op.Target;op.State="completed";return op.Json();}
            var buffer=em.GetBuffer<Game.Areas.Node>(op.Target);try{var heights=world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);if(!heights.isCreated)throw new QueryException("TERRAIN_UNAVAILABLE","Terrain CPU heights are unavailable.");buffer.Clear();foreach(var p in op.Points){var placed=p;placed.y=TerrainUtils.SampleHeight(ref heights,p);buffer.Add(new Game.Areas.Node(placed,float.MinValue));}if(!em.HasComponent<Updated>(op.Target))em.AddComponent<Updated>(op.Target);op.Result=op.Target;op.State="completed";}catch(Exception e){buffer.Clear();foreach(var p in op.OriginalPoints)buffer.Add(new Game.Areas.Node(p,float.MinValue));op.State="failed";op.Error=e.GetType().Name+": "+e.Message;throw new QueryException("DISTRICT_APPLY_FAILED","Boundary write failed and the original nodes were restored.");}return op.Json();
        }
        private JObject CancelDistrict(JObject args){var op=DistrictOperationById(args);if(op.ApplyDispatched)throw new QueryException("APPLY_ALREADY_DISPATCHED","The native apply was already dispatched.");if(!op.Terminal)op.CancelRequested=true;return op.Json();}
    }
}
