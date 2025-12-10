// Gamified reagents simulation
const pKa1 = 2.34, pKa2 = 9.60;
const expected_pI = (pKa1 + pKa2)/2;
const gly_mmol_in = document.getElementById('glycine_mmol') || {value:10};
const vol_ml_in = document.getElementById('vol_ml');
const burette = document.getElementById('burette');
const added_mL = document.getElementById('added_mL');
const ph_read = document.getElementById('ph_read');
const curve = document.getElementById('curve');
const ctx = curve.getContext('2d');
const liquidLayer = document.getElementById('liquid-layer');
const logTable = document.querySelector('#log_table tbody');
const scoreEl = document.getElementById('score');
const tasksEl = document.getElementById('tasks');
const message = document.getElementById('message');
const startBtn = document.getElementById('start_experiment');
const stopBtn = document.getElementById('stop_experiment');
const add01 = document.getElementById('add01');
const autoBtn = document.getElementById('auto');
const stirBtn = document.getElementById('stir');
const exportBtn = document.getElementById('export');
const recordBtn = document.getElementById('record') || document.createElement('button');
const achStart = document.getElementById('ach_start');
const achFirst = document.getElementById('ach_first');
const achPi = document.getElementById('ach_pi');
let recorded = []; let score = 0; let tasks = 0;
let running = false; let autoInterval = null;

// internal solution state (mmol)
let beaker = {volume_mL: parseFloat(vol_ml_in.value || 50), gly_mmol: 0, naoh_mmol: 0};
// titrant concentration for NaOH bottle default 0.1 M
const naoh_M = 0.1;

// utility
function setControlsEnabled(enabled){
  burette.disabled = !enabled;
  add01.disabled = !enabled;
  autoBtn.disabled = !enabled;
  stirBtn.disabled = !enabled;
  exportBtn.disabled = !enabled;
  document.querySelectorAll('.reagent .pour').forEach(b=>b.disabled = !enabled);
  document.querySelectorAll('.reagent').forEach(r=> r.draggable = enabled);
}

setControlsEnabled(false);
updateUI();

// Start/Stop
startBtn.addEventListener('click', ()=>{
  running = true; startBtn.disabled = true; stopBtn.disabled = false;
  setControlsEnabled(true);
  achStart.innerText = 'Started'; achStart.style.background='#e6f9ff';
  message.innerText = 'Experiment started. Add reagents by dragging or pouring.';
});

stopBtn.addEventListener('click', ()=>{
  running = false; startBtn.disabled = false; stopBtn.disabled = true;
  setControlsEnabled(false);
  if(autoInterval){ clearInterval(autoInterval); autoInterval=null; autoBtn.innerText='Auto'; }
  message.innerText = 'Experiment stopped.';
});

// Drag & drop reagents onto beaker
document.querySelectorAll('.reagent').forEach(r=>{
  r.addEventListener('dragstart', (e)=> { e.dataTransfer.setData('text/plain', JSON.stringify({name: r.dataset.name})); });
});
const beakerArea = document.getElementById('beaker-area');
beakerArea.addEventListener('dragover', (e)=> e.preventDefault());
beakerArea.addEventListener('drop', (e)=>{
  e.preventDefault();
  const data = JSON.parse(e.dataTransfer.getData('text/plain'));
  pourReagentByName(data.name, true);
});

// Pour button handlers
document.querySelectorAll('.reagent .pour').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const parent = btn.closest('.reagent');
    const name = parent.dataset.name;
    const vol = parseFloat(btn.dataset.volume);
    pourReagentByName(name, false, vol);
  });
});

function pourAnimation(){
  const anim = document.getElementById('pour-animation');
  anim.hidden = false;
  anim.style.top = '0px';
  anim.style.opacity = '1';
  setTimeout(()=>{ anim.style.top = '120px'; anim.style.opacity = '0.2'; }, 250);
  setTimeout(()=>{ anim.hidden = true; }, 520);
}

