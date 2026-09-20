from pathlib import Path
import json,html
q=json.loads(Path('plans/auburn-octagon-town.json').read_text(encoding='utf-8'));s=json.loads(Path('artifacts/octagon-access-survey.json').read_text(encoding='utf-8'));n=json.loads(Path('artifacts/octagon-access-design.json').read_text(encoding='utf-8'))
P=lambda p:((p['x']-4750)*.36,(2850-p['z'])*.36)
ps=lambda pts:' '.join(f'{P(p)[0]:.1f},{P(p)[1]:.1f}' for p in pts)
svg='<svg viewBox="0 0 870 980" role="img" aria-label="南角和东角出入口、跨铁路桥与高速四匝道"><rect width="870" height="980" fill="#f1f5ef"/>'
for z in q['plan']['zones']:svg+=f'<polygon points="{ps(z["polygon"])}" fill="#d5e6d8" stroke="#adbfaf"/>'
for layer,color in [('roads','#72767d'),('tracks','#151f26')]:
 for r in s['live']['data'][layer]:
  cv=r['curve'];a,b,c,d=[P(cv[k]) for k in 'abcd'];svg+=f'<path d="M {a[0]},{a[1]} C {b[0]},{b[1]} {c[0]},{c[1]} {d[0]},{d[1]}" fill="none" stroke="{color}" stroke-width="5"/>'
for i,r in enumerate(q['plan']['roads']):
 if i<48 and not (r['id'].startswith('ring-680') or r['id'].startswith('spoke')):continue
 color='#879e8d' if i<48 else '#c06424' if r['id'].startswith('ramp-') else '#146f86'
 svg+=f'<polyline points="{ps(r["points"])}" fill="none" stroke="{color}" stroke-width="{3 if i<48 else 5}" stroke-linejoin="round"><title>{html.escape(r["label"])}</title></polyline>'
 if r['id'].startswith('ramp-'):
  pts=r['points'];a,b=P(pts[9]),P(pts[11]);import math
  ang=math.atan2(b[1]-a[1],b[0]-a[0]);x,y=P(pts[10]);l=[(x+9*math.cos(ang),y+9*math.sin(ang)),(x+8*math.cos(ang+2.5),y+8*math.sin(ang+2.5)),(x+8*math.cos(ang-2.5),y+8*math.sin(ang-2.5))];svg+=f'<polygon points="{" ".join(f"{u},{v}" for u,v in l)}" fill="#642d10"/>'
labels=[(5600,1350,'A 南角主入口'),(6280,2030,'B 东角货运入口'),(5600,1145,'跨铁路桥 A'),(6500,1145,'跨铁路桥 B'),(5900,900,'南部集散路'),(6500,580,'跨高速桥'),(5550,1145,'既有铁路'),(6240,300,'四匝道菱形立交意向')]
for x,z,t in labels:
 u,v=P({'x':x,'z':z});svg+=f'<circle cx="{u}" cy="{v}" r="6" fill="#125669"/><text x="{u+10}" y="{v-12}" font-size="14" font-weight="600" fill="#164052" paint-order="stroke" stroke="#f1f5ef" stroke-width="4">{t}</text>'
svg+='</svg>'
section='<section class="card" id="access" style="margin-top:24px"><h2>V2 · 出入口只设在顶点</h2><div class="layout"><div>'+svg+'</div><div><p><b>A 南角：</b>X=5600，Z=1350。与南向放射路同轴衔接，服务生活区。</p><p><b>B 东角：</b>X=6280，Z=2030。沿东向放射路延长后折向南，服务工业与办公区。</p><p>两个入口均与外环的真实顶点重合，外环边中间不开口。分别跨铁路后，通过南部集散路汇入一座四匝道菱形立交意向方案。两处城镇入口共用一个高速节点。</p><ul><li>西侧高速来车 → 南端路口 → 跨高速桥 → 集散路 → A/B。</li><li>A/B → 集散路 → 北端路口 → 西侧高速。</li><li>东侧高速来车 → 北端路口 → 集散路 → A/B。</li><li>A/B → 集散路 → 跨高速桥 → 南端路口 → 东侧高速。</li></ul><p>蓝色为城镇连接路与桥梁，橙色为单向匝道意向，灰色为既有高速，黑色为铁路。匝道箭头表示行驶方向。</p><p>跨铁路桥面暂定 A=554 米、B=553 米；跨高速桥面暂定 558 米。南角北坡约7.9%，东桥北坡约4.7%，须检查原生坡度、桥下结构净空、道路端点和转向能力。</p><div class="note">本次完成平面和初步竖向方案，未运行原生预检。匝道曲线需按原生长度上限拆分，并重新发现接点、核验碰撞及双向寻路；图线不是已建连通证明。<a href="octagon-access-design.json">出入口坐标与曲线说明</a></div></div></div></section>'
p=Path('artifacts/auburn-octagon-town.html');v=p.read_text(encoding='utf-8').replace('V1 · 规划','V2 · 顶点出入口规划').replace('<h2 id="map">',section+'<h2 id="map">');v=v.replace('两条南向/东向外联走廊为概念预留，跨铁路采用高架思路，桥面高度、坡长与高速立交端口待勘察预检。','两处外联入口固定在南角与东角；初步桥面、道路与高速四匝道方案见下方 V2 出入口详图，仍待原生预检。');p.write_text(v,encoding='utf-8')
# Assert boundary gateways coincide with vertices, while preserving ring geometry.
a=json.loads(Path('artifacts/octagon-audit.json').read_text(encoding='utf-8'))
for e in n['entrances']:
 v=a['vertices'][e['vertex_index']];assert abs(v['x']-e['position']['x'])<1e-6 and abs(v['z']-e['position']['z'])<1e-6
print('V2 overview updated; both gateways verified at exact vertices')
