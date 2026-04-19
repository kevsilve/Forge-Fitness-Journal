import { esc } from '../utils/misc.js';
import { fmtDate, dotw } from '../utils/date.js';
import { EFFORT_LABELS, EFFORT_COLORS } from '../constants.js';
import { getLevelProgress } from '../gamification/ui.js';

let _ctx = null;

export function initSummary(ctx) { _ctx = ctx; }

export function showWorkoutSummary(session, newPRs, gamResult) {
  const { gamification, fmtWt } = _ctx;
  const effortLabels = EFFORT_LABELS;
  const effortColors = EFFORT_COLORS;
  const totalSets = session.exercises.reduce((a,ex)=>a+(ex.repsLog||[]).length, 0);
  const calHtml = session.calories
    ? `<div class="summ-stat"><div class="summ-stat-val">🔥${session.calories}</div><div class="summ-stat-lbl">cal${session.caloriesEst?' (est)':''}</div></div>`
    : '';
  const effortHtml = session.effort
    ? `<div class="summ-effort" style="color:${effortColors[session.effort]}">${effortLabels[session.effort]}</div>`
    : '';
  const prHtml = newPRs.length
    ? `<div class="summ-prs"><div class="summ-prs-title">🏆 NEW PRs THIS SESSION</div>${newPRs.map(p=>`<div class="summ-pr-row"><span>${esc(p.name)}</span><span style="color:var(--accent);font-weight:700;">${fmtWt(p.weight,false,p.weightType)}</span></div>`).join('')}</div>`
    : '';
  const {xpGained=0, newBadges=[], leveledUp=false, newLevel=1} = gamResult||{};
  const tierC = {bronze:'#cd7f32',silver:'#94a3b8',gold:'#f59e0b',platinum:'#a5b4fc'};
  const prog = getLevelProgress(gamification.xp||0, gamification.level||1);
  const xpHtml = xpGained>0
    ? `<div class="summ-xp-row">
    <div class="summ-xp-left">
      <span class="summ-xp-gained">+${xpGained} XP</span>
      ${leveledUp
        ? `<span class="summ-lvlup">LEVEL UP → LV ${newLevel} 🎉</span>`
        : `<span class="summ-xp-lv">LV ${gamification.level||1}</span>`}
    </div>
    <div class="summ-xp-bar-wrap"><div class="summ-xp-bar-fill" style="width:${prog.pct}%"></div></div>
  </div>`
    : '';
  const badgesHtml = newBadges.length
    ? `<div class="summ-prs summ-badges-section"><div class="summ-prs-title">🏅 ACCOLADES EARNED</div>${newBadges.map(b=>`<div class="summ-badge-row"><span class="summ-badge-icon">${b.icon}</span><span style="color:${tierC[b.tier]||'var(--accent)'};font-weight:700;font-size:13px;">${esc(b.name)}</span><span class="summ-badge-tier" style="color:${tierC[b.tier]||'var(--text3)'};">${b.tier}</span></div>`).join('')}</div>`
    : '';
  const prNames = new Set(newPRs.map(p=>p.name));
  const exBreakdownHtml = session.exercises.length
    ? `<div class="summ-exercises"><div class="summ-prs-title">💪 EXERCISES</div>${session.exercises.map(ex=>{const repsStr=(ex.repsLog||[]).join(', ');const isPR=prNames.has(ex.name);return`<div class="summ-ex-row"><div class="summ-ex-info"><div class="summ-ex-name">${esc(ex.name)}${isPR?'<span class="summ-ex-pr-tag">PR</span>':''}</div><div class="summ-ex-detail">${esc(ex.scheme)}${repsStr?' · '+repsStr:''}</div></div><div class="summ-ex-wt">${fmtWt(ex.weight,false,ex.weightType)}</div></div>`;}).join('')}</div>`
    : '';
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay">
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

export function closeSummaryModal() {
  document.getElementById('modal-root').innerHTML = '';
  _ctx.switchTab('history');
  if(_ctx.pendingBackupPrompt){ _ctx.pendingBackupPrompt=false; _ctx.showBackupPrompt(); }
}
