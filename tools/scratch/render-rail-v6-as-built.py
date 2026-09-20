import json, html, math
from pathlib import Path
root=Path(__file__).resolve().parents[2]
d=json.loads((root/'artifacts/auburn-rail-v6-as-built.json').read_text(encoding='utf8'))
o=json.loads((root/'artifacts/auburn-rail-v6-operation-observation.json').read_text(encoding='utf8'))
s=d['snapshot']; bounds=s['bounds']; X=lambda x:x-bounds['min_x']; Y=lambda z:bounds['max_z']-z
w=bounds['max_x']-bounds['min_x']; h=bounds['max_z']-bounds['min_z']
new={t['data']['track_edge_id'] for t in d['new_track_audit']}
names={'RailYard02':'小型车辆段','TrainStationTerminus01':'火车总站','TrainStation02':'小型客运站','CargoTrainTerminal01':'货运火车站'}
def path(c):
    p=[(X(c[k]['x']),Y(c[k]['z'])) for k in ['a','b','c','d']]
    return f'M{p[0][0]:.3f},{p[0][1]:.3f} C{p[1][0]:.3f},{p[1][1]:.3f} {p[2][0]:.3f},{p[2][1]:.3f} {p[3][0]:.3f},{p[3][1]:.3f}'
svg=[f'<svg id="map" viewBox="-40 -40 {w+80} {h+80}" aria-label="站区永久道路、建筑和大半径轨道实测图"><rect x="-5000" y="-5000" width="12000" height="12000" fill="#edf1e8"/>']
for x in range(0,int(w),200): svg.append(f'<path d="M{x},0 V{h}" stroke="#dde3d9"/>')
for y in range(0,int(h),200): svg.append(f'<path d="M0,{y} H{w}" stroke="#dde3d9"/>')
for r in s['roads']:
    color='#b29266' if r['elevation_class']=='elevated' else '#b3bcb5'
    svg.append(f'<path d="{path(r["curve"])}" stroke="{color}" stroke-width="{r["width_m"]}" fill="none"><title>{html.escape(r["prefab"])}</title></path>')
for t in s['tracks']:
    built=t['id'] in new; color='#176eae' if built else '#737b80'
    svg.append(f'<path class="{"new" if built else "existing"}" d="{path(t["curve"])}" stroke="{color}" stroke-width="7" fill="none"><title>{html.escape(t["id"])} · {"本轮建成" if built else "既有/站内"}</title></path>')
for b in s['buildings']:
    x,y=X(b['position']['x']),Y(b['position']['z']); bw,bh=b['size_m']['x'],b['size_m']['z']
    if round(b['rotation_degrees'])%180==90: bw,bh=bh,bw
    svg.append(f'<rect x="{x-bw/2}" y="{y-bh/2}" width="{bw}" height="{bh}" rx="4" fill="#34876c" fill-opacity=".22" stroke="#23644e" stroke-width="3"/><text x="{x}" y="{y-8}" text-anchor="middle" font-size="23" font-weight="650" fill="#173c30">{names[b["prefab"]]}</text>')
