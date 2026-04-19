import { esc, normalizeWeightType } from '../utils/misc.js';

export function renderPRs({ sessions, stats, cfg, fmtWt }) {
  const wrap = document.getElementById('prs-wrap');
  const prs = stats.prs || {};
  const wh = stats.weightHistory || {};
  const keys = Object.keys(prs);
  if(!keys.length) {
    wrap.innerHTML = `<div class="prs-title">Personal Records</div><div class="empty-state-card">
      <span class="es-icon">🏆</span>
      <div class="es-title">NO PRs YET</div>
      <div class="es-sub">Complete workouts to start tracking your personal bests</div>
      <button class="es-cta" onclick="switchTab('generate')">Build a Workout</button>
    </div>`;
    return;
  }
  // Group by muscle group
  const byGroup = {};
  keys.forEach(k => {
    const sep = k.indexOf('::');
    const grp = k.slice(0, sep);
    if(!byGroup[grp]) byGroup[grp] = [];
    byGroup[grp].push({ key: k, name: k.slice(sep+2), ...prs[k] });
  });
  Object.values(byGroup).forEach(arr => arr.sort((a,b) => b.weight - a.weight));
  let html = `<div class="prs-title">Personal Records</div>`;
  Object.entries(byGroup).sort((a,b) => b[1][0].weight - a[1][0].weight).forEach(([grp, arr]) => {
    html += `<div class="pr-group"><div class="pr-group-name">${esc(grp)}</div>`;
    arr.forEach(pr => {
      // Build mini sparkline from weight history
      const hist = wh[pr.key] || [];
      const sparkW = 80, sparkH = 24;
      let sparkHtml = '';
      if(hist.length > 1) {
        const weights = hist.map(d => isNaN(d.weight) ? 0 : d.weight);
        const minW = Math.min(...weights), maxW = Math.max(...weights);
        const range = maxW - minW || 1;
        const n = hist.length;
        const pts = hist.map((d,i) => {
          const x = (n > 1 ? (i/(n-1)) : 0.5) * (sparkW-4) + 2;
          const y = sparkH - 2 - ((d.weight - minW) / range) * (sparkH-4);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        const prIdx = hist.reduce((mx,d,i) => d.weight > hist[mx].weight ? i : mx, 0);
        const prX = (prIdx/(n-1)) * (sparkW-4) + 2;
        const prY = sparkH - 2 - ((hist[prIdx].weight - minW) / range) * (sparkH-4);
        sparkHtml = `<svg width="${sparkW}" height="${sparkH}" viewBox="0 0 ${sparkW} ${sparkH}" style="flex-shrink:0;opacity:.8">
          <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="${prX.toFixed(1)}" cy="${prY.toFixed(1)}" r="3" fill="var(--accent)"/>
        </svg>`;
      }
      // Trend: compare last 2 entries
      let trendHtml = '';
      if(hist.length >= 2) {
        const diff = hist[hist.length-1].weight - hist[hist.length-2].weight;
        const isKg = cfg.profile && cfg.profile.weightUnit === 'kg';
        const diffDisp = isKg ? (diff * 0.453592).toFixed(1) : Math.abs(diff);
        const unit = isKg ? 'kg' : 'lb';
        if(diff > 0) trendHtml = `<span style="font-size:9px;color:var(--up);font-weight:700;">↑${diffDisp}${unit}</span>`;
        else if(diff < 0) trendHtml = `<span style="font-size:9px;color:var(--dn);font-weight:700;">↓${diffDisp}${unit}</span>`;
      }
      // Find calories from the PR session
      const prSession = sessions.find(s => s.date === pr.date && s.exercises && s.exercises.some(ex => ex.name === pr.name));
      const prCalHtml = prSession && prSession.calories ? `<span style="font-size:9px;color:var(--accent);font-weight:600;margin-left:6px;">🔥${prSession.caloriesEst?'~':''}${prSession.calories}${prSession.caloriesEst?' (est.)':''}</span>` : '';
      // 1RM estimate (Epley formula)
      const prMaxReps = Math.max(...((pr.reps||[]).filter(r => !isNaN(r) && r > 0)), 0);
      const prWtType = pr.weightType || 'standard';
      const normPrWtType = normalizeWeightType(prWtType);
      const est1rm = normPrWtType === 'standard' && prMaxReps > 1 ? Math.round(pr.weight * (1 + prMaxReps/30)) : 0;
      const wtUnit = normPrWtType === 'level' ? 'Lvl' : normPrWtType === 'bodyweight' ? ((cfg.profile&&cfg.profile.weightUnit==='kg'?'kg':'lbs')+'+') : (cfg.profile&&cfg.profile.weightUnit==='kg'?'kg':'lbs');
      html += `<div class="pr-row" style="flex-direction:column;align-items:stretch;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="pr-info">
            <div class="pr-name">${esc(pr.name)}</div>
            <div class="pr-meta">${esc(pr.scheme||'')} · ${esc(pr.date||'')}${prCalHtml} ${trendHtml}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div class="pr-weight">${fmtWt(pr.weight, true, prWtType)}</div>
            <div class="pr-unit">${wtUnit} PR</div>
            ${est1rm ? `<div class="pr-1rm">~${fmtWt(est1rm)} 1RM</div>` : ''}
          </div>
        </div>
        ${hist.length > 1 ? `<div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:9px;color:var(--text3);">${hist.length} sessions · started ${fmtWt(hist[0].weight, false, hist[0].weightType)}</div>
          ${sparkHtml}
        </div>` : ''}
      </div>`;
    });
    html += '</div>';
  });
  wrap.innerHTML = html;
}
