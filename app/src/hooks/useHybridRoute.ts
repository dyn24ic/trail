'use client';

import { useState, useRef, useCallback } from 'react';
import type { HybridRoute, LatLon, Weather } from '@/types/backend';
import { findOptimalStop } from '@/lib/routeOptimizer';

export type RouteStatus = 'idle' | 'computing' | 'done' | 'error';

export function useHybridRoute() {
  const [ambulancePos, setAmbulancePos] = useState<LatLon | null>(null);
  const [victimPos, setVictimPos] = useState<LatLon | null>(null);
  const [hybridRoute, setHybridRoute] = useState<HybridRoute | null>(null);
  const [status, setStatus] = useState<RouteStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Cache weather to avoid re-fetching on every route compute
  const weatherCacheRef = useRef<{ pos: LatLon; weather: Weather } | null>(null);

  const fetchWeather = useCallback(async (pos: LatLon): Promise<Weather> => {
    const cache = weatherCacheRef.current;
    if (
      cache &&
      Math.abs(cache.pos.lat - pos.lat) < 0.05 &&
      Math.abs(cache.pos.lon - pos.lon) < 0.05
    ) {
      return cache.weather;
    }
    const res = await fetch(`/api/weather?lat=${pos.lat}&lon=${pos.lon}`);
    if (!res.ok) throw new Error(`Weather fetch failed ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error('Weather API error');
    const weather: Weather = data.weather;
    weatherCacheRef.current = { pos, weather };
    return weather;
  }, []);

  const computeRoute = useCallback(
    async (severity: number) => {
      if (!ambulancePos || !victimPos) return;
      setStatus('computing');
      setError(null);
      setHybridRoute(null);
      try {
        const weather = await fetchWeather(victimPos);
        const result = await findOptimalStop({
          ambulance: ambulancePos,
          victim: victimPos,
          severity,
          weather,
        });
        setHybridRoute(result);
        setStatus('done');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Route computation failed');
        setStatus('error');
      }
    },
    [ambulancePos, victimPos, fetchWeather]
  );

  const reset = useCallback(() => {
    setAmbulancePos(null);
    setVictimPos(null);
    setHybridRoute(null);
    setStatus('idle');
    setError(null);
  }, []);

  return {
    ambulancePos,
    victimPos,
    hybridRoute,
    status,
    error,
    setAmbulance: setAmbulancePos,
    setVictim: setVictimPos,
    computeRoute,
    reset,
  };
}
