import type { Weather, HybridRoute, LatLon, RouteCalculateResponse } from '@/types/backend';

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

// ── Haversine distance in km ────────────────────────────────────────────────
export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

// ── Fetch road route via OSRM (free, no API key) ───────────────────────────
export async function getRoadRoute(
  a: LatLon,
  b: LatLon
): Promise<{ path: LatLon[]; durationSeconds: number }> {
  const url = `${OSRM_BASE}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM error ${res.status}`);
  const data = await res.json();
  if (!data.routes?.length) throw new Error('OSRM returned no routes');
  const coords: [number, number][] = data.routes[0].geometry.coordinates;
  const path: LatLon[] = coords.map(([lon, lat]) => ({ lat, lon }));
  return { path, durationSeconds: data.routes[0].duration as number };
}

// ── Sample N evenly-spaced candidate stop points near victim ───────────────
export function sampleCandidateStops(
  roadPath: LatLon[],
  victim: LatLon,
  n = 4
): LatLon[] {
  let nearby = roadPath.filter((p) => haversineKm(p, victim) <= 2);
  if (nearby.length < n) {
    nearby = roadPath.filter((p) => haversineKm(p, victim) <= 4);
  }
  if (nearby.length < n) {
    nearby = roadPath.filter((p) => haversineKm(p, victim) <= 8);
  }
  if (nearby.length === 0) {
    // Fallback: take last N points of the road
    return roadPath.slice(-n);
  }
  if (nearby.length <= n) return nearby;
  // Evenly sample
  const step = (nearby.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => nearby[Math.round(i * step)]);
}

// ── Weather penalty multiplier ─────────────────────────────────────────────
export function computeWeatherPenalty(weather: Weather): {
  penalty: number;
  reason: string;
} {
  const { conditions, precipitation_mm_1h } = weather;
  let penalty = 1.0;
  let reason = '';

  if (conditions.storm) {
    penalty += 1.0;
    reason = 'Storm detected';
  } else if (conditions.heavy_rain) {
    penalty += 1.0;
    reason = 'Heavy rain detected';
  }
  if (conditions.snow) {
    penalty += 0.8;
    reason = reason ? reason + ' + snow' : 'Snow detected';
  }
  if (conditions.fog) {
    penalty += 0.5;
    reason = reason ? reason + ' + fog' : 'Fog detected';
  } else if (precipitation_mm_1h > 2 && !conditions.heavy_rain) {
    penalty += 0.5;
    reason = reason ? reason + ' + rain' : 'Rain detected';
  }

  if (!reason) reason = 'Clear conditions';
  return { penalty, reason };
}

// ── Call backend route calculation ─────────────────────────────────────────
async function calcBackendRoute(
  responder: LatLon,
  victim: LatLon,
  severity: number
): Promise<RouteCalculateResponse> {
  const res = await fetch('/api/route/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      responder_lat: responder.lat,
      responder_lon: responder.lon,
      victim_lat: victim.lat,
      victim_lon: victim.lon,
      severity,
      route_type: 'ground',
    }),
  });
  if (!res.ok) throw new Error(`Backend error ${res.status}`);
  return res.json();
}

// ── Main optimisation: find best stop point ────────────────────────────────
export async function findOptimalStop(params: {
  ambulance: LatLon;
  victim: LatLon;
  severity: number;
  weather: Weather;
}): Promise<HybridRoute> {
  const { ambulance, victim, severity, weather } = params;

  // 1. Get road route from OSRM
  const { path: roadPath, durationSeconds } = await getRoadRoute(ambulance, victim);
  const roadEtaMinutes = durationSeconds / 60;

  // 2. Sample candidates
  const candidates = sampleCandidateStops(roadPath, victim);

  // 3. Weather penalty
  const { penalty, reason } = computeWeatherPenalty(weather);
  const penaltyApplied = penalty > 1.0;

  // 4. Estimate road_time for each candidate (proportional to progress along path)
  const totalPathLen = roadPath.reduce((acc, p, i) => {
    if (i === 0) return 0;
    return acc + haversineKm(roadPath[i - 1], p);
  }, 0);

  function roadTimeToPoint(candidate: LatLon): number {
    // Find nearest index in roadPath to candidate
    let minDist = Infinity;
    let nearestIdx = 0;
    roadPath.forEach((p, i) => {
      const d = haversineKm(p, candidate);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    });
    // Partial distance up to that index
    let partialLen = 0;
    for (let i = 1; i <= nearestIdx; i++) {
      partialLen += haversineKm(roadPath[i - 1], roadPath[i]);
    }
    return totalPathLen > 0 ? (partialLen / totalPathLen) * roadEtaMinutes : 0;
  }

  // 5. Call backend in parallel for all candidates
  const results = await Promise.allSettled(
    candidates.map((c) => calcBackendRoute(c, victim, severity))
  );

  // 6. Score each successful result
  let bestScore = Infinity;
  let bestIdx = 0;

  results.forEach((result, i) => {
    if (result.status !== 'fulfilled') return;
    const route = result.value.route;
    const candidateRoadTime = roadTimeToPoint(candidates[i]);
    const mountainEta = route.eta_minutes;
    const safetyScore = route.safety_score;
    const score = candidateRoadTime + penalty * mountainEta * (1 + safetyScore * 2);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });

  // Fallback: if all failed, try direct route
  const winnerResult = results[bestIdx];
  let mountainRoute: RouteCalculateResponse;
  if (winnerResult.status === 'fulfilled') {
    mountainRoute = winnerResult.value;
  } else {
    mountainRoute = await calcBackendRoute(ambulance, victim, severity);
  }

  const stopPoint = candidates[bestIdx] ?? roadPath[roadPath.length - 1];
  const mountainEta = mountainRoute.route.eta_minutes;
  const candidateRoadTime = roadTimeToPoint(stopPoint);

  const penaltyDescription = penaltyApplied
    ? `${reason} – route prefers longer road drive to minimise mountain exposure`
    : 'Clear conditions – most direct route selected';

  return {
    roadPath,
    stopPoint,
    mountainRoute,
    roadEtaMinutes: candidateRoadTime,
    totalEtaMinutes: candidateRoadTime + mountainEta,
    weatherPenaltyApplied: penaltyApplied,
    penaltyReason: penaltyDescription,
  };
}
