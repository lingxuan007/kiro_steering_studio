class ExpandableBuffer {
  constructor() {
    this.buffer = new Float32Array(24000);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.isInitialBuffering = true;
    this.initialBufferLength = 24000;
  }
  write(samples) {
    if (this.writeIndex + samples.length > this.buffer.length) {
      const unread = this.buffer.subarray(this.readIndex, this.writeIndex);
      const newLen = Math.max(unread.length + samples.length, this.buffer.length * 2);
      const nb = new Float32Array(newLen);
      nb.set(unread, 0);
      this.buffer = nb;
      this.writeIndex = unread.length;
      this.readIndex = 0;
    }
    this.buffer.set(samples, this.writeIndex);
    this.writeIndex += samples.length;
    if (this.writeIndex - this.readIndex >= this.initialBufferLength) this.isInitialBuffering = false;
  }
  read(dest) {
    let n = 0;
    if (!this.isInitialBuffering) n = Math.min(dest.length, this.writeIndex - this.readIndex);
    dest.set(this.buffer.subarray(this.readIndex, this.readIndex + n));
    this.readIndex += n;
    if (n < dest.length) dest.fill(0, n);
    if (n === 0) this.isInitialBuffering = true;
  }
  clearBuffer(){ this.readIndex = 0; this.writeIndex = 0; }
}
class AudioPlayerProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.playbackBuffer = new ExpandableBuffer();
    this.port.onmessage = (event) => {
      if (event.data.type === "audio") this.playbackBuffer.write(event.data.audioData);
      if (event.data.type === "barge-in") this.playbackBuffer.clearBuffer();
    };
  }
  process(_inputs, outputs){
    const out = outputs[0][0];
    this.playbackBuffer.read(out);
    return true;
  }
}
registerProcessor("audio-player-processor", AudioPlayerProcessor);
