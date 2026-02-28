export interface BBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface ElevationResponse {
  grid: number[];
  width: number;
  height: number;
  bbox: BBox;
  minElev: number;
  maxElev: number;
  source: 'opentopography' | 'usgs' | 'procedural';
}
