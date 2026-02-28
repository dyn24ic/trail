'use client';

import { useState, useEffect } from 'react';
import type { BBox, ElevationResponse } from '@/types/elevation';

export function useTerrainGrid(bbox: BBox, res: number): ElevationResponse | null {
  const [data, setData] = useState<ElevationResponse | null>(null);

  useEffect(() => {
    const key = `elevation:${bbox.south}:${bbox.north}:${bbox.west}:${bbox.east}:${res}`;

    // Check sessionStorage cache — skip procedural entries so real API data
    // is fetched once an OpenTopography key becomes available.
    if (typeof sessionStorage !== 'undefined') {
      const cached = sessionStorage.getItem(key);
      if (cached) {
        try {
          const parsed: ElevationResponse = JSON.parse(cached);
          if (parsed.source !== 'procedural') {
            setData(parsed);
            return;
          }
          // Procedural data cached — discard and re-fetch so real API is tried
          sessionStorage.removeItem(key);
        } catch {
          // ignore corrupt cache
        }
      }
    }

    const url = `/api/elevation?south=${bbox.south}&north=${bbox.north}&west=${bbox.west}&east=${bbox.east}&res=${res}`;
    fetch(url)
      .then((r) => r.json())
      .then((json: ElevationResponse) => {
        setData(json);
        // Only persist real elevation data — procedural is fast to regenerate
        if (json.source !== 'procedural' && typeof sessionStorage !== 'undefined') {
          try {
            sessionStorage.setItem(key, JSON.stringify(json));
          } catch {
            // storage quota exceeded — ignore
          }
        }
      })
      .catch(console.error);
  }, [bbox.south, bbox.north, bbox.west, bbox.east, res]);

  return data;
}
