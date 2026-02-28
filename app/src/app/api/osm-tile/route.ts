import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const z = searchParams.get('z');
  const x = searchParams.get('x');
  const y = searchParams.get('y');

  if (!z || !x || !y) {
    return NextResponse.json({ error: 'missing params' }, { status: 400 });
  }

  const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
    headers: {
      'User-Agent': 'trAIl/1.0 (trail-guardian safety-research)',
      'Referer': 'https://www.openstreetmap.org',
    },
  });

  if (!res.ok) {
    return new NextResponse(null, { status: res.status });
  }

  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
