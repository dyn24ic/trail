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
}

export interface IncidentMarker {
  id: string;
  lat: number;
  lon: number;
  color: number;
  severity: 'critical' | 'warning' | 'info';
}
