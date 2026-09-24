import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import QRCode from 'qrcode';
import { 
  Tv, Music, Monitor, Mic, Radio, Users, Sliders, Copy, 
  Check, Volume2, VolumeX, ShieldCheck, Play, Pause, RefreshCw, QrCode,
  Zap, Clock, Wifi, Info, BellRing, Target
} from 'lucide-react';
import { clockSync, ClockSynchronizer } from '../utils/clockSync';
import Visualizer from './Visualizer';

export default function HostView({ onBack }) {
  const [roomId, setRoomId] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [sourceType, setSourceType] = useState('screen');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [connectedPeers, setConnectedPeers] = useState([]);
  const [copied, setCopied] = useState(false);
  
  // Host local playback pipeline delay & mute controls
  const [laptopMuted, setLaptopMuted] = useState(false);
  const [hostDelayMs, setHostDelayMs] = useState(120); // Stable locked default matching WebRTC transmission
  const [isFlashing, setIsFlashing] = useState(false);

  const [activeMediaTitle, setActiveMediaTitle] = useState('No audio source selected');
  const [showQrModal, setShowQrModal] = useState(false);
  const [showAudioMissingHelp, setShowAudioMissingHelp] = useState(false);

  const peerRef = useRef(null);
  const audioStreamRef = useRef(null);
  const videoElementRef = useRef(null);
  const audioContextRef = useRef(null);
  const hostDelayNodeRef = useRef(null);
  const hostGainNodeRef = useRef(null);
  const hostSourceNodeRef = useRef(null);
  const synthIntervalRef = useRef(null);
  const analyserRef = useRef(null);
  const activeConnectionsRef = useRef(new Map());
  const activeMediaTitleRef = useRef('No audio source selected');

  useEffect(() => {
    const randomCode = 'SESSION-' + Math.floor(1000 + Math.random() * 9000);
    setRoomId(randomCode);

    const joinUrl = `${window.location.origin}?room=${randomCode}`;
    QRCode.toDataURL(joinUrl, {
      width: 240,
      margin: 2,
      color: { dark: '#f4efe6', light: '#141210' }
    }).then(url => setQrDataUrl(url));

    // Initialize Host Peer immediately on signaling network
    initHostPeer(randomCode);

    return () => {
      stopBroadcasting(true);
    };
  }, []);

  const triggerVisualFlash = () => {
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 80);
  };

  const initHostPeer = (hostRoomId) => {
    if (peerRef.current) {
      peerRef.current.destroy();
    }

    const peer = new Peer(hostRoomId, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    peer.on('open', (id) => {
      console.log('[Host] Master broadcast console listening on:', id);
    });

    peer.on('connection', (conn) => {
      console.log('[Host] Incoming satellite connection:', conn.peer);

      conn.on('open', () => {
        console.log('[Host] Satellite data channel active:', conn.peer);
        activeConnectionsRef.current.set(conn.peer, conn);

        conn.send({ 
          type: 'WELCOME', 
          title: activeMediaTitleRef.current,
          isAudioActive: !!audioStreamRef.current
        });

        setConnectedPeers(prev => [
          ...prev.filter(p => p.id !== conn.peer),
          { id: conn.peer, name: conn.metadata?.name || `Phone (${conn.peer.slice(-4)})` }
        ]);

        // If audio stream is already playing, immediately pipe to new satellite
        if (audioStreamRef.current && peerRef.current) {
          console.log(`[Host] Piping active stream to new satellite: ${conn.peer}`);
          try {
            peerRef.current.call(conn.peer, audioStreamRef.current);
          } catch (e) {
            console.error('[Host] Call error:', e);
          }
        }
      });

      conn.on('data', (data) => {
        if (data.type === 'NTP_PING') {
          // Immediately respond with nanosecond server timestamp for Christian's clock sync
          ClockSynchronizer.handleHostPing(conn, data);
        } else if (data.type === 'CALIBRATE_REQUEST') {
          handleCalibrateRequest(conn);
        } else if (data.type === 'EMIT_PULSE_REQUEST') {
          emitSyncPulse();
        }
      });

      conn.on('close', () => {
        console.log('[Host] Satellite disconnected:', conn.peer);
        activeConnectionsRef.current.delete(conn.peer);
        setConnectedPeers(prev => prev.filter(p => p.id !== conn.peer));
      });

      conn.on('error', (err) => {
        console.warn('[Host] Peer connection error:', err);
        activeConnectionsRef.current.delete(conn.peer);
        setConnectedPeers(prev => prev.filter(p => p.id !== conn.peer));
      });
    });

    peer.on('error', (err) => {
      console.error('[Host] Signaling/Peer error:', err);
    });

    peerRef.current = peer;
  };

  // EMIT ACOUSTIC & VISUAL SYNC PULSE (SYNC CLAPPER)
  const emitSyncPulse = () => {
    const ctx = audioContextRef.current || new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = ctx;
    if (ctx.state === 'suspended') ctx.resume();

    const targetMasterTime = clockSync.now() + 350; // Fire 350ms in the future across all devices

    // 1. Broadcast scheduled pulse timestamp to all satellite receivers
    activeConnectionsRef.current.forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'SYNC_CLAPPER', targetMasterTime });
      }
    });

    // 2. Play scheduled acoustic pulse through Host delay pipeline (or destination) and trigger flash
    const destNode = (!laptopMuted && hostDelayNodeRef.current) 
      ? hostDelayNodeRef.current 
      : ctx.destination;
    clockSync.playScheduledPulse(ctx, targetMasterTime, triggerVisualFlash, destNode);
  };

  // Respond to satellite auto-sync telemetry request
  const handleCalibrateRequest = (conn) => {
    if (!conn || !conn.open) return;
    conn.send({ 
      type: 'CALIBRATE_TELEMETRY', 
      hostDelayMs: hostDelayMs,
      laptopMuted: laptopMuted,
      rtt: clockSync.rtt || 0 
    });
    triggerVisualFlash();
  };

  const triggerAutoSyncForPeer = (peerId) => {
    const conn = activeConnectionsRef.current.get(peerId);
    if (conn && conn.open) {
      conn.send({ type: 'START_CALIBRATE_CLIENT' });
    }
  };

  const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('firefox');

  const startScreenCapture = async () => {
    if (isFirefox) {
      setShowAudioMissingHelp(true);
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser'
        },
        audio: {
          suppressLocalAudioPlayback: true,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        systemAudio: 'include',
        surfaceSwitching: 'include'
      });

      const audioTracks = mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        mediaStream.getTracks().forEach(t => t.stop());
        setShowAudioMissingHelp(true);
        return;
      }

      setShowAudioMissingHelp(false);
      const title = mediaStream.getVideoTracks()[0]?.label || "Desktop / Movie Audio Loopback";
      setActiveMediaTitle(title);
      activeMediaTitleRef.current = title;
      setupHostAudio(mediaStream);
    } catch (err) {
      console.error("[Host] Screen capture error:", err);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setActiveMediaTitle(file.name);
    activeMediaTitleRef.current = file.name;
    const fileUrl = URL.createObjectURL(file);

    if (videoElementRef.current) {
      videoElementRef.current.src = fileUrl;
      // CRITICAL: Mute the <video> element so it doesn't play twice or clip!
      videoElementRef.current.muted = true;
      videoElementRef.current.play();

      let stream;
      if (videoElementRef.current.captureStream) {
        stream = videoElementRef.current.captureStream();
      } else if (videoElementRef.current.mozCaptureStream) {
        stream = videoElementRef.current.mozCaptureStream();
      }

      if (stream) {
        setupHostAudio(stream);
      }
    }
  };

  const startMicCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000,
          channelCount: 2
        }
      });
      setActiveMediaTitle("Live Room Mic / DJ Line-in");
      activeMediaTitleRef.current = "Live Room Mic / DJ Line-in";
      setupHostAudio(stream);
    } catch (err) {
      console.error("[Host] Mic error:", err);
    }
  };

  const startSynthGenerator = () => {
    const ctx = audioContextRef.current || new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = ctx;
    if (ctx.state === 'suspended') ctx.resume();

    const dest = ctx.createMediaStreamDestination();
    let step = 0;
    const notes = [110, 130.81, 146.83, 164.81, 196, 220, 261.63];

    synthIntervalRef.current = setInterval(() => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const freq = notes[step % notes.length];
      osc.type = step % 4 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

      osc.connect(gain);
      gain.connect(dest);

      osc.start();
      osc.stop(ctx.currentTime + 0.24);
      step++;
    }, 240);

    setActiveMediaTitle("Warm Analog Lofi Chords (Test Loop)");
    activeMediaTitleRef.current = "Warm Analog Lofi Chords (Test Loop)";
    setupHostAudio(dest.stream);
  };

  const setupHostAudio = (stream) => {
    audioStreamRef.current = stream;
    setIsBroadcasting(true);

    console.log(`[Host] Broadcasting Studio Hi-Fi Opus audio stream to ${activeConnectionsRef.current.size} satellites`);
    activeConnectionsRef.current.forEach((conn, peerId) => {
      if (peerRef.current && peerRef.current.open) {
        console.log(`[Host] Calling satellite ${peerId} with 256kbps audio`);
        try {
          peerRef.current.call(peerId, stream);
        } catch (err) {
          console.error(`[Host] Error calling peer ${peerId}:`, err);
        }
      }
      if (conn.open) {
        conn.send({ type: 'AUDIO_STARTED', title: activeMediaTitleRef.current });
      }
    });

    try {
      const ctx = audioContextRef.current || new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();

      if (hostSourceNodeRef.current) {
        try { hostSourceNodeRef.current.disconnect(); } catch (e) {}
      }

      const source = ctx.createMediaStreamSource(stream);
      hostSourceNodeRef.current = source;

      // Visualizer Analyser
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyserRef.current = analyser;

      // DELAY NODE: Delays Host Laptop speaker playback by hostDelayMs (120ms)
      // to eliminate the slap-back echo between laptop and phones!
      const hostDelay = ctx.createDelay(1.0);
      hostDelay.delayTime.setValueAtTime(hostDelayMs / 1000, ctx.currentTime);
      hostDelayNodeRef.current = hostDelay;

      // GAIN NODE: For muting laptop speakers
      const hostGain = ctx.createGain();
      hostGain.gain.setValueAtTime(laptopMuted ? 0 : 1.0, ctx.currentTime);
      hostGainNodeRef.current = hostGain;

      // Master Soft-Knee Compressor / Limiter to prevent distortion on laptop speakers
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-1.0, ctx.currentTime);
      compressor.knee.setValueAtTime(12, ctx.currentTime);
      compressor.ratio.setValueAtTime(20, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.20, ctx.currentTime);

      source.connect(hostDelay);
      hostDelay.connect(hostGain);
      hostGain.connect(compressor);
      compressor.connect(ctx.destination);
    } catch (e) {
      console.warn("[Host] Audio pipeline notice:", e);
    }
  };

  const handleToggleLaptopMute = () => {
    const nextMuted = !laptopMuted;
    setLaptopMuted(nextMuted);
    if (hostGainNodeRef.current && audioContextRef.current) {
      hostGainNodeRef.current.gain.setValueAtTime(nextMuted ? 0 : 1.0, audioContextRef.current.currentTime);
    }
  };

  const handleDelayChange = (ms) => {
    const clamped = Math.max(0, Math.min(300, ms));
    setHostDelayMs(clamped);
    if (hostDelayNodeRef.current && audioContextRef.current) {
      const ctx = audioContextRef.current;
      const now = ctx.currentTime;
      const gainNode = hostGainNodeRef.current;
      if (gainNode && !laptopMuted) {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0.001, now + 0.015);
        hostDelayNodeRef.current.delayTime.setValueAtTime(clamped / 1000, now + 0.018);
        gainNode.gain.setValueAtTime(0.001, now + 0.020);
        gainNode.gain.linearRampToValueAtTime(1.0, now + 0.035);
      } else {
        hostDelayNodeRef.current.delayTime.setValueAtTime(clamped / 1000, now);
      }
    }
  };

  const stopBroadcasting = (fullTeardown = false) => {
    setIsBroadcasting(false);
    if (synthIntervalRef.current) {
      clearInterval(synthIntervalRef.current);
      synthIntervalRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
    }

    activeConnectionsRef.current.forEach(conn => {
      if (conn.open) conn.send({ type: 'AUDIO_STOPPED' });
    });

    if (fullTeardown) {
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
      activeConnectionsRef.current.clear();
      setConnectedPeers([]);
    }
  };

  const copyShareLink = () => {
    const url = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Console Top Deck */}
      <div 
        className="analog-deck" 
        style={{ 
          padding: '24px', 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '20px', 
          position: 'relative',
          transition: 'box-shadow 0.08s ease, border-color 0.08s ease',
          borderColor: isFlashing ? 'var(--amber-bright)' : 'var(--border-deck)',
          boxShadow: isFlashing ? '0 0 35px var(--amber-bright)' : '0 20px 48px -12px rgba(0, 0, 0, 0.85)'
        }}
      >
        {/* Chassis Corner Rivets */}
        <div className="corner-rivet rivet-tl" />
        <div className="corner-rivet rivet-tr" />
        <div className="corner-rivet rivet-bl" />
        <div className="corner-rivet rivet-br" />

        {/* Header Ribbon */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ 
                width: '10px', 
                height: '10px', 
                borderRadius: '50%', 
                background: isBroadcasting ? 'var(--amber-bright)' : '#44403c',
                boxShadow: isBroadcasting ? '0 0 10px var(--amber-core)' : 'none'
              }} />
              <span className="font-mono" style={{ fontSize: '12px', letterSpacing: '1.5px', color: isBroadcasting ? 'var(--amber-bright)' : 'var(--text-dim)' }}>
                {isBroadcasting ? 'TRANSMITTER LIVE • 256KBPS STUDIO' : 'TRANSMITTER STANDBY'}
              </span>
            </div>
            <h1 className="font-serif" style={{ fontSize: '26px', fontWeight: '700', marginTop: '4px' }}>
              Master Broadcast Deck
            </h1>
          </div>

          {/* Stamped Room Ticket */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div className="paper-badge" title="Room Code">
              <span>ROOM:</span>
              <strong style={{ letterSpacing: '1.5px', color: 'var(--amber-bright)' }}>
                {roomId.replace('SESSION-', '#')}
              </strong>
            </div>

            <button onClick={() => setShowQrModal(true)} className="btn-analog" title="Show QR Code">
              <QrCode size={16} />
              <span>QR Code</span>
            </button>

            <button onClick={copyShareLink} className="btn-analog">
              {copied ? <Check size={16} color="var(--amber-bright)" /> : <Copy size={16} />}
              <span>{copied ? 'Copied' : 'Share'}</span>
            </button>
          </div>
        </div>

        {/* Live Network & Satellite Telemetry Banner */}
        <div style={{
          padding: '12px 16px',
          borderRadius: '12px',
          background: connectedPeers.length > 0 
            ? 'rgba(16, 185, 129, 0.12)' 
            : 'rgba(245, 158, 11, 0.08)',
          border: `1px solid ${connectedPeers.length > 0 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.25)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: connectedPeers.length > 0 ? '#10b981' : 'var(--accent-bright)',
              boxShadow: connectedPeers.length > 0 ? '0 0 10px #10b981' : '0 0 8px var(--accent-glow)'
            }} />
            <span className="font-mono" style={{ fontSize: '12px', fontWeight: '700', color: connectedPeers.length > 0 ? '#10b981' : 'var(--text-cream)' }}>
              {connectedPeers.length === 0 
                ? 'WAITING FOR SATELLITE PHONES TO TUNE IN...' 
                : `WI-FI DIRECT MESH ACTIVE • ${connectedPeers.length} PHONE(S) LINKED`}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* INSTANT SYNC CLAPPER / ACOUSTIC PULSE TOOL */}
            <button
              onClick={emitSyncPulse}
              className="btn-analog btn-amber"
              style={{ padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Click to emit a synchronized sharp click & flash across all screens to verify phase lock"
            >
              <Target size={14} />
              <span>🎯 Emit Sync Pulse (Sync Clapper)</span>
            </button>
          </div>
        </div>

        {/* Source Selector Rack */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '1px' }}>
            1. SELECT AUDIO INPUT CHANNEL:
          </span>

          <div className="input-channels-grid">
            <button 
              onClick={() => { setSourceType('screen'); startScreenCapture(); }}
              className={`btn-analog ${sourceType === 'screen' && isBroadcasting ? 'btn-amber' : ''}`}
              style={{ padding: '14px', justifyContent: 'flex-start' }}
            >
              <Monitor size={18} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '13px', fontWeight: '600' }}>Screen / Tab Loopback</div>
                <div style={{ fontSize: '11px', color: isFirefox ? 'var(--amber-bright)' : 'rgba(244, 239, 230, 0.7)' }}>
                  {isFirefox ? '⚠️ Chrome / Edge needed for Tab Audio' : 'Spotify, Netflix, YouTube'}
                </div>
              </div>
            </button>

            <label 
              className={`btn-analog ${sourceType === 'file' && isBroadcasting ? 'btn-amber' : ''}`}
              style={{ padding: '14px', justifyContent: 'flex-start', cursor: 'pointer' }}
            >
              <Music size={18} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '13px', fontWeight: '600' }}>Local Audio / Movie File</div>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>MP3, WAV, MP4</div>
              </div>
              <input type="file" accept="audio/*,video/*" onChange={(e) => { setSourceType('file'); handleFileUpload(e); }} style={{ display: 'none' }} />
            </label>

            <button 
              onClick={() => { setSourceType('synth'); startSynthGenerator(); }}
              className={`btn-analog ${sourceType === 'synth' && isBroadcasting ? 'btn-amber' : ''}`}
              style={{ padding: '14px', justifyContent: 'flex-start' }}
            >
              <Radio size={18} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '13px', fontWeight: '600' }}>Analog Lofi Groove</div>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>Instant built-in test synth</div>
              </div>
            </button>

            <button 
              onClick={() => { setSourceType('mic'); startMicCapture(); }}
              className={`btn-analog ${sourceType === 'mic' && isBroadcasting ? 'btn-amber' : ''}`}
              style={{ padding: '14px', justifyContent: 'flex-start' }}
            >
              <Mic size={18} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '13px', fontWeight: '600' }}>Live Microphone</div>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>Room line-in DJ</div>
              </div>
            </button>
          </div>
        </div>

        {/* PRECISION SYNCHRONIZATION & LAPTOP SPEAKER CONTROL DECK */}
        <div className="analog-inset" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px', border: '1px solid var(--amber-glow)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Zap size={16} color="var(--amber-bright)" />
                <span className="font-mono" style={{ fontSize: '12px', fontWeight: '700', letterSpacing: '1px', color: 'var(--amber-bright)' }}>
                  PRECISION HOST LATENCY CONTROLLER
                </span>
                <span className="paper-badge" style={{ fontSize: '10px', padding: '2px 6px', color: '#10b981' }}>
                  ● LOCKED ({hostDelayMs}MS)
                </span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Laptop audio is delayed by <strong>{hostDelayMs}ms</strong> to match the phone WebRTC transmission pipeline. Zero pitch-warping.
              </p>
            </div>

            {/* Quick 1-Click Laptop Mute/Play Toggle */}
            <button 
              onClick={handleToggleLaptopMute}
              className={`btn-analog ${laptopMuted ? '' : 'btn-amber'}`}
              style={{ padding: '8px 14px', fontSize: '12px' }}
            >
              {laptopMuted ? (
                <>
                  <VolumeX size={16} />
                  <span>🔇 Laptop Muted (Party Mode: Phones Only)</span>
                </>
              ) : (
                <>
                  <Volume2 size={16} />
                  <span>🔊 Laptop Speakers: Active ({hostDelayMs}ms delay)</span>
                </>
              )}
            </button>
          </div>

          {/* Stepped Adjustments for Host Delay */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={14} color="var(--text-muted)" />
              <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Host Playback Delay:
              </span>
              <strong className="font-mono" style={{ fontSize: '12px', color: 'var(--amber-bright)' }}>
                {hostDelayMs} ms
              </strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button 
                onClick={() => handleDelayChange(hostDelayMs - 50)}
                className="btn-analog" 
                style={{ padding: '4px 8px', fontSize: '11px' }}
              >
                -50ms
              </button>
              <button 
                onClick={() => handleDelayChange(hostDelayMs - 10)}
                className="btn-analog" 
                style={{ padding: '4px 8px', fontSize: '11px' }}
              >
                -10ms
              </button>

              <button 
                onClick={() => handleDelayChange(120)}
                className="btn-analog" 
                style={{ 
                  padding: '4px 10px', 
                  fontSize: '11px',
                  background: hostDelayMs === 120 ? 'var(--amber-core)' : '#1a1816',
                  color: hostDelayMs === 120 ? '#0c0b0a' : 'var(--text-cream)'
                }}
              >
                120ms (Standard Lock)
              </button>

              <button 
                onClick={() => handleDelayChange(hostDelayMs + 10)}
                className="btn-analog" 
                style={{ padding: '4px 8px', fontSize: '11px' }}
              >
                +10ms
              </button>
              <button 
                onClick={() => handleDelayChange(hostDelayMs + 50)}
                className="btn-analog" 
                style={{ padding: '4px 8px', fontSize: '11px' }}
              >
                +50ms
              </button>
            </div>
          </div>
        </div>

        {/* Live Audio Meter & Readout Panel */}
        <div className="analog-inset" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              FEED: <strong style={{ color: 'var(--text-cream)' }}>{activeMediaTitle}</strong>
            </span>
            <span className="font-mono" style={{ fontSize: '11px', color: isBroadcasting ? 'var(--amber-bright)' : 'var(--text-dim)' }}>
              {isBroadcasting ? '48.0 kHz • 256KBPS STUDIO STEREO OPUS' : 'WAITING FOR INPUT'}
            </span>
          </div>

          <Visualizer analyser={analyserRef.current} active={isBroadcasting} height={54} />
        </div>

        {/* Video preview for local movies */}
        <video ref={videoElementRef} controls style={{ width: '100%', maxHeight: '180px', borderRadius: '10px', display: sourceType === 'file' ? 'block' : 'none' }} />

      </div>

      {/* Connected Satellite Soundboard Strip */}
      <div className="analog-deck" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
        {/* Chassis Corner Rivets */}
        <div className="corner-rivet rivet-tl" />
        <div className="corner-rivet rivet-tr" />
        <div className="corner-rivet rivet-bl" />
        <div className="corner-rivet rivet-br" />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2 className="font-serif" style={{ fontSize: '18px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={18} color="var(--amber-bright)" />
              Satellite Speaker Fleet ({connectedPeers.length} Active Devices)
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
              All devices are locked to the Host Master Clock and streaming 256kbps Studio Hi-Fi sound.
            </p>
          </div>
        </div>

        {connectedPeers.length === 0 ? (
          <div className="analog-inset" style={{ padding: '32px 16px', textAlign: 'center' }}>
            <p className="font-mono" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              No satellite speakers paired yet. Scan the QR code or share session code to tune in!
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
            {connectedPeers.map((peer, idx) => (
              <div key={peer.id} className="analog-inset" style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span className="font-mono" style={{ fontSize: '10px', color: 'var(--amber-bright)' }}>DEVICE {idx + 1}</span>
                    <strong style={{ fontSize: '13px', display: 'block', color: 'var(--text-cream)' }}>{peer.name}</strong>
                  </div>
                  <span className="paper-badge" style={{ fontSize: '10px', padding: '2px 6px', color: '#10b981' }}>
                    ● CLOCK LOCKED
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  <span>P2P DataChannel Active</span>
                  <span style={{ color: 'var(--accent-bright)' }}>256KBPS OPUS</span>
                </div>

                <button
                  onClick={() => triggerAutoSyncForPeer(peer.id)}
                  className="btn-analog btn-amber"
                  style={{ fontSize: '11px', padding: '6px 12px', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  <Target size={12} /> Auto-Sync This Speaker
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* QR Code Modal Drawer */}
      {showQrModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '16px'
        }}>
          <div className="analog-deck" style={{ maxWidth: '340px', width: '100%', padding: '28px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 className="font-serif" style={{ fontSize: '20px', fontWeight: '700' }}>Scan to Tune In</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Scan with any phone camera to link as a satellite speaker</p>
            
            <div style={{ background: '#141210', padding: '14px', borderRadius: '12px', display: 'inline-block', margin: '0 auto', border: '1px solid var(--border-deck)' }}>
              {qrDataUrl && <img src={qrDataUrl} alt="QR Code" style={{ width: '200px', height: '200px', display: 'block' }} />}
            </div>

            <div className="paper-badge" style={{ margin: '0 auto', fontSize: '15px' }}>
              SESSION: <strong>{roomId}</strong>
            </div>

            <button onClick={() => setShowQrModal(false)} className="btn-analog btn-amber" style={{ marginTop: '8px' }}>
              Close Deck
            </button>
          </div>
        </div>
      )}

      {/* Audio Track Missing Guide Modal */}
      {showAudioMissingHelp && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0,0,0,0.88)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 110,
          padding: '16px'
        }}>
          <div className="analog-deck" style={{ maxWidth: '440px', width: '100%', padding: '28px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
            <div className="corner-rivet rivet-tl" />
            <div className="corner-rivet rivet-tr" />
            <div className="corner-rivet rivet-bl" />
            <div className="corner-rivet rivet-br" />

            <div>
              <span className="paper-badge" style={{ fontSize: '11px', color: 'var(--amber-bright)', marginBottom: '8px' }}>
                {isFirefox ? '🦊 FIREFOX BROWSER LIMITATION' : '⚠️ AUDIO PERMISSION REQUIRED'}
              </span>
              <h3 className="font-serif" style={{ fontSize: '22px', fontWeight: '800', color: 'var(--text-cream)', marginTop: '4px' }}>
                {isFirefox ? 'Firefox Does Not Support Tab Audio' : 'How to Pick Up Audio in Chrome'}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.5' }}>
                {isFirefox 
                  ? 'Mozilla Firefox only supports sharing video, not audio from tabs or desktop (Mozilla Bug #1541425).' 
                  : 'Chrome blocked audio because the audio toggle was not turned on in the browser popup:'}
              </p>
            </div>

            {/* Visual Guide / Solutions */}
            {isFirefox ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: '#100f0d', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-deck)' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ background: 'var(--amber-core)', color: '#0c0b0a', borderRadius: '4px', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '11px', flexShrink: 0 }}>1</span>
                  <div style={{ fontSize: '12px', color: 'var(--text-cream)' }}>
                    <strong>To stream Spotify, Netflix, or YouTube:</strong> Open this page in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> on your laptop. (Chromium browsers support direct tab audio capture out of the box).
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ background: 'var(--amber-core)', color: '#0c0b0a', borderRadius: '4px', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '11px', flexShrink: 0 }}>2</span>
                  <div style={{ fontSize: '12px', color: 'var(--text-cream)' }}>
                    <strong>Want to stay in Firefox?</strong> Select <strong>"Local Audio / Movie File"</strong> below to stream MP3, WAV, or MP4 files in perfect sync right now!
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ background: 'var(--amber-core)', color: '#0c0b0a', borderRadius: '4px', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '11px', flexShrink: 0 }}>3</span>
                  <div style={{ fontSize: '12px', color: 'var(--text-cream)' }}>
                    <strong>Test mesh right now:</strong> Click <strong>"Test Synth Groove"</strong> below to hear live audio pipe to your phone immediately in Firefox.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: '#100f0d', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-deck)' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ background: 'var(--amber-core)', color: '#0c0b0a', borderRadius: '4px', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '11px', flexShrink: 0 }}>1</span>
                  <div style={{ fontSize: '12px', color: 'var(--text-cream)' }}>
                    <strong>Select "Chrome Tab"</strong> (at the top of the popup) and click your Spotify Web, YouTube, or Netflix tab.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ background: 'var(--amber-core)', color: '#0c0b0a', borderRadius: '4px', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '11px', flexShrink: 0 }}>2</span>
                  <div style={{ fontSize: '12px', color: 'var(--text-cream)' }}>
                    <strong>Turn ON "Also share tab audio"</strong> at the bottom-left corner of the Chrome dialog.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ background: 'var(--amber-core)', color: '#0c0b0a', borderRadius: '4px', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '11px', flexShrink: 0 }}>3</span>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    <em>Using Desktop Spotify App?</em> Choose <strong>"Entire Screen"</strong> and check <strong>"Share system audio"</strong>. (Chrome does NOT support audio from the "Window" tab).
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {!isFirefox && (
                <button 
                  onClick={() => { setShowAudioMissingHelp(false); startScreenCapture(); }} 
                  className="btn-analog btn-amber" 
                  style={{ flex: 1, padding: '12px', fontSize: '13px' }}
                >
                  🔄 Try Again (Open Popup)
                </button>
              )}

              <button 
                onClick={() => { setShowAudioMissingHelp(false); setSourceType('synth'); startSynthGenerator(); }} 
                className={`btn-analog ${isFirefox ? 'btn-amber' : ''}`} 
                style={{ flex: isFirefox ? 1 : 'none', padding: '12px', fontSize: '13px' }}
              >
                ⚡ Test Synth Groove
              </button>

              <button 
                onClick={() => setShowAudioMissingHelp(false)} 
                className="btn-analog" 
                style={{ padding: '12px', fontSize: '13px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