// Pouring logic: name, dragged flag, requested volume (mL)
function pourReagentByName(name, dragged=false, vol=null){
  if(!running){ message.innerText = 'Start the experiment first.'; return; }
  pourAnimation();
  if(name==='glycine'){
    // if vol null -> assume entire vial adds gly_mmol in dataset; else scale
    const vial_mmol = parseFloat(document.querySelector('.reagent[data-name="glycine"]').dataset.mmol);
    const add_mmol = vol ? (vial_mmol * (vol/100.0)) : vial_mmol;
    beaker.gly_mmol += add_mmol;
    beaker.volume_mL += vol || 10;
    message.innerText = `Added ${add_mmol.toFixed(2)} mmol glycine.`;
    addScore(10); document.getElementById('t1').classList.add('done'); achFirst.innerText='Prepared'; achFirst.style.background='#e6f9ff';
  } else if(name==='naoh'){
    const v = vol || 1.0;
    const added_mmol = naoh_M * v; // M * mL = mmol (since M = mmol/mL here as convention)
    beaker.naoh_mmol += added_mmol;
    beaker.volume_mL += v;
    message.innerText = `Added ${v.toFixed(2)} mL NaOH (${added_mmol.toFixed(3)} mmol).`;
    // if poured directly, reflect on burette reading as well
    burette.value = Math.min(50, parseFloat(burette.value) + v);
    added_mL.innerText = parseFloat(burette.value).toFixed(2);
    addScore(5); document.getElementById('t2').classList.add('done');
  } else if(name==='water'){
    const w = vol || 20;
    beaker.volume_mL += w;
    message.innerText = `Added ${w.toFixed(1)} mL water.`;
    addScore(2);
  }
  updateSolutionState();
  updateUI();
}

// Stir action: mixes and slightly speeds pH equilibration
stirBtn.addEventListener('click', ()=>{
  if(!running){ message.innerText='Start first'; return; }
  message.innerText = 'Stirring... equilibrating.';
  // visual stir: rotate stirrer briefly
  const stirEl = document.querySelector('.stirrer-img');
  stirEl.style.transition = 'transform 0.4s linear';
  stirEl.style.transform = 'rotate(360deg)';
  setTimeout(()=>{ stirEl.style.transform='rotate(0deg)'; }, 420);
  // slight score bump
  addScore(3);
  updateSolutionState();
  updateUI();
});

// Burette controls: update added_mL and solution when user moves slider
burette.addEventListener('input', ()=>{
  if(!running) return;
  const v = parseFloat(burette.value);
  added_mL.innerText = v.toFixed(2);
  // compute incremental added since previous recorded total by reading beaker.naoh_mmol
  // For simplicity, treat burette as adding NaOH instantly to solution
  const totalNaOHAdded_mmol = naoh_M * v;
  // set beaker.naoh_mmol to totalNaOHAdded_mmol (plus any poured)
  beaker.naoh_mmol = totalNaOHAdded_mmol;
  updateSolutionState();
  updateUI();
});

add01.addEventListener('click', ()=>{ if(!running) return; burette.value = Math.min(50, parseFloat(burette.value) + 0.1); burette.dispatchEvent(new Event('input')); });

// Auto titrate
autoBtn.addEventListener('click', ()=>{
  if(autoInterval){ clearInterval(autoInterval); autoInterval=null; autoBtn.innerText='Auto'; return; }
  autoBtn.innerText='Stop';
  autoInterval = setInterval(()=>{ if(parseFloat(burette.value) >= 50){ clearInterval(autoInterval); autoInterval=null; autoBtn.innerText='Auto'; } else { burette.value = Math.min(50, parseFloat(burette.value) + 0.2); burette.dispatchEvent(new Event('input')); } }, 120);
});

