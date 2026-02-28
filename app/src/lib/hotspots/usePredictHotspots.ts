'use client';

import { useState, useCallback } from 'react';
import type { HotspotPredictionResponse, PlacementSuggestions } from '@/types/hotspots';
import { derivePlacements } from './placementAlgorithm';

type Status = 'idle' | 'loading' | 'loaded' | 'error';

interface BBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

function cacheKey(bbox: BBox): string {
  return `hotspots:${bbox.south}:${bbox.north}:${bbox.west}:${bbox.east}`;
}

export function usePredictHotspots(bbox: BBox) {
  const [status, setStatus] = useState<Status>('idle');
  const [data, setData] = useState<HotspotPredictionResponse | null>(null);
  const [placement, setPlacement] = useState<PlacementSuggestions | null>(null);

  const load = useCallback(async () => {
    if (status === 'loading') return;

    // Check sessionStorage cache first
    try {
      const cached = sessionStorage.getItem(cacheKey(bbox));
      if (cached) {
        const parsed = JSON.parse(cached) as { data: HotspotPredictionResponse; placement: PlacementSuggestions };
        setData(parsed.data);
        setPlacement(parsed.placement);
        setStatus('loaded');
        return;
      }
    } catch {
      // sessionStorage unavailable or JSON parse failed — proceed to fetch
    }

    setStatus('loading');
    try {
      const params = new URLSearchParams({
        south: String(bbox.south),
        north: String(bbox.north),
        west: String(bbox.west),
        east: String(bbox.east),
      });
      const res = await fetch(`/api/hotspots?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json: HotspotPredictionResponse = await res.json();
      const placements = derivePlacements(json.hotspots, json.bbox);

      // Persist to sessionStorage for this session
      try {
        sessionStorage.setItem(cacheKey(bbox), JSON.stringify({ data: json, placement: placements }));
      } catch {
        // Storage quota exceeded or unavailable — continue without caching
      }

      setData(json);
      setPlacement(placements);
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }, [bbox, status]);

  return { data, placement, load, status };
}
