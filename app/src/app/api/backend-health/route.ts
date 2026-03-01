import { NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000';

export async function GET() {
  const url = `${BACKEND}/api/health/`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 30 },
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[TRAIL][backend-health] Upstream ${res.status} from ${url}`);
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const msg = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
    console.error(`[TRAIL][backend-health] 503 — could not reach ${url} | ${msg}`);
    return NextResponse.json(
      { status: 'error', error: 'Backend unavailable' },
      { status: 503 }
    );
  }
}
