import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import { 
  Speaker, Sliders, Volume2, Maximize, Smartphone, 
  CheckCircle2, Radio, Zap, AlertTriangle, ShieldCheck, Power,
  Clock, Music
} from 'lucide-react';
import { audioProcessor } from '../utils/audio';
import Visualizer from './Visualizer';

export default function ReceiverView({ initialRoomId = '', onBack }) {
  const [roomId, setRoomId] = useState(initialRoomId);
  const [deviceName, setDeviceName] = useState('Satellite Speaker');
  const [isConnected, setIsConnected] = useState(false);
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [nudgeMs, setNudgeMs] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [statusText, setStatusText] = useState('Receiver Standby');
  const [isFullscreenVisualizer, setIsFullscreenVisualizer] = useState(false);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const wakeLockRef = useRef(null);
  const audioElRef = useRef(null);

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
    return () => {
      disconnect();
    };
  }, [initialRoomId]);

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
      setStatusText('Synchronizing with Host...');

      const conn = peer.connect(targetRoomId, {
        metadata: { name: deviceName }
      });

      conn.on('open', () => {
        setIsConnected(true);
        setStatusText('Tuned In • Auto-Synchronized');
        requestWakeLock();
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
        } else if (data.type === 'PING_RTT') {
          // Respond immediately to host's RTT probe for automatic latency calibration
          conn.send({ type: 'PONG_RTT', t0: data.t0 });
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
      console.log('[Receiver] Answering audio pipe...');
      call.answer();

      call.on('stream', (remoteAudioStream) => {
        console.log('[Receiver] Received remote audio stream track:', remoteAudioStream.getAudioTracks().length);
        audioProcessor.setupStream(remoteAudioStream);
        if (audioElRef.current) {
          audioElRef.current.srcObject = remoteAudioStream;
          audioElRef.current.play().catch(e => console.log('Audio element play notice:', e));
        }
        setIsAudioActive(true);
        setStatusText('● Live Synchronized Playout');
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

  const handleNudgeChange = (ms) => {
    setNudgeMs(ms);
    audioProcessor.setDelay(ms);
  };

  const handleVolumeChange = (vol) => {
    setVolume(vol);
    audioProcessor.setVolume(vol);
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
    <div style={{ maxWidth: '580px', margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      
      {/* Console Top Deck */}
      <div className="analog-deck" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
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
                background: isAudioActive ? 'var(--amber-bright)' : '#44403c',
                boxShadow: isAudioActive ? '0 0 10px var(--amber-core)' : 'none'
              }} />
              <span className="font-mono" style={{ fontSize: '11px', letterSpacing: '1.5px', color: isAudioActive ? 'var(--amber-bright)' : 'var(--text-dim)' }}>
                {isAudioActive ? 'RECEIVING FEED' : 'STANDBY'}
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
                    background: '#0d0c0a',
                    border: '1px solid var(--border-deck)',
                    borderRadius: '10px',
                    color: 'var(--amber-bright)',
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
                  placeholder="e.g. Table Phone, Kitchen Speaker, Balcony" 
                  value={deviceName} 
                  onChange={(e) => setDeviceName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    background: '#0d0c0a',
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
            
            {/* Live Wi-Fi Mesh Status Inset */}
            <div style={{
              padding: '14px 16px',
              borderRadius: '12px',
              background: isAudioActive ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.1)',
              border: `1px solid ${isAudioActive ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.25)'}`,
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
                    background: isAudioActive ? '#10b981' : '#f59e0b',
                    boxShadow: isAudioActive ? '0 0 8px #10b981' : 'none'
                  }} />
                  <strong className="font-mono" style={{ fontSize: '12px', color: isAudioActive ? '#10b981' : 'var(--amber-bright)' }}>
                    {isAudioActive ? 'LIVE WI-FI AUDIO STREAMING' : 'LINKED OVER LOCAL WI-FI'}
                  </strong>
                </div>

                <button onClick={disconnect} className="btn-analog" style={{ fontSize: '11px', padding: '4px 10px' }}>
                  Cut Link
                </button>
              </div>

              <div style={{ fontSize: '12px', color: 'var(--text-cream)' }}>
                {isAudioActive 
                  ? '● Stream is playing in synchronized lockstep with host and peer devices.' 
                  : '📡 Connected to Host! Waiting for Host to select audio. (On host laptop, click "Analog Lofi Groove" or "Screen Loopback" to begin streaming!)'}
              </div>
            </div>

            {/* Full-Range Uniform Audio Banner (Replaced disruptive stereo splitting) */}
            <div style={{
              padding: '12px 14px',
              borderRadius: '10px',
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <Volume2 size={18} color="var(--amber-bright)" style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '12px', color: 'var(--text-cream)' }}>
                <strong>Uniform Full-Range Sound:</strong> Streaming identical audio to all devices for maximum room-filling volume.
              </div>
            </div>

            {/* Precision Micro-Nudge Calibration (Replaced huge offset with ±30ms acoustic nudge) */}
            <div className="analog-inset" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Clock size={14} color="var(--amber-bright)" />
                    Acoustic Room Nudge (Fine-Tune):
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    Auto-synced by host. Only adjust for physical room distance or speaker delay.
                  </div>
                </div>
                <span className="font-mono paper-badge" style={{ padding: '3px 8px', fontSize: '12px', color: nudgeMs === 0 ? '#10b981' : 'var(--amber-bright)' }}>
                  {nudgeMs === 0 ? '0ms (Locked)' : `${nudgeMs > 0 ? '+' : ''}${nudgeMs}ms`}
                </span>
              </div>

              <input 
                type="range" 
                min="-30" 
                max="30" 
                step="1"
                value={nudgeMs} 
                onChange={(e) => handleNudgeChange(parseInt(e.target.value))} 
              />

              {/* Quick Preset Nudge Buttons */}
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  { label: '-10ms', val: -10 },
                  { label: '-5ms', val: -5 },
                  { label: '0ms (Auto-Lock)', val: 0 },
                  { label: '+5ms', val: 5 },
                  { label: '+10ms', val: 10 },
                ].map(preset => (
                  <button
                    key={preset.label}
                    onClick={() => handleNudgeChange(preset.val)}
                    className="btn-analog"
                    style={{
                      flex: 1,
                      padding: '4px 2px',
                      fontSize: '10px',
                      fontFamily: 'monospace',
                      background: nudgeMs === preset.val ? 'var(--amber-core)' : '#1a1816',
                      color: nudgeMs === preset.val ? '#0c0b0a' : 'var(--text-muted)',
                      borderColor: nudgeMs === preset.val ? 'var(--amber-bright)' : 'var(--border-deck)'
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                <span>Faster (-30ms)</span>
                <span style={{ color: 'var(--amber-bright)' }}>Auto-Synced (0ms)</span>
                <span>Slower (+30ms)</span>
              </div>
            </div>

            {/* Volume Potentiometer */}
            <div className="analog-inset" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>OUTPUT LEVEL:</span>
                <span className="font-mono" style={{ fontSize: '12px', color: 'var(--amber-bright)' }}>{Math.round(volume * 100)}%</span>
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
                <span className="font-mono" style={{ fontSize: '10px', color: 'var(--amber-bright)', letterSpacing: '1px' }}>
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
      
      {/* Hidden Audio Element for Mobile Browser Playback Assurance */}
      <audio ref={audioElRef} autoPlay playsInline style={{ display: 'none' }} />
    </div>
  );
}
