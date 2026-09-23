import React, { useState } from 'react';
import { Radio, Speaker, Sparkles, ChevronDown, ChevronUp, Share2, HelpCircle } from 'lucide-react';

export default function HeroCard({ mode, setMode }) {
  const [showHowItWorks, setShowHowItWorks] = useState(true);

  return (
    <div className="hero-chassis" style={{
      maxWidth: '960px',
      margin: '0 auto 20px',
      width: '100%',
      position: 'relative',
      background: 'linear-gradient(180deg, #181614 0%, #11100e 100%)',
      border: '1px solid var(--border-deck)',
      borderRadius: '24px',
      boxShadow: '0 20px 48px -12px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
      padding: '28px 24px',
      overflow: 'hidden'
    }}>
      {/* Decorative Corner Rivets */}
      <div className="corner-rivet rivet-tl" />
      <div className="corner-rivet rivet-tr" />
      <div className="corner-rivet rivet-bl" />
      <div className="corner-rivet rivet-br" />

      {/* Top Meta Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="paper-badge" style={{ fontSize: '11px', padding: '4px 10px', color: 'var(--amber-bright)' }}>
            ● ROOM AUDIO MESH
          </span>
          <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.8px' }}>
            SUB-20MS PCM SYNC
          </span>
        </div>

        <button
          onClick={() => setShowHowItWorks(!showHowItWorks)}
          className="btn-analog"
          style={{ fontSize: '11px', padding: '5px 12px', borderRadius: '20px' }}
        >
          <HelpCircle size={13} color="var(--amber-bright)" />
          <span>{showHowItWorks ? 'Hide Guide' : 'How It Works'}</span>
          {showHowItWorks ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Main Hero Headline & Reassuring Intro */}
      <div style={{ marginBottom: '22px' }}>
        <h1 className="font-serif" style={{
          fontSize: 'clamp(24px, 4.5vw, 36px)',
          fontWeight: '800',
          lineHeight: '1.2',
          letterSpacing: '-0.8px',
          color: 'var(--text-cream)',
          marginBottom: '10px'
        }}>
          Turn every phone in the room into a <span style={{ color: 'var(--amber-bright)' }}>surround sound system</span>.
        </h1>
        <p style={{
          fontSize: 'clamp(13px, 2vw, 15px)',
          color: 'var(--text-muted)',
          maxWidth: '740px',
          lineHeight: '1.6'
        }}>
          Play movies, Spotify, or music on your laptop or TV. Connect your friends’ phones in seconds — 
          delivering perfectly synchronized, room-filling sound without hauling around a heavy Bluetooth speaker.
        </p>
      </div>

      {/* 3-Step Human Guide Micro-Rack (Collapsible) */}
      {showHowItWorks && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '12px',
          marginBottom: '24px',
          background: 'rgba(14, 13, 12, 0.75)',
          padding: '16px',
          borderRadius: '16px',
          border: '1px solid var(--border-deck)'
        }}>
          {/* Step 1 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                width: '22px',
                height: '22px',
                borderRadius: '6px',
                background: 'var(--amber-core)',
                color: '#0c0b0a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: '800',
                fontFamily: 'monospace'
              }}>1</span>
              <strong style={{ fontSize: '13px', color: 'var(--text-cream)' }}>Pick Audio Source</strong>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4', margin: 0 }}>
              Host from your laptop or TV. Share Spotify, YouTube, Netflix tab sound, or drop any local media file.
            </p>
          </div>

          {/* Step 2 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                width: '22px',
                height: '22px',
                borderRadius: '6px',
                background: 'var(--amber-core)',
                color: '#0c0b0a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: '800',
                fontFamily: 'monospace'
              }}>2</span>
              <strong style={{ fontSize: '13px', color: 'var(--text-cream)' }}>Connect the Room</strong>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4', margin: 0 }}>
              Friends scan the QR code with their camera or tap the invite link. Works straight in Safari and Chrome.
            </p>
          </div>

          {/* Step 3 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                width: '22px',
                height: '22px',
                borderRadius: '6px',
                background: 'var(--amber-core)',
                color: '#0c0b0a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: '800',
                fontFamily: 'monospace'
              }}>3</span>
              <strong style={{ fontSize: '13px', color: 'var(--text-cream)' }}>Distribute & Party</strong>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4', margin: 0 }}>
              Scatter phones around the room. Assign Left, Right, or Subwoofer channels for immersive spatial audio.
            </p>
          </div>
        </div>
      )}

      {/* Mode Rocker Switch (Clean, Tactile, Prominent) */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        <div className="font-mono" style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '1px' }}>
          CHOOSE YOUR ROLE FOR THIS DEVICE:
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '10px'
        }}>
          {/* Host Selector */}
          <button
            onClick={() => setMode('host')}
            className="btn-analog"
            style={{
              padding: '16px 20px',
              justifyContent: 'flex-start',
              gap: '14px',
              borderRadius: '14px',
              background: mode === 'host' 
                ? 'linear-gradient(180deg, #2b251e 0%, #1e1914 100%)' 
                : 'linear-gradient(180deg, #181614 0%, #12100f 100%)',
              borderColor: mode === 'host' ? 'var(--amber-bright)' : 'var(--border-deck)',
              boxShadow: mode === 'host' ? '0 4px 20px var(--amber-glow), inset 0 1px 0 rgba(251, 191, 36, 0.2)' : 'none'
            }}
          >
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: mode === 'host' ? 'var(--amber-core)' : '#262320',
              color: mode === 'host' ? '#0c0b0a' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <Radio size={20} />
            </div>

            <div style={{ textAlign: 'left' }}>
              <div style={{
                fontSize: '14px',
                fontWeight: '700',
                color: mode === 'host' ? 'var(--amber-bright)' : 'var(--text-cream)'
              }}>
                🎙️ Host the Room (Broadcaster)
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Play Spotify, movies, or files on this screen and stream to everyone
              </div>
            </div>
          </button>

          {/* Receiver Selector */}
          <button
            onClick={() => setMode('receiver')}
            className="btn-analog"
            style={{
              padding: '16px 20px',
              justifyContent: 'flex-start',
              gap: '14px',
              borderRadius: '14px',
              background: mode === 'receiver' 
                ? 'linear-gradient(180deg, #2b251e 0%, #1e1914 100%)' 
                : 'linear-gradient(180deg, #181614 0%, #12100f 100%)',
              borderColor: mode === 'receiver' ? 'var(--amber-bright)' : 'var(--border-deck)',
              boxShadow: mode === 'receiver' ? '0 4px 20px var(--amber-glow), inset 0 1px 0 rgba(251, 191, 36, 0.2)' : 'none'
            }}
          >
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: mode === 'receiver' ? 'var(--amber-core)' : '#262320',
              color: mode === 'receiver' ? '#0c0b0a' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <Speaker size={20} />
            </div>

            <div style={{ textAlign: 'left' }}>
              <div style={{
                fontSize: '14px',
                fontWeight: '700',
                color: mode === 'receiver' ? 'var(--amber-bright)' : 'var(--text-cream)'
              }}>
                🎧 Tune In as Speaker (Receiver)
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Use this phone as a satellite speaker in someone's party room
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
