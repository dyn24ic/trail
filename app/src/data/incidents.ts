import type { IncidentMarker } from '@/types/markers';

export const incidentData: IncidentMarker[] = [
  {
    id: 'INC-001',
    lat: 37.7459, lon: -119.5332,
    color: 0xFF3B3B,
    severity: 'critical',
    label: 'Hiker overdue — Half Dome Summit',
  },
  {
    id: 'INC-002',
    lat: 37.7573, lon: -119.5982,
    color: 0xFFC107,
    severity: 'warning',
    label: 'Audio distress — Yosemite Falls Trail',
  },
];
