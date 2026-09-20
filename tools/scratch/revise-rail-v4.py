import json, re, math
from pathlib import Path
root=Path(__file__).resolve().parents[2]
p=root/'plans/auburn-rail-station-plan.json'
d=json.loads(p.read_text(encoding='utf-8-sig'))
(root/'artifacts/auburn-rail-station-plan-v3.json').write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf-8')
b=next(b for b in d['plan']['buildings'] if b['id']=='terminus')
b.update(position={'x':-2700,'z':-992},rotation_degrees=90,rotation_source='manual',label='火车总站｜横向设计，待原生绑定')
roads=d['plan']['roads']; tracks=d['plan']['tracks']
roads.append(dict(id='terminus-entry',label='总站东端入口短路',prefab='Medium Road',width_m=24,points=[{'x':-2568,'z':-912},{'x':-2568,'z':-1056}],planning_status='conceptual',level='surface'))
d['plan']['grid_exceptions'][0]['road_ids'].append('terminus-entry')
# Exact midpoint of existing rail edge 48867 from the surveyed Bezier.
c=[(-2757.942,-1397.03943),(-2714.30078,-1330.14941),(-2663.92041,-1267.27417),(-2609.59863,-1207.49219)]
j={'x':sum(k*v[0] for k,v in zip([1,3,3,1],c))/8,'z':sum(k*v[1] for k,v in zip([1,3,3,1],c))/8}
next(t for t in tracks if t['id']=='rail-approach')['points'][0]=j.copy()
tracks[:]=[t for t in tracks if t['id']!='terminus-port']
ports=[{'x':-2826.0005874634,'z':-1011.0001144409},{'x':-2826.0004730225,'z':-995.69995880127}]
merge={'x':-2864,'z':-1056}
for i,port in enumerate(ports):
 tracks.append(dict(id=f'terminus-port-{i+1}',label=f'总站轨道端点 {i+1} 接驳｜设计坐标',prefab='Double Train Track',track_type='train',width_m=12,points=[port,{'x':-2852,'z':port['z']},merge],planning_status='conceptual'))
tracks.append(dict(id='terminus-link',label='总站接入既有铁路｜道岔及纵坡待预检',prefab='Double Train Track',track_type='train',width_m=12,points=[merge,{'x':-2856,'z':-1136},{'x':-2800,'z':-1224},j],planning_status='conceptual'))
d['render']['title']='奥本山铁路站区｜总站横向接轨 V4'
p.write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf-8')
(root/'artifacts/auburn-rail-station-plan.json').write_text(p.read_text(encoding='utf-8'),encoding='utf-8')
h=root/'artifacts/auburn-rail-station-plan.html'; html=h.read_text(encoding='utf-8-sig')
html=html.replace('V3','V4').replace('补齐火车总站，四座设施完整布局','火车总站横向贴路，两处端点接入铁路')
html=html.replace('本版新增独立尽头式火车总站，位于图面左侧，保留小型客运站、货运站和车辆段。','本版将图面左侧总站横向旋转，平行于站前道路，西端两处轨道连接点接入既有铁路，东端增加入口短路。')
start=html.index('<polyline points="145.5,168.0')
end=html.index('</svg>',start)
X=lambda x:(x+2850)*.7+30
Y=lambda z:(z+1480)*.7+35
svg=[]
for t in tracks:
 pts=' '.join(f'{X(v["x"]):.2f},{Y(v["z"]):.2f}' for v in t['points'])
 svg.append(f'<polyline points="{pts}" fill="none" stroke="#31577d" stroke-width="5" stroke-dasharray="9 4"><title>{t["label"]}</title></polyline>')
for r in roads:
 pts=' '.join(f'{X(v["x"]):.2f},{Y(v["z"]):.2f}' for v in r['points'])
 color='#d89120' if r['id']=='highway-bridge' else '#36876d'
 svg.append(f'<polyline points="{pts}" fill="none" stroke="white" stroke-width="22"/><polyline points="{pts}" fill="none" stroke="{color}" stroke-width="16.8"><title>{r["label"]}</title></polyline>')
