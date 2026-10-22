import json

with open('d:/Develop/game/CityWeaverMCP/identified_rect_roads.json') as f:
    roads = json.load(f)

# Group segments by (axis, coord, prefab)
# Axis: 'x' (constant x, varying z) or 'z' (constant z, varying x)
by_line = {}

for r in roads:
    c = r['curve']
    ax, az = c['a']['x'], c['a']['z']
    dx, dz = c['d']['x'], c['d']['z']
    pname = r['prefab']
    
    if abs(ax - dx) < 1.0: # Vertical (running along Z)
        axis = 'vertical'
        coord = round(ax)
        by_line.setdefault((axis, coord, pname), []).append(r)
    elif abs(az - dz) < 1.0: # Horizontal (running along X)
        axis = 'horizontal'
        coord = round(az)
        by_line.setdefault((axis, coord, pname), []).append(r)
    else:
        print(f"Diagonal road: {pname} from ({ax}, {az}) to ({dx}, {dz})")

print(f"Total lines: {len(by_line)}")
for (axis, coord, pname), segs in sorted(by_line.items()):
    print(f"  {axis:10s} at {coord:6d} ({pname:32s}): {len(segs):2d} segments")
