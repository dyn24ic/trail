import { NextRequest, NextResponse } from 'next/server';

const SCALA = process.env.SCALA_URL ?? 'http://localhost:8080';

export async function GET() {
  const url = `${SCALA}/api/v1/incidents`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.error(`[TRAIL][incidents] Upstream ${res.status} from ${url}`);
      return NextResponse.json({ error: 'Scala backend error' }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    const msg = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
    console.error(`[TRAIL][incidents] 503 — could not reach ${url} | ${msg}`);
    return NextResponse.json({ error: 'Scala backend unavailable' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const url = `${SCALA}/api/v1/triggers`;
  try {
    const body = await req.json();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[TRAIL][incidents/POST] Upstream ${res.status} from ${url}`);
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const msg = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
    console.error(`[TRAIL][incidents/POST] 503 — could not reach ${url} | ${msg}`);
    return NextResponse.json({ error: 'Scala backend unavailable' }, { status: 503 });
  }
}
