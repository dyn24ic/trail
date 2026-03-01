"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import mapboxgl from "mapbox-gl";
import { useRef, useEffect, useCallback, useState } from "react";
import type { HikeNode } from "@/lib/hikeRoute";
import type { LatLon, HybridRoute } from "@/types/backend";
import { YOSEMITE_BBOX } from "@/data/trailBbox";
import { YOSEMITE_BOUNDARY, WORLD_RING } from "@/data/yosemiteBoundary";
import type { DangerZone } from "@/types/backend";
import type { HotspotPredictionResponse } from "@/types/hotspots";
import type {
  BleScannerSuggestion,
  DroneMarker,
  IncidentMarker,
} from "@/types/markers";
import { DRONE_CONFIGS, DRONE_SEARCH_DURATION_MS } from "@/data/dronePath";
import type { DroneState, DroneSearchUpdate } from "@/data/dronePath";

// ── Path interpolation helper ─────────────────────────────────────────────

function interpolatePath(
  path: [number, number][],
  t: number,
): { lon: number; lat: number; bearing: number } {
  if (path.length === 0) return { lon: 0, lat: 0, bearing: 0 };
  if (path.length === 1)
    return { lon: path[0][0], lat: path[0][1], bearing: 0 };

  const clamped = Math.max(0, Math.min(1, t));

  // Cumulative lengths in degree-space (lat-corrected for lon)
  const lengths: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    const [lon0, lat0] = path[i - 1];
    const [lon1, lat1] = path[i];
    const dlat = lat1 - lat0;
    const dlon = (lon1 - lon0) * Math.cos((lat0 * Math.PI) / 180);
    lengths.push(lengths[i - 1] + Math.sqrt(dlat * dlat + dlon * dlon));
  }

  const total = lengths[lengths.length - 1];
  const target = clamped * total;

  let segIdx = lengths.length - 2;
  for (let i = 0; i < lengths.length - 1; i++) {
    if (target <= lengths[i + 1]) {
      segIdx = i;
      break;
    }
  }

  const segLen = lengths[segIdx + 1] - lengths[segIdx];
  const segT = segLen > 0 ? (target - lengths[segIdx]) / segLen : 0;

  const [lon0, lat0] = path[segIdx];
  const [lon1, lat1] = path[segIdx + 1];
  const lon = lon0 + (lon1 - lon0) * segT;
  const lat = lat0 + (lat1 - lat0) * segT;

  const dlat = lat1 - lat0;
  const dlon = (lon1 - lon0) * Math.cos((lat0 * Math.PI) / 180);
  const bearing = (Math.atan2(dlon, dlat) * 180) / Math.PI;

  return { lon, lat, bearing };
}

interface MapboxSceneProps {
  viewMode: "3d" | "2d";
  layers: {
    sensors: boolean;
    drones: boolean;
    incidents: boolean;
    zones: boolean;
    hotspots: boolean;
    osm: boolean;
  };
  dangerZones: DangerZone[];
  hotspotData: HotspotPredictionResponse | null;
  hybridRoute?: HybridRoute | null;
  onMove?: (lat: number, lon: number, zoom: number) => void;
  boxZoomMode?: boolean;
  flyTo?: { lat: number; lon: number; zoom: number; v: number } | null;
  hikeMode?: boolean;
  hikeWaypoints?: HikeNode[];
  onHikeNodeClick?: (pos: LatLon) => void;
  onMapReady?: (map: mapboxgl.Map) => void;
  bleScanners?: BleScannerSuggestion[];
  droneData?: DroneMarker[];
  incidentData?: IncidentMarker[];
  droneSearchActive?: boolean;
  onDroneUpdate?: (update: DroneSearchUpdate) => void;
}

const CENTER_LAT = (YOSEMITE_BBOX.north + YOSEMITE_BBOX.south) / 2;
const CENTER_LON = (YOSEMITE_BBOX.east + YOSEMITE_BBOX.west) / 2;

