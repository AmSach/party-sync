import React, { useEffect, useRef, useState } from 'react';
import { Film, Maximize2, Minimize2, Sliders, ExternalLink, Clock, Play, Pause, RotateCcw } from 'lucide-react';

export default function LipSyncVideoMonitor({ 
  stream, 
  audioDelayMs = 200, 
  onDelayChange, 
  title = 'System Screen Capture' 
}) {
  const [isDelayed, setIsDelayed] = useState(true);
  const [fineTuneMs, setFineTuneMs] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);
  const [measuredFps, setMeasuredFps] = useState(30);

  const containerRef = useRef(null);
  const hiddenVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const pipVideoRef = useRef(null);
  const frameQueueRef = useRef([]); // { bitmap, timestamp }
  const animationFrameRef = useRef(null);
  const isDelayedRef = useRef(true);
  const totalDelayRef = useRef(audioDelayMs);

  useEffect(() => {
    isDelayedRef.current = isDelayed;
  }, [isDelayed]);

  useEffect(() => {
    totalDelayRef.current = Math.max(0, audioDelayMs + fineTuneMs);
  }, [audioDelayMs, fineTuneMs]);

  useEffect(() => {
    const video = hiddenVideoRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    video.play().catch(e => console.warn('[LipSyncMonitor] Video play notice:', e));

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    let lastTime = performance.now();
    let lastFpsUpdate = performance.now();
    let frameCount = 0;
    let isCapturingFrame = false;

    const processFrame = async () => {
      animationFrameRef.current = requestAnimationFrame(processFrame);

      if (video.readyState < 2 || video.videoWidth === 0) return;

      const now = performance.now();
      frameCount++;
      if (now - lastFpsUpdate >= 1000) {
        setMeasuredFps(frameCount);
        frameCount = 0;
        lastFpsUpdate = now;
      }

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const delayNeeded = isDelayedRef.current ? totalDelayRef.current : 0;

      if (delayNeeded <= 15) {
        // Direct zero-delay passthrough
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        while (frameQueueRef.current.length > 0) {
          const f = frameQueueRef.current.shift();
          if (f.bitmap && typeof f.bitmap.close === 'function') f.bitmap.close();
        }
        return;
      }

      // Capture frame into ImageBitmap with queue limit and in-flight guard
      if (!isCapturingFrame && frameQueueRef.current.length < 35) {
        isCapturingFrame = true;
        try {
          const maxDim = 1920;
          const opts = video.videoWidth > maxDim 
            ? { resizeWidth: maxDim, resizeQuality: 'medium' } 
            : undefined;
          const bitmap = await (opts ? createImageBitmap(video, opts) : createImageBitmap(video));
          frameQueueRef.current.push({ bitmap, time: performance.now() });
        } catch (e) {
          // Fallback if bitmap fails
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } finally {
          isCapturingFrame = false;
        }
      }

      const targetTime = now - delayNeeded;
      const queue = frameQueueRef.current;

      // Find best frame closest to targetTime
      let bestIndex = -1;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].time <= targetTime) {
          bestIndex = i;
        } else {
          break;
        }
      }

      if (bestIndex >= 0) {
        const targetFrame = queue[bestIndex];
        ctx.drawImage(targetFrame.bitmap, 0, 0, canvas.width, canvas.height);

        // Discard frames older than the displayed frame to save memory
        for (let i = 0; i <= bestIndex; i++) {
          const old = queue.shift();
          if (old && old.bitmap && typeof old.bitmap.close === 'function') {
            old.bitmap.close();
          }
        }
      } else if (queue.length > 0) {
        // Buffer warming up
        ctx.drawImage(queue[0].bitmap, 0, 0, canvas.width, canvas.height);
      }
    };

    animationFrameRef.current = requestAnimationFrame(processFrame);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      while (frameQueueRef.current.length > 0) {
        const f = frameQueueRef.current.shift();
        if (f && f.bitmap && typeof f.bitmap.close === 'function') f.bitmap.close();
      }
    };
  }, [stream]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handlePipLeave = () => setIsPipActive(false);
    const video = pipVideoRef.current;
    if (video) {
      video.addEventListener('leavepictureinpicture', handlePipLeave);
    }
    return () => {
      if (video) video.removeEventListener('leavepictureinpicture', handlePipLeave);
    };
  }, []);

  const togglePip = async () => {
    const canvas = canvasRef.current;
    const pipVideo = pipVideoRef.current;
    if (!canvas || !pipVideo) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPipActive(false);
      } else {
        if (!pipVideo.requestPictureInPicture) {
          console.warn('[LipSyncMonitor] Picture-in-picture API not supported in this browser');
          return;
        }
        if (!pipVideo.srcObject) {
          const stream = typeof canvas.captureStream === 'function' 
            ? canvas.captureStream(30) 
            : typeof canvas.mozCaptureStream === 'function' 
              ? canvas.mozCaptureStream(30) 
              : null;
          if (!stream) {
            console.warn('[LipSyncMonitor] Canvas captureStream not available');
            return;
          }
          pipVideo.srcObject = stream;
          await pipVideo.play();
        }
        await pipVideo.requestPictureInPicture();
        setIsPipActive(true);
      }
    } catch (err) {
      console.warn('[LipSyncMonitor] Picture-in-picture error:', err);
    }
  };

  const totalEffectiveDelay = Math.max(0, audioDelayMs + fineTuneMs);

  return (
    <div 
      ref={containerRef}
      className="analog-inset" 
      style={{ 
        padding: '16px', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '12px',
        background: '#0a0f15',
        border: '1px solid var(--accent-core)',
        borderRadius: '12px',
        position: 'relative'
      }}
    >
      {/* Hidden Live Video Element for Frame Capture */}
      <video 
        ref={hiddenVideoRef} 
        muted 
        playsInline 
        autoPlay 
        style={{ display: 'none' }} 
      />

      {/* Hidden PiP Video Element */}
      <video 
        ref={pipVideoRef} 
        muted 
        playsInline 
        style={{ display: 'none' }} 
      />

      {/* Header Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Film size={18} color="var(--accent-bright)" />
          <div>
            <strong style={{ fontSize: '13px', color: 'var(--text-cream)' }}>
              🎬 Lip-Sync Visual Delay Monitor
            </strong>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              Delays video frames to match multi-phone audio transmission (+{totalEffectiveDelay}ms)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setIsDelayed(!isDelayed)}
            className="btn-analog"
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              background: isDelayed ? 'rgba(16, 185, 129, 0.2)' : undefined,
              borderColor: isDelayed ? '#10b981' : undefined,
              color: isDelayed ? '#10b981' : undefined
            }}
          >
            {isDelayed ? '● Lip-Sync Delayed' : '○ Passthrough (0ms)'}
          </button>

          <button
            onClick={togglePip}
            className="btn-analog"
            title="Pop out into floating Picture-in-Picture window"
            style={{ padding: '4px 8px', fontSize: '11px' }}
          >
            <ExternalLink size={13} />
            <span>PiP</span>
          </button>

          <button
            onClick={toggleFullscreen}
            className="btn-analog"
            title="Fullscreen Video"
            style={{ padding: '4px 8px', fontSize: '11px' }}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* Canvas Video Viewport */}
      <div style={{ 
        position: 'relative', 
        width: '100%', 
        maxHeight: isFullscreen ? '90vh' : '320px', 
        aspectRatio: '16/9', 
        background: '#000000', 
        borderRadius: '8px', 
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--border-deck)'
      }}>
        <canvas 
          ref={canvasRef} 
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} 
        />

        {/* HUD Stamp */}
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          background: 'rgba(0, 0, 0, 0.75)',
          padding: '3px 8px',
          borderRadius: '6px',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          fontSize: '10px',
          fontFamily: 'monospace',
          color: isDelayed ? '#10b981' : '#f59e0b',
          display: 'flex',
          gap: '8px'
        }}>
          <span>SYNC: {isDelayed ? `+${totalEffectiveDelay}ms` : '0ms'}</span>
          <span>FPS: {measuredFps}</span>
        </div>
      </div>

      {/* Lip-Sync Calibration Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: '#0e151e', padding: '12px', borderRadius: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            LIP-SYNC VIDEO OFFSET CALIBRATOR:
          </span>
          <span className="font-mono paper-badge" style={{ fontSize: '11px', color: fineTuneMs === 0 ? '#10b981' : 'var(--accent-bright)' }}>
            {fineTuneMs === 0 ? 'Locked to Fleet Target' : `${fineTuneMs > 0 ? '+' : ''}${fineTuneMs}ms Manual Offset`}
          </span>
        </div>

        <input 
          type="range" 
          min="-250" 
          max="350" 
          step="5" 
          value={fineTuneMs} 
          onChange={(e) => setFineTuneMs(parseInt(e.target.value))} 
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
          {[
            { label: '-100ms', val: -100 },
            { label: '-50ms', val: -50 },
            { label: '0ms Reset', val: 0 },
            { label: '+50ms', val: 50 },
            { label: '+100ms', val: 100 },
          ].map(b => (
            <button
              key={b.label}
              onClick={() => setFineTuneMs(b.val)}
              className="btn-analog"
              style={{
                padding: '4px 2px',
                fontSize: '10px',
                fontFamily: 'monospace',
                background: fineTuneMs === b.val ? 'var(--accent-core)' : undefined,
                color: fineTuneMs === b.val ? '#0f1419' : undefined
              }}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          <span>Advance Video (if sound is late)</span>
          <span>Delay Video (if sound is early)</span>
        </div>
      </div>
    </div>
  );
}
