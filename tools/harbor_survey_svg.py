import json
from pathlib import Path
d=json.load(open('artifacts/auburn-harbor-survey.json',encoding='utf8'));s=['<html><body><svg width="1000" height="850" viewBox="-3500 -7500 10800 11600" style="background:#e8eddc"><g transform="scale(1,-1)">']
for w in d['water']:
 if w['water']:s.append(f'<rect x="{w["x"]-64}" y="{w["z"]-64}" width="128" height="128" fill="#8bcce5"/>')
for t in d['tiles']['items']:
 if t['owned']:
  b=t['bounds'];s.append(f'<rect x="{b["min_x"]}" y="{b["min_z"]}" width="623.3" height="623.3" fill="none" stroke="#75a247" stroke-width="6"/>')
def curve(c,col,lw):
 a,b,e,f=[c[k] for k in 'abcd'];s.append(f'<path d="M {a["x"]},{a["z"]} C {b["x"]},{b["z"]} {e["x"]},{e["z"]} {f["x"]},{f["z"]}" fill="none" stroke="{col}" stroke-width="{lw}"/>')
for r in d['map']['roads']:curve(r['curve'],'#666',12)
for r in d['waterways']['items']:curve(r['components']['Game.Net.Curve']['fields']['m_Bezier'],'#1458d5',30)
s.append('</g>')
for x in range(-3000,7500,1000):
 for z in range(-4000,7500,1000):s.append(f'<text x="{x}" y="{-z}" font-size="90">{x},{z}</text>')
s.append('</svg></body></html>');Path('artifacts/harbor-survey.html').write_text(''.join(s),encoding='utf8')
