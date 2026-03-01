import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get('lat');
  const lon = searchParams.get('lon');

  if (!lat || !lon) {
    return NextResponse.json({ error: 'lat and lon query params are required' }, { status: 400 });
  }

  const url = `${BACKEND}/api/weather/?lat=${lat}&lon=${lon}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[TRAIL][weather] Upstream ${res.status} from ${url}`);
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const msg = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
    console.error(`[TRAIL][weather] 503 — could not reach ${url} | ${msg}`);
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
  }
}
