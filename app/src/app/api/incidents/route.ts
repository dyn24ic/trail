import { NextRequest, NextResponse } from 'next/server';

const SCALA = process.env.SCALA_URL ?? 'http://localhost:8080';

export async function GET() {
  try {
    const res = await fetch(`${SCALA}/api/v1/incidents`, { cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ error: 'Scala backend error' }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Scala backend unavailable' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${SCALA}/api/v1/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Scala backend unavailable' }, { status: 503 });
  }
}
