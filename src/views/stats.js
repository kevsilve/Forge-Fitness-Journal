import { esc } from '../utils/misc.js';
import { sessionTotalCal } from '../utils/misc.js';
import { todayISO, isoFromDate } from '../utils/date.js';

function computeStreaks(cfg, sessions) {
  const mode = cfg.streakMode || 'weekly';
  const goal = mode === 'daily' ? 1 : Math.max(1, cfg.streakGoal || 3);

  function getPeriodKey(dateStr) {
    if(mode === 'daily') return dateStr;
    if(mode === 'monthly') return dateStr.slice(0, 7);
    // weekly: Monday of that week
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return isoFromDate(d);
  }

  function shiftPeriod(key, n) {
    if(mode === 'daily') {
      const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + n); return isoFromDate(d);
    }
    if(mode === 'monthly') {
      const [y,m] = key.split('-').map(Number);
      const d = new Date(y, m-1+n, 1);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    }
    // weekly
    const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + n*7); return isoFromDate(d);
  }

  const today = todayISO();
  const thisPeriod = getPeriodKey(today);
  const lastPeriod = shiftPeriod(thisPeriod, -1);

  const periodMap = {};
  sessions.forEach(s => {
    if(!s.date) return;
    const k = getPeriodKey(s.date);
    periodMap[k] = (periodMap[k] || 0) + 1;
  });

  const periodProgress = periodMap[thisPeriod] || 0;
  const periodLabel = mode === 'daily' ? 'today' : mode === 'weekly' ? 'this week' : 'this month';

  if(!Object.keys(periodMap).length) return { current:0, longest:0, periodProgress, periodGoal:goal, periodLabel };

  const periods = Object.keys(periodMap).sort();

  // Longest streak
  let longest = 0, streak = 0;
  for(let i = 0; i < periods.length; i++) {
    if(periodMap[periods[i]] >= goal) {
      streak = (i > 0 && shiftPeriod(periods[i-1], 1) === periods[i]) ? streak+1 : 1;
      longest = Math.max(longest, streak);
    } else { streak = 0; }
  }

  // Current streak: anchor on this period (if complete) or last period, walk back
  let current = 0, anchor = null;
  if((periodMap[thisPeriod] || 0) >= goal) anchor = thisPeriod;
  else if((periodMap[lastPeriod] || 0) >= goal) anchor = lastPeriod;
  if(anchor) {
    current = 1;
    let expect = shiftPeriod(anchor, -1);
    for(let i = periods.indexOf(anchor) - 1; i >= 0; i--) {
      if(periods[i] === expect && periodMap[periods[i]] >= goal) { current++; expect = shiftPeriod(periods[i], -1); }
      else break;
    }
  }

  return { current, longest, periodProgress, periodGoal: goal, periodLabel };
}

function buildVolumeChart(sessions, cfg) {
  const now = new Date();
  const weeks = [];
  for(let w = 11; w >= 0; w--) {
    const end = new Date(now); end.setDate(now.getDate() - w*7); end.setHours(23,59,59,999);
    const start = new Date(end); start.setDate(end.getDate() - 6); start.setHours(0,0,0,0);
    const label = `${start.getMonth()+1}/${start.getDate()}`;
    const wSessions = sessions.filter(s => { const d = new Date(s.date+'T12:00:00'); return d >= start && d <= end; });
    const vol = wSessions.reduce((acc,s) => acc + (s.exercises||[]).reduce((a,ex) => a + (parseFloat(ex.weight)||0) * ((ex.repsLog||[]).reduce((r,v) => r+(isNaN(v)?0:+v), 0)), 0), 0);
    weeks.push({ label, vol, isCur: w === 0 });
  }
  const maxVol = Math.max(...weeks.map(w => w.vol), 1);
  const fmtV = v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(Math.round(v));
  const barHtml = weeks.map(b => {
    const h = Math.round((b.vol/maxVol)*52) + 2;
    return `<div class="week-bar-col">
      <div class="week-bar-num" style="font-size:${b.vol?'9':'8'}px;color:${b.vol?'var(--accent)':'var(--text3)'}">${b.vol?fmtV(b.vol):''}</div>
      <div class="week-bar-fill${b.isCur?' this-week':''}" style="height:${h}px"></div>
      <div class="week-bar-lbl">${b.label}</div>
    </div>`;
  }).join('');
  return `<div class="weekly-chart">
    <div class="weekly-chart-title">Weekly Volume — ${cfg.profile.weightUnit==='kg'?'kg':'lbs'} lifted (Last 12 Weeks)</div>
    <div class="week-bars">${barHtml}</div>
  </div>`;
}

