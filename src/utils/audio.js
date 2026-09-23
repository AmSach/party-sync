// Universal Synced Audio Processor for PartySync
// Streams identical full-range audio across all connected devices

class SyncedAudioProcessor {
  constructor() {
    this.ctx = null;
    this.sourceNode = null;
    this.delayNode = null;
    this.gainNode = null;
    this.analyserNode = null;
    this.delayMs = 0;
    this.baseBufferMs = 50; // Headroom allowing bidirectional micro-nudges (-45ms to +100ms)
  }

  init() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass({ latencyHint: 'interactive' });
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setupStream(mediaStream) {
    this.init();
    this.disconnect();

    try {
      this.sourceNode = this.ctx.createMediaStreamSource(mediaStream);
      this.delayNode = this.ctx.createDelay(1.0);
      const initialDelay = Math.max(0, (this.baseBufferMs + this.delayMs) / 1000);
      this.delayNode.delayTime.setValueAtTime(initialDelay, this.ctx.currentTime);

      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = 128;
      this.analyserNode.smoothingTimeConstant = 0.8;

      // Pure direct full-range audio routing to hardware speakers and VU meter
      this.sourceNode.connect(this.delayNode);
      this.delayNode.connect(this.gainNode);
      this.gainNode.connect(this.ctx.destination);
      this.gainNode.connect(this.analyserNode);
    } catch (err) {
      console.error('[AudioProcessor] setupStream error:', err);
    }
  }

  setDelay(ms) {
    this.delayMs = Math.max(-45, Math.min(100, ms));
    if (this.delayNode && this.ctx) {
      const effectiveSec = Math.max(0, (this.baseBufferMs + this.delayMs) / 1000);
      this.delayNode.delayTime.setTargetAtTime(effectiveSec, this.ctx.currentTime, 0.05);
    }
  }

  setVolume(vol) {
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setValueAtTime(Math.max(0, Math.min(2, vol)), this.ctx.currentTime);
    }
  }

  disconnect() {
    try {
      this.sourceNode?.disconnect();
      this.delayNode?.disconnect();
      this.gainNode?.disconnect();
      this.analyserNode?.disconnect();
    } catch (e) {
      // ignore
    }
  }
}

export const audioProcessor = new SyncedAudioProcessor();
