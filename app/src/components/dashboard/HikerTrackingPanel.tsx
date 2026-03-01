'use client';

import type { HikerState } from '@/hooks/useHikerTracking';

interface HikerTrackingPanelProps {
  hikerStates: HikerState[];
}

function SensorPip({ status, label }: { status: 'pending' | 'detected' | 'missed'; label: string }) {
  const bg =
    status === 'detected' ? '#00FF88' :
    status === 'missed'   ? '#FF3B3B' :
    '#2a3535';

  return (
    <div
      title={label}
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: bg,
        border: `1px solid ${status === 'pending' ? 'rgba(176,216,200,0.15)' : bg}`,
        flexShrink: 0,
        cursor: 'default',
        transition: 'background 0.35s',
      }}
    />
  );
}

export default function HikerTrackingPanel({ hikerStates }: HikerTrackingPanelProps) {
  const sorted = [...hikerStates].sort((a, b) => (b.deviated ? 1 : 0) - (a.deviated ? 1 : 0));
  const onTrackCount = hikerStates.filter(s => !s.deviated).length;
  const deviantCount = hikerStates.filter(s => s.deviated).length;

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {/* Panel heading */}
      <div className="panel-heading">
        <span className="panel-title">Hikers</span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {onTrackCount > 0 && (
            <span className="panel-badge" style={{ color: '#00FF88' }}>
              {onTrackCount} on-track
            </span>
          )}
          {deviantCount > 0 && (
            <span className="panel-badge" style={{ color: '#FF3B3B' }}>
              ⚠ {deviantCount}
            </span>
          )}
        </div>
      </div>

      {/* Hiker cards */}
      {sorted.map(hs => {
        const { hiker, sensorStates, logEntries, deviated } = hs;
        const borderColor = deviated ? '#FF3B3B' : '#00FF88';

        return (
          <div
            key={hiker.id}
            style={{
              borderLeft: `3px solid ${borderColor}`,
              padding: '10px 14px',
              borderBottom: '1px solid var(--db-border2)',
              background: deviated ? 'rgba(255,59,59,0.04)' : 'transparent',
              transition: 'border-color 0.3s, background 0.3s',
            }}
          >
            {/* Name + status row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '9px', color: borderColor }}>
                {deviated ? '◉' : '●'}
              </span>
              <span style={{
                fontSize: '0.65rem',
                color: 'var(--db-label)',
                flex: 1,
                fontWeight: 'bold',
                letterSpacing: '0.04em',
              }}>
                {hiker.name}
              </span>
              <span style={{
                fontSize: '0.58rem',
                color: borderColor,
                letterSpacing: '0.08em',
              }}>
                {deviated ? 'DEVIATED' : 'On Track'}
              </span>
            </div>

            {/* MAC + trail */}
            <div style={{
              fontSize: '0.57rem',
              color: 'var(--db-muted)',
              marginBottom: '7px',
              letterSpacing: '0.03em',
            }}>
              {hiker.mac} · {hiker.trail}
            </div>

            {/* Sensor pip row */}
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'nowrap' }}>
              {sensorStates.map(ss => (
                <SensorPip
                  key={ss.sensor.id}
                  status={ss.status}
                  label={`${ss.sensor.id}: ${ss.sensor.label}`}
                />
              ))}
              <div style={{
                fontSize: '0.52rem',
                color: 'var(--db-muted)',
                marginLeft: '4px',
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {sensorStates.map(ss => ss.sensor.id.replace('S-', '')).join(' → ')}
              </div>
            </div>

            {/* Timeline log — only for deviated hikers */}
            {deviated && logEntries.length > 0 && (
              <div style={{
                marginTop: '8px',
                borderTop: '1px solid rgba(255,59,59,0.15)',
                paddingTop: '6px',
                maxHeight: '90px',
                overflowY: 'auto',
              }}>
                {[...logEntries].reverse().map((entry, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: '0.56rem',
                      lineHeight: 1.8,
                      color: entry.status === 'missed' ? '#FF3B3B' : '#00FF88',
                      letterSpacing: '0.02em',
                      fontFamily: "'Share Tech Mono', monospace",
                    }}
                  >
                    [{entry.time}] {entry.sensorLabel} —{' '}
                    {entry.status === 'missed' ? 'NOT SEEN' : 'DETECTED'}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