function buildMonthlyChart(sessions) {
  const now = new Date();
  const months = [];
  for(let m = 11; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth()-m, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'short' });
    const count = sessions.filter(s => s.date.startsWith(key)).length;
    months.push({ key, label, count, isThis: m === 0 });
  }
  const maxCount = Math.max(...months.map(b => b.count), 1);
  const barHtml = months.map(b => {
    const h = Math.round((b.count/maxCount)*52) + 2;
    return `<div class="week-bar-col">
      <div class="week-bar-num" style="font-size:${b.count?'9':'8'}px;color:${b.count?'var(--accent)':'var(--text3)'}">${b.count||''}</div>
      <div class="week-bar-fill${b.isThis?' this-week':''}" style="height:${h}px"></div>
      <div class="week-bar-lbl">${b.label}</div>
    </div>`;
  }).join('');
  return `<div class="weekly-chart">
    <div class="weekly-chart-title">Sessions per Month (Last 12 Months)</div>
    <div class="week-bars">${barHtml}</div>
  </div>`;
}

function buildGroupFrequencyChart(sessions) {
  if(!sessions.length) return '';
  const totalSess = sessions.length;
  const groupCounts = {};
  sessions.forEach(s => {
    const seen = new Set();
    (s.exercises||[]).forEach(ex => { if(ex.group && !seen.has(ex.group)) { seen.add(ex.group); groupCounts[ex.group] = (groupCounts[ex.group]||0) + 1; } });
  });
  const sorted = Object.entries(groupCounts).sort((a,b) => b[1] - a[1]);
  if(!sorted.length) return '';
  const maxC = sorted[0][1];
  const rows = sorted.map(([grp, cnt]) => {
    const pct = Math.round(cnt/totalSess*100);
    return `<div class="sr">
      <span class="sn" title="${esc(grp)}">${esc(grp)}</span>
      <div class="sbw"><div class="sb top" style="width:${Math.round(cnt/maxC*100)}%"></div></div>
      <span class="sp">${pct}%</span><span class="sct">${cnt}</span>
    </div>`;
  }).join('');
  return `<div class="sg"><div class="sg-name" style="margin-bottom:8px;">Muscle Group Frequency</div>${rows}</div>`;
}

