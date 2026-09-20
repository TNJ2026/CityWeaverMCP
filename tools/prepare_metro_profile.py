import json,math
routes=json.load(open('artifacts/auburn-metro-track-geometry.json'))
for r in routes:
 seg=r['segments']; n=len(seg); samples=r['samples']; bounds=[next(s for s in samples if s['i']==i and s['t']==0) for i in range(n)]+[samples[-1]]
 ds=[math.hypot(s['d']['x']-s['a']['x'],s['d']['z']-s['a']['z']) for s in seg]; dist=[0]
 for d in ds:dist.append(dist[-1]+d)
 y=[s['terrain']['height_m']-30 for s in bounds]
 if r.get('portal'):
  for i in range(n+1):
   if dist[i]<650:y[i]=r['a']['y']-min(30,max(0,dist[i]-75)*.05)
 y[0]=r['a']['y'];y[-1]=r['d']['y']
 for _ in range(20):
  for i in range(1,n):y[i]=min(max(y[i],y[i-1]-.055*ds[i-1]),y[i-1]+.055*ds[i-1])
  for i in range(n-1,0,-1):y[i]=min(max(y[i],y[i+1]-.055*ds[i]),y[i+1]+.055*ds[i])
 depths=[s['terrain']['height_m']-((1-s['t'])*y[s['i']]+s['t']*y[s['i']+1]) for s in samples]
 if not r.get('portal'):assert min(depths)>17 and max(depths)<48,(r['id'],min(depths),max(depths))
 r['profile']={'min_depth':min(depths),'max_depth':max(depths),'max_chord_grade':max(abs(y[i+1]-y[i])/ds[i] for i in range(n)),'y':y}
 r['points']=[{'x':b['x'],'z':b['z'],'elevation_m':y[i]-b['terrain']['height_m']} for i,b in enumerate(bounds)]
 for i,node in [(0,r['an']),(-1,r['dn'])]:r['points'][i].pop('elevation_m');r['points'][i]['node_id']=node
 print(r['id'],r['profile']['min_depth'],r['profile']['max_depth'],r['profile']['max_chord_grade'])
json.dump(routes,open('artifacts/auburn-metro-track-ready.json','w'),indent=2)
