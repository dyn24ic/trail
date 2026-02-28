'use client';

import { useEffect, useRef } from 'react';

const sensorStates = [
  'ok','ok','ok','warn','ok','ok','alert','ok',
  'ok','off','ok','ok','warn','ok','ok','ok',
];

export default function LeftPanel() {
  const chargeBarRef = useRef<HTMLDivElement>(null);
  const chargePctRef = useRef<HTMLDivElement>(null);
  const chargeVal = useRef(30);

  useEffect(() => {
    const id = setInterval(() => {
      if (chargeVal.current < 100) {
        chargeVal.current = Math.min(100, chargeVal.current + 0.15);
        if (chargeBarRef.current) chargeBarRef.current.style.width = chargeVal.current.toFixed(1) + '%';
        if (chargePctRef.current) chargePctRef.current.textContent = Math.floor(chargeVal.current) + '%';
      }
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="panel">
      {/* Drone Fleet */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Drone Fleet</span>
          <span className="panel-badge">3/4 Ops</span>
        </div>

        <div className="drone-card">
          <div className="drone-header">
            <span className="drone-id">UAV-ALPHA-01</span>
            <span className="drone-status-badge badge-deployed">⬡ Deployed</span>
          </div>
          <div className="drone-meta">
            <span>Mission: <span>Active Search</span></span>
            <span>Alt: <span>380m AGL</span></span>
            <span>Speed: <span>12 m/s</span></span>
            <span>ETA Base: <span>18 min</span></span>
            <span>Thermal: <span style={{ color: 'var(--db-green)' }}>Active</span></span>
            <span>Sector: <span>Zone A-2</span></span>
          </div>
          <div className="battery-bar"><div className="battery-fill" style={{ width: '62%', background: 'var(--db-amber)' }}></div></div>
          <div className="battery-pct">62%</div>
        </div>

        <div className="drone-card">
          <div className="drone-header">
            <span className="drone-id">UAV-BETA-02</span>
            <span className="drone-status-badge badge-active">◉ Standby</span>
          </div>
          <div className="drone-meta">
            <span>Mission: <span>On Call</span></span>
            <span>Alt: <span>Ground</span></span>
            <span>Speed: <span>—</span></span>
            <span>Launch: <span style={{ color: 'var(--db-green)' }}>&lt;90 sec</span></span>
            <span>Thermal: <span style={{ color: 'var(--db-green)' }}>Ready</span></span>
            <span>Sector: <span>Base</span></span>
          </div>
          <div className="battery-bar"><div className="battery-fill" style={{ width: '88%', background: 'var(--db-green)' }}></div></div>
          <div className="battery-pct">88%</div>
        </div>

        <div className="drone-card">
          <div className="drone-header">
            <span className="drone-id">UAV-GAMMA-03</span>
            <span className="drone-status-badge badge-active">◉ Patrol</span>
          </div>
          <div className="drone-meta">
            <span>Mission: <span>Perimeter</span></span>
            <span>Alt: <span>220m AGL</span></span>
            <span>Speed: <span>8 m/s</span></span>
            <span>ETA Base: <span>34 min</span></span>
            <span>Thermal: <span style={{ color: 'var(--db-muted)' }}>Off</span></span>
            <span>Sector: <span>Trail B</span></span>
          </div>
          <div className="battery-bar"><div className="battery-fill" style={{ width: '45%', background: 'var(--db-amber)' }}></div></div>
          <div className="battery-pct">45%</div>
        </div>

        <div className="drone-card">
          <div className="drone-header">
            <span className="drone-id">UAV-DELTA-04</span>
            <span className="drone-status-badge badge-charging">⚡ Charging</span>
          </div>
          <div className="drone-meta">
            <span>Mission: <span>—</span></span>
            <span>Alt: <span>Ground</span></span>
            <span>Speed: <span>—</span></span>
            <span>Ready: <span style={{ color: 'var(--db-blue)' }}>~22 min</span></span>
            <span>Thermal: <span style={{ color: 'var(--db-muted)' }}>Offline</span></span>
            <span>Sector: <span>Hangar</span></span>
          </div>
          <div className="battery-bar">
            <div className="battery-fill" ref={chargeBarRef} style={{ width: '30%', background: 'var(--db-blue)' }}></div>
          </div>
          <div className="battery-pct" ref={chargePctRef}>30%</div>
        </div>
      </div>

      {/* Sensor Network */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Sensor Network</span>
          <span className="panel-badge">16 Nodes</span>
        </div>
        <div className="sensor-summary">
          <div className="sensor-row">
            <span className="sensor-label">Active / Nominal</span>
            <span className="sensor-count count-ok">12</span>
          </div>
          <div className="sensor-row">
            <span className="sensor-label">Alert / Motion Detected</span>
            <span className="sensor-count count-alert">1</span>
          </div>
          <div className="sensor-row">
            <span className="sensor-label">Warning / Elevated</span>
            <span className="sensor-count count-warn">2</span>
          </div>
          <div className="sensor-row">
            <span className="sensor-label">Offline / No Signal</span>
            <span className="sensor-count count-muted">1</span>
          </div>
        </div>
        <div className="mini-sensor-grid">
          {sensorStates.map((state, i) => (
            <div
              key={String(i)}
              className={`sensor-pixel sp-${state}`}
              data-id={String(i + 1).padStart(2, '0')}
              title={`Sensor S-${String(i + 1).padStart(2, '0')} · ${state.toUpperCase()}`}
            />
          ))}
        </div>
      </div>

      {/* Emergency Call Boxes */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Emergency Call Boxes</span>
          <span className="panel-badge">5 Units</span>
        </div>
        <div className="callbox-list">
          {[
            ['CB-01 · Trailhead Entrance',    'cb-ok',   '● ONLINE'],
            ['CB-02 · Nevada Falls Jct',       'cb-ok',   '● ONLINE'],
            ['CB-03 · Half Dome Base',         'cb-ok',   '● ONLINE'],
            ['CB-04 · Cables Route Mid',       'cb-warn', '⚠ LAST PING 6h'],
            ['CB-05 · Little Yosemite',        'cb-ok',   '● ONLINE'],
          ].map(([name, cls, status]) => (
            <div key={name} className="callbox-item">
              <span className="cb-name">{name}</span>
              <span className={`cb-status ${cls}`}>{status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Weather */}
      <div className="panel-section">
        <div className="panel-heading">
          <span className="panel-title">Environmental Conditions</span>
        </div>
        <div className="weather-grid">
          {([
            ['Temperature',       '14°C',    'Dropping to 4°C at 18:00',  false],
            ['Wind Speed',        '28 km/h', 'NW gusts to 42 km/h',       true],
            ['Visibility',        '14 km',   'Clear above 2400m',         false],
            ['Precip Forecast',   '62%',     'Snow likely above 3000m',   true],
            ['Daylight Remaining','3h 12m',  'Sunset 18:12 local',        false],
            ['Trail Condition',   'Moderate','Wet rock above 2800m',      true],
          ] as [string, string, string, boolean][]).map(([label, value, sub, warn]) => (
            <div key={label} className="weather-cell">
              <div className="w-label">{label}</div>
              <div className={`w-value${warn ? ' warn' : ''}`}>{value}</div>
              <div className="w-sub">{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
