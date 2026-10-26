"""Exercise actual mouse/wheel and Chromium touch input, not mocked gestures."""
import json
import math
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
areas=json.loads((ROOT/'dist/data/manifest.json').read_text())['areas']
by_code={a['code']:a for a in areas}
URL='http://127.0.0.1:4320/'
errors=[]
def ready(page):page.locator('#loading').wait_for(state='hidden')
def zoom(page):return float(page.locator('#map').get_attribute('data-zoom'))
def wait_zoom(page,value):page.wait_for_function('(v)=>Math.abs(Number(document.querySelector("#map").dataset.zoom)-v)<0.001',arg=value)
def transform(page):return page.locator('#mapContent').get_attribute('transform')
def position(page,code):
 return page.evaluate('a=>{const p=new DOMPoint(a.x,a.y).matrixTransform(document.querySelector("#mapContent").getScreenCTM());return {x:p.x,y:p.y}}',by_code[code])
def world_at(page,point):
 return page.evaluate('a=>{const p=new DOMPoint(a.x,a.y).matrixTransform(document.querySelector("#mapContent").getScreenCTM().inverse());return {x:p.x,y:p.y}}',point)
def reset(page):page.locator('#resetZoom').click();wait_zoom(page,1);page.wait_for_function('document.querySelector("#mapContent").getAttribute("transform")==="translate(0 0) scale(1)"')
def tap_points(cdp,kind,points,ids=None):
 cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'id':ids[i] if ids else i+1,'x':x,'y':y,'radiusX':4,'radiusY':4} for i,(x,y) in enumerate(points)]})

