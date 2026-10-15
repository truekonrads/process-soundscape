// Shared: deterministic factory simulator, event log, nature soundscape, clock and common controls.
// Pages define: draw(), binMin, curBins, selMin (and optionally onSelect()).
const DAY=600,SEED=20261015,$=id=>document.getElementById(id);
const SIG=['materialsIn','produced','qaInspected','qaRejected','warehouse','trucksWaiting'];
const SIGLAB=['Materials in','Produced','QA inspected','QA rejected','Warehouse stock','Trucks waiting'];

// ---- deterministic simulator ----
function hash(a){a=(a^SEED)>>>0;a=Math.imul(a^a>>>16,0x45d9f3b);a=Math.imul(a^a>>>16,0x45d9f3b);return((a^a>>>16)>>>0)/4294967296}
const R=(m,k)=>hash(m*4096+k);
function pois(l,m,k){const L=Math.exp(-l);let p=1,n=-1;do{n++;p*=R(m,k*64+n)}while(p>L&&n<60);return n}
const ramp=(x,a,b)=>Math.min(1,Math.max(0,(x-a)/(b-a)));
const act=h=>h>=12&&h<12.75?.04:ramp(h,8,9)*(h<12?1:ramp(h,12.75,13.25))*(1-ramp(h,17.4,18));
const hhmm=m=>{const h=8+Math.floor(m/60),mm=m%60;return String(h).padStart(2,'0')+':'+String(mm).padStart(2,'0')};
const SHIFT={0:'Shift start',240:'Lunch break (planned)',285:'Lunch ends',564:'Wind-down (planned)'};
const ANAME={stop:'Line stoppage 10 min',qa:'QA reject spike',truck:'Pickup delay 30 min',drop:'Telemetry drop 10 min'};

