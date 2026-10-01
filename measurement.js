/* Pure measurement engine. Units: milliseconds in, seconds / m/s / m/s² out. */
(function(root){
  'use strict';
  const VERSION = '2.0.0';
  const mean = a => a.reduce((s,v) => s+v,0)/a.length;
  const sd = a => { const m=mean(a); return Math.sqrt(mean(a.map(v=>(v-m)**2))); };
  const median = a => { const b=a.slice().sort((x,y)=>x-y), n=b.length; return n ? (b[(n-1)>>1]+b[n>>1])/2 : 0; };
  function baseline(samples){
    const g={x:mean(samples.map(s=>s.x)),y:mean(samples.map(s=>s.y)),z:mean(samples.map(s=>s.z))};
    const gmag=Math.hypot(g.x,g.y,g.z);
    // One static orientation cannot distinguish gain from offset. Do not invent a scale correction.
    return {gh:{x:g.x/gmag,y:g.y/gmag,z:g.z/gmag},gmag,k:1};
  }
  function vertical(b,s){return s.x*b.gh.x+s.y*b.gh.y+s.z*b.gh.z-b.gmag;}
  function angle(b,s){
    const mag=Math.hypot(s.x,s.y,s.z);
    return Math.acos(Math.max(-1,Math.min(1,(s.x*b.gh.x+s.y*b.gh.y+s.z*b.gh.z)/mag)))*180/Math.PI;
  }
  function fail(code,message){ const e=new Error(message); e.code=code; throw e; }
  function validate(samples){
    if(samples.length<30) fail('SAMPLES','센서 데이터가 부족합니다.');
    const gaps=[];
    samples.forEach((s,i)=>{
      if(![s.t,s.x,s.y,s.z].every(Number.isFinite)) fail('FINITE','유효하지 않은 센서 값이 있습니다.');
      if(i){const d=s.t-samples[i-1].t; if(d<=0) fail('CLOCK','센서 시각이 역전되거나 중복되었습니다.'); gaps.push(d);}
    });
    const med=median(gaps), max=Math.max(...gaps);
    if(med>100) fail('RATE','센서 주기가 너무 느립니다(10 Hz 미만).');
    if(max>Math.max(150,med*5)) fail('GAP','센서 데이터가 끊겼습니다. 화면을 켜고 다시 측정하세요.');
    return {sampleHz:1000/med,maxGapMs:max};
  }
  // Uniform sampling prevents event bursts from receiving extra weight in the filter.
  function resample(samples,step){
    const out=[], origin=samples[0].t, end=samples[samples.length-1].t;
    let j=1;
    for(let t=origin;t<=end+1e-6;t+=step){
      while(j<samples.length-1 && samples[j].t<t) j++;
      const p=samples[j-1], q=samples[j], f=(t-p.t)/(q.t-p.t);
      out.push({t:(t-origin)/1000,x:p.x+(q.x-p.x)*f,y:p.y+(q.y-p.y)*f,z:p.z+(q.z-p.z)*f});
    }
    return out;
  }
  function box(values,radius){
    const prefix=[0]; values.forEach(v=>prefix.push(prefix[prefix.length-1]+v));
    return values.map((_,i)=>{const a=Math.max(0,i-radius),b=Math.min(values.length,i+radius+1);return (prefix[b]-prefix[a])/(b-a);});
  }
  function blocks(t,a,threshold){
    const out=[]; let start=-1, sign=0;
    function close(i){ if(start>=0 && t[i]-t[start]>=0.3) out.push({start,end:i,sign}); }
    a.forEach((v,i)=>{
      const s=Math.abs(v)>threshold?Math.sign(v):0;
      if(s!==sign){close(i-1);start=s?i:-1;sign=s;}
    }); close(a.length-1);
    return out;
  }
  function analyze(samples,options={}){
    const quality=validate(samples), t0=samples[0].t;
    const baselineEnd=options.baselineEnd ?? t0+3000;
    const baseSamples=samples.filter(s=>s.t>=t0+400 && s.t<baselineEnd);
    if(baseSamples.length<20 || baseSamples.at(-1).t-baseSamples[0].t<2300)
      fail('BASELINE','출발 전 정지 기준 데이터가 부족합니다.');
    const base=baseline(baseSamples), sigma=sd(baseSamples.map(s=>vertical(base,s)));
    if(base.gmag<9.3 || base.gmag>10.3 || sigma>0.12 || Math.max(...baseSamples.map(s=>angle(base,s)))>2)
      fail('BASELINE','기준 측정 중 움직임이 큽니다. 휴대폰을 고정하고 다시 측정하세요.');
    const ride=samples.filter(s=>s.t>=baselineEnd);
    if(ride.length<30 || ride.at(-1).t-ride[0].t<3000) fail('SHORT','운행과 도착 후 정지 기록이 더 필요합니다.');
    const step=Math.max(1000/120,Math.min(50,1000/quality.sampleHz));
    const rows=resample(ride,step), t=rows.map(s=>s.t), n=t.length;
    const radius=Math.max(1,Math.round(125/step));
    const raw=rows.map(s=>vertical(base,s)), a=box(raw,radius);
    const threshold=Math.max(0.08,Math.min(0.18,4*sigma));
    const runs=blocks(t,a,threshold);
    if(runs.length<2) fail('INCOMPLETE','출발과 감속을 모두 확인하지 못했습니다. 도착 후 3초 이상 기다리세요.');
    const first=runs[0], last=runs.at(-1), dir=first.sign;
    if(last.sign===dir) fail('INCOMPLETE','도착 감속이 확인되지 않았습니다. 정속 운행 중에는 종료하지 마세요.');
    let braking=false;
    for(const r of runs){
      if(r.sign!==dir) braking=true;
      else if(braking) fail('MULTI','한 번의 운행만 측정하세요. 재출발 또는 큰 흔들림이 감지되었습니다.');
    }
    const iA=Math.max(0,first.start-Math.ceil(300/step));
    const iB=Math.min(n-1,last.end+Math.ceil(300/step));
    if(t[n-1]-t[iB]<2) fail('TAIL','도착 후 정지 데이터가 부족합니다. 3초 이상 정지한 뒤 종료하세요.');
    const tail=raw.filter((_,i)=>t[i]>=t[n-1]-1.8);
    if(sd(tail)>0.12 || Math.abs(mean(tail))>0.15) fail('TAIL','도착 후 센서가 안정되지 않았습니다. 고정 상태로 다시 측정하세요.');
    // Check the whole ride, including a tilt that returns to the original position.
    const xyz=['x','y','z'].map(k=>box(rows.map(s=>s[k]),Math.round(250/step)));
    let tiltDeg=0;
    rows.forEach((_,i)=>{tiltDeg=Math.max(tiltDeg,angle(base,{x:xyz[0][i],y:xyz[1][i],z:xyz[2][i]}));});
    if(tiltDeg>5) fail('TILT','운행 중 자세 변화 또는 횡방향 움직임이 큽니다. 휴대폰을 고정하고 재측정하세요.');
    const pre=raw.filter((_,i)=>t[i]<t[iA]-0.2 && t[i]>t[iA]-1.5);
    const bPre=pre.length*step>=500?mean(pre):0, bPost=mean(tail);
    const span=t[iB]-t[iA], corrected=a.map((v,i)=>v-(bPre+(bPost-bPre)*Math.max(0,Math.min(1,(t[i]-t[iA])/span))));
    const vel=t.map(t=>({t,v:0})); let v=0, positive=0,negative=0;
    for(let i=iA+1;i<=iB;i++){
      const dv=(corrected[i]+corrected[i-1])/2*(t[i]-t[i-1]);
      v+=dv; vel[i].v=v;
      if(dv*dir>0) positive+=dv*dir; else negative-=dv*dir;
    }
    // A partial brake must never be transformed into a complete stop by endpoint fitting.
    if(positive<0.2 || negative/positive<0.65 || negative/positive>1.5)
      fail('BALANCE','가속·감속의 균형이 맞지 않습니다. 중간 종료 또는 센서 오차가 의심됩니다.');
    const endDrift=Math.abs(v), correction=v/span;
    if(Math.abs(correction)>0.12) fail('DRIFT','필요한 드리프트 보정량이 너무 큽니다. 다시 측정하세요.');
    for(let i=iA;i<=iB;i++) vel[i].v-=v*(t[i]-t[iA])/span;
    const maxV=Math.max(...vel.map(p=>Math.abs(p.v)));
    if(endDrift/Math.max(maxV,0.1)>0.4) fail('DRIFT','누적 오차가 속도에 비해 너무 큽니다. 다시 측정하세요.');
    // Only a contiguous, sufficiently long plateau between acceleration and braking counts.
    let cs=-1,ce=-1,start=-1;
    const accelEnd=Math.max(...runs.filter(r=>r.sign===dir).map(r=>r.end));
    const brakeStart=runs.find(r=>r.sign!==dir).start;
    function closePlateau(end){
      if(start>=0 && t[end]-t[start]>=1.5 && (cs<0 || t[end]-t[start]>t[ce]-t[cs])){cs=start;ce=end;}
      start=-1;
    }
    for(let i=0;i<n;i++){
      const ok=i>accelEnd+radius && i<brakeStart-radius && Math.abs(corrected[i]-correction)<0.08 && Math.abs(vel[i].v)>maxV*0.65;
      if(ok){if(start<0)start=i;} else closePlateau(i-1);
    } closePlateau(n-1);
    const plateau=cs>=0?vel.slice(cs,ce+1):[];
    const cruise=plateau.length?median(plateau.map(p=>Math.abs(p.v))):null;
    let cruiseSlope=null;
    if(plateau.length){
      const mt=mean(plateau.map(p=>p.t)),mv=mean(plateau.map(p=>Math.abs(p.v)));
      const den=plateau.reduce((s,p)=>s+(p.t-mt)**2,0);
      cruiseSlope=plateau.reduce((s,p)=>s+(p.t-mt)*(Math.abs(p.v)-mv),0)/den*(t[ce]-t[cs]);
    }
    let displacement=0;
    for(let i=1;i<n;i++) displacement+=(vel[i].v+vel[i-1].v)/2*(t[i]-t[i-1]);
    const warnings=[];
    if(tiltDeg>=2) warnings.push('운행 중 자세 변화 또는 횡방향 움직임이 있습니다.');
    if(quality.sampleHz<30) warnings.push('센서 주기가 낮아 짧은 가감속의 오차가 커질 수 있습니다.');
    if(cruise===null) warnings.push('1.5초 이상의 정속 구간이 없어 정속 속도를 표시하지 않습니다.');
    if(cruise && Math.abs(cruiseSlope)/cruise>0.035) warnings.push('정속 구간의 속도가 기울어져 있습니다. 재측정이 필요합니다.');
    if(endDrift/Math.max(maxV,0.1)>0.15) warnings.push('누적 드리프트 보정량이 큽니다.');
    return {version:VERSION,cruise,maxV,dist:Math.abs(displacement),duration:span,fullSpan:t.at(-1),vel,
      cruiseStart:cs,cruiseEnd:ce,gmag:base.gmag,n:ride.length,endDrift,sensor:options.sensor,
      tiltDeg,scaleK:1,cruiseSlope,moveBias:null,warnings,baselineSigma:sigma,...quality};
  }
  const api={VERSION,baseline,vertical,analyze,validate};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.ElevatorMeasurement=api;
})(typeof globalThis!=='undefined'?globalThis:this);
