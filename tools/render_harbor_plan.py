import json,math
from pathlib import Path
d=json.load(open('artifacts/auburn-harbor-survey.json',encoding='utf8'))
detail=json.load(open('artifacts/auburn-harbor-detail.json',encoding='utf8'))['cells']
route=[(4700,2932),(4700,3030),(4480,3230),(4100,3270),(3650,3240),(2900,3200),(2223.84,3160.5)]
road=[(4920,2030),(4700,2030),(4600,2200),(4600,2630)]
def path(c):
 a,b,e,f=[c[k] for k in 'abcd'];return f'M{a["x"]},{-a["z"]} C{b["x"]},{-b["z"]} {e["x"]},{-e["z"]} {f["x"]},{-f["z"]}'
def svg(full=False):
 box='-7480 -7550 14960 15100' if full else '1700 -3520 5500 2700'
 s=[f'<svg viewBox="{box}" role="img" aria-label="货运港口、水路与道路规划图" style="background:#e6eadf">']
 water=d['water'] if full else detail
 size=128 if full else 16
 for w in water:
  if w['water']:s.append(f'<rect x="{w["x"]-size/2}" y="{-w["z"]-size/2}" width="{size}" height="{size}" fill="#91c8dc"/>')
 for t in d['tiles']['items']:
  b=t['bounds'];s.append(f'<rect x="{b["min_x"]}" y="{-b["max_z"]}" width="{b["max_x"]-b["min_x"]}" height="{b["max_z"]-b["min_z"]}" fill="none" stroke="{"#72966b" if t["owned"] else "#c3c8c2"}" stroke-width="{5 if t["owned"] else 2}"/>')
 for r in d['map']['roads']:s.append(f'<path d="{path(r["curve"])}" fill="none" stroke="#7d8585" stroke-width="{r["width_m"]}"/>')
 for b in d['map']['buildings']:
  p=b['position'];sz=b['size_m'];s.append(f'<rect x="{p["x"]-sz["x"]/2}" y="{-p["z"]-sz["z"]/2}" width="{sz["x"]}" height="{sz["z"]}" transform="rotate({-b["rotation_degrees"]} {p["x"]} {-p["z"]})" fill="{"#d3ad83" if b["kind"]=="residential" else "#adbbb2"}"/>')
 for r in d['waterways']['items']:s.append(f'<path d="{path(r["components"]["Game.Net.Curve"]["fields"]["m_Bezier"])}" fill="none" stroke="#276592" stroke-width="{24 if full else 14}"/>')
 for pts,col,width in [(route,'#006b97',22),(road,'#d67937',24),([(4400,2630),(5000,2630)],'#d67937',24)]:s.append('<polyline points="'+' '.join(f'{x},{-z}' for x,z in pts)+f'" fill="none" stroke="{col}" stroke-width="{width}" stroke-dasharray="36 14" stroke-linejoin="round"/>')
 s.append('<rect x="4476.2" y="-2931.8" width="447.6" height="263.6" fill="#e0bb6e" fill-opacity=".65" stroke="#975c16" stroke-width="8" stroke-dasharray="20 12"/>')
 labels=[(4700,2800,'货运港口候选'),(5550,1950,'小镇2'),(4600,2400,'接港路'),(3260,3300,'规划水路 → 既有航道'),(2224,3090,'接入点'),(6692,1510,'地铁总站')]
 if full:labels=[(4700,2800,'港口候选'),(5301,7100,'北侧船舶外部连接'),(-500,300,'小镇1'),(5600,2030,'小镇2')]
 for x,z,txt in labels:s.append(f'<text x="{x}" y="{-z}" text-anchor="middle" font-size="{160 if full else 65}" fill="#183b4e" stroke="#fff" stroke-width="{12 if full else 5}" paint-order="stroke">{txt}</text>')
 s.append('</svg>');return ''.join(s)
