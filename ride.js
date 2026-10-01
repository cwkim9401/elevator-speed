(function(){
  'use strict';
  const $=id=>document.getElementById(id), core=RideCore;
  let busy=false, kind='', token=0, capture=null, last=null, prepared=null;
  let stream=null, ctx=null, node=null, source=null, sensor=null, wake=null;
  let timer=null, fallback=null, sensorKind='', audioClock=0, started=0;
  let folder=null, saving=false;
  window.ElevatorRideBusy=()=>busy;
  const status=text=>{$('rideStatus').textContent=text;};
  function controls(){
    $('saveEsv').disabled=busy||saving||!prepared;
    $('saveRideRaw').disabled=busy||saving||!last;
    $('rideStart').disabled=saving||(busy&&kind!=='ride');
    $('rideStart').textContent=busy&&kind==='ride'?'측정 종료':'승차감 · 속도 측정 시작';
    $('rideStart').classList.toggle('stop',busy&&kind==='ride');
  }
  function alive(id){if(id!==token||!busy)throw Error('측정 시작이 취소되었습니다.');}
  async function microphone(id){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw Error('HTTPS 주소에서 마이크를 사용할 수 있는 브라우저로 실행하세요.');
    const ac=new AudioContext({latencyHint:'interactive'});
    ctx=ac;await ac.resume();alive(id);
    const media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    if(id!==token||!busy){media.getTracks().forEach(t=>t.stop());throw Error('취소되었습니다.');}
    stream=media;
    const track=media.getAudioTracks()[0], settings=track.getSettings();
    if(['echoCancellation','noiseSuppression','autoGainControl'].some(k=>settings[k]===true))
      throw Error('마이크 자동 음량·잡음 처리를 끌 수 없습니다. 다른 브라우저를 사용하세요.');
    capture.microphone={label:track.label,settings};
    track.onended=()=>{if(busy)stop('마이크가 중단되었습니다.');};
    await ac.audioWorklet.addModule('./sound-worklet.js');alive(id);
    if(ac.state!=='running')throw Error('마이크 오디오가 시작되지 않았습니다. 다시 눌러주세요.');
    audioClock=performance.now()-ac.currentTime*1000;
    source=ac.createMediaStreamSource(media);node=new AudioWorkletNode(ac,'elevator-sound-meter');
    node.port.onmessage=e=>{
      if(id!==token||!busy)return;
      const a=e.data,t=audioClock+a.time*1000;
      if(!Number.isFinite(t)||!Number.isFinite(a.power)||a.power<0)return;
      capture.audio.push({t,power:a.power});
      if(a.peak>=0.999)capture.clipped=true;
    };
    // The worklet outputs silence; connect it to keep processing, never play microphone audio.
    source.connect(node);node.connect(ac.destination);
  }
  function accept(x,y,z,t){
    if(!busy||kind!=='ride'||![x,y,z,t].every(Number.isFinite))return;
    const a=capture.samples,prev=a.at(-1);
    if(prev&&t<=prev.t)return;
    if(prev&&t-prev.t>150){stop('가속도 데이터가 끊겼습니다.');return;}
    a.push({t,x,y,z});
    if(a.length===1)started=performance.now();
  }
  function motion(e){
    const a=e.accelerationIncludingGravity;
    if(a){sensorKind='devicemotion';accept(a.x,a.y,a.z,performance.now());}
  }
  function fallbackSensor(){
    if(sensor){sensor.stop();sensor=null;}
    sensorKind='devicemotion';window.addEventListener('devicemotion',motion,{passive:true});
  }
  function accelerometer(){
    if('Accelerometer' in window){
      try{
        sensor=new Accelerometer({frequency:120});
        sensor.addEventListener('reading',()=>{
          sensorKind='accelerometer';clearTimeout(fallback);
          accept(sensor.x,sensor.y,sensor.z,sensor.timestamp);
        });
        sensor.addEventListener('error',()=>{
          if(!busy)return;
          if(capture.samples.length)stop('가속도 센서가 중단되었습니다.');else fallbackSensor();
        });
        sensor.start();fallback=setTimeout(()=>{if(busy&&!capture.samples.length)fallbackSensor();},1500);
        return;
      }catch(_){fallbackSensor();return;}
    }
    fallbackSensor();
  }
  function cleanup(){
    clearInterval(timer);clearTimeout(fallback);timer=null;fallback=null;
    window.removeEventListener('devicemotion',motion);
    if(sensor){try{sensor.stop();}catch(_){}sensor=null;}
    if(node){node.port.onmessage=null;node.disconnect();node=null;}
    if(source){source.disconnect();source=null;}
    if(stream){stream.getTracks().forEach(t=>{t.onended=null;t.stop();});stream=null;}
    if(ctx){ctx.close().catch(()=>{});ctx=null;}
    if(wake){wake.release().catch(()=>{});wake=null;}
  }
  async function start(){
    if(busy||saving)return;
    busy=true;kind='starting';const id=++token;
    capture={version:2,capturedAt:new Date().toISOString(),direction:'unknown',
      samples:[],audio:[],soundUnit:'dBFS',soundEncoding:'normalized-digital-rms-uncalibrated',clipped:false,baselineTrimMs:500};
    controls();status('마이크와 센서 권한을 확인하고 있습니다…');
    try{
      if(typeof DeviceMotionEvent!=='undefined'&&typeof DeviceMotionEvent.requestPermission==='function'){
        if(await DeviceMotionEvent.requestPermission()!=='granted')throw Error('가속도 센서 권한이 필요합니다.');alive(id);
      }
      await microphone(id);alive(id);
      if(navigator.wakeLock){try{
        const lock=await navigator.wakeLock.request('screen');
        if(id!==token||!busy){await lock.release();return;}wake=lock;
      }catch(_){}}
      alive(id);started=performance.now();
      kind='ride';$('rideResult').hidden=true;
      $('rideTime').textContent='0.0 s';$('soundLive').textContent='– dBFS';
      $('rideChart').getContext('2d').clearRect(0,0,$('rideChart').width,$('rideChart').height);
      status('처음 0.5초는 제외하고 정지 기준을 잡습니다. 화면을 위로 고정하세요.');accelerometer();
      timer=setInterval(tick,100);controls();
    }catch(e){if(id===token)stop(e.message||'권한 또는 센서 시작에 실패했습니다.');}
  }
  function tick(){
    if(!busy)return;
    const now=performance.now(),a=capture.audio.at(-1),s=capture.samples;
    if(now-started>3000&&(!a||now-a.t>1000)){stop('마이크 데이터가 끊겼습니다.');return;}
    const power=capture.audio.slice(-12).reduce((sum,p)=>sum+p.power,0)/Math.max(1,Math.min(12,capture.audio.length));
    $('soundLive').textContent=core.soundDb(power).toFixed(1)+' dBFS';
    if(now-started>5000&&!s.length){stop('가속도 센서 응답이 없습니다. 권한과 브라우저를 확인하세요.');return;}
    if(s.length&&now-s.at(-1).t>1000){stop('가속도 센서 응답이 중단되었습니다.');return;}
    if(!s.length)return;
    const elapsed=(s.at(-1).t-s[0].t)/1000;
    $('rideTime').textContent=elapsed.toFixed(1)+' s';
    if(elapsed<0.5)status('버튼을 누른 흔들림을 제외하는 중…');
    else if(elapsed<3.1)status('정지 기준 측정… '+Math.max(0,3.1-elapsed).toFixed(1)+'초');
    else {
      if(!capture.baseline){try{capture.baseline=core.baseline(s);}catch(e){stop(e.message);return;}}
      status('측정 중 · 운행 후 3초 기다린 뒤 종료하세요.');draw(s,capture.baseline);
    }
    if(elapsed>=600)stop('10분 제한에 도달했습니다.');
  }
  function stop(error){
    if(!busy)return;
    busy=false;kind='';++token;cleanup();
    capture.sensor=sensorKind;capture.error=error||null;last=capture;prepared=null;
    $('rideResult').hidden=false;
    for(const id of ['resultSpeed','resultX','resultY','resultZ','resultSound'])$(id).textContent='–';
    $('resultSpeedLabel').textContent='속도';$('speedDetail').textContent='';
    try{
      if(error)throw Error(error);
      prepared=core.prepare(last);
      const speed=core.speedResult(last,ElevatorMeasurement);
      last.direction=speed.direction;last.speed=speed.result;last.speedError=speed.error;
      const r=core.summary(prepared);last.summary=r;
      if(speed.result){
        const v=speed.result.cruise??speed.result.maxV;
        $('resultSpeedLabel').textContent=speed.result.cruise===null?'최고 속도 (정속 구간 없음)':'정속 속도';
        $('resultSpeed').textContent=v.toFixed(2)+' m/s';
        $('speedDetail').textContent=(v*60).toFixed(1)+' m/min · '+(speed.direction==='up'?'상승':speed.direction==='dn'?'하강':'방향 미확인');
      }else{
        $('resultSpeed').textContent='계산 불가';$('speedDetail').textContent=speed.error;
      }
      r.axes.forEach((a,i)=>{$(['resultX','resultY','resultZ'][i]).textContent=a.rms.toFixed(2)+' gal';});
      $('resultSound').textContent=r.sound.toFixed(1)+' dBFS';
      $('rideSummary').textContent='기록 '+r.duration.toFixed(2)+'초 · 센서 '+r.hz.toFixed(1)+' Hz\n'+
        '최대 절댓값: '+r.axes.map((a,i)=>['X','Y','Z'][i]+' '+a.peak.toFixed(2)).join(' / ')+' gal'+
        (speed.result&&speed.result.warnings.length?'\n'+speed.result.warnings.join('\n'):'');
      status('기록 완료. ESV를 저장할 수 있습니다.');
    }catch(e){$('rideSummary').textContent=e.message;status('측정 미완료: '+e.message+' 원본 JSON은 저장할 수 있습니다.');}
    controls();
  }
  function draw(s,b){
    const cv=$('rideChart'),g=cv.getContext('2d'),w=cv.width,h=cv.height;
    g.clearRect(0,0,w,h);g.strokeStyle='#394150';g.beginPath();g.moveTo(0,h/2);g.lineTo(w,h/2);g.stroke();
    const end=s.at(-1).t,rows=s.filter(p=>p.t>=end-5000);
    let limit=0.15;for(const p of rows)for(const k of ['x','y','z'])limit=Math.max(limit,Math.abs(p[k]-b[k]));
    ['x','y','z'].forEach((k,i)=>{
      g.strokeStyle=['#60a5fa','#fb923c','#36d399'][i];g.beginPath();
      rows.forEach((p,j)=>{const x=(p.t-end+5000)/5000*w,y=h/2-(p[k]-b[k])/limit*(h/2-20);if(j)g.lineTo(x,y);else g.moveTo(x,y);});g.stroke();
    });
    g.fillStyle='#9ca3af';g.font='12px sans-serif';g.fillText('±'+(limit*100).toFixed(1)+' gal',8,15);
  }
  // Persist the granted directory handle, never a made-up Android filesystem path.
  async function folderStore(value,write=false){
    const db=await new Promise((resolve,reject)=>{
      const q=indexedDB.open('elevator-save-folder',1);q.onupgradeneeded=()=>q.result.createObjectStore('settings');
      q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
    });
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction('settings',write?'readwrite':'readonly'),st=tx.objectStore('settings');
      const q=write?st.put(value,'folder'):st.get('folder');let result;
      q.onsuccess=()=>{result=q.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });}finally{db.close();}
  }
  const folderLabel=()=>{$('folderStatus').textContent=folder?'선택된 폴더: '+folder.name+' · 저장 시 권한을 확인합니다.':'폴더 미선택 · 브라우저 다운로드 위치에 저장됩니다.';};
  const readyFolder=folderStore().then(value=>{folder=value||null;folderLabel();}).catch(()=>{});
  $('chooseFolder').onclick=async()=>{
    if(!window.showDirectoryPicker){$('folderStatus').textContent='이 브라우저는 폴더 선택을 지원하지 않습니다. 다운로드 후 내 파일 앱에서 storage/ELScan으로 이동하세요.';return;}
    try{await readyFolder;folder=await window.showDirectoryPicker({id:'el-scan-output',mode:'readwrite'});folderLabel();
      try{await folderStore(folder,true);}catch(_){$('folderStatus').textContent+=' (이번 실행에만 적용)';}
    }catch(e){if(e.name!=='AbortError')$('folderStatus').textContent='폴더 선택 실패: '+e.message;}
  };
  $('defaultDownload').onclick=async()=>{await readyFolder;folder=null;folderLabel();try{await folderStore(null,true);}catch(_){}};
  async function save(blob,name){
    await readyFolder;
    if(folder){
      if(await folder.queryPermission({mode:'readwrite'})!=='granted'&&await folder.requestPermission({mode:'readwrite'})!=='granted')throw Error('폴더 쓰기 권한이 없습니다. 폴더를 다시 선택하세요.');
      // Never replace an earlier recording with the same filename.
      let chosen=name,i=1;
      while(true){try{await folder.getFileHandle(chosen);chosen=name.replace(/(\.[^.]+)$/,`_${i++}$1`);}catch(e){if(e.name==='NotFoundError')break;throw e;}}
      const handle=await folder.getFileHandle(chosen,{create:true}),writer=await handle.createWritable();
      try{await writer.write(blob);await writer.close();}catch(e){try{await writer.abort();}catch(_){}throw e;}
      $('saveStatus').textContent=folder.name+' / '+chosen+' 저장 완료';
    }else{
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      $('saveStatus').textContent='다운로드 요청: '+name+'\n브라우저 다운로드 위치를 확인하세요. ELScan 폴더로 자동 저장된 것은 아닙니다.';
    }
  }
  function filename(extension){return core.filename(last,extension);}
  async function saveCapture(raw){
    if(saving||busy||!last)return;saving=true;controls();
    try{
      const blob=raw?new Blob([JSON.stringify(last)],{type:'application/json'}):new Blob([
        core.writeESV(Uint8Array.from(atob(ESV_HEADER_BASE64),c=>c.charCodeAt(0)),last,prepared)
      ],{type:'application/octet-stream'});
      await save(blob,filename(raw?'json':'esv'));
    }catch(e){$('saveStatus').textContent='저장 실패: '+e.message;}finally{saving=false;controls();}
  }
  $('rideStart').onclick=()=>busy?stop():start();
  $('saveEsv').onclick=()=>saveCapture(false);$('saveRideRaw').onclick=()=>saveCapture(true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&busy)stop('화면이 숨겨져 측정을 중단했습니다.');});
  window.addEventListener('pagehide',()=>{if(busy)stop('페이지를 닫아 측정을 중단했습니다.');});
  controls();
})();
