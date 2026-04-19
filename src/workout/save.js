import { dc } from '../utils/misc.js';
import { parseDurationMin, estimateCalories } from '../utils/misc.js';
import { normalizeWeightType } from '../utils/misc.js';
import { sv, ld } from '../storage.js';
import { gistPush } from '../sync/gist.js';
import { clearRestTimer, clearLiveTimer } from './timers.js';
import { showWorkoutSummary } from './summary.js';
import { processGamification } from '../gamification/ui.js';

let _ctx = null;

export function initSave(ctx) { _ctx = ctx; }

export function flushStrength() {
  const active = _ctx.active;
  if(!active) return;
  active.exercises.forEach((ex,ei)=>{
    const w = document.getElementById('wt-'+ei); if(w) ex.weight=parseFloat(w.value)||0;
  });
}
export function flushCardio() {
  const active = _ctx.active;
  if(!active) return;
  ['cd-prog','cd-dur','cd-cal','cd-metric'].forEach(id=>{
    const el = document.getElementById(id); if(!el) return;
    if(id==='cd-prog') active.cardio.program=el.value;
    if(id==='cd-dur')  active.cardio.duration=el.value;
    if(id==='cd-cal')  active.cardio.calories=el.value;
    if(id==='cd-metric') active.cardio.metric=el.value;
  });
}
export function flushFinish() {
  const active = _ctx.active;
  if(!active) return;
  const d = document.getElementById('f-dur'); if(d) active.duration=d.value;
  const c = document.getElementById('f-cal'); if(c) active.calories=c.value;
  const n = document.querySelector('.f-textarea'); if(n) active.notes=n.value;
}

export async function saveWorkout() {
  const active = _ctx.active;
  if(!active) return;
  clearLiveTimer();
  clearRestTimer();
  flushStrength(); flushCardio(); flushFinish();
  const savedAt = new Date().toISOString();
  if(!active.duration?.trim()&&active.startedAt){
    const diffMin = Math.ceil((new Date(savedAt)-new Date(active.startedAt))/60000);
    active.duration = Math.max(1,diffMin)+' min';
  }
  let caloriesEst = false;
  if(!active.calories){
    const { cfg } = _ctx;
    if(cfg.profile?.weight){
      const wallClockMin = parseDurationMin(active.duration);
      const doneSets = active.exercises.reduce((a,ex)=>a+(ex.setsDone||[]).filter(Boolean).length,0);
      const dMin = Math.max(wallClockMin, doneSets*2);
      const est = estimateCalories(active.exercises, dMin, active.effort, cfg.profile);
      if(est){ active.calories=est; caloriesEst=true; }
    }
  }
  const session = {
    id:Date.now(), date:active.date,
    startedAt:active.startedAt||null, savedAt,
    effort:active.effort, duration:active.duration, calories:active.calories, caloriesEst, notes:active.notes,
    cardio:active.cardio.machine ? dc(active.cardio) : null,
    exercises:active.exercises.map(ex=>({
      name:ex.name, group:ex.group, scheme:ex.scheme,
      weight:ex.weight, weightType:ex.weightType||'standard', repsLog:[...ex.repsLog], arrow:ex.arrow||'eq'
    }))
  };
  const prsBefore = JSON.parse(JSON.stringify(_ctx.stats.prs||{}));
  const sessions = _ctx.sessions;
  const stats = _ctx.stats;

  sessions.unshift(session); sv('fj_sessions', sessions);
  stats.total = (stats.total||0)+1;
  if(!stats.exercises) stats.exercises={};
  if(!stats.weightHistory) stats.weightHistory={};
  if(!stats.totalReps) stats.totalReps={};
  if(!stats.prs) stats.prs={};
  session.exercises.forEach(ex=>{
    const k = ex.group+'::'+ex.name;
    const wt = ex.weightType||'standard';
    stats.exercises[k] = (stats.exercises[k]||0)+1;
    if(!stats.weightHistory[k]) stats.weightHistory[k]=[];
    stats.weightHistory[k].push({date:session.date, weight:ex.weight, weightType:wt});
    const repsThisSession = (ex.repsLog||[]).reduce((a,b)=>a+(isNaN(b)?0:+b),0);
    stats.totalReps[k] = (stats.totalReps[k]||0)+repsThisSession;
    const normWt = normalizeWeightType(wt);
    if(!(normWt==='bodyweight'&&(ex.weight||0)===0)){
      const cur = stats.prs[k];
      if(!isNaN(ex.weight)&&(!cur||ex.weight>cur.weight)){
        stats.prs[k] = {weight:ex.weight, weightType:normWt, date:session.date, scheme:ex.scheme, reps:ex.repsLog};
      }
    }
  });
  sv('fj_stats', stats);

  const newPRs = [];
  session.exercises.forEach(ex=>{
    const k = ex.group+'::'+ex.name;
    const was = prsBefore[k];
    const now = stats.prs[k];
    if(now&&(!was||now.weight>was.weight)){ newPRs.push({name:ex.name, weight:now.weight, weightType:now.weightType||'standard', prev:was?was.weight:0}); }
  });

  const gamResult = processGamification(session, newPRs)||{};

  _ctx.active = null; _ctx.pending = null;
  _ctx.lsSet('fj_active_workout', null);
  _ctx.renderPending();
  const _sb = document.getElementById('start-row'); if(_sb) _sb.style.display='none';

  showWorkoutSummary(session, newPRs, gamResult);

  const { gistCfg, buildPayload, setSyncStatus, formatSyncError, toast } = _ctx;
  if(gistCfg.pat){
    setSyncStatus('syncing');
    try{ await gistPush(gistCfg, buildPayload()); setSyncStatus('synced'); }
    catch(err){ setSyncStatus('error'); toast(formatSyncError(err),4000); }
  } else {
    const lastSeen = parseInt(ld('fj_backup_seen_count',0)||0);
    if(sessions.length===1||sessions.length-lastSeen>=10) _ctx.pendingBackupPrompt=true;
  }
}
