import json

with open('d:/Develop/game/CityWeaverMCP/all_left_network_segments.json') as f:
    left_segments = json.load(f)

# Compute mirrored segments: (x, -z)
# For direction of oneway roads: (ax, -az) -> (dx, -dz)
mirrored = []
for s in left_segments:
    ax, az = s['a']
    dx, dz = s['d']
    mirrored.append({
        'prefab': s['prefab'],
        'a': (round(ax, 2), round(-az, 2)),
        'd': (round(dx, 2), round(-dz, 2))
    })

print(f"Total mirrored segments: {len(mirrored)}")

# Let's inspect each line on the right side
# Group by (axis, coord, prefab)
by_line = {}
for m in mirrored:
    ax, az = m['a']
    dx, dz = m['d']
    pname = m['prefab']
    if abs(ax - dx) < 1.0:
        by_line.setdefault(('vertical', round(ax), pname), []).append(m)
    elif abs(az - dz) < 1.0:
        by_line.setdefault(('horizontal', round(az), pname), []).append(m)
    else:
        print("Diagonal!", m)

print(f"Total distinct lines: {len(by_line)}")

routes = []

for (axis, coord, pname), segs in sorted(by_line.items()):
    print(f"\nLine {axis} at {coord} ({pname}), {len(segs)} segments:")
    
    # We want to chain segments into continuous points
    # For horizontal lines, varying coordinate is X
    # For vertical lines, varying coordinate is Z
    if axis == 'horizontal':
        # Collect all unique x coordinates
        xs = set()
        for s in segs:
            xs.add(s['a'][0])
            xs.add(s['d'][0])
        s_xs = sorted(xs)
        # Determine direction: for one-way roads, check flow direction
        # Look at the first segment in segs
        sample = segs[0]
        reverse = sample['a'][0] > sample['d'][0]
        if reverse:
            s_xs = sorted(xs, reverse=True)
        
        # Check if s_xs has <= 16 points (15 segments)
        # If > 16 points, split into chunks of at most 15 segments (16 points)
        # with overlap of 1 point
        pts = [{'x': x, 'z': float(coord)} for x in s_xs]
        if len(pts) <= 16:
            routes.append({'prefab': pname, 'points': pts, 'desc': f"{axis} at Z={coord}"})
        else:
            mid = len(pts) // 2 + 1
            routes.append({'prefab': pname, 'points': pts[:mid], 'desc': f"{axis} at Z={coord} (part 1)"})
            routes.append({'prefab': pname, 'points': pts[mid-1:], 'desc': f"{axis} at Z={coord} (part 2)"})
            
    else: # vertical
        zs = set()
        for s in segs:
            zs.add(s['a'][1])
            zs.add(s['d'][1])
        s_zs = sorted(zs)
        sample = segs[0]
        reverse = sample['a'][1] > sample['d'][1]
        if reverse:
            s_zs = sorted(zs, reverse=True)
            
        pts = [{'x': float(coord), 'z': z} for z in s_zs]
        if len(pts) <= 16:
            routes.append({'prefab': pname, 'points': pts, 'desc': f"{axis} at X={coord}"})
        else:
            mid = len(pts) // 2 + 1
            routes.append({'prefab': pname, 'points': pts[:mid], 'desc': f"{axis} at X={coord} (part 1)"})
            routes.append({'prefab': pname, 'points': pts[mid-1:], 'desc': f"{axis} at X={coord} (part 2)"})

print(f"\n==========================================")
print(f"Generated {len(routes)} total routes to execute:")
for i, r in enumerate(routes):
    print(f"Route {i+1:2d}: {r['desc']:30s} | {r['prefab']:32s} | {len(r['points']):2d} points ({r['points'][0]} -> {r['points'][-1]})")

with open('d:/Develop/game/CityWeaverMCP/generated_routes.json', 'w') as f:
    json.dump(routes, f, indent=2)
