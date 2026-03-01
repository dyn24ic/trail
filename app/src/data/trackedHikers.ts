export interface TrackedSensor {
  id: string;
  label: string;
  lat: number;
  lon: number;
}

export interface SensorEvent {
  offsetMs: number;
  sensorId: string;
  status: 'detected' | 'missed';
}

export interface TrackedHiker {
  id: string;
  name: string;
  mac: string;
  color: string;
  trail: string;
  sensors: TrackedSensor[];
  events: SensorEvent[];
  simulationDurationMs: number;
}

export const TRACKED_HIKERS: TrackedHiker[] = [
  {
    // Sarah K. — DEVIATES on Mist Trail
    id: 'h1',
    name: 'Sarah K.',
    mac: 'a8:4b:05:c2:11:3e',
    color: '#FF3B3B',
    trail: 'Mist Trail',
    sensors: [
      { id: 'S-MT-01', label: 'Happy Isles TH',    lat: 37.7323, lon: -119.5582 },
      { id: 'S-MT-02', label: 'VF Bridge',          lat: 37.7280, lon: -119.5520 },
      { id: 'S-MT-03', label: 'Top of Vernal Fall', lat: 37.7267, lon: -119.5448 },
      { id: 'S-MT-04', label: 'Nevada Approach',    lat: 37.7290, lon: -119.5380 },
      { id: 'S-MT-05', label: 'Nevada Fall Top',    lat: 37.7310, lon: -119.5330 },
    ],
    events: [
      { offsetMs: 0,     sensorId: 'S-MT-01', status: 'detected' },
      { offsetMs: 8000,  sensorId: 'S-MT-02', status: 'detected' },
      { offsetMs: 16000, sensorId: 'S-MT-03', status: 'detected' },
      { offsetMs: 28000, sensorId: 'S-MT-04', status: 'missed'   },
      { offsetMs: 40000, sensorId: 'S-MT-05', status: 'missed'   },
    ],
    simulationDurationMs: 48000,
  },
  {
    // James R. — on track, Panorama Trail
    id: 'h2',
    name: 'James R.',
    mac: 'f4:2d:c1:7a:93:bb',
    color: '#00FF88',
    trail: 'Panorama Trail',
    sensors: [
      { id: 'S-PT-01', label: 'Glacier Point',      lat: 37.7291, lon: -119.5734 },
      { id: 'S-PT-02', label: 'Panorama Cliff Jct', lat: 37.7274, lon: -119.5530 },
      { id: 'S-PT-03', label: 'Nevada Fall Top',    lat: 37.7310, lon: -119.5330 },
    ],
    events: [
      { offsetMs: 0,     sensorId: 'S-PT-01', status: 'detected' },
      { offsetMs: 12000, sensorId: 'S-PT-02', status: 'detected' },
      { offsetMs: 24000, sensorId: 'S-PT-03', status: 'detected' },
    ],
    simulationDurationMs: 48000,
  },
  {
    // Alex M. — on track, Mirror Lake Loop
    id: 'h3',
    name: 'Alex M.',
    mac: 'dc:a6:32:1e:7f:02',
    color: '#00FF88',
    trail: 'Mirror Lake Loop',
    sensors: [
      { id: 'S-ML-01', label: 'Mirror Lake TH', lat: 37.7451, lon: -119.5456 },
      { id: 'S-ML-02', label: 'Lake North',     lat: 37.7480, lon: -119.5410 },
      { id: 'S-ML-03', label: 'Return',         lat: 37.7451, lon: -119.5456 },
    ],
    events: [
      { offsetMs: 0,     sensorId: 'S-ML-01', status: 'detected' },
      { offsetMs: 10000, sensorId: 'S-ML-02', status: 'detected' },
      { offsetMs: 20000, sensorId: 'S-ML-03', status: 'detected' },
    ],
    simulationDurationMs: 48000,
  },
];