export default function MapboxScene({
  viewMode,
  layers,
  dangerZones,
  hotspotData,
  hybridRoute,
  onMove,
  boxZoomMode = false,
  flyTo,
  hikeMode,
  hikeWaypoints,
  onHikeNodeClick,
  onMapReady,
  bleScanners = [],
  droneData = [],
  incidentData = [],
  droneSearchActive = false,
  onDroneUpdate,
}: MapboxSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const [mapStyleLoaded, setMapStyleLoaded] = useState(false);

  // Layer state ref (for use inside one-time load callbacks)
  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  // Marker refs
  const droneMarkerEls = useRef<mapboxgl.Marker[]>([]);
  const hubMarkerEls = useRef<mapboxgl.Marker[]>([]);
  const incidentMarkerEls = useRef<mapboxgl.Marker[]>([]);

  // Hike mode refs
  const hikeModeRef = useRef(hikeMode ?? false);
  const onHikeNodeClickRef = useRef(onHikeNodeClick);
  useEffect(() => {
    hikeModeRef.current = hikeMode ?? false;
  }, [hikeMode]);
  useEffect(() => {
    onHikeNodeClickRef.current = onHikeNodeClick;
  }, [onHikeNodeClick]);

  // Drone update callback ref (keeps RAF loop stable)
  const onDroneUpdateRef = useRef(onDroneUpdate);
  useEffect(() => {
    onDroneUpdateRef.current = onDroneUpdate;
  }, [onDroneUpdate]);

  // ── Initialize map once ───────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !token || mapRef.current) return;

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [CENTER_LON, CENTER_LAT],
      zoom: 10,
      pitch: viewMode === "3d" ? 55 : 0,
      bearing: viewMode === "3d" ? -20 : 0,
      antialias: true,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on("load", () => {
      // Add DEM source for 3D terrain
      map.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });

      if (viewMode === "3d") {
        map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
        map.addLayer({
          id: "sky",
          type: "sky",
          paint: {
            "sky-type": "atmosphere",
            "sky-atmosphere-sun": [0.0, 90.0],
            "sky-atmosphere-sun-intensity": 15,
          },
        });
      }

      // ── Yosemite boundary fog of war ──────────────────────────────────
      map.addSource("yosemite-fog", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [WORLD_RING, YOSEMITE_BOUNDARY],
          },
        },
      });
      map.addLayer({
        id: "yosemite-fog-fill",
        type: "fill",
        source: "yosemite-fog",
        paint: { "fill-color": "#020608", "fill-opacity": 0.78 },
      });

      // Park boundary — glow + dashed line
      map.addSource("yosemite-boundary-src", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: YOSEMITE_BOUNDARY },
        },
      });
      map.addLayer({
        id: "yosemite-boundary-glow",
        type: "line",
        source: "yosemite-boundary-src",
        paint: {
          "line-color": "#00FF88",
          "line-width": 10,
          "line-opacity": 0.18,
          "line-blur": 8,
        },
      });
      map.addLayer({
        id: "yosemite-boundary-line",
        type: "line",
        source: "yosemite-boundary-src",
        paint: {
          "line-color": "#00FF88",
          "line-width": 1.5,
          "line-dasharray": [6, 3],
          "line-opacity": 0.9,
        },
      });

      // ── Trail traffic overlay ────────────────────────────────────────────
      const trailFeatures = TRAIL_SEGMENTS.map((seg) => ({
        type: "Feature" as const,
        properties: { traffic: seg.traffic, name: seg.name },
        geometry: { type: "LineString" as const, coordinates: seg.coords },
      }));

      map.addSource("trail-traffic-src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: trailFeatures },
      });

      // Casing (dark background for legibility against terrain)
      map.addLayer({
        id: "trail-traffic-casing",
        type: "line",
        source: "trail-traffic-src",
        paint: {
          "line-color": "#0a0a0a",
          "line-width": 5,
          "line-opacity": 0.55,
        },
      });

      // Traffic-colored line
      map.addLayer({
        id: "trail-traffic-line",
        type: "line",
        source: "trail-traffic-src",
        paint: {
          "line-width": 3,
          "line-opacity": 0.92,
          "line-color": [
            "match",
            ["get", "traffic"],
            "high",
            "#ef4444",
            "medium",
            "#f59e0b",
            "#22c55e", // low / default
          ],
        },
      });

      // ── Hide labels outside Yosemite boundary ─────────────────────────
      const yosemitePoly = {
        type: "Polygon" as const,
        coordinates: [YOSEMITE_BOUNDARY],
      };
      map.getStyle().layers.forEach((layer) => {
        if (layer.type === "symbol") {
          const existing = (layer as mapboxgl.SymbolLayerSpecification).filter;
          const withinFilter: mapboxgl.FilterSpecification = [
            "within",
            yosemitePoly,
          ];
          map.setFilter(
            layer.id,
            existing ? ["all", existing, withinFilter] : withinFilter,
          );
        }
      });

      // Fly-to on load
      map.flyTo({
        center: [CENTER_LON, CENTER_LAT],
        zoom: 11,
        pitch: viewMode === "3d" ? 55 : 0,
        bearing: viewMode === "3d" ? -20 : 0,
        duration: 2000,
        essential: true,
      });

      onMapReady?.(map);
      setMapStyleLoaded(true);
    });

    map.on("move", () => {
      const c = map.getCenter();
      onMove?.(c.lat, c.lng, map.getZoom());
    });

    map.on("click", (e) => {
      if (!hikeModeRef.current) return;
      onHikeNodeClickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapStyleLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── viewMode pitch/terrain toggle ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (viewMode === "3d") {
      map.easeTo({ pitch: 55, bearing: -20, duration: 1000 });
      try {
        map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
      } catch {}
    } else {
      map.easeTo({ pitch: 0, bearing: 0, duration: 1000 });
      try {
        map.setTerrain(null as unknown as mapboxgl.TerrainSpecification);
      } catch {}
    }
  }, [viewMode]);

  // ── Sync position on 2D → 3D return ──────────────────────────────────────
  useEffect(() => {
    if (!flyTo) return;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.easeTo({
        center: [flyTo.lon, flyTo.lat],
        zoom: flyTo.zoom,
        pitch: 55,
        bearing: -20,
        duration: 800,
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [flyTo]);

  // ── Box zoom mode ─────────────────────────────────────────────────────────
  const boxZoomModeRef = useRef(boxZoomMode);
  boxZoomModeRef.current = boxZoomMode;

  const setupBoxZoom = useCallback(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;
    if (!boxZoomModeRef.current) return;

    map.dragPan.disable();
    map.dragRotate.disable();

    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:absolute;inset:0;cursor:crosshair;z-index:100;";
    container.appendChild(overlay);

    let startX = 0,
      startY = 0;
    let boxEl: HTMLDivElement | null = null;

    const onMouseDown = (e: MouseEvent) => {
      startX = e.clientX;
      startY = e.clientY;
      const rect = overlay.getBoundingClientRect();
      boxEl = document.createElement("div");
      boxEl.style.cssText = `position:absolute;left:${e.clientX - rect.left}px;top:${e.clientY - rect.top}px;width:0;height:0;border:1.5px dashed rgba(0,255,200,0.8);background:rgba(0,255,200,0.05);pointer-events:none;`;
      overlay.appendChild(boxEl);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!boxEl) return;
      const rect = overlay.getBoundingClientRect();
      const x0 = startX - rect.left,
        y0 = startY - rect.top;
      const x1 = e.clientX - rect.left,
        y1 = e.clientY - rect.top;
      boxEl.style.left = `${Math.min(x0, x1)}px`;
      boxEl.style.top = `${Math.min(y0, y1)}px`;
      boxEl.style.width = `${Math.abs(x1 - x0)}px`;
      boxEl.style.height = `${Math.abs(y1 - y0)}px`;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!boxEl) return;
      const rect = container.getBoundingClientRect();
      const dx = Math.abs(e.clientX - startX),
        dy = Math.abs(e.clientY - startY);
      if (dx > 8 && dy > 8) {
        const x0 = Math.min(startX, e.clientX) - rect.left,
          y0 = Math.min(startY, e.clientY) - rect.top;
        const x1 = Math.max(startX, e.clientX) - rect.left,
          y1 = Math.max(startY, e.clientY) - rect.top;
        map.fitBounds([map.unproject([x0, y1]), map.unproject([x1, y0])], {
          padding: 20,
          duration: 800,
        });
      }
      boxEl.remove();
      boxEl = null;
    };

    overlay.addEventListener("mousedown", onMouseDown);
    overlay.addEventListener("mousemove", onMouseMove);
    overlay.addEventListener("mouseup", onMouseUp);

    return () => {
      overlay.removeEventListener("mousedown", onMouseDown);
      overlay.removeEventListener("mousemove", onMouseMove);
      overlay.removeEventListener("mouseup", onMouseUp);
      overlay.remove();
      map.dragPan.enable();
      map.dragRotate.enable();
    };
  }, []);

  useEffect(() => {
    if (!boxZoomMode) return;
    return setupBoxZoom();
  }, [boxZoomMode, setupBoxZoom]);

  // ── Danger zone overlays ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || dangerZones.length === 0) return;

    const addLayers = () => {
      if (map.getSource("danger-zones")) return;

      const features = dangerZones.map((z) => ({
        type: "Feature" as const,
        properties: { hazard_score: z.hazard_score, type: z.type },
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [z.bounds.sw.lon, z.bounds.sw.lat],
              [z.bounds.ne.lon, z.bounds.sw.lat],
              [z.bounds.ne.lon, z.bounds.ne.lat],
              [z.bounds.sw.lon, z.bounds.ne.lat],
              [z.bounds.sw.lon, z.bounds.sw.lat],
            ],
          ],
        },
      }));

      map.addSource("danger-zones", {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });
      map.addLayer({
        id: "danger-zones-fill",
        type: "fill",
        source: "danger-zones",
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "hazard_score"],
            0,
            "rgba(74,159,212,0.15)",
            0.5,
            "rgba(255,140,66,0.25)",
            1,
            "rgba(255,59,59,0.35)",
          ],
          "fill-outline-color": "rgba(255,59,59,0.5)",
        },
        layout: { visibility: layersRef.current.zones ? "visible" : "none" },
      });
    };

    if (map.isStyleLoaded()) addLayers();
    else map.once("load", addLayers);
  }, [dangerZones]);

  // ── Zone visibility toggle ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !map.getLayer("danger-zones-fill")) return;
    map.setLayoutProperty(
      "danger-zones-fill",
      "visibility",
      layers.zones ? "visible" : "none",
    );
  }, [layers.zones]);

  // ── Hotspot overlays ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hotspotData) return;

    const addHotspots = () => {
      if (map.getSource("hotspots")) return;

      const features = hotspotData.hotspots.map((h) => ({
        type: "Feature" as const,
        properties: { risk_score: h.riskScore, risk_level: h.riskLevel },
        geometry: { type: "Point" as const, coordinates: [h.lon, h.lat] },
      }));

      map.addSource("hotspots", {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });
      map.addLayer({
        id: "hotspots-circle",
        type: "circle",
        source: "hotspots",
        paint: {
          "circle-radius": [
            "interpolate" as const,
            ["linear" as const],
            ["get", "risk_score"],
            0,
            20,
            1,
            60,
          ],
          "circle-color": "rgba(255,140,66,0.35)",
          "circle-stroke-color": "rgba(255,140,66,0.7)",
          "circle-stroke-width": 1.5,
        },
        layout: { visibility: layersRef.current.hotspots ? "visible" : "none" },
      });
    };

    if (map.isStyleLoaded()) addHotspots();
    else map.once("load", addHotspots);
  }, [hotspotData]);

  // ── Hotspot visibility toggle ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !map.getLayer("hotspots-circle")) return;
    map.setLayoutProperty(
      "hotspots-circle",
      "visibility",
      layers.hotspots ? "visible" : "none",
    );
  }, [layers.hotspots]);

  // ── BLE scanner overlay ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const SRC = "ble-scanners-src";
    const featureCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: bleScanners.map((s) => ({
        type: "Feature" as const,
        properties: {
          type: s.type,
          priority: s.priority,
          label: s.label,
          name: s.name,
        },
        geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
      })),
    };

    const apply = () => {
      if (map.getSource(SRC)) {
        (map.getSource(SRC) as mapboxgl.GeoJSONSource).setData(
          featureCollection,
        );
        return;
      }
      map.addSource(SRC, { type: "geojson", data: featureCollection });
      map.addLayer({
        id: "ble-scanners-glow",
        type: "circle",
        source: SRC,
        paint: {
          "circle-radius": 20,
          "circle-color": "#a855f7",
          "circle-opacity": 0.12,
          "circle-stroke-width": 0,
        },
      });
      map.addLayer({
        id: "ble-scanners-circle",
        type: "circle",
        source: SRC,
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "type"], "trailhead"],
            11,
            ["==", ["get", "type"], "junction"],
            8,
            7,
          ],
          "circle-color": [
            "case",
            ["==", ["get", "type"], "trailhead"],
            "#a855f7",
            ["==", ["get", "type"], "junction"],
            "#7c3aed",
            "#f97316",
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "ble-scanners-label",
        type: "symbol",
        source: SRC,
        layout: {
          "text-field": ["get", "label"],
          "text-size": 10,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-offset": [0, -1.8],
          "text-anchor": "bottom",
          "text-allow-overlap": false,
          "text-ignore-placement": false,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.8)",
          "text-halo-width": 1,
        },
      });
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [bleScanners]);

  // ── Drone markers ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapStyleLoaded || !map || !droneData.length) return;

    droneMarkerEls.current.forEach((m) => m.remove());
    droneMarkerEls.current = [];
    hubMarkerEls.current.forEach((m) => m.remove());
    hubMarkerEls.current = [];

    if (map.getLayer("drone-lines")) map.removeLayer("drone-lines");
    if (map.getSource("drone-lines-src")) map.removeSource("drone-lines-src");

    map.addSource("drone-lines-src", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: droneData.map((d) => ({
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [d.hubLon, d.hubLat],
              [d.lon, d.lat],
            ],
          },
        })),
      },
    });
    map.addLayer({
      id: "drone-lines",
      type: "line",
      source: "drone-lines-src",
      paint: {
        "line-color": "#FFC107",
        "line-width": 1,
        "line-dasharray": [4, 3],
        "line-opacity": 0.55,
      },
      layout: { visibility: layersRef.current.drones ? "visible" : "none" },
    });

    const showDrones = layersRef.current.drones;

    droneData.forEach((drone) => {
      // Hub — amber rotated diamond
      const hubEl = document.createElement("div");
      hubEl.style.cssText =
        "width:10px;height:10px;background:rgba(255,193,7,0.5);border:1.5px solid #FFC107;transform:rotate(45deg);cursor:pointer;";
      if (!showDrones) hubEl.style.display = "none";
      hubMarkerEls.current.push(
        new mapboxgl.Marker({ element: hubEl })
          .setLngLat([drone.hubLon, drone.hubLat])
          .addTo(map),
      );

      // Drone — pulsing ring + ✈ + altitude badge
      const droneEl = document.createElement("div");
      droneEl.style.cssText =
        "position:relative;width:32px;height:32px;cursor:pointer;";
      droneEl.innerHTML = `
        <div style="position:absolute;inset:0;border-radius:50%;border:2px solid rgba(255,193,7,0.8);animation:drone-pulse 1.5s ease-out infinite;"></div>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;color:#FFC107;">✈</div>
        <div style="position:absolute;top:-16px;left:50%;transform:translateX(-50%);font-size:9px;color:#FFC107;white-space:nowrap;font-family:monospace;background:rgba(4,11,11,0.85);padding:1px 4px;border-radius:2px;">+${drone.alt}m</div>
      `;
      if (!showDrones) droneEl.style.display = "none";
      droneMarkerEls.current.push(
        new mapboxgl.Marker({ element: droneEl, anchor: "center" })
          .setLngLat([drone.lon, drone.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 20, closeButton: false }).setHTML(
              `<div style="font-family:monospace;font-size:11px;color:#b0d8c8;"><b style="color:#FFC107;">${drone.id}</b><br/>${drone.label}<br/>Alt: ${drone.alt}m AGL</div>`,
            ),
          )
          .addTo(map),
      );
    });

    return () => {
      droneMarkerEls.current.forEach((m) => m.remove());
      droneMarkerEls.current = [];
      hubMarkerEls.current.forEach((m) => m.remove());
      hubMarkerEls.current = [];
      const m = mapRef.current;
      if (m?.getLayer("drone-lines")) m.removeLayer("drone-lines");
      if (m?.getSource("drone-lines-src")) m.removeSource("drone-lines-src");
    };
  }, [droneData, mapStyleLoaded]);

  // ── Drone visibility toggle ───────────────────────────────────────────────
  useEffect(() => {
    const show = layers.drones;
    droneMarkerEls.current.forEach((m) => {
      m.getElement().style.display = show ? "" : "none";
    });
    hubMarkerEls.current.forEach((m) => {
      m.getElement().style.display = show ? "" : "none";
    });
    const map = mapRef.current;
    if (map?.getLayer("drone-lines"))
      map.setLayoutProperty(
        "drone-lines",
        "visibility",
        show ? "visible" : "none",
      );
  }, [layers.drones]);

  // ── Incident markers ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapStyleLoaded || !map || !incidentData.length) return;

    incidentMarkerEls.current.forEach((m) => m.remove());
    incidentMarkerEls.current = [];

    const showIncidents = layersRef.current.incidents;

    incidentData.forEach((inc) => {
      const isCritical = inc.severity === "critical";
      const size = isCritical ? 28 : 24;
      const color = isCritical ? "#FF3B3B" : "#FFC107";
      const animDuration = isCritical ? "1.2s" : "2s";

      const el = document.createElement("div");
      el.style.cssText = `position:relative;width:${size}px;height:${size}px;cursor:pointer;`;
      el.innerHTML = `
        <div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:0.3;animation:incident-pulse ${animDuration} ease-out infinite;"></div>
        <div style="position:absolute;inset:4px;border-radius:50%;background:${color};"></div>
      `;
      if (!showIncidents) el.style.display = "none";

      const severityLabel = isCritical ? "🔴 CRITICAL" : "🟡 WARNING";
      const popupHtml = `<div style="font-family:monospace;font-size:11px;color:#b0d8c8;"><b style="color:${color};">${severityLabel}</b><br/>${inc.label ?? inc.id}</div>`;

      incidentMarkerEls.current.push(
        new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([inc.lon, inc.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 16, closeButton: false }).setHTML(
              popupHtml,
            ),
          )
          .addTo(map),
      );
    });

    return () => {
      incidentMarkerEls.current.forEach((m) => m.remove());
      incidentMarkerEls.current = [];
    };
  }, [incidentData, mapStyleLoaded]);

  // ── Incident visibility toggle ────────────────────────────────────────────
  useEffect(() => {
    const show = layers.incidents;
    incidentMarkerEls.current.forEach((m) => {
      m.getElement().style.display = show ? "" : "none";
    });
  }, [layers.incidents]);

  // ── Hybrid route layers (road + mountain gradient + stop + victim) ─────────
  useEffect(() => {
    const _map = mapRef.current;
    if (!_map) return;
    const map: mapboxgl.Map = _map;

    const ROUTE_LAYERS = [
      "route-road",
      "route-mountain",
      "route-stop",
      "route-victim",
    ];
    const ROUTE_SOURCES = [
      "route-road-src",
      "route-mountain-src",
      "route-stop-src",
      "route-victim-src",
    ];

    function cleanup() {
      ROUTE_LAYERS.forEach((id) => {
        try {
          if (map.getLayer(id)) map.removeLayer(id);
        } catch {}
      });
      ROUTE_SOURCES.forEach((id) => {
        try {
          if (map.getSource(id)) map.removeSource(id);
        } catch {}
      });
    }

    function addRoute() {
      cleanup();
      if (!hybridRoute) return;

      const wps = hybridRoute.mountainRoute.route.waypoints;
      if (wps.length < 2) return;

      // Road segment (cyan dashed)
      if (hybridRoute.roadPath.length >= 2) {
        map.addSource("route-road-src", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: hybridRoute.roadPath.map((p) => [p.lon, p.lat]),
            },
          },
        });
        map.addLayer({
          id: "route-road",
          type: "line",
          source: "route-road-src",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#22d3ee",
            "line-width": 4,
            "line-dasharray": [2, 2],
          },
        });
      }

      // Mountain segment (elevation gradient via line-progress)
      map.addSource("route-mountain-src", {
        type: "geojson",
        lineMetrics: true,
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: wps.map((w) => [w.lon, w.lat]),
          },
        },
      });
      map.addLayer({
        id: "route-mountain",
        type: "line",
        source: "route-mountain-src",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 5,
          "line-gradient": [
            "interpolate",
            ["linear"],
            ["line-progress"],
            0,
            "#22c55e",
            0.4,
            "#eab308",
            0.75,
            "#f97316",
            1,
            "#ef4444",
          ],
        },
      });

      // Stop point (orange circle)
      map.addSource("route-stop-src", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [hybridRoute.stopPoint.lon, hybridRoute.stopPoint.lat],
          },
        },
      });
      map.addLayer({
        id: "route-stop",
        type: "circle",
        source: "route-stop-src",
        paint: {
          "circle-radius": 10,
          "circle-color": "#f97316",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Victim point (red circle)
      const last = wps[wps.length - 1];
      map.addSource("route-victim-src", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [last.lon, last.lat] },
        },
      });
      map.addLayer({
        id: "route-victim",
        type: "circle",
        source: "route-victim-src",
        paint: {
          "circle-radius": 12,
          "circle-color": "#ef4444",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Fit map to full route
      const allCoords = [
        ...hybridRoute.roadPath.map((p) => [p.lon, p.lat] as [number, number]),
        ...wps.map((w) => [w.lon, w.lat] as [number, number]),
      ];
      const bounds = allCoords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(allCoords[0], allCoords[0]),
      );
      map.fitBounds(bounds, {
        padding: 80,
        pitch: 55,
        bearing: -20,
        duration: 1500,
      });
    }

    if (map.isStyleLoaded()) addRoute();
    else map.once("load", addRoute);

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hybridRoute]);

  // ── Cursor for hike mode ──────────────────────────────────────────────────
  useEffect(() => {
    mapRef.current
      ?.getCanvas()
      .style.setProperty("cursor", hikeMode ? "crosshair" : "");
  }, [hikeMode]);

  // ── Hike route layers ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const lineSrcId = "hike-route-line-src";
    const nodesSrcId = "hike-route-nodes-src";
    const casingLayId = "hike-route-casing";
    const lineLayId = "hike-route-line";
    const nodesLayId = "hike-route-nodes";

    const nodes = hikeWaypoints ?? [];

    const lineGeoJSON: GeoJSON.FeatureCollection =
      nodes.length < 2
        ? { type: "FeatureCollection", features: [] }
        : {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: nodes.map((n) => [n.lon, n.lat]),
                },
              },
            ],
          };

    const nodesGeoJSON: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: nodes.map((n, i) => ({
        type: "Feature",
        properties: {
          nodeType: i === 0 ? "start" : i === nodes.length - 1 ? "end" : "mid",
          elevation: n.elevation_m,
        },
        geometry: { type: "Point", coordinates: [n.lon, n.lat] },
      })),
    };

    const apply = () => {
      if (map.getSource(lineSrcId)) {
        (map.getSource(lineSrcId) as mapboxgl.GeoJSONSource).setData(
          lineGeoJSON,
        );
        (map.getSource(nodesSrcId) as mapboxgl.GeoJSONSource).setData(
          nodesGeoJSON,
        );
        return;
      }

      map.addSource(lineSrcId, { type: "geojson", data: lineGeoJSON });
      map.addSource(nodesSrcId, { type: "geojson", data: nodesGeoJSON });

      map.addLayer({
        id: casingLayId,
        type: "line",
        source: lineSrcId,
        paint: { "line-color": "#000000", "line-width": 6 },
      });
      map.addLayer({
        id: lineLayId,
        type: "line",
        source: lineSrcId,
        paint: {
          "line-color": "#00ffc8",
          "line-width": 3,
          "line-dasharray": [2, 1],
        },
      });
      map.addLayer({
        id: nodesLayId,
        type: "circle",
        source: nodesSrcId,
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "nodeType"], "start"],
            9,
            ["==", ["get", "nodeType"], "end"],
            9,
            6,
          ],
          "circle-color": [
            "case",
            ["==", ["get", "nodeType"], "start"],
            "#22c55e",
            ["==", ["get", "nodeType"], "end"],
            "#ef4444",
            "#00ffc8",
          ],
          "circle-stroke-color": "#040b0b",
          "circle-stroke-width": 2,
        },
      });
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [hikeWaypoints]);

  // ── Drone SAR animation (RAF loop) ───────────────────────────────────────
  useEffect(() => {
    if (!droneSearchActive || !mapStyleLoaded) return;
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    // Add per-drone sources + layers
    DRONE_CONFIGS.forEach((cfg) => {
      if (map.getSource(`drone-pos-${cfg.id}`)) return;
      const startCoord = cfg.path[0];
      map.addSource(`drone-pos-${cfg.id}`, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "Point", coordinates: startCoord },
          properties: {},
        },
      });
      // Pulse ring
      map.addLayer({
        id: `drone-pulse-${cfg.id}`,
        type: "circle",
        source: `drone-pos-${cfg.id}`,
        paint: {
          "circle-radius": 60,
          "circle-color": cfg.color,
          "circle-opacity": 0.15,
          "circle-stroke-width": 0,
        },
      });
      // Dot
      map.addLayer({
        id: `drone-dot-${cfg.id}`,
        type: "circle",
        source: `drone-pos-${cfg.id}`,
        paint: {
          "circle-radius": 7,
          "circle-color": cfg.color,
          "circle-opacity": 1,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    });

    let rafId: number;
    let startTime: number | null = null;
    let victimFoundFired = false;
    let victimFoundData: { droneId: string; lat: number; lon: number } | null =
      null;
    const dur = DRONE_SEARCH_DURATION_MS;

    const tick = (now: number) => {
      if (!startTime) startTime = now;
      const globalT = Math.min((now - startTime) / dur, 1);

      const droneStates: DroneState[] = DRONE_CONFIGS.map((cfg) => {
        const loopT =
          cfg.victimAtProgress != null
            ? Math.min(globalT / cfg.victimAtProgress, 1)
            : globalT % 1;

        const pos = interpolatePath(cfg.path, loopT);
        const isFound =
          cfg.victimAtProgress != null && globalT >= cfg.victimAtProgress;

        (
          map.getSource(`drone-pos-${cfg.id}`) as mapboxgl.GeoJSONSource
        )?.setData({
          type: "Feature",
          geometry: { type: "Point", coordinates: [pos.lon, pos.lat] },
          properties: {},
        });

        const pulse = 55 + Math.sin(now * 0.004 + cfg.id.charCodeAt(0)) * 22;
        try {
          map.setPaintProperty(`drone-pulse-${cfg.id}`, "circle-radius", pulse);
        } catch {}

        return {
          id: cfg.id,
          label: cfg.label,
          color: cfg.color,
          lat: pos.lat,
          lon: pos.lon,
          bearing: pos.bearing,
          progress: loopT,
          status: isFound ? ("found" as const) : ("searching" as const),
        };
      });

      // Victim found event (fire once)
      const victimCfg = DRONE_CONFIGS.find(
        (c) => c.victimAtProgress != null && globalT >= c.victimAtProgress,
      );
      if (victimCfg && !victimFoundFired) {
        victimFoundFired = true;
        const vPos = interpolatePath(victimCfg.path, 1); // drone is at end of its path
        victimFoundData = {
          droneId: victimCfg.id,
          lat: vPos.lat,
          lon: vPos.lon,
        };

        if (!map.getSource("victim-marker")) {
          map.addSource("victim-marker", {
            type: "geojson",
            data: {
              type: "Feature",
              geometry: { type: "Point", coordinates: [vPos.lon, vPos.lat] },
              properties: {},
            },
          });
          map.addLayer({
            id: "victim-dot",
            type: "circle",
            source: "victim-marker",
            paint: {
              "circle-radius": 10,
              "circle-color": "#FF3B3B",
              "circle-opacity": 1,
              "circle-stroke-width": 3,
              "circle-stroke-color": "#ffffff",
            },
          });
        }

        map.flyTo({
          center: [vPos.lon, vPos.lat],
          zoom: 14,
          pitch: 60,
          duration: 2500,
        });
      }

      onDroneUpdateRef.current?.({
        drones: droneStates,
        victimFound: victimFoundFired,
        victimDroneId: victimFoundData?.droneId ?? null,
        victimLat: victimFoundData?.lat ?? null,
        victimLon: victimFoundData?.lon ?? null,
      });

      if (globalT < 1) rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      // Remove all SAR drone layers + sources
      DRONE_CONFIGS.forEach((cfg) => {
        try {
          map.removeLayer(`drone-dot-${cfg.id}`);
        } catch {}
        try {
          map.removeLayer(`drone-pulse-${cfg.id}`);
        } catch {}
        try {
          map.removeSource(`drone-pos-${cfg.id}`);
        } catch {}
      });
      try {
        map.removeLayer("victim-dot");
      } catch {}
      try {
        map.removeSource("victim-marker");
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droneSearchActive, mapStyleLoaded]);

  if (!token) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#040B0B",
          flexDirection: "column",
          gap: "16px",
          fontFamily: "'Share Tech Mono', monospace",
        }}
      >
        <div style={{ fontSize: "1.5rem", color: "rgba(0,255,136,0.3)" }}>
          ⬡
        </div>
        <div
          style={{
            fontSize: "0.7rem",
            color: "rgba(0,255,136,0.4)",
            letterSpacing: "0.15em",
          }}
        >
          MAPBOX TOKEN NOT CONFIGURED
        </div>
        <div
          style={{
            fontSize: "0.6rem",
            color: "rgba(0,255,136,0.2)",
            letterSpacing: "0.1em",
          }}
        >
          Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .mapboxgl-ctrl-logo { display: none !important; }
        @keyframes drone-pulse {
          0%   { transform: scale(1);   opacity: 0.9; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        @keyframes incident-pulse {
          0%   { transform: scale(1);   opacity: 0.9; }
          100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          inset: 0,
        }}
      />
    </>
  );
}
