import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const west  = searchParams.get('west');
  const south = searchParams.get('south');
  const east  = searchParams.get('east');
  const north = searchParams.get('north');

  if (!west || !south || !east || !north) {
    return NextResponse.json(
      { error: 'west, south, east, north query params are required' },
      { status: 400 }
    );
  }

  const url = `${BACKEND}/api/terrain/?west=${west}&south=${south}&east=${east}&north=${north}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[TRAIL][terrain] Upstream ${res.status} from ${url}`);
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const msg = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
    console.error(`[TRAIL][terrain] 503 — could not reach ${url} | ${msg}`);
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
  }
}
