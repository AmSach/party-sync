import React, { useState, useEffect } from 'react';
import { Battery, BatteryCharging, Zap, Power, Volume2, ShieldCheck, Sun } from 'lucide-react';

export default function UltraPowerSaver({ onWake, mode = 'host', activeMediaTitle = '' }) {
  const [time, setTime] = useState('');
  const [batteryInfo, setBatteryInfo] = useState({ level: null, charging: null });
  const [wakeConfirm, setWakeConfirm] = useState(false);

  // Digital Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Web Battery API (Supported on Chromium / Android)
  useEffect(() => {
    let batteryInstance = null;
    let listener = null;

    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      navigator.getBattery().then(battery => {
        batteryInstance = battery;
        listener = () => {
          setBatteryInfo({
            level: Math.round(battery.level * 100),
            charging: battery.charging
          });
        };
        listener();
        battery.addEventListener('levelchange', listener);
        battery.addEventListener('chargingchange', listener);
      }).catch(() => {});
    }

    return () => {
      if (batteryInstance && listener) {
        try {
          batteryInstance.removeEventListener('levelchange', listener);
          batteryInstance.removeEventListener('chargingchange', listener);
        } catch (e) {}
      }
    };
  }, []);

  const handleScreenTap = () => {
    if (!wakeConfirm) {
      setWakeConfirm(true);
      setTimeout(() => setWakeConfirm(false), 3500);
    } else {
      onWake();
    }
  };

  return (
    <div 
      onClick={handleScreenTap}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: '#000000', // Pure Pitch OLED Black (0mA pixel current)
        color: '#64748b',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '24px 20px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        cursor: 'pointer',
        fontFamily: 'monospace'
      }}
    >
      {/* Top Telemetry Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#10b981',
            boxShadow: '0 0 8px #10b981'
          }} />
          <span style={{ fontSize: '11px', color: '#10b981', letterSpacing: '1px', fontWeight: '700' }}>
            AUDIO STREAM ACTIVE
          </span>
        </div>

        {batteryInfo.level !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8' }}>
            {batteryInfo.charging ? (
              <BatteryCharging size={16} color="#10b981" />
            ) : (
              <Battery size={16} color={batteryInfo.level <= 20 ? '#ef4444' : '#94a3b8'} />
            )}
            <span>{batteryInfo.level}%</span>
          </div>
        )}
      </div>

      {/* Center Clock & Mode Indicator */}
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
        <div style={{ 
          display: 'inline-flex', 
          alignItems: 'center', 
          gap: '6px', 
          padding: '4px 12px', 
          borderRadius: '999px', 
          border: '1px solid #1e293b', 
          background: '#090d12',
          fontSize: '11px',
          color: '#38bdf8'
        }}>
          <Zap size={13} color="#38bdf8" />
          <span>ULTRA POWER SAVER • OLED BLACKOUT</span>
        </div>

        {/* Minimal Digital Clock */}
        <div style={{ 
          fontSize: '44px', 
          fontWeight: '700', 
          color: '#334155', 
          letterSpacing: '2px',
          lineHeight: '1',
          margin: '8px 0'
        }}>
          {time}
        </div>

        <div style={{ fontSize: '12px', color: '#475569', maxWidth: '300px', lineHeight: '1.4' }}>
          {mode === 'host' ? '🎙️ HOST TRANSMITTER' : '🎧 SATELLITE SPEAKER'}
          {activeMediaTitle && (
            <div style={{ color: '#64748b', fontSize: '11px', marginTop: '2px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              ● {activeMediaTitle}
            </div>
          )}
        </div>

        <div style={{ 
          fontSize: '10px', 
          color: '#334155', 
          letterSpacing: '0.5px',
          marginTop: '6px'
        }}>
          GPU & Visualizers Halted • Web Audio Active • Screen WakeLock
        </div>
      </div>

      {/* Bottom Wake Action / Confirm Banner */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
        {wakeConfirm ? (
          <button 
            onClick={(e) => { e.stopPropagation(); onWake(); }}
            style={{
              padding: '12px 24px',
              borderRadius: '12px',
              border: '1px solid #38bdf8',
              background: '#0c1a24',
              color: '#38bdf8',
              fontSize: '13px',
              fontWeight: '700',
              fontFamily: 'monospace',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              boxShadow: '0 0 20px rgba(56, 189, 248, 0.25)'
            }}
          >
            <Sun size={16} />
            <span>TAP AGAIN TO WAKE CONSOLE</span>
          </button>
        ) : (
          <div style={{ 
            fontSize: '11px', 
            color: '#334155', 
            letterSpacing: '1px',
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid #0f172a'
          }}>
            [ TAP SCREEN TO WAKE ]
          </div>
        )}
      </div>
    </div>
  );
}