for bb in d['plan']['buildings']:
 w,hb=bb['size_m']['x'],bb['size_m']['z']
 if bb['id']=='terminus':w,hb=hb,w
 x,z=bb['position']['x'],bb['position']['z']
 svg.append(f'<rect x="{X(x-w/2)}" y="{Y(z-hb/2)}" width="{w*.7}" height="{hb*.7}" fill="#fff0c5" stroke="#af741a" stroke-width="2"/><text x="{X(x)}" y="{Y(z)+6}" text-anchor="middle" font-size="15">{bb["label"].split("｜")[0]}</text>')
# Continue the native station tracks inside the footprint so neither port floats.
for i,port in enumerate(ports):
 svg.append(f'<path d="M{X(-2639)},{Y(port["z"])} H{X(port["x"])}" stroke="#31577d" stroke-width="3"/><circle cx="{X(port["x"])}" cy="{Y(port["z"])}" r="5" fill="#d45129"/><text x="{X(port["x"])+8}" y="{Y(port["z"])-7}" font-size="12">P{i+1}</text>')
svg.append(f'<circle cx="{X(j["x"])}" cy="{Y(j["z"])}" r="6" fill="#d45129"/>')
for x,z,label in [(-2820,-880,'总站贴路横向布置 · 东端入口'),(-2800,-1190,'两端口 → 汇合 → 既有铁路'),(-2420,-1090,'宽路西端止于铁路前'),(-2420,-1420,'站后铁路走廊'),(-2210,-635,'直线坡道 ─ 跨高速桥 ─ 直线坡道')]:
 svg.append(f'<text x="{X(x)}" y="{Y(z)}" font-size="15" paint-order="stroke" stroke="#f1f5ed" stroke-width="4" fill="#21483b">{label}</text>')
html=html[:start]+''.join(svg)+html[end:]
html=html.replace('蓝色虚线为拟建铁路走廊，连接口短线只表示预留空间；不是最终轨道端口或道岔曲线。所有车辆站区占位均在原指定镜头内。','红点 P1 / P2 为按总站预设局部端点及设计朝向换算的连接点，站内轨道与站外接轨线连续绘制；既有铁路红点为其贝塞尔曲线上的接入位置。虚线为设计走廊，折线转折不是最终施工曲线。')
html=html.replace('−2740 / −1060','−2700 / −992').replace('约 120 × 240 m','横向约 240 × 120 m')
a=html.index('<section><h2>新增火车总站说明'); e=html.index('</section>',a)+len('</section>')
html=html[:a]+'''<section><h2>总站横向布局与两个轨道连接点</h2><p>总站中心改为 <b>(−2700, −992)</b>，设计旋转 90°，长边沿东西方向。站体与 Z −912 的道路平行，建筑用地边界距道路边缘约 8.2 米；东端设 X −2568 的入口短路，避免只让建筑侧面靠路。</p><table><tr><th>位置</th><th>设计 X / Z（米）</th><th>接入组织</th></tr><tr><td>P1</td><td>−2826.001 / −1011.000</td><td>总站西端第一处轨道端点</td></tr><tr><td>P2</td><td>−2826.000 / −995.700</td><td>总站西端第二处轨道端点</td></tr><tr><td>既有铁路接入点</td><td>−2687.776 / −1299.600</td><td>现状铁路曲线中点，预留道岔</td></tr></table><p>两处端点先向西引出，再在西侧弯向既有铁路；连接线不穿站前道路。端点坐标来自预设 SubNet 轨道数据按设计位置与朝向换算。90° 是本次横向布局的设计角度，尚未获得道路绑定和原生预览；落地位置变化后必须同步重算端点。</p></section>'''+html[e:]
html=html.replace('图面校验仍有四项“建筑朝向未解析”，源于规划道路尚未建成。','其余三座建筑的朝向尚未解析；总站按横向设计角度绘制，但四座建筑均未完成原生道路绑定。')
html=html.replace('二维采样检查：新建道路与现有、规划铁路没有中心线交叉；中间宽路与铁路边缘的最小采样间距约 <b>37 米</b>。建筑占位没有图面道路重叠。','本版几何检查见下载文件；本站道路、接轨走廊与原铁路的平面关系须与原生纵坡、曲线及道岔预检一同验收。')
html=html.replace('auburn-rail-v3-checks.json','auburn-rail-v4-checks.json')
html=html.replace('最终标高和朝向仍待原生选址预检','最终标高和道路绑定仍待原生选址预检')
h.write_text(html,encoding='utf-8')
print(json.dumps({'junction':j,'ports':ports,'version':4}))
