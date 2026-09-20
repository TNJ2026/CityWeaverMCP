import json,math
from pathlib import Path
p=Path('plans/auburn-octagon-town.json');q=json.loads(p.read_text(encoding='utf-8'));q['plan']['roads']=q['plan']['roads'][:48];rs=q['plan']['roads'];s=json.loads(Path('artifacts/octagon-access-survey.json').read_text(encoding='utf-8'));live=s['live']['data']['roads']
def pt(x,z,y):return dict(x=x,z=z,y=y)
def add(id,label,pts,w=24,prefab='Medium Road',level='surface'):
 rs.append(dict(id=id,label=label,points=pts,width_m=w,prefab=prefab,level=level,planning_status='conceptual',construction_status='planned'))
# Ramp heights are design targets, not native clearance verification.
add('south-corner-approach','A 南角主入口北坡',[pt(5600,1350,541.7962),pt(5600,1195,554)])
add('south-rail-bridge','A 跨铁路桥｜桥面暂定554米',[pt(5600,1195,554),pt(5600,1095,554)],level='elevated')
add('south-corner-descent','A 南坡与集散路接点',[pt(5600,1095,554),pt(5600,900,541.94574)])
add('east-corner-access','B 东角货运入口',[pt(6280,2030,533.5081),pt(6500,2030,535.0171),pt(6500,1800,536),pt(6500,1500,538.6929)])
add('east-rail-north-ramp','B 跨铁路桥北坡',[pt(6500,1500,538.6929),pt(6500,1195,553)])
add('east-rail-bridge','B 跨铁路桥｜桥面暂定553米',[pt(6500,1195,553),pt(6500,1095,553)],level='elevated')
add('east-rail-south-ramp','B 跨铁路桥南坡',[pt(6500,1095,553),pt(6500,900,541.94574)])
add('shared-distributor','南部集散路｜连接两角入口',[pt(x,900,541.94574) for x in [5600,5780,5960,6140,6320,6500]])
add('interchange-approach','集散路至立交北端',[pt(6500,900,541.94574),pt(6400,760,547)])
add('interchange-overpass-north','立交桥北坡',[pt(6400,760,547),pt(6470,634,558)])
add('interchange-overpass','跨高速桥｜暂定558米',[pt(6470,634,558),pt(6530,526,558)],level='elevated')
add('interchange-overpass-south','立交桥南坡',[pt(6530,526,558),pt(6600,400,553)])
def near(x,z):
 choices=[(math.hypot(r['curve'][k]['x']-x,r['curve'][k]['z']-z),r,k) for r in live for k in ['a','d']]
 _,r,k=min(choices,key=lambda v:v[0]);return r['curve'][k],r['id']
ports={};curves=[]
# Direction follows the actual highway edge start-to-end geometry.
for id,label,target,node,controls,outbound in [
 ('ramp-west-in','西侧高速来车 → 小镇',(6194,364),pt(6600,400,553),[pt(6270,437,545),pt(6460,350,548)],False),
 ('ramp-east-out','小镇 → 东侧高速',(6860,717),pt(6600,400,553),[pt(6720,420,552),pt(6780,703,554)],True),
 ('ramp-east-in','东侧高速来车 → 小镇',(6857,737),pt(6400,760,547),[pt(6740,717,553),pt(6560,820,548)],False),
 ('ramp-west-out','小镇 → 西侧高速',(6180,379),pt(6400,760,547),[pt(6250,720,546),pt(6260,456,545)],True)]:
 port,eid=near(*target);start,end=(node,port) if outbound else (port,node);a,b,c,d=start,controls[0],controls[1],end
 pts=[{k:sum(v[k]*coef for v,coef in zip([a,b,c,d],[(1-t)**3,3*(1-t)**2*t,3*(1-t)*t*t,t**3])) for k in ['x','y','z']} for t in [j/20 for j in range(21)]]
 add(id,label+'｜概念曲线',pts,8,'Highway Oneway - 1 lane');ports[id]={'edge_id':eid,'position':port,'direction':label};curves.append({'id':id,'curve':{'a':a,'b':b,'c':c,'d':d},'note':'曲线意向；points仅供渲染，施工须使用曲线接口并按原生长度上限拆分，不能逐采样点建折线'})
q['bounds'].update(min_z=200,max_x=7100);q['render']['title']='奥本山 · 正八角城镇 V2｜顶点出入口';q['plan']['grid_exceptions'][0]['road_ids']=[r['id'] for r in rs]
p.write_text(json.dumps(q,ensure_ascii=False,indent=2),encoding='utf-8')
notes={'status':'conceptual_not_native_previewed','entrances':[{'name':'A 南角主入口','vertex_index':6,'position':pt(5600,1350,541.7962)},{'name':'B 东角货运入口','vertex_index':0,'position':pt(6280,2030,533.5081)}],'highway_ports':ports,'ramp_design_curves':curves,'limits':['两入口共用一座高速立交，不是两个独立高速出口','桥面暂定高于轨顶约12米；不等于已验证结构净空','南角北坡约7.9%、东桥北坡约4.7%，需原生坡度预检；失败时延长坡道或调整桥面','不能直接提交概念匝道折线或复用历史实体ID']}
Path('artifacts/octagon-access-design.json').write_text(json.dumps(notes,ensure_ascii=False,indent=2),encoding='utf-8')
print('V2: 2 vertex entrances, 2 rail bridges, 1 highway overpass, 4 directional ramps')
