import { esc, pick, shuffle, parseScheme, normalizeWeightType } from '../utils/misc.js';
import { fmtDate, todayISO } from '../utils/date.js';
import { sv } from '../storage.js';
import { computeStreaks } from '../views/stats.js';
import { saveWorkout } from './save.js';
import { renderToday } from './log.js';

let _ctx = null;
let openPicker = {};

export function initGenerate(ctx) { _ctx = ctx; }

function lastForEx(name){
  for(const s of _ctx.sessions){ const e=s.exercises.find(e=>e.name===name); if(e) return e; }
  return null;
}
function enabledEx(g){ return g.exercises.filter(e=>e.enabled); }
function getPlateauCount(name,group){
  const k = group+'::'+name;
  const hist = (_ctx.stats.weightHistory||{})[k]||[];
  if(hist.length<3) return 0;
  const last = hist[hist.length-1].weight;
  let count = 0;
  for(let i=hist.length-1;i>=0;i--){ if(hist[i].weight===last) count++; else break; }
  return count;
}

export function setBuildMode(mode){
  _ctx.buildMode = mode;
  renderPending();
}

export function generate(){
  const { cfg, groups, sessions, active, toast } = _ctx;
  if(active){ toast('Finish or discard your active workout first'); return; }
  if(_ctx.buildMode==='custom'){ toast('Switch to Random mode to generate a workout'); return; }
  const btn = document.getElementById('gen-btn');
  btn.classList.remove('rolling'); void btn.offsetWidth; btn.classList.add('rolling');
  const used = new Set();
  const result = [];
  for(const g of shuffle(groups.filter(g=>g.active&&g.mode==='core'))){
    const avail = enabledEx(g).filter(e=>!used.has(e.name));
    const count = Math.min(g.required||1, avail.length);
    const picked = shuffle(avail).slice(0,count);
    for(const ex of picked){ used.add(ex.name); result.push({name:ex.name,group:g.name,isBonus:false,scheme:pick(_ctx.getSchemes())}); }
  }
  const bonusN = cfg.bonusSlots||2;
  const allGroups = groups.filter(g=>g.active);
  let att=0; const bonusGroupsUsed=[];
  while(bonusGroupsUsed.length<bonusN && att<300){
    att++;
    const cands = allGroups.filter(g=>!bonusGroupsUsed.includes(g.id));
    if(!cands.length) break;
    const g = pick(cands);
    const avail = enabledEx(g).filter(e=>!used.has(e.name));
    if(avail.length){ const ex=pick(avail); used.add(ex.name); bonusGroupsUsed.push(g.id); result.push({name:ex.name,group:g.name,isBonus:true,scheme:pick(_ctx.getSchemes())}); }
    else bonusGroupsUsed.push(g.id);
  }
  if(!result.length){ toast('No exercises available! Check Settings → Exercise Pool'); return; }
  _ctx.pending = result; renderPending();
}

