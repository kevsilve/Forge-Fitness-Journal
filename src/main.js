import './styles/index.css';
import { DEF_GROUPS, DEF_CFG, DEF_MACHINES, THEME_BASES, EFFORT_LABELS, EFFORT_COLORS, DEF_GAMIFICATION } from './constants.js';
import { dotw, fmtDate, todayISO, isoFromDate, getWeekStart, DAYS_OF_WEEK } from './utils/date.js';
import { dc, uid, esc, normalizeWeightType, pick, shuffle, parseScheme } from './utils/misc.js';
import { ld, sv } from './storage.js';
import { gistPull, gistPush } from './sync/gist.js';
import { supabase, isSupabaseEnabled, signInWithEmail, signOut, getSession, dbPull, dbPush, dbPushSession, dbDeleteSession, dbPushConfig, dbPushStats } from './sync/supabase.js';
import { sessionTotalCal } from './utils/misc.js';
import { renderPRs } from './views/prs.js';
import { renderStats, computeStreaks } from './views/stats.js';
import {
  initGamification, renderHeaderLevel, openProfileModal,
  exportCallingCard, exportSessionCard,
  showBadgeDetail, showBadgeToast, showLevelUpModal,
  processGamification, migrateGamification,
  BADGES, ARCHETYPES, LEVEL_THRESHOLDS, xpToLevel, getLevelProgress, getTier,
  calcBuild, checkBadges,
} from './gamification/ui.js';
import {
  initHistory, renderHistory, rebuildStats,
  setHistView, weekNav, weekGoToday, weekSelectDay, toggleChip,
  calNav, calGoToday, calSelectDay,
  setHistFilter, toggleHist, deleteSession, undoDelete, clearHistory, _doClearHistory,
  openEditSession, renderEditModal, editSelMachine, editClearCardio,
  deleteEditSession, editRemoveEx, editAddEx, editSetScheme,
  closeEditModal, saveEditSession,
} from './views/history.js';
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
  settGistPush, settGistPull, settDbPush, setSettMsg,
} from './views/settings/index.js';
import { initTimers, startRestTimer, clearRestTimer, clearLiveTimer, startLiveTimer, updateLiveTimer, updateStickyCalories, setRestTimerEnabled, setRestDuration } from './workout/timers.js';
import { initPlates, calcPlates, openPlateCalc, setPlateBar, renderPlates } from './workout/plates.js';
import { initSummary, showWorkoutSummary, closeSummaryModal } from './workout/summary.js';
import { initLog, renderToday, buildSetsArea, wtTypeLabel, updateTypeBadge, updatePRBadge, adjWt, setWt, cycleWeightType, toggleDone, startEditReps, commitReps, blurReps, checkExComplete, setEffort, selMachine } from './workout/log.js';
import { initSave, saveWorkout, flushStrength, flushCardio, flushFinish } from './workout/save.js';
import { initGenerate, generate, renderPending, renderGenStreakChip, renderTemplates, saveAsTemplate, loadTemplate, deleteTemplate, openExercisePicker, renderPickerGroups, togglePickerGroup, togglePickerEx, closePickerModal, cycleScheme, cycleSchemeSelect, removeCustomEx, repeatSession, renderActiveWorkoutBanner, discardActiveWorkout, endAndSaveActive, startWorkout, setBuildMode } from './workout/generate.js';
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

  // ── Supabase auth path ──────────────────────────────────────────────────────
  if(isSupabaseEnabled()){
    // Handle magic-link redirect (token in URL hash)
    if(window.location.hash.includes('access_token')){
      lmsg.textContent='Signing in…';
      await supabase.auth.getSession(); // Supabase processes the hash automatically
      window.history.replaceState(null,'',window.location.pathname);
    }
    const session=await getSession();
    if(!session){
      ls.style.display='none';
      document.getElementById('auth-screen').style.display='';
      // Subscribe to auth state changes so magic-link tab can advance
      supabase.auth.onAuthStateChange(async(event,s)=>{
        if(event==='SIGNED_IN'&&s){
          document.getElementById('auth-screen').style.display='none';
          ls.style.display='';
          lmsg.textContent='Loading your data…';
          await _syncFromSupabase(ls,lmsg,lspinner,lerr,lerrmsg);
        }
      });
      return;
    }
    await _syncFromSupabase(ls,lmsg,lspinner,lerr,lerrmsg);
    return;
  }

  // ── Legacy Gist path ────────────────────────────────────────────────────────
  if(!gistCfg.pat){ls.style.display='none';launchApp();return;}
  lmsg.textContent='Syncing from Gist…';setSyncStatus('syncing');
  try{
    const data=await gistPull(gistCfg);
    if(data&&data.version){
      const localSessions=ld('fj_sessions',[]);
      const gistSessions=data.sessions||[];
      if(gistSessions.length>0){
        const merged=Object.values(
          [...localSessions,...gistSessions].reduce((acc,s)=>{
            if(!acc[s.id]||s.savedAt>acc[s.id].savedAt)acc[s.id]=s;
            return acc;
          },{})
        ).sort((a,b)=>b.date.localeCompare(a.date));
        sessions=merged;sv('fj_sessions',sessions);data.sessions=sessions;
      }
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

async function _syncFromSupabase(ls,lmsg,lspinner,lerr,lerrmsg){
  lmsg.textContent='Loading your data…';setSyncStatus('syncing');
  try{
    const remote=await dbPull();
    if(remote){
      // Merge strategy: Supabase is source of truth for config; merge sessions by id
      const localSessions=ld('fj_sessions',[]);
      const remoteSessions=remote.sessions||[];
      const merged=Object.values(
        [...localSessions,...remoteSessions].reduce((acc,s)=>{
          if(!acc[s.id]||s.savedAt>acc[s.id].savedAt)acc[s.id]=s;
          return acc;
        },{})
      ).sort((a,b)=>b.date.localeCompare(a.date));
      const payload={
        cfg:remote.cfg||cfg,
        groups:remote.groups&&remote.groups.length?remote.groups:groups,
        machines:remote.machines&&remote.machines.length?remote.machines:machines,
        theme:remote.theme||theme,
        gamification:remote.gamification||gamification,
        sessions:merged,
        stats:remote.stats||stats,
        version:1,
      };
      applyPayload(payload);
    }
    // Push any locally-pending sessions that aren't in Supabase yet
    const pendingSync=JSON.parse(ld('fj_pending_sync','[]')||'[]');
    if(pendingSync.length){
      for(const sid of pendingSync){
        const s=sessions.find(x=>x.id===sid);
        if(s)await dbPushSession(s);
      }
      sv('fj_pending_sync','[]');
    }
    setSyncStatus('synced');ls.style.display='none';launchApp();
  }catch(err){
    lspinner.style.display='none';lmsg.style.display='none';
    lerrmsg.textContent=`Could not load data: ${err.message}. You can continue offline.`;
    lerr.style.display='block';setSyncStatus('error');
  }
}

async function authSendLink(){
  const email=(document.getElementById('auth-email')?.value||'').trim();
  const msgEl=document.getElementById('auth-msg');
  const titleEl=document.getElementById('auth-title');
  const subEl=document.getElementById('auth-sub');
  const bodyEl=document.getElementById('auth-body');
  if(!email||!email.includes('@')){
    if(msgEl){msgEl.style.display='';msgEl.style.color='var(--accent)';msgEl.textContent='Enter a valid email address.';}
    return;
  }
  try{
    await signInWithEmail(email);
    titleEl.textContent='CHECK YOUR EMAIL';
    subEl.textContent=`Magic link sent to ${email}. Click it to sign in — you can close this tab.`;
    bodyEl.style.display='none';
  }catch(err){
    if(msgEl){msgEl.style.display='';msgEl.style.color='var(--accent)';msgEl.textContent='Error: '+err.message;}
  }
}

async function authSignOut(){
  await signOut();
  sv('fj_sessions',[]);sv('fj_stats',{exercises:{},total:0,weightHistory:{},totalReps:{},prs:{}});
  window.location.reload();
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
  // Wire up gamification module with live-state context
  initGamification({
    get cfg(){return cfg;},
    get sessions(){return sessions;},
    get stats(){return stats;},
    get machines(){return machines;},
    get gamification(){return gamification;},
    fmtWt, toast, toastHtml,
  });
  // Initialize gamification — migrate existing users, then render header badge
  migrateGamification();
  renderHeaderLevel();
  // Wire up history module with live-state context
  initHistory({
    get cfg(){return cfg;},
    get groups(){return groups;},
    get machines(){return machines;},
    get sessions(){return sessions;}, set sessions(s){sessions=s;},
    get stats(){return stats;}, set stats(st){stats=st;},
    get gistCfg(){return gistCfg;},
    get histView(){return histView;}, set histView(v){histView=v;},
    get weekOffset(){return weekOffset;}, set weekOffset(v){weekOffset=v;},
    get weekSelectedDate(){return weekSelectedDate;}, set weekSelectedDate(v){weekSelectedDate=v;},
    get calSelectedDate(){return calSelectedDate;}, set calSelectedDate(v){calSelectedDate=v;},
    get calViewMonth(){return calViewMonth;}, set calViewMonth(v){calViewMonth=v;},
    get expandedChip(){return expandedChip;}, set expandedChip(v){expandedChip=v;},
    get histFilter(){return histFilter;},
    toast, toastHtml, fmtWt, wtTypeLabel, getSchemes, buildPayload, setSyncStatus,
  });
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
  // Wire up workout modules
  const workoutCtxBase = {
    get cfg(){return cfg;},
    get sessions(){return sessions;},
    get stats(){return stats;},
    get machines(){return machines;},
    get active(){return active;}, set active(v){active=v;},
    get pending(){return pending;}, set pending(v){pending=v;},
    get gistCfg(){return gistCfg;},
    get gamification(){return gamification;},
    get templates(){return templates;}, set templates(v){templates=v;},
    get buildMode(){return buildMode;}, set buildMode(v){buildMode=v;},
    get armed(){return armed;},
    get pendingBackupPrompt(){return _pendingBackupPrompt;}, set pendingBackupPrompt(v){_pendingBackupPrompt=v;},
    fmtWt, toast, toastHtml, getSchemes, switchTab, lsSet,
    saveActiveToLocal, saveActiveThrottled,
    flushStrength, flushCardio,
    renderPending, renderSettings, autoSaveSettings,
    buildPayload, setSyncStatus, formatSyncError,
    showBackupPrompt, clearLiveTimer,
  };
  initTimers(workoutCtxBase);
  initPlates(workoutCtxBase);
  initSummary(workoutCtxBase);
  initLog(workoutCtxBase);
  initSave(workoutCtxBase);
  initGenerate(workoutCtxBase);
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
  if(_settingsPushTimer)clearTimeout(_settingsPushTimer);
  _settingsPushTimer=setTimeout(async()=>{
    _settingsPushTimer=null;
    if(isSupabaseEnabled()){
      try{await dbPushConfig(cfg,groups,machines,theme,gamification);setSyncStatus('synced');}catch(e){setSyncStatus('error');}
    } else if(gistCfg.pat){
      try{await gistPush(gistCfg, buildPayload());setSyncStatus('synced');}catch(e){setSyncStatus('error');}
    }
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
  document.getElementById('auth-screen').style.display='none';
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

function enabledEx(g){return g.exercises.filter(e=>e.enabled);}
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
  const todayBtn=document.getElementById('bnav-today');
  if(todayBtn) todayBtn.classList.toggle('has-active-workout',!!active);
  if(tab!=='today') clearLiveTimer();
  if(tab==='generate'){renderActiveWorkoutBanner();setBuildMode(buildMode);renderGenStreakChip();renderTemplates();}
  if(tab==='today')    renderToday();
  if(tab==='history')  renderHistory();
  if(tab==='settings') renderSettings();
  if(tab==='stats')    renderStats({sessions,stats,cfg,statTab});
  if(tab==='prs')      renderPRs({sessions,stats,cfg,fmtWt});
}
function setStatTab(t){statTab=t;renderStats({sessions,stats,cfg,statTab});}

/* ═══════════════════════════════════════════
   HISTORY + CALENDAR
═══════════════════════════════════════════ */
function getCalMonthDate(){
  if(calViewMonth) return new Date(calViewMonth.year,calViewMonth.month,1);
  const n=new Date();return new Date(n.getFullYear(),n.getMonth(),1);
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
  // Auth
  authSendLink, authSignOut,
  // Navigation & core UI
  switchTab, continueOffline, manualSync,
  // Setup / Gist
  setupConnect, settGistPush, settGistPull, settDbPush, modalGistConnect,
  // Generate tab
  generate, setBuildMode, startWorkout, saveAsTemplate,
  openExercisePicker, togglePickerEx, togglePickerGroup, closePickerModal,
  cycleScheme, removeCustomEx, loadTemplate, deleteTemplate,
  // Today / workout logging
  renderToday, toggleDone, adjWt, setWt, cycleWeightType, openPlateCalc,
  setPlateBar, setEffort, saveWorkout, selMachine,
  startEditReps, commitReps, blurReps, endAndSaveActive, discardActiveWorkout,
  repeatSession, cycleSchemeSelect, renderPlates,
  // Timers
  clearRestTimer,
  // Summary
  closeSummaryModal,
  // History
  setHistView, weekSelectDay, weekNav, weekGoToday,
  calSelectDay, calNav, calGoToday, toggleChip,
  setHistFilter, openManualEntry, clearHistory, toggleHist, undoDelete,
  deleteSession, _doClearHistory, openEditSession,
  // Edit session
  closeEditModal, deleteEditSession, editAddEx, editRemoveEx,
  editSelMachine, editClearCardio, saveEditSession, editSetScheme, renderEditModal,
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
