export interface HotspotZone {
  id: string;
  lat: number;
  lon: number;
  radiusMeters: number;
  riskScore: number;
  riskLevel: 'low' | 'moderate' | 'high' | 'extreme';
  factors: {
    fire: number;
    weather: number;
    terrain: number;
    water: number;
    accessibility: number;
  };
  description: string;
  recommendations: string[];
}

export interface SensorSuggestion {
  id: string;
  lat: number;
  lon: number;
  label: string;
}

export interface CallBoxSuggestion {
  id: string;
  lat: number;
  lon: number;
  label: string;
}

export interface PlacementSuggestions {
  sensors: SensorSuggestion[];
  callBoxes: CallBoxSuggestion[];
}

export interface HotspotPredictionResponse {
  hotspots: HotspotZone[];
  bbox: { south: number; north: number; west: number; east: number };
  generatedAt: string;
  modelVersion: string;
  conditions: {
    fireDangerRating: string;
    weatherSummary: string;
    activeFires: number;
    smokeAqi: number | null;
  };
}
