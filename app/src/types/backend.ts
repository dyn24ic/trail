// TypeScript types for the trAIl Django backend API responses

export interface WeatherConditions {
  fog: boolean;
  storm: boolean;
  heavy_rain: boolean;
  snow: boolean;
}

export interface WeatherRoutingFactors {
  ground_speed_factor: number;
  helicopter_speed_factor: number;
  weather_hazard: number;
}

export interface Weather {
  temperature_c: number;
  feels_like_c: number;
  humidity_pct: number;
  pressure_hpa: number;
  wind_speed_ms: number;
  wind_direction_deg: number;
  visibility_m: number;
  precipitation_mm_1h: number;
  description: string;
  conditions: WeatherConditions;
  routing_factors: WeatherRoutingFactors;
}

export interface WeatherResponse {
  status: string;
  weather: Weather;
  location: { lat: number; lon: number };
}

export interface DangerZone {
  center: { lat: number; lon: number };
  bounds: {
    sw: { lat: number; lon: number };
    ne: { lat: number; lon: number };
  };
  hazard_score: number;
  avg_slope_deg: number;
  type: string;
}

export interface TerrainStats {
  min_elevation: number;
  max_elevation: number;
  mean_elevation: number;
  max_slope_deg: number;
  mean_slope_deg: number;
}

export interface TerrainResponse {
  status: string;
  bbox: { west: number; south: number; east: number; north: number };
  stats: TerrainStats;
  danger_zones: DangerZone[];
  elevation_grid_sample: number[][];
  grid_size: { rows: number; cols: number };
}

export interface RouteWaypoint {
  lat: number;
  lon: number;
  elevation_m: number;
  slope_deg: number;
  hazard: number;
  colour: string;
  index: number;
}

export interface ElevationProfilePoint {
  distance_m: number;
  elevation_m: number;
  lat: number;
  lon: number;
}

export interface HelicopterRecommendation {
  recommended: boolean;
  safety_score: number;
  threshold: number;
  helicopter_flight_ok: boolean;
  reasons: string[];
}

export interface RouteStats {
  avg_slope_deg: number;
  max_elevation_m: number;
  min_elevation_m: number;
  elevation_gain_m?: number;
  clearance_required_m?: number;
}

export interface FlightConditions {
  ok: boolean;
  wind_speed_ms: number;
  visibility_m: number;
  storm: boolean;
}

export interface Route {
  route_type: string;
  severity: number;
  waypoints: RouteWaypoint[];
  total_distance_m: number;
  eta_minutes: number;
  effective_speed_kmh: number;
  elevation_profile: ElevationProfilePoint[];
  danger_zones: DangerZone[];
  safety_score: number;
  helicopter_recommendation: HelicopterRecommendation;
  route_colour: string;
  stats: RouteStats;
  flight_conditions?: FlightConditions;
}

export interface RouteAnalysis {
  summary: string;
  hazards: string[];
  recommendations: string[];
  helicopter_advice: string;
  safety_assessment: string;
  turn_by_turn: string[];
  model: string;
  llm_used: boolean;
}

export interface RouteCalculateResponse {
  status: string;
  request: {
    responder: { lat: number; lon: number };
    victim: { lat: number; lon: number };
    severity: number;
    route_type: string;
  };
  route: Route;
  weather: Weather;
  terrain_stats: TerrainStats;
  analysis: RouteAnalysis;
}

export interface RouteCompareResponse {
  status: string;
  request: {
    responder: { lat: number; lon: number };
    victim: { lat: number; lon: number };
    severity: number;
  };
  recommended_type: 'ground' | 'helicopter';
  ground: {
    route: Route;
    analysis: RouteAnalysis;
  };
  helicopter: {
    route: Route;
    analysis: RouteAnalysis;
  };
  weather: Weather;
  terrain_stats: TerrainStats;
  helicopter_recommendation: HelicopterRecommendation;
}

export interface BackendHealthResponse {
  status: string;
  service: string;
  openai_configured: boolean;
  openweather_configured: boolean;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface HybridRoute {
  roadPath: LatLon[];
  stopPoint: LatLon;
  mountainRoute: RouteCalculateResponse;
  roadEtaMinutes: number;
  totalEtaMinutes: number;
  weatherPenaltyApplied: boolean;
  penaltyReason: string;
}

// ── Scala incident types ──────────────────────────────────────────────────────

export interface PoliceReport {
  officerName:   string;
  badgeNumber:   string;
  description:   string;
  crimeInvolved: boolean;
  submittedAt:   string;
}

export interface AmbulanceReport {
  paramedicName:       string;
  vehicleId:           string;
  treatmentGiven:      string;
  hospitalDestination: string | null;
  submittedAt:         string;
}

export interface ExternalReports {
  police:    PoliceReport | null;
  ambulance: AmbulanceReport | null;
}

export interface AiRecommendation {
  generatedAt:        string;
  summary:            string;
  immediateActions:   string[];
  preventionMeasures: string[];
  resourceNotes:      string;
  modelUsed:          string;
}

export type IncidentStatus =
  | 'Triggered'
  | 'Searching'
  | 'VictimFound'
  | 'Triaged'
  | 'Routed'
  | 'Closed';

export interface ScalaSearchZone {
  lat: number;
  lng: number;
  radiusMeters: number;
  confidence: number;
}

export interface ScalaDroneResult {
  victimFound: boolean;
  victimLat: number | null;
  victimLng: number | null;
  confidence: number;
  imageUrl: string | null;
  scanDurationSeconds: number;
}

export interface ScalaInjuryTriage {
  severity: 'Minor' | 'Moderate' | 'Severe';
  injuryType: string;
  consciousAndResponsive: boolean;
  recommendedResponse: string;
  estimatedMedicalUrgencyMinutes: number;
}

export interface ScalaRouteStep {
  stepNumber: number;
  description: string;
  distanceMeters: number;
  estimatedMinutes: number;
  hazards: string[];
}

export interface ScalaResponderRoute {
  steps: ScalaRouteStep[];
  totalDistanceMeters: number;
  totalEtaMinutes: number;
  accessType: string;
  notes: string;
}

export interface IncidentSummary {
  id: string;
  triggerType: string;
  status: IncidentStatus;
  locationLat: number | null;
  locationLng: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportTimeline {
  triggeredAt:          string;
  totalResponseMinutes: number;
  droneSearchSeconds:   number;
  victimFound:          boolean;
  triageSeverity:       string | null;
}

export interface ResponseMetrics {
  searchZoneCount:    number;
  bestZoneConfidence: number;
  droneConfidence:    number;
  etaMinutes:         number;
  accessType:         string;
  medicalUrgencyMin:  number | null;
}

export interface TrailRecommendation {
  category:    string;
  priority:    string;
  lat:         number | null;
  lng:         number | null;
  description: string;
  rationale:   string;
}

export interface IncidentReport {
  incidentId:        string;
  generatedAt:       string;
  timeline:          ReportTimeline;
  rootCauseAnalysis: string;
  responseMetrics:   ResponseMetrics;
  recommendations:   TrailRecommendation[];
}

export interface Incident extends IncidentSummary {
  triggerPayload:   string;
  searchZones:      ScalaSearchZone[] | null;
  droneResult:      ScalaDroneResult | null;
  triage:           ScalaInjuryTriage | null;
  route:            ScalaResponderRoute | null;
  report:           IncidentReport | null;
  externalReports:  ExternalReports | null;
  aiRecommendation: AiRecommendation | null;
}