let anoms=[],mins=[],evts=[],st;
const inA=(type,m,len,off=0)=>anoms.some(a=>a.type===type&&m>=a.s+off&&m<a.s+off+len);
// Rate sliders (logged as timed 'set' entries so replays are deterministic) and the controller that counteracts each.
const RATES={supply:['Supply rate','sup','order level'],jam:['Line jam rate','maint','maintenance'],reject:['QA reject rate','proc','process tuning'],trucks:['Truck calls','disp','dispatch']};
const setting=(k,m,d=1)=>{let v=d,s=-1;anoms.forEach(x=>{if(x.type==='set'&&x.key===k&&x.s<=m&&x.s>=s){s=x.s;v=x.v}});return v};
const RECIPE=2,TRUCK_CAP=100,TRUCK_EVERY=10; // materials per unit; units per truck; minutes between scheduled trucks
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
function reset(){st={buf:30,qaQ:0,wh:0,tq:[],dockFree:0,whHigh:false,sup:1,maint:1,proc:1,disp:1,jamE:.024,rejE:.008,tphase:.5,load:0,starveE:0,starving:false};mins=[];evts=[];simT=0;harmony=1;evShown=0;if($('events'))$('events').innerHTML=''}
function gen(m){
  const h=8+m/60,a=act(h),aq=act(h-.25); // QA runs ~15 min behind the lines
  const ev=(src,txt,alarm=false)=>evts.push({m,src,txt,alarm});
  const al={materialsIn:0,produced:0,qaInspected:0,warehouse:0,trucksWaiting:0};
  const H=setting('homeo',m),S=k=>setting(k,m),C=k=>H?st[k]:1;
  if(SHIFT[m])ev('Shift',SHIFT[m]);
  anoms.filter(x=>x.s===m).forEach(x=>x.type==='set'
    ?ev('Control',x.key==='homeo'?'Homeostatic control '+(x.v?'on':'off'):`${RATES[x.key][0]} set ×${x.v.toFixed(1)}`)
    :ev('Injected',ANAME[x.type]+(x.type==='drop'?' — '+SIGLAB[SIG.indexOf(x.key)]:'')));
  const burst=R(m,2)<.04*a*S('supply')*C('sup'),mi=pois(24*a*S('supply')*C('sup'),m,1)+(burst?36:0);st.buf+=mi;
  if(burst)ev('Materials','Bulk delivery +36');
  if(R(m,50)<.004*a){al.materialsIn++;ev('Materials','Damaged pallet on delivery',true)}
  const slow=inA('qa',m,30,8)?.55:1,stop=inA('stop',m,10); // reject spike causes later rework slowdown
  if(stop&&!inA('stop',m-1,10)){al.produced++;ev('Production','All lines stopped',true)}
  let jams=0,want=0;
  const lines=[0,1,2].map(l=>{
    if(stop)return 0;
    if(R(m,40+l)<.008*a*S('jam')*C('maint')){jams++;al.produced++;ev('Production',`Line ${l+1} jam (cleared)`,true);return 0}
    const w=pois(4*a*slow*(.85+.3*R(m,3+l)),m,10+l),n=Math.min(w,Math.floor(st.buf/RECIPE));want+=w;st.buf-=n*RECIPE;return n}); // each unit consumes RECIPE materials
  const prod=lines[0]+lines[1]+lines[2];st.qaQ+=prod;
  const starve=want?1-prod/want:0;st.starveE=.8*st.starveE+.2*starve;
  if(!st.starving&&st.starveE>.3){st.starving=true;al.produced++;ev('Production','Lines waiting for materials',true)}
  else if(st.starving&&st.starveE<.1){st.starving=false;ev('Production','Material flow restored')}
  const ins=Math.min(st.qaQ,pois(14*aq,m,20));st.qaQ-=ins;
  const p=Math.min(.9,(inA('qa',m,15)?.35:.008*S('reject'))*C('proc'));let rej=0;for(let i=0;i<ins;i++)if(R(m,3000+i)<p)rej++;
  if(rej){al.qaInspected=rej;ev('QA',`Rejected ×${rej} of ${ins}`,true)}
  st.wh+=ins-rej;
  if(h>=8.5&&h<17.75)st.tphase+=S('trucks')*C('disp')/TRUCK_EVERY; // trucks arrive on a fixed schedule
  if(st.tphase>=1){st.tphase-=1;st.tq.push(m);ev('Logistics',`Truck arrived (parking ${st.tq.length})`)}
  // one dock (staffed through lunch), loads from warehouse stock; a truck leaves only when full
  if(st.tq.length&&h>=8.5&&h<17.9&&!inA('truck',m,30)){const x=Math.min(st.wh,30,TRUCK_CAP-st.load);st.wh-=x;st.load+=x;
    if(st.load>=TRUCK_CAP){const t=st.tq.shift();st.load=0;ev('Logistics',`Truck departed full (on site ${m-t} min)`)}}
  st.tq.forEach(t=>{if(m-t===20){al.trucksWaiting++;ev('Logistics','Truck waiting > 20 min',true)}});
  if(st.wh>350!==st.whHigh){st.whHigh=st.wh>350;if(st.whHigh){al.warehouse++;ev('Warehouse','Stock above 350 (near capacity)',true)}}
  // homeostasis: slow integral controllers with clamped steps, so disturbances are absorbed over tens of minutes
  st.jamE=.97*st.jamE+.03*jams;if(ins)st.rejE=.95*st.rejE+.05*rej/ins;
  if(H){
    st.sup=clamp(st.sup+.02*clamp((120-st.buf)/120,-1,1),.2,2.5);                     // keep raw buffer near 120
    if(a>.5)st.maint=clamp(st.maint+.01*clamp((.024-st.jamE)/.024,-2,1),.15,1.5);   // keep jams near 1 per ~40 min
    if(ins)st.proc=clamp(st.proc+.01*clamp((.008-st.rejE)/.008,-3,1),.1,1.5);        // keep rejects near 0.8%
    st.disp=clamp(1+(st.wh-150)/400,.6,1.6);                                       // proportional: more trucks when stock is high
  }
  const valid={};SIG.forEach(k=>valid[k]=!anoms.some(x=>x.type==='drop'&&x.key===k&&m>=x.s&&m<x.s+10));
  anoms.filter(x=>x.type==='drop'&&x.s+10===m).forEach(x=>ev('Telemetry','Restored — '+SIGLAB[SIG.indexOf(x.key)]));
  return{m,timestamp:`2026-10-15T${hhmm(m)}:00`,windowSeconds:60,materialsIn:mi,produced:prod,qaInspected:ins,qaRejected:rej,
    warehouse:st.wh,trucksWaiting:st.tq.length,truckLoad:st.load,starve,lines,alarms:al,valid,ctl:{H,sup:st.sup,maint:st.maint,proc:st.proc,disp:st.disp}};
}

