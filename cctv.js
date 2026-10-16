// CCTV view: cartoon camera feeds of each factory area, driven by the simulator.
// Levels (piles, racks, parked trucks, belt motion) follow the latest minute; one-off moments
// (deliveries, rejects, jams, departures) come from the event log and play at a fixed real-time pace,
// capped so ×300 stays readable. Scenes are drawn in a 320×180 space and scaled to each camera cell.
const CCTV=(()=>{
const cv=$('cctv');
const K={wall:'#33475A',wall2:'#2C3E4E',floor:'#3A4E5C',floor2:'#34475A',road:'#26343F',line:'#16212A',ink:'#E4E8E3',mute:'#82939A',
  skin:'#F1C9A5',hat:'#F2D58A',red:'#F0605D',ok:'#9CCB6B',crate:'#C8955A',crateD:'#9C6E3C',box:'#E3A84B',boxD:'#B98232',
  teal:'#5EC4B6',blue:'#7E9CF0',green:'#9CCB6B',amber:'#E3A84B',purple:'#B48BD6'};
const CAMS=[{id:'rx',lab:'Receiving',k:'materialsIn'},{id:'pr',lab:'Production',k:'produced'},{id:'qa',lab:'QA',k:'qaInspected'},
  {id:'wh',lab:'Warehouse',k:'warehouse'},{id:'yd',lab:'Truck yard',k:'trucksWaiting'}];
const ease=p=>p<=0?0:p>=1?1:p*p*(3-2*p),lerp=(a,b,p)=>a+(b-a)*p;
const Z={m:0,materialsIn:0,produced:0,qaInspected:0,qaRejected:0,warehouse:0,trucksWaiting:0,truckLoad:0,buffer:30,starve:0,lines:[0,0,0],valid:{}};
let on=false,T=0,last=0,S=null; // T: animation clock, advances only while the day plays

function fresh(){S={evts,mins,evI:evts.length,rejI:0,rejTotal:0,
  rx:{trucks:[],cr:0,lastStart:-9,flash:-9},pr:{items:[[],[],[]],cr:[0,0,0],beacon:[-9,-9,-9]},
  qa:{items:[],cr:0,rej:0},yd:{arr:[],dep:[],bubble:-9}}}

// ---- drawing helpers (scene units) ----
function box(g,x,y,w,h,r,fill,stroke){g.beginPath();g.roundRect(x,y,w,h,r);g.fillStyle=fill;g.fill();if(stroke){g.strokeStyle=stroke;g.lineWidth=1.4;g.stroke()}}
function circle(g,x,y,r,fill,stroke){g.beginPath();g.arc(x,y,r,0,7);g.fillStyle=fill;g.fill();if(stroke){g.strokeStyle=stroke;g.lineWidth=1.2;g.stroke()}}
function crate(g,x,y,w,col,dark){box(g,x,y,w,w*.85,1.5,col,K.line);g.strokeStyle=dark;g.lineWidth=1;g.beginPath();g.moveTo(x+2,y+2);g.lineTo(x+w-2,y+w*.85-2);g.moveTo(x+w-2,y+2);g.lineTo(x+2,y+w*.85-2);g.stroke()}
function parcel(g,x,y,w,col,dark){box(g,x,y,w,w*.8,1.5,col,K.line);g.fillStyle=dark;g.fillRect(x+w/2-1,y+1,2,w*.8-2)}
function truck(g,x,y,col,o={}){ // x = trailer rear, y = ground; faces right (o.dir=-1 faces left)
  const w=o.w||58;g.save();g.translate(x,y);if(o.dir<0){g.translate(w+22,0);g.scale(-1,1)}
  g.save();if(o.tip){g.translate(0,-7);g.rotate(-o.tip);g.translate(0,7)} // tipper pivots on the rear axle
  box(g,0,-30,w,23,3,col,K.line);
  if(o.load!=null){box(g,5,-25,w-10,6,2,'rgba(22,33,42,.45)');box(g,5,-25,(w-10)*Math.min(1,o.load),6,2,'rgba(255,255,255,.8)')}
  if(o.logo){g.fillStyle='rgba(255,255,255,.75)';g.font='600 8px "Barlow Semi Condensed",sans-serif';g.textAlign='center';g.textBaseline='middle';
    g.save();if(o.dir<0){g.translate(w/2,-15);g.scale(-1,1);g.fillText(o.logo,0,0)}else g.fillText(o.logo,w/2,-15);g.restore()}
  g.restore();
  box(g,w+2,-25,19,19,5,K.ink,K.line);box(g,w+11,-22,8,7,2,'#8EC3E6');box(g,-2,-9,w+25,4,1.5,K.line);
  [9,w-9,w+13].forEach(wx=>{circle(g,wx,-4,4.6,K.line);circle(g,wx,-4,1.8,K.mute)});
  g.restore();
}
function person(g,x,y,shirt,o={}){ // x,y = feet
  const b=o.bob||0;g.save();g.translate(x,y);if(o.sc)g.scale(o.sc,o.sc);
  box(g,-5,-11,4,11,1.5,'#2E3F4C');box(g,1,-11,4,11,1.5,'#2E3F4C');
  box(g,-7,-25+b,14,16,5,shirt,K.line);
  if(o.tie){g.fillStyle=K.red;g.beginPath();g.moveTo(0,-23+b);g.lineTo(2,-16+b);g.lineTo(0,-13+b);g.lineTo(-2,-16+b);g.fill()}
  circle(g,0,-30+b,5.5,K.skin,K.line);
  if(o.hat){g.beginPath();g.arc(0,-31+b,6,Math.PI,0);g.closePath();g.fillStyle=K.hat;g.fill();g.strokeStyle=K.line;g.stroke()}
  if(o.arm!=null){g.save();g.translate(5,-21+b);g.rotate(o.arm);box(g,0,-2,11,4,2,shirt,K.line);if(o.tool)o.tool(g);g.restore()}
  g.restore();
}
function beacon(g,x,y,state){ // state: 'ok' | 'alarm' | 'idle'
  const c=state==='alarm'?(T*4%1<.5?K.red:'#7A2E2D'):state==='ok'?K.ok:'#4B5D69';
  box(g,x-4,y-2,8,4,1,K.line);g.beginPath();g.arc(x,y-2,4,Math.PI,0);g.fillStyle=c;g.fill();
  if(state==='alarm'&&T*4%1<.5){g.beginPath();g.arc(x,y-2,10,0,7);g.fillStyle='rgba(240,96,93,.25)';g.fill()}
}
function sign(g,x,y,txt,bg,fg){g.font='700 9px "Barlow Semi Condensed",sans-serif';const w=g.measureText(txt).width+10;
  box(g,x-w/2,y-7,w,14,3,bg,K.line);g.fillStyle=fg;g.textAlign='center';g.textBaseline='middle';g.fillText(txt,x,y+.5)}
function room(g,wallH){g.fillStyle=K.floor;g.fillRect(0,0,320,180);g.fillStyle=K.wall;g.fillRect(0,0,320,wallH);
  g.fillStyle=K.wall2;g.fillRect(0,wallH-4,320,4);g.fillStyle=K.floor2;for(let x=0;x<320;x+=40)g.fillRect(x,wallH,1,180-wallH)}

// ---- scenes ----
function spawnTruck(big){const R=S.rx;if(R.trucks.length>=3)return;const t0=Math.max(T,R.lastStart+3.1);R.trucks.push({t0,big});R.lastStart=t0}
function rx(g,s){ // receiving: supply trucks drive in, crates hop onto the raw-material pile
  room(g,64);
  box(g,22,14,70,46,3,'#2A3B48',K.line);for(let y=20;y<58;y+=6){g.fillStyle='#3B5060';g.fillRect(25,y,64,2)} // roller door
  g.fillStyle=K.road;g.fillRect(0,132,320,40);g.fillStyle='rgba(242,213,138,.6)';for(let x=(-T*0)%30;x<320;x+=30)g.fillRect(x,151,14,2);
  const n=Math.min(54,Math.round(s.buffer/8));
  box(g,166,118,128,5,1,'#5A4632');
  for(let i=0;i<n;i++)crate(g,168+(i%9)*14,106-Math.floor(i/9)*11,12,K.crate,K.crateD);
  if(T<S.rx.flash){crate(g,150,106,12,K.red,'#7A2E2D');beacon(g,300,20,'alarm')}else beacon(g,300,20,s.buffer<10?'alarm':'ok');
  if(s.buffer<10)sign(g,230,90,'NO STOCK',K.red,K.line);
  let busy=false;
  S.rx.trucks.forEach(tk=>{const d=T-tk.t0;if(d<0)return;
    const x=d<1.2?lerp(-90,140,ease(d/1.2)):d<2.8?140:lerp(140,340,ease((d-2.8)/1.4)),un=d<1.2?0:d<2.8?(d-1.2)/1.6:1,cnt=tk.big?6:3;
    truck(g,x,170,K.teal,{w:tk.big?70:58,load:1-un,logo:tk.big?'BULK':'SUPPLY'});
    if(d>1.2&&d<2.8){busy=true;for(let j=0;j<cnt;j++){const p=(un*cnt-j);if(p>0&&p<1){const cx=lerp(x+30,200+j*12,p),cy=lerp(138,100,p)-30*Math.sin(Math.PI*p);crate(g,cx,cy,11,K.crate,K.crateD)}}}
  });
  person(g,150,128,K.teal,{hat:1,arm:busy?-1.2+Math.sin(T*9)*.5:.6});
}
function pr(g,s){ // production: three belts, a press per line, raw cubes in → finished boxes out
  room(g,30);
  const stopped=s.m!=null&&typeof inA==='function'&&inA('stop',s.m,10);
  for(let l=0;l<3;l++){const y=66+l*44,run=s.lines[l]>0,P=S.pr;
    const st=stopped||T<P.beacon[l]?'alarm':run?'ok':'idle';
    person(g,96,y-4,K.blue,{hat:1,sc:.8,arm:run?-.3+Math.sin(T*6+l)*.4:.7});
    box(g,8,y,304,8,3,'#22303A',K.line);
    g.fillStyle='#4B5D69';const off=run?(T*42)%16:0;for(let x=10+off;x<310;x+=16)g.fillRect(x,y+3,6,2); // belt treads
    P.items[l].forEach(it=>{if(it.x<138)box(g,it.x,y-7,7,7,1.5,K.teal,K.line);else parcel(g,it.x,y-10,10,K.blue,'#5876C9')});
    const ph=run?Math.max(0,Math.sin(T*7+l*2)):0;
    box(g,128,y-36,34,20,4,'#5A73B8',K.line);box(g,140,y-16+ph*7,10,6,1.5,'#C9D3DD',K.line); // press head
    box(g,124,y-4,42,4,1,K.line);beacon(g,156,y-36,st);
    g.fillStyle=K.mute;g.font='600 9px "Barlow Semi Condensed",sans-serif';g.textAlign='left';g.textBaseline='middle';g.fillText('LINE '+(l+1),12,y-10);
  }
  if(stopped)sign(g,220,40,'ALL LINES STOPPED',K.red,K.line);
  else if(s.starve>.3)sign(g,220,40,'WAITING FOR MATERIALS',K.hat,K.line);
}
function qa(g,s){ // QA: an inspector stamps each unit; rejects get tossed onto a growing pile
  room(g,40);
  box(g,0,108,150,8,3,'#22303A',K.line);box(g,186,108,134,8,3,'#22303A',K.line);
  box(g,140,100,56,10,2,'#6E8B4E',K.line);box(g,146,110,4,26,1,K.line);box(g,186,110,4,26,1,K.line); // inspection table
  const chk=S.qa.items.find(i=>i.ph==='chk');
  person(g,168,96,'#F4F1EA',{tie:1,arm:chk?-.9+Math.sin(T*14)*.25:.5,tool:g=>{circle(g,13,0,4,'rgba(142,195,230,.5)',K.line)}});
  // reject pile
  const n=Math.min(66,S.rejTotal);let i=0,row=0,top=172;
  while(i<n){const w=11-row;for(let c=0;c<w&&i<n;c++,i++)parcel(g,226+row*4.5+c*9,164-row*8,9,'#C9615E','#8E3B39');top=164-row*8;row++}
  sign(g,275,72,`REJECTS ${S.rejTotal}`,K.red,K.line);
  S.qa.items.forEach(it=>{
    if(it.ph==='toss'){const p=Math.min(1,(T-it.t)/.7);parcel(g,lerp(170,250,p),lerp(92,top-6,p)-40*Math.sin(Math.PI*p),10,'#C9615E','#8E3B39');return}
    parcel(g,it.x,it.ph==='chk'?90:98,10,it.ph==='out'?K.green:K.blue,it.ph==='out'?'#6E9A45':'#5876C9');
    if(it.ph==='out'&&it.x<215){g.fillStyle=K.ok;g.font='700 12px sans-serif';g.textAlign='center';g.fillText('✓',it.x+5,84)}
  });
  if(chk&&chk.rej&&T-chk.t>.2){g.fillStyle=K.red;g.font='700 14px sans-serif';g.textAlign='center';g.fillText('✗',168,52)}
  if(s.valid&&s.valid.qaRejected===false)sign(g,275,88,'REJECT COUNT: NO DATA',K.mute,K.line);
}
function wh(g,s){ // warehouse: racks fill with finished goods; a forklift shuttles while goods move
  room(g,26);
  const n=Math.min(40,Math.round(s.warehouse/10));
  [20,166].forEach((rx0,r)=>{
    for(let lv=0;lv<4;lv++){const y=150-lv*28;box(g,rx0,y,134,4,1,'#7C6A55',K.line)}
    box(g,rx0,38,4,116,1,'#7C6A55',K.line);box(g,rx0+130,38,4,116,1,'#7C6A55',K.line);
  });
  for(let i=0;i<n;i++){const r=i<20?0:1,j=i%20,lv=Math.floor(j/5),c=j%5;parcel(g,(r?166:20)+8+c*25,150-lv*28-17,19,K.box,K.boxD)}
  const busy=s.qaInspected>0||s.truckLoad>0,fx=busy?160+120*Math.sin(T*.9):60,dir=busy&&Math.cos(T*.9)<0?-1:1;
  g.save();g.translate(fx,174);if(dir<0)g.scale(-1,1);
  box(g,-16,-16,24,12,3,K.hat,K.line);box(g,-12,-26,12,10,2,'rgba(142,195,230,.4)',K.line);box(g,8,-28,3,26,1,K.line);box(g,8,-4,14,3,1,K.line);
  if(busy)parcel(g,10,-16,13,K.box,K.boxD);circle(g,-11,-3,4,K.line);circle(g,4,-3,4,K.line);g.restore();
  if(s.warehouse>350)sign(g,160,34,'NEAR CAPACITY',T*2%1<.5?K.red:'#7A2E2D',K.ink);
  else if(n===0)sign(g,160,34,'EMPTY',K.mute,K.line);
}
function yd(g,s){ // truck yard: one dock loads the front truck; the rest idle in bays until it leaves full
  g.fillStyle='#2F3F33';g.fillRect(0,0,320,180);g.fillStyle=K.road;g.fillRect(40,44,280,136);
  g.strokeStyle='rgba(228,232,227,.35)';g.lineWidth=1;for(let i=0;i<3;i++){g.strokeRect(118+i*67,108,67,32);g.strokeRect(118+i*67,140,67,32)}
  g.fillStyle='#55463A';g.fillRect(0,0,40,180);box(g,6,48,30,40,2,'#2A3B48',K.line);
  const Y=S.yd,closed=s.m!=null&&typeof inA==='function'&&inA('truck',s.m,30),tw=s.trucksWaiting;
  if(closed){for(let y=50;y<88;y+=5){g.fillStyle='#8E6E50';g.fillRect(7,y,28,3)}sign(g,90,34,'DOCK CLOSED',K.red,K.line)}
  const leaving=Y.dep.some(d=>T-d.t0<.9);
  if(tw>0&&!leaving)truck(g,40,92,K.purple,{load:s.truckLoad/100,logo:'FREIGHT'});
  Y.dep.forEach(d=>{const p=(T-d.t0)/2;truck(g,lerp(40,340,ease(p)),92,K.purple,{load:1,logo:'FREIGHT'})});
  const A=Y.arr.length,P=Math.max(0,tw-1-A);
  const slot=i=>[118+(i%3)*67+2,i<3?138:170];
  for(let i=0;i<Math.min(P,6);i++){const[x,y]=slot(i);truck(g,x,y,'#8D6FAF',{w:42,dir:-1});
    const p=(T*1.1+i*.37)%1;circle(g,x+66-4,y-6-p*12,2+p*3,`rgba(200,210,215,${.5*(1-p)})`)} // idle exhaust
  if(P>6)sign(g,290,100,'+'+(P-6),K.purple,K.line);
  Y.arr.forEach((a,j)=>{const p=ease((T-a.t0)/1.4),[x,y]=slot(Math.min(5,P+j));truck(g,lerp(330,x,p),y,'#8D6FAF',{w:42,dir:-1})});
  if(T<Y.bubble&&P>0){const[x,y]=slot(0);box(g,x+20,y-48,18,16,5,K.ink,K.line);g.fillStyle=K.red;g.font='800 12px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('!',x+29,y-40)}
  person(g,52,58,K.purple,{hat:1,sc:.8,arm:tw>0&&!closed?-1+Math.sin(T*5)*.4:.6});
}
const SCENES={rx,pr,qa,wh,yd};

// ---- per-frame simulation of the moving bits ----
function events(){
  for(;S.evI<evts.length;S.evI++){const x=evts[S.evI].txt;let m;
    if(/^Bulk delivery/.test(x))spawnTruck(true);
    else if(/^Damaged pallet/.test(x))S.rx.flash=T+2;
    else if(m=x.match(/^Line (\d) jam/))S.pr.beacon[m[1]-1]=T+2.5;
    else if(m=x.match(/^Rejected ×(\d+)/))S.qa.rej=Math.min(4,S.qa.rej+ +m[1]);
    else if(/^Truck arrived/.test(x)){if(S.yd.arr.length<3)S.yd.arr.push({t0:T})}
    else if(/^Truck departed/.test(x)){if(S.yd.dep.length<2)S.yd.dep.push({t0:T})}
    else if(/waiting > 20/.test(x))S.yd.bubble=T+3;
  }
}
function update(dt,s){
  for(;S.rejI<mins.length;S.rejI++)S.rejTotal+=mins[S.rejI].qaRejected;
  events();
  const R=S.rx;R.cr+=dt*(s.materialsIn/24)*.22;if(R.cr>=1){R.cr=0;spawnTruck(false)}
  R.trucks=R.trucks.filter(t=>T<t.t0+4.4);
  s.lines.forEach((n,l)=>{const P=S.pr,its=P.items[l];P.cr[l]=Math.min(1.5,P.cr[l]+dt*n*.35);
    if(n>0){if(P.cr[l]>=1&&!(its.length&&its[its.length-1].x<22)){its.push({x:2});P.cr[l]-=1}its.forEach(it=>it.x+=42*dt)}
    P.items[l]=its.filter(it=>it.x<325)});
  const Q=S.qa;Q.cr=Math.min(1.5,Q.cr+dt*s.qaInspected*.12);
  if(Q.cr>=1&&!Q.items.some(it=>it.ph==='in'&&it.x<10)){const rej=Q.rej>=1;if(rej)Q.rej--;Q.items.push({x:-8,ph:'in',rej});Q.cr--}
  const busy=Q.items.some(it=>it.ph==='chk');let lim=busy?136:150;
  Q.items.filter(it=>it.ph==='in').sort((a,b)=>b.x-a.x).forEach(it=>{it.x=Math.min(it.x+42*dt,lim);lim=it.x-13});
  if(!busy){const nx=Q.items.find(it=>it.ph==='in'&&it.x>=150);if(nx){nx.ph='chk';nx.x=163;nx.t=T}}
  Q.items.forEach(it=>{if(it.ph==='chk'&&T-it.t>.45){it.ph=it.rej?'toss':'out';it.t=T;it.x=it.rej?it.x:192}else if(it.ph==='out')it.x+=42*dt});
  Q.items=Q.items.filter(it=>it.ph==='toss'?T-it.t<.7:it.x<325);
  const Y=S.yd;Y.arr=Y.arr.filter(a=>T-a.t0<1.4);Y.dep=Y.dep.filter(d=>T-d.t0<2);
}

function noise(g,w,h){for(let i=0;i<260;i++){const v=Math.random()*120|0;g.fillStyle=`rgb(${v},${v},${v})`;g.fillRect(Math.random()*w,Math.random()*h,2+Math.random()*10,2)}}
// ---- frame: lay out the camera grid, draw each feed, then the CCTV overlay ----
function frame(ts){
  if(!on)return;requestAnimationFrame(frame);
  const dt=last?Math.min(.1,(ts-last)/1000):0;last=ts;
  if(!S||S.evts!==evts||S.mins!==mins)fresh();
  const s=mins[mins.length-1]||Z;
  if(playing){T+=dt;update(dt,s)}
  const dpr=devicePixelRatio||1,W=cv.clientWidth,H=cv.clientHeight;if(!W||!H)return;
  if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr)}
  const g=cv.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle='#0E161C';g.fillRect(0,0,W,H);
  const mini=W<480,gap=mini?3:6;let best=null; // pick the column count that gives the biggest 16:9 cells
  for(let cols=1;cols<=3;cols++){const rows=Math.ceil(6/cols),cw=Math.min((W-gap*(cols+1))/cols,((H-gap*(rows+1))/rows)*16/9);if(!best||cw>best.cw)best={cols,rows,cw}}
  const{cols,rows,cw}=best,ch=cw*9/16,ox=(W-cols*cw-(cols-1)*gap)/2,oy=(H-rows*ch-(rows-1)*gap)/2;
  const sec=Math.floor((simT%1)*60),stamp=hhmm(Math.floor(Math.min(simT,DAY-1/60)))+':'+String(sec).padStart(2,'0');
  for(let i=0;i<6;i++){const x=ox+(i%cols)*(cw+gap),y=oy+Math.floor(i/cols)*(ch+gap);
    g.save();g.beginPath();g.rect(x,y,cw,ch);g.clip();g.translate(x,y);
    if(i<5){const cam=CAMS[i],sig=!s.valid||s.valid[cam.k]!==false; // cutting an area's sensor feed also takes its camera down
      g.save();g.scale(cw/320,ch/180);if(sig)SCENES[cam.id](g,s);else{g.fillStyle='#1B2329';g.fillRect(0,0,320,180)}g.restore();
      if(!sig){noise(g,cw,ch);const f=mini?11:14;g.fillStyle='rgba(14,22,28,.75)';g.fillRect(cw/2-f*4.3,ch/2-f,f*8.6,f*2);g.fillStyle=K.ink;g.font=`600 ${f}px "Barlow Semi Condensed",sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText('NO SIGNAL',cw/2,ch/2)}
      const vg=g.createRadialGradient(cw/2,ch/2,ch*.35,cw/2,ch/2,cw*.75);vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(0,0,0,.45)');g.fillStyle=vg;g.fillRect(0,0,cw,ch);
      g.fillStyle='rgba(0,0,0,.07)';for(let yy=0;yy<ch;yy+=3)g.fillRect(0,yy,cw,1); // scanlines
      const f=mini?8:cw<230?10:11;g.font=`600 ${f}px ui-monospace,Consolas,monospace`;g.textBaseline='top';
      const lab=(cw<230?'':`CAM ${i+1} `)+cam.lab.toUpperCase(),pad=mini?2:4;g.fillStyle='rgba(0,0,0,.55)';g.fillRect(pad,pad,g.measureText(lab).width+(mini?4:8),f+(mini?3:6));
      g.fillStyle='#fff';g.textAlign='left';g.fillText(lab,pad*2,pad+(mini?1.5:3));
      if(mini){if(playing&&T%1<.6)circle(g,cw-6,6,2.5,K.red)}else{g.textAlign='right';const tw=g.measureText(stamp).width;g.fillStyle='rgba(0,0,0,.55)';g.fillRect(cw-tw-24,4,tw+20,f+6);
      g.fillStyle='#fff';g.fillText(stamp,cw-8,7);if(playing&&T%1<.6)circle(g,cw-tw-16,7+f/2,3,K.red)}
    }else if(mini){g.fillStyle='#16212A';g.fillRect(0,0,cw,ch);g.fillStyle=K.ink;g.textAlign='center';g.textBaseline='middle'; // picture-in-picture: invite a click
      g.font='600 20px sans-serif';g.fillText('⤢',cw/2,ch/2-8);g.font='600 11px "Barlow Semi Condensed",sans-serif';g.fillStyle=K.mute;g.fillText('Click to enlarge',cw/2,ch/2+12)}
    else control(g,cw,ch);
    g.restore();g.strokeStyle='#273743';g.lineWidth=1;g.strokeRect(x+.5,y+.5,cw-1,ch-1);
  }
}
function control(g,w,h){ // sixth tile: the control-room summary
  g.fillStyle='#16212A';g.fillRect(0,0,w,h);const F='"Barlow Semi Condensed",Barlow,sans-serif',p=Math.max(8,w*.04);
  g.textAlign='left';g.textBaseline='top';g.fillStyle=K.mute;g.font=`600 ${Math.max(10,w*.035)}px ${F}`;g.fillText('CONTROL ROOM',p,p);
  g.fillStyle=K.ink;g.font=`500 ${w*.11}px ${F}`;g.fillText(hhmm(Math.floor(simT)),p,p+w*.05);
  const hc=harmony>=.75?K.ink:harmony>=.45?K.hat:K.red,ly=p+w*.19;
  g.fillStyle=hc;g.font=`500 ${Math.max(11,w*.045)}px ${F}`;g.fillText(`Harmony ${harmony.toFixed(2)} · ${mood(harmony)}`,p,ly);
  box(g,p,ly+w*.06,w-2*p,4,2,'#273743');box(g,p,ly+w*.06,(w-2*p)*harmony,4,2,hc);
  const al=evts.filter(e=>e.alarm).slice(-4).reverse();g.font=`400 ${Math.max(10,w*.036)}px ${F}`;
  al.forEach((e,i)=>{const y=ly+w*.1+i*w*.048;if(y>h-12)return;g.fillStyle=K.mute;g.fillText(hhmm(e.m),p,y);g.fillStyle=K.red;g.fillText(e.txt,p+w*.13,y)});
  if(!al.length){g.fillStyle=K.mute;g.fillText('No alarms yet',p,ly+w*.1)}
}
return{show(v){if(v===on)return;on=v;last=0;if(S)S.evI=evts.length;if(v)requestAnimationFrame(frame)}}; // one loop at a time; skip events missed while hidden
})();
