let _ctx = null;
let _plateBar = 45;

export function initPlates(ctx) { _ctx = ctx; }

export function calcPlates(totalLbs, barLbs) {
  const PLATES = [45,35,25,10,5,2.5];
  const COLORS = {45:'#e8271f',35:'#3b6fff',25:'#f59e0b',10:'#22c55e',5:'#aaa',2.5:'#cd7f32'};
  let rem = Math.max(0,(totalLbs-barLbs)/2);
  const result = [];
  for(const p of PLATES){ while(rem>=p-0.001){ result.push({p,c:COLORS[p]}); rem=Math.round((rem-p)*100)/100; } }
  return result;
}

export function openPlateCalc(ei) {
  const w = _ctx.active ? _ctx.active.exercises[ei].weight : 0;
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)document.getElementById('modal-root').innerHTML=''">
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

export function setPlateBar(w, btn) {
  _plateBar = w;
  document.querySelectorAll('#plate-bar-pills .inc-pill').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderPlates();
}

export function renderPlates() {
  const t = parseFloat(document.getElementById('plate-target')?.value)||0;
  const res = document.getElementById('plate-result'); if(!res) return;
  if(!t){ res.innerHTML='<div class="plate-empty">Enter a weight above</div>'; return; }
  const plates = calcPlates(t, _plateBar);
  if(!plates.length){
    res.innerHTML=`<div class="plate-empty">${t<=_plateBar?'Bar only — no plates needed':'Weight equals bar'}</div>`; return;
  }
  const chips = plates.map(({p,c})=>`<div class="plate-chip" style="background:${c}22;border-color:${c};color:${c};">${p}</div>`).join('');
  res.innerHTML = `<div class="plate-side-lbl">Each side:</div><div class="plate-chips">${chips}</div>
    <div class="plate-total-row"><span class="plate-total-lbl">Bar (${_plateBar}) + 2 × ${plates.reduce((a,{p})=>a+p,0)} lbs = </span><span class="plate-total-val">${_plateBar+plates.reduce((a,{p})=>a+p,0)*2} lbs</span></div>`;
}