html='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>奥本山 · 货运港口规划</title><style>*{box-sizing:border-box}body{margin:0;background:#edf1ee;color:#223a40;font:16px/1.65 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1320px;margin:auto;padding:32px}h1{margin:4px 0 12px;font-size:32px}h2{font-size:22px}p{max-width:1050px}.tag{color:#a05a15;font-weight:bold}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card,section{background:white;padding:20px;border-radius:12px;margin-bottom:18px}.card strong{display:block;font-size:24px;color:#136778}svg{width:100%;height:auto;border-radius:8px}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #e1e6e4;padding:12px}a{color:#076b94}.note{border-left:4px solid #d7973e;padding-left:14px}.legend{display:flex;gap:25px;flex-wrap:wrap;font-size:14px}details summary{cursor:pointer;font-weight:bold}iframe{width:100%;height:780px;border:0}footer{font-size:13px;color:#6a797b}@media(max-width:700px){main{padding:14px}.cards{grid-template-columns:1fr 1fr}}</style><main><div class="tag">只读规划 · 尚未施工 · 2026-09-20 实时勘察</div><h1>货运港口 · 小镇2西北海湾</h1><p>在已购区域内预留一座标准货运港口，从八角形西角引出接港路。船舶沿新支航道绕开浅滩，接入现有普通航道，再利用既有航道通往地图北侧的外部连接。图面按世界坐标绘制，+Z 朝上，不随游戏镜头旋转。</p><div class="cards"><div class="card">设施建筑费<strong>490,000</strong>仅主体，未含道路与水路</div><div class="card">主体占地<strong>448 × 264 m</strong>CargoHarbor01，已解锁</div><div class="card">外侧水路走廊<strong>约 2.56 km</strong>另约98m港池出口段</div><div class="card">走廊抽样最低水深<strong>约 7.8 m</strong>16m 网格 / 128m 宽范围</div></div><section><h2>港区与水路布局</h2>'''+svg()+'''<div class="legend"><span>橙色虚线：规划道路</span><span>蓝色虚线：规划水路</span><span>蓝色实线：现有航道</span><span>黄色框：概念占地</span><span>绿色格框：已购地图格</span></div><p class="note">黄色占地框只用于预留空间，横向显示不代表已确定原生朝向；码头需朝水、道路入口需朝陆。水路折线表示走廊，施工时应采用平顺曲线，并绑定港口真实船舶端口。</p></section><section><h2>选址与接入安排</h2><table><tr><th>项目</th><th>规划内容</th></tr><tr><td>港口候选</td><td>中心约 X=4700、Z=2800；沿岸预留448×264米主体及南侧港前路。需局部整地，不能按现状高程直接施工。</td></tr><tr><td>陆路入口</td><td>小镇2西角 (4920,2030) → (4700,2030) → (4600,2200) → (4600,2630)。港前路沿 Z=2630，X=4400–5000。使用24米宽 Medium Road，重卡经外环接既有公路出入口。</td></tr><tr><td>水路连接</td><td>港池外侧 (4700,3030) → (4480,3230) → (4100,3270) → (3650,3240) → (2900,3200) → 现有航道约 (2224,3160)。绕开 X≈4000、Z≈3100 的浅滩。</td></tr><tr><td>对外货运线路</td><td>预留“西北货运港 ↔ 北侧船舶外部连接”的往返货运航线。已查询到真实 Ship 外部站点，并验证接入航道所在网络能沿7段既有边到达北侧外部节点；港口建成后再读取真实停靠点创建线路。</td></tr><tr><td>噪声与道路</td><td>候选中心到最近住宅中心约545米，尚未验证噪声边界。港区与住宅之间保留缓冲，不新增住宅；重卡需经过部分外环，运营后检查路口排队。</td></tr><tr><td>水电污水</td><td>沿普通接港道路预留管网，施工后逐项验证道路绑定及给水、污水、电力连通；“接上道路”不能代替网络验收。</td></tr></table></section><section><h2>施工前需要解决的条件</h2><p>① 陆侧样点约533.6–540.4米，附近水面约525米，需设计局部台地和道路坡度。② 目前临路临水选址器返回0个候选，必须在接港路建成后重新选址，确认主体坐标、道路边及朝向并通过原生预览。③ 当前MCP能查询现有航道及船舶站点，但尚无专用航道建设接口；道路列表也不包含Seaway。要由MCP完成新支航道，需要先增加航道放置支持。④ 当前水深是规划抽样值，仍需港池、全宽航道、转弯和原生水深预检。</p><p class="note">本方案没有建造、整地、购地或创建线路。490,000为实时资产建筑费；完整工程预算需道路、航道及港口原生预检后确定。</p></section><section><details><summary>全地图水路与对外连接</summary>'''+svg(True)+'''<p>全图水域为128米网格概览；港区详图为16米网格。全图现状道路/建筑快照覆盖两镇及已购区域，航道为全部38段实时对象。</p></details></section><section><details><summary>打开可缩放的完整底图（原生规划渲染）</summary><p><a href="auburn-cargo-harbor-map.html">独立打开完整底图</a>。此底图用于道路与港口占地检查；水路以本页专题图为准。</p><iframe loading="lazy" src="auburn-cargo-harbor-map.html" title="原生规划底图"></iframe></details></section><footer>数据：CityWeaverMCP / 当前存档 奥本山 / 港口实体尚未创建。方案JSON与水路连通证据随页面保存在artifacts目录。</footer></main></html>'''
status_path=Path('artifacts/auburn-harbor-construction-status.json')
if status_path.exists():
 status=json.loads(status_path.read_text(encoding='utf8'))
 if status.get('state')=='blocked_requires_city_reload':
  html=html.replace('只读规划 · 尚未施工 · 2026-09-20 实时勘察','施工中 · 港区整地已完成 · 等待存档并重载')
  html=html.replace('<h1>货运港口 · 小镇2西北海湾</h1>','<h1>货运港口 · 小镇2西北海湾</h1><section class="note"><strong>施工进度：已完成陆侧局部整地</strong><p>约600×280米范围整至527米，27个路径采样点回读527.008米，费用0。道路预览返回 ROAD_OPERATION_LIMIT：当前会话已达128次道路操作上限。请先存档并重新载入城市，保留整地后继续。道路、港口、航道与货运线路均尚未建成；图中仍为规划线。</p></section>')
  html=html.replace('本方案没有建造、整地、购地或创建线路。','本轮仅完成港区陆侧局部整地；未建道路、港口、航道或线路，未购地。')
  html=html.replace('① 陆侧样点约533.6–540.4米，附近水面约525米，需设计局部台地和道路坡度。','① 已完成陆侧局部整地至约527米，后续核对完整主体基础、岸线及接港道路坡度。')
