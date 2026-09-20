import json,re,math
from pathlib import Path
root=Path('artifacts');p=root/'auburn-metro-feasibility.html'
data=json.loads((root/'auburn-metro-permanent.json').read_text())
rows=[json.loads(s) for s in (root/'auburn-metro-tracks.jsonl').read_text().splitlines() if s]
done=[x for x in rows if x.get('stage')=='completed'];tracks=[t for x in done for t in x['tracks']];routes=json.loads((root/'auburn-metro-track-ready.json').read_text())
cost=1000000+sum(x['result']['cost'] for x in done)
def path(c):
 return 'M {a[x]} {-az} C {b[x]} {-bz} {c[x]} {-cz} {d[x]} {-dz}'.format(**c,**{'-az':-c['a']['z'],'-bz':-c['b']['z'],'-cz':-c['c']['z'],'-dz':-c['d']['z']})
svg='<svg viewBox="-850 -2900 8100 3350" aria-label="地铁实际施工进度"><rect x="-850" y="-2900" width="8100" height="3350" fill="#edf1e8"/>'
for r in routes:
 for c in r['segments']:svg+=f'<path d="{path(c)}" fill="none" stroke="#b4bcc2" stroke-width="18" stroke-dasharray="35 25"/>'
for t in tracks:svg+=f'<path d="{path(t["curve"])}" fill="none" stroke="#167d9a" stroke-width="22"/>'
for f in data:
 x=f['facility']['position']['x'];z=f['facility']['position']['z'];label='横向临路总站' if f['id']=='depot' else f['id'];svg+=f'<circle cx="{x}" cy="{-z}" r="42" fill="#de9a36"/><text x="{x+65}" y="{-z-60}" font-size="80">{label}</text>'
svg+='</svg>'
section=f'<section id="construction"><h2>施工已暂停</h2><p><b>4座地下车站、1座横向临路总站已建成</b>，全部通过永久道路绑定回读。已铺设 {len(tracks)} 段地下轨道，累计已提交费用 <b>{cost:,}</b>。</p>{svg}<p>蓝色为已建轨道；灰色虚线为设计线，蓝色为已建轨道；待补的三组库线接头尚未在本图绘出。原概念连线已按实际站台朝向改为连续曲线。</p><p>四站地下主线与北侧入库支线已建成，M1 小镇1—小镇2 往返线路已创建。五座设施道路绑定、电力、给水及污水均已核验正常。总站仍有三组独立库线尚未接入支线，列车出库请求未成功；不能将线路创建成功视为已经通车。用户要求暂停施工，游戏保持暂停。</p><p class="note">客运轨道采样埋深约20—41米；总站内部轨道和入库口为地面部分。最终仍需逐段永久曲线、管网和实际发车验收。</p><a href="auburn-metro-tracks.jsonl">轨道施工日志</a> · <a href="auburn-metro-construction.jsonl">车站施工日志</a></section>'
s=p.read_text(encoding='utf8');s=re.sub(r'<section id="construction">.*?</section>','',s,flags=re.S);s=s.replace('奥本山 / 实时勘察 / 仅分析，未施工','奥本山 / 施工已暂停 / 列车出库待完成');s=s.replace('<section>',section+'<section>',1);s=s.replace('本轮只读取城市、寻找候选并采样，没有建造、拆除、整地或改变模拟速度。下一步应先确定车辆段地面部分是否符合地下线路要求，再制作含地下站体、真实曲线、深度和原生预检的施工图。','以上为原勘察阶段结论；目前已进入施工，实际完成范围请查看页面顶部施工进度。');p.write_text(s,encoding='utf8')
print(json.dumps({'built_track_edges':len(tracks),'track_length':sum(t['length_m'] for t in tracks),'cost':cost}))
