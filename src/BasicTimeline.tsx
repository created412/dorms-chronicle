import {useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import type {EventRecord} from './metro-model';
import {strataTimeline} from './strata-model';
import './basic-timeline.css';

const modes={arc:'사건군',theme:'주제',period:'시기'} as const;
const uncategorized='__timeline_uncategorized__';
type Mode=keyof typeof modes;
const modeOrder=Object.keys(modes) as Mode[];
type Category={id:string;name:string;kind:string;start?:string;end?:string};
type Props={
 events:EventRecord[];
 categories:Category[];
 records:{id:string;sourceId:string;place?:string;title:string}[];
 relations:{fromType:string;fromId:string;toType:string;toId:string;status?:string;visible?:boolean;body?:string}[];
 onVisit:(id:string,button:HTMLButtonElement)=>void;
 showroomFrame:HTMLElement|null;
};

function dateLabel(date:string,groupYear?:number){
 const [year,month,day]=date.split('-');
 const prefix=Number(year)===groupYear?'':year+'년';
 if(!month)return year+'년';
 return [prefix,Number(month)+'월',day&&Number(day)+'일'].filter(Boolean).join(' ');
}

// The time column shows years only, so each card carries its own month.
function monthLabel(date:string){
 const month=Number(date.split('-')[1]);
 return month?month+'월':'';
}

function periodLabel(start:string,end:string){
 if(start===end)return dateLabel(start);
 if(/^\d{4}$/.test(start)&&/^\d{4}$/.test(end))return start+'–'+end+'년';
 return dateLabel(start)+' – '+dateLabel(end);
}

function filterLabel(category:Category){
 if(category.kind!=='period')return category.name;
 const {start,end}=category;
 const range=start&&end?periodLabel(start,end):start?dateLabel(start)+'부터':end?dateLabel(end)+'까지':'';
 return range?`${category.name} (${range})`:category.name;
}

function frameTop(frame:HTMLElement){
 return frame.getBoundingClientRect().top+frame.clientTop;
}

export function BasicTimeline({events,categories,records,relations,onVisit,showroomFrame}:Props){
 const [choice,setChoice]=useState<Mode>('arc');
 const viewport=useRef<HTMLDivElement>(null);
 const [selected,setSelected]=useState<string[]>([]);
 const filterGroups=useMemo(()=> (['period','arc','theme'] as const)
  .map(kind=>({kind,options:categories.filter(category=>category.kind===kind)}))
  .filter(group=>group.options.length),[categories]);
 const activeGroups=useMemo(()=>filterGroups.map(({options})=>
  options.filter(category=>selected.includes(category.id)).map(category=>category.id)
 ).filter(ids=>ids.length),[filterGroups,selected]);
 function toggleFilter(category:Category,kind:Mode){
  if(!activeGroups.length)setChoice(kind);
  setSelected(ids=>ids.includes(category.id)?ids.filter(id=>id!==category.id):[...ids,category.id]);
 }
 const mapTopics=selected.length?selected:categories.map(c=>c.id);
 const mapQuery=new URLSearchParams(mapTopics.map(id=>['topic',id]));
 const relatedContext=useMemo(()=>{
  const byId=new Map(records.map(record=>[record.id,record]));
  const context=new Map<string,{peer:string;body:string}>();
  for(const relation of relations){
   if(relation.fromType!=='event'||relation.toType!=='event'||relation.visible===false||relation.status!=='verified')continue;
   const from=byId.get(relation.fromId),to=byId.get(relation.toId),body=relation.body?.trim();
   if(!from||!to||!body)continue;
   if(!context.has(from.sourceId))context.set(from.sourceId,{peer:to.title,body});
   if(!context.has(to.sourceId))context.set(to.sourceId,{peer:from.title,body});
  }
  return context;
 },[records,relations]);
 const places=useMemo(()=>new Map(records.map(record=>[record.sourceId,record.place])),[records]);
 const mode=categories.some(c=>c.kind===choice)?choice:modeOrder.find(kind=>categories.some(c=>c.kind===kind))??choice;
 const {columns,years,visibleCount}=useMemo(()=>{
  const counts=new Map<string,number>();
  const selectedColumns=categories.filter(c=>c.kind===mode&&selected.includes(c.id));
  const allowed=new Map((selectedColumns.length?selectedColumns:categories.filter(c=>c.kind===mode)).map(c=>[c.id,c]));
  const chronological=[...events].sort((a,b)=>a.bounds.start-b.bounds.start||a.id.localeCompare(b.id));
  const visible=chronological.filter(event=>activeGroups.every(ids=>ids.some(id=>event.directTopicIds.includes(id))));
  let ungrouped=0;
  for(const event of visible){
   const matches=[...new Set(event.directTopicIds)].filter(id=>allowed.has(id));
   if(!matches.length)ungrouped++;
   for(const id of matches)counts.set(id,(counts.get(id)??0)+1);
  }
  const columns=Array.from(counts,([id,count])=>({...allowed.get(id)!,count}));
  if(ungrouped)columns.push({id:uncategorized,name:modes[mode]+' 미분류',kind:mode,count:ungrouped});
  return {
   columns,
   years:strataTimeline(visible),visibleCount:visible.length
  };
 },[categories,events,mode,activeGroups,selected]);
 const decades=years.filter((entry,i)=>!i||Math.floor(entry.year/10)!==Math.floor(years[i-1].year/10));
 useLayoutEffect(()=>{
  const box=viewport.current,head=box?.querySelector('thead');
  if(!box||!head)return;
  function pinHeader(){
   if(!showroomFrame||!box)return;
   const top=frameTop(showroomFrame)+box.getBoundingClientRect().top+box.clientTop;
   box.style.setProperty('--head-top',Math.max(0,-top)+'px');
  }
  const measure=()=>{
   box.style.setProperty('--head-height',head.offsetHeight+'px');
   pinHeader();
  };
  measure();
  const observer=new ResizeObserver(measure);observer.observe(box);observer.observe(head);
  if(showroomFrame)window.parent.addEventListener('scroll',pinHeader,{passive:true});
  return ()=>{
   observer.disconnect();
   if(showroomFrame)window.parent.removeEventListener('scroll',pinHeader);
  };
 },[mode,columns,showroomFrame]);
 useLayoutEffect(()=>{viewport.current?.scrollTo(0,0);},[mode,selected]);
 // Cards rise one after another as they scroll into view.
 useEffect(()=>{
  const box=viewport.current;
  if(!box||!('IntersectionObserver' in window)||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  box.dataset.motion='';
  const observer=new IntersectionObserver(entries=>{
   const arrived=entries.filter(entry=>entry.isIntersecting).map(entry=>entry.target as HTMLElement);
   for(const [i,card] of arrived.entries()){
    card.style.setProperty('--bt-delay',Math.min(i*70,700)+'ms');
    card.dataset.shown='';
    observer.unobserve(card);
   }
  },{rootMargin:'0px 0px -6% 0px'});
  for(const card of box.querySelectorAll('.basic-timeline-event:not([data-shown])'))observer.observe(card);
  return ()=>observer.disconnect();
 },[years,columns]);
 function jumpYear(year:number){
  const box=viewport.current,group=box?.querySelector('tbody[data-year="'+year+'"]');
  const head=box?.querySelector('thead');
  if(!box||!group||!head)return;
  const top=group.getBoundingClientRect().top;
  if(showroomFrame)window.parent.scrollBy(0,top+frameTop(showroomFrame)-head.offsetHeight);
  else box.scrollTop+=top-head.getBoundingClientRect().bottom;
 }
 return <section id="panel-timeline" role="tabpanel" aria-labelledby="tab-timeline" className="basic-timeline">
  <header className="bt-heading">
   <div>{years.length>0&&<h2>{years[0].year}{years.length>1&&<> — {years.at(-1)!.year}</>}</h2>}
    <p aria-live="polite">{activeGroups.length?`사건 ${visibleCount} / ${events.length}개 표시`:`사건 ${visibleCount}개`}</p></div>
   <div className="bt-modes" role="group" aria-label="열 기준"><span>열 기준</span>{modeOrder.map(kind=>
    <button type="button" key={kind} aria-pressed={mode===kind} disabled={!categories.some(c=>c.kind===kind)} onClick={()=>setChoice(kind)}>{modes[kind]}</button>
   )}</div>
  </header>
  {decades.length>1&&<nav className="bt-jumps" aria-label="연대 바로가기">{decades.map(({year})=>
   <button key={year} onClick={()=>jumpYear(year)}>{Math.floor(year/10)*10}년대 ↓</button>
  )}</nav>}
  {filterGroups.length>0&&<section className="bt-filters" aria-label="카테고리 필터">
   <header><h3>카테고리 필터</h3>
    <a className="bt-atlas" href={'/history-map.html?'+mapQuery} target="_blank" rel="noreferrer">지도 제작실에서 열기 ↗</a>
    <button type="button" disabled={!activeGroups.length} onClick={()=>setSelected([])}>선택 해제</button>
   </header>
   {filterGroups.map(({kind,options})=><div key={kind} role="group" aria-label={modes[kind]} className="bt-filter-group">
    <strong>{modes[kind]}</strong>
    <div>{options.map(category=><button type="button" key={category.id} aria-pressed={selected.includes(category.id)}
     onClick={()=>toggleFilter(category,kind)}>{filterLabel(category)}</button>)}</div>
   </div>)}
  </section>}
  {!visibleCount?<p role="status">선택한 조건에 맞는 사건이 없습니다.</p>:
   <div className="bt-board" ref={viewport} role="region" aria-label={modes[mode]+'별 연표'} tabIndex={0}>
    <table style={{'--lanes':columns.length} as CSSProperties} aria-label={modes[mode]+'별 사건'}>
     <colgroup><col className="bt-year-col"/><col className="bt-date-col"/>{columns.map(col=><col key={col.id}/>)}</colgroup>
     <thead><tr><th colSpan={2}>연도</th>{columns.map((col,i)=><th key={col.id} scope="col" data-tone={i%3}>{col.name} <small>{col.count}개</small></th>)}</tr></thead>
     {years.map(group=><tbody key={group.year} data-year={group.year}>{group.events.map((event,index)=>{
      const assigned=new Set(event.directTopicIds);
      const ungrouped=!columns.some(col=>col.id!==uncategorized&&assigned.has(col.id));
      const membership=columns.map(col=>col.id===uncategorized?ungrouped:assigned.has(col.id));
      const last=membership.lastIndexOf(true);
      const place=places.get(event.id)||event.place;
      const description=event.description?.trim().replace(/^>\s*/,'');
      const context=description&&description!==event.title?undefined:relatedContext.get(event.id);
      const summary=context?.body||(description!==event.title?description:'');
      const period=event.endDate?periodLabel(event.date,event.endDate):'';
      const month=event.endDate?'':monthLabel(event.date);
      return <tr key={event.id}>
       {!index&&<th scope="rowgroup" rowSpan={group.events.length}><span>{group.year}</span></th>}
       <th scope="row"><time className="bt-visually-hidden" dateTime={event.date}>{dateLabel(event.date,group.year)}</time></th>
       {columns.map((col,i)=><td key={col.id} data-tone={i%3} className={i===last?'bt-branch bt-end':i<last?'bt-branch':undefined}>
        {membership[i]&&<button type="button" className="basic-timeline-event" data-open-event={event.id} aria-haspopup="dialog"
         aria-label={event.date+' '+event.title} onClick={e=>onVisit(event.id,e.currentTarget)}>
         <span className="bt-card-heading"><strong>{event.title}{month&&<small className="bt-card-month">{month}</small>}</strong><span className="bt-card-chevron" aria-hidden="true">›</span></span>
         {(period||place)&&<span className="bt-card-facts">
          {period&&<span className="bt-card-period">{period}</span>}{place&&<span>{place}</span>}
         </span>}
         {summary&&<span className="bt-card-context">
          {context&&<span className="bt-card-peer">관련 사건 · {context.peer}</span>}
          <span className="bt-card-summary">{summary.split(/\r?\n/,1)[0]}</span>
         </span>}
        </button>}
       </td>)}
      </tr>;
     })}</tbody>)}
    </table>
   </div>}
 </section>;
}
