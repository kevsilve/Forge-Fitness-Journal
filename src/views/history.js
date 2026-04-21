import { dc, esc, normalizeWeightType, parseScheme, sessionTotalCal } from '../utils/misc.js';
import { fmtDate, dotw, isoFromDate, todayISO, getWeekStart } from '../utils/date.js';
import { sv } from '../storage.js';
import { gistPush } from '../sync/gist.js';
import { isSupabaseEnabled, dbDeleteSession } from '../sync/supabase.js';
import { EFFORT_LABELS, EFFORT_COLORS } from '../constants.js';

let _ctx = null;
let _pendingDelete = null;
export let editSessionData = null;

export function initHistory(ctx) { _ctx = ctx; }

// ── local helpers ────────────────────────────────────────────────────────────

function fmtCal(s){if(!s.calories)return'';return s.caloriesEst?`~${s.calories} cal <span style="font-size:10px;opacity:.7;">(est.)</span>`:`${s.calories} cal`;}
function fmtCalFull(s){
  const strCal=parseFloat(s.calories)||0;
  const crdCal=parseFloat(s.cardio?.calories)||0;
  const tot=strCal+crdCal;
  if(!tot)return'';
  if(strCal&&crdCal){const strTxt=s.caloriesEst?`~${strCal} cal <span style="font-size:10px;opacity:.7;">(est.)</span>`:`${strCal} cal`;return`💪 ${strTxt} &nbsp;·&nbsp; 🏃 ${crdCal} cal &nbsp;·&nbsp; 🔥 ${tot} cal total`;}
  if(strCal)return'🔥 '+fmtCal(s);
  return`🔥 ${crdCal} cal`;
}
function machById(id){return _ctx.machines.find(m=>m.id===id);}
function getGroupExerciseMap(){
  return _ctx.groups.map(g=>({id:g.id,name:g.name,exercises:g.exercises.filter(e=>e.enabled).map(e=>e.name)})).filter(g=>g.exercises.length>0);
}
function getCalMonthDate(){
  const v=_ctx.calViewMonth;
  if(v)return new Date(v.year,v.month,1);
  return new Date();
}

// ── rebuildStats ─────────────────────────────────────────────────────────────

export function rebuildStats(){
  const s={total:0,exercises:{},weightHistory:{},totalReps:{},prs:{}};
  const ordered=[..._ctx.sessions].reverse();
  ordered.forEach(sess=>{
    s.total++;
    (sess.exercises||[]).forEach(ex=>{
      const k=ex.group+'::'+ex.name;
      s.exercises[k]=(s.exercises[k]||0)+1;
      const wt=ex.weightType||'standard';
      if(!s.weightHistory[k])s.weightHistory[k]=[];
      s.weightHistory[k].push({date:sess.date,weight:ex.weight,weightType:wt});
      const reps=(ex.repsLog||[]).reduce((a,b)=>a+b,0);
      s.totalReps[k]=(s.totalReps[k]||0)+reps;
      const cur=s.prs[k];
      const normWt2=normalizeWeightType(wt);
      if(!(normWt2==='bodyweight'&&(ex.weight||0)===0)&&(!cur||ex.weight>cur.weight)){
        s.prs[k]={weight:ex.weight,weightType:normWt2,date:sess.date,scheme:ex.scheme,reps:ex.repsLog};
      }
    });
  });
  _ctx.stats=s;
  sv('fj_stats',_ctx.stats);
}

// ── history dispatcher ───────────────────────────────────────────────────────

export function renderHistory(){
  const hv=_ctx.histView,hf=_ctx.histFilter;
  document.getElementById('hist-view-toggle').innerHTML=`
    <div class="hist-view-toggle">
      <button class="hvt-btn${hv==='week'?' active':''}"  onclick="setHistView('week')">📅 Week</button>
      <button class="hvt-btn${hv==='month'?' active':''}" onclick="setHistView('month')">📆 Month</button>
      <button class="hvt-btn${hv==='list'?' active':''}"  onclick="setHistView('list')">☰ All${(hf.effort||hf.group)?'<span class="hvt-filter-dot"></span>':''}</button>
    </div>`;
  document.getElementById('week-section').style.display=hv==='week'  ?'':'none';
  document.getElementById('cal-section').style.display =hv==='month' ?'':'none';
  document.getElementById('hist-wrap').style.display   =hv==='list'  ?'':'none';
  if(hv==='week')  renderWeekView();
  if(hv==='month') renderMonthView();
  if(hv==='list')  renderListView();
}
export function setHistView(v){_ctx.histView=v;_ctx.expandedChip=null;renderHistory();}

// ── week view ────────────────────────────────────────────────────────────────

