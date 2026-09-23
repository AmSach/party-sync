// Acoustic Auto-Calibration Engine
// Precision differential acoustic pulse detection for sub-millisecond sync lock.
//
// Protocol:
// 1. Host schedules a calibration sequence at targetMasterTime.
// 2. Host emits Tone A (2400 Hz, 40ms) through laptop speaker pipeline at targetMasterTime.
// 3. Receiver emits Tone B (1200 Hz, 40ms) through phone/BT speaker pipeline at targetMasterTime + 500ms.
// 4. Phone mic records audio from targetMasterTime - 100ms to targetMasterTime + 1000ms.
// 5. Differential matched-filtering calculates t_B - t_A.
// 6. Error = (t_B - t_A) - 500ms.
// 7. Any microphone input latency cancels out completely (t_B + mic - (t_A + mic) = t_B - t_A).
// 8. newDelay = currentDelay - Error.

export class AcousticCalibrator {
  constructor() {
    this.isCalibrating = false;
    this._micStream = null;
    this._scriptNode = null;
    this._micSource = null;
  }

  /**
   * Play the host calibration beep (2400Hz, 40ms).
   * @param {AudioContext} ctx 
   * @param {AudioNode} destinationNode - hostDelayNode or ctx.destination
   * @param {number} triggerAudioTime 
   */
  static playHostBeep(ctx, destinationNode, triggerAudioTime) {
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(2400, triggerAudioTime);

      // Smooth Hann-like window to prevent click harmonics
      gain.gain.setValueAtTime(0, triggerAudioTime);
      gain.gain.linearRampToValueAtTime(0.85, triggerAudioTime + 0.006);
      gain.gain.setValueAtTime(0.85, triggerAudioTime + 0.034);
      gain.gain.linearRampToValueAtTime(0, triggerAudioTime + 0.040);

      osc.connect(gain);
      gain.connect(destinationNode || ctx.destination);

      osc.start(triggerAudioTime);
      osc.stop(triggerAudioTime + 0.045);
    } catch (e) {
      console.error('[AcousticCalibrator] Host beep error:', e);
    }
  }

  /**
   * Play the receiver calibration beep (1200Hz, 40ms).
   * @param {AudioContext} ctx 
   * @param {AudioNode} destinationNode - receiver delay/gain node or ctx.destination
   * @param {number} triggerAudioTime 
   */
  static playReceiverBeep(ctx, destinationNode, triggerAudioTime) {
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, triggerAudioTime);

      // Smooth Hann-like window
      gain.gain.setValueAtTime(0, triggerAudioTime);
      gain.gain.linearRampToValueAtTime(0.85, triggerAudioTime + 0.006);
      gain.gain.setValueAtTime(0.85, triggerAudioTime + 0.034);
      gain.gain.linearRampToValueAtTime(0, triggerAudioTime + 0.040);

      osc.connect(gain);
      gain.connect(destinationNode || ctx.destination);

      osc.start(triggerAudioTime);
      osc.stop(triggerAudioTime + 0.045);
    } catch (e) {
      console.error('[AcousticCalibrator] Receiver beep error:', e);
    }
  }

  /**
   * Run the receiver-side calibration capture.
   * Records mic for 1.2s, detects 2400Hz and 1200Hz arrival peaks, and computes sync error.
   */
  async runReceiverCalibration({
    audioCtx,
    receiverPlaybackNode,
    targetMasterTime,
    clockSyncInstance,
    onProgress,
    onSuccess,
    onError
  }) {
    if (this.isCalibrating) return;
    this.isCalibrating = true;

    try {
      onProgress?.('Accessing phone microphone...');
      
      // Request raw, uncompressed microphone audio without noise suppression
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000
        }
      });
      this._micStream = micStream;

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const sampleRate = audioCtx.sampleRate || 48000;
      const durationSec = 1.25;
      const totalSamples = Math.floor(sampleRate * durationSec);
      const recordedBuffer = new Float32Array(totalSamples);
      let recordedOffset = 0;

      // Set up recording using ScriptProcessor
      const micSource = audioCtx.createMediaStreamSource(micStream);
      this._micSource = micSource;

      // Buffer size 2048 gives low latency and reliable capture
      const scriptNode = audioCtx.createScriptProcessor(2048, 1, 1);
      this._scriptNode = scriptNode;

      scriptNode.onaudioprocess = (e) => {
        if (!this.isCalibrating) return;
        const inputData = e.inputBuffer.getChannelData(0);
        if (recordedOffset + inputData.length <= totalSamples) {
          recordedBuffer.set(inputData, recordedOffset);
          recordedOffset += inputData.length;
        }
      };

      micSource.connect(scriptNode);
      // Connect to destination with 0 gain to keep script processor active without mic feedback
      const zeroGain = audioCtx.createGain();
      zeroGain.gain.setValueAtTime(0, audioCtx.currentTime);
      scriptNode.connect(zeroGain);
      zeroGain.connect(audioCtx.destination);

      // Calculate exact trigger times
      const currentMasterTime = clockSyncInstance.now();
      const delayToStartMs = targetMasterTime - currentMasterTime;
      const hostBeepDelaySec = Math.max(0, delayToStartMs / 1000);
      const phoneBeepDelaySec = hostBeepDelaySec + 0.500; // 500ms after Host beep

      const hostBeepAudioTime = audioCtx.currentTime + hostBeepDelaySec;
      const phoneBeepAudioTime = audioCtx.currentTime + phoneBeepDelaySec;

      onProgress?.('Listening... Hold phone next to host speaker');

      // Schedule Receiver's 1200Hz beep at targetMasterTime + 500ms
      AcousticCalibrator.playReceiverBeep(audioCtx, receiverPlaybackNode, phoneBeepAudioTime);

      // Wait until recording completes (delayToStartMs + 1000ms)
      const waitMs = Math.max(1200, delayToStartMs + 850);
      await new Promise(r => setTimeout(r, waitMs));

      onProgress?.('Analyzing acoustic waveform...');

      // Cleanup mic nodes immediately
      this._cleanup();

      // Analyze the recording to find the two beep arrivals
      const result = this._analyzeRecording(recordedBuffer, sampleRate);

      if (!result.success) {
        onError?.(result.error);
        return;
      }

      onSuccess?.(result);

    } catch (err) {
      console.error('[AcousticCalibrator] Error during calibration:', err);
      this._cleanup();
      onError?.(err.name === 'NotAllowedError' 
        ? 'Microphone permission denied. Please allow microphone access to auto-sync.' 
        : `Calibration error: ${err.message}`);
    } finally {
      this.isCalibrating = false;
    }
  }

  _cleanup() {
    try {
      this._scriptNode?.disconnect();
      this._micSource?.disconnect();
    } catch (e) {}
    if (this._micStream) {
      this._micStream.getTracks().forEach(t => t.stop());
      this._micStream = null;
    }
    this._scriptNode = null;
    this._micSource = null;
  }

  /**
   * Evaluates Goertzel energy for target frequency in a sliding window.
   */
  _analyzeRecording(buffer, sampleRate) {
    const windowSize = Math.floor(sampleRate * 0.012); // 12ms window
    const hopSize = Math.floor(sampleRate * 0.002);    // 2ms resolution step

    const numFrames = Math.floor((buffer.length - windowSize) / hopSize);
    const hostEnergy = new Float32Array(numFrames);     // 2400Hz
    const receiverEnergy = new Float32Array(numFrames); // 1200Hz

    const freqHost = 2400;
    const freqReceiver = 1200;

    for (let f = 0; f < numFrames; f++) {
      const startIdx = f * hopSize;
      hostEnergy[f] = this._goertzelPower(buffer, startIdx, windowSize, freqHost, sampleRate);
      receiverEnergy[f] = this._goertzelPower(buffer, startIdx, windowSize, freqReceiver, sampleRate);
    }

    // Find peak for Host beep (expected in first 500ms)
    const hostSearchEndFrame = Math.floor(numFrames * 0.55);
    let maxHostEnergy = 0;
    let peakHostFrame = -1;

    for (let f = 0; f < hostSearchEndFrame; f++) {
      if (hostEnergy[f] > maxHostEnergy) {
        maxHostEnergy = hostEnergy[f];
        peakHostFrame = f;
      }
    }

    // Find peak for Receiver beep (expected 350ms to 750ms after Host beep)
    let maxReceiverEnergy = 0;
    let peakReceiverFrame = -1;

    const receiverSearchStartFrame = Math.max(0, peakHostFrame + Math.floor((sampleRate * 0.25) / hopSize));
    for (let f = receiverSearchStartFrame; f < numFrames; f++) {
      if (receiverEnergy[f] > maxReceiverEnergy) {
        maxReceiverEnergy = receiverEnergy[f];
        peakReceiverFrame = f;
      }
    }

    // Baseline noise floor calculation
    const avgHost = hostEnergy.reduce((a, b) => a + b, 0) / numFrames;
    const avgReceiver = receiverEnergy.reduce((a, b) => a + b, 0) / numFrames;

    const hostSnr = avgHost > 0 ? maxHostEnergy / avgHost : 0;
    const receiverSnr = avgReceiver > 0 ? maxReceiverEnergy / avgReceiver : 0;

    console.log(`[AcousticCalibrator] Host SNR: ${hostSnr.toFixed(1)}, Receiver SNR: ${receiverSnr.toFixed(1)}`);

    if (peakHostFrame === -1 || hostSnr < 2.5) {
      return {
        success: false,
        error: 'Host speaker pulse not heard clearly. Hold phone speaker closer to laptop and turn up laptop volume.'
      };
    }

    if (peakReceiverFrame === -1 || receiverSnr < 2.5) {
      return {
        success: false,
        error: 'Phone speaker pulse not heard clearly. Turn up phone volume and hold close to mic.'
      };
    }

    const hostTimeMs = (peakHostFrame * hopSize / sampleRate) * 1000;
    const receiverTimeMs = (peakReceiverFrame * hopSize / sampleRate) * 1000;

    const measuredIntervalMs = receiverTimeMs - hostTimeMs;
    // Expected interval is exactly 500ms
    const errorMs = Math.round(measuredIntervalMs - 500);

    console.log(`[AcousticCalibrator] Host peak: ${hostTimeMs.toFixed(1)}ms, Receiver peak: ${receiverTimeMs.toFixed(1)}ms`);
    console.log(`[AcousticCalibrator] Measured Interval: ${measuredIntervalMs.toFixed(1)}ms, Sync Error: ${errorMs}ms`);

    return {
      success: true,
      errorMs,
      measuredIntervalMs: Math.round(measuredIntervalMs),
      hostSnr: Math.round(hostSnr),
      receiverSnr: Math.round(receiverSnr)
    };
  }

  /**
   * Optimized Goertzel algorithm to compute power at target frequency.
   */
  _goertzelPower(buffer, start, length, targetFreq, sampleRate) {
    const k = Math.round((length * targetFreq) / sampleRate);
    const w = (2 * Math.PI * k) / length;
    const coeff = 2 * Math.cos(w);

    let s0 = 0;
    let s1 = 0;
    let s2 = 0;

    for (let i = 0; i < length; i++) {
      s0 = buffer[start + i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
  }
}

export const acousticCalibrator = new AcousticCalibrator();
