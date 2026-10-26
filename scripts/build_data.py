"""Validate source cells and publish a compact, deterministic static snapshot."""
import json
import math
import urllib.request
from collections import Counter
from pathlib import Path

import networkx as nx
import numpy as np
from shapely.geometry import shape
from shapely.ops import transform

from fetch_data import ROOT, CACHE, AGE_BANDS, metadata, values, read_csv

OUT = ROOT / 'dist' / 'data'
GEO_URL = 'https://gisco-services.ec.europa.eu/distribution/v2/lau/geojson/LAU_RG_01M_2024_4326.geojson'


def write(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))


def geometry(codes):
    cache = CACHE / 'dk-lau.geojson'
    if not cache.exists():
        with urllib.request.urlopen(GEO_URL, timeout=120) as response:
            data = json.load(response)
        data['features'] = [f for f in data['features'] if f['properties']['CNTR_CODE'] == 'DK']
        cache.write_text(json.dumps(data))
    features = json.loads(cache.read_text())['features']
    geoms = {f['properties']['GISCO_ID'].split('_')[1]: shape(f['geometry']) for f in features}
    assert set(geoms) == set(codes), 'Boundary/data area mismatch'
    names = {f['properties']['GISCO_ID'].split('_')[1]: f['properties']['LAU_NAME'] for f in features}
    projected = {c: transform(lambda x, y, z=None: (x * math.cos(math.radians(56)), -y), g)
                 for c, g in geoms.items()}
    x0 = min(g.bounds[0] for g in projected.values())
    y0 = min(g.bounds[1] for g in projected.values())
    x1 = max(g.bounds[2] for g in projected.values())
    y1 = max(g.bounds[3] for g in projected.values())
    scale = min(800 / (x1 - x0), 620 / (y1 - y0))
    dx = (900 - (x1 - x0) * scale) / 2
    dy = (720 - (y1 - y0) * scale) / 2
    result = []
    for code in codes:
        geom = transform(lambda x, y, z=None: ((x - x0) * scale + dx, (y - y0) * scale + dy), projected[code])
        geom = geom.simplify(.22, preserve_topology=True)
        polygons = list(geom.geoms) if geom.geom_type == 'MultiPolygon' else [geom]
        largest = max(polygons, key=lambda g: g.area)
        centre = largest.representative_point()
        parts = []
        for polygon in polygons:
            for ring in [polygon.exterior] + list(polygon.interiors):
                coords = list(ring.coords)
                parts.append('M' + 'L'.join(f'{x:.2f},{y:.2f}' for x, y in coords) + 'Z')
        result.append({'code': code, 'name': names[code], 'x': round(centre.x, 2),
                       'y': round(centre.y, 2), 'path': ''.join(parts)})
    return result


def age_index(age):
    n = int(age)
    for i, (_, lo, hi) in enumerate(AGE_BANDS):
        if lo <= n <= hi:
            return i
    raise ValueError('Unexpected age: ' + str(age))


def summary_for(matrix, population):
    """matrix[origin,destination,age,sex]; summaries[sex][age/all][area]."""
    result = []
    for s in [None, 0, 1]:
        by_age = matrix.sum(axis=3) if s is None else matrix[:, :, :, s]
        pop = None if population is None else (population.sum(axis=2) if s is None else population[:, :, s])
        bands = []
        for a in [None] + list(range(8)):
            network = by_age.sum(axis=2) if a is None else by_age[:, :, a]
            pops = None if pop is None else (pop.sum(axis=1) if a is None else pop[:, a])
            arrivals, departures = network.sum(axis=0), network.sum(axis=1)
            assert arrivals.sum() == departures.sum()
            bands.append([[int(arrivals[i]), int(departures[i]), None if pops is None else int(pops[i])]
                          for i in range(len(arrivals))])
        result.append(bands)
    return result


