import { NextRequest, NextResponse } from 'next/server';

const SCALA = process.env.SCALA_URL ?? 'http://localhost:8080';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const res = await fetch(`${SCALA}/api/v1/incidents/${id}/police-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return NextResponse.json(await res.json(), { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Scala backend unavailable' }, { status: 503 });
  }
}
