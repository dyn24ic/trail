export type TrailNodeType = 'trailhead' | 'junction' | 'destination';

export interface TrailNetworkNode {
  name: string;
  lat: number;
  lon: number;
  elevation_m: number;
  type: TrailNodeType;
  notes: string;
}

export const TRAIL_NETWORK: TrailNetworkNode[] = [
  // ── Trailheads (system entry/exit) ────────────────────────────────────────
  {
    name: 'Happy Isles Trailhead',
    lat: 37.7323, lon: -119.5582, elevation_m: 1219,
    type: 'trailhead',
    notes: 'Mist Trail + JMT gateway, most popular',
  },
  {
    name: 'Mirror Lake Trailhead',
    lat: 37.7413, lon: -119.5550, elevation_m: 1192,
    type: 'trailhead',
    notes: 'North Dome / Tenaya Canyon',
  },
  {
    name: 'Yosemite Falls Trailhead',
    lat: 37.7485, lon: -119.5977, elevation_m: 1214,
    type: 'trailhead',
    notes: 'Upper Falls trail',
  },
  {
    name: 'Glacier Point',
    lat: 37.7268, lon: -119.5724, elevation_m: 2199,
    type: 'trailhead',
    notes: 'Road-accessible, Panorama Trail',
  },
  {
    name: 'Tuolumne Meadows Trailhead',
    lat: 37.8761, lon: -119.3618, elevation_m: 2621,
    type: 'trailhead',
    notes: 'High Sierra hub, multiple trails',
  },
  {
    name: 'Hetch Hetchy Dam Trailhead',
    lat: 37.9534, lon: -119.7801, elevation_m: 1175,
    type: 'trailhead',
    notes: "O'Shaughnessy Dam access",
  },
  {
    name: 'Wawona / Mariposa Grove',
    lat: 37.5071, lon: -119.6027, elevation_m: 1243,
    type: 'trailhead',
    notes: 'South entrance',
  },
  {
    name: 'Bridalveil Fall Trailhead',
    lat: 37.7161, lon: -119.6519, elevation_m: 1147,
    type: 'trailhead',
    notes: 'Valley entrance',
  },
  {
    name: 'Sentinel Dome Trailhead',
    lat: 37.7100, lon: -119.5826, elevation_m: 2133,
    type: 'trailhead',
    notes: 'Sentinel + Taft Point',
  },
  {
    name: 'May Lake Trailhead',
    lat: 37.8280, lon: -119.4868, elevation_m: 2780,
    type: 'trailhead',
    notes: 'High Sierra camp access',
  },
  {
    name: 'White Wolf Trailhead',
    lat: 37.8660, lon: -119.6451, elevation_m: 2395,
    type: 'trailhead',
    notes: 'Backcountry camp start',
  },
  {
    name: 'Tenaya Lake East Shore',
    lat: 37.8356, lon: -119.4675, elevation_m: 2484,
    type: 'trailhead',
    notes: 'Sunrise + Clouds Rest',
  },

  // ── Trail Junctions ────────────────────────────────────────────────────────
  {
    name: 'Vernal Fall Bridge',
    lat: 37.7289, lon: -119.5459, elevation_m: 1292,
    type: 'junction',
    notes: 'Mist Trail / horse trail split',
  },
  {
    name: 'Top of Vernal Fall',
    lat: 37.7267, lon: -119.5448, elevation_m: 1573,
    type: 'junction',
    notes: 'Mist Trail / JMT diverge',
  },
  {
    name: 'Nevada Fall Top',
    lat: 37.7301, lon: -119.5312, elevation_m: 1906,
    type: 'junction',
    notes: 'JMT / Panorama Trail',
  },
  {
    name: 'Little Yosemite Valley',
    lat: 37.7380, lon: -119.5280, elevation_m: 1890,
    type: 'junction',
    notes: 'JMT / Half Dome cables split',
  },
  {
    name: 'Half Dome Cables Junction',
    lat: 37.7451, lon: -119.5342, elevation_m: 2438,
    type: 'junction',
    notes: 'Sub Dome → cables',
  },
  {
    name: 'Clouds Rest Junction',
    lat: 37.7970, lon: -119.4680, elevation_m: 2591,
    type: 'junction',
    notes: 'From Tuolumne / Tenaya',
  },
  {
    name: 'Yosemite Falls Top',
    lat: 37.7553, lon: -119.5963, elevation_m: 2430,
    type: 'junction',
    notes: 'North Dome connector',
  },
  {
    name: 'Panorama Cliff Junction',
    lat: 37.7310, lon: -119.5620, elevation_m: 2073,
    type: 'junction',
    notes: 'Glacier Point → Nevada Fall',
  },
  {
    name: 'Tuolumne River Bridge',
    lat: 37.8780, lon: -119.3720, elevation_m: 2591,
    type: 'junction',
    notes: 'Lembert Dome / Dog Lake split',
  },

  // ── Popular Destinations (high-risk) ──────────────────────────────────────
  {
    name: 'Half Dome Summit',
    lat: 37.7459, lon: -119.5332, elevation_m: 2693,
    type: 'destination',
    notes: 'Highest incident rate, cables',
  },
  {
    name: 'Glacier Point Overlook',
    lat: 37.7268, lon: -119.5724, elevation_m: 2199,
    type: 'destination',
    notes: 'Cliff edge, 2199m',
  },
  {
    name: 'Upper Yosemite Falls',
    lat: 37.7560, lon: -119.5970, elevation_m: 2430,
    type: 'destination',
    notes: '2430m overlook',
  },
  {
    name: 'El Capitan Base',
    lat: 37.7336, lon: -119.6376, elevation_m: 1098,
    type: 'destination',
    notes: 'Climber rescue zone',
  },
  {
    name: 'Tioga Pass Summit',
    lat: 37.9101, lon: -119.2555, elevation_m: 3031,
    type: 'destination',
    notes: '3031m, altitude sickness',
  },
];