function renderStatSessions(sessions, stats, cfg) {
  const total = stats.total || 0;
  const { current, longest, periodProgress, periodGoal, periodLabel } = computeStreaks(cfg, sessions);
  const streakMode = cfg.streakMode || 'weekly';
  const streakUnit = streakMode === 'daily' ? 'day' : streakMode === 'weekly' ? 'week' : 'month';
  const now = new Date();
  const fourWeeksAgo = new Date(now); fourWeeksAgo.setDate(now.getDate() - 28);
  const recent = sessions.filter(s => new Date(s.date+'T12:00:00') >= fourWeeksAgo).length;
  const avgRecent = (recent/4).toFixed(1);
  let avgAllTime = '—';
  if(sessions.length) {
    const allDates = sessions.map(s => s.date).sort();
    const first = new Date(allDates[0]+'T12:00:00');
    const weeksTotal = Math.max(1, Math.round((now - first) / (7*24*3600*1000)));
    avgAllTime = (total/weeksTotal).toFixed(1);
  }
  const monthCounts = {};
  sessions.forEach(s => { const m = s.date.slice(0,7); monthCounts[m] = (monthCounts[m]||0) + 1; });
  let bestMonthLbl = '—', bestMonthCount = 0;
  Object.entries(monthCounts).forEach(([k,v]) => { if(v > bestMonthCount) { bestMonthCount = v; const d = new Date(k+'-01T12:00:00'); bestMonthLbl = d.toLocaleDateString('en-US', { month:'short', year:'numeric' }); } });
  const durSessions = sessions.filter(s => s.duration && s.duration.trim());
  const totalMinutes = durSessions.reduce((acc,s) => { const m = s.duration.match(/(\d+)/); return acc + (m ? parseInt(m[1]) : 0); }, 0);
  const durHtml = totalMinutes > 0 ? `<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
    <div><div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:4px;">Total Time Logged</div>
    <div style="font-size:10px;color:var(--text2);">${durSessions.length} sessions with duration</div></div>
    <div style="text-align:right;"><div style="font-family:'Black Ops One',sans-serif;font-size:22px;color:var(--accent);line-height:1;">${totalMinutes>=60?Math.floor(totalMinutes/60)+'h '+(totalMinutes%60)+'m':totalMinutes+'m'}</div></div>
  </div>` : '';
  const calSessions = sessions.filter(s => sessionTotalCal(s) > 0);
  const totalCal = Math.round(calSessions.reduce((a,s) => a + sessionTotalCal(s), 0));
  const totalStrCal = Math.round(sessions.reduce((a,s) => a + (parseFloat(s.calories)||0), 0));
  const totalCrdCal = Math.round(sessions.reduce((a,s) => a + (parseFloat(s.cardio?.calories)||0), 0));
  const avgCal = calSessions.length ? Math.round(totalCal/calSessions.length) : 0;
  const totalCalStr = totalCal >= 1000 ? `${(totalCal/1000).toFixed(1)}k` : `${totalCal}`;
  const calBreakdown = totalStrCal && totalCrdCal ? `<div style="font-size:10px;color:var(--text3);margin-top:2px;">💪 ${totalStrCal} str &nbsp;·&nbsp; 🏃 ${totalCrdCal} cardio</div>` : '';
  const calHtml = totalCal > 0 ? `<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
    <div><div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:4px;">Total Calories Burned</div>
    <div style="font-size:10px;color:var(--text2);">${calSessions.length} sessions · ~${avgCal} cal avg</div>${calBreakdown}</div>
    <div style="text-align:right;"><div style="font-family:'Black Ops One',sans-serif;font-size:22px;color:var(--accent);line-height:1;">🔥${totalCalStr}</div>
    <div style="font-size:9px;color:var(--text3);">calories</div></div>
  </div>` : '';

  return `<div class="stat-panel active">
    <div class="sess-hero">
      <span class="sess-num">${total}</span>
      <span class="sess-lbl">Total Sessions Logged</span>
    </div>
    ${streakMode !== 'daily' ? `<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
      <div><div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:4px;">${streakMode==='weekly'?'This Week':'This Month'}</div>
      <div style="font-size:10px;color:var(--text2);">Goal: ${periodGoal} session${periodGoal!==1?'s':''} per ${streakUnit}</div></div>
      <div style="text-align:right;"><div style="font-family:'Black Ops One',sans-serif;font-size:26px;color:${periodProgress>=periodGoal?'var(--up)':'var(--accent)'};line-height:1;">${periodProgress}/${periodGoal}</div>
      <div style="font-size:9px;color:var(--text3);">${periodProgress>=periodGoal?'goal met ✓':'sessions'}</div></div>
    </div>` : `<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
      <div><div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:4px;">Today</div>
      <div style="font-size:10px;color:var(--text2);">Daily streak mode</div></div>
      <div style="text-align:right;"><div style="font-size:13px;font-weight:700;color:${periodProgress>0?'var(--up)':'var(--text3)'};">${periodProgress>0?'Logged ✓':'Not yet'}</div></div>
    </div>`}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
      <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:14px;text-align:center;">
        <div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:6px;">Current Streak</div>
        <div style="font-family:'Black Ops One',sans-serif;font-size:28px;color:${current>0?'var(--up)':'var(--text3)'};line-height:1;">${current}</div>
        <div style="font-size:9px;color:var(--text3);margin-top:3px;">${streakUnit}${current!==1?'s':''}</div>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:14px;text-align:center;">
        <div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:6px;">Longest Streak</div>
        <div style="font-family:'Black Ops One',sans-serif;font-size:28px;color:var(--accent);line-height:1;">${longest}</div>
        <div style="font-size:9px;color:var(--text3);margin-top:3px;">${streakUnit}${longest!==1?'s':''}</div>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:14px;text-align:center;">
        <div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:6px;">Avg / Week (4wk)</div>
        <div style="font-family:'Black Ops One',sans-serif;font-size:28px;color:var(--accent);line-height:1;">${avgRecent}</div>
        <div style="font-size:9px;color:var(--text3);margin-top:3px;">sessions</div>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:14px;text-align:center;">
        <div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:6px;">Avg / Week (all)</div>
        <div style="font-family:'Black Ops One',sans-serif;font-size:28px;color:var(--accent);line-height:1;">${avgAllTime}</div>
        <div style="font-size:9px;color:var(--text3);margin-top:3px;">sessions</div>
      </div>
    </div>
    <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
      <div><div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:4px;">Best Month</div>
      <div style="font-size:10px;color:var(--text2);">${bestMonthLbl}</div></div>
      <div style="text-align:right;"><div style="font-family:'Black Ops One',sans-serif;font-size:22px;color:var(--accent);line-height:1;">${bestMonthCount}</div>
      <div style="font-size:9px;color:var(--text3);">sessions</div></div>
    </div>
    ${durHtml}
    ${calHtml}
    ${buildMonthlyChart(sessions)}
    ${sessions.length ? buildVolumeChart(sessions, cfg) : ''}
  </div>`;
}

