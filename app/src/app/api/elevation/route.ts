import { NextRequest, NextResponse } from 'next/server';
import type { BBox, ElevationResponse } from '@/types/elevation';
import { generateProceduralGrid } from '@/lib/elevation/fallbackTerrain';
import { fetchOpenTopo } from '@/lib/elevation/fetchOpenTopo';
import { parseGeoTiff } from '@/lib/elevation/parseGeoTiff';
import { fetchUSGSGrid } from '@/lib/elevation/fetchUSGS';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const south = parseFloat(searchParams.get('south') ?? '37.70');
  const north = parseFloat(searchParams.get('north') ?? '37.82');
  const west  = parseFloat(searchParams.get('west')  ?? '-119.62');
  const east  = parseFloat(searchParams.get('east')  ?? '-119.47');
  const res   = Math.min(512, Math.max(8, parseInt(searchParams.get('res') ?? '256', 10)));

  const bbox: BBox = { south, north, west, east };

  // Tier 1: OpenTopography GeoTIFF
  if (process.env.OPENTOPO_API_KEY) {
    try {
      const buffer = await fetchOpenTopo(bbox);
      const { grid, minElev, maxElev } = await parseGeoTiff(buffer, res);
      const body: ElevationResponse = {
        grid, width: res, height: res, bbox, minElev, maxElev,
        source: 'opentopography',
      };
      return NextResponse.json(body, {
        headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' },
      });
    } catch (err) {
      console.warn('OpenTopography fetch failed, trying USGS fallback:', err);
    }
  }

  // Tier 2: USGS EPQS point queries — only when OpenTopo key is set but failed,
  // and for small grids only to avoid excessive network requests.
  if (process.env.OPENTOPO_API_KEY && res <= 32) {
    try {
      const { grid, minElev, maxElev } = await fetchUSGSGrid(bbox, res);
      const body: ElevationResponse = {
        grid, width: res, height: res, bbox, minElev, maxElev,
        source: 'usgs',
      };
      return NextResponse.json(body, {
        headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' },
      });
    } catch (err) {
      console.warn('USGS EPQS failed, using procedural fallback:', err);
    }
  }

  // Tier 3: Procedural fallback
  const { grid, minElev, maxElev } = generateProceduralGrid(res, 20);
  const body: ElevationResponse = {
    grid, width: res, height: res, bbox, minElev, maxElev,
    source: 'procedural',
  };
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' },
  });
}
