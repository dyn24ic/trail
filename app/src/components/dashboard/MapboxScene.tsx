'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import mapboxgl from 'mapbox-gl';
import { useRef, useEffect } from 'react';
import { YOSEMITE_BBOX } from '@/data/trailBbox';
import type { DangerZone, HybridRoute } from '@/types/backend';
import type { HotspotPredictionResponse } from '@/types/hotspots';

interface MapboxSceneProps {
  viewMode: '3d' | '2d';
  layers: {
    sensors: boolean;
    drones: boolean;
    incidents: boolean;
    zones: boolean;
    landmarks: boolean;
    hotspots: boolean;
    osm: boolean;
  };
  dangerZones: DangerZone[];
  hotspotData: HotspotPredictionResponse | null;
  hybridRoute?: HybridRoute | null;
  onMove?: (lat: number, lon: number) => void;
}

const CENTER_LAT = (YOSEMITE_BBOX.north + YOSEMITE_BBOX.south) / 2;
const CENTER_LON = (YOSEMITE_BBOX.east + YOSEMITE_BBOX.west) / 2;

export default function MapboxScene({
  viewMode,
  dangerZones,
  hotspotData,
  hybridRoute,
  onMove,
}: MapboxSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || !token || mapRef.current) return;

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [CENTER_LON, CENTER_LAT],
      zoom: 10,
      pitch: viewMode === '3d' ? 55 : 0,
      bearing: viewMode === '3d' ? -20 : 0,
      antialias: true,
    });

    mapRef.current = map;

    map.on('load', () => {
      // Add DEM source for 3D terrain
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });

      if (viewMode === '3d') {
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
        map.addLayer({
          id: 'sky',
          type: 'sky',
          paint: {
            'sky-type': 'atmosphere',
            'sky-atmosphere-sun': [0.0, 90.0],
            'sky-atmosphere-sun-intensity': 15,
          },
        });
      }

      // Fly-to animation on load
      map.flyTo({
        center: [CENTER_LON, CENTER_LAT],
        zoom: 11,
        pitch: viewMode === '3d' ? 55 : 0,
        bearing: viewMode === '3d' ? -20 : 0,
        duration: 2000,
        essential: true,
      });
    });

    map.on('move', () => {
      const c = map.getCenter();
      onMove?.(c.lat, c.lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Respond to viewMode changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (viewMode === '3d') {
      map.easeTo({ pitch: 55, bearing: -20, duration: 1000 });
      try {
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      } catch {}
    } else {
      map.easeTo({ pitch: 0, bearing: 0, duration: 1000 });
      try {
        map.setTerrain(null as unknown as mapboxgl.TerrainSpecification);
      } catch {}
    }
  }, [viewMode]);

  // Danger zone overlays
  useEffect(() => {
    const map = mapRef.current;
    if (!map || dangerZones.length === 0) return;

    const addLayers = () => {
      if (map.getSource('danger-zones')) return;

      const features = dangerZones.map(z => ({
        type: 'Feature' as const,
        properties: { hazard_score: z.hazard_score, type: z.type },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [z.bounds.sw.lon, z.bounds.sw.lat],
            [z.bounds.ne.lon, z.bounds.sw.lat],
            [z.bounds.ne.lon, z.bounds.ne.lat],
            [z.bounds.sw.lon, z.bounds.ne.lat],
            [z.bounds.sw.lon, z.bounds.sw.lat],
          ]],
        },
      }));

      map.addSource('danger-zones', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      map.addLayer({
        id: 'danger-zones-fill',
        type: 'fill',
        source: 'danger-zones',
        paint: {
          'fill-color': [
            'interpolate', ['linear'],
            ['get', 'hazard_score'],
            0, 'rgba(74,159,212,0.15)',
            0.5, 'rgba(255,140,66,0.25)',
            1, 'rgba(255,59,59,0.35)',
          ],
          'fill-outline-color': 'rgba(255,59,59,0.5)',
        },
      });
    };

    if (map.isStyleLoaded()) {
      addLayers();
    } else {
      map.once('load', addLayers);
    }
  }, [dangerZones]);

  // Hotspot overlays
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hotspotData) return;

    const addHotspots = () => {
      if (map.getSource('hotspots')) return;

      const features = hotspotData.hotspots.map(h => ({
        type: 'Feature' as const,
        properties: { risk_score: h.riskScore, risk_level: h.riskLevel },
        geometry: { type: 'Point' as const, coordinates: [h.lon, h.lat] },
      }));

      map.addSource('hotspots', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      map.addLayer({
        id: 'hotspots-circle',
        type: 'circle',
        source: 'hotspots',
        paint: {
          'circle-radius': ['interpolate' as const, ['linear' as const], ['get', 'risk_score'], 0, 20, 1, 60],
          'circle-color': 'rgba(255,140,66,0.35)',
          'circle-stroke-color': 'rgba(255,140,66,0.7)',
          'circle-stroke-width': 1.5,
        },
      });
    };

    if (map.isStyleLoaded()) {
      addHotspots();
    } else {
      map.once('load', addHotspots);
    }
  }, [hotspotData]);

  // Hybrid route layers (mountain walk + road drive + markers)
  useEffect(() => {
    const _map = mapRef.current;
    if (!_map) return;
    // Explicitly typed as non-null so closures (cleanup/addRoute) inherit the narrowed type
    const map: mapboxgl.Map = _map;

    const ROUTE_LAYERS  = ['route-road', 'route-mountain', 'route-stop', 'route-victim'];
    const ROUTE_SOURCES = ['route-road-src', 'route-mountain-src', 'route-stop-src', 'route-victim-src'];

    function cleanup() {
      ROUTE_LAYERS.forEach(id  => { try { if (map.getLayer(id))   map.removeLayer(id);   } catch {} });
      ROUTE_SOURCES.forEach(id => { try { if (map.getSource(id)) map.removeSource(id); } catch {} });
    }

    function addRoute() {
      cleanup();
      if (!hybridRoute) return;

      const wps = hybridRoute.mountainRoute.route.waypoints;
      if (wps.length < 2) return;

      // ── Road segment (cyan dashed) ──────────────────────────────────
      if (hybridRoute.roadPath.length >= 2) {
        map.addSource('route-road-src', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: hybridRoute.roadPath.map(p => [p.lon, p.lat]),
            },
          },
        });
        map.addLayer({
          id: 'route-road',
          type: 'line',
          source: 'route-road-src',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#22d3ee', 'line-width': 4, 'line-dasharray': [2, 2] },
        });
      }

      // ── Mountain segment (elevation gradient via line-progress) ──────
      map.addSource('route-mountain-src', {
        type: 'geojson',
        lineMetrics: true,
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: wps.map(w => [w.lon, w.lat]),
          },
        },
      });
      map.addLayer({
        id: 'route-mountain',
        type: 'line',
        source: 'route-mountain-src',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 5,
          'line-gradient': [
            'interpolate', ['linear'], ['line-progress'],
            0,   '#22c55e',
            0.4, '#eab308',
            0.75,'#f97316',
            1,   '#ef4444',
          ],
        },
      });

      // ── Stop point (orange circle) ───────────────────────────────────
      map.addSource('route-stop-src', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [hybridRoute.stopPoint.lon, hybridRoute.stopPoint.lat] },
        },
      });
      map.addLayer({
        id: 'route-stop',
        type: 'circle',
        source: 'route-stop-src',
        paint: {
          'circle-radius': 10,
          'circle-color': '#f97316',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });

      // ── Victim point (red circle) ────────────────────────────────────
      const last = wps[wps.length - 1];
      map.addSource('route-victim-src', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [last.lon, last.lat] },
        },
      });
      map.addLayer({
        id: 'route-victim',
        type: 'circle',
        source: 'route-victim-src',
        paint: {
          'circle-radius': 12,
          'circle-color': '#ef4444',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });

      // ── Fit map to the full route ─────────────────────────────────────
      const allCoords = [
        ...hybridRoute.roadPath.map(p => [p.lon, p.lat] as [number, number]),
        ...wps.map(w => [w.lon, w.lat] as [number, number]),
      ];
      const bounds = allCoords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(allCoords[0], allCoords[0]),
      );
      map.fitBounds(bounds, { padding: 80, pitch: 55, bearing: -20, duration: 1500 });
    }

    if (map.isStyleLoaded()) {
      addRoute();
    } else {
      map.once('load', addRoute);
    }

    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hybridRoute]);

  if (!token) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#040B0B', flexDirection: 'column', gap: '16px',
        fontFamily: "'Share Tech Mono', monospace",
      }}>
        <div style={{ fontSize: '1.5rem', color: 'rgba(0,255,136,0.3)' }}>⬡</div>
        <div style={{ fontSize: '0.7rem', color: 'rgba(0,255,136,0.4)', letterSpacing: '0.15em' }}>
          MAPBOX TOKEN NOT CONFIGURED
        </div>
        <div style={{ fontSize: '0.6rem', color: 'rgba(0,255,136,0.2)', letterSpacing: '0.1em' }}>
          Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
    />
  );
}
