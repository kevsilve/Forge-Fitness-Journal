import { dc, uid, esc, normalizeWeightType, parseScheme } from '../../utils/misc.js';
import { sv } from '../../storage.js';
import { todayISO } from '../../utils/date.js';
import { DEF_CFG, DEF_GROUPS, DEF_MACHINES, DEF_GAMIFICATION } from '../../constants.js';
import { gistPush, gistPull } from '../../sync/gist.js';
import { isSupabaseEnabled, signOut, getUser, dbPush, dbPushSession, dbPushStats } from '../../sync/supabase.js';

let _ctx = null;
let _newSchemeSets = 3, _newSchemeReps = 10;
export let manualExercises = [];
let backupPromptTimer = null;

export function initSettings(ctx) { _ctx = ctx; }

export async function renderSettings() {
  const wrap = document.getElementById('sett-wrap');
  const tab = _ctx.settingsTab;
  const tabs = [
    {id:'profile',icon:'👤',lbl:'Profile'},{id:'workout',icon:'⚡',lbl:'Workout'},
    {id:'exercises',icon:'🏋️',lbl:'Exercises'},{id:'cardio',icon:'🏃',lbl:'Cardio'},
    {id:'theme',icon:'🎨',lbl:'Theme'},{id:'data',icon:'💾',lbl:'Data'},
  ];
  const tabBar = `<div class="sett-tabs">${tabs.map(t=>`<button class="sett-tab${tab===t.id?' active':''}" onclick="setSettTab('${t.id}')"><span class="sett-tab-icon">${t.icon}</span><span class="sett-tab-lbl">${t.lbl}</span></button>`).join('')}</div>`;
  let panel = '';
  if(tab==='profile'){
    const gp=_ctx.cfg.gamificationPrefs||DEF_CFG.gamificationPrefs;
    panel=`<div class="sett-card">${renderProfile()}</div>
    <div class="sett-card" style="margin-top:0;">
      <div class="sett-card-title">Gamification</div>
      <div class="s-row"><div class="s-lbl">Show Level Badge in Header<span class="s-sub">Displays your current level and tier at the top</span></div>
        <label class="tog"><input type="checkbox" ${gp.showHeaderBadge!==false?'checked':''} onchange="setGamifPref('showHeaderBadge',this.checked)"><span class="tog-track"></span></label>
      </div>
      <div class="s-row"><div class="s-lbl">Show XP Progress Bar<span class="s-sub">Level progress bar in your Player Card</span></div>
        <label class="tog"><input type="checkbox" ${gp.showXPBar!==false?'checked':''} onchange="setGamifPref('showXPBar',this.checked)"><span class="tog-track"></span></label>
      </div>
    </div>`;
  }
  else if(tab==='workout') panel=renderWorkoutSettings();
  else if(tab==='exercises') panel=renderPool();
  else if(tab==='cardio') panel=`<div class="sett-card">${renderMachines()}</div>`;
  else if(tab==='theme') panel=`<div class="sett-card">${renderTheme()}</div><div style="height:24px"></div>`;
  else if(tab==='data'){ await renderDataTab(); return; }
  wrap.innerHTML=tabBar+`<div class="sett-panel">${panel}</div>`;
  if(tab==='theme'&&_ctx._fcp.open){
    const fp=document.getElementById('fcp-panel');
    const pb=document.getElementById('accent-preview-box');
    if(fp){fp.style.display='block';if(pb)pb.classList.add('fcp-open');_ctx.initForgePicker(_ctx.cfg.accentColor||'#e8271f');}
  }
}
export function setSettTab(t){_ctx.settingsTab=t;renderSettings();}

function renderWorkoutSettings(){
  const cfg=_ctx.cfg,groups=_ctx.groups;
  const coreTotal=groups.filter(g=>g.active&&g.mode==='core').reduce((a,g)=>a+(g.required||1),0);
  const total=coreTotal+(cfg.bonusSlots||2);
  const incOpts=[2.5,5,10].map(v=>`<button class="inc-pill${(cfg.weightIncrement||5)===v?' active':''}" onclick="setIncrement(${v})">${v}lb</button>`).join('');
  const mode=cfg.streakMode||'weekly';
  const rt=cfg.restTimer||{enabled:false,duration:60};
  const durOpts=[[30,'30s'],[45,'45s'],[60,'1m'],[90,'1:30'],[120,'2m'],[180,'3m']].map(([v,l])=>`<button class="inc-pill${rt.duration===v?' active':''}" onclick="setRestDuration(${v})">${l}</button>`).join('');
  const goalStepper=mode!=='daily'?`<div class="s-row"><div class="s-lbl">Sessions per ${mode==='weekly'?'Week':'Month'}<span class="s-sub">Minimum workouts needed to count the ${mode==='weekly'?'week':'month'}</span></div><div class="num-ctrl"><button class="num-btn" onclick="adjStreakGoal(-1)">−</button><span class="num-val">${cfg.streakGoal||3}</span><button class="num-btn" onclick="adjStreakGoal(1)">+</button></div></div>`:'';
  return`<div class="sett-card">
    <div class="sett-card-title">Workout Structure</div>
    <div class="s-row"><div class="s-lbl">Bonus Slots<span class="s-sub">Extra exercises beyond core requirements</span></div>
      <div class="num-ctrl"><button class="num-btn" onclick="adjCfg('bonusSlots',-1)">−</button><span class="num-val">${cfg.bonusSlots}</span><button class="num-btn" onclick="adjCfg('bonusSlots',1)">+</button></div>
    </div>
    <div class="s-row"><div class="s-lbl">Core Exercises<span class="s-sub">Sum of required per active core group</span></div><span style="font-size:13px;font-weight:700;color:var(--accent)">${coreTotal}</span></div>
    <div class="s-row"><div class="s-lbl">Total Per Workout<span class="s-sub">Core + Bonus</span></div><span style="font-size:13px;font-weight:700;color:var(--accent)">${total}</span></div>
  </div>
  <div class="sett-card">
    <div class="sett-card-title">Workout Schemes</div>
    <div class="s-sub" style="padding:0 0 12px;color:var(--text3);font-size:11px;">Sets × Reps options used when generating and planning workouts</div>
    <div class="inc-pills" style="flex-wrap:wrap;gap:6px;margin-bottom:14px;">${_ctx.getSchemes().map(sc=>`<button class="inc-pill" style="display:inline-flex;align-items:center;gap:5px;" onclick="removeScheme('${esc(sc)}')">${esc(sc)} <span style="font-size:10px;opacity:.6;">×</span></button>`).join('')}</div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:4px;"><span style="font-size:11px;color:var(--text3);">Sets</span>
        <div class="num-ctrl"><button class="num-btn" onclick="adjNewScheme('sets',-1)">−</button><span class="num-val" id="ns-sets">3</span><button class="num-btn" onclick="adjNewScheme('sets',1)">+</button></div>
      </div>
      <span style="color:var(--text3);font-size:13px;">×</span>
      <div style="display:flex;align-items:center;gap:4px;"><span style="font-size:11px;color:var(--text3);">Reps</span>
        <div class="num-ctrl"><button class="num-btn" onclick="adjNewScheme('reps',-1)">−</button><span class="num-val" id="ns-reps">10</span><button class="num-btn" onclick="adjNewScheme('reps',1)">+</button></div>
      </div>
      <button class="inc-pill active" style="flex-shrink:0;" onclick="addScheme()">+ Add</button>
    </div>
  </div>
  <div class="sett-card">
    <div class="sett-card-title">Weight &amp; Schedule</div>
    <div class="s-row"><div class="s-lbl">Weight Increment<span class="s-sub">Amount ± buttons change weight by</span></div><div class="inc-pills">${incOpts}</div></div>
    <div class="s-row"><div class="s-lbl">Streak Period<span class="s-sub">How your streak is measured</span></div><div class="inc-pills"><button class="inc-pill${mode==='daily'?' active':''}" onclick="setStreakMode('daily')">Daily</button><button class="inc-pill${mode==='weekly'?' active':''}" onclick="setStreakMode('weekly')">Weekly</button><button class="inc-pill${mode==='monthly'?' active':''}" onclick="setStreakMode('monthly')">Monthly</button></div></div>
    ${goalStepper}
  </div>
  <div class="sett-card">
    <div class="sett-card-title">Rest Timer</div>
    <div class="s-row"><div class="s-lbl">Enable Rest Timer<span class="s-sub">Auto-countdown after each completed set</span></div>
      <label class="tog"><input type="checkbox" ${rt.enabled?'checked':''} onchange="setRestTimerEnabled(this.checked)"><span class="tog-track"></span></label>
    </div>
    <div class="s-row${rt.enabled?'':' sett-row-disabled'}" style="flex-direction:column;align-items:flex-start;gap:10px;">
      <div class="s-lbl">Rest Duration<span class="s-sub">How long to rest between sets</span></div>
      <div class="inc-pills" style="flex-wrap:wrap;">${durOpts}</div>
    </div>
  </div>
  <div class="sett-card">
    <div class="sett-card-title">Workout Cards</div>
    <div class="s-row"><div class="s-lbl">Show Exercise Cues<span class="s-sub">Coaching notes displayed under exercise name</span></div>
      <label class="tog"><input type="checkbox" ${(cfg.cardPrefs&&cfg.cardPrefs.showCues!==false)?'checked':''} onchange="setCardPref('showCues',this.checked)"><span class="tog-track"></span></label>
    </div>
    <div class="s-row"><div class="s-lbl">Show Last Session Weight<span class="s-sub">Previous weight displayed on each lift</span></div>
      <label class="tog"><input type="checkbox" ${(cfg.cardPrefs&&cfg.cardPrefs.showLastSession!==false)?'checked':''} onchange="setCardPref('showLastSession',this.checked)"><span class="tog-track"></span></label>
    </div>
    <div class="s-row"><div class="s-lbl">Show Muscle Group Label<span class="s-sub">Group tag displayed beneath exercise name</span></div>
      <label class="tog"><input type="checkbox" ${(cfg.cardPrefs&&cfg.cardPrefs.showGroupLabel!==false)?'checked':''} onchange="setCardPref('showGroupLabel',this.checked)"><span class="tog-track"></span></label>
    </div>
  </div>`;
}

