'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { usePredictHotspots } from '@/lib/hotspots/usePredictHotspots';
import { useIncidents } from '@/lib/incidents/useIncidents';
import { YOSEMITE_BBOX } from '@/data/trailBbox';
import type { DangerZone, IncidentSummary } from '@/types/backend';
import type { IncidentMarker } from '@/types/markers';
import { useHybridRoute } from '@/hooks/useHybridRoute';
import RouteAnalysisPanel from './RouteAnalysisPanel';
import type { RoutingMode } from './LeafletMapView';

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

  const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
  const band  = BANDS[Math.max(0, Math.min(19, Math.floor((lat + 80) / 8)))];
  const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
  const colIdx   = Math.floor(easting / 100000) - 1;
  const colLetter = COL_SETS[(zoneNum - 1) % 3][Math.max(0, Math.min(7, colIdx))];
  const ROW_SETS = ['ABCDEFGHJKLMNPQRSTUV', 'FGHJKLMNPQRSTUVABCDE'];
  const rowLetter = ROW_SETS[(zoneNum - 1) % 2][Math.floor(northing / 100000) % 20];
  const eStr = String(Math.floor((easting  % 100000) / 100)).padStart(3, '0');
  const nStr = String(Math.floor((northing % 100000) / 100)).padStart(3, '0');

  return `${zoneNum}${band} ${colLetter}${rowLetter} ${eStr} ${nStr}`;
}

// ── Dynamic imports ────────────────────────────────────────────────────────

const MapboxScene = dynamic(() => import('./MapboxScene'), {
  ssr: false,
  loading: () => <div style={{ width: '100%', height: '100%', background: '#040B0B' }} />,
});

const LeafletMapView = dynamic(() => import('./LeafletMapView'), {
  ssr: false,
  loading: () => <div style={{ width: '100%', height: '100%', background: '#040B0B' }} />,
});

function toIncidentMarker(inc: IncidentSummary): IncidentMarker | null {
  if (inc.locationLat == null || inc.locationLng == null) return null;
  const isCritical = ['Triggered', 'Searching'].includes(inc.status);
  const isWarning  = ['VictimFound', 'Triaged', 'Routed'].includes(inc.status);
  return {
    id:       inc.id,
    lat:      inc.locationLat,
    lon:      inc.locationLng,
    color:    isCritical ? 0xFF3B3B : isWarning ? 0xFFD84A : 0x4A9FD4,
    severity: isCritical ? 'critical' : isWarning ? 'warning' : 'info',
  };
}

// ── Toolbar button styles (shared) ─────────────────────────────────────────
const tbBtnBase: React.CSSProperties = {
  background: 'none',
  border: '1px solid rgba(0,255,200,0.2)',
  color: '#7ab8b0',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '11px',
  padding: '4px 8px',
  borderRadius: '3px',
  letterSpacing: '0.04em',
  transition: 'all 0.15s',
  width: '100%',
  textAlign: 'left' as const,
};

const tbBtnOn: React.CSSProperties = {
  ...tbBtnBase,
  background: 'rgba(0,255,200,0.12)',
  border: '1px solid rgba(0,255,200,0.6)',
  color: '#00ffc8',
};

interface MapContainerProps {
  onMapMove?: (lat: number, lon: number) => void;
}

