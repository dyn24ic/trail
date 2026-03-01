'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker, Polyline, CircleMarker } from 'leaflet';
import type { HybridRoute, LatLon } from '@/types/backend';
import { YOSEMITE_BOUNDARY, WORLD_RING } from '@/data/yosemiteBoundary';

export type RoutingMode = 'set-ambulance' | 'set-victim' | 'view';

interface Props {
  mode: RoutingMode;
  ambulancePos: LatLon | null;
  victimPos: LatLon | null;
  hybridRoute: HybridRoute | null;
  onAmbulanceSet: (pos: LatLon) => void;
  onVictimSet: (pos: LatLon) => void;
}

// ── Elevation/hazard colour helper ─────────────────────────────────────────
function hazardColour(hazard: number): string {
  const t = Math.max(0, Math.min(1, hazard));
  if (t < 0.33) {
    const u = t / 0.33;
    return `rgb(${Math.round(34 + u * 200)},${Math.round(197 - u * 18)},${Math.round(94 - u * 86)})`;
  } else if (t < 0.66) {
    const u = (t - 0.33) / 0.33;
    return `rgb(${Math.round(234 + u * 15)},${Math.round(179 - u * 64)},${Math.round(8 + u * 14)})`;
  } else {
    const u = (t - 0.66) / 0.34;
    return `rgb(${Math.round(249 - u * 10)},${Math.round(115 - u * 47)},${Math.round(22 + u * 46)})`;
  }
}

