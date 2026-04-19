export function dc(x) { return JSON.parse(JSON.stringify(x)); }
export function uid() { return '_'+Math.random().toString(36).slice(2,9); }
export function esc(s) { if(s==null)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
export function normalizeWeightType(wt) {
  if(wt==='bw'||wt==='bw+') return 'bodyweight';
  return wt||'standard';
}
export function pick(a) { return a[Math.floor(Math.random()*a.length)]; }
export function shuffle(a) { const r=[...a]; for(let i=r.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[r[i],r[j]]=[r[j],r[i]];} return r; }
export function parseScheme(s) { const p=String(s||'3×10').split('×'); const sets=Math.max(1,Math.min(parseInt(p[0])||3,20)); const reps=Math.max(1,Math.min(parseInt(p[1])||10,100)); return{sets,reps}; }
export function sessionTotalCal(s) { return (parseFloat(s.calories)||0) + (parseFloat(s.cardio?.calories)||0); }
export function parseDurationMin(durStr) { if(!durStr)return 0; const m=durStr.match(/(\d+)/); return m?parseInt(m[1]):0; }
export function estimateCalories(exercises, durationMin, effort, profile) {
  if(!profile?.weight) return null;
  const kg = profile.weightUnit==='kg' ? parseFloat(profile.weight) : parseFloat(profile.weight)*0.453592;
  if(!kg||kg<=0||kg>500||isNaN(kg)) return null;
  const mets = {1:3.0, 2:3.5, 3:5.0, 4:6.0};
  const met = mets[effort]||3.5;
  const totalSets = (exercises||[]).reduce((a,ex)=>a+(ex.repsLog||[]).length, 0);
  const effectiveDur = durationMin>0 ? durationMin : Math.max(1, totalSets*2);
  const calPerMin = (met*3.5*kg)/200;
  const total = Math.round(calPerMin*effectiveDur);
  return total>0 ? total : null;
}
