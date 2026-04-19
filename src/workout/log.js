import { esc, normalizeWeightType, parseScheme, parseDurationMin, estimateCalories } from '../utils/misc.js';
import { fmtDate, dotw } from '../utils/date.js';
import { DEF_CFG } from '../constants.js';
import { startRestTimer, startLiveTimer, updateStickyCalories } from './timers.js';

let _ctx = null;

export function initLog(ctx) { _ctx = ctx; }

function repIntensity(r){
  if(r<=1)return 1.00; if(r<=2)return 0.95; if(r<=3)return 0.90;
  if(r<=4)return 0.88; if(r<=5)return 0.85; if(r<=6)return 0.82;
  if(r<=7)return 0.80; if(r<=8)return 0.77; if(r<=9)return 0.75;
  if(r<=10)return 0.72; if(r<=11)return 0.70; if(r<=12)return 0.67;
  if(r<=14)return 0.63; return 0.58;
}
function calcSuggestedWeight(lastWeight,lastReps,lastSets,newReps,newSets){
  if(!lastWeight||lastWeight<=0) return 0;
  const repsRatio = repIntensity(newReps)/repIntensity(lastReps);
  const setsAdj = n => 1/(1+(n-1)*0.05);
  const raw = lastWeight*repsRatio*(setsAdj(newSets)/setsAdj(lastSets));
  const inc = _ctx.cfg.weightIncrement||5;
  return Math.round(raw/inc)*inc;
}
function lastForEx(name){
  for(const s of _ctx.sessions){ const e=s.exercises.find(e=>e.name===name); if(e) return e; }
  return null;
}
function lastForExByType(name,type){
  const normType = normalizeWeightType(type);
  const match = normType==='bodyweight'
    ? t => normalizeWeightType(t)==='bodyweight'
    : t => normalizeWeightType(t)===normType;
  for(const s of _ctx.sessions){ const e=s.exercises.find(e=>e.name===name&&match(e.weightType||'standard')); if(e) return e; }
  return null;
}
function machById(id){ return (_ctx.machines||[]).find(m=>m.id===id); }

export function buildSetsArea(ex,ei){
  function cellHtml(s){
    const done=ex.setsDone[s];
    return`<div class="j-cell-set${done?' done':''}" id="row-${ei}-${s}" onclick="toggleDone(${ei},${s})"><div class="j-set-frac" onclick="event.stopPropagation();startEditReps(event,${ei},${s})"><span class="j-set-actual" id="sa-${ei}-${s}">${ex.repsLog[s]}</span><span class="j-set-slash">/</span><span class="j-set-target">${ex.targetReps}</span></div><input class="j-set-input" id="si-${ei}-${s}" type="number" inputmode="numeric" value="${ex.repsLog[s]}" onchange="commitReps(${ei},${s},this.value)" onblur="blurReps(${ei},${s})" onclick="event.stopPropagation()"><div class="j-set-chk">✓</div></div>`;
  }
  function rowHtml(from,to,cont){
    const hdrs=Array.from({length:to-from},(_,i)=>`<div class="j-sets-col-hdr-cell">S${from+i+1}</div>`).join('');
    const cells=Array.from({length:to-from},(_,i)=>cellHtml(from+i)).join('');
    return`<div class="j-sets-col-hdr${cont?' j-sets-row-continuation':''}">${hdrs}</div><div class="j-sets-grid">${cells}</div>`;
  }
  if(ex.sets<=5) return rowHtml(0,ex.sets,false);
  const row1=Math.ceil(ex.sets/2);
  return rowHtml(0,row1,false)+rowHtml(row1,ex.sets,true);
}

function fmtCal(s){if(!s.calories)return'';return s.caloriesEst?`~${s.calories} cal <span style="font-size:10px;opacity:.7;">(est.)</span>`:`${s.calories} cal`;}
function fmtCalFull(s){
  const strCal=parseFloat(s.calories)||0;
  const crdCal=parseFloat(s.cardio?.calories)||0;
  const tot=strCal+crdCal;
  if(!tot)return'';
  if(strCal&&crdCal){
    const strTxt=s.caloriesEst?`~${strCal} cal <span style="font-size:10px;opacity:.7;">(est.)</span>`:`${strCal} cal`;
    return `💪 ${strTxt} &nbsp;·&nbsp; 🏃 ${crdCal} cal &nbsp;·&nbsp; 🔥 ${tot} cal total`;
  }
  if(strCal)return'🔥 '+fmtCal(s);
  return`🔥 ${crdCal} cal`;
}