export function renderPending(){
  const { pending, buildMode, active, groups, cfg, stats, fmtWt, getSchemes } = _ctx;
  const c = document.getElementById('ex-cards');
  const rBtn = document.getElementById('bm-random'), cBtn = document.getElementById('bm-custom');
  if(rBtn) rBtn.classList.toggle('active', buildMode==='random');
  if(cBtn) cBtn.classList.toggle('active', buildMode==='custom');
  const genBtn = document.getElementById('gen-btn');
  if(genBtn) genBtn.style.display = buildMode==='random' ? '' : 'none';
  const sb = document.getElementById('start-row');
  if(!pending||!pending.length){
    if(buildMode==='custom'){
      c.innerHTML=`<div class="empty-gen"><span class="empty-big">BUILD IT</span><span class="empty-sub">Tap + Add Exercise to choose your lifts</span><button class="es-secondary" style="margin-top:18px;" onclick="openExercisePicker()">+ Add Exercise</button></div>`;
    } else {
      c.innerHTML=`<div class="empty-gen"><span class="empty-big">FORGE IT</span><span class="empty-sub">Hit Generate to build today's workout</span></div>`;
    }
    if(sb) sb.style.display='none';
    return;
  }
  if(sb) sb.style.display='block';
  c.innerHTML = pending.map((ex,i)=>{
    const grp = groups.find(g=>g.name===ex.group);
    const exDef = grp ? grp.exercises.find(e=>e.name===ex.name) : null;
    const last = lastForEx(ex.name);
    const schemes = getSchemes();
    const platCount = getPlateauCount(ex.name, ex.group);
    const platNote = platCount>=3 ? `<span class="plateau-tag">PLATEAU ×${platCount}</span>` : '';
    const schemeOpts = schemes.map(s=>`<option value="${esc(s)}"${s===ex.scheme?' selected':''}>${esc(s)}</option>`).join('');
    const lastWt = last ? fmtWt(last.weight,false,last.weightType) : '—';
    const prKey = ex.group+'::'+ex.name;
    const prW = (stats.prs&&stats.prs[prKey]) ? fmtWt(stats.prs[prKey].weight,false,stats.prs[prKey].weightType) : '—';
    const cue = exDef ? exDef.cue||'' : '';
    return `<div class="ex-card${ex.isBonus?' bonus':''}">
      <div class="ex-card-hdr">
        <div>
          <div class="ex-card-name">${esc(ex.name)}${platNote}</div>
          <div class="ex-card-grp">${esc(ex.group)}${ex.isBonus?' <span class="bonus-tag">BONUS</span>':''}</div>
          ${cue?`<div class="ex-card-cue">${esc(cue)}</div>`:''}
        </div>
        <button class="ex-card-remove" onclick="removeCustomEx('${esc(ex.name).replace(/'/g,"\\'")}')">×</button>
      </div>
      <div class="ex-card-meta">
        <span>Last: ${lastWt}</span>
        <span>PR: ${prW}</span>
        <select class="scheme-sel" onchange="cycleSchemeSelect('${esc(ex.name).replace(/'/g,"\\'")}',this.value)">${schemeOpts}</select>
      </div>
    </div>`;
  }).join('');
  const add = document.getElementById('add-ex-btn');
  if(add) c.appendChild(add);
  if(add) c.innerHTML+=`<div style="padding:8px 12px 4px;"><button class="es-secondary" style="width:100%;margin:0;" onclick="openExercisePicker()">+ Add Exercise</button></div>`;
}

export function renderGenStreakChip(){
  const { cfg, sessions } = _ctx;
  const el = document.getElementById('gen-streak-chip'); if(!el) return;
  const {current,periodProgress,periodGoal,periodLabel} = computeStreaks(cfg, sessions);
  const mode = cfg.streakMode||'weekly';
  const done = periodProgress>=periodGoal;
  const unit = mode==='daily'?'day':mode==='weekly'?'week':'month';
  const left = current>0
    ? `<div class="gen-streak-count"><span class="gen-streak-fire">🔥</span>${current}-${unit} streak</div>`
    : `<div class="gen-streak-idle">No active streak</div>`;
  const right = mode==='daily'
    ? `<div class="gen-streak-prog${done?' done':''}">${done?'Logged today ✓':'Log today'}</div>`
    : `<div class="gen-streak-prog${done?' done':''}">${periodProgress}/${periodGoal} ${unit}s${done?' ✓':''}</div>`;
  el.innerHTML = left+right;
}

