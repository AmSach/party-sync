// High-Precision Clock Synchronization Protocol — Continuous Phase-Lock Loop (PLL)
// Uses NTP/Christian's Algorithm for initial lock, then transitions to a PLL servo
// for drift-free, click-free, continuous synchronization across all devices.
//
// ARCHITECTURE:
//   Phase 1 — Initial Calibration: 8-ping burst for fast lock at connect time.
//   Phase 2 — PLL Servo: Lightweight 1-ping every 2s through a sliding EMA window.
//   Phase 3 — AudioContext Drift Correction: Measures & corrects hardware clock skew.
//
// This eliminates the two root causes of drift:
//   (a) performance.now() on mobile phones drifts vs wall clock under thermal throttling.
//   (b) AudioContext.currentTime (DAC crystal) diverges from performance.now() by 1–10ms/min.

class ClockSynchronizer {
  constructor() {
    this.clockOffset = 0;       // NTP offset: masterTime = performance.now() + clockOffset
    this.rtt = 0;               // Last measured round-trip time in ms
    this.isSynced = false;
    this.samples = [];          // Burst calibration sample buffer
    this.onSyncChange = null;

    // PLL servo state
    this._pllConn = null;
    this._pllTimer = null;
    this._pllSeq = 0;
    this._pllPendingSamples = new Map();  // seq -> t0
    this._emaOffset = null;               // Exponential Moving Average of clock offset
    this._emaRtt = null;
    this._pllOnCorrection = null;

    // AudioContext drift anchoring
    this._anchorPerfNow = null;    // performance.now() at stream start
    this._anchorCtxTime = null;    // AudioContext.currentTime at stream start
    this._audioCtx = null;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  // Get current synchronized Master Clock timestamp (ms, sub-ms precision)
  now() {
    return performance.now() + this.clockOffset;
  }

  // ─── Phase 1: Initial Calibration Burst ──────────────────────────────────

  startCalibration(conn) {
    if (!conn || !conn.open) return Promise.resolve(null);
    this.samples = [];
    this.isSynced = false;
    this._isCalibrating = true;

    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    if (this._safetyTimeout) {
      clearTimeout(this._safetyTimeout);
      this._safetyTimeout = null;
    }

    return new Promise((resolve) => {
      this._resolveCalibration = resolve;
      let count = 0;

      // Safety timeout: finalize after 1000ms if pongs are slow
      this._safetyTimeout = setTimeout(() => {
        if (this._pingTimer) {
          clearInterval(this._pingTimer);
          this._pingTimer = null;
        }
        this.finalizeCalibration();
      }, 1000);

      const sendPing = () => {
        if (!conn.open) {
          if (this._pingTimer) {
            clearInterval(this._pingTimer);
            this._pingTimer = null;
          }
          this.finalizeCalibration();
          return;
        }
        count++;
        const t0 = performance.now();
        conn.send({ type: 'NTP_PING', t0, seq: count });
        if (count >= 8) {
          if (this._pingTimer) {
            clearInterval(this._pingTimer);
            this._pingTimer = null;
          }
        }
      };

      // Send first ping immediately
      sendPing();

      // Burst remaining 7 pings at 30ms spacing
      this._pingTimer = setInterval(() => {
        if (!conn.open || count >= 8) {
          if (this._pingTimer) {
            clearInterval(this._pingTimer);
            this._pingTimer = null;
          }
          return;
        }
        sendPing();
      }, 30);
    });
  }

  // ─── Phase 2: PLL Servo ──────────────────────────────────────────────────

  /**
   * Start the continuous Phase-Lock Loop servo.
   * Fires one ping every 2s, feeds result through an EMA filter, and calls
   * onCorrection(deltaMsAbsolute) so the receiver can smoothly nudge its DelayNode.
   *
   * @param {DataConnection} conn   - Open PeerJS data connection to Host.
   * @param {AudioContext|null} ctx - The satellite's AudioContext (for drift anchoring).
   * @param {Function} onCorrection - Called with (newTargetDelayMs) whenever offset updates.
   */
  startPLL(conn, ctx, onCorrection) {
    this.stopPLL();

    this._pllConn = conn;
    this._pllSeq = 1000; // Use high seq numbers so they don't collide with burst pings (1–8)
    this._pllPendingSamples.clear();
    this._pllOnCorrection = onCorrection;

    // Anchor AudioContext clock vs performance.now() at this exact moment
    if (ctx && ctx.state === 'running') {
      this._audioCtx = ctx;
      this._anchorPerfNow = performance.now();
      this._anchorCtxTime = ctx.currentTime * 1000; // convert s → ms
      console.log('[PLL] AudioContext drift anchor established. BaseLatency:', (ctx.baseLatency * 1000).toFixed(1), 'ms');
    }

    // Fire first ping immediately
    this._pllPing();

    // Then ping every 2000ms
    this._pllTimer = setInterval(() => {
      if (!conn.open) {
        this.stopPLL();
        return;
      }
      this._pllPing();
    }, 2000);

    console.log('[PLL] Continuous Phase-Lock Loop started (1 ping / 2s)');
  }

  stopPLL() {
    if (this._pllTimer) {
      clearInterval(this._pllTimer);
      this._pllTimer = null;
    }
    this._pllConn = null;
    this._pllPendingSamples.clear();
    console.log('[PLL] Stopped');
  }

  _pllPing() {
    const conn = this._pllConn;
    if (!conn || !conn.open) return;

    this._pllSeq++;
    const t0 = performance.now();
    this._pllPendingSamples.set(this._pllSeq, t0);

    // Prune stale pending samples (older than 10s)
    for (const [seq, t] of this._pllPendingSamples) {
      if (t < performance.now() - 10000) this._pllPendingSamples.delete(seq);
    }

    conn.send({ type: 'NTP_PING', t0, seq: this._pllSeq });
  }

  // Called by ReceiverView when NTP_PONG arrives (handles both burst & PLL pongs)
  handlePong(data) {
    const t3 = performance.now();
    const { t0, t1, t2, seq } = data;

    const roundTrip = (t3 - t0) - (t2 - t1);
    const offset = ((t1 - t0) + (t2 - t3)) / 2;

    if (seq >= 1000) {
      // ── PLL pong ──
      this._pllPendingSamples.delete(seq);
      this._applyPLLSample(roundTrip, offset);
    } else {
      // ── Burst calibration pong ──
      this.samples.push({ rtt: roundTrip, offset });
      if (this.samples.length >= 7) {
        this.finalizeCalibration();
      }
    }
  }

  _applyPLLSample(rtt, offset) {
    // Discard high-jitter outliers (> 3× median RTT is likely a Wi-Fi retry)
    if (this._emaRtt !== null && rtt > this._emaRtt * 4) {
      console.log(`[PLL] Discarded outlier: RTT=${rtt.toFixed(1)}ms vs EMA_RTT=${this._emaRtt.toFixed(1)}ms`);
      return;
    }

    // EMA filter: α=0.15 for smooth convergence (slower = more stable)
    const alpha = 0.15;
    if (this._emaOffset === null) {
      this._emaOffset = offset;
      this._emaRtt = rtt;
    } else {
      this._emaOffset = alpha * offset + (1 - alpha) * this._emaOffset;
      this._emaRtt = alpha * rtt + (1 - alpha) * this._emaRtt;
    }

    // Apply the filtered offset to the master clock
    const previousOffset = this.clockOffset;
    this.clockOffset = this._emaOffset;
    this.rtt = Math.round(this._emaRtt);
    this.isSynced = true;

    // Compute AudioContext drift correction
    // DAC runs at crystal frequency independent of performance.now(). Over time these diverge.
    // We measure: expectedCtxMs = elapsed performance.now() since anchor
    // actualCtxMs  = AudioContext.currentTime progression since anchor
    // drift = expectedCtxMs - actualCtxMs → positive means DAC is running slow
    let audioCtxDriftMs = 0;
    if (this._audioCtx && this._anchorPerfNow !== null && this._audioCtx.state === 'running') {
      const elapsedPerfMs = performance.now() - this._anchorPerfNow;
      const elapsedCtxMs = (this._audioCtx.currentTime * 1000) - this._anchorCtxTime;
      audioCtxDriftMs = elapsedPerfMs - elapsedCtxMs;

      // Sanity clamp — ignore implausibly large drift (context was suspended/resumed)
      if (Math.abs(audioCtxDriftMs) > 500) {
        // Re-anchor after a suspend/resume cycle
        this._anchorPerfNow = performance.now();
        this._anchorCtxTime = this._audioCtx.currentTime * 1000;
        audioCtxDriftMs = 0;
      }
    }

    const offsetDelta = this.clockOffset - previousOffset;
    const totalCorrection = offsetDelta + audioCtxDriftMs;

    console.log(
      `[PLL] RTT=${this._emaRtt.toFixed(1)}ms | Offset EMA=${this._emaOffset.toFixed(2)}ms | ` +
      `CtxDrift=${audioCtxDriftMs.toFixed(2)}ms | TotalCorrection=${totalCorrection.toFixed(2)}ms`
    );

    // Notify callback so receiver can servo-adjust its DelayNode
    if (this._pllOnCorrection && Math.abs(totalCorrection) > 0.5) {
      this._pllOnCorrection(totalCorrection, this.rtt);
    }

    if (this.onSyncChange) {
      this.onSyncChange({
        isSynced: true,
        rtt: this.rtt,
        offset: this.clockOffset,
        drift: audioCtxDriftMs
      });
    }
  }

  // ─── Phase 1 finalization ────────────────────────────────────────────────

  finalizeCalibration() {
    if (this._safetyTimeout) {
      clearTimeout(this._safetyTimeout);
      this._safetyTimeout = null;
    }
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    if (!this._isCalibrating) return;
    this._isCalibrating = false;

    if (this.samples.length === 0) {
      if (this._resolveCalibration) {
        this._resolveCalibration({ rtt: 10, offset: this.clockOffset });
        this._resolveCalibration = null;
      }
      return;
    }

    // Sort by RTT — cleanest packets have least queuing delay
    this.samples.sort((a, b) => a.rtt - b.rtt);
    const topSamples = this.samples.slice(0, Math.min(3, this.samples.length));
    const medianOffset = topSamples.reduce((sum, s) => sum + s.offset, 0) / topSamples.length;
    const bestRtt = this.samples[0].rtt;

    this.clockOffset = medianOffset;
    this._emaOffset = medianOffset;   // Seed PLL EMA with the burst result
    this._emaRtt = bestRtt;
    this.rtt = Math.round(bestRtt);
    this.isSynced = true;

    console.log(`[ClockSync] Initial lock! RTT: ${this.rtt}ms, Offset: ${this.clockOffset.toFixed(2)}ms`);

    if (this.onSyncChange) {
      this.onSyncChange({ isSynced: true, rtt: this.rtt, offset: this.clockOffset });
    }

    if (this._resolveCalibration) {
      this._resolveCalibration({ rtt: this.rtt, offset: this.clockOffset });
      this._resolveCalibration = null;
    }
  }

  // ─── Acoustic & Visual Sync Clapper ─────────────────────────────────────

  static handleHostPing(conn, data) {
    if (!conn || !conn.open) return;
    const t1 = performance.now();
    conn.send({
      type: 'NTP_PONG',
      seq: data.seq,
      t0: data.t0,
      t1,
      t2: performance.now()
    });
  }

  playScheduledPulse(ctx, targetMasterTime, onVisualFlash, destinationNode = 'default') {
    const localNow = this.now();
    const delaySec = Math.max(0, (targetMasterTime - localNow) / 1000);

    if (!ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        try { ctx = new AudioCtx({ latencyHint: 'interactive' }); } catch (e) {}
      }
    }

    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const triggerAudioTime = ctx.currentTime + delaySec;

      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(1400, triggerAudioTime);
        osc.frequency.exponentialRampToValueAtTime(300, triggerAudioTime + 0.02);
        gain.gain.setValueAtTime(0.8, triggerAudioTime);
        gain.gain.exponentialRampToValueAtTime(0.001, triggerAudioTime + 0.02);

        osc.connect(gain);
        const target = (destinationNode === 'default' || !destinationNode) ? ctx.destination : destinationNode;
        gain.connect(target);

        osc.start(triggerAudioTime);
        osc.stop(triggerAudioTime + 0.025);

        setTimeout(() => {
          try { osc.disconnect(); gain.disconnect(); } catch (e) {}
        }, (delaySec + 0.08) * 1000);
      } catch (e) {
        console.warn('[ClockSync] Audio pulse error:', e);
      }
    }

    if (onVisualFlash) {
      setTimeout(() => {
        onVisualFlash();
      }, Math.max(0, targetMasterTime - localNow));
    }
  }
}

export { ClockSynchronizer };
export const clockSync = new ClockSynchronizer();
