import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import QRCode from 'qrcode';
import { 
  Tv, Music, Monitor, Mic, Radio, Users, Sliders, Copy, 
  Check, Volume2, ShieldCheck, Play, Pause, RefreshCw, Smartphone
} from 'lucide-react';
import Visualizer from './Visualizer';

export default function HostView({ onBack }) {
  const [roomId, setRoomId] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [sourceType, setSourceType] = useState('screen'); // 'screen' | 'file' | 'mic' | 'synth'
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [connectedPeers, setConnectedPeers] = useState([]);
  const [copied, setCopied] = useState(false);
  const [lipSyncDelay, setLipSyncDelay] = useState(0);
  const [activeMediaTitle, setActiveMediaTitle] = useState('No audio source selected');

  const peerRef = useRef(null);
  const audioStreamRef = useRef(null);
  const videoElementRef = useRef(null);
  const audioContextRef = useRef(null);
  const synthIntervalRef = useRef(null);
  const analyserRef = useRef(null);

  // Generate random room code on mount
  useEffect(() => {
    const randomCode = 'PARTY-' + Math.floor(1000 + Math.random() * 9000);
    setRoomId(randomCode);

    // Generate QR code for mobile joining
    const joinUrl = `${window.location.origin}?room=${randomCode}`;
    QRCode.toDataURL(joinUrl, {
      width: 200,
      margin: 1,
      color: { dark: '#00f5ff', light: '#070a12' }
    }).then(url => setQrDataUrl(url));

    return () => {
      stopBroadcasting();
    };
  }, []);

  // Initialize PeerJS Host
  const initHostPeer = (stream) => {
    if (peerRef.current) {
      peerRef.current.destroy();
    }

    const peer = new Peer(roomId, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    peer.on('open', (id) => {
      console.log('[Host] PeerJS Room opened:', id);
    });

    // When a receiver phone connects to this room
    peer.on('connection', (conn) => {
      console.log('[Host] Receiver phone connected:', conn.peer);
      
      conn.on('open', () => {
        // Send welcome & metadata
        conn.send({ type: 'WELCOME', title: activeMediaTitle });

        // Add to connected peer list
        setConnectedPeers(prev => [
          ...prev.filter(p => p.id !== conn.peer),
          { id: conn.peer, name: conn.metadata?.name || `Phone (${conn.peer.slice(-4)})`, role: 'stereo', rtt: 12 }
        ]);

        // Call the receiver phone with the live audio stream
        if (audioStreamRef.current) {
          peer.call(conn.peer, audioStreamRef.current);
        }
      });

      conn.on('data', (data) => {
        if (data.type === 'UPDATE_ROLE') {
          setConnectedPeers(prev => prev.map(p => p.id === conn.peer ? { ...p, role: data.role } : p));
        }
      });

      conn.on('close', () => {
        setConnectedPeers(prev => prev.filter(p => p.id !== conn.peer));
      });
    });

    peerRef.current = peer;
  };

  // Start Screen / Tab / Spotify Audio Capture
  const startScreenCapture = async () => {
    try {
      // getDisplayMedia captures Spotify, Netflix, YouTube, VLC, browser tabs
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
        alert("⚠️ No audio detected! Make sure you check 'Share tab audio' or 'Share system audio' when choosing the screen/tab.");
        mediaStream.getTracks().forEach(t => t.stop());
        return;
      }

      // Check if user chose a tab or window
      setActiveMediaTitle(mediaStream.getVideoTracks()[0]?.label || "Shared Screen / Movie Audio");
      setupHostAudio(mediaStream);
    } catch (err) {
      console.error("[Host] Screen capture error:", err);
    }
  };

  // Start Local File Audio/Video Player
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setActiveMediaTitle(file.name);
    const fileUrl = URL.createObjectURL(file);

    if (videoElementRef.current) {
      videoElementRef.current.src = fileUrl;
      videoElementRef.current.play();

      // Capture audio from video element
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

  // Start Microphone / Line-In
  const startMicCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      setActiveMediaTitle("Live DJ / Microphone Line-in");
      setupHostAudio(stream);
    } catch (err) {
      console.error("[Host] Mic error:", err);
    }
  };

  // Synth Groove Loop Generator (Instant zero-file demo)
  const startSynthGenerator = () => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = ctx;

    const dest = ctx.createMediaStreamDestination();
    analyserRef.current = ctx.createAnalyser();

    // 80s Synth Funk Loop
    let step = 0;
    const notes = [110, 130.81, 146.83, 164.81, 196, 220, 261.63]; // A Minor Pentatonic

    synthIntervalRef.current = setInterval(() => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const freq = notes[step % notes.length];
      osc.type = step % 4 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

      osc.connect(gain);
      gain.connect(dest);
      gain.connect(analyserRef.current);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.25);
      step++;
    }, 220);

    setActiveMediaTitle("80s Synthwave Beat Generator");
    setupHostAudio(dest.stream);
  };

  // Wire up audio stream to WebRTC and connected peers
  const setupHostAudio = (stream) => {
    audioStreamRef.current = stream;
    setIsBroadcasting(true);

    // Initialize Host Peer
    initHostPeer(stream);

    // Setup visualizer analyzer
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

  const stopBroadcasting = () => {
    setIsBroadcasting(false);
    if (synthIntervalRef.current) clearInterval(synthIntervalRef.current);
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop());
    }
    if (peerRef.current) {
      peerRef.current.destroy();
    }
    setConnectedPeers([]);
  };

  const copyShareLink = () => {
    const url = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ 
              background: 'rgba(0, 245, 255, 0.15)', 
              color: 'var(--accent-cyan)', 
              padding: '4px 12px', 
              borderRadius: '20px', 
              fontSize: '12px', 
              fontWeight: '700',
              letterSpacing: '1px'
            }}>
              HOST MODE
            </span>
            <h1 style={{ fontSize: '24px', fontWeight: '800' }}>Party Broadcast Hub</h1>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
            Broadcasting live audio to all connected phones and speakers in the room
          </p>
        </div>

        <button onClick={onBack} className="btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }}>
          Leave Host Mode
        </button>
      </div>

      {/* Main Grid: Audio Source Picker + QR Code & Room Info */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        
        {/* Source Selection Panel */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Volume2 size={18} color="var(--accent-cyan)" />
            Step 1: Choose Your Audio Source
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <button 
              onClick={() => { setSourceType('screen'); startScreenCapture(); }}
              className={sourceType === 'screen' && isBroadcasting ? 'btn-primary' : 'btn-secondary'}
              style={{ padding: '16px 12px', flexDirection: 'column', gap: '6px', textAlign: 'center' }}
            >
              <Monitor size={24} />
              <strong style={{ fontSize: '13px' }}>Share Screen / Tab</strong>
              <span style={{ fontSize: '11px', opacity: 0.8 }}>Spotify, Netflix, YouTube</span>
            </button>

            <label 
              className={sourceType === 'file' && isBroadcasting ? 'btn-primary' : 'btn-secondary'}
              style={{ padding: '16px 12px', flexDirection: 'column', gap: '6px', textAlign: 'center', cursor: 'pointer' }}
            >
              <Music size={24} />
              <strong style={{ fontSize: '13px' }}>Movie / MP3 File</strong>
              <span style={{ fontSize: '11px', opacity: 0.8 }}>Upload video or audio</span>
              <input type="file" accept="audio/*,video/*" onChange={(e) => { setSourceType('file'); handleFileUpload(e); }} style={{ display: 'none' }} />
            </label>

            <button 
              onClick={() => { setSourceType('synth'); startSynthGenerator(); }}
              className={sourceType === 'synth' && isBroadcasting ? 'btn-primary' : 'btn-secondary'}
              style={{ padding: '16px 12px', flexDirection: 'column', gap: '6px', textAlign: 'center' }}
            >
              <Radio size={24} />
              <strong style={{ fontSize: '13px' }}>Synth Beat Loop</strong>
              <span style={{ fontSize: '11px', opacity: 0.8 }}>Instant test groove</span>
            </button>

            <button 
              onClick={() => { setSourceType('mic'); startMicCapture(); }}
              className={sourceType === 'mic' && isBroadcasting ? 'btn-primary' : 'btn-secondary'}
              style={{ padding: '16px 12px', flexDirection: 'column', gap: '6px', textAlign: 'center' }}
            >
              <Mic size={24} />
              <strong style={{ fontSize: '13px' }}>Live Mic / DJ</strong>
              <span style={{ fontSize: '11px', opacity: 0.8 }}>Microphone line-in</span>
            </button>
          </div>

          {/* Active Stream Monitor */}
          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '14px', padding: '14px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Status:</span>
              <span style={{ 
                fontSize: '12px', 
                fontWeight: '700', 
                color: isBroadcasting ? 'var(--status-green)' : 'var(--accent-magenta)',
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px' 
              }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isBroadcasting ? 'var(--status-green)' : 'var(--accent-magenta)' }} />
                {isBroadcasting ? 'LIVE BROADCASTING' : 'IDLE'}
              </span>
            </div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-main)', wordBreak: 'break-all' }}>
              {activeMediaTitle}
            </div>
          </div>

          {/* Hidden video element for local file playback */}
          <video ref={videoElementRef} controls style={{ width: '100%', maxHeight: '160px', borderRadius: '10px', display: sourceType === 'file' ? 'block' : 'none' }} />

          {/* Realtime Waveform Visualizer */}
          <Visualizer analyser={analyserRef.current} active={isBroadcasting} height={70} />
        </div>

        {/* Room Pairing & QR Code Panel */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', textAlign: 'center' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '700' }}>Step 2: Have Friends Scan to Join</h2>
          
          <div style={{ 
            background: '#070a12', 
            padding: '16px', 
            borderRadius: '20px', 
            border: '2px solid var(--border-glow)',
            boxShadow: '0 0 25px rgba(0, 245, 255, 0.15)'
          }}>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Room QR Code" style={{ width: '180px', height: '180px', display: 'block', borderRadius: '8px' }} />
            ) : (
              <div style={{ width: '180px', height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <RefreshCw className="spin-slow" />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Room Code:</span>
            <div style={{ 
              fontSize: '24px', 
              fontWeight: '800', 
              letterSpacing: '3px', 
              color: 'var(--accent-cyan)',
              fontFamily: 'monospace'
            }}>
              {roomId}
            </div>
          </div>

          <button onClick={copyShareLink} className="btn-secondary" style={{ width: '100%', fontSize: '13px' }}>
            {copied ? <Check size={16} color="var(--status-green)" /> : <Copy size={16} />}
            {copied ? 'Link Copied to Clipboard!' : 'Copy Share Link'}
          </button>
        </div>
      </div>

      {/* Connected Phones & Spatial Surround Control Grid */}
      <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={20} color="var(--accent-cyan)" />
              Connected Room Speakers ({connectedPeers.length})
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Assign spatial roles (Left, Right, Surround, Bass) to build a distributed multi-channel soundstage
            </p>
          </div>

          {/* Master Lip-Sync Slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(0,0,0,0.3)', padding: '8px 16px', borderRadius: '12px' }}>
            <Sliders size={16} color="var(--accent-cyan)" />
            <span style={{ fontSize: '12px', fontWeight: '600' }}>Master Lip-Sync:</span>
            <input 
              type="range" 
              min="-200" 
              max="200" 
              step="5"
              value={lipSyncDelay} 
              onChange={(e) => setLipSyncDelay(parseInt(e.target.value))} 
              style={{ width: '100px' }}
            />
            <span style={{ fontSize: '12px', fontFamily: 'monospace', minWidth: '45px' }}>{lipSyncDelay > 0 ? `+${lipSyncDelay}` : lipSyncDelay}ms</span>
          </div>
        </div>

        {connectedPeers.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '36px 16px', 
            background: 'rgba(255,255,255,0.02)', 
            borderRadius: '16px',
            border: '1px dashed var(--border-color)'
          }}>
            <Smartphone size={32} color="var(--text-dim)" style={{ marginBottom: '8px' }} />
            <p style={{ fontSize: '14px', fontWeight: '600' }}>No satellite speakers connected yet</p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Have friends scan the QR code above on their phones to link their speakers!
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
            {connectedPeers.map(peer => (
              <div key={peer.id} style={{ 
                background: 'rgba(255,255,255,0.04)', 
                border: '1px solid var(--border-color)', 
                borderRadius: '16px', 
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Smartphone size={20} color="var(--accent-cyan)" />
                    <div>
                      <strong style={{ fontSize: '14px' }}>{peer.name}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--status-green)' }}>● WebRTC P2P Sync (LAN)</div>
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '10px', background: 'rgba(0, 245, 255, 0.15)', color: 'var(--accent-cyan)', fontWeight: '700' }}>
                    {peer.role.toUpperCase()}
                  </span>
                </div>

                {/* Role Switcher */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {['stereo', 'left', 'right', 'bass'].map(r => (
                    <button
                      key={r}
                      onClick={() => {
                        setConnectedPeers(prev => prev.map(p => p.id === peer.id ? { ...p, role: r } : p));
                      }}
                      style={{
                        flex: 1,
                        padding: '6px 4px',
                        fontSize: '11px',
                        fontWeight: '600',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: peer.role === r ? 'var(--accent-cyan)' : 'transparent',
                        background: peer.role === r ? 'rgba(0, 245, 255, 0.2)' : 'rgba(255,255,255,0.05)',
                        color: peer.role === r ? '#fff' : 'var(--text-muted)',
                        cursor: 'pointer'
                      }}
                    >
                      {r === 'bass' ? 'Sub' : r.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
