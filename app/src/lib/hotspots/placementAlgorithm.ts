import type { HotspotZone, PlacementSuggestions, SensorSuggestion, CallBoxSuggestion } from '@/types/hotspots';

// 8-entry offset rotation table — spreads sensors around zone centres without stacking
const OFFSETS: [number, number][] = [
  [ 0.003,  0.002],
  [-0.003,  0.002],
  [ 0.002, -0.003],
  [-0.002, -0.003],
  [ 0.003, -0.001],
  [-0.001,  0.003],
  [ 0.002,  0.002],
  [-0.002, -0.002],
];

/**
 * Derive sensor and call-box placement suggestions from hotspot zones.
 *
 * Sensors: one per hotspot (all risk levels), offset via rotation table, cap 10.
 * Call boxes: one per high/extreme hotspot, pushed 60% toward the nearest bbox
 *   edge to simulate a trailhead approach point, cap 5.
 */
export function derivePlacements(
  zones: HotspotZone[],
  bbox: { south: number; north: number; west: number; east: number },
): PlacementSuggestions {
  const sensors: SensorSuggestion[] = [];
  const callBoxes: CallBoxSuggestion[] = [];

  const cx = (bbox.west + bbox.east) / 2;
  const cy = (bbox.south + bbox.north) / 2;

  zones.slice(0, 10).forEach((zone, i) => {
    // Sensor: offset from zone centre using rotation table
    const [dLat, dLon] = OFFSETS[i % OFFSETS.length];
    sensors.push({
      id: `SENSOR-${String(i + 1).padStart('03'.length, '0')}`,
      lat: zone.lat + dLat,
      lon: zone.lon + dLon,
      label: `SENSOR · ${zone.id}`,
    });

    // Call box: high/extreme zones only, pushed 60% toward nearest bbox edge
    if (zone.riskLevel === 'high' || zone.riskLevel === 'extreme') {
      if (callBoxes.length >= 5) return;

      // Nearest edge: compare distance from zone centre to each cardinal edge
      const distS = zone.lat - bbox.south;
      const distN = bbox.north - zone.lat;
      const distW = zone.lon - bbox.west;
      const distE = bbox.east - zone.lon;
      const minDist = Math.min(distS, distN, distW, distE);

      let edgeLat = zone.lat;
      let edgeLon = zone.lon;
      if (minDist === distS) edgeLat = bbox.south;
      else if (minDist === distN) edgeLat = bbox.north;
      else if (minDist === distW) edgeLon = bbox.west;
      else edgeLon = bbox.east;

      callBoxes.push({
        id: `CALLBOX-${String(callBoxes.length + 1).padStart('03'.length, '0')}`,
        lat: zone.lat + (edgeLat - zone.lat) * 0.6,
        lon: zone.lon + (edgeLon - zone.lon) * 0.6,
        label: `CALL BOX · ${zone.id}`,
      });
    }
  });

  // Suppress unused-variable lint (cx/cy kept for future proximity deduplication)
  void cx; void cy;

  return { sensors, callBoxes };
}
