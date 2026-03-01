'use client';

import type { DeviantHiker } from '@/hooks/useHikerTracking';

interface HikerAlertPanelProps {
  deviants: DeviantHiker[];
  onDismiss: () => void;
}

export default function HikerAlertPanel({ deviants, onDismiss }: HikerAlertPanelProps) {
  const primary = deviants[0];
  if (!primary) return null;

  const lastDetected = primary.logEntries.filter(e => e.status === 'detected').at(-1);
  const missed = primary.logEntries.filter(e => e.status === 'missed');

  return (
    <div
      style={{
        position: 'absolute',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 840,
        background: 'rgba(4,11,11,0.95)',
        border: '1px solid rgba(255,59,59,0.65)',
        borderRadius: '6px',
        fontFamily: "'Share Tech Mono', monospace",
        fontSize: '11px',
        color: '#b0d8c8',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 0 32px rgba(255,59,59,0.18), 0 4px 20px rgba(0,0,0,0.7)',
        minWidth: '320px',
        maxWidth: '420px',
        pointerEvents: 'auto',
        animation: 'hiker-alert-in 0.3s ease-out',
      }}
    >
      <style>{`
        @keyframes hiker-alert-in {
          from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes hiker-alert-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.45; }
        }
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 12px',
        borderBottom: '1px solid rgba(255,59,59,0.22)',
        background: 'rgba(255,59,59,0.06)',
        borderRadius: '6px 6px 0 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            color: '#FF3B3B',
            fontSize: '14px',
            animation: 'hiker-alert-pulse 1.4s ease-in-out infinite',
          }}>
            ⚠
          </span>
          <span style={{ color: '#FF3B3B', letterSpacing: '0.1em', fontSize: '11px' }}>
            NEEDS ATTENTION — HIKER DEVIATION
          </span>
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(176,216,200,0.45)',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '0 0 0 10px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 12px' }}>
        {deviants.map(d => {
          const dLastDetected = d.logEntries.filter(e => e.status === 'detected').at(-1);
          const dMissed = d.logEntries.filter(e => e.status === 'missed');

          return (
            <div key={d.id} style={{ marginBottom: deviants.length > 1 ? '12px' : 0 }}>
              {/* Name row */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                <span style={{ color: '#FF3B3B', marginTop: '1px' }}>◉</span>
                <div>
                  <div style={{ color: '#FF3B3B', fontSize: '11px', letterSpacing: '0.06em', fontWeight: 'bold' }}>
                    {d.name}
                  </div>
                  <div style={{ fontSize: '10px', color: 'rgba(176,216,200,0.5)', marginTop: '1px' }}>
                    {d.mac} · {d.trail}
                  </div>
                </div>
              </div>

              {/* Last seen */}
              {dLastDetected && (
                <div style={{
                  fontSize: '10px',
                  padding: '4px 8px',
                  background: 'rgba(0,255,136,0.05)',
                  border: '1px solid rgba(0,255,136,0.14)',
                  borderRadius: '3px',
                  marginBottom: '5px',
                }}>
                  <span style={{ color: 'rgba(176,216,200,0.5)' }}>Last seen: </span>
                  <span style={{ color: '#00FF88' }}>{dLastDetected.sensorLabel}</span>
                  <span style={{ color: 'rgba(176,216,200,0.5)' }}> at </span>
                  <span style={{ color: '#00FF88' }}>{dLastDetected.time}</span>
                </div>
              )}

              {/* Missed checkpoints */}
              {dMissed.length > 0 && (
                <div style={{ fontSize: '10px', marginBottom: '6px' }}>
                  <div style={{ color: 'rgba(176,216,200,0.5)', marginBottom: '3px' }}>
                    Missed checkpoints:
                  </div>
                  {dMissed.map((m, i) => (
                    <div key={i} style={{ color: '#FF3B3B', paddingLeft: '8px', lineHeight: 1.8 }}>
                      ✕ {m.sensorLabel} [{m.time}]
                    </div>
                  ))}
                </div>
              )}

              {/* Last known coords */}
              <div style={{ fontSize: '10px', color: 'rgba(176,216,200,0.4)', display: 'flex', gap: '4px' }}>
                <span>Last known pos:</span>
                <span style={{ color: 'rgba(176,216,200,0.65)' }}>
                  {d.lat.toFixed(4)}°N {Math.abs(d.lon).toFixed(4)}°W
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
