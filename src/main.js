import './styles/index.css';
import { DEF_GROUPS, DEF_CFG, DEF_MACHINES, THEME_BASES, EFFORT_LABELS, EFFORT_COLORS, DEF_GAMIFICATION } from './constants.js';
import { dotw, fmtDate, todayISO, isoFromDate, getWeekStart, DAYS_OF_WEEK } from './utils/date.js';
import { dc, uid, esc, normalizeWeightType, pick, shuffle, parseScheme } from './utils/misc.js';
import { ld, sv } from './storage.js';
import { gistPull, gistPush } from './sync/gist.js';
import { sessionTotalCal } from './utils/misc.js';
import { renderPRs } from './views/prs.js';
import { renderStats } from './views/stats.js';
import {
  initSettings, renderSettings, setSettTab,
  toggleGrp, adjCfg, adjNewScheme, addScheme, removeScheme,
  adjRequired, toggleGroupActive, setGroupMode, saveExCue,
  toggleEx, deleteEx, addEx, addGroup, deleteGroup,
  addMachine, deleteMachine,
  setStreakMode, adjStreakGoal, setIncrement,
  setThemeBase, setCustomAccent, setCardPref, setGamifPref,
  resetAcc, resetHistoryAndStats, _doResetHistoryAndStats, nuclearReset, _doNuclearReset,
  setProfileVal,
  showBackupPrompt, dismissBackupPrompt, exportDataAndDismiss,
  exportData, copyExportJson, closeExportModal, importData,
  openManualEntry, renderManualModal, setManualGroup, setManualExName,
  setManualScheme, addManualEx, removeManualEx, closeManualModal, saveManualSession,
  settGistPush, settGistPull, setSettMsg,
} from './views/settings/index.js';
'use strict';

function getSchemes(){return(cfg.schemes&&cfg.schemes.length)?cfg.schemes:['3×10','3×12','4×10'];}

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
const lsGet=ld, lsSet=sv;
let gistCfg = ld('fj_gist_cfg', {pat:'',gistId:''});

let groups   = ld('fj_groups',   DEF_GROUPS);
let cfg      = ld('fj_cfg',      DEF_CFG);
// Migrate: ensure profile sub-object exists for users upgrading from older versions
if(!cfg.profile) cfg.profile=dc(DEF_CFG.profile);
// Migrate: ensure restTimer sub-object exists
if(!cfg.restTimer) cfg.restTimer=dc(DEF_CFG.restTimer);
// Migrate: replace workoutDays array with streakMode/streakGoal
if(cfg.streakMode==null){cfg.streakMode='weekly';cfg.streakGoal=Math.max(1,(cfg.workoutDays||[]).length)||3;}
// Migrate: new customization fields
if(cfg.accentColor===undefined) cfg.accentColor=null;
if(!cfg.cardPrefs) cfg.cardPrefs=dc(DEF_CFG.cardPrefs);
if(cfg.cardPrefs.showCues===undefined) cfg.cardPrefs.showCues=true;
if(cfg.cardPrefs.showLastSession===undefined) cfg.cardPrefs.showLastSession=true;
if(cfg.cardPrefs.showGroupLabel===undefined) cfg.cardPrefs.showGroupLabel=true;
if(!cfg.gamificationPrefs) cfg.gamificationPrefs=dc(DEF_CFG.gamificationPrefs);
if(cfg.gamificationPrefs.showHeaderBadge===undefined) cfg.gamificationPrefs.showHeaderBadge=true;
if(cfg.gamificationPrefs.showXPBar===undefined) cfg.gamificationPrefs.showXPBar=true;
let machines = ld('fj_machines', DEF_MACHINES);
let sessions = ld('fj_sessions', []);
let stats    = ld('fj_stats',    {exercises:{},total:0,weightHistory:{},totalReps:{},prs:{}});
let theme    = ld('fj_theme',    'dark');
// Migrate legacy theme name strings → base system
{const _lm={'dark-red':'dark','dark-blue':'dark','dark-green':'dark','dark-purple':'dark','dark-orange':'dark','dark-teal':'dark','dark-gold':'dark','light':'light'};
const _la={'dark-red':'#e8271f','dark-blue':'#3b6fff','dark-green':'#22c55e','dark-purple':'#8b5cf6','dark-orange':'#f97316','dark-teal':'#14b8a6','dark-gold':'#eab308'};
if(_lm[theme]!==undefined){if(!cfg.accentColor&&_la[theme])cfg.accentColor=_la[theme];theme=_lm[theme];sv('fj_theme',theme);sv('fj_cfg',cfg);}
if(theme!=='dark'&&theme!=='light')theme='dark';}


let pending  = null;
let active   = null;
let statTab  = 'sessions';
let calSelectedDate = null;
let calViewMonth = null;
let histView = 'week';
let weekOffset = 0;
let weekSelectedDate = null;
let expandedChip = null;
const openAcc = {};
const openGrp = {};
const armed   = {};
let _pendingDelete = null;
let _pendingBackupPrompt = false;
let templates = ld('fj_templates',[])||[];
let histFilter = {effort:0,group:''};
let settingsTab = 'profile';
let buildMode = 'random';
let _restTimerInterval = null;
let _restTimerRemaining = 0;
let _restTimerTotal = 0;
const openPicker = {};

/* ═══════════════════════════════════════════
   BODY CLASS & ACCENT UTILITIES
═══════════════════════════════════════════ */
function applyBodyClasses(){
  document.body.className='base-'+theme;
}
function hexToRgb(hex){
  const h=hex.replace('#','');
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return {r,g,b};
}
function hexToRgba(hex,alpha){
  const {r,g,b}=hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
function lightenHex(hex,amount){
  let {r,g,b}=hexToRgb(hex);
  r=Math.min(255,Math.round(r+(255-r)*amount));
  g=Math.min(255,Math.round(g+(255-g)*amount));
  b=Math.min(255,Math.round(b+(255-b)*amount));
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function hsvToRgb(h,s,v){
  h=h%360;s/=100;v/=100;
  const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;
  let r,g,b;
  if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];
  else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];
  else if(h<300)[r,g,b]=[x,0,c];else [r,g,b]=[c,0,x];
  return[Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];
}
function rgbToHsv(r,g,b){
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  let h=0,s=max===0?0:d/max,v=max;
  if(d){if(max===r)h=((g-b)/d%6+6)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;}
  return[Math.round(h),Math.round(s*100),Math.round(v*100)];
}
function hexToHsv(hex){const{r,g,b}=hexToRgb(hex);return rgbToHsv(r,g,b);}
function hsvToHex(h,s,v){const[r,g,b]=hsvToRgb(h,s,v);return'#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');}

const _fcp={hue:0,sat:100,val:100,open:false};
function _fcpDrawSV(){
  const c=document.getElementById('fcp-sv');if(!c)return;
  const ctx=c.getContext('2d'),w=c.width,h=c.height;
  ctx.fillStyle=hsvToHex(_fcp.hue,100,100);ctx.fillRect(0,0,w,h);
  const wg=ctx.createLinearGradient(0,0,w,0);
  wg.addColorStop(0,'rgba(255,255,255,1)');wg.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=wg;ctx.fillRect(0,0,w,h);
  const bg=ctx.createLinearGradient(0,0,0,h);
  bg.addColorStop(0,'rgba(0,0,0,0)');bg.addColorStop(1,'rgba(0,0,0,1)');
  ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  const cx=(_fcp.sat/100)*w,cy=(1-_fcp.val/100)*h;
  ctx.beginPath();ctx.arc(cx,cy,8,0,Math.PI*2);
  ctx.strokeStyle='rgba(0,0,0,0.5)';ctx.lineWidth=2.5;ctx.stroke();
  ctx.beginPath();ctx.arc(cx,cy,7,0,Math.PI*2);
  ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
}
function _fcpDrawHue(){
  const c=document.getElementById('fcp-hue');if(!c)return;
  const ctx=c.getContext('2d'),w=c.width,h=c.height;
  const g=ctx.createLinearGradient(0,0,w,0);
  for(let i=0;i<=360;i+=30)g.addColorStop(i/360,`hsl(${i},100%,50%)`);
  ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  const tx=Math.round((_fcp.hue/360)*w);
  ctx.strokeStyle='rgba(0,0,0,0.5)';ctx.lineWidth=1.5;ctx.strokeRect(tx-5,1,10,h-2);
  ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.strokeRect(tx-4,1,8,h-2);
}
function _fcpApplyLive(){
  const hex=hsvToHex(_fcp.hue,_fcp.sat,_fcp.val);
  _fcpDrawSV();_fcpDrawHue();
  const inp=document.querySelector('.accent-hex-inp');
  const prev=document.getElementById('accent-preview-box');
  if(inp)inp.value=hex;
  if(prev)prev.style.background=hex;
  cfg.accentColor=hex;sv('fj_cfg',cfg);applyCustomAccent(hex);
}
function _fcpSVAt(e,c){
  const r=c.getBoundingClientRect();
  const px=(e.touches?e.touches[0].clientX:e.clientX)-r.left;
  const py=(e.touches?e.touches[0].clientY:e.clientY)-r.top;
  _fcp.sat=Math.round(Math.max(0,Math.min(1,px/r.width))*100);
  _fcp.val=Math.round(Math.max(0,Math.min(1,1-py/r.height))*100);
  _fcpApplyLive();
}
function _fcpHueAt(e,c){
  const r=c.getBoundingClientRect();
  const px=(e.touches?e.touches[0].clientX:e.clientX)-r.left;
  _fcp.hue=Math.round(Math.max(0,Math.min(1,px/r.width))*360);
  _fcpApplyLive();
}
(function(){
  let drag=null;
  function mm(e){
    if(!drag)return;e.preventDefault();
    const sv=document.getElementById('fcp-sv'),hu=document.getElementById('fcp-hue');
    if(drag==='sv'&&sv)_fcpSVAt(e,sv);
    else if(drag==='hue'&&hu)_fcpHueAt(e,hu);
  }
  function mu(){drag=null;}
  document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);
  document.addEventListener('touchmove',mm,{passive:false});document.addEventListener('touchend',mu);
  document._fcpSetDrag=v=>{drag=v;};
})();
function initForgePicker(hex){
  const[h,s,v]=hexToHsv(hex||'#e8271f');
  _fcp.hue=h;_fcp.sat=s;_fcp.val=v;
  requestAnimationFrame(()=>{
    const sv=document.getElementById('fcp-sv');
    const hu=document.getElementById('fcp-hue');
    if(!sv||!hu)return;
    sv.width=sv.clientWidth||280;sv.height=Math.round(sv.clientWidth*0.6)||168;
    hu.width=hu.clientWidth||280;hu.height=20;
    _fcpDrawSV();_fcpDrawHue();
    sv.onmousedown=e=>{document._fcpSetDrag('sv');_fcpSVAt(e,sv);};
    sv.ontouchstart=e=>{document._fcpSetDrag('sv');_fcpSVAt(e,sv);};
    hu.onmousedown=e=>{document._fcpSetDrag('hue');_fcpHueAt(e,hu);};
    hu.ontouchstart=e=>{document._fcpSetDrag('hue');_fcpHueAt(e,hu);};
  });
}
function toggleForgePicker(){
  _fcp.open=!_fcp.open;
  const el=document.getElementById('fcp-panel');
  const btn=document.getElementById('accent-preview-box');
  if(!el)return;
  el.style.display=_fcp.open?'block':'none';
  if(btn)btn.classList.toggle('fcp-open',_fcp.open);
  if(_fcp.open)initForgePicker(cfg.accentColor||'#e8271f');
}
function applyCustomAccent(hex){
  const props=['--accent','--accent2','--accent-dim','--accent-glow','--j-acc'];
  if(!hex){props.forEach(p=>document.body.style.removeProperty(p));return;}
  const accent2=lightenHex(hex,0.18);
  const accentDim=hexToRgba(hex,0.1);
  const accentGlow=hexToRgba(hex,0.25);
  document.body.style.setProperty('--accent',hex);
  document.body.style.setProperty('--accent2',accent2);
  document.body.style.setProperty('--accent-dim',accentDim);
  document.body.style.setProperty('--accent-glow',accentGlow);
  document.body.style.setProperty('--j-acc',hex);
}
function fmtWt(n,noUnit,weightType){
  const type=normalizeWeightType(weightType);
  if(type==='level'){
    const lvl=parseInt(n);
    return isNaN(lvl)?'Lvl —':(noUnit?String(lvl):'Lvl '+lvl);
  }
  if(n==null||n==='') return '—';
  const v=parseFloat(n);
  if(isNaN(v)) return '—';
  const unit=cfg.profile&&cfg.profile.weightUnit==='kg'?'kg':'lbs';
  let display;
  if(unit==='kg'){
    const kg=(v*0.453592).toFixed(1);
    display=noUnit?kg:kg+' kg';
  } else {
    display=noUnit?String(v):v+' lbs';
  }
  if(type==='bodyweight') return v>0?'BW +'+display:'BW';
  return display;
}
applyBodyClasses();
if(cfg.accentColor) applyCustomAccent(cfg.accentColor);

/* ═══════════════════════════════════════════
   GIST API
═══════════════════════════════════════════ */
function buildPayload(){
  return JSON.stringify({version:4,exportedAt:new Date().toISOString(),sessions,stats,groups,cfg,machines,theme,gamification},null,2);
}
function applyPayload(data){
  if(Array.isArray(data.sessions)){sessions=data.sessions;lsSet('fj_sessions',sessions);}
  if(data.stats&&typeof data.stats==='object'){stats=data.stats;lsSet('fj_stats',stats);}
  if(Array.isArray(data.groups)&&data.groups.length){groups=data.groups;lsSet('fj_groups',groups);}
  if(data.cfg&&typeof data.cfg==='object'){cfg=data.cfg;lsSet('fj_cfg',cfg);}
  if(Array.isArray(data.machines)){machines=data.machines;lsSet('fj_machines',machines);}
  if(data.theme&&typeof data.theme==='string'){
    const _lm2={'dark-red':'dark','dark-blue':'dark','dark-green':'dark','dark-purple':'dark','dark-orange':'dark','dark-teal':'dark','dark-gold':'dark','light':'light'};
    const _la2={'dark-red':'#e8271f','dark-blue':'#3b6fff','dark-green':'#22c55e','dark-purple':'#8b5cf6','dark-orange':'#f97316','dark-teal':'#14b8a6','dark-gold':'#eab308'};
    theme=_lm2[data.theme]||(_la2[data.theme]?'dark':data.theme);
    if(_la2[data.theme]&&!cfg.accentColor)cfg.accentColor=_la2[data.theme];
    lsSet('fj_theme',theme);applyBodyClasses();if(cfg.accentColor)applyCustomAccent(cfg.accentColor);
  }
  if(data.gamification&&typeof data.gamification==='object'){
    // Merge conflict: keep higher XP (more progress wins), union badge arrays
    const incoming=data.gamification;
    if((incoming.xp||0)>(gamification.xp||0)){
      gamification={...dc(DEF_GAMIFICATION),...incoming};
    } else {
      // Keep local XP but merge in any new badges from incoming
      const allBadges=[...new Set([...(gamification.earnedBadges||[]),...(incoming.earnedBadges||[])])];
      gamification={...gamification,earnedBadges:allBadges};
    }
    lsSet('fj_gamification',gamification);
  }
  // Post-apply migrations
  if(!cfg.profile)cfg.profile=dc(DEF_CFG.profile);
  if(!cfg.restTimer)cfg.restTimer=dc(DEF_CFG.restTimer);
  if(cfg.streakMode==null){cfg.streakMode='weekly';cfg.streakGoal=Math.max(1,(cfg.workoutDays||[]).length)||3;}
  if(!stats.exercises)stats.exercises={};
  if(!stats.weightHistory)stats.weightHistory={};
  if(!stats.totalReps)stats.totalReps={};
  if(!stats.prs)stats.prs={};
}