export function renderTemplates(){
  const { templates, fmtDate: fmt } = _ctx;
  const el = document.getElementById('templates-section'); if(!el) return;
  if(!templates||!templates.length){ el.innerHTML=''; return; }
  el.innerHTML=`<div class="tmpl-label">SAVED WORKOUTS</div>`+templates.map(t=>
    `<div class="tmpl-row">
      <div class="tmpl-info" onclick="loadTemplate('${t.id}')">
        <div class="tmpl-name">${esc(t.name)}</div>
        <div class="tmpl-meta">${t.exercises.length} exercise${t.exercises.length!==1?'s':''}</div>
      </div>
      <button class="tmpl-del" onclick="deleteTemplate('${t.id}')">×</button>
    </div>`
  ).join('');
}
export function saveAsTemplate(){
  const { pending, templates, toast } = _ctx;
  if(!pending||!pending.length){ toast('Generate or build a workout first'); return; }
  const name = prompt('Template name:','My Workout');
  if(!name||!name.trim()) return;
  if(templates.length>=20){ toast('Max 20 templates'); return; }
  templates.push({id:Date.now().toString(), name:name.trim(), exercises:pending.map(e=>({name:e.name,group:e.group,scheme:e.scheme}))});
  sv('fj_templates', templates);
  renderTemplates();
  _ctx.toast(`Template "${name.trim()}" saved ✓`);
}
export function loadTemplate(id){
  const { active, templates, groups, toast } = _ctx;
  if(active){ toast('Finish your active workout first'); return; }
  const t = templates.find(t=>t.id===id); if(!t) return;
  const exMap = groups.flatMap(g=>g.exercises.map(e=>({...e,group:g.name})));
  _ctx.pending = t.exercises.map(te=>{
    const matched = exMap.find(e=>e.name===te.name);
    const last = lastForEx(te.name);
    return{name:te.name, group:te.group, scheme:te.scheme||'3×10', isBonus:false,
      weight:last?last.weight:0, last:last||null, cue:matched?matched.cue||'':''};
  });
  _ctx.buildMode = 'custom';
  renderPending();
  toast(`"${t.name}" loaded`);
}
export function deleteTemplate(id){
  _ctx.templates = _ctx.templates.filter(t=>t.id!==id);
  sv('fj_templates', _ctx.templates);
  renderTemplates();
}
export function openExercisePicker(){
  const { active, toast } = _ctx;
  if(active){ toast('Finish active workout first'); return; }
  const root = document.getElementById('modal-root');
  root.innerHTML=`<div class="modal-overlay" onclick="if(event.target===this)closePickerModal()">
    <div class="modal" onclick="event.stopPropagation()" style="max-height:90vh;">
      <div class="modal-hdr" style="position:sticky;top:0;z-index:10;">
        <span class="modal-title">ADD EXERCISES</span>
        <button class="modal-close" onclick="closePickerModal()">×</button>
      </div>
      <div class="modal-body" style="padding:0 0 20px;">${renderPickerGroups()}</div>
    </div>
  </div>`;
}
export function renderPickerGroups(){
  const { groups, getSchemes } = _ctx;
  let pending = _ctx.pending;
  if(!pending) pending=[];
  const added = new Set(pending.map(e=>e.name));
  return groups.filter(g=>g.active).map(g=>{
    const open = openPicker[g.id];
    const exItems = g.exercises.filter(e=>e.enabled).map(ex=>{
      const sel = added.has(ex.name);
      return`<div class="picker-ex-item${sel?' selected':''}" onclick="togglePickerEx('${esc(ex.name).replace(/'/g,"\\'")}','${esc(g.name).replace(/'/g,"\\'")}')">
        <span class="picker-ex-name">${esc(ex.name)}</span>
        <span class="picker-ex-check">${sel?'✓':''}</span>
      </div>`;
    }).join('');
    return`<div class="picker-group">
      <div class="picker-group-hdr${open?' open':''}" onclick="togglePickerGroup('${g.id}')">
        <span class="picker-group-name">${esc(g.name)}</span>
        <span class="picker-group-count">${g.exercises.filter(e=>e.enabled).length} exercises</span>
        <span class="picker-group-chev">▼</span>
      </div>
      ${open?`<div class="picker-ex-list">${exItems}</div>`:''}
    </div>`;
  }).join('');
}
export function togglePickerGroup(gid){
  openPicker[gid] = !openPicker[gid];
  const root = document.getElementById('modal-root');
  if(root) root.querySelector('.modal-body').innerHTML=renderPickerGroups();
}
export function togglePickerEx(name,group){
  let pending = _ctx.pending; if(!pending) pending=[];
  const idx = pending.findIndex(e=>e.name===name);
  if(idx>-1){ pending.splice(idx,1); }
  else{ pending.push({name,group,isBonus:false,scheme:_ctx.getSchemes()[0]}); }
  _ctx.pending = pending;
  const root = document.getElementById('modal-root');
  if(root) root.querySelector('.modal-body').innerHTML=renderPickerGroups();
  renderPending();
  const sb = document.getElementById('start-row');
  if(sb) sb.style.display = pending.length>0 ? 'block' : 'none';
}
export function closePickerModal(){ document.getElementById('modal-root').innerHTML=''; }
export function cycleScheme(name){
  const pending = _ctx.pending;
  const ex = pending&&pending.find(e=>e.name===name); if(!ex) return;
  const schemes = _ctx.getSchemes(); const idx = schemes.indexOf(ex.scheme);
  ex.scheme = schemes[(idx+1)%schemes.length];
  renderPending();
}
export function cycleSchemeSelect(name,val){
  const pending = _ctx.pending;
  const ex = pending&&pending.find(e=>e.name===name); if(!ex) return;
  ex.scheme = val;
}
export function removeCustomEx(name){
  if(!_ctx.pending) return;
  _ctx.pending = _ctx.pending.filter(e=>e.name!==name);
  renderPending();
}
export function repeatSession(id){
  const { active, sessions, toast } = _ctx;
  if(active){ toast('Finish or discard active workout first'); return; }
  const s = sessions.find(s=>String(s.id)===String(id));
  if(!s||!s.exercises.length){ toast('No exercises to repeat'); return; }
  _ctx.pending = s.exercises.map(ex=>({name:ex.name,group:ex.group,scheme:ex.scheme,isBonus:false}));
  _ctx.buildMode = 'custom';
  _ctx.switchTab('generate');
  toast('Loaded '+s.exercises.length+' exercises from '+fmtDate(s.date));
}