function renderWeekView(){
  const wrap=document.getElementById('week-section');
  const ws=getWeekStart(_ctx.weekOffset);
  const today=todayISO();
  const DOW_S=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const weekDays=Array.from({length:7},(_,i)=>{const d=new Date(ws);d.setDate(ws.getDate()+i);return isoFromDate(d);});
  const byDate={};
  _ctx.sessions.forEach(s=>{if(!byDate[s.date])byDate[s.date]=[];byDate[s.date].push(s);});
  const fmtShort=iso=>{const d=new Date(iso+'T12:00:00');return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});};
  const rangeLabel=`${fmtShort(weekDays[0])} – ${fmtShort(weekDays[6])}`;
  if(!_ctx.weekSelectedDate||!weekDays.includes(_ctx.weekSelectedDate)){
    _ctx.weekSelectedDate=weekDays.includes(today)?today:(weekDays.slice().reverse().find(d=>byDate[d]?.length)||weekDays[0]);
  }
  const strip=weekDays.map((iso,i)=>{
    const ss=byDate[iso]||[];
    const hasSess=ss.length>0;
    const isToday=iso===today,isSel=iso===_ctx.weekSelectedDate,isFuture=iso>today;
    const dayNum=parseInt(iso.split('-')[2]);
    const exCount=ss.reduce((a,s)=>a+s.exercises.length,0);
    let cls='week-day-cell';
    if(hasSess)cls+=' has-session';if(isToday)cls+=' is-today';if(isSel)cls+=' is-selected';
    const sub=hasSess?`<span class="wdc-sub">${exCount}ex</span>`:isFuture?`<span class="wdc-sub"> </span>`:`<span class="wdc-sub rest">·</span>`;
    return`<div class="${cls}" onclick="weekSelectDay('${iso}')">
      <span class="wdc-label">${DOW_S[i]}</span>
      <div class="wdc-bubble">${dayNum}</div>
      ${sub}
    </div>`;
  }).join('');
  const wSessions=weekDays.flatMap(d=>byDate[d]||[]);
  const wDaysWorked=weekDays.filter(d=>byDate[d]?.length).length;
  const wExCount=wSessions.reduce((a,s)=>a+s.exercises.length,0);
  const wVol=wSessions.reduce((a,s)=>a+s.exercises.reduce((b,ex)=>{
    if(normalizeWeightType(ex.weightType)==='level')return b;
    const reps=(ex.repsLog||[]).reduce((c,r)=>c+(r>0?r:0),0);
    return b+(ex.weight||0)*reps;
  },0),0);
  const volStr=wVol>=1000?`${(wVol/1000).toFixed(1)}k`:`${Math.round(wVol)}`;
  const wCalories=Math.round(wSessions.reduce((a,s)=>a+sessionTotalCal(s),0));
  const wCalStr=wCalories>=1000?`${(wCalories/1000).toFixed(1)}k`:`${wCalories}`;
  const selSessions=byDate[_ctx.weekSelectedDate]||[];
  let detailHtml=`<div class="week-detail">
    <div class="week-detail-hdr">
      <span class="wdh-dow">${dotw(_ctx.weekSelectedDate)}</span>
      <span class="wdh-date">${fmtDate(_ctx.weekSelectedDate)}</span>
    </div>`;
  if(!selSessions.length){
    detailHtml+=`<div class="wdh-rest">Rest day — no workout logged.</div>`;
  } else {
    selSessions.forEach(s=>{
      const metaParts=[];
      if(s.effort)metaParts.push(`<span class="wsm-badge" style="color:${EFFORT_COLORS[s.effort]}">${EFFORT_LABELS[s.effort]}</span>`);
      if(s.duration)metaParts.push(`<span class="wsm-stat">⏱ ${esc(s.duration)}</span>`);
      if(sessionTotalCal(s))metaParts.push(`<span class="wsm-stat">${fmtCalFull(s)}</span>`);
      const fmtT=iso=>{if(!iso)return null;return new Date(iso).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});};
      const ts=fmtT(s.startedAt);
      if(ts)metaParts.push(`<span class="wsm-stat">🕐 ${ts}</span>`);
      if(metaParts.length)detailHtml+=`<div class="week-sess-meta">${metaParts.join('')}</div>`;
      if(s.cardio&&s.cardio.machine){
        const m=machById(s.cardio.machine);
        const parts=[];
        if(s.cardio.program)parts.push(`📋 ${esc(s.cardio.program)}`);
        if(s.cardio.duration)parts.push(esc(s.cardio.duration));
        if(s.cardio.metric)parts.push(`${esc(s.cardio.metric)} ${m?esc(m.unit):''}`);
        if(s.cardio.calories)parts.push(`${parseFloat(s.cardio.calories)||0} cal`);
        detailHtml+=`<div class="week-cardio-chip">
          <span class="wcc-icon">${m?m.icon:'🏃'}</span>
          <div><div class="wcc-name">${m?esc(m.name):'Cardio'}</div><div class="wcc-stats">${parts.join(' · ')}</div></div>
        </div>`;
      }
      detailHtml+=`<div class="week-ex-chips">`;
      (s.exercises||[]).forEach((ex,ei)=>{
        const chipKey=`${s.id}::${ei}`;
        const isExp=_ctx.expandedChip===chipKey;
        const pills=ex.repsLog.map((r,si2)=>`<span class="wec-set-pill">Set ${si2+1}: ${_ctx.fmtWt(ex.weight,false,ex.weightType)} × ${r}</span>`).join('');
        detailHtml+=`
          <div class="week-ex-chip${isExp?' expanded':''}" onclick="toggleChip('${chipKey}')">
            <div class="wec-top">
              <div class="wec-info">
                <div class="wec-name">${esc(ex.name)}</div>
                <div class="wec-sub">${esc(ex.group)} · ${esc(ex.scheme)}</div>
              </div>
              <div class="wec-right">
                <span class="wec-wt">${_ctx.fmtWt(ex.weight,false,ex.weightType)}</span>
                <span class="wec-expand-icon">▼</span>
              </div>
            </div>
            <div class="wec-detail${isExp?' open':''}">
              <div class="wec-sets-row">${pills}</div>
            </div>
          </div>`;
      });
      detailHtml+=`</div>`;
      if(s.notes)detailHtml+=`<div class="h-notes" style="margin:0 0 10px;border-radius:6px;">"${esc(s.notes)}"</div>`;
      detailHtml+=`<div style="display:flex;justify-content:flex-end;margin:4px 0 10px;"><button class="sess-export-btn" title="Export session as PNG" onclick="exportSessionCard('${s.id}')">⬇</button></div>`;
    });
  }
  detailHtml+=`</div>`;
  wrap.innerHTML=`
    <div class="week-nav">
      <button class="week-nav-btn" onclick="weekNav(-1)">‹</button>
      <span class="week-range-lbl">${rangeLabel}</span>
      <button class="week-today-btn" onclick="weekGoToday()">This Week</button>
      <button class="week-nav-btn" onclick="weekNav(1)">›</button>
    </div>
    <div class="week-strip">${strip}</div>
    <div class="week-summary${wCalories>0?' has-cal':''}">
      <div class="week-sum-item"><span class="week-sum-val">${wDaysWorked}</span><span class="week-sum-lbl">Days</span></div>
      <div class="week-sum-item"><span class="week-sum-val">${wSessions.length}</span><span class="week-sum-lbl">Sessions</span></div>
      <div class="week-sum-item"><span class="week-sum-val">${wExCount}</span><span class="week-sum-lbl">Exercises</span></div>
      <div class="week-sum-item"><span class="week-sum-val">${volStr}</span><span class="week-sum-lbl">Vol ${_ctx.cfg.profile.weightUnit==='kg'?'kg':'lb'}</span></div>
      ${wCalories>0?`<div class="week-sum-item cal-item"><span class="week-sum-val" style="color:var(--accent);">🔥${wCalStr}</span><span class="week-sum-lbl">Cal</span></div>`:''}
    </div>
    ${detailHtml}`;
}
export function weekNav(d){_ctx.weekOffset+=d;_ctx.weekSelectedDate=null;_ctx.expandedChip=null;renderWeekView();}
export function weekGoToday(){_ctx.weekOffset=0;_ctx.weekSelectedDate=todayISO();_ctx.expandedChip=null;renderWeekView();}
export function weekSelectDay(iso){
  _ctx.weekSelectedDate=(_ctx.weekSelectedDate===iso)?null:iso;
  if(!_ctx.weekSelectedDate)_ctx.weekSelectedDate=iso;
  _ctx.expandedChip=null;
  renderWeekView();
  setTimeout(()=>{const el=document.querySelector('.week-detail');if(el)el.scrollIntoView({behavior:'smooth',block:'nearest'});},60);
}
export function toggleChip(key){_ctx.expandedChip=(_ctx.expandedChip===key)?null:key;renderWeekView();}

