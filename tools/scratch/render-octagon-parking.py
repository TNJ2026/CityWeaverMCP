from pathlib import Path
import json,html,re
d=json.loads(Path('artifacts/octagon-parking-plan.json').read_text(encoding='utf-8'))
assert all(x['found'] and x['tile']['owned'] for s in d['sites'] for x in s['land'])
P=lambda p:(p['x']-4700,2850-p['z'])
svg=['<svg viewBox="0 0 1800 1700" role="img" aria-label="外环外侧五个停车场规划"><rect width="1800" height="1700" fill="#edf1e9"/>']
for r in d['snapshot']['roads']:
 a,b,c,e=[P(r['curve'][k]) for k in 'abcd'];svg.append(f'<path d="M{a[0]},{a[1]} C{b[0]},{b[1]} {c[0]},{c[1]} {e[0]},{e[1]}" stroke="#6c8186" stroke-width="{r["width_m"]}" fill="none"/>')
for b in d['snapshot']['buildings']:
 x,y=P(b['position']);svg.append(f'<circle cx="{x}" cy="{y}" r="8" fill="#a1b8aa"/>')
rows=[]
for s in d['sites']:
 corners=[s['corners'][i] for i in [0,1,3,2]];points=' '.join(f'{P(p)[0]},{P(p)[1]}' for p in corners);p=s['plan']['candidate']['position'];x,y=P(p)
 svg.append(f'<polygon points="{points}" fill="#eab85b" stroke="#9d5c15" stroke-width="4" stroke-dasharray="9 5"/><text x="{x}" y="{y+8}" text-anchor="middle" font-size="30" font-weight="700" fill="#533215">{s["id"]}</text>')
 rows.append(f'<tr><td>{s["id"]}</td><td>{s["label"]}</td><td>{p["x"]:.1f}, {p["z"]:.1f}</td><td>35,000</td></tr>')
svg.append('</svg>')
section='<section id="parking-plan"><h2>外环外侧停车场 · 规划，未施工</h2><p>规划 5 处中型地面停车场（ParkingLot03），每处约 80 × 64 米，预计建筑费合计 <b>175,000</b>。入口采用实时道路候选的精确朝向，直接接外环人行道及机动车道，沿外环分散布置。</p><div class="layout"><div>'+''.join(svg)+'</div><div><table><tr><th>编号</th><th>位置与服务片区</th><th>X / Z</th><th>建筑费</th></tr>'+''.join(rows)+'</table><p>西侧两处服务住宅区；南侧一处服务商业区；东南及北侧两处服务办公区。停车场入口位于边的直路段，不新增城镇对外道路出入口。</p><p>全部候选占地在已购土地内，建筑边缘位于外环中心线外约 12.25 米，入口紧贴外环外侧。自行车道保持现状；进出停车场车辆需与骑行者、行人交织，实际通行效果须施工后观察。</p><p class="note">候选查询未报告近似碰撞。原生放置预检因当前游戏工具占用（TOOL_BUSY）未能执行：施工前退出当前工具、重新预检坐标与道路绑定。未建设、未扣款。平面停车位数量需读取实际停车车道，目录中的 garage_marker_capacity=0 不代表没有车位。</p><a href="octagon-parking-plan.json">候选坐标、朝向与土地检查记录</a></div></div></section>'
p=Path('artifacts/auburn-octagon-town.html');v=p.read_text(encoding='utf-8');v=re.sub(r'<section id="parking-plan">.*?</section>','',v,flags=re.S);v=v.replace('<section id="bicycles">',section+'<section id="bicycles">');p.write_text(v,encoding='utf-8');print('Parking plan published locally; all 20 footprint corners on owned tiles')
