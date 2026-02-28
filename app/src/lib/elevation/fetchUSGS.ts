import type { BBox } from '@/types/elevation';

const CONCURRENCY = 4;

/**
 * Query USGS Elevation Point Query Service for a grid of points.
 * Only suitable for small grids (res ≤ 32) to avoid excessive requests.
 */
export async function fetchUSGSGrid(
  bbox: BBox,
  res: number,
): Promise<{ grid: number[]; minElev: number; maxElev: number }> {
  if (res > 32) throw new Error('USGS point query not suitable for res > 32');

  const points: { lat: number; lon: number; row: number; col: number }[] = [];

  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      // row 0 = north
      const lat = bbox.north - (row / (res - 1)) * (bbox.north - bbox.south);
      const lon = bbox.west  + (col / (res - 1)) * (bbox.east  - bbox.west);
      points.push({ lat, lon, row, col });
    }
  }

  const grid = new Array(res * res).fill(0);
  let minElev = Infinity;
  let maxElev = -Infinity;

  // Process in batches of CONCURRENCY
  for (let i = 0; i < points.length; i += CONCURRENCY) {
    const batch = points.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(({ lat, lon }) => queryUSGSPoint(lat, lon)),
    );

    results.forEach((result, idx) => {
      const { row, col } = batch[idx];
      const h = result.status === 'fulfilled' ? result.value : 0;
      grid[row * res + col] = h;
      if (h < minElev) minElev = h;
      if (h > maxElev) maxElev = h;
    });
  }

  return { grid, minElev, maxElev };
}

async function queryUSGSPoint(lat: number, lon: number): Promise<number> {
  const url = `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&wkid=4326&includeDate=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`USGS EPQS error ${res.status}`);
  const json = await res.json() as { value: string };
  const h = parseFloat(json.value);
  return isNaN(h) ? 0 : h;
}
