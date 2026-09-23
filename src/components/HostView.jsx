import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import QRCode from 'qrcode';
import { 
  Tv, Music, Monitor, Mic, Radio, Users, Sliders, Copy, 
  Check, Volume2, ShieldCheck, Play, Pause, RefreshCw, QrCode
} from 'lucide-react';
import Visualizer from './Visualizer';

export default function HostView({ onBack }) {
  const [roomId, setRoomId] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [sourceType, setSourceType] = useState('screen');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [connectedPeers, setConnectedPeers] = useState([]);
  const [copied, setCopied] = useState(false);
  const [lipSyncDelay, setLipSyncDelay] = useState(0);
  const [activeMediaTitle, setActiveMediaTitle] = useState('No audio source selected');
  const [showQrModal, setShowQrModal] = useState(false);

  const peerRef = useRef(null);
  const audioStreamRef = useRef(null);
  const videoElementRef = useRef(null);
  const audioContextRef = useRef(null);
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

    // CRITICAL FIX: Initialize Host Peer on the signaling network immediately!
    initHostPeer(randomCode);

    return () => {
      stopBroadcasting(true);
    };
  }, []);

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
      console.log('[Host] Room console active & listening for satellites:', id);
    });

    peer.on('connection', (conn) => {
      console.log('[Host] Incoming peer connection attempt:', conn.peer);

      conn.on('open', () => {
        console.log('[Host] Satellite data channel established:', conn.peer);
        activeConnectionsRef.current.set(conn.peer, conn);

        conn.send({ 
          type: 'WELCOME', 
          title: activeMediaTitleRef.current,
          isAudioActive: !!audioStreamRef.current
        });

        setConnectedPeers(prev => [
          ...prev.filter(p => p.id !== conn.peer),
          { id: conn.peer, name: conn.metadata?.name || `Phone (${conn.peer.slice(-4)})`, role: 'stereo' }
        ]);

        // If audio stream is already playing, immediately call this new satellite
        if (audioStreamRef.current && peerRef.current) {
          console.log(`[Host] Piping active audio stream to new satellite: ${conn.peer}`);
          peerRef.current.call(conn.peer, audioStreamRef.current);
        }
      });

      conn.on('data', (data) => {
        if (data.type === 'UPDATE_ROLE') {
          setConnectedPeers(prev => prev.map(p => p.id === conn.peer ? { ...p, role: data.role } : p));
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

  const startScreenCapture = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000
        }
      });

      const audioTracks = mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        alert("⚠️ Audio track missing. Please ensure 'Share audio' is checked when selecting your screen or tab.");
        mediaStream.getTracks().forEach(t => t.stop());
        return;
      }

      setActiveMediaTitle(mediaStream.getVideoTracks()[0]?.label || "Desktop / Movie Audio Loopback");
      setupHostAudio(mediaStream);
    } catch (err) {
      console.error("[Host] Screen capture error:", err);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setActiveMediaTitle(file.name);
    const fileUrl = URL.createObjectURL(file);

    if (videoElementRef.current) {
      videoElementRef.current.src = fileUrl;
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
          autoGainControl: false
        }
      });
      setActiveMediaTitle("Live Room Mic / DJ Line-in");
      setupHostAudio(stream);
    } catch (err) {
      console.error("[Host] Mic error:", err);
    }
  };

  const startSynthGenerator = () => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = ctx;

    const dest = ctx.createMediaStreamDestination();
    analyserRef.current = ctx.createAnalyser();

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
      gain.connect(analyserRef.current);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.24);
      step++;
    }, 240);

    setActiveMediaTitle("Warm Analog Lofi Chords (Test Loop)");
    setupHostAudio(dest.stream);
  };

  const setupHostAudio = (stream) => {
    audioStreamRef.current = stream;
    setIsBroadcasting(true);

    console.log(`[Host] Broadcasting audio stream to ${activeConnectionsRef.current.size} connected satellites`);
    activeConnectionsRef.current.forEach((conn, peerId) => {
      if (peerRef.current && peerRef.current.open) {
        console.log(`[Host] Calling satellite ${peerId} with audio stream`);
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
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyserRef.current = analyser;
    } catch (e) {
      console.warn("[Host] Visualizer link notice:", e);
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
      <div className="analog-deck" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
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
                {isBroadcasting ? 'TRANSMITTER LIVE' : 'TRANSMITTER STANDBY'}
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

        {/* Source Selector Rack */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '1px' }}>
            SELECT INPUT CHANNEL:
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
                <div style={{ fontSize: '11px', opacity: 0.7 }}>Spotify, Netflix, YouTube</div>
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
                <div style={{ fontSize: '11px', opacity: 0.7 }}>Built-in test synth</div>
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

        {/* Live Audio Meter & Readout Panel */}
        <div className="analog-inset" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              FEED: <strong style={{ color: 'var(--text-cream)' }}>{activeMediaTitle}</strong>
            </span>
            <span className="font-mono" style={{ fontSize: '11px', color: isBroadcasting ? 'var(--amber-bright)' : 'var(--text-dim)' }}>
              {isBroadcasting ? '48.0 kHz • 16-BIT PCM' : 'WAITING FOR INPUT'}
            </span>
          </div>

          <Visualizer analyser={analyserRef.current} active={isBroadcasting} height={54} />
        </div>

        {/* Video preview for local movies */}
        <video ref={videoElementRef} controls style={{ width: '100%', maxHeight: '180px', borderRadius: '10px', display: sourceType === 'file' ? 'block' : 'none' }} />

        {/* Lip-Sync Offset Calibration */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', borderTop: '1px solid var(--border-deck)', paddingTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Sliders size={16} color="var(--amber-bright)" />
            <span className="font-mono" style={{ fontSize: '12px', fontWeight: '600' }}>Acoustic Lip-Sync Calibration:</span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Align screen dialogue with room acoustics</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input 
              type="range" 
              min="-200" 
              max="200" 
              step="5"
              value={lipSyncDelay} 
              onChange={(e) => setLipSyncDelay(parseInt(e.target.value))} 
              style={{ width: '140px' }}
            />
            <span className="font-mono paper-badge" style={{ padding: '3px 8px' }}>
              {lipSyncDelay > 0 ? `+${lipSyncDelay}` : lipSyncDelay} ms
            </span>
          </div>
        </div>

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
              Satellite Soundboard ({connectedPeers.length} Active Nodes)
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
              Assign spatial channels across the room to create an organic soundstage
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
              <div key={peer.id} className="analog-inset" style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span className="font-mono" style={{ fontSize: '10px', color: 'var(--amber-bright)' }}>CH {idx + 1}</span>
                    <strong style={{ fontSize: '13px', display: 'block', color: 'var(--text-cream)' }}>{peer.name}</strong>
                  </div>
                  <span className="paper-badge" style={{ fontSize: '10px', padding: '2px 6px' }}>
                    {peer.role.toUpperCase()}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  {['stereo', 'left', 'right', 'bass'].map(r => (
                    <button
                      key={r}
                      onClick={() => setConnectedPeers(prev => prev.map(p => p.id === peer.id ? { ...p, role: r } : p))}
                      className="btn-analog"
                      style={{
                        flex: 1,
                        padding: '4px',
                        fontSize: '10px',
                        fontFamily: 'monospace',
                        background: peer.role === r ? 'var(--amber-core)' : '#1a1816',
                        color: peer.role === r ? '#0c0b0a' : 'var(--text-muted)',
                        borderColor: peer.role === r ? 'var(--amber-bright)' : 'var(--border-deck)'
                      }}
                    >
                      {r === 'bass' ? 'SUB' : r.toUpperCase()}
                    </button>
                  ))}
                </div>
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

    </div>
  );
}