export function wtTypeLabel(ex){
  const unit = _ctx.cfg.profile&&_ctx.cfg.profile.weightUnit==='kg'?'KG':'LBS';
  switch(normalizeWeightType(ex.weightType)){
    case 'level': return 'LVL';
    case 'bodyweight': return (ex.weight||0)>0?'BW+':'BW';
    default: return unit;
  }
}
export function updateTypeBadge(ei){
  const ex = _ctx.active.exercises[ei];
  if(normalizeWeightType(ex.weightType)!=='bodyweight') return;
  const badge = document.getElementById('wt-type-badge-'+ei);
  if(badge) badge.textContent = wtTypeLabel(ex);
}
export function updatePRBadge(ei){
  const ex = _ctx.active.exercises[ei];
  const k = ex.group+'::'+ex.name;
  const prW = (_ctx.stats.prs&&_ctx.stats.prs[k]) ? _ctx.stats.prs[k].weight : 0;
  const badge = document.getElementById('pr-badge-'+ei);
  if(badge) badge.style.display = (ex.weight>0&&ex.weight>prW) ? '' : 'none';
}
export function adjWt(ei,d){
  const ex = _ctx.active.exercises[ei];
  let newVal = Math.max(0,(ex.weight||0)+d);
  if(normalizeWeightType(ex.weightType)==='level') newVal=Math.round(newVal);
  ex.weight = newVal;
  const el = document.getElementById('wt-'+ei); if(el) el.value=ex.weight;
  updateTypeBadge(ei); updatePRBadge(ei); _ctx.saveActiveThrottled();
}
export function setWt(ei,v){
  const w = parseFloat(v);
  _ctx.active.exercises[ei].weight = (!isNaN(w)&&w>=0) ? Math.min(w,2000) : 0;
  updateTypeBadge(ei); updatePRBadge(ei); _ctx.saveActiveThrottled();
}
export function cycleWeightType(ei){
  const TYPES = ['standard','level','bodyweight'];
  const ex = _ctx.active.exercises[ei];
  const currentType = normalizeWeightType(ex.weightType);
  const idx = TYPES.indexOf(currentType);
  const newType = TYPES[(idx+1)%TYPES.length];
  ex.weightType = newType;
  if(newType==='bodyweight'){
    const lastOfType = lastForExByType(ex.name,'bodyweight');
    ex.weight = lastOfType ? (lastOfType.weight||0) : 0;
  } else {
    const lastOfType = lastForExByType(ex.name, newType);
    if(lastOfType){
      if(newType==='standard'){
        const{sets:ls,reps:lr}=parseScheme(lastOfType.scheme);
        const{sets,reps}=parseScheme(ex.scheme);
        ex.weight = calcSuggestedWeight(lastOfType.weight,lr,ls,reps,sets);
      } else { ex.weight = lastOfType.weight||0; }
    } else { ex.weight = 0; }
  }
  renderToday(); _ctx.saveActiveThrottled();
}
export function toggleDone(ei,si){
  const active = _ctx.active;
  active.exercises[ei].setsDone[si] = !active.exercises[ei].setsDone[si];
  const done = active.exercises[ei].setsDone[si];
  const cell = document.getElementById(`row-${ei}-${si}`);
  if(cell){
    cell.classList.toggle('done',done);
    if(done){ cell.classList.remove('set-pop'); void cell.offsetWidth; cell.classList.add('set-pop'); }
  }
  const totalSets = active.exercises.reduce((a,ex)=>a+ex.sets,0);
  const doneSets = active.exercises.reduce((a,ex)=>a+ex.setsDone.filter(Boolean).length,0);
  const fill = document.getElementById('j-prog-fill');
  if(fill){
    fill.style.width = totalSets>0 ? Math.round((doneSets/totalSets)*100)+'%' : '0%';
    fill.classList.toggle('complete', doneSets===totalSets&&totalSets>0);
  }
  const ctr = document.getElementById('sets-counter'); if(ctr) ctr.textContent=`${doneSets}/${totalSets}`;
  const stickyCtr = document.getElementById('sticky-sets-counter'); if(stickyCtr) stickyCtr.textContent=`${doneSets}/${totalSets}`;
  checkExComplete(ei); updateStickyCalories(); _ctx.saveActiveToLocal();
  if(done) startRestTimer();
}
export function startEditReps(e,ei,si){
  e.stopPropagation();
  const inp = document.getElementById(`si-${ei}-${si}`);
  const disp = document.getElementById(`sa-${ei}-${si}`);
  if(!inp||!disp) return;
  inp.classList.add('editing'); disp.style.display='none';
  inp.value = _ctx.active.exercises[ei].repsLog[si];
  inp.focus(); inp.select();
}
export function commitReps(ei,si,val){
  const v = Math.max(0,Math.min(parseInt(val)||0,999));
  _ctx.active.exercises[ei].repsLog[si] = v;
  const disp = document.getElementById(`sa-${ei}-${si}`);
  if(disp) disp.textContent=v;
  _ctx.saveActiveThrottled();
}
export function blurReps(ei,si){
  const inp = document.getElementById(`si-${ei}-${si}`);
  const disp = document.getElementById(`sa-${ei}-${si}`);
  if(inp){ commitReps(ei,si,inp.value); inp.classList.remove('editing'); }
  if(disp) disp.style.display='';
}
export function checkExComplete(ei){
  const active = _ctx.active;
  const ex = active.exercises[ei];
  const card = document.getElementById('jex-'+ei); if(!card) return;
  card.classList.toggle('ex-complete', ex.setsDone.every(Boolean));
  const totalSets = active.exercises.reduce((a,e)=>a+e.sets,0);
  const doneSets = active.exercises.reduce((a,e)=>a+e.setsDone.filter(Boolean).length,0);
  const ctr = document.getElementById('sets-counter'); if(ctr) ctr.textContent=doneSets+'/'+totalSets;
  const stickyCtr = document.getElementById('sticky-sets-counter'); if(stickyCtr) stickyCtr.textContent=doneSets+'/'+totalSets;
}
export function setEffort(n){
  _ctx.active.effort = n;
  document.querySelectorAll('.eff-btn').forEach((b,i)=>{ b.className='eff-btn'+(n===i+1?' e'+(i+1):''); });
  _ctx.saveActiveToLocal();
}
export function selMachine(id){
  _ctx.flushCardio(); _ctx.flushStrength();
  _ctx.active.cardio.machine = id;
  renderToday();
  setTimeout(()=>{ const el=document.querySelector('.cardio-card'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); },80);
}

