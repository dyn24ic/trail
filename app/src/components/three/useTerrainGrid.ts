'use client';

import { useState, useEffect } from 'react';
import type { BBox, ElevationResponse } from '@/types/elevation';

export function useTerrainGrid(bbox: BBox, res: number): ElevationResponse | null {
  const [data, setData] = useState<ElevationResponse | null>(null);

  useEffect(() => {
    const key = `elevation:${bbox.south}:${bbox.north}:${bbox.west}:${bbox.east}:${res}`;

    // Check sessionStorage cache
    if (typeof sessionStorage !== 'undefined') {
      const cached = sessionStorage.getItem(key);
      if (cached) {
        try {
          setData(JSON.parse(cached));
          return;
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
        if (typeof sessionStorage !== 'undefined') {
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
