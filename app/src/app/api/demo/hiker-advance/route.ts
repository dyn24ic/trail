import { NextRequest, NextResponse } from 'next/server';

// In-memory state — works for single-process dev/demo
let pendingAdvances: string[] = [];
let pendingReset = false;

export async function GET() {
  const result = { advances: pendingAdvances, reset: pendingReset };
  pendingAdvances = [];
  pendingReset = false;
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { hikerId?: string; reset?: boolean };
  if (body.reset === true) {
    pendingReset = true;
    pendingAdvances = [];
  } else if (typeof body.hikerId === 'string') {
    pendingAdvances.push(body.hikerId);
  }
  return NextResponse.json({ ok: true });
}