export function renderToday(){
  const wrap = document.getElementById('j-wrap');
  const { active, cfg, stats, machines, fmtWt, saveActiveThrottled } = _ctx;
  if(!active){
    wrap.innerHTML=`<div style="text-align:center;padding:64px 20px;color:#888;font-size:11px;letter-spacing:2px;text-transform:uppercase;line-height:2.2;">
      <div style="font-family:'Black Ops One',sans-serif;font-size:22px;letter-spacing:4px;color:#ccc;margin-bottom:8px;">READY</div>
      Go to Build tab to generate &amp; start a workout
    </div>`;
    return;
  }
  const w = active;
  const inc = cfg.weightIncrement||5;
  const fmtTime = iso => { if(!iso)return'—'; const d=new Date(iso); return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); };
  const totalSets = w.exercises.reduce((a,ex)=>a+ex.sets,0);
  const doneSets = w.exercises.reduce((a,ex)=>a+ex.setsDone.filter(Boolean).length,0);

  let html=`
  <div class="j-hdr">
    <div class="j-hdr-inner">
      <div>
        <div class="j-hdr-date">${dotw(w.date)} · ${fmtDate(w.date)}</div>
        <div class="j-hdr-title">Workout Log</div>
      </div>
      <div class="j-hdr-meta">
        <div class="j-hdr-stat"><div class="j-hdr-stat-val">${w.exercises.length}</div><div class="j-hdr-stat-lbl">Lifts</div></div>
        <div class="j-hdr-stat"><div class="j-hdr-stat-val" id="sets-counter">${doneSets}/${totalSets}</div><div class="j-hdr-stat-lbl">Sets</div></div>
      </div>
    </div>
  </div>
  <div class="j-sticky-bar">
    <div class="j-sticky-inner">
      <span class="j-sticky-sets"><span id="sticky-sets-counter">${doneSets}/${totalSets}</span> sets · started ${fmtTime(w.startedAt)}</span>
      <span class="j-sticky-cal" id="sticky-cal"></span>
      <span class="j-sticky-timer j-live-timer" id="live-elapsed">—</span>
    </div>
    <div class="j-progress"><div class="j-progress-fill${doneSets===totalSets&&totalSets>0?' complete':''}" id="j-prog-fill" style="width:${totalSets>0?Math.round((doneSets/totalSets)*100):0}%"></div></div>
  </div>
  <div class="j-section-lbl">Strength Training</div>
  <div style="padding:0 0 8px;">`;

  w.exercises.forEach((ex,ei)=>{
    const allDone = ex.setsDone.every(Boolean);
    const cp = cfg.cardPrefs||DEF_CFG.cardPrefs;
    const lastInfo = (cp.showLastSession!==false)&&ex.last
      ? `<div class="j-ex-last"><span style="margin-right:2px;">Prev:</span><span class="j-ex-last-w">${fmtWt(ex.last.weight,false,ex.last.weightType)}</span>${ex.last.scheme&&ex.last.scheme!==ex.scheme?`<span style="font-size:9px;color:var(--j-mut);margin-left:3px;">(${esc(ex.last.scheme)})</span>`:''}</div>`
      : '';
    const prKey = ex.group+'::'+ex.name;
    const prW = (stats.prs&&stats.prs[prKey]) ? stats.prs[prKey].weight : 0;
    const isPR = ex.weight>0&&ex.weight>prW;
    html+=`<div class="j-ex${allDone?' ex-complete':''}" id="jex-${ei}">
      <div class="j-ex-name-row">
        <div style="min-width:0;flex:1;">
          <div class="j-ex-name">${esc(ex.name)}</div>
          ${(cp.showGroupLabel!==false||((cp.showCues!==false)&&ex.cue))?`<div class="j-ex-grp">${cp.showGroupLabel!==false?esc(ex.group):''}${(cp.showGroupLabel!==false)&&(cp.showCues!==false)&&ex.cue?' · ':''}<span class="j-ex-cue">${(cp.showCues!==false)&&ex.cue?esc(ex.cue):''}</span></div>`:''}
        </div>
        <div class="j-ex-right">${lastInfo}<div class="j-ex-scheme">${esc(ex.scheme)}</div></div>
      </div>
      <div class="j-wt-row">
        <span class="j-wt-lbl">Weight</span>
        ${(()=>{const wt=normalizeWeightType(ex.weightType);const isLvl=wt==='level';const isBW=wt==='bodyweight';return`<div class="j-wt-ctrl">
          <button class="j-adj" onclick="adjWt(${ei},-${isLvl?1:inc})">−</button>
          <input class="j-wt-val" type="number" inputmode="${isLvl?'numeric':'decimal'}" id="wt-${ei}"
            step="${isLvl?'1':'any'}"
            value="${ex.weight||0}" placeholder="${isBW?'+ extra':''}" onchange="setWt(${ei},this.value)" onfocus="this.select()">
          <button class="j-adj" onclick="adjWt(${ei},${isLvl?1:inc})">+</button>
        </div>`;})()}
        <button class="j-wt-type-badge" id="wt-type-badge-${ei}" title="Change weight type" onclick="cycleWeightType(${ei})">${wtTypeLabel(ex)}</button>
        ${normalizeWeightType(ex.weightType)==='standard'?`<button class="j-plate-btn" title="Plate calculator" onclick="openPlateCalc(${ei})">🔢</button>`:''}
      </div>
      <div class="j-pr-badge" id="pr-badge-${ei}" style="${isPR?'':'display:none'}">🔥 NEW PR!</div>
      ${buildSetsArea(ex,ei)}
    </div>`;
  });
  html+='</div>';

  const cd = w.cardio;
  const selM = cd.machine ? machById(cd.machine) : null;
  const machGrid = machines.map(m=>`
    <button class="mach-btn${cd.machine===m.id?' sel':''}" onclick="selMachine('${m.id}')">
      <span class="mi">${m.icon}</span>${m.name}
    </button>`).join('');
  const metField = selM ? `<div class="c-row">
    <span class="c-lbl">${selM.metric}</span>
    <input class="c-inp" id="cd-metric" type="number" inputmode="decimal" placeholder="0"
      value="${cd.metric}" onchange="active.cardio.metric=this.value;saveActiveThrottled()">
    <span class="c-unit">${selM.unit}</span>
  </div>` : '';
  html+=`<div class="j-divider"><span>Cardio</span></div>
  <div class="cardio-card">
    <div class="cardio-hdr"><span style="font-size:20px;">🫀</span><span class="cardio-title">Cardio Log</span>
      ${selM?`<span style="font-size:11px;color:var(--j-mut);margin-left:auto;">${selM.icon} ${selM.name}</span>`:''}
    </div>
    <div class="cardio-body">
      <div class="machine-grid">${machGrid}</div>
      <div id="cardio-fields" style="${cd.machine?'':'display:none'}">
        <div class="cardio-fields">
          <div class="c-row"><span class="c-lbl">Program</span>
            <input class="c-inp" id="cd-prog" type="text" placeholder="e.g. Weight Loss Mode Level 3"
              value="${cd.program||''}" onchange="active.cardio.program=this.value;saveActiveThrottled()">
          </div>
          <div class="c-row"><span class="c-lbl">Duration</span>
            <input class="c-inp" id="cd-dur" type="text" placeholder="e.g. 30 min"
              value="${cd.duration}" onchange="active.cardio.duration=this.value;saveActiveThrottled()">
          </div>
          ${metField}
          <div class="c-row"><span class="c-lbl">Calories</span>
            <input class="c-inp" id="cd-cal" type="number" inputmode="numeric" placeholder="from machine"
              value="${cd.calories}" onchange="active.cardio.calories=this.value;saveActiveThrottled()">
            <span class="c-unit">cal</span>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  const effHtml = [['Easy',1],['Good',2],['Hard',3],['Max',4]].map(([l,n])=>
    `<button class="eff-btn${w.effort===n?' e'+n:''}" onclick="setEffort(${n})">${l}</button>`).join('');
  html+=`<div class="j-divider"><span>Wrap Up</span></div>
  <div class="finish-card">
    <div class="finish-hdr">Session Notes</div>
    <div class="finish-body">
      <div class="f-row"><span class="f-lbl">Effort</span><div class="effort-opts">${effHtml}</div></div>
      <div class="f-row"><span class="f-lbl">Total Time</span>
        <input class="f-inp" type="text" placeholder="e.g. 75 min" value="${w.duration}" onchange="active.duration=this.value;saveActiveThrottled()">
      </div>
      <div class="f-row"><span class="f-lbl">Calories${cfg.profile?.weight?'<span style="font-size:9px;font-weight:400;color:var(--j-mut);margin-left:4px;">(est. ready)</span>':''}</span>
        <input class="f-inp" type="number" inputmode="numeric" placeholder="${(()=>{if(!cfg.profile?.weight)return'from watch';const dMin=parseDurationMin(w.duration);const est=estimateCalories(w.exercises,dMin,w.effort,cfg.profile);return est?'~'+est+' cal (est.)':'from watch'})()}" value="${w.calories}" onchange="active.calories=this.value;saveActiveThrottled()">
      </div>
      <div>
        <div class="j-sets-lbl" style="margin-bottom:7px;padding-top:4px;">Notes</div>
        <textarea class="f-textarea" placeholder="How did it go? Any PRs, observations..."
          onchange="active.notes=this.value;saveActiveThrottled()">${w.notes||''}</textarea>
      </div>
    </div>
  </div>
  <button class="save-btn" onclick="saveWorkout()">Save &amp; Finish</button>`;
  wrap.innerHTML = html;
  startLiveTimer();
}
