import json
from collections import Counter

# 1. Inspect atlas-graph.json
with open('web/public/data/atlas-graph.json', 'r', encoding='utf-8') as f:
    bundle = json.load(f)

meta = bundle['metadata']
print('=== METADATA ===')
print(json.dumps(meta, indent=2))

nodes = bundle['nodes']
edges = bundle['edges']
continents = bundle['continents']

print(f'\nTotal Nodes: {len(nodes):,}')
print(f'Total Edges: {len(edges):,}')
print(f'Total Continents: {len(continents)}')

# 2. Check searched artists
targets = ['egberto gismonti', 'sergio assad', 'becca stevens', 'creo']
print('\n=== TARGET ARTISTS CHECK ===')
nodes_by_name = {n['label'].lower(): n for n in nodes}
for t in targets:
    matches = [n for name, n in nodes_by_name.items() if t == name or (len(t) > 4 and t in name)]
    if matches:
        for m in matches:
            print(f"FOUND: {m['label']} (ID: {m['id']})")
            print(f"  Continent: {m['continentName']} (#{m['continentId']})")
            print(f"  Coords: ({m['x']}, {m['y']}) | Size: {m['size']} | Subs: {m.get('subscribers', 0):,}")
            print(f"  Primary: {m.get('primaryGenre')} | Top Subgenres: {m.get('topSubgenres')}")
    else:
        print(f"NOT FOUND in graph: {t}")

# Check catalog & raw occurrences for missing targets
print('\n=== CHECKING CATALOG & OCCURRENCES FOR TARGETS ===')
with open('pipeline/output/artists_catalog.json', 'r', encoding='utf-8') as f:
    cat = json.load(f)
cat_by_name = {a['name'].lower(): a for a in cat}
for t in targets:
    matches = [a for name, a in cat_by_name.items() if t == name or (len(t) > 4 and t in name)]
    if matches:
        for m in matches:
            print(f"In catalog: {m['name']} (ID: {m['id']}) | Total Playlists: {m.get('totalPlaylists')}")
    else:
        print(f"Not in surviving catalog (needs c_i >= 4): {t}")

with open('pipeline/output/artist_subgenre_occurrences.json', 'r', encoding='utf-8') as f:
    occ = json.load(f)
for t in targets:
    occ_matches = [v for k, v in occ.items() if t in v.get('name', '').lower()]
    if occ_matches:
        for m in occ_matches:
            print(f"Found candidate in harvest: {m.get('name')} | Playlists count (c_i): {m.get('playlists_count')} | Subgenres: {list(m.get('subgenres', {}).keys())}")
    else:
        print(f"Zero playlists harvested for: {t}")

# 3. Check Continent distribution
print('\n=== CONTINENTS ANALYSIS ===')
c_counts = Counter(n['continentId'] for n in nodes)
c_names = {c['id']: c['name'] for c in continents}
print('Top 10 Largest Continents:')
for cid, count in c_counts.most_common(10):
    name = c_names.get(cid, 'Unknown')
    print(f"  #{cid:2d} {name[:40]:<40} : {count:,} artists ({count/len(nodes)*100:.1f}%)")

print('\nTop 10 Smallest Continents:')
for cid, count in c_counts.most_common()[-10:]:
    name = c_names.get(cid, 'Unknown')
    print(f"  #{cid:2d} {name[:40]:<40} : {count:,} artists ({count/len(nodes)*100:.1f}%)")

# Continent size statistics
sizes = list(c_counts.values())
print(f"\nContinent Size Stats: Min={min(sizes)}, Median={sorted(sizes)[len(sizes)//2]}, Mean={sum(sizes)/len(sizes):.1f}, Max={max(sizes)}")