if status_path.exists() and status.get('state')=='blocked_requires_hotfix_deployment':
 html=html.replace('只读规划 · 尚未施工 · 2026-09-20 实时勘察','施工中 · 整地及道路已完成 · 修复补丁已部署，等待加载存档')
 html=html.replace('<h1>货运港口 · 小镇2西北海湾</h1>','<h1>货运港口 · 小镇2西北海湾</h1><section class="note"><strong>已完成：陆侧整地、接港路、港前路</strong><p>道路10段通过永久回读，费用合计8,252。航道独立预览通过并已取消；异宽航道分接实测发现原航道保留段误判，港口选址发现水下地形高差误判。1.23.1修复包已部署，6个文件哈希核对一致。请启动游戏并加载已保存的城市，继续原生预检和施工。港口、永久航道和货运线路尚未建成。</p></section>')
 html=html.replace('本方案没有建造、整地、购地或创建线路。','已完成港区整地与接港道路，未建港口、航道或线路，未购地。')
 html=html.replace('尚无专用航道建设接口；道路列表也不包含Seaway。要由MCP完成新支航道，需要先增加航道放置支持。','已接入航道接口；首次实测发现异宽分接保留段误判，修复后需重新验证。')
if status_path.exists() and status.get('harbor_built'):
 html=html.replace('只读规划 · 尚未施工 · 2026-09-20 实时勘察','施工中 · 港口与道路已建成 · 航道待接通')
 html=html.replace('<h1>货运港口 · 小镇2西北海湾</h1>','<h1>货运港口 · 小镇2西北海湾</h1><section class="note"><strong>已建成：货运港口、10段接港道路及陆侧整地</strong><p>港口最终位置 X=4650、Z=2774.25，朝向180°，主体费用490,000；永久建筑道路绑定回读正常，已发现两个货船停靠点。航道最终预览被工具切换取消，尚未提交。航线及水电污水运营验收仍待完成。</p></section>')
 html=html.replace('货运港口候选','货运港口（已建）').replace('港口候选','港口（已建）')
 html=html.replace('x="4476.2" y="-2931.8"','x="4426.2" y="-2906.05"')
 html=html.replace('黄色框：概念占地','黄色框：已建港口主体').replace('黄色占地框只用于预留空间，横向显示不代表已确定原生朝向；码头需朝水、道路入口需朝陆。水路折线表示走廊，施工时应采用平顺曲线，并绑定港口真实船舶端口。','港口已沿港前路建成，陆路入口朝南；内部普通航道位于 Z=2957.25、X=4500–4800。蓝色虚线仍是待建路线，最终按原生曲线及港池连接点施工。')
 a=html.index('<section><h2>施工前需要解决的条件</h2>');b=html.index('</section>',a)+len('</section>')
 html=html[:a]+'<section><h2>当前施工检查</h2><p>岸线选址器返回10个候选；X=4650候选原生预览无错误、无警告并已完成建造。普通航道210米宽，分段采用平顺曲线，最小采样半径约235米；全宽5025个规划样点位于已购地图格内，实时预检通过4米水深筛查。末端精确接入港口内部航道；最终接线事务因 USER_CHANGED_TOOL 取消，尚未提交。未创建货运线路，尚不能宣称港口已通航。</p><p>已完成费用：道路8,252，港口490,000；航道预览费用51,840，尚未扣除。原始16米网格水深数据仅用于规划参考。</p></section>'+html[b:]
 html=html.replace('港口实体尚未创建','港口实体已创建；航道和货运线路待完成')
 html=html.replace('中心约 X=4700、Z=2800；沿岸预留448×264米主体及南侧港前路。需局部整地，不能按现状高程直接施工。','最终主体中心 X=4650、Z=2774.25，朝向180°，基础高程527.097米，已完成原生施工。')
 html=html.replace('约 2.56 km','约 2.60 km').replace('另约98m港池出口段','最终接入港口内部航道，尚未提交')
