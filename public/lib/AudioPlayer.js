const AudioPlayerWorkletUrl = new URL('./AudioPlayerProcessor.worklet.js', import.meta.url).toString();

export class AudioPlayer {
  constructor() {
    this.initialized = false;
  }

  async start() {
    this.audioContext = new AudioContext({ sampleRate: 24000 });
    await this.audioContext.audioWorklet.addModule(AudioPlayerWorkletUrl);
    this.workletNode = new AudioWorkletNode(this.audioContext, "audio-player-processor");
    this.workletNode.connect(this.audioContext.destination);
    this.initialized = true;
  }

  bargeIn() {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({ type: "barge-in" });
  }

  playAudio(samples) {
    if (!this.initialized) return;
    this.workletNode.port.postMessage({ type: "audio", audioData: samples });
  }
}
