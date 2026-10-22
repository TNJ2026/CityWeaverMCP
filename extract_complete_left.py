import json, socket, os

with open(os.path.expanduser('~/AppData/LocalLow/Colossal Order/Cities Skylines II/ModsData/CityWeaver/bridge.json')) as f:
    cfg = json.load(f)

def call(tool, args={}):
    s = socket.socket()
    s.connect((cfg['host'], cfg['port']))
    req = {'protocol_version': 1, 'token': cfg['token'], 'tool': tool, 'arguments': args}
    s.sendall(json.dumps(req).encode('utf-8') + b'\n')
    buf = bytearray()
    while True:
        chunk = s.recv(65536)
        if not chunk: break
        buf.extend(chunk)
        if b'\n' in chunk: break
    s.close()
    return json.loads(buf.decode('utf-8'))

res = call('query_entities', {'category': 'roads', 'include_components': ['Game.Net.Curve', 'Game.Prefabs.PrefabRef'], 'limit': 100})
total = res['data']['total']
snap = res['data']['snapshot_id']

all_roads = []
for off in range(0, min(total, 4000), 100):
    r = call('query_entities', {'category': 'roads', 'include_components': ['Game.Net.Curve', 'Game.Prefabs.PrefabRef'], 'limit': 100, 'offset': off, 'snapshot_id': snap})
    for it in r.get('data', {}).get('items', []):
        curve = it.get('components', {}).get('Game.Net.Curve', {}).get('fields', {}).get('m_Bezier')
        pname = it.get('prefab_name')
        if curve:
            all_roads.append({
                'id': it['entity_id'],
                'prefab': pname,
                'a': (curve['a']['x'], curve['a']['z']),
                'd': (curve['d']['x'], curve['d']['z'])
            })

# Select roads on left side strictly belonging to the rectangular network:
left_roads = []
for r in all_roads:
    ax, az = r['a']
    dx, dz = r['d']
    mx, mz = (ax+dx)/2, (az+dz)/2
    
    # 1. Outer rectangular loop & inner grid: X in [-4850, -2840], Z in [-2505, -1890]
    if -4850 <= mx <= -2840 and -2505 <= mz <= -1890:
        left_roads.append(r)
    # 2. Main connector at X = -3848: from Z = -2496 down to -2855
    elif abs(mx - (-3848)) < 5 and -2860 <= mz <= -2490:
        left_roads.append(r)
    # 3. Outer connector at Z = -2196: from X = -5205 to -4720
    elif abs(mz - (-2196)) < 5 and -5205 <= mx <= -4720:
        left_roads.append(r)

print(f"Total left network segments found: {len(left_roads)}")
by_p = {}
for r in left_roads:
    by_p[r['prefab']] = by_p.get(r['prefab'], 0) + 1
print("Prefabs breakdown:", by_p)

with open('d:/Develop/game/CityWeaverMCP/all_left_network_segments.json', 'w') as f:
    json.dump(left_roads, f, indent=2)
