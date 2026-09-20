import json,math
from pathlib import Path
b=json.loads(Path('artifacts/airport-survey-baseline.json').read_text(encoding='utf-8'));ts=b['tiles']['items'];bs=b['snapshot']['buildings'];houses=[v for v in bs if v['kind']=='residential'];roads=[]
for r in b['snapshot']['roads']:
 for k in range(11):
  t=k/10;u=1-t;c=r['curve'];roads.append(tuple(u**3*c['a'][a]+3*u*u*t*c['b'][a]+3*u*t*t*c['c'][a]+t**3*c['d'][a] for a in ['x','z']))
def tile(x,z):return next((t for t in ts if t['bounds']['min_x']<=x<=t['bounds']['max_x'] and t['bounds']['min_z']<=z<=t['bounds']['max_z']),None)
c=[]
for x in range(-2800,7001,200):
 for z in range(-3600,3201,200):
  for w,h,rotation in [(1136,376,0),(376,1136,90)]:
   tt=[tile(x+dx*w/2,z+dz*h/2) for dx in [-1,-.5,0,.5,1] for dz in [-1,-.5,0,.5,1]]
   if any(t is None for t in tt):continue
   if any(next((f['amount'] for f in t['features'] if f['feature']=='SurfaceWater'),0)>30000 for t in tt):continue
   def dist(v):p=v['position'];return math.hypot(max(abs(x-p['x'])-w/2-max(v['size_m'].values())/2,0),max(abs(z-p['z'])-h/2-max(v['size_m'].values())/2,0))
   dh=min(map(dist,houses));db=min(map(dist,bs));dr=min(math.hypot(max(abs(x-a)-w/2,0),max(abs(z-b)-h/2,0)) for a,b in roads)
   if dh<1000 or db<100 or dr>1600 or dr<60:continue
   c.append(dict(x=x,z=z,width=w,depth=h,rotation=rotation,residential_clearance_m=dh,building_clearance_m=db,road_distance_m=dr,score=min(dh,2000)*.3-dr))
c.sort(key=lambda a:a['score'],reverse=True);picked=[]
for p in c:
 if all(math.hypot(p['x']-v['x'],p['z']-v['z'])>550 for v in picked):picked.append(p)
 if len(picked)>=24:break
Path('artifacts/airport-candidates.json').write_text(json.dumps(picked),encoding='utf-8');print(json.dumps(picked))

