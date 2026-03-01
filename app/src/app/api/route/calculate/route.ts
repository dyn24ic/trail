import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000';

export async function POST(req: NextRequest) {
  const url = `${BACKEND}/api/route/calculate/`;
  try {
    const body = await req.json();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[TRAIL][route/calculate] Upstream ${res.status} from ${url} | response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const msg = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
    console.error(`[TRAIL][route/calculate] 503 — could not reach ${url} | ${msg}`);
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
  }
}
