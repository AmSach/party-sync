import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import { 
  Speaker, Sliders, Volume2, Maximize, Smartphone, 
  CheckCircle2, Radio, Zap, AlertTriangle, ShieldCheck, Power,
  Clock, Music, Bluetooth, Headphones, Cable, RefreshCw, Mic, Target
} from 'lucide-react';
import { audioProcessor } from '../utils/audio';
import { clockSync } from '../utils/clockSync';
import { configureHighFidelityAudioSDP } from '../utils/sdp';
import Visualizer from './Visualizer';

export default function ReceiverView({ initialRoomId = '', onBack }) {
  const [roomId, setRoomId] = useState(initialRoomId);
  const [deviceName, setDeviceName] = useState('Satellite Speaker');
  const [isConnected, setIsConnected] = useState(false);
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [delayMs, setDelayMs] = useState(0);
  const [fineTuneMs, setFineTuneMs] = useState(0);
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
  const webrtcStreamRef = useRef(null);
  const activeCallRef = useRef(null);
  const fineTuneMsRef = useRef(0);
  const hardwareProfileRef = useRef('phone');
  const myPhysicalLagRef = useRef(90);
  const fleetTargetLagRef = useRef(300);
  const syncKeeperIntervalRef = useRef(null);

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

  const isConnectedRef = useRef(false);
  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    if (initialRoomId) {
      setRoomId(initialRoomId);
    }
  }, [initialRoomId]);

  useEffect(() => {
    clockSync.onSyncChange = (info) => {
      setClockInfo(info);
    };

    const unlockAudio = () => {
      if (audioProcessor.ctx && audioProcessor.ctx.state === 'suspended') {
        audioProcessor.ctx.resume().catch(() => {});
      }
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        if (audioProcessor.ctx && audioProcessor.ctx.state === 'suspended') {
          try { await audioProcessor.ctx.resume(); } catch (e) {}
        }
        if (wakeLockRef.current === null && isConnectedRef.current) {
          requestWakeLock();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      disconnect();
    };
  }, []);

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

    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch (e) {}
      peerRef.current = null;
    }

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
        clockSync.startCalibration(conn).then(() => {
          sendLagUpdateToHost(hardwareProfileRef.current, fineTuneMsRef.current);
        });

        // Background Sync Keeper: check clock periodically to prevent long-term crystal drift
        if (syncKeeperIntervalRef.current) clearInterval(syncKeeperIntervalRef.current);
        syncKeeperIntervalRef.current = setInterval(async () => {
          if (connRef.current && connRef.current.open) {
            await clockSync.startCalibration(connRef.current);
            sendLagUpdateToHost(hardwareProfileRef.current, fineTuneMsRef.current);
          }
        }, 15000);
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
          // Fire scheduled acoustic tick & visual flash.
          // Target 'default' (ctx.destination) so clapper ALWAYS sounds even before audio stream connects
          clockSync.playScheduledPulse(audioProcessor.ctx, data.targetMasterTime, triggerVisualFlash, 'default');
        } else if (data.type === 'FLEET_SYNC_TARGET') {
          // Master Fleet Target from Host
          const fleetTargetMs = data.fleetTargetMs || 300;
          fleetTargetLagRef.current = fleetTargetMs;
          const myLag = myPhysicalLagRef.current;
          const neededDelay = Math.max(0, fleetTargetMs - myLag);
          console.log(`[Receiver] Fleet Target=${fleetTargetMs}ms - My Lag=${myLag}ms → Delay=${neededDelay}ms`);
          setDelayMs(neededDelay);
          audioProcessor.setDelay(neededDelay);
          setAutoSyncStatus('done');
          setAutoSyncMsg(`⚡ Fleet Phase-Locked (Target: ${fleetTargetMs}ms | Hardware Lag: ${myLag}ms [Profile: ${hardwareProfileRef.current}] → Delay Node: +${neededDelay}ms)`);
        } else if (data.type === 'CALIBRATE_TELEMETRY') {
          if (data.fleetTargetMs) {
            fleetTargetLagRef.current = data.fleetTargetMs;
          }
          sendLagUpdateToHost(hardwareProfileRef.current, fineTuneMsRef.current);
        } else if (data.type === 'HOST_DELAY_UPDATE') {
          console.log('[Receiver] Host updated delay to:', data.hostDelayMs, '→ re-aligning fleet');
          sendLagUpdateToHost(hardwareProfileRef.current, fineTuneMsRef.current);
        } else if (data.type === 'START_CALIBRATE_CLIENT') {
          performAutoSync();
        }
      });

      conn.on('close', () => {
        setIsConnected(false);
        setIsAudioActive(false);
        setStatusText('Host Transmitter Offline');
      });

      conn.on('error', (err) => {
        console.warn('[Receiver] Data channel error:', err);
        setStatusText('Connection interrupted. Reconnecting...');
      });

      connRef.current = conn;
    });

    peer.on('call', (call) => {
      console.log('[Receiver] Answering incoming audio stream from Host...');
      call.answer(undefined, { sdpTransform: configureHighFidelityAudioSDP });

      // Constrain WebRTC NetEQ jitter buffer to prevent buffer ballooning and playout drift
      if (call.peerConnection) {
        try {
          call.peerConnection.getReceivers().forEach(receiver => {
            if (receiver.track && receiver.track.kind === 'audio') {
              if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = 0.04;
              if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 40;
            }
          });
        } catch (e) {}
      }

      call.on('stream', (remoteAudioStream) => {
        console.log('[Receiver] Received remote audio stream track:', remoteAudioStream.getAudioTracks().length);
        
        remoteAudioStream.getAudioTracks().forEach(track => {
          if ('contentHint' in track) {
            track.contentHint = 'music';
          }
        });

        // Route audio through Web Audio API DelayNode pipeline (which manages the stream activator)
        audioProcessor.setupStream(remoteAudioStream);

        setIsAudioActive(true);
        setStatusText('● Live Synchronized Studio Playout');
      });

      call.on('close', () => {
        setIsAudioActive(false);
        setStatusText('Audio Feed Stopped');
      });

      call.on('error', (err) => {
        console.warn('[Receiver] Media call error:', err);
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

  const sendLagUpdateToHost = (profile = hardwareProfileRef.current, fineTune = fineTuneMsRef.current) => {
    const effectiveRtt = clockSync.rtt > 0 ? clockSync.rtt : 10;
    const oneWayTransit = effectiveRtt / 2;
    const baseLat = (audioProcessor.ctx?.baseLatency || 0.015) * 1000;
    const outLat = (audioProcessor.ctx?.outputLatency || 0.025) * 1000;
    const totalDac = Math.round(baseLat + outLat);

    let profileLag = 0;
    if (profile === 'bt_speaker') {
      profileLag = 200; // Standard Bluetooth speaker SBC/AAC buffer latency
    } else if (profile === 'bt_headphones') {
      profileLag = 150; // Bluetooth earbud buffer latency
    }

    const physicalLag = Math.max(0, Math.round(oneWayTransit + 35 + totalDac + profileLag + fineTune));
    myPhysicalLagRef.current = physicalLag;

    console.log(`[Receiver] My Physical Lag: Transit=${Math.round(oneWayTransit)}ms + NetEQ=35ms + DAC=${totalDac}ms + Profile=${profileLag}ms (${profile}) + FineTune=${fineTune}ms = ${physicalLag}ms`);

    // Calculate local delay needed against current fleet target
    const currentFleetTarget = fleetTargetLagRef.current || 300;
    const effectiveDelay = Math.max(0, currentFleetTarget - physicalLag);
    setDelayMs(effectiveDelay);
    audioProcessor.setDelay(effectiveDelay);

    // Notify host so the fleet target expands if this device is slower
    if (connRef.current && connRef.current.open) {
      connRef.current.send({
        type: 'SATELLITE_LAG_UPDATE',
        satellitePhysicalLag: physicalLag,
        profile,
        fineTuneMs: fineTune,
        deviceName
      });
    }

    setAutoSyncStatus('done');
    setAutoSyncMsg(`⚡ Fleet Synchronized (Hardware Lag: ${physicalLag}ms [Profile: ${profile}] | Delay Node: +${effectiveDelay}ms)`);
  };

  const handleProfileSelect = (profile) => {
    setHardwareProfile(profile);
    hardwareProfileRef.current = profile;
    sendLagUpdateToHost(profile, fineTuneMsRef.current);
  };

  const handleFineTuneChange = (val) => {
    const clamped = Math.max(-300, Math.min(700, val));
    setFineTuneMs(clamped);
    fineTuneMsRef.current = clamped;
    sendLagUpdateToHost(hardwareProfileRef.current, clamped);
  };

  const handleNudgeChange = (val) => {
    handleFineTuneChange(val);
  };

  const handleVolumeChange = (vol) => {
    setVolume(vol);
    audioProcessor.setVolume(vol);
  };

  const recalibrateClock = () => {
    if (connRef.current && connRef.current.open) {
      clockSync.startCalibration(connRef.current).then(() => {
        sendLagUpdateToHost(hardwareProfileRef.current, fineTuneMsRef.current);
      });
    }
  };

  const requestSyncPulse = () => {
    if (connRef.current && connRef.current.open) {
      connRef.current.send({ type: 'EMIT_PULSE_REQUEST' });
    }
  };

  const performAutoSync = async () => {
    if (!connRef.current || !connRef.current.open) {
      setAutoSyncStatus('error');
      setAutoSyncMsg('Not connected to Host. Please join session first.');
      return;
    }

    setAutoSyncStatus('calibrating');
    setAutoSyncMsg('Measuring network transit (NTP) & hardware DAC buffers...');

    // 1. Await high-precision 8-ping NTP calibration burst
    await clockSync.startCalibration(connRef.current);

    // 2. Transmit true latency to host and calibrate
    sendLagUpdateToHost(hardwareProfileRef.current, fineTuneMsRef.current);
    triggerVisualFlash();
  };

  const applyTelemetrySync = (hostDelay = 350, rtt = 10, isHostMuted = false) => {
    sendLagUpdateToHost(hardwareProfileRef.current, fineTuneMsRef.current);
    triggerVisualFlash();
  };

  const disconnect = () => {
    if (syncKeeperIntervalRef.current) {
      clearInterval(syncKeeperIntervalRef.current);
      syncKeeperIntervalRef.current = null;
    }
    if (activeCallRef.current) {
      try { activeCallRef.current.close(); } catch (e) {}
      activeCallRef.current = null;
    }
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

            {/* 1-TAP SMART TELEMETRY AUTO-SYNC */}
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
                  <Zap size={16} color="var(--accent-bright)" />
                  <strong className="font-mono" style={{ fontSize: '12px', color: 'var(--accent-bright)', letterSpacing: '0.8px' }}>
                    SMART TELEMETRY AUTO-SYNC
                  </strong>
                </div>
                <span className="paper-badge" style={{ 
                  fontSize: '10px', 
                  padding: '2px 8px',
                  color: autoSyncStatus === 'done' ? '#10b981' : autoSyncStatus === 'error' ? '#ef4444' : 'var(--accent-bright)'
                }}>
                  {autoSyncStatus === 'calibrating' ? 'MEASURING...' : autoSyncStatus === 'done' ? '● LOCKED' : '1-TAP ALIGN'}
                </span>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Measures network transit latency, phone DAC buffers, and speaker profiles to lock phase alignment with zero microphone feedback or whooshing.
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
                onClick={performAutoSync} 
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
                <Zap size={18} />
                {autoSyncStatus === 'calibrating' ? 'Measuring Transit & DAC...' : '⚡ Auto-Align & Lock Phase'}
              </button>

              <button 
                onClick={requestSyncPulse} 
                className="btn-analog" 
                style={{ 
                  padding: '10px 14px', 
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  borderColor: 'var(--border-deck)'
                }}
                title="Broadcast a simultaneous click through all speakers to test phase alignment"
              >
                <Target size={15} color="var(--accent-bright)" />
                <span>🎯 Emit Sync Pulse (Verify Alignment)</span>
              </button>
            </div>

            {/* PRECISION ACOUSTIC NUDGE CALIBRATION */}
            <div className="analog-inset" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Clock size={14} color="var(--accent-bright)" />
                    Precision Phase Nudge (Micro-Alignment):
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    Slide negative to advance this speaker earlier; slide positive to delay it
                  </div>
                </div>
                <span className="font-mono paper-badge" style={{ padding: '3px 8px', fontSize: '12px', color: fineTuneMs === 0 ? '#10b981' : 'var(--accent-bright)' }}>
                  {fineTuneMs === 0 ? '0ms (Phase-Locked)' : `${fineTuneMs > 0 ? '+' : ''}${fineTuneMs}ms Nudge`}
                </span>
              </div>

              {/* Wide Range Bi-directional Fine Tuner: -300ms to +700ms */}
              <input 
                type="range" 
                min="-300" 
                max="700" 
                step="2"
                value={fineTuneMs} 
                onChange={(e) => handleFineTuneChange(parseInt(e.target.value))} 
              />

              {/* Stepped Coarse/Fine Alignment Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                {[
                  { label: '-100ms', val: fineTuneMs - 100 },
                  { label: '-50ms', val: fineTuneMs - 50 },
                  { label: '-20ms', val: fineTuneMs - 20 },
                  { label: '0ms Reset', val: 0 },
                  { label: '+20ms', val: fineTuneMs + 20 },
                  { label: '+50ms', val: fineTuneMs + 50 },
                  { label: '+100ms', val: fineTuneMs + 100 },
                ].map(b => (
                  <button
                    key={b.label}
                    onClick={() => handleFineTuneChange(b.val)}
                    className="btn-analog"
                    style={{
                      padding: '6px 2px',
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

              {/* Quick Preset Jumps */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
                {[
                  { label: '-150ms Earbuds', val: -150 },
                  { label: '0ms Phase Lock', val: 0 },
                  { label: '+100ms', val: 100 },
                  { label: '+200ms BT Spkr', val: 200 },
                  { label: '+350ms Heavy BT', val: 350 },
                ].map(b => (
                  <button
                    key={b.label}
                    onClick={() => handleFineTuneChange(b.val)}
                    className="btn-analog"
                    style={{
                      padding: '6px 2px',
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

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                <span>-300ms (Play Earlier / Signal Host)</span>
                <span style={{ color: 'var(--accent-bright)' }}>Active Web Audio Delay: +{delayMs}ms</span>
                <span>+700ms (High Latency Bluetooth)</span>
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
    </div>
  );
}
