// Drone SAR search configuration — Yosemite Valley lawnmower sectors

export interface DroneConfig {
  id: string;
  label: string;
  color: string;        // hex for CSS + Mapbox circle color
  path: [number, number][];  // [lon, lat][]
  victimAtProgress?: number; // 0–1: globalT at which this drone "finds" victim
}

export interface DroneState {
  id: string;
  label: string;
  color: string;
  lat: number;
  lon: number;
  bearing: number;
  progress: number;  // 0–1 within its own segment
  status: 'searching' | 'found' | 'returning';
}

export interface DroneSearchUpdate {
  drones: DroneState[];
  victimFound: boolean;
  victimDroneId: string | null;
  victimLat: number | null;
  victimLon: number | null;
}

// ── Yosemite Valley divided into 3 W/C/E sectors ─────────────────────────

export const DRONE_CONFIGS: DroneConfig[] = [
  {
    id: 'D1',
    label: 'DELTA-1 W-SECTOR',
    color: '#FFD84A',
    path: [
      // West sector — lawnmower over valley floor west (Mirror Lake side)
      [-119.652, 37.726],
      [-119.652, 37.746],
      [-119.636, 37.746],
      [-119.636, 37.726],
      [-119.620, 37.726],
      [-119.620, 37.746],
      [-119.608, 37.746],
      [-119.608, 37.726],
      [-119.602, 37.733],
      [-119.600, 37.740],
    ],
  },
  {
    id: 'D2',
    label: 'DELTA-2 CTR-SECTOR',
    color: '#00ffc8',
    // Central valley + approach to Vernal Fall — finds victim
    path: [
      [-119.598, 37.722],
      [-119.598, 37.742],
      [-119.583, 37.742],
      [-119.583, 37.722],
      [-119.568, 37.722],
      [-119.568, 37.738],
      [-119.560, 37.730],
      [-119.555, 37.724],
      [-119.552, 37.731],
    ],
    victimAtProgress: 0.72,
  },
  {
    id: 'D3',
    label: 'DELTA-3 E-SECTOR',
    color: '#BF80FF',
    path: [
      // East sector — Half Dome base / Nevada Fall side
      [-119.550, 37.720],
      [-119.550, 37.738],
      [-119.535, 37.738],
      [-119.535, 37.720],
      [-119.520, 37.720],
      [-119.520, 37.735],
      [-119.508, 37.735],
      [-119.508, 37.720],
      [-119.500, 37.727],
      [-119.495, 37.732],
    ],
  },
];

export const DRONE_SEARCH_DURATION_MS = 45_000; // 45s full sweep