with sync_playwright() as p:
 browser=p.chromium.launch()
 context=browser.new_context(viewport={'width':1440,'height':1050})
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(URL,wait_until='domcontentloaded');ready(page);page.evaluate('document.fonts.ready')
 page.locator('#map').scroll_into_view_if_needed()
 point=position(page,'851');before=world_at(page,point);scroll=page.evaluate('scrollY')
 page.mouse.move(point['x'],point['y']);page.mouse.wheel(0,-37)
 wait_zoom(page,math.exp(.074));after=world_at(page,point)
 assert math.hypot(after['x']-before['x'],after['y']-before['y'])<.2, f'Wheel did not preserve cursor anchor: {before} -> {after}'
 assert page.evaluate('scrollY')==scroll, 'Map wheel scrolled the page'
 page.mouse.wheel(0,-66);wait_zoom(page,math.exp(.206))
 assert 1.22<zoom(page)<1.24, 'Zoom was snapped to a fixed level'
 # Drag from a different municipality, then deliberately click it.
 start=position(page,'851');old=transform(page)
 page.mouse.move(start['x'],start['y']);page.mouse.down();page.mouse.move(start['x']+80,start['y']+40,steps=12);page.mouse.up()
 assert transform(page)!=old
 assert page.locator('#area').input_value()=='751', 'Dragging selected a municipality'
 after=position(page,'851')
 assert abs(after['x']-start['x']-80)<1 and abs(after['y']-start['y']-40)<1, 'Drag did not follow the pointer'
 page.mouse.click(after['x'],after['y']);ready(page)
 assert page.locator('#area').input_value()=='851', 'Click after a drag was swallowed'
 view=transform(page)
 for key,value in [('year','2012'),('age','2'),('sex','1')]:
  page.locator('#'+key).select_option(value);ready(page);assert transform(page)==view, 'Filters reset the map'
 for tab in ['balance','groups','flows']:
  page.locator('#tab-'+tab).click();ready(page);assert transform(page)==view, 'View tab reset the map'
 # Controls, centre, stable symbol size, and keyboard equivalents.
 base_zoom=zoom(page)
 page.locator('#zoomBtn').click();wait_zoom(page,base_zoom*1.5)
 page.locator('#zoomOutBtn').click();wait_zoom(page,base_zoom)
 page.locator('#focusMap').click();wait_zoom(page,4)
 point=position(page,'851');bounds=page.locator('#map').bounding_box()
 assert abs(point['x']-(bounds['x']+bounds['width']/2))<1
 assert abs(point['y']-(bounds['y']+bounds['height']/2))<1
 label=page.locator('#points .selected-label')
 font=float(label.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)'))
 screen_scale=page.locator('#mapContent').evaluate('e=>e.getScreenCTM().a')
 assert abs(font*screen_scale-13)<.02, 'Labels grow with zoom'
 page.locator('#map').focus();page.keyboard.press('+');wait_zoom(page,6)
 old=transform(page);page.keyboard.press('ArrowRight')
 page.wait_for_function('(old)=>document.querySelector("#mapContent").getAttribute("transform")!==old',arg=old)
 page.keyboard.press('Home');wait_zoom(page,1)
 reset(page)
 bounds=page.locator('#map').bounding_box()
 page.mouse.dblclick(bounds['x']+bounds['width']*.85,bounds['y']+bounds['height']*.2);wait_zoom(page,2)
 # Wheel zoom remains finite and bounded after extreme input; reset recovers.
 for _ in range(12):page.mouse.wheel(0,-2000)
 wait_zoom(page,32);expect(page.locator('#zoomBtn')).to_be_disabled()
 reset(page);expect(page.locator('#zoomOutBtn')).to_be_disabled()
 # The map can also be moved at country scale.
 bounds=page.locator('#map').bounding_box();x=bounds['x']+bounds['width']*.85;y=bounds['y']+bounds['height']*.25
 page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-75,y+40,steps=8);page.mouse.up()
 assert transform(page)!='translate(0 0) scale(1)' and zoom(page)==1
 reset(page)
 page.locator('#area').select_option('101');ready(page);page.locator('#focusMap').click();wait_zoom(page,4)
 page.locator('#mapStage').screenshot(path=str(OUT/'map-navigation-desktop.png'))
 # Actual multitouch input: pinch + pan, transition to one finger, tap and cancel.
 mobile=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 mp=mobile.new_page();mp.on('pageerror',lambda e:errors.append(str(e)))
 mp.goto(URL,wait_until='domcontentloaded');ready(mp);mp.evaluate('document.fonts.ready');mp.locator('#map').scroll_into_view_if_needed()
 cdp=mobile.new_cdp_session(mp)
 bounds=mp.locator('#map').bounding_box();cx=bounds['x']+bounds['width']/2;cy=bounds['y']+bounds['height']/2
 touch_scroll=mp.evaluate('scrollY');before=world_at(mp,{'x':cx,'y':cy})
 tap_points(cdp,'touchStart',[(cx-35,cy),(cx+35,cy)])
 for step in range(1,9):
  spread=35+step*6
  tap_points(cdp,'touchMove',[(cx-spread+step*2,cy+step),(cx+spread+step*2,cy+step)])
 wait_zoom(mp,166/70)
 assert zoom(mp)>2, 'Pinch did not zoom'
 after=world_at(mp,{'x':cx+16,'y':cy+8})
 assert math.hypot(after['x']-before['x'],after['y']-before['y'])<1, f'Pinch midpoint drifted: {before} -> {after}, zoom {zoom(mp)}, transform {transform(mp)}'
 assert mp.evaluate('scrollY')==touch_scroll, 'Pinch moved the page'
 # Lift one finger and continue panning without a jump or accidental selection.
 remaining=(cx-83+16,cy+8)
 tap_points(cdp,'touchEnd',[(cx+83+16,cy+8)],ids=[2]);old=transform(mp)
 tap_points(cdp,'touchMove',[(remaining[0]+25,remaining[1]+18)])
 mp.wait_for_function('(old)=>document.querySelector("#mapContent").getAttribute("transform")!==old',arg=old)
 tap_points(cdp,'touchEnd',[])
 assert mp.locator('#area').input_value()=='751'
 mp.locator('#resetZoom').tap();wait_zoom(mp,1)
 point=position(mp,'851');mp.touchscreen.tap(point['x'],point['y']);ready(mp)
 assert mp.locator('#area').input_value()=='851', 'Touch tap did not select municipality'
 # A one-finger pan is supported, including cancellation and a fresh gesture.
 point=position(mp,'751');tap_points(cdp,'touchStart',[(point['x'],point['y'])])
 tap_points(cdp,'touchMove',[(point['x']+30,point['y']+25)])
 tap_points(cdp,'touchCancel',[])
 assert 'is-dragging' not in (mp.locator('#map').get_attribute('class') or '')
 assert mp.locator('#area').input_value()=='851'
 mp.locator('#focusMap').tap();wait_zoom(mp,4)
 mp.locator('#mapStage').screenshot(path=str(OUT/'map-navigation-mobile.png'))
 label_size=mp.locator('#points .selected-label').evaluate('e=>parseFloat(getComputedStyle(e).fontSize)*e.getScreenCTM().a')
 assert abs(label_size-13)<.02, 'Mobile label text is not legible'
 assert mp.evaluate('document.documentElement.scrollWidth <= innerWidth')
 # Reduced-motion users get immediate changes, with the same navigation.
 reduced=browser.new_context(reduced_motion='reduce');rp=reduced.new_page();rp.goto(URL,wait_until='domcontentloaded');ready(rp)
 rp.locator('#zoomBtn').click();assert zoom(rp)==1.5
 rp.locator('#resetZoom').click();assert zoom(rp)==1
 assert not errors,errors
 browser.close()
print('PASS: continuous cursor-anchored wheel zoom, free mouse/touch pan, real pinch, gesture transitions/cancellation, selection vs dragging, persistent viewport, controls, keyboard, zoom bounds and reduced motion.')
