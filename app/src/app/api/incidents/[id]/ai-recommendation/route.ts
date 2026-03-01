import { NextRequest, NextResponse } from 'next/server';

const SCALA = process.env.SCALA_URL ?? 'http://localhost:8080';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const res = await fetch(`${SCALA}/api/v1/incidents/${id}/ai-recommendation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return NextResponse.json(await res.json(), { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Scala backend unavailable' }, { status: 503 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const res = await fetch(`${SCALA}/api/v1/incidents/${id}/ai-recommendation`, { cache: 'no-store' });
    if (!res.ok) return NextResponse.json(await res.json(), { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Scala backend unavailable' }, { status: 503 });
  }
}