/* ═══════════════════════════════════════════
   STARTUP
═══════════════════════════════════════════ */
async function init(){
  const ls=document.getElementById('loading-screen');
  const lmsg=document.getElementById('loading-msg');
  const lspinner=document.querySelector('.loading-spinner');
  const lerr=document.getElementById('loading-err');
  const lerrmsg=document.getElementById('loading-err-msg');
  if(!gistCfg.pat){
    ls.style.display='none';
    launchApp();
    return;
  }
  lmsg.textContent='Syncing from Gist…';setSyncStatus('syncing');
  try{
    const data=await gistPull(gistCfg);
    if(data&&data.version){
      // Merge strategy: compare session counts — take whichever has more data
      // For sessions: merge by id so no duplicates, keep all unique sessions
      const localSessions=ld('fj_sessions',[]);
      const gistSessions=data.sessions||[];
      if(gistSessions.length>0){
        // Merge: union of sessions by id, newest wins for duplicates
        const merged=Object.values(
          [...localSessions,...gistSessions].reduce((acc,s)=>{
            if(!acc[s.id]||s.savedAt>acc[s.id].savedAt)acc[s.id]=s;
            return acc;
          },{})
        ).sort((a,b)=>b.date.localeCompare(a.date));
        sessions=merged;sv('fj_sessions',sessions);
        data.sessions=sessions;
      }
      // For non-session data, only apply Gist version if local wasn't modified after last push
      // Simple heuristic: always take Gist groups/cfg/machines (they're settings, not history)
      // But only if Gist has them — don't wipe local customizations
      if(data.groups&&data.groups.length)applyPayload({...data,sessions});
      else applyPayload({...data,sessions,groups,cfg,machines});
    }
    setSyncStatus('synced');ls.style.display='none';launchApp();
  }catch(err){
    lspinner.style.display='none';lmsg.style.display='none';
    lerrmsg.textContent=`Could not sync from Gist: ${err.message}. You can continue with your locally cached data.`;
    lerr.style.display='block';setSyncStatus('error');
  }
}
function setHdrH(){
  const h=document.querySelector('.hdr');
  if(h)document.documentElement.style.setProperty('--hdr-h',h.offsetHeight+'px');
}
function launchApp(){
  document.getElementById('loading-screen').style.display='none';
  document.getElementById('setup-screen').style.display='none';
  setHdrH();
  // Restore any in-progress workout that was interrupted (refresh, crash, etc.)
  const savedActive=ld('fj_active_workout',null);
  if(savedActive&&Array.isArray(savedActive.exercises)){
    // Validate and repair each exercise entry before restoring
    savedActive.exercises=savedActive.exercises.map(ex=>{
      if(!Array.isArray(ex.repsLog))ex.repsLog=[];
      if(!Array.isArray(ex.setsDone))ex.setsDone=Array(ex.sets||3).fill(false);
      if(typeof ex.weight!=='number'||isNaN(ex.weight))ex.weight=0;
      if(typeof ex.sets!=='number'||ex.sets<1)ex.sets=ex.repsLog.length||3;
      return ex;
    });
    if(!savedActive.cardio||typeof savedActive.cardio!=='object')
      savedActive.cardio={machine:null,duration:'',metric:'',calories:'',program:''};
    active=savedActive;
    toast('Workout restored 💪');
  }
  // Set active workout dot on nav
  const todayBtn=document.getElementById('bnav-today');
  if(todayBtn) todayBtn.classList.toggle('has-active-workout',!!active);
  updateSyncUI();
  startAutoSync();
  // Initialize gamification — migrate existing users, then render header badge
  migrateGamification();
  renderHeaderLevel();
  // Wire up settings module with live-state context
  initSettings({
    get cfg(){return cfg;}, set cfg(c){cfg=c;},
    get groups(){return groups;}, set groups(g){groups=g;},
    get machines(){return machines;}, set machines(m){machines=m;},
    get theme(){return theme;}, set theme(t){theme=t;},
    get sessions(){return sessions;}, set sessions(s){sessions=s;},
    get stats(){return stats;}, set stats(st){stats=st;},
    get gistCfg(){return gistCfg;},
    get gamification(){return gamification;}, set gamification(g){gamification=g;},
    get settingsTab(){return settingsTab;}, set settingsTab(t){settingsTab=t;},
    openGrp, _fcp,
    toast, autoSaveSettings, applyBodyClasses, applyCustomAccent, initForgePicker,
    renderGenStreakChip, renderHeaderLevel, renderHistory, buildPayload, applyPayload,
    setSyncStatus, formatSyncError, armReset, getSchemes, enabledEx, wtTypeLabel,
  });
  // Generate tab is the default active view — populate it on load
  renderActiveWorkoutBanner();renderGenStreakChip();renderTemplates();
}
window.addEventListener('resize',setHdrH);

/* ── AUTO-SYNC every 30s when active workout exists ── */
let autoSyncInterval=null;
function startAutoSync(){
  if(autoSyncInterval)clearInterval(autoSyncInterval);
  autoSyncInterval=setInterval(async()=>{
    if(!active||!gistCfg.pat)return;
    // Save active workout state to localStorage silently
    lsSet('fj_active_workout',active);
    try{await gistPush(gistCfg, buildPayload());}catch(e){/* silent */}
  },30000);
}
/* ── AUTO-PUSH settings changes to Gist (debounced) ── */
let _settingsPushTimer=null;
function autoSaveSettings(){
  if(!gistCfg.pat)return;
  if(_settingsPushTimer)clearTimeout(_settingsPushTimer);
  _settingsPushTimer=setTimeout(async()=>{
    _settingsPushTimer=null;
    try{await gistPush(gistCfg, buildPayload());setSyncStatus('synced');}catch(e){setSyncStatus('error');}
  },2500);
}
// Throttled version for high-frequency events (weight inputs, reps)
let _saveThrottle=null;
function saveActiveToLocal(){lsSet('fj_active_workout',active);}
function saveActiveThrottled(){
  if(_saveThrottle)clearTimeout(_saveThrottle);
  _saveThrottle=setTimeout(()=>{saveActiveToLocal();_saveThrottle=null;},500);
}
function continueOffline(){
  document.getElementById('loading-screen').style.display='none';
  document.getElementById('setup-screen').style.display='none';
  launchApp();
}

/* ═══════════════════════════════════════════
   SETUP FLOW
═══════════════════════════════════════════ */
async function setupConnect(){
  const pat=document.getElementById('setup-pat').value.trim();
  const gistId=document.getElementById('setup-gist-id').value.trim();
  if(!pat){showSetupMsg('Enter your Personal Access Token','err');return;}
  showSetupMsg('Connecting…','info');
  gistCfg.pat=pat;if(gistId)gistCfg.gistId=gistId;lsSet('fj_gist_cfg',gistCfg);
  try{
    if(gistId){showSetupMsg('Pulling your data from Gist…','info');const data=await gistPull(gistCfg);if(data&&data.version)applyPayload(data);showSetupMsg(`✓ Restored ${sessions.length} sessions`,'ok');}
    else{showSetupMsg('Creating new Gist…','info');await gistPush(gistCfg, buildPayload());showSetupMsg('✓ New Gist created','ok');}
    setSyncStatus('synced');setTimeout(launchApp,800);
  }catch(err){showSetupMsg(`Error: ${err.message}`,'err');gistCfg.pat='';gistCfg.gistId='';lsSet('fj_gist_cfg',gistCfg);}
}
function showSetupMsg(msg,type){
  const el=document.getElementById('setup-msg');
  el.style.display='block';el.className='setup-msg '+type;el.textContent=msg;
}

/* ═══════════════════════════════════════════
   SYNC UI
═══════════════════════════════════════════ */
function setSyncStatus(state){
  const btn=document.getElementById('sync-btn');const lbl=document.getElementById('sync-lbl');
  if(!btn)return;btn.className='sync-btn';
  if(state==='synced'){btn.classList.add('synced');lbl.textContent='Synced ✓';}
  else if(state==='syncing'){btn.classList.add('syncing');lbl.textContent='Syncing…';}
  else if(state==='error'){btn.classList.add('error');lbl.textContent='Sync Error';}
  else{lbl.textContent='☁ Backup';}
}
function updateSyncUI(){if(gistCfg.pat&&gistCfg.gistId)setSyncStatus('synced');else setSyncStatus('');}
async function manualSync(){
  if(!gistCfg.pat){openGistSetupModal();return;}
  setSyncStatus('syncing');
  try{
    const data=await gistPull(gistCfg);if(data&&data.version)applyPayload(data);
    await gistPush(gistCfg, buildPayload());setSyncStatus('synced');toast('Synced with Gist ✓');
    const activeNav=document.querySelector('.tab.active');
    if(activeNav){const tabs=['generate','today','history','settings','stats'];tabs.forEach((t,i)=>{if(document.querySelectorAll('.tab')[i]?.classList.contains('active'))switchTab(t);});}
  }catch(err){setSyncStatus('error');toast(formatSyncError(err),4000);}
}
function openGistSetupModal(){
  const root=document.getElementById('modal-root');
  root.innerHTML=`<div class="modal-overlay" onclick="closeExportModal(event)"><div class="modal" onclick="event.stopPropagation()"><div class="modal-hdr"><span class="modal-title">SETUP GIST SYNC</span><button class="modal-close" onclick="closeExportModal()">×</button></div><div class="modal-body"><div style="display:flex;flex-direction:column;gap:14px;"><p style="font-size:13px;color:var(--j-txt2);line-height:1.6;">Connect a GitHub Gist to sync your data across all your devices.</p><div class="gist-field"><label>Personal Access Token</label><input class="gist-inp" type="password" id="modal-pat" placeholder="ghp_xxxxxxxxxxxx" value="${gistCfg.pat||''}"><div class="gist-hint">GitHub → Settings → Developer settings → PAT (classic) — needs <code>gist</code> scope only</div></div><div class="gist-field"><label>Gist ID <span style="font-weight:400;color:var(--text3);">(blank = create new)</span></label><input class="gist-inp" type="text" id="modal-gid" placeholder="Paste existing Gist ID to restore" value="${gistCfg.gistId||''}"></div><div id="modal-gist-msg"></div><div class="gist-btns"><button class="gist-btn primary" onclick="modalGistConnect()">Connect</button></div></div></div></div></div>`;
}
async function modalGistConnect(){
  const pat=document.getElementById('modal-pat')?.value.trim();const gid=document.getElementById('modal-gid')?.value.trim();const msgEl=document.getElementById('modal-gist-msg');
  if(!pat){if(msgEl){msgEl.className='gist-msg err';msgEl.textContent='Enter your PAT';}return;}
  gistCfg.pat=pat;if(gid)gistCfg.gistId=gid;lsSet('fj_gist_cfg',gistCfg);
  if(msgEl){msgEl.className='gist-msg info';msgEl.textContent=gid?'Pulling data…':'Creating Gist…';}
  try{
    if(gid){const data=await gistPull(gistCfg);applyPayload(data);if(msgEl){msgEl.className='gist-msg ok';msgEl.innerHTML=`✅ Restored ${sessions.length} sessions`;}}
    else{await gistPush(gistCfg, buildPayload());if(msgEl){msgEl.className='gist-msg ok';msgEl.textContent='✅ Gist created!';}}
    setSyncStatus('synced');toast('Connected ✓');setTimeout(()=>{closeExportModal();renderHistory();},800);
  }catch(err){gistCfg.pat='';gistCfg.gistId='';lsSet('fj_gist_cfg',gistCfg);if(msgEl){msgEl.className='gist-msg err';msgEl.textContent='❌ '+err.message;}}
}

