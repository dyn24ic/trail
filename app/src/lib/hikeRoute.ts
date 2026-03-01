export interface HikeNode {
  lat: number;
  lon: number;
  elevation_m: number | null; // null until terrain query resolves
}

export interface HikeStats {
  totalDistanceKm: number;
  elevationGainM: number;
  elevationLossM: number;
  estimatedTimeMin: number;   // Naismith's Rule: (dist/5 + gain/600) × 60
  difficulty: 'Easy' | 'Moderate' | 'Hard' | 'Expert';
  cumulativeDistancesKm: number[]; // one per waypoint, for SVG x-axis
  hasElevationData: boolean;       // true when ≥2 nodes have non-null elevation_m
}

export class HikeRoute {
  static haversineKm(a: HikeNode, b: HikeNode): number {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  static naismithMinutes(distKm: number, gainM: number): number {
    return (distKm / 5 + gainM / 600) * 60;
  }

  static classifyDifficulty(distKm: number, gainM: number): HikeStats['difficulty'] {
    if (gainM > 1000 || distKm > 25) return 'Expert';
    if (gainM > 600  || distKm > 15) return 'Hard';
    if (gainM > 300  || distKm > 8)  return 'Moderate';
    return 'Easy';
  }

  static computeStats(nodes: HikeNode[]): HikeStats | null {
    if (nodes.length < 2) return null;

    let totalDistanceKm = 0;
    let elevationGainM = 0;
    let elevationLossM = 0;
    const cumulativeDistancesKm: number[] = [0];

    let elevNodesCount = 0;
    for (const n of nodes) {
      if (n.elevation_m !== null) elevNodesCount++;
    }
    const hasElevationData = elevNodesCount >= 2;

    for (let i = 1; i < nodes.length; i++) {
      const seg = HikeRoute.haversineKm(nodes[i - 1], nodes[i]);
      totalDistanceKm += seg;
      cumulativeDistancesKm.push(totalDistanceKm);

      if (hasElevationData) {
        const prevElev = nodes[i - 1].elevation_m;
        const currElev = nodes[i].elevation_m;
        if (prevElev !== null && currElev !== null) {
          const delta = currElev - prevElev;
          if (delta > 0) elevationGainM += delta;
          else elevationLossM += Math.abs(delta);
        }
      }
    }

    return {
      totalDistanceKm,
      elevationGainM,
      elevationLossM,
      estimatedTimeMin: HikeRoute.naismithMinutes(totalDistanceKm, elevationGainM),
      difficulty: HikeRoute.classifyDifficulty(totalDistanceKm, elevationGainM),
      cumulativeDistancesKm,
      hasElevationData,
    };
  }
}

// Hardcoded example: Mist Trail → Half Dome (Yosemite)
// ~7.4km one-way, ~1469m gain → Hard
export const YOSEMITE_EXAMPLE_ROUTE: HikeNode[] = [
  { lat: 37.7323, lon: -119.5582, elevation_m: 1224 }, // Happy Isles TH
  { lat: 37.7289, lon: -119.5459, elevation_m: 1372 }, // Vernal Fall bridge
  { lat: 37.7267, lon: -119.5448, elevation_m: 1573 }, // Top of Vernal Fall
  { lat: 37.7301, lon: -119.5312, elevation_m: 1921 }, // Top of Nevada Fall
  { lat: 37.7459, lon: -119.5332, elevation_m: 2693 }, // Half Dome Summit
];
