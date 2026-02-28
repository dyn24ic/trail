'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { usePredictHotspots } from '@/lib/hotspots/usePredictHotspots';
import { YOSEMITE_BBOX } from '@/data/trailBbox';
import type { DangerZone } from '@/types/backend';
import type { CameraControls } from '@/components/three/TerrainScene';

// ── Coordinate utilities ───────────────────────────────────────────────────

function toDMS(dd: number, isLat: boolean): string {
  const abs = Math.abs(dd);
  const deg = Math.floor(abs);
  const minF = (abs - deg) * 60;
  const min  = Math.floor(minF);
  const sec  = Math.round((minF - min) * 60);
  const dir  = isLat ? (dd >= 0 ? 'N' : 'S') : (dd >= 0 ? 'E' : 'W');
  return `${deg}°${String(min).padStart(2, '0')}'${String(sec).padStart(2, '0')}"${dir}`;
}

function latLonToMGRS(lat: number, lon: number): string {
  // WGS84
  const a  = 6378137.0;
  const f  = 1 / 298.257223563;
  const b  = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const eP2 = e2 / (1 - e2);
  const k0 = 0.9996;

  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const zoneNum = Math.floor((lon + 180) / 6) + 1;
  const lon0 = (((zoneNum - 1) * 6 - 180 + 3) * Math.PI) / 180;

  const N  = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
  const T  = Math.tan(latR) ** 2;
  const C  = eP2 * Math.cos(latR) ** 2;
  const A  = Math.cos(latR) * (lonR - lon0);
  const e4 = e2 * e2, e6 = e4 * e2;

  const M = a * (
    (1 - e2/4 - 3*e4/64 - 5*e6/256)    * latR
    - (3*e2/8 + 3*e4/32  + 45*e6/1024)  * Math.sin(2*latR)
    + (15*e4/256 + 45*e6/1024)           * Math.sin(4*latR)
    - (35*e6/3072)                        * Math.sin(6*latR)
  );

  const easting = k0 * N * (
    A
    + (1 - T + C)                                          * A**3 / 6
    + (5 - 18*T + T**2 + 72*C - 58*eP2)                   * A**5 / 120
  ) + 500000;

  let northing = k0 * (
    M + N * Math.tan(latR) * (
      A**2 / 2
      + (5 - T + 9*C + 4*C**2)                            * A**4 / 24
      + (61 - 58*T + T**2 + 600*C - 330*eP2)              * A**6 / 720
    )
  );
  if (lat < 0) northing += 10000000;

  // Latitude band
  const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
  const band  = BANDS[Math.max(0, Math.min(19, Math.floor((lat + 80) / 8)))];

  // 100km column letter
  const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
  const colIdx   = Math.floor(easting / 100000) - 1;
  const colLetter = COL_SETS[(zoneNum - 1) % 3][Math.max(0, Math.min(7, colIdx))];

  // 100km row letter (20-letter cycle, I and O omitted)
  const ROW_SETS = ['ABCDEFGHJKLMNPQRSTUV', 'FGHJKLMNPQRSTUVABCDE'];
  const rowLetter = ROW_SETS[(zoneNum - 1) % 2][Math.floor(northing / 100000) % 20];

  // 100 m precision (3-digit)
  const eStr = String(Math.floor((easting  % 100000) / 100)).padStart(3, '0');
  const nStr = String(Math.floor((northing % 100000) / 100)).padStart(3, '0');

  return `${zoneNum}${band} ${colLetter}${rowLetter} ${eStr} ${nStr}`;
}

const TerrainScene = dynamic(() => import('@/components/three/TerrainScene'), {
  ssr: false,
  loading: () => <div className="terrain-canvas" style={{ background: '#040B0B' }} />,
});

interface MapContainerProps {
  leftOpen?: boolean;
  rightOpen?: boolean;
}

