import type { BBox } from '@/types/elevation';

const DEM_TYPE = process.env.OPENTOPO_DEM_TYPE ?? 'SRTMGL3';

/**
 * Fetch a GeoTIFF from OpenTopography's REST API.
 * Returns raw ArrayBuffer or throws on error.
 */
export async function fetchOpenTopo(bbox: BBox): Promise<ArrayBuffer> {
  const apiKey = process.env.OPENTOPO_API_KEY;
  if (!apiKey) throw new Error('OPENTOPO_API_KEY not set');

  const url = new URL('https://portal.opentopography.org/API/globaldem');
  url.searchParams.set('demtype', DEM_TYPE);
  url.searchParams.set('south',  String(bbox.south));
  url.searchParams.set('north',  String(bbox.north));
  url.searchParams.set('west',   String(bbox.west));
  url.searchParams.set('east',   String(bbox.east));
  url.searchParams.set('outputFormat', 'GTiff');
  url.searchParams.set('API_Key', apiKey);

  const res = await fetch(url.toString(), {
    next: { revalidate: 86400 },
  });

  if (!res.ok) {
    throw new Error(`OpenTopography error ${res.status}: ${await res.text()}`);
  }

  return res.arrayBuffer();
}
