'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import type mapboxgl from 'mapbox-gl';
import { usePredictHotspots } from '@/lib/hotspots/usePredictHotspots';
import { useIncidents } from '@/lib/incidents/useIncidents';
import { YOSEMITE_BBOX } from '@/data/trailBbox';
import type { DangerZone, IncidentSummary, LatLon } from '@/types/backend';
import type { IncidentMarker } from '@/types/markers';
import { droneData } from '@/data/drones';
import { incidentData as staticIncidentData } from '@/data/incidents';
import { useHybridRoute } from '@/hooks/useHybridRoute';
import RouteAnalysisPanel from './RouteAnalysisPanel';
import type { RoutingMode } from './LeafletMapView';
import { HikeNode, HikeStats, HikeRoute, YOSEMITE_EXAMPLE_ROUTE } from '@/lib/hikeRoute';
import HikeRoutePanel from './HikeRoutePanel';
import { useSensorSuggestions } from '@/hooks/useSensorSuggestions';
import DroneFlightPanel from './DroneFlightPanel';
import type { DroneSearchUpdate } from '@/data/dronePath';
import HikerAlertPanel from './HikerAlertPanel';
import type { DeviantHiker } from '@/hooks/useHikerTracking';

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
  deviantHikers?: DeviantHiker[];
}

