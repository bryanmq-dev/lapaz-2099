"""Populate the same Overpass cache from a Geofabrik OSM extract (no API requests).
Usage: python scripts/metro/from-pbf.py scripts/metro/.cache/bolivia.osm.pbf
Requires osmium. Locations index is disk-backed to limit RAM.
"""
import json, sys, os
from pathlib import Path
import osmium
ROOT = Path('scripts/metro/.cache')
S, W, N, E = -16.65, -68.32, -16.38, -68.0

def save(name, elements):
    path = ROOT / (name + '.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'elements': elements}, separators=(',', ':'), ensure_ascii=False))

def inside(lon, lat): return W <= lon <= E and S <= lat <= N
class Extract(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.roads = []; self.cable = []; self.ways = {}; self.buses = []; self.buildings = [[] for _ in range(16)]; self.areas = [[] for _ in range(16)]
    def node(self, n):
        if n.tags.get('aerialway') and inside(n.location.lon, n.location.lat):
            self.cable.append({'type':'node', 'id':n.id, 'lon':n.location.lon, 'lat':n.location.lat, 'tags':dict(n.tags)})
    def way(self, w):
        tags = dict(w.tags)
        road = 'highway' in tags; cable = tags.get('aerialway') == 'gondola'; building = 'building' in tags
        area = tags.get('leisure') in ('park','garden','pitch','playground') or tags.get('place') == 'square' or tags.get('landuse') in ('grass','recreation_ground') or (tags.get('highway')=='pedestrian' and tags.get('area')=='yes')
        if not (road or cable or building or area): return
        if not all(n.location.valid() for n in w.nodes): return
        coords = [(n.lon,n.lat) for n in w.nodes]
        if not any(inside(*p) for p in coords): return
        value = {'type':'way','id':w.id,'tags':tags,'nodes':[n.ref for n in w.nodes],'geometry':[{'lon':p[0],'lat':p[1]} for p in coords]}
        if road: self.roads.append(value); self.ways[w.id]=value
        if cable: self.cable.append(value); self.ways[w.id]=value
        if building or area:
            x=max(0,min(3,int((coords[0][0]-W)/(E-W)*4))); y=max(0,min(3,int((coords[0][1]-S)/(N-S)*4))); idx=y*4+x
            if building: self.buildings[idx].append(value)
            if area: self.areas[idx].append(value)
    def relation(self, r):
        mode = r.tags.get('route')
        if mode not in ('bus','minibus','share_taxi','aerialway'): return
        if not any(m.type == 'w' and m.ref in self.ways for m in r.members): return
        members=[]
        for m in r.members:
            item={'type':{'w':'way','n':'node','r':'relation'}[m.type],'ref':m.ref,'role':m.role}
            if m.type == 'w' and m.ref in self.ways: item['geometry']=self.ways[m.ref]['geometry']
            members.append(item)
        value={'type':'relation','id':r.id,'tags':dict(r.tags),'members':members}
        if mode=='aerialway': self.cable.append(value)
        else: self.buses.append(value)
h=Extract()
print('Leyendo extracto OSM con índice en disco…', flush=True)
h.apply_file(sys.argv[1], locations=True, idx='sparse_file_array,/tmp/lapaz-osmium-locations.idx')
save('streets',h.roads); save('cable',h.cable); save('bus-tags',[{k:r[k] for k in ('type','id','tags')} for r in h.buses])
# Importer reads this file before requesting relation batches.
save('bus-local',h.buses)
for y in range(4):
    for x in range(4):
        save(f'{x}-{y}/buildings',h.buildings[y*4+x]); save(f'{x}-{y}/areas',h.areas[y*4+x])
print(f'{len(h.roads)} vías, {len(h.cable)} elementos de teleférico, {len(h.buses)} relaciones de transporte, {sum(map(len,h.buildings))} edificios', flush=True)