if status_path.exists() and status.get('waterway_built') and status.get('route_created'):
 import re
 op=json.loads(Path('artifacts/harbor-waterway-completed.json').read_text(encoding='utf8'))['data']
 curve_path=' '.join(path(c) for c in op['curve_segments'])
 html=re.sub(r'<polyline[^>]*stroke="#006b97"[^>]*/>',lambda m: '<path d="'+curve_path+'" fill="none" stroke="#006b97" stroke-width="22"/>',html)
 html=html.replace('stroke-dasharray="36 14"','').replace('stroke-dasharray="20 12"','')
 html=html.replace('施工中 · 港口与道路已建成 · 航道待接通','施工完成 · 港口、道路、航道与货运线路已创建')
 html=html.replace('航道最终预览被工具切换取消，尚未提交。航线及水电污水运营验收仍待完成。','航道已完成提交及7条永久边回读，货运线路已创建并启用。电力、给水及污水连接正常，实时需求全部满足；已生成首艘货船 ShipCargo02；实际靠港装卸仍待模拟运行观察。')
 html=html.replace('橙色虚线：规划道路','橙色实线：已建接港道路').replace('蓝色虚线：规划水路','蓝色实线：已建接港航道')
 html=html.replace('蓝色虚线仍是待建路线，最终按原生曲线及港池连接点施工。','蓝色曲线为已建航道，末端已绑定港池内部航道。')
 html=html.replace('最终接线事务因 USER_CHANGED_TOOL 取消，尚未提交。未创建货运线路，尚不能宣称港口已通航。','最终接线事务 completed，永久航道回读通过。货运线路“西北货运港—北侧外港”通过原生往返寻路预览并完成创建，全天启用。实际船舶运行及装卸量仍待观察。')
 html=html.replace('航道预览费用51,840，尚未扣除','航道费用51,840，累计建设费用550,092')
 html=html.replace('最终接入港口内部航道，尚未提交','已接入港口内部航道').replace('航道和货运线路待完成','航道和货运线路已完成，首艘货船已生成')
 html=html.replace('预留“西北货运港 ↔ 北侧船舶外部连接”的往返货运航线。已查询到真实 Ship 外部站点，并验证接入航道所在网络能沿7段既有边到达北侧外部节点；港口建成后再读取真实停靠点创建线路。','已创建“西北货运港—北侧外港”往返货运航线，绑定港口真实货船停靠点与北侧外部连接。原生寻路通过，线路完整且全天启用。')
Path('artifacts/auburn-cargo-harbor-plan.html').write_text(html,encoding='utf8')
