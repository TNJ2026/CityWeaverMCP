import json,math
from pathlib import Path
b=json.loads(Path('artifacts/octagon-baseline.json').read_text());cat=json.loads(Path('artifacts/octagon-catalog.json').read_text());cx,cz,R=5600,2030,680
p=lambda r,a:{'x':round(cx+r*math.cos(a),6),'z':round(cz+r*math.sin(a),6)}
vertices=[p(R,i*math.pi/4) for i in range(8)]
roads=[]
def road(id,pts,w=16,prefab='Small Road',**kw):
 roads.append(dict(id=id,label=id,prefab=prefab,width_m=w,points=pts,level='surface',planning_status='conceptual',construction_status='planned',**kw))
for r in [80,200,360,520,680]:
 for i in range(8):
  a=p(r,i*math.pi/4);d=p(r,(i+1)*math.pi/4);n=math.ceil(math.dist([a['x'],a['z']],[d['x'],d['z']])/240)
  pts=[{'x':a['x']+(d['x']-a['x'])*j/n,'z':a['z']+(d['z']-a['z'])*j/n} for j in range(n+1)]
  road(f'ring-{r}-{i+1}',pts,24 if r in [80,680] else 16,'Medium Road' if r in [80,680] else 'Small Road')
for i in range(8):road(f'spoke-{i+1}',[p(r,i*math.pi/4) for r in [80,200,360,520,680]],24,'Medium Road')
kinds=['industrial','office','residential','residential','residential','service','commercial','office']
names=['① 东北工业与物流','② 北部办公与缓冲','③ 西北住宅','④ 西部住宅','⑤ 西南住宅','⑥ 南西公共服务','⑦ 南东商业门户','⑧ 东南办公']
zone_names={'industrial':'Industrial Manufacturing','office':'Office Low','residential':'NA Residential Medium Row','commercial':'NA Commercial Low'}
zones=[]
for i,k in enumerate(kinds):
 zones.append(dict(id=f'sector-{i+1}',label=names[i],kind=k,zone_type=zone_names.get(k),planning_status='land_use_reservation',polygon=[p(105,i*math.pi/4),p(655,i*math.pi/4),p(655,(i+1)*math.pi/4),p(105,(i+1)*math.pi/4)]))
services={x['name']:x for x in cat['services']};buildings=[]
for i,r,name,label in [(2,420,'ElementarySchool02','小学'),(3,420,'MedicalClinic02','社区诊所'),(4,420,'ElementarySchool02','小学'),(5,410,'HighSchool02','中学'),(5,245,'PoliceStation02','警务站'),(6,410,'PostOffice02','邮局'),(7,410,'FireHouse01','消防站'),(0,410,'FireHouse02','工业消防'),(4,245,'CityPark02','社区公园'),(2,245,'CityPark02','社区公园'),(1,410,'BicycleParkingHall01','自行车停放室')]:
 f=services[name];buildings.append(dict(id=f'facility-{len(buildings)+1}',label=label,prefab=name,position=p(r,(i+.5)*math.pi/4),size_m=f['size_m'],rotation_degrees=None,rotation_source='unresolved',placement_status='conceptual',construction_status='planned',category='city_service'))
# Exits are reserved corridors, not a fictitious native highway connection.
road('south-access-reservation',[p(680,1.5*math.pi),{'x':5600,'z':1260},{'x':5600,'z':1040},{'x':5960,'z':760},{'x':6320,'z':650}],24,'Medium Road',native_binding_status='unresolved',crossing_note='跨铁路需独立高架；高速立交需实时预设选址，不是平交接入')
road('freight-access-reservation',[vertices[0],{'x':6500,'z':2030},{'x':6500,'z':1600},{'x':6500,'z':1280},{'x':6500,'z':960},{'x':6500,'z':760}],24,'Medium Road',native_binding_status='unresolved',crossing_note='东侧物流外联走廊，跨铁路高架，接同一高速立交系统待预检')
plan={'grids':[],'grid_exceptions':[{'scope_id':'octagonal-town','road_ids':[r['id'] for r in roads],'reason_codes':['irregular_geometry'],'message':'用户指定正八角形外环及八条放射路，扇区和同心道路无法无损表示为轴对齐矩形网格。'}],'roads':roads,'zones':zones,'buildings':buildings,'tracks':[],'utilities':[]}
args={'bounds':{'min_x':4800,'min_z':600,'max_x':6620,'max_z':2800},'plan':plan,'include_existing':True,'include_water':True,'include_terrain':True,'water_cell_size_m':16,'terrain_cell_size_m':128,'render':{'format':'static_html','title':'奥本山 · 正八角城镇规划 V1','width':1600,'height':1100,'view':'combined'}}
for r in roads:
 r.pop('native_binding_status',None);r.pop('crossing_note',None)
for z in zones:
 z.pop('zone_type',None);z.pop('planning_status',None)
for f in buildings:f['size_m'].pop('y',None)
Path('plans/auburn-octagon-town.json').write_text(json.dumps(args,ensure_ascii=False,indent=2),encoding='utf-8')
# Read-only geometry checks; sample whole town and road footprints for ownership.
def inside(pt,poly):
 x,z=pt['x'],pt['z'];hit=False
 for a,d in zip(poly,poly[1:]+poly[:1]):
  if (a['z']>z)!=(d['z']>z) and x<(d['x']-a['x'])*(z-a['z'])/(d['z']-a['z'])+a['x']:hit=not hit
 return hit
owned=lambda q:any(t['bounds']['min_x']<=q['x']<=t['bounds']['max_x'] and t['bounds']['min_z']<=q['z']<=t['bounds']['max_z'] for t in b['tiles'])
checks=[{'x':x,'z':z} for x in range(4920,6281,20) for z in range(1350,2711,20) if inside({'x':x,'z':z},vertices)]
water=[c for c in b['water']['data']['cells'] if c['water'] and inside(c,vertices)]
heights=[t['height_m'] for t in b['terrain']['data']['items'] if inside(t,vertices)]
audit={'center':{'x':cx,'z':cz},'radius_m':R,'side_m':2*R*math.sin(math.pi/8),'area_m2':2*math.sqrt(2)*R*R,'vertices':vertices,'owned_samples':len(checks),'unowned_samples':sum(not owned(q) for q in checks),'water_sample_conflicts':len(water),'terrain_min_m':min(heights),'terrain_max_m':max(heights),'native_preview':False,'notes':['80米中心小八角环岛，八条放射路均接入中央节点','分区面是用途预留，不是逐格施工指令','外联走廊尚未绑定立交端口/竖向桥梁设计','工业扇区近中心留绿地及非污染配套，生产地块集中外侧','不承诺固定人口和财政结果']}
assert audit['unowned_samples']==0 and not water
Path('artifacts/octagon-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(audit,ensure_ascii=False))
