"""Download the entire FLY66 time range without credentials.

BULK keeps the full time series within the API contract. Missing combinations
are zero as documented by StatBank; explicit missing values are rejected.
"""
import argparse
import concurrent.futures
import csv
import gzip
import io
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache'
API = 'https://api.statbank.dk/v1/'
AGE_BANDS = [('0-17', 0, 17), ('18-24', 18, 24), ('25-29', 25, 29),
             ('30-39', 30, 39), ('40-49', 40, 49), ('50-64', 50, 64),
             ('65-79', 65, 79), ('80+', 80, 125)]


def request(endpoint, payload):
    body = json.dumps(payload).encode()
    for attempt in range(5):
        req = urllib.request.Request(API + endpoint, data=body,
            headers={'Content-Type': 'application/json', 'User-Agent': 'DenmarkInMotion/1.0 (public StatBank analysis)'})
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise RuntimeError(str(error) + ': ' + error.read().decode()[:1000])
        except (urllib.error.URLError, TimeoutError):
            if attempt == 4:
                raise
        time.sleep(2 ** attempt)


def metadata(table, refresh=False):
    path = CACHE / (table + '-metadata.json')
    if refresh or not path.exists():
        path.write_bytes(request('tableinfo', {'table': table, 'format': 'JSON', 'lang': 'en'}))
    return json.loads(path.read_text())


def values(meta, code):
    return next(v['values'] for v in meta['variables'] if v['id'].upper() == code.upper())


def age_values(population=False):
    result = [f'sum(a{i}|{label}=' + ';'.join(map(str, range(lo, hi + 1))) + ')'
              for i, (label, lo, hi) in enumerate(AGE_BANDS)]
    # FOLK1A includes its own total; summing '*' there would double count.
    result.append('sum(all|All ages=IALT)' if population else 'sum(all|All ages=*)')
    return result


def fetch_csv(name, table, variables, refresh=False, fmt="BULK"):
    payload = {'table': table, 'format': fmt, 'lang': 'en',
               'valuePresentation': 'Code', 'variables': variables}
    path = CACHE / (name + '.csv.gz')
    query = CACHE / (name + '-query.json')
    if path.exists() and query.exists() and not refresh and json.loads(query.read_text()) == payload:
        return
    raw = request('data', payload)
    rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig')), delimiter=';'))
    if not rows or 'INDHOLD' not in rows[0]:
        raise RuntimeError('Unexpected CSV response: ' + raw[:300].decode())
    for row in rows:
        if not row['INDHOLD'].isdigit():
            raise RuntimeError('Missing or suppressed cell; refusing to treat it as zero: ' + str(row))
    temp = path.with_suffix('.tmp')
    with gzip.open(temp, 'wb') as handle:
        handle.write(raw)
    temp.replace(path)
    query.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(name, len(rows), 'source cells', flush=True)


def read_csv(name):
    with gzip.open(CACHE / (name + '.csv.gz'), 'rt', encoding='utf-8-sig') as handle:
        return list(csv.DictReader(handle, delimiter=';'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    CACHE.mkdir(exist_ok=True)
    flow = metadata('FLY66', args.refresh)
    pop = metadata('FOLK1A', args.refresh)
    years = [v['id'] for v in values(flow, 'Tid')]
    area_ids = [v['id'] for v in values(flow, 'FRAKOMMUNE')]
    def fetch_year(year):
        fetch_csv(f'flows-{year}', 'FLY66', [
            {'code': 'TILKOMMUNE', 'values': ['*']},
            {'code': 'FRAKOMMUNE', 'values': ['*']},
            {'code': 'ALDER', 'values': ['*']},
            {'code': 'KØN', 'values': ['*']},
            {'code': 'Tid', 'values': [year]},
        ], args.refresh)
        # Independently reconcile every route from Copenhagen with a normal
        # CSV query summed by the source, including explicit zero rows.
        fetch_csv(f'audit-{year}', 'FLY66', [
            {'code': 'TILKOMMUNE', 'values': ['*']},
            {'code': 'FRAKOMMUNE', 'values': ['101']},
            {'code': 'ALDER', 'values': ['sum(all|All ages=*)']},
            {'code': 'KØN', 'values': ['*']},
            {'code': 'Tid', 'values': [year]},
        ], args.refresh, fmt='CSV')

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(fetch_year, reversed(years)))
    available = {v['id'] for v in values(pop, 'Tid')}
    periods = [year + 'K1' for year in years if year + 'K1' in available]
    fetch_csv('population', 'FOLK1A', [
        {'code': 'OMRÅDE', 'values': area_ids},
        {'code': 'KØN', 'values': ['1', '2']},
        {'code': 'ALDER', 'values': ['*']},
        {'code': 'CIVILSTAND', 'values': ['TOT']},
        {'code': 'Tid', 'values': periods},
    ], args.refresh)
    (CACHE / 'import.json').write_text(json.dumps({'fetched_at': datetime.now(timezone.utc).isoformat(),
        'years': years, 'population_periods': periods, 'source_updated': flow['updated']}, indent=2))
    print('Complete:', len(years), 'years,', len(area_ids), 'areas, both recorded sexes and all ages.', flush=True)


if __name__ == '__main__':
    main()
