import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import { 
  Speaker, Sliders, Volume2, Maximize, Smartphone, 
  CheckCircle2, Radio, Zap, AlertTriangle, ShieldCheck
} from 'lucide-react';
import { audioProcessor } from '../utils/audio';
import Visualizer from './Visualizer';

export default function ReceiverView({ initialRoomId = '', onBack }) {
  const [roomId, setRoomId] = useState(initialRoomId);
  const [deviceName, setDeviceName] = useState('My Satellite Speaker');
  const [isConnected, setIsConnected] = useState(false);
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [speakerRole, setSpeakerRole] = useState('stereo');
  const [delayMs, setDelayMs] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [statusText, setStatusText] = useState('Ready to link');
  const [isFullscreenVisualizer, setIsFullscreenVisualizer] = useState(false);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const wakeLockRef = useRef(null);

  // Auto request screen wake lock so phone doesn't sleep during party
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
    // If URL has ?room=PARTY-xxxx, set it
    if (initialRoomId) {
      setRoomId(initialRoomId);
    }
    return () => {
      disconnect();
    };
  }, [initialRoomId]);

  const connectToHost = () => {
    if (!roomId) {
      alert('Please enter a 4-digit Room Code!');
      return;
    }

    setStatusText('Connecting to Host...');
    audioProcessor.init();

    // Create random receiver peer
    const receiverPeerId = 'CLIENT-' + Math.random().toString(36).substring(2, 9);
    const peer = new Peer(receiverPeerId, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    peer.on('open', (id) => {
      console.log('[Receiver] Peer opened:', id);
      setStatusText('Linking to room ' + roomId + '...');

      // Connect data channel to host
      const conn = peer.connect(roomId, {
        metadata: { name: deviceName }
      });

      conn.on('open', () => {
        setIsConnected(true);
        setStatusText('Connected to Host! Waiting for audio stream...');
        requestWakeLock();
      });

      conn.on('data', (data) => {
        if (data.type === 'WELCOME') {
          console.log('[Receiver] Host active stream:', data.title);
        }
      });

      conn.on('close', () => {
        setIsConnected(false);
        setIsAudioActive(false);
        setStatusText('Host disconnected.');
      });

      connRef.current = conn;
    });

    // Handle incoming audio call from Host
    peer.on('call', (call) => {
      console.log('[Receiver] Incoming audio call from host...');
      call.answer(); // Answer the call

      call.on('stream', (remoteAudioStream) => {
        console.log('[Receiver] Remote audio stream received!');
        audioProcessor.setupStream(remoteAudioStream);
        setIsAudioActive(true);
        setStatusText('🔊 Live Audio Sync Active!');
      });

      call.on('close', () => {
        setIsAudioActive(false);
        setStatusText('Audio stream ended.');
      });
    });

    peer.on('error', (err) => {
      console.error('[Receiver] Peer error:', err);
      setStatusText('Connection error. Is the Room Code correct?');
    });

    peerRef.current = peer;
  };

  const handleRoleChange = (newRole) => {
    setSpeakerRole(newRole);
    audioProcessor.applyRole(newRole);
    if (connRef.current && connRef.current.open) {
      connRef.current.send({ type: 'UPDATE_ROLE', role: newRole });
    }
  };

  const handleDelayChange = (ms) => {
    setDelayMs(ms);
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
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ 
            background: 'rgba(255, 0, 122, 0.15)', 
            color: 'var(--accent-magenta)', 
            padding: '4px 12px', 
            borderRadius: '20px', 
            fontSize: '12px', 
            fontWeight: '700',
            letterSpacing: '1px'
          }}>
            SPEAKER NODE
          </span>
          <h1 style={{ fontSize: '24px', fontWeight: '800', marginTop: '4px' }}>Satellite Receiver</h1>
        </div>

        <button onClick={onBack} className="btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }}>
          Change Mode
        </button>
      </div>

      {!isConnected ? (
        /* Connect Form */
        <div className="glass-panel" style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <Speaker size={48} color="var(--accent-cyan)" style={{ marginBottom: '12px' }} />
            <h2 style={{ fontSize: '18px', fontWeight: '700' }}>Link to Party Room</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Turn this device and its speakers into a synchronized satellite audio node
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Room Code (From Host Screen):</label>
            <input 
              type="text" 
              placeholder="e.g. PARTY-4821" 
              value={roomId} 
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              style={{
                width: '100%',
                padding: '14px 16px',
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '18px',
                fontWeight: '700',
                letterSpacing: '2px',
                textAlign: 'center',
                fontFamily: 'monospace'
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Speaker Name / Location:</label>
            <input 
              type="text" 
              placeholder="e.g. Left Couch, Car Stereo, JBL Flip" 
              value={deviceName} 
              onChange={(e) => setDeviceName(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '14px'
              }}
            />
          </div>

          <button onClick={connectToHost} className="btn-primary" style={{ width: '100%', padding: '16px', fontSize: '15px' }}>
            <Zap size={18} />
            Connect & Activate Speaker
          </button>

          <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-dim)' }}>
            Status: {statusText}
          </div>
        </div>
      ) : (
        /* Connected Speaker Controls */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Status Banner */}
          <div className="glass-panel" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: isAudioActive ? 'var(--status-green)' : 'var(--accent-magenta)' }} />
              <div>
                <strong style={{ fontSize: '14px' }}>Room: {roomId}</strong>
                <div style={{ fontSize: '12px', color: isAudioActive ? 'var(--status-green)' : 'var(--text-muted)' }}>
                  {statusText}
                </div>
              </div>
            </div>

            <button onClick={disconnect} className="btn-danger" style={{ fontSize: '12px', padding: '6px 12px' }}>
              Disconnect
            </button>
          </div>

          {/* Spatial Channel Assignment */}
          <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-muted)' }}>
              1. Spatial Role Placement:
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              {[
                { id: 'stereo', label: 'All (Stereo)', desc: 'Standard' },
                { id: 'left', label: 'Left (L)', desc: 'Room Left' },
                { id: 'right', label: 'Right (R)', desc: 'Room Right' },
                { id: 'bass', label: 'Sub (Bass)', desc: 'Low-Pass' },
              ].map(role => (
                <button
                  key={role.id}
                  onClick={() => handleRoleChange(role.id)}
                  style={{
                    padding: '12px 6px',
                    borderRadius: '12px',
                    border: '1px solid',
                    borderColor: speakerRole === role.id ? 'var(--accent-cyan)' : 'var(--border-color)',
                    background: speakerRole === role.id ? 'rgba(0, 245, 255, 0.2)' : 'rgba(255,255,255,0.03)',
                    color: speakerRole === role.id ? '#fff' : 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <strong style={{ fontSize: '12px' }}>{role.label}</strong>
                  <span style={{ fontSize: '10px', opacity: 0.7 }}>{role.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Precision Latency Calibration Slider */}
          <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: '700' }}>2. Sync Delay Calibration:</h3>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Tune Bluetooth DAC processing delay to eliminate echo
                </p>
              </div>
              <span style={{ fontSize: '16px', fontWeight: '800', fontFamily: 'monospace', color: 'var(--accent-cyan)' }}>
                {delayMs > 0 ? `+${delayMs}` : delayMs} ms
              </span>
            </div>

            <input 
              type="range" 
              min="-200" 
              max="300" 
              step="5"
              value={delayMs} 
              onChange={(e) => handleDelayChange(parseInt(e.target.value))} 
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)' }}>
              <span>Ahead (-200ms)</span>
              <span>In-Sync (0ms)</span>
              <span>Delay (+300ms)</span>
            </div>
          </div>

          {/* Volume Control */}
          <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Volume2 size={18} color="var(--accent-cyan)" />
                <h3 style={{ fontSize: '14px', fontWeight: '700' }}>3. Speaker Volume:</h3>
              </div>
              <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>
                {Math.round(volume * 100)}%
              </span>
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

          {/* Live Reactive Visualizer */}
          <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--accent-cyan)' }}>
                ● ROOM BEAT REACTOR
              </span>
              <button 
                onClick={() => setIsFullscreenVisualizer(!isFullscreenVisualizer)}
                className="btn-secondary" 
                style={{ padding: '4px 10px', fontSize: '11px', gap: '4px' }}
              >
                <Maximize size={12} />
                {isFullscreenVisualizer ? 'Exit Fullscreen' : 'Fullscreen Party Visualizer'}
              </button>
            </div>

            <Visualizer 
              analyser={audioProcessor.analyserNode} 
              active={isAudioActive} 
              height={isFullscreenVisualizer ? 260 : 90} 
            />
          </div>

        </div>
      )}

    </div>
  );
}