// ── month view ───────────────────────────────────────────────────────────────

function renderMonthView(){
  const calSec=document.getElementById('cal-section');
  const md=getCalMonthDate();
  const year=md.getFullYear(),month=md.getMonth();
  const monthName=md.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const today=todayISO();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const firstDow=new Date(year,month,1).getDay();
  const sessionsByDate={};
  _ctx.sessions.forEach(s=>{if(!sessionsByDate[s.date])sessionsByDate[s.date]=[];sessionsByDate[s.date].push(s);});
  const DOW=['Su','Mo','Tu','We','Th','Fr','Sa'];
  const dowHdr=DOW.map(d=>`<div class="cal-dow">${d}</div>`).join('');
  let cells='';
  for(let i=0;i<firstDow;i++)cells+=`<div class="cal-day cal-empty"></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const iso=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const daySessions=sessionsByDate[iso]||[];
    const hasSession=daySessions.length>0,isToday=iso===today,isFuture=iso>today,isSelected=_ctx.calSelectedDate===iso;
    let cls='cal-day';
    if(isToday)cls+=' cal-today';if(isFuture)cls+=' cal-future';if(hasSession)cls+=' cal-has-session';if(isSelected)cls+=' cal-selected';
    const dot=hasSession?`<div class="cal-day-dot${daySessions.length>1?' multi':''}"></div>`:'';
    const cnt=daySessions.length>1?`<div class="cal-day-count">${daySessions.length}</div>`:'';
    cells+=`<div class="${cls}" onclick="calSelectDay('${iso}')"><span class="cal-day-num">${d}</span>${dot}${cnt}</div>`;
  }
  const monthSessions=_ctx.sessions.filter(s=>s.date.startsWith(`${year}-${String(month+1).padStart(2,'0')}`));
  const monthDays=new Set(monthSessions.map(s=>s.date)).size;
  const monthExCount=monthSessions.reduce((a,s)=>a+s.exercises.length,0);
  const monthCalories=Math.round(monthSessions.reduce((a,s)=>a+sessionTotalCal(s),0));
  const monthCalStr=monthCalories>=1000?`${(monthCalories/1000).toFixed(1)}k`:`${monthCalories}`;
  let detailHtml='';
  if(_ctx.calSelectedDate){
    const daySessions=sessionsByDate[_ctx.calSelectedDate]||[];
    if(!daySessions.length){
      detailHtml=`<div class="cal-detail" id="cal-detail">
        <div class="cal-detail-hdr">
          <div><div class="cal-detail-date">${dotw(_ctx.calSelectedDate)}</div>
          <div class="cal-detail-meta">${fmtDate(_ctx.calSelectedDate)}</div></div>
          <button class="cal-detail-close" onclick="calSelectDay('${_ctx.calSelectedDate}')">×</button>
        </div>
        <div class="cal-detail-empty">No workout logged</div>
      </div>`;
    } else {
      daySessions.forEach(s=>{
        const exRows=(s.exercises||[]).map(ex=>`
          <div class="h-ex-row">
            <div><div class="h-ex-name">${esc(ex.name)}</div><div class="h-ex-grp">${esc(ex.group)}</div></div>
            <div class="h-ex-r">
              <div class="h-ex-wt">${_ctx.fmtWt(ex.weight,false,ex.weightType)}</div>
              <div class="h-ex-sets">${esc(ex.scheme)} · ${(ex.repsLog||[]).join(', ')}</div>
            </div>
          </div>`).join('');
        let cardioHtml='';
        if(s.cardio&&s.cardio.machine){
          const m=machById(s.cardio.machine);
          const parts=[];
          if(s.cardio.program)parts.push(`📋 ${esc(s.cardio.program)}`);
          if(s.cardio.duration)parts.push(esc(s.cardio.duration));
          if(s.cardio.metric)parts.push(`${esc(s.cardio.metric)} ${m?esc(m.unit):''}`);
          if(s.cardio.calories)parts.push(`${parseFloat(s.cardio.calories)||0} cal`);
          cardioHtml=`<div class="h-cardio-row"><span class="h-cardio-icon">${m?m.icon:'🏃'}</span>
            <div><div class="h-cardio-name">${m?esc(m.name):esc(s.cardio.machine)}</div>
            <div class="h-cardio-stats">${parts.join(' · ')}</div></div></div>`;
        }
        const notesHtml=s.notes?`<div class="h-notes">"${esc(s.notes)}"</div>`:'';
        const badge=s.effort?`<span class="h-badge" style="color:${EFFORT_COLORS[s.effort]}">${EFFORT_LABELS[s.effort]}</span>`:'';
        const ftParts=[];
        if(s.duration)ftParts.push(`<div class="h-fi">⏱ <span class="h-fv">${esc(s.duration)}</span></div>`);
        if(sessionTotalCal(s))ftParts.push(`<div class="h-fi"><span class="h-fv">${fmtCalFull(s)}</span></div>`);
        const footer=ftParts.length?`<div class="h-footer">${ftParts.join('')}</div>`:'';
        detailHtml+=`<div class="cal-detail" id="cal-detail">
          <div class="cal-detail-hdr">
            <div><div class="cal-detail-date">${dotw(_ctx.calSelectedDate)}, ${fmtDate(_ctx.calSelectedDate)}</div>
            <div class="cal-detail-meta">${(s.exercises||[]).length} exercises${s.cardio&&s.cardio.machine?' · cardio':''}</div></div>
            <div style="display:flex;gap:6px;align-items:center;">${badge}
              <button class="sess-export-btn" title="Export session as PNG" onclick="exportSessionCard('${s.id}')">⬇</button>
              <button class="cal-detail-close" onclick="calSelectDay('${_ctx.calSelectedDate}')">×</button>
            </div>
          </div>
          ${exRows}${cardioHtml}${notesHtml}${footer}
        </div>`;
      });
    }
  }
  calSec.innerHTML=`
    <div class="cal-nav">
      <button class="cal-nav-btn" onclick="calNav(-1)">‹</button>
      <span class="cal-month-lbl">${monthName}</span>
      <button class="cal-today-btn" onclick="calGoToday()">Today</button>
      <button class="cal-nav-btn" onclick="calNav(1)">›</button>
    </div>
    <div class="cal-wrap">
      <div class="cal-grid-wrap">
        <div class="cal-dow-row">${dowHdr}</div>
        <div class="cal-grid">${cells}</div>
      </div>
      <div class="cal-summary">
        <div class="cal-sum-item"><span class="cal-sum-val">${monthSessions.length}</span><span class="cal-sum-lbl">Sessions</span></div>
        <div class="cal-sum-item"><span class="cal-sum-val">${monthDays}</span><span class="cal-sum-lbl">Days</span></div>
        <div class="cal-sum-item"><span class="cal-sum-val">${monthExCount}</span><span class="cal-sum-lbl">Exercises</span></div>
        ${monthCalories>0?`<div class="cal-sum-item"><span class="cal-sum-val" style="color:var(--accent);">🔥${monthCalStr}</span><span class="cal-sum-lbl">Cal</span></div>`:''}
      </div>
      ${detailHtml}
    </div>`;
}
export function calNav(d){
  const cur=getCalMonthDate();
  const nd=new Date(cur.getFullYear(),cur.getMonth()+d,1);
  _ctx.calViewMonth={year:nd.getFullYear(),month:nd.getMonth()};
  renderHistory();
}
export function calGoToday(){_ctx.calViewMonth=null;_ctx.calSelectedDate=null;renderHistory();}
export function calSelectDay(iso){
  _ctx.calSelectedDate=(_ctx.calSelectedDate===iso)?null:iso;
  renderHistory();
  if(_ctx.calSelectedDate){setTimeout(()=>{const el=document.getElementById('cal-detail');if(el)el.scrollIntoView({behavior:'smooth',block:'nearest'});},60);}
}

// ── list view ───────────────────────────────────���────────────────────────────

export function setHistFilter(key,val){_ctx.histFilter[key]=val;renderListView();}
function renderListView(){
  const histWrap=document.getElementById('hist-wrap');
  if(!_ctx.sessions.length){
    histWrap.innerHTML=`<div class="empty-state-card">
      <span class="es-icon">📋</span>
      <div class="es-title">NO SESSIONS YET</div>
      <div class="es-sub">Complete your first workout to see it here</div>
      <button class="es-cta" onclick="switchTab('generate')">Build a Workout</button>
      <button class="es-secondary" onclick="openManualEntry()">+ Log Past Session</button>
    </div>`;
    return;
  }
  const hf=_ctx.histFilter;
  const effortOpts=[['All',0],['Easy',1],['Good',2],['Hard',3],['Max',4]];
  const effortPills=effortOpts.map(([lbl,v])=>`<button class="hf-pill${hf.effort===v?' active':''}" onclick="setHistFilter('effort',${v})">${lbl}</button>`).join('');
  const allGroups=[...new Set(_ctx.sessions.flatMap(s=>(s.exercises||[]).map(e=>e.group).filter(Boolean)))].sort();
  const groupOpts=['<option value="">All groups</option>',...allGroups.map(g=>`<option value="${esc(g)}"${hf.group===g?' selected':''}>${esc(g)}</option>`)].join('');
  const isFiltered=hf.effort!==0||hf.group!=='';
  const filterBar=`<div class="hist-filter-bar">
    <div class="hf-row"><div class="hf-pills">${effortPills}</div>
      <select class="hf-grp-sel" onchange="setHistFilter('group',this.value)">${groupOpts}</select>
      ${isFiltered?`<button class="hf-clear" onclick="histFilter={effort:0,group:''};renderListView()">✕ Clear</button>`:''}
    </div>
  </div>`;
  const filtered=_ctx.sessions.filter(s=>{
    if(hf.effort&&s.effort!==hf.effort)return false;
    if(hf.group&&!(s.exercises||[]).some(e=>e.group===hf.group))return false;
    return true;
  });
  const listTotalCal=Math.round(filtered.reduce((a,s)=>a+sessionTotalCal(s),0));
  const calLabel=listTotalCal>0?` · 🔥${listTotalCal>=1000?(listTotalCal/1000).toFixed(1)+'k':listTotalCal} cal`:'';
  const countLabel=isFiltered?`${filtered.length} / ${_ctx.sessions.length} sessions`:
    `${_ctx.sessions.length} session${_ctx.sessions.length!==1?'s':''}`;
  const toolbar=`<div class="hist-toolbar">
    <span class="hist-count">${countLabel}${calLabel}</span>
    <div style="display:flex;gap:7px;">
      <button class="hist-clear-btn accent" onclick="openManualEntry()">+ Log Past</button>
      <button class="hist-clear-btn" onclick="clearHistory()">Clear History</button>
    </div>
  </div>`;
  const rows=filtered.map((s,si)=>{
    const badge=s.effort?`<span class="h-badge" style="color:${EFFORT_COLORS[s.effort]}">${EFFORT_LABELS[s.effort]}</span>`:'';
    const exRows=(s.exercises||[]).map(ex=>`
      <div class="h-ex-row">
        <div><div class="h-ex-name">${esc(ex.name)}</div><div class="h-ex-grp">${esc(ex.group)}</div></div>
        <div class="h-ex-r">
          <div class="h-ex-wt">${_ctx.fmtWt(ex.weight,false,ex.weightType)}</div>
          <div class="h-ex-sets">${esc(ex.scheme)} · ${(ex.repsLog||[]).join(', ')}</div>
        </div>
      </div>`).join('');
    let cardioHtml='';
    if(s.cardio&&s.cardio.machine){
      const m=machById(s.cardio.machine);
      const parts=[];
      if(s.cardio.program)parts.push(`📋 ${esc(s.cardio.program)}`);
      if(s.cardio.duration)parts.push(esc(s.cardio.duration));
      if(s.cardio.metric)parts.push(`${esc(s.cardio.metric)} ${m?esc(m.unit):''}`);
      if(s.cardio.calories)parts.push(`${parseFloat(s.cardio.calories)||0} cal`);
      cardioHtml=`<div class="h-cardio-row">
        <span class="h-cardio-icon">${m?m.icon:'🏃'}</span>
        <div><div class="h-cardio-name">${m?esc(m.name):esc(s.cardio.machine)}</div>
        <div class="h-cardio-stats">${parts.join(' · ')}</div></div>
      </div>`;
    }
    const notesHtml=s.notes?`<div class="h-notes">"${esc(s.notes)}"</div>`:'';
    const ftParts=[];
    if(s.duration)ftParts.push(`<div class="h-fi">⏱ <span class="h-fv">${esc(s.duration)}</span></div>`);
    if(sessionTotalCal(s))ftParts.push(`<div class="h-fi"><span class="h-fv">${fmtCalFull(s)}</span></div>`);
    const footer=ftParts.length?`<div class="h-footer">${ftParts.join('')}</div>`:'';
    const fmtTime=iso=>{if(!iso)return null;const d=new Date(iso);return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});};
    const tsStart=fmtTime(s.startedAt),tsEnd=fmtTime(s.savedAt);
    const tsHtml=(tsStart||tsEnd)?`<div class="h-ts">
      ${tsStart?`<span>🕐 Started <strong>${tsStart}</strong></span>`:''}
      ${tsEnd?`<span>🏁 Finished <strong>${tsEnd}</strong></span>`:''}
    </div>`:'';
    return`<div class="hist-sess" style="animation-delay:${si*.03}s">
      <div class="hist-sess-hdr" onclick="toggleHist(${si})">
        <div><div class="hsd-date">${dotw(s.date)}, ${fmtDate(s.date)}</div>
        <div class="hsd-meta">${s.exercises.length} exercises${s.cardio&&s.cardio.machine?' · cardio':''}</div></div>
        <div class="hsd-right">
          ${badge}
          <button class="h-sess-edit" title="Repeat this workout" onclick="event.stopPropagation();repeatSession('${s.id}')">↺</button>
          <button class="sess-export-btn" title="Export session as PNG" onclick="event.stopPropagation();exportSessionCard('${s.id}')">⬇</button>
          <button class="h-sess-edit" title="Edit session" onclick="event.stopPropagation();openEditSession('${s.id}')">✎</button>
          <button class="h-sess-del" title="Delete session" onclick="event.stopPropagation();deleteSession('${s.id}')">×</button>
          <span class="h-chev" id="hc-${si}">▼</span>
        </div>
      </div>
      <div class="hist-body" id="hb-${si}">${exRows}${cardioHtml}${notesHtml}${tsHtml}${footer}</div>
    </div>`;
  }).join('');
  const emptyHtml=!filtered.length?`<div class="empty-state-card" style="margin:12px;">
    <span class="es-icon">🔍</span>
    <div class="es-title">NO SESSIONS MATCH</div>
    <div class="es-sub">Try adjusting your filters</div>
    <button class="es-secondary" onclick="histFilter={effort:0,group:''};renderListView()">Clear filters</button>
  </div>`:'';
  histWrap.innerHTML=filterBar+toolbar+'<div style="padding-bottom:16px;">'+rows+emptyHtml+'</div>';
}
export function toggleHist(si){
  const b=document.getElementById('hb-'+si),c=document.getElementById('hc-'+si);
  b.classList.toggle('open');c.classList.toggle('open',b.classList.contains('open'));
}

// ── delete / undo ─────────────────────────────────────────────────────────��──

function _commitPendingDelete(){
  if(!_pendingDelete)return;
  clearTimeout(_pendingDelete.t);
  sv('fj_sessions',_ctx.sessions);
  rebuildStats();
  _pendingDelete=null;
}
export function deleteSession(id){
  _commitPendingDelete();
  const removed=_ctx.sessions.find(s=>String(s.id)===String(id));
  if(!removed)return;
  _ctx.sessions=_ctx.sessions.filter(s=>String(s.id)!==String(id));
  renderHistory();
  _pendingDelete={session:removed,t:setTimeout(()=>{
    _pendingDelete=null;sv('fj_sessions',_ctx.sessions);rebuildStats();
    if(isSupabaseEnabled()) dbDeleteSession(removed.id).catch(()=>{});
    else if(_ctx.gistCfg.pat){gistPush(_ctx.gistCfg,_ctx.buildPayload()).catch(()=>{});}
  },5000)};
  _ctx.toastHtml(`Session removed &nbsp;<span style="font-weight:700;color:var(--accent);cursor:pointer;text-decoration:underline;" onclick="undoDelete()">Undo</span>`,5200);
}
export function undoDelete(){
  if(!_pendingDelete)return;
  clearTimeout(_pendingDelete.t);
  const s=_pendingDelete.session;
  _pendingDelete=null;
  _ctx.sessions.push(s);
  _ctx.sessions.sort((a,b)=>b.id-a.id);
  renderHistory();
  _ctx.toast('Session restored');
}
export function clearHistory(){
  const root=document.getElementById('modal-root');
  root.innerHTML=`<div class="modal-overlay" onclick="if(event.target===this)document.getElementById('modal-root').innerHTML=''">
    <div class="modal" onclick="event.stopPropagation()" style="max-height:60vh;">
      <div class="modal-hdr">
        <span class="modal-title" style="color:#ef4444;">⚠ CLEAR HISTORY</span>
        <button class="modal-close" onclick="document.getElementById('modal-root').innerHTML=''">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--j-txt2);line-height:1.6;margin-bottom:16px;">
          This will permanently delete all <strong>${_ctx.sessions.length} session${_ctx.sessions.length!==1?'s':''}</strong> and rebuild stats from scratch.
        </p>
        <p style="font-size:12px;color:var(--j-mut);margin-bottom:10px;">Type <strong>DELETE</strong> to confirm:</p>
        <input class="me-inp" id="clear-hist-confirm" type="text" placeholder="DELETE" style="width:100%;margin-bottom:16px;"
          oninput="const b=document.getElementById('clear-hist-go');b.style.opacity=this.value==='DELETE'?'1':'.5';b.style.cursor=this.value==='DELETE'?'pointer':'not-allowed';b.disabled=this.value!=='DELETE';">
        <button class="me-save-btn" id="clear-hist-go" disabled style="background:#ef4444;opacity:.5;cursor:not-allowed;"
          onclick="if(document.getElementById('clear-hist-confirm').value==='DELETE'){document.getElementById('modal-root').innerHTML='';_doClearHistory();}">
          Permanently Delete History
        </button>
      </div>
    </div>
  </div>`;
}
export async function _doClearHistory(){
  _ctx.sessions=[];sv('fj_sessions',_ctx.sessions);
  rebuildStats();
  if(_ctx.gistCfg.pat){try{await gistPush(_ctx.gistCfg,_ctx.buildPayload());}catch(e){}}
  _ctx.toast('History cleared');renderHistory();
}

// ── edit session ──────────────────────────────────────────────────────────────

export function openEditSession(id){
  const sess=_ctx.sessions.find(s=>String(s.id)===String(id));
  if(!sess)return;
  editSessionData=JSON.parse(JSON.stringify(sess));
  renderEditModal();
}
export function renderEditModal(){
  const root=document.getElementById('modal-root');
  const s=editSessionData;
  const gmap=getGroupExerciseMap();
  const allGroupNames=gmap.map(g=>g.name);
  const exHtml=s.exercises.map((ex,i)=>{
    const grpOpts=allGroupNames.map(n=>`<option value="${n}"${ex.group===n?' selected':''}>${n}</option>`).join('');
    const matchedGroup=gmap.find(g=>g.name===ex.group);
    const exOptions=matchedGroup?matchedGroup.exercises.map(e=>e):gmap.flatMap(g=>g.exercises.map(e=>e));
    const exOpts=exOptions.map(n=>`<option value="${n}"${ex.name===n?' selected':''}>${n}</option>`).join('');
    const setsHtml=ex.repsLog.map((r,si)=>`
      <div style="display:flex;align-items:center;gap:5px;">
        <span style="font-size:10px;color:var(--j-mut);width:14px;">${si+1}</span>
        <input class="me-inp me-inp-sm" type="number" inputmode="numeric" value="${r}"
          onchange="editSessionData.exercises[${i}].repsLog[${si}]=parseInt(this.value)||0">
      </div>`).join('');
    return`<div class="me-ex-card">
      <div class="me-ex-top">
        <span class="me-ex-num">${i+1}</span>
        <button class="me-ex-del" onclick="editRemoveEx(${i})">×</button>
      </div>
      <div class="me-ex-fields">
        <div class="me-field" style="flex:1;min-width:120px;"><span class="me-field-lbl">Group</span>
          <select class="me-inp" style="width:100%;" onchange="editSessionData.exercises[${i}].group=this.value">${grpOpts}</select>
        </div>
        <div class="me-field" style="flex:1;min-width:140px;"><span class="me-field-lbl">Exercise</span>
          <select class="me-inp" style="width:100%;" onchange="editSessionData.exercises[${i}].name=this.value">${exOpts}</select>
        </div>
        <div class="me-field"><span class="me-field-lbl">Type</span>
          <select class="me-inp" onchange="editSessionData.exercises[${i}].weightType=this.value;renderEditModal()">
            <option value="standard"${normalizeWeightType(ex.weightType)==='standard'?' selected':''}>LBS${_ctx.cfg.profile&&_ctx.cfg.profile.weightUnit==='kg'?'/KG':''}</option>
            <option value="level"${normalizeWeightType(ex.weightType)==='level'?' selected':''}>Level</option>
            <option value="bodyweight"${normalizeWeightType(ex.weightType)==='bodyweight'?' selected':''}>Bodyweight</option>
          </select>
        </div>
        <div class="me-field"><span class="me-field-lbl">${normalizeWeightType(ex.weightType)==='bodyweight'?'Extra Wt':_ctx.wtTypeLabel(ex)}</span>
          <input class="me-inp me-inp-sm" type="number" inputmode="${normalizeWeightType(ex.weightType)==='level'?'numeric':'decimal'}"
            step="${normalizeWeightType(ex.weightType)==='level'?'1':'any'}" value="${ex.weight||0}" placeholder="${normalizeWeightType(ex.weightType)==='bodyweight'?'0':''}"
            onchange="editSessionData.exercises[${i}].weight=${normalizeWeightType(ex.weightType)==='level'?'parseInt':'parseFloat'}(this.value)||0">
        </div>
        <div class="me-field"><span class="me-field-lbl">Scheme</span>
          <select class="me-inp" onchange="editSetScheme(${i},this.value)">
            ${_ctx.getSchemes().map(sc=>`<option${ex.scheme===sc?' selected':''}>${sc}</option>`).join('')}
          </select>
        </div>
        <div class="me-field"><span class="me-field-lbl">Reps per set</span>
          <div style="display:flex;flex-direction:column;gap:4px;">${setsHtml}</div>
        </div>
      </div>
    </div>`;
  }).join('');
  root.innerHTML=`<div class="modal-overlay" onclick="closeEditModal(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-hdr">
        <span class="modal-title">Edit Session</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="me-del-sess-btn" onclick="deleteEditSession()" title="Delete this session">🗑</button>
          <button class="modal-close" onclick="closeEditModal()">×</button>
        </div>
      </div>
      <div class="modal-body">
        <div class="me-section"><span class="me-section-lbl">Date</span>
          <input class="me-inp" style="width:100%;" type="date" id="edit-date" value="${s.date}" max="${todayISO()}">
        </div>
        <div class="me-section"><span class="me-section-lbl">Exercises</span>
          <div class="me-ex-list">${exHtml}</div>
          <button class="me-add-ex" onclick="editAddEx()">+ Add Exercise</button>
        </div>
        ${(()=>{
          const cd=s.cardio||{machine:null,duration:'',metric:'',calories:'',program:''};
          const selM=cd.machine?machById(cd.machine):null;
          const machGrid=_ctx.machines.map(m=>`
            <button class="mach-btn${cd.machine===m.id?' sel':''}" onclick="editSelMachine('${m.id}')">
              <span class="mi">${m.icon}</span>${m.name}
            </button>`).join('');
          const metField=selM?`<div class="me-field" style="flex:1;min-width:100px;">
            <span class="me-field-lbl">${selM.metric} (${selM.unit})</span>
            <input class="me-inp" style="width:100%;" type="number" inputmode="decimal" placeholder="0"
              value="${cd.metric||''}" onchange="editSessionData.cardio.metric=this.value">
          </div>`:'';
          return`<div class="me-section"><span class="me-section-lbl">Cardio</span>
            <div class="machine-grid">${machGrid}</div>
            <div style="${cd.machine?'':'display:none'}">
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;margin-bottom:8px;">
                <div class="me-field" style="flex:1;min-width:120px;"><span class="me-field-lbl">Program</span>
                  <input class="me-inp" style="width:100%;" type="text" placeholder="e.g. Weight Loss Level 3"
                    value="${esc(cd.program||'')}" onchange="editSessionData.cardio.program=this.value">
                </div>
                <div class="me-field" style="flex:1;min-width:100px;"><span class="me-field-lbl">Duration</span>
                  <input class="me-inp" style="width:100%;" type="text" placeholder="e.g. 30 min"
                    value="${esc(cd.duration||'')}" onchange="editSessionData.cardio.duration=this.value">
                </div>
                ${metField}
                <div class="me-field" style="flex:1;min-width:80px;"><span class="me-field-lbl">Calories</span>
                  <input class="me-inp" style="width:100%;" type="number" inputmode="numeric" placeholder="from machine"
                    value="${cd.calories||''}" onchange="editSessionData.cardio.calories=this.value">
                </div>
              </div>
              <button style="font-size:10px;color:var(--j-mut);background:transparent;border:none;cursor:pointer;padding:2px 0;text-decoration:underline;" onclick="editClearCardio()">Clear cardio</button>
            </div>
          </div>`;
        })()}
        <div class="me-section"><span class="me-section-lbl">Session Notes (optional)</span>
          <textarea class="me-inp" style="width:100%;resize:none;min-height:60px;font-size:13px;" id="edit-notes">${esc(s.notes||'')}</textarea>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
          <div class="me-field" style="flex:2;min-width:160px;"><span class="me-field-lbl">Effort</span>
            <div class="effort-opts">
              <button class="eff-btn${!s.effort?' e0':''}" style="${!s.effort?'border-color:var(--j-acc);color:var(--j-acc);':''}" onclick="editSessionData.effort=null;renderEditModal()">— Skip —</button>
              ${[1,2,3,4].map(n=>`<button class="eff-btn${s.effort===n?' e'+n:''}" onclick="editSessionData.effort=${n};renderEditModal()">${EFFORT_LABELS[n]}</button>`).join('')}
            </div>
          </div>
          <div class="me-field" style="flex:1;min-width:120px;"><span class="me-field-lbl">Total Time</span>
            <input class="me-inp" style="width:100%;" type="text" id="edit-duration" value="${s.duration||''}" placeholder="e.g. 60 min">
          </div>
        </div>
        <button class="me-save-btn" onclick="saveEditSession()">Save Changes</button>
      </div>
    </div>
  </div>`;
}
export function editSelMachine(id){
  if(!editSessionData.cardio)editSessionData.cardio={machine:null,duration:'',metric:'',calories:'',program:''};
  editSessionData.cardio.machine=id;renderEditModal();
}
export function editClearCardio(){editSessionData.cardio={machine:null,duration:'',metric:'',calories:'',program:''};renderEditModal();}
export function deleteEditSession(){
  if(!confirm('Delete this session? This cannot be undone.'))return;
  const idx=_ctx.sessions.findIndex(s=>String(s.id)===String(editSessionData.id));
  if(idx===-1){_ctx.toast('Session not found');return;}
  _ctx.sessions.splice(idx,1);
  sv('fj_sessions',_ctx.sessions);rebuildStats();
  document.getElementById('modal-root').innerHTML='';
  _ctx.toast('Session deleted');renderHistory();
  if(_ctx.gistCfg.pat){_ctx.setSyncStatus('syncing');gistPush(_ctx.gistCfg,_ctx.buildPayload()).then(()=>_ctx.setSyncStatus('synced')).catch(()=>_ctx.setSyncStatus('error'));}
}
export function editRemoveEx(i){editSessionData.exercises.splice(i,1);renderEditModal();}
export function editAddEx(){
  const gmap=getGroupExerciseMap();
  const g=gmap[0]||{name:'General',exercises:[]};
  const exName=g.exercises[0]||'Unnamed';
  editSessionData.exercises.push({name:exName,group:g.name,scheme:'3×10',weight:0,weightType:'standard',repsLog:[10,10,10],arrow:'eq'});
  renderEditModal();
  setTimeout(()=>{const m=document.querySelector('.modal');if(m)m.scrollTop=m.scrollHeight;},50);
}
export function editSetScheme(i,val){
  const{sets,reps}=parseScheme(val);
  editSessionData.exercises[i].scheme=val;
  editSessionData.exercises[i].repsLog=Array(sets).fill(reps);
  renderEditModal();
}
export function closeEditModal(event){
  if(event&&event.target!==event.currentTarget)return;
  document.getElementById('modal-root').innerHTML='';
}
export async function saveEditSession(){
  const dateEl=document.getElementById('edit-date');
  const notesEl=document.getElementById('edit-notes');
  const durEl=document.getElementById('edit-duration');
  const idx=_ctx.sessions.findIndex(s=>String(s.id)===String(editSessionData.id));
  if(idx===-1){_ctx.toast('Session not found');return;}
  const newDate=dateEl?dateEl.value.trim():editSessionData.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(newDate)){_ctx.toast('Invalid date format');return;}
  if(newDate>todayISO()){_ctx.toast('Date cannot be in the future');return;}
  editSessionData.date=newDate;
  editSessionData.notes=notesEl?notesEl.value:editSessionData.notes;
  editSessionData.duration=durEl?durEl.value:editSessionData.duration;
  _ctx.sessions[idx]=editSessionData;
  _ctx.sessions.sort((a,b)=>b.date.localeCompare(a.date));
  sv('fj_sessions',_ctx.sessions);
  rebuildStats();
  document.getElementById('modal-root').innerHTML='';
  _ctx.toast('Session updated ✓');renderHistory();
  if(_ctx.gistCfg.pat){_ctx.setSyncStatus('syncing');try{await gistPush(_ctx.gistCfg,_ctx.buildPayload());_ctx.setSyncStatus('synced');}catch(e){_ctx.setSyncStatus('error');}}
}
