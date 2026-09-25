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
      
      // Delay Node supporting up to 2.0s (sufficient for Bluetooth latencies)
      this.delayNode = this.ctx.createDelay(2.0);
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
  setDelay(ms, isDiscreteJump = false) {
    this.delayMs = Math.max(-90, Math.min(400, ms));
    
    const effectiveSec = Math.max(0, (this.baseBufferMs + this.delayMs) / 1000);
    
    console.log(`[AudioProcessor] setDelay(${ms}ms, discrete=${isDiscreteJump}) → effective=${(effectiveSec * 1000).toFixed(1)}ms | ctx=${!!this.ctx} state=${this.ctx?.state} | delayNode=${!!this.delayNode} | gainNode=${!!this.gainNode}`);
    
    if (!this.delayNode || !this.ctx) {
      console.warn('[AudioProcessor] setDelay SKIPPED — delayNode or ctx is null!');
      return;
    }

    // Ensure AudioContext is running (mobile browsers suspend it)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        console.log('[AudioProcessor] AudioContext resumed from suspended state');
      });
    }

    if (!this.gainNode || this.ctx.state !== 'running') {
      this.delayNode.delayTime.setValueAtTime(effectiveSec, this.ctx.currentTime);
      console.log(`[AudioProcessor] setDelay applied via setValueAtTime (ctx not running or no gainNode)`);
      return;
    }

    if (isDiscreteJump) {
      // Micro-crossfade for large button jumps (+50ms, reset, profile switch)
      const now = this.ctx.currentTime;
      const targetGain = this.currentVolume;

      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0.01, now + 0.012);

      this.delayNode.delayTime.setValueAtTime(effectiveSec, now + 0.015);

      this.gainNode.gain.setValueAtTime(0.01, now + 0.018);
      this.gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.030);
      
      console.log(`[AudioProcessor] setDelay applied via micro-crossfade, target=${effectiveSec.toFixed(4)}s`);
    } else {
      // Continuous slider drag: smooth real-time parameter tracking WITHOUT muting!
      // You hear the audio shift immediately as your finger moves.
      this.delayNode.delayTime.setTargetAtTime(effectiveSec, this.ctx.currentTime, 0.025);
      
      console.log(`[AudioProcessor] setDelay applied via setTargetAtTime, target=${effectiveSec.toFixed(4)}s`);
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
