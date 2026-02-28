import { NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000';

export async function GET(req: Request) {
  const qs = new URL(req.url).searchParams.toString();
  try {
    const res = await fetch(`${BACKEND}/api/hotspots/predict/?${qs}`, { cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ error: 'Backend error' }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
  }
}
