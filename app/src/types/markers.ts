export interface SensorMarker {
  id: string;
  lat: number;
  lon: number;
  state: 'ok' | 'warn' | 'alert' | 'off';
  label: string;
}

export interface DroneMarker {
  id: string;
  lat: number;
  lon: number;
  alt: number; // meters AGL
  color: number; // hex
  label: string;
  hubLat: number; // launch pad position
  hubLon: number;
}

export interface IncidentMarker {
  id: string;
  lat: number;
  lon: number;
  color: number;
  severity: 'critical' | 'warning' | 'info';
  label?: string;
}

export interface BleScannerSuggestion {
  id: string;
  lat: number;
  lon: number;
  name: string;
  label: string;
  rationale: string;
  type: 'trailhead' | 'junction' | 'destination';
  priority: 'critical' | 'high' | 'medium';
  elevation_m: number;
  coverageRadiusM: 80;
}
