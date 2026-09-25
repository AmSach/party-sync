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
  const [laptopMuted, setLaptopMuted] = useState(true);
  const [hostDelayMs, setHostDelayMs] = useState(300); // 300ms default matches typical WebRTC transit latency
  const hostDelayMsRef = useRef(300);
  const [isFlashing, setIsFlashing] = useState(false);

  const [activeMediaTitle, setActiveMediaTitle] = useState('No audio source selected');
  const [showQrModal, setShowQrModal] = useState(false);
  const [showAudioMissingHelp, setShowAudioMissingHelp] = useState(false);

  const peerRef = useRef(null);
  const audioStreamRef = useRef(null);
  const videoElementRef = useRef(null);
  const audioElementRef = useRef(null);
  const mediaElementSourceRef = useRef(null);
  const streamDestRef = useRef(null);
  const audioContextRef = useRef(null);
  const hostDelayNodeRef = useRef(null);
  const hostGainNodeRef = useRef(null);
  const hostSourceNodeRef = useRef(null);
  const synthIntervalRef = useRef(null);
  const metronomeIntervalRef = useRef(null);
  const [isMetronomeActive, setIsMetronomeActive] = useState(false);
  const analyserRef = useRef(null);
  const activeConnectionsRef = useRef(new Map());
  const activeMediaCallsRef = useRef(new Map()); // peerId -> MediaConnection
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
          callPeerWithStream(conn.peer, audioStreamRef.current);
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
        } else if (data.type === 'REQUEST_HOST_DELAY') {
          // Satellite says: "My inherent latency is X, you need to delay yourself by at least Y"
          // Take the MAX of current host delay and the requested delay — never go DOWN from a satellite request
          // because another satellite might need the higher delay
          const requestedMs = Math.round(data.neededDelayMs || 0);
          const currentMs = hostDelayMsRef.current;
          if (requestedMs > currentMs) {
            console.log(`[Host] Satellite "${data.deviceName || conn.peer}" needs ${requestedMs}ms host delay (currently ${currentMs}ms) — auto-bumping`);
            handleDelayChange(requestedMs);
            // Notify ALL satellites about the new host delay so they can re-align
            activeConnectionsRef.current.forEach((c) => {
              if (c.open) {
                c.send({ type: 'HOST_DELAY_UPDATE', hostDelayMs: requestedMs });
              }
            });
          } else {
            console.log(`[Host] Satellite "${data.deviceName || conn.peer}" needs ${requestedMs}ms — already at ${currentMs}ms, no change needed`);
          }
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

    // 2. Play scheduled acoustic pulse through Host delay pipeline only if laptop speakers are unmuted
    const destNode = laptopMuted ? null : (hostDelayNodeRef.current || 'default');
    clockSync.playScheduledPulse(ctx, targetMasterTime, triggerVisualFlash, destNode);
  };

  // Respond to satellite auto-sync telemetry request
  const handleCalibrateRequest = (conn) => {
    if (!conn || !conn.open) return;
    conn.send({ 
      type: 'CALIBRATE_TELEMETRY', 
      hostDelayMs: hostDelayMsRef.current,
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

  const callPeerWithStream = (peerId, stream) => {
    if (!peerRef.current || !peerRef.current.open || !stream) return;

    // Check if we have an active, TRULY live call to this peer
    const existingCall = activeMediaCallsRef.current.get(peerId);
    if (existingCall) {
      // Verify the existing call is actually alive — PeerJS .open can be stale
      const isCallAlive = existingCall.open && 
        existingCall.peerConnection && 
        existingCall.peerConnection.connectionState !== 'closed' &&
        existingCall.peerConnection.connectionState !== 'failed' &&
        existingCall.peerConnection.connectionState !== 'disconnected';
      
      // Also check if the stream tracks are still live
      const tracksLive = stream.getAudioTracks().some(t => t.readyState === 'live');
      
      if (isCallAlive && tracksLive) {
        console.log(`[Host] Media call already active for satellite ${peerId}`);
        return;
      }
      
      // Stale call — clean up before re-calling
      console.log(`[Host] Stale media call detected for ${peerId} — closing and re-calling`);
      try { existingCall.close(); } catch (e) {}
      activeMediaCallsRef.current.delete(peerId);
    }

    console.log(`[Host] Calling satellite ${peerId} with pristine stereo music audio`);
    try {
      const call = peerRef.current.call(peerId, stream);
      if (call) {
        activeMediaCallsRef.current.set(peerId, call);
        call.on('close', () => {
          activeMediaCallsRef.current.delete(peerId);
        });
        call.on('error', (err) => {
          console.warn(`[Host] Media call error for ${peerId}:`, err);
          activeMediaCallsRef.current.delete(peerId);
        });
      }
    } catch (err) {
      console.error(`[Host] Error calling peer ${peerId}:`, err);
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
          suppressLocalAudioPlayback: true, // CRITICAL: Suppress tab's direct audio — play through our delayed Web Audio pipeline instead to sync with phones
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2
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

      // Extract ONLY audio tracks to avoid wasting Wi-Fi bandwidth on video!
      const audioOnlyStream = new MediaStream(audioTracks);

      // Listen for user ending screen capture via browser banner (without killing active session)
      mediaStream.getVideoTracks().forEach(track => {
        track.onended = () => {
          console.log('[Host] Native screen capture ended by user');
          stopBroadcasting(false);
        };
      });

      // Screen capture: Tab audio is SUPPRESSED (suppressLocalAudioPlayback=true).
      // Host plays through delayed Web Audio pipeline at configured host delay to sync with phones.
      setLaptopMuted(false);
      setupHostAudio(audioOnlyStream, false); // false = DON'T mute host, play through delayed pipeline
    } catch (err) {
      console.error("[Host] Screen capture error:", err);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Clean up previous broadcast
    stopBroadcasting(false);

    setActiveMediaTitle(file.name);
    activeMediaTitleRef.current = file.name;
    const fileUrl = URL.createObjectURL(file);

    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    const ctx = audioContextRef.current || new AudioCtxClass({ latencyHint: 'interactive', sampleRate: 48000 });
    audioContextRef.current = ctx;
    if (ctx.state === 'suspended') ctx.resume();

    // Create an audio element for pristine audio decoding
    if (!audioElementRef.current) {
      const audioEl = new Audio();
      audioEl.crossOrigin = 'anonymous';
      audioElementRef.current = audioEl;
    }
    const audioEl = audioElementRef.current;
    audioEl.src = fileUrl;
    audioEl.loop = true;

    if (!mediaElementSourceRef.current) {
      mediaElementSourceRef.current = ctx.createMediaElementSource(audioEl);
    }
    const sourceNode = mediaElementSourceRef.current;

    if (!streamDestRef.current) {
      streamDestRef.current = ctx.createMediaStreamDestination();
    }
    const streamDest = streamDestRef.current;

    try { sourceNode.disconnect(); } catch (err) {}

    // Visualizer
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    sourceNode.connect(analyser);
    analyserRef.current = analyser;

    // Route to WebRTC broadcast destination
    sourceNode.connect(streamDest);

    audioEl.play().catch(err => console.error("[Host] Audio playback error:", err));

    // Broadcast audio-only stream to satellites & configure delayed host playback
    setLaptopMuted(false);
    setupHostAudio(streamDest.stream, false);
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
      setLaptopMuted(true); // Mute host to prevent feedback loop
      setupHostAudio(stream, true);
    } catch (err) {
      console.error("[Host] Mic error:", err);
    }
  };

  const startSynthGenerator = () => {
    const ctx = audioContextRef.current || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive', sampleRate: 48000 });
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
    setLaptopMuted(false); // Enable laptop playback for synth!
    setupHostAudio(dest.stream, false);
  };

  const setupHostAudio = (stream, isScreenCapture = false) => {
    audioStreamRef.current = stream;
    setIsBroadcasting(true);

    // CRITICAL: Set contentHint = 'music' on all tracks!
    // Disables browser speech filtering, prevents treble/bass cutoff, and switches Opus to full-band CELT music mode!
    stream.getAudioTracks().forEach(track => {
      if ('contentHint' in track) {
        track.contentHint = 'music';
      }
      try {
        track.applyConstraints({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2
        });
      } catch (e) {}
    });

    console.log(`[Host] Broadcasting Studio Hi-Fi Opus audio stream to ${activeConnectionsRef.current.size} satellites`);
    activeConnectionsRef.current.forEach((conn, peerId) => {
      callPeerWithStream(peerId, stream);
      if (conn.open) {
        conn.send({ type: 'AUDIO_STARTED', title: activeMediaTitleRef.current });
      }
    });

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      const ctx = audioContextRef.current || new AudioCtxClass({ latencyHint: 'interactive', sampleRate: 48000 });
      audioContextRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();

      if (hostSourceNodeRef.current) {
        try { hostSourceNodeRef.current.disconnect(); } catch (e) {}
      }
      if (hostDelayNodeRef.current) {
        try { hostDelayNodeRef.current.disconnect(); } catch (e) {}
      }
      if (hostGainNodeRef.current) {
        try { hostGainNodeRef.current.disconnect(); } catch (e) {}
      }

      const source = ctx.createMediaStreamSource(stream);
      hostSourceNodeRef.current = source;

      // Visualizer Analyser
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyserRef.current = analyser;

      // DELAY NODE: Delays Host Laptop speaker playback to sync with phones.
      // Without this delay, laptop plays at T=0 while phones play at T+300ms via WebRTC.
      // Supports up to 3.0s (3000ms) delay for high-latency Wi-Fi and Bluetooth pipelines.
      const hostDelay = ctx.createDelay(3.0);
      const currentDelayMs = hostDelayMsRef.current;
      hostDelay.delayTime.setValueAtTime(currentDelayMs / 1000, ctx.currentTime);
      hostDelayNodeRef.current = hostDelay;
      console.log(`[Host] Delay pipeline set to ${currentDelayMs}ms`);

      // GAIN NODE: For muting laptop speakers
      const hostGain = ctx.createGain();
      const shouldMute = isScreenCapture ? false : false; // Screen capture uses delayed host playback (tab is muted by suppressLocalAudioPlayback)
      setLaptopMuted(shouldMute);
      hostGain.gain.setValueAtTime(shouldMute ? 0 : 1.0, ctx.currentTime);
      hostGainNodeRef.current = hostGain;

      // Clean Bit-Perfect Direct Audio Pipeline (ZERO COMPRESSOR - prevents treble squashing and muffling)
      source.connect(hostDelay);
      hostDelay.connect(hostGain);
      hostGain.connect(ctx.destination);
    } catch (e) {
      console.warn("[Host] Audio pipeline notice:", e);
    }
  };

  const toggleMetronome = () => {
    if (metronomeIntervalRef.current) {
      clearInterval(metronomeIntervalRef.current);
      metronomeIntervalRef.current = null;
      setIsMetronomeActive(false);
      return;
    }

    setIsMetronomeActive(true);
    emitSyncPulse();
    metronomeIntervalRef.current = setInterval(() => {
      emitSyncPulse();
    }, 1000);
  };

  const handleToggleLaptopMute = () => {
    const nextMuted = !laptopMuted;
    setLaptopMuted(nextMuted);
    if (hostGainNodeRef.current && audioContextRef.current) {
      hostGainNodeRef.current.gain.setValueAtTime(nextMuted ? 0 : 1.0, audioContextRef.current.currentTime);
    }
  };

  const hostDelayBroadcastTimer = useRef(null);

  const handleDelayChange = (ms) => {
    const clamped = Math.max(0, Math.min(2000, ms));
    setHostDelayMs(clamped);
    hostDelayMsRef.current = clamped;

    if (hostDelayNodeRef.current && audioContextRef.current) {
      try {
        const ctx = audioContextRef.current;
        const now = ctx.currentTime;
        hostDelayNodeRef.current.delayTime.cancelScheduledValues(0);
        hostDelayNodeRef.current.delayTime.setValueAtTime(clamped / 1000, now);
        console.log(`[Host] Host delay updated to ${clamped}ms`);
      } catch (err) {
        console.warn('[Host] Host delay update error, using fallback:', err);
        try {
          hostDelayNodeRef.current.delayTime.value = clamped / 1000;
        } catch (e) {}
      }
    }

    // Debounced broadcast to satellites so they re-align (300ms debounce to avoid flooding during slider drag)
    if (hostDelayBroadcastTimer.current) clearTimeout(hostDelayBroadcastTimer.current);
    hostDelayBroadcastTimer.current = setTimeout(() => {
      activeConnectionsRef.current.forEach((c) => {
        if (c.open) {
          c.send({ type: 'HOST_DELAY_UPDATE', hostDelayMs: clamped });
        }
      });
    }, 300);
  };

  const stopBroadcasting = (fullTeardown = false) => {
    setIsBroadcasting(false);
    if (metronomeIntervalRef.current) {
      clearInterval(metronomeIntervalRef.current);
      metronomeIntervalRef.current = null;
      setIsMetronomeActive(false);
    }
    if (synthIntervalRef.current) {
      clearInterval(synthIntervalRef.current);
      synthIntervalRef.current = null;
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = '';
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
    }

    if (hostSourceNodeRef.current) {
      try { hostSourceNodeRef.current.disconnect(); } catch (e) {}
      hostSourceNodeRef.current = null;
    }
    if (hostDelayNodeRef.current) {
      try { hostDelayNodeRef.current.disconnect(); } catch (e) {}
      hostDelayNodeRef.current = null;
    }
    if (hostGainNodeRef.current) {
      try { hostGainNodeRef.current.disconnect(); } catch (e) {}
      hostGainNodeRef.current = null;
    }

    activeMediaCallsRef.current.forEach(call => {
      try { call.close(); } catch (e) {}
    });
    activeMediaCallsRef.current.clear();

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
              <span>🎯 1-Tap Pulse</span>
            </button>

            <button
              onClick={toggleMetronome}
              className={`btn-analog ${isMetronomeActive ? 'btn-amber' : ''}`}
              style={{ padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Toggle continuous 1-second sync tick across all devices to easily hear alignment"
            >
              <Clock size={14} />
              <span>{isMetronomeActive ? '⏹ Stop Metronome' : '⏱ Loop Metronome'}</span>
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

          {/* Continuous Slider & Stepped Adjustments for Host Delay */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={14} color="var(--amber-bright)" />
                <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  HOST PLAYBACK DELAY:
                </span>
                <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
                  (Adjusts laptop timing to match phones)
                </span>
              </div>
              <strong className="font-mono paper-badge" style={{ fontSize: '13px', padding: '3px 10px', color: hostDelayMs === 0 ? '#10b981' : 'var(--amber-bright)' }}>
                {hostDelayMs === 0 ? '0ms (Direct / No Delay)' : `${hostDelayMs} ms`}
              </strong>
            </div>

            {/* Continuous Host Delay Slider: 0ms to 1500ms */}
            <input 
              type="range" 
              min="0" 
              max="1500" 
              step="5"
              value={hostDelayMs} 
              onChange={(e) => handleDelayChange(parseInt(e.target.value))} 
              style={{ width: '100%', accentColor: 'var(--amber-bright)' }}
            />

            {/* Stepped Fine-Tuning Nudge Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px' }}>
              {[
                { label: '-100ms', val: hostDelayMs - 100 },
                { label: '-50ms', val: hostDelayMs - 50 },
                { label: '-10ms', val: hostDelayMs - 10 },
                { label: '+10ms', val: hostDelayMs + 10 },
                { label: '+50ms', val: hostDelayMs + 50 },
                { label: '+100ms', val: hostDelayMs + 100 },
              ].map(b => (
                <button
                  key={b.label}
                  onClick={() => handleDelayChange(b.val)}
                  className="btn-analog"
                  style={{ padding: '6px 2px', fontSize: '11px', fontFamily: 'monospace' }}
                >
                  {b.label}
                </button>
              ))}
            </div>

            {/* Quick Preset Buttons (supporting beyond 300ms!) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
              {[
                { label: '0ms', val: 0 },
                { label: '150ms', val: 150 },
                { label: '250ms', val: 250 },
                { label: '350ms', val: 350 },
                { label: '500ms', val: 500 },
                { label: '700ms', val: 700 },
                { label: '1000ms', val: 1000 },
              ].map(b => (
                <button
                  key={b.label}
                  onClick={() => handleDelayChange(b.val)}
                  className="btn-analog"
                  style={{
                    padding: '6px 2px',
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    background: hostDelayMs === b.val ? 'var(--amber-core)' : '#1a1816',
                    color: hostDelayMs === b.val ? '#0c0b0a' : 'var(--text-cream)'
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
              <span>0ms (No Delay)</span>
              <span style={{ color: 'var(--amber-bright)' }}>Increase delay if phones sound late</span>
              <span>1500ms (High Latency)</span>
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