// compute pH using previous solver approach (approx)
function computePHFromBeaker(){
  const gly_mmol = beaker.gly_mmol;
  const vol_mL = beaker.volume_mL;
  const nOH_mmol = beaker.naoh_mmol;
  const pKa1 = 2.34, pKa2 = 9.60;
  // same logic as earlier computePH but using current beaker numbers
  let n_gly = gly_mmol;
  let n_H2A=0,n_HA=0,n_A=0;
  if(nOH_mmol <= n_gly){
    n_H2A = n_gly - nOH_mmol; n_HA = nOH_mmol; n_A = 0;
  } else if(nOH_mmol <= 2*n_gly){
    n_H2A = 0; n_HA = 2*n_gly - nOH_mmol; n_A = nOH_mmol - n_gly;
  } else {
    n_H2A = 0; n_HA = 0; n_A = n_gly;
  }
  const V_L = vol_mL/1000.0;
  const Ka1 = Math.pow(10, -pKa1), Ka2 = Math.pow(10, -pKa2);
  const c_H2A = (n_H2A/1000)/V_L;
  const c_HA = (n_HA/1000)/V_L;
  const c_A = (n_A/1000)/V_L;
  let pH = 7.0;
  if(c_H2A>0 && c_HA>0){
    pH = pKa1 + Math.log10((c_HA+1e-16)/(c_H2A+1e-16));
  } else if(c_HA>0 && c_A>0){
    pH = pKa2 + Math.log10((c_A+1e-16)/(c_HA+1e-16));
  } else if(c_HA>0 && c_H2A===0 && c_A===0){
    pH = 0.5*(pKa1 + pKa2);
  } else if(c_A>0 && nOH_mmol > 2*n_gly){
    const excessOH_mmol = nOH_mmol - 2*n_gly;
    const conc_OH = (excessOH_mmol/1000)/V_L;
    pH = 14 + Math.log10(conc_OH);
  } else if(c_H2A>0 && nOH_mmol===0){
    let c = c_H2A;
    let x = Math.sqrt(Ka1 * c);
    let H = x; pH = -Math.log10(H);
  }
  if(!isFinite(pH) || isNaN(pH)) pH = 7.0;
  return pH;
}

function updateSolutionState(){
  // after any change, recompute pH and maybe mark tasks
  const pH = computePHFromBeaker();
  ph_read.innerText = pH.toFixed(2);
  // if first record not done and glycine exists and water added, mark prepared
  if(beaker.gly_mmol > 0 && beaker.volume_mL > 10){ document.getElementById('t1').classList.add('done'); tasks = Math.max(tasks,1); tasksEl.innerText = tasks; updateProgress(); }
  // if NaOH present mark t2
  if(beaker.naoh_mmol > 0){ document.getElementById('t2').classList.add('done'); tasks = Math.max(tasks,2); tasksEl.innerText = tasks; updateProgress(); }
  // if pH near pI mark achievement
  if(Math.abs(pH - expected_pI) < 0.3){ achPi.innerText = 'Near pI'; achPi.style.background='#e6f9ff'; addScore(20); document.getElementById('t3').classList.add('done'); tasks = Math.max(tasks,3); tasksEl.innerText = tasks; updateProgress(); }
  drawCurve();
}

// UI update
function updateUI(){
  // liquid visual scale based on volume (capped)
  const frac = Math.min(1, beaker.volume_mL / 200.0);
  liquidLayer.style.transform = `translateY(${(1 - frac) * 28}px) scale(${0.8 + frac*0.6})`;
  // update score display
  scoreEl.innerText = score;
  tasksEl.innerText = tasks;
}

// logging
function logReading(action='manual'){
  const tr = document.createElement('tr');
  const time = new Date().toLocaleTimeString();
  const added = parseFloat(burette.value) || 0;
  const pH = computePHFromBeaker();
  tr.innerHTML = `<td>${time}</td><td>${added.toFixed(2)}</td><td>${pH.toFixed(2)}</td><td>${action}</td>`;
  logTable.appendChild(tr);
  updateProgress();
}
document.getElementById('clear_log').addEventListener('click', ()=>{ logTable.innerHTML=''; });

// export CSV
document.getElementById('export').addEventListener('click', ()=>{
  let rows = [['time','added_mL','pH','action']];
  document.querySelectorAll('#log_table tbody tr').forEach(tr=>{ const cols = Array.from(tr.querySelectorAll('td')).map(td=>td.innerText); rows.push(cols); });
  const csv = rows.map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'glycine_log.csv'; a.click(); URL.revokeObjectURL(url);
});

