import json,html
from pathlib import Path
root=Path(__file__).resolve().parents[2]
d=json.loads((root/'plans/auburn-rail-station-plan.json').read_text(encoding='utf8'))
e=json.loads((root/'artifacts/auburn-rail-site-evidence.json').read_text(encoding='utf-8-sig'))
X=lambda x:(x+2910)*.7+30
Y=lambda z:(z+1480)*.7+35
svg=['<svg viewBox="0 0 1135 650" aria-label="四座车站设施已通过原生预检的布局"><rect width="1135" height="650" fill="#f1f5ed"/>']
for layer in ['roads','tracks']:
 for r in e['snapshot']['data'][layer]:
  c=r.get('curve')
  if not c:continue
  pts=[f'{X(c[k]["x"]):.2f},{Y(c[k]["z"]):.2f}' for k in 'abcd']
  color='#88968d' if layer=='roads' else '#344a63'
  svg.append(f'<path d="M{pts[0]} C{pts[1]} {pts[2]} {pts[3]}" fill="none" stroke="{color}" stroke-width="{r["width_m"]*.7}"/>')
for layer in ['tracks','roads']:
 for r in d['plan'][layer]:
  pts=' '.join(f'{X(v["x"]):.2f},{Y(v["z"]):.2f}' for v in r['points'])
  color=('#d89120' if r['id']=='highway-bridge' else '#36876d') if layer=='roads' else '#31577d'
  dash='' if layer=='roads' else 'stroke-dasharray="9 5"'
  svg.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{r["width_m"]*.7}" {dash}><title>{html.escape(r["label"])}</title></polyline>')
rows=[]
for b in d['plan']['buildings']:
 w,h=b['size_m']['x'],b['size_m']['z'];x,z=b['position']['x'],b['position']['z']
 if b['rotation_degrees']==90:w,h=h,w
 label=b['label'].split('｜')[0].replace('预留','')
 svg.append(f'<rect x="{X(x-w/2)}" y="{Y(z-h/2)}" width="{w*.7}" height="{h*.7}" fill="#edf8e9" stroke="#247b43" stroke-width="3"/><text x="{X(x)}" y="{Y(z)+5}" text-anchor="middle" font-size="16">{label}</text>')
 rows.append(f'<tr><td>{label}</td><td>{x:.2f} / {z:.2f}</td><td>{b["position"]["y"]:.2f} m</td><td>{b["rotation_degrees"]}°</td><td>{b["native_preview"]["cost"]:,}</td></tr>')
for t in d['plan']['tracks']:
 if t['id'].startswith('terminus-port-'):
  p=t['points'][0];svg.append(f'<circle cx="{X(p["x"])}" cy="{Y(p["z"])}" r="5" fill="#c4522b"/><path d="M{X(p["x"])},{Y(p["z"])} H{X(-2639.25)}" stroke="#31577d" stroke-width="3"/>')
svg.append('<text x="25" y="27" font-size="17">绿色道路已建 · 绿色建筑框仅表示预检通过、尚未建造 · 虚线铁路待建</text></svg>')
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>奥本山铁路站区 V5 · 原生预检通过</title><style>body{margin:0;background:#edf2ee;color:#213b30;font:16px/1.75 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1180px;margin:auto;padding:28px}h1{font-size:32px}section{background:white;border:1px solid #d8e3db;border-radius:16px;padding:24px;margin:22px 0}svg{width:100%;height:auto}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #e0e8e1}.note{padding:16px;background:#fff7db;border-left:4px solid #bd8b2b}iframe{width:100%;height:850px;border:0}a{color:#23765a}.ok{color:#247b43;font-weight:700}@media(max-width:700px){main,section{padding:14px}table{font-size:12px}td,th{padding:5px}h1{font-size:25px}}</style><main><p class="ok">V5 · 道路与台地已完成 · 四座设施原生预检通过</p><h1>横向火车总站与统一标高站区</h1><p>本版采用建成道路上的原生候选位置。四座设施均已通过放置预览，临时预览已取消，建筑尚未永久放置。铁路与客货线路尚未建设。</p><section><h2>已经完成</h2><p>跨高速桥及两端直线坡道、总站站前路、总站入口短路、站区连接路、站前横向宽路。按你的批准重做了站前横路 5 段与连接路末端 2 段；主站区台地整平至约 570 米，总站台地约 571.2 米。</p><p>总站入口前段由约 567.6 米升至 571.2 米，后段为平路。连接路由 Z −912 处约 548.35 米过渡到 Z −1140 处约 570 米；所有新建与重建道路都完成原生提交和永久回读。</p></section><section><h2>按原生候选修订的平面图</h2>'''+''.join(svg)+'''<p>总站相较 V4 沿入口道路移动约 28 米，保持横向 90°。红点为根据总站新位置重新换算的两处轨道端点。其余三座设施的轨道支线仍为走廊预留，落地后须读取永久端点再精确接轨。</p></section><section><h2>待建建筑的确定位置</h2><table><tr><th>设施</th><th>X / Z</th><th>标高</th><th>朝向</th><th>预检费用</th></tr>'''+''.join(rows)+'''</table><p>四座建筑费用合计 <b>470,000</b>。每座设施均取得精确道路边绑定，原生预览无错误、无警告。网页几何校验为 0 错误、0 警告。</p><p class="note">建筑位置经原生选址发生调整，本图供确认最终位置。接轨曲线、道岔、纵坡与客货线路寻路仍需分别通过原生预览和回读，不能把图上虚线视为已连通。</p></section><section><h2>完整交互地图</h2><iframe src="auburn-rail-station-map.html" title="V5 原生绑定地图"></iframe><a href="auburn-rail-station-map.html" target="_blank">单独打开地图</a></section><section><h2>下一施工阶段</h2><p>按上述确定位置建造四座设施 → 回读道路入口和永久轨道端点 → 精确接入既有铁路 → 创建并验证客运、货运线路。中间横路保持不穿铁路，跨高速通道保持直线高架。</p><p><a href="auburn-rail-station-plan.json">结构化施工图</a> · <a href="auburn-rail-v5-building-bindings.json">四座设施原生绑定记录</a></p></section></main></html>'''
(root/'artifacts/auburn-rail-station-plan.html').write_text(page,encoding='utf8')
print('Updated V5 review page')
