/**
 * Procedural terrain functions ported from the original HTML files.
 * Used as fallback when no elevation API key is available.
 */

/** mountainH — landing page mountain (Half Dome / El Capitan hybrid) */
export function mountainH(x: number, z: number): number {
  const nx = x / 10, nz = z / 10;

  const peakX = 0.0, peakZ = -0.25;
  const d1 = Math.sqrt(((nx - peakX) * 0.9) ** 2 + ((nz - peakZ) * 1.3) ** 2);
  const peak = Math.max(0, 1 - d1 * 1.7) ** 1.8 * 7.8;

  const d2 = Math.sqrt(((nx + 0.5) * 1.1) ** 2 + ((nz + 0.1) * 0.9) ** 2);
  const shoulder = Math.max(0, (1 - d2 * 1.9) ** 2) * 4.5;

  const d3 = Math.sqrt(((nx - 0.55) * 1.2) ** 2 + ((nz - 0.05) * 0.8) ** 2);
  const eRidge = Math.max(0, (1 - d3 * 2.0) ** 2) * 3.8;

  const valleyZ = Math.max(0, nz - 0.15);
  const valley = valleyZ * 2.2;

  const fore = Math.max(0, nz - 0.45) * 1.2;

  const n1 = Math.sin(x * 0.7 + 0.8) * Math.cos(z * 0.6 - 0.4) * 0.6;
  const n2 = Math.sin(x * 1.6 - 0.9) * Math.sin(z * 1.4 + 0.6) * 0.3;
  const n3 = Math.cos(x * 3.2 + z * 2.8) * 0.18;
  const n4 = Math.sin(x * 6.5 - z * 5.1) * 0.08;

  return Math.max(0.05, 0.35 + peak + shoulder + eRidge - valley + fore + n1 + n2 + n3 + n4);
}

/** yosemiteH — dashboard terrain (Yosemite Valley accurate topology) */
export function yosemiteH(x: number, z: number): number {
  const nx = x / 9, nz = z / 9;

  const valleyW = 0.22 + Math.sin((nx + 1) * Math.PI * 0.5) * 0.06;
  const valleyDepth = Math.max(0, 1 - (nz / valleyW) ** 2) * 0.28;
  let h = 0.38 - valleyDepth;

  const nWall = Math.max(0, -nz - 0.18) * 3.8;
  h += nWall;

  const sWall = Math.max(0, nz - 0.22) * 3.2;
  h += sWall;

  const ecX = -0.58, ecZ = -0.38;
  const ecD = Math.sqrt(((nx - ecX) * 1.4) ** 2 + ((nz - ecZ) * 3.2) ** 2);
  h += Math.max(0, (1 - ecD * 1.7) ** 2) * 4.2;

  const hdX = 0.52, hdZ = -0.1;
  const hdD = Math.sqrt(((nx - hdX) * 2.2) ** 2 + ((nz - hdZ) * 2.8) ** 2);
  h += Math.max(0, 1 - hdD * 2.4) ** 2.8 * 5.8;

  const yfX = -0.05, yfZ = -0.42;
  const yfD = Math.sqrt(((nx - yfX) * 1.3) ** 2 + ((nz - yfZ) * 2.5) ** 2);
  h += Math.max(0, (1 - yfD * 2.1) ** 2) * 2.8;

  const nfX = 0.35, nfZ = 0.38;
  const nfD = Math.sqrt(((nx - nfX) * 1.6) ** 2 + ((nz - nfZ) * 1.8) ** 2);
  h += Math.max(0, (1 - nfD * 2.0) ** 2) * 2.2;

  h += Math.max(0, nx - 0.35) * 2.2;

  const n = Math.sin(x * 0.75 + 0.9) * Math.cos(z * 0.65 - 0.4) * 0.35 +
    Math.sin(x * 1.7 - 0.6) * Math.sin(z * 1.5 + 0.7) * 0.18 +
    Math.cos(x * 3.3 + z * 2.9) * 0.1 +
    Math.sin(x * 6.2 - z * 5.3) * 0.05;

  return Math.max(0.04, h + n);
}

/**
 * Generate a procedural grid using yosemiteH for the given resolution.
 * Returns flat row-major array with minElev/maxElev metadata.
 */
export function generateProceduralGrid(res: number, meshSize: number): {
  grid: number[];
  minElev: number;
  maxElev: number;
} {
  const grid: number[] = [];
  let minElev = Infinity;
  let maxElev = -Infinity;

  // Row 0 = north in our convention (GeoTIFF style), so iterate z from north to south
  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      // Map [0,res-1] → [-meshSize/2, meshSize/2] in world space
      // row=0 → north → z = -meshSize/2
      const x = (col / (res - 1) - 0.5) * meshSize;
      const z = ((res - 1 - row) / (res - 1) - 0.5) * meshSize; // flip: row0=north
      const h = yosemiteH(x, z);
      grid.push(h);
      if (h < minElev) minElev = h;
      if (h > maxElev) maxElev = h;
    }
  }

  return { grid, minElev, maxElev };
}
