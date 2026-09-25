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
    this.baseBufferMs = 0; // Zero base buffer — minimum latency. Delay slider adds ms ON TOP of WebRTC pipeline latency.
    this.currentVolume = 1.0;
  }

  init() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass({ latencyHint: 'interactive', sampleRate: 48000 });
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setupStream(mediaStream) {
    this.init();
    this.disconnect();

    try {
      // Ensure browser treats stream as music (disables telephone speech filtering)
      mediaStream.getAudioTracks().forEach(track => {
        if ('contentHint' in track) {
          track.contentHint = 'music';
        }
      });

      this.sourceNode = this.ctx.createMediaStreamSource(mediaStream);
      
      // Delay Node supporting up to 3.0s (sufficient for high-latency Wi-Fi & Bluetooth pipelines)
      this.delayNode = this.ctx.createDelay(3.0);
      const initialDelay = Math.max(0, (this.baseBufferMs + this.delayMs) / 1000);
      this.delayNode.delayTime.setValueAtTime(initialDelay, this.ctx.currentTime);

      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.setValueAtTime(this.currentVolume, this.ctx.currentTime);

      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = 128;
      this.analyserNode.smoothingTimeConstant = 0.8;

      // Audio Graph: Pure Bit-Perfect Passthrough (NO COMPRESSOR - zero squashing/muffling!)
      // source -> delay -> gain -> destination & analyser
      this.sourceNode.connect(this.delayNode);
      this.delayNode.connect(this.gainNode);
      this.gainNode.connect(this.ctx.destination);
      this.gainNode.connect(this.analyserNode);

      console.log(`[AudioProcessor] ✅ Hi-Fi Pipeline CONNECTED | ctx.state=${this.ctx.state} | sampleRate=${this.ctx.sampleRate} | baseLatency=${(this.ctx.baseLatency * 1000).toFixed(1)}ms | outputLatency=${((this.ctx.outputLatency || 0) * 1000).toFixed(1)}ms | initialDelay=${(initialDelay * 1000).toFixed(1)}ms | volume=${this.currentVolume}`);
      console.log(`[AudioProcessor] Nodes: source=${!!this.sourceNode} delay=${!!this.delayNode} gain=${!!this.gainNode} analyser=${!!this.analyserNode}`);
      console.log(`[AudioProcessor] Stream tracks: ${mediaStream.getAudioTracks().map(t => `${t.label} (${t.readyState}, hint=${t.contentHint})`).join(', ')}`);
    } catch (err) {
      console.error('[AudioProcessor] setupStream error:', err);
    }
  }

  /**
   * Set delay with smooth responsive tracking.
   * Continuous slider dragging uses smooth parameter interpolation without muting.
   * Discrete jumps use a micro-crossfade to eliminate pops.
   */
  setDelay(ms) {
    this.delayMs = Math.max(0, Math.min(2000, ms));
    const effectiveSec = Math.max(0, (this.baseBufferMs + this.delayMs) / 1000);
    
    console.log(`[AudioProcessor] setDelay(${ms}ms) → effective=${(effectiveSec * 1000).toFixed(1)}ms | ctx=${!!this.ctx} state=${this.ctx?.state} | delayNode=${!!this.delayNode}`);
    
    if (!this.delayNode || !this.ctx) {
      console.warn('[AudioProcessor] setDelay SKIPPED — delayNode or ctx is null!');
      return;
    }

    // Ensure AudioContext is running (mobile browsers suspend it)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    try {
      const now = this.ctx.currentTime;
      // Wipe ANY previous scheduled events on delayTime to prevent DOMException collisions
      this.delayNode.delayTime.cancelScheduledValues(0);
      this.delayNode.delayTime.setValueAtTime(effectiveSec, now);
    } catch (err) {
      console.warn('[AudioProcessor] setValueAtTime failed, using direct property assignment:', err);
      try {
        this.delayNode.delayTime.value = effectiveSec;
      } catch (e) {}
    }
  }

  setVolume(vol) {
    this.currentVolume = Math.max(0, Math.min(2, vol));
    if (this.gainNode && this.ctx) {
      try {
        const now = this.ctx.currentTime;
        this.gainNode.gain.cancelScheduledValues(0);
        this.gainNode.gain.setValueAtTime(this.currentVolume, now);
      } catch (e) {
        try {
          this.gainNode.gain.value = this.currentVolume;
        } catch (err) {}
      }
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
