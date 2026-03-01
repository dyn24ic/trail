'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker, Polyline, CircleMarker, Polygon, TileLayer } from 'leaflet';
import type { HybridRoute, LatLon, DangerZone } from '@/types/backend';
import type { HikeNode } from '@/lib/hikeRoute';
import { YOSEMITE_BOUNDARY, WORLD_RING } from '@/data/yosemiteBoundary';
import { TRAIL_SEGMENTS } from '@/data/trailSegments';
import type { BleScannerSuggestion, DroneMarker, IncidentMarker } from '@/types/markers';

export type RoutingMode = 'set-ambulance' | 'set-victim' | 'view';

interface Props {
  mode: RoutingMode;
  ambulancePos: LatLon | null;
  victimPos: LatLon | null;
  hybridRoute: HybridRoute | null;
  onAmbulanceSet: (pos: LatLon) => void;
  onVictimSet: (pos: LatLon) => void;
  initialView?: { lat: number; lon: number; zoom: number };
  onMove?: (lat: number, lon: number, zoom: number) => void;
  hikeMode?: boolean;
  hikeWaypoints?: HikeNode[];
  onHikeNodeAdded?: (pos: LatLon) => void;
  bleScanners?: BleScannerSuggestion[];
  droneData?: DroneMarker[];
  incidentData?: IncidentMarker[];
  dangerZones?: DangerZone[];
  layers?: {
    sensors: boolean;
    drones: boolean;
    incidents: boolean;
    zones: boolean;
    hotspots: boolean;
    osm: boolean;
  };
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
  initialView,
  onMove,
  hikeMode,
  hikeWaypoints,
  onHikeNodeAdded,
  bleScanners = [],
  droneData = [],
  incidentData = [],
  dangerZones = [],
  layers,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Routing marker refs
  const ambulanceMarkerRef = useRef<Marker | null>(null);
  const victimMarkerRef = useRef<Marker | null>(null);
  const stopMarkerRef = useRef<Marker | null>(null);
  const victimEndMarkerRef = useRef<Marker | null>(null);
  const roadPolyRef = useRef<Polyline | null>(null);
  const mountainPolylinesRef = useRef<(Polyline | CircleMarker)[]>([]);

  // Hike refs
  const hikeModeRef = useRef(hikeMode ?? false);
  const onHikeNodeAddedRef = useRef(onHikeNodeAdded);
  const hikeMarkersRef = useRef<CircleMarker[]>([]);
  const hikePolyRef = useRef<Polyline | null>(null);

  // BLE scanner refs
  const bleMarkersRef = useRef<CircleMarker[]>([]);

  // Drone / incident / zone / satellite refs
  const droneLeafletRefs    = useRef<Marker[]>([]);
  const incidentLeafletRefs = useRef<CircleMarker[]>([]);
  const zoneLeafletRefs     = useRef<Polygon[]>([]);
  const satelliteTileRef    = useRef<TileLayer | null>(null);

