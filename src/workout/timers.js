import { dc } from '../utils/misc.js';
import { parseDurationMin, estimateCalories } from '../utils/misc.js';
import { sv } from '../storage.js';
import { DEF_CFG } from '../constants.js';

let _ctx = null;
let _restTimerInterval = null;
let _restTimerRemaining = 0;
let _restTimerTotal = 0;
export let _timerInterval = null;

export function initTimers(ctx) { _ctx = ctx; }

export function startRestTimer() {
  if(!_ctx.cfg.restTimer||!_ctx.cfg.restTimer.enabled) return;
  clearRestTimer();
  const dur = _ctx.cfg.restTimer.duration||60;
  _restTimerTotal = dur;
  _restTimerRemaining = dur;
  _renderRestTimer();
  _restTimerInterval = setInterval(()=>{
    _restTimerRemaining--;
    if(_restTimerRemaining<=0){
      _restTimerRemaining=0; _renderRestTimer(true);
      clearInterval(_restTimerInterval); _restTimerInterval=null;
      setTimeout(clearRestTimer,1500);
    } else { _renderRestTimer(); }
  },1000);
}

export function clearRestTimer() {
  if(_restTimerInterval){ clearInterval(_restTimerInterval); _restTimerInterval=null; }
  document.getElementById('rest-timer-bar')?.remove();
}

function _renderRestTimer(done) {
  let bar = document.getElementById('rest-timer-bar');
  if(!bar){
    bar=document.createElement('div'); bar.id='rest-timer-bar'; bar.className='rest-timer-bar';
    const wrap=document.getElementById('j-wrap'); if(wrap) wrap.prepend(bar); else return;
  }
  const pct = _restTimerTotal>0 ? Math.round((_restTimerRemaining/_restTimerTotal)*100) : 0;
  const m = Math.floor(_restTimerRemaining/60), s = _restTimerRemaining%60;
  const display = m>0 ? `${m}:${String(s).padStart(2,'0')}` : `0:${String(_restTimerRemaining).padStart(2,'0')}`;
  bar.className = 'rest-timer-bar'+(done?' rt-done':'');
  bar.innerHTML = `<span class="rest-timer-time">${done?'GO!':display}</span><span class="rest-timer-label">Rest${done?' — GO!':''}</span><button class="rest-timer-skip" onclick="clearRestTimer()">${done?'✓':'Skip'}</button><div class="rest-timer-prog" style="width:${pct}%"></div>`;
}

export function setRestTimerEnabled(v) {
  const cfg = _ctx.cfg;
  if(!cfg.restTimer) cfg.restTimer = dc(DEF_CFG.restTimer);
  cfg.restTimer.enabled = v;
  sv('fj_cfg', cfg);
  _ctx.autoSaveSettings();
  _ctx.renderSettings();
}

export function setRestDuration(v) {
  const cfg = _ctx.cfg;
  if(!cfg.restTimer) cfg.restTimer = dc(DEF_CFG.restTimer);
  cfg.restTimer.duration = v;
  sv('fj_cfg', cfg);
  _ctx.autoSaveSettings();
  _ctx.renderSettings();
}

export function startLiveTimer() {
  clearInterval(_timerInterval);
  updateLiveTimer();
  _timerInterval = setInterval(updateLiveTimer, 1000);
}

export function clearLiveTimer() {
  clearInterval(_timerInterval);
  _timerInterval = null;
}

export function updateLiveTimer() {
  const el = document.getElementById('live-elapsed');
  if(!el){ clearInterval(_timerInterval); return; }
  const active = _ctx.active;
  if(!active?.startedAt){ el.textContent='—'; return; }
  const secs = Math.floor((Date.now()-new Date(active.startedAt))/1000);
  if(isNaN(secs)||secs<0){ el.textContent='—'; return; }
  const h = Math.floor(secs/3600);
  const m = Math.floor((secs%3600)/60);
  const s = secs%60;
  el.textContent = h>0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export function updateStickyCalories() {
  const el = document.getElementById('sticky-cal');
  if(!el) return;
  const { active, cfg } = _ctx;
  if(!active||!cfg.profile?.weight){ el.textContent=''; return; }
  const doneSets = active.exercises.reduce((a,ex)=>a+(ex.setsDone||[]).filter(Boolean).length, 0);
  if(doneSets===0){ el.textContent=''; return; }
  const estMin = doneSets*2;
  const est = estimateCalories(active.exercises, estMin, active.effort||2, cfg.profile);
  el.textContent = est ? `~${est} cal` : '';
}
