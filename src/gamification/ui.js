import { dc, esc, sessionTotalCal } from '../utils/misc.js';
import { fmtDate, dotw, todayISO } from '../utils/date.js';
import { sv } from '../storage.js';
import { DEF_GAMIFICATION, EFFORT_LABELS, EFFORT_COLORS } from '../constants.js';
import { computeStreaks } from '../views/stats.js';

let _ctx = null;

export function initGamification(ctx) { _ctx = ctx; }

function parseDurationMin(durStr){
  if(!durStr)return 0;
  const m=durStr.match(/(\d+)/);return m?parseInt(m[1]):0;
}

export const LEVEL_THRESHOLDS=(()=>{
  const t=[0];
  for(let i=0;i<4;i++)t.push(t[t.length-1]+120);
  for(let i=0;i<10;i++)t.push(t[t.length-1]+240);
  for(let i=0;i<15;i++)t.push(t[t.length-1]+600);
  for(let i=0;i<15;i++)t.push(t[t.length-1]+1200);
  for(let i=0;i<5;i++)t.push(t[t.length-1]+3000);
  return t;
})();

export function xpToLevel(xp){
  let lv=1;
  for(let i=1;i<LEVEL_THRESHOLDS.length;i++){if(xp>=LEVEL_THRESHOLDS[i])lv=i+1;else break;}
  return Math.min(lv,50);
}
export function getLevelProgress(xp,level){
  const idx=level-1;
  const curr=LEVEL_THRESHOLDS[idx]||0;
  const next=LEVEL_THRESHOLDS[idx+1];
  if(!next)return{pct:100,xpInLevel:0,xpNeeded:0};
  const inLevel=xp-curr;const needed=next-curr;
  return{pct:Math.round(inLevel/needed*100),inLevel,needed};
}
export function getTier(level){
  if(level<=5)return{name:'RECRUIT',idx:0};
  if(level<=15)return{name:'IRON',idx:1};
  if(level<=30)return{name:'STEEL',idx:2};
  if(level<=45)return{name:'FORGE',idx:3};
  return{name:'LEGEND',idx:4};
}

export const ARCHETYPES={
  iron_titan:{name:'Iron Titan',icon:'⚔️',tagline:'You lift heavy and push hard. PRs are your currency.'},
  volume_engine:{name:'Volume Engine',icon:'🔩',tagline:'You outwork everyone. Volume is your superpower.'},
  cardio_ghost:{name:'Cardio Ghost',icon:'💨',tagline:"You're built for distance. Endurance is your edge."},
  forge_athlete:{name:'Forge Athlete',icon:'🔥',tagline:'You do it all. No weakness, no skipped days.'},
};

