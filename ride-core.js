/* Experimental EL-Scan writer. Verified layout, approximate acceleration gain.
   Sound is uncalibrated digital RMS, not acoustic pressure or calibrated SPL. */
(function(root){
  'use strict';
  const RATE=256, HEADER=928, GAIN=32768/10000;
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  function check(rows,keys,maxGap,label){
    if(!Array.isArray(rows)||rows.length<2) throw Error(label+' 데이터가 부족합니다.');
    rows.forEach((r,i)=>{
      if(!['t',...keys].every(k=>Number.isFinite(r[k]))) throw Error(label+' 값이 유효하지 않습니다.');
      if(i&&(r.t<=rows[i-1].t||r.t-rows[i-1].t>maxGap)) throw Error(label+' 기록이 끊기거나 시간이 중복되었습니다.');
    });
  }
  function baseline(samples){
    check(samples,['x','y','z'],150,'가속도');
    const t0=samples[0].t;
    const rows=samples.filter(s=>s.t>=t0+500&&s.t<=t0+3000);
    if(rows.length<30||rows.at(-1).t-rows[0].t<2400) throw Error('출발 전 3초 정지 기록이 필요합니다.');
    const b=Object.fromEntries(['x','y','z'].map(k=>[k,mean(rows.map(s=>s[k]))]));
    if(Math.hypot(b.x,b.y,b.z)<9.3||Math.hypot(b.x,b.y,b.z)>10.3||b.z<9||Math.hypot(b.x,b.y)>0.85)
      throw Error('화면을 위로 향하게 바닥에 수평으로 고정하세요.');
    if(['x','y','z'].some(k=>Math.sqrt(mean(rows.map(s=>(s[k]-b[k])**2)))>0.12))
      throw Error('기준 측정 중 움직였습니다. 정지 상태에서 다시 시작하세요.');
    return b;
  }
  function prepare(capture){
    const s=capture.samples, audio=capture.audio;
    const b=baseline(s);
    check(audio,['power'],100,'소음');
    if(audio.some(p=>p.power<0)) throw Error('소음 에너지가 유효하지 않습니다.');
    const start=s[0].t+3000, end=Math.min(s.at(-1).t,audio.at(-1).t);
    if(audio[0].t>start||end-start<3000) throw Error('가속도와 소음의 동시 기록이 부족합니다.');
    const gaps=s.slice(1).map((r,i)=>r.t-s[i].t).sort((a,b)=>a-b);
    const hz=1000/gaps[Math.floor(gaps.length/2)];
    if(hz<20) throw Error('가속도 기록이 너무 느립니다(20 Hz 미만).');
    if(hz>260) throw Error('256 Hz를 초과한 기록은 별도 저역통과 처리가 필요합니다.');
    if(capture.error) throw Error('중단된 기록입니다. 원본을 저장하고 다시 측정하세요.');
    if(capture.clipped) throw Error('마이크 입력이 포화되었습니다. 마이크 위치를 확인하세요.');
    const n=Math.floor((end-start)*RATE/1000)+1;
    if(n>RATE*600) throw Error('최대 10분까지만 저장할 수 있습니다.');
    const axes=[new Float64Array(n),new Float64Array(n),new Float64Array(n)];
    const power=new Float64Array(n);
    let j=1,k=1;
    for(let i=0;i<n;i++){
      const t=start+i*1000/RATE;
      while(j<s.length-1&&s[j].t<t)j++;
      while(k<audio.length-1&&audio[k].t<t)k++;
      const p=s[j-1],q=s[j],f=(t-p.t)/(q.t-p.t);
      ['x','y','z'].forEach((key,c)=>axes[c][i]=p[key]+f*(q[key]-p[key])-b[key]);
      const ap=audio[k-1],aq=audio[k],af=(t-ap.t)/(aq.t-ap.t);
      power[i]=Math.max(0,ap.power+af*(aq.power-ap.power));
    }
    return {axes,power,n,hz,baseline:b,duration:n/RATE};
  }
  function soundDb(power,offset=0){return 10*Math.log10(Math.max(power,1e-16))+offset;}
  function writeESV(header,capture,prepared){
    if(!(header instanceof Uint8Array)||header.length!==HEADER)throw Error('ESV 기본 형식이 잘못되었습니다.');
    const r=prepared||prepare(capture);
    const buffer=new ArrayBuffer(HEADER+r.n*32), bytes=new Uint8Array(buffer),v=new DataView(buffer);
    bytes.set(header);bytes.fill(0,320,928);v.setFloat64(264,r.n/RATE,true);
    const label=('\r\nPHONE EXPERIMENTAL\r\nSOUND UNCALIBRATED RMS / NOT SPL\r\n'+(capture.capturedAt||'')+'\r\n'+({up:'UP',dn:'DOWN'}[capture.direction]||'UNKNOWN')).slice(0,280);
    for(let i=0;i<label.length;i++)v.setUint16(320+i*2,label.charCodeAt(i),true);
    for(let c=0;c<3;c++)for(let i=0;i<r.n;i++)v.setFloat64(HEADER+(c*r.n+i)*8,32768+r.axes[c][i]*GAIN,true);
    // Normalized digital microphone RMS, NOT pressure in Pa. Legacy SPL displays
    // cannot be interpreted as calibrated sound levels. Preserve real amplitudes;
    // never invent a calibration offset to make the legacy display look plausible.
    for(let i=0;i<r.n;i++){
      // Same -160 dBFS floor as soundDb; avoid log(0) in legacy readers.
      v.setFloat64(HEADER+(3*r.n+i)*8,Math.sqrt(Math.max(r.power[i],1e-16)),true);
    }
    return buffer;
  }
  function summary(r){
    return {hz:r.hz,duration:r.duration,axes:r.axes.map(a=>{
      let sq=0,peak=0;for(const x of a){sq+=x*x;peak=Math.max(peak,Math.abs(x));}
      return {rms:Math.sqrt(sq/a.length)*100,peak:peak*100};
    }),sound:soundDb(mean(r.power))};
  }
  function speedResult(capture,engine){
    try{
      const result=engine.analyze(capture.samples,{baselineEnd:capture.samples[0].t+3000,sensor:capture.sensor});
      const moving=result.vel.find(p=>Math.abs(p.v)>0.2);
      return {result,direction:moving?(moving.v>0?'up':'dn'):'unknown',error:null};
    }catch(e){return {result:null,direction:'unknown',error:e.message};}
  }
  function filename(capture,extension){
    const d=new Date(capture.capturedAt),pad=(n,w=2)=>String(n).padStart(w,'0');
    // Local phone date/time, with milliseconds; direction is never forced when unknown.
    const stamp=d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'_'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds())+'_'+pad(d.getMilliseconds(),3);
    const dir=['up','dn'].includes(capture.direction)?capture.direction:'unknown';
    return 'PHONE_'+stamp+'_'+dir+'_RQ.'+extension;
  }
  const api={RATE,HEADER,GAIN,baseline,prepare,writeESV,summary,soundDb,speedResult,filename};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RideCore=api;
})(globalThis);