// ---- audio: ambient beds for normal flow (soothing), distinct strikes for faults (attention) ----
// Panned left→right along the material flow. Missing telemetry silences that voice.
let AC=null,master,wet,beds={},audioOn=false;
function initAudio(){
  AC=new AudioContext();master=AC.createGain();master.gain.value=+$('vol').value;master.connect(AC.destination);
  const len=AC.sampleRate*3,ir=AC.createBuffer(2,len,AC.sampleRate); // generated reverb impulse
  for(let c=0;c<2;c++){const d=ir.getChannelData(c);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3)}
  const cv=AC.createConvolver();cv.buffer=ir;wet=AC.createGain();wet.gain.value=.5;wet.connect(cv).connect(master);
  const noise=brown=>{const b=AC.createBuffer(1,AC.sampleRate*4,AC.sampleRate),d=b.getChannelData(0);let l=0;
    for(let i=0;i<d.length;i++){const w=Math.random()*2-1;l=(l+.02*w)/1.02;d[i]=brown?l*3.5:w}
    const s=AC.createBufferSource();s.buffer=b;s.loop=true;s.start();return s};
  const lfo=(f,amt,param)=>{const o=AC.createOscillator(),g=AC.createGain();o.frequency.value=f;g.gain.value=amt;o.connect(g).connect(param);o.start()};
  const bed=pan=>{const g=AC.createGain();g.gain.value=0;const p=AC.createStereoPanner();p.pan.value=pan;g.connect(p);p.connect(master);p.connect(wet);return g};
  const filt=(type,f,q)=>{const b=AC.createBiquadFilter();b.type=type;b.frequency.value=f;b.Q.value=q;return b};
  beds.brook=bed(-.7);{const bp=filt('bandpass',900,.8);lfo(.23,300,bp.frequency);noise(false).connect(bp).connect(beds.brook)} // materials
  beds.pad=bed(0);beds.padLP=filt('lowpass',400,.5);beds.padLP.connect(beds.pad);lfo(.05,120,beds.padLP.frequency);       // production
  beds.padOsc=CHORDS[0].map(f=>[-5,5].map(dt=>{const o=AC.createOscillator();o.type='triangle';o.frequency.value=f;o.detune.value=dt;o.connect(beds.padLP);o.start();return o}));
  beds.diss=bed(.1);{const lp=filt('lowpass',900,.7);lp.connect(beds.diss);beds.dissOsc=[1.06,Math.SQRT2].map(r=>{const o=AC.createOscillator();o.type='sawtooth';o.frequency.value=146.83*r;o.connect(lp);o.start();return o})} // strain drone
  setInterval(conductor,100);
  beds.wind=bed(.8);{const bp=filt('bandpass',450,.6);lfo(.07,250,bp.frequency);noise(true).connect(bp).connect(beds.wind)} // truck queue
}
function bus(pan,w=.6){const p=AC.createStereoPanner();p.pan.value=pan;const d=AC.createGain();d.gain.value=1-w*.5;p.connect(d).connect(master);const s=AC.createGain();s.gain.value=w;p.connect(s).connect(wet);return p}
function env(t,peak,att,dec,dest){const g=AC.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak,t+att);g.gain.exponentialRampToValueAtTime(1e-4,t+att+dec);g.connect(dest);return g}
function osc(type,f,t,dur,dest){const o=AC.createOscillator();o.type=type;o.frequency.setValueAtTime(f,t);o.connect(dest);o.start(t);o.stop(t+dur);return o}
// Flow harmony (0..1) from material shortage, parking crowding and reject ratio. High → a gentle I–vi–IV–V progression,
// notes on the beat and on chord tones, soft bass. Low → progression stalls, pad detunes, a dissonant drone rises, notes drift off key/beat.
const CHORDS=[[146.83,220,293.66,369.99],[123.47,185,246.94,293.66],[98,146.83,196,246.94],[110,164.81,220,277.18]],BEAT=60/66;
let harmony=1,chord=0,nextBar=0,padLevel=0;
const strainOf=s=>clamp(1.2*s.starve+.15*Math.max(0,s.trucksWaiting-2)+(s.qaInspected?6*s.qaRejected/s.qaInspected:0)+(s.alarms.produced?.2:0),0,1);
function conductor(){
  if(!AC||!audioOn)return;if(nextBar<AC.currentTime)nextBar=AC.currentTime+.05;
  while(nextBar<AC.currentTime+.3){const t=nextBar,h=harmony;
    if(h>.55)chord=(chord+1)%4;const c=CHORDS[chord];
    beds.padOsc.forEach((pr,i)=>pr.forEach((o,j)=>{o.frequency.setTargetAtTime(c[i],t,.4);o.detune.setTargetAtTime((j?1:-1)*(4+45*(1-h)),t,1)}));
    beds.dissOsc.forEach((o,i)=>o.frequency.setTargetAtTime(c[0]*[1.06,Math.SQRT2][i],t,.4));beds.diss.gain.setTargetAtTime(.025*Math.pow(1-h,1.5),t,1.5);
    if(h>.7&&padLevel>.1)osc('sine',c[0],t,3,env(t,.07*padLevel,.01,2.6,bus(0,.5)));
    nextBar+=4*BEAT}
}
const SND={
  drop(t){const f=500+Math.random()*600,o=osc('sine',f,t,.2,env(t,.06,.004,.12,bus(-.75,.8)));o.frequency.exponentialRampToValueAtTime(f*2.2,t+.05)},
  kalimba(t,l){let f=CHORDS[chord][Math.random()*4|0]*[2,2,4][l];if(Math.random()<.8*(1-harmony))f*=Math.pow(2,((Math.random()*11|0)+1+Math.random()*.6-.3)/12);
    if(harmony>.6)t=Math.ceil(t/(BEAT/2))*(BEAT/2); // on the half-beat when flow is healthy
    const p=bus([-.3,0,.3][l],.7);
    osc('sine',f,t,1.6,env(t,[.06,.045,.025][l],.006,1.4,p));osc('sine',f*5.4,t,.3,env(t,.008,.002,.2,p))},
  cricket(t){const p=bus(.45,.9);for(let i=0;i<3;i++){const s=t+i*.035;osc('sine',3600,s,.03,env(s,.006,.005,.02,p))}},
  knock(t){const p=bus(.45,.25);[0,.13].forEach(d=>{const o=osc('sine',560,t+d,.15,env(t+d,.22,.002,.09,p));o.frequency.exponentialRampToValueAtTime(380,t+d+.08);
    osc('triangle',1400,t+d,.04,env(t+d,.05,.001,.03,p))})}, // QA reject: wood knock
  bell(t,pan){const p=bus(pan,.45);[[1,.11,3],[2.76,.05,2],[5.4,.025,1],[8.9,.012,.6]].forEach(([r,g,d])=>osc('sine',830.6*r,t,d+.1,env(t,g,.003,d,p)))} // other alarms: off-key bowl
};
function playMinute(s,t0,D){ // continuous beds follow rates; sparse notes thinned to a per-second cap
  if(!AC||!audioOn)return;
  const at=()=>t0+Math.random()*D,thin=(n,cap)=>Math.min(n,Math.max(n?1:0,Math.round(cap*D))),
    n1=x=>Math.min(1,x),set=(g,v)=>g.setTargetAtTime(v,t0,D/2+.3),V=s.valid,pn=n1(s.produced/16);
  set(beds.brook.gain,V.materialsIn?.1*n1(s.materialsIn/20):0);
  padLevel=V.produced?pn:0;set(beds.pad.gain,V.produced?.004+.014*pn:0);set(beds.padLP.frequency,250+1100*pn);
  set(beds.wind.gain,V.trucksWaiting?.015+.3*n1(s.trucksWaiting/6):0);
  if(V.materialsIn)for(let i=thin(s.materialsIn,.4);i--;)SND.drop(at());
  if(V.produced)s.lines.forEach((n,l)=>{for(let i=thin(n,.25);i--;)SND.kalimba(at(),l)});
  if(V.qaInspected){const n=thin(s.qaInspected,1);for(let i=0;i<n;i++)SND.cricket(t0+(i+.5)*D/n)} // even cadence: absence is audible
  if(V.qaRejected)for(let i=thin(s.qaRejected,1);i--;)SND.knock(at());
  const al=s.alarms;[['materialsIn',-.7],['produced',0],['warehouse',.5],['trucksWaiting',.8]].forEach(([k,p])=>{for(let i=Math.min(al[k],2);i--;)SND.bell(at(),p)});
}