export const BADGES=[
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

export function calcBuild(){
  const {cfg,sessions,stats}=_ctx;
  if(!stats||stats.total<3)return null;
  let pwr=0;
  const prVals=Object.values(stats.prs||{}).map(p=>p.weight).filter(w=>w>0);
  if(prVals.length>0){
    const topPR=Math.max(...prVals);
    const bwLbs=cfg.profile?.weightUnit==='kg'?(parseFloat(cfg.profile?.weight)||68)*2.20462:(parseFloat(cfg.profile?.weight)||150);
    pwr=Math.min(100,Math.round((topPR/bwLbs)*35));
  }
  const totalReps=Object.values(stats.totalReps||{}).reduce((a,b)=>a+b,0);
  const vol=Math.min(100,Math.max(0,Math.round((Math.log10(Math.max(10,totalReps))-1)*20)));
  const cardioSess=sessions.filter(s=>s.cardio&&s.cardio.machine).length;
  const totalDur=sessions.reduce((a,s)=>a+parseDurationMin(s.duration||''),0);
  const avgDur=sessions.length>0?totalDur/sessions.length:0;
  const end=Math.min(100,Math.round(Math.min(50,cardioSess*0.6)+Math.min(50,avgDur*0.8)));
  const effortSess=sessions.filter(s=>s.effort);
  const avgEffort=effortSess.length>0?effortSess.reduce((a,s)=>a+s.effort,0)/effortSess.length:2;
  const grn=Math.min(100,Math.round((avgEffort/4)*50+Math.min(50,stats.total*0.5)));
  const streaks=computeStreaks(cfg,sessions);
  const msRange=sessions.length>1?Math.max(1,Math.ceil((new Date(sessions[0].date)-new Date(sessions[sessions.length-1].date))/(7*24*60*60*1000))):1;
  const freq=sessions.length/msRange;
  const streakMult=({daily:0.55,weekly:1.9,monthly:8})[cfg.streakMode||'weekly']||1.9;
  const cns=Math.min(100,Math.round(Math.min(50,freq*12)+Math.min(50,streaks.longest*streakMult)));
  const subStats={pwr,vol,end,grn,cns};
  const cardioRatio=cardioSess/Math.max(1,sessions.length);
  let archetype;
  if(cardioRatio>0.4&&end>35)archetype='cardio_ghost';
  else if(pwr>vol&&pwr>end&&pwr>=25)archetype='iron_titan';
  else if(vol>=pwr&&vol>=end&&vol>=30)archetype='volume_engine';
  else archetype='forge_athlete';
  return{archetype,subStats};
}

export function checkBadges(session,newPRs){
  const {cfg,sessions,stats,gamification}=_ctx;
  const newB=[];
  const earned=gamification.earnedBadges||[];
  function earn(id){if(!earned.includes(id)&&!newB.includes(id))newB.push(id);}
  if(stats.total>=1)earn('first_forge');
  if(newPRs&&newPRs.length>0)earn('pr_breaker');
  const streaks=computeStreaks(cfg,sessions);
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

export function processGamification(session,newPRs){
  const {cfg,sessions,stats}=_ctx;
  let gamification=_ctx.gamification;
  if(!gamification)gamification=dc(DEF_GAMIFICATION);
  if(gamification.lastProcessedSession===session.id)return;
  gamification.lastProcessedSession=session.id;
  let xp=50;
  const mults=[0,1.0,1.25,1.5,2.0];
  xp=Math.floor(xp*(mults[session.effort||1]||1.0));
  xp+=((newPRs&&newPRs.length)||0)*100;
  const streaks=computeStreaks(cfg,sessions);
  const [xpT1,xpT2]=({daily:[7,30],weekly:[4,12],monthly:[3,6]})[cfg.streakMode||'weekly'];
  if(streaks.current>=xpT2)xp+=250;
  else if(streaks.current>=xpT1)xp+=75;
  if(parseDurationMin(session.duration||'')>=90)xp+=50;
  const sDate=new Date((session.date||todayISO())+'T12:00:00');
  const weekStart=new Date(sDate);weekStart.setDate(sDate.getDate()-sDate.getDay());weekStart.setHours(0,0,0,0);
  const weekPrev=sessions.filter(s=>s.id!==session.id&&new Date(s.date+'T12:00:00')>=weekStart&&new Date(s.date+'T12:00:00')<sDate);
  if(weekPrev.length===0)xp+=25;
  const prevLevel=gamification.level||1;
  gamification.xp=(gamification.xp||0)+xp;
  gamification.level=xpToLevel(gamification.xp);
  const newBadges=checkBadges(session,newPRs);
  newBadges.forEach(bid=>{if(!gamification.earnedBadges.includes(bid))gamification.earnedBadges.push(bid);});
  sv('fj_gamification',gamification);
  renderHeaderLevel();
  const leveledUp=gamification.level>prevLevel;
  if(leveledUp){setTimeout(()=>showLevelUpModal(gamification.level),1800);}
  const delay=leveledUp?3500:1800;
  newBadges.forEach((bid,i)=>{
    const badge=BADGES.find(b=>b.id===bid);
    if(badge)setTimeout(()=>showBadgeToast(badge),delay+i*1400);
  });
  return{xpGained:xp,newBadges:newBadges.map(bid=>BADGES.find(b=>b.id===bid)).filter(Boolean),leveledUp,newLevel:gamification.level};
}

export function migrateGamification(){
  const {cfg,sessions,stats}=_ctx;
  const gamification=_ctx.gamification;
  if(gamification.xp>0||!sessions.length)return;
  let xp=0;
  sessions.forEach(s=>{
    const mults=[0,1.0,1.25,1.5,2.0];
    xp+=Math.floor(50*(mults[s.effort||1]||1.0));
    if(parseDurationMin(s.duration||'')>=90)xp+=50;
  });
  xp+=Object.keys(stats.prs||{}).length*50;
  const streaks=computeStreaks(cfg,sessions);
  const [mT1,mT2,mT3]=({daily:[7,30,90],weekly:[4,12,26],monthly:[3,6,12]})[cfg.streakMode||'weekly'];
  if(streaks.longest>=mT3)xp+=3000;
  else if(streaks.longest>=mT2)xp+=1000;
  else if(streaks.longest>=mT1)xp+=250;
  gamification.xp=xp;
  gamification.level=xpToLevel(xp);
  gamification.lastProcessedSession=sessions.length>0?sessions[0].id:-1;
  const fakeSess={effort:sessions[0]?.effort||1,duration:sessions[0]?.duration||'60 min',savedAt:new Date().toISOString(),exercises:sessions[0]?.exercises||[]};
  const allPRs=Object.values(stats.prs||{}).map(p=>({name:'',weight:p.weight,prev:0}));
  const retroBadges=checkBadges(fakeSess,allPRs);
  gamification.earnedBadges=[...new Set([...gamification.earnedBadges,...retroBadges])];
  sv('fj_gamification',gamification);
}

export function renderHeaderLevel(){
  const el=document.getElementById('hdr-level');if(!el)return;
  const {cfg,gamification}=_ctx;
  const showBadge=!cfg.gamificationPrefs||cfg.gamificationPrefs.showHeaderBadge!==false;
  el.style.display=showBadge?'':'none';
  if(!showBadge)return;
  const lv=gamification.level||1;
  const xp=gamification.xp||0;
  const tier=getTier(lv);
  const prog=getLevelProgress(xp,lv);
  el.innerHTML=`<span class="hdr-level-tier">${tier.name}</span><span class="hdr-level-num">LV ${lv}</span><div class="hdr-level-bar"><div class="hdr-level-fill" style="width:${prog.pct}%"></div></div>`;
}

export function openProfileModal(){
  const {cfg,stats,gamification}=_ctx;
  const root=document.getElementById('modal-root');
  const build=calcBuild();
  const lv=gamification.level||1;
  const xp=gamification.xp||0;
  const tier=getTier(lv);
  const prog=getLevelProgress(xp,lv);
  const archData=build?ARCHETYPES[build.archetype]:null;
  const ss=build?build.subStats:{pwr:0,vol:0,end:0,grn:0,cns:0};
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
  const prVals=Object.entries(stats.prs||{});
  let topPR={name:'—',weight:0,weightType:'standard'};
  if(prVals.length>0){const best=prVals.sort((a,b)=>b[1].weight-a[1].weight)[0];topPR={name:best[0].split('::')[1],weight:best[1].weight,weightType:best[1].weightType};}
  const streaks=computeStreaks(_ctx.cfg,_ctx.sessions);
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
            <div class="card-footer-stat"><div class="card-footer-val">${topPR.weight>0?_ctx.fmtWt(topPR.weight,false,topPR.weightType):'—'}</div><div class="card-footer-lbl">Top PR</div></div>
          </div>
        </div>
        <button class="card-export-btn" onclick="exportCallingCard()">⬇ EXPORT CARD AS PNG</button>
      </div>
    </div>
  </div>
</div>`;
}

export function exportCallingCard(){
  const {stats,gamification}=_ctx;
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
  const streaks=computeStreaks(_ctx.cfg,_ctx.sessions);
  const prog=getLevelProgress(xp,lv);
  const W=360,H=520;
  const canvas=document.createElement('canvas');
  canvas.width=W*2;canvas.height=H*2;
  const ctx=canvas.getContext('2d');
  ctx.scale(2,2);
  const bg=ctx.createLinearGradient(0,0,W,H);bg.addColorStop(0,'#0a0a0a');bg.addColorStop(1,'#1a1010');
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
  const accentColor=getComputedStyle(document.body).getPropertyValue('--accent').trim()||'#e8271f';
  const barGrad=ctx.createLinearGradient(0,0,W,0);barGrad.addColorStop(0,accentColor);barGrad.addColorStop(1,accentColor+'88');
  ctx.fillStyle=barGrad;ctx.fillRect(0,0,W,4);
  const radGrad=ctx.createRadialGradient(W,0,0,W,0,200);radGrad.addColorStop(0,accentColor+'25');radGrad.addColorStop(1,'transparent');
  ctx.fillStyle=radGrad;ctx.fillRect(0,0,W,H);
  ctx.font='bold 28px serif';ctx.fillStyle='#fff';ctx.fillText(archData?archData.icon:'❓',20,54);
  ctx.font='bold 15px Arial';ctx.fillStyle='#fff';ctx.fillText((archData?archData.name:'UNKNOWN').toUpperCase(),58,48);
  ctx.font='10px Arial';ctx.fillStyle='#888';ctx.fillText(archData?archData.tagline:'Log 3+ sessions to discover your build',58,64);
  ctx.fillStyle=accentColor;_rrect(ctx,W-70,16,58,26,5);ctx.fill();
  ctx.font='bold 13px Arial';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText('LV '+lv,W-41,34);ctx.textAlign='left';
  ctx.font='bold 9px Arial';ctx.fillStyle='#555';ctx.fillText(tier.name+' TIER',20,90);
  ctx.font='9px Arial';ctx.fillStyle='#444';ctx.textAlign='right';ctx.fillText(xp.toLocaleString()+' XP',W-20,90);ctx.textAlign='left';
  ctx.fillStyle='#2a2a2a';_rrect(ctx,20,97,W-40,6,3);ctx.fill();
  ctx.fillStyle=accentColor;_rrect(ctx,20,97,Math.max(6,(W-40)*prog.pct/100),6,3);ctx.fill();
  const statDefs=[['PWR',ss.pwr,'#ef4444'],['VOL',ss.vol,'#f59e0b'],['END',ss.end,'#22c55e'],['GRN',ss.grn,accentColor],['CNS',ss.cns,'#3b82f6']];
  let sy=118;
  statDefs.forEach(([lbl,val,clr])=>{
    ctx.font='bold 8px Arial';ctx.fillStyle='#666';ctx.fillText(lbl,20,sy+7);
    ctx.fillStyle='#2a2a2a';_rrect(ctx,54,sy,W-96,8,4);ctx.fill();
    if(val>0){ctx.fillStyle=clr;_rrect(ctx,54,sy,(W-96)*val/100,8,4);ctx.fill();}
    ctx.font='bold 9px Arial';ctx.fillStyle='#777';ctx.textAlign='right';ctx.fillText(String(val),W-20,sy+8);ctx.textAlign='left';
    sy+=18;
  });
  sy+=6;ctx.fillStyle='#222';ctx.fillRect(20,sy,W-40,1);sy+=14;
  if(displayBadges.length>0){
    ctx.font='22px serif';
    displayBadges.forEach((b,i)=>{ctx.fillText(b.icon,20+i*38,sy+22);});
    sy+=36;
  } else {
    ctx.font='10px Arial';ctx.fillStyle='#333';ctx.fillText('Earn accolades to show here',20,sy+14);sy+=22;
  }
  sy+=8;ctx.fillStyle='#1e1e1e';ctx.fillRect(20,sy,W-40,1);sy+=14;
  const footStats=[['SESSIONS',String(stats.total||0)],['BEST STREAK',String(streaks.longest)],['TOP PR',topPR.weight>0?_ctx.fmtWt(topPR.weight,false,topPR.weightType):'—']];
  const colW=(W-40)/3;
  footStats.forEach(([label,val],i)=>{
    const cx=20+i*colW+colW/2;
    ctx.font='bold 14px Arial';ctx.fillStyle='#eee';ctx.textAlign='center';ctx.fillText(val,cx,sy+14);
    ctx.font='7px Arial';ctx.fillStyle='#444';ctx.fillText(label,cx,sy+25);
  });
  ctx.textAlign='left';
  ctx.font='bold 8px Arial';ctx.fillStyle='#2a2a2a';ctx.letterSpacing='3px';
  ctx.fillText('FORGE FITNESS JOURNAL',20,H-12);
  const a=document.createElement('a');a.download='forge-card.png';a.href=canvas.toDataURL('image/png');a.click();
  _ctx.toast('Card exported ✓');
}

function machById(id){return (_ctx.machines||[]).find(m=>m.id===id);}

export function exportSessionCard(id){
  const {sessions,stats}=_ctx;
  const s=sessions.find(x=>String(x.id)===String(id));
  if(!s){_ctx.toast('Session not found');return;}
  const accentColor=getComputedStyle(document.body).getPropertyValue('--accent').trim()||'#e8271f';
  const exList=s.exercises||[];
  const hasCardio=!!(s.cardio&&s.cardio.machine);
  const hasNotes=!!s.notes;
  const totalSets=exList.reduce((a,ex)=>a+(ex.repsLog||[]).length,0);
  const totCal=sessionTotalCal(s);
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
  const H=Math.max(300,
    94+16+56+16+24+exList.length*exRowH+(hasCardio?56:0)+(hasNotes?46:0)+48
  );
  const canvas=document.createElement('canvas');
  canvas.width=W*2;canvas.height=H*2;
  const ctx=canvas.getContext('2d');
  ctx.scale(2,2);
  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#0d0d0d');bg.addColorStop(1,'#0a0a12');
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
  const radGrad=ctx.createRadialGradient(W,0,0,W,0,240);
  radGrad.addColorStop(0,accentColor+'18');radGrad.addColorStop(1,'transparent');
  ctx.fillStyle=radGrad;ctx.fillRect(0,0,W,H);
  const barGrad=ctx.createLinearGradient(0,0,W,0);
  barGrad.addColorStop(0,accentColor);barGrad.addColorStop(0.55,accentColor+'99');barGrad.addColorStop(1,'transparent');
  ctx.fillStyle=barGrad;ctx.fillRect(0,0,W,5);
  ctx.font='700 8px Inter,Arial';ctx.fillStyle='#333';
  if(ctx.letterSpacing!==undefined)ctx.letterSpacing='3px';
  ctx.fillText('FORGE FITNESS JOURNAL',PADX,22);
  if(ctx.letterSpacing!==undefined)ctx.letterSpacing='0px';
  ctx.font='bold 26px Inter,Arial';ctx.fillStyle='#f0f0f0';
  ctx.fillText(dotw(s.date).toUpperCase(),PADX,56);
  ctx.font='11px Inter,Arial';ctx.fillStyle='#4a4a4a';
  ctx.fillText(fmtDate(s.date),PADX,72);
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
    if(i<nStats-1){ctx.fillStyle='#222';ctx.fillRect(PADX+i*statColW+statColW,sy+4,1,28);}
  });
  ctx.textAlign='left';
  sy+=56;
  ctx.fillStyle='#1c1c1c';ctx.fillRect(PADX,sy,W-PADX*2,1);sy+=16;
  ctx.font='700 8px Inter,Arial';ctx.fillStyle=accentColor;
  if(ctx.letterSpacing!==undefined)ctx.letterSpacing='2.5px';
  ctx.fillText('EXERCISES',PADX,sy+11);
  if(ctx.letterSpacing!==undefined)ctx.letterSpacing='0px';
  sy+=24;
  exList.forEach((ex,idx)=>{
    const k=(ex.group||'')+'::'+ex.name;
    const isPR=sessionPRKeys.has(k);
    const rowY=sy;
    if(idx%2===0){ctx.fillStyle='#ffffff06';ctx.fillRect(PADX-8,rowY,W-PADX*2+16,exRowH);}
    ctx.font='600 12px Inter,Arial';ctx.fillStyle='#e0e0e0';
    ctx.fillText(ex.name,PADX,rowY+15);
    if(isPR){
      const nameW=ctx.measureText(ex.name).width;
      const tX=PADX+nameW+7;const tY=rowY+3;const tW=20;const tH=13;
      ctx.fillStyle=accentColor;
      ctx.beginPath();ctx.roundRect?ctx.roundRect(tX,tY,tW,tH,3):ctx.rect(tX,tY,tW,tH);ctx.fill();
      ctx.font='bold 7px Inter,Arial';ctx.fillStyle='#000';
      ctx.textAlign='center';ctx.fillText('PR',tX+tW/2,tY+9);ctx.textAlign='left';
    }
    const wtStr=_ctx.fmtWt(ex.weight,false,ex.weightType);
    ctx.font='bold 13px Inter,Arial';ctx.fillStyle=accentColor;
    ctx.textAlign='right';ctx.fillText(wtStr,W-PADX,rowY+15);ctx.textAlign='left';
    const repsStr=(ex.repsLog||[]).join(', ');
    const detailStr=ex.scheme+(repsStr?' · '+repsStr:'');
    ctx.font='10px Inter,Arial';ctx.fillStyle='#404040';
    ctx.fillText(detailStr,PADX,rowY+30);
    if(idx<exList.length-1){ctx.fillStyle='#1e1e1e';ctx.fillRect(PADX,rowY+exRowH-1,W-PADX*2,1);}
    sy+=exRowH;
  });
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
  if(hasNotes){
    sy+=10;
    ctx.font='italic 10px Inter,Arial';ctx.fillStyle='#383838';
    const note='"'+s.notes+'"';
    ctx.fillText(note.length>72?note.slice(0,69)+'…"':note,PADX,sy+14);
    sy+=30;
  }
  sy+=14;
  ctx.fillStyle='#1a1a1a';ctx.fillRect(PADX,sy,W-PADX*2,1);sy+=10;
  ctx.font='700 7px Inter,Arial';ctx.fillStyle='#272727';
  if(ctx.letterSpacing!==undefined)ctx.letterSpacing='3px';
  ctx.textAlign='center';ctx.fillText('FORGE FITNESS JOURNAL',W/2,sy+14);
  ctx.textAlign='left';
  if(ctx.letterSpacing!==undefined)ctx.letterSpacing='0px';
  const datePart=s.date||'session';
  const a=document.createElement('a');a.download=`forge-session-${datePart}.png`;a.href=canvas.toDataURL('image/png');a.click();
  _ctx.toast('Session exported ✓');
}

function _rrect(ctx,x,y,w,h,r){
  if(w<2*r)r=w/2;if(h<2*r)r=h/2;
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
}

export function showBadgeToast(badge){
  const c={bronze:'#cd7f32',silver:'#94a3b8',gold:'#f59e0b',platinum:'#a5b4fc'}[badge.tier]||'var(--accent)';
  _ctx.toastHtml(`<span style="font-size:16px">${badge.icon}</span>&nbsp;<span style="color:${c};font-weight:700">${esc(badge.name)}</span>&nbsp;<span style="color:var(--text2);font-size:10px">Unlocked!</span>`,3500);
}
export function showBadgeDetail(id){
  const {gamification}=_ctx;
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

export function showLevelUpModal(newLevel){
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
