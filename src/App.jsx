import React, { useState, useEffect } from 'react';
import { Radio, Speaker, Tv, Download, Disc3, Sparkles } from 'lucide-react';
import HeroCard from './components/HeroCard';
import HostView from './components/HostView';
import ReceiverView from './components/ReceiverView';
import MotionBackground from './components/MotionBackground';

export default function App() {
  const [mode, setMode] = useState('host'); // Default directly into a working console, no split tab landing screen!
  const [roomFromUrl, setRoomFromUrl] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setRoomFromUrl(room);
      setMode('receiver'); // Auto switch to tune-in when joining via friend's link
    }

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
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      flexDirection: 'column', 
      position: 'relative',
      background: '#0f1419'
    }}>
      {/* Motion.dev Hardware-Accelerated Acoustic Background */}
      <MotionBackground />
      
      {/* Main Console Container */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        
        {/* Top Tactile Nav Ribbon */}
        <header style={{
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-deck)',
          background: 'rgba(15, 20, 25, 0.92)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 50
        }}>
          {/* Brand Mark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'linear-gradient(180deg, #2a2622 0%, #171513 100%)',
              border: '1px solid var(--border-deck-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--amber-bright)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.5)'
            }}>
              <Disc3 size={20} className="spin-slow" />
            </div>

            <div>
              <div className="font-serif" style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.5px', color: 'var(--text-cream)' }}>
                Party<span style={{ color: 'var(--amber-bright)' }}>Sync</span>
              </div>
              <div className="font-mono" style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.8px' }}>
                ANALOG AUDIO MESH CONSOLE
              </div>
            </div>
          </div>

          {/* Unified Analog Mode Rocker Switch (Desktop) */}
          <div className="hide-on-mobile" style={{ 
            background: '#100f0d', 
            border: '1px solid var(--border-deck)', 
            borderRadius: '12px', 
            padding: '3px',
            display: 'flex',
            gap: '2px'
          }}>
            <button
              onClick={() => setMode('host')}
              className="btn-analog"
              style={{
                padding: '6px 14px',
                fontSize: '11px',
                fontFamily: 'monospace',
                borderRadius: '8px',
                background: mode === 'host' ? 'var(--amber-core)' : 'transparent',
                color: mode === 'host' ? '#0c0b0a' : 'var(--text-muted)',
                borderColor: mode === 'host' ? 'var(--amber-bright)' : 'transparent',
                boxShadow: mode === 'host' ? '0 2px 8px var(--amber-glow)' : 'none'
              }}
            >
              🎙️ HOST DECK
            </button>

            <button
              onClick={() => setMode('receiver')}
              className="btn-analog"
              style={{
                padding: '6px 14px',
                fontSize: '11px',
                fontFamily: 'monospace',
                borderRadius: '8px',
                background: mode === 'receiver' ? 'var(--amber-core)' : 'transparent',
                color: mode === 'receiver' ? '#0c0b0a' : 'var(--text-muted)',
                borderColor: mode === 'receiver' ? 'var(--amber-bright)' : 'transparent',
                boxShadow: mode === 'receiver' ? '0 2px 8px var(--amber-glow)' : 'none'
              }}
            >
              🎧 SATELLITE
            </button>
          </div>

          {/* Right Tools & Mobile Mode Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setMode(mode === 'host' ? 'receiver' : 'host')}
              className="btn-analog show-on-mobile"
              style={{
                padding: '6px 10px',
                fontSize: '11px',
                fontFamily: 'monospace',
                borderColor: 'var(--amber-bright)',
                color: 'var(--amber-bright)'
              }}
            >
              {mode === 'host' ? '🎙️ HOST' : '🎧 SPEAKER'}
            </button>

            {installPrompt && (
              <button onClick={handleInstallPWA} className="btn-analog" style={{ fontSize: '11px', padding: '6px 12px' }}>
                <Download size={13} />
                <span className="hide-on-mobile">Install</span>
              </button>
            )}
          </div>
        </header>

        {/* Console Body */}
        <main style={{ flex: 1, padding: '16px 12px 36px', display: 'flex', flexDirection: 'column' }}>
          {/* Welcoming, Reassuring Human Hero Onboarding Card */}
          <HeroCard mode={mode} setMode={setMode} />

          {/* Active Broadcast or Receiver Station */}
          {mode === 'host' ? (
            <HostView onBack={() => setMode('receiver')} />
          ) : (
            <ReceiverView initialRoomId={roomFromUrl} onBack={() => setMode('host')} />
          )}
        </main>

        {/* Vintage Chassis Bottom Footer */}
        <footer style={{
          padding: '14px 20px',
          textAlign: 'center',
          borderTop: '1px solid var(--border-deck)',
          background: 'rgba(15, 20, 25, 0.95)',
          color: 'var(--text-dim)',
          fontSize: '11px',
          fontFamily: 'monospace',
          letterSpacing: '0.5px'
        }}>
          PARTYSYNC MESH AUDIO • 192KBPS OPUS HI-FI • SMART PHASE SYNC
        </footer>

      </div>
    </div>
  );
}
