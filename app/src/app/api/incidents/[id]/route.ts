import { NextRequest, NextResponse } from 'next/server';

const SCALA = process.env.SCALA_URL ?? 'http://localhost:8080';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = `${SCALA}/api/v1/incidents/${id}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.error(`[TRAIL][incidents/${id}] Upstream ${res.status} from ${url}`);
      return NextResponse.json({ error: 'Not found' }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    const msg = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
    console.error(`[TRAIL][incidents/${id}] 503 — could not reach ${url} | ${msg}`);
    return NextResponse.json({ error: 'Scala backend unavailable' }, { status: 503 });
  }
}
