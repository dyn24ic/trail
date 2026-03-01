export type TrafficLevel = 'high' | 'medium' | 'low';

export interface TrailSegment {
  id: string;
  name: string;
  traffic: TrafficLevel;
  coords: [number, number][]; // GeoJSON order: [lon, lat]
}

export const TRAIL_SEGMENTS: TrailSegment[] = [
  // ── High traffic ─────────────────────────────────────────────────────────
  {
    id: 'T01',
    name: 'Mist Trail',
    traffic: 'high',
    coords: [
      [-119.5582, 37.7323], // Happy Isles TH
      [-119.5520, 37.7305], // lower mist trail
      [-119.5459, 37.7289], // Vernal Fall Bridge
      [-119.5452, 37.7278], // mist trail upper
      [-119.5448, 37.7267], // Top of Vernal Fall
      [-119.5398, 37.7280], // between falls
      [-119.5312, 37.7301], // Nevada Fall Top
    ],
  },
  {
    id: 'T02',
    name: 'Half Dome via JMT',
    traffic: 'high',
    coords: [
      [-119.5312, 37.7301], // Nevada Fall Top
      [-119.5296, 37.7340], // JMT connector
      [-119.5280, 37.7380], // Little Yosemite Valley
      [-119.5315, 37.7410], // sub-dome approach
      [-119.5342, 37.7451], // Half Dome Cables Junction
      [-119.5332, 37.7459], // Half Dome Summit
    ],
  },
  {
    id: 'T03',
    name: 'Upper Yosemite Falls Trail',
    traffic: 'high',
    coords: [
      [-119.5977, 37.7485], // Yosemite Falls TH
      [-119.5990, 37.7498], // lower switchbacks
      [-119.5975, 37.7520], // mid trail
      [-119.5968, 37.7545], // upper section
      [-119.5963, 37.7553], // Yosemite Falls Top
      [-119.5970, 37.7560], // Upper Falls viewpoint
    ],
  },

  // ── Medium traffic ────────────────────────────────────────────────────────
  {
    id: 'T04',
    name: 'Panorama Trail',
    traffic: 'medium',
    coords: [
      [-119.5724, 37.7268], // Glacier Point
      [-119.5680, 37.7285], // panorama cliff approach
      [-119.5620, 37.7310], // Panorama Cliff Junction
      [-119.5510, 37.7305], // east traverse
      [-119.5390, 37.7298], // approaching Nevada Fall
      [-119.5312, 37.7301], // Nevada Fall Top
    ],
  },
  {
    id: 'T05',
    name: 'Four Mile Trail',
    traffic: 'medium',
    coords: [
      [-119.5900, 37.7415], // Valley floor (Four Mile TH)
      [-119.5850, 37.7380], // lower switchbacks
      [-119.5810, 37.7345], // mid trail
      [-119.5780, 37.7320], // upper section
      [-119.5750, 37.7295], // approaching rim
      [-119.5724, 37.7268], // Glacier Point
    ],
  },
  {
    id: 'T06',
    name: 'Mirror Lake Loop',
    traffic: 'medium',
    coords: [
      [-119.5550, 37.7413], // Mirror Lake TH
      [-119.5530, 37.7430], // west shore
      [-119.5510, 37.7448], // north end
      [-119.5490, 37.7442], // east shore
      [-119.5495, 37.7425], // south return
      [-119.5530, 37.7415], // close loop approach
      [-119.5550, 37.7413], // back to TH
    ],
  },
  {
    id: 'T07',
    name: 'Tenaya Lake to Clouds Rest',
    traffic: 'medium',
    coords: [
      [-119.4675, 37.8356], // Tenaya Lake East Shore
      [-119.4680, 37.8290], // Sunrise Lakes trail split
      [-119.4682, 37.8210], // mid climb
      [-119.4680, 37.8120], // upper approach
      [-119.4680, 37.7970], // Clouds Rest Junction
    ],
  },
  {
    id: 'T08',
    name: 'Tuolumne Meadows Connector',
    traffic: 'medium',
    coords: [
      [-119.3618, 37.8761], // Tuolumne Meadows TH
      [-119.3660, 37.8772], // west meadow trail
      [-119.3700, 37.8778], // approaching bridge
      [-119.3720, 37.8780], // Tuolumne River Bridge
    ],
  },
  {
    id: 'T09',
    name: 'Sentinel Dome Trail',
    traffic: 'medium',
    coords: [
      [-119.5826, 37.7100], // Sentinel Dome TH
      [-119.5850, 37.7088], // south approach
      [-119.5863, 37.7072], // west flank
      [-119.5860, 37.7059], // Sentinel Dome summit
    ],
  },
  {
    id: 'T10',
    name: 'Bridalveil / Valley West',
    traffic: 'medium',
    coords: [
      [-119.6519, 37.7161], // Bridalveil Fall TH
      [-119.6500, 37.7168], // approach path
      [-119.6483, 37.7173], // Bridalveil Fall viewpoint
      [-119.6460, 37.7196], // valley connector west
      [-119.6420, 37.7270], // valley floor west
      [-119.6376, 37.7336], // El Capitan Base
    ],
  },
  {
    id: 'T11',
    name: 'Valley Floor East',
    traffic: 'medium',
    coords: [
      [-119.5550, 37.7413], // Mirror Lake TH
      [-119.5555, 37.7395], // valley floor east
      [-119.5565, 37.7375], // mid connector
      [-119.5575, 37.7355], // approaching Happy Isles
      [-119.5582, 37.7323], // Happy Isles TH
    ],
  },

  // ── Low traffic ───────────────────────────────────────────────────────────
  {
    id: 'T12',
    name: 'Hetch Hetchy Trail',
    traffic: 'low',
    coords: [
      [-119.7801, 37.9534], // Hetch Hetchy Dam TH
      [-119.7700, 37.9535], // along reservoir west
      [-119.7600, 37.9530], // mid reservoir
      [-119.7500, 37.9490], // reservoir east
      [-119.7420, 37.9465], // far east section
    ],
  },
  {
    id: 'T13',
    name: 'Wawona / Mariposa Grove',
    traffic: 'low',
    coords: [
      [-119.6027, 37.5071], // Wawona TH
      [-119.6010, 37.5060], // lower grove
      [-119.5995, 37.5040], // mid grove
      [-119.5983, 37.5020], // upper grove
      [-119.5978, 37.5000], // Mariposa Grove upper
    ],
  },
  {
    id: 'T14',
    name: 'White Wolf Backcountry',
    traffic: 'low',
    coords: [
      [-119.6451, 37.8660], // White Wolf TH
      [-119.6250, 37.8610], // east traverse
      [-119.6050, 37.8560], // mid backcountry
      [-119.5900, 37.8520], // far east
      [-119.5800, 37.8490], // east backcountry end
    ],
  },
  {
    id: 'T15',
    name: 'May Lake Trail',
    traffic: 'low',
    coords: [
      [-119.4868, 37.8280], // May Lake TH
      [-119.4880, 37.8295], // lower trail
      [-119.4892, 37.8315], // mid trail
      [-119.4905, 37.8342], // May Lake shore
    ],
  },
  {
    id: 'T16',
    name: 'High Sierra Connector',
    traffic: 'low',
    coords: [
      [-119.4675, 37.8356], // Tenaya Lake East Shore
      [-119.4740, 37.8330], // connector trail
      [-119.4790, 37.8315], // mid connector
      [-119.4830, 37.8298], // approaching May Lake
      [-119.4868, 37.8280], // May Lake TH
    ],
  },
];