svg.append(f'<circle cx="{X(-1926.3335)}" cy="{Y(-1194.04993)}" r="8" fill="#c97624"><title>车辆段上侧股道未接通；下侧股道已能派车</title></circle>')
svg.append(f'<path d="M40,{h-40} h200" stroke="#334b42" stroke-width="4"/><text x="40" y="{h-55}" font-size="23">200 m · 北 ↑</text></svg>')
rows=[]
for r in o['lines']:
    x=r['data']; distance=f'{x["route_distance_m"]/1000:.2f} km' if x['route_distance_m']>=0 else '原生距离字段暂未提供'
    rows.append(f'<tr><td>{html.escape(x["name"])}</td><td>已创建 / 启用</td><td>{x["vehicle_count"]} 列已派出</td><td>{distance}</td></tr>')
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>奥本山铁路站区 · V6 实际施工图</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1f4ef;color:#203c32;font:16px/1.75 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1280px;margin:auto;padding:32px}h1{font-size:34px;margin:4px 0}h2{font-size:22px}section{background:white;border:1px solid #d7e1d9;border-radius:14px;padding:22px;margin:20px 0}.badge{color:#277153;font-weight:700;letter-spacing:.1em}.metrics{display:flex;gap:16px;flex-wrap:wrap}.metrics div{flex:1;min-width:180px;padding:18px;background:#e8f0e9;border-radius:10px}.metrics b{display:block;font-size:28px}#map{width:100%;max-height:800px;touch-action:none;cursor:grab;border:1px solid #d7e1d9;border-radius:10px}button{padding:7px 16px;border:1px solid #a6b5ac;border-radius:8px;background:white;color:#244a39;cursor:pointer}.legend{display:flex;gap:20px;flex-wrap:wrap;font-size:14px}.note{background:#fff2d7;border-left:4px solid #c97624;padding:16px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #dde4de}a{color:#176eae}small{color:#63766b}@media(max-width:650px){main{padding:14px}section{padding:14px}td,th{padding:6px;font-size:13px}h1{font-size:27px}}</style><main>
<div class="badge">V6 · 永久对象回读 · 初期运行已观察</div><h1>大半径曲线接轨，客货列车已派出</h1><p>四座设施保留批准位置；火车总站保持横向。中间横路不穿铁路，跨高速通道保留直线桥梁。本站区接轨已按平缓曲线重建。</p>
<div class="metrics"><div><b>4 座</b>设施已建成并核查道路入口</div><div><b>155.5 m</b>本轮永久曲线采样最小半径</div><div><b>2 客运 + 1 货运</b>线路已创建，均观察到列车移动</div></div>
<section><h2>实际建成轨道与站区</h2><div class="legend"><span style="color:#176eae">━━ 本轮建成轨道</span><span style="color:#737b80">━━ 既有及站内轨道</span><span style="color:#34876c">■ 已建建筑</span><span style="color:#c97624">● 车辆段预留股道</span></div><p><button id="reset">复位视图</button> <small>滚轮缩放，拖动平移；悬停轨道查看实体编号。</small></p>'''+''.join(svg)+'''</section>
<section><h2>已创建线路</h2><table><tr><th>线路</th><th>状态</th><th>本次观察</th><th>原生往返距离</th></tr>'''+''.join(rows)+'''</table><p>两条客运线目标各 2 列；货运按当前原生允许范围设为 1 列。表内为回读时的实际派出数量。三列车均有有效行驶路径，未标记卡住；尚未据此宣称长期满载或稳定吞吐。</p></section>
<section><h2>验收与保留项</h2><p>总站两组出站连接点均已接入铁路。小型客站、货站及车辆段下侧股道已接轨；车辆段已派出客运与货运车辆。四座建筑道路绑定有效，均已获得所需供电；带用水组件的三座设施给水、污水均显示已连接。</p><p class="note">车辆段上侧股道的补充连接尚未通过原生预检，未施工，图中以橙点标出。现有下侧股道已能派车。此项保留，不计入已完成范围。</p><p>本轮曲线轨道建造费 25,780，拆除旧急折接轨返还 870，净支出 24,910；不含此前道路、整地及四座建筑的费用。</p><p><a href="auburn-rail-v6-as-built.json">施工与永久对象回读记录</a> · <a href="auburn-rail-v6-operation-observation.json">线路和车辆观察记录</a></p><small>数据来自当前存档实时回读；曲率为水平曲线采样值，非现实铁路设计认证。</small></section></main>
<script>const m=document.getElementById('map'),initial=m.getAttribute('viewBox');let box=initial.split(' ').map(Number),drag=null;function draw(){m.setAttribute('viewBox',box.join(' '))}m.addEventListener('wheel',e=>{e.preventDefault();const r=m.getBoundingClientRect(),fx=(e.clientX-r.left)/r.width,fy=(e.clientY-r.top)/r.height,k=e.deltaY>0?1.15:1/1.15;if(box[2]*k<200||box[2]*k>6000)return;box[0]+=box[2]*fx*(1-k);box[1]+=box[3]*fy*(1-k);box[2]*=k;box[3]*=k;draw()},{passive:false});m.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY,...box];m.setPointerCapture(e.pointerId)});m.addEventListener('pointermove',e=>{if(!drag)return;const r=m.getBoundingClientRect();box[0]=drag[2]-(e.clientX-drag[0])*box[2]/r.width;box[1]=drag[3]-(e.clientY-drag[1])*box[3]/r.height;draw()});m.addEventListener('pointerup',()=>drag=null);document.getElementById('reset').onclick=()=>{box=initial.split(' ').map(Number);draw()};</script></html>'''
(root/'artifacts/auburn-rail-station-plan.html').write_text(page,encoding='utf8')
print('V6 as-built page generated:',len(page),'characters')
