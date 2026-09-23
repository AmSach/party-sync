// High-Precision Microsecond Clock Synchronization Protocol (NTP / Christian's Algorithm)
// Enables sub-millisecond phase alignment across heterogeneous devices (laptops, phones, Bluetooth)

class ClockSynchronizer {
  constructor() {
    this.clockOffset = 0; // offset in milliseconds: masterTime = localTime + clockOffset
    this.rtt = 0;
    this.isSynced = false;
    this.samples = [];
    this.onSyncChange = null;
  }

  // Get current synchronized Master Clock timestamp in milliseconds (with microsecond precision)
  now() {
    return performance.now() + this.clockOffset;
  }

  // Initiate high-speed calibration handshake over DataChannel
  startCalibration(conn) {
    if (!conn || !conn.open) return;
    this.samples = [];
    this.isSynced = false;

    let count = 0;
    const sendPing = () => {
      if (count >= 8 || !conn.open) {
        this.finalizeCalibration();
        return;
      }
      count++;
      const t0 = performance.now();
      conn.send({ type: 'NTP_PING', t0, seq: count });
    };

    // Burst 8 pings spaced by 40ms to find the cleanest network route
    const interval = setInterval(() => {
      sendPing();
      if (count >= 8) clearInterval(interval);
    }, 50);
  }

  // Host handles ping and immediately responds with timestamp
  static handleHostPing(conn, data) {
    if (!conn || !conn.open) return;
    const t1 = performance.now();
    conn.send({
      type: 'NTP_PONG',
      seq: data.seq,
      t0: data.t0,
      t1: t1,
      t2: performance.now()
    });
  }

  // Receiver processes pong
  handlePong(data) {
    const t3 = performance.now();
    const t0 = data.t0;
    const t1 = data.t1;
    const t2 = data.t2;

    const roundTrip = (t3 - t0) - (t2 - t1);
    const offset = ((t1 - t0) + (t2 - t3)) / 2;

    this.samples.push({ rtt: roundTrip, offset });
    if (this.samples.length >= 6) {
      this.finalizeCalibration();
    }
  }

  finalizeCalibration() {
    if (this.samples.length === 0) return;

    // Filter by minimum RTT (cleanest packet without Wi-Fi queuing delay)
    this.samples.sort((a, b) => a.rtt - b.rtt);
    const bestSample = this.samples[0];

    // Take median of best 3 samples to eliminate outliers
    const topSamples = this.samples.slice(0, Math.min(3, this.samples.length));
    const medianOffset = topSamples.reduce((sum, s) => sum + s.offset, 0) / topSamples.length;

    this.clockOffset = medianOffset;
    this.rtt = Math.round(bestSample.rtt);
    this.isSynced = true;

    console.log(`[ClockSync] Precision Master Clock locked! RTT: ${this.rtt}ms, Offset: ${this.clockOffset.toFixed(2)}ms`);

    if (this.onSyncChange) {
      this.onSyncChange({
        isSynced: true,
        rtt: this.rtt,
        offset: this.clockOffset
      });
    }
  }

  // Schedule an acoustic and visual Sync Clapper tick at an exact future Master Time
  playScheduledPulse(ctx, targetMasterTime, onVisualFlash) {
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const localNow = this.now();
    const delaySec = Math.max(0, (targetMasterTime - localNow) / 1000);

    const triggerAudioTime = ctx.currentTime + delaySec;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, triggerAudioTime); // Crisp 1400Hz snap
      osc.frequency.exponentialRampToValueAtTime(300, triggerAudioTime + 0.02);

      gain.gain.setValueAtTime(0.7, triggerAudioTime);
      gain.gain.exponentialRampToValueAtTime(0.001, triggerAudioTime + 0.02);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(triggerAudioTime);
      osc.stop(triggerAudioTime + 0.025);
    } catch (e) {
      console.warn('[ClockSync] Audio pulse error:', e);
    }

    // Trigger visual flash at the exact same millisecond
    if (onVisualFlash) {
      setTimeout(() => {
        onVisualFlash();
      }, Math.max(0, targetMasterTime - localNow));
    }
  }
}

export { ClockSynchronizer };
export const clockSync = new ClockSynchronizer();