// % of 1RM intensity by rep count, based on standard training zones:
// Strength (1-6 reps): 80-90%, Hypertrophy (7-12): 65-75%, Endurance (15+): <60%
function repIntensity(r){
  if(r<=1)return 1.00; if(r<=2)return 0.95; if(r<=3)return 0.90;
  if(r<=4)return 0.88; if(r<=5)return 0.85; if(r<=6)return 0.82;
  if(r<=7)return 0.80; if(r<=8)return 0.77; if(r<=9)return 0.75;
  if(r<=10)return 0.72; if(r<=11)return 0.70; if(r<=12)return 0.67;
  if(r<=14)return 0.63; return 0.58; // 15+ endurance: under 60%
}
// Suggest starting weight for a new scheme given last session data.
// Uses ratio of rep-zone intensities so same scheme always returns same weight.
// Sets penalty uses a hyperbolic model: 1/(1+(n-1)*0.05) — no hard cap,
// so high-volume schemes (e.g. 10x10) get meaningfully lower suggestions.
function calcSuggestedWeight(lastWeight,lastReps,lastSets,newReps,newSets){
  if(!lastWeight||lastWeight<=0)return 0;
  const repsRatio=repIntensity(newReps)/repIntensity(lastReps);
  const setsAdj=n=>1/(1+(n-1)*0.05);
  const raw=lastWeight*repsRatio*(setsAdj(newSets)/setsAdj(lastSets));
  const inc=cfg.weightIncrement||5;
  return Math.round(raw/inc)*inc;
}
// Build the sets column-headers + grid HTML.
// ≤5 sets: single row. >5 sets: two balanced rows (ceil/floor split), each filling full width.
function buildSetsArea(ex,ei){
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
function enabledEx(g){return g.exercises.filter(e=>e.enabled);}
function lastForEx(name){for(const s of sessions){const e=s.exercises.find(e=>e.name===name);if(e)return e;}return null;}
function lastForExByType(name,type){
  const normType=normalizeWeightType(type);
  const match=normType==='bodyweight'
    ?t=>normalizeWeightType(t)==='bodyweight'
    :t=>normalizeWeightType(t)===normType;
  for(const s of sessions){const e=s.exercises.find(e=>e.name===name&&match(e.weightType||'standard'));if(e)return e;}
  return null;
}
function machById(id){return machines.find(m=>m.id===id);}

function toast(msg,dur){
  const t=document.getElementById('toast');
  t.textContent=msg;t.style.pointerEvents='';t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),dur||2500);
}
function toastHtml(html,dur){
  const t=document.getElementById('toast');
  t.innerHTML=html;t.style.pointerEvents='auto';t.classList.add('show');
  setTimeout(()=>{t.classList.remove('show');t.style.pointerEvents='';},dur||2500);
}
function formatSyncError(err){
  const msg=(err&&err.message)||String(err);
  if(msg.includes('Failed to fetch')||msg.includes('NetworkError')||msg.includes('network'))return'No internet connection — data saved locally';
  if(msg.includes('401')||msg.toLowerCase().includes('bad credentials')||msg.toLowerCase().includes('invalid token'))return'Invalid token — check your PAT in Settings → Data';
  if(msg.includes('403'))return'Permission denied — ensure your PAT has "gist" scope';
  if(msg.includes('404')||msg.toLowerCase().includes('not found'))return'Gist not found — verify the Gist ID in Settings → Data';
  if(msg.includes('422'))return'GitHub rejected the data — try exporting a backup first';
  if(msg.includes('429'))return'Rate limited by GitHub — wait a minute and try again';
  return'Sync failed: '+msg;
}
function getPlateauCount(name,group){
  const k=group+'::'+name;
  const hist=stats.weightHistory[k]||[];
  if(hist.length<3)return 0;
  const last=hist[hist.length-1].weight;
  let count=0;
  for(let i=hist.length-1;i>=0;i--){if(hist[i].weight===last)count++;else break;}
  return count;
}
/* ── Rest Timer ── */
function startRestTimer(){
  if(!cfg.restTimer||!cfg.restTimer.enabled)return;
  clearRestTimer();
  const dur=cfg.restTimer.duration||60;
  _restTimerTotal=dur;
  _restTimerRemaining=dur;
  _renderRestTimer();
  _restTimerInterval=setInterval(()=>{
    _restTimerRemaining--;
    if(_restTimerRemaining<=0){
      _restTimerRemaining=0;_renderRestTimer(true);
      clearInterval(_restTimerInterval);_restTimerInterval=null;
      setTimeout(clearRestTimer,1500);
    } else {_renderRestTimer();}
  },1000);
}
function clearRestTimer(){
  if(_restTimerInterval){clearInterval(_restTimerInterval);_restTimerInterval=null;}
  document.getElementById('rest-timer-bar')?.remove();
}
function _renderRestTimer(done){
  let bar=document.getElementById('rest-timer-bar');
  if(!bar){
    bar=document.createElement('div');bar.id='rest-timer-bar';bar.className='rest-timer-bar';
    const wrap=document.getElementById('j-wrap');if(wrap)wrap.prepend(bar);else return;
  }
  const pct=_restTimerTotal>0?Math.round((_restTimerRemaining/_restTimerTotal)*100):0;
  const m=Math.floor(_restTimerRemaining/60),s=_restTimerRemaining%60;
  const display=m>0?`${m}:${String(s).padStart(2,'0')}`:`0:${String(_restTimerRemaining).padStart(2,'0')}`;
  bar.className='rest-timer-bar'+(done?' rt-done':'');
  bar.innerHTML=`<span class="rest-timer-time">${done?'GO!':display}</span><span class="rest-timer-label">Rest${done?' — GO!':''}</span><button class="rest-timer-skip" onclick="clearRestTimer()">${done?'✓':'Skip'}</button><div class="rest-timer-prog" style="width:${pct}%"></div>`;
}
function setRestTimerEnabled(v){if(!cfg.restTimer)cfg.restTimer=dc(DEF_CFG.restTimer);cfg.restTimer.enabled=v;sv('fj_cfg',cfg);autoSaveSettings();renderSettings();}
function setRestDuration(v){if(!cfg.restTimer)cfg.restTimer=dc(DEF_CFG.restTimer);cfg.restTimer.duration=v;sv('fj_cfg',cfg);autoSaveSettings();renderSettings();}
/* ── Build Mode / Custom Workout ── */
function setBuildMode(mode){
  buildMode=mode;
  renderPending();
}
function openExercisePicker(){
  if(active){toast('Finish active workout first');return;}
  const root=document.getElementById('modal-root');
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
function renderPickerGroups(){
  if(!pending)pending=[];
  const added=new Set(pending.map(e=>e.name));
  return groups.filter(g=>g.active).map(g=>{
    const open=openPicker[g.id];
    const exItems=g.exercises.filter(e=>e.enabled).map(ex=>{
      const sel=added.has(ex.name);
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
function togglePickerGroup(gid){openPicker[gid]=!openPicker[gid];const root=document.getElementById('modal-root');if(root)root.querySelector('.modal-body').innerHTML=renderPickerGroups();}
function togglePickerEx(name,group){
  if(!pending)pending=[];
  const idx=pending.findIndex(e=>e.name===name);
  if(idx>-1){pending.splice(idx,1);}
  else{pending.push({name,group,isBonus:false,scheme:getSchemes()[0]});}
  const root=document.getElementById('modal-root');
  if(root)root.querySelector('.modal-body').innerHTML=renderPickerGroups();
  renderPending();
  const sb=document.getElementById('start-row');
  if(sb)sb.style.display=pending.length>0?'block':'none';
}
function closePickerModal(){document.getElementById('modal-root').innerHTML='';}
function cycleScheme(name){
  const ex=pending&&pending.find(e=>e.name===name);if(!ex)return;
  const schemes=getSchemes();const idx=schemes.indexOf(ex.scheme);ex.scheme=schemes[(idx+1)%schemes.length];
  renderPending();
}
function removeCustomEx(name){
  if(!pending)return;
  pending=pending.filter(e=>e.name!==name);
  renderPending();
}
/* ── Repeat Session ── */
function repeatSession(id){
  if(active){toast('Finish or discard active workout first');return;}
  const s=sessions.find(s=>String(s.id)===String(id));
  if(!s||!s.exercises.length){toast('No exercises to repeat');return;}
  pending=s.exercises.map(ex=>({name:ex.name,group:ex.group,scheme:ex.scheme,isBonus:false}));
  buildMode='custom';
  switchTab('generate');
  toast('Loaded '+s.exercises.length+' exercises from '+fmtDate(s.date));
}
function armReset(key,fn,render){
  if(armed[key]){
    clearTimeout(armed[key+'_t']);delete armed[key];delete armed[key+'_t'];fn();
  } else {
    armed[key]=true;
    armed[key+'_t']=setTimeout(()=>{delete armed[key];delete armed[key+'_t'];render();},3000);
    render();
  }
}

/* ═══════════════════════════════════════════
   TABS
═══════════════════════════════════════════ */
const TAB_IDS=['generate','today','history','prs','stats','settings'];
function switchTab(tab){
  TAB_IDS.forEach(id=>{
    const btn=document.getElementById('bnav-'+id);
    if(btn) btn.classList.toggle('active',id===tab);
  });
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  const v=document.getElementById('view-'+tab);
  if(v) v.classList.add('active');
  // Active workout indicator on Log nav button
  const todayBtn=document.getElementById('bnav-today');
  if(todayBtn) todayBtn.classList.toggle('has-active-workout',!!active);
  if(tab!=='today') clearInterval(_timerInterval);
  if(tab==='generate'){renderActiveWorkoutBanner();setBuildMode(buildMode);renderGenStreakChip();renderTemplates();}
  if(tab==='today')    renderToday();
  if(tab==='history')  renderHistory();
  if(tab==='settings') renderSettings();
  if(tab==='stats')    renderStats({sessions,stats,cfg,statTab});
  if(tab==='prs')      renderPRs({sessions,stats,cfg,fmtWt});
}
function setStatTab(t){statTab=t;renderStats({sessions,stats,cfg,statTab});}

/* ═══════════════════════════════════════════
   GENERATE
═══════════════════════════════════════════ */
function generate(){
  if(active){toast('Finish or discard your active workout first');return;}
  if(buildMode==='custom'){toast('Switch to Random mode to generate a workout');return;}
  const btn=document.getElementById('gen-btn');
  btn.classList.remove('rolling');void btn.offsetWidth;btn.classList.add('rolling');
  const used=new Set();
  const result=[];
  for(const g of shuffle(groups.filter(g=>g.active&&g.mode==='core'))){
    const avail=enabledEx(g).filter(e=>!used.has(e.name));
    const count=Math.min(g.required||1, avail.length);
    const picked=shuffle(avail).slice(0,count);
    for(const ex of picked){used.add(ex.name);result.push({name:ex.name,group:g.name,isBonus:false,scheme:pick(getSchemes())});}
  }
  const bonusN=cfg.bonusSlots||2;
  const allGroups=groups.filter(g=>g.active);
  let att=0;const bonusGroupsUsed=[];
  while(bonusGroupsUsed.length<bonusN && att<300){
    att++;
    const cands=allGroups.filter(g=>!bonusGroupsUsed.includes(g.id));
    if(!cands.length)break;
    const g=pick(cands);
    const avail=enabledEx(g).filter(e=>!used.has(e.name));
    if(avail.length){const ex=pick(avail);used.add(ex.name);bonusGroupsUsed.push(g.id);result.push({name:ex.name,group:g.name,isBonus:true,scheme:pick(getSchemes())});}
    else bonusGroupsUsed.push(g.id);
  }
  if(!result.length){toast('No exercises available! Check Settings → Exercise Pool');return;}
  pending=result;renderPending();
}

function renderPending(){
  const c=document.getElementById('ex-cards');
  // Sync mode toggle buttons
  const rBtn=document.getElementById('bm-random'),cBtn=document.getElementById('bm-custom');
  if(rBtn)rBtn.classList.toggle('active',buildMode==='random');
  if(cBtn)cBtn.classList.toggle('active',buildMode==='custom');
  const genBtn=document.getElementById('gen-btn');
  if(genBtn)genBtn.style.display=buildMode==='random'?'':'none';
  const sb=document.getElementById('start-row');
  if(!pending||!pending.length){
    if(buildMode==='custom'){
      c.innerHTML=`<div class="empty-gen"><span class="empty-big">BUILD IT</span><span class="empty-sub">Tap + Add Exercise to choose your lifts</span><button class="es-secondary" style="margin-top:18px;" onclick="openExercisePicker()">+ Add Exercise</button></div>`;
    } else {
      const firstTime=!sessions.length;
      c.innerHTML=`<div class="empty-gen"><span class="empty-big">FORGE IT</span><span class="empty-sub">${firstTime?'Customize your exercises in Settings, then hit Generate':'Hit generate to build your workout'}</span>${firstTime?`<button class="es-secondary" style="margin-top:18px;" onclick="switchTab('settings')">Go to Settings →</button>`:''}</div>`;
    }
    if(sb)sb.style.display='none';
    return;
  }
  const isCustom=buildMode==='custom';
  c.innerHTML=pending.map(ex=>{
    const last=lastForEx(ex.name);
    const plateau=getPlateauCount(ex.name,ex.group);
    const plateauHtml=plateau>=3?`<span class="plateau-hint${plateau>=5?' strong':''}">↑ Push it! (${plateau}× same)</span>`:'';
    const lastHtml=last?`<div class="ex-last-bar">
      <span>Last:</span><span style="font-weight:700;color:var(--text);font-size:13px;">${fmtWt(last.weight,false,last.weightType)}</span>
      ${plateauHtml}
    </div>`:(plateauHtml?`<div class="ex-last-bar">${plateauHtml}</div>`:'');
    const nameEsc=esc(ex.name).replace(/'/g,'&#39;');
    return`<div class="ex-card${ex.isBonus&&!isCustom?' bonus-card':''}">
      <div class="ex-card-top">
        <div style="flex:1;min-width:0;"><div class="ex-name">${esc(ex.name)}${ex.isBonus&&!isCustom?'<span class="bonus-tag">BONUS</span>':''}</div>
        <div class="ex-group-lbl">${esc(ex.group)}</div></div>
        ${isCustom?`<button class="scheme-cycle" onclick="cycleScheme('${nameEsc}')">${esc(ex.scheme)}</button><button class="ex-card-remove" onclick="removeCustomEx('${nameEsc}')">×</button>`:`<div class="ex-scheme-lbl">${esc(ex.scheme)}</div>`}
      </div>${lastHtml}
    </div>`;
  }).join('');
  if(isCustom){
    c.innerHTML+=`<div style="padding:8px 12px 4px;"><button class="es-secondary" style="width:100%;margin:0;" onclick="openExercisePicker()">+ Add Exercise</button></div>`;
  }
  // Start row: visible when exercises are queued and no workout is already running
  if(sb)sb.style.display=active?'none':'flex';
}

function renderGenStreakChip(){
  const el=document.getElementById('gen-streak-chip');if(!el)return;
  const {current,periodProgress,periodGoal,periodLabel}=computeStreaks();
  const mode=cfg.streakMode||'weekly';
  const done=periodProgress>=periodGoal;
  const unit=mode==='daily'?'day':mode==='weekly'?'week':'month';
  const left=current>0
    ?`<div class="gen-streak-count"><span class="gen-streak-fire">🔥</span>${current}-${unit} streak</div>`
    :`<div class="gen-streak-idle">No active streak</div>`;
  const right=mode==='daily'
    ?`<div class="gen-streak-prog${done?' done':''}">${done?'Logged today ✓':'Log today'}</div>`
    :`<div class="gen-streak-prog${done?' done':''}">${periodProgress}/${periodGoal} ${periodLabel}${done?' ✓':''}</div>`;
  el.innerHTML=`<div class="gen-streak-row">${left}${right}</div>`;
}
function renderTemplates(){
  const el=document.getElementById('templates-section');if(!el)return;
  if(!templates.length){el.innerHTML='';return;}
  const chips=templates.map(t=>`<div class="tpl-chip">
    <button class="tpl-load" onclick="loadTemplate('${t.id}')">${esc(t.name)}<span class="tpl-count">${t.exercises.length}ex</span></button>
    <button class="tpl-del" onclick="deleteTemplate('${t.id}')">×</button>
  </div>`).join('');
  el.innerHTML=`<div class="tpl-bar"><div class="tpl-lbl">📂 Templates</div><div class="tpl-chips">${chips}</div></div>`;
}
function saveAsTemplate(){
  if(!pending||!pending.length){toast('Generate or build a workout first');return;}
  const name=prompt('Template name:','My Workout');
  if(!name||!name.trim())return;
  if(templates.length>=20){toast('Max 20 templates');return;}
  templates.push({id:Date.now().toString(),name:name.trim(),exercises:pending.map(e=>({name:e.name,group:e.group,scheme:e.scheme}))});
  sv('fj_templates',templates);
  renderTemplates();
  toast(`Template "${name.trim()}" saved ✓`);
}
function loadTemplate(id){
  if(active){toast('Finish your active workout first');return;}
  const t=templates.find(t=>t.id===id);if(!t)return;
  const exMap=groups.flatMap(g=>g.exercises.map(e=>({...e,group:g.name})));
  pending=t.exercises.map(te=>{
    const matched=exMap.find(e=>e.name===te.name);
    const last=lastForEx(te.name);
    return{name:te.name,group:te.group,scheme:te.scheme||'3×10',isBonus:false,
      weight:last?last.weight:0,last:last||null,
      cue:matched?matched.cue||'':''};
  });
  buildMode='custom';
  renderPending();
  toast(`"${t.name}" loaded`);
}
function deleteTemplate(id){
  templates=templates.filter(t=>t.id!==id);
  sv('fj_templates',templates);
  renderTemplates();
}
function renderActiveWorkoutBanner(){
  const container=document.getElementById('view-generate');
  const existing=document.getElementById('active-workout-banner');
  if(existing)existing.remove();
  // Dim the generate button while a workout is in progress
  const genBtn=document.getElementById('gen-btn');
  if(genBtn){genBtn.style.opacity=active?'.35':'';genBtn.style.cursor=active?'not-allowed':'';}
  if(!active)return;
  const exDone=active.exercises.filter(ex=>ex.setsDone.every(Boolean)&&ex.arrow!==null).length;
  const banner=document.createElement('div');
  banner.id='active-workout-banner';
  banner.className='active-workout-banner';
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
function discardActiveWorkout(){
  if(armed['discard-active']){
    clearTimeout(armed['discard-active_t']);
    delete armed['discard-active'];delete armed['discard-active_t'];
    clearInterval(_timerInterval);
    active=null;pending=null;
    lsSet('fj_active_workout',null);
    renderPending();
    renderActiveWorkoutBanner();
    toast('Workout discarded');
  } else {
    armed['discard-active']=true;
    armed['discard-active_t']=setTimeout(()=>{delete armed['discard-active'];delete armed['discard-active_t'];renderActiveWorkoutBanner();},3000);
    renderActiveWorkoutBanner();
  }
}
async function endAndSaveActive(){
  if(!active)return;
  renderActiveWorkoutBanner();
  await saveWorkout();
}

/* ═══════════════════════════════════════════
   START
═══════════════════════════════════════════ */
function startWorkout(){
  if(!pending)return;
  if(active){toast('Finish or discard your active workout first');return;}
  active={
    date:todayISO(),startedAt:new Date().toISOString(),effort:null,duration:'',calories:'',notes:'',
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
          weight=calcSuggestedWeight(last.weight,lr,ls,reps,sets);
        } else {
          weight=last.weight||0; // preserve level number or bodyweight extra weight as-is
        }
      }
      return{
        name:ex.name,group:ex.group,scheme:ex.scheme,
        weight,weightType,sets,targetReps:reps,
        repsLog:Array(sets).fill(reps),setsDone:Array(sets).fill(false),
        arrow:null,last:last||null,cue:exDef?exDef.cue||'':''
      };
    })
  };
  switchTab('today');
  lsSet('fj_active_workout',active);
}

/* ═══════════════════════════════════════════
   TODAY — CARD-PER-EXERCISE LAYOUT
═══════════════════════════════════════════ */
function renderToday(){
  const wrap=document.getElementById('j-wrap');
  if(!active){
    wrap.innerHTML=`<div style="text-align:center;padding:64px 20px;color:#888;font-size:11px;letter-spacing:2px;text-transform:uppercase;line-height:2.2;">
      <div style="font-family:'Black Ops One',sans-serif;font-size:22px;letter-spacing:4px;color:#ccc;margin-bottom:8px;">READY</div>
      Go to Build tab to generate &amp; start a workout
    </div>`;
    return;
  }
  const w=active;
  const inc=cfg.weightIncrement||5;
  const fmtTime=iso=>{if(!iso)return'—';const d=new Date(iso);return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});};
  const totalSets=w.exercises.reduce((a,ex)=>a+ex.sets,0);
  const doneSets=w.exercises.reduce((a,ex)=>a+ex.setsDone.filter(Boolean).length,0);

  let html=`
  <div class="j-hdr">
    <div class="j-hdr-inner">
      <div>
        <div class="j-hdr-date">${dotw(w.date)} · ${fmtDate(w.date)}</div>
        <div class="j-hdr-title">Workout Log</div>
      </div>
      <div class="j-hdr-meta">
        <div class="j-hdr-stat">
          <div class="j-hdr-stat-val">${w.exercises.length}</div>
          <div class="j-hdr-stat-lbl">Lifts</div>
        </div>
        <div class="j-hdr-stat">
          <div class="j-hdr-stat-val" id="sets-counter">${doneSets}/${totalSets}</div>
          <div class="j-hdr-stat-lbl">Sets</div>
        </div>
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
    const allDone=ex.setsDone.every(Boolean);
    const cp=cfg.cardPrefs||DEF_CFG.cardPrefs;
    const lastInfo=(cp.showLastSession!==false)&&ex.last
      ?`<div class="j-ex-last"><span style="margin-right:2px;">Prev:</span><span class="j-ex-last-w">${fmtWt(ex.last.weight,false,ex.last.weightType)}</span>${ex.last.scheme&&ex.last.scheme!==ex.scheme?`<span style="font-size:9px;color:var(--j-mut);margin-left:3px;">(${esc(ex.last.scheme)})</span>`:''}</div>`
      :'';

    const prKey=ex.group+'::'+ex.name;
    const prW=(stats.prs&&stats.prs[prKey])?stats.prs[prKey].weight:0;
    const isPR=ex.weight>0&&ex.weight>prW;
    html+=`<div class="j-ex${allDone?' ex-complete':''}" id="jex-${ei}">
      <div class="j-ex-name-row">
        <div style="min-width:0;flex:1;">
          <div class="j-ex-name">${esc(ex.name)}</div>
          ${(cp.showGroupLabel!==false||((cp.showCues!==false)&&ex.cue))?`<div class="j-ex-grp">${cp.showGroupLabel!==false?esc(ex.group):''}${(cp.showGroupLabel!==false)&&(cp.showCues!==false)&&ex.cue?' · ':''}<span class="j-ex-cue">${(cp.showCues!==false)&&ex.cue?esc(ex.cue):''}</span></div>`:''}
        </div>
        <div class="j-ex-right">
          ${lastInfo}
          <div class="j-ex-scheme">${esc(ex.scheme)}</div>
        </div>
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
  html+='</div>'; // close exercises wrapper

  // Cardio
  const cd=w.cardio;
  const selM=cd.machine?machById(cd.machine):null;
  const machGrid=machines.map(m=>`
    <button class="mach-btn${cd.machine===m.id?' sel':''}" onclick="selMachine('${m.id}')">
      <span class="mi">${m.icon}</span>${m.name}
    </button>`).join('');
  const metField=selM?`<div class="c-row">
    <span class="c-lbl">${selM.metric}</span>
    <input class="c-inp" id="cd-metric" type="number" inputmode="decimal" placeholder="0"
      value="${cd.metric}" onchange="active.cardio.metric=this.value;saveActiveThrottled()">
    <span class="c-unit">${selM.unit}</span>
  </div>`:'';
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

  const effHtml=[['Easy',1],['Good',2],['Hard',3],['Max',4]].map(([l,n])=>
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
  wrap.innerHTML=html;
  startLiveTimer();
}

/* ── Live elapsed timer ── */
let _timerInterval=null;
function startLiveTimer(){
  clearInterval(_timerInterval);
  updateLiveTimer();
  _timerInterval=setInterval(updateLiveTimer,1000);
}
function updateLiveTimer(){
  const el=document.getElementById('live-elapsed');
  if(!el){clearInterval(_timerInterval);return;}
  if(!active?.startedAt){el.textContent='—';return;}
  const secs=Math.floor((Date.now()-new Date(active.startedAt))/1000);
  if(isNaN(secs)||secs<0){el.textContent='—';return;}
  const h=Math.floor(secs/3600);
  const m=Math.floor((secs%3600)/60);
  const s=secs%60;
  el.textContent=h>0?`${h}h ${String(m).padStart(2,'0')}m`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function updateStickyCalories(){
  const el=document.getElementById('sticky-cal');
  if(!el)return;
  if(!active||!cfg.profile?.weight){el.textContent='';return;}
  // Duration estimated from completed sets only (2 min per set including rest)
  const doneSets=active.exercises.reduce((a,ex)=>a+(ex.setsDone||[]).filter(Boolean).length,0);
  if(doneSets===0){el.textContent='';return;}
  const estMin=doneSets*2;
  const est=estimateCalories(active.exercises,estMin,active.effort||2,cfg.profile);
  el.textContent=est?`~${est} cal`:'';
}

/* Journal interactions */
function adjWt(ei,d){
  const ex=active.exercises[ei];
  let newVal=Math.max(0,(ex.weight||0)+d);
  if(normalizeWeightType(ex.weightType)==='level') newVal=Math.round(newVal);
  ex.weight=newVal;
  const el=document.getElementById('wt-'+ei);if(el)el.value=ex.weight;
  updateTypeBadge(ei);
  updatePRBadge(ei);
  saveActiveThrottled();
}
function setWt(ei,v){const w=parseFloat(v);active.exercises[ei].weight=(!isNaN(w)&&w>=0)?Math.min(w,2000):0;updateTypeBadge(ei);updatePRBadge(ei);saveActiveThrottled();}
function cycleWeightType(ei){
  const TYPES=['standard','level','bodyweight'];
  const ex=active.exercises[ei];
  const currentType=normalizeWeightType(ex.weightType);
  const idx=TYPES.indexOf(currentType);
  const newType=TYPES[(idx+1)%TYPES.length];
  ex.weightType=newType;
  if(newType==='bodyweight'){
    const lastOfType=lastForExByType(ex.name,'bodyweight');
    ex.weight=lastOfType?(lastOfType.weight||0):0;
  } else {
    const lastOfType=lastForExByType(ex.name,newType);
    if(lastOfType){
      if(newType==='standard'){
        const{sets:ls,reps:lr}=parseScheme(lastOfType.scheme);
        const{sets,reps}=parseScheme(ex.scheme);
        ex.weight=calcSuggestedWeight(lastOfType.weight,lr,ls,reps,sets);
      } else {
        ex.weight=lastOfType.weight||0;
      }
    } else {
      ex.weight=0;
    }
  }
  renderToday();
  saveActiveThrottled();
}
function wtTypeLabel(ex){
  const unit=cfg.profile&&cfg.profile.weightUnit==='kg'?'KG':'LBS';
  switch(normalizeWeightType(ex.weightType)){
    case 'level':return'LVL';
    case 'bodyweight':return(ex.weight||0)>0?'BW+':'BW';
    default:return unit;
  }
}
function updateTypeBadge(ei){
  const ex=active.exercises[ei];
  if(normalizeWeightType(ex.weightType)!=='bodyweight') return;
  const badge=document.getElementById('wt-type-badge-'+ei);
  if(badge) badge.textContent=wtTypeLabel(ex);
}
function updatePRBadge(ei){
  const ex=active.exercises[ei];
  const k=ex.group+'::'+ex.name;
  const prW=(stats.prs&&stats.prs[k])?stats.prs[k].weight:0;
  const badge=document.getElementById('pr-badge-'+ei);
  if(badge)badge.style.display=(ex.weight>0&&ex.weight>prW)?'':'none';
}
function calcPlates(totalLbs,barLbs){
  const PLATES=[45,35,25,10,5,2.5];
  const COLORS={45:'#e8271f',35:'#3b6fff',25:'#f59e0b',10:'#22c55e',5:'#aaa',2.5:'#cd7f32'};
  let rem=Math.max(0,(totalLbs-barLbs)/2);
  const result=[];
  for(const p of PLATES){while(rem>=p-0.001){result.push({p,c:COLORS[p]});rem=Math.round((rem-p)*100)/100;}}
  return result;
}
function openPlateCalc(ei){
  const w=active?active.exercises[ei].weight:0;
  const root=document.getElementById('modal-root');
  root.innerHTML=`<div class="modal-overlay" onclick="if(event.target===this)document.getElementById('modal-root').innerHTML=''">
    <div class="modal" onclick="event.stopPropagation()" style="max-height:80vh;border-radius:16px 16px 0 0;">
      <div class="modal-hdr">
        <span class="modal-title">PLATE CALCULATOR</span>
        <button class="modal-close" onclick="document.getElementById('modal-root').innerHTML=''">×</button>
      </div>
      <div class="modal-body" id="plate-calc-body" style="padding-bottom:32px;">
        <div class="plate-row">
          <div class="plate-field"><label class="plate-lbl">Target Weight</label>
            <div style="display:flex;align-items:center;gap:6px;">
              <input class="gist-inp" id="plate-target" type="number" inputmode="decimal" value="${w}" style="width:88px;font-size:18px;padding:8px 12px;" oninput="renderPlates()">
              <span style="color:var(--text3);font-size:12px;">lbs</span>
            </div>
          </div>
          <div class="plate-field"><label class="plate-lbl">Bar Weight</label>
            <div class="inc-pills" id="plate-bar-pills">
              <button class="inc-pill active" onclick="setPlateBar(45,this)">45</button>
              <button class="inc-pill" onclick="setPlateBar(35,this)">35</button>
              <button class="inc-pill" onclick="setPlateBar(15,this)">15</button>
            </div>
          </div>
        </div>
        <div id="plate-result"></div>
      </div>
    </div>
  </div>`;
  renderPlates();
}
let _plateBar=45;
function setPlateBar(w,btn){
  _plateBar=w;
  document.querySelectorAll('#plate-bar-pills .inc-pill').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderPlates();
}
function renderPlates(){
  const t=parseFloat(document.getElementById('plate-target')?.value)||0;
  const res=document.getElementById('plate-result');if(!res)return;
  if(!t){res.innerHTML='<div class="plate-empty">Enter a weight above</div>';return;}
  const plates=calcPlates(t,_plateBar);
  if(!plates.length){
    res.innerHTML=`<div class="plate-empty">${t<=_plateBar?'Bar only — no plates needed':'Weight equals bar'}</div>`;return;
  }
  const chips=plates.map(({p,c})=>`<div class="plate-chip" style="background:${c}22;border-color:${c};color:${c};">${p}</div>`).join('');
  res.innerHTML=`<div class="plate-side-lbl">Each side:</div><div class="plate-chips">${chips}</div>
    <div class="plate-total-row"><span class="plate-total-lbl">Bar (${_plateBar}) + 2 × ${plates.reduce((a,{p})=>a+p,0)} lbs = </span><span class="plate-total-val">${_plateBar+plates.reduce((a,{p})=>a+p,0)*2} lbs</span></div>`;
}
function toggleDone(ei,si){
  active.exercises[ei].setsDone[si]=!active.exercises[ei].setsDone[si];
  const done=active.exercises[ei].setsDone[si];
  const cell=document.getElementById(`row-${ei}-${si}`);
  if(cell){
    cell.classList.toggle('done',done);
    if(done){
      cell.classList.remove('set-pop');
      void cell.offsetWidth; // reflow to restart animation
      cell.classList.add('set-pop');
    }
  }
  // Update progress bar live
  const totalSets=active.exercises.reduce((a,ex)=>a+ex.sets,0);
  const doneSets=active.exercises.reduce((a,ex)=>a+ex.setsDone.filter(Boolean).length,0);
  const fill=document.getElementById('j-prog-fill');
  if(fill){
    fill.style.width=totalSets>0?Math.round((doneSets/totalSets)*100)+'%':'0%';
    fill.classList.toggle('complete',doneSets===totalSets&&totalSets>0);
  }
  // Update sets counter
  const ctr=document.getElementById('sets-counter');
  if(ctr)ctr.textContent=`${doneSets}/${totalSets}`;
  const stickyCtr=document.getElementById('sticky-sets-counter');
  if(stickyCtr)stickyCtr.textContent=`${doneSets}/${totalSets}`;
  checkExComplete(ei);
  updateStickyCalories();
  saveActiveToLocal();
  if(done) startRestTimer();
}
function startEditReps(e,ei,si){
  e.stopPropagation();
  const inp=document.getElementById(`si-${ei}-${si}`);
  const disp=document.getElementById(`sa-${ei}-${si}`);
  if(!inp||!disp)return;
  inp.classList.add('editing');
  disp.style.display='none';
  inp.value=active.exercises[ei].repsLog[si];
  inp.focus();inp.select();
}
function commitReps(ei,si,val){
  const v=Math.max(0,Math.min(parseInt(val)||0,999));
  active.exercises[ei].repsLog[si]=v;
  const disp=document.getElementById(`sa-${ei}-${si}`);
  if(disp)disp.textContent=v;
  saveActiveThrottled();
}
function blurReps(ei,si){
  const inp=document.getElementById(`si-${ei}-${si}`);
  const disp=document.getElementById(`sa-${ei}-${si}`);
  if(inp){commitReps(ei,si,inp.value);inp.classList.remove('editing');}
  if(disp)disp.style.display='';
}
function checkExComplete(ei){
  const ex=active.exercises[ei];
  const card=document.getElementById('jex-'+ei);if(!card)return;
  const allDone=ex.setsDone.every(Boolean);
  card.classList.toggle('ex-complete',allDone);
  const totalSets=active.exercises.reduce((a,e)=>a+e.sets,0);
  const doneSets=active.exercises.reduce((a,e)=>a+e.setsDone.filter(Boolean).length,0);
  const ctr=document.getElementById('sets-counter');
  if(ctr)ctr.textContent=doneSets+'/'+totalSets;
  const stickyCtr=document.getElementById('sticky-sets-counter');
  if(stickyCtr)stickyCtr.textContent=doneSets+'/'+totalSets;
}
function setEffort(n){
  active.effort=n;
  document.querySelectorAll('.eff-btn').forEach((b,i)=>{b.className='eff-btn'+(n===i+1?' e'+(i+1):'');});
  saveActiveToLocal();
}
function selMachine(id){
  flushCardio();flushStrength();
  active.cardio.machine=id;
  renderToday();
  setTimeout(()=>{const el=document.querySelector('.cardio-card');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},80);
}
function flushStrength(){
  if(!active)return;
  active.exercises.forEach((ex,ei)=>{
    const w=document.getElementById('wt-'+ei);if(w)ex.weight=parseFloat(w.value)||0;
  });
}
function flushCardio(){
  if(!active)return;
  ['cd-prog','cd-dur','cd-cal','cd-metric'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    if(id==='cd-prog') active.cardio.program=el.value;
    if(id==='cd-dur')  active.cardio.duration=el.value;
    if(id==='cd-cal')  active.cardio.calories=el.value;
    if(id==='cd-metric') active.cardio.metric=el.value;
  });
}
function flushFinish(){
  if(!active)return;
  const d=document.getElementById('f-dur');if(d)active.duration=d.value;
  const c=document.getElementById('f-cal');if(c)active.calories=c.value;
  const n=document.querySelector('.f-textarea');if(n)active.notes=n.value;
}

/* ═══════════════════════════════════════════
   CALORIE ESTIMATION
═══════════════════════════════════════════ */
function parseDurationMin(durStr){
  if(!durStr)return 0;
  const m=durStr.match(/(\d+)/);return m?parseInt(m[1]):0;
}
function estimateCalories(exercises,durationMin,effort,profile){
  if(!profile?.weight)return null;
  const kg=profile.weightUnit==='kg'
    ?parseFloat(profile.weight)
    :parseFloat(profile.weight)*0.453592;
  if(!kg||kg<=0||kg>500||isNaN(kg))return null;
  // MET values from 2024 Compendium of Physical Activities (resistance training):
  // code 02054 = 3.5 (light/moderate), code 02052 = 5.0 (moderate), vigorous = 6.0
  // Effort scale: 1=Easy→3.0, 2=Good→3.5, 3=Hard→5.0, 4=Max→6.0
  const mets={1:3.0,2:3.5,3:5.0,4:6.0};
  const met=mets[effort]||3.5;
  // If no duration, estimate from total sets (avg 2 min per set including rest)
  const totalSets=(exercises||[]).reduce((a,ex)=>a+(ex.repsLog||[]).length,0);
  const effectiveDur=durationMin>0?durationMin:Math.max(1,totalSets*2);
  // Standard MET formula: Cal/min = (MET × 3.5 × kg) / 200 ; Total = Cal/min × minutes
  const calPerMin=(met*3.5*kg)/200;
  const total=Math.round(calPerMin*effectiveDur);
  return total>0?total:null;
}

/* ═══════════════════════════════════════════
   SAVE
═══════════════════════════════════════════ */
async function saveWorkout(){
  if(!active)return;
  clearInterval(_timerInterval);
  clearRestTimer();
  flushStrength();flushCardio();flushFinish();
  const savedAt=new Date().toISOString();
  // Auto-populate duration if left blank
  if(!active.duration?.trim()&&active.startedAt){
    const diffMin=Math.ceil((new Date(savedAt)-new Date(active.startedAt))/60000);
    active.duration=Math.max(1,diffMin)+' min';
  }
  // Auto-populate calories if left blank (requires body weight in profile)
  let caloriesEst=false;
  if(!active.calories){
    if(cfg.profile?.weight){
      const wallClockMin=parseDurationMin(active.duration);
      const doneSets=active.exercises.reduce((a,ex)=>a+(ex.setsDone||[]).filter(Boolean).length,0);
      const dMin=Math.max(wallClockMin,doneSets*2);
      const est=estimateCalories(active.exercises,dMin,active.effort,cfg.profile);
      if(est){active.calories=est;caloriesEst=true;}
    }
  }
  const session={
    id:Date.now(),date:active.date,
    startedAt:active.startedAt||null,savedAt,
    effort:active.effort,duration:active.duration,calories:active.calories,caloriesEst,notes:active.notes,
    cardio:active.cardio.machine?dc(active.cardio):null,
    exercises:active.exercises.map(ex=>({
      name:ex.name,group:ex.group,scheme:ex.scheme,
      weight:ex.weight,weightType:ex.weightType||'standard',repsLog:[...ex.repsLog],arrow:ex.arrow||'eq'
    }))
  };
  // Snapshot PRs before update so we can detect new ones
  const prsBefore=JSON.parse(JSON.stringify(stats.prs||{}));

  sessions.unshift(session);sv('fj_sessions',sessions);

  // Update stats
  stats.total=(stats.total||0)+1;
  if(!stats.exercises)stats.exercises={};
  if(!stats.weightHistory)stats.weightHistory={};
  if(!stats.totalReps)stats.totalReps={};
  if(!stats.prs)stats.prs={};
  session.exercises.forEach(ex=>{
    const k=ex.group+'::'+ex.name;
    const wt=ex.weightType||'standard';
    stats.exercises[k]=(stats.exercises[k]||0)+1;
    if(!stats.weightHistory[k])stats.weightHistory[k]=[];
    stats.weightHistory[k].push({date:session.date,weight:ex.weight,weightType:wt});
    const repsThisSession=(ex.repsLog||[]).reduce((a,b)=>a+(isNaN(b)?0:+b),0);
    stats.totalReps[k]=(stats.totalReps[k]||0)+repsThisSession;
    // Update PRs (skip for pure bodyweight with no extra weight — no numeric comparison meaningful)
    const normWt=normalizeWeightType(wt);
    if(!(normWt==='bodyweight'&&(ex.weight||0)===0)){
      const cur=stats.prs[k];
      if(!isNaN(ex.weight)&&(!cur||ex.weight>cur.weight)){
        stats.prs[k]={weight:ex.weight,weightType:normWt,date:session.date,scheme:ex.scheme,reps:ex.repsLog};
      }
    }
  });
  sv('fj_stats',stats);

  // Detect new PRs set this session
  const newPRs=[];
  session.exercises.forEach(ex=>{
    const k=ex.group+'::'+ex.name;
    const was=prsBefore[k];
    const now=stats.prs[k];
    if(now&&(!was||now.weight>was.weight)){newPRs.push({name:ex.name,weight:now.weight,weightType:now.weightType||'standard',prev:was?was.weight:0});}
  });

  // Process gamification (XP + badges) — must happen after stats are updated
  const gamResult=processGamification(session,newPRs)||{};

  active=null;pending=null;
  lsSet('fj_active_workout',null);
  renderPending();
  const _sb=document.getElementById('start-row');if(_sb)_sb.style.display='none';

  // Show summary modal — navigation to history happens on dismiss
  showWorkoutSummary(session,newPRs,gamResult);

  // Auto-push to Gist in background while summary is visible
  if(gistCfg.pat){
    setSyncStatus('syncing');
    try{await gistPush(gistCfg, buildPayload());setSyncStatus('synced');}
    catch(err){setSyncStatus('error');toast(formatSyncError(err),4000);}
  } else {
    const lastSeen=parseInt(ld('fj_backup_seen_count',0)||0);
    if(sessions.length===1||sessions.length-lastSeen>=10)_pendingBackupPrompt=true;
  }
}
function showWorkoutSummary(session,newPRs,gamResult){
  const effortLabels=EFFORT_LABELS;
  const effortColors=EFFORT_COLORS;
  const totalSets=session.exercises.reduce((a,ex)=>a+(ex.repsLog||[]).length,0);
  const calHtml=session.calories?`<div class="summ-stat"><div class="summ-stat-val">🔥${session.calories}</div><div class="summ-stat-lbl">cal${session.caloriesEst?' (est)':''}</div></div>`:'';
  const effortHtml=session.effort?`<div class="summ-effort" style="color:${effortColors[session.effort]}">${effortLabels[session.effort]}</div>`:'';
  const prHtml=newPRs.length?`<div class="summ-prs"><div class="summ-prs-title">🏆 NEW PRs THIS SESSION</div>${newPRs.map(p=>`<div class="summ-pr-row"><span>${esc(p.name)}</span><span style="color:var(--accent);font-weight:700;">${fmtWt(p.weight,false,p.weightType)}</span></div>`).join('')}</div>`:'';
  const {xpGained=0,newBadges=[],leveledUp=false,newLevel=1}=gamResult||{};
  const tierC={bronze:'#cd7f32',silver:'#94a3b8',gold:'#f59e0b',platinum:'#a5b4fc'};
  const prog=getLevelProgress(gamification.xp||0,gamification.level||1);
  const xpHtml=xpGained>0?`<div class="summ-xp-row">
    <div class="summ-xp-left">
      <span class="summ-xp-gained">+${xpGained} XP</span>
      ${leveledUp?`<span class="summ-lvlup">LEVEL UP → LV ${newLevel} 🎉</span>`:`<span class="summ-xp-lv">LV ${gamification.level||1}</span>`}
    </div>
    <div class="summ-xp-bar-wrap"><div class="summ-xp-bar-fill" style="width:${prog.pct}%"></div></div>
  </div>`:'';
  const badgesHtml=newBadges.length?`<div class="summ-prs summ-badges-section"><div class="summ-prs-title">🏅 ACCOLADES EARNED</div>${newBadges.map(b=>`<div class="summ-badge-row"><span class="summ-badge-icon">${b.icon}</span><span style="color:${tierC[b.tier]||'var(--accent)'};font-weight:700;font-size:13px;">${esc(b.name)}</span><span class="summ-badge-tier" style="color:${tierC[b.tier]||'var(--text3)'};">${b.tier}</span></div>`).join('')}</div>`:'';
  const prNames=new Set(newPRs.map(p=>p.name));
  const exBreakdownHtml=session.exercises.length?`<div class="summ-exercises"><div class="summ-prs-title">💪 EXERCISES</div>${session.exercises.map(ex=>{const repsStr=(ex.repsLog||[]).join(', ');const isPR=prNames.has(ex.name);return`<div class="summ-ex-row"><div class="summ-ex-info"><div class="summ-ex-name">${esc(ex.name)}${isPR?'<span class="summ-ex-pr-tag">PR</span>':''}</div><div class="summ-ex-detail">${esc(ex.scheme)}${repsStr?' · '+repsStr:''}</div></div><div class="summ-ex-wt">${fmtWt(ex.weight,false,ex.weightType)}</div></div>`;}).join('')}</div>`:'';
  const root=document.getElementById('modal-root');
  root.innerHTML=`<div class="modal-overlay">
    <div class="modal summ-modal" onclick="event.stopPropagation()" style="max-height:85vh;">
      <div class="summ-hero">
        <div class="summ-title">WORKOUT COMPLETE</div>
        <div class="summ-date">${dotw(session.date)}, ${fmtDate(session.date)}</div>
        ${effortHtml}
      </div>
      <div class="summ-stats-grid">
        ${session.duration?`<div class="summ-stat"><div class="summ-stat-val">⏱ ${esc(session.duration)}</div><div class="summ-stat-lbl">duration</div></div>`:''}
        <div class="summ-stat"><div class="summ-stat-val">${session.exercises.length}</div><div class="summ-stat-lbl">exercise${session.exercises.length!==1?'s':''}</div></div>
        <div class="summ-stat"><div class="summ-stat-val">${totalSets}</div><div class="summ-stat-lbl">set${totalSets!==1?'s':''}</div></div>
        ${calHtml}
      </div>
      ${xpHtml}
      ${prHtml}
      ${badgesHtml}
      ${exBreakdownHtml}
      <div style="padding:16px 16px 32px;">
        <button class="me-save-btn" onclick="closeSummaryModal()">Done →</button>
      </div>
    </div>
  </div>`;
}
function closeSummaryModal(){
  document.getElementById('modal-root').innerHTML='';
  switchTab('history');
  if(_pendingBackupPrompt){_pendingBackupPrompt=false;showBackupPrompt();}
}

/* ═══════════════════════════════════════════
   HISTORY + CALENDAR
═══════════════════════════════════════════ */
function getCalMonthDate(){
  if(calViewMonth) return new Date(calViewMonth.year,calViewMonth.month,1);
  const n=new Date();return new Date(n.getFullYear(),n.getMonth(),1);
}
function calNav(d){
  const cur=getCalMonthDate();
  const nd=new Date(cur.getFullYear(),cur.getMonth()+d,1);
  calViewMonth={year:nd.getFullYear(),month:nd.getMonth()};
  renderHistory();
}
function calGoToday(){calViewMonth=null;calSelectedDate=null;renderHistory();}
function calSelectDay(iso){
  calSelectedDate=(calSelectedDate===iso)?null:iso;
  renderHistory();
  if(calSelectedDate){
    setTimeout(()=>{
      const el=document.getElementById('cal-detail');
      if(el)el.scrollIntoView({behavior:'smooth',block:'nearest'});
    },60);
  }
}

/* ─── HISTORY: top-level dispatcher ─── */
function renderHistory(){
  // Toggle bar
  document.getElementById('hist-view-toggle').innerHTML=`
    <div class="hist-view-toggle">
      <button class="hvt-btn${histView==='week'?' active':''}"  onclick="setHistView('week')">📅 Week</button>
      <button class="hvt-btn${histView==='month'?' active':''}" onclick="setHistView('month')">📆 Month</button>
      <button class="hvt-btn${histView==='list'?' active':''}"  onclick="setHistView('list')">☰ All${(histFilter.effort||histFilter.group)?'<span class="hvt-filter-dot"></span>':''}</button>
    </div>`;
  document.getElementById('week-section').style.display = histView==='week'  ? '' : 'none';
  document.getElementById('cal-section').style.display  = histView==='month' ? '' : 'none';
  document.getElementById('hist-wrap').style.display    = histView==='list'  ? '' : 'none';
  if(histView==='week')  renderWeekView();
  if(histView==='month') renderMonthView();
  if(histView==='list')  renderListView();
}
function setHistView(v){histView=v;expandedChip=null;renderHistory();}

/* ─── WEEK VIEW ─── */
function renderWeekView(){
  const wrap=document.getElementById('week-section');
  const ws=getWeekStart(weekOffset);
  const we=new Date(ws); we.setDate(ws.getDate()+6);
  const today=todayISO();
  const DOW_S=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const weekDays=Array.from({length:7},(_,i)=>{const d=new Date(ws);d.setDate(ws.getDate()+i);return isoFromDate(d);});

  // Build session map
  const byDate={};
  sessions.forEach(s=>{if(!byDate[s.date])byDate[s.date]=[];byDate[s.date].push(s);});

  // Range label
  const fmtShort=iso=>{const d=new Date(iso+'T12:00:00');return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});};
  const rangeLabel=`${fmtShort(weekDays[0])} – ${fmtShort(weekDays[6])}`;

  // Auto-select: prefer today if in week, else last day with session, else Monday
  if(!weekSelectedDate||!weekDays.includes(weekSelectedDate)){
    weekSelectedDate=weekDays.includes(today)?today:(weekDays.slice().reverse().find(d=>byDate[d]?.length)||weekDays[0]);
  }

  // 7-day strip
  const strip=weekDays.map((iso,i)=>{
    const ss=byDate[iso]||[];
    const hasSess=ss.length>0;
    const isToday=iso===today;
    const isSel=iso===weekSelectedDate;
    const isFuture=iso>today;
    const dayNum=parseInt(iso.split('-')[2]);
    const exCount=ss.reduce((a,s)=>a+s.exercises.length,0);
    let cls='week-day-cell';
    if(hasSess)cls+=' has-session';
    if(isToday)cls+=' is-today';
    if(isSel)cls+=' is-selected';
    const sub=hasSess?`<span class="wdc-sub">${exCount}ex</span>`:isFuture?`<span class="wdc-sub"> </span>`:`<span class="wdc-sub rest">·</span>`;
    return`<div class="${cls}" onclick="weekSelectDay('${iso}')">
      <span class="wdc-label">${DOW_S[i]}</span>
      <div class="wdc-bubble">${dayNum}</div>
      ${sub}
    </div>`;
  }).join('');

  // Week summary
  const wSessions=weekDays.flatMap(d=>byDate[d]||[]);
  const wDaysWorked=weekDays.filter(d=>byDate[d]?.length).length;
  const wExCount=wSessions.reduce((a,s)=>a+s.exercises.length,0);
  const wVol=wSessions.reduce((a,s)=>a+s.exercises.reduce((b,ex)=>{
    if(normalizeWeightType(ex.weightType)==='level') return b;
    const reps=(ex.repsLog||[]).reduce((c,r)=>c+(r>0?r:0),0);
    return b+(ex.weight||0)*reps;
  },0),0);
  const volStr=wVol>=1000?`${(wVol/1000).toFixed(1)}k`:`${Math.round(wVol)}`;
  const wCalories=Math.round(wSessions.reduce((a,s)=>a+sessionTotalCal(s),0));
  const wCalStr=wCalories>=1000?`${(wCalories/1000).toFixed(1)}k`:`${wCalories}`;

  // Selected day detail
  const selSessions=byDate[weekSelectedDate]||[];
  const effortLabels=EFFORT_LABELS;
  const effortColors=EFFORT_COLORS;
  let detailHtml=`<div class="week-detail">
    <div class="week-detail-hdr">
      <span class="wdh-dow">${dotw(weekSelectedDate)}</span>
      <span class="wdh-date">${fmtDate(weekSelectedDate)}</span>
    </div>`;

  if(!selSessions.length){
    detailHtml+=`<div class="wdh-rest">Rest day — no workout logged.</div>`;
  } else {
    selSessions.forEach(s=>{
      // Meta row
      const metaParts=[];
      if(s.effort)metaParts.push(`<span class="wsm-badge" style="color:${effortColors[s.effort]}">${effortLabels[s.effort]}</span>`);
      if(s.duration)metaParts.push(`<span class="wsm-stat">⏱ ${esc(s.duration)}</span>`);
      if(sessionTotalCal(s))metaParts.push(`<span class="wsm-stat">${fmtCalFull(s)}</span>`);
      const fmtT=iso=>{if(!iso)return null;return new Date(iso).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});};
      const ts=fmtT(s.startedAt);
      if(ts)metaParts.push(`<span class="wsm-stat">🕐 ${ts}</span>`);
      if(metaParts.length)detailHtml+=`<div class="week-sess-meta">${metaParts.join('')}</div>`;

      // Cardio chip
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

      // Exercise chips — tappable to expand set detail
      detailHtml+=`<div class="week-ex-chips">`;
      (s.exercises||[]).forEach((ex,ei)=>{
        const chipKey=`${s.id}::${ei}`;
        const isExp=expandedChip===chipKey;
        const pills=ex.repsLog.map((r,si2)=>`<span class="wec-set-pill">Set ${si2+1}: ${fmtWt(ex.weight,false,ex.weightType)} × ${r}</span>`).join('');
        detailHtml+=`
          <div class="week-ex-chip${isExp?' expanded':''}" onclick="toggleChip('${chipKey}')">
            <div class="wec-top">
              <div class="wec-info">
                <div class="wec-name">${esc(ex.name)}</div>
                <div class="wec-sub">${esc(ex.group)} · ${esc(ex.scheme)}</div>
              </div>
              <div class="wec-right">
                <span class="wec-wt">${fmtWt(ex.weight,false,ex.weightType)}</span>
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
      <div class="week-sum-item"><span class="week-sum-val">${volStr}</span><span class="week-sum-lbl">Vol ${cfg.profile.weightUnit==='kg'?'kg':'lb'}</span></div>
      ${wCalories>0?`<div class="week-sum-item cal-item"><span class="week-sum-val" style="color:var(--accent);">🔥${wCalStr}</span><span class="week-sum-lbl">Cal</span></div>`:''}
    </div>
    ${detailHtml}`;
}
function weekNav(d){weekOffset+=d;weekSelectedDate=null;expandedChip=null;renderWeekView();}
function weekGoToday(){weekOffset=0;weekSelectedDate=todayISO();expandedChip=null;renderWeekView();}
function weekSelectDay(iso){
  weekSelectedDate=(weekSelectedDate===iso)?null:iso;
  if(!weekSelectedDate)weekSelectedDate=iso; // always keep one selected
  expandedChip=null;
  renderWeekView();
  setTimeout(()=>{const el=document.querySelector('.week-detail');if(el)el.scrollIntoView({behavior:'smooth',block:'nearest'});},60);
}
function toggleChip(key){expandedChip=(expandedChip===key)?null:key;renderWeekView();}

/* ─── MONTH VIEW ─── */
function renderMonthView(){
  const calSec=document.getElementById('cal-section');
  const md=getCalMonthDate();
  const year=md.getFullYear(), month=md.getMonth();
  const monthName=md.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const today=todayISO();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const firstDow=new Date(year,month,1).getDay();
  const sessionsByDate={};
  sessions.forEach(s=>{if(!sessionsByDate[s.date])sessionsByDate[s.date]=[];sessionsByDate[s.date].push(s);});
  const DOW=['Su','Mo','Tu','We','Th','Fr','Sa'];
  const dowHdr=DOW.map(d=>`<div class="cal-dow">${d}</div>`).join('');
  let cells='';
  for(let i=0;i<firstDow;i++)cells+=`<div class="cal-day cal-empty"></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const iso=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const daySessions=sessionsByDate[iso]||[];
    const hasSession=daySessions.length>0;
    const isToday=iso===today;
    const isFuture=iso>today;
    const isSelected=calSelectedDate===iso;
    let cls='cal-day';
    if(isToday)cls+=' cal-today';
    if(isFuture)cls+=' cal-future';
    if(hasSession)cls+=' cal-has-session';
    if(isSelected)cls+=' cal-selected';
    const dot=hasSession?`<div class="cal-day-dot${daySessions.length>1?' multi':''}"></div>`:'';
    const cnt=daySessions.length>1?`<div class="cal-day-count">${daySessions.length}</div>`:'';
    cells+=`<div class="${cls}" onclick="calSelectDay('${iso}')"><span class="cal-day-num">${d}</span>${dot}${cnt}</div>`;
  }
  const monthSessions=sessions.filter(s=>s.date.startsWith(`${year}-${String(month+1).padStart(2,'0')}`));
  const monthDays=new Set(monthSessions.map(s=>s.date)).size;
  const monthExCount=monthSessions.reduce((a,s)=>a+s.exercises.length,0);
  const monthCalories=Math.round(monthSessions.reduce((a,s)=>a+sessionTotalCal(s),0));
  const monthCalStr=monthCalories>=1000?`${(monthCalories/1000).toFixed(1)}k`:`${monthCalories}`;
  const effortLabels=EFFORT_LABELS;
  const effortColors=EFFORT_COLORS;
  let detailHtml='';
  if(calSelectedDate){
    const daySessions=sessionsByDate[calSelectedDate]||[];
    if(!daySessions.length){
      detailHtml=`<div class="cal-detail" id="cal-detail">
        <div class="cal-detail-hdr">
          <div><div class="cal-detail-date">${dotw(calSelectedDate)}</div>
          <div class="cal-detail-meta">${fmtDate(calSelectedDate)}</div></div>
          <button class="cal-detail-close" onclick="calSelectDay('${calSelectedDate}')">×</button>
        </div>
        <div class="cal-detail-empty">No workout logged</div>
      </div>`;
    } else {
      daySessions.forEach(s=>{
        const exRows=(s.exercises||[]).map(ex=>`
          <div class="h-ex-row">
            <div><div class="h-ex-name">${esc(ex.name)}</div><div class="h-ex-grp">${esc(ex.group)}</div></div>
            <div class="h-ex-r">
              <div class="h-ex-wt">${fmtWt(ex.weight,false,ex.weightType)}</div>
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
        const badge=s.effort?`<span class="h-badge" style="color:${effortColors[s.effort]}">${effortLabels[s.effort]}</span>`:'';
        const ftParts=[];
        if(s.duration)ftParts.push(`<div class="h-fi">⏱ <span class="h-fv">${esc(s.duration)}</span></div>`);
        if(sessionTotalCal(s))ftParts.push(`<div class="h-fi"><span class="h-fv">${fmtCalFull(s)}</span></div>`);
        const footer=ftParts.length?`<div class="h-footer">${ftParts.join('')}</div>`:'';
        detailHtml+=`<div class="cal-detail" id="cal-detail">
          <div class="cal-detail-hdr">
            <div><div class="cal-detail-date">${dotw(calSelectedDate)}, ${fmtDate(calSelectedDate)}</div>
            <div class="cal-detail-meta">${(s.exercises||[]).length} exercises${s.cardio&&s.cardio.machine?' · cardio':''}</div></div>
            <div style="display:flex;gap:6px;align-items:center;">${badge}
              <button class="sess-export-btn" title="Export session as PNG" onclick="exportSessionCard('${s.id}')">⬇</button>
              <button class="cal-detail-close" onclick="calSelectDay('${calSelectedDate}')">×</button>
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

/* ─── LIST VIEW ─── */
function setHistFilter(key,val){
  histFilter[key]=val;
  renderListView();
}
function renderListView(){
  const histWrap=document.getElementById('hist-wrap');
  const effortLabels=EFFORT_LABELS;
  const effortColors=EFFORT_COLORS;
  if(!sessions.length){
    histWrap.innerHTML=`<div class="empty-state-card">
      <span class="es-icon">📋</span>
      <div class="es-title">NO SESSIONS YET</div>
      <div class="es-sub">Complete your first workout to see it here</div>
      <button class="es-cta" onclick="switchTab('generate')">Build a Workout</button>
      <button class="es-secondary" onclick="openManualEntry()">+ Log Past Session</button>
    </div>`;
    return;
  }
  // Build filter bar
  const effortOpts=[['All',0],['Easy',1],['Good',2],['Hard',3],['Max',4]];
  const effortPills=effortOpts.map(([lbl,v])=>`<button class="hf-pill${histFilter.effort===v?' active':''}" onclick="setHistFilter('effort',${v})">${lbl}</button>`).join('');
  const allGroups=[...new Set(sessions.flatMap(s=>(s.exercises||[]).map(e=>e.group).filter(Boolean)))].sort();
  const groupOpts=['<option value="">All groups</option>',...allGroups.map(g=>`<option value="${esc(g)}"${histFilter.group===g?' selected':''}>${esc(g)}</option>`)].join('');
  const isFiltered=histFilter.effort!==0||histFilter.group!=='';
  const filterBar=`<div class="hist-filter-bar">
    <div class="hf-row"><div class="hf-pills">${effortPills}</div>
      <select class="hf-grp-sel" onchange="setHistFilter('group',this.value)">${groupOpts}</select>
      ${isFiltered?`<button class="hf-clear" onclick="histFilter={effort:0,group:''};renderListView()">✕ Clear</button>`:''}
    </div>
  </div>`;
  // Apply filters
  const filtered=sessions.filter(s=>{
    if(histFilter.effort&&s.effort!==histFilter.effort)return false;
    if(histFilter.group&&!(s.exercises||[]).some(e=>e.group===histFilter.group))return false;
    return true;
  });
  const listTotalCal=Math.round(filtered.reduce((a,s)=>a+sessionTotalCal(s),0));
  const calLabel=listTotalCal>0?` · 🔥${listTotalCal>=1000?(listTotalCal/1000).toFixed(1)+'k':listTotalCal} cal`:'';
  const countLabel=isFiltered?`${filtered.length} / ${sessions.length} sessions`:
    `${sessions.length} session${sessions.length!==1?'s':''}`;
  const toolbar=`<div class="hist-toolbar">
    <span class="hist-count">${countLabel}${calLabel}</span>
    <div style="display:flex;gap:7px;">
      <button class="hist-clear-btn accent" onclick="openManualEntry()">+ Log Past</button>
      <button class="hist-clear-btn" onclick="clearHistory()">Clear History</button>
    </div>
  </div>`;
  const rows=filtered.map((s,si)=>{
    const badge=s.effort?`<span class="h-badge" style="color:${effortColors[s.effort]}">${effortLabels[s.effort]}</span>`:'';
    const exRows=(s.exercises||[]).map(ex=>`
      <div class="h-ex-row">
        <div><div class="h-ex-name">${esc(ex.name)}</div><div class="h-ex-grp">${esc(ex.group)}</div></div>
        <div class="h-ex-r">
          <div class="h-ex-wt">${fmtWt(ex.weight,false,ex.weightType)}</div>
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
function toggleHist(si){const b=document.getElementById('hb-'+si),c=document.getElementById('hc-'+si);b.classList.toggle('open');c.classList.toggle('open',b.classList.contains('open'));}
function _commitPendingDelete(){
  if(!_pendingDelete)return;
  clearTimeout(_pendingDelete.t);
  sv('fj_sessions',sessions);
  rebuildStats();
  _pendingDelete=null;
}
function deleteSession(id){
  // Commit any prior pending delete before starting a new one
  _commitPendingDelete();
  const removed=sessions.find(s=>String(s.id)===String(id));
  if(!removed)return;
  sessions=sessions.filter(s=>String(s.id)!==String(id));
  renderHistory();
  _pendingDelete={session:removed,t:setTimeout(()=>{
    _pendingDelete=null;
    sv('fj_sessions',sessions);
    rebuildStats();
  },5000)};
  toastHtml(`Session removed &nbsp;<span style="font-weight:700;color:var(--accent);cursor:pointer;text-decoration:underline;" onclick="undoDelete()">Undo</span>`,5200);
}
function undoDelete(){
  if(!_pendingDelete)return;
  clearTimeout(_pendingDelete.t);
  const s=_pendingDelete.session;
  _pendingDelete=null;
  sessions.push(s);
  sessions.sort((a,b)=>b.id-a.id);
  renderHistory();
  toast('Session restored');
}
function rebuildStats(){
  const s={total:0,exercises:{},weightHistory:{},totalReps:{},prs:{}};
  // Process in chronological order so PR reflects the most-recent best, not just any order
  const ordered=[...sessions].reverse();
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
  stats=s;
  sv('fj_stats',stats);
}
function clearHistory(){
  const root=document.getElementById('modal-root');
  root.innerHTML=`<div class="modal-overlay" onclick="if(event.target===this)document.getElementById('modal-root').innerHTML=''">
    <div class="modal" onclick="event.stopPropagation()" style="max-height:60vh;">
      <div class="modal-hdr">
        <span class="modal-title" style="color:#ef4444;">⚠ CLEAR HISTORY</span>
        <button class="modal-close" onclick="document.getElementById('modal-root').innerHTML=''">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--j-txt2);line-height:1.6;margin-bottom:16px;">
          This will permanently delete all <strong>${sessions.length} session${sessions.length!==1?'s':''}</strong> and rebuild stats from scratch. Your exercise pool and settings will remain untouched.
        </p>
        <p style="font-size:12px;color:var(--j-mut);margin-bottom:10px;">Type <strong>DELETE</strong> to confirm:</p>
        <input class="me-inp" id="clear-hist-confirm" type="text" placeholder="DELETE" style="width:100%;margin-bottom:16px;" oninput="document.getElementById('clear-hist-go').disabled=this.value!=='DELETE'">
        <button class="me-save-btn" id="clear-hist-go" disabled style="background:#ef4444;opacity:.5;cursor:not-allowed;"
          onclick="if(document.getElementById('clear-hist-confirm').value==='DELETE'){document.getElementById('modal-root').innerHTML='';_doClearHistory();}">
          Permanently Delete History
        </button>
      </div>
    </div>
  </div>`;
  const btn=document.getElementById('clear-hist-go');
  document.getElementById('clear-hist-confirm').addEventListener('input',function(){
    btn.style.opacity=this.value==='DELETE'?'1':'.5';
    btn.style.cursor=this.value==='DELETE'?'pointer':'not-allowed';
  });
}
async function _doClearHistory(){
  sessions=[];sv('fj_sessions',sessions);
  rebuildStats();
  if(gistCfg.pat){try{await gistPush(gistCfg, buildPayload());}catch(e){}}
  toast('History cleared');renderHistory();
}

/* ── EDIT SESSION ── */
let editSessionData=null;
function openEditSession(id){
  const sess=sessions.find(s=>String(s.id)===String(id));
  if(!sess)return;
  editSessionData=JSON.parse(JSON.stringify(sess)); // deep copy
  renderEditModal();
}
function renderEditModal(){
  const root=document.getElementById('modal-root');
  const s=editSessionData;
  const effortLabels=EFFORT_LABELS;
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
            <option value="standard"${normalizeWeightType(ex.weightType)==='standard'?' selected':''}>LBS${cfg.profile&&cfg.profile.weightUnit==='kg'?'/KG':''}</option>
            <option value="level"${normalizeWeightType(ex.weightType)==='level'?' selected':''}>Level</option>
            <option value="bodyweight"${normalizeWeightType(ex.weightType)==='bodyweight'?' selected':''}>Bodyweight</option>
          </select>
        </div>
        <div class="me-field"><span class="me-field-lbl">${normalizeWeightType(ex.weightType)==='bodyweight'?'Extra Wt':wtTypeLabel(ex)}</span>
          <input class="me-inp me-inp-sm" type="number" inputmode="${normalizeWeightType(ex.weightType)==='level'?'numeric':'decimal'}"
            step="${normalizeWeightType(ex.weightType)==='level'?'1':'any'}" value="${ex.weight||0}" placeholder="${normalizeWeightType(ex.weightType)==='bodyweight'?'0':''}"
            onchange="editSessionData.exercises[${i}].weight=${normalizeWeightType(ex.weightType)==='level'?'parseInt':'parseFloat'}(this.value)||0">
        </div>
        <div class="me-field"><span class="me-field-lbl">Scheme</span>
          <select class="me-inp" onchange="editSetScheme(${i},this.value)">
            ${getSchemes().map(sc=>`<option${ex.scheme===sc?' selected':''}>${sc}</option>`).join('')}
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
          const machGrid=machines.map(m=>`
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
              ${[1,2,3,4].map(n=>`<button class="eff-btn${s.effort===n?' e'+n:''}" onclick="editSessionData.effort=${n};renderEditModal()">${effortLabels[n]}</button>`).join('')}
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
function editSelMachine(id){
  if(!editSessionData.cardio)editSessionData.cardio={machine:null,duration:'',metric:'',calories:'',program:''};
  editSessionData.cardio.machine=id;
  renderEditModal();
}
function editClearCardio(){
  editSessionData.cardio={machine:null,duration:'',metric:'',calories:'',program:''};
  renderEditModal();
}
function deleteEditSession(){
  if(!confirm('Delete this session? This cannot be undone.'))return;
  const idx=sessions.findIndex(s=>String(s.id)===String(editSessionData.id));
  if(idx===-1){toast('Session not found');return;}
  sessions.splice(idx,1);
  sv('fj_sessions',sessions);
  rebuildStats();
  document.getElementById('modal-root').innerHTML='';
  toast('Session deleted');
  renderHistory();
  if(gistCfg.pat){setSyncStatus('syncing');gistPush(gistCfg, buildPayload()).then(()=>setSyncStatus('synced')).catch(()=>setSyncStatus('error'));}
}
function editRemoveEx(i){editSessionData.exercises.splice(i,1);renderEditModal();}
function editAddEx(){
  const gmap=getGroupExerciseMap();
  const g=gmap[0]||{name:'General',exercises:[]};
  const exName=g.exercises[0]||'Unnamed';
  editSessionData.exercises.push({name:exName,group:g.name,scheme:'3×10',weight:0,weightType:'standard',repsLog:[10,10,10],arrow:'eq'});
  renderEditModal();
  setTimeout(()=>{const m=document.querySelector('.modal');if(m)m.scrollTop=m.scrollHeight;},50);
}
function editSetScheme(i,val){
  const{sets,reps}=parseScheme(val);
  editSessionData.exercises[i].scheme=val;
  editSessionData.exercises[i].repsLog=Array(sets).fill(reps);
  renderEditModal();
}
function closeEditModal(event){
  if(event&&event.target!==event.currentTarget)return;
  document.getElementById('modal-root').innerHTML='';
}
async function saveEditSession(){
  const dateEl=document.getElementById('edit-date');
  const notesEl=document.getElementById('edit-notes');
  const durEl=document.getElementById('edit-duration');
  const idx=sessions.findIndex(s=>String(s.id)===String(editSessionData.id));
  if(idx===-1){toast('Session not found');return;}
  const newDate=dateEl?dateEl.value.trim():editSessionData.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(newDate)){toast('Invalid date format');return;}
  if(newDate>todayISO()){toast('Date cannot be in the future');return;}
  editSessionData.date=newDate;
  editSessionData.notes=notesEl?notesEl.value:editSessionData.notes;
  editSessionData.duration=durEl?durEl.value:editSessionData.duration;
  sessions[idx]=editSessionData;
  sessions.sort((a,b)=>b.date.localeCompare(a.date));
  sv('fj_sessions',sessions);
  rebuildStats();
  document.getElementById('modal-root').innerHTML='';
  toast('Session updated ✓');
  renderHistory();
  if(gistCfg.pat){setSyncStatus('syncing');try{await gistPush(gistCfg, buildPayload());setSyncStatus('synced');}catch(e){setSyncStatus('error');}}
}

/* ═══════════════════════════════════════════
   SETTINGS
═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   GAMIFICATION
═══════════════════════════════════════════ */
let gamification=ld('fj_gamification',DEF_GAMIFICATION);
if(!gamification.earnedBadges)gamification.earnedBadges=[];
if(!gamification.unlockedItems)gamification.unlockedItems=[];

const LEVEL_THRESHOLDS=(()=>{
  const t=[0];
  for(let i=0;i<4;i++)t.push(t[t.length-1]+120);   // Recruit: Lv 2–5
  for(let i=0;i<10;i++)t.push(t[t.length-1]+240);  // Iron:    Lv 6–15
  for(let i=0;i<15;i++)t.push(t[t.length-1]+600);  // Steel:   Lv 16–30
  for(let i=0;i<15;i++)t.push(t[t.length-1]+1200); // Forge:   Lv 31–45
  for(let i=0;i<5;i++)t.push(t[t.length-1]+3000);  // Legend:  Lv 46–50
  return t;
})();

function xpToLevel(xp){
  let lv=1;
  for(let i=1;i<LEVEL_THRESHOLDS.length;i++){if(xp>=LEVEL_THRESHOLDS[i])lv=i+1;else break;}
  return Math.min(lv,50);
}
function getLevelProgress(xp,level){
  const idx=level-1;
  const curr=LEVEL_THRESHOLDS[idx]||0;
  const next=LEVEL_THRESHOLDS[idx+1];
  if(!next)return{pct:100,xpInLevel:0,xpNeeded:0};
  const inLevel=xp-curr;const needed=next-curr;
  return{pct:Math.round(inLevel/needed*100),inLevel,needed};
}
function getTier(level){
  if(level<=5)return{name:'RECRUIT',idx:0};
  if(level<=15)return{name:'IRON',idx:1};
  if(level<=30)return{name:'STEEL',idx:2};
  if(level<=45)return{name:'FORGE',idx:3};
  return{name:'LEGEND',idx:4};
}

const ARCHETYPES={
  iron_titan:{name:'Iron Titan',icon:'⚔️',tagline:'You lift heavy and push hard. PRs are your currency.'},
  volume_engine:{name:'Volume Engine',icon:'🔩',tagline:'You outwork everyone. Volume is your superpower.'},
  cardio_ghost:{name:'Cardio Ghost',icon:'💨',tagline:"You're built for distance. Endurance is your edge."},
  forge_athlete:{name:'Forge Athlete',icon:'🔥',tagline:'You do it all. No weakness, no skipped days.'},
};

const BADGES=[
  {id:'first_forge',name:'First Forge',icon:'🔨',tier:'bronze',desc:'Log your first session',hidden:false},
  {id:'week_warrior',name:'Week Warrior',icon:'📅',tier:'bronze',desc:'7-day streak',hidden:false},
  {id:'pr_breaker',name:'PR Breaker',icon:'💥',tier:'bronze',desc:'Set your first personal record',hidden:false},
  {id:'iron_mind',name:'Iron Mind',icon:'🧠',tier:'silver',desc:'30-day streak',hidden:false},
  {id:'centurion',name:'Centurion',icon:'💯',tier:'silver',desc:'100 sessions logged',hidden:false},
  {id:'pr_machine',name:'PR Machine',icon:'🏆',tier:'silver',desc:'Set 25 total PRs',hidden:false},
  {id:'max_out',name:'Max Out',icon:'🔴',tier:'silver',desc:'10 Max-effort sessions',hidden:false},
  {id:'volume_freak',name:'Volume Freak',icon:'📦',tier:'gold',desc:'50,000 total reps logged',hidden:false},
  {id:'forge_elite',name:'Forge Elite',icon:'⚡',tier:'gold',desc:'Reach Level 30',hidden:false},
  {id:'savage_mode',name:'Savage Mode',icon:'💀',tier:'gold',desc:'Max effort + 3 PRs in one session',hidden:false},
  {id:'unstoppable',name:'Unstoppable',icon:'🌊',tier:'platinum',desc:'90-day streak',hidden:false},
  {id:'living_legend',name:'Living Legend',icon:'👑',tier:'platinum',desc:'Reach Level 50',hidden:false},
  {id:'long_haul',name:'Long Haul',icon:'⏳',tier:'silver',desc:'Session over 2 hours',hidden:true},
  {id:'night_iron',name:'Night Iron',icon:'🌙',tier:'gold',desc:'Log a session midnight–4am',hidden:true},
  {id:'mirror_match',name:'Mirror Match',icon:'🪞',tier:'bronze',desc:'Log the exact same workout as a previous session',hidden:true},
];

function calcBuild(){
  if(!stats||stats.total<3)return null;
  // PWR: top PR vs body weight
  let pwr=0;
  const prVals=Object.values(stats.prs||{}).map(p=>p.weight).filter(w=>w>0);
  if(prVals.length>0){
    const topPR=Math.max(...prVals);
    const bwLbs=cfg.profile?.weightUnit==='kg'?(parseFloat(cfg.profile?.weight)||68)*2.20462:(parseFloat(cfg.profile?.weight)||150);
    pwr=Math.min(100,Math.round((topPR/bwLbs)*35));
  }
  // VOL: total lifetime reps (log scale)
  const totalReps=Object.values(stats.totalReps||{}).reduce((a,b)=>a+b,0);
  const vol=Math.min(100,Math.max(0,Math.round((Math.log10(Math.max(10,totalReps))-1)*20)));
  // END: cardio ratio + avg session duration
  const cardioSess=sessions.filter(s=>s.cardio&&s.cardio.machine).length;
  const totalDur=sessions.reduce((a,s)=>a+parseDurationMin(s.duration||''),0);
  const avgDur=sessions.length>0?totalDur/sessions.length:0;
  const end=Math.min(100,Math.round(Math.min(50,cardioSess*0.6)+Math.min(50,avgDur*0.8)));
  // GRN: avg effort × total sessions
  const effortSess=sessions.filter(s=>s.effort);
  const avgEffort=effortSess.length>0?effortSess.reduce((a,s)=>a+s.effort,0)/effortSess.length:2;
  const grn=Math.min(100,Math.round((avgEffort/4)*50+Math.min(50,stats.total*0.5)));
  // CNS: streak + sessions per week
  const streaks=computeStreaks();
  const msRange=sessions.length>1?Math.max(1,Math.ceil((new Date(sessions[0].date)-new Date(sessions[sessions.length-1].date))/(7*24*60*60*1000))):1;
  const freq=sessions.length/msRange;
  const streakMult=({daily:0.55,weekly:1.9,monthly:8})[cfg.streakMode||'weekly']||1.9;
  const cns=Math.min(100,Math.round(Math.min(50,freq*12)+Math.min(50,streaks.longest*streakMult)));
  const subStats={pwr,vol,end,grn,cns};
  // Archetype: cardio ghost if heavy cardio, iron titan if high PRs, volume engine if high reps, otherwise forge athlete
  const cardioRatio=cardioSess/Math.max(1,sessions.length);
  let archetype;
  if(cardioRatio>0.4&&end>35)archetype='cardio_ghost';
  else if(pwr>vol&&pwr>end&&pwr>=25)archetype='iron_titan';
  else if(vol>=pwr&&vol>=end&&vol>=30)archetype='volume_engine';
  else archetype='forge_athlete';
  return{archetype,subStats};
}

function checkBadges(session,newPRs){
  const newB=[];
  const earned=gamification.earnedBadges||[];
  function earn(id){if(!earned.includes(id)&&!newB.includes(id))newB.push(id);}
  if(stats.total>=1)earn('first_forge');
  if(newPRs&&newPRs.length>0)earn('pr_breaker');
  const streaks=computeStreaks();
  const [t1,t2,t3]=({daily:[7,30,90],weekly:[4,12,26],monthly:[3,6,12]})[cfg.streakMode||'weekly'];
  if(streaks.current>=t1)earn('week_warrior');
  if(streaks.current>=t2)earn('iron_mind');
  if(streaks.current>=t3)earn('unstoppable');
  if(stats.total>=100)earn('centurion');
  if(Object.keys(stats.prs||{}).length>=25)earn('pr_machine');
  const maxCount=sessions.filter(s=>s.effort===4).length;
  if(maxCount>=10)earn('max_out');
  const totalReps=Object.values(stats.totalReps||{}).reduce((a,b)=>a+b,0);
  if(totalReps>=50000)earn('volume_freak');
  if((gamification.level||1)>=30)earn('forge_elite');
  if(session.effort===4&&newPRs&&newPRs.length>=3)earn('savage_mode');
  if((gamification.level||1)>=50)earn('living_legend');
  // Hidden badges
  const durMin=parseDurationMin(session.duration||'');
  if(durMin>=120)earn('long_haul');
  if(session.savedAt){const h=new Date(session.savedAt).getHours();if(h>=0&&h<4)earn('night_iron');}
  if(sessions.length>=2){
    const cur=new Set(session.exercises.map(e=>e.name));
    const match=sessions.find(s=>s.id!==session.id&&s.exercises.length===session.exercises.length&&s.exercises.every(e=>cur.has(e.name)));
    if(match)earn('mirror_match');
  }
  return newB;
}

function processGamification(session,newPRs){
  if(!gamification)gamification=dc(DEF_GAMIFICATION);
  if(gamification.lastProcessedSession===session.id)return;
  gamification.lastProcessedSession=session.id;
  // XP
  let xp=50;
  const mults=[0,1.0,1.25,1.5,2.0];
  xp=Math.floor(xp*(mults[session.effort||1]||1.0));
  xp+=((newPRs&&newPRs.length)||0)*100;
  const streaks=computeStreaks();
  const [xpT1,xpT2]=({daily:[7,30],weekly:[4,12],monthly:[3,6]})[cfg.streakMode||'weekly'];
  if(streaks.current>=xpT2)xp+=250;
  else if(streaks.current>=xpT1)xp+=75;
  if(parseDurationMin(session.duration||'')>=90)xp+=50;
  // First session of the week bonus
  const sDate=new Date((session.date||todayISO())+'T12:00:00');
  const weekStart=new Date(sDate);weekStart.setDate(sDate.getDate()-sDate.getDay());weekStart.setHours(0,0,0,0);
  const weekPrev=sessions.filter(s=>s.id!==session.id&&new Date(s.date+'T12:00:00')>=weekStart&&new Date(s.date+'T12:00:00')<sDate);
  if(weekPrev.length===0)xp+=25;
  const prevLevel=gamification.level||1;
  gamification.xp=(gamification.xp||0)+xp;
  gamification.level=xpToLevel(gamification.xp);
  // Badges
  const newBadges=checkBadges(session,newPRs);
  newBadges.forEach(bid=>{if(!gamification.earnedBadges.includes(bid))gamification.earnedBadges.push(bid);});
  sv('fj_gamification',gamification);
  renderHeaderLevel();
  // Notifications
  const leveledUp=gamification.level>prevLevel;
  if(leveledUp){setTimeout(()=>showLevelUpModal(gamification.level),1800);}
  const delay=leveledUp?3500:1800;
  newBadges.forEach((bid,i)=>{
    const badge=BADGES.find(b=>b.id===bid);
    if(badge)setTimeout(()=>showBadgeToast(badge),delay+i*1400);
  });
  return{xpGained:xp,newBadges:newBadges.map(bid=>BADGES.find(b=>b.id===bid)).filter(Boolean),leveledUp,newLevel:gamification.level};
}

function migrateGamification(){
  // For existing users who have sessions but haven't run gamification yet
  if(gamification.xp>0||!sessions.length)return;
  let xp=0;
  sessions.forEach(s=>{
    const mults=[0,1.0,1.25,1.5,2.0];
    xp+=Math.floor(50*(mults[s.effort||1]||1.0));
    if(parseDurationMin(s.duration||'')>=90)xp+=50;
  });
  // Retroactive partial PR bonus (half rate — you didn't earn them in real-time)
  xp+=Object.keys(stats.prs||{}).length*50;
  // Streak milestone bonus
  const streaks=computeStreaks();
  const [mT1,mT2,mT3]=({daily:[7,30,90],weekly:[4,12,26],monthly:[3,6,12]})[cfg.streakMode||'weekly'];
  if(streaks.longest>=mT3)xp+=3000;
  else if(streaks.longest>=mT2)xp+=1000;
  else if(streaks.longest>=mT1)xp+=250;
  gamification.xp=xp;
  gamification.level=xpToLevel(xp);
  gamification.lastProcessedSession=sessions.length>0?sessions[0].id:-1;
  // Grant retroactive badges based on current stats
  const fakeSess={effort:sessions[0]?.effort||1,duration:sessions[0]?.duration||'60 min',savedAt:new Date().toISOString(),exercises:sessions[0]?.exercises||[]};
  const allPRs=Object.values(stats.prs||{}).map(p=>({name:'',weight:p.weight,prev:0}));
  const retroBadges=checkBadges(fakeSess,allPRs);
  gamification.earnedBadges=[...new Set([...gamification.earnedBadges,...retroBadges])];
  sv('fj_gamification',gamification);
}

function renderHeaderLevel(){
  const el=document.getElementById('hdr-level');if(!el)return;
  const showBadge=!cfg.gamificationPrefs||cfg.gamificationPrefs.showHeaderBadge!==false;
  el.style.display=showBadge?'':'none';
  if(!showBadge)return;
  const lv=gamification.level||1;
  const xp=gamification.xp||0;
  const tier=getTier(lv);
  const prog=getLevelProgress(xp,lv);
  el.innerHTML=`<span class="hdr-level-tier">${tier.name}</span><span class="hdr-level-num">LV ${lv}</span><div class="hdr-level-bar"><div class="hdr-level-fill" style="width:${prog.pct}%"></div></div>`;
}

function openProfileModal(){
  const root=document.getElementById('modal-root');
  const build=calcBuild();
  const lv=gamification.level||1;
  const xp=gamification.xp||0;
  const tier=getTier(lv);
  const prog=getLevelProgress(xp,lv);
  const archData=build?ARCHETYPES[build.archetype]:null;
  const ss=build?build.subStats:{pwr:0,vol:0,end:0,grn:0,cns:0};
  // Archetype card
  let archetypeHtml='';
  if(archData&&build){
    archetypeHtml=`<div class="archetype-card">
      <div class="archetype-top">
        <span class="archetype-icon">${archData.icon}</span>
        <div class="archetype-info">
          <div class="archetype-name">${archData.name}</div>
          <div class="archetype-tagline">${archData.tagline}</div>
        </div>
        <div class="archetype-level">
          <div class="archetype-lv-num">LV ${lv}</div>
          <div class="archetype-lv-tier">${tier.name}</div>
          <div class="archetype-xp">${xp.toLocaleString()} XP</div>
        </div>
      </div>
      ${(!cfg.gamificationPrefs||cfg.gamificationPrefs.showXPBar!==false)?`<div class="xp-bar"><div class="xp-fill" style="width:${prog.pct}%"></div></div><div class="xp-meta">${prog.inLevel} / ${prog.needed} XP to LV ${lv+1<51?lv+1:'MAX'}</div>`:''}

      <div class="substats">
        ${[['PWR',ss.pwr],['VOL',ss.vol],['END',ss.end],['GRN',ss.grn],['CNS',ss.cns]].map(([l,v])=>`<div class="substat-row"><span class="substat-lbl">${l}</span><div class="substat-bar"><div class="substat-fill" style="width:${v}%"></div></div><span class="substat-val">${v}</span></div>`).join('')}
      </div>
    </div>`;
  } else {
    archetypeHtml=`<div class="archetype-card" style="text-align:center;padding:24px 16px;">
      <div style="font-size:32px;margin-bottom:10px">⚙️</div>
      <div style="font-family:'Black Ops One',sans-serif;font-size:14px;letter-spacing:2px;color:var(--text2)">BUILD UNLOCKS AT 3 SESSIONS</div>
      <div style="font-size:11px;color:var(--text3);margin-top:6px;line-height:1.5">Keep training — your archetype is taking shape</div>
      ${(!cfg.gamificationPrefs||cfg.gamificationPrefs.showXPBar!==false)?`<div class="xp-bar" style="margin-top:14px"><div class="xp-fill" style="width:${prog.pct}%"></div></div><div class="xp-meta">LV ${lv} · ${tier.name} · ${xp.toLocaleString()} XP · ${prog.inLevel}/${prog.needed} to next level</div>`:''}
    </div>`;
  }
  // Badge grid
  const earnedIds=gamification.earnedBadges||[];
  const badgeHtml=BADGES.map(b=>{
    const isEarned=earnedIds.includes(b.id);
    const isHidden=b.hidden&&!isEarned;
    return `<div class="badge-item${isEarned?' earned':''}${isHidden?' hidden-badge':''}" onclick="showBadgeDetail('${b.id}')">
      <span class="badge-icon">${isHidden?'🔒':b.icon}</span>
      <span class="badge-name">${isHidden?'???':esc(b.name)}</span>
      <div class="badge-tier-dot tier-${b.tier}"></div>
    </div>`;
  }).join('');
  // Calling card data
  const prVals=Object.entries(stats.prs||{});
  let topPR={name:'—',weight:0,weightType:'standard'};
  if(prVals.length>0){const best=prVals.sort((a,b)=>b[1].weight-a[1].weight)[0];topPR={name:best[0].split('::')[1],weight:best[1].weight,weightType:best[1].weightType};}
  const streaks=computeStreaks();
  const cardArchIcon=archData?archData.icon:'❓';
  const cardArchName=archData?archData.name:'Unknown';
  const displayBadges=earnedIds.slice(-3).map(id=>BADGES.find(b=>b.id===id)).filter(Boolean);
  const cardStatColors={pwr:'#ef4444',vol:'#f59e0b',end:'#22c55e',grn:'#e8271f',cns:'#3b82f6'};
  const cardStatsHtml=[['PWR',ss.pwr,cardStatColors.pwr],['VOL',ss.vol,cardStatColors.vol],['END',ss.end,cardStatColors.end],['GRN',ss.grn,cardStatColors.grn],['CNS',ss.cns,cardStatColors.cns]].map(([l,v,c])=>`<div class="card-stat-row"><span class="card-stat-lbl">${l}</span><div class="card-stat-bar"><div class="card-stat-fill" style="width:${v}%;background:${c}"></div></div><span class="card-stat-val">${v}</span></div>`).join('');
  root.innerHTML=`<div class="profile-overlay" onclick="if(event.target===this)document.getElementById('modal-root').innerHTML=''">
  <div class="profile-sheet" onclick="event.stopPropagation()">
    <div class="profile-hdr">
      <span class="profile-hdr-title">PLAYER CARD</span>
      <button class="profile-close" onclick="document.getElementById('modal-root').innerHTML=''">×</button>
    </div>
    <div class="profile-body">
      ${archetypeHtml}
      <div class="gamif-section-title">ACCOLADES &nbsp;·&nbsp; ${earnedIds.length} / ${BADGES.length}</div>
      <div class="badge-grid">${badgeHtml}</div>
      <div class="gamif-section-title" style="margin-top:20px">CALLING CARD</div>
      <div class="calling-card-section">
        <div class="card-preview">
          <div class="card-accent-bar"></div>
          <div class="card-top-row">
            <div>
              <div class="card-archetype-name">${cardArchIcon} ${esc(cardArchName)}</div>
              <div class="card-archetype-tag">${esc(tier.name)}</div>
            </div>
            <div class="card-level-badge">LV ${lv}</div>
          </div>
          <div class="card-substats-row">${cardStatsHtml}</div>
          <div class="card-badges-row">${displayBadges.map(b=>`<span class="card-badge-icon" title="${esc(b.name)}">${b.icon}</span>`).join('')}${!displayBadges.length?`<span style="font-size:10px;color:#444">Earn badges to display here</span>`:''}</div>
          <div class="card-footer">
            <div class="card-footer-stat"><div class="card-footer-val">${stats.total||0}</div><div class="card-footer-lbl">Sessions</div></div>
            <div class="card-footer-stat"><div class="card-footer-val">${streaks.longest}</div><div class="card-footer-lbl">Best Streak</div></div>
            <div class="card-footer-stat"><div class="card-footer-val">${topPR.weight>0?fmtWt(topPR.weight,false,topPR.weightType):'—'}</div><div class="card-footer-lbl">Top PR</div></div>
          </div>
        </div>
        <button class="card-export-btn" onclick="exportCallingCard()">⬇ EXPORT CARD AS PNG</button>
      </div>
    </div>
  </div>
</div>`;
}

function exportCallingCard(){
  const build=calcBuild();
  const archData=build?ARCHETYPES[build.archetype]:null;
  const lv=gamification.level||1;
  const xp=gamification.xp||0;
  const tier=getTier(lv);
  const ss=build?build.subStats:{pwr:0,vol:0,end:0,grn:0,cns:0};
  const earnedIds=gamification.earnedBadges||[];
  const displayBadges=earnedIds.slice(-3).map(id=>BADGES.find(b=>b.id===id)).filter(Boolean);
  const prVals=Object.entries(stats.prs||{});
  let topPR={name:'—',weight:0,weightType:'standard'};
  if(prVals.length>0){const best=prVals.sort((a,b)=>b[1].weight-a[1].weight)[0];topPR={name:best[0].split('::')[1],weight:best[1].weight,weightType:best[1].weightType};}
  const streaks=computeStreaks();
  const prog=getLevelProgress(xp,lv);
  const W=360,H=520;
  const canvas=document.createElement('canvas');
  canvas.width=W*2;canvas.height=H*2;
  const ctx=canvas.getContext('2d');
  ctx.scale(2,2);
  // Background
  const bg=ctx.createLinearGradient(0,0,W,H);bg.addColorStop(0,'#0a0a0a');bg.addColorStop(1,'#1a1010');
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
  // Accent color from CSS variable
  const accentColor=getComputedStyle(document.body).getPropertyValue('--accent').trim()||'#e8271f';
  // Top accent bar
  const barGrad=ctx.createLinearGradient(0,0,W,0);barGrad.addColorStop(0,accentColor);barGrad.addColorStop(1,accentColor+'88');
  ctx.fillStyle=barGrad;ctx.fillRect(0,0,W,4);
  // Glow
  const radGrad=ctx.createRadialGradient(W,0,0,W,0,200);radGrad.addColorStop(0,accentColor+'25');radGrad.addColorStop(1,'transparent');
  ctx.fillStyle=radGrad;ctx.fillRect(0,0,W,H);
  // Archetype name + tagline
  ctx.font='bold 28px serif';ctx.fillStyle='#fff';ctx.fillText(archData?archData.icon:'❓',20,54);
  ctx.font='bold 15px Arial';ctx.fillStyle='#fff';ctx.fillText((archData?archData.name:'UNKNOWN').toUpperCase(),58,48);
  ctx.font='10px Arial';ctx.fillStyle='#888';ctx.fillText(archData?archData.tagline:'Log 3+ sessions to discover your build',58,64);
  // Level badge
  ctx.fillStyle=accentColor;_rrect(ctx,W-70,16,58,26,5);ctx.fill();
  ctx.font='bold 13px Arial';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText('LV '+lv,W-41,34);ctx.textAlign='left';
  // Tier + XP
  ctx.font='bold 9px Arial';ctx.fillStyle='#555';ctx.fillText(tier.name+' TIER',20,90);
  ctx.font='9px Arial';ctx.fillStyle='#444';ctx.textAlign='right';ctx.fillText(xp.toLocaleString()+' XP',W-20,90);ctx.textAlign='left';
  // XP bar
  ctx.fillStyle='#2a2a2a';_rrect(ctx,20,97,W-40,6,3);ctx.fill();
  ctx.fillStyle=accentColor;_rrect(ctx,20,97,Math.max(6,(W-40)*prog.pct/100),6,3);ctx.fill();
  // Stat bars
  const statDefs=[['PWR',ss.pwr,'#ef4444'],['VOL',ss.vol,'#f59e0b'],['END',ss.end,'#22c55e'],['GRN',ss.grn,accentColor],['CNS',ss.cns,'#3b82f6']];
  let sy=118;
  statDefs.forEach(([lbl,val,clr])=>{
    ctx.font='bold 8px Arial';ctx.fillStyle='#666';ctx.fillText(lbl,20,sy+7);
    ctx.fillStyle='#2a2a2a';_rrect(ctx,54,sy,W-96,8,4);ctx.fill();
    if(val>0){ctx.fillStyle=clr;_rrect(ctx,54,sy,(W-96)*val/100,8,4);ctx.fill();}
    ctx.font='bold 9px Arial';ctx.fillStyle='#777';ctx.textAlign='right';ctx.fillText(String(val),W-20,sy+8);ctx.textAlign='left';
    sy+=18;
  });
  // Divider
  sy+=6;ctx.fillStyle='#222';ctx.fillRect(20,sy,W-40,1);sy+=14;
  // Badge row
  if(displayBadges.length>0){
    ctx.font='22px serif';
    displayBadges.forEach((b,i)=>{ctx.fillText(b.icon,20+i*38,sy+22);});
    sy+=36;
  } else {
    ctx.font='10px Arial';ctx.fillStyle='#333';ctx.fillText('Earn accolades to show here',20,sy+14);sy+=22;
  }
  // Footer
  sy+=8;ctx.fillStyle='#1e1e1e';ctx.fillRect(20,sy,W-40,1);sy+=14;
  const footStats=[['SESSIONS',String(stats.total||0)],['BEST STREAK',String(streaks.longest)],['TOP PR',topPR.weight>0?fmtWt(topPR.weight,false,topPR.weightType):'—']];
  const colW=(W-40)/3;
  footStats.forEach(([label,val],i)=>{
    const cx=20+i*colW+colW/2;
    ctx.font='bold 14px Arial';ctx.fillStyle='#eee';ctx.textAlign='center';ctx.fillText(val,cx,sy+14);
    ctx.font='7px Arial';ctx.fillStyle='#444';ctx.fillText(label,cx,sy+25);
  });
  ctx.textAlign='left';
  // Watermark
  ctx.font='bold 8px Arial';ctx.fillStyle='#2a2a2a';ctx.letterSpacing='3px';
  ctx.fillText('FORGE FITNESS JOURNAL',20,H-12);
  // Download
  const a=document.createElement('a');a.download='forge-card.png';a.href=canvas.toDataURL('image/png');a.click();
  toast('Card exported ✓');
}
function exportSessionCard(id){
  const s=sessions.find(x=>String(x.id)===String(id));
  if(!s){toast('Session not found');return;}
  const accentColor=getComputedStyle(document.body).getPropertyValue('--accent').trim()||'#e8271f';
  const exList=s.exercises||[];
  const hasCardio=!!(s.cardio&&s.cardio.machine);
  const hasNotes=!!s.notes;
  const totalSets=exList.reduce((a,ex)=>a+(ex.repsLog||[]).length,0);
  const totCal=sessionTotalCal(s);

  // Determine which exercises set PRs in this session
  const sessionPRKeys=new Set();
  exList.forEach(ex=>{
    const k=(ex.group||'')+'::'+ex.name;
    const history=(stats.weightHistory||{})[k]||[];
    const priorMax=history.filter(h=>h.date<s.date).reduce((m,h)=>Math.max(m,h.weight||0),0);
    if((ex.weight||0)>0&&(ex.weight||0)>priorMax)sessionPRKeys.add(k);
  });

  const W=390;
  const PADX=24;
  const exRowH=42;
  // Pre-calculate total canvas height
  const H=Math.max(300,
    94                          // header (branding + day + date)
    +16+56+16                   // divider + stats row + divider
    +24                         // "EXERCISES" label
    +exList.length*exRowH       // exercise rows
    +(hasCardio?56:0)           // cardio block
    +(hasNotes?46:0)            // notes block
    +48                         // footer gap + divider + text + bottom pad
  );

  const canvas=document.createElement('canvas');
  canvas.width=W*2;canvas.height=H*2;
  const ctx=canvas.getContext('2d');
  ctx.scale(2,2);

  // === BACKGROUND ===
  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#0d0d0d');bg.addColorStop(1,'#0a0a12');
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);

  // Radial glow from top-right corner
  const radGrad=ctx.createRadialGradient(W,0,0,W,0,240);
  radGrad.addColorStop(0,accentColor+'18');radGrad.addColorStop(1,'transparent');
  ctx.fillStyle=radGrad;ctx.fillRect(0,0,W,H);

  // Top accent bar — gradient fading to transparent
  const barGrad=ctx.createLinearGradient(0,0,W,0);
  barGrad.addColorStop(0,accentColor);barGrad.addColorStop(0.55,accentColor+'99');barGrad.addColorStop(1,'transparent');
  ctx.fillStyle=barGrad;ctx.fillRect(0,0,W,5);

  // === HEADER ===
  // Subtle branding label
  ctx.font='700 8px Inter,Arial';ctx.fillStyle='#333';
  if(ctx.letterSpacing!==undefined)ctx.letterSpacing='3px';
  ctx.fillText('FORGE FITNESS JOURNAL',PADX,22);
  if(ctx.letterSpacing!==undefined)ctx.letterSpacing='0px';

  // Day of week — large
  ctx.font='bold 26px Inter,Arial';ctx.fillStyle='#f0f0f0';
  ctx.fillText(dotw(s.date).toUpperCase(),PADX,56);

  // Full date — subdued
  ctx.font='11px Inter,Arial';ctx.fillStyle='#4a4a4a';
  ctx.fillText(fmtDate(s.date),PADX,72);

  // Effort badge — pill, top right
  if(s.effort){
    const eLabel=EFFORT_LABELS[s.effort]||'';
    const eColor=EFFORT_COLORS[s.effort]||accentColor;
    ctx.font='bold 9px Inter,Arial';
    const tw=ctx.measureText(eLabel).width;
    const bW=tw+18;const bH=19;const bX=W-PADX-bW;const bY=44;
    ctx.fillStyle=eColor+'22';
    ctx.beginPath();ctx.roundRect?ctx.roundRect(bX,bY,bW,bH,9):ctx.rect(bX,bY,bW,bH);ctx.fill();
    ctx.strokeStyle=eColor+'77';ctx.lineWidth=0.75;
    ctx.beginPath();ctx.roundRect?ctx.roundRect(bX,bY,bW,bH,9):ctx.rect(bX,bY,bW,bH);ctx.stroke();
    ctx.fillStyle=eColor;ctx.textAlign='center';ctx.fillText(eLabel,bX+bW/2,bY+13);ctx.textAlign='left';
  }

  // === STATS ROW ===
  let sy=94;
  ctx.fillStyle='#1c1c1c';ctx.fillRect(PADX,sy,W-PADX*2,1);sy+=16;

  const statItems=[];
  statItems.push({val:String(exList.length),lbl:exList.length===1?'EXERCISE':'EXERCISES'});
  statItems.push({val:String(totalSets),lbl:totalSets===1?'SET':'SETS'});
  if(s.duration)statItems.push({val:s.duration,lbl:'DURATION'});
  if(totCal)statItems.push({val:(s.caloriesEst?'~':'')+totCal,lbl:'CALORIES'});

  const nStats=statItems.length;
  const statColW=(W-PADX*2)/nStats;
  statItems.forEach((st,i)=>{
    const cx=PADX+i*statColW+statColW/2;
    ctx.font='bold 16px Inter,Arial';ctx.fillStyle='#e8e8e8';ctx.textAlign='center';
    ctx.fillText(st.val,cx,sy+16);
    ctx.font='700 7px Inter,Arial';ctx.fillStyle='#3a3a3a';
    if(ctx.letterSpacing!==undefined)ctx.letterSpacing='1.5px';
    ctx.fillText(st.lbl,cx,sy+30);
    if(ctx.letterSpacing!==undefined)ctx.letterSpacing='0px';
    // Column separator (skip after last)
    if(i<nStats-1){ctx.fillStyle='#222';ctx.fillRect(PADX+i*statColW+statColW,sy+4,1,28);}
  });
  ctx.textAlign='left';
  sy+=56;

  ctx.fillStyle='#1c1c1c';ctx.fillRect(PADX,sy,W-PADX*2,1);sy+=16;

  // === EXERCISES SECTION LABEL ===
  ctx.font='700 8px Inter,Arial';ctx.fillStyle=accentColor;
  if(ctx.letterSpacing!==undefined)ctx.letterSpacing='2.5px';
  ctx.fillText('EXERCISES',PADX,sy+11);
  if(ctx.letterSpacing!==undefined)ctx.letterSpacing='0px';
  sy+=24;

  // === EXERCISE ROWS ===
  exList.forEach((ex,idx)=>{
    const k=(ex.group||'')+'::'+ex.name;
    const isPR=sessionPRKeys.has(k);
    const rowY=sy;

    // Subtle row stripe on even rows
    if(idx%2===0){
      ctx.fillStyle='#ffffff06';
      ctx.fillRect(PADX-8,rowY,W-PADX*2+16,exRowH);
    }

    // Exercise name
    ctx.font='600 12px Inter,Arial';ctx.fillStyle='#e0e0e0';
    ctx.fillText(ex.name,PADX,rowY+15);

    // PR pill
    if(isPR){
      const nameW=ctx.measureText(ex.name).width;
      const tX=PADX+nameW+7;const tY=rowY+3;const tW=20;const tH=13;
      ctx.fillStyle=accentColor;
      ctx.beginPath();ctx.roundRect?ctx.roundRect(tX,tY,tW,tH,3):ctx.rect(tX,tY,tW,tH);ctx.fill();
      ctx.font='bold 7px Inter,Arial';ctx.fillStyle='#000';
      ctx.textAlign='center';ctx.fillText('PR',tX+tW/2,tY+9);ctx.textAlign='left';
    }

    // Weight — accent, right-aligned
    const wtStr=fmtWt(ex.weight,false,ex.weightType);
    ctx.font='bold 13px Inter,Arial';ctx.fillStyle=accentColor;
    ctx.textAlign='right';ctx.fillText(wtStr,W-PADX,rowY+15);ctx.textAlign='left';

    // Scheme + reps — muted, second line
    const repsStr=(ex.repsLog||[]).join(', ');
    const detailStr=ex.scheme+(repsStr?' · '+repsStr:'');
    ctx.font='10px Inter,Arial';ctx.fillStyle='#404040';
    ctx.fillText(detailStr,PADX,rowY+30);

    // Row divider (skip last)
    if(idx<exList.length-1){
      ctx.fillStyle='#1e1e1e';ctx.fillRect(PADX,rowY+exRowH-1,W-PADX*2,1);
    }

    sy+=exRowH;
  });

  // === CARDIO BLOCK ===
  if(hasCardio){
    sy+=8;
    const blockH=42;
    ctx.fillStyle='#111116';
    ctx.beginPath();ctx.roundRect?ctx.roundRect(PADX-8,sy,W-PADX*2+16,blockH,6):ctx.rect(PADX-8,sy,W-PADX*2+16,blockH);ctx.fill();
    ctx.strokeStyle='#222';ctx.lineWidth=0.75;
    ctx.beginPath();ctx.roundRect?ctx.roundRect(PADX-8,sy,W-PADX*2+16,blockH,6):ctx.rect(PADX-8,sy,W-PADX*2+16,blockH);ctx.stroke();
    const m=machById(s.cardio.machine);
    const parts=[];
    if(s.cardio.program)parts.push(s.cardio.program);
    if(s.cardio.duration)parts.push(s.cardio.duration);
    if(s.cardio.metric)parts.push(s.cardio.metric+(m?' '+m.unit:''));
    if(s.cardio.calories)parts.push(parseFloat(s.cardio.calories)+' cal');
    ctx.font='bold 10px Inter,Arial';ctx.fillStyle='#bbb';
    ctx.fillText((m?m.icon+' ':'')+(m?m.name:'Cardio').toUpperCase(),PADX,sy+16);
    ctx.font='9px Inter,Arial';ctx.fillStyle='#4a4a4a';
    ctx.fillText(parts.join(' · '),PADX,sy+30);
    sy+=blockH+6;
  }

  // === NOTES BLOCK ===
  if(hasNotes){
    sy+=10;
    ctx.font='italic 10px Inter,Arial';ctx.fillStyle='#383838';
    const note='"'+s.notes+'"';
    ctx.fillText(note.length>72?note.slice(0,69)+'…"':note,PADX,sy+14);
    sy+=30;
  }

  // === FOOTER ===
  sy+=14;
  ctx.fillStyle='#1a1a1a';ctx.fillRect(PADX,sy,W-PADX*2,1);sy+=10;
  ctx.font='700 7px Inter,Arial';ctx.fillStyle='#272727';
  if(ctx.letterSpacing!==undefined)ctx.letterSpacing='3px';
  ctx.textAlign='center';ctx.fillText('FORGE FITNESS JOURNAL',W/2,sy+14);
  ctx.textAlign='left';
  if(ctx.letterSpacing!==undefined)ctx.letterSpacing='0px';

  // Download
  const datePart=s.date||'session';
  const a=document.createElement('a');a.download=`forge-session-${datePart}.png`;a.href=canvas.toDataURL('image/png');a.click();
  toast('Session exported ✓');
}
function _rrect(ctx,x,y,w,h,r){
  if(w<2*r)r=w/2;if(h<2*r)r=h/2;
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
}

function showBadgeToast(badge){
  const c={bronze:'#cd7f32',silver:'#94a3b8',gold:'#f59e0b',platinum:'#a5b4fc'}[badge.tier]||'var(--accent)';
  toastHtml(`<span style="font-size:16px">${badge.icon}</span>&nbsp;<span style="color:${c};font-weight:700">${esc(badge.name)}</span>&nbsp;<span style="color:var(--text2);font-size:10px">Unlocked!</span>`,3500);
}
function showBadgeDetail(id){
  const badge=BADGES.find(b=>b.id===id);if(!badge)return;
  const isEarned=(gamification.earnedBadges||[]).includes(id);
  const isHidden=badge.hidden&&!isEarned;
  const tierColors={bronze:'#cd7f32',silver:'#94a3b8',gold:'#f59e0b',platinum:'#a5b4fc'};
  const tierLabels={bronze:'Bronze',silver:'Silver',gold:'Gold',platinum:'Platinum'};
  const tc=tierColors[badge.tier]||'var(--text3)';
  const div=document.createElement('div');
  div.className='badge-detail-overlay';
  div.onclick=(e)=>{if(e.target===div)div.remove();};
  div.innerHTML=`<div class="badge-detail-sheet" onclick="event.stopPropagation()">
    <span class="badge-detail-icon">${isHidden?'🔒':badge.icon}</span>
    <div class="badge-detail-name">${isHidden?'???':esc(badge.name)}</div>
    <div class="badge-detail-tier">
      <div class="badge-tier-dot tier-${badge.tier}"></div>
      <span style="color:${tc}">${tierLabels[badge.tier]}</span>
    </div>
    <div class="badge-detail-desc">${isHidden?'Keep training — this one reveals itself when the time is right.':esc(badge.desc)}</div>
    <div class="badge-detail-status ${isEarned?'earned':'locked'}">${isEarned?'✓ Unlocked':'Locked'}</div>
    <button class="badge-detail-close" onclick="this.closest('.badge-detail-overlay').remove()">Close</button>
  </div>`;
  document.body.appendChild(div);
}

function showLevelUpModal(newLevel){
  const tier=getTier(newLevel);
  const div=document.createElement('div');
  div.id='levelup-overlay';div.className='levelup-overlay';
  div.innerHTML=`<div class="levelup-modal">
    <div class="levelup-icon">⚡</div>
    <div class="levelup-label">LEVEL UP</div>
    <div class="levelup-level">${newLevel}</div>
    <div class="levelup-tier">${tier.name}</div>
    <div class="levelup-desc">${esc(_getLevelDesc(newLevel,tier))}</div>
    <button class="levelup-close" onclick="document.getElementById('levelup-overlay').remove()">LET'S GO</button>
  </div>`;
  document.body.appendChild(div);
}
function _getLevelDesc(level,tier){
  if(level===5)return"Recruit complete. You're no longer a beginner.";
  if(level===6)return'Welcome to Iron. The real work begins here.';
  if(level===15)return'Iron mastered. Steel awaits.';
  if(level===16)return'Steel unlocked. You\'re building something real.';
  if(level===30)return'Forge Elite badge earned. You\'re in rare company.';
  if(level===31)return'Forge tier. You\'ve earned respect in this gym.';
  if(level===46)return'LEGEND tier. You are what others aspire to be.';
  if(level===50)return'Level 50. Living Legend. This is the peak.';
  if(tier.name==='IRON')return'The grind is paying off. Keep building.';
  if(tier.name==='STEEL')return'Steel-forged. This is consistency personified.';
  if(tier.name==='FORGE')return'Elite level. Your build speaks for itself.';
  if(tier.name==='LEGEND')return'A Living Legend in the making.';
  return'Keep pushing. The gym remembers.';
}

// ═══════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════
init().catch(err=>{
  const lmsg=document.getElementById('loading-msg');
  const lerr=document.getElementById('loading-err');
  const lerrmsg=document.getElementById('loading-err-msg');
  if(lmsg)lmsg.style.display='none';
  if(lerrmsg)lerrmsg.textContent='App failed to start: '+err.message;
  if(lerr)lerr.style.display='block';
  console.error('init() failed:',err);
});

// Expose functions to global scope for inline onclick="" handlers in HTML.
// This block is temporary and will be removed in Phase 4e when event delegation replaces inline handlers.
Object.assign(window, {
  // Navigation & core UI
  switchTab, continueOffline, manualSync,
  // Setup / Gist
  setupConnect, settGistPush, settGistPull, modalGistConnect,
  // Generate tab
  generate, setBuildMode, startWorkout, saveAsTemplate,
  openExercisePicker, togglePickerEx, togglePickerGroup, closePickerModal,
  cycleScheme, removeCustomEx, loadTemplate, deleteTemplate,
  // Today / workout logging
  renderToday, toggleDone, adjWt, setWt, cycleWeightType, openPlateCalc,
  setPlateBar, setEffort, saveWorkout, selMachine,
  startEditReps, commitReps, endAndSaveActive, discardActiveWorkout,
  // Timers
  clearRestTimer,
  // Summary
  closeSummaryModal,
  // History
  setHistView, weekSelectDay, weekNav, weekGoToday,
  calSelectDay, calNav, calGoToday, toggleChip,
  setHistFilter, openManualEntry, clearHistory, toggleHist, undoDelete,
  // Edit session
  closeEditModal, deleteEditSession, editAddEx, editRemoveEx,
  editSelMachine, editClearCardio, saveEditSession, editSetScheme,
  // Manual entry
  closeManualModal, addManualEx, removeManualEx,
  setManualExName, setManualGroup, setManualScheme, saveManualSession,
  // PRs (none needed)
  // Stats
  setStatTab,
  // Settings
  setSettTab, adjCfg, addScheme, removeScheme, adjNewScheme,
  setIncrement, setStreakMode, adjStreakGoal, setRestTimerEnabled, setRestDuration,
  toggleGroupActive, toggleGrp, toggleEx, addEx, deleteEx, saveExCue,
  adjRequired, addGroup, deleteGroup, setGroupMode, addMachine, deleteMachine,
  setProfileVal, setThemeBase, setCustomAccent, toggleForgePicker, resetAcc,
  setCardPref, setGamifPref,
  exportData, copyExportJson, closeExportModal, importData,
  exportDataAndDismiss, dismissBackupPrompt, nuclearReset, resetHistoryAndStats,
  _doNuclearReset, _doResetHistoryAndStats,
  // Gamification
  openProfileModal, showBadgeDetail, exportCallingCard, exportSessionCard,
});