// ---- clock, event grid & controls ----
let simT=0,playing=false,speed=60,last=0,replayUntil=0,evShown=0,dirty=true;
function advance(to){
  to=Math.min(DAY,to);
  while(mins.length<Math.floor(to)){const s=gen(mins.length);mins.push(s);
    harmony+=.25*(1-strainOf(s)-harmony);
    if(AC&&to-s.m<3&&AC.currentTime>replayUntil)playMinute(s,AC.currentTime+.05,60/speed)}
  simT=to;dirty=true;
}
function status(){
  $('clock').textContent=hhmm(Math.floor(simT))+(playing?'':' ⏸');
  const s=mins[mins.length-1],miss=s?SIG.filter(k=>!s.valid[k]).map(k=>SIGLAB[SIG.indexOf(k)]):[];
  $('telem').textContent=miss.length?'Telemetry unavailable: '+miss.join(', '):'';
  if($('harm'))$('harm').textContent=`flow harmony ${harmony.toFixed(2)}`;
  if(s&&$('rates'))Object.entries(RATES).forEach(([k,[,c,cl]])=>$('rc-'+k).textContent=s.ctl.H?`${cl} ×${s.ctl[c].toFixed(2)}`:'control off');
}
function grid(){ // newest first
  const el=$('events');if(!el||evShown>=evts.length)return;
  const f=document.createDocumentFragment();
  for(;evShown<evts.length;evShown++){const e=evts[evShown],tr=document.createElement('tr');
    tr.className=e.alarm?'alarm':'';tr.dataset.m=e.m;tr.innerHTML=`<td>${hhmm(e.m)}</td><td>${e.src}</td><td>${e.txt}</td>`;f.prepend(tr)}
  el.prepend(f);
}
function frame(ts){
  const dt=last?Math.min(.5,(ts-last)/1000):0;last=ts;
  if(playing){advance(simT+dt*speed/60);if(simT>=DAY){playing=false;$('play').textContent='▶ Start'}}
  if(dirty){draw();status();grid()}
  requestAnimationFrame(frame);
}
function log(t){const li=document.createElement('li');li.textContent=t;$('log').prepend(li)}
$('play').onclick=()=>{if(simT>=DAY)reset();playing=!playing;$('play').textContent=playing?'⏸ Pause':'▶ Start';dirty=true};
$('restart').onclick=()=>{reset();playing=true;$('play').textContent='⏸ Pause';log('Day replayed (same seed, same injections)')};
$('speed').onchange=e=>speed=+e.target.value;
SIG.forEach((k,i)=>$('dropKey').add(new Option(SIGLAB[i],k)));
document.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{
  const s=Math.floor(simT)+1,type=b.dataset.a,key=$('dropKey').value;
  if(s>=DAY)return;anoms.push({type,s,key});log(`${hhmm(s)} injected: ${ANAME[type]}${type==='drop'?' ('+SIGLAB[SIG.indexOf(key)]+')':''}`);
});
$('audioBtn').onclick=async()=>{
  if(!AC)initAudio();audioOn=!audioOn;
  if(audioOn)await AC.resume();else await AC.suspend(); // mute stops immediately
  $('audioBtn').textContent=audioOn?'🔊 Mute':'🔈 Enable sound';
};
$('vol').oninput=e=>{if(master)master.gain.setTargetAtTime(+e.target.value,AC.currentTime,.05)};
$('replaySel').onclick=async()=>{
  if(!audioOn)await $('audioBtn').onclick();
  const m0=selMin??(curBins.length?curBins[curBins.length-1].m:0),t=AC.currentTime+.1;
  for(let j=0;j<15&&mins[m0+j];j++)playMinute(mins[m0+j],t+j,1);
  replayUntil=t+15;
};
if($('rates')){ // rate sliders + homeostasis toggle (mudlog page)
  $('rates').innerHTML=Object.entries(RATES).map(([k,[lab,,cl]])=>`<label class="rate">${lab}<input type="range" min="0" max="4" step=".1" value="1" data-k="${k}"><b id="rv-${k}">×1.0</b><i id="rc-${k}" title="${cl}"></i></label>`).join('');
  const setAt=(key,v)=>{const s=mins.length;if(s<DAY)anoms.push({type:'set',s,key,v})};
  $('rates').querySelectorAll('input').forEach(i=>{
    i.oninput=()=>$('rv-'+i.dataset.k).textContent='×'+(+i.value).toFixed(1);
    i.onchange=()=>{setAt(i.dataset.k,+i.value);log(`${hhmm(mins.length)} ${RATES[i.dataset.k][0]} ×${(+i.value).toFixed(1)}`)}});
  $('homeo').onchange=e=>{setAt('homeo',e.target.checked?1:0);log(`${hhmm(mins.length)} homeostasis ${e.target.checked?'on':'off'}`)};
}
reset();
requestAnimationFrame(frame);
