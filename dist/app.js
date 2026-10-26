import {matrixFor,statsFor,netRate,partnersFor,routeSeries} from './model.mjs';
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('en-GB').format(Math.round(n));
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const decimal = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1);
const pct = (part,whole) => whole ? (100*part/whole).toFixed(1)+'%' : '0%';
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const palette = ['#539883','#b78b59','#6f8fb3','#b97c87','#8c86ab','#89a454','#c29568','#599f9f','#a28e72','#9f9fb8'];
const state = {area:'751',year:2025,age:0,sex:0,view:'flows',direction:'out',unit:'count'};
let manifest, history, current, matrix, selected=0, renderId=0, zoomed=false, routeRenderId=0;
const yearCache = new Map(), routeCache = new Map();
const name = i => manifest.areas[i].english;
const ageName = () => state.age ? 'ages '+manifest.ages[state.age-1].replace('-', '–') : 'all ages';
const sexName = () => ['everyone','men','women'][state.sex];
const scope = () => `${state.year} · ${ageName()} · ${sexName()}`;
const metric = (row, unit=state.unit) => unit==='rate' ? netRate(...row) : row[0]-row[1];
const getSummary = (year=state.year, age=state.age) => history[year][state.sex][age];
async function getJSON(path) { const r=await fetch(path); if(!r.ok) throw new Error(`Could not load ${path} (${r.status})`); return r.json(); }
function getYear(year) { if(!yearCache.has(year)) yearCache.set(year,getJSON(`data/${year}.json`).catch(e=>{yearCache.delete(year);throw e;})); return yearCache.get(year); }
function getRoutes(code) { if(!routeCache.has(code)) routeCache.set(code,getJSON(`data/routes/${code}.json`).catch(e=>{routeCache.delete(code);throw e;})); return routeCache.get(code); }
function readHash() {
  if(!manifest)return;
  const h=new URLSearchParams(location.hash.slice(1));
  const candidate={...state};
  if(manifest.areas.some(a=>a.code===h.get('area'))) candidate.area=h.get('area');
  for(const [key,valid] of Object.entries({year:manifest.years,age:[0,1,2,3,4,5,6,7,8],sex:[0,1,2]}))
    if(h.has(key)&&valid.includes(Number(h.get(key))))candidate[key]=Number(h.get(key));
  if(['flows','balance','groups'].includes(h.get('view')))candidate.view=h.get('view');
  if(['in','out'].includes(h.get('direction')))candidate.direction=h.get('direction');
  if(['count','rate'].includes(h.get('unit')))candidate.unit=h.get('unit');
  Object.assign(state,candidate);
}
function updateHash() { const h=new URLSearchParams(Object.entries(state)).toString(); window.history.replaceState(null,'','#'+h); }
function toast(message) { $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4200); }
function syncControls() {
  for(const key of ['area','year','age','sex'])$(key).value=state[key];
  $('yearRange').value=state.year;$('rangeValue').textContent=state.year;
  document.querySelectorAll('[data-view]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.view===state.view));b.tabIndex=b.dataset.view===state.view?0:-1;});
  $('panel').setAttribute('aria-labelledby','tab-'+state.view);
}
async function render() {
  const id=++renderId;
  selected=manifest.areas.findIndex(a=>a.code===state.area);
  if(state.year<2008&&state.unit==='rate')state.unit='count';
  syncControls();updateHash();$('loading').textContent='Loading '+state.year+'…';$('loading').hidden=false;
  try { const data=await getYear(state.year);if(id!==renderId)return;current=data;matrix=matrixFor(data.flows,manifest.areas.length,state.age,state.sex);renderMap();renderInsight();renderDetails();$('loading').hidden=true; }
  catch(error){if(id!==renderId)return;$('loading').innerHTML=`<div><p>This year could not be loaded.</p><button class="primary-btn" id="retry">Try again</button></div>`;$('retry').onclick=render;$('insight').innerHTML='<p>Please retry to load the selected data.</p>';console.error(error);}
}
function chooseArea(i) { state.area=manifest.areas[i].code;render(); }
function mapFill(i,partners,maximum) {
  if(state.view==='flows') {
    if(i===selected)return '#1e655a';
    const found=partners.find(p=>p.i===i);
    if(found) return blend('#d5dfd8','#8baea2',Math.sqrt(found.count/maximum));
    return '#d5dfd8';
  }
  if(state.view==='groups')return palette[current.communities[state.sex][state.age].membership[i]%palette.length];
  const value=metric(getSummary()[i]);
  if(value===null)return '#d3d8d5';
  return blend('#e4e8df',value>=0?'#287e6c':'#bf7256',Math.sqrt(Math.min(1,Math.abs(value)/maximum)));
}
function blend(a,b,t){const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const x=rgb(a),y=rgb(b);return '#'+x.map((v,i)=>Math.round(v+(y[i]-v)*t).toString(16).padStart(2,'0')).join('');}
function renderMap() {
  const partners=partnersFor(matrix,selected,state.direction),max=state.view==='balance'?Math.max(...getSummary().map(row=>Math.abs(metric(row)||0)),1):(partners[0]?.count||1);
  $('mapHeading').textContent=state.view==='flows'?`${state.direction==='out'?'Leaving':'Arriving in'} ${name(selected)}`:state.view==='balance'?'The domestic migration balance':'Denmark’s circles of connection';
  $('mapKicker').textContent=state.view==='flows'?'THE STRONGEST CONNECTIONS · '+state.year:state.view==='balance'?'ARRIVALS MINUS DEPARTURES · '+state.year:'GROUPS BASED ON MOVES · '+state.year;
  if(state.view==='flows')$('mapSwitch').innerHTML=`<button data-direction="out" aria-pressed="${state.direction==='out'}">Departures</button><button data-direction="in" aria-pressed="${state.direction==='in'}">Arrivals</button>`;
  else if(state.view==='balance')$('mapSwitch').innerHTML=`<button data-unit="count" aria-pressed="${state.unit==='count'}">Moves</button><button data-unit="rate" aria-pressed="${state.unit==='rate'}" ${state.year<2008?'disabled title="Population denominators begin in 2008"':''}>Per 1,000</button>`;
  else $('mapSwitch').innerHTML='';
  $('mapSwitch').hidden=state.view==='groups';
  $('land').innerHTML=manifest.areas.map((a,i)=>`<path class="municipality ${i===selected?'selected':''}" data-i="${i}" d="${a.path}" fill-rule="evenodd" style="fill:${mapFill(i,partners,max)}"><title>${esc(name(i))}</title></path>`).join('');
  $('routes').innerHTML='';
  if(state.view==='flows') {
    $('routes').innerHTML=partners.slice(0,8).reverse().map(p=>{
      const from=manifest.areas[state.direction==='out'?selected:p.i],to=manifest.areas[state.direction==='out'?p.i:selected];
      const dx=to.x-from.x,dy=to.y-from.y;
      return `<path class="route-line" d="M${from.x},${from.y} Q${(from.x+to.x)/2-dy*.18},${(from.y+to.y)/2+dx*.18} ${to.x},${to.y}" stroke-width="${1+3*Math.sqrt(p.count/max)}" marker-end="url(#arrow)"/>`;
    }).join('');
  }
  const labels=[selected];
  const candidates=state.view==='flows'?partners.slice(0,8).map(p=>p.i):['751','851','461','561','400'].map(code=>manifest.areas.findIndex(a=>a.code===code));
  for(const i of candidates)if(i>=0&&!labels.includes(i)&&labels.every(j=>Math.hypot(manifest.areas[i].x-manifest.areas[j].x,manifest.areas[i].y-manifest.areas[j].y)>70))labels.push(i);
  $('points').innerHTML=labels.map(i=>{const a=manifest.areas[i],chosen=i===selected;return `<circle cx="${a.x}" cy="${a.y}" r="${chosen?5:3}" fill="${chosen?'#19343c':'#427c91'}" stroke="#fff" stroke-width="1.6" pointer-events="none"/><text x="${a.x}" y="${a.y-11}" text-anchor="middle" class="map-label ${chosen?'selected-label':''}">${esc(name(i))}</text>`;}).join('');
  if(state.view==='flows')$('legend').innerHTML='<span><i style="background:#1e655a"></i>Selected place</span><span><i style="background:#427c91"></i>Top 8 flows · thicker = more moves</span>';
  else if(state.view==='balance')$('legend').innerHTML='<span><i style="background:#bf7256"></i>Net loss</span><span><i style="background:#e4e8df"></i>Balanced</span><span><i style="background:#287e6c"></i>Net gain</span>';
  else $('legend').innerHTML='<span>Same colour = more closely connected through moves</span>';
  applyZoom();
}
function applyZoom(){const a=manifest.areas[selected];$('map').setAttribute('viewBox',zoomed?`${a.x-145} ${a.y-116} 290 232`:'0 0 900 720');$('zoomBtn').setAttribute('aria-pressed',String(zoomed));}
function statsMarkup(row) { const net=row[0]-row[1];return `<div class="stats"><div class="stat"><span>ARRIVALS</span><strong>${fmt(row[0])}</strong></div><div class="stat"><span>DEPARTURES</span><strong>${fmt(row[1])}</strong></div><div class="stat net"><span>NET DOMESTIC MOVES</span><strong class="${net>=0?'positive':'negative'}">${signed(net)}</strong></div></div>`; }
function ranking(rows,kind='route',limit=6) {
  const max=Math.max(...rows.map(r=>Math.abs(r.count)),1);
  return `<ol class="rank-list">${rows.slice(0,limit).map((r,index)=>`<li><button data-${kind}="${r.i}" aria-label="${kind==='route'?'Inspect connection with':'Select'} ${esc(name(r.i))}"><span class="rank">${String(index+1).padStart(2,'0')}</span><span class="rank-name">${esc(name(r.i))}<i class="rank-bar" style="width:${Math.abs(r.count)/max*90}%"></i></span><strong class="${kind==='place'?(r.count>=0?'positive':'negative'):''}">${kind==='place'?(state.unit==='rate'?decimal(r.count):signed(r.count)):fmt(r.count)}</strong></button></li>`).join('')}</ol>`;
}
function renderInsight() {
  const row=getSummary()[selected],net=row[0]-row[1],area=esc(name(selected));
  if(state.view==='flows') {
    const partners=partnersFor(matrix,selected,state.direction),first=partners[0],total=state.direction==='out'?row[1]:row[0];
    const headline=net===0?`${area} is in balance.`:net>0?`${area} receives more movers than it sends.`:`${area} sends more movers than it receives.`;
    $('insight').innerHTML=`<p class="eyebrow">THE STORY · ${esc(ageName().toUpperCase())}</p><h3>${headline}</h3><p>${first?`<strong>${esc(name(first.i))}</strong> is the largest ${state.direction==='out'?'destination':'origin'}: <strong>${fmt(first.count)} moves</strong>, or ${pct(first.count,total)} of ${state.direction==='out'?'departures':'arrivals'}.`:'No intermunicipal moves were recorded for this selection.'}</p>${statsMarkup(row)}<h4 class="section-label">${state.direction==='out'?'TOP DESTINATIONS':'TOP ORIGINS'}</h4>${ranking(partners)}${partners.length>6?`<details class="all-connections"><summary>All ${partners.length} ${state.direction==='out'?'destinations':'origins'}</summary><div>${ranking(partners,'route',99)}</div></details>`:''}<p class="aside-note">${esc(scope())}<br>Select a connection to compare both directions.</p>`;
  } else if(state.view==='balance') {
    const rows=getSummary().map((r,i)=>({i,count:metric(r)})).filter(r=>r.count!==null).sort((a,b)=>b.count-a.count),rank=rows.findIndex(r=>r.i===selected)+1,value=metric(row);
    $('insight').innerHTML=`<p class="eyebrow">THE STORY · ${esc(ageName().toUpperCase())}</p><h3>${area}: ${value===null?'no rate available':(state.unit==='rate'?decimal(value):signed(value))} ${state.unit==='rate'?'per 1,000.':'net moves.'}</h3><p>${value===null?'No matching population denominator is available.':`Ranks <strong>${rank} of ${rows.length}</strong> from highest gain to greatest loss, ${state.unit==='rate'?'relative to its population':'by number of moves'}. This covers domestic migration only.`}</p>${statsMarkup(row)}<h4 class="section-label">LARGEST ${state.unit==='rate'?'RELATIVE ':''}GAINS</h4>${ranking(rows,'place',3)}<h4 class="section-label" style="margin-top:18px">LARGEST ${state.unit==='rate'?'RELATIVE ':''}LOSSES</h4>${ranking([...rows].reverse(),'place',3)}<p class="aside-note">${state.year<2008?'Per-1,000 rates start in 2008.':state.unit==='rate'?'Per 1,000 residents of the same age and sex at 1 January. Small populations can produce large rates.':'Switch to “Per 1,000” to account for population size.'}<br>${esc(scope())}</p>`;
  } else {
    const c=current.communities[state.sex][state.age],group=c.membership[selected],members=c.membership.map((g,i)=>g===group?i:-1).filter(i=>i>=0);
    let inside=0,total=0;for(const i of members)for(let j=0;j<matrix.length;j++){total+=matrix[i][j];if(c.membership[j]===group)inside+=matrix[i][j];}
    const connected=members.filter(i=>i!==selected).map(i=>({i,count:matrix[i][selected]+matrix[selected][i]})).sort((a,b)=>b.count-a.count).filter(r=>r.count>0);
    $('insight').innerHTML=`<p class="eyebrow"><span class="group-swatch" style="background:${palette[group%palette.length]}"></span>A CIRCLE OF CONNECTION</p><h3>${area} belongs to a group of ${members.length} places.</h3><p><strong>${pct(inside,total)}</strong> of departures from this group stay within it. These municipalities exchange many movers with one another.</p><div class="stats"><div class="stat"><span>MOVES WITHIN THIS GROUP</span><strong>${fmt(inside)}</strong></div><div class="stat"><span>GROUPS ACROSS DENMARK</span><strong>${new Set(c.membership).size}</strong></div></div><h4 class="section-label">${area.toUpperCase()}’S STRONGEST GROUP LINKS</h4>${ranking(connected,'route',4)}<details><summary>See all ${members.length} places in this group</summary><p class="group-members">${members.map(i=>`<button data-place="${i}">${esc(name(i))}</button>`).join(' · ')}</p></details><p class="aside-note">${esc(scope())}<br>Groups are calculated from moves, not official regional boundaries. The colours can change with your filters.</p>`;
  }
}
function chartMarkup(values,years,selectedYear=state.year,interactive=true) {
  const W=560,H=205,left=44,right=12,top=16,bottom=29,plotW=W-left-right,plotH=H-top-bottom;
  const lo=Math.min(0,...values),hi=Math.max(0,...values),span=hi-lo||1,pad=span*.12;
  const y=v=>top+(hi+pad-v)/(span+2*pad)*plotH,step=plotW/values.length;
  const compact=n=>Math.abs(n)>=1000?(n/1000).toFixed(Math.abs(n)>=10000?0:1)+'k':String(Math.round(n));
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net domestic moves by year. Exact values are in the table below.">`;
  for(const v of [...new Set([lo,0,hi])])svg+=`<line class="${v===0?'zero':'grid'}" x1="${left}" x2="${W-right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left-8}" y="${y(v)+3}" text-anchor="end">${compact(v)}</text>`;
  svg+=values.map((v,i)=>{const x=left+step*i+step*.2,width=step*.6;return `<rect ${interactive?`data-year="${years[i]}" style="cursor:pointer"`:''} x="${x}" y="${Math.min(y(0),y(v))}" width="${width}" height="${Math.max(1,Math.abs(y(v)-y(0)))}" rx="2" fill="${v>=0?'#529a85':'#ce957b'}" ${years[i]===selectedYear?'stroke="#19343c" stroke-width="1.5"':''}><title>${years[i]}: ${signed(v)} net moves</title></rect>${i===0||i===values.length-1||i%5===4?`<text x="${x+width/2}" y="${H-6}" text-anchor="middle">${years[i]}</text>`:''}`;}).join('');
  return svg+'</svg>';
}
function renderDetails() {
  const years=manifest.years,values=years.map(y=>{const r=getSummary(y)[selected];return r[0]-r[1];});
  $('trendTitle').textContent=name(selected)+' over time';$('trendSubtitle').textContent=`${ageName()} · ${sexName()} · counts, 2006–2025`;
  $('trendChart').innerHTML=chartMarkup(values,years);
  const best=values.indexOf(Math.max(...values)),worst=values.indexOf(Math.min(...values));
  $('trendText').innerHTML=`The highest balance was <strong>${signed(values[best])} in ${years[best]}</strong>; the lowest was <strong>${signed(values[worst])} in ${years[worst]}</strong>. Click a bar to explore that year.`;
  $('trendTable').innerHTML='<table><thead><tr><th>Year</th><th>Arrivals</th><th>Departures</th><th>Net</th></tr></thead><tbody>'+years.map(y=>{const r=getSummary(y)[selected];return `<tr><th scope="row">${y}</th><td>${fmt(r[0])}</td><td>${fmt(r[1])}</td><td>${signed(r[0]-r[1])}</td></tr>`;}).join('')+'</tbody></table>';
  $('ageTitle').textContent='Who arrives. Who leaves.';$('ageYear').textContent=state.year;
  const vals=manifest.ages.map((_,i)=>{const r=getSummary(state.year,i+1)[selected];return r[0]-r[1];}),max=Math.max(...vals.map(Math.abs),1);
  $('ageChart').innerHTML=vals.map((v,i)=>{const width=Math.abs(v)/max*48;return `<button class="age-row" data-age="${i+1}" aria-pressed="${state.age===i+1}" aria-label="Explore ages ${esc(manifest.ages[i])}: ${signed(v)} net moves"><span class="age-label">${manifest.ages[i].replace('-','–')}</span><span class="age-track"><i class="age-fill" style="left:${v<0?50-width:50}%;width:${width}%;background:${v>=0?'#529a85':'#ce957b'}"></i></span><span class="age-value ${v>=0?'positive':'negative'}">${signed(v)}</span></button>`;}).join('');
  $('ageText').innerHTML=`In ${state.year}, ${esc(name(selected))} had <strong>${signed(vals[1])} net moves at ages 18–24</strong> and <strong>${signed(vals[3])} at ages 30–39</strong> (${sexName()}). These are different age groups, not the same people followed through life.`;
}
async function openRoute(other) {
  const id=++routeRenderId,origin=selected,year=state.year,age=state.age,sex=state.sex;
  const from=matrix[origin][other],to=matrix[other][origin];
  const breakdown=manifest.ages.map((label,a)=>{let f=0,t=0;for(const r of current.flows){if(r[2]!==a)continue;const value=sex===1?r[3]:sex===2?r[4]:r[3]+r[4];if(r[0]===origin&&r[1]===other)f+=value;if(r[0]===other&&r[1]===origin)t+=value;}return {label,f,t};});
  $('routeBody').innerHTML=`<p class="eyebrow">A CONNECTION, IN BOTH DIRECTIONS</p><h2>${esc(name(origin))} ↔ ${esc(name(other))}</h2><p>${esc(scope())}. A move in one direction is counted separately from a move in the other.</p><div class="stats"><div class="stat"><span>${esc(name(origin))} → ${esc(name(other))}</span><strong>${fmt(from)}</strong></div><div class="stat"><span>${esc(name(other))} → ${esc(name(origin))}</span><strong>${fmt(to)}</strong></div></div><p>The balance for ${esc(name(origin))} on this connection is <strong>${signed(to-from)} moves</strong>.</p><div class="route-ages"><h3>All age groups on this connection · ${year}</h3><table><thead><tr><th>Age</th><th>To ${esc(name(other))}</th><th>To ${esc(name(origin))}</th></tr></thead><tbody>${breakdown.map(r=>`<tr><th scope="row">${r.label}</th><td>${fmt(r.f)}</td><td>${fmt(r.t)}</td></tr>`).join('')}</tbody></table></div><h3>The balance over twenty years</h3><p>Net moves to ${esc(name(origin))} from ${esc(name(other))}; ${esc(ageName())}, ${sexName()}.</p><div class="chart" id="routeTrend"><p role="status">Loading this connection’s history…</p></div><div id="routeHistoryTable"></div><p><a href="https://www.statbank.dk/FLY66" target="_blank" rel="noopener">Source: Statistics Denmark, FLY66 ↗</a><br>Origin codes ${manifest.areas[origin].code} and ${manifest.areas[other].code}; selected year ${year}.</p><button class="primary-btn" id="exploreOther">Explore ${esc(name(other))} →</button>`;
  $('exploreOther').onclick=()=>{$('routeDialog').close();chooseArea(other);};
  $('routeDialog').showModal();
  try {const [a,b]=await Promise.all([getRoutes(manifest.areas[origin].code),getRoutes(manifest.areas[other].code)]);if(id!==routeRenderId)return;
    const outgoing=routeSeries(a,other,manifest.years,age,sex),incoming=routeSeries(b,origin,manifest.years,age,sex),net=incoming.map((v,i)=>v-outgoing[i]);
    $('routeTrend').innerHTML=chartMarkup(net,manifest.years,year,false);
    $('routeHistoryTable').innerHTML='<details><summary>Read all route figures</summary><div class="table-scroll"><table><thead><tr><th>Year</th><th>To '+esc(name(other))+'</th><th>To '+esc(name(origin))+'</th><th>Net</th></tr></thead><tbody>'+manifest.years.map((y,i)=>`<tr><th scope="row">${y}</th><td>${fmt(outgoing[i])}</td><td>${fmt(incoming[i])}</td><td>${signed(net[i])}</td></tr>`).join('')+'</tbody></table></div></details>';
  }catch(error){if(id===routeRenderId)$('routeTrend').innerHTML='<p>Route history could not be loaded. Close and reopen this connection to retry.</p>';}
}
function downloadView() {
  if(!matrix)return;
  let lines;
  if(state.view==='balance') {
    lines=[['year','age_group','sex','area_code','area','arrivals','departures','net_domestic_moves','population_jan_1','net_moves_per_1000']];
    getSummary().forEach((r,i)=>lines.push([state.year,ageName(),sexName(),manifest.areas[i].code,name(i),r[0],r[1],r[0]-r[1],r[2]??'',netRate(...r)??'']));
  } else {
    const groups=current.communities[state.sex][state.age].membership;
    lines=[['year','age_group','sex','origin_code','origin','destination_code','destination','moves',...(state.view==='groups'?['origin_group','destination_group','same_group']:[])]];
    for(let i=0;i<matrix.length;i++)for(let j=0;j<matrix.length;j++)if(matrix[i][j] && (state.view!=='flows'||(state.direction==='out'?i===selected:j===selected)))lines.push([state.year,ageName(),sexName(),manifest.areas[i].code,name(i),manifest.areas[j].code,name(j),matrix[i][j],...(state.view==='groups'?[groups[i]+1,groups[j]+1,groups[i]===groups[j]]:[])]);
  }
  const csv=lines.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`denmark-in-motion-${state.view}-${state.area}-${state.year}-age${state.age}-sex${state.sex}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Downloaded this view for the current filters. Source: Statistics Denmark.');
}
function attachEvents() {
  for(const key of ['area','year','age','sex'])$(key).addEventListener('change',e=>{state[key]=key==='area'?e.target.value:Number(e.target.value);render();});
  $('yearRange').addEventListener('input',e=>{$('rangeValue').textContent=e.target.value;});
  $('yearRange').addEventListener('change',e=>{state.year=Number(e.target.value);render();});
  document.querySelectorAll('[data-view]').forEach(button=>{button.onclick=()=>{state.view=button.dataset.view;render();};button.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...document.querySelectorAll('[data-view]')],i=buttons.indexOf(button),next=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;buttons[next].focus();buttons[next].click();};});
  $('mapSwitch').onclick=e=>{const b=e.target.closest('button');if(!b||b.disabled)return;if(b.dataset.direction)state.direction=b.dataset.direction;if(b.dataset.unit)state.unit=b.dataset.unit;render();};
  $('land').onclick=e=>{const p=e.target.closest('[data-i]');if(p)chooseArea(Number(p.dataset.i));};
  $('mapStage').addEventListener('pointermove',e=>{const p=e.target.closest('[data-i]');if(!p){$('mapTip').hidden=true;return;}const i=Number(p.dataset.i),r=getSummary()[i];let description=state.view==='flows'?`${fmt(state.direction==='out'?matrix[selected][i]:matrix[i][selected])} ${state.direction==='out'?'from':'to'} ${name(selected)}`:state.view==='balance'?`${metric(r)===null?'Unavailable':state.unit==='rate'?decimal(metric(r)):signed(metric(r))} ${state.unit==='rate'?'per 1,000':'net moves'}`:`${fmt(r[0])} arrivals · ${fmt(r[1])} departures`;
    if(i===selected&&state.view==='flows')description='Selected municipality';
    const rect=$('mapStage').getBoundingClientRect();$('mapTip').innerHTML=`<strong>${esc(name(i))}</strong>${esc(description)}`;$('mapTip').hidden=false;$('mapTip').style.left=Math.max(5,Math.min(e.clientX-rect.left+12,rect.width-225))+'px';$('mapTip').style.top=Math.max(4,e.clientY-rect.top-57)+'px';});
  $('mapStage').addEventListener('pointerleave',()=>$('mapTip').hidden=true);
  $('zoomBtn').onclick=()=>{zoomed=!zoomed;applyZoom();};$('resetZoom').onclick=()=>{zoomed=false;applyZoom();};
  $('insight').onclick=e=>{const route=e.target.closest('[data-route]'),place=e.target.closest('[data-place]');if(route)openRoute(Number(route.dataset.route));if(place)chooseArea(Number(place.dataset.place));};
  $('ageChart').onclick=e=>{const b=e.target.closest('[data-age]');if(b){state.age=Number(b.dataset.age);render();}};
  $('trendChart').onclick=e=>{const b=e.target.closest('[data-year]');if(b){state.year=Number(b.dataset.year);render();}};
  document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{state.year=manifest.years.at(-1);state.sex=0;state.unit='count';state.view='flows';state.direction='in';zoomed=false;if(b.dataset.preset==='young'){state.area='751';state.age=2;}if(b.dataset.preset==='thirties'){state.area='101';state.age=4;state.direction='out';}if(b.dataset.preset==='gains'){state.area='336';state.age=0;state.view='balance';state.unit='rate';}render();$('explorer').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});});
  for(const id of ['aboutBtn','methodBtn','footerAbout'])$(id).onclick=()=>$('aboutDialog').showModal();
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  $('downloadBtn').onclick=downloadView;
  $('shareBtn').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);toast('Link copied. It includes your current filters.');}catch{toast('Copy the page URL to share these filters.');}};
  window.addEventListener('hashchange',()=>{readHash();render();});
}
async function init(){try{
  [manifest,history]=await Promise.all([getJSON('data/manifest.json'),getJSON('data/summary.json')]);
  $('area').innerHTML=manifest.areas.map((a,i)=>({a,i})).sort((a,b)=>a.a.english.localeCompare(b.a.english)).map(({a})=>`<option value="${a.code}">${esc(a.english)}${a.name!==a.english?' / '+esc(a.name):''}</option>`).join('');
  $('year').innerHTML=[...manifest.years].reverse().map(y=>`<option>${y}</option>`).join('');
  $('age').insertAdjacentHTML('beforeend',manifest.ages.map((a,i)=>`<option value="${i+1}">${a.replace('-','–')} years</option>`).join(''));
  $('yearRange').min=manifest.years[0];$('yearRange').max=manifest.years.at(-1);
  const date=s=>new Date(s).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  $('freshness').textContent=`Migration source updated ${date(manifest.sourceUpdated)} · Snapshot ${date(manifest.fetchedAt)}`;
  $('sourceDates').textContent=`Migration table updated ${date(manifest.sourceUpdated)}. Population table updated ${date(manifest.populationUpdated)}. This snapshot was downloaded ${date(manifest.fetchedAt)}. It is a static publication, not a live feed; future source revisions appear after a data refresh.`;
  readHash();attachEvents();await render();
}catch(error){$('loading').innerHTML='<div><p>The atlas could not be loaded. Check your connection and reload.</p><button class="primary-btn" id="reload">Reload atlas</button></div>';$('reload').onclick=()=>location.reload();console.error(error);}}
init();