  // Keep mode + callbacks in refs so the permanent click handler always sees latest values
  const modeRef = useRef(mode);
  const onAmbulanceSetRef = useRef(onAmbulanceSet);
  const onVictimSetRef = useRef(onVictimSet);
  const onMoveRef = useRef(onMove);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { onAmbulanceSetRef.current = onAmbulanceSet; }, [onAmbulanceSet]);
  useEffect(() => { onVictimSetRef.current = onVictimSet; }, [onVictimSet]);
  useEffect(() => { hikeModeRef.current = hikeMode ?? false; }, [hikeMode]);
  useEffect(() => { onHikeNodeAddedRef.current = onHikeNodeAdded; }, [onHikeNodeAdded]);

  // ── Cursor update ─────────────────────────────────────────────────────────
  useEffect(() => {
    mapRef.current?.getContainer()?.style.setProperty(
      'cursor',
      (mode !== 'view' || hikeMode) ? 'crosshair' : ''
    );
  }, [mode, hikeMode, mapReady]);

  // ── Initialise map once ──────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    if (!document.getElementById('leaflet-css-link')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css-link';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    import('leaflet').then((L) => {
      if (mapRef.current || !containerRef.current) return;

      const initCenter: [number, number] = initialView
        ? [initialView.lat, initialView.lon]
        : [37.74, -119.58];
      const initZoom = initialView?.zoom ?? 12;

      const map = L.map(containerRef.current, {
        center: initCenter,
        zoom: initZoom,
        zoomControl: false,
      });

      // OpenTopoMap base layer
      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution:
          'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors, SRTM | Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
        maxZoom: 17,
      }).addTo(map);

      // Create satellite tile layer (not added yet — toggled via layers.osm)
      satelliteTileRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri', maxZoom: 19, opacity: 0.95 }
      );

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Yosemite boundary fog of war
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

      // ── Trail traffic overlay ────────────────────────────────────────────
      const trafficColor = (t: string) =>
        t === 'high' ? '#ef4444' : t === 'medium' ? '#f59e0b' : '#22c55e';

      TRAIL_SEGMENTS.forEach(seg => {
        const latlngs = seg.coords.map(([lon, lat]) => [lat, lon] as [number, number]);
        L.polyline(latlngs, {
          color: trafficColor(seg.traffic),
          weight: 4,
          opacity: 0.85,
          interactive: true,
        })
          .bindTooltip(seg.name, { sticky: true })
          .addTo(map);
      });

      // Permanent click handler
      map.on('click', (e) => {
        const pos: LatLon = { lat: e.latlng.lat, lon: e.latlng.lng };
        if (hikeModeRef.current) {
          onHikeNodeAddedRef.current?.(pos);
          return;
        }
        if (modeRef.current === 'set-ambulance') onAmbulanceSetRef.current(pos);
        else if (modeRef.current === 'set-victim') onVictimSetRef.current(pos);
      });

      map.on('move', () => {
        const c = map.getCenter();
        onMoveRef.current?.(c.lat, c.lng, map.getZoom());
      });

      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      satelliteTileRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Ambulance marker ──────────────────────────────────────────────────────
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

  // ── Victim marker ─────────────────────────────────────────────────────────
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

  // ── Route display ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    import('leaflet').then((L) => {
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

      const waypoints = hybridRoute.mountainRoute.route.waypoints;
      if (waypoints.length > 1) {
        for (let i = 0; i < waypoints.length - 1; i++) {
          const wp = waypoints[i];
          const wn = waypoints[i + 1];
          const colour = hazardColour(wp.hazard ?? 0);
          const seg = L.polyline(
            [[wp.lat, wp.lon], [wn.lat, wn.lon]],
            { color: colour, weight: 6, opacity: 0.95 }
          ).addTo(map);
          mountainPolylinesRef.current.push(seg);
          allPoints.push([wp.lat, wp.lon]);
        }
        const lastWp = waypoints[waypoints.length - 1];
        allPoints.push([lastWp.lat, lastWp.lon]);
      }

      const sp = hybridRoute.stopPoint;
      allPoints.push([sp.lat, sp.lon]);
      stopMarkerRef.current = L.marker([sp.lat, sp.lon], {
        icon: stopIcon(L),
        zIndexOffset: 1000,
      })
        .bindTooltip('🛑 Ambulance stops – medics walk from here', { permanent: false })
        .addTo(map);

      const lastWp = waypoints[waypoints.length - 1];
      if (lastWp) {
        allPoints.push([lastWp.lat, lastWp.lon]);
        victimEndMarkerRef.current = L.marker([lastWp.lat, lastWp.lon], {
          icon: victimEndpointIcon(L),
          zIndexOffset: 1200,
        })
          .bindTooltip('🎯 Victim – end of mountain route', { permanent: false })
          .addTo(map);
      }

      if (allPoints.length > 1) {
        map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] });
      }
    });
  }, [hybridRoute, mapReady]);

  // ── Hike route drawing ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    import('leaflet').then((L) => {
      hikeMarkersRef.current.forEach(m => m.remove());
      hikeMarkersRef.current = [];
      hikePolyRef.current?.remove();
      hikePolyRef.current = null;

      const nodes = hikeWaypoints ?? [];
      if (nodes.length === 0) return;

      if (nodes.length >= 2) {
        const coords = nodes.map(n => [n.lat, n.lon] as [number, number]);
        hikePolyRef.current = L.polyline(coords, {
          color: '#00ffc8',
          weight: 3,
          dashArray: '8 5',
          opacity: 0.9,
        }).addTo(map);
      }

      nodes.forEach((node, i) => {
        const isStart = i === 0;
        const isEnd   = i === nodes.length - 1;
        const fillColor = isStart ? '#22c55e' : isEnd ? '#ef4444' : '#00ffc8';
        const radius    = (isStart || isEnd) ? 9 : 6;

        const elevLine = node.elevation_m !== null
          ? `<br/>${node.elevation_m} m`
          : '<br/>pending…';

        const label = isStart
          ? `▶ Start${elevLine}`
          : isEnd
          ? `■ End${elevLine}`
          : `● Node ${i + 1}${elevLine}`;

        const marker = L.circleMarker([node.lat, node.lon], {
          radius,
          fillColor,
          color: '#fff',
          weight: 2,
          fillOpacity: 1,
        })
          .bindTooltip(label, { permanent: false })
          .addTo(map);

        hikeMarkersRef.current.push(marker);
      });
    });
  }, [hikeWaypoints, mapReady]);

  // ── BLE scanner markers ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    import('leaflet').then((L) => {
      bleMarkersRef.current.forEach(m => m.remove());
      bleMarkersRef.current = [];

      bleScanners.forEach(scanner => {
        const isTrailhead   = scanner.type === 'trailhead';
        const isDestination = scanner.type === 'destination';
        const color  = isTrailhead ? '#a855f7' : isDestination ? '#f97316' : '#7c3aed';
        const radius = isTrailhead ? 10 : isDestination ? 6 : 7;

        const marker = L.circleMarker([scanner.lat, scanner.lon], {
          radius,
          fillColor: color,
          color: '#ffffff',
          weight: 1.5,
          fillOpacity: 0.95,
        })
          .bindTooltip(`${scanner.name}\n${scanner.rationale}`, { permanent: false })
          .addTo(map);

        bleMarkersRef.current.push(marker);
      });
    });
  }, [bleScanners, mapReady]);

  // ── Drone markers ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    import('leaflet').then((L) => {
      droneLeafletRefs.current.forEach(m => m.remove());
      droneLeafletRefs.current = [];

      const show = layers?.drones ?? true;

      droneData.forEach(drone => {
        // Hub — amber rotated diamond
        const hubIcon = L.divIcon({
          className: '',
          html: `<div style="width:10px;height:10px;background:rgba(255,193,7,0.5);border:1.5px solid #FFC107;transform:rotate(45deg);"></div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        });
        const hubMarker = L.marker([drone.hubLat, drone.hubLon], { icon: hubIcon })
          .bindTooltip(`Hub: ${drone.label}`, { permanent: false })
          .addTo(map);
        hubMarker.setOpacity(show ? 1 : 0);
        droneLeafletRefs.current.push(hubMarker);

        // Drone — amber circle + ✈ + altitude badge
        const droneIcon = L.divIcon({
          className: '',
          html: `<div style="position:relative;width:24px;height:24px;">
            <div style="position:absolute;inset:0;border-radius:50%;background:rgba(255,193,7,0.25);border:1.5px solid #FFC107;"></div>
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#FFC107;">✈</div>
            <div style="position:absolute;top:-13px;left:50%;transform:translateX(-50%);font-size:8px;color:#FFC107;white-space:nowrap;font-family:monospace;background:rgba(4,11,11,0.85);padding:1px 3px;border-radius:2px;">+${drone.alt}m</div>
          </div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const droneMarker = L.marker([drone.lat, drone.lon], { icon: droneIcon })
          .bindTooltip(`${drone.id} — ${drone.label}\nAlt: ${drone.alt}m AGL`, { permanent: false })
          .addTo(map);
        droneMarker.setOpacity(show ? 1 : 0);
        droneLeafletRefs.current.push(droneMarker);
      });
    });
  }, [droneData, mapReady]);

  // ── Drone visibility toggle ───────────────────────────────────────────────
  useEffect(() => {
    const show = layers?.drones ?? true;
    droneLeafletRefs.current.forEach(m => m.setOpacity(show ? 1 : 0));
  }, [layers?.drones]);

  // ── Incident markers ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    import('leaflet').then((L) => {
      incidentLeafletRefs.current.forEach(m => m.remove());
      incidentLeafletRefs.current = [];

      const show = layers?.incidents ?? true;

      incidentData.forEach(inc => {
        const isCritical = inc.severity === 'critical';
        const radius     = isCritical ? 12 : 9;
        const color      = isCritical ? '#FF3B3B' : '#FFC107';

        const marker = L.circleMarker([inc.lat, inc.lon], {
          radius,
          fillColor: color,
          color: color,
          weight: 2,
          fillOpacity: show ? 0.5 : 0,
          opacity: show ? 0.9 : 0,
        })
          .bindTooltip(inc.label ?? inc.id, { permanent: false })
          .addTo(map);

        incidentLeafletRefs.current.push(marker);
      });
    });
  }, [incidentData, mapReady]);

  // ── Incident visibility toggle ────────────────────────────────────────────
  useEffect(() => {
    const show = layers?.incidents ?? true;
    incidentLeafletRefs.current.forEach(m => {
      m.setStyle({ fillOpacity: show ? 0.5 : 0, opacity: show ? 0.9 : 0 });
    });
  }, [layers?.incidents]);

  // ── Zone polygons ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !dangerZones.length) return;

    import('leaflet').then((L) => {
      zoneLeafletRefs.current.forEach(p => p.remove());
      zoneLeafletRefs.current = [];

      const show = layers?.zones ?? true;

      dangerZones.forEach(zone => {
        const sw = zone.bounds.sw;
        const ne = zone.bounds.ne;
        const corners: [number, number][] = [
          [sw.lat, sw.lon],
          [sw.lat, ne.lon],
          [ne.lat, ne.lon],
          [ne.lat, sw.lon],
        ];

        let fillColor: string;
        if (zone.hazard_score > 0.66)      fillColor = '#FF3B3B';
        else if (zone.hazard_score > 0.33) fillColor = '#FF8C42';
        else                               fillColor = '#4A9FD4';

        const poly = L.polygon(corners, {
          fillColor,
          fillOpacity: show ? 0.35 : 0,
          color: fillColor,
          weight: show ? 1 : 0,
          opacity: show ? 0.6 : 0,
          interactive: false,
        }).addTo(map);

        zoneLeafletRefs.current.push(poly);
      });
    });
  }, [dangerZones, mapReady]);

  // ── Zone visibility toggle ────────────────────────────────────────────────
  useEffect(() => {
    const show = layers?.zones ?? true;
    zoneLeafletRefs.current.forEach(poly => {
      poly.setStyle({
        fillOpacity: show ? 0.35 : 0,
        weight: show ? 1 : 0,
        opacity: show ? 0.6 : 0,
      });
    });
  }, [layers?.zones]);

  // ── Satellite tile toggle ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const tile = satelliteTileRef.current;
    if (!map || !tile) return;
    if (layers?.osm) tile.addTo(map);
    else tile.remove();
  }, [layers?.osm, mapReady]);

  // ── Mode cursor hint ──────────────────────────────────────────────────────
  const hintText = hikeMode
    ? 'Click map to add hike waypoint'
    : mode === 'set-ambulance'
    ? 'Click map to place ambulance'
    : mode === 'set-victim'
    ? 'Click map to place victim'
    : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
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