def communities(matrix):
    result = []
    for s in [None, 0, 1]:
        by_age = matrix.sum(axis=3) if s is None else matrix[:, :, :, s]
        bands = []
        for a in [None] + list(range(8)):
            network = by_age.sum(axis=2) if a is None else by_age[:, :, a]
            graph = nx.from_numpy_array(network + network.T)
            if graph.number_of_edges():
                groups = nx.community.louvain_communities(graph, weight='weight', seed=42)
            else:
                groups = [{i} for i in range(len(network))]
            groups.sort(key=lambda group: (-sum(graph.degree(i, weight='weight') for i in group), min(group)))
            membership = [None] * len(network)
            for group_id, members in enumerate(groups):
                for i in members:
                    membership[i] = group_id
            within = sum(int(network[i, j]) for i, j in zip(*np.nonzero(network)) if membership[i] == membership[j])
            bands.append({'membership': membership, 'within': within, 'total': int(network.sum())})
        result.append(bands)
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = metadata('FLY66')
    assert str(meta.get('suppressedDataValue')) == '0', 'Recheck BULK omitted-cell semantics'
    codes = sorted(v['id'] for v in values(meta, 'FRAKOMMUNE'))
    index = {code: i for i, code in enumerate(codes)}
    years = [v['id'] for v in values(meta, 'Tid')]
    assert len(codes) == 99
    n = len(codes)
    population = {}
    totals = {}
    seen = set()
    for row in read_csv('population'):
        key = (row['OMRÅDE'], row['KØN'], row['ALDER'], row['TID'])
        assert key not in seen, 'Duplicate population row'
        seen.add(key)
        c, s, a, period = key
        assert period.endswith('K1') and row['CIVILSTAND'] == 'TOT'
        year = period[:4]
        i, sex, count = index[c], {'1': 0, '2': 1}[s], int(row['INDHOLD'])
        population.setdefault(year, np.zeros((n, 8, 2), dtype=np.int64))
        totals.setdefault(year, np.zeros((n, 2), dtype=np.int64))
        if a == 'IALT':
            totals[year][i, sex] = count
        else:
            population[year][i, age_index(a), sex] += count
    for year in population:
        assert np.array_equal(population[year].sum(axis=1), totals[year]), 'Population age reconciliation failed'
        assert (totals[year] > 0).all()
    histories, audit = {}, []
    routes = {code: [] for code in codes}
    (OUT / 'routes').mkdir(exist_ok=True)
    for year in years:
        matrix = np.zeros((n, n, 8, 2), dtype=np.int64)
        raw_count = 0
        seen = set()
        for row in read_csv('flows-' + year):
            key = (row['FRAKOMMUNE'], row['TILKOMMUNE'], row['ALDER'], row['KØN'])
            assert key not in seen, 'Duplicate flow row'
            seen.add(key)
            origin, destination, age, sex = key
            assert row['TID'] == year
            i, j, a, s = index[origin], index[destination], age_index(age), {'M': 0, 'K': 1}[sex]
            count = int(row['INDHOLD'])
            assert i != j or count == 0, 'Unexpected within-municipality move'
            matrix[i, j, a, s] += count
            raw_count += count
        checks = read_csv('audit-' + year)
        assert len(checks) == n * 2
        for row in checks:
            i, j, s = index[row['FRAKOMMUNE']], index[row['TILKOMMUNE']], {'M': 0, 'K': 1}[row['KØN']]
            assert matrix[i, j, :, s].sum() == int(row['INDHOLD']), 'Independent CSV audit failed'
        assert raw_count == matrix.sum()
        rows = [[int(i), int(j), int(a), int(matrix[i, j, a, 0]), int(matrix[i, j, a, 1])]
                for i, j, a in zip(*np.nonzero(matrix.sum(axis=3)))]
        for i, j, a, men, women in rows:
            routes[codes[i]].append([int(year), j, a, men, women])
        groups = communities(matrix)
        histories[year] = summary_for(matrix, population.get(year))
        write(year + '.json', {'year': int(year), 'flows': rows, 'communities': groups})
        audit.append({'year': int(year), 'sourceRows': len(seen), 'moves': raw_count, 'routeChecks': len(checks)})
        print(year, raw_count, 'moves;', len(rows), 'compact rows', flush=True)
    for code, rows in routes.items():
        write('routes/' + code + '.json', rows)
    areas = geometry(codes)
    english = {v['id']: v['text'].removeprefix('From ') for v in values(meta, 'FRAKOMMUNE')}
    for area in areas:
        area['english'] = english[area['code']]
    imported = json.loads((CACHE / 'import.json').read_text())
    write('manifest.json', {'schema': 1, 'years': list(map(int, years)), 'ages': [a[0] for a in AGE_BANDS],
        'areas': areas, 'sourceUpdated': meta['updated'], 'fetchedAt': imported['fetched_at'],
        'populationUpdated': metadata('FOLK1A')['updated'], 'mapYear': 2024,
        'sources': {'flows': 'https://www.statbank.dk/FLY66', 'population': 'https://www.statbank.dk/FOLK1A',
                    'geometry': GEO_URL}, 'audit': audit})
    write('summary.json', histories)
    write('audit.json', {'years': audit, 'populationYears': sorted(population),
        'method': 'BULK single ages grouped into disjoint age bands; omitted combinations are zero under StatBank API semantics. Explicit missing values rejected. All Copenhagen-origin routes independently reconciled against CSV source aggregates for both sexes and every year.',
        'networkx': nx.__version__, 'communityAlgorithm': 'Louvain, undirected sum of both directions, resolution=1, seed=42'})
    print('Built', len(years), 'years; total JSON MB:', round(sum(p.stat().st_size for p in OUT.glob('*.json')) / 1e6, 2))


if __name__ == '__main__':
    main()
