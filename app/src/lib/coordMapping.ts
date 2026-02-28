import type { BBox } from '@/types/elevation';

/**
 * Convert real lat/lon to Three.js mesh x/z coordinates.
 */
export function latLonToMesh(
  lat: number,
  lon: number,
  bbox: BBox,
  meshSize = 20,
): { x: number; z: number } {
  const normLon = (lon - bbox.west) / (bbox.east - bbox.west);
  const normLat = (lat - bbox.south) / (bbox.north - bbox.south);
  return {
    x: (normLon - 0.5) * meshSize,
    z: -(normLat - 0.5) * meshSize,
  };
}

/**
 * Convert a DEM grid (row 0 = north, GeoTIFF convention) to Three.js vertex Y heights.
 * PlaneGeometry after rotateX(-π/2) has row 0 = south, so we flip rows.
 */
export function demGridToVertexHeights(
  grid: number[],
  res: number,
  minElev: number,
  maxElev: number,
  targetHeight = 7.0,
): Float32Array {
  const range = maxElev - minElev || 1;
  const heights = new Float32Array(res * res);

  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      // Flip row: GeoTIFF row 0 = north, Three.js PlaneGeometry row 0 = south
      const geoRow = (res - 1) - row;
      const elevRaw = grid[geoRow * res + col];
      const h = Math.max(0.04, ((elevRaw - minElev) / range) * targetHeight);
      heights[row * res + col] = h;
    }
  }
  return heights;
}

/**
 * Sample height at a Three.js mesh position (x, z) from a vertex heights array.
 * Uses bilinear interpolation.
 */
export function heightAtMeshPos(
  x: number,
  z: number,
  heights: Float32Array,
  res: number,
  meshSize = 20,
): number {
  // Map x,z from [-meshSize/2, meshSize/2] to [0, res-1]
  const u = (x / meshSize + 0.5) * (res - 1);
  const v = (z / meshSize + 0.5) * (res - 1); // v=0 → south (Three.js row 0)

  const col = Math.max(0, Math.min(res - 2, Math.floor(u)));
  const row = Math.max(0, Math.min(res - 2, Math.floor(v)));
  const fu = u - col;
  const fv = v - row;

  const h00 = heights[row * res + col];
  const h10 = heights[row * res + (col + 1)];
  const h01 = heights[(row + 1) * res + col];
  const h11 = heights[(row + 1) * res + (col + 1)];

  return h00 * (1 - fu) * (1 - fv) +
    h10 * fu * (1 - fv) +
    h01 * (1 - fu) * fv +
    h11 * fu * fv;
}
