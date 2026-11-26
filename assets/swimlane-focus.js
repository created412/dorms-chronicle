import {importanceLabels,loadSwimlane,swimlaneDateRange,eventPeriods,eventMonthLabel,packTimelineItems,cardRelationPaths,relationChain} from '../swimlane-data.js';
import {getSwimlaneEmbed,setupSwimlaneModal} from './swimlane-modal.js';

const $=id=>document.getElementById(id);
const make=(tag,cls='',label='')=>Object.assign(document.createElement(tag),{className:cls,textContent:label});
const button=(label,click,cls='')=>{
 const node=make('button',cls,label);
 node.type='button';
 node.addEventListener('click',click);
 return node;
};
const svg=(tag,attrs)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
 for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
 return node;
};
const DAY=86400000;
const iso=t=>new Date(t).toISOString().slice(0,10);
const monthOf=t=>new Date(t).getUTCFullYear()*12+new Date(t).getUTCMonth();
const monthStart=m=>Date.UTC(Math.floor(m/12),m%12,1);
const yearFloor=m=>Math.floor(m/12)*12;
const yearCeil=m=>Math.ceil(m/12)*12;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const rise={duration:440,easing:'cubic-bezier(.2,.7,.2,1)',fill:'backwards'};
function riseIn(node,delay=0,lift=10){
 if(!reducedMotion.matches)node.animate([{opacity:0,transform:'translateY('+lift+'px)'},{opacity:1,transform:'none'}],{...rise,delay});
}
const bounds=value=>swimlaneDateRange(value,SheetData.dateRange);
const params=new URLSearchParams(location.search);
const frame=window.frameElement;
async function init(){
 const embed=frame&&getSwimlaneEmbed(frame);
 const pkg=params.get('package')==='cold-war'?'cold-war':'japan';
 const data=frame?.lessonSwimlane??await loadSwimlane(SHEET_CONFIG,SheetData,pkg);
 const {events,categories,actors,relations,periods}=data;
 if(!events.length)throw Error('표시할 수업 사건이 없습니다.');
 const levels=new Set(events.map(event=>event.importance));
 for(const [level,label] of importanceLabels){
  if(levels.has(level))$('importance-key').append(make('span','level-'+level,label));
 }
 const {open}=setupSwimlaneModal(data,frame);
 const all=[...events,...categories,...actors];
 const records=new Map(all.map(record=>[record.id,record]));
 const role=new Map([...events.map(e=>[e.id,'event']),...categories.map(c=>[c.id,'category']),...actors.map(a=>[a.id,'actor'])]);
 const intervals=new Map(all.flatMap(record=>{
  const date=record.date||record.start;
  if(!date&&!record.end)return [];
  return [[record.id,{start:date?bounds(date).start:-Infinity,end:record.end?bounds(record.end).end+DAY:date?bounds(date).end+DAY:Infinity}]];
 }));
 const times=[...intervals.values()].flatMap(i=>[i.start,i.end-1]).filter(Number.isFinite);
 const firstYear=new Date(Math.min(...times)).getUTCFullYear(),lastYear=new Date(Math.max(...times)).getUTCFullYear();
 const min=firstYear*12,max=(lastYear+1)*12;
 const counts=new Map();
 for(const e of events){const y=Number(e.date.slice(0,4));counts.set(y,(counts.get(y)??0)+1);}
 const maxCount=Math.max(...counts.values());
 const requested=params.get('focus');
 const initial=/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(requested)?bounds(requested).start:null;
 let anchor=initial??Math.min(...events.map(e=>intervals.get(e.id).start)),size=initial?12:frame?.hasAttribute('data-package-draft')?0:36;
 let emptyLanes=false,allEdges=false,selected='',relationFocus=null,preferred=null,anchors=new Map(),start,end,ticks,plotWidth;
 // Cards rise in date order when the window changes, not when the page only resizes.
 let entrance=true,ready=false,sequence=null;
 const labels={cause:'원인·계기',shift:'전환·변화',action:'활동·실행',succession:'계승',integration:'통합·편입',split:'분열·개편',background:'구조적 배경'};
 const kindLabel={period:'시기별 사건',arc:'사건군',theme:'주제'};
 const title=r=>r.title||r.name;
 const x=t=>Math.max(0,Math.min(plotWidth,(t-start)/(end-start)*plotWidth));
 const intersects=i=>i&&i.start<end&&i.end>start;
 const labelDate=r=>[r.date||r.start,r.end].filter(Boolean).join(' – ');
 let wheelRemainder=0;
 function setWindow(t,months){endSequence();anchor=t;size=months;selected='';preferred=null;wheelRemainder=0;entrance=true;render();}
 function panYears(years){
  const begin=monthOf(start),span=monthOf(end)-begin;
  const next=Math.max(min,Math.min(max-span,begin+years*12));
  if(next!==begin)setWindow(monthStart(next),size);
 }
 const viewport=$('ticks').closest('.viewport');
 viewport.addEventListener('wheel',event=>{
  if(event.ctrlKey||event.defaultPrevented)return;
  const horizontal=Math.abs(event.deltaX)>Math.abs(event.deltaY);
  if(!horizontal&&(embed?.outerFrame||event.target.closest?.('.rail, .axis > strong')))return;
  const direction=horizontal?event.deltaX:event.deltaY;
  if(!direction)return;
  if(direction<0?monthOf(start)<=min:monthOf(end)>=max){
   wheelRemainder=0;
   return;
  }
  event.preventDefault();
  const pixels=direction*(event.deltaMode===1?16:event.deltaMode===2?viewport.clientWidth:1);
  if(Math.sign(wheelRemainder)!==Math.sign(pixels))wheelRemainder=0;
  const total=wheelRemainder+pixels;
  const years=Math.trunc(total/96);
  if(years)panYears(years);
  wheelRemainder=total%96;
 },{passive:false});
 viewport.addEventListener('keydown',event=>{
  if(event.target!==viewport||event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
  event.preventDefault();
  if(sequence)return;
  panYears(event.key==='ArrowLeft'?-1:1);
 });
 const ey=lastYear-firstYear+1;
 $('extent').textContent=firstYear+'–'+lastYear+' · 사건 '+events.length+'개';
 for(let y=firstYear;y<=lastYear;y++){
  const b=button('',()=>setWindow(Date.UTC(y,0),12));
  b.setAttribute('aria-label',y+'년 확대');b.title=y+'년 · 시작 사건 '+(counts.get(y)??0)+'개';
  const bar=make('i');bar.style.height=Math.max(2,Math.round((counts.get(y)??0)/maxCount*27))+'px';b.append(bar);$('overview').append(b);
  const step=ey>90?25:ey>24?10:5;
  if(y===firstYear||y===lastYear||(y%step===0&&y-firstYear>=ey*.07&&lastYear-y>=ey*.07)){
   const tick=make('span','',y);tick.style.left=(y===firstYear?0:y===lastYear?100:(y-firstYear+.5)/ey*100)+'%';$('ruler').append(tick);
  }
 }
 const extentStart=monthStart(min),extentEnd=monthStart(max);
 const eraOverview=$('era-overview');
 const eraItems=periods.filter(p=>p.start||p.end).map(p=>{
  const from=p.start?bounds(p.start).start:extentStart;
  const until=p.end?bounds(p.end).end+DAY:extentEnd;
  const b=button('',()=>{setWindow(from,36);select(p.id,anchors.get(p.id)?.[0]);},'overview-era');
  const dateText=value=>value.slice(0,4)+'년';
  const dates=p.start&&p.end?dateText(p.start)+' – '+dateText(p.end):
   p.start?dateText(p.start)+'부터':dateText(p.end)+'까지';
  const caption=make('span','era-caption');
  caption.append(make('b','',p.name),make('span','era-years',dates));
  b.append(make('i','era-stroke'),caption);
  eraOverview.append(b);
  return {b,caption,from,until};
 });
 function layoutEraOverview(){
  const width=eraOverview.clientWidth;
  if(!width)return;
  const items=eraItems.map(({b,caption,from,until})=>{
   const left=(from-extentStart)/(extentEnd-extentStart)*width;
   const right=(until-extentStart)/(extentEnd-extentStart)*width;
   const labelWidth=caption.getBoundingClientRect().width;
   const labelLeft=Math.min(left,width-labelWidth);
   const start=Math.min(left,labelLeft);
   const end=Math.max(right,labelLeft+labelWidth);
   b.style.marginLeft=start+'px';
   b.style.width=(end-start)+'px';
   b.style.setProperty('--bar-left',(left-start)+'px');
   b.style.setProperty('--bar-width',(right-left)+'px');
   return {b,start,end:end+8};
  });
  for(const {b,track} of packTimelineItems(items))b.style.gridRow=String(track+1);
 }
 const viewportMark=make('i','window');$('overview').append(viewportMark);
 const overview=$('overview');
 overview.title='클릭해 연도로 이동하거나 드래그해 볼 구간을 정하세요.';
 const monthAt=clientX=>{
  const r=overview.getBoundingClientRect();
  return Math.min(max-1,Math.max(min,min+Math.floor((clientX-r.left)/r.width*(max-min))));
 };
 let drag=null,ignoreClick=false;
 overview.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  ignoreClick=false;
  const m=monthAt(e.clientX),left=monthOf(start),right=monthOf(end);
  const bounds=viewportMark.getBoundingClientRect();
  const mode=Math.abs(e.clientX-bounds.left)<5?'left':Math.abs(e.clientX-bounds.right)<5?'right':
    m>=left&&m<right&&right-left<max-min?'pan':'select';
  drag={x:e.clientX,m,left,right,mode,moved:false,from:left,to:right};
 });
 overview.addEventListener('pointermove',e=>{
  if(!drag||Math.abs(e.clientX-drag.x)<4&&!drag.moved)return;
  overview.setPointerCapture(e.pointerId);
  drag.moved=true;
  const m=monthAt(e.clientX),width=drag.right-drag.left;
  // Dragging snaps to whole years to match the axis.
  if(drag.mode==='pan'){
   drag.from=Math.max(min,Math.min(max-width,drag.left+yearFloor(m)-yearFloor(drag.m)));drag.to=drag.from+width;
  }else if(drag.mode==='left'){drag.from=Math.min(yearFloor(m),drag.right-12);}
  else if(drag.mode==='right'){drag.to=Math.max(yearCeil(m+1),drag.left+12);}
  else{drag.from=yearFloor(Math.min(m,drag.m));drag.to=yearCeil(Math.max(m,drag.m)+1);}
  Object.assign(viewportMark.style,{left:100*(drag.from-min)/(max-min)+'%',width:100*(drag.to-drag.from)/(max-min)+'%'});
 });
 overview.addEventListener('pointerup',()=>{
  if(drag?.moved){ignoreClick=true;setWindow(monthStart(drag.from),drag.to-drag.from);}
  drag=null;
 });
 overview.addEventListener('pointercancel',()=>{drag=null;render();});
 overview.addEventListener('click',e=>{if(ignoreClick){e.stopPropagation();ignoreClick=false;}},true);
 for(const [months,label] of [[0,'전체'],[120,'10년'],[36,'3년'],[12,'1년']]){
  const b=button(label,()=>{const t=intervals.get(selected)?.start;setWindow(Number.isFinite(t)?t:anchor,months);});b.dataset.months=months;$('zoom').append(b);
 }
 $('jump').min=firstYear;$('jump').max=lastYear;
 $('jump').onchange=()=>{
  if(!$('jump').value||!$('jump').validity.valid)return;
  setWindow(monthStart(Number($('jump').value)*12),12);
  $('year-panel').hidePopover();
 };
 $('prev').onclick=()=>setWindow(monthStart(Math.max(min,monthOf(start)-size)),size);
 $('next').onclick=()=>setWindow(monthStart(monthOf(end)),size);
 $('empty-lanes').onclick=()=>{emptyLanes=!emptyLanes;$('empty-lanes').setAttribute('aria-pressed',String(emptyLanes));render();};
 $('relations').textContent='전체 관계 '+relations.length+'건';$('relations').onclick=()=>open('all');
 // Lines across every lane bury the cards, so only the selected card's relations show until asked.
 $('all-edges').onclick=()=>{allEdges=!allEdges;$('all-edges').setAttribute('aria-pressed',String(allEdges));drawEdges();};
 function addAnchor(id,node){
  if(!anchors.has(id))anchors.set(id,[]);
  anchors.get(id).push(node);
 }
 function select(id,node){selected=id;relationFocus=null;preferred=node;paintSelection();drawEdges();}
 function openRecord(record,node){
  select(record.id,node);
  open(role.get(record.id),record);
 }
 function row(name,kind,record){
  const line=make('div','row lane');
  const rail=record?button('',()=>openRecord(record,rail),'rail'):make('div','rail');
  if(kind)rail.append(make('small','',kind));
  rail.append(make('b','',name));
  if(record){rail.dataset.record=record.id;addAnchor(record.id,rail);}
  const track=make('div','track');line.append(rail,track);$('lanes').append(line);
  for(const [i,tick] of ticks.entries()){
   const grid=make('i',tick.shaded?'tick shaded':'tick');
   grid.style.left=x(tick.t)+'px';grid.style.width=x(ticks[i+1]?.t??end)-x(tick.t)+'px';track.append(grid);
  }
  return track;
 }
 function periodLane(){
  const track=row('시기','',null);track.classList.add('era-track');
  const items=periods.map(p=>({p,start:p.start?bounds(p.start).start:-Infinity,end:p.end?bounds(p.end).end+DAY:Infinity})).filter(intersects);
  if(!items.length){track.append(make('span','no-period','이 구간에 등록된 시기 없음'));return;}
  const packed=packTimelineItems(items);
  track.style.minHeight=29*Math.max(...packed.map(item=>item.track+1))+8+'px';
  for(const item of packed){
   const {p,track:level}=item;
   const bar=button(p.name,()=>openRecord(p,bar),'era');
   bar.dataset.record=p.id;bar.title=p.name+' '+labelDate(p);bar.setAttribute('aria-label',bar.title);
   Object.assign(bar.style,{left:x(item.start)+'px',width:Math.max(3,x(item.end)-x(item.start))+'px',top:5+level*29+'px'});
   track.append(bar);addAnchor(p.id,bar);
  }
 }
 function eventButton(record){
  const mark=button('',()=>openRecord(record,mark),'event');
  mark.dataset.record=record.id;
  const kind=record.end?'기간':'시점';
  const level=importanceLabels.get(record.importance);
  if(level)mark.dataset.importance=record.importance;
  mark.title=[kind,labelDate(record),title(record),level].filter(Boolean).join(' · ');
  mark.setAttribute('aria-label',mark.title);
  mark.append(make('b','',title(record)));
  return mark;
 }
 function drawBand(track,heading,items){
  if(!items.length)return;
  const section=make('section','lane-band');
  section.append(make('h3','band-heading',heading));
  const body=make('div','band-items');
  section.append(body);track.append(section);
  const blocks=[],years=new Map();
  for(const r of items){
   const date=r.date||r.start;
   const mark=eventButton(r);
   const interval=intervals.get(r.id),left=x(interval.start),right=x(interval.end);
   if(!r.end&&/^\d{4}$/.test(date)){
    if(!years.has(date)){
     const group=make('div','year-events');group.append(make('h4','',date+'년'));
     body.append(group);
     const width=Math.min(plotWidth,Math.max(132,Math.min(240,right-left-6)));
     const groupLeft=Math.min(left,plotWidth-width);
     group.style.width=width+'px';group.style.left=groupLeft+'px';
     years.set(date,group);blocks.push({node:group,start:groupLeft,end:groupLeft+width+5});
    }
    years.get(date).append(mark);addAnchor(r.id,mark);continue;
   }
   const duration=Boolean(r.end);
   const when=eventMonthLabel(r);
   if(when)mark.append(make('small','when',when));
   mark.classList.add(duration?'span-event':'point-event');
   body.append(mark);addAnchor(r.id,mark);
   const width=mark.offsetWidth;
   // A month-only record belongs to its month, without implying a specific day.
   const point=date.length===7?(left+right)/2:left;
   const dotX=Math.max(4,Math.min(point,plotWidth-4));
   const labelLeft=Math.max(0,Math.min(duration?left:dotX-8,plotWidth-width));
   mark.style.left=labelLeft+'px';
   if(duration){
    const pin=make('i','pin duration');
    pin.setAttribute('aria-hidden','true');mark.append(pin);
    pin.style.left=(left-labelLeft)+'px';
    pin.style.width=Math.max(2,right-left)+'px';
    pin.classList.toggle('continues',interval.end>end);
    pin.classList.toggle('began-earlier',interval.start<start);
   }else{
    const dot=make('i','date-dot');
    dot.setAttribute('aria-hidden','true');dot.style.left=(dotX-labelLeft)+'px';mark.append(dot);
   }
   blocks.push({node:mark,start:duration?Math.min(labelLeft,left):Math.min(labelLeft,dotX-4),
    end:Math.max(labelLeft+width,duration?right:dotX+4)+5,above:duration?0:13});
  }
  const packed=packTimelineItems(blocks);
  const heights=[],headroom=[];
  for(const {node,track:level,above=0} of packed){
   heights[level]=Math.max(heights[level]||0,node.offsetHeight);
   headroom[level]=Math.max(headroom[level]||0,above);
  }
  const offsets=[];let height=4;
  for(const [level,h] of heights.entries()){
   height+=headroom[level];offsets.push(height);height+=h+9;
  }
  for(const {node,track:level} of packed)node.style.top=offsets[level]+'px';
  body.style.height=height+'px';
 }
 function drawLane(name,kind,record,items){
  const visible=items.filter(r=>intersects(intervals.get(r.id)));
  if(!items.length||(!visible.length&&!emptyLanes))return;
  const track=row(name,kind,record);
  if(!visible.length){track.classList.add('quiet');return;}
  const actor=role.get(visible[0].id)==='actor';
  drawBand(track,actor?'존속 시작':'시점 사건',visible.filter(r=>!r.end));
  drawBand(track,actor?'존속 기간':'기간 사건',visible.filter(r=>r.end));
 }
 const drawnEndpoints=new Map();
 function drawEdges(){
  drawnEndpoints.clear();
  const layer=$('edges');layer.replaceChildren();
  const defs=svg('defs',{});layer.append(defs);
  for(const [id,color] of [['normal','#487a70'],['active','#a94929']]){
   const tip=svg('marker',{id,viewBox:'0 0 10 10',refX:10,refY:5,markerWidth:8,markerHeight:8,markerUnits:'userSpaceOnUse',orient:'auto'});
   tip.append(svg('path',{d:'M0 0 L10 5 L0 10Z',fill:color}));defs.append(tip);
   const dot=svg('marker',{id:id+'-start',viewBox:'0 0 8 8',refX:4,refY:4,markerWidth:7,markerHeight:7,markerUnits:'userSpaceOnUse'});
   dot.append(svg('circle',{cx:4,cy:4,r:3,fill:color}));defs.append(dot);
  }
  const origin=layer.getBoundingClientRect(),boxes=new Map();
  function box(node){
   if(!boxes.has(node)){
    const r=(node.matches('.rail')?node.querySelector('b'):node).getBoundingClientRect();
    boxes.set(node,{left:r.left-origin.left,right:r.right-origin.left,top:r.top-origin.top,bottom:r.bottom-origin.top});
   }
   return boxes.get(node);
  }
  const candidates=id=>selected===id&&preferred?.isConnected?[preferred]:anchors.get(id)||[];
  const isActive=r=>relationFocus?.relationIds.has(r.id)||selected===r.fromId||selected===r.toId;
  const links=[];
  for(const rel of [...relations].sort((a,b)=>Number(isActive(a))-Number(isActive(b)))){
   if(!allEdges&&!isActive(rel))continue;
   let nearest=Infinity,pair;
   for(const from of candidates(rel.fromId))for(const to of candidates(rel.toId)){
    const a=box(from),b=box(to);
    const distance=Math.hypot((a.left+a.right-b.left-b.right)/2,(a.top+a.bottom-b.top-b.bottom)/2);
    if(distance>=nearest)continue;
    nearest=distance;
    pair={from,to};
   }
   if(!pair)continue;
   drawnEndpoints.set(rel,pair);
   const {from,to}=pair;
   const sameGroup=from.parentElement===to.parentElement&&from.parentElement.matches('.year-events');
   links.push({id:rel.id,rel,from:box(from),to:box(to),sameGroup});
  }
  const paths=cardRelationPaths(links,origin.width);
  for(const [i,{rel}] of links.entries()){
   const d=paths[i];
   const pressed=rel.id===relationFocus?.id;
   const active=isActive(rel),marker=active?'active':'normal';
   const path=svg('path',{class:'edge '+(rel.status==='draft'?'draft ':'')+(active?'focus':selected||relationFocus?'muted':''),d,'marker-start':'url(#'+marker+'-start)','marker-end':'url(#'+marker+')','data-relation':rel.id});
   const hit=svg('path',{class:'edge-hit',d,role:'button',tabindex:0,'data-relation':rel.id,'aria-pressed':String(pressed),'aria-label':rel.fromName+' → '+rel.toName});
   hit.onclick=()=>{
    relationFocus=pressed?null:{id:rel.id,...relationChain(relations,rel)};
    selected='';preferred=null;
    paintSelection();drawEdges();
    layer.querySelector('.edge-hit[data-relation="'+CSS.escape(rel.id)+'"]')?.focus({preventScroll:true});
   };
   hit.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!e.repeat)hit.onclick();}};
   layer.append(path,hit);
   if(pressed||(!relationFocus&&active)){
    const mid=path.getPointAtLength(path.getTotalLength()/2);
    const label=svg('text',{class:'edge-label',x:mid.x,y:mid.y-3,'data-relation':rel.id});label.textContent=labels[rel.kind]||rel.label;layer.append(label);
   }
  }
  syncEdges();
 }
 // One step per record, earliest first. A record drawn in several lanes appears in all of them at once.
 function revealSteps(){
  const steps=[];
  for(const [id,nodes] of anchors){
   const cards=nodes.filter(node=>node.matches('.event'));
   if(cards.length)steps.push({id,t:intervals.get(id)?.start??-Infinity,nodes:cards});
  }
  return steps.sort((a,b)=>a.t-b.t);
 }
 // Whatever began before this window is already under way, so it stays on screen as context.
 const sequenceSteps=()=>revealSteps().filter(step=>step.t>=start);
 function playEntrance(){
  if(reducedMotion.matches)return;
  const steps=revealSteps(),gap=Math.min(90,1600/Math.max(1,steps.length)),groups=new Set();
  for(const [i,step] of steps.entries())for(const node of step.nodes){
   const group=node.closest('.year-events');
   if(group&&!groups.has(group)){groups.add(group);riseIn(group,i*gap,0);}
   riseIn(node,i*gap);
  }
  for(const bar of $('lanes').querySelectorAll('.era'))bar.animate([{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0)'}],{duration:620,easing:'ease-out'});
  $('edges').animate([{opacity:0},{opacity:1}],{duration:420,delay:steps.length*gap+240,fill:'backwards'});
 }
 const waiting=node=>node.classList.contains('waiting');
 function syncGroups(){
  for(const group of $('lanes').querySelectorAll('.year-events'))group.classList.toggle('waiting',[...group.querySelectorAll('.event')].every(waiting));
 }
 // A relation line waits until both of its cards are on screen.
 function syncEdges(){
  const hidden=new Set();
  if(sequence)for(const [rel,{from,to}] of drawnEndpoints)if(waiting(from)||waiting(to))hidden.add(rel.id);
  for(const node of $('edges').querySelectorAll('[data-relation]')){
   const hide=hidden.has(node.dataset.relation);
   if(!hide&&waiting(node)&&!reducedMotion.matches)node.animate([{opacity:0,offset:0}],{duration:520,delay:260,fill:'backwards'});
   node.classList.toggle('waiting',hide);
  }
 }
 const play=button('',()=>{
  if(!sequence||sequence.index>=sequence.steps.length)startSequence();
  else if(sequence.timer)pauseSequence();
  else resumeSequence();
 },'sequence-play');
 const back=button('←',()=>{pauseSequence();stepSequence(-1);});
 const forward=button('→',()=>{pauseSequence();stepSequence(1);});
 const finish=button('모두 보기',()=>endSequence());
 const progress=make('span','sequence-count');
 back.setAttribute('aria-label','이전 사건으로');forward.setAttribute('aria-label','다음 사건 보기');progress.setAttribute('aria-live','polite');
 $('sequence').append(play,back,progress,forward,finish);
 function paintSequence(){
  const shown=sequence?.index??0,total=sequence?.steps.length??0;
  play.textContent=!sequence?'▶ 순서대로 보기':sequence.timer?'❚❚ 멈춤':shown>=total?'↺ 처음부터':'▶ 이어 보기';
  for(const node of [back,progress,forward,finish])node.hidden=!sequence;
  progress.textContent=shown+' / '+total;
  back.disabled=!shown;forward.disabled=shown>=total;
  for(const node of $('lanes').querySelectorAll('[data-now]'))node.removeAttribute('data-now');
  if(sequence&&shown)for(const node of sequence.steps[shown-1].nodes)node.setAttribute('data-now','');
 }
 function stepSequence(direction){
  if(!sequence)return;
  const {steps}=sequence;
  if(direction>0&&sequence.index<steps.length){
   const step=steps[sequence.index++];
   for(const node of step.nodes){
    const group=node.closest('.year-events');
    if(group&&waiting(group)){group.classList.remove('waiting');riseIn(group,0,0);}
    node.classList.remove('waiting');riseIn(node,0,14);
   }
   step.nodes[0].scrollIntoView({block:'nearest',inline:'nearest',behavior:reducedMotion.matches?'auto':'smooth'});
  }else if(direction<0&&sequence.index>0){
   for(const node of steps[--sequence.index].nodes)node.classList.add('waiting');
   syncGroups();
  }
  syncEdges();paintSequence();
  if(sequence.index>=steps.length&&sequence.timer)pauseSequence();
 }
 function resumeSequence(){
  if(!sequence)return;
  clearInterval(sequence.timer);
  sequence.timer=setInterval(()=>stepSequence(1),1150);
  paintSequence();
 }
 function pauseSequence(){
  if(!sequence)return;
  clearInterval(sequence.timer);sequence.timer=0;paintSequence();
 }
 function hideFrom(index){
  for(const [i,step] of sequence.steps.entries())for(const node of step.nodes)node.classList.toggle('waiting',i>=index);
  syncGroups();syncEdges();
 }
 function startSequence(){
  const steps=sequenceSteps();
  if(!steps.length)return;
  clearInterval(sequence?.timer);sequence=null;
  for(const animation of main.getAnimations({subtree:true}))animation.cancel();
  select('',null);
  sequence={steps,index:0,timer:0};
  hideFrom(0);stepSequence(1);resumeSequence();
 }
 function endSequence(){
  if(!sequence)return;
  clearInterval(sequence.timer);
  const rest=sequence.steps.slice(sequence.index).flatMap(step=>step.nodes);
  sequence=null;
  for(const node of $('lanes').querySelectorAll('.waiting'))node.classList.remove('waiting');
  for(const [i,node] of rest.entries())riseIn(node,Math.min(i*40,900));
  syncEdges();paintSequence();
 }
 // After a resize the lanes are rebuilt, so hide the not-yet-shown cards again.
 function restoreSequence(){
  const index=Math.min(sequence.index,(sequence.steps=sequenceSteps()).length);
  sequence.index=index;hideFrom(index);paintSequence();
 }
 document.addEventListener('keydown',event=>{
  if(!sequence||event.altKey||event.ctrlKey||event.metaKey||event.target.closest?.('input,dialog,[popover]'))return;
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
  event.preventDefault();pauseSequence();stepSequence(event.key==='ArrowLeft'?-1:1);
 });
 paintSequence();
 function follow(id,node){
  const r=records.get(id);if(!r)return;
  node??=anchors.get(id)?.[0];
  if(!node){
   const i=intervals.get(id);
   if(!i){open(role.get(id),r);return;}
   anchor=Number.isFinite(i.start)?i.start:i.end-DAY;render();node=anchors.get(id)?.[0];
  }
  if(!node){open(role.get(id),r);return;}
  select(id,node);
  node.scrollIntoView({block:'center',inline:'nearest'});
 }
 function paintSelection(){
  const panel=$('selection');panel.replaceChildren();
  for(const node of $('lanes').querySelectorAll('button[data-record]')){
   node.setAttribute('aria-pressed',String(node.dataset.record===selected));
   node.toggleAttribute('data-chain',relationFocus?.recordIds.has(node.dataset.record)??false);
  }
  const r=records.get(selected);if(!r)return;
  const head=make('div','selection-head');head.append(make('small','',labelDate(r)),make('b','',title(r)),button('상세 보기',()=>open(role.get(selected),r)));
  const related=relations.filter(rel=>rel.fromId===selected||rel.toId===selected);
  panel.append(head);
  if(related.length){
   const nav=make('div','neighbors');
   for(const rel of related){
    const out=rel.fromId===selected,other=out?rel.toId:rel.fromId;
    const peer=records.get(other),i=intervals.get(other);
    const where=i?.end<=start?'이전 구간 · ':i?.start>=end?'다음 구간 · ':'';
    const word=labels[rel.kind]||rel.label||'관계';
    nav.append(button(where+(out?'→ ':'← ')+(peer?title(peer):out?rel.toName:rel.fromName)+' · '+word,()=>peer?follow(other,drawnEndpoints.get(rel)?.[out?'to':'from']):open('relation',rel)));
   }
   panel.append(nav);
  }
 }
 function render(){
  const span=Math.min(size||max-min,max-min);
  const focus=Math.min(Math.max(monthOf(anchor),min),max-1);
  const begin=Math.max(min,Math.min(yearFloor(focus),max-span));
  start=monthStart(begin);end=monthStart(begin+span);
  plotWidth=$('ticks').clientWidth;if(plotWidth<30)return;
  const fromYear=begin/12,untilYear=(begin+span)/12-1;
  $('range').textContent=fromYear===untilYear?fromYear+'년':fromYear+' — '+untilYear+'년';
  $('pick-year').setAttribute('aria-label',$('range').textContent+' · 연도 선택');
  $('jump').value=Math.floor(focus/12);$('prev').disabled=begin<=min;$('next').disabled=begin+span>=max;
  for(const b of $('zoom').children)b.setAttribute('aria-pressed',String(+b.dataset.months===size));
  Object.assign(viewportMark.style,{left:100*(begin-min)/(max-min)+'%',width:100*span/(max-min)+'%'});
  ticks=[];
  const step=12*Math.ceil(span/12/Math.max(3,Math.floor(plotWidth/65)));
  for(let m=begin;m<begin+span;m+=step)ticks.push({t:monthStart(m),label:m/12+'년',shaded:Math.floor(m/step)%2===1});
  // When every year has its own column, the cards need no year heading of their own.
  viewport.classList.toggle('yearly',step===12);
  $('ticks').replaceChildren();for(const tick of ticks){if(plotWidth-x(tick.t)<34&&tick.t!==start)continue;
   const el=span===12?make('span','',tick.label):button(tick.label,()=>setWindow(tick.t,12),'axis-jump');
   el.style.left=x(tick.t)+2+'px';$('ticks').append(el);}
  $('lanes').replaceChildren();anchors=new Map();preferred=null;
  periodLane();
  for(const c of categories){
   const items=events.filter(e=>c.kind==='period'?(!e.arcs.length&&!e.themes.length&&eventPeriods(e).includes(c.name)):c.kind==='arc'?e.arcs.includes(c.name):e.themes.includes(c.name));
   drawLane(c.name,kindLabel[c.kind],c,items);
  }
  drawLane('미분류','',null,events.filter(e=>!e.arcs.length&&!e.themes.length&&!eventPeriods(e).length));
  drawLane('존속 시작일','관계 주체',null,actors.filter(a=>a.start));
  if(!events.some(e=>intersects(intervals.get(e.id))))$('lanes').append(make('p','empty','이 구간에 기록된 수업 사건이 없습니다.'));
  paintSelection();drawEdges();
  if(sequence)restoreSequence();
  else if(entrance&&ready){entrance=false;playEntrance();}
 }
 const main=document.querySelector('main');
 function fitFrame(){
  if(!frame)return;
  frame.style.height=Math.ceil(main.getBoundingClientRect().height+3)+'px';
  if(embed.outerFrame){
   const {outerFrame,showroom}=embed;
   const border=outerFrame.offsetHeight-outerFrame.clientHeight;
   outerFrame.style.height=Math.ceil(showroom.getBoundingClientRect().height+border)+'px';
  }
 }
 if(frame){
  // The lesson page owns scrolling, so keep the axis at its visible top edge.
  const axis=document.querySelector('.axis');
  const pinAxis=()=>axis.style.setProperty('--axis-top',Math.max(0,-embed.bounds().top)+'px');
  embed.scrollWindow.addEventListener('scroll',pinAxis,{passive:true});
  window.addEventListener('pagehide',()=>embed.scrollWindow.removeEventListener('scroll',pinAxis),{once:true});
  pinAxis();
 }
 // Hold the lanes until the fonts settle so the entrance plays once on final positions.
 main.classList.add('booting');
 $('status').textContent='';fitFrame();render();
 new ResizeObserver(()=>{if($('ticks').clientWidth!==plotWidth)render();fitFrame();}).observe(main);
 new ResizeObserver(layoutEraOverview).observe(eraOverview);
 document.fonts.ready.then(()=>{layoutEraOverview();ready=true;main.classList.remove('booting');render();fitFrame();});
}
init().catch(error=>{$('status').textContent='스윔레인을 불러오지 못했습니다. '+error.message;});
