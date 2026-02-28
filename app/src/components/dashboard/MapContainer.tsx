'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

const TerrainScene = dynamic(() => import('@/components/three/TerrainScene'), {
  ssr: false,
  loading: () => <div className="terrain-canvas" style={{ background: '#040B0B' }} />,
});

export default function MapContainer() {
  const [layers, setLayers] = useState({
    sensors: true,
    drones: true,
    incidents: true,
    zones: true,
    landmarks: true,
  });
  const [viewMode, setViewMode] = useState<'3d' | 'wireframe'>('3d');

  const toggle = (name: keyof typeof layers) => {
    setLayers((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div className="map-container">
      <div className="map-topbar">
        <div className="map-tab active">3D Terrain</div>
        <div className="map-tab">Risk Heatmap</div>
        <div className="map-tab">Incident Log</div>

        {/* View mode toggle */}
        <div className="view-toggle">
          <button
            className={`view-btn${viewMode === '3d' ? ' active' : ''}`}
            onClick={() => setViewMode('3d')}
          >
            3D
          </button>
          <button
            className={`view-btn${viewMode === 'wireframe' ? ' active' : ''}`}
            onClick={() => setViewMode('wireframe')}
          >
            Wire
          </button>
        </div>

        <div className="map-layers">
          {([
            ['sensors',   'sensors',   'var(--db-green)'],
            ['drones',    'drones',    'var(--db-amber)'],
            ['incidents', 'incidents', 'var(--db-red)'],
            ['zones',     'zones',     'var(--db-blue)'],
            ['landmarks', 'landmarks', '#FFD700'],
          ] as const).map(([key, label, color]) => (
            <div
              key={key}
              className={`layer-toggle${layers[key as keyof typeof layers] ? '' : ' off'}`}
              onClick={() => toggle(key as keyof typeof layers)}
            >
              <span className="layer-swatch" style={{ background: color }}></span>
              {label}
            </div>
          ))}
        </div>
      </div>

      <TerrainScene layers={layers} viewMode={viewMode} />

      <div className="scan-indicator">
        <span className="status-dot"></span>
        LIVE · Yosemite National Park · 37.7459°N 119.5332°W
      </div>

      <div className="map-hint">
        drag to orbit · scroll to zoom · right-drag to pan
      </div>

      <div className="map-coords">
        37°44&apos;45&quot;N&nbsp;&nbsp;119°31&apos;59&quot;W<br />
        Elev: 2696m&nbsp;&nbsp;&nbsp;MSL<br />
        Grid: 11S&nbsp;MT&nbsp;428&nbsp;863
      </div>

      <div className="map-overlay">
        <div className="overlay-title">Map Legend</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--db-green)' }}></span>Sensor · Nominal</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--db-amber)' }}></span>Drone · Active</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--db-red)' }}></span>Incident · Critical</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--db-yellow)' }}></span>Incident · Warning</div>
        <div className="legend-item"><span className="legend-line" style={{ background: 'rgba(74,159,212,0.6)' }}></span>Search Zone</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: '#FFD700' }}></span>Landmark</div>
      </div>

      <div id="source-badge" className="source-badge procedural">Procedural</div>
    </div>
  );
}
