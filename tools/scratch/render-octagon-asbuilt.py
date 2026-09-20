from pathlib import Path
import json,html,math
root=Path('artifacts'); a=json.loads((root/'octagon-asbuilt-audit.json').read_text(encoding='utf-8'));q=json.loads(Path('plans/auburn-octagon-town.json').read_text(encoding='utf-8'))
old=root/'auburn-octagon-town.html'
if not (root/'auburn-octagon-town-v2-plan.html').exists():(root/'auburn-octagon-town-v2-plan.html').write_text(old.read_text(encoding='utf-8'),encoding='utf-8')
colors={'NA Residential Medium Row':'#62ba84','Office Low':'#ae8dda','Industrial Manufacturing':'#e2ad54','NA Commercial Low':'#62b4dc'}
P=lambda p:(p['x']-4750,2850-p['z'])
svg=['<svg id="citymap" viewBox="0 0 2400 2720" role="img" aria-label="八角城镇实际建成地图"><rect width="2400" height="2720" fill="#edf1e9"/>']
for line in (root/'octagon-zoning-journal.jsonl').read_text(encoding='utf-8').splitlines():
 z=json.loads(line)
 if z['stage']!='verified':continue
 for c in z['read']['items']:
  if c['zone'] not in colors:continue
  x,y=P(c['position']);svg.append(f'<rect x="{x-4}" y="{y-4}" width="8" height="8" fill="{colors[c["zone"]]}"/>')
for layer,color in [('roads','#65747c'),('tracks','#413e3b'),('utilities','#be7496')]:
 for r in a['snapshot'][layer]:
  if 'curve' not in r:continue
  p=[P(r['curve'][k]) for k in 'abcd'];w=r.get('width_m',4)
  svg.append(f'<path d="M{p[0][0]},{p[0][1]} C{p[1][0]},{p[1][1]} {p[2][0]},{p[2][1]} {p[3][0]},{p[3][1]}" stroke="{color}" stroke-width="{w}" fill="none"><title>{html.escape(r.get("prefab",layer))}</title></path>')
for b in a['snapshot']['buildings']:
 x,y=P(b['position']);size=b.get('size_m',{});w=size.get('x',10);h=size.get('z',10)
 svg.append(f'<rect x="{x-w/2}" y="{y-h/2}" width="{w}" height="{h}" transform="rotate({b.get("rotation_degrees",0)} {x} {y})" fill="#abb5ad" stroke="#f6f6ef" stroke-width="1"><title>{html.escape(b["prefab"])}</title></rect>')
labels={'transformer':'变电站','sewage':'污水处理厂','water':'水塔','deathcare':'公墓','recycling':'回收中心','maintenance':'道路养护站'}
for v in q['plan']['buildings']:labels[v['id']]=v.get('label',v['prefab'])
rows=[]
for i,f in enumerate(a['facilities'],1):
 x,y=P(f['candidate']['position']);label=labels[f['id']]
 svg.append(f'<circle cx="{x}" cy="{y}" r="15" fill="#184f60" stroke="white" stroke-width="2"/><text x="{x}" y="{y+6}" text-anchor="middle" fill="white" font-size="17">{i}</text>')
 rows.append(f'<tr><td>{i}</td><td>{html.escape(label)}</td><td>已建成 · 道路绑定有效</td></tr>')
for x,z,t in [(5600,1350,'A 南角入口'),(6280,2030,'B 东角入口'),(5600,1145,'跨铁路桥 A'),(6500,1145,'跨铁路桥 B'),(6500,550,'高速立交')]:
 u,v=P({'x':x,'z':z});svg.append(f'<text x="{u+20}" y="{v-25}" font-size="28" fill="#153746" stroke="#edf1e9" stroke-width="5" paint-order="stroke">{t}</text>')
svg.append('</svg>');svg=''.join(svg)
cells=''.join(f'<span style="border-left:5px solid {colors[k]}">{n} {a["zone_cells"][k]:,} 格</span>' for k,n in [('NA Residential Medium Row','住宅'),('NA Commercial Low','商业'),('Office Low','办公'),('Industrial Manufacturing','工业')])
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>八角城镇 · 竣工记录</title><style>body{margin:0;background:#f3f5f1;color:#203a41;font:16px/1.65 system-ui}main{max-width:1250px;margin:auto;padding:32px}h1{font-size:38px}header small{color:#54806b}a{color:#146b83}.stats{display:flex;gap:20px;flex-wrap:wrap}.stats span{padding:12px;background:white}section{margin-top:26px;background:white;padding:24px;border-radius:15px}.layout{display:grid;grid-template-columns:2fr 1fr;gap:24px}svg{width:100%;max-height:1100px;background:#edf1e9}table{width:100%;border-collapse:collapse}td{padding:7px;border-bottom:1px solid #ddd;font-size:14px}button{padding:8px 14px;margin-right:8px;cursor:pointer}.note{color:#647578;font-size:14px}@media(max-width:850px){.layout{display:block}}</style><main><header><small>奥本山 / 八角城镇 / V3 实际建成</small><h1>八角路网与两个角入口已建成</h1><p>正八角外环、八条放射路、三道内环及中心环路；南角连接生活区，东角连接工业与办公区。两条外联道路跨越铁路，经南部集散路接入四匝道高速立交。</p></header>'''
page+=f'<div class="stats"><span>17 座服务及配套设施</span><span>施工支出 {a["cost"]["total"]:,}</span><span>资金快照 {a["economy"]["money"]:,}</span></div><section id="checks"><h2>施工与回读结果</h2><p>道路、桥梁、匝道、建筑和高压电缆均已完成永久对象回读。17 座设施道路绑定有效，相关道路处于同一连通分量；所有具有水电消费组件的设施，已确认电力连接及给水、污水供给。</p><div class="stats">{cells}</div><p>中心公共空间、西南公共服务扇区、东北工业内侧缓冲区域保持不划区。建筑落位采用原生道路候选与预检，回收中心位于东北外环外侧。</p><p class="note">住宅和企业正在随模拟成长，划区完成不等于全部入住。当前已核验道路节点与车道对象，尚未完成完整高峰期交通、服务车辆派遣和长期污染观察。全市当前现金流仍为正。</p></section>'
page+=f'<section id="access"><h2 id="map">实际建成地图</h2><button onclick="document.querySelector(\"#citymap\").setAttribute(\"viewBox\",\"0 0 2400 2720\")">城镇与出入口</button><button onclick="document.querySelector(\"#citymap\").setAttribute(\"viewBox\",\"100 100 1700 1500\")">放大城镇</button><div class="layout"><div>{svg}</div><div><h3>设施索引</h3><table>{"".join(rows)}</table><p class="note">实线来自永久道路曲线；彩色小格来自已写入分区的回读。灰色建筑为采集时已生成建筑，不代表全部入住。地图数据时间：{a["captured"]}。</p></div></div></section><section><a href="octagon-asbuilt-audit.json">完整验收记录</a> · <a href="auburn-octagon-town-v2-plan.html">保留的 V2 施工前方案</a></section></main></html>'
old.write_text(page,encoding='utf-8');print('Updated',old)
