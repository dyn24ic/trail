'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { usePredictHotspots } from '@/lib/hotspots/usePredictHotspots';
import { YOSEMITE_BBOX } from '@/data/trailBbox';
import type { DangerZone } from '@/types/backend';
import type { CameraControls } from '@/components/three/TerrainScene';

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
    hotspots: true,
    osm: false,
  });
  const [viewMode, setViewMode] = useState<'3d' | 'wireframe'>('3d');
  const [focusMode, setFocusMode] = useState(false);
  const [boxZoomMode, setBoxZoomMode] = useState(false);
  const [dangerZones, setDangerZones] = useState<DangerZone[]>([]);
  const cameraControlsRef = useRef<CameraControls | null>(null);

  const hotspots = usePredictHotspots(YOSEMITE_BBOX);

  const toggle = (name: keyof typeof layers) => {
    setLayers((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  // Fetch backend terrain danger zones for the Yosemite bounding box
  useEffect(() => {
    const { west, south, east, north } = YOSEMITE_BBOX;
    fetch(`/api/terrain?west=${west}&south=${south}&east=${east}&north=${north}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.status === 'ok' && Array.isArray(data.danger_zones)) {
          setDangerZones(data.danger_zones);
        }
      })
      .catch(() => {/* silently ignore if backend unavailable */});
  }, []);

  const layerDefs: [keyof typeof layers, string, string][] = [
    ['sensors',   'Sensors',   'var(--db-green)'],
    ['drones',    'Drones',    'var(--db-amber)'],
    ['incidents', 'Incidents', 'var(--db-red)'],
    ['zones',     'Zones',     'var(--db-blue)'],
    ['landmarks', 'Landmarks', '#FFD700'],
    ['osm',       'Satellite', '#88BBFF'],
  ];

  return (
    <div className="map-container" style={{ position: 'absolute', inset: 0 }}>
      {/* Floating vertical toolbar */}
      <div className="map-toolbar">
        <span className="tb-section-lbl">LAYERS</span>
        {layerDefs.map(([key, label, color]) => (
          <button
            key={key}
            className={`tb-layer-btn${layers[key] ? ' on' : ''}`}
            style={{ '--lc': color } as React.CSSProperties}
            onClick={() => toggle(key)}
          >
            <span className="tb-dot" />{label}
          </button>
        ))}
        <div className="tb-sep" />
        <span className="tb-section-lbl">VIEW</span>
        <button className={`tb-view-btn${viewMode === '3d' ? ' on' : ''}`} onClick={() => setViewMode('3d')}>3D</button>
        <button className={`tb-view-btn${viewMode === 'wireframe' ? ' on' : ''}`} onClick={() => setViewMode('wireframe')}>Wire</button>
        <div className="tb-sep" />
        <button
          className={`tb-focus-btn${focusMode ? ' on' : ''}`}
          onClick={() => setFocusMode(v => !v)}
          title="Click terrain to zoom in"
        >
          {focusMode ? '⊕ Active' : '⊕ Focus'}
        </button>
        <button
          className="tb-focus-btn"
          onClick={() => cameraControlsRef.current?.topView()}
          title="Top-down view"
        >
          ⌂ Home
        </button>
        <div className="tb-sep" />
        <div
          className={`layer-toggle${hotspots.status === 'loading' ? ' predicting' : ' load-action'}`}
          onClick={hotspots.status === 'idle' || hotspots.status === 'error' ? hotspots.load : undefined}
        >
          <span className="layer-swatch sq" style={{ background: '#ff8c42' }} />
          {hotspots.status === 'loading'
            ? 'Predicting…'
            : hotspots.status === 'loaded'
              ? 'Hotspots ✓'
              : 'Load Hotspots'}
        </div>
      </div>

      <TerrainScene
        layers={layers}
        viewMode={viewMode}
        focusMode={focusMode}
        boxZoomMode={boxZoomMode}
        dangerZones={dangerZones}
        hotspotData={hotspots.data}
        placementData={hotspots.placement}
        onControlsReady={(ctrl) => { cameraControlsRef.current = ctrl; }}
      />

      {/* Box-zoom toggle — top-right corner of the map */}
      <button
        onClick={() => setBoxZoomMode(v => !v)}
        title="Drag to zoom into a region"
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          padding: '6px 12px',
          background: boxZoomMode ? 'rgba(0,255,200,0.18)' : 'rgba(4,11,11,0.75)',
          border: `1.5px solid ${boxZoomMode ? 'rgba(0,255,200,0.9)' : 'rgba(0,255,200,0.3)'}`,
          color: boxZoomMode ? '#00ffc8' : '#7ab8b0',
          borderRadius: '4px',
          fontSize: '11px',
          fontFamily: 'monospace',
          letterSpacing: '0.05em',
          cursor: 'pointer',
          backdropFilter: 'blur(4px)',
          zIndex: 10,
          userSelect: 'none',
        }}
      >
        {boxZoomMode ? '⬚ ZOOM ON' : '⬚ BOX ZOOM'}
      </button>

      <div className="scan-indicator">
        <span className="status-dot"></span>
        LIVE · Yosemite National Park · 37.7459°N 119.5332°W
      </div>

      <div className="map-hint">
        🖱 scroll / pinch to zoom &nbsp;·&nbsp; drag to orbit &nbsp;·&nbsp; ↑↓←→ to pan
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
        <div className="legend-item"><span className="legend-line" style={{ background: '#88BBFF' }}></span>OSM Overlay</div>
      </div>

      <div id="source-badge" className="source-badge procedural">Procedural</div>
    </div>
  );
}
