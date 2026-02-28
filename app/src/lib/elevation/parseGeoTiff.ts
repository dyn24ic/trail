import { fromArrayBuffer } from 'geotiff';

/**
 * Parse a GeoTIFF ArrayBuffer and bilinear-resample to a target res×res grid.
 * Returns flat row-major Float32Array (row 0 = north, matching GeoTIFF convention).
 */
export async function parseGeoTiff(
  buffer: ArrayBuffer,
  targetRes: number,
): Promise<{ grid: number[]; minElev: number; maxElev: number }> {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  const rawData = rasters[0] as unknown as Float32Array | Int16Array;

  const srcWidth  = image.getWidth();
  const srcHeight = image.getHeight();

  const grid: number[] = new Array(targetRes * targetRes);
  let minElev = Infinity;
  let maxElev = -Infinity;

  for (let row = 0; row < targetRes; row++) {
    for (let col = 0; col < targetRes; col++) {
      // Map target pixel to source pixel (bilinear)
      const srcU = (col / (targetRes - 1)) * (srcWidth  - 1);
      const srcV = (row / (targetRes - 1)) * (srcHeight - 1);

      const c0 = Math.floor(srcU);
      const r0 = Math.floor(srcV);
      const c1 = Math.min(c0 + 1, srcWidth  - 1);
      const r1 = Math.min(r0 + 1, srcHeight - 1);
      const fu = srcU - c0;
      const fv = srcV - r0;

      const h00 = rawData[r0 * srcWidth + c0];
      const h10 = rawData[r0 * srcWidth + c1];
      const h01 = rawData[r1 * srcWidth + c0];
      const h11 = rawData[r1 * srcWidth + c1];

      const h = h00 * (1 - fu) * (1 - fv) +
                h10 * fu       * (1 - fv) +
                h01 * (1 - fu) * fv       +
                h11 * fu       * fv;

      grid[row * targetRes + col] = h;
      if (h < minElev) minElev = h;
      if (h > maxElev) maxElev = h;
    }
  }

  return { grid, minElev, maxElev };
}
