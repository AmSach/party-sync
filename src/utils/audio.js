// Universal Studio Synced Audio Processor for PartySync
// Clean, distortion-free full-range stereo playback with soft-knee limiter & pop-free micro-fading
import './sdp'; // Ensures Hi-Fi Opus SDP negotiation on all WebRTC calls

class SyncedAudioProcessor {
  constructor() {
    this.ctx = null;
    this.sourceNode = null;
    this.delayNode = null;
    this.gainNode = null;
    this.compressorNode = null;
    this.analyserNode = null;
    this.delayMs = 0;
    this.baseBufferMs = 100; // 100ms base buffer allows clean -90ms to +350ms delay adjustments (ideal for Bluetooth)
    this.currentVolume = 1.0;
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
      
      // Delay Node supporting up to 2.0s (sufficient for extreme Bluetooth latencies)
      this.delayNode = this.ctx.createDelay(2.0);
      const initialDelay = Math.max(0, (this.baseBufferMs + this.delayMs) / 1000);
      this.delayNode.delayTime.setValueAtTime(initialDelay, this.ctx.currentTime);

      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.setValueAtTime(this.currentVolume, this.ctx.currentTime);

      // Studio Master Limiter / Compressor: Prevents digital 0dBFS clipping on phone speakers
      this.compressorNode = this.ctx.createDynamicsCompressor();
      this.compressorNode.threshold.setValueAtTime(-1.0, this.ctx.currentTime);
      this.compressorNode.knee.setValueAtTime(12, this.ctx.currentTime);
      this.compressorNode.ratio.setValueAtTime(20, this.ctx.currentTime);
      this.compressorNode.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressorNode.release.setValueAtTime(0.20, this.ctx.currentTime);

      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = 128;
      this.analyserNode.smoothingTimeConstant = 0.8;

      // Audio Graph: source -> delay -> gain -> compressor -> destination & analyser
      this.sourceNode.connect(this.delayNode);
      this.delayNode.connect(this.gainNode);
      this.gainNode.connect(this.compressorNode);
      this.compressorNode.connect(this.ctx.destination);
      this.gainNode.connect(this.analyserNode);

      console.log('[AudioProcessor] Hi-Fi Audio pipeline connected cleanly with soft-knee limiter');
    } catch (err) {
      console.error('[AudioProcessor] setupStream error:', err);
    }
  }

  /**
   * Set delay with a micro-crossfade.
   * Completely eliminates Doppler pitch-bending / flanging / jet-engine "whoosh" sound!
   */
  setDelay(ms, instant = false) {
    this.delayMs = Math.max(-90, Math.min(400, ms));
    if (this.delayNode && this.ctx) {
      const effectiveSec = Math.max(0, (this.baseBufferMs + this.delayMs) / 1000);

      if (instant || !this.gainNode || this.ctx.state !== 'running') {
        this.delayNode.delayTime.setValueAtTime(effectiveSec, this.ctx.currentTime);
        return;
      }

      // Micro-crossfade: ramp gain down over 15ms, snap delay instantly, ramp gain back up over 15ms.
      // This mathematically guarantees zero pitch-bending / whooshing during delay shifts!
      const now = this.ctx.currentTime;
      const targetGain = this.currentVolume;

      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0.001, now + 0.015);

      this.delayNode.delayTime.setValueAtTime(effectiveSec, now + 0.018);

      this.gainNode.gain.setValueAtTime(0.001, now + 0.020);
      this.gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.035);
    }
  }

  setVolume(vol) {
    this.currentVolume = Math.max(0, Math.min(2, vol));
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setValueAtTime(this.currentVolume, this.ctx.currentTime);
    }
  }

  disconnect() {
    try {
      this.sourceNode?.disconnect();
      this.delayNode?.disconnect();
      this.gainNode?.disconnect();
      this.compressorNode?.disconnect();
      this.analyserNode?.disconnect();
    } catch (e) {
      // ignore
    }
  }
}

export const audioProcessor = new SyncedAudioProcessor();