// ── Custom marker HTML ──────────────────────────────────────────────────────
function ambulanceIcon(L: typeof import('leaflet')) {
  return L.divIcon({
    className: '',
    html: `<div style="width:36px;height:36px;background:#ef4444;border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 10px rgba(0,0,0,0.6);">🚑</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function victimIcon(L: typeof import('leaflet')) {
  return L.divIcon({
    className: '',
    html: `<div style="width:36px;height:36px;background:#3b82f6;border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 10px rgba(0,0,0,0.6);">🧍</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function stopIcon(L: typeof import('leaflet')) {
  return L.divIcon({
    className: '',
    html: `<div style="width:40px;height:40px;background:#f97316;border:3px solid #fff;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;font-family:monospace;box-shadow:0 2px 10px rgba(0,0,0,0.6);">STOP</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function victimEndpointIcon(L: typeof import('leaflet')) {
  return L.divIcon({
    className: '',
    html: `<div style="width:40px;height:40px;background:#dc2626;border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 0 12px rgba(220,38,38,0.8);">🎯</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

// ── Component ───────────────────────────────────────────────────────────────
export default function LeafletMapView({
  mode,
  ambulancePos,
  victimPos,
  hybridRoute,
  onAmbulanceSet,
  onVictimSet,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Marker refs
  const ambulanceMarkerRef = useRef<Marker | null>(null);
  const victimMarkerRef = useRef<Marker | null>(null);
  const stopMarkerRef = useRef<Marker | null>(null);
  const victimEndMarkerRef = useRef<Marker | null>(null);
  const roadPolyRef = useRef<Polyline | null>(null);
  const mountainPolylinesRef = useRef<(Polyline | CircleMarker)[]>([]);

  // Keep mode + callbacks in refs so the permanent click handler always sees latest values
  const modeRef = useRef(mode);
  const onAmbulanceSetRef = useRef(onAmbulanceSet);
  const onVictimSetRef = useRef(onVictimSet);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { onAmbulanceSetRef.current = onAmbulanceSet; }, [onAmbulanceSet]);
  useEffect(() => { onVictimSetRef.current = onVictimSet; }, [onVictimSet]);

  // ── Cursor update (safe to run whether map is ready or not) ──────────────
  useEffect(() => {
    mapRef.current?.getContainer()?.style.setProperty('cursor', mode !== 'view' ? 'crosshair' : '');
  }, [mode, mapReady]);

  // ── Initialise map once ──────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    // Inject Leaflet CSS via <link> – @import inside <style> is unreliable in React
    if (!document.getElementById('leaflet-css-link')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css-link';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    import('leaflet').then((L) => {
      if (mapRef.current || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [37.74, -119.58],
        zoom: 12,
        zoomControl: false,
      });

      // OpenTopoMap – terrain colours, rivers, contours; free, no API key
      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution:
          'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors, SRTM | Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
        maxZoom: 17,
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // ── Yosemite boundary fog of war ─────────────────────────────────────
      // evenodd fill rule: inside world ring (1 crossing) = filled;
      // inside Yosemite (2 crossings) = unfilled = map shows through.
      L.geoJSON(
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [WORLD_RING, YOSEMITE_BOUNDARY],
          },
        } as GeoJSON.Feature,
        {
          style: {
            fillColor: '#020608',
            fillOpacity: 0.72,
            stroke: false,
            fillRule: 'evenodd',
          },
          interactive: false,
        }
      ).addTo(map);

      // Park boundary dashed line
      L.geoJSON(
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: YOSEMITE_BOUNDARY,
          },
        } as GeoJSON.Feature,
        {
          style: {
            color: '#00FF88',
            weight: 2,
            opacity: 0.85,
            dashArray: '8 4',
          },
          interactive: false,
        }
      ).addTo(map);

      // Single permanent click handler reads current mode from ref
      map.on('click', (e) => {
        const pos: LatLon = { lat: e.latlng.lat, lon: e.latlng.lng };
        if (modeRef.current === 'set-ambulance') onAmbulanceSetRef.current(pos);
        else if (modeRef.current === 'set-victim') onVictimSetRef.current(pos);
      });

      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Ambulance marker ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    import('leaflet').then((L) => {
      ambulanceMarkerRef.current?.remove();
      ambulanceMarkerRef.current = null;
      if (ambulancePos) {
        ambulanceMarkerRef.current = L.marker(
          [ambulancePos.lat, ambulancePos.lon],
          { icon: ambulanceIcon(L), zIndexOffset: 500 }
        )
          .bindTooltip('🚑 Ambulance', { permanent: false })
          .addTo(map);
      }
    });
  }, [ambulancePos, mapReady]);

  // ── Victim marker ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    import('leaflet').then((L) => {
      victimMarkerRef.current?.remove();
      victimMarkerRef.current = null;
      if (victimPos) {
        victimMarkerRef.current = L.marker(
          [victimPos.lat, victimPos.lon],
          { icon: victimIcon(L), zIndexOffset: 500 }
        )
          .bindTooltip('🧍 Victim location', { permanent: false })
          .addTo(map);
      }
    });
  }, [victimPos, mapReady]);

  // ── Route display ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    import('leaflet').then((L) => {
      // Clear previous route layers
      roadPolyRef.current?.remove();
      roadPolyRef.current = null;
      mountainPolylinesRef.current.forEach((p) => p.remove());
      mountainPolylinesRef.current = [];
      stopMarkerRef.current?.remove();
      stopMarkerRef.current = null;
      victimEndMarkerRef.current?.remove();
      victimEndMarkerRef.current = null;

      if (!hybridRoute) return;

      const allPoints: [number, number][] = [];

      // ── Road segment – cyan polyline (ambulance → stop) ──────────────
      if (hybridRoute.roadPath.length > 1) {
        const roadCoords = hybridRoute.roadPath.map(
          (p) => [p.lat, p.lon] as [number, number]
        );
        allPoints.push(...roadCoords);
        roadPolyRef.current = L.polyline(roadCoords, {
          color: '#22d3ee',
          weight: 5,
          opacity: 0.9,
          dashArray: '10 5',
        })
          .bindTooltip('🚑 Road (ambulance drives)', { sticky: true })
          .addTo(map);
      }

      // ── Mountain segment – per-segment colour by hazard (stop → victim) ──
      const waypoints = hybridRoute.mountainRoute.route.waypoints;
      if (waypoints.length > 1) {
        for (let i = 0; i < waypoints.length - 1; i++) {
          const wp = waypoints[i];
          const wn = waypoints[i + 1];
          const colour = hazardColour(wp.hazard ?? 0);
          const seg = L.polyline(
            [
              [wp.lat, wp.lon],
              [wn.lat, wn.lon],
            ],
            { color: colour, weight: 6, opacity: 0.95 }
          ).addTo(map);
          mountainPolylinesRef.current.push(seg);
          allPoints.push([wp.lat, wp.lon]);
        }
        const lastWp = waypoints[waypoints.length - 1];
        allPoints.push([lastWp.lat, lastWp.lon]);
      }

      // ── Stop point marker (ambulance dismount) ───────────────────────
      const sp = hybridRoute.stopPoint;
      allPoints.push([sp.lat, sp.lon]);
      stopMarkerRef.current = L.marker([sp.lat, sp.lon], {
        icon: stopIcon(L),
        zIndexOffset: 1000,
      })
        .bindTooltip('🛑 Ambulance stops – medics walk from here', {
          permanent: false,
        })
        .addTo(map);

      // ── Victim endpoint marker (end of mountain route) ────────────────
      const lastWp = waypoints[waypoints.length - 1];
      if (lastWp) {
        allPoints.push([lastWp.lat, lastWp.lon]);
        victimEndMarkerRef.current = L.marker([lastWp.lat, lastWp.lon], {
          icon: victimEndpointIcon(L),
          zIndexOffset: 1200,
        })
          .bindTooltip('🎯 Victim – end of mountain route', {
            permanent: false,
          })
          .addTo(map);
      }

      // ── Fit map to show the full route ───────────────────────────────
      if (allPoints.length > 1) {
        map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] });
      }
    });
  }, [hybridRoute, mapReady]);

  // ── Mode cursor hint ──────────────────────────────────────────────────────
  const hintText =
    mode === 'set-ambulance'
      ? 'Click map to place ambulance'
      : mode === 'set-victim'
      ? 'Click map to place victim'
      : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Tooltip style overrides */}
      <style>{`
        .leaflet-tooltip {
          background: rgba(10,30,20,0.92) !important;
          border: 1px solid rgba(0,200,150,0.4) !important;
          color: #b0d8c8 !important;
          font-family: monospace !important;
          font-size: 11px !important;
          border-radius: 4px !important;
        }
        .leaflet-tooltip-tip { display: none !important; }
      `}</style>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {hintText && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            background: 'rgba(4,11,11,0.88)',
            border: '1.5px solid rgba(0,255,200,0.5)',
            color: '#00ffc8',
            fontFamily: 'monospace',
            fontSize: '12px',
            padding: '6px 18px',
            borderRadius: '4px',
            backdropFilter: 'blur(4px)',
            pointerEvents: 'none',
            letterSpacing: '0.05em',
          }}
        >
          {hintText}
        </div>
      )}
    </div>
  );
}