export default function MapContainer({ leftOpen = false, rightOpen = false }: MapContainerProps) {
  const lp = leftOpen ? 320 : 0;
  const rp = rightOpen ? 320 : 0;
  const [center, setCenter] = useState<{ lat: number; lon: number; elevM: number } | null>(null);
  const [layers, setLayers] = useState({
    sensors: true,
    drones: true,
    incidents: true,
    zones: true,
    landmarks: true,
    hotspots: true,
    osm: false,
  });
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d');
  const [focusMode, setFocusMode] = useState(false);
  const [boxZoomMode, setBoxZoomMode] = useState(false);
  const [satStatus, setSatStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
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
    <div className="map-container" style={{ position: 'absolute', inset: 0, '--lp': `${lp}px`, '--rp': `${rp}px` } as React.CSSProperties}>
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
        <button className={`tb-view-btn${viewMode === '3d' ? ' on' : ''}`} onClick={() => {
          setViewMode('3d');
          setLayers(prev => ({ ...prev, osm: false }));
        }}>3D</button>
        <button className={`tb-view-btn${viewMode === '2d' ? ' on' : ''}`} onClick={() => {
          setViewMode('2d');
          setLayers(prev => ({ ...prev, osm: true }));
        }}>2D</button>
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
        onSatStatus={setSatStatus}
        onCenterUpdate={(lat, lon, elevM) => setCenter({ lat, lon, elevM })}
      />

      {/* Box-zoom toggle — top-right corner of the map */}
      <button
        onClick={() => setBoxZoomMode(v => !v)}
        title="Drag to zoom into a region"
        style={{
          position: 'absolute',
          top: '12px',
          right: `${rp + 12}px`,
          transition: 'right 0.3s cubic-bezier(0.4,0,0.2,1)',
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

      {/* Satellite loading indicator */}
      {layers.osm && satStatus === 'loading' && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(4,11,11,0.88)',
          border: '1px solid rgba(136,187,255,0.5)',
          color: '#88bbff',
          borderRadius: '6px',
          padding: '10px 18px',
          fontSize: '12px',
          fontFamily: 'monospace',
          letterSpacing: '0.08em',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          pointerEvents: 'none',
          zIndex: 20,
          backdropFilter: 'blur(6px)',
        }}>
          <span style={{
            width: '10px', height: '10px', borderRadius: '50%',
            border: '2px solid rgba(136,187,255,0.3)',
            borderTopColor: '#88bbff',
            display: 'inline-block',
            animation: 'spin 0.9s linear infinite',
          }} />
          LOADING SATELLITE IMAGERY
        </div>
      )}

      <div className="scan-indicator">
        <span className="status-dot"></span>
        LIVE · Yosemite National Park · 37.7459°N 119.5332°W
      </div>

      <div className="map-hint">
        🖱 scroll / pinch to zoom &nbsp;·&nbsp; drag to orbit &nbsp;·&nbsp; ↑↓←→ to pan
      </div>

      <div className="map-coords">
        {center ? (
          <>
            {toDMS(center.lat, true)}&nbsp;&nbsp;{toDMS(center.lon, false)}<br />
            Elev: {center.elevM}m&nbsp;&nbsp;&nbsp;MSL<br />
            Grid: {latLonToMGRS(center.lat, center.lon).replace(/ /g, '\u00a0')}
          </>
        ) : (
          <>
            37°44&apos;45&quot;N&nbsp;&nbsp;119°31&apos;59&quot;W<br />
            Elev: —<br />
            Grid: —
          </>
        )}
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
        <div className="legend-item"><span className="legend-line" style={{ background: '#00E87A' }}></span>SAR Alpha Route</div>
        <div className="legend-item"><span className="legend-line" style={{ background: '#FF9500' }}></span>Ranger 7 Route</div>
        <div className="legend-item"><span className="legend-line" style={{ background: '#00CFFF' }}></span>Helicopter Arc</div>
      </div>

      <div id="source-badge" className="source-badge procedural">Procedural</div>
    </div>
  );
}
