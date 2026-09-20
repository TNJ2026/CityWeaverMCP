import json, matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
d=json.load(open('artifacts/auburn-harbor-survey.json',encoding='utf8'))
fig,ax=plt.subplots(figsize=(14,10))
for w in d['water']:
 if w['water']:ax.add_patch(Rectangle((w['x']-64,w['z']-64),128,128,color='#87cae3',lw=0))
for t in d['tiles']['items']:
 if t['owned']:
  b=t['bounds'];ax.add_patch(Rectangle((b['min_x'],b['min_z']),b['max_x']-b['min_x'],b['max_z']-b['min_z'],fill=False,edgecolor='#60a020',lw=.4))
def curve(c,col,lw):
 p=[c[k] for k in 'abcd'];ts=[i/20 for i in range(21)];v=[[sum(p[j][q]*[(1-t)**3,3*(1-t)**2*t,3*(1-t)*t*t,t**3][j] for j in range(4)) for t in ts] for q in ['x','z']];ax.plot(*v,color=col,lw=lw)
for r in d['map']['roads']:curve(r['curve'],'#666666',.5)
for r in d['waterways']['items']:curve(r['components']['Game.Net.Curve']['fields']['m_Bezier'],'#0048bd',2)
for b in d['map']['buildings']:
 p=b['position'];ax.plot(p['x'],p['z'],'.',color='#c78254',markersize=1)
ax.set(xlim=(-3500,7300),ylim=(-4100,7500),aspect='equal');ax.grid(alpha=.2)
fig.savefig('artifacts/harbor-survey.png',dpi=130,bbox_inches='tight')