async function renderDataTab(){
  if(isSupabaseEnabled()){
    let email='';
    try{ const u=await getUser(); email=u?.email||''; }catch(e){}
    const wrap=document.getElementById('sett-wrap');
    const tab=_ctx.settingsTab;
    const tabs=[
      {id:'profile',icon:'👤',lbl:'Profile'},{id:'workout',icon:'⚡',lbl:'Workout'},
      {id:'exercises',icon:'🏋️',lbl:'Exercises'},{id:'cardio',icon:'🏃',lbl:'Cardio'},
      {id:'theme',icon:'🎨',lbl:'Theme'},{id:'data',icon:'💾',lbl:'Data'},
    ];
    const tabBar=`<div class="sett-tabs">${tabs.map(t=>`<button class="sett-tab${tab===t.id?' active':''}" onclick="setSettTab('${t.id}')"><span class="sett-tab-icon">${t.icon}</span><span class="sett-tab-lbl">${t.lbl}</span></button>`).join('')}</div>`;
    const panel=`<div class="sett-card">
      <div class="sett-card-title">Account <span style="color:var(--up);font-size:10px;">● Synced</span></div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.5;">Signed in as <strong>${email||'—'}</strong></div>
      <div class="gist-btns" style="margin-bottom:12px;">
        <button class="gist-btn primary" onclick="settDbPush()">⬆ Push All Data</button>
        <button class="gist-btn" onclick="authSignOut()">Sign Out</button>
      </div>
      <div id="s-gist-msg" style="margin-bottom:8px;"></div>
    </div>
    <div class="sett-card">
      <div class="sett-card-title">Backup &amp; Import</div>
      ${renderDataManagement()}
    </div>`;
    if(wrap)wrap.innerHTML=tabBar+`<div class="sett-panel">${panel}</div>`;
    return;
  }
  const gc=_ctx.gistCfg;
  const linked=!!(gc.pat&&gc.gistId);
  return`<div class="sett-card">
    <div class="sett-card-title">GitHub Gist Sync ${linked?'<span style="color:var(--up);font-size:10px;">● Connected</span>':''}</div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:10px;line-height:1.5;">${linked?`Syncing to <code style="background:var(--surface3);padding:1px 5px;border-radius:3px;">${gc.gistId.slice(0,12)}…</code>`:'Connect a GitHub Gist to sync across devices.'}</div>
    <div class="gist-field" style="margin-bottom:10px;">
      <label>Personal Access Token</label>
      <input class="gist-inp" type="password" id="s-pat" placeholder="ghp_xxxxxxxxxxxx" value="${gc.pat||''}" oninput="gistCfg.pat=this.value.trim();lsSet('fj_gist_cfg',gistCfg);">
      <div class="gist-hint">GitHub → Settings → Developer settings → PAT (classic) — needs only <code>gist</code> scope</div>
    </div>
    <div class="gist-field" style="margin-bottom:10px;">
      <label>Gist ID <span style="font-weight:400;color:var(--text3);">(blank = create new on next push)</span></label>
      <input class="gist-inp" type="text" id="s-gid" placeholder="Leave blank to auto-create" value="${gc.gistId||''}" oninput="gistCfg.gistId=this.value.trim();lsSet('fj_gist_cfg',gistCfg);">
    </div>
    <div id="s-gist-msg" style="margin-bottom:8px;"></div>
    <div class="gist-btns">
      <button class="gist-btn primary" onclick="settGistPush()">⬆ Push Now</button>
      <button class="gist-btn" onclick="settGistPull()">⬇ Pull / Restore</button>
    </div>
  </div>
  <div class="sett-card">
    <div class="sett-card-title">Backup &amp; Import</div>
    ${renderDataManagement()}
  </div>`;
}
function renderDataManagement(){
  return`<div class="data-btns">
    <button class="data-btn" onclick="exportData()">
      <span class="data-btn-icon">⬇️</span>
      <div class="data-btn-text"><span>Export Backup</span><span class="data-btn-sub">Copy your data as JSON</span></div>
    </button>
    <label class="data-btn" style="cursor:pointer;" for="import-file-visible">
      <span class="data-btn-icon">⬆️</span>
      <div class="data-btn-text"><span>Import Backup</span><span class="data-btn-sub">Tap to select a JSON backup file</span></div>
    </label>
  </div>
  <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
    <div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:10px;">Danger Zone</div>
    <button class="data-btn" style="border-color:var(--dn);color:var(--dn);margin-bottom:8px;" onclick="resetHistoryAndStats()">
      <span class="data-btn-icon">🗑️</span>
      <div class="data-btn-text"><span>Reset History &amp; Stats</span><span class="data-btn-sub">Wipes all sessions, PRs &amp; stats — keeps your exercise pool</span></div>
    </button>
    <button class="data-btn" style="border-color:var(--dn);color:var(--dn);" onclick="nuclearReset()">
      <span class="data-btn-icon">☢️</span>
      <div class="data-btn-text"><span>Factory Reset</span><span class="data-btn-sub">Wipes everything including groups, machines &amp; settings</span></div>
    </button>
  </div>`;
}

