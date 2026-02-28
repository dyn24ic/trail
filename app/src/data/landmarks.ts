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
];
