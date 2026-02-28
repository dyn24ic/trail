export interface Landmark {
  name: string;
  lat: number;
  lon: number;
  color: number;
  colorHex: string;
  description: string;
}

export const landmarkData: Landmark[] = [
  {
    name: 'Half Dome',
    lat: 37.7459, lon: -119.5332,
    color: 0xFFD700, colorHex: '#FFD700',
    description: '2693m · Granite monolith',
  },
  {
    name: 'Yosemite Falls',
    lat: 37.7553, lon: -119.5963,
    color: 0x4A9FD4, colorHex: '#4A9FD4',
    description: '739m drop · Highest in N.America',
  },
  {
    name: 'Glacier Point',
    lat: 37.7268, lon: -119.5724,
    color: 0xFF8C42, colorHex: '#FF8C42',
    description: '2199m · Panoramic overlook',
  },
  {
    name: 'Vernal Fall',
    lat: 37.7267, lon: -119.5448,
    color: 0x4AD4C8, colorHex: '#4AD4C8',
    description: '97m drop · Mist Trail',
  },
  {
    name: 'Nevada Fall',
    lat: 37.7301, lon: -119.5312,
    color: 0x4AD4C8, colorHex: '#4AD4C8',
    description: '181m drop · John Muir Trail',
  },
  {
    name: 'Mirror Lake',
    lat: 37.7483, lon: -119.5098,
    color: 0x00CFFF, colorHex: '#00CFFF',
    description: 'Reflective seasonal lake',
  },
  {
    name: 'Valley Floor',
    lat: 37.7398, lon: -119.5850,
    color: 0x00FF88, colorHex: '#00FF88',
    description: '1200m · Main visitor area',
  },
  {
    name: 'El Capitan',
    lat: 37.7336, lon: -119.6376,
    color: 0xE8D5A3, colorHex: '#E8D5A3',
    description: '2307m · Iconic granite wall',
  },
  {
    name: 'Tuolumne Meadows',
    lat: 37.8758, lon: -119.3562,
    color: 0x7BC47F, colorHex: '#7BC47F',
    description: '2621m · High Sierra meadow',
  },
  {
    name: 'Tenaya Lake',
    lat: 37.8356, lon: -119.4675,
    color: 0x00CFFF, colorHex: '#00CFFF',
    description: '2484m · Alpine lake',
  },
  {
    name: 'Tioga Pass',
    lat: 37.9101, lon: -119.2555,
    color: 0xB0C4DE, colorHex: '#B0C4DE',
    description: '3031m · Eastern gateway',
  },
  {
    name: 'Hetch Hetchy',
    lat: 37.9534, lon: -119.7801,
    color: 0x4ADEC8, colorHex: '#4ADEC8',
    description: '1158m · Reservoir valley',
  },
  {
    name: 'Wawona',
    lat: 37.5371, lon: -119.6546,
    color: 0xD4A05A, colorHex: '#D4A05A',
    description: '1211m · South entrance',
  },
  {
    name: 'White Wolf',
    lat: 37.8660, lon: -119.6451,
    color: 0xA8D8A8, colorHex: '#A8D8A8',
    description: '2392m · Backcountry camp',
  },
  {
    name: 'Bridalveil Fall',
    lat: 37.7157, lon: -119.6519,
    color: 0x80C0FF, colorHex: '#80C0FF',
    description: '188m drop · Valley entrance',
  },
];