export default function MapContainer({ onMapMove, deviantHikers = [] }: MapContainerProps) {
  const [sharedView, setSharedView] = useState({ lat: 37.74, lon: -119.58, zoom: 11 });
  const [mapboxFlyTo, setMapboxFlyTo] = useState<{ lat: number; lon: number; zoom: number; v: number } | null>(null);
  const [layers, setLayers] = useState({
    sensors: true,
    drones: true,
    incidents: true,
    zones: true,
    hotspots: true,
    osm: false,
  });
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d');
  const [focusMode, setFocusMode] = useState(false);
  const [dangerZones, setDangerZones] = useState<DangerZone[]>([]);
  const [routingMode, setRoutingMode] = useState<RoutingMode>('view');
  const [severity, setSeverity] = useState(3);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [hikeMode, setHikeMode] = useState(false);
  const [hikeWaypoints, setHikeWaypoints] = useState<HikeNode[]>([]);
  const [hikeStats, setHikeStats] = useState<HikeStats | null>(null);
  const [droneSearchActive, setDroneSearchActive] = useState(false);
  const [droneUpdate, setDroneUpdate] = useState<DroneSearchUpdate | null>(null);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const mapboxMapRef = useRef<mapboxgl.Map | null>(null);
  const prevDeviantIdsRef = useRef<string>('');
  const hikeNodeIdxRef = useRef(0);

  const hotspots = usePredictHotspots(YOSEMITE_BBOX);
  const { status: scanStatus, scanners, load: loadScanners, clear: clearScanners } = useSensorSuggestions();
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
  const allIncidentMarkers: IncidentMarker[] = [
    ...staticIncidentData,
    ...incidents.map(toIncidentMarker).filter((m): m is IncidentMarker => m !== null),
  ];

  const toggle = (name: keyof typeof layers) => {
    setLayers(prev => ({ ...prev, [name]: !prev[name] }));
  };

  useEffect(() => {
    if (hybridRoute) setShowAnalysis(true);
  }, [hybridRoute]);

  // Re-show alert when deviant set changes (new deviation cycle)
  useEffect(() => {
    const ids = deviantHikers.map(d => d.id).sort().join(',');
    if (ids !== prevDeviantIdsRef.current) {
      prevDeviantIdsRef.current = ids;
      if (ids !== '') setAlertDismissed(false);
    }
  }, [deviantHikers]);

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

  // Recompute hike stats when waypoints change
  useEffect(() => {
    setHikeStats(hikeWaypoints.length >= 2 ? HikeRoute.computeStats(hikeWaypoints) : null);
  }, [hikeWaypoints]);

  function handleHikeNodeAdded(pos: LatLon) {
    const idx = hikeNodeIdxRef.current++;
    setHikeWaypoints(prev => [...prev, { lat: pos.lat, lon: pos.lon, elevation_m: null }]);

    const map = mapboxMapRef.current;
    if (!map) return;

    const doQuery = () => {
      const elev = map.queryTerrainElevation([pos.lon, pos.lat], { exaggerated: false });
      if (elev != null) {
        map.off('idle', doQuery);
        setHikeWaypoints(cur => {
          if (cur[idx]?.lat !== pos.lat || cur[idx]?.lon !== pos.lon) return cur;
          const copy = [...cur];
          copy[idx] = { ...copy[idx], elevation_m: Math.round(elev) };
          return copy;
        });
      }
    };

    if (map.areTilesLoaded()) doQuery();
    else map.on('idle', doQuery);
  }

  function loadExampleRoute() {
    hikeNodeIdxRef.current = YOSEMITE_EXAMPLE_ROUTE.length;
    setHikeWaypoints([...YOSEMITE_EXAMPLE_ROUTE]);
    setMapboxFlyTo({ lat: 37.7323, lon: -119.5582, zoom: 13, v: Date.now() });

    const map = mapboxMapRef.current;
    if (!map) return;

    // Try to override hardcoded elevations with real DEM data
    const queryAll = () => {
      YOSEMITE_EXAMPLE_ROUTE.forEach((node, i) => {
        const elev = map.queryTerrainElevation([node.lon, node.lat], { exaggerated: false });
        if (elev != null) {
          setHikeWaypoints(cur => {
            const copy = [...cur];
            if (copy[i]) copy[i] = { ...copy[i], elevation_m: Math.round(elev) };
            return copy;
          });
        }
      });
    };

    if (map.areTilesLoaded()) queryAll();
    else map.once('idle', queryAll);
  }

  function clearHikeRoute() {
    setHikeWaypoints([]);
    setHikeStats(null);
    hikeNodeIdxRef.current = 0;
  }

  function handleMapboxMove(lat: number, lon: number, zoom: number) {
    setSharedView({ lat, lon, zoom });
    onMapMove?.(lat, lon);
  }

  function handleLeafletMove(lat: number, lon: number, zoom: number) {
    setSharedView({ lat, lon, zoom });
    onMapMove?.(lat, lon);
  }

  const layerDefs: [keyof typeof layers, string, string][] = [
    ['sensors',   'Sensors',   'var(--db-green)'],
    ['drones',    'Drones',    'var(--db-amber)'],
    ['incidents', 'Incidents', 'var(--db-red)'],
    ['zones',     'Zones',     'var(--db-blue)'],
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
          if (viewMode !== '3d') setMapboxFlyTo({ ...sharedView, v: Date.now() });
          setViewMode('3d');
          setLayers(prev => ({ ...prev, osm: false }));
        }}>3D</button>
        <button className={`tb-view-btn${viewMode === '2d' ? ' on' : ''}`} onClick={() => {
          setHikeMode(false);
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
            setHikeMode(false);
            setRoutingMode(prev => prev === 'set-ambulance' ? 'view' : 'set-ambulance');
            if (viewMode !== '2d') setViewMode('2d');
          }}
        >
          🚑 {ambulancePos ? '✓ Ambul.' : 'Set Ambul.'}
        </button>

        <button
          style={routingMode === 'set-victim' ? tbBtnOn : tbBtnBase}
          onClick={() => {
            setHikeMode(false);
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

        {/* Sensor Suggestions */}
        <div className="tb-sep" />
        <span className="tb-section-lbl">SENSORS</span>

        <button
          style={scanStatus === 'loaded' ? tbBtnOn : {
            ...tbBtnBase,
            opacity: scanStatus === 'loading' ? 0.6 : 1,
            cursor: scanStatus === 'loading' ? 'not-allowed' : 'pointer',
          }}
          disabled={scanStatus === 'loading'}
          onClick={() => {
            if (scanStatus === 'loaded') clearScanners();
            else loadScanners();
          }}
        >
          {scanStatus === 'loading'
            ? '📡 Scanning…'
            : scanStatus === 'loaded'
            ? '📡 Network ✓'
            : '📡 Suggest Sensors'}
        </button>

        {scanStatus === 'loaded' && scanners.length > 0 && (
          <div style={{ fontSize: '10px', color: 'rgba(168,85,247,0.6)', padding: '1px 0' }}>
            {scanners.length} scanners:{' '}
            {scanners.filter(s => s.type === 'trailhead').length} entry{' · '}
            {scanners.filter(s => s.type === 'junction').length} junction{' · '}
            {scanners.filter(s => s.type === 'destination').length} hotspot
          </div>
        )}

        {scanStatus === 'error' && (
          <div style={{ fontSize: '10px', color: '#ef4444', padding: '2px 0' }}>
            ✕ Scan failed
          </div>
        )}

        {/* Hike Planner */}
        <div className="tb-sep" />
        <span className="tb-section-lbl">HIKE PLAN</span>

        <button
          style={hikeMode ? tbBtnOn : tbBtnBase}
          onClick={() => {
            if (!hikeMode) setRoutingMode('view');
            setHikeMode(v => !v);
          }}
        >
          {hikeMode ? '+ Adding…' : '+ Add Node'}
        </button>

        <button
          style={tbBtnBase}
          onClick={loadExampleRoute}
        >
          ⬡ Load Example
        </button>

        {hikeWaypoints.length > 0 && (
          <button
            style={{ ...tbBtnBase, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
            onClick={clearHikeRoute}
          >
            ↺ Clear Route
          </button>
        )}

        {hikeWaypoints.length > 0 && (
          <div style={{ fontSize: '10px', color: 'rgba(176,216,200,0.4)', padding: '1px 0' }}>
            {hikeWaypoints.length} node{hikeWaypoints.length !== 1 ? 's' : ''}
          </div>
        )}

        {/* Drone SAR */}
        <div className="tb-sep" />
        <span className="tb-section-lbl">DRONE SAR</span>

        <button
          style={droneSearchActive ? tbBtnOn : tbBtnBase}
          onClick={() => {
            const next = !droneSearchActive;
            setDroneSearchActive(next);
            if (!next) {
              setDroneUpdate(null);
            } else {
              setViewMode('3d');
              setLayers(prev => ({ ...prev, osm: false }));
            }
          }}
        >
          {droneSearchActive ? '⬡ Abort Search' : '⬡ Launch SAR'}
        </button>

        {droneUpdate?.victimFound && (
          <div style={{ fontSize: '10px', color: '#ff6020', padding: '2px 0', letterSpacing: '0.04em' }}>
            ◉ VICTIM LOCATED
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
          onMove={handleMapboxMove}
          flyTo={mapboxFlyTo}
          hikeMode={hikeMode}
          hikeWaypoints={hikeWaypoints}
          onHikeNodeClick={handleHikeNodeAdded}
          onMapReady={(m) => { mapboxMapRef.current = m; }}
          bleScanners={scanners}
          droneData={droneData}
          incidentData={allIncidentMarkers}
          droneSearchActive={droneSearchActive}
          onDroneUpdate={setDroneUpdate}
          deviantHikers={deviantHikers.map(d => ({ id: d.id, name: d.name, lat: d.lat, lon: d.lon }))}
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
            initialView={sharedView}
            onMove={handleLeafletMove}
            hikeMode={hikeMode}
            hikeWaypoints={hikeWaypoints}
            onHikeNodeAdded={handleHikeNodeAdded}
            bleScanners={scanners}
            droneData={droneData}
            incidentData={allIncidentMarkers}
            dangerZones={dangerZones}
            layers={layers}
          />
        </div>
      )}

      {/* ── Hike route panel ──────────────────────────────────────────── */}
      {hikeStats && (
        <div style={{
          position: 'absolute', bottom: 48, right: 16,
          width: 300, zIndex: 820,
          pointerEvents: 'none',
        }}>
          <HikeRoutePanel waypoints={hikeWaypoints} stats={hikeStats} />
        </div>
      )}

      {/* ── Drone SAR flight panel ────────────────────────────────────── */}
      {droneSearchActive && (
        <div style={{
          position: 'absolute', bottom: 16, right: 16,
          width: 420, zIndex: 821, pointerEvents: 'none',
        }}>
          <DroneFlightPanel update={droneUpdate} />
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

      {/* ── Hiker alert panel ─────────────────────────────────────────── */}
      {deviantHikers.length > 0 && !alertDismissed && (
        <HikerAlertPanel
          deviants={deviantHikers}
          onDismiss={() => setAlertDismissed(true)}
        />
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
            {toDMS(sharedView.lat, true)}&nbsp;&nbsp;{toDMS(sharedView.lon, false)}<br />
            Grid: {latLonToMGRS(sharedView.lat, sharedView.lon).replace(/ /g, '\u00a0')}
          </div>

          <div className="map-overlay">
            <div className="overlay-title">Map Legend</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--db-green)' }} />Sensor · Nominal</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--db-amber)' }} />Drone · Active</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--db-red)' }} />Incident · Critical</div>
            <div className="legend-item"><span className="legend-line" style={{ background: 'rgba(74,159,212,0.6)' }} />Search Zone</div>
            <div className="legend-item">
              <span className="legend-dot" style={{ background: 'rgba(255,193,7,0.4)', border: '1.5px solid #FFC107', borderRadius: '2px', transform: 'rotate(45deg)' }} />
              Drone Hub
            </div>
            <div className="legend-item"><span className="legend-line" style={{ background: '#ef4444' }} />Trail · High Traffic</div>
            <div className="legend-item"><span className="legend-line" style={{ background: '#f59e0b' }} />Trail · Medium Traffic</div>
            <div className="legend-item"><span className="legend-line" style={{ background: '#22c55e' }} />Trail · Low Traffic</div>
            <div className="legend-item"><span className="legend-line" style={{ background: '#22d3ee' }} />Road Route</div>
            <div className="legend-item"><span className="legend-line" style={{ background: '#22c55e' }} />Mountain (Low)</div>
            <div className="legend-item"><span className="legend-line" style={{ background: '#ef4444' }} />Mountain (High Risk)</div>
          </div>
        </>
      )}
    </div>
  );
}
