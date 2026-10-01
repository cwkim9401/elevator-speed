const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const engine=require('./measurement.js');

// Analytic raised-cosine velocity ramps: known integral without using the engine.
function ride({speed=1.5,hz=60,cruise=6,ramp=2,noise=0,bias=0,jitter=false,tilt=0,tail=4,offset=0}={}){
  const samples=[], start=5, brake=start+ramp+cruise, stop=brake+ramp;
  let t=0,i=0;
  while(t<=stop+tail){
    let a=0;
    if(t>=start && t<start+ramp) a=speed*Math.PI/(2*ramp)*Math.sin(Math.PI*(t-start)/ramp);
    if(t>=brake && t<stop) a=-speed*Math.PI/(2*ramp)*Math.sin(Math.PI*(t-brake)/ramp);
    const drift=t>3?bias:0;
    const theta=t>start+ramp && t<brake?tilt*Math.PI/180:0;
    const g=9.799+offset+a+drift+noise*(Math.sin(i*1.7)+0.5*Math.cos(i*0.31));
    samples.push({t:t*1000,x:g*Math.sin(theta),y:0,z:g*Math.cos(theta)});
    t+=(1/hz)*(jitter?1+0.3*Math.sin(i*1.31):1);i++;
  }
  return {samples,distance:Math.abs(speed)*(cruise+ramp),stop,brake};
}
for(const hz of [20,60,120]) for(const speed of [-2,-0.5,0.5,1.5,4]){
  test(`known ride ${speed} m/s at ${hz} Hz`,()=>{
    const r=ride({hz,speed}), out=engine.analyze(r.samples);
    assert.ok(Math.abs(out.cruise-Math.abs(speed))<0.02,JSON.stringify({speed,hz,actual:out.cruise}));
    assert.ok(Math.abs(out.dist-r.distance)<0.12);
    assert.equal(Math.sign(out.vel.find(p=>Math.abs(p.v)>0.2).v),Math.sign(speed));
  });
}
test('noise, variable cadence and small offset drift',()=>{
  const r=ride({noise:0.025,bias:0.015,jitter:true});
  const out=engine.analyze(r.samples);
  assert.ok(Math.abs(out.cruise-1.5)<0.04,`${out.cruise}`);
  assert.ok(Math.abs(out.dist-r.distance)<0.3);
});
test('constant sensor offset does not cause fabricated scale correction',()=>{
  const out=engine.analyze(ride({offset:0.15}).samples);
  assert.equal(out.scaleK,1);
  assert.ok(Math.abs(out.cruise-1.5)<0.02);
});
test('short triangular trip has no claimed cruise speed',()=>{
  const out=engine.analyze(ride({cruise:0}).samples);
  assert.equal(out.cruise,null);assert.ok(out.maxV>1.4);
});
test('long slow cruise is retained',()=>{
  const out=engine.analyze(ride({speed:0.5,cruise:70}).samples);
  assert.ok(Math.abs(out.cruise-0.5)<0.02);
});
function rejects(samples,code){ assert.throws(()=>engine.analyze(samples),e=>e.code===code); }
test('manual stop during cruising is rejected',()=>{
  rejects(ride().samples.filter(s=>s.t<11000),'INCOMPLETE');
});
test('missing arrival rest is rejected',()=>{rejects(ride({tail:0.5}).samples,'TAIL');});
test('half brake followed by quiet cruising is rejected',()=>{
  const r=ride();
  r.samples.forEach(s=>{if(s.t>(r.brake+1)*1000)s.z=9.799;});
  rejects(r.samples,'BALANCE');
});
test('sensor dropout is rejected instead of truncating integration time',()=>{
  rejects(ride().samples.filter(s=>s.t<6500||s.t>7000),'GAP');
});
test('duplicate, backward and non-finite samples are rejected',()=>{
  for(const kind of ['duplicate','backward','nan']){
    const s=ride().samples;
    if(kind==='nan'){s[30].x=NaN;rejects(s,'FINITE');}
    else {s[30].t=s[29].t-(kind==='backward'?1:0);rejects(s,'CLOCK');}
  }
});
test('temporary tilt is detected even if restored at arrival',()=>{rejects(ride({tilt:8}).samples,'TILT');});
test('stationary recording cannot become a ride',()=>{rejects(ride({speed:0}).samples,'INCOMPLETE');});

function app(){
  let now=0;
  const elements=new Map(), handlers={};
  const canvas=new Proxy({}, {get:()=>()=>{}});
  function el(id){
    if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',style:{},classList:{add(){},remove(){},toggle(){}},
      addEventListener(type,fn){handlers[id+':'+type]=fn;},getContext(){return canvas;},width:600,height:240});
    return elements.get(id);
  }
  const context={ElevatorMeasurement:engine,console,performance:{now:()=>now},
    document:{getElementById:el,addEventListener(type,fn){handlers[type]=fn;},visibilityState:'visible'},
    navigator:{},localStorage:{getItem(){return null;},setItem(){}},
    setInterval(){return 1;},clearInterval(){},setTimeout(){return 1;},clearTimeout(){},
    requestAnimationFrame(){return 1;},alert(){},confirm(){return true;}};
  context.window={isSecureContext:true,addEventListener(){},removeEventListener(){},navigator:context.navigator};
  vm.createContext(context);
  let code=fs.readFileSync('index.html','utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  code=code.replace('  loadHistory(); renderHistory();',`  globalThis.hooks={start,recordSample,finishMeasurement,uiTick,
    state:()=>({recording,phase,hasMoved,brakingSeen,lastCapture})};\n  loadHistory(); renderHistory();`);
  vm.runInContext(code,context);
  return {context,el,handlers,clock(t){now=t;},feed(samples){
    for(const s of samples){now=s.t;context.hooks.recordSample(s.x,s.y,s.z,s.t);}
  }};
}
test('live slow cruise cannot auto-stop before braking; finishes after arrival',()=>{
  const a=app();a.context.hooks.start();
  const r=ride({speed:0.5,cruise:70,tail:5});
  a.feed(r.samples.filter(s=>s.t<(r.brake)*1000));
  assert.equal(a.context.hooks.state().recording,true);
  assert.equal(a.context.hooks.state().brakingSeen,false);
  a.feed(r.samples.filter(s=>s.t>=r.brake*1000));
  assert.equal(a.context.hooks.state().recording,false);
  assert.equal(a.context.hooks.state().lastCapture.reason,'complete');
});
test('hidden page cancels and retains raw data',()=>{
  const a=app();a.context.hooks.start();a.feed(ride().samples.slice(0,250));
  a.context.document.visibilityState='hidden';a.handlers.visibilitychange();
  assert.equal(a.context.hooks.state().recording,false);
  assert.ok(a.context.hooks.state().lastCapture.samples.length);
});
test('absent sensor exits instead of hanging on countdown',()=>{
  const a=app();a.context.hooks.start();a.clock(6000);a.context.hooks.uiTick();
  assert.equal(a.context.hooks.state().recording,false);
});
test('live manual cruise stop shows failure and preserves raw data',()=>{
  const a=app();a.context.hooks.start();a.feed(ride().samples.filter(s=>s.t<11000));
  a.context.hooks.finishMeasurement(false);
  assert.equal(a.context.hooks.state().lastCapture.reason,'INCOMPLETE');
});
