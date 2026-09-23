import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import { 
  Speaker, Sliders, Volume2, Maximize, Smartphone, 
  CheckCircle2, Radio, Zap, AlertTriangle, ShieldCheck, Power,
  Clock, Music, Bluetooth, Headphones, Cable, RefreshCw, Mic, Target
} from 'lucide-react';
import { audioProcessor } from '../utils/audio';
import { clockSync } from '../utils/clockSync';
import { acousticCalibrator } from '../utils/acousticCalibrate';
import Visualizer from './Visualizer';

export default function ReceiverView({ initialRoomId = '', onBack }) {
  const [roomId, setRoomId] = useState(initialRoomId);
  const [deviceName, setDeviceName] = useState('Satellite Speaker');
  const [isConnected, setIsConnected] = useState(false);
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [delayMs, setDelayMs] = useState(0);
  const [hardwareProfile, setHardwareProfile] = useState('phone'); // 'phone' | 'bt_speaker' | 'bt_headphones' | 'aux'
  const [volume, setVolume] = useState(1.0);
  const [statusText, setStatusText] = useState('Receiver Standby');
  const [isFullscreenVisualizer, setIsFullscreenVisualizer] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [clockInfo, setClockInfo] = useState({ isSynced: false, rtt: 0, offset: 0 });
  const [autoSyncStatus, setAutoSyncStatus] = useState(null); // null | 'calibrating' | 'done' | 'error'
  const [autoSyncMsg, setAutoSyncMsg] = useState('');

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const wakeLockRef = useRef(null);
  const audioElRef = useRef(null);
  const webrtcStreamRef = useRef(null);

  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('[Receiver] Screen Wake Lock active');
      }
    } catch (e) {
      console.warn('[Receiver] Wake lock unavailable:', e);
    }
  };

  useEffect(() => {
    if (initialRoomId) {
      setRoomId(initialRoomId);
    }

    clockSync.onSyncChange = (info) => {
      setClockInfo(info);
    };

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        if (audioProcessor.ctx && audioProcessor.ctx.state === 'suspended') {
          try { await audioProcessor.ctx.resume(); } catch (e) {}
        }
        if (wakeLockRef.current === null && isConnected) {
          requestWakeLock();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      disconnect();
    };
  }, [initialRoomId, isConnected]);

  const triggerVisualFlash = () => {
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 80);
  };

  const connectToHost = () => {
    const cleanRoom = roomId.trim();
    if (!cleanRoom) {
      alert('Please enter a valid Session Code (e.g. 4821)!');
      return;
    }

    const targetRoomId = cleanRoom.toUpperCase().startsWith('SESSION-')
      ? cleanRoom.toUpperCase()
      : `SESSION-${cleanRoom.replace(/[^0-9A-Za-z]/g, '')}`;

    setStatusText('Tuning into session...');
    audioProcessor.init();

    const receiverPeerId = 'CLIENT-' + Math.random().toString(36).substring(2, 9);
    const peer = new Peer(receiverPeerId, {
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
      console.log('[Receiver] Connected to peer mesh:', id);
      setStatusText('Synchronizing Master Clock with Host...');

      const conn = peer.connect(targetRoomId, {
        metadata: { name: deviceName }
      });

      conn.on('open', () => {
        setIsConnected(true);
        setStatusText('Tuned In • Calibrating Precision Clock');
        requestWakeLock();

        // High-precision clock calibration burst on handshake
        clockSync.startCalibration(conn);
      });

      conn.on('data', (data) => {
        if (data.type === 'WELCOME') {
          console.log('[Receiver] Host media title:', data.title);
          if (data.isAudioActive) {
            setStatusText('Host broadcasting • Connecting audio...');
          } else {
            setStatusText('● Tuned In • Waiting for Host to select audio');
          }
        } else if (data.type === 'AUDIO_STARTED') {
          setStatusText('● Host started audio • Connecting...');
        } else if (data.type === 'AUDIO_STOPPED') {
          setIsAudioActive(false);
          setStatusText('● Host paused audio feed');
        } else if (data.type === 'NTP_PONG') {
          // Process high-resolution master clock synchronization response
          clockSync.handlePong(data);
        } else if (data.type === 'SYNC_CLAPPER') {
          // Fire scheduled acoustic tick & visual flash at exact microsecond
          clockSync.playScheduledPulse(audioProcessor.ctx, data.targetMasterTime, triggerVisualFlash);
        } else if (data.type === 'CALIBRATE_SCHEDULED') {
          runAcousticCalibration(data.targetMasterTime);
        } else if (data.type === 'START_CALIBRATE_CLIENT') {
          startAutoSync();
        } else if (data.type === 'CALIBRATE_ERROR') {
          setAutoSyncStatus('error');
          setAutoSyncMsg(data.message || 'Calibration aborted by host.');
        }
      });

      conn.on('close', () => {
        setIsConnected(false);
        setIsAudioActive(false);
        setStatusText('Host Transmitter Offline');
      });

      connRef.current = conn;
    });

    peer.on('call', (call) => {
      console.log('[Receiver] Answering audio pipe with Studio Hi-Fi Opus...');
      call.answer();

      call.on('stream', (remoteAudioStream) => {
        console.log('[Receiver] Received remote audio stream track:', remoteAudioStream.getAudioTracks().length);
        
        // Route audio through Web Audio API with soft-knee limiter and delay
        audioProcessor.setupStream(remoteAudioStream);
        webrtcStreamRef.current = remoteAudioStream; // Store for acoustic auto-sync mic calibration

        // CRITICAL FIX FOR AUDIO DISTORTION:
        // The hidden <audio> element is muted so it does NOT play simultaneously with Web Audio!
        // Playing both simultaneously caused massive phase distortion, comb filtering, and clipping.
        if (audioElRef.current) {
          audioElRef.current.srcObject = remoteAudioStream;
          audioElRef.current.muted = true;
          audioElRef.current.play().catch(e => console.log('Audio element play notice:', e));
        }

        setIsAudioActive(true);
        setStatusText('● Live Synchronized Studio Playout');
      });

      call.on('close', () => {
        setIsAudioActive(false);
        setStatusText('Audio Feed Stopped');
      });
    });

    peer.on('error', (err) => {
      console.error('[Receiver] Peer error:', err);
      if (err.type === 'peer-unavailable') {
        setStatusText(`⚠️ Host ${targetRoomId.replace('SESSION-', '#')} not found. Verify code or make sure Host is open!`);
      } else {
        setStatusText('Station connection failed. Verify session code.');
      }
      setIsConnected(false);
    });

    peerRef.current = peer;
  };

  const handleProfileSelect = (profile) => {
    setHardwareProfile(profile);
    let offset = 0;
    if (profile === 'bt_speaker') {
      offset = 180; // Standard Bluetooth speaker SBC/AAC buffer latency compensation
    } else if (profile === 'bt_headphones') {
      offset = 120; // Bluetooth earbud latency compensation
    } else if (profile === 'phone' || profile === 'aux') {
      offset = 0;
    }
    setDelayMs(offset);
    audioProcessor.setDelay(offset);
  };

  const handleNudgeChange = (ms) => {
    setDelayMs(ms);
    audioProcessor.setDelay(ms);
  };

  const handleVolumeChange = (vol) => {
    setVolume(vol);
    audioProcessor.setVolume(vol);
  };

  const recalibrateClock = () => {
    if (connRef.current && connRef.current.open) {
      clockSync.startCalibration(connRef.current);
    }
  };

  const startAutoSync = () => {
    if (!connRef.current || !connRef.current.open) {
      setAutoSyncStatus('error');
      setAutoSyncMsg('Not connected to Host. Please join session first.');
      return;
    }
    audioProcessor.init();
    if (audioProcessor.ctx && audioProcessor.ctx.state === 'suspended') {
      audioProcessor.ctx.resume();
    }
    setAutoSyncStatus('calibrating');
    setAutoSyncMsg('Requesting acoustic calibration pulse from Host...');
    connRef.current.send({ type: 'CALIBRATE_REQUEST' });
  };

  const runAcousticCalibration = (targetMasterTime) => {
    audioProcessor.init();
    const ctx = audioProcessor.ctx;
    if (!ctx) {
      setAutoSyncStatus('error');
      setAutoSyncMsg('Web Audio context unavailable.');
      return;
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const prevVol = volume;
    // Duck volume during calibration so the two calibration tones stand out
    audioProcessor.setVolume(prevVol * 0.15);

    acousticCalibrator.runReceiverCalibration({
      audioCtx: ctx,
      receiverPlaybackNode: audioProcessor.delayNode || audioProcessor.gainNode,
      targetMasterTime,
      clockSyncInstance: clockSync,
      onProgress: (msg) => {
        setAutoSyncMsg(msg);
      },
      onSuccess: (result) => {
        audioProcessor.setVolume(prevVol);
        const currentDelay = delayMs;
        // errorMs > 0 means Phone was heard too late -> reduce phone delay
        // errorMs < 0 means Phone was heard too early -> increase phone delay
        const newDelay = Math.max(-90, Math.min(350, Math.round(currentDelay - result.errorMs)));
        setDelayMs(newDelay);
        audioProcessor.setDelay(newDelay);
        setAutoSyncStatus('done');
        setAutoSyncMsg(`✅ Phase Locked! Offset: ${result.errorMs > 0 ? '+' : ''}${result.errorMs}ms compensated. New delay: ${newDelay}ms.`);
        triggerVisualFlash();
      },
      onError: (errMsg) => {
        audioProcessor.setVolume(prevVol);
        setAutoSyncStatus('error');
        setAutoSyncMsg(errMsg);
      }
    });
  };

  const disconnect = () => {
    if (connRef.current) connRef.current.close();
    if (peerRef.current) peerRef.current.destroy();
    audioProcessor.disconnect();
    if (wakeLockRef.current) wakeLockRef.current.release();
    setIsConnected(false);
    setIsAudioActive(false);
    setStatusText('Receiver Standby');
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      
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
          borderColor: isFlashing ? 'var(--accent-bright)' : 'var(--border-deck)',
          boxShadow: isFlashing ? '0 0 35px var(--accent-bright)' : '0 20px 48px -12px rgba(0, 0, 0, 0.85)'
        }}
      >
        {/* Chassis Corner Rivets */}
        <div className="corner-rivet rivet-tl" />
        <div className="corner-rivet rivet-tr" />
        <div className="corner-rivet rivet-bl" />
        <div className="corner-rivet rivet-br" />
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ 
                width: '10px', 
                height: '10px', 
                borderRadius: '50%', 
                background: isAudioActive ? 'var(--accent-bright)' : '#344a60',
                boxShadow: isAudioActive ? '0 0 10px var(--accent-core)' : 'none'
              }} />
              <span className="font-mono" style={{ fontSize: '11px', letterSpacing: '1.5px', color: isAudioActive ? 'var(--accent-bright)' : 'var(--text-dim)' }}>
                {isAudioActive ? 'STUDIO FEED ACTIVE' : 'RECEIVER STANDBY'}
              </span>
            </div>
            <h1 className="font-serif" style={{ fontSize: '24px', fontWeight: '700', marginTop: '2px' }}>
              Satellite Speaker
            </h1>
          </div>

          <button onClick={onBack} className="btn-analog" style={{ fontSize: '12px', padding: '6px 14px' }}>
            Switch Mode
          </button>
        </div>

        {!isConnected ? (
          /* Connect Deck */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="analog-inset" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>SESSION / ROOM CODE:</label>
                <input 
                  type="text" 
                  placeholder="e.g. 4821 or SESSION-4821" 
                  value={roomId} 
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="font-mono"
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: '#0c1117',
                    border: '1px solid var(--border-deck)',
                    borderRadius: '10px',
                    color: 'var(--accent-bright)',
                    fontSize: '18px',
                    fontWeight: '700',
                    letterSpacing: '2px',
                    textAlign: 'center'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>SPEAKER NAME / LOCATION:</label>
                <input 
                  type="text" 
                  placeholder="e.g. Living Room, JBL Flip, Kitchen Phone" 
                  value={deviceName} 
                  onChange={(e) => setDeviceName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    background: '#0c1117',
                    border: '1px solid var(--border-deck)',
                    borderRadius: '10px',
                    color: 'var(--text-cream)',
                    fontSize: '14px'
                  }}
                />
              </div>
            </div>

            <button onClick={connectToHost} className="btn-analog btn-amber" style={{ padding: '16px', fontSize: '15px' }}>
              <Power size={18} />
              🔊 Activate Speaker & Join Party
            </button>

            <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
              {statusText}
            </div>
          </div>
        ) : (
          /* Active Speaker Deck */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Live Wi-Fi Mesh & Precision Clock Telemetry Banner */}
            <div style={{
              padding: '14px 16px',
              borderRadius: '12px',
              background: isAudioActive ? 'rgba(16, 185, 129, 0.12)' : 'rgba(6, 182, 212, 0.1)',
              border: `1px solid ${isAudioActive ? 'rgba(16, 185, 129, 0.4)' : 'rgba(6, 182, 212, 0.25)'}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: isAudioActive ? '#10b981' : 'var(--accent-core)',
                    boxShadow: isAudioActive ? '0 0 8px #10b981' : '0 0 8px var(--accent-glow)'
                  }} />
                  <strong className="font-mono" style={{ fontSize: '12px', color: isAudioActive ? '#10b981' : 'var(--accent-bright)' }}>
                    {isAudioActive ? '256KBPS STUDIO HI-FI STREAMING' : 'LINKED TO HOST CLOCK'}
                  </strong>
                </div>

                <button onClick={disconnect} className="btn-analog" style={{ fontSize: '11px', padding: '4px 10px' }}>
                  Cut Link
                </button>
              </div>

              {/* Nanosecond Master Clock Telemetry */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                <span>
                  ⚡ Master Clock: {clockInfo.isSynced ? <span style={{ color: '#10b981' }}>Locked (RTT: {clockInfo.rtt}ms, Drift: {clockInfo.offset.toFixed(1)}ms)</span> : 'Calibrating...'}
                </span>
                <button onClick={recalibrateClock} className="btn-analog" style={{ padding: '2px 6px', fontSize: '10px' }}>
                  <RefreshCw size={10} /> Re-Sync
                </button>
              </div>
            </div>

            {/* TRANSMISSION TARGET HARDWARE PROFILES (BLUETOOTH LATENCY SOLVER) */}
            <div className="analog-inset" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.8px' }}>
                  SPEAKER HARDWARE PROFILE:
                </span>
                <span className="paper-badge" style={{ fontSize: '10px', padding: '2px 6px' }}>
                  {hardwareProfile === 'bt_speaker' ? 'BLUETOOTH (+180MS)' : hardwareProfile === 'bt_headphones' ? 'EARBUDS (+120MS)' : 'ZERO-BUFFER (0MS)'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
                <button
                  onClick={() => handleProfileSelect('phone')}
                  className="btn-analog"
                  style={{
                    padding: '10px 8px',
                    flexDirection: 'column',
                    gap: '4px',
                    background: hardwareProfile === 'phone' ? 'var(--accent-core)' : '#121d28',
                    color: hardwareProfile === 'phone' ? '#0f1419' : 'var(--text-cream)',
                    borderColor: hardwareProfile === 'phone' ? 'var(--accent-bright)' : 'var(--border-deck)'
                  }}
                >
                  <Smartphone size={16} />
                  <strong style={{ fontSize: '11px' }}>Phone Speaker</strong>
                  <span style={{ fontSize: '9px', opacity: 0.8 }}>Internal (0ms)</span>
                </button>

                <button
                  onClick={() => handleProfileSelect('bt_speaker')}
                  className="btn-analog"
                  style={{
                    padding: '10px 8px',
                    flexDirection: 'column',
                    gap: '4px',
                    background: hardwareProfile === 'bt_speaker' ? 'var(--accent-core)' : '#121d28',
                    color: hardwareProfile === 'bt_speaker' ? '#0f1419' : 'var(--text-cream)',
                    borderColor: hardwareProfile === 'bt_speaker' ? 'var(--accent-bright)' : 'var(--border-deck)'
                  }}
                >
                  <Bluetooth size={16} />
                  <strong style={{ fontSize: '11px' }}>BT Speaker</strong>
                  <span style={{ fontSize: '9px', opacity: 0.8 }}>JBL/Bose (+180ms)</span>
                </button>

                <button
                  onClick={() => handleProfileSelect('bt_headphones')}
                  className="btn-analog"
                  style={{
                    padding: '10px 8px',
                    flexDirection: 'column',
                    gap: '4px',
                    background: hardwareProfile === 'bt_headphones' ? 'var(--accent-core)' : '#121d28',
                    color: hardwareProfile === 'bt_headphones' ? '#0f1419' : 'var(--text-cream)',
                    borderColor: hardwareProfile === 'bt_headphones' ? 'var(--accent-bright)' : 'var(--border-deck)'
                  }}
                >
                  <Headphones size={16} />
                  <strong style={{ fontSize: '11px' }}>Earbuds</strong>
                  <span style={{ fontSize: '9px', opacity: 0.8 }}>AirPods (+120ms)</span>
                </button>

                <button
                  onClick={() => handleProfileSelect('aux')}
                  className="btn-analog"
                  style={{
                    padding: '10px 8px',
                    flexDirection: 'column',
                    gap: '4px',
                    background: hardwareProfile === 'aux' ? 'var(--accent-core)' : '#121d28',
                    color: hardwareProfile === 'aux' ? '#0f1419' : 'var(--text-cream)',
                    borderColor: hardwareProfile === 'aux' ? 'var(--accent-bright)' : 'var(--border-deck)'
                  }}
                >
                  <Cable size={16} />
                  <strong style={{ fontSize: '11px' }}>AUX Cable</strong>
                  <span style={{ fontSize: '9px', opacity: 0.8 }}>Wired Jack (0ms)</span>
                </button>
              </div>
            </div>

            {/* 1-TAP AUTOMATED ACOUSTIC SYNC (MIC CALIBRATION) */}
            <div className="analog-inset" style={{ 
              padding: '18px', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '12px',
              border: autoSyncStatus === 'calibrating' 
                ? '1px solid var(--accent-bright)' 
                : autoSyncStatus === 'done' 
                ? '1px solid #10b981' 
                : autoSyncStatus === 'error'
                ? '1px solid #ef4444'
                : '1px solid var(--border-deck)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Mic size={16} color="var(--accent-bright)" />
                  <strong className="font-mono" style={{ fontSize: '12px', color: 'var(--accent-bright)', letterSpacing: '0.8px' }}>
                    AUTOMATED ACOUSTIC AUTO-SYNC
                  </strong>
                </div>
                <span className="paper-badge" style={{ 
                  fontSize: '10px', 
                  padding: '2px 8px',
                  color: autoSyncStatus === 'done' ? '#10b981' : autoSyncStatus === 'error' ? '#ef4444' : 'var(--accent-bright)'
                }}>
                  {autoSyncStatus === 'calibrating' ? 'CALIBRATING...' : autoSyncStatus === 'done' ? '● LOCKED' : 'MIC-POWERED'}
                </span>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Hold your phone's speaker close to the host laptop speaker, then tap Calibrate. The phone microphone listens to the arrival times and locks phase alignment automatically.
              </p>

              {autoSyncMsg && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  background: autoSyncStatus === 'error' ? 'rgba(239, 68, 68, 0.15)' : autoSyncStatus === 'done' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(6, 182, 212, 0.15)',
                  border: `1px solid ${autoSyncStatus === 'error' ? '#ef4444' : autoSyncStatus === 'done' ? '#10b981' : 'var(--accent-core)'}`,
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: autoSyncStatus === 'error' ? '#fca5a5' : autoSyncStatus === 'done' ? '#6ee7b7' : 'var(--accent-bright)'
                }}>
                  {autoSyncMsg}
                </div>
              )}

              <button 
                onClick={startAutoSync} 
                disabled={autoSyncStatus === 'calibrating'}
                className="btn-analog btn-amber" 
                style={{ 
                  padding: '14px', 
                  fontSize: '14px',
                  opacity: autoSyncStatus === 'calibrating' ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <Target size={18} />
                {autoSyncStatus === 'calibrating' ? 'Listening & Calibrating...' : '🎯 Auto-Calibrate (Mic Sync)'}
              </button>
            </div>

            {/* PRECISION ACOUSTIC NUDGE CALIBRATION */}
            <div className="analog-inset" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Clock size={14} color="var(--accent-bright)" />
                    Minute Manual Fine-Tuning:
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    Compensates for speaker processing and physical room distance
                  </div>
                </div>
                <span className="font-mono paper-badge" style={{ padding: '3px 8px', fontSize: '12px', color: delayMs === 0 ? '#10b981' : 'var(--amber-bright)' }}>
                  {delayMs === 0 ? '0ms (Locked)' : `${delayMs > 0 ? '+' : ''}${delayMs}ms`}
                </span>
              </div>

              <input 
                type="range" 
                min="-90" 
                max="350" 
                step="5"
                value={delayMs} 
                onChange={(e) => handleNudgeChange(parseInt(e.target.value))} 
              />

              {/* Stepped Coarse/Fine Alignment Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px' }}>
                {[
                  { label: '-50ms', val: delayMs - 50 },
                  { label: '-10ms', val: delayMs - 10 },
                  { label: '0ms Reset', val: 0 },
                  { label: '+10ms', val: delayMs + 10 },
                  { label: '+50ms', val: delayMs + 50 },
                  { label: '+180ms BT', val: 180 },
                ].map(b => (
                  <button
                    key={b.label}
                    onClick={() => handleNudgeChange(Math.max(-90, Math.min(350, b.val)))}
                    className="btn-analog"
                    style={{
                      padding: '6px 2px',
                      fontSize: '10px',
                      fontFamily: 'monospace'
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                <span>Faster (-90ms)</span>
                <span style={{ color: 'var(--accent-bright)' }}>Phase Synchronized</span>
                <span>Bluetooth Delay (+350ms)</span>
              </div>
            </div>

            {/* Volume Potentiometer */}
            <div className="analog-inset" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>OUTPUT LEVEL:</span>
                <span className="font-mono" style={{ fontSize: '12px', color: 'var(--accent-bright)' }}>{Math.round(volume * 100)}%</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="1.5" 
                step="0.05" 
                value={volume} 
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))} 
              />
            </div>

            {/* Lofi Analog VU Meter */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="font-mono" style={{ fontSize: '10px', color: 'var(--accent-bright)', letterSpacing: '1px' }}>
                  ● ANALOG LEVEL MONITOR
                </span>
                <button 
                  onClick={() => setIsFullscreenVisualizer(!isFullscreenVisualizer)}
                  className="btn-analog" 
                  style={{ padding: '3px 8px', fontSize: '10px' }}
                >
                  <Maximize size={10} />
                  {isFullscreenVisualizer ? 'Compact' : 'Expanded View'}
                </button>
              </div>

              <Visualizer 
                analyser={audioProcessor.analyserNode} 
                active={isAudioActive} 
                height={isFullscreenVisualizer ? 200 : 64} 
              />
            </div>

          </div>
        )}

      </div>
      
      {/* Hidden Muted Audio Element to Keep Mobile Browser Audio Session Active */}
      <audio ref={audioElRef} autoPlay playsInline muted style={{ display: 'none' }} />
    </div>
  );
}
