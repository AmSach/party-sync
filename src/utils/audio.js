// Web Audio API Routing & Spatial Processor for PartySync

class SpatialAudioProcessor {
  constructor() {
    this.ctx = null;
    this.sourceNode = null;
    this.delayNode = null;
    this.splitterNode = null;
    this.mergerNode = null;
    this.filterNode = null;
    this.gainNode = null;
    this.analyserNode = null;
    this.currentRole = 'stereo'; // 'stereo' | 'left' | 'right' | 'bass'
    this.delayMs = 0;
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

    // Clean up existing nodes
    this.disconnect();

    this.sourceNode = this.ctx.createMediaStreamSource(mediaStream);
    this.delayNode = this.ctx.createDelay(1.0); // max 1 second delay
    this.delayNode.delayTime.setValueAtTime(this.delayMs / 1000, this.ctx.currentTime);

    this.splitterNode = this.ctx.createChannelSplitter(2);
    this.mergerNode = this.ctx.createChannelMerger(2);

    // Low-pass filter for Subwoofer/Bass mode
    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.setValueAtTime(140, this.ctx.currentTime); // 140Hz cutoff
    this.filterNode.Q.setValueAtTime(1.0, this.ctx.currentTime);

    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 128;
    this.analyserNode.smoothingTimeConstant = 0.8;

    // Connect source -> delay
    this.sourceNode.connect(this.delayNode);

    // Route channels based on selected role
    this.applyRole(this.currentRole);
  }

  applyRole(role) {
    this.currentRole = role;
    if (!this.delayNode || !this.ctx) return;

    try {
      this.delayNode.disconnect();
      this.splitterNode.disconnect();
      this.mergerNode.disconnect();
      this.filterNode.disconnect();
      this.gainNode.disconnect();
    } catch (e) {
      // ignore disconnection errors on unlinked nodes
    }

    if (role === 'bass') {
      // Subwoofer role: Delay -> Lowpass Filter -> Gain -> Analyser -> Destination
      this.delayNode.connect(this.filterNode);
      this.filterNode.connect(this.gainNode);
      this.gainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.ctx.destination);
    } else if (role === 'left') {
      // Left channel only: Split -> Channel 0 to both output channels
      this.delayNode.connect(this.splitterNode);
      this.splitterNode.connect(this.mergerNode, 0, 0); // left to left
      this.splitterNode.connect(this.mergerNode, 0, 1); // left to right
      this.mergerNode.connect(this.gainNode);
      this.gainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.ctx.destination);
    } else if (role === 'right') {
      // Right channel only: Split -> Channel 1 to both output channels
      this.delayNode.connect(this.splitterNode);
      this.splitterNode.connect(this.mergerNode, 1, 0); // right to left
      this.splitterNode.connect(this.mergerNode, 1, 1); // right to right
      this.mergerNode.connect(this.gainNode);
      this.gainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.ctx.destination);
    } else {
      // Full Stereo (Default): Delay -> Gain -> Analyser -> Destination
      this.delayNode.connect(this.gainNode);
      this.gainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.ctx.destination);
    }
  }

  setDelay(ms) {
    this.delayMs = Math.max(-300, Math.min(500, ms));
    if (this.delayNode && this.ctx) {
      // In Web Audio API, delayTime cannot be negative, so we map 0-500ms
      const effectiveSec = Math.max(0, this.delayMs / 1000);
      this.delayNode.delayTime.setValueAtTime(effectiveSec, this.ctx.currentTime);
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
      this.splitterNode?.disconnect();
      this.mergerNode?.disconnect();
      this.filterNode?.disconnect();
      this.gainNode?.disconnect();
      this.analyserNode?.disconnect();
    } catch (e) {
      // ignore
    }
  }
}

export const audioProcessor = new SpatialAudioProcessor();