function renderStatExercises(sessions, stats) {
  const exStats = stats.exercises || {};
  const totalReps = stats.totalReps || {};
  const total = Object.values(exStats).reduce((a,b) => a+b, 0);
  if(!total) return `<div class="stat-panel active"><div class="no-stat">No exercise data yet</div></div>`;
  const byGroup = {};
  Object.entries(exStats).forEach(([key, count]) => {
    const sep = key.indexOf('::');
    const grpName = key.slice(0, sep); const exName = key.slice(sep+2);
    if(!byGroup[grpName]) byGroup[grpName] = [];
    byGroup[grpName].push({ name: exName, count, key });
  });
  let html = '<div class="stat-panel active">' + buildGroupFrequencyChart(sessions);
  Object.entries(byGroup).sort((a,b) => b[1].reduce((s,e) => s+e.count,0) - a[1].reduce((s,e) => s+e.count,0)).forEach(([grpName, exArr]) => {
    exArr.sort((a,b) => b.count - a.count);
    const maxCount = exArr[0].count;
    html += `<div class="sg"><div class="sg-name">${grpName}</div>`;
    exArr.forEach((ex, i) => {
      const pct = maxCount > 0 ? ex.count/maxCount : 0;
      const totPct = total > 0 ? Math.round(ex.count/total*100) : 0;
      const reps = totalReps[ex.key] || 0;
      const repsLbl = reps >= 1000 ? `${(reps/1000).toFixed(1)}k` : reps;
      html += `<div class="sr">
        <span class="sn" title="${esc(ex.name)}">${esc(ex.name)}</span>
        <div class="sbw"><div class="sb${i===0?' top':''}" style="width:${Math.round(pct*100)}%"></div></div>
        <span class="sp">${totPct}%</span><span class="sct">${ex.count}</span>
        <span class="sreps">${reps?repsLbl+'r':''}</span>
      </div>`;
    });
    html += '</div>';
  });
  html += `<div class="stat-actions"><span class="stat-count-lbl">${total} total picks</span></div></div>`;
  return html;
}

export function renderStats({ sessions, stats, cfg, statTab }) {
  const wrap = document.getElementById('stats-wrap');
  if(!sessions.length) {
    wrap.innerHTML = `<div class="empty-state-card">
      <span class="es-icon">📊</span>
      <div class="es-title">NO DATA YET</div>
      <div class="es-sub">Complete workouts to see your stats and trends</div>
      <button class="es-cta" onclick="switchTab('generate')">Build a Workout</button>
    </div>`;
    return;
  }
  const tabs = `<div class="stat-tabs">
    <button class="stat-tab${statTab==='sessions'?' active':''}" onclick="setStatTab('sessions')">Sessions</button>
    <button class="stat-tab${statTab==='exercises'?' active':''}" onclick="setStatTab('exercises')">Exercises</button>
  </div>`;
  wrap.innerHTML = tabs + (statTab === 'sessions' ? renderStatSessions(sessions, stats, cfg) : renderStatExercises(sessions, stats));
}
