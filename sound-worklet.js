/* Only 10 ms energy levels leave this processor; speech/PCM is never stored. */
class ElevatorSoundMeter extends AudioWorkletProcessor {
  constructor(){super();this.sum=0;this.n=0;this.peak=0;this.block=Math.round(sampleRate/100);}
  process(inputs){
    const data=inputs[0]&&inputs[0][0];
    if(data)for(let i=0;i<data.length;i++){
      this.sum+=data[i]*data[i];this.peak=Math.max(this.peak,Math.abs(data[i]));this.n++;
      if(this.n>=this.block){
        this.port.postMessage({time:(currentFrame+i+1-this.n/2)/sampleRate,power:this.sum/this.n,peak:this.peak});
        this.sum=0;this.n=0;this.peak=0;
      }
    }
    return true;
  }
}
registerProcessor('elevator-sound-meter',ElevatorSoundMeter);