// record button (in header of previous version) - we will add logging on +/- events
document.getElementById('burette').addEventListener('change', ()=>{ if(running) logReading('burette adjust'); });

document.getElementById('submit_guess').addEventListener('click', ()=>{
  const guess = parseFloat(document.getElementById('guess_pI').value);
  if(isNaN(guess)){ message.innerText = 'Enter numeric pI'; return; }
  const pH = computePHFromBeaker();
  const diff = Math.abs(guess - expected_pI);
  if(diff < 0.2){ message.innerText = `Excellent! pI ≈ ${expected_pI.toFixed(2)}.`; addScore(50); document.getElementById('t3').classList.add('done'); }
  else if(diff < 0.6){ message.innerText = `Close — actual pI ≈ ${expected_pI.toFixed(2)}`; addScore(10); }
  else { message.innerText = 'Not close, try again.'; addScore(-5); }
  updateProgress();
});

// scoring animation helper
function addScore(delta){
  const old = score; const target = old + delta;
  const steps = 8; let i=0;
  const iv = setInterval(()=>{ i++; score = Math.round(old + (target-old)*(i/steps)); scoreEl.innerText = score; if(i>=steps){ clearInterval(iv); score = target; scoreEl.innerText = score; } }, 40);
}

// progress bar update
function updateProgress(){
  const total = 3; const done = Math.min(total, document.querySelectorAll('.done').length);
  const pct = Math.round((done/total)*100);
  document.getElementById('progress').style.width = pct + '%';
}

// initial draw
updateSolutionState();
updateUI();
drawCurve();

// draw titration curve approximation for preview
function drawCurve(){
  ctx.clearRect(0,0,curve.width,curve.height);
  ctx.strokeStyle='rgba(11,111,182,0.15)'; ctx.lineWidth=1;
  for(let i=0;i<6;i++){ ctx.beginPath(); ctx.moveTo(0,i*(curve.height/5)); ctx.lineTo(curve.width,i*(curve.height/5)); ctx.stroke(); }
  // sample using current beaker values
  const gly = beaker.gly_mmol || 10;
  const vol = beaker.volume_mL || 50;
  const maxAdd = 2 * Math.max(1,gly);
  const titrantM = naoh_M;
  ctx.beginPath(); ctx.lineWidth=2; ctx.strokeStyle='#66d1ff';
  for(let i=0;i<=200;i++){
    const added = (i/200) * (maxAdd / titrantM);
    // approximate pH as earlier (reuse compute but local)
    const nOH_mmol = titrantM * added;
    let n_gly = gly; let n_H2A=0,n_HA=0,n_A=0;
    if(nOH_mmol <= n_gly){ n_H2A = n_gly - nOH_mmol; n_HA = nOH_mmol; n_A = 0; }
    else if(nOH_mmol <= 2*n_gly){ n_H2A=0; n_HA = 2*n_gly - nOH_mmol; n_A = nOH_mmol - n_gly; }
    else { n_H2A=0; n_HA=0; n_A=n_gly; }
    const V_L = (vol + added)/1000.0;
    const Ka1 = Math.pow(10,-pKa1), Ka2 = Math.pow(10,-pKa2);
    const c_H2A = (n_H2A/1000)/V_L; const c_HA = (n_HA/1000)/V_L; const c_A = (n_A/1000)/V_L;
    let pH = 7.0;
    if(c_H2A>0 && c_HA>0) pH = pKa1 + Math.log10((c_HA+1e-16)/(c_H2A+1e-16));
    else if(c_HA>0 && c_A>0) pH = pKa2 + Math.log10((c_A+1e-16)/(c_HA+1e-16));
    else if(c_HA>0 && c_H2A===0 && c_A===0) pH = 0.5*(pKa1 + pKa2);
    const x = (i/200) * curve.width; const y = curve.height - ((pH/14) * curve.height);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
}