function renderPool(){
  const groups=_ctx.groups,openGrp=_ctx.openGrp;
  const grpHtml=groups.map(g=>{
    const bodyOpen=openGrp[g.id];
    const exHtml=g.exercises.map(ex=>`
      <div class="ex-item">
        <label class="tog"><input type="checkbox" ${ex.enabled?'checked':''} onchange="toggleEx('${g.id}','${ex.id}',this.checked)"><span class="tog-track"></span></label>
        <div class="ex-item-main">
          <span class="ex-item-name" style="${!ex.enabled?'color:var(--text3);text-decoration:line-through;':''}">${esc(ex.name)}</span>
          <input class="ex-cue-inp" type="text" placeholder="Add cue... (e.g. keep elbows tucked)" maxlength="80"
            value="${esc(ex.cue||'')}" oninput="saveExCue('${g.id}','${ex.id}',this.value)">
        </div>
        <button class="ex-del" onclick="deleteEx('${g.id}','${ex.id}')">×</button>
      </div>`).join('');
    return`<div class="grp-block">
      <div class="grp-block-hdr${bodyOpen?' open':''}" onclick="toggleGrp('${g.id}')">
        <span class="grp-block-chev">▲</span>
        <span class="grp-block-name">${g.name}</span>
        <span class="grp-block-meta">${_ctx.enabledEx(g).length}/${g.exercises.length}</span>
        <button class="grp-del" onclick="event.stopPropagation();deleteGroup('${g.id}')">Delete</button>
      </div>
      <div class="grp-block-body${bodyOpen?' open':''}">
        <div class="grp-cfg">
          <div class="grp-cfg-row"><span class="grp-cfg-lbl">Active in workout</span>
            <label class="tog"><input type="checkbox" ${g.active?'checked':''} onchange="toggleGroupActive('${g.id}',this.checked)"><span class="tog-track"></span></label>
          </div>
          <div class="grp-cfg-row"><span class="grp-cfg-lbl">Slot type</span>
            <div class="slot-pills">
              <button class="slot-pill${g.mode==='core'?' active':''}" onclick="setGroupMode('${g.id}','core')">Core</button>
              <button class="slot-pill${g.mode==='bonus'?' active':''}" onclick="setGroupMode('${g.id}','bonus')">Bonus</button>
            </div>
          </div>
          <div class="grp-cfg-row" style="${g.mode==='core'?'':'display:none'}">
            <span class="grp-cfg-lbl">Required exercises</span>
            <div class="num-ctrl">
              <button class="num-btn" onclick="adjRequired('${g.id}',-1)">−</button>
              <span class="num-val">${g.required||1}</span>
              <button class="num-btn" onclick="adjRequired('${g.id}',1)">+</button>
            </div>
          </div>
        </div>
        ${exHtml}
        <div class="add-row">
          <input class="add-inp" type="text" placeholder="Add exercise..." id="nex-${g.id}">
          <button class="add-btn" onclick="addEx('${g.id}')">ADD</button>
        </div>
      </div>
    </div>`;
  }).join('');
  return`${grpHtml}
    <div class="add-row" style="margin-top:12px;">
      <input class="add-inp" type="text" placeholder="New group name..." id="ngrp-inp">
      <button class="add-btn" onclick="addGroup()">+ GROUP</button>
    </div>`;
}
function renderMachines(){
  const items=_ctx.machines.map(m=>`
    <div class="machine-item">
      <span class="machine-icon">${m.icon}</span>
      <span class="machine-name">${m.name} <span style="font-size:10px;color:var(--text3)">(${m.metric}, ${m.unit})</span></span>
      <button class="machine-del" onclick="deleteMachine('${m.id}')">Remove</button>
    </div>`).join('');
  return`<div class="machine-list">${items}</div>
    <div style="font-size:10px;color:var(--text3);margin-bottom:8px;letter-spacing:.5px;">Add: emoji · name · metric · unit</div>
    <div class="add-machine-row">
      <input class="add-inp emoji-inp" type="text" placeholder="🏃" id="nm-icon" maxlength="2">
      <input class="add-inp" type="text" placeholder="Machine name" id="nm-name" style="flex:2">
      <input class="add-inp" type="text" placeholder="Metric" id="nm-metric" style="flex:1.2">
      <input class="add-inp" type="text" placeholder="Unit" id="nm-unit" style="width:52px;flex:none">
    </div>
    <button class="add-btn" style="width:100%;margin-top:7px;" onclick="addMachine()">+ ADD MACHINE</button>`;
}
function renderProfile(){
  const cfg=_ctx.cfg;
  if(!cfg.profile)cfg.profile=dc(DEF_CFG.profile);
  const p=cfg.profile;
  const wtUnitBtns=['lbs','kg'].map(u=>`<button class="inc-pill${(p.weightUnit||'lbs')===u?' active':''}" onclick="setProfileVal('weightUnit','${u}')">${u}</button>`).join('');
  const htUnitBtns=['in','cm'].map(u=>`<button class="inc-pill${(p.heightUnit||'in')===u?' active':''}" onclick="setProfileVal('heightUnit','${u}')">${u}</button>`).join('');
  const sexBtns=[['male','Male'],['female','Female'],['other','Other']].map(([v,l])=>`<button class="inc-pill${(p.sex||'male')===v?' active':''}" onclick="setProfileVal('sex','${v}')">${l}</button>`).join('');
  return`
    <div class="s-row"><div class="s-lbl">Body Weight<span class="s-sub">Required for calorie estimation</span></div>
      <div style="display:flex;gap:6px;align-items:center;">
        <input class="gist-inp" type="number" inputmode="decimal" style="width:72px;padding:7px 10px;font-size:14px;" placeholder="${(p.weightUnit||'lbs')==='lbs'?'e.g. 185':'e.g. 84'}" value="${p.weight||''}" oninput="setProfileVal('weight',this.value,true)">
        <div class="inc-pills">${wtUnitBtns}</div>
      </div>
    </div>
    <div class="s-row"><div class="s-lbl">Height <span style="font-weight:400;color:var(--text3);">(optional)</span><span class="s-sub">Used for future BMR refinement</span></div>
      <div style="display:flex;gap:6px;align-items:center;">
        <input class="gist-inp" type="number" inputmode="decimal" style="width:72px;padding:7px 10px;font-size:14px;" placeholder="${(p.heightUnit||'in')==='in'?'e.g. 70':'e.g. 178'}" value="${p.height||''}" oninput="setProfileVal('height',this.value,true)">
        <div class="inc-pills">${htUnitBtns}</div>
      </div>
    </div>
    <div class="s-row"><div class="s-lbl">Age <span style="font-weight:400;color:var(--text3);">(optional)</span></div>
      <input class="gist-inp" type="number" inputmode="numeric" style="width:72px;padding:7px 10px;font-size:14px;" placeholder="e.g. 30" value="${p.age||''}" oninput="setProfileVal('age',this.value,true)">
    </div>
    <div class="s-row" style="flex-direction:column;align-items:flex-start;gap:10px;">
      <div class="s-lbl">Biological Sex <span style="font-weight:400;color:var(--text3);">(optional)</span><span class="s-sub">Improves MET accuracy</span></div>
      <div class="inc-pills">${sexBtns}</div>
    </div>
    ${buildWeightChart(p.weightLog||[],p.weightUnit||'lbs')}`;
}
function buildWeightChart(log,unit){
  if(!log||log.length<2)return'';
  const weights=log.map(e=>e.weight);
  const minW=Math.min(...weights),maxW=Math.max(...weights);
  const range=maxW-minW||1;
  const W=280,H=48,n=log.length;
  const pts=log.map((e,i)=>{
    const x=(n>1?i/(n-1):0.5)*(W-8)+4;
    const y=H-4-((e.weight-minW)/range)*(H-8);
    return`${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last=log[log.length-1],first=log[0];
  const diff=Math.round((last.weight-first.weight)*10)/10;
  const diffHtml=diff!==0?`<span style="color:${diff>0?'var(--accent)':'var(--up)'};font-weight:700;font-size:10px;">${diff>0?'+':''}${diff}${unit}</span>`:'';
  return`<div class="s-row" style="flex-direction:column;gap:8px;margin-top:4px;">
    <div class="s-lbl" style="margin-bottom:0;">Weight History <span style="font-weight:400;color:var(--text3);">(${n} entries)</span> ${diffHtml}</div>
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;">
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${log.reduce((mx,e,i)=>e.weight>log[mx].weight?i:mx,0)/(n-1)*(W-8)+4}" cy="${H-4-((maxW-minW)/range)*(H-8)}" r="3.5" fill="var(--accent)"/>
    </svg>
    <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);">
      <span>${first.date}</span><span>${last.weight}${unit} · ${last.date}</span>
    </div>
  </div>`;
}
function renderTheme(){
  const ACCENT_PRESETS=[
    {hex:'#e8271f',name:'Red'},{hex:'#f97316',name:'Orange'},{hex:'#eab308',name:'Amber'},
    {hex:'#84cc16',name:'Lime'},{hex:'#22c55e',name:'Green'},{hex:'#14b8a6',name:'Teal'},
    {hex:'#3b82f6',name:'Blue'},{hex:'#6366f1',name:'Indigo'},{hex:'#8b5cf6',name:'Violet'},
    {hex:'#ec4899',name:'Pink'},{hex:'#f43f5e',name:'Rose'},{hex:'#e2e8f0',name:'Silver'},
  ];
  const cfg=_ctx.cfg,theme=_ctx.theme,_fcp=_ctx._fcp;
  const curAccent=cfg.accentColor||null;
  const THEME_BASES_LOCAL=[
    {id:'dark',label:'DARK',bg:'#080808',text:'#ececec',dots:['#e8271f','#aaa','#0f0f0f']},
    {id:'light',label:'LIGHT',bg:'#f0eeeb',text:'#1a1a1a',dots:['#c8102e','#555','#faf9f7']},
  ];
  const baseBtns=THEME_BASES_LOCAL.map(b=>{
    const isActive=theme===b.id;
    const dotsHtml=b.dots.map(c=>`<div class="base-btn-dot" style="background:${c}"></div>`).join('');
    return`<button class="base-btn${isActive?' active':''}" onclick="setThemeBase('${b.id}')" style="background:${b.bg};">
      <div class="base-btn-label" style="color:${b.text}">${b.label}</div>
      <div class="base-btn-dots">${dotsHtml}</div>
      ${isActive?`<div class="base-btn-check">✓</div>`:''}
    </button>`;
  }).join('');
  const swatches=ACCENT_PRESETS.map(a=>{
    const isActive=curAccent&&curAccent.toLowerCase()===a.hex.toLowerCase();
    return`<button class="accent-swatch${isActive?' active':''}" style="background:${a.hex}" title="${a.name}" onclick="setCustomAccent('${a.hex}')"></button>`;
  }).join('');
  const hexVal=curAccent||'';
  const previewBg=curAccent||'var(--accent)';
  return`
    <div class="sett-card-title">Base</div>
    <div class="base-picker">${baseBtns}</div>
    <div class="sett-card-title" style="margin-top:18px;">Accent Color</div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:10px;line-height:1.5;">Pick your highlight color — applied everywhere across the app.</div>
    <div class="accent-swatches">${swatches}</div>
    <div class="accent-custom-row">
      <input class="accent-hex-inp" type="text" maxlength="7" placeholder="#e8271f" value="${esc(hexVal)}"
        oninput="
          const v=this.value.trim();
          if(v.match(/^#[0-9a-fA-F]{6}$/)){document.getElementById('accent-preview-box').style.background=v;if(_fcp.open){const[h,s,vv]=hexToHsv(v);_fcp.hue=h;_fcp.sat=s;_fcp.val=vv;_fcpDrawSV();_fcpDrawHue();}}
          else document.getElementById('accent-preview-box').style.background='var(--accent)';"
        onchange="const v=this.value.trim();if(v.match(/^#[0-9a-fA-F]{6}$/))setCustomAccent(v);">
      <div class="accent-preview${_fcp.open?' fcp-open':''}" id="accent-preview-box" style="background:${previewBg}" title="Open color picker" onclick="toggleForgePicker()"></div>
      ${curAccent?`<button class="inc-pill" onclick="setCustomAccent(null)" style="font-size:10px;">Reset</button>`:''}
    </div>
    <div id="fcp-panel" style="display:none">
      <canvas id="fcp-sv" class="fcp-sv"></canvas>
      <canvas id="fcp-hue" class="fcp-hue"></canvas>
    </div>`;
}

// ── mutations ────────────────────────────────────────────────────────────────

export function toggleGrp(id){_ctx.openGrp[id]=!_ctx.openGrp[id];renderSettings();}
export function adjCfg(k,d){
  if(k==='bonusSlots')_ctx.cfg.bonusSlots=Math.max(0,Math.min(10,(_ctx.cfg.bonusSlots||2)+d));
  sv('fj_cfg',_ctx.cfg);_ctx.autoSaveSettings();renderSettings();
}
export function adjNewScheme(field,d){
  if(field==='sets'){_newSchemeSets=Math.max(1,Math.min(10,_newSchemeSets+d));const el=document.getElementById('ns-sets');if(el)el.textContent=_newSchemeSets;}
  else{_newSchemeReps=Math.max(1,Math.min(100,_newSchemeReps+d));const el=document.getElementById('ns-reps');if(el)el.textContent=_newSchemeReps;}
}
export function addScheme(){
  const sc=_newSchemeSets+'×'+_newSchemeReps;
  if(!_ctx.cfg.schemes||!_ctx.cfg.schemes.length)_ctx.cfg.schemes=[...DEF_CFG.schemes];
  if(_ctx.cfg.schemes.includes(sc)){_ctx.toast('Scheme already exists');return;}
  _ctx.cfg.schemes.push(sc);sv('fj_cfg',_ctx.cfg);renderSettings();
}
export function removeScheme(sc){
  if(!_ctx.cfg.schemes)_ctx.cfg.schemes=[...DEF_CFG.schemes];
  if(_ctx.cfg.schemes.length<=1){_ctx.toast('Must keep at least one scheme');return;}
  _ctx.cfg.schemes=_ctx.cfg.schemes.filter(s=>s!==sc);sv('fj_cfg',_ctx.cfg);renderSettings();
}
export function adjRequired(gid,d){
  const g=_ctx.groups.find(g=>g.id===gid);if(!g)return;
  g.required=Math.max(1,Math.min(_ctx.enabledEx(g).length,(g.required||1)+d));
  sv('fj_groups',_ctx.groups);_ctx.autoSaveSettings();renderSettings();
}
export function toggleGroupActive(gid,val){const g=_ctx.groups.find(g=>g.id===gid);if(g){g.active=val;sv('fj_groups',_ctx.groups);_ctx.autoSaveSettings();}renderSettings();}
export function setGroupMode(gid,mode){const g=_ctx.groups.find(g=>g.id===gid);if(g){g.mode=mode;sv('fj_groups',_ctx.groups);_ctx.autoSaveSettings();}renderSettings();}
export function saveExCue(gid,eid,val){
  const g=_ctx.groups.find(g=>g.id===gid);if(!g)return;
  const ex=g.exercises.find(e=>e.id===eid);if(ex){ex.cue=val.trim();sv('fj_groups',_ctx.groups);_ctx.autoSaveSettings();}
}
export function toggleEx(gid,eid,val){
  const g=_ctx.groups.find(g=>g.id===gid);if(!g)return;
  if(!val&&_ctx.enabledEx(g).length<=1){_ctx.toast('Must keep at least one enabled');renderSettings();return;}
  const ex=g.exercises.find(e=>e.id===eid);if(ex){ex.enabled=val;sv('fj_groups',_ctx.groups);_ctx.autoSaveSettings();}renderSettings();
}
export function deleteEx(gid,eid){
  const g=_ctx.groups.find(g=>g.id===gid);if(!g)return;
  if(_ctx.enabledEx(g).length<=1&&g.exercises.find(e=>e.id===eid&&e.enabled)){_ctx.toast('Must keep at least one');return;}
  g.exercises=g.exercises.filter(e=>e.id!==eid);sv('fj_groups',_ctx.groups);_ctx.autoSaveSettings();renderSettings();
}
export function addEx(gid){
  const inp=document.getElementById('nex-'+gid);if(!inp)return;
  const name=inp.value.trim();if(!name){_ctx.toast('Enter a name');return;}
  const g=_ctx.groups.find(g=>g.id===gid);if(!g)return;
  if(g.exercises.some(e=>e.name.toLowerCase()===name.toLowerCase())){_ctx.toast('Already exists');return;}
  g.exercises.push({id:uid(),name,enabled:true});sv('fj_groups',_ctx.groups);_ctx.autoSaveSettings();renderSettings();
}
export function addGroup(){
  const inp=document.getElementById('ngrp-inp');if(!inp)return;
  const name=inp.value.trim();if(!name){_ctx.toast('Enter a group name');return;}
  if(_ctx.groups.some(g=>g.name.toLowerCase()===name.toLowerCase())){_ctx.toast('Group exists');return;}
  _ctx.groups.push({id:uid(),name,mode:'bonus',active:true,required:1,exercises:[]});
  sv('fj_groups',_ctx.groups);_ctx.autoSaveSettings();renderSettings();
}
export function deleteGroup(gid){
  if(_ctx.groups.length<=1){_ctx.toast('Must keep at least one group');return;}
  _ctx.groups=_ctx.groups.filter(g=>g.id!==gid);sv('fj_groups',_ctx.groups);_ctx.autoSaveSettings();renderSettings();
}
export function addMachine(){
  const icon=document.getElementById('nm-icon')?.value.trim()||'💪';
  const name=document.getElementById('nm-name')?.value.trim();
  const metric=document.getElementById('nm-metric')?.value.trim()||'Distance';
  const unit=document.getElementById('nm-unit')?.value.trim()||'mi';
  if(!name){_ctx.toast('Enter machine name');return;}
  if(_ctx.machines.some(m=>m.name.toLowerCase()===name.toLowerCase())){_ctx.toast('Machine exists');return;}
  _ctx.machines.push({id:uid(),icon,name,metric,unit});sv('fj_machines',_ctx.machines);_ctx.autoSaveSettings();renderSettings();
}
export function deleteMachine(mid){
  if(_ctx.machines.length<=1){_ctx.toast('Must keep at least one');return;}
  _ctx.machines=_ctx.machines.filter(m=>m.id!==mid);sv('fj_machines',_ctx.machines);_ctx.autoSaveSettings();renderSettings();
}
export function setStreakMode(m){_ctx.cfg.streakMode=m;sv('fj_cfg',_ctx.cfg);_ctx.autoSaveSettings();renderSettings();_ctx.renderGenStreakChip();}
export function adjStreakGoal(delta){
  const max=_ctx.cfg.streakMode==='monthly'?28:7;
  _ctx.cfg.streakGoal=Math.min(max,Math.max(1,(_ctx.cfg.streakGoal||3)+delta));
  sv('fj_cfg',_ctx.cfg);_ctx.autoSaveSettings();renderSettings();_ctx.renderGenStreakChip();
}
export function setIncrement(v){_ctx.cfg.weightIncrement=v;sv('fj_cfg',_ctx.cfg);_ctx.autoSaveSettings();renderSettings();}
export function setThemeBase(b){_ctx.theme=b;sv('fj_theme',b);_ctx.applyBodyClasses();if(_ctx.cfg.accentColor)_ctx.applyCustomAccent(_ctx.cfg.accentColor);else _ctx.applyCustomAccent(null);renderSettings();}
export function setCustomAccent(hex){_ctx.cfg.accentColor=hex||null;sv('fj_cfg',_ctx.cfg);_ctx.applyCustomAccent(_ctx.cfg.accentColor);renderSettings();}
export function setCardPref(key,val){if(!_ctx.cfg.cardPrefs)_ctx.cfg.cardPrefs=dc(DEF_CFG.cardPrefs);_ctx.cfg.cardPrefs[key]=val;sv('fj_cfg',_ctx.cfg);renderSettings();}
export function setGamifPref(key,val){if(!_ctx.cfg.gamificationPrefs)_ctx.cfg.gamificationPrefs=dc(DEF_CFG.gamificationPrefs);_ctx.cfg.gamificationPrefs[key]=val;sv('fj_cfg',_ctx.cfg);_ctx.renderHeaderLevel();renderSettings();}
export function resetAcc(id){
  _ctx.armReset('rst_'+id,()=>{
    if(id==='structure'){_ctx.cfg.bonusSlots=DEF_CFG.bonusSlots;sv('fj_cfg',_ctx.cfg);}
    if(id==='pool'){_ctx.groups=dc(DEF_GROUPS);sv('fj_groups',_ctx.groups);}
    if(id==='machines'){_ctx.machines=dc(DEF_MACHINES);sv('fj_machines',_ctx.machines);}
    if(id==='prefs'){_ctx.cfg.weightIncrement=DEF_CFG.weightIncrement;_ctx.cfg.streakMode=DEF_CFG.streakMode;_ctx.cfg.streakGoal=DEF_CFG.streakGoal;sv('fj_cfg',_ctx.cfg);}
    if(id==='profile'){_ctx.cfg.profile=dc(DEF_CFG.profile);sv('fj_cfg',_ctx.cfg);}
    if(id==='theme'){_ctx.theme='dark';sv('fj_theme','dark');_ctx.cfg.accentColor=null;sv('fj_cfg',_ctx.cfg);_ctx.applyBodyClasses();_ctx.applyCustomAccent(null);}
    _ctx.autoSaveSettings();_ctx.toast('Reset complete');renderSettings();
  },renderSettings);
}
export function resetHistoryAndStats(){
  const root=document.getElementById('modal-root');
  root.innerHTML=`<div class="modal-overlay" onclick="if(event.target===this)document.getElementById('modal-root').innerHTML=''">
    <div class="modal" onclick="event.stopPropagation()" style="max-height:65vh;">
      <div class="modal-hdr">
        <span class="modal-title" style="color:#ef4444;">🗑 RESET HISTORY & STATS</span>
        <button class="modal-close" onclick="document.getElementById('modal-root').innerHTML=''">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--j-txt2);line-height:1.6;margin-bottom:8px;">
          This will permanently delete all <strong>${_ctx.sessions.length} session${_ctx.sessions.length!==1?'s':''}</strong>, all PRs, and all stats.
        </p>
        <p style="font-size:12px;color:var(--j-mut);line-height:1.6;margin-bottom:16px;">
          ✅ Kept: exercise groups, machines, preferences, theme<br>
          ❌ Deleted: workout history, PRs, weight progress, totals
        </p>
        <p style="font-size:12px;color:var(--j-mut);margin-bottom:10px;">Type <strong>DELETE</strong> to confirm:</p>
        <input class="me-inp" id="rhs-confirm" type="text" placeholder="DELETE" style="width:100%;margin-bottom:16px;"
          oninput="const b=document.getElementById('rhs-go');b.style.opacity=this.value==='DELETE'?'1':'.5';b.style.cursor=this.value==='DELETE'?'pointer':'not-allowed';b.disabled=this.value!=='DELETE';">
        <button class="me-save-btn" id="rhs-go" disabled style="background:#ef4444;opacity:.5;cursor:not-allowed;"
          onclick="document.getElementById('modal-root').innerHTML='';_doResetHistoryAndStats();">
          Delete History &amp; Stats
        </button>
      </div>
    </div>
  </div>`;
}
export async function _doResetHistoryAndStats(){
  _ctx.sessions=[];_ctx.stats={exercises:{},total:0,weightHistory:{},totalReps:{},prs:{}};
  sv('fj_sessions',_ctx.sessions);sv('fj_stats',_ctx.stats);
  if(isSupabaseEnabled()){
    try{await dbPush(_ctx.buildPayload());_ctx.setSyncStatus('synced');}catch(e){_ctx.setSyncStatus('error');}
  } else if(_ctx.gistCfg.pat){
    try{await gistPush(_ctx.gistCfg,_ctx.buildPayload());_ctx.setSyncStatus('synced');}catch(e){_ctx.setSyncStatus('error');}
  }
  _ctx.toast('History & stats cleared');renderSettings();
}
export function nuclearReset(){
  const root=document.getElementById('modal-root');
  root.innerHTML=`<div class="modal-overlay" onclick="if(event.target===this)document.getElementById('modal-root').innerHTML=''">
    <div class="modal" onclick="event.stopPropagation()" style="max-height:65vh;">
      <div class="modal-hdr">
        <span class="modal-title" style="color:#ef4444;">☢ FACTORY RESET</span>
        <button class="modal-close" onclick="document.getElementById('modal-root').innerHTML=''">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--j-txt2);line-height:1.6;margin-bottom:8px;">This will wipe <strong>everything</strong> and restore factory defaults.</p>
        <p style="font-size:12px;color:var(--j-mut);line-height:1.6;margin-bottom:16px;">❌ Deleted: sessions, PRs, stats, groups, machines, all settings</p>
        <p style="font-size:12px;color:var(--j-mut);margin-bottom:10px;">Type <strong>RESET</strong> to confirm:</p>
        <input class="me-inp" id="nuke-confirm" type="text" placeholder="RESET" style="width:100%;margin-bottom:16px;"
          oninput="const b=document.getElementById('nuke-go');b.style.opacity=this.value==='RESET'?'1':'.5';b.style.cursor=this.value==='RESET'?'pointer':'not-allowed';b.disabled=this.value!=='RESET';">
        <button class="me-save-btn" id="nuke-go" disabled style="background:#ef4444;opacity:.5;cursor:not-allowed;"
          onclick="document.getElementById('modal-root').innerHTML='';_doNuclearReset();">
          Factory Reset Everything
        </button>
      </div>
    </div>
  </div>`;
}
export async function _doNuclearReset(){
  _ctx.groups=dc(DEF_GROUPS);_ctx.cfg=dc(DEF_CFG);_ctx.machines=dc(DEF_MACHINES);
  _ctx.sessions=[];_ctx.stats={exercises:{},total:0,weightHistory:{},totalReps:{},prs:{}};
  _ctx.gamification=dc(DEF_GAMIFICATION);_ctx.theme='dark';
  sv('fj_groups',_ctx.groups);sv('fj_cfg',_ctx.cfg);sv('fj_machines',_ctx.machines);
  sv('fj_sessions',_ctx.sessions);sv('fj_stats',_ctx.stats);sv('fj_theme','dark');
  sv('fj_gamification',_ctx.gamification);
  _ctx.applyBodyClasses();_ctx.applyCustomAccent(null);_ctx.renderHeaderLevel();
  if(isSupabaseEnabled()){try{await dbPush(_ctx.buildPayload());}catch(e){}}
  else if(_ctx.gistCfg.pat){try{await gistPush(_ctx.gistCfg,_ctx.buildPayload());}catch(e){}}
  _ctx.toast('Everything reset to defaults');renderSettings();
}
export function setProfileVal(key,val,noRender){
  if(!_ctx.cfg.profile)_ctx.cfg.profile=dc(DEF_CFG.profile);
  const oldWeight=_ctx.cfg.profile.weight;
  _ctx.cfg.profile[key]=val;
  if(key==='weight'&&val&&val!==oldWeight){
    const w=parseFloat(val);
    if(!isNaN(w)&&w>0){
      if(!_ctx.cfg.profile.weightLog)_ctx.cfg.profile.weightLog=[];
      const today=todayISO();
      const last=_ctx.cfg.profile.weightLog[_ctx.cfg.profile.weightLog.length-1];
      if(last&&last.date===today){last.weight=w;}
      else{_ctx.cfg.profile.weightLog.push({date:today,weight:w});}
      if(_ctx.cfg.profile.weightLog.length>100)_ctx.cfg.profile.weightLog=_ctx.cfg.profile.weightLog.slice(-100);
    }
  }
  sv('fj_cfg',_ctx.cfg);_ctx.autoSaveSettings();
  if(!noRender)renderSettings();
}

// ── export / import ──────────────────────────────────────────────────────────

export function showBackupPrompt(){
  sv('fj_backup_seen_count',_ctx.sessions.length);
  dismissBackupPrompt();
  const el=document.createElement('div');
  el.className='backup-prompt';el.id='backup-prompt';
  el.innerHTML=`<div class="backup-prompt-top">
    <span class="backup-prompt-icon">💾</span>
    <div class="backup-prompt-text">
      <div class="backup-prompt-title">Workout saved!</div>
      <div class="backup-prompt-sub">Download a backup to keep your data safe</div>
    </div>
  </div>
  <div class="backup-prompt-btns">
    <button class="backup-dl-btn" onclick="exportDataAndDismiss()">📋 Backup Now</button>
    <button class="backup-skip-btn" onclick="dismissBackupPrompt()">Skip</button>
  </div>`;
  document.body.appendChild(el);
  backupPromptTimer=setTimeout(dismissBackupPrompt,12000);
}
export function dismissBackupPrompt(){
  if(backupPromptTimer){clearTimeout(backupPromptTimer);backupPromptTimer=null;}
  document.getElementById('backup-prompt')?.remove();
}
export function exportDataAndDismiss(){exportData();dismissBackupPrompt();}
export function exportData(){
  const payload={
    version:4,exportedAt:new Date().toISOString(),
    sessions:_ctx.sessions,stats:_ctx.stats,groups:_ctx.groups,cfg:_ctx.cfg,machines:_ctx.machines,theme:_ctx.theme
  };
  const json=JSON.stringify(payload,null,2);
  const root=document.getElementById('modal-root');root.innerHTML='';
  root.innerHTML=`<div class="modal-overlay" onclick="closeExportModal(event)">
    <div class="modal" onclick="event.stopPropagation()" style="max-height:85vh;">
      <div class="modal-hdr">
        <span class="modal-title">Export Backup</span>
        <button class="modal-close" onclick="closeExportModal()">×</button>
      </div>
      <div class="modal-body" style="padding-bottom:24px;">
        <p style="font-size:12px;color:var(--j-txt2);line-height:1.6;margin-bottom:12px;">
          Tap <strong>Copy All</strong>, paste into a text file and save as
          <code style="background:var(--j-tnt);padding:1px 5px;border-radius:3px;">forge-backup.json</code>
        </p>
        <button class="me-save-btn" id="copy-btn" onclick="copyExportJson()" style="margin-bottom:10px;margin-top:0;">📋 Copy All</button>
        <textarea id="export-json" readonly
          style="width:100%;height:220px;font-family:monospace;font-size:10px;padding:9px;border:1.5px solid var(--j-bor2);border-radius:6px;background:var(--j-tnt);color:var(--j-txt);resize:none;line-height:1.4;"
          onclick="this.select()">${json}</textarea>
        <p style="font-size:10px;color:var(--j-mut);margin-top:8px;">
          ${_ctx.sessions.length} session${_ctx.sessions.length!==1?'s':''} · v4 · ${new Date().toLocaleDateString()}
        </p>
      </div>
    </div>
  </div>`;
}
export function copyExportJson(){
  const ta=document.getElementById('export-json');if(!ta)return;
  ta.select();
  navigator.clipboard.writeText(ta.value).then(()=>{
    const btn=document.getElementById('copy-btn');
    if(btn){btn.textContent='✓ Copied!';setTimeout(()=>{if(btn)btn.textContent='📋 Copy All';},2000);}
  }).catch(()=>{document.execCommand('copy');});
}
export function closeExportModal(event){
  if(event&&event.target!==event.currentTarget)return;
  document.getElementById('modal-root').innerHTML='';
}
export function importData(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.version||!Array.isArray(data.sessions)){_ctx.toast('Invalid backup file');return;}
      if(data.sessions){_ctx.sessions=data.sessions;sv('fj_sessions',_ctx.sessions);}
      if(data.stats)   {_ctx.stats=data.stats;sv('fj_stats',_ctx.stats);}
      if(data.groups)  {_ctx.groups=data.groups;sv('fj_groups',_ctx.groups);}
      if(data.cfg)     {_ctx.cfg=data.cfg;sv('fj_cfg',_ctx.cfg);}
      if(data.machines){_ctx.machines=data.machines;sv('fj_machines',_ctx.machines);}
      if(data.theme)   {_ctx.theme=data.theme;sv('fj_theme',_ctx.theme);_ctx.applyBodyClasses();if(_ctx.cfg.accentColor)_ctx.applyCustomAccent(_ctx.cfg.accentColor);}
      _ctx.toast(`Imported ${_ctx.sessions.length} sessions ✓`);
      _ctx.renderHistory();
    } catch(err){_ctx.toast('Failed to read file');}
    input.value='';
  };
  reader.readAsText(file);
}

// ── manual session entry ─────────────────────────────────────────────────────

export function openManualEntry(){manualExercises=[];renderManualModal();}
function getGroupExerciseMap(){
  return _ctx.groups.map(g=>({id:g.id,name:g.name,exercises:g.exercises.filter(e=>e.enabled).map(e=>e.name)})).filter(g=>g.exercises.length>0);
}
export function renderManualModal(){
  const root=document.getElementById('modal-root');
  const gmap=getGroupExerciseMap();
  const allGroupNames=gmap.map(g=>g.name);
  const exHtml=manualExercises.map((ex,i)=>{
    const grpOpts=`<option value="">— Group —</option>`+allGroupNames.map(n=>`<option value="${n}"${ex.group===n?' selected':''}>${n}</option>`).join('')+`<option value="__new__">+ New group...</option>`;
    const matchedGroup=gmap.find(g=>g.name===ex.group);
    const exOptions=matchedGroup?matchedGroup.exercises:gmap.flatMap(g=>g.exercises);
    const exOpts=`<option value="">— Exercise —</option>`+exOptions.map(n=>`<option value="${n}"${ex.name===n?' selected':''}>${n}</option>`).join('')+`<option value="__new__">+ New exercise...</option>`;
    return`<div class="me-ex-card" id="me-ex-${ex.id}">
      <div class="me-ex-top">
        <span class="me-ex-num">${i+1}</span>
        <button class="me-ex-del" onclick="removeManualEx('${ex.id}')">×</button>
      </div>
      <div class="me-ex-fields">
        <div class="me-field" style="flex:1;min-width:120px;">
          <span class="me-field-lbl">Group</span>
          <select class="me-inp" style="width:100%;" onchange="setManualGroup(${i},this.value)">${grpOpts}</select>
          ${ex.group==='__new__'?`<input class="me-inp" style="width:100%;margin-top:5px;" type="text" placeholder="New group name" onchange="manualExercises[${i}].customGroup=this.value">`:''}
        </div>
        <div class="me-field" style="flex:1;min-width:140px;">
          <span class="me-field-lbl">Exercise</span>
          <select class="me-inp" style="width:100%;" onchange="setManualExName(${i},this.value)">${exOpts}</select>
          ${ex.name==='__new__'?`<input class="me-inp" style="width:100%;margin-top:5px;" type="text" placeholder="New exercise name" onchange="manualExercises[${i}].customName=this.value">`:''}
        </div>
        <div class="me-field"><span class="me-field-lbl">Type</span>
          <select class="me-inp" onchange="manualExercises[${i}].weightType=this.value;renderManualModal()">
            <option value="standard"${normalizeWeightType(ex.weightType)==='standard'?' selected':''}>LBS${_ctx.cfg.profile&&_ctx.cfg.profile.weightUnit==='kg'?'/KG':''}</option>
            <option value="level"${normalizeWeightType(ex.weightType)==='level'?' selected':''}>Level</option>
            <option value="bodyweight"${normalizeWeightType(ex.weightType)==='bodyweight'?' selected':''}>Bodyweight</option>
          </select>
        </div>
        <div class="me-field"><span class="me-field-lbl">${normalizeWeightType(ex.weightType)==='bodyweight'?'Extra Wt':_ctx.wtTypeLabel(ex)}</span>
          <input class="me-inp me-inp-sm" type="number" inputmode="${normalizeWeightType(ex.weightType)==='level'?'numeric':'decimal'}"
            step="${normalizeWeightType(ex.weightType)==='level'?'1':'any'}" placeholder="0" value="${ex.weight||''}"
            onchange="manualExercises[${i}].weight=${normalizeWeightType(ex.weightType)==='level'?'parseInt':'parseFloat'}(this.value)||0">
        </div>
        <div class="me-field"><span class="me-field-lbl">Scheme</span>
          <select class="me-inp" onchange="setManualScheme(${i},this.value)">
            ${_ctx.getSchemes().map(s=>`<option${ex.scheme===s?' selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="me-field"><span class="me-field-lbl">Reps per set</span>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${ex.repsLog.map((r,si)=>`<div style="display:flex;align-items:center;gap:5px;">
              <span style="font-size:10px;color:var(--j-mut);width:14px;">${si+1}</span>
              <input class="me-inp me-inp-sm" type="number" inputmode="numeric" value="${r}" onchange="manualExercises[${i}].repsLog[${si}]=parseInt(this.value)||0">
            </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  const emptyState=manualExercises.length===0?`<div style="text-align:center;padding:24px;color:var(--j-mut);font-size:12px;letter-spacing:1px;text-transform:uppercase;">No exercises added yet</div>`:'';
  root.innerHTML=`<div class="modal-overlay" onclick="closeManualModal(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-hdr">
        <span class="modal-title">Log Past Workout</span>
        <button class="modal-close" onclick="closeManualModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="me-section"><span class="me-section-lbl">Date</span>
          <input class="me-inp" style="width:100%;" type="date" id="me-date" value="${todayISO()}" max="${todayISO()}">
        </div>
        <div class="me-section"><span class="me-section-lbl">Exercises</span>
          <div class="me-ex-list">${exHtml}${emptyState}</div>
          <button class="me-add-ex" onclick="addManualEx()">+ Add Exercise</button>
        </div>
        <div class="me-section"><span class="me-section-lbl">Session Notes (optional)</span>
          <textarea class="me-inp" style="width:100%;resize:none;min-height:60px;font-size:13px;" id="me-notes" placeholder="How did it go?"></textarea>
        </div>
        <div style="display:flex;gap:8px;">
          <div class="me-field" style="flex:1;"><span class="me-field-lbl">Effort</span>
            <select class="me-inp" style="width:100%;" id="me-effort">
              <option value="">— skip —</option><option value="1">Easy</option>
              <option value="2">Good</option><option value="3">Hard</option><option value="4">Max</option>
            </select>
          </div>
          <div class="me-field" style="flex:1;"><span class="me-field-lbl">Total Time</span>
            <input class="me-inp" style="width:100%;" type="text" id="me-duration" placeholder="e.g. 60 min">
          </div>
        </div>
        <button class="me-save-btn" onclick="saveManualSession()">Save Session</button>
      </div>
    </div>
  </div>`;
}
export function setManualGroup(i,val){manualExercises[i].group=val;manualExercises[i].name='';manualExercises[i].customGroup='';manualExercises[i].customName='';renderManualModal();}
export function setManualExName(i,val){manualExercises[i].name=val;manualExercises[i].customName='';renderManualModal();}
export function setManualScheme(i,val){const{sets,reps}=parseScheme(val);manualExercises[i].scheme=val;manualExercises[i].repsLog=Array(sets).fill(reps);renderManualModal();}
export function addManualEx(){
  manualExercises.push({id:uid(),group:'',name:'',customGroup:'',customName:'',weight:0,weightType:'standard',scheme:'3×10',repsLog:[10,10,10],arrow:'eq'});
  renderManualModal();
  setTimeout(()=>{const m=document.querySelector('.modal');if(m)m.scrollTop=m.scrollHeight;},50);
}
export function removeManualEx(id){manualExercises=manualExercises.filter(e=>e.id!==id);renderManualModal();}
export function closeManualModal(event){
  if(event&&event.target!==event.currentTarget)return;
  document.getElementById('modal-root').innerHTML='';
}
export async function saveManualSession(){
  const dateEl=document.getElementById('me-date');
  const date=dateEl?dateEl.value:todayISO();
  if(!date){_ctx.toast('Pick a date');return;}
  if(date>todayISO()){_ctx.toast('Date cannot be in the future');return;}
  if(!manualExercises.length){_ctx.toast('Add at least one exercise');return;}
  const exercises=manualExercises.map(ex=>{
    const grp=ex.group==='__new__'?(ex.customGroup.trim()||'General'):ex.group||'General';
    const name=ex.name==='__new__'?(ex.customName.trim()||'Unnamed'):ex.name||'Unnamed';
    if(ex.group==='__new__'&&ex.customGroup.trim()){
      const ng=ex.customGroup.trim();
      if(!_ctx.groups.some(g=>g.name.toLowerCase()===ng.toLowerCase()))
        _ctx.groups.push({id:uid(),name:ng,mode:'bonus',active:true,required:1,exercises:[]});
    }
    if(ex.name==='__new__'&&ex.customName.trim()){
      const tg=_ctx.groups.find(g=>g.name===grp);
      if(tg&&!tg.exercises.some(e=>e.name.toLowerCase()===ex.customName.trim().toLowerCase()))
        tg.exercises.push({id:uid(),name:ex.customName.trim(),enabled:true});
    }
    return{name,group:grp,scheme:ex.scheme||'3×10',weight:parseFloat(ex.weight)||0,weightType:ex.weightType||'standard',repsLog:ex.repsLog.map(r=>parseInt(r)||0),arrow:ex.arrow||'eq'};
  });
  sv('fj_groups',_ctx.groups);
  const notesEl=document.getElementById('me-notes');
  const effortEl=document.getElementById('me-effort');
  const durEl=document.getElementById('me-duration');
  const session={
    id:Date.now(),date,startedAt:null,savedAt:null,
    effort:effortEl&&effortEl.value?parseInt(effortEl.value):null,
    duration:durEl?durEl.value:'',calories:'',notes:notesEl?notesEl.value:'',
    cardio:null,exercises
  };
  const idx=_ctx.sessions.findIndex(s=>s.date<date);
  if(idx===-1)_ctx.sessions.push(session);else _ctx.sessions.splice(idx,0,session);
  sv('fj_sessions',_ctx.sessions);
  _ctx.stats.total=(_ctx.stats.total||0)+1;
  if(!_ctx.stats.prs)_ctx.stats.prs={};
  exercises.forEach(ex=>{
    const k=ex.group+'::'+ex.name;
    _ctx.stats.exercises[k]=(_ctx.stats.exercises[k]||0)+1;
    if(!_ctx.stats.weightHistory)_ctx.stats.weightHistory={};
    if(!_ctx.stats.weightHistory[k])_ctx.stats.weightHistory[k]=[];
    const wt=ex.weightType||'standard';
    _ctx.stats.weightHistory[k].push({date,weight:ex.weight,weightType:wt});
    _ctx.stats.weightHistory[k].sort((a,b)=>a.date.localeCompare(b.date));
    if(!_ctx.stats.totalReps)_ctx.stats.totalReps={};
    _ctx.stats.totalReps[k]=(_ctx.stats.totalReps[k]||0)+ex.repsLog.reduce((a,b)=>a+b,0);
    const cur=_ctx.stats.prs[k];
    const normWt3=normalizeWeightType(wt);
    if(!(normWt3==='bodyweight'&&(ex.weight||0)===0)&&(!cur||ex.weight>cur.weight)) _ctx.stats.prs[k]={weight:ex.weight,weightType:normWt3,date,scheme:ex.scheme,reps:ex.repsLog};
  });
  sv('fj_stats',_ctx.stats);
  document.getElementById('modal-root').innerHTML='';
  _ctx.toast('Session logged ✓');_ctx.renderHistory();
  if(isSupabaseEnabled()){
    _ctx.setSyncStatus('syncing');
    try{await Promise.all([dbPushSession(session),dbPushStats(_ctx.stats)]);_ctx.setSyncStatus('synced');}
    catch(e){_ctx.setSyncStatus('error');}
  } else if(_ctx.gistCfg.pat){
    _ctx.setSyncStatus('syncing');
    try{await gistPush(_ctx.gistCfg,_ctx.buildPayload());_ctx.setSyncStatus('synced');}catch(e){_ctx.setSyncStatus('error');}
  }
}

// ── supabase helpers ─────────────────────────────────────────────────────────

export async function settDbPush(){
  setSettMsg('Pushing…','info');_ctx.setSyncStatus('syncing');
  try{
    await dbPush(_ctx.buildPayload());
    setSettMsg('✅ All data pushed to Supabase','ok');
    _ctx.setSyncStatus('synced');_ctx.toast('Synced ✓');
  }catch(err){
    setSettMsg(`❌ ${_ctx.formatSyncError(err)}`,'err');_ctx.setSyncStatus('error');
  }
}

// ── gist helpers ─────────────────────────────────────────────────────────────

export async function settGistPush(){
  const pat=document.getElementById('s-pat')?.value.trim();const gid=document.getElementById('s-gid')?.value.trim();
  if(pat)_ctx.gistCfg.pat=pat;if(gid)_ctx.gistCfg.gistId=gid;sv('fj_gist_cfg',_ctx.gistCfg);
  if(!_ctx.gistCfg.pat){setSettMsg('Enter your PAT first','err');return;}
  setSettMsg('Pushing…','info');_ctx.setSyncStatus('syncing');
  try{
    const d=await gistPush(_ctx.gistCfg,_ctx.buildPayload());
    const idInp=document.getElementById('s-gid');if(idInp)idInp.value=_ctx.gistCfg.gistId;
    setSettMsg(`✅ Pushed! <a href="${d.html_url}" target="_blank" style="color:var(--accent);">View Gist ↗</a>`,'ok');
    _ctx.setSyncStatus('synced');_ctx.toast('Synced ✓');
  }catch(err){setSettMsg(`❌ ${_ctx.formatSyncError(err)}`,'err');_ctx.setSyncStatus('error');}
}
export async function settGistPull(){
  const pat=document.getElementById('s-pat')?.value.trim();const gid=document.getElementById('s-gid')?.value.trim();
  if(pat)_ctx.gistCfg.pat=pat;if(gid)_ctx.gistCfg.gistId=gid;sv('fj_gist_cfg',_ctx.gistCfg);
  if(!_ctx.gistCfg.pat||!_ctx.gistCfg.gistId){setSettMsg('Need both PAT and Gist ID','err');return;}
  setSettMsg('Pulling…','info');
  try{
    const data=await gistPull(_ctx.gistCfg);_ctx.applyPayload(data);
    setSettMsg(`✅ Restored ${_ctx.sessions.length} sessions`,'ok');
    _ctx.toast('Restored ✓');_ctx.setSyncStatus('synced');_ctx.renderHistory();
  }catch(err){setSettMsg(`❌ ${_ctx.formatSyncError(err)}`,'err');}
}
export function setSettMsg(msg,type){const el=document.getElementById('s-gist-msg');if(el){el.className='gist-msg '+type;el.innerHTML=msg;}}
