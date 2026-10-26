"""Check the shipped snapshot, independently of the importer/build pipeline."""
import json
from pathlib import Path
import numpy as np

root=Path(__file__).resolve().parents[1]/'dist'/'data'
load=lambda name:json.loads((root/name).read_text())
m=load('manifest.json'); h=load('summary.json'); audit=load('audit.json')
assert m['years']==list(range(2006,2026))
assert len(m['areas'])==99 and len({a['code'] for a in m['areas']})==99
assert all(a['path'] and a['english'] for a in m['areas'])
assert '411' in [a['code'] for a in m['areas']]
route_totals={}
for year in m['years']:
    d=load(f'{year}.json'); a=np.zeros((99,99,8,2),dtype=np.int64)
    seen=set()
    for i,j,age,men,women in d['flows']:
        assert i!=j and 0<=age<8 and min(men,women)>=0 and men+women>0
        assert (i,j,age) not in seen
        seen.add((i,j,age));a[i,j,age]=[men,women]
    assert int(a.sum())==next(r['moves'] for r in audit['years'] if r['year']==year)
    for sex in range(3):
        cube=a.sum(axis=3) if sex==0 else a[:,:,:,sex-1]
        for band in range(9):
            matrix=cube.sum(axis=2) if band==0 else cube[:,:,band-1]
            summary=h[str(year)][sex][band]
            assert [r[0] for r in summary]==matrix.sum(axis=0).tolist()
            assert [r[1] for r in summary]==matrix.sum(axis=1).tolist()
            assert sum(r[0]-r[1] for r in summary)==0
            assert all(r[2] is None if year<2008 else r[2]>=0 for r in summary)
            community=d['communities'][sex][band]
            labels=np.array(community['membership'])
            assert len(labels)==99 and all(x is not None for x in labels)
            assert int(matrix[labels[:,None]==labels[None,:]].sum())==community['within']
            assert int(matrix.sum())==community['total']
    # The all-age population equals the sum of the eight age groups.
    if year>=2008:
        for sex in range(3):
            for i in range(99):
                assert h[str(year)][sex][0][i][2]==sum(h[str(year)][sex][a][i][2] for a in range(1,9))
    for i,area in enumerate(m['areas']):
        route_totals[(year,area['code'])]=int(a[i].sum())
for area in m['areas']:
    totals={year:0 for year in m['years']}
    for year,j,band,men,women in load('routes/'+area['code']+'.json'):totals[year]+=men+women
    assert all(totals[year]==route_totals[(year,area['code'])] for year in m['years'])
assert all(p.stat().st_size<25*1024*1024 for p in root.rglob('*.json'))
print('PASS: all 20 years, 99 areas, 540 filtered networks, source totals, populations, communities and 99 route histories.')
print('Snapshot:',round(sum(p.stat().st_size for p in root.rglob('*') if p.is_file())/1e6,2),'MB uncompressed')
