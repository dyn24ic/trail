import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const z = searchParams.get('z');
  const x = searchParams.get('x');
  const y = searchParams.get('y');

  if (!z || !x || !y) {
    return NextResponse.json({ error: 'missing params' }, { status: 400 });
  }

  // Proxy kept for potential future use, but OSM layer now fetches tiles directly from browser
  const tileUrl = `https://a.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`;
  const res = await fetch(tileUrl, {
    headers: { 'User-Agent': 'trAIl/1.0 trail-guardian-safety-app' },
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
