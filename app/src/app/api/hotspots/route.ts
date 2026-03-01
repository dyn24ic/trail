import { NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000';

export async function GET(req: Request) {
  const qs = new URL(req.url).searchParams.toString();
  const url = `${BACKEND}/api/hotspots/predict/?${qs}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.error(`[TRAIL][hotspots] Upstream ${res.status} from ${url}`);
      return NextResponse.json({ error: 'Backend error' }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    const msg = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
    console.error(`[TRAIL][hotspots] 503 — could not reach ${url} | ${msg}`);
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
  }
}
