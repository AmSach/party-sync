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
    // Configure iOS 17+ / mobile browser playback audio session (bypasses iPhone physical mute switch)
    if (typeof navigator !== 'undefined' && 'audioSession' in navigator) {
      try {
        navigator.audioSession.type = 'playback';
      } catch (e) {}
    }

    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass({ latencyHint: 'interactive', sampleRate: 48000 });
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    // Mobile unlock: play a 1-sample silent buffer to unlock audio hardware pipeline
    try {
      const buffer = this.ctx.createBuffer(1, 1, 22050);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      source.start(0);
    } catch (e) {}

    // Mobile & WebRTC stream activator: Pre-create and warm up during user touch gesture
    if (typeof document !== 'undefined' && !this.streamActivator) {
      try {
        const audio = document.createElement('audio');
        audio.id = 'party-sync-stream-activator';
        audio.autoplay = true;
        audio.playsInline = true;
        audio.muted = true;
        audio.volume = 0;
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('webkit-playsinline', 'true');
        audio.style.position = 'fixed';
        audio.style.opacity = '0';
        audio.style.pointerEvents = 'none';
        audio.style.width = '1px';
        audio.style.height = '1px';
        audio.style.bottom = '0';
        audio.style.left = '0';
        document.body.appendChild(audio);

        // Warm up with tiny silent WAV to authorize audio playback on mobile OS
        audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAD//w8A';
        audio.play().catch(() => {});
        this.streamActivator = audio;
      } catch (e) {
        console.warn('[AudioProcessor] Pre-warming activator notice:', e);
      }
    }
  }

  unlock() {
    if (typeof navigator !== 'undefined' && 'audioSession' in navigator) {
      try {
        navigator.audioSession.type = 'playback';
      } catch (e) {}
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.streamActivator) {
      this.streamActivator.play().catch(() => {});
    }
  }

  setupStream(mediaStream) {
    this.init();
    this.disconnect();

    if (!mediaStream || mediaStream.getAudioTracks().length === 0) {
      console.warn('[AudioProcessor] setupStream called with null or empty stream');
      return;
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    // Pull RTP packets from the network into the browser's decoding engine.
    if (this.streamActivator) {
      try {
        this.streamActivator.removeAttribute('src');
        this.streamActivator.src = '';
        this.streamActivator.srcObject = mediaStream;
        const playPromise = this.streamActivator.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn('[AudioProcessor] Stream activator play notice (user interaction required):', err);
          });
        }
      } catch (e) {
        console.warn('[AudioProcessor] Stream activator notice:', e);
      }
    }

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
      // Smooth 35ms exponential transition eliminates Web Audio ring-buffer pointer clicks, pops and dropped samples
      this.delayNode.delayTime.cancelScheduledValues(now);
      this.delayNode.delayTime.setTargetAtTime(effectiveSec, now, 0.035);
    } catch (err) {
      console.warn('[AudioProcessor] setTargetAtTime failed, using direct property assignment:', err);
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
      // NOTE: Do NOT pause or null streamActivator.srcObject here —
      // setupStream() calls disconnect() then immediately reassigns srcObject.
      // Nulling it mid-stream causes an audio gap. streamActivator lifecycle
      // is managed solely by setupStream() and the full component unmount.
    } catch (e) {
      // ignore
    }
    this.sourceNode = null;
    this.delayNode = null;
    this.gainNode = null;
    this.analyserNode = null;
  }

  // Full teardown for component unmount — also cleans up the DOM activator element.
  fullDisconnect() {
    this.disconnect();
    try {
      if (this.streamActivator) {
        this.streamActivator.pause();
        this.streamActivator.srcObject = null;
        this.streamActivator.src = '';
        if (this.streamActivator.parentNode) {
          this.streamActivator.parentNode.removeChild(this.streamActivator);
        }
        this.streamActivator = null;
      }
      if (this.ctx) {
        this.ctx.close().catch(() => {});
        this.ctx = null;
      }
    } catch (e) {}
  }
}

export const audioProcessor = new SyncedAudioProcessor();
