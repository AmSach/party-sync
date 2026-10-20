import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import QRCode from 'qrcode';
import { 
  Tv, Music, Monitor, Mic, Radio, Users, Sliders, Copy, 
  Check, Volume2, VolumeX, ShieldCheck, Play, Pause, RefreshCw, QrCode,
  Zap, Clock, Wifi, Info, BellRing, Target, RotateCcw, Repeat, FileAudio, AlertCircle
} from 'lucide-react';
import { clockSync, ClockSynchronizer } from '../utils/clockSync';
import { configureHighFidelityAudioSDP } from '../utils/sdp';
import Visualizer from './Visualizer';

export default function HostView({ onBack }) {
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const [roomId, setRoomId] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [sourceType, setSourceType] = useState(isMobile ? 'file' : 'screen');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [connectedPeers, setConnectedPeers] = useState([]);
  const [copied, setCopied] = useState(false);
  
  // System audio capture & browser popup guide modal
  const [showScreenCaptureGuideModal, setShowScreenCaptureGuideModal] = useState(false);

  // AudioBuffer in-memory playback state (Zero-delay, works 100% on iOS & Android)
  const [fileAudioBuffer, setFileAudioBuffer] = useState(null);
  const [isFilePlaying, setIsFilePlaying] = useState(false);
  const [isFileDecoding, setIsFileDecoding] = useState(false);
  const [fileDuration, setFileDuration] = useState(0);
  const [fileCurrentTime, setFileCurrentTime] = useState(0);
  const [isFileLooping, setIsFileLooping] = useState(true);

  const audioBufferRef = useRef(null);
  const bufferSourceNodeRef = useRef(null);
  const bufferPlaybackStartRef = useRef(0);
  const bufferPauseOffsetRef = useRef(0);
  const fileProgressTimerRef = useRef(null);
  const isFileLoopingRef = useRef(true);
  const displayMediaStreamRef = useRef(null);

  // Host local playback pipeline delay & mute controls
  const [laptopMuted, setLaptopMuted] = useState(isMobile ? false : true);
  const laptopMutedRef = useRef(isMobile ? false : true);
  const [hostDelayMs, setHostDelayMs] = useState(300); // 300ms default matches typical WebRTC transit latency
  const hostDelayMsRef = useRef(300);
  const [isFlashing, setIsFlashing] = useState(false);
  const [hostOutputProfile, setHostOutputProfile] = useState('internal'); // 'internal' | 'bluetooth' | 'aux'
  const hostOutputProfileRef = useRef('internal');
  const satelliteLagsRef = useRef(new Map()); // peerId -> { name, physicalLagMs, profile }
  const [fleetTargetMs, setFleetTargetMs] = useState(300);

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
  const wakeLockRef = useRef(null);

  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('[Host] Screen Wake Lock active — preventing mobile sleep');
      }
    } catch (e) {
      console.warn('[Host] Wake lock unavailable:', e);
    }
  };

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
    requestWakeLock();

    // Mobile gesture unlock listener: touching screen resumes AudioContext if suspended
    const unlockHostAudio = () => {
      if (typeof navigator !== 'undefined' && 'audioSession' in navigator) {
        try { navigator.audioSession.type = 'playback'; } catch (e) {}
      }
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
    };
    window.addEventListener('click', unlockHostAudio);
    window.addEventListener('touchstart', unlockHostAudio, { passive: true });
    window.addEventListener('pointerdown', unlockHostAudio);

    // Keep mobile host alive when app is minimized or screen unlocks
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        unlockHostAudio();
        if (wakeLockRef.current === null) {
          requestWakeLock();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('click', unlockHostAudio);
      window.removeEventListener('touchstart', unlockHostAudio);
      window.removeEventListener('pointerdown', unlockHostAudio);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch (e) {}
        wakeLockRef.current = null;
      }
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
        } else if (data.type === 'SATELLITE_LAG_UPDATE') {
          // Satellite reports its true physical latency (transit + NetEQ + DAC + hardware profile + fine-tune)
          const lag = Math.max(0, Math.round(data.satellitePhysicalLag || 0));
          satelliteLagsRef.current.set(conn.peer, {
            name: data.deviceName || conn.peer,
            physicalLagMs: lag,
            profile: data.profile || 'phone'
          });
          recalculateFleetSync();
        } else if (data.type === 'REQUEST_HOST_DELAY') {
          const requestedMs = Math.round(data.neededDelayMs || 0);
          satelliteLagsRef.current.set(conn.peer, {
            name: data.deviceName || conn.peer,
            physicalLagMs: requestedMs + 20,
            profile: 'phone'
          });
          recalculateFleetSync();
        }
      });

      conn.on('close', () => {
        console.log('[Host] Satellite disconnected:', conn.peer);
        activeConnectionsRef.current.delete(conn.peer);
        satelliteLagsRef.current.delete(conn.peer);
        setConnectedPeers(prev => prev.filter(p => p.id !== conn.peer));
        recalculateFleetSync();
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

    // 2. Play scheduled acoustic pulse directly to Host speakers so user can audibly verify alignment
    clockSync.playScheduledPulse(ctx, targetMasterTime, triggerVisualFlash, 'default');
  };

  // Respond to satellite auto-sync telemetry request
  const handleCalibrateRequest = (conn) => {
    if (!conn || !conn.open) return;
    conn.send({ 
      type: 'CALIBRATE_TELEMETRY', 
      hostDelayMs: hostDelayMsRef.current,
      fleetTargetMs: fleetTargetMs,
      hostOutputProfile: hostOutputProfileRef.current,
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
    if (!stream.getAudioTracks().some(t => t.readyState === 'live')) {
      console.warn(`[Host] Stream has no live audio tracks — skipping call to ${peerId}`);
      return;
    }

    const existingCall = activeMediaCallsRef.current.get(peerId);
    if (existingCall && existingCall.open && existingCall._localStream === stream) {
      console.log(`[Host] Media call to ${peerId} already active on this stream, skipping redundant call`);
      return;
    }

    // Remove any old entry from tracking map (do NOT call .close() — it sends a
    // CLOSE signal to the receiver which can kill newly arriving calls too)
    activeMediaCallsRef.current.delete(peerId);

    console.log(`[Host] Calling satellite ${peerId} with audio stream`);
    try {
      const call = peerRef.current.call(peerId, stream, { sdpTransform: configureHighFidelityAudioSDP });
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

  const ensureHostAudioNodes = (ctx) => {
    if (typeof navigator !== 'undefined' && 'audioSession' in navigator) {
      try { navigator.audioSession.type = 'playback'; } catch (e) {}
    }
    // Always rebuild a fresh MediaStreamDestination so we never broadcast dead/stale tracks.
    // stopBroadcasting() nulls streamDestRef, delay, and gain — so this always starts clean.
    if (!streamDestRef.current) {
      const dest = ctx.createMediaStreamDestination();
      dest.stream.getAudioTracks().forEach(track => {
        if ('contentHint' in track) track.contentHint = 'music';
      });
      streamDestRef.current = dest;
    }
    if (!analyserRef.current) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyserRef.current = analyser;
    }
    if (!hostDelayNodeRef.current) {
      const hostDelay = ctx.createDelay(3.0);
      hostDelay.delayTime.setValueAtTime(hostDelayMsRef.current / 1000, ctx.currentTime);
      hostDelayNodeRef.current = hostDelay;
    }
    if (!hostGainNodeRef.current) {
      const hostGain = ctx.createGain();
      hostGain.gain.setValueAtTime(laptopMutedRef.current ? 0 : 1.0, ctx.currentTime);
      hostGainNodeRef.current = hostGain;
      hostDelayNodeRef.current.connect(hostGain);
      hostGain.connect(ctx.destination);
    }
  };

  const playBufferAtOffset = (offset = 0) => {
    const buffer = audioBufferRef.current;
    if (!buffer) return;

    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    const ctx = audioContextRef.current || new AudioCtxClass({ latencyHint: 'interactive', sampleRate: 48000 });
    audioContextRef.current = ctx;
    if (ctx.state === 'suspended') ctx.resume();

    ensureHostAudioNodes(ctx);

    // Explicitly unmute host speaker for local file playback
    laptopMutedRef.current = false;
    setLaptopMuted(false);
    if (hostGainNodeRef.current) {
      hostGainNodeRef.current.gain.setValueAtTime(1.0, ctx.currentTime);
    }

    if (bufferSourceNodeRef.current) {
      try {
        bufferSourceNodeRef.current.onended = null;
        bufferSourceNodeRef.current.stop();
        bufferSourceNodeRef.current.disconnect();
      } catch (e) {}
      bufferSourceNodeRef.current = null;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = isFileLoopingRef.current;

    // Route directly to WebRTC stream destination (for satellites)
    source.connect(streamDestRef.current);
    // Route to delayed host speaker pipeline (for host speakers to sync)
    source.connect(hostDelayNodeRef.current);
    // Route to visualizer
    source.connect(analyserRef.current);

    const safeOffset = Math.max(0, Math.min(buffer.duration - 0.05, offset));
    source.start(0, safeOffset);
    bufferSourceNodeRef.current = source;
    bufferPlaybackStartRef.current = ctx.currentTime - safeOffset;
    bufferPauseOffsetRef.current = safeOffset;
    setIsFilePlaying(true);

    source.onended = () => {
      if (!isFileLoopingRef.current) {
        setIsFilePlaying(false);
        bufferPauseOffsetRef.current = 0;
        setFileCurrentTime(0);
        if (fileProgressTimerRef.current) {
          clearInterval(fileProgressTimerRef.current);
          fileProgressTimerRef.current = null;
        }
      }
    };

    audioStreamRef.current = streamDestRef.current.stream;
    setIsBroadcasting(true);

    activeConnectionsRef.current.forEach((conn, peerId) => {
      callPeerWithStream(peerId, streamDestRef.current.stream);
      if (conn.open) {
        conn.send({ type: 'AUDIO_STARTED', title: activeMediaTitleRef.current });
      }
    });

    if (fileProgressTimerRef.current) clearInterval(fileProgressTimerRef.current);
    fileProgressTimerRef.current = setInterval(() => {
      if (!audioContextRef.current || !audioBufferRef.current) return;
      const cur = audioContextRef.current.currentTime - bufferPlaybackStartRef.current;
      const dur = audioBufferRef.current.duration;
      if (dur > 0) {
        setFileCurrentTime(isFileLoopingRef.current ? (cur % dur) : Math.min(dur, cur));
      }
    }, 200);
  };

  const pauseBufferPlayback = () => {
    if (bufferSourceNodeRef.current && audioContextRef.current) {
      const elapsed = audioContextRef.current.currentTime - bufferPlaybackStartRef.current;
      const dur = audioBufferRef.current?.duration || 1;
      bufferPauseOffsetRef.current = isFileLoopingRef.current ? (elapsed % dur) : Math.min(dur, elapsed);
      try {
        bufferSourceNodeRef.current.onended = null;
        bufferSourceNodeRef.current.stop();
        bufferSourceNodeRef.current.disconnect();
      } catch (e) {}
      bufferSourceNodeRef.current = null;
    }
    if (fileProgressTimerRef.current) {
      clearInterval(fileProgressTimerRef.current);
      fileProgressTimerRef.current = null;
    }
    setIsFilePlaying(false);
    activeConnectionsRef.current.forEach(conn => {
      if (conn.open) conn.send({ type: 'AUDIO_STOPPED' });
    });
  };

  const toggleFilePlayback = () => {
    if (isFilePlaying) {
      pauseBufferPlayback();
    } else {
      playBufferAtOffset(bufferPauseOffsetRef.current || 0);
    }
  };

  const restartFilePlayback = () => {
    bufferPauseOffsetRef.current = 0;
    setFileCurrentTime(0);
    playBufferAtOffset(0);
  };

  const toggleFileLoop = () => {
    const nextLoop = !isFileLooping;
    setIsFileLooping(nextLoop);
    isFileLoopingRef.current = nextLoop;
    if (bufferSourceNodeRef.current) {
      bufferSourceNodeRef.current.loop = nextLoop;
    }
  };

  const startScreenCapture = () => {
    // Show pre-flight interactive popup so user knows to check the "Share audio" box
    setShowScreenCaptureGuideModal(true);
  };

  const executeScreenCapture = async () => {
    setShowScreenCaptureGuideModal(false);
    setShowAudioMissingHelp(false);
    stopBroadcasting(false);
    pauseBufferPlayback();

    let mediaStream;
    try {
      // 1. First attempt: standard system audio capture constraints
      mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2
        },
        systemAudio: 'include',
        selfBrowserSurface: 'include',
        surfaceSwitching: 'include'
      });
    } catch (firstErr) {
      console.warn('[Host] Advanced getDisplayMedia constraints failed, trying universal fallback:', firstErr);
      try {
        // 2. Second attempt: broadest possible video+audio constraints (works on Android Chrome and all platforms)
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
          systemAudio: 'include'
        });
      } catch (secondErr) {
        console.warn('[Host] Screen capture cancelled or failed:', secondErr);
        return;
      }
    }

    if (!mediaStream) return;

    const audioTracks = mediaStream.getAudioTracks();
    if (audioTracks.length === 0) {
      // User forgot to check "Share system audio" / "Also share tab audio" in the browser popup
      mediaStream.getTracks().forEach(t => t.stop());
      setShowAudioMissingHelp(true);
      return;
    }

    setShowAudioMissingHelp(false);
    const title = mediaStream.getVideoTracks()[0]?.label || "System Audio Loopback";
    setActiveMediaTitle(title);
    activeMediaTitleRef.current = title;

    // CRITICAL: Set contentHint = 'music' on all audio tracks
    audioTracks.forEach(t => {
      if ('contentHint' in t) t.contentHint = 'music';
    });

    // CRITICAL FIX: Keep video track enabled=false instead of stopping it,
    // so Chrome does NOT kill the entire capture session!
    mediaStream.getVideoTracks().forEach(track => {
      track.enabled = false;
      track.onended = () => {
        console.log('[Host] Native screen capture ended by user');
        stopBroadcasting(false);
      };
    });

    displayMediaStreamRef.current = mediaStream;

    // Create audio-only stream for WebRTC broadcast & host delayed playback
    const audioOnlyStream = new MediaStream(audioTracks);

    setLaptopMuted(false);
    setupHostAudio(audioOnlyStream, false);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clean up previous broadcast & buffer
    stopBroadcasting(false);
    pauseBufferPlayback();

    setActiveMediaTitle(file.name);
    activeMediaTitleRef.current = file.name;
    setIsFileDecoding(true);

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      const ctx = audioContextRef.current || new AudioCtxClass({ latencyHint: 'interactive', sampleRate: 48000 });
      audioContextRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume();

      if (typeof navigator !== 'undefined' && 'audioSession' in navigator) {
        try { navigator.audioSession.type = 'playback'; } catch (err) {}
      }

      const arrayBuffer = await file.arrayBuffer();
      // Decode audio data reliably across all browsers (safely handles callback and promise API)
      const decodedBuffer = await new Promise((resolve, reject) => {
        ctx.decodeAudioData(arrayBuffer, resolve, reject);
      });

      audioBufferRef.current = decodedBuffer;
      setFileAudioBuffer(decodedBuffer);
      setFileDuration(decodedBuffer.duration);
      setFileCurrentTime(0);
      bufferPauseOffsetRef.current = 0;
      setIsFileDecoding(false);

      // Immediately play decoded audio through delayed host pipeline & broadcast
      setLaptopMuted(false);
      playBufferAtOffset(0);
    } catch (err) {
      console.error("[Host] Audio decoding failed:", err);
      setIsFileDecoding(false);
      alert("Failed to decode audio file. Please try another MP3, WAV, or AAC file.");
    }
  };

  const startMicCapture = async () => {
    stopBroadcasting(false);
    pauseBufferPlayback();

    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48000,
            channelCount: 2
          }
        });
      } catch (e) {
        // Fallback for mobile devices that do not support custom audio constraints
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      setActiveMediaTitle("Live Room Mic / DJ Line-in");
      activeMediaTitleRef.current = "Live Room Mic / DJ Line-in";
      setLaptopMuted(true); // Mute host to prevent acoustic feedback squeal
      setupHostAudio(stream, true);
    } catch (err) {
      console.error("[Host] Mic error:", err);
      alert("Microphone permission denied or unavailable on this device.");
    }
  };

  const startSynthGenerator = () => {
    stopBroadcasting(false);
    pauseBufferPlayback();

    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    const ctx = audioContextRef.current || new AudioCtxClass({ latencyHint: 'interactive', sampleRate: 48000 });
    audioContextRef.current = ctx;
    if (ctx.state === 'suspended') ctx.resume();

    ensureHostAudioNodes(ctx);
    const dest = streamDestRef.current;

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
      // Route directly to WebRTC broadcast stream destination (for satellites)
      gain.connect(dest);
      // Route directly to delayed host speaker pipeline (for host speakers to sync)
      gain.connect(hostDelayNodeRef.current);
      // Route to visualizer
      gain.connect(analyserRef.current);

      osc.start();
      osc.stop(ctx.currentTime + 0.24);
      step++;
    }, 240);

    const title = "Warm Analog Lofi Chords (Test Loop)";
    setActiveMediaTitle(title);
    activeMediaTitleRef.current = title;
    laptopMutedRef.current = false;
    setLaptopMuted(false);
    if (hostGainNodeRef.current && audioContextRef.current) {
      hostGainNodeRef.current.gain.setValueAtTime(1.0, audioContextRef.current.currentTime);
    }
    audioStreamRef.current = dest.stream;
    setIsBroadcasting(true);

    activeConnectionsRef.current.forEach((conn, peerId) => {
      callPeerWithStream(peerId, dest.stream);
      if (conn.open) {
        conn.send({ type: 'AUDIO_STARTED', title });
      }
    });
  };

  const setupHostAudio = (stream, isMic = false) => {
    setIsBroadcasting(true);

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

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      const ctx = audioContextRef.current || new AudioCtxClass({ latencyHint: 'interactive', sampleRate: 48000 });
      audioContextRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();

      // Build shared nodes (fresh every broadcast session since stopBroadcasting nulls them)
      ensureHostAudioNodes(ctx);

      if (hostSourceNodeRef.current) {
        try { hostSourceNodeRef.current.disconnect(); } catch (e) {}
      }

      const source = ctx.createMediaStreamSource(stream);
      hostSourceNodeRef.current = source;

      // Route to visualizer, delayed host speaker pipeline, AND the shared WebRTC
      // stream destination — same unified path used by file/synth sources.
      source.connect(analyserRef.current);
      source.connect(hostDelayNodeRef.current);
      source.connect(streamDestRef.current);

      laptopMutedRef.current = isMic;
      setLaptopMuted(isMic);
      if (hostGainNodeRef.current) {
        hostGainNodeRef.current.gain.setValueAtTime(isMic ? 0 : 1.0, ctx.currentTime);
      }
    } catch (e) {
      console.warn('[Host] Audio pipeline notice:', e);
    }

    // Broadcast the unified WebRTC stream destination output (not the raw mic/screen stream)
    const broadcastStream = streamDestRef.current ? streamDestRef.current.stream : stream;
    audioStreamRef.current = broadcastStream;

    console.log(`[Host] Broadcasting Studio Hi-Fi Opus audio stream to ${activeConnectionsRef.current.size} satellites`);
    activeConnectionsRef.current.forEach((conn, peerId) => {
      callPeerWithStream(peerId, broadcastStream);
      if (conn.open) {
        conn.send({ type: 'AUDIO_STARTED', title: activeMediaTitleRef.current });
      }
    });
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
    laptopMutedRef.current = nextMuted;
    if (hostGainNodeRef.current && audioContextRef.current) {
      hostGainNodeRef.current.gain.setValueAtTime(nextMuted ? 0 : 1.0, audioContextRef.current.currentTime);
    }
  };

  const hostDelayBroadcastTimer = useRef(null);

  const recalculateFleetSync = () => {
    const hostBtLag = hostOutputProfileRef.current === 'bluetooth' ? 200 : 0;
    const hostPhysicalLag = 20 + hostBtLag; // 20ms DAC + BT lag
    
    // Find the maximum physical latency across all satellites and host
    let maxLag = Math.max(hostPhysicalLag, 280); // 280ms baseline so phones have buffer
    satelliteLagsRef.current.forEach((info) => {
      if (info.physicalLagMs > maxLag) {
        maxLag = info.physicalLagMs;
      }
    });

    const targetMs = maxLag;
    setFleetTargetMs(targetMs);

    const newHostDelay = Math.max(0, targetMs - hostPhysicalLag);
    console.log(`[Host] Fleet Sync: Target=${targetMs}ms | Host Lag=${hostPhysicalLag}ms (${hostOutputProfileRef.current}) → Host Delay=${newHostDelay}ms across ${satelliteLagsRef.current.size} satellites`);

    setHostDelayMs(newHostDelay);
    hostDelayMsRef.current = newHostDelay;

    if (hostDelayNodeRef.current && audioContextRef.current) {
      try {
        const ctx = audioContextRef.current;
        const now = ctx.currentTime;
        hostDelayNodeRef.current.delayTime.cancelScheduledValues(now);
        hostDelayNodeRef.current.delayTime.setTargetAtTime(newHostDelay / 1000, now, 0.035);
      } catch (err) {
        try {
          hostDelayNodeRef.current.delayTime.value = newHostDelay / 1000;
        } catch (e) {}
      }
    }

    // Broadcast fleet target to ALL satellites so every device locks phase
    activeConnectionsRef.current.forEach((c) => {
      if (c.open) {
        c.send({
          type: 'FLEET_SYNC_TARGET',
          fleetTargetMs: targetMs,
          hostDelayMs: newHostDelay,
          hostOutputProfile: hostOutputProfileRef.current
        });
      }
    });
  };

  const handleHostProfileSelect = (profile) => {
    setHostOutputProfile(profile);
    hostOutputProfileRef.current = profile;
    recalculateFleetSync();
  };

  const handleDelayChange = (ms) => {
    const clamped = Math.max(0, Math.min(2000, ms));
    setHostDelayMs(clamped);
    hostDelayMsRef.current = clamped;

    if (hostDelayNodeRef.current && audioContextRef.current) {
      try {
        const ctx = audioContextRef.current;
        const now = ctx.currentTime;
        hostDelayNodeRef.current.delayTime.cancelScheduledValues(now);
        hostDelayNodeRef.current.delayTime.setTargetAtTime(clamped / 1000, now, 0.035);
        console.log(`[Host] Host delay updated smoothly to ${clamped}ms`);
      } catch (err) {
        try {
          hostDelayNodeRef.current.delayTime.value = clamped / 1000;
        } catch (e) {}
      }
    }

    // Debounced broadcast to satellites so they re-align (250ms debounce to avoid flooding during slider drag)
    if (hostDelayBroadcastTimer.current) clearTimeout(hostDelayBroadcastTimer.current);
    hostDelayBroadcastTimer.current = setTimeout(() => {
      activeConnectionsRef.current.forEach((c) => {
        if (c.open) {
          c.send({ type: 'HOST_DELAY_UPDATE', hostDelayMs: clamped });
        }
      });
    }, 250);
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
    if (bufferSourceNodeRef.current) {
      try {
        bufferSourceNodeRef.current.onended = null;
        bufferSourceNodeRef.current.stop();
        bufferSourceNodeRef.current.disconnect();
      } catch (e) {}
      bufferSourceNodeRef.current = null;
    }
    if (fileProgressTimerRef.current) {
      clearInterval(fileProgressTimerRef.current);
      fileProgressTimerRef.current = null;
    }
    setIsFilePlaying(false);
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = '';
    }

    // Only stop tracks on real media streams (mic/screen). NEVER stop WebAudio-synthesized
    // MediaStreamDestination tracks — those are virtual and cannot be restarted once stopped.
    if (audioStreamRef.current) {
      const isWebAudioDest = streamDestRef.current &&
        audioStreamRef.current === streamDestRef.current.stream;
      if (!isWebAudioDest) {
        audioStreamRef.current.getTracks().forEach(t => t.stop());
      }
      audioStreamRef.current = null;
    }
    if (displayMediaStreamRef.current) {
      displayMediaStreamRef.current.getTracks().forEach(t => t.stop());
      displayMediaStreamRef.current = null;
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
    // Null the WebRTC stream destination and analyser so ensureHostAudioNodes
    // always creates a fresh, live destination on the next broadcast session.
    if (streamDestRef.current) {
      try { streamDestRef.current.disconnect?.(); } catch (e) {}
      streamDestRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch (e) {}
      analyserRef.current = null;
    }

    activeMediaCallsRef.current.forEach(call => {
      try { call.close(); } catch (e) {}
    });
    activeMediaCallsRef.current.clear();

    activeConnectionsRef.current.forEach(conn => {
      if (conn.open) conn.send({ type: 'AUDIO_STOPPED' });
    });

    if (fullTeardown) {
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch (e) {}
        wakeLockRef.current = null;
      }
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
              onClick={() => {
                setSourceType('screen');
                startScreenCapture();
              }}
              className={`btn-analog ${sourceType === 'screen' && isBroadcasting ? 'btn-amber' : ''}`}
              style={{ padding: '14px', justifyContent: 'flex-start', position: 'relative' }}
            >
              <Monitor size={18} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  System & Screen Audio
                  <span className="paper-badge" style={{ fontSize: '9px', padding: '1px 5px', color: 'var(--amber-bright)' }}>
                    SPOTIFY / TABS
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'rgba(244, 239, 230, 0.7)' }}>
                  Capture system sound, Spotify, movies & tabs
                </div>
              </div>
            </button>

            <label 
              className={`btn-analog ${sourceType === 'file' && (isBroadcasting || audioBufferRef.current) ? 'btn-amber' : ''}`}
              style={{ padding: '14px', justifyContent: 'flex-start', cursor: 'pointer' }}
            >
              <Music size={18} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  Local Audio / Music File
                  {isMobile && (
                    <span className="paper-badge" style={{ fontSize: '9px', padding: '1px 5px', color: '#10b981' }}>
                      RECOMMENDED
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>MP3, WAV, M4A, FLAC, AAC</div>
              </div>
              <input 
                type="file" 
                accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg" 
                onChange={(e) => { setSourceType('file'); handleFileUpload(e); }} 
                style={{ display: 'none' }} 
              />
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

          {/* DEDICATED TAPE DECK MUSIC PLAYER (When audio file is loaded or decoding) */}
          {sourceType === 'file' && (
            <div className="analog-inset" style={{ 
              padding: '16px', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '12px',
              border: '1px solid var(--amber-glow)',
              background: '#0d1218'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileAudio size={16} color="var(--amber-bright)" />
                  <strong style={{ fontSize: '13px', color: 'var(--text-cream)' }}>
                    {activeMediaTitleRef.current !== 'No audio source selected' ? activeMediaTitleRef.current : 'No audio file selected yet'}
                  </strong>
                </div>

                <label className="btn-analog" style={{ padding: '5px 10px', fontSize: '11px', cursor: 'pointer' }}>
                  <span>📂 Choose Another File</span>
                  <input 
                    type="file" 
                    accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg" 
                    onChange={(e) => { handleFileUpload(e); }} 
                    style={{ display: 'none' }} 
                  />
                </label>
              </div>

              {isFileDecoding ? (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  gap: '8px', 
                  padding: '12px', 
                  fontSize: '12px', 
                  color: 'var(--amber-bright)',
                  fontFamily: 'monospace' 
                }}>
                  <RefreshCw size={14} className="spin-slow" />
                  <span>DECODING PCM AUDIO INTO MEMORY (ZERO-BUFFER STREAMING)...</span>
                </div>
              ) : fileAudioBuffer ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {/* Timeline Bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className="font-mono" style={{ fontSize: '11px', color: 'var(--amber-bright)', minWidth: '40px' }}>
                      {(() => {
                        const m = Math.floor(fileCurrentTime / 60);
                        const s = Math.floor(fileCurrentTime % 60);
                        return `${m}:${s < 10 ? '0' : ''}${s}`;
                      })()}
                    </span>

                    <div style={{ 
                      flex: 1, 
                      height: '6px', 
                      background: 'rgba(255,255,255,0.1)', 
                      borderRadius: '3px', 
                      overflow: 'hidden',
                      position: 'relative'
                    }}>
                      <div style={{ 
                        width: `${fileDuration > 0 ? (fileCurrentTime / fileDuration) * 100 : 0}%`, 
                        height: '100%', 
                        background: 'var(--amber-bright)',
                        transition: 'width 0.2s linear'
                      }} />
                    </div>

                    <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '40px' }}>
                      {(() => {
                        const m = Math.floor(fileDuration / 60);
                        const s = Math.floor(fileDuration % 60);
                        return `${m}:${s < 10 ? '0' : ''}${s}`;
                      })()}
                    </span>
                  </div>

                  {/* Playback Transport Buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button 
                      onClick={toggleFilePlayback}
                      className="btn-analog btn-amber"
                      style={{ padding: '8px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      {isFilePlaying ? <Pause size={14} /> : <Play size={14} />}
                      <span>{isFilePlaying ? 'Pause Broadcast' : 'Resume Broadcast'}</span>
                    </button>

                    <button 
                      onClick={restartFilePlayback}
                      className="btn-analog"
                      style={{ padding: '8px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      title="Restart track from beginning"
                    >
                      <RotateCcw size={14} />
                      <span>Restart</span>
                    </button>

                    <button 
                      onClick={toggleFileLoop}
                      className={`btn-analog ${isFileLooping ? 'btn-amber' : ''}`}
                      style={{ padding: '8px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      title="Toggle auto-looping"
                    >
                      <Repeat size={14} />
                      <span>{isFileLooping ? 'Loop: ON' : 'Loop: OFF'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '10px', fontSize: '12px', color: 'var(--text-dim)' }}>
                  Tap "Local Audio / Music File" or click above to pick an MP3/WAV/FLAC track from your device.
                </div>
              )}
            </div>
          )}
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

          {/* Host Hardware Output Profile: Laptop Speakers vs Bluetooth Speaker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                HOST AUDIO OUTPUT HARDWARE (LAPTOP / BLE SPEAKER):
              </span>
              <span className="paper-badge" style={{ fontSize: '10px', padding: '2px 6px', color: hostOutputProfile === 'bluetooth' ? 'var(--amber-bright)' : '#10b981' }}>
                {hostOutputProfile === 'bluetooth' ? 'BLUETOOTH / BLE (+200MS BUFFER)' : 'INTERNAL / WIRED (0MS)'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              <button
                onClick={() => handleHostProfileSelect('internal')}
                className={`btn-analog ${hostOutputProfile === 'internal' ? 'btn-amber' : ''}`}
                style={{ padding: '8px', fontSize: '11px', justifyContent: 'center' }}
              >
                💻 Laptop Speakers (0ms)
              </button>
              <button
                onClick={() => handleHostProfileSelect('bluetooth')}
                className={`btn-analog ${hostOutputProfile === 'bluetooth' ? 'btn-amber' : ''}`}
                style={{ padding: '8px', fontSize: '11px', justifyContent: 'center' }}
              >
                🔊 Laptop BLE/BT (+200ms)
              </button>
              <button
                onClick={() => handleHostProfileSelect('aux')}
                className={`btn-analog ${hostOutputProfile === 'aux' ? 'btn-amber' : ''}`}
                style={{ padding: '8px', fontSize: '11px', justifyContent: 'center' }}
              >
                🔌 AUX Cable (0ms)
              </button>
            </div>
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
              <button 
                onClick={() => { setShowAudioMissingHelp(false); executeScreenCapture(); }} 
                className="btn-analog btn-amber" 
                style={{ flex: 1, padding: '12px', fontSize: '13px' }}
              >
                🔄 Re-Open Popup (Check "Share Audio" box)
              </button>

              <button 
                onClick={() => { setShowAudioMissingHelp(false); setSourceType('synth'); startSynthGenerator(); }} 
                className="btn-analog" 
                style={{ padding: '12px', fontSize: '13px' }}
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

      {/* Interactive System Audio Capture Guidance Modal */}
      {showScreenCaptureGuideModal && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.88)',
            backdropFilter: 'blur(10px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
          onClick={() => setShowScreenCaptureGuideModal(false)}
        >
          <div 
            className="analog-deck" 
            style={{ 
              maxWidth: '520px', 
              width: '100%', 
              padding: '24px', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '16px',
              border: '1px solid var(--amber-bright)',
              boxShadow: '0 0 45px var(--amber-glow)',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid var(--amber-bright)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--amber-bright)',
                boxShadow: '0 0 15px var(--amber-glow)'
              }}>
                <Volume2 size={22} />
              </div>
              <div>
                <h3 className="font-serif" style={{ fontSize: '19px', fontWeight: '800', color: 'var(--text-cream)' }}>
                  System Audio Capture Setup
                </h3>
                <span className="font-mono" style={{ fontSize: '10px', color: 'var(--amber-bright)', letterSpacing: '1px' }}>
                  STEP-BY-STEP POPUP INSTRUCTIONS
                </span>
              </div>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              To stream music from Spotify, YouTube, games, or movies to all connected phones, the browser will ask you what to capture:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: '#0e141a', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-deck)' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <span style={{ background: 'var(--amber-core)', color: '#0c0b0a', borderRadius: '6px', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '11px', flexShrink: 0 }}>1</span>
                <div style={{ fontSize: '12px', color: 'var(--text-cream)', lineHeight: '1.4' }}>
                  <strong>Pick Your Sound Source in the Browser Popup:</strong>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    • For <em>Spotify desktop app, games & system sound</em>: Select <strong>"Entire Screen"</strong>.<br />
                    • For <em>YouTube, Web Spotify or Netflix tab</em>: Select <strong>"Chrome Tab"</strong>.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(245, 158, 11, 0.08)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                <span style={{ background: '#ef4444', color: '#fff', borderRadius: '6px', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '11px', flexShrink: 0 }}>2</span>
                <div style={{ fontSize: '12px', color: 'var(--amber-bright)', lineHeight: '1.4' }}>
                  <strong>⚠️ CRITICAL — TURN ON THE AUDIO CHECKBOX:</strong>
                  <div style={{ fontSize: '11px', color: 'var(--text-cream)', marginTop: '2px' }}>
                    Check the box: <strong>"Share system audio"</strong> or <strong>"Also share tab audio"</strong> at the bottom left!<br />
                    <em>(On Android phones: select "Entire screen" and choose "Device audio").</em><br />
                    If left unchecked, the browser captures silent video only.
                  </div>
                  {isMobile && /iPhone|iPad|iPod/i.test(navigator.userAgent) && (
                    <div style={{ fontSize: '11px', color: '#f87171', marginTop: '6px', padding: '6px 8px', background: 'rgba(239, 68, 68, 0.15)', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                      ⚠️ <strong>iOS Notice:</strong> Apple iOS blocks system audio capture in Safari. To host from an iPhone or iPad, use <strong>"Local Audio / Music File"</strong> or <strong>"Analog Lofi Groove"</strong>.
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <span style={{ background: 'var(--amber-core)', color: '#0c0b0a', borderRadius: '6px', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '11px', flexShrink: 0 }}>3</span>
                <div style={{ fontSize: '12px', color: 'var(--text-cream)', lineHeight: '1.4' }}>
                  <strong>Click "Share":</strong>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    PartySync automatically strips the video feed and broadcasts pure 192kbps stereo Opus to all phones in sync!
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button 
                onClick={executeScreenCapture}
                className="btn-analog btn-amber" 
                style={{ flex: 1, padding: '14px', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <Zap size={18} />
                <span>Open Audio Capture Popup</span>
              </button>

              <button 
                onClick={() => setShowScreenCaptureGuideModal(false)} 
                className="btn-analog" 
                style={{ padding: '14px 18px', fontSize: '13px' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
