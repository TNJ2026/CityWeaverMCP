import json,math
q=json.load(open('artifacts/auburn-metro-permanent.json',encoding='utf8'));d=q[-1]['tracks'];out=[]
def mid(a,b):return {k:(a[k]+b[k])/2 for k in ['x','z']}
def split(c):
 a,b,e,z=[c[k] for k in ['a','b','c','d']];ab=mid(a,b);bc=mid(b,e);cd=mid(e,z);abc=mid(ab,bc);bcd=mid(bc,cd);m=mid(abc,bcd)
 return [dict(a=a,b=ab,c=abc,d=m),dict(a=m,b=bcd,c=cd,d=z)]
def radius(c):
 a,b,e,d=[c[k] for k in ['a','b','c','d']];v=1e10
 for i in range(257):
  t=i/256;u=1-t;x=[3*(u*u*(b[k]-a[k])+2*u*t*(e[k]-b[k])+t*t*(d[k]-e[k])) for k in ['x','z']];y=[6*(u*(e[k]-2*b[k]+a[k])+t*(d[k]-2*e[k]+b[k])) for k in ['x','z']];v=min(v,math.hypot(*x)**3/max(1e-9,abs(x[0]*y[1]-x[1]*y[0])))
 return v
for id,node,endx,endnode,prefab in [('new-main','618760:9',6335.764,'611270:29','Double Subway Track')]:
 t=next(t for t in d if t['end_node_id'].endswith(':'+node));a=t['end'];z=dict(x=endx,y=503.583435,z=2009.75);c=dict(a=a,b=dict(x=a['x'],z=a['z']+220),c=dict(x=z['x']+220,z=z['z']),d=z);segs=[]
 for half in split(c):segs+=split(half)
 out.append(dict(id=id,track_prefab=prefab,a_node=t['end_node_id'],d_node=t['end_node_id'].split(':')[0]+':'+endnode,curve=c,segments=segs,min_radius=radius(c)))
 print(id,radius(c))
json.dump(out,open('artifacts/auburn-metro-relocation-geometry.json','w'),indent=2)