export default function MapContainer({ onMapMove }: MapContainerProps) {
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);
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
  const [dangerZones, setDangerZones] = useState<DangerZone[]>([]);
  const [routingMode, setRoutingMode] = useState<RoutingMode>('view');
  const [severity, setSeverity] = useState(3);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const hotspots = usePredictHotspots(YOSEMITE_BBOX);
  const {
    ambulancePos,
    victimPos,
    hybridRoute,
    status: routeStatus,
    setAmbulance,
    setVictim,
    computeRoute,
    reset: resetRoute,
  } = useHybridRoute();

  const { incidents } = useIncidents();
  const incidentMarkers: IncidentMarker[] = incidents
    .map(toIncidentMarker)
    .filter((m): m is IncidentMarker => m !== null);

  const toggle = (name: keyof typeof layers) => {
    setLayers(prev => ({ ...prev, [name]: !prev[name] }));
  };

  useEffect(() => {
    if (hybridRoute) setShowAnalysis(true);
  }, [hybridRoute]);

  useEffect(() => {
    const { west, south, east, north } = YOSEMITE_BBOX;
    fetch(`/api/terrain?west=${west}&south=${south}&east=${east}&north=${north}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.status === 'ok' && Array.isArray(data.danger_zones)) {
          setDangerZones(data.danger_zones);
        }
      })
      .catch(() => {});
  }, []);

  // Forward map move events to parent
  function handleMapMove(lat: number, lon: number) {
    setCenter({ lat, lon });
    onMapMove?.(lat, lon);
  }

  const layerDefs: [keyof typeof layers, string, string][] = [
    ['sensors',   'Sensors',   'var(--db-green)'],
    ['drones',    'Drones',    'var(--db-amber)'],
    ['incidents', 'Incidents', 'var(--db-red)'],
    ['zones',     'Zones',     'var(--db-blue)'],
    ['landmarks', 'Landmarks', '#FFD700'],
    ['osm',       'Satellite', '#88BBFF'],
  ];

  const canCompute = !!ambulancePos && !!victimPos && routeStatus !== 'computing';
  const isComputing = routeStatus === 'computing';

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
          title="Focus mode"
        >
          {focusMode ? '⊕ Active' : '⊕ Focus'}
        </button>
        <div className="tb-sep" />
        <div
          className={`layer-toggle${hotspots.status === 'loading' ? ' predicting' : ' load-action'}`}
          onClick={hotspots.status === 'idle' || hotspots.status === 'error' ? hotspots.load : undefined}
        >
          <span className="layer-swatch sq" style={{ background: '#ff8c42' }} />
          {hotspots.status === 'loading' ? 'Predicting…' : hotspots.status === 'loaded' ? 'Hotspots ✓' : 'Load Hotspots'}
        </div>

        {/* Route Planner */}
        <div className="tb-sep" />
        <span className="tb-section-lbl">ROUTE</span>

        <button
          style={routingMode === 'set-ambulance' ? tbBtnOn : tbBtnBase}
          onClick={() => {
            setRoutingMode(prev => prev === 'set-ambulance' ? 'view' : 'set-ambulance');
            if (viewMode !== '2d') setViewMode('2d');
          }}
        >
          🚑 {ambulancePos ? '✓ Ambul.' : 'Set Ambul.'}
        </button>

        <button
          style={routingMode === 'set-victim' ? tbBtnOn : tbBtnBase}
          onClick={() => {
            setRoutingMode(prev => prev === 'set-victim' ? 'view' : 'set-victim');
            if (viewMode !== '2d') setViewMode('2d');
          }}
        >
          🧍 {victimPos ? '✓ Victim' : 'Set Victim'}
        </button>

        <div style={{ display: 'flex', gap: '2px', width: '100%' }}>
          {[1, 2, 3, 4, 5].map(s => (
            <button
              key={s}
              onClick={() => setSeverity(s)}
              style={{
                flex: 1, padding: '3px 0',
                background: severity === s ? 'rgba(239,68,68,0.2)' : 'none',
                border: `1px solid ${severity === s ? '#ef4444' : 'rgba(0,255,200,0.15)'}`,
                color: severity === s ? '#ef4444' : '#7ab8b0',
                cursor: 'pointer', fontFamily: 'monospace', fontSize: '10px', borderRadius: '2px',
              }}
            >
              {s}
            </button>
          ))}
        </div>

        <button
          style={{
            ...tbBtnBase,
            opacity: canCompute ? 1 : 0.4,
            cursor: canCompute ? 'pointer' : 'not-allowed',
            background: canCompute ? 'rgba(0,255,200,0.06)' : 'none',
            borderColor: canCompute ? 'rgba(0,255,200,0.4)' : 'rgba(0,255,200,0.1)',
            color: canCompute ? '#00ffc8' : '#7ab8b0',
          }}
          onClick={() => { if (canCompute) { setRoutingMode('view'); computeRoute(severity); } }}
          disabled={!canCompute}
        >
          {isComputing ? '⟳ Computing…' : '▶ Compute Route'}
        </button>

        {(ambulancePos || victimPos || hybridRoute) && (
          <button
            style={{ ...tbBtnBase, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
            onClick={() => { resetRoute(); setRoutingMode('view'); setShowAnalysis(false); }}
          >
            ↺ Reset
          </button>
        )}

        {routeStatus === 'error' && (
          <div style={{ fontSize: '10px', color: '#ef4444', padding: '2px 0', lineHeight: 1.3 }}>
            ✕ Route failed
          </div>
        )}
      </div>

      {/* ── Mapbox Scene (3D terrain only) ────────────────────────────── */}
      <div style={{ display: viewMode === '3d' ? 'block' : 'none', position: 'absolute', inset: 0 }}>
        <MapboxScene
          viewMode={viewMode}
          layers={layers}
          dangerZones={dangerZones}
          hotspotData={hotspots.data}
          hybridRoute={hybridRoute}
          onMove={handleMapMove}
        />
      </div>

      {/* ── 2D Leaflet (always used in 2D mode) ───────────────────────── */}
      {viewMode === '2d' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
          <LeafletMapView
            mode={routingMode}
            ambulancePos={ambulancePos}
            victimPos={victimPos}
            hybridRoute={hybridRoute}
            onAmbulanceSet={(pos) => { setAmbulance(pos); setRoutingMode('view'); }}
            onVictimSet={(pos) => { setVictim(pos); setRoutingMode('view'); }}
          />
        </div>
      )}

      {/* ── Route analysis panel ──────────────────────────────────────── */}
      {hybridRoute && showAnalysis && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 800 }}>
          <div style={{ pointerEvents: 'auto' }}>
            <RouteAnalysisPanel
              hybridRoute={hybridRoute}
              onDismiss={() => setShowAnalysis(false)}
            />
          </div>
        </div>
      )}

      {/* Computing spinner */}
      {isComputing && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(4,11,11,0.92)', border: '1px solid rgba(0,255,200,0.4)',
          color: '#00ffc8', borderRadius: '8px', padding: '14px 24px',
          fontSize: '12px', fontFamily: 'monospace', letterSpacing: '0.08em',
          display: 'flex', alignItems: 'center', gap: '12px',
          zIndex: 850, backdropFilter: 'blur(8px)', pointerEvents: 'none',
        }}>
          <span style={{
            width: '12px', height: '12px', borderRadius: '50%',
            border: '2px solid rgba(0,255,200,0.3)', borderTopColor: '#00ffc8',
            display: 'inline-block', animation: 'spin 0.9s linear infinite',
          }} />
          COMPUTING OPTIMAL ROUTE…
        </div>
      )}

      {/* Box-zoom toggle (3D only) */}
      {viewMode === '3d' && (
        <button
          onClick={() => setBoxZoomMode(v => !v)}
          style={{
            position: 'absolute', top: '12px', right: '12px',
            padding: '6px 12px',
            background: boxZoomMode ? 'rgba(0,255,200,0.18)' : 'rgba(4,11,11,0.75)',
            border: `1.5px solid ${boxZoomMode ? 'rgba(0,255,200,0.9)' : 'rgba(0,255,200,0.3)'}`,
            color: boxZoomMode ? '#00ffc8' : '#7ab8b0',
            borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace',
            letterSpacing: '0.05em', cursor: 'pointer', backdropFilter: 'blur(4px)',
            zIndex: 10, userSelect: 'none',
          }}
        >
          {boxZoomMode ? '⬚ ZOOM ON' : '⬚ BOX ZOOM'}
        </button>
      )}

      {/* Scan indicator */}
      <div className="scan-indicator">
        <span className="status-dot" />
        LIVE · Yosemite National Park · 37.7459°N 119.5332°W
      </div>

      {viewMode === '3d' && (
        <>
          <div className="map-hint">
            🖱 scroll / pinch to zoom · drag to orbit
          </div>

          <div className="map-coords">
            {center ? (
              <>
                {toDMS(center.lat, true)}&nbsp;&nbsp;{toDMS(center.lon, false)}<br />
                Grid: {latLonToMGRS(center.lat, center.lon).replace(/ /g, '\u00a0')}
              </>
            ) : (
              <>37°44&apos;45&quot;N&nbsp;&nbsp;119°31&apos;59&quot;W<br />Grid: —</>
            )}
          </div>

          <div className="map-overlay">
            <div className="overlay-title">Map Legend</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--db-green)' }} />Sensor · Nominal</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--db-amber)' }} />Drone · Active</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--db-red)' }} />Incident · Critical</div>
            <div className="legend-item"><span className="legend-line" style={{ background: 'rgba(74,159,212,0.6)' }} />Search Zone</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: '#FFD700' }} />Landmark</div>
            <div className="legend-item"><span className="legend-line" style={{ background: '#22d3ee' }} />Road Route</div>
            <div className="legend-item"><span className="legend-line" style={{ background: '#22c55e' }} />Mountain (Low)</div>
            <div className="legend-item"><span className="legend-line" style={{ background: '#ef4444' }} />Mountain (High Risk)</div>
          </div>
        </>
      )}
    </div>
  );
}
