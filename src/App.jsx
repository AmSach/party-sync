import React, { useState, useEffect } from 'react';
import { Radio, Speaker, Tv, Sparkles, Download, Volume2, ShieldCheck } from 'lucide-react';
import HostView from './components/HostView';
import ReceiverView from './components/ReceiverView';

export default function App() {
  const [mode, setMode] = useState(null); // 'host' | 'receiver' | null
  const [roomFromUrl, setRoomFromUrl] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);

  // Check URL query parameters for ?room=PARTY-xxxx
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setRoomFromUrl(room);
      setMode('receiver'); // Automatically open receiver mode on friend's phone
    }

    // PWA install prompt handler
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    });
  }, []);

  const handleInstallPWA = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallPrompt(null);
      }
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* Top Navbar */}
      <header style={{
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid var(--border-color)',
        backdropFilter: 'blur(16px)',
        background: 'rgba(7, 10, 18, 0.7)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div 
          onClick={() => setMode(null)} 
          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
        >
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-magenta))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#050811',
            boxShadow: '0 0 16px rgba(0, 245, 255, 0.35)'
          }}>
            <Radio size={20} />
          </div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.5px' }}>
              Party<span className="gradient-text">Sync</span>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
              DISTRIBUTED AUDIO & MOVIE MESH
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {installPrompt && (
            <button onClick={handleInstallPWA} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
              <Download size={14} />
              Install App
            </button>
          )}

          <a 
            href="https://github.com" 
            target="_blank" 
            rel="noreferrer"
            style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none', fontSize: '12px' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {mode === 'host' && (
          <HostView onBack={() => setMode(null)} />
        )}

        {mode === 'receiver' && (
          <ReceiverView initialRoomId={roomFromUrl} onBack={() => setMode(null)} />
        )}

        {mode === null && (
          /* Landing Screen */
          <div style={{
            maxWidth: '900px',
            margin: '0 auto',
            padding: '48px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '36px'
          }}>
            
            {/* Hero Banner */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', maxWidth: '680px' }}>
              <span style={{
                background: 'rgba(0, 245, 255, 0.1)',
                border: '1px solid var(--border-glow)',
                color: 'var(--accent-cyan)',
                padding: '6px 16px',
                borderRadius: '30px',
                fontSize: '12px',
                fontWeight: '700',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <Sparkles size={14} />
                ZERO-LATENCY DISTRIBUTED SOUNDSTAGE
              </span>

              <h1 style={{ fontSize: 'clamp(32px, 6vw, 54px)', fontWeight: '800', lineHeight: 1.15, letterSpacing: '-1px' }}>
                Turn Everyone's Phones into a <span className="gradient-text">Massive Sound System</span>
              </h1>

              <p style={{ fontSize: '16px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Play movies, Spotify, or music on a TV or laptop, and stream the audio in lockstep synchronization across all connected phones and speakers in the room.
              </p>
            </div>

            {/* Mode Selection Cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '24px',
              width: '100%'
            }}>
              
              {/* Host Card */}
              <div 
                onClick={() => setMode('host')}
                className="glass-panel glass-glow-cyan"
                style={{
                  padding: '36px 28px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '16px',
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
              >
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '20px',
                  background: 'linear-gradient(135deg, rgba(0,245,255,0.2), rgba(157,78,221,0.2))',
                  border: '1px solid var(--border-glow)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent-cyan)'
                }}>
                  <Tv size={32} />
                </div>

                <div>
                  <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '6px' }}>Host Party / Movie</h2>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    Run this on your Laptop, TV, or Host Phone. Share Spotify, Netflix, YouTube, or MP3s to everyone.
                  </p>
                </div>

                <button className="btn-primary" style={{ width: '100%', marginTop: '8px' }}>
                  <Tv size={18} />
                  Start Host Broadcast
                </button>
              </div>

              {/* Receiver Card */}
              <div 
                onClick={() => setMode('receiver')}
                className="glass-panel"
                style={{
                  padding: '36px 28px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '16px',
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
              >
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '20px',
                  background: 'linear-gradient(135deg, rgba(255,0,122,0.2), rgba(157,78,221,0.2))',
                  border: '1px solid rgba(255,0,122,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent-magenta)'
                }}>
                  <Speaker size={32} />
                </div>

                <div>
                  <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '6px' }}>Join as Speaker Node</h2>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    Open this on any friend's iPhone, Android, or laptop to turn its speakers into part of the party mesh.
                  </p>
                </div>

                <button className="btn-secondary" style={{ width: '100%', marginTop: '8px' }}>
                  <Speaker size={18} />
                  Connect Speaker
                </button>
              </div>

            </div>

            {/* Feature Pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '16px', maxWidth: '750px', color: 'var(--text-dim)', fontSize: '13px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ShieldCheck size={16} color="var(--status-green)" /> Direct WebRTC Local Wi-Fi (Sub-20ms)
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Volume2 size={16} color="var(--accent-cyan)" /> Virtual Surround & Spatial Channels
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={16} color="var(--accent-magenta)" /> Zero Install (Runs in Any Browser)
              </span>
            </div>

          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        padding: '18px 24px',
        textAlign: 'center',
        borderTop: '1px solid var(--border-color)',
        color: 'var(--text-dim)',
        fontSize: '12px'
      }}>
        PartySync • Multi-Device Audio Mesh Engine • Vercel Ready
      </footer>
    </div>
  );
}