export function renderActiveWorkoutBanner(){
  const { active, armed } = _ctx;
  const container = document.getElementById('view-generate');
  const existing = document.getElementById('active-workout-banner');
  if(existing) existing.remove();
  const genBtn = document.getElementById('gen-btn');
  if(genBtn){ genBtn.style.opacity=active?'.35':''; genBtn.style.cursor=active?'not-allowed':''; }
  if(!active) return;
  const exDone = active.exercises.filter(ex=>ex.setsDone.every(Boolean)&&ex.arrow!==null).length;
  const banner = document.createElement('div');
  banner.id = 'active-workout-banner';
  banner.className = 'active-workout-banner';
  banner.innerHTML=`
    <div class="awb-title"><span class="awb-pulse"></span> WORKOUT IN PROGRESS</div>
    <div class="awb-sub">${active.exercises.length} exercises · ${exDone}/${active.exercises.length} complete · started ${(()=>{if(!active.startedAt)return 'earlier';const d=new Date(active.startedAt);return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});})()}</div>
    <div class="awb-btns">
      <button class="awb-btn-go" onclick="switchTab('today')">▶ Go to Workout</button>
      <button class="awb-btn-end" onclick="endAndSaveActive()">✓ End &amp; Save</button>
      <button class="awb-btn-discard${armed['discard-active']?' armed':''}" onclick="discardActiveWorkout()" id="discard-btn">
        ${armed['discard-active']?'Confirm Discard':'✕ Discard'}
      </button>
    </div>`;
  container.insertBefore(banner, container.firstChild);
}

export function discardActiveWorkout(){
  const { armed, lsSet, toast } = _ctx;
  if(armed['discard-active']){
    clearTimeout(armed['discard-active_t']);
    delete armed['discard-active']; delete armed['discard-active_t'];
    _ctx.clearLiveTimer();
    _ctx.active = null; _ctx.pending = null;
    lsSet('fj_active_workout', null);
    renderPending();
    renderActiveWorkoutBanner();
    toast('Workout discarded');
  } else {
    armed['discard-active'] = true;
    armed['discard-active_t'] = setTimeout(()=>{delete armed['discard-active'];delete armed['discard-active_t'];renderActiveWorkoutBanner();},3000);
    renderActiveWorkoutBanner();
  }
}

export async function endAndSaveActive(){
  if(!_ctx.active) return;
  renderActiveWorkoutBanner();
  await saveWorkout();
}

export function startWorkout(){
  const { cfg, groups, sessions, active, pending, toast, switchTab, lsSet } = _ctx;
  if(!pending) return;
  if(active){ toast('Finish or discard your active workout first'); return; }
  _ctx.active = {
    date:todayISO(), startedAt:new Date().toISOString(), effort:null, duration:'', calories:'', notes:'',
    cardio:{machine:null,duration:'',metric:'',calories:'',program:''},
    exercises:pending.map(ex=>{
      const{sets,reps}=parseScheme(ex.scheme);
      const last=lastForEx(ex.name);
      const grp=groups.find(g=>g.name===ex.group);
      const exDef=grp?grp.exercises.find(e=>e.name===ex.name):null;
      let weight=0;
      const weightType=last?last.weightType||'standard':'standard';
      if(last){
        const{sets:ls,reps:lr}=parseScheme(last.scheme);
        if(normalizeWeightType(weightType)==='standard'){
          // calcSuggestedWeight inline (avoids cross-dep to log.js)
          const repInt=r=>{if(r<=1)return 1.00;if(r<=2)return 0.95;if(r<=3)return 0.90;if(r<=4)return 0.88;if(r<=5)return 0.85;if(r<=6)return 0.82;if(r<=7)return 0.80;if(r<=8)return 0.77;if(r<=9)return 0.75;if(r<=10)return 0.72;if(r<=11)return 0.70;if(r<=12)return 0.67;if(r<=14)return 0.63;return 0.58;};
          const setsAdj=n=>1/(1+(n-1)*0.05);
          const inc=cfg.weightIncrement||5;
          weight=Math.round(last.weight*(repInt(reps)/repInt(lr))*(setsAdj(sets)/setsAdj(ls))/inc)*inc;
        } else { weight=last.weight||0; }
      }
      return{
        name:ex.name, group:ex.group, scheme:ex.scheme,
        weight, weightType, sets, targetReps:reps,
        repsLog:Array(sets).fill(reps), setsDone:Array(sets).fill(false),
        arrow:null, last:last||null, cue:exDef?exDef.cue||'':''
      };
    })
  };
  switchTab('today');
  lsSet('fj_active_workout', _ctx.active);
}
