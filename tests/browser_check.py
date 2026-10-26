"""End-to-end checks against a locally served, fully built snapshot."""
import csv
import io
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
manifest=json.loads((ROOT/'dist/data/manifest.json').read_text())
summary=json.loads((ROOT/'dist/data/summary.json').read_text())
idx={a['code']:i for i,a in enumerate(manifest['areas'])}
URL=os.environ.get('MOTION_TEST_URL','http://127.0.0.1:4320/')
errors=[]
def ready(page):page.locator('#loading').wait_for(state='hidden')
def select(page,key,value):page.locator('#'+key).select_option(str(value));ready(page)
def check_stats(page,area,year,age,sex):
 r=summary[str(year)][sex][age][idx[area]]
 vals=page.locator('#insight .stat strong').all_text_contents()
 assert vals[:2]==[f'{r[0]:,}',f'{r[1]:,}'],(vals,r)

def download(page):
 with page.expect_download() as result:page.locator('#downloadBtn').click()
 return list(csv.DictReader(io.StringIO(Path(result.value.path()).read_text(encoding='utf-8-sig'))))

with sync_playwright() as p:
 browser=p.chromium.launch()
 context=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True)
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(URL,wait_until='domcontentloaded');ready(page)
 assert page.locator('.municipality').count()==99
 assert page.locator('#year option').count()==20
 check_stats(page,'751',2025,0,0)
 page.screenshot(path=str(OUT/'desktop.png'),full_page=True)
 # A known route independently reconciled to CSV source sums.
 select(page,'area','101');check_stats(page,'101',2025,0,0)
 expect(page.locator('#insight')).to_contain_text('6,683')
 page.locator('[data-route="'+str(idx['147'])+'"]').first.click()
 expect(page.locator('#routeDialog')).to_be_visible()
 page.locator('#routeTrend svg').wait_for()
 expect(page.locator('#routeBody .stats')).to_contain_text('6,683')
 assert page.locator('#routeHistoryTable tbody tr').count()==20
 page.keyboard.press('Escape');expect(page.locator('#routeDialog')).not_to_be_visible()
 # The complete partner list includes small connections as well as the top six.
 page.locator('.all-connections summary').click()
 assert page.locator('.all-connections [data-route]').count()==98
 page.locator('.all-connections [data-route]').last.click()
 page.locator('#routeTrend svg').wait_for()
 page.keyboard.press('Escape')
 # Direction and every data filter.
 page.locator('[data-direction="in"]').click();ready(page)
 expect(page.locator('#mapHeading')).to_contain_text('Arriving in Copenhagen')
 select(page,'age',2);select(page,'sex',2);select(page,'year',2010)
 check_stats(page,'101',2010,2,2)
 rows=download(page)
 assert rows and all(r['destination_code']=='101' and r['year']=='2010' and r['sex']=='women' for r in rows)
 assert sum(int(r['moves']) for r in rows)==summary['2010'][2][2][idx['101']][0]
 # URL preserves filters in a fresh page.
 other=context.new_page();other.goto(page.url,wait_until='domcontentloaded');ready(other)
 assert other.locator('#age').input_value()=='2' and other.locator('#sex').input_value()=='2'
 check_stats(other,'101',2010,2,2);other.close()
 # Population rates and the genuinely unavailable 2006 denominator.
 page.locator('#tab-balance').click();ready(page)
 page.locator('[data-unit="rate"]').click();ready(page)
 expected=(summary['2010'][2][2][idx['101']][0]-summary['2010'][2][2][idx['101']][1])/summary['2010'][2][2][idx['101']][2]*1000
 assert f'{abs(expected):.1f}' in page.locator('#insight h3').inner_text()
 rows=download(page);assert len(rows)==99 and 'net_moves_per_1000' in rows[0]
 select(page,'year',2006)
 expect(page.locator('[data-unit="rate"]')).to_be_disabled()
 assert 'rates start in 2008' in page.locator('#insight').inner_text()
 rows=download(page);assert all(r['population_jan_1']=='' and r['net_moves_per_1000']=='' for r in rows)
 # Entire year range is reachable and data is real.
 select(page,'year',2025);select(page,'age',0);select(page,'sex',0)
 page.locator('[data-unit="rate"]').click();ready(page)
 page.screenshot(path=str(OUT/'balance.png'),full_page=True)
 # Groups and their CSV carry membership as well as flows.
 page.locator('#tab-groups').click();ready(page)
 expect(page.locator('#insight')).to_contain_text('group of')
 rows=download(page);assert rows and 'same_group' in rows[0]
 assert len(set(page.locator('.municipality').evaluate_all('(els)=>els.map(e=>e.style.fill)')))>2
 page.screenshot(path=str(OUT/'groups.png'),full_page=True)
 # Tab keyboard behaviour and geographic selection.
 page.locator('#tab-groups').focus();page.keyboard.press('ArrowRight');ready(page)
 expect(page.locator('#tab-flows')).to_have_attribute('aria-selected','true')
 page.locator('.municipality[data-i="'+str(idx['851'])+'"]').dispatch_event('click');ready(page)
 assert page.locator('#area').input_value()=='851'
 page.locator('#zoomBtn').click();page.wait_for_function('Number(document.querySelector("#map").dataset.zoom)>1.4')
 page.locator('#resetZoom').click();page.wait_for_function('document.querySelector("#mapContent").getAttribute("transform")==="translate(0 0) scale(1)"')
 # Narrative presets are live queries, not disconnected text.
 page.locator('[data-preset="young"]').click();ready(page);check_stats(page,'751',2025,2,0)
 page.locator('[data-preset="thirties"]').click();ready(page);check_stats(page,'101',2025,4,0)
 page.locator('#ageChart [data-age="2"]').click();ready(page);check_stats(page,'101',2025,2,0)
 page.locator('#trendChart [data-year="2008"]').click();ready(page);check_stats(page,'101',2008,2,0)
 page.locator('#aboutBtn').click();expect(page.locator('#aboutDialog')).to_be_visible()
 assert 'non-commercial' in page.locator('#aboutDialog').inner_text()
 page.keyboard.press('Escape')
 # No-population subgroups remain unavailable, never infinity/NaN.
 select(page,'area','411');select(page,'age',8);page.locator('#tab-balance').click();ready(page)
 page.locator('[data-unit="rate"]').click();ready(page)
 assert 'NaN' not in page.locator('#insight').inner_text() and 'Infinity' not in page.locator('#insight').inner_text()
 # Small mobile viewport and real touch controls.
 mobile=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
 mp=mobile.new_page();mp.on('pageerror',lambda e:errors.append(str(e)))
 mp.goto(URL,wait_until='domcontentloaded');ready(mp)
 assert mp.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile horizontal overflow'
 mp.screenshot(path=str(OUT/'mobile.png'),full_page=True)
 select(mp,'area','101');select(mp,'age',4);check_stats(mp,'101',2025,4,0)
 mp.locator('#tab-groups').tap();ready(mp)
 mp.locator('#aboutBtn').tap();expect(mp.locator('#aboutDialog')).to_be_visible()
 mp.locator('#aboutDialog [data-close]').tap()
 assert not errors,errors
 browser.close()
print('PASS: desktop + mobile; source counts, directions, filters, routes, history, URL restore, rates, missing denominators, groups, downloads, keyboard tabs and map selection. No page errors.')
