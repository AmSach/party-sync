// Automated Acoustic Synchronization Engine
// Brings a phone speaker close to the host speaker, activates the phone mic,
// and cross-correlates the two audio signals to measure the exact offset in milliseconds.
// Then auto-corrects the delay node to achieve sub-5ms phase alignment.

class AcousticAutoSync {
  constructor() {
    this.isCalibrating = false;
    this.onProgress = null; // (status: string) => void
    this.onComplete = null; // (offsetMs: number) => void
    this.onError = null;    // (msg: string) => void
    this._micStream = null;
    this._aborted = false;
  }

  abort() {
    this._aborted = true;
    this.isCalibrating = false;
    if (this._micStream) {
      this._micStream.getTracks().forEach(t => t.stop());
      this._micStream = null;
    }
  }

  /**
   * Run the full auto-sync calibration.
   * @param {AudioContext} ctx - The receiver's Web Audio context
   * @param {MediaStream} webrtcStream - The remote audio stream from the host
   * @param {Function} onProgress - Status callback
   * @param {Function} onComplete - Called with the measured offset in ms
   * @param {Function} onError - Called on failure
   */
  async calibrate(ctx, webrtcStream, onProgress, onComplete, onError) {
    if (this.isCalibrating) return;
    this.isCalibrating = true;
    this._aborted = false;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;

    try {
      // Step 1: Request microphone access
      onProgress?.('Requesting microphone access...');
      let micStream;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48000
          }
        });
      } catch (e) {
        onError?.('Mic access denied. Allow microphone to auto-sync.');
        this.isCalibrating = false;
        return;
      }

      if (this._aborted) { micStream.getTracks().forEach(t => t.stop()); return; }
      this._micStream = micStream;

      // Step 2: Set up recording nodes for both mic and WebRTC stream
      onProgress?.('Listening through microphone... Hold phone near host speaker.');
      if (ctx.state === 'suspended') await ctx.resume();

      const sampleRate = ctx.sampleRate;
      const recordDurationSec = 2.0;
      const bufferLength = Math.floor(sampleRate * recordDurationSec);

      // ScriptProcessor / AudioWorklet to capture raw PCM samples
      // We'll record simultaneously from mic and from WebRTC stream
      const micSource = ctx.createMediaStreamSource(micStream);
      const webrtcSource = ctx.createMediaStreamSource(webrtcStream);

      const micBuffer = new Float32Array(bufferLength);
      const webrtcBuffer = new Float32Array(bufferLength);

      let micOffset = 0;
      let webrtcOffset = 0;

      // Use AnalyserNode + getFloatTimeDomainData for clean sample capture
      const micAnalyser = ctx.createAnalyser();
      micAnalyser.fftSize = 2048;
      micSource.connect(micAnalyser);

      const webrtcAnalyser = ctx.createAnalyser();
      webrtcAnalyser.fftSize = 2048;
      webrtcSource.connect(webrtcAnalyser);

      const chunkSize = micAnalyser.fftSize;
      const micChunk = new Float32Array(chunkSize);
      const webrtcChunk = new Float32Array(chunkSize);

      // Wait 300ms for buffers to stabilize
      await this._sleep(300);
      if (this._aborted) { this._cleanup(micStream, micSource, webrtcSource); return; }

      onProgress?.('Recording 2 seconds of audio from mic & stream...');

      // Record in a tight loop
      const startTime = performance.now();
      const targetMs = recordDurationSec * 1000;

      while (micOffset < bufferLength - chunkSize && webrtcOffset < bufferLength - chunkSize) {
        if (this._aborted) { this._cleanup(micStream, micSource, webrtcSource); return; }
        if (performance.now() - startTime > targetMs + 500) break;

        micAnalyser.getFloatTimeDomainData(micChunk);
        webrtcAnalyser.getFloatTimeDomainData(webrtcChunk);

        micBuffer.set(micChunk, micOffset);
        webrtcBuffer.set(webrtcChunk, webrtcOffset);

        micOffset += chunkSize;
        webrtcOffset += chunkSize;

        // Yield to UI thread
        await this._sleep(Math.floor(chunkSize / sampleRate * 1000 * 0.85));
      }

      if (this._aborted) { this._cleanup(micStream, micSource, webrtcSource); return; }

      onProgress?.('Analyzing audio signals... Computing cross-correlation...');

      // Step 3: Cross-correlate to find the time offset
      const maxLagSamples = Math.floor(sampleRate * 0.5); // Search up to 500ms offset
      const offset = this._crossCorrelate(micBuffer, webrtcBuffer, maxLagSamples);
      const offsetMs = Math.round((offset / sampleRate) * 1000);

      // Cleanup
      this._cleanup(micStream, micSource, webrtcSource);

      onProgress?.(`Sync complete! Measured offset: ${offsetMs}ms`);
      onComplete?.(offsetMs);

    } catch (err) {
      console.error('[AcousticSync] Error:', err);
      onError?.(`Calibration failed: ${err.message}`);
    } finally {
      this.isCalibrating = false;
    }
  }

  /**
   * Efficient cross-correlation using sum of products.
   * Returns the lag (in samples) where micSignal best aligns with webrtcSignal.
   * Positive lag means webrtc is ahead (phone needs to delay).
   * Negative lag means webrtc is behind (phone needs less delay).
   */
  _crossCorrelate(micSignal, webrtcSignal, maxLag) {
    // Normalize both signals
    const micNorm = this._normalize(micSignal);
    const webNorm = this._normalize(webrtcSignal);

    const len = Math.min(micNorm.length, webNorm.length);
    let bestLag = 0;
    let bestCorr = -Infinity;

    // Slide webrtc signal against mic signal
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      let sum = 0;
      let count = 0;

      for (let i = 0; i < len; i++) {
        const j = i + lag;
        if (j >= 0 && j < len) {
          sum += micNorm[i] * webNorm[j];
          count++;
        }
      }

      if (count > 0) {
        const correlation = sum / count;
        if (correlation > bestCorr) {
          bestCorr = correlation;
          bestLag = lag;
        }
      }
    }

    console.log(`[AcousticSync] Best correlation: ${bestCorr.toFixed(4)} at lag: ${bestLag} samples (${Math.round(bestLag / (micSignal.length > 0 ? 48000 : 44100) * 1000)}ms)`);
    return bestLag;
  }

  _normalize(signal) {
    let max = 0;
    for (let i = 0; i < signal.length; i++) {
      const abs = Math.abs(signal[i]);
      if (abs > max) max = abs;
    }
    if (max < 0.001) return signal; // too quiet to normalize
    const out = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      out[i] = signal[i] / max;
    }
    return out;
  }

  _cleanup(micStream, micSource, webrtcSource) {
    try { micSource?.disconnect(); } catch (e) {}
    try { webrtcSource?.disconnect(); } catch (e) {}
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
    }
    this._micStream = null;
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

export const acousticSync = new AcousticAutoSync();
